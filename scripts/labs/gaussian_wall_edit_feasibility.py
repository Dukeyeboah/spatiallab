#!/usr/bin/env python3
"""
LAB EXP-05C — Selective open-format Gaussian recoloring feasibility.

Works on a *copy* of a trained Gaussian PLY (never the original). Selection
combines plane distance, optional wall polygon, optional colour similarity,
and exclusion polygons. Recolours f_dc (base SH0 colour) and optionally
attenuates f_rest (higher SH) for more uniform paint — not physically correct
relighting.

Usage (from repo root):

  python3 scripts/labs/gaussian_wall_edit_feasibility.py \\
    --src spatial-data/splats/spl_7ca424a1fee6/source/scene.ply \\
    --out-dir spatial-data/labs/exp05c

Outputs under --out-dir:
  working_slice.ply      cropped region used for the lab (original untouched)
  selection_mask.npz     boolean mask + indices for the recolour pass
  selection_preview.json summary stats for the report
  recolored.ply          modified slice
  original_slice.ply     identical to working_slice (restore baseline)
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

SH_C0 = 0.28209479177387814

REQUIRED = {
    "x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
}


def parse_header(path: Path) -> tuple[bytes, int, int, np.dtype, list[str]]:
    with path.open("rb") as f:
        head = b""
        while b"end_header" not in head:
            line = f.readline()
            if not line:
                raise SystemExit(f"{path}: truncated PLY header")
            head += line
    text = head.decode("ascii", errors="replace")
    if "binary_little_endian" not in text:
        raise SystemExit(f"{path}: only binary_little_endian Gaussian PLY is supported")
    props: list[tuple[str, str]] = []
    count = 0
    for line in text.splitlines():
        w = line.split()
        if not w:
            continue
        if w[0] == "element" and w[1] == "vertex":
            count = int(w[2])
        elif w[0] == "property" and len(w) == 3 and w[1] in ("float", "float32"):
            props.append((w[2], "<f4"))
    names = [n for n, _ in props]
    if not REQUIRED <= set(names):
        missing = sorted(REQUIRED - set(names))
        raise SystemExit(f"{path}: not a trained Gaussian PLY (missing {missing})")
    dtype = np.dtype(props)
    return head, len(head), count, dtype, names


def mmap_vertices(path: Path) -> tuple[np.memmap, bytes, np.dtype]:
    head, offset, count, dtype, _ = parse_header(path)
    mm = np.memmap(path, dtype=dtype, mode="r", offset=offset, shape=(count,))
    return mm, head, dtype


def write_ply(path: Path, header: bytes, rows: np.ndarray) -> None:
    """Rewrite vertex count in the header and write rows."""
    text = header.decode("ascii", errors="replace")
    lines = []
    for line in text.splitlines(keepends=True):
        if line.startswith("element vertex"):
            lines.append(f"element vertex {len(rows)}\n")
        else:
            lines.append(line if line.endswith("\n") else line + "\n")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        f.write("".join(lines).encode("ascii"))
        f.write(rows.tobytes(order="C"))


def base_rgb(rows: np.ndarray) -> np.ndarray:
    return np.stack(
        [
            0.5 + SH_C0 * rows["f_dc_0"],
            0.5 + SH_C0 * rows["f_dc_1"],
            0.5 + SH_C0 * rows["f_dc_2"],
        ],
        axis=1,
    ).astype(np.float64)


def rgb_to_fdc(rgb: np.ndarray) -> np.ndarray:
    return ((rgb - 0.5) / SH_C0).astype(np.float32)


def point_in_poly_2d(uv: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Ray casting; poly is (N,2)."""
    x, y = uv[:, 0], uv[:, 1]
    n = len(poly)
    inside = np.zeros(len(uv), dtype=bool)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        intersect = ((yi > y) != (yj > y)) & (
            x < (xj - xi) * (y - yi) / ((yj - yi) + 1e-30) + xi
        )
        inside ^= intersect
        j = i
    return inside


