#!/usr/bin/env bash
# Lab 14B: train splatfacto on an XGRIDS Lab 14A COLMAP package (LAS-frame poses,
# LiDAR points3D.bin seed). Same result layout as Lab 10C train.sh, but with
# COLMAP flags that keep our Z-up world and eval-interval 9 (both cameras held out).
#
#   bash train_xgrids.sh smoke       300 iterations: LiDAR init + train + export + eval, then STOP
#   bash train_xgrids.sh quick       7,000 iterations: only after you have reviewed smoke
#   bash train_xgrids.sh quality     30,000 iterations: only if quick looks coherent
#   bash train_xgrids.sh continue <nerfstudio_run_dir> <max_iterations>
#                                    resume from that run's latest checkpoint into a new
#                                    result folder (does not overwrite the earlier run)
#   bash train_xgrids.sh finish <result folder>
#                                    retry PLY export / evaluation / run.json only
#
# Smoke never starts quick. Each stage is a separate command. If export or evaluation
# fails, the script exits non-zero and tells you not to proceed to the next stage.
#
# Every run gets its own folders (preset + UTC time). Never overwrites another run.
# Detached:  nohup bash train_xgrids.sh quick > quick.out 2>&1 &   then: tail -f quick.out
# Stop:      kill the train_xgrids.sh / ns-train PID (flock released on exit); checkpoints stay.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="${NAME:-basel-xgrids}"
OUT="${OUT:-/workspace/outputs}"
VENV="${VENV:-/workspace/nerfstudio-venv}"
EVAL_INTERVAL="${EVAL_INTERVAL:-9}"
EXPECTED_POINTS="${EXPECTED_POINTS:-1000000}"
if [ -x "$VENV/bin/ns-train" ]; then export PATH="$VENV/bin:$PATH"; fi
command -v ns-train >/dev/null || { echo "ns-train not found: run bash setup_env.sh first."; exit 1; }
export TORCH_HOME="${TORCH_HOME:-/workspace/.cache/torch}"

MODE="${1:-}"
LOAD_DIR=""
case "$MODE" in
  smoke) ITERATIONS=300 ;;
  quick) ITERATIONS=7000 ;;
  quality) ITERATIONS=30000 ;;
  continue)
    SRC_RUN="$(cd "${2:?usage: bash train_xgrids.sh continue <nerfstudio_run_dir> <max_iterations>}" && pwd)" || exit 2
    ITERATIONS="${3:?usage: bash train_xgrids.sh continue <nerfstudio_run_dir> <max_iterations>}"
    LOAD_DIR="$SRC_RUN/nerfstudio_models"
    [ -d "$LOAD_DIR" ] || { echo "No nerfstudio_models in $SRC_RUN"; exit 2; }
    MODE="continue"
    ;;
  finish)
    RESULT="$(cd "${2:?usage: bash train_xgrids.sh finish <result folder>}" && pwd)" || exit 2
    [ -f "$RESULT/run.env" ] || { echo "$RESULT is not a train_xgrids.sh result folder (no run.env)."; exit 2; }
    ;;
  *) echo "usage: bash train_xgrids.sh smoke|quick|quality | continue <run_dir> <iters> | finish <result>"; exit 2 ;;
esac

mkdir -p "$OUT"
exec 9>"$OUT/.train.lock"
flock -n 9 || { echo "Another train_xgrids.sh is still running (see nvidia-smi). Wait for it to finish."; exit 1; }

record() { echo "$1=$2" >> "$RESULT/run.env"; }
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

# COLMAP flags for Lab 14A (LAS Z-up, OpenCV cameras already converted by Nerfstudio's OpenGL flip).
# Do NOT enable assume_colmap_world_coordinate_convention: that remaps COLMAP y-down → z-up and would
# break our already upright LAS frame. orientation-method none keeps axes; center+scale are recorded
# in dataparser_transforms.json for mapping the PLY back to LAS later.
colmap_args=(
  colmap
  --colmap-path sparse/0 --images-path images
  --downscale-factor 1
  --load-3D-points True
  --assume-colmap-world-coordinate-convention False
  --orientation-method none
  --center-method poses
  --auto-scale-poses True
  --eval-mode interval --eval-interval "$EVAL_INTERVAL"
)

