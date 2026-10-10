#!/usr/bin/env bash
# run.sh - Complete autonomous orchestration script for Noulette on Grafilab
# Runs inside tmux, logs to /root/noulette-out/run.log, supports resumption.

set -euo pipefail

export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# --------------------------------------------------------------------------
# Defaults and Flag Parsing
# --------------------------------------------------------------------------
SMOKE_ONLY=false
SKIP_SMOKE=false
RESUME=false
DRY_RUN=false
MAX_HOURS=3
RENTAL_HOURS=12

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke-only)
      SMOKE_ONLY=true
      shift
      ;;
    --skip-smoke)
      SKIP_SMOKE=true
      shift
      ;;
    --resume)
      RESUME=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --max-hours)
      MAX_HOURS="$2"
      shift 2
      ;;
    --rental-hours)
      RENTAL_HOURS="$2"
      shift 2
      ;;
    --out)
      OUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

OUT_DIR="${OUT_DIR:-/root/noulette-out}"
if [[ "$DRY_RUN" == false ]]; then
  mkdir -p "$OUT_DIR" 2>/dev/null || OUT_DIR="./noulette-out"
  mkdir -p "$OUT_DIR"
fi
LOG_FILE="$OUT_DIR/run.log"

START_TIME=$(date +%s)

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  if [[ "$DRY_RUN" == false ]]; then
    echo "$msg" >> "$LOG_FILE"
  fi
}

check_time_remaining() {
  local now
  now=$(date +%s)
  local elapsed_hours
  elapsed_hours=$(echo "scale=2; ($now - $START_TIME) / 3600" | bc -l 2>/dev/null || echo "0")
  local remaining_hours
  remaining_hours=$(echo "scale=2; $RENTAL_HOURS - $elapsed_hours" | bc -l 2>/dev/null || echo "12")
  log "Time update: ${elapsed_hours}h elapsed, approx ${remaining_hours}h remaining of ${RENTAL_HOURS}h rental."

  if (( $(echo "$remaining_hours < 2.0" | bc -l 2>/dev/null || echo "0") )); then
    log "=========================================================================="
    log "CRITICAL WARNING: Less than 2 hours remaining in rental period!"
    log "Initiate a Backup in Grafilab Console NOW for: $OUT_DIR"
    log "Exclude patterns: /root/.cache/**"
    log "=========================================================================="
  fi
}

log "=========================================================================="
log "Starting Noulette Fine-Tuning Pipeline"
log "Flags: max-hours=$MAX_HOURS, rental-hours=$RENTAL_HOURS, resume=$RESUME, dry-run=$DRY_RUN"
log "=========================================================================="

# --------------------------------------------------------------------------
# Stage 1: Preflight
# --------------------------------------------------------------------------
log "--> Stage 1: Preflight"
if [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] Stage 1: Checking GPU VRAM, free disk, HF_TOKEN presence, pip, and data files."
else
  # Verify data files exist
  for f in data/train.jsonl data/val.jsonl data/test.jsonl data/meta.jsonl; do
    if [[ ! -s "$f" ]]; then
      log "Preflight Error: Required data file missing or empty: $f"
      exit 2
    fi
  done

  # Verify HF_TOKEN
  if [[ -z "${HF_TOKEN:-}" ]]; then
    log "Preflight Error: HF_TOKEN environment variable is not set."
    log "Run: export HF_TOKEN=your_huggingface_token (typed in terminal only)"
    exit 2
  else
    log "HF_TOKEN is set (value redacted)."
  fi

  # Run Python preflight
  python train.py --preflight-only
fi
check_time_remaining

# --------------------------------------------------------------------------
# Stage 2: Install Dependencies
# --------------------------------------------------------------------------
INSTALL_MARKER="$OUT_DIR/INSTALL_DONE"
log "--> Stage 2: Install Dependencies"
if [[ -f "$INSTALL_MARKER" ]]; then
  log "Dependencies already installed ($INSTALL_MARKER exists). Skipping."
elif [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] Stage 2: pip install -r requirements.txt && touch $INSTALL_MARKER"
else
  pip uninstall -y torchvision torchaudio 2>/dev/null || true
  pip install --no-cache-dir -r requirements.txt
  touch "$INSTALL_MARKER"
  log "Dependencies installed successfully."
