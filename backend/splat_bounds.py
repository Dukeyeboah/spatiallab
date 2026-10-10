"""
Robust bounds of a Gaussian scene's splat centres, for the viewer's starting
camera (Lab 8).

The plain bounding box of a trained scene is dominated by a few stray
"floater" splats far away (Ceramic Studio: about ±200 m around a room a few
metres wide), so framing it shows the scene as a dot. The box from the 2nd
to the 98th percentile of the centres, per axis, frames what was captured.

Values are in the scene file's own frame (as trained, nothing rotated); the
viewer's 180° rotation about Z is applied in lib/splats.ts.

"centralFraction" is the share of centres in the middle half of that box
(per axis). A shell such as a room puts few splats there (Ceramic Studio
0.04, Apartment 0.17), a compact object many (0.8 for a dense blob in a
sparse background; uniform filling would give 0.125). The frontend uses it
only to pick the default start view, inside or outside; the user can switch.

How centres are read, per format:
    ply             x, y, z of every vertex (memory-mapped, sampled)
    compressed-ply  centre of each 256-splat chunk's min/max box
    SOG             means_l.webp / means_u.webp: 16-bit values per axis
                    (upper byte << 8 | lower byte) / 65535, mapped linearly
                    to [mins, maxs] from meta.json, then un-logged:
                    x = sign(v) * (exp(|v|) - 1)
"""

import io
import json
import posixpath
import zipfile
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
from PIL import Image

from splats import parse_ply_header, read_head

PERCENTILES = (2.0, 98.0)
MAX_SAMPLE = 2_000_000

PLY_NUMPY_TYPES = {
    "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
    "short": "<i2", "int16": "<i2", "ushort": "<u2", "uint16": "<u2",
    "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
    "float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
}


