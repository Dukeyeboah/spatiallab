#!/usr/bin/env bash
# Installs Nerfstudio 1.1.5 (splatfacto) from the pinned lock file into a virtual
# environment on the persistent volume, checks the installed set with pip check,
# then proves the GPU works with a small gsplat rasterisation.
#
# For a Runpod "PyTorch 2.1" Pod (runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04: Python 3.10
# with venv, gcc via the CUDA devel packages) or any Ubuntu 22.04 machine with an NVIDIA driver for
# CUDA >= 11.8, Python 3.10 and gcc. Skip it inside ghcr.io/nerfstudio-project/nerfstudio:1.1.5.
#
#   bash setup_env.sh            (about 5-10 minutes; downloads about 3.3 GB, installs about 7 GB)
# Then: bash train.sh smoke      (2-5 minutes: a 300-step training, export, evaluation and report)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="${VENV:-/workspace/nerfstudio-venv}"
export PIP_NO_CACHE_DIR=1   # no 3 GB wheel cache on the container disk; the venv itself is on the volume

echo "== GPU"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

mkdir -p "$(dirname "$VENV")"
FREE_GB=$(df -BG --output=avail "$(dirname "$VENV")" | tail -1 | tr -dc 0-9)
echo "Free space on $(dirname "$VENV"): ${FREE_GB} GB (install about 7 GB, runs up to about 8 GB more)"
[ "$FREE_GB" -ge 10 ] || { echo "Less than 10 GB free: give the Pod a bigger volume."; exit 1; }

command -v python3.10 >/dev/null || { echo "Python 3.10 is required: the pinned wheels are built for it."; exit 1; }
if ! command -v gcc >/dev/null; then
  # pyliblzfse (a Nerfstudio dependency) is compiled from source.
  echo "== Installing a C compiler"
  apt-get update -qq && apt-get install -y -qq build-essential
fi
if [ ! -x "$VENV/bin/python" ]; then
  echo "== Creating $VENV"
  python3.10 -m venv "$VENV" || {
    echo "venv support is missing. Run: apt-get update && apt-get install -y python3.10-venv, then this script again."
    exit 1
  }
fi
"$VENV/bin/python" -m pip install --quiet --upgrade "pip==24.3.1"

echo "== Installing the pinned packages (torch 2.1.2+cu118, gsplat 1.4.0, nerfstudio 1.1.5)"
# --no-deps: the lock already lists every dependency at an exact version (pip check below proves it).
"$VENV/bin/pip" install --no-deps -r "$HERE/requirements-nerfstudio.lock.txt" \
  --extra-index-url https://download.pytorch.org/whl/cu118 \
  --find-links https://docs.gsplat.studio/whl/pt21cu118/gsplat/

echo "== pip check (every installed package's requirements are met)"
"$VENV/bin/pip" check

echo "== Checking the GPU with a small gsplat rasterisation"
"$VENV/bin/python" - <<'EOF'
import importlib.metadata as md
import torch
from gsplat import rasterization

assert torch.cuda.is_available(), "PyTorch can't see the GPU (driver too old for CUDA 11.8?)"
name, cap = torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0)
print(f"torch {torch.__version__} (CUDA {torch.version.cuda}) on {name}, compute capability {cap[0]}.{cap[1]}")
print("nerfstudio", md.version("nerfstudio"), "| gsplat", md.version("gsplat"))
n, dev = 2000, "cuda"
means = torch.randn(n, 3, device=dev) + torch.tensor([0.0, 0.0, 5.0], device=dev)
quats = torch.nn.functional.normalize(torch.randn(n, 4, device=dev), dim=-1)
scales = torch.full((n, 3), 0.05, device=dev)
opacities = torch.full((n,), 0.8, device=dev)
colors = torch.rand(n, 3, device=dev)
viewmats = torch.eye(4, device=dev)[None]
Ks = torch.tensor([[[300.0, 0, 160], [0, 300.0, 120], [0, 0, 1]]], device=dev)
image, alpha, _ = rasterization(means, quats, scales, opacities, colors, viewmats, Ks, 320, 240)
torch.cuda.synchronize()
assert float(alpha.mean()) > 0, "gsplat rendered nothing"
print(f"gsplat OK: rendered {tuple(image.shape)}, mean coverage {float(alpha.mean()):.2f}")
EOF

"$VENV/bin/ns-train" --help >/dev/null && echo "== Ready. Next: bash train.sh smoke"