fi
check_time_remaining

# --------------------------------------------------------------------------
# Stage 3: Smoke Test
# --------------------------------------------------------------------------
SMOKE_MARKER="$OUT_DIR/smoke/DONE"
log "--> Stage 3: Smoke Test"
if [[ "$SKIP_SMOKE" == true ]]; then
  log "Skipping smoke test (--skip-smoke specified)."
elif [[ -f "$SMOKE_MARKER" ]]; then
  log "Smoke test already completed ($SMOKE_MARKER exists). Skipping."
elif [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] Stage 3: python train.py --smoke --out $OUT_DIR"
else
  log "Running 10-step smoke test to verify model loading and 4-bit forward/backward pass..."
  python train.py --smoke --out "$OUT_DIR"
  log "Smoke test passed."
fi
check_time_remaining

if [[ "$SMOKE_ONLY" == true ]]; then
  log "Stopping after smoke test (--smoke-only specified)."
  exit 0
fi

# --------------------------------------------------------------------------
# Stage 4: Full Training
# --------------------------------------------------------------------------
TRAIN_MARKER="$OUT_DIR/DONE"
log "--> Stage 4: QLoRA Training"
if [[ -f "$TRAIN_MARKER" && "$RESUME" == false ]]; then
  log "Training already finished ($TRAIN_MARKER exists). Skipping."
elif [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] Stage 4: python train.py --out $OUT_DIR --max-hours $MAX_HOURS $([[ "$RESUME" == true ]] && echo "--resume")"
else
  TRAIN_CMD="python train.py --out $OUT_DIR --max-hours $MAX_HOURS"
  if [[ "$RESUME" == true ]]; then
    TRAIN_CMD="$TRAIN_CMD --resume"
  fi
  log "Executing: $TRAIN_CMD"
  $TRAIN_CMD
  log "Training phase completed."
fi
check_time_remaining

# --------------------------------------------------------------------------
# Stage 5: Evaluation
# --------------------------------------------------------------------------
EVAL_MARKER="$OUT_DIR/results.json"
log "--> Stage 5: Evaluation on Held-Out Test Set"
if [[ -f "$EVAL_MARKER" && "$RESUME" == false ]]; then
  log "Evaluation already done ($EVAL_MARKER exists). Skipping."
elif [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] Stage 5: python eval.py --adapter $OUT_DIR/adapter --out $EVAL_MARKER"
else
  python eval.py --adapter "$OUT_DIR/adapter" --out "$EVAL_MARKER" || log "Eval finished with warnings."
fi
check_time_remaining

# --------------------------------------------------------------------------
# Stage 6: Export & Merge
# --------------------------------------------------------------------------
EXPORT_MARKER="$OUT_DIR/EXPORT_DONE"
log "--> Stage 6: Model Export and GGUF Conversion"
if [[ -f "$EXPORT_MARKER" && "$RESUME" == false ]]; then
  log "Export already completed ($EXPORT_MARKER exists). Skipping."
elif [[ "$DRY_RUN" == true ]]; then
  echo "[DRY-RUN] Stage 6: python export.py --adapter $OUT_DIR/adapter --out $OUT_DIR"
else
  python export.py --adapter "$OUT_DIR/adapter" --out "$OUT_DIR"
fi
check_time_remaining

# --------------------------------------------------------------------------
# Stage 7: Finish & Backup Reminder
# --------------------------------------------------------------------------
log "=========================================================================="
log "PIPELINE COMPLETED SUCCESSFULLY"
log "=========================================================================="
log "Artifacts directory: $OUT_DIR"
log "Adapter location:    $OUT_DIR/adapter"
log "Evaluation results:  $OUT_DIR/results.json"
log "Merged weights:      $OUT_DIR/merged"
log ""
log ">>> IMPORTANT BACKUP ACTION REQUIRED NOW <<<"
log "1. In Grafilab Console, go to 'My Instance' -> Click 'Backup'."
log "2. Backup Directory: $OUT_DIR"
log "3. Exclude Patterns: /root/.cache/**"
log "4. Wait for backup to generate, then download the .tar file immediately to your PC!"
log "5. The rental container and un-backed data will be permanently deleted upon expiry."
log "=========================================================================="
