#!/usr/bin/env python3
"""
Lab 14B: build an upload package from a Lab 14A splat dataset (no GPU, no upload).

    backend/.venv/bin/python scripts/xgrids/package_splat_training.py \
        --dataset RECON/training/lab14a/basel-5s-forward12 \
        --out RECON/training/lab14b/basel-5s-forward12-package

Writes a new folder (never overwritten) containing:
  images/                  hard-linked or copied JPEGs
  sparse/0/*.bin           COLMAP model (points3D.txt omitted — Nerfstudio reads .bin)
  manifest.json            Lab 14A provenance (read-only copy)
  setup_env.sh, train_xgrids.sh, verify_lidar_init.py, requirements-nerfstudio.lock.txt, README.md
  SHA256SUMS
  package.json             what was packaged, sizes, checksums

Then optionally zips it (--zip). The zip stays outside Git.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CLOUD = REPO_ROOT / "backend" / "cloud_training"
SUPPORT = [
    ("setup_env.sh", "setup_env.sh"),
    ("train_xgrids.sh", "train_xgrids.sh"),
    ("verify_lidar_init.py", "verify_lidar_init.py"),
    ("requirements-nerfstudio.lock.txt", "requirements-nerfstudio.lock.txt"),
]
MODEL_BIN = ["cameras.bin", "images.bin", "points3D.bin"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def link_or_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, required=True, help="Lab 14A basel-5s-forward12 (or equivalent)")
    parser.add_argument("--out", type=Path, required=True, help="new package folder (must not exist; outside the repo)")
    parser.add_argument("--slug", default="basel-xgrids", help="folder name inside the zip / NAME for train_xgrids.sh")
    parser.add_argument("--zip", action="store_true", help="also write <out>.zip next to the folder")
    parser.add_argument("--expect-points", type=int, default=1_000_000)
    args = parser.parse_args()

    dataset = args.dataset.resolve()
    out = args.out.resolve()
    if out.is_relative_to(REPO_ROOT):
        parser.error("--out must be outside the repository")
    if out.exists():
        parser.error(f"{out} exists; packages are never overwritten")
    for name in ("images", "sparse/0", "manifest.json", "SHA256SUMS"):
        if not (dataset / name).exists():
            parser.error(f"dataset missing {name}")

    # Verify source checksums still match Lab 14A.
    bad = []
    for line in (dataset / "SHA256SUMS").read_text().splitlines():
        digest, rel = line.split("  ", 1)
        path = dataset / rel
        if not path.is_file():
            continue  # checks/ may be listed; we don't ship them
        if sha256_file(path) != digest:
            bad.append(rel)
    if bad:
        parser.error(f"dataset SHA256SUMS mismatch: {bad[:5]}")

    # Point count from our binary layout (uint64 header).
    import struct
    with open(dataset / "sparse/0/points3D.bin", "rb") as f:
        (n_points,) = struct.unpack("<Q", f.read(8))
    if n_points != args.expect_points:
        parser.error(f"points3D.bin has {n_points} points, expected {args.expect_points}")

    manifest = json.loads((dataset / "manifest.json").read_text())
    if manifest.get("trainer", {}).get("evalInterval") != 9:
        print("warning: manifest evalInterval is not 9; train_xgrids.sh defaults to 9", file=sys.stderr)

    out.mkdir(parents=False)
    pkg = out  # flat package root = what gets uploaded and becomes $HERE on the Pod
    (pkg / "images").mkdir()
    (pkg / "sparse" / "0").mkdir(parents=True)

    images = sorted((dataset / "images").glob("*.jpg"))
    if len(images) != manifest["counts"]["views"]:
        parser.error(f"image count {len(images)} != manifest views {manifest['counts']['views']}")
    for image in images:
        link_or_copy(image, pkg / "images" / image.name)
    for name in MODEL_BIN:
        link_or_copy(dataset / "sparse" / "0" / name, pkg / "sparse" / "0" / name)
    shutil.copy2(dataset / "manifest.json", pkg / "manifest.json")

    for src_name, dst_name in SUPPORT:
        src = CLOUD / src_name
        if not src.is_file():
            parser.error(f"missing {src}")
        shutil.copy2(src, pkg / dst_name)
        if dst_name.endswith(".sh"):
            (pkg / dst_name).chmod(0o755)

    readme = f"""# {args.slug}: XGRIDS Gaussian splatting package (Spatial Lab Lab 14B)