if [ "$MODE" != finish ]; then
  # Prove LiDAR seed points before spending GPU time (does not train).
  echo "== Verifying LiDAR Gaussian initialization"
  python "$HERE/verify_lidar_init.py" --data "$HERE" --expect "$EXPECTED_POINTS" --eval-interval "$EVAL_INTERVAL" \
    || { echo "FAIL: LiDAR init check failed. Refusing to train."; exit 1; }

  PRESET="$MODE"
  RUN_ID="$PRESET-$(date -u +%Y%m%d-%H%M%S)"
  RUN_DIR="$OUT/$NAME/splatfacto/$RUN_ID"
  RESULT="$OUT/$NAME-$RUN_ID"
  mkdir "$RESULT" || exit 1
  record PRESET "$PRESET"; record ITERATIONS "$ITERATIONS"; record RUN_DIR "$RUN_DIR"; record PACKAGE "$HERE"
  record EVAL_INTERVAL "$EVAL_INTERVAL"
  [ -n "$LOAD_DIR" ] && record LOAD_DIR "$LOAD_DIR"
  echo "Preset $PRESET ($ITERATIONS iterations). Nerfstudio run: $RUN_DIR  Result: $RESULT"
  df -h "$OUT" | tail -1 | awk '{print "Free space on the volume: " $4}'

  nvidia-smi --query-gpu=timestamp,name,memory.used,memory.total,utilization.gpu --format=csv,nounits -l 5 > "$RESULT/gpu.csv" &
  MONITOR=$!
  trap 'kill $MONITOR 2>/dev/null || true' EXIT

  echo "== Training"
  START=$(date +%s)
  TRAIN_CMD=(
    ns-train splatfacto
    --data "$HERE"
    --output-dir "$OUT" --experiment-name "$NAME" --timestamp "$RUN_ID"
    --max-num-iterations "$ITERATIONS"
    --vis viewer+tensorboard --viewer.quit-on-train-completion True
  )
  if [ -n "$LOAD_DIR" ]; then
    TRAIN_CMD+=(--load-dir "$LOAD_DIR")
    echo "Resuming from $LOAD_DIR"
  fi
  TRAIN_CMD+=("${colmap_args[@]}")
  "${TRAIN_CMD[@]}" 2>&1 | tee "$RESULT/train.log"
  TRAIN_RC=${PIPESTATUS[0]}
  record TRAIN_SECONDS $(( $(date +%s) - START ))
  kill $MONITOR 2>/dev/null || true

  # Confirm the training log saw ~EXPECTED_POINTS Gaussians at the start (best-effort).
  if grep -E -q "means|Gaussian|points" "$RESULT/train.log"; then
    echo "(see train.log for model size; init-check.json has the pre-train point count)"
  fi
  # Count Parameter means from a one-line hint we also write into run.env after export.

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
for f in "$RUN_DIR/config.yml" "$RUN_DIR/dataparser_transforms.json" "$PACKAGE/manifest.json" "$PACKAGE/init-check.json"; do
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

# Copy the checkpoint into the result folder so one tarball has everything to review
# (a symlink to the Nerfstudio run dir would break when the tar is unpacked elsewhere).
# shellcheck disable=SC1091
source "$RESULT/run.env"
CHECKPOINT="$(latest_checkpoint)"
if [ -n "$CHECKPOINT" ] && [ -f "$CHECKPOINT" ]; then
  mkdir -p "$RESULT/checkpoint"
  cp -f "$CHECKPOINT" "$RESULT/checkpoint/$(basename "$CHECKPOINT")"
  cp -f "$CHECKPOINT" "$RESULT/checkpoint/latest.ckpt"
  record CHECKPOINT_COPIED "$RESULT/checkpoint/$(basename "$CHECKPOINT")"
fi

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
    except Exception as error:  # noqa: BLE001
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
    import yaml
    config = yaml.load((result / "config.yml").read_text(), Loader=yaml.Loader)
    datamanager = config.pipeline.datamanager
    if datamanager.data is not None:
        datamanager.dataparser.data = Path(datamanager.data)
    outputs = datamanager.dataparser.setup().get_dataparser_outputs(split="test")
    return [p.name for p in outputs.image_filenames]


manifest = attempt("manifest.json", lambda: json.loads((result / "manifest.json").read_text())) or {}
init_check = attempt("init-check.json", lambda: json.loads((result / "init-check.json").read_text()))
by_name = {Path(i["file"]).name: i for i in manifest.get("images", [])}
manifest_eval = [Path(i["file"]).name for i in manifest.get("images", []) if i.get("split") == "eval"]
trained = (result / "config.yml").exists()
eval_files = attempt("held-out photos from Nerfstudio's dataparser", nerfstudio_eval_files) if trained else None
split_matches = eval_files == manifest_eval if eval_files is not None and manifest_eval else None
if split_matches is False:
    problems.append("Nerfstudio held out different photos than manifest.json lists; INDEX.txt follows Nerfstudio")
if init_check and init_check.get("status") != "ok":
    problems.append("init-check.json is not ok — LiDAR seed may not have been used")

renders = result / "eval-renders"
if renders.is_dir():
    names = eval_files if eval_files is not None else manifest_eval
    lines = []
    for k, name in enumerate(names):
        present = "" if (renders / f"eval_img_{k:04d}.png").exists() else "  (render missing)"
        lines.append(f"eval_img_{k:04d}.png  images/{name}{present}\n")
    (renders / "INDEX.txt").write_text("".join(lines))

