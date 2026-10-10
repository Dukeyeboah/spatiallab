"""
Read individual Gaussians from a trained Gaussian PLY (Lab 9: Gaussian Inspector).

The file is memory-mapped, so reading a few records touches only the pages
that hold them: inspecting Gaussian #812,345 of a 236 MB file reads a few
kilobytes, never the whole scene. Nothing is ever written back.

How a trained Gaussian PLY (the 3D Gaussian Splatting reference layout) stores
one Gaussian: a binary little-endian "vertex" record of float32 properties

    x, y, z                 centre (the mean), in the scene's own frame
    nx, ny, nz              optional, unused by Gaussian splatting (always 0)
    f_dc_0..2               base colour as the degree-0 spherical-harmonic (SH) coefficient, per RGB channel
    f_rest_0..(3K-1)        higher SH coefficients, K = 3, 8 or 15 per channel (SH degree 1, 2, 3),
                            stored channel by channel: all K red, then all K green, then all K blue
    opacity                 logit of the opacity (any real number)
    scale_0..2              natural log of the standard deviation along the Gaussian's own axes
    rot_0..3                rotation quaternion (w, x, y, z), NOT normalised

Training optimises unconstrained numbers; the renderer turns them into
meaningful values. The same conversions are applied here ("decoded"):

    scale    = exp(scale_i)                       always positive; log spacing covers mm..m
    opacity  = sigmoid(opacity) = 1 / (1 + e^-v)  always in (0, 1)
    rotation = rot / |rot|                        a unit quaternion
    colour   = 0.5 + C0 * f_dc,  C0 = 0.28209479  (the constant SH basis function Y00);
               the view-dependent part, sum of f_rest * SH basis(view direction), is added on
               top and depends on the camera (evaluated in the browser, lib/gaussian/sphericalHarmonics.ts)

An ordinary point-cloud PLY (x, y, z, red, green, blue...) has none of these
fields and is refused when imported (splats.inspect_ply), so it can never
reach this module as a Gaussian scene.

Random samples use SplitMix64, a tiny, fully specified generator, so a seed
gives the same Gaussians on any machine and any NumPy version.
"""

import math
from typing import Any, Optional

import numpy as np

from splat_bounds import PLY_NUMPY_TYPES
from splats import parse_ply_header, read_head, served_file

SH_C0 = 0.28209479177387814
MAX_RECORDS = 64            # records per request
SUMMARY_SAMPLE = 20_000     # Gaussians behind the summary statistics
SUMMARY_PERCENTILES = (1, 5, 25, 50, 75, 95, 99)
FLOAT_TYPES = {"float", "float32", "double", "float64"}


class GaussianReadError(Exception):
    """Shown to the user (HTTP 400)."""


# ---------------------------------------------------------------------------
# Layout