Built from Lab 14A dataset `{dataset.name}`. Experimental calibration
`{(manifest.get('calibration') or {}).get('experimentId')}`. Not trained yet.

| Path | Content |
| --- | --- |
| `images/` | {len(images)} PINHOLE 1600×1200 views (fisheye re-projections) |
| `sparse/0/` | COLMAP cameras, images, **{n_points:,} LiDAR seed points** (binary) |
| `manifest.json` | provenance, conventions, assumptions, train/eval split |
| `setup_env.sh` | Nerfstudio 1.1.5 + gsplat 1.4.0 (Lab 10C lock) |
| `train_xgrids.sh` | smoke / quick / quality / continue / finish |
| `verify_lidar_init.py` | **must pass before training** — proves points reach splatfacto |

## On the Pod

```bash
cd /workspace
# after uploading and unpacking this folder:
cd {args.slug}   # or whatever folder name you unpacked
sha256sum -c SHA256SUMS --quiet && echo package intact
bash setup_env.sh
bash train_xgrids.sh smoke
# Smoke STOPS here. Pack/download the result (checkpoint, splat.ply, eval-renders, metrics, logs):
#   cd /workspace/outputs && tar czf smoke.tgz {args.slug}-smoke-<time>
# Review on the Mac. Only then:
# nohup bash train_xgrids.sh quick > quick.out 2>&1 &
# quality only if quick looks coherent:
# nohup bash train_xgrids.sh quality > quality.out 2>&1 &
```

If smoke export or evaluation fails, `train_xgrids.sh` exits non-zero — do not start quick;
run `bash train_xgrids.sh finish <result>` after fixing, then re-download.

COLMAP flags (also in train_xgrids.sh): `--assume-colmap-world-coordinate-convention False`
`--orientation-method none --center-method poses --auto-scale-poses True --eval-interval 9 --load-3D-points True`.

Keep `dataparser_transforms.json` with the result: it maps Nerfstudio's centred/scaled frame back toward LAS.
"""
    (pkg / "README.md").write_text(readme)

    files = sorted(p for p in pkg.rglob("*") if p.is_file())
    with open(pkg / "SHA256SUMS", "w") as f:
        for path in files:
            if path.name == "SHA256SUMS":
                continue
            f.write(f"{sha256_file(path)}  {path.relative_to(pkg)}\n")

    size = sum(p.stat().st_size for p in pkg.rglob("*") if p.is_file())
    info = {
        "schema": "spatial-lab/xgrids-splat-training-package",
        "version": 1,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "slug": args.slug,
        "sourceDataset": str(dataset),
        "sourceManifestSha256": sha256_file(dataset / "manifest.json"),
        "calibrationExperimentId": (manifest.get("calibration") or {}).get("experimentId"),
        "images": len(images),
        "points3D": n_points,
        "bytes": size,
        "omitted": ["sparse/0/points3D.txt", "sparse/poses-only", "lidar_init.ply", "checks/", "images from checks"],
        "trainer": {
            "script": "train_xgrids.sh",
            "nerfstudio": "1.1.5",
            "method": "splatfacto",
            "evalInterval": 9,
            "assumeColmapWorldCoordinateConvention": False,
            "orientationMethod": "none",
            "load3DPoints": True,
        },
    }
    (pkg / "package.json").write_text(json.dumps(info, indent=2) + "\n")
    # Refresh SHA256SUMS to include package.json
    files = sorted(p for p in pkg.rglob("*") if p.is_file() and p.name != "SHA256SUMS")
    with open(pkg / "SHA256SUMS", "w") as f:
        for path in files:
            f.write(f"{sha256_file(path)}  {path.relative_to(pkg)}\n")

    print(f"Package {size / 1e6:.0f} MB → {pkg}")
    if args.zip:
        zip_path = out.with_suffix(".zip")
        if zip_path.exists():
            parser.error(f"{zip_path} exists")
        # Zip with a top-level slug folder so unpacking on the Pod is tidy.
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            for path in sorted(p for p in pkg.rglob("*") if p.is_file()):
                zf.write(path, arcname=str(Path(args.slug) / path.relative_to(pkg)))
        print(f"Zip {zip_path.stat().st_size / 1e6:.0f} MB → {zip_path} (sha256 {sha256_file(zip_path)})")
        info["zip"] = {"path": str(zip_path), "bytes": zip_path.stat().st_size, "sha256": sha256_file(zip_path)}
        (pkg / "package.json").write_text(json.dumps(info, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
