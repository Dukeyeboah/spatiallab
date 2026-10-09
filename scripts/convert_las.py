"""
Convert a .las/.laz file into the small binary format read by lib/loadPointCloud.ts.

    pip install laspy numpy          # add "laspy[lazrs]" for .laz files
    python scripts/convert_las.py input.las public/data/pointcloud.bin --max-points 2000000

Output layout (little-endian):
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

import laspy
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--max-points", type=int, default=2_000_000)
    args = parser.parse_args()

    las = laspy.read(args.input)
    print(f"Read {len(las.points):,} points from {args.input}")

    if "red" not in las.point_format.dimension_names:
        raise SystemExit("This LAS file has no RGB colours.")

    # 1. Real-world coordinates (laspy applies the LAS scale/offset for us).
    xyz = np.vstack([las.x, las.y, las.z]).T
    rgb = np.vstack([las.red, las.green, las.blue]).T

    # 2. Compute the offset from ALL original points, before downsampling,
    #    so every point budget shares exactly the same origin.
    mins, maxs = xyz.min(axis=0), xyz.max(axis=0)
    offset = np.array([(mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, mins[2]])
    print(f"Offset from full dataset (x, y, z): {offset.tolist()}")
    print(f"Size (x, y, z) in metres: {(maxs - mins).round(2).tolist()}")

    # 3. Downsample with a fixed seed so the result is reproducible.
    if len(xyz) > args.max_points:
        rng = np.random.default_rng(0)
        keep = rng.choice(len(xyz), size=args.max_points, replace=False)
        keep.sort()
        xyz, rgb = xyz[keep], rgb[keep]

    # Move the scan near the origin using the shared offset.
    xyz = (xyz - offset).astype("<f4")

    # 4. LAS colours are usually 16-bit (0..65535); some files store 0..255.
    if rgb.max() > 255:
        rgb = rgb >> 8
    rgb = rgb.astype(np.uint8)

    with open(args.output, "wb") as f:
        f.write(np.uint32(len(xyz)).astype("<u4").tobytes())
        f.write(xyz.tobytes())
        f.write(rgb.tobytes())

    print(f"Wrote {len(xyz):,} points to {args.output}")


if __name__ == "__main__":
    main()
