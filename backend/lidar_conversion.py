"""
LAS -> browser binary conversion, shared by scripts/convert_las.py (command
line) and the dataset backend (backend/converter.py).

Output layout (little-endian), read by lib/loadPointCloud.ts:
    uint32              N
    float32[N * 3]      X, Y, Z   (metres, offset already subtracted, Z-up)
    uint8[N * 3]        R, G, B

The rules that keep every budget of a dataset in one coordinate frame:
  1. The offset is computed from ALL original points (X/Y bounding-box centre,
     lowest Z), never from a downsampled budget.
  2. Every budget (and the scanner poses) subtracts exactly that offset.
  3. Downsampling uses a fixed seed, so a conversion is reproducible.

Offsets exist because float32 has ~7 significant digits: real-world
coordinates (e.g. UTM, hundreds of thousands of metres) would lose
centimetre precision. Subtract in float64, then store float32.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import laspy
import numpy as np

HEADER_BYTES = 4
BYTES_PER_POINT = 15  # 3 x float32 + 3 x uint8
READ_CHUNK_POINTS = 1_000_000

ProgressCallback = Callable[[float], None]


@dataclass
class LasCloud:
    """All points of a LAS file, in real-world coordinates."""

    xyz: np.ndarray  # float64, shape (N, 3)
    rgb: Optional[np.ndarray]  # uint8, shape (N, 3); None if the file has no colours


def read_las(path: Path, on_progress: Optional[ProgressCallback] = None) -> LasCloud:
    """Read every point. Reads in chunks so progress (0..1) can be reported."""
    with laspy.open(path) as reader:
        header = reader.header
        expected = header.point_count
        has_rgb = "red" in set(header.point_format.dimension_names)

        xyz = np.empty((expected, 3), dtype=np.float64)
        rgb16 = np.empty((expected, 3), dtype=np.uint16) if has_rgb else None

        filled = 0
        for chunk in reader.chunk_iterator(READ_CHUNK_POINTS):
            n = min(len(chunk), expected - filled)
            # laspy applies the LAS scale/offset: .x/.y/.z are real coordinates.
            xyz[filled : filled + n, 0] = chunk.x[:n]
            xyz[filled : filled + n, 1] = chunk.y[:n]
            xyz[filled : filled + n, 2] = chunk.z[:n]
            if rgb16 is not None:
                rgb16[filled : filled + n, 0] = chunk.red[:n]
                rgb16[filled : filled + n, 1] = chunk.green[:n]
                rgb16[filled : filled + n, 2] = chunk.blue[:n]
            filled += n
            if on_progress:
                on_progress(filled / max(expected, 1))

    # Some writers store a wrong header count; keep only what was actually read.
    xyz = xyz[:filled]
    rgb = None
    if rgb16 is not None:
        rgb16 = rgb16[:filled]
        # LAS colours are usually 16-bit (0..65535); some files store 0..255.
        # Decided on the full dataset so every budget converts colours the same way.
        rgb = (rgb16 >> 8 if rgb16.max() > 255 else rgb16).astype(np.uint8)
    return LasCloud(xyz=xyz, rgb=rgb)


def compute_offset(xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Offset (X/Y centre, lowest Z) and bounds of the FULL point set."""
    mins, maxs = xyz.min(axis=0), xyz.max(axis=0)
    offset = np.array([(mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, mins[2]])
    return offset, mins, maxs


def sample_indices(total: int, max_points: int) -> Optional[np.ndarray]:
    """Sorted random subset of at most max_points indices (None = keep all)."""
    if total <= max_points:
        return None
    rng = np.random.default_rng(0)  # fixed seed: reproducible budgets
    keep = rng.choice(total, size=max_points, replace=False)
    keep.sort()
    return keep


def write_bin(
    path: Path,
    xyz: np.ndarray,
    rgb: Optional[np.ndarray],
    offset: np.ndarray,
    keep: Optional[np.ndarray],
) -> int:
    """Write one budget. Returns the number of points written."""
    if keep is not None:
        xyz = xyz[keep]
        rgb = rgb[keep] if rgb is not None else None
    if rgb is None:
        # No colours in the source: a neutral grey, flagged in the metadata
        # (hasRgb = false). Height colouring still works.
        rgb = np.full((len(xyz), 3), 180, dtype=np.uint8)

    local = (xyz - offset).astype("<f4")  # subtract in float64, then store float32
    with open(path, "wb") as f:
        f.write(np.uint32(len(local)).astype("<u4").tobytes())
        f.write(local.tobytes())
        f.write(np.ascontiguousarray(rgb, dtype=np.uint8).tobytes())
    return len(local)
