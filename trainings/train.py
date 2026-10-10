#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""
train.py - QLoRA fine-tuning for the Noulette log-analysis model.

What it does:
  1. Preflight checks (GPU, disk, token, Hugging Face, pip). Fails fast.
  2. Loads train/val JSONL files (chat format) and checks every line.
  3. Trains a small LoRA adapter on top of a 4-bit base model (QLoRA).
     The loss is counted on the assistant answer ONLY.
  4. Saves checkpoints so a crash can be resumed with --resume.
  5. Stops cleanly and saves when --max-hours is reached.
  6. Writes the final adapter and a DONE marker file.

Secrets: the Hugging Face token is read from the HF_TOKEN environment
variable only. It is never written to any file or log.

Exit codes: 0 ok, 2 preflight/data problem, 3 stopped early (time cap), 1 other error.
"""
import argparse
import inspect
import json
import logging
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_MODEL = "Qwen/Qwen3-8B"  # Apache-2.0, not gated. Check the model card before use.
DEFAULT_OUT = "/root/noulette-out"
UNTRUSTED_OPEN = "<<<UNTRUSTED_LOGS>>>"
UNTRUSTED_CLOSE = "<<<END_UNTRUSTED_LOGS>>>"

log = logging.getLogger("noulette")


# --------------------------------------------------------------------------
# Logging (the token is blanked out of every message, just in case)
# --------------------------------------------------------------------------
class _RedactToken(logging.Filter):
    def filter(self, record):
        token = os.environ.get("HF_TOKEN", "")
        if token and len(token) > 8:
            record.msg = str(record.getMessage()).replace(token, "***")
            record.args = ()
        return True


def setup_logging(log_path):
    log.setLevel(logging.INFO)
    log.handlers.clear()
    fmt = logging.Formatter("%(asctime)s  %(message)s", "%Y-%m-%d %H:%M:%S")
    for handler in (logging.StreamHandler(sys.stdout), logging.FileHandler(log_path, encoding="utf-8")):
        handler.setFormatter(fmt)
        handler.addFilter(_RedactToken())
        log.addHandler(handler)


# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------
def _hf_check(token):
    """Returns (reachable, message). The token is only sent to huggingface.co."""
    try:
        req = urllib.request.Request(
            "https://huggingface.co/api/whoami-v2",
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return True, f"Hugging Face reachable (HTTP {resp.status}), token accepted."
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return True, "Hugging Face reachable, but the token was REJECTED. Make a new token."
        return True, f"Hugging Face reachable (HTTP {e.code})."
    except Exception as e:  # network down, DNS, proxy...
        return False, f"Cannot reach huggingface.co ({type(e).__name__}). Check the instance's internet."


def preflight(args, out_dir):
    """Returns a list of plain-language problems. Empty list = all good."""
    problems = []
    cpu_mode = args.cpu
    print("== Preflight checks ==")

    # GPU and VRAM
    try:
        import torch
        if torch.cuda.is_available() and not cpu_mode:
            props = torch.cuda.get_device_properties(0)
            vram = props.total_memory / 1024 ** 3
            print(f"GPU: {props.name}, {vram:.1f} GiB")
            if vram < args.min_vram_gib:
                problems.append(f"GPU has {vram:.1f} GiB memory, need at least {args.min_vram_gib} GiB. Rent a 16GB or 24GB GPU.")
            if vram < 18.0 and args.max_len > 3072:
                print(f"Notice: GPU has {vram:.1f} GiB (16GB class). Recommended --max-len is 3072 to stay safely within 16GB VRAM.")
            if not torch.cuda.is_bf16_supported():
                problems.append("This GPU does not support bf16. Pick a newer GPU (RTX 30xx/40xx, A-series).")
        elif cpu_mode:
            print("CPU mode (only for the tiny-model smoke test).")
        else:
            problems.append("No GPU found. Real training needs the rented GPU. (CPU is only for --smoke --cpu with a tiny model.)")
        print(f"torch {torch.__version__}")
    except ImportError:
        problems.append("PyTorch is not installed. On Grafilab pick the 'PyTorch + CUDA' template.")

    # Required libraries
    for mod in ("transformers", "peft", "accelerate"):
        try:
            __import__(mod)
        except ImportError:
            problems.append(f"Python package '{mod}' is missing. Run: pip install -r requirements.txt")
    if not cpu_mode:
        try:
            __import__("bitsandbytes")
        except Exception:
            problems.append("Python package 'bitsandbytes' is missing or broken. Run: pip install -r requirements.txt")

    # Free disk
    out_dir.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(out_dir).free / 1024 ** 3
    print(f"Free disk: {free:.1f} GiB")
    if free < args.min_disk_gib:
        problems.append(f"Only {free:.1f} GiB free disk, need {args.min_disk_gib} GiB (model download + checkpoints).")

    # Token + Hugging Face
    token = os.environ.get("HF_TOKEN", "")
    if not token:
        if cpu_mode:
            print("HF_TOKEN not set (ok for CPU smoke test with a public tiny model).")
        else:
            problems.append("HF_TOKEN is not set. Type: export HF_TOKEN=... (in this terminal only).")
    ok, msg = _hf_check(token)
    print(msg)
    if not ok or "REJECTED" in msg:
        problems.append(msg)

    # pip
    try:
        r = subprocess.run([sys.executable, "-m", "pip", "--version"], capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            problems.append("pip does not work: " + (r.stderr.strip()[:200] or "unknown error"))
        else:
            print(r.stdout.strip())
    except Exception as e:
        problems.append(f"pip does not work ({type(e).__name__}).")

    return problems


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------
def load_jsonl(path, allow_unwrapped=False):
    """Reads chat-format JSONL. Raises ValueError with a plain message on bad data."""
    path = Path(path)
    if not path.exists():
        raise ValueError(f"File not found: {path}")
    rows = []
    with path.open(encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                msgs = row["messages"]
            except Exception:
                raise ValueError(f"{path.name} line {n}: not valid JSON with a 'messages' list.")
            if not isinstance(msgs, list) or len(msgs) < 2:
                raise ValueError(f"{path.name} line {n}: need at least a user and an assistant message.")
            for m in msgs:
                if m.get("role") not in ("system", "user", "assistant") or not isinstance(m.get("content"), str):
                    raise ValueError(f"{path.name} line {n}: each message needs a role and text content.")
            if msgs[-1]["role"] != "assistant":
                raise ValueError(f"{path.name} line {n}: the last message must be the assistant answer.")
            try:
                json.loads(msgs[-1]["content"])
            except Exception:
                raise ValueError(f"{path.name} line {n}: assistant answer is not strict JSON.")
            if not allow_unwrapped:
                user_text = "\n".join(m["content"] for m in msgs[:-1] if m["role"] == "user")
                if UNTRUSTED_OPEN not in user_text or UNTRUSTED_CLOSE not in user_text:
                    raise ValueError(f"{path.name} line {n}: log text is not wrapped in {UNTRUSTED_OPEN} ... {UNTRUSTED_CLOSE}.")
            rows.append(msgs)
    if not rows:
        raise ValueError(f"{path.name} is empty.")
    return rows


_FALLBACK_TEMPLATE = (
    "{% for m in messages %}<|{{ m['role'] }}|>\n{{ m['content'] }}\n{% endfor %}"
    "{% if add_generation_prompt %}<|assistant|>\n{% endif %}"
)


def prepare_tokenizer(tok):
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    if getattr(tok, "chat_template", None) is None:  # only tiny test models
        tok.chat_template = _FALLBACK_TEMPLATE
    return tok


def encode_example(tok, messages, max_len):
    """
    Turns one chat sample into token ids + labels.
    Everything before the assistant answer gets label -100 (ignored by the loss).
    Only the answer (plus the end-of-turn token) is learned.
    Returns None if the sample is longer than max_len (we never cut the answer).
    """
    prompt_text = tok.apply_chat_template(
        messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False
    )
    answer_text = messages[-1]["content"] + (tok.eos_token or "")
    prompt_ids = tok(prompt_text, add_special_tokens=False)["input_ids"]
    answer_ids = tok(answer_text, add_special_tokens=False)["input_ids"]
    ids = prompt_ids + answer_ids
    if len(answer_ids) >= max_len:
        return None
    max_prompt = max_len - len(answer_ids)
    if len(prompt_ids) > max_prompt:
        prompt_ids = prompt_ids[-max_prompt:]
    ids = prompt_ids + answer_ids
    return {"input_ids": ids, "labels": [-100] * len(prompt_ids) + answer_ids}


def encode_all(tok, rows, max_len, name):
    out, dropped = [], 0
    for msgs in rows:
        enc = encode_example(tok, msgs, max_len)
        if enc is None:
            dropped += 1
        else:
            out.append(enc)
    lens = [len(e["input_ids"]) for e in out] or [0]
    log.info(f"{name}: {len(out)} samples kept, {dropped} dropped (longer than {max_len} tokens). "
             f"Length mean {sum(lens)//len(lens)}, max {max(lens)}.")
    if rows and dropped / len(rows) > 0.10:
        raise ValueError(f"{name}: more than 10% of samples are too long. Make the packets shorter or raise --max-len.")
    if not out:
        raise ValueError(f"{name}: no usable samples.")
    return out


def make_collator(pad_id):
    import torch

    def collate(batch):
        n = max(len(b["input_ids"]) for b in batch)
        ids = torch.full((len(batch), n), pad_id, dtype=torch.long)
        lab = torch.full((len(batch), n), -100, dtype=torch.long)
        att = torch.zeros((len(batch), n), dtype=torch.long)
        for i, b in enumerate(batch):
            k = len(b["input_ids"])
            ids[i, :k] = torch.tensor(b["input_ids"])
            lab[i, :k] = torch.tensor(b["labels"])
            att[i, :k] = 1
        return {"input_ids": ids, "labels": lab, "attention_mask": att}

    return collate


# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------
def build_model(args, use_4bit):
    import torch
    try:
        import transformers.utils.quantization_config as qc
        qc.torch = torch
    except Exception:
        pass
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig  # type: ignore
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training  # type: ignore

    kwargs = {}
    if use_4bit:
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
        kwargs["device_map"] = {"": 0}
        kwargs["attn_implementation"] = "sdpa"
    dtype = torch.bfloat16 if use_4bit else torch.float32
    try:
        model = AutoModelForCausalLM.from_pretrained(args.model, dtype=dtype, **kwargs)
    except TypeError:  # older transformers call it torch_dtype
        model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=dtype, **kwargs)
    model.config.use_cache = False
    if use_4bit:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    lora = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_r * 2,
        lora_dropout=0.05,
        target_modules="all-linear",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()
    return model


def run_training(args, out_dir):
    import torch
    import transformers  # type: ignore
    from transformers import AutoTokenizer, Trainer, TrainerCallback, TrainingArguments  # type: ignore
    from transformers.trainer_utils import get_last_checkpoint  # type: ignore

    use_4bit = torch.cuda.is_available() and not args.cpu
    ckpt_dir = out_dir / "checkpoints"
    adapter_dir = out_dir / "adapter"

    # Never overwrite old checkpoints by accident
    last_ckpt = get_last_checkpoint(str(ckpt_dir)) if ckpt_dir.exists() else None
    if last_ckpt and not args.resume:
        raise ValueError(f"Old checkpoints found in {ckpt_dir}. Use --resume to continue, "
                         f"or delete that folder to start over.")
    if args.resume and not last_ckpt:
        log.info("--resume given but no checkpoint exists yet. Starting from the beginning.")

    # Fixed seed
    random.seed(args.seed)
    transformers.set_seed(args.seed)

    # Data
    train_rows = load_jsonl(args.train, args.allow_unwrapped)
    val_rows = load_jsonl(args.val, args.allow_unwrapped) if Path(args.val).exists() else []
    if args.smoke:
        train_rows, val_rows = train_rows[:8], val_rows[:4]
    tok = prepare_tokenizer(AutoTokenizer.from_pretrained(args.model))
    train_ds = encode_all(tok, train_rows, args.max_len, "train")
    val_ds = encode_all(tok, val_rows, args.max_len, "val") if val_rows else []

    # Show that only the answer is learned
    first = train_ds[0]
    learned = [t for t in first["labels"] if t != -100]
    log.info(f"Loss check: first sample has {len(first['input_ids'])} tokens, {len(learned)} are learned (answer only).")
    log.info("First learned text: " + tok.decode(learned)[:300].replace("\n", " "))
    if not learned:
        raise ValueError("No answer tokens to learn. Something is wrong with the chat template.")

    # Model
    log.info(f"Loading {args.model} ({'4-bit NF4' if use_4bit else 'CPU, no quantization'}) ...")
    model = build_model(args, use_4bit)

    # Training arguments (names changed between transformers versions, so we check)
    ta_params = inspect.signature(TrainingArguments.__init__).parameters
    eval_key = "eval_strategy" if "eval_strategy" in ta_params else "evaluation_strategy"
    save_steps = 5 if args.smoke else args.save_steps
    ta_kwargs = dict(
        output_dir=str(ckpt_dir),
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        gradient_accumulation_steps=1 if args.smoke else args.grad_accum,
        num_train_epochs=args.epochs,
        max_steps=10 if args.smoke else -1,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_grad_norm=0.3,
        bf16=use_4bit,
        optim="paged_adamw_8bit" if use_4bit else "adamw_torch",
        gradient_checkpointing=use_4bit,
        logging_steps=1,
        save_strategy="steps",
        save_steps=save_steps,
        save_total_limit=3,
        seed=args.seed,
        data_seed=args.seed,
        report_to="none",
        remove_unused_columns=False,
        use_cpu=not use_4bit,
        **{eval_key: "no" if args.smoke else ("steps" if val_ds else "no")},
    )
    if val_ds and not args.smoke:
        ta_kwargs["eval_steps"] = save_steps
    if use_4bit:
        ta_kwargs["gradient_checkpointing_kwargs"] = {"use_reentrant": False}
    filtered_kwargs = {k: v for k, v in ta_kwargs.items() if k in ta_params}
    if "warmup_ratio" not in ta_params and "warmup_steps" in ta_params:
        filtered_kwargs["warmup_steps"] = 1 if args.smoke else 5
    targs = TrainingArguments(**filtered_kwargs)

    # Time cap: stop cleanly and save
    start = time.time()
    state = {"stopped_early": False}

    class Watch(TrainerCallback):
        def on_log(self, a, s, c, logs=None, **kw):
            if logs:
                log.info(f"step {s.global_step}/{s.max_steps} " + json.dumps(
                    {k: (round(v, 5) if isinstance(v, float) else v) for k, v in logs.items()}))

        def on_step_end(self, a, s, control, **kw):
            if args.max_hours and (time.time() - start) > args.max_hours * 3600:
                log.info(f"--max-hours {args.max_hours} reached. Saving and stopping.")
                state["stopped_early"] = True
                control.should_save = True
                control.should_training_stop = True
            return control

        def on_evaluate(self, a, s, control, **kw):
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        def on_save(self, a, s, control, **kw):
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    tr_params = inspect.signature(Trainer.__init__).parameters
    tok_key = "processing_class" if "processing_class" in tr_params else "tokenizer"
    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=train_ds,
        eval_dataset=val_ds or None,
        data_collator=make_collator(tok.pad_token_id),
        callbacks=[Watch()],
        **{tok_key: tok},
    )

    log.info("Training starts." + (f" Resuming from {last_ckpt}" if (args.resume and last_ckpt) else ""))
    trainer.train(resume_from_checkpoint=last_ckpt if args.resume and last_ckpt else None)

    # Save adapter (small) + tokenizer
    trainer.save_model(str(adapter_dir))
    tok.save_pretrained(str(adapter_dir))
    info = {
        "model": args.model,
        "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "steps": trainer.state.global_step,
        "seed": args.seed,
        "smoke": args.smoke,
        "minutes_this_run": round((time.time() - start) / 60, 1),
    }
    if state["stopped_early"]:
        (out_dir / "STOPPED_EARLY").write_text(json.dumps(info, indent=2))
        log.info("Stopped early because of --max-hours. Adapter saved. Run again with --resume to continue.")
        return 3
    (out_dir / "DONE").write_text(json.dumps(info, indent=2))
    log.info(f"All done. Adapter saved in {adapter_dir}. DONE marker written.")
    return 0


# --------------------------------------------------------------------------
def parse_args(argv=None):
    p = argparse.ArgumentParser(description="QLoRA training for the Noulette log model.")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--train", default=str(HERE / "data" / "train.jsonl"))
    p.add_argument("--val", default=str(HERE / "data" / "val.jsonl"))
    p.add_argument("--out", default=DEFAULT_OUT)
    p.add_argument("--epochs", type=float, default=3)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--grad-accum", type=int, default=16)
    p.add_argument("--max-len", type=int, default=2048, help="max tokens (2048 is safe for 16GB VRAM)")
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--save-steps", type=int, default=10)
    p.add_argument("--max-hours", type=float, default=0, help="hard time cap for this run (0 = no cap)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--resume", action="store_true", help="continue from the latest checkpoint")
    p.add_argument("--smoke", action="store_true", help="about 10 steps on a handful of samples")
    p.add_argument("--cpu", action="store_true", help="CPU only (tiny-model smoke test, no 4-bit)")
    p.add_argument("--preflight-only", action="store_true")
    p.add_argument("--allow-unwrapped", action="store_true", help="skip the UNTRUSTED_LOGS wrapper check")
    p.add_argument("--min-vram-gib", type=float, default=14.0, help="minimum VRAM required in GiB (14.0 fits 16GB GPUs)")
    p.add_argument("--min-disk-gib", type=float, default=50)
    args = p.parse_args(argv)
    if args.smoke and args.cpu:
        args.min_disk_gib = min(args.min_disk_gib, 5)
    return args


def main(argv=None):
    args = parse_args(argv)
    out_dir = Path(args.out) / ("smoke" if args.smoke else "")
    out_dir.mkdir(parents=True, exist_ok=True)
    setup_logging(out_dir / "train.log")

    problems = preflight(args, out_dir)
    if problems:
        print("\nPreflight FAILED:")
        for item in problems:
            print("  - " + item)
        return 2
    print("Preflight OK.\n")
    if args.preflight_only:
        return 0

    try:
        import peft, transformers, torch  # type: ignore
        versions = f"torch {torch.__version__}, transformers {transformers.__version__}, peft {peft.__version__}"
        try:
            import importlib
            bnb = importlib.import_module("bitsandbytes")
            versions += f", bitsandbytes {bnb.__version__}"
        except Exception:
            pass
        log.info("Versions: " + versions)
        (out_dir / "versions.txt").write_text(versions + "\n")
        return run_training(args, out_dir)
    except ValueError as e:
        log.info(f"STOPPED: {e}")
        return 2
    except Exception as e:
        if "out of memory" in str(e).lower():
            log.info("OUT OF MEMORY. Try: --max-len 3072  (or  --max-len 2048), keep --batch 1, then run again.")
            return 1
        log.exception("Training crashed. You can run again with --resume to continue from the last checkpoint.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