gpu_name, peak = attempt("gpu.csv", gpu) or (None, None)
metrics = attempt("eval.json", lambda: json.loads((result / "eval.json").read_text())["results"]) if env.get("EVAL") == "ok" else None
status = {step: env.get(step.upper(), "not run") for step in ("train", "export", "eval")}
for step, state in status.items():
    if state not in ("ok", "not run"):
        problems.append(f"{step}: {state} (see {step}.log)")

run = {
    "trainer": "nerfstudio splatfacto",
    "lab": "14B",
    "versions": attempt("versions", lambda: {p: version(p) for p in ("nerfstudio", "gsplat", "torch")}),
    "preset": env.get("PRESET"),
    "iterations": int(env["ITERATIONS"]) if "ITERATIONS" in env else None,
    "loadDir": env.get("LOAD_DIR"),
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
    "lidarInit": init_check,
    "package": {"schema": manifest.get("schema"), "calibration": (manifest.get("calibration") or {}).get("experimentId")},
}
(result / "run.json").write_text(json.dumps(run, indent=2))
print(json.dumps(run, indent=2))
EOF
[ $? -eq 0 ] || echo "!! run.json could not be written; the PLY, checkpoint and logs are unaffected."

# shellcheck disable=SC1091
source "$RESULT/run.env"
CHECKPOINT="$(latest_checkpoint)"

# Manifest of downloadable review artefacts (one folder → one tar).
cat > "$RESULT/DOWNLOAD.txt" <<EOF
Spatial Lab Lab 14B result: $(basename "$RESULT")
Preset: ${PRESET:-?}   Iterations: ${ITERATIONS:-?}
Status: train=${TRAIN:-?}  export=${EXPORT:-?}  eval=${EVAL:-?}

Contents of this folder (pack the whole folder):
  run.json                 metrics summary, Gaussian count, GPU peak, problems[]
  init-check.json          LiDAR seed-point verification (must be status ok)
  splat.ply                exported Gaussians
  eval.json                PSNR / SSIM / LPIPS on held-out views
  eval-renders/            side-by-side photo vs render (+ INDEX.txt)
  checkpoint/              copy of the latest .ckpt (also kept under nerfstudio_models/)
  config.yml               Nerfstudio config for this run
  dataparser_transforms.json  centre/scale mapping toward LAS
  manifest.json            Lab 14A dataset provenance
  train.log export.log eval.log gpu.csv run.env

Pack on the Pod:
  cd $OUT && tar czf $(basename "$RESULT").tar.gz $(basename "$RESULT")
Then download that .tar.gz (JupyterLab, runpodctl, or scp).

Nerfstudio run directory (still on the volume; optional second download):
  $RUN_DIR
EOF

echo
echo "== Summary: training ${TRAIN:-?}, PLY export ${EXPORT:-not run}, evaluation ${EVAL:-not run}"
[ -n "$CHECKPOINT" ] && echo "Checkpoint: $CHECKPOINT (also copied under $RESULT/checkpoint/)"
du -sh "$RESULT"
echo "Pack this result for download (includes checkpoint, PLY, eval renders, metrics, logs):"
echo "  cd $OUT && tar czf $(basename "$RESULT").tar.gz $(basename "$RESULT")"
echo "See $RESULT/DOWNLOAD.txt"

OK=1
[ "${TRAIN:-}" = ok ] || OK=0
[ "${EXPORT:-}" = ok ] || OK=0
[ "${EVAL:-}" = ok ] || OK=0

if [ "$OK" -ne 1 ]; then
  echo
  echo "!! FAIL: train/export/eval did not all succeed. Do NOT start the next stage."
  echo "   Fix the cause (see train.log / export.log / eval.log), then:"
  echo "   bash train_xgrids.sh finish $RESULT"
  echo "   Re-download the result and review again before quick/quality."
  exit 1
fi

if [ "${PRESET:-}" = smoke ]; then
  echo
  echo "== SMOKE COMPLETE — STOPPING HERE"
  echo "Download and review $RESULT before any further training."
  echo "This script will NOT start quick. When smoke looks acceptable, run separately:"
  echo "  nohup bash train_xgrids.sh quick > quick.out 2>&1 &"
  exit 0
fi

if [ "${PRESET:-}" = quick ]; then
  echo
  echo "== QUICK COMPLETE — review before quality"
  echo "Only if the reconstruction is coherent, either:"
  echo "  nohup bash train_xgrids.sh quality > quality.out 2>&1 &"
  echo "or resume this run without overwriting it:"
  echo "  bash train_xgrids.sh continue $RUN_DIR 30000"
  exit 0
fi

echo "Continue a successful run to more iterations without overwriting it:"
echo "  bash train_xgrids.sh continue $RUN_DIR 30000"
exit 0