def ply_layout(metadata: dict[str, Any]) -> dict[str, Any]:
    """Where the vertex records are and how one is laid out. Refuses anything but a standard Gaussian PLY."""
    fmt = metadata.get("format")
    if fmt == "compressed-ply":
        raise GaussianReadError(
            "This scene is a compressed PLY: its Gaussians are quantised into 256-splat chunks, not stored "
            "one by one. Decompress it with SplatTransform "
            "(`npx @playcanvas/splat-transform scene.compressed.ply scene.ply`) and import the result."
        )
    if fmt != "ply":
        raise GaussianReadError(
            f"This scene is {metadata.get('formatLabel') or fmt}: SOG stores Gaussians as quantised WebP "
            "images, so its values are approximations. The inspector reads trained Gaussian PLY files; "
            "import the scene's .ply (e.g. SuperSplat's PLY download)."
        )
    path = served_file(metadata, metadata["entry"])
    if path is None:
        raise GaussianReadError("The scene's PLY file is missing.")

    _, offset, elements = parse_ply_header(read_head(path), path.name)
    for element in elements:
        if element["name"] == "vertex":
            break
        offset += element["count"] * element.get("stride", 0)
    else:
        raise GaussianReadError("No vertex element in the PLY.")

    properties = element["properties"]
    types = element["types"]
    rest = sorted((p for p in properties if p.startswith("f_rest_")), key=lambda p: int(p[7:]))
    if len(rest) % 3:
        raise GaussianReadError(f"{len(rest)} f_rest properties: not a multiple of 3 (one set per colour channel).")
    sh_degree = {0: 0, 3: 1, 8: 2, 15: 3}.get(len(rest) // 3)
    if sh_degree is None:
        raise GaussianReadError(f"{len(rest)} f_rest properties don't match SH degree 1, 2 or 3.")
    non_float = [p for p, t in zip(properties, types) if t not in FLOAT_TYPES]
    if non_float:
        raise GaussianReadError(f"Expected float properties; found integer ones ({', '.join(non_float[:4])}).")

    return {
        "path": path,
        "count": element["count"],
        "dataOffset": offset,
        "stride": element["stride"],
        "dtype": np.dtype([(n, PLY_NUMPY_TYPES[t]) for n, t in zip(properties, types)]),
        "properties": [{"name": n, "type": t} for n, t in zip(properties, types)],
        "restNames": rest,
        "shDegree": sh_degree,
    }


def public_layout(layout: dict[str, Any]) -> dict[str, Any]:
    return {
        "count": layout["count"],
        "dataOffset": layout["dataOffset"],
        "stride": layout["stride"],
        "properties": layout["properties"],
        "shDegree": layout["shDegree"],
        "shCoefficientsPerChannel": (layout["shDegree"] + 1) ** 2,
        "fileBytes": layout["path"].stat().st_size,
    }


def open_records(layout: dict[str, Any]) -> np.memmap:
    return np.memmap(layout["path"], dtype=layout["dtype"], mode="r",
                     offset=layout["dataOffset"], shape=(layout["count"],))


# ---------------------------------------------------------------------------
# Decoding one Gaussian


def finite(value: float) -> Optional[float]:
    """JSON has no NaN/Infinity: non-finite values become null (and are flagged)."""
    return value if math.isfinite(value) else None


def sigmoid(v: float) -> float:
    if v >= 0:
        return 1.0 / (1.0 + math.exp(-v))
    e = math.exp(v)  # stable for very negative v
    return e / (1.0 + e)


def decode_record(record: np.void, index: int, layout: dict[str, Any]) -> dict[str, Any]:
    names = record.dtype.names
    raw = {name: float(record[name]) for name in names}
    checks: list[str] = []
    bad = [name for name, value in raw.items() if not math.isfinite(value)]
    if bad:
        checks.append(f"Non-finite stored values: {', '.join(bad[:6])}.")

    position = [raw["x"], raw["y"], raw["z"]]
    log_scale = [raw["scale_0"], raw["scale_1"], raw["scale_2"]]
    scale = [math.exp(min(v, 700.0)) for v in log_scale]
    if any(s > 1000 for s in scale):
        checks.append("A scale above 1 km: a degenerate Gaussian.")

    quaternion_raw = [raw["rot_0"], raw["rot_1"], raw["rot_2"], raw["rot_3"]]  # w, x, y, z
    norm = math.sqrt(sum(q * q for q in quaternion_raw))
    if norm > 1e-12 and math.isfinite(norm):
        quaternion = [q / norm for q in quaternion_raw]
    else:
        quaternion = [1.0, 0.0, 0.0, 0.0]
        checks.append("The stored quaternion has zero length; shown unrotated.")

    opacity = sigmoid(raw["opacity"])
    f_dc = [raw["f_dc_0"], raw["f_dc_1"], raw["f_dc_2"]]
    base = [0.5 + SH_C0 * v for v in f_dc]
    if any(c < 0 or c > 1 for c in base):
        checks.append("Base colour outside 0..1 (allowed: view-dependent terms and clamping bring it back).")

    # f_rest is channel-major: [R coeff 1..K, G coeff 1..K, B coeff 1..K] -> K rows of [r, g, b].
    rest = layout["restNames"]
    k = len(rest) // 3
    sh_rest = [[raw[rest[c * k + i]] for c in range(3)] for i in range(k)]

    return {
        "index": index,
        "byteOffset": layout["dataOffset"] + index * layout["stride"],
        "stored": {name: finite(value) for name, value in raw.items()},
        "decoded": {
            "position": [finite(v) for v in position],
            "logScale": [finite(v) for v in log_scale],
            "scale": [finite(v) for v in scale],
            "quaternionRaw": [finite(v) for v in quaternion_raw],
            "quaternionNorm": finite(norm),
            "quaternion": quaternion,
            "opacityLogit": finite(raw["opacity"]),
            "opacity": opacity,
            "fDc": [finite(v) for v in f_dc],
            "baseColor": [finite(v) for v in base],
            "shDegree": layout["shDegree"],
            "shRest": [[finite(v) for v in row] for row in sh_rest],
        },
        "checks": checks,
    }


def read_records(metadata: dict[str, Any], indices: list[int]) -> dict[str, Any]:
    layout = ply_layout(metadata)
    if not indices:
        raise GaussianReadError("No Gaussian index given.")
    if len(indices) > MAX_RECORDS:
        raise GaussianReadError(f"At most {MAX_RECORDS} Gaussians per request.")
    out_of_range = [i for i in indices if not 0 <= i < layout["count"]]
    if out_of_range:
        raise GaussianReadError(
            f"Index {out_of_range[0]:,} is out of range: this scene has {layout['count']:,} Gaussians "
            f"(0 to {layout['count'] - 1:,})."
        )
    data = open_records(layout)
    records = [decode_record(data[i], i, layout) for i in indices]
    del data
    return {"layout": public_layout(layout), "records": records}


# ---------------------------------------------------------------------------
# Reproducible random samples


MASK64 = (1 << 64) - 1


def splitmix64(seed: int):
    """SplitMix64 (Steele, Lea & Flood 2014): the same stream for a seed everywhere."""
    state = seed & MASK64
    while True:
        state = (state + 0x9E3779B97F4A7C15) & MASK64
        z = state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
        yield z ^ (z >> 31)


def sample_indices(seed: int, count: int, population: int) -> list[int]:
    """`count` distinct indices in [0, population), in draw order. The modulo bias is < 2^-40 here."""
    count = min(count, population)
    seen: set[int] = set()
    out: list[int] = []
    for value in splitmix64(seed):
        index = value % population
        if index not in seen:
            seen.add(index)
            out.append(index)
            if len(out) == count:
                return out
    return out  # unreachable: the generator is infinite


def read_sample(metadata: dict[str, Any], seed: int, count: int) -> dict[str, Any]:
    layout = ply_layout(metadata)
    if not 1 <= count <= MAX_RECORDS:
        raise GaussianReadError(f"Sample size must be 1–{MAX_RECORDS}.")
    indices = sample_indices(seed, count, layout["count"])
    result = read_records(metadata, indices)
    result["seed"] = seed
    return result


def summarise(metadata: dict[str, Any], seed: int) -> dict[str, Any]:
    """Distributions of the decoded values over a seeded sample: what "typical" looks like, and validity."""
    layout = ply_layout(metadata)
    indices = np.array(sorted(sample_indices(seed, SUMMARY_SAMPLE, layout["count"])), dtype=np.int64)
    data = open_records(layout)[indices]  # sorted: the reads move forward through the file

    def column(name: str) -> np.ndarray:
        return data[name].astype(np.float64)

    stored = np.stack([column(n) for n in data.dtype.names], axis=1)
    finite_rows = np.isfinite(stored).all(axis=1)

    log_scale = np.stack([column(f"scale_{i}") for i in range(3)], axis=1)
    scale = np.exp(np.minimum(log_scale, 700.0))
    q = np.stack([column(f"rot_{i}") for i in range(4)], axis=1)
    q_norm = np.linalg.norm(q, axis=1)
    logit = column("opacity")
    with np.errstate(over="ignore"):  # exp overflow -> inf -> opacity 0, which is the right limit
        opacity = 1 / (1 + np.exp(-logit))
    base = 0.5 + SH_C0 * np.stack([column(f"f_dc_{i}") for i in range(3)], axis=1)

    def stats(values: np.ndarray) -> dict[str, Any]:
        values = values[np.isfinite(values)]
        if values.size == 0:
            return {"percentiles": {}, "min": None, "max": None}
        return {
            "percentiles": {str(p): float(v) for p, v in zip(SUMMARY_PERCENTILES, np.percentile(values, SUMMARY_PERCENTILES))},
            "min": float(values.min()),
            "max": float(values.max()),
        }

    sorted_scale = np.sort(scale, axis=1)
    summary = {
        "seed": seed,
        "sampled": int(len(indices)),
        "nonFinite": int((~finite_rows).sum()),
        "scaleLargest": stats(sorted_scale[:, 2]),
        "scaleSmallest": stats(sorted_scale[:, 0]),
        "anisotropy": stats(sorted_scale[:, 2] / np.maximum(sorted_scale[:, 0], 1e-30)),
        "opacity": stats(opacity),
        "opacityLogit": stats(logit),
        "quaternionNorm": stats(q_norm),
        "zeroQuaternions": int((q_norm < 1e-12).sum()),
        "baseColorOutside01": float(((base < 0) | (base > 1)).any(axis=1).mean()),
        # A PLY saved from compressed data (e.g. a SuperSplat download of an SOG scene) has opacities on
        # 1/255 steps; one straight from training has arbitrary values.
        "opacityOn255Steps": float((np.abs(opacity * 255 - np.round(opacity * 255)) < 1e-3).mean()),
    }
    if layout["restNames"]:
        rest = np.stack([column(n) for n in layout["restNames"]], axis=1)
        summary["shRestMagnitude"] = stats(np.sqrt((rest ** 2).sum(axis=1)))
    return {"layout": public_layout(layout), "summary": summary}
