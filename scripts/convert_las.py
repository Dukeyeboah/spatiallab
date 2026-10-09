"""
Convert a .las file into the small binary format read by lib/loadPointCloud.ts.

    pip install laspy numpy
    python3 scripts/convert_las.py input.las public/data/pointcloud.bin --max-points 2000000

The conversion itself lives in backend/lidar_conversion.py (shared with the
dataset backend). Output layout (little-endian):
    uint32              N
    float32[N * 3]      X, Y, Z   (metres, shifted near the origin)
    uint8[N * 3]        R, G, B

Steps:
  1. Read real XYZ + RGB from the LAS file.
  2. Compute the offset from the FULL dataset (X/Y centre, lowest Z), so every
     point budget uses exactly the same origin.
     (float32 cannot precisely store large coordinates such as UTM values.)
  3. Randomly keep at most --max-points points (downsampling), then subtract the offset.
  4. Convert 16-bit LAS colours to 8-bit.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from lidar_conversion import compute_offset, read_las, sample_indices, write_bin  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--max-points", type=int, default=2_000_000)
    args = parser.parse_args()

    cloud = read_las(Path(args.input))
    print(f"Read {len(cloud.xyz):,} points from {args.input}")
    if cloud.rgb is None:
        raise SystemExit("This LAS file has no RGB colours.")

    offset, mins, maxs = compute_offset(cloud.xyz)
    print(f"Offset from full dataset (x, y, z): {offset.tolist()}")
    print(f"Size (x, y, z) in metres: {(maxs - mins).round(2).tolist()}")

    keep = sample_indices(len(cloud.xyz), args.max_points)
    written = write_bin(Path(args.output), cloud.xyz, cloud.rgb, offset, keep)
    print(f"Wrote {written:,} points to {args.output}")


if __name__ == "__main__":
    main()
