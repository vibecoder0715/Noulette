# Noulette LLM Fine-Tuning Pipeline

Self-contained QLoRA fine-tuning, evaluation, and export pipeline for the Noulette log analysis and early-warning detection model (based on `Qwen/Qwen3-8B`).

Designed to run on cloud or local GPUs with 16GB+ VRAM (NVIDIA RTX 4080 / 4090 / 5080 / A10 / L4 / A100).

---

## Directory Structure

```text
├── data/                  # Pre-built dataset files
│   ├── train.jsonl        # 210 training samples (20 scenario families)
│   ├── val.jsonl          # 30 validation samples
│   ├── test.jsonl         # 60 held-out evaluation test samples
│   └── meta.jsonl         # 300 metadata records with ground truth annotations
├── tests/
│   └── test_all.py        # 14 unit tests covering schemas, data, eval, and export
├── allowlist.py           # Security allowlist & prompt-injection defensive rules
├── build_dataset.py       # Deterministic scenario simulator & dataset generator
├── eval.py                # Benchmark evaluation suite across 10 core metrics
├── export.py              # 16-bit LoRA weight merger, GGUF converter, Ollama Modelfile
├── packet.py              # Telemetry & log packet schema definitions
├── requirements.txt       # Python dependencies
├── run.sh                 # End-to-end 7-stage orchestration script (with tmux support)
├── schema.py              # Strict JSON verdict schema and parser
├── simlib.py              # Simulation and metric calculation library
└── train.py               # Core QLoRA training script (4-bit NF4, SDPA, dynamic padding)
```

---

## Prerequisites

- **Python:** 3.10+
- **GPU:** NVIDIA GPU with 14GB+ VRAM (e.g. RTX 5080, RTX 4080/4090, A10, A100)
- **Hugging Face Token:** Free account token with read access to `Qwen/Qwen3-8B`

```bash
pip install -r requirements.txt
export HF_TOKEN="your_huggingface_token_here"
```

---

## Quick Start (Automated Pipeline)

Run all 7 stages (Preflight $\rightarrow$ Dependencies $\rightarrow$ 10-step Smoke Test $\rightarrow$ QLoRA Training $\rightarrow$ Evaluation $\rightarrow$ Export $\rightarrow$ Backup) in a single command:

```bash
bash run.sh --max-hours 3 --rental-hours 12
```

Flags:
- `--max-hours <N>`: Enforce a hard time cap in hours (saves clean checkpoint upon reaching limit).
- `--resume`: Resume from the latest checkpoint if interrupted.
- `--smoke-only`: Run only the 10-step verification test and stop.
- `--skip-smoke`: Skip the smoke test and start full training immediately.

---

## Manual Execution (Step-by-Step)

### 1. (Optional) Rebuild the Dataset
```bash
python build_dataset.py --seed 42 --train 210 --val 30 --test 60 --out data
```

### 2. Verify with Smoke Test (10 Steps)
```bash
python train.py --smoke --out ./output
```

### 3. Run Full QLoRA Training
```bash
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"
python train.py --out ./output --epochs 3 --lr 2e-4 --max-len 2048 --batch 1 --grad-accum 16
```

### 4. Evaluate on Held-Out Test Scenarios
```bash
python eval.py --adapter ./output/adapter --data data/test.jsonl --meta data/meta.jsonl --out ./output/results.json
```

Evaluation targets:
* Valid JSON format $\ge$ 99%
* Fix-needed recall $\ge$ 90%
* False alarm rate $\le$ 5%
* Prompt injection defense == 100%

### 5. Merge LoRA Weights & Export for Ollama
```bash
python export.py --adapter ./output/adapter --out ./output
```
Outputs:
* `output/merged/`: Standalone 16-bit model weights (no PEFT required).
* `output/Modelfile`: Ollama model configuration with stop tokens and system prompt.

---

## Running the Unit Tests

```bash
python -m unittest tests/test_all.py
```
