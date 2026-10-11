"""
What this machine can do for Gaussian splatting training (Lab 10A).

Only asks the system: platform facts, `system_profiler` (macOS) or
`nvidia-smi` for GPUs, executables on PATH, and whether Python packages are
installed (importlib find_spec: nothing is imported, nothing is installed).
The verdict is a rule of thumb for planning Lab 10B, not a benchmark.
"""

import functools
import importlib.util
import json
import os
import platform
import shutil
import subprocess
from typing import Any, Optional

from storage import DATA_DIR

GiB = 1024 ** 3
TOOLS = {
    "colmap": "COLMAP (structure from motion)",
    "glomap": "GLOMAP (faster global mapper for COLMAP data)",
    "brush_app": "Brush (Gaussian trainer, WebGPU/Metal)",
    "opensplat": "OpenSplat (Gaussian trainer, CPU/Metal/CUDA)",
    "ns-train": "Nerfstudio (splatfacto, CUDA)",
    "ffmpeg": "ffmpeg (video → frames)",
    "nvidia-smi": "NVIDIA driver tools",
    "docker": "Docker",
}
PYTHON_PACKAGES = ["torch", "gsplat", "pycolmap", "cv2"]
# Homebrew's folders: a backend started outside a login shell may not have them on PATH.
EXTRA_TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"]


def find_tool(name: str) -> Optional[str]:
    return shutil.which(name) or shutil.which(name, path=os.pathsep.join(EXTRA_TOOL_DIRS))


def run(command: list[str], timeout: float = 10) -> Optional[str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


def memory_bytes() -> Optional[int]:
    if platform.system() == "Darwin":
        out = run(["sysctl", "-n", "hw.memsize"])
        return int(out) if out and out.strip().isdigit() else None
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        return None


def cpu_name() -> str:
    if platform.system() == "Darwin":
        out = run(["sysctl", "-n", "machdep.cpu.brand_string"])
        if out:
            return out.strip()
    return platform.processor() or platform.machine()


def gpus() -> list[dict[str, Any]]:
    found = []
    out = run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"])
    for line in (out or "").strip().splitlines():
        name, memory, driver = [part.strip() for part in line.split(",")]
        found.append({"name": name, "vendor": "NVIDIA", "api": "CUDA", "memoryBytes": int(float(memory)) * 1024 * 1024,
                      "detail": f"driver {driver}"})
    if platform.system() == "Darwin":
        out = run(["system_profiler", "SPDisplaysDataType", "-json"], timeout=20)
        try:
            items = json.loads(out or "{}").get("SPDisplaysDataType", [])
        except json.JSONDecodeError:
            items = []
        for item in items:
            found.append({
                "name": item.get("sppci_model") or item.get("_name"),
                "vendor": "Apple" if "Apple" in str(item.get("spdisplays_vendor", "")) else item.get("spdisplays_vendor"),
                "api": str(item.get("spdisplays_mtlgpufamilysupport", "Metal")).replace("spdisplays_", "").replace("metal", "Metal "),
                "memoryBytes": None,  # unified memory: shared with the CPU (see memory)
                "detail": f"{item.get('sppci_cores', '?')} GPU cores",
            })
    return found


@functools.lru_cache(maxsize=1)
def static_report() -> dict[str, Any]:
    system = platform.system()
    mac = platform.mac_ver()[0]
    return {
        "os": f"macOS {mac}" if system == "Darwin" and mac else f"{system} {platform.release()}",
        "architecture": platform.machine(),
        "cpu": cpu_name(),
        "cpuCores": os.cpu_count(),
        "memoryBytes": memory_bytes(),
        "gpus": gpus(),
        "tools": {name: {"label": label, "path": find_tool(name)} for name, label in TOOLS.items()},
        "pythonPackages": {name: importlib.util.find_spec(name) is not None for name in PYTHON_PACKAGES},
    }


def report() -> dict[str, Any]:
    info = dict(static_report())
    info["diskFreeBytes"] = shutil.disk_usage(DATA_DIR).free  # changes; not cached
    info["assessment"] = assess(info)
    return info


def assess(info: dict[str, Any]) -> dict[str, Any]:
    cuda = any(g["api"] == "CUDA" for g in info["gpus"])
    apple = platform.system() == "Darwin" and info["architecture"] == "arm64"
    memory = info["memoryBytes"] or 0
    disk = info["diskFreeBytes"]
    notes = []

    if cuda:
        verdict = "local-cuda"
        summary = ("An NVIDIA GPU with CUDA is available: the mainstream trainers (gsplat, Nerfstudio splatfacto, "
                   "the original 3DGS code) can run locally.")
    elif apple:
        verdict = "local-metal-limited"
        summary = ("Apple Silicon (Metal), no CUDA: the CUDA-only trainers (original 3DGS, gsplat, Nerfstudio "
                   "splatfacto) don't run here. Metal/WebGPU trainers (Brush, OpenSplat) do, and COLMAP runs on "
                   "the CPU. Practical for small experiments; a cloud NVIDIA GPU is the better fit for full scenes.")
    else:
        verdict = "cpu-only"
        summary = "No supported GPU found: train on a cloud GPU; COLMAP can still run on the CPU (slowly)."

    if memory and memory < 16 * GiB:
        notes.append(f"{memory / GiB:.0f} GB memory (shared with the GPU on Apple Silicon): keep local runs small "
                     "(≈100–200 photos downscaled to ≤1600 px, capped Gaussian count) or train in the cloud.")
    if disk < 30 * GiB:
        notes.append(f"Only {disk / GiB:.0f} GiB free disk: a training run needs several GB (preprocessed images, "
                     "COLMAP database, checkpoints, PLY). Free space before Lab 10B.")
    if not info["tools"]["colmap"]["path"]:
        notes.append("COLMAP isn't installed (macOS: `brew install colmap`, CPU feature matching; no CUDA there).")
    if not any(info["tools"][t]["path"] for t in ("brush_app", "opensplat", "ns-train")):
        notes.append("No Gaussian trainer is installed (nothing is installed without your go-ahead).")

    return {"verdict": verdict, "summary": summary, "notes": notes}
