#!/usr/bin/env python3
"""
Lab 14B: prove that Nerfstudio will seed Gaussians from our LiDAR points3D.bin.

Runs on the GPU Pod after setup_env.sh (needs the nerfstudio venv), or locally
if nerfstudio is installed. Does not train.

Exit 0 only when:
  1. sparse/0/points3D.bin contains the expected number of points (default 1e6);
  2. the COLMAP dataparser with our Lab 14A flags puts those points into
     metadata['points3D_xyz'] / points3D_rgb;
  3. that is the same path VanillaPipeline uses as seed_points for splatfacto
     (see nerfstudio/pipelines/base_pipeline.py in v1.1.5).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def read_points3d_count(path: Path) -> int:
    """COLMAP points3D.bin header: uint64 count (nerfstudio colmap_parsing_utils)."""
    import struct

    with path.open("rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
    return int(n)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--data", type=Path, default=Path("."), help="package root (contains sparse/0 and images)")
    parser.add_argument("--expect", type=int, default=1_000_000, help="expected point count")
    parser.add_argument("--eval-interval", type=int, default=9)
    parser.add_argument("--skip-dataparser", action="store_true", help="only count the binary file (no nerfstudio)")
    args = parser.parse_args()

    data = args.data.resolve()
    points_bin = data / "sparse" / "0" / "points3D.bin"
    if not points_bin.is_file():
        print(f"FAIL: missing {points_bin}")
        return 1

    n_file = read_points3d_count(points_bin)
    print(f"points3D.bin: {n_file:,} points at {points_bin}")
    if n_file != args.expect:
        print(f"FAIL: expected {args.expect:,} points")
        return 1

    if args.skip_dataparser:
        print("OK (file count only; dataparser check skipped)")
        return 0

    try:
        from nerfstudio.data.dataparsers.colmap_dataparser import ColmapDataParserConfig
    except ImportError as error:
        print(f"FAIL: nerfstudio not importable ({error}). Run inside the Pod venv after setup_env.sh.")
        return 1

    # Flags must match train_xgrids.sh exactly.
    config = ColmapDataParserConfig(
        data=data,
        colmap_path=Path("sparse/0"),
        images_path=Path("images"),
        load_3D_points=True,
        assume_colmap_world_coordinate_convention=False,
        orientation_method="none",
        center_method="poses",
        auto_scale_poses=True,
        eval_mode="interval",
        eval_interval=args.eval_interval,
        downscale_factor=1,
    )
    outputs = config.setup().get_dataparser_outputs(split="train")
    meta = outputs.metadata
    if "points3D_xyz" not in meta or "points3D_rgb" not in meta:
        print(f"FAIL: dataparser metadata keys={sorted(meta)} — no points3D_xyz/rgb; splatfacto would random-init")
        return 1

    xyz, rgb = meta["points3D_xyz"], meta["points3D_rgb"]
    print(f"dataparser points3D_xyz: shape={tuple(xyz.shape)} dtype={xyz.dtype}")
    print(f"dataparser points3D_rgb: shape={tuple(rgb.shape)} dtype={rgb.dtype}")
    print(f"dataparser_scale={float(outputs.dataparser_scale):.8f}")
    print(f"dataparser_transform=\n{outputs.dataparser_transform}")
    print(f"train cameras={len(outputs.cameras)}")

    if tuple(xyz.shape) != (args.expect, 3):
        print(f"FAIL: expected points3D_xyz shape ({args.expect}, 3), got {tuple(xyz.shape)}")
        return 1
    if int(rgb.shape[0]) != args.expect:
        print(f"FAIL: rgb count {rgb.shape[0]} != {args.expect}")
        return 1

    # Record for the training report (same folder as the package).
    report = {
        "check": "lidar-seed-points",
        "status": "ok",
        "points3DBin": n_file,
        "dataparserPoints": int(xyz.shape[0]),
        "dataparserScale": float(outputs.dataparser_scale),
        "dataparserTransform": outputs.dataparser_transform.tolist(),
        "trainCameras": len(outputs.cameras),
        "assumeColmapWorldCoordinateConvention": False,
        "orientationMethod": "none",
        "centerMethod": "poses",
        "autoScalePoses": True,
        "load3DPoints": True,
        "evalInterval": args.eval_interval,
        "pipelineSeedPath": "VanillaPipeline reads metadata['points3D_xyz'|rgb] → SplatfactoModel(seed_points=...)",
        "note": "A successful ns-train alone does not prove LiDAR init; this check does.",
    }
    out = data / "init-check.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {out}")
    print("OK: LiDAR points will be passed to splatfacto as seed_points (unless --pipeline.model.random-init True).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
