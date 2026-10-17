#!/usr/bin/env python3
"""Export Nerfstudio-frame training cameras for Spatial Lab's Gaussian viewer (Lab 14C).

Reads COLMAP images.bin + a result's dataparser_transforms.json and writes
training-cameras.json with positionNs/targetNs (file frame) and viewer maps.

  backend/.venv/bin/python scripts/xgrids/export_training_cameras_for_viewer.py \\
    --colmap-images …/sparse/0/images.bin \\
    --dataparser …/basel-xgrids-quick-…/dataparser_transforms.json \\
    --out …/lab14c/training-cameras-quick.json
"""

from __future__ import annotations

import argparse
import json
import re
import struct
from pathlib import Path

import numpy as np


def qvec2R(q: tuple[float, float, float, float]) -> np.ndarray:
    w, x, y, z = q
    return np.array(
        [
            [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * z * w, 2 * x * z + 2 * y * w],
            [2 * x * y + 2 * z * w, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * x * w],
            [2 * x * z - 2 * y * w, 2 * y * z + 2 * x * w, 1 - 2 * x * x - 2 * y * y],
        ]
    )


def read_images(path: Path) -> list[dict]:
    data = path.read_bytes()
    n = struct.unpack_from("<Q", data, 0)[0]
    off = 8
    out: list[dict] = []
    for _ in range(n):
        image_id = struct.unpack_from("<I", data, off)[0]
        off += 4
        q = struct.unpack_from("<dddd", data, off)
        off += 32
        t = struct.unpack_from("<ddd", data, off)
        off += 24
        cam_id = struct.unpack_from("<I", data, off)[0]
        off += 4
        end = data.index(b"\0", off)
        name = data[off:end].decode()
        off = end + 1
        np2 = struct.unpack_from("<Q", data, off)[0]
        off += 8 + np2 * 24
        R = qvec2R(q)
        C = -R.T @ np.array(t)
        forward = R.T @ np.array([0.0, 0.0, 1.0])
        out.append({"id": image_id, "name": name, "cameraId": cam_id, "C": C, "forward": forward})
    return out


def seq_of(name: str) -> int:
    m = re.search(r"seq(\d+)", name)
    return int(m.group(1)) if m else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--colmap-images", type=Path, required=True)
    parser.add_argument("--dataparser", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--look-ahead-m", type=float, default=3.0, help="Look-at distance in LAS metres before scale")
    parser.add_argument("--default-seq-lo", type=int, default=2500)
    parser.add_argument("--default-seq-hi", type=int, default=3100)
    args = parser.parse_args()

    tf = json.loads(args.dataparser.read_text())
    scale = float(tf["scale"])
    T = np.array(tf["transform"], dtype=float)
    t = T[:, 3]
    imgs = read_images(args.colmap_images)

    cameras = []
    for im in imgs:
        C_las = im["C"]
        f = im["forward"] / np.linalg.norm(im["forward"])
        target_las = C_las + args.look_ahead_m * f
        C_ns = scale * (C_las + t)
        tgt_ns = scale * (target_las + t)
        cameras.append(
            {
                "imageId": im["id"],
                "file": im["name"],
                "positionNs": C_ns.tolist(),
                "targetNs": tgt_ns.tolist(),
                "viewerYDownColmap": {
                    "position": [-float(C_ns[0]), -float(C_ns[1]), float(C_ns[2])],
                    "target": [-float(tgt_ns[0]), -float(tgt_ns[1]), float(tgt_ns[2])],
                    "fov": 60,
                },
                "viewerZUpLas": {
                    "position": [float(C_ns[0]), float(C_ns[2]), -float(C_ns[1])],
                    "target": [float(tgt_ns[0]), float(tgt_ns[2]), -float(tgt_ns[1])],
                    "fov": 60,
                },
            }
        )

    courtyard = [c for c in cameras if args.default_seq_lo <= seq_of(c["file"]) <= args.default_seq_hi]
    pick = courtyard[len(courtyard) // 2] if courtyard else cameras[len(cameras) // 2]

    out = {
        "schema": "spatial-lab/xgrids-training-cameras",
        "version": 1,
        "source": str(args.dataparser.parent.name),
        "dataparserTransforms": tf,
        "note": (
            "Nerfstudio frame = scale*(LAS + t) with identity R when orientation-method none. "
            "Paste positionNs/targetNs into /gaussian-viewer with World up = LAS Z-up."
        ),
        "defaultCameraFile": pick["file"],
        "cameras": cameras,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {args.out} ({len(cameras)} cameras); default {pick['file']}")


if __name__ == "__main__":
    main()
