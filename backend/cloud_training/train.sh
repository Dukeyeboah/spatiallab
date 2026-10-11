#!/usr/bin/env bash
# Trains splatfacto on this package, exports the Gaussian PLY, evaluates it on
# the held-out photos and gathers everything Spatial Lab needs in one folder.
#
#   bash train.sh quick      7,000 iterations: proves the pipeline, first look at quality
#   bash train.sh quality    30,000 iterations: the first useful reconstruction
#
# Run it detached so a dropped connection doesn't stop it:
#   nohup bash train.sh quick > quick.out 2>&1 &     then: tail -f quick.out
set -euo pipefail
PRESET="${1:-}"
case "$PRESET" in
  quick) ITERATIONS=7000 ;;
  quality) ITERATIONS=30000 ;;
  *) echo "usage: bash train.sh quick|quality"; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="{{SLUG}}"
OUT="${OUT:-/workspace/outputs}"
VENV="${VENV:-/workspace/nerfstudio-venv}"
if [ -x "$VENV/bin/ns-train" ]; then export PATH="$VENV/bin:$PATH"; fi
command -v ns-train >/dev/null || { echo "ns-train not found: run bash setup_env.sh first."; exit 1; }

RUN_ID="$PRESET-$(date -u +%Y%m%d-%H%M%S)"
RUN_DIR="$OUT/$NAME/splatfacto/$RUN_ID"   # Nerfstudio's layout: output-dir/experiment/method/timestamp
RESULT="$OUT/$NAME-$RUN_ID"               # the folder to download
mkdir -p "$RESULT"
echo "Preset $PRESET ($ITERATIONS iterations). Nerfstudio run: $RUN_DIR  Result: $RESULT"

# GPU memory and load every 5 s (peak memory for the record).
nvidia-smi --query-gpu=timestamp,name,memory.used,memory.total,utilization.gpu --format=csv,nounits -l 5 > "$RESULT/gpu.csv" &
MONITOR=$!
trap 'kill $MONITOR 2>/dev/null || true' EXIT

# The COLMAP model is read as exported: images at the calibrated size (downscale 1, so Nerfstudio
# never stops to ask), every 8th photo held out for evaluation (listed in manifest.json).
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
TRAIN_SECONDS=$(( $(date +%s) - START ))

echo "== Exporting the Gaussian PLY"
ns-export gaussian-splat --load-config "$RUN_DIR/config.yml" --output-dir "$RESULT" 2>&1 | tee "$RESULT/export.log"

echo "== Evaluating on the held-out photos (PSNR / SSIM / LPIPS + side-by-side renders)"
ns-eval --load-config "$RUN_DIR/config.yml" --output-path "$RESULT/eval.json" \
  --render-output-path "$RESULT/eval-renders" 2>&1 | tee "$RESULT/eval.log"

kill $MONITOR 2>/dev/null || true
cp "$RUN_DIR/config.yml" "$RUN_DIR/dataparser_transforms.json" "$HERE/manifest.json" "$RESULT/"

# run.json: the facts Spatial Lab records with the imported scene.
python3 - "$RESULT" "$PRESET" "$ITERATIONS" "$TRAIN_SECONDS" <<'EOF'
import csv, json, sys
from importlib.metadata import version
from pathlib import Path

result, preset, iterations, seconds = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
ply = result / "splat.ply"
header = ply.read_bytes()[:4096].split(b"end_header")[0].decode("ascii", "replace")
count = next(int(line.split()[2]) for line in header.splitlines() if line.startswith("element vertex"))
rows = list(csv.reader((result / "gpu.csv").open()))[1:]
peak = max((int(r[2]) for r in rows if len(r) > 2 and r[2].strip().isdigit()), default=None)
manifest = json.loads((result / "manifest.json").read_text())
evals = [i for i in manifest["images"] if i["split"] == "eval"]
(result / "eval-renders" / "INDEX.txt").write_text(
    "".join(f"eval_img_{k:04d}.png  {i['file']}  ({i['originalFilename']})\n" for k, i in enumerate(evals)))
metrics = json.loads((result / "eval.json").read_text()).get("results", {})
run = {
    "trainer": "nerfstudio splatfacto",
    "versions": {p: version(p) for p in ("nerfstudio", "gsplat", "torch")},
    "preset": preset,
    "iterations": iterations,
    "gpu": rows[0][1].strip() if rows else None,
    "trainingSeconds": seconds,
    "peakGpuMemoryMiB": peak,
    "gaussians": count,
    "plyBytes": ply.stat().st_size,
    "evalImages": len(evals),
    "evalMetrics": metrics,
    "package": {"project": manifest["project"], "posesFinishedAt": manifest["poses"]["finishedAt"]},
}
(result / "run.json").write_text(json.dumps(run, indent=2))
print(json.dumps(run, indent=2))
EOF

echo "== Done. Download this folder: $RESULT"
du -sh "$RESULT"
