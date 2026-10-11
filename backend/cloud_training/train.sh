#!/usr/bin/env bash
# Trains splatfacto on this package, exports the Gaussian PLY, evaluates it on
# the held-out photos and gathers everything Spatial Lab needs in one folder.
#
#   bash train.sh smoke      300 iterations, 2-5 min: proves install, training, export, evaluation, report
#   bash train.sh quick      7,000 iterations: first look at quality
#   bash train.sh quality    30,000 iterations: the first useful reconstruction
#   bash train.sh finish /workspace/outputs/<result folder>
#                            retries the PLY export, evaluation and report of a finished training
#
# Every run gets its own folders (preset + UTC time), so runs never overwrite each other:
#   /workspace/outputs/{{SLUG}}/splatfacto/<preset>-<time>/   Nerfstudio's run: config, checkpoint, TensorBoard
#   /workspace/outputs/{{SLUG}}-<preset>-<time>/              the result to download
#
# Run it detached so a dropped connection doesn't stop it:
#   nohup bash train.sh quick > quick.out 2>&1 &     then: tail -f quick.out
set -uo pipefail   # no -e: a failed export or evaluation must not throw away a finished training

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="{{SLUG}}"
OUT="${OUT:-/workspace/outputs}"
VENV="${VENV:-/workspace/nerfstudio-venv}"
if [ -x "$VENV/bin/ns-train" ]; then export PATH="$VENV/bin:$PATH"; fi
command -v ns-train >/dev/null || { echo "ns-train not found: run bash setup_env.sh first."; exit 1; }
export TORCH_HOME="${TORCH_HOME:-/workspace/.cache/torch}"   # LPIPS weights: on the volume, not the container disk

MODE="${1:-}"
case "$MODE" in
  smoke) ITERATIONS=300 ;;
  quick) ITERATIONS=7000 ;;
  quality) ITERATIONS=30000 ;;
  finish)
    RESULT="$(cd "${2:?usage: bash train.sh finish <result folder>}" && pwd)" || exit 2
    [ -f "$RESULT/run.env" ] || { echo "$RESULT is not a train.sh result folder (no run.env)."; exit 2; }
    ;;
  *) echo "usage: bash train.sh smoke|quick|quality   or   bash train.sh finish <result folder>"; exit 2 ;;
esac

# One job per GPU: a second run would compete for memory and the viewer port.
mkdir -p "$OUT"
exec 9>"$OUT/.train.lock"
flock -n 9 || { echo "Another train.sh is still running (see nvidia-smi). Wait for it to finish."; exit 1; }