def _sample(points: np.ndarray) -> np.ndarray:
    step = max(1, len(points) // MAX_SAMPLE)
    return points[::step]


def ply_centres(path: Path) -> np.ndarray:
    _, offset, elements = parse_ply_header(read_head(path), path.name)
    for element in elements:
        dtype = np.dtype([(n, PLY_NUMPY_TYPES[t]) for n, t in zip(element["properties"], element["types"])])
        data = np.memmap(path, dtype=dtype, mode="r", offset=offset, shape=(element["count"],))
        if element["name"] == "chunk":  # compressed PLY: chunks come first
            return np.stack([(data[f"min_{a}"] + data[f"max_{a}"]) / 2 for a in "xyz"], axis=1).astype(np.float64)
        if element["name"] == "vertex" and "x" in dtype.names:
            sample = _sample(data)
            return np.stack([sample["x"], sample["y"], sample["z"]], axis=1).astype(np.float64)
        offset += element["count"] * dtype.itemsize
    raise ValueError("no splat positions found")


def sog_centres(meta_path: str, read: Callable[[str], bytes]) -> np.ndarray:
    """Decode the means of one SOG meta.json; `read` takes a package-relative path."""
    meta = json.loads(read(meta_path))
    means, count = meta["means"], meta["count"]
    files = [posixpath.normpath(posixpath.join(posixpath.dirname(meta_path), f)) for f in means["files"]]
    lower = next((f for f in files if f.endswith("means_l.webp")), files[0])
    upper = next((f for f in files if f.endswith("means_u.webp")), files[1])

    def pixels(path: str) -> np.ndarray:
        image = Image.open(io.BytesIO(read(path))).convert("RGB")
        return np.asarray(image, dtype=np.uint16).reshape(-1, 3)[:count]

    quantised = ((pixels(upper) << 8) | pixels(lower)).astype(np.float64) / 65535.0
    mins, maxs = np.asarray(means["mins"], dtype=np.float64), np.asarray(means["maxs"], dtype=np.float64)
    v = mins + (maxs - mins) * quantised
    return _sample(np.sign(v) * np.expm1(np.abs(v)))


def scene_centres(root: Path, metadata: dict[str, Any]) -> np.ndarray:
    fmt, entry = metadata["format"], metadata["entry"]
    if fmt in ("ply", "compressed-ply"):
        return ply_centres(root / entry)
    if fmt == "sog":
        with zipfile.ZipFile(root / entry) as archive:
            return sog_centres("meta.json", archive.read)

    def read(path: str) -> bytes:
        return (root / path).read_bytes()

    if fmt == "sog-folder":
        return sog_centres(entry, read)
    lod = json.loads(read(entry))  # sog-lod: every chunk except the environment
    base = posixpath.dirname(entry)
    chunks = [posixpath.join(base, f) for f in lod["filenames"] if f.endswith("meta.json")]
    return _sample(np.concatenate([sog_centres(chunk, read) for chunk in chunks]))


GRID = 16
VERTICAL_AXIS = 1  # file frame, trained Y-down (the viewer flips it to Y-up)
HORIZONTAL_DIRECTIONS = [(np.cos(a), np.sin(a)) for a in np.linspace(0, 2 * np.pi, 16, endpoint=False)]


def free_viewpoint(centres: np.ndarray, low: np.ndarray, high: np.ndarray) -> Optional[dict[str, list[float]]]:
    """
    A camera spot in empty space for the "inside" start view: the box is cut
    into 16³ cells; a cell is free when it and its 26 neighbours hold
    (almost) no splats. The free cell at mid height nearest the box centre
    wins, looking horizontally along the longest clear line of sight. None
    if nothing is free (a solid object). File frame, like the bounds.
    """
    size = high - low
    cell = np.floor((centres - low) / size * GRID).astype(int)
    cell = cell[((cell >= 0) & (cell < GRID)).all(axis=1)]
    counts = np.zeros((GRID, GRID, GRID), dtype=np.int64)
    np.add.at(counts, (cell[:, 0], cell[:, 1], cell[:, 2]), 1)
    occupied = counts > max(1.0, 0.02 * counts.mean())

    padded = np.pad(occupied, 1)
    near = np.zeros_like(occupied)
    for dx in range(3):
        for dy in range(3):
            for dz in range(3):
                near |= padded[dx:dx + GRID, dy:dy + GRID, dz:dz + GRID]
    free = ~near
    band = np.zeros_like(free)
    band[:, GRID // 4: 3 * GRID // 4, :] = True  # keep away from floor and ceiling
    candidates = np.argwhere(free & band)
    if len(candidates) == 0:
        return None

    def centre_of(cells: np.ndarray) -> np.ndarray:
        return low + (cells + 0.5) / GRID * size

    middle = (low + high) / 2
    best = candidates[np.argmin(np.linalg.norm((centre_of(candidates) - middle) / size, axis=1))]

    def clear_run(dx: float, dz: float) -> float:
        """Metres of open cells from `best` in a horizontal direction."""
        step = 0.5
        distance = 0.0
        while True:
            point = best + 0.5 + np.array([dx, 0.0, dz]) * (distance + step) / (size / GRID)
            index = np.floor(point).astype(int)
            if (index < 0).any() or (index >= GRID).any() or occupied[tuple(index)]:
                return distance
            distance += step

    runs = [clear_run(dx, dz) for dx, dz in HORIZONTAL_DIRECTIONS]
    dx, dz = HORIZONTAL_DIRECTIONS[int(np.argmax(runs))]
    position = centre_of(best)
    # Orbit turns around the target: a point part-way along the view, so
    # dragging looks around the room rather than circling far away.
    reach = max(0.5, 0.5 * max(runs))
    target = position + np.array([dx, 0.0, dz]) * reach
    return {"position": [round(float(v), 4) for v in position], "target": [round(float(v), 4) for v in target]}


def robust_bounds(root: Path, metadata: dict[str, Any]) -> Optional[dict[str, Any]]:
    centres = scene_centres(root, metadata)
    centres = centres[np.isfinite(centres).all(axis=1)]
    if len(centres) == 0:
        return None
    low, high = np.percentile(centres, PERCENTILES, axis=0)
    middle, half = (low + high) / 2, (high - low) / 2
    central = float((np.abs(centres - middle) < half / 2).all(axis=1).mean())
    return {
        "min": [round(float(v), 4) for v in low],
        "max": [round(float(v), 4) for v in high],
        "percentiles": list(PERCENTILES),
        "sampledCentres": int(len(centres)),
        "centralFraction": round(central, 4),
        "insideViewpoint": free_viewpoint(centres, low, high),
    }