def orthonormal_wall_basis(normal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n = normal / (np.linalg.norm(normal) + 1e-12)
    up = np.array([0.0, 0.0, 1.0])  # Nerfstudio Z-up for this sample
    if abs(np.dot(n, up)) > 0.92:
        up = np.array([0.0, 1.0, 0.0])
    t = np.cross(up, n)
    t /= np.linalg.norm(t) + 1e-12
    b = np.cross(n, t)
    b /= np.linalg.norm(b) + 1e-12
    return t, b


def estimate_vertical_plane(xyz: np.ndarray, sample: int = 40_000, seed: int = 7) -> tuple[np.ndarray, float]:
    """
    Rough RANSAC for a vertical wall: normal constrained to XY (Z-up file).
    Returns (unit normal, plane offset d) with n·x + d = 0.
    """
    rng = np.random.default_rng(seed)
    n = len(xyz)
    idx = rng.choice(n, size=min(sample, n), replace=False)
    pts = xyz[idx]
    best_inliers = -1
    best_n = np.array([1.0, 0.0, 0.0])
    best_d = 0.0
    thresh = 0.08
    for _ in range(80):
        i0, i1 = rng.choice(len(pts), size=2, replace=False)
        v = pts[i1] - pts[i0]
        # Vertical plane: normal ⊥ Z and ⊥ edge projected on XY
        edge = np.array([v[0], v[1], 0.0])
        if np.linalg.norm(edge) < 1e-4:
            continue
        normal = np.array([-edge[1], edge[0], 0.0])
        normal /= np.linalg.norm(normal) + 1e-12
        d = -float(np.dot(normal, pts[i0]))
        dist = np.abs(pts @ normal + d)
        inl = int(np.count_nonzero(dist < thresh))
        if inl > best_inliers:
            best_inliers = inl
            best_n, best_d = normal, d
    # Refine with inliers
    dist = np.abs(xyz @ best_n + best_d)
    inl = xyz[dist < thresh]
    if len(inl) >= 100:
        # PCA on XY for normal
        c = inl.mean(axis=0)
        xy = inl[:, :2] - c[:2]
        cov = xy.T @ xy / max(len(xy) - 1, 1)
        evals, evecs = np.linalg.eigh(cov)
        n_xy = evecs[:, 0]  # smallest variance
        best_n = np.array([n_xy[0], n_xy[1], 0.0])
        best_n /= np.linalg.norm(best_n) + 1e-12
        best_d = -float(np.dot(best_n, c))
    return best_n.astype(np.float64), float(best_d)


def crop_slice(rows: np.ndarray, center: np.ndarray, half: np.ndarray) -> np.ndarray:
    lo = center - half
    hi = center + half
    m = (
        (rows["x"] >= lo[0])
        & (rows["x"] <= hi[0])
        & (rows["y"] >= lo[1])
        & (rows["y"] <= hi[1])
        & (rows["z"] >= lo[2])
        & (rows["z"] <= hi[2])
    )
    return np.asarray(rows[m])


def select_gaussians(
    rows: np.ndarray,
    normal: np.ndarray,
    d: float,
    plane_thickness: float,
    poly_uv: np.ndarray | None,
    exclude_uv: list[np.ndarray],
    color_centroid: np.ndarray | None,
    color_max_dist: float,
    max_scale: float,
) -> np.ndarray:
    xyz = np.stack([rows["x"], rows["y"], rows["z"]], axis=1).astype(np.float64)
    dist = np.abs(xyz @ normal + d)
    mask = dist <= plane_thickness

    # Prefer flatter Gaussians (wall-like) — optional soft filter
    scales = np.exp(np.stack([rows["scale_0"], rows["scale_1"], rows["scale_2"]], axis=1))
    max_s = scales.max(axis=1)
    mask &= max_s <= max_scale

    t, b = orthonormal_wall_basis(normal)
    # Project onto plane
    plane_pts = xyz - np.outer(xyz @ normal + d, normal)
    # Origin at mean of plane candidates
    origin = plane_pts[mask].mean(axis=0) if np.any(mask) else plane_pts.mean(axis=0)
    rel = plane_pts - origin
    uv = np.stack([rel @ t, rel @ b], axis=1)

    if poly_uv is not None:
        mask &= point_in_poly_2d(uv, poly_uv)

    for ex in exclude_uv:
        mask &= ~point_in_poly_2d(uv, ex)

    if color_centroid is not None:
        rgb = base_rgb(rows)
        cdist = np.linalg.norm(rgb - color_centroid[None, :], axis=1)
        # Colour similarity is an *additional* filter, never the sole criterion
        # (plane/poly already required via mask so far).
        mask &= cdist <= color_max_dist

    return mask, uv, origin, t, b


def recolor(
    rows: np.ndarray,
    mask: np.ndarray,
    target_rgb: np.ndarray,
    attenuate_sh: float,
) -> np.ndarray:
    out = rows.copy()
    fdc = rgb_to_fdc(target_rgb)
    out["f_dc_0"][mask] = fdc[0]
    out["f_dc_1"][mask] = fdc[1]
    out["f_dc_2"][mask] = fdc[2]
    if attenuate_sh > 0:
        rest = [n for n in out.dtype.names if n.startswith("f_rest_")]
        factor = float(np.clip(1.0 - attenuate_sh, 0.0, 1.0))
        for name in rest:
            out[name][mask] = out[name][mask] * factor
    return out


def default_wall_polygon(uv: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Axis-aligned rectangle covering central 70% of planar candidates."""
    pts = uv[mask]
    if len(pts) < 10:
        return np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]], dtype=np.float64)
    lo = np.quantile(pts, 0.15, axis=0)
    hi = np.quantile(pts, 0.85, axis=0)
    return np.array(
        [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]],
        dtype=np.float64,
    )


def default_exclusion(poly: np.ndarray) -> np.ndarray:
    """Small rectangle in the upper-middle of the wall poly (fake ‘artwork’)."""
    lo = poly.min(axis=0)
    hi = poly.max(axis=0)
    c = (lo + hi) * 0.5
    w = (hi - lo) * 0.18
    return np.array(
        [
            [c[0] - w[0], c[1] + w[1] * 0.4],
            [c[0] + w[0], c[1] + w[1] * 0.4],
            [c[0] + w[0], c[1] + w[1] * 1.2],
            [c[0] - w[0], c[1] + w[1] * 1.2],
        ],
        dtype=np.float64,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, required=True, help="Original trained Gaussian PLY (read-only)")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--half-extent", type=float, nargs=3, default=(2.5, 2.5, 2.0), help="Crop half-size XYZ (file frame)")
    ap.add_argument("--plane-thickness", type=float, default=0.06)
    ap.add_argument("--max-scale", type=float, default=0.25, help="Exclude large Gaussians (metres)")
    ap.add_argument("--target-rgb", type=float, nargs=3, default=(0.55, 0.72, 0.58))
    ap.add_argument("--attenuate-sh", type=float, default=0.85, help="0..1 how much to damp f_rest on selected")
    ap.add_argument("--color-gate", type=float, default=0.35, help="Optional RGB distance gate (after plane+poly)")
    ap.add_argument(
        "--mode",
        choices=("in-place", "duplicate"),
        default="in-place",
        help="in-place: edit selected f_dc. duplicate: keep originals + append recoloured copies (EXP-05D Test B).",
    )
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    src = args.src.resolve()
    if not src.is_file():
        print(f"Missing source PLY: {src}", file=sys.stderr)
        return 1

    out = args.out_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)

    print(f"[exp05c] reading {src} …")
    mm, header, dtype = mmap_vertices(src)
    xyz_all = np.stack([mm["x"], mm["y"], mm["z"]], axis=1)
    # Crop around scene centre (robust percentiles)
    lo = np.percentile(xyz_all, 5, axis=0)
    hi = np.percentile(xyz_all, 95, axis=0)
    center = (lo + hi) * 0.5
    half = np.array(args.half_extent, dtype=np.float64)
    print(f"[exp05c] crop centre {center.round(3).tolist()} half {half.tolist()}")
    slice_rows = crop_slice(mm, center, half)
    print(f"[exp05c] working slice: {len(slice_rows):,} / {len(mm):,} Gaussians")
    if len(slice_rows) < 500:
        print("Slice too small — widen --half-extent", file=sys.stderr)
        return 1

    original_slice = out / "original_slice.ply"
    working = out / "working_slice.ply"
    write_ply(original_slice, header, slice_rows)
    write_ply(working, header, slice_rows)
    print(f"[exp05c] wrote restore baseline {original_slice.name}")

    xyz = np.stack([slice_rows["x"], slice_rows["y"], slice_rows["z"]], axis=1).astype(np.float64)
    normal, d = estimate_vertical_plane(xyz, seed=args.seed)
    print(f"[exp05c] estimated plane n={normal.round(4).tolist()} d={d:.4f}")

    # First pass without poly to build default poly
    scales = np.exp(
        np.stack([slice_rows["scale_0"], slice_rows["scale_1"], slice_rows["scale_2"]], axis=1)
    )
    rough = (np.abs(xyz @ normal + d) <= args.plane_thickness) & (scales.max(axis=1) <= args.max_scale)
    t, b = orthonormal_wall_basis(normal)
    origin = xyz[rough].mean(axis=0) if np.any(rough) else xyz.mean(axis=0)
    rel = (xyz - np.outer(xyz @ normal + d, normal)) - origin
    uv = np.stack([rel @ t, rel @ b], axis=1)
    poly = default_wall_polygon(uv, rough)
    excl = default_exclusion(poly)

    rgb = base_rgb(slice_rows)
    # Colour centroid from planar candidates (assistive, not sole)
    color_centroid = rgb[rough].mean(axis=0) if np.any(rough) else rgb.mean(axis=0)

    mask_full, uv2, origin2, t2, b2 = select_gaussians(
        slice_rows,
        normal,
        d,
        args.plane_thickness,
        poly,
        [],
        None,
        args.color_gate,
        args.max_scale,
    )
    mask_excl, _, _, _, _ = select_gaussians(
        slice_rows,
        normal,
        d,
        args.plane_thickness,
        poly,
        [excl],
        color_centroid,
        args.color_gate,
        args.max_scale,
    )

    n_full = int(mask_full.sum())
    n_excl = int(mask_excl.sum())
    print(f"[exp05c] selected (wall poly): {n_full:,}")
    print(f"[exp05c] selected (poly − exclusion): {n_excl:,} (excluded {n_full - n_excl:,})")

    # Selection preview: tint selected magenta in a preview-only array (not exported as scene default)
    preview = slice_rows.copy()
    preview = recolor(preview, mask_full, np.array([1.0, 0.2, 0.75]), attenuate_sh=1.0)
    write_ply(out / "selection_preview.ply", header, preview)

    target = np.array(args.target_rgb, dtype=np.float64)
    if args.mode == "duplicate":
        # Keep every original Gaussian; append recoloured clones of the selection.
        # Preserves underlying surface detail (at the cost of density / possible shimmer).
        clones = recolor(slice_rows[mask_excl].copy(), np.ones(int(mask_excl.sum()), dtype=bool), target, args.attenuate_sh)
        # Nudge clones a hair along +normal so they sit slightly toward the room
        n_xyz = normal / (np.linalg.norm(normal) + 1e-12)
        clones["x"] = clones["x"] + np.float32(n_xyz[0] * 0.004)
        clones["y"] = clones["y"] + np.float32(n_xyz[1] * 0.004)
        clones["z"] = clones["z"] + np.float32(n_xyz[2] * 0.004)
        recolored = np.concatenate([slice_rows, clones])
        print(f"[exp05c] duplicate mode: {len(slice_rows):,} originals + {len(clones):,} recoloured clones")
    else:
        recolored = recolor(slice_rows, mask_excl, target, attenuate_sh=args.attenuate_sh)
    write_ply(out / ("recolored_duplicate.ply" if args.mode == "duplicate" else "recolored.ply"), header, recolored)

    np.savez_compressed(
        out / "selection_mask.npz",
        mask_full=mask_full,
        mask_excl=mask_excl,
        normal=normal,
        d=np.array([d]),
        poly_uv=poly,
        exclude_uv=excl,
        origin=origin2,
        tangent=t2,
        bitangent=b2,
    )

    # Spatial consistency check: exclusion region along a second “view” (shift UV frame)
    # Compare overlap of excluded set when poly is rotated 0° vs when we only change
    # the projection origin slightly (simulates viewpoint-independent 3D selection).
    origin_shift = origin2 + t2 * 0.05 + b2 * 0.03
    rel_b = (xyz - np.outer(xyz @ normal + d, normal)) - origin_shift
    uv_b = np.stack([rel_b @ t2, rel_b @ b2], axis=1)
    # Re-express polys in shifted UV approximately by translating
    delta = np.array([0.05, 0.03])
    poly_b = poly - delta
    excl_b = excl - delta
    inside_a = mask_full & ~point_in_poly_2d(uv2, excl)
    inside_b = (
        (np.abs(xyz @ normal + d) <= args.plane_thickness)
        & point_in_poly_2d(uv_b, poly_b)
        & ~point_in_poly_2d(uv_b, excl_b)
    )
    agree = float(np.mean(inside_a == inside_b)) if len(inside_a) else 0.0

    summary = {
        "source": str(src),
        "sourceBytes": src.stat().st_size,
        "sourceCount": int(len(mm)),
        "sliceCount": int(len(slice_rows)),
        "plane": {"normal": normal.tolist(), "d": d, "thicknessM": args.plane_thickness},
        "selection": {
            "wallPolyCount": n_full,
            "afterExclusionCount": n_excl,
            "excludedCount": n_full - n_excl,
            "colorGateUsed": True,
            "colorCentroid": color_centroid.tolist(),
            "colorMaxDist": args.color_gate,
        },
        "recolor": {
            "mode": args.mode,
            "targetRgb": list(args.target_rgb),
            "attenuateSh": args.attenuate_sh,
            "method": (
                "duplicate: keep originals + append f_dc-edited clones nudged +4mm along normal"
                if args.mode == "duplicate"
                else "in-place: set f_dc from target RGB via (c-0.5)/C0; multiply f_rest by (1-attenuate)"
            ),
        },
        "exclusionConsistency": {
            "note": "3D Gaussian membership vs shifted UV frame (not a pixel mask)",
            "maskAgreement": round(agree, 4),
        },
        "attributesPresent": {
            "position": True,
            "scaleLog": True,
            "rotationQuat": True,
            "opacityLogit": True,
            "fDc": True,
            "fRest": any(n.startswith("f_rest_") for n in dtype.names),
            "semanticLabels": False,
        },
        "outputs": {
            "original_slice": str(original_slice),
            "working_slice": str(working),
            "selection_preview": str(out / "selection_preview.ply"),
            "recolored": str(out / "recolored.ply"),
            "mask": str(out / "selection_mask.npz"),
        },
        "restore": "Replace recolored.ply with original_slice.ply (byte-identical baseline written first).",
    }
    (out / "selection_preview.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"[exp05c] summary → {out / 'selection_preview.json'}")
    print("[exp05c] done. Original source PLY was not modified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