# run.env: KEY=value lines, later lines win. Lets `finish` pick up where a run stopped.
record() { echo "$1=$2" >> "$RESULT/run.env"; }
# Nerfstudio names checkpoints step-<step, 9 digits>.ckpt; the highest step number wins.
latest_checkpoint() {
  local file step best="" best_step=-1
  for file in "$RUN_DIR"/nerfstudio_models/step-*.ckpt; do
    [ -f "$file" ] || continue
    step="${file##*/step-}"; step="${step%.ckpt}"
    [[ "$step" =~ ^[0-9]+$ ]] || continue
    if (( 10#$step > best_step )); then best_step=$((10#$step)); best="$file"; fi
  done
  echo "$best"
}

if [ "$MODE" != finish ]; then
  PRESET="$MODE"
  RUN_ID="$PRESET-$(date -u +%Y%m%d-%H%M%S)"
  RUN_DIR="$OUT/$NAME/splatfacto/$RUN_ID"   # Nerfstudio's layout: output-dir/experiment/method/timestamp
  RESULT="$OUT/$NAME-$RUN_ID"
  mkdir "$RESULT" || exit 1
  record PRESET "$PRESET"; record ITERATIONS "$ITERATIONS"; record RUN_DIR "$RUN_DIR"; record PACKAGE "$HERE"
  echo "Preset $PRESET ($ITERATIONS iterations). Nerfstudio run: $RUN_DIR  Result: $RESULT"
  df -h "$OUT" | tail -1 | awk '{print "Free space on the volume: " $4}'

  # GPU memory and load every 5 s (peak memory for the record).
  nvidia-smi --query-gpu=timestamp,name,memory.used,memory.total,utilization.gpu --format=csv,nounits -l 5 > "$RESULT/gpu.csv" &
  MONITOR=$!
  trap 'kill $MONITOR 2>/dev/null || true' EXIT

  # The COLMAP model is read as exported: images at the calibrated size (downscale 1, so Nerfstudio never
  # stops to ask), photos sorted by COLMAP image id, every 8th held out (the "eval" photos in manifest.json).
  echo "== Training"
  START=$(date +%s)
  ns-train splatfacto \
    --data "$HERE" \
    --output-dir "$OUT" --experiment-name "$NAME" --timestamp "$RUN_ID" \
    --max-num-iterations "$ITERATIONS" \
    --vis viewer+tensorboard --viewer.quit-on-train-completion True \
    colmap \
    --colmap-path sparse/0 --images-path images \
    --downscale-factor 1 \
    --eval-mode interval --eval-interval 8 \
    2>&1 | tee "$RESULT/train.log"
  TRAIN_RC=${PIPESTATUS[0]}
  record TRAIN_SECONDS $(( $(date +%s) - START ))
  kill $MONITOR 2>/dev/null || true

  # Nerfstudio saves a checkpoint every 2,000 steps and at the end; it stays in $RUN_DIR whatever happens next.
  # Training ran steps 0..ITERATIONS-1 and saves the last one at the end.
  FINAL_CHECKPOINT="$(printf 'step-%09d.ckpt' $((ITERATIONS - 1)))"
  LATEST="$(latest_checkpoint)"
  if [ "$TRAIN_RC" -eq 0 ] && [ "${LATEST##*/}" = "$FINAL_CHECKPOINT" ]; then
    record TRAIN ok
  elif [ -n "$LATEST" ]; then
    record TRAIN incomplete
    echo "!! Training stopped early (exit code $TRAIN_RC). The last checkpoint is still exported and evaluated."
  else
    record TRAIN failed
    echo "!! Training failed (exit code $TRAIN_RC) before any checkpoint. See $RESULT/train.log."
  fi
fi

# shellcheck disable=SC1091
source "$RESULT/run.env"
for f in "$RUN_DIR/config.yml" "$RUN_DIR/dataparser_transforms.json" "$PACKAGE/manifest.json"; do
  [ -f "$f" ] && cp -n "$f" "$RESULT/"
done
CHECKPOINT="$(latest_checkpoint)"

if [ -n "$CHECKPOINT" ] && [ "${EXPORT:-}" != ok ]; then
  echo "== Exporting the Gaussian PLY"
  ns-export gaussian-splat --load-config "$RUN_DIR/config.yml" --output-dir "$RESULT" 2>&1 | tee "$RESULT/export.log"
  if [ "${PIPESTATUS[0]}" -eq 0 ] && [ -s "$RESULT/splat.ply" ]; then record EXPORT ok; else record EXPORT failed; fi
fi

if [ -n "$CHECKPOINT" ] && [ "${EVAL:-}" != ok ]; then
  echo "== Evaluating on the held-out photos (PSNR / SSIM / LPIPS + side-by-side renders)"
  ns-eval --load-config "$RUN_DIR/config.yml" --output-path "$RESULT/eval.json" \
    --render-output-path "$RESULT/eval-renders" 2>&1 | tee "$RESULT/eval.log"
  if [ "${PIPESTATUS[0]}" -eq 0 ] && [ -s "$RESULT/eval.json" ]; then record EVAL ok; else record EVAL failed; fi
fi

# run.json: the facts Spatial Lab records with the imported scene. Every item is optional: a missing
# file becomes null plus a line in "problems", never a lost result.
echo "== Writing run.json"
python - "$RESULT" "$CHECKPOINT" <<'EOF'
import csv, json, sys
from importlib.metadata import version
from pathlib import Path

result, checkpoint = Path(sys.argv[1]), sys.argv[2]
env = dict(line.split("=", 1) for line in (result / "run.env").read_text().splitlines() if "=" in line)
problems = []


def attempt(label, fn):
    try:
        return fn()
    except Exception as error:  # noqa: BLE001 - the report must survive anything
        problems.append(f"{label}: {type(error).__name__}: {error}")
        return None


def gaussians():
    with (result / "splat.ply").open("rb") as f:
        header = f.read(4096).split(b"end_header")[0].decode("ascii", "replace")
    return next(int(line.split()[2]) for line in header.splitlines() if line.startswith("element vertex"))


def gpu():
    rows = [r for r in csv.reader((result / "gpu.csv").open()) if len(r) > 2 and r[2].strip().isdigit()]
    return rows[0][1].strip(), max(int(r[2]) for r in rows)


def nerfstudio_eval_files():
    # The held-out photos in the order ns-eval renders them (eval_img_0000.png, ...), from the run's own config.
    import yaml
    config = yaml.load((result / "config.yml").read_text(), Loader=yaml.Loader)
    datamanager = config.pipeline.datamanager
    if datamanager.data is not None:
        datamanager.dataparser.data = Path(datamanager.data)
    outputs = datamanager.dataparser.setup().get_dataparser_outputs(split="test")
    return [p.name for p in outputs.image_filenames]


manifest = attempt("manifest.json", lambda: json.loads((result / "manifest.json").read_text())) or {}
by_name = {Path(i["file"]).name: i for i in manifest.get("images", [])}
manifest_eval = [Path(i["file"]).name for i in manifest.get("images", []) if i["split"] == "eval"]
trained = (result / "config.yml").exists()
eval_files = attempt("held-out photos from Nerfstudio's dataparser", nerfstudio_eval_files) if trained else None
split_matches = eval_files == manifest_eval if eval_files is not None and manifest else None
if split_matches is False:
    problems.append("Nerfstudio held out different photos than manifest.json lists; INDEX.txt follows Nerfstudio")

renders = result / "eval-renders"
if renders.is_dir():
    names = eval_files if eval_files is not None else manifest_eval
    lines = []
    for k, name in enumerate(names):
        original = by_name.get(name, {}).get("originalFilename", "?")
        present = "" if (renders / f"eval_img_{k:04d}.png").exists() else "  (render missing)"
        lines.append(f"eval_img_{k:04d}.png  images/{name}  ({original}){present}\n")
    (renders / "INDEX.txt").write_text("".join(lines))

gpu_name, peak = attempt("gpu.csv", gpu) or (None, None)
metrics = attempt("eval.json", lambda: json.loads((result / "eval.json").read_text())["results"]) if env.get("EVAL") == "ok" else None
status = {step: env.get(step.upper(), "not run") for step in ("train", "export", "eval")}
for step, state in status.items():
    if state not in ("ok", "not run"):
        problems.append(f"{step}: {state} (see {step}.log)")

run = {
    "trainer": "nerfstudio splatfacto",
    "versions": attempt("versions", lambda: {p: version(p) for p in ("nerfstudio", "gsplat", "torch")}),
    "preset": env.get("PRESET"),
    "iterations": int(env["ITERATIONS"]) if "ITERATIONS" in env else None,
    "status": status,
    "problems": problems,
    "gpu": gpu_name,
    "trainingSeconds": int(env["TRAIN_SECONDS"]) if "TRAIN_SECONDS" in env else None,
    "peakGpuMemoryMiB": peak,
    "gaussians": attempt("splat.ply", gaussians) if (result / "splat.ply").exists() else None,
    "plyBytes": (result / "splat.ply").stat().st_size if (result / "splat.ply").exists() else None,
    "checkpoint": {"path": checkpoint, "bytes": Path(checkpoint).stat().st_size} if checkpoint else None,
    "nerfstudioRun": env.get("RUN_DIR"),
    "evalImages": len(eval_files) if eval_files is not None else None,
    "evalSplitMatchesManifest": split_matches,
    "evalMetrics": metrics,
    "package": {"project": manifest.get("project"), "posesFinishedAt": manifest.get("poses", {}).get("finishedAt")},
}
(result / "run.json").write_text(json.dumps(run, indent=2))
print(json.dumps(run, indent=2))
EOF
[ $? -eq 0 ] || echo "!! run.json could not be written; the PLY, checkpoint and logs are unaffected."

# shellcheck disable=SC1091
source "$RESULT/run.env"
echo
echo "== Summary: training ${TRAIN:-?}, PLY export ${EXPORT:-not run}, evaluation ${EVAL:-not run}"
[ -n "$CHECKPOINT" ] && echo "Checkpoint (kept on the volume): $CHECKPOINT"
du -sh "$RESULT"
echo "Pack the result for download:"
echo "  cd $OUT && tar czf $(basename "$RESULT").tar.gz $(basename "$RESULT")"
if [ -n "$CHECKPOINT" ] && { [ "${EXPORT:-}" != ok ] || [ "${EVAL:-}" != ok ]; }; then
  echo "Something after training failed. Fix the cause (see the .log files), then retry only those steps:"
  echo "  bash train.sh finish $RESULT"
fi
[ "${TRAIN:-}" = ok ] && [ "${EXPORT:-}" = ok ] && [ "${EVAL:-}" = ok ]
