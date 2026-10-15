#!/usr/bin/env python3
"""
Lab 14A: preflight checks of a dataset written by prepare_splat_dataset.py.
Reads the dataset back from disk and recomputes what it can independently
(poses from poses.csv with SciPy's Slerp, projections from the COLMAP files,
pixels from the original fisheye JPEGs). Writes only into <dataset>/checks/
(a new folder; never overwritten).

    backend/.venv/bin/python scripts/xgrids/validate_splat_dataset.py DATASET \
        --correspondences CORRESPONDENCES.json \
        --cloud-bin public/datasets/basel-house/basel-preview-5m.bin \
        --cloud-metadata public/datasets/basel-house/basel-preview-5m-metadata.json

Exit code 0 = no failed check (warnings allowed), 1 = at least one failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage, sparse
from scipy.spatial.transform import Rotation, Slerp

sys.path.insert(0, str(Path(__file__).resolve().parent))
import splat_colmap as colmap  # noqa: E402
import splat_geometry as g  # noqa: E402

cc = g.cc
RENDER_W, RENDER_H = 200, 150
RENDER_RANGE_M = 25.0
NEAR_M = 0.3


class Report:
    def __init__(self) -> None:
        self.checks: list[dict] = []

    def add(self, name: str, status: str, summary: str, **details) -> None:
        assert status in ("pass", "warn", "fail", "info")
        self.checks.append({"check": name, "status": status, "summary": summary, **details})
        print(f"[{status.upper():4}] {name}: {summary}", flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def read_poses(path: Path):
    data = np.loadtxt(path, delimiter=",", dtype=np.float64)
    times_us = np.round(data[:, 0] * 1e6).astype(np.int64)
    return times_us, data[:, 1:4], Rotation.from_quat(data[:, 4:8])   # SciPy: scalar-last (x, y, z, w)


def interpolate(times_us, positions, rotations, t_us: int):
    k = int(np.clip(np.searchsorted(times_us, t_us, side="right") - 1, 0, len(times_us) - 2))
    a = (t_us - times_us[k]) / (times_us[k + 1] - times_us[k])
    p = positions[k] + a * (positions[k + 1] - positions[k])
    r = Slerp([0.0, 1.0], rotations[[k, k + 1]])([a])[0]
    return p, r.as_matrix()


def camera_from_colmap(image: colmap.Image, camera: colmap.Camera):
    """(R_c2w, C, K in OpenCV pixels) from the files as written."""
    r_w2c = g.qvec_to_rotmat(image.qvec)
    t = np.asarray(image.tvec)
    fx, fy, cx, cy = camera.params
    k = np.array([[fx, 0, cx - 0.5], [0, fy, cy - 0.5], [0, 0, 1.0]])
    return r_w2c.T, -r_w2c.T @ t, k


def render_ids(points: np.ndarray, r_c2w, centre, k, width: int, height: int, scale_w: int, scale_h: int):
    """Nearest LiDAR point per cell of a (scale_w × scale_h) grid over the view: point index or −1."""
    u, v, z = g.project_pinhole(points, r_c2w, centre, k)
    ok = (z > NEAR_M) & (u >= -0.5) & (u < width - 0.5) & (v >= -0.5) & (v < height - 0.5)
    xi = ((u[ok] + 0.5) * scale_w / width).astype(int)
    yi = ((v[ok] + 0.5) * scale_h / height).astype(int)
    idx = np.nonzero(ok)[0]
    order = np.argsort(-z[ok])
    grid = np.full((scale_h, scale_w), -1, dtype=np.int64)
    grid[yi[order], xi[order]] = idx[order]
    return grid


def ncc(a: np.ndarray, b: np.ndarray):
    both = ~np.isnan(a) & ~np.isnan(b)
    if both.sum() < 200:
        return None
    x, y = a[both] - a[both].mean(), b[both] - b[both].mean()
    d = math.sqrt(float((x * x).sum() * (y * y).sum()))
    return float((x * y).sum() / d) if d > 0 else None


def laplacian_variance(grey: np.ndarray) -> float:
    return float(ndimage.laplace(grey).var())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--correspondences", type=Path, required=True)
    parser.add_argument("--cloud-bin", type=Path, required=True)
    parser.add_argument("--cloud-metadata", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=8, help="views drawn as reprojection overlays")
    args = parser.parse_args()
    root = args.dataset.resolve()
    checks_dir = root / "checks"
    if checks_dir.exists():
        parser.error(f"{checks_dir} exists; checks are never overwritten")
    report = Report()
    manifest = json.loads((root / "manifest.json").read_text())
    entries = manifest["images"]
    by_name = {Path(e["file"]).name: e for e in entries}
    cal = manifest["calibration"]["cameras"]
    run_dir = Path(manifest["source"]["run"])

    # --- 1. File structure ------------------------------------------------------------------------
    sums_bad = []
    for line in (root / "SHA256SUMS").read_text().splitlines():
        digest, rel = line.split("  ", 1)
        if sha256_file(root / rel) != digest:
            sums_bad.append(rel)
    report.add("checksums", "fail" if sums_bad else "pass", f"{len((root / 'SHA256SUMS').read_text().splitlines())} files, {len(sums_bad)} mismatches", mismatches=sums_bad[:20])

    model_dir = root / "sparse" / "0"
    cams_bin, cams_txt = colmap.read_cameras_bin(model_dir / "cameras.bin"), colmap.read_cameras_txt(model_dir / "cameras.txt")
    ims_bin, ims_txt = colmap.read_images_bin(model_dir / "images.bin"), colmap.read_images_txt(model_dir / "images.txt")
    pts_bin, rgb_bin = colmap.read_points_bin(model_dir / "points3D.bin")
    pts_txt, rgb_txt = colmap.read_points_txt(model_dir / "points3D.txt")
    same = (cams_bin.keys() == cams_txt.keys() and all(np.allclose(cams_bin[k].params, cams_txt[k].params, atol=1e-9) and
                                                       (cams_bin[k].width, cams_bin[k].height) == (cams_txt[k].width, cams_txt[k].height) for k in cams_bin)
            and ims_bin.keys() == ims_txt.keys()
            and all(ims_bin[k].name == ims_txt[k].name and ims_bin[k].camera_id == ims_txt[k].camera_id and
                    np.allclose(ims_bin[k].qvec, ims_txt[k].qvec, atol=1e-12) and np.allclose(ims_bin[k].tvec, ims_txt[k].tvec, atol=1e-9) for k in ims_bin)
            and np.allclose(pts_bin, pts_txt, atol=1e-9) and (rgb_bin == rgb_txt).all())
    ids = sorted(ims_bin)
    names = [ims_bin[k].name for k in ids]
    files_on_disk = sorted(p.name for p in (root / "images").iterdir())
    structure_ok = (same and ids == list(range(1, len(ids) + 1)) and len(set(names)) == len(names)
                    and sorted(names) == files_on_disk and set(names) == set(by_name)
                    and all(ims_bin[k].camera_id in cams_bin for k in ids))
    report.add("colmap structure", "pass" if structure_ok else "fail",
               f"{len(cams_bin)} PINHOLE camera(s), {len(ids)} images (ids 1…{len(ids)}), {len(pts_bin):,} points; "
               f".bin == .txt: {same}; image files match the model and the manifest: {sorted(names) == files_on_disk and set(names) == set(by_name)}")
    poses_only = colmap.read_images_bin(root / "sparse/poses-only/images.bin")
    report.add("poses-only model", "pass" if {k: (v.name, v.qvec) for k, v in poses_only.items()} == {k: (v.name, v.qvec) for k, v in ims_bin.items()}
               and len(colmap.read_points_bin(root / "sparse/poses-only/points3D.bin")[0]) == 0 else "fail",
               "same cameras and poses, no points")
    manifest_match = max(max(np.abs(np.subtract(ims_bin[e["imageId"]].qvec, e["colmap"]["qvec"])).max(),
                             np.abs(np.subtract(ims_bin[e["imageId"]].tvec, e["colmap"]["tvec"])).max()) for e in entries)
    report.add("manifest ↔ COLMAP", "pass" if manifest_match < 1e-9 else "fail", f"max |difference| {manifest_match:.1e}")
    eval_ids = [k for k in ids if (k - 1) % manifest["trainer"]["evalInterval"] == 0]
    split_ok = all((by_name[ims_bin[k].name]["split"] == "eval") == (k in eval_ids) for k in ids)
    eval_channels = defaultdict(int)
    for k in eval_ids:
        eval_channels[by_name[ims_bin[k].name]["channel"]] += 1
    report.add("train/eval split", "pass" if split_ok and len(eval_channels) == 2 else "warn",
               f"{len(ids) - len(eval_ids)} train / {len(eval_ids)} eval (every {manifest['trainer']['evalInterval']}th image id, "
               f"as Nerfstudio's interval split); eval per camera {dict(eval_channels)}")

    # --- 2. Images ----------------------------------------------------------------------------------
    sizes_bad, greys, quality = [], {}, {}
    for k in ids:
        im = ims_bin[k]
        cam = cams_bin[im.camera_id]
        with Image.open(root / "images" / im.name) as pic:
            if pic.size != (cam.width, cam.height) or pic.format != "JPEG":
                sizes_bad.append(im.name)
            rgb = np.asarray(pic.convert("RGB"), dtype=np.float32)
        grey = rgb.mean(axis=2)
        small = np.asarray(Image.fromarray(grey.astype(np.uint8)).resize((800, 600), Image.BOX), dtype=np.float32)
        greys[im.name] = np.asarray(Image.fromarray(grey.astype(np.uint8)).resize((RENDER_W, RENDER_H), Image.BOX), dtype=np.float32)
        quality[im.name] = {"sharpness": laplacian_variance(small), "mean": float(grey.mean()),
                            "clipped": float((rgb.max(axis=2) >= 250).mean()), "dark": float((grey <= 8).mean())}
    events = sorted({e["sequence"] for e in entries})
    views_per_source = len(entries) // (2 * len(events))
    report.add("image count and size", "pass" if not sizes_bad and len(entries) == 2 * len(events) * views_per_source else "fail",
               f"{len(entries)} JPEG views = {len(events)} events × 2 cameras × {views_per_source} view(s); wrong size/format: {len(sizes_bad)}")

    # --- 3. Timestamps and pairs ---------------------------------------------------------------------
    times_us, positions, rotations = read_poses(Path(manifest["source"]["poses"]))
    pose_sha_ok = sha256_file(Path(manifest["source"]["poses"])) == manifest["source"]["posesSha256"]
    per_event = defaultdict(dict)
    for e in entries:
        per_event[e["sequence"]].setdefault(e["channel"], e["timestampUs"])
    pair_dt = [abs(v["ch14"] - v["ch18"]) for v in per_event.values() if len(v) == 2]
    complete = sum(len(v) == 2 for v in per_event.values())
    event_times = [min(per_event[s].values()) for s in events]
    increasing = all(b > a for a, b in zip(event_times, event_times[1:]))
    in_range = all(times_us[0] <= e["timestampUs"] <= times_us[-1] for e in entries)
    source_bad = [e["source"]["image"] for e in entries[::views_per_source]
                  if sha256_file(run_dir / Path(e["source"]["image"]).name) != e["source"]["sha256"]]
    ok = complete == len(events) and max(pair_dt) <= 1000 and increasing and in_range and pose_sha_ok and not source_bad
    report.add("timestamps and camera pairs", "pass" if ok else "fail",
               f"{complete}/{len(events)} events with both cameras; pair Δt max {max(pair_dt)} µs (median {int(np.median(pair_dt))}); "
               f"event times strictly increasing: {increasing}; inside the pose range: {in_range}; poses.csv hash: {pose_sha_ok}; "
               f"source JPEG hashes: {len(entries) // views_per_source - len(source_bad)}/{len(entries) // views_per_source}")

    # --- 4. Orientation, handedness, positions -------------------------------------------------------
    det_err, ortho_err, pos_err, axis_dots, up_dots, rel = [], [], [], {"ch14": [], "ch18": []}, [], defaultdict(dict)
    for e in entries:
        im = ims_bin[e["imageId"]]
        r_c2w, centre, _ = camera_from_colmap(im, cams_bin[im.camera_id])
        det_err.append(abs(np.linalg.det(r_c2w) - 1))
        ortho_err.append(np.abs(r_c2w.T @ r_c2w - np.eye(3)).max())
        p, rb = interpolate(times_us, positions, rotations, e["timestampUs"])
        pos_err.append(float(np.linalg.norm(centre - (p + rb @ np.asarray(manifest["calibration"]["leverArmBodyM"])))))
        axis_body = rb.T @ r_c2w[:, 2]                         # optical axis in the scanner body frame
        axis_dots[e["channel"]].append(axis_body[1])           # body +Y = left
        up_dots.append(float(-r_c2w[:, 1] @ np.array([0, 0, 1.0])))  # image up · world up
        rel[e["sequence"]][e["channel"] + e["view"]] = rb.T @ r_c2w
    report.add("rotation matrices", "pass" if max(det_err) < 1e-9 and max(ortho_err) < 1e-9 else "fail",
               f"all proper rotations (max |det − 1| {max(det_err):.1e}, max orthonormality error {max(ortho_err):.1e}): right-handed OpenCV cameras")
    report.add("camera centres vs scanner trajectory", "pass" if max(pos_err) < 1e-3 else "fail",
               f"max distance from the independently interpolated scanner position (+ lever arm {manifest['calibration']['leverArmBodyM']}) "
               f"{max(pos_err) * 1000:.3f} mm")
    ch14_left, ch18_right = np.array(axis_dots["ch14"]), -np.array(axis_dots["ch18"])
    lateral_ok = ch14_left.min() > 0.9 and ch18_right.min() > 0.9
    report.add("camera directions on the scanner", "pass" if lateral_ok else "fail",
               f"ch14 looks to the scanner's left (axis·body+Y min {ch14_left.min():.3f}), ch18 to its right (min {ch18_right.min():.3f}), "
               "as calibrated (yaw ≈ ∓89°, views turned 12° forward)")
    up = np.array(up_dots)
    report.add("image up vs world up", "pass" if np.median(up) > 0.95 and up.min() > 0.5 else "fail",
               f"image-up · world +Z: median {np.median(up):.3f}, min {up.min():.3f} (no upside-down or sideways views)", values={"p5": float(np.percentile(up, 5))})
    rigid = [g.rotation_angle_deg(v["ch14c"].T @ v["ch18c"], next(iter(rel.values()))["ch14c"].T @ next(iter(rel.values()))["ch18c"])
             for v in rel.values() if "ch14c" in v and "ch18c" in v]
    between = [g.rotation_angle_deg(v["ch14c"], v["ch18c"]) for v in rel.values() if "ch14c" in v and "ch18c" in v]
    report.add("rigid two-camera rig", "pass" if max(rigid) < 1e-6 else "fail",
               f"ch14 ↔ ch18 relative rotation constant over all events (max deviation {max(rigid):.1e}°); angle between the two views {np.median(between):.1f}°")

    # --- 5. Projection vs hand-picked correspondences -----------------------------------------------
    records = json.loads(args.correspondences.read_text())["correspondences"]
    rows = []
    for r in records:
        e = next((x for x in entries if x["sequence"] == r["sequence"] and x["channel"] == r["channel"]), None)
        if e is None:
            continue
        im = ims_bin[e["imageId"]]
        cam = cams_bin[im.camera_id]
        r_c2w, centre, k = camera_from_colmap(im, cam)
        u, v, z = (float(a[0]) for a in g.project_pinhole(r["lidar"]["las"], r_c2w, centre, k))
        view = g.PinholeView(e["view"], e["viewYawDeg"], e["viewPitchDeg"], cam.width, cam.height,
                             math.degrees(2 * math.atan(cam.width / 2 / cam.params[0])))
        pu, pv, inside = g.fisheye_pixel_to_view(r["pixel"]["u"], r["pixel"]["v"], view, cal[r["channel"]]["model"])
        ray_pix = r_c2w @ np.linalg.solve(k, [pu, pv, 1.0])
        ray_lidar = np.asarray(r["lidar"]["las"], float) - centre
        angle_view = math.degrees(math.acos(np.clip(ray_pix @ ray_lidar / np.linalg.norm(ray_pix) / np.linalg.norm(ray_lidar), -1, 1)))
        predicted = cc.predict_record(r, cal[r["channel"]]["orientation"], cal[r["channel"]]["model"])
        angle_fisheye = predicted["errorPx"] / cal[r["channel"]]["model"]["focalPx"] if predicted["valid"] else None
        rows.append({"id": r["id"], "sequence": r["sequence"], "channel": r["channel"], "image": im.name,
                     "pixelInView": [round(pu, 2), round(pv, 2)], "insideView": bool(inside),
                     "lidarInView": [round(u, 2), round(v, 2)] if z > 0 else None,
                     "errorViewPx": round(math.hypot(u - pu, v - pv), 2) if z > 0 else None,
                     "angleDeg": round(angle_view, 4), "fisheyeErrorPx": None if not predicted["valid"] else round(predicted["errorPx"], 2),
                     "fisheyeErrorApproxDeg": None if angle_fisheye is None else round(math.degrees(angle_fisheye), 4)})
    inside_rows = [x for x in rows if x["insideView"]]
    report.add("projection vs correspondences", "pass" if rows else "warn",
               f"{len(rows)} hand-picked matches fall on dataset frames, {len(inside_rows)} inside the view; error in view pixels: median "
               f"{np.median([x['errorViewPx'] for x in inside_rows]):.1f}, max {max(x['errorViewPx'] for x in inside_rows):.1f} "
               f"(angular {np.median([x['angleDeg'] for x in inside_rows]):.2f}° median, matching the Stage B fisheye residuals)" if inside_rows else "none inside",
               records=rows)

    # --- 6. Pixels: view ↔ original fisheye through the written model ---------------------------------
    rng = np.random.default_rng(14)
    diffs, controls = [], []
    for name in [ims_bin[k].name for k in ids[:: max(1, len(ids) // 12)]]:
        e = by_name[name]
        im = ims_bin[e["imageId"]]
        cam = cams_bin[im.camera_id]
        r_c2w, centre, k = camera_from_colmap(im, cam)
        _, rb = interpolate(times_us, positions, rotations, e["timestampUs"])
        uu, vv = rng.uniform(20, cam.width - 20, 400), rng.uniform(20, cam.height - 20, 400)
        rays = (r_c2w @ np.linalg.solve(k, np.stack([uu, vv, np.ones_like(uu)]))).T      # world directions
        o = cal[e["channel"]]["orientation"]
        r_las_f = rb @ cc.offset_matrix(o["yawDeg"], o["pitchDeg"], o["rollDeg"])
        fu, fv, _ = cc.project_camera(rays @ r_las_f, cal[e["channel"]]["model"])
        fish = np.asarray(Image.open(run_dir / Path(e["source"]["image"]).name).convert("L").filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32)
        view = np.asarray(Image.open(root / "images" / name).convert("L"), dtype=np.float32)
        a = ndimage.map_coordinates(fish, [fv, fu], order=1)
        b = ndimage.map_coordinates(view, [vv, uu], order=1)
        c = ndimage.map_coordinates(view, [cam.height - 1 - vv, cam.width - 1 - uu], order=1)   # control: view rotated 180°
        diffs.append(float(np.abs(a - b).mean()))
        controls.append(float(np.abs(a - c).mean()))
    report.add("view pixels vs original fisheye", "pass" if max(diffs) < 6 and min(controls) > 2 * max(diffs) else "fail",
               f"mean |grey difference| at 400 random pixels of {len(diffs)} views, ray from the COLMAP file → fisheye: "
               f"{np.mean(diffs):.2f} (max {max(diffs):.2f}); same test with the view rotated 180°: {np.mean(controls):.1f}")

    # --- 7. LiDAR rendering vs photo (orientation), covisibility -------------------------------------
    meta = json.loads(args.cloud_metadata.read_text())
    raw = np.fromfile(args.cloud_bin, dtype=np.dtype([("p", "<f4", 3), ("rgb", "u1", 3)]))
    cloud = raw["p"].astype(np.float64) + np.asarray(meta["coordinateCenter"], float)
    cloud_grey = raw["rgb"].astype(np.float32).mean(axis=1)
    centres_all = np.array([camera_from_colmap(ims_bin[k], cams_bin[ims_bin[k].camera_id])[1] for k in ids])
    lo, hi = centres_all.min(0) - RENDER_RANGE_M, centres_all.max(0) + RENDER_RANGE_M
    box = np.all((cloud >= lo) & (cloud <= hi), axis=1)
    cloud, cloud_grey = cloud[box], cloud_grey[box]
    voxel_of = np.unique(np.floor(cloud / 0.2).astype(np.int64), axis=0, return_inverse=True)[1].ravel()
    ncc_rows, vis_rows, vis_cols = [], [], []
    flip = np.diag([-1.0, -1.0, 1.0])                      # control: camera rolled 180° about its axis
    for n, kid in enumerate(ids):
        im = ims_bin[kid]
        cam = cams_bin[im.camera_id]
        r_c2w, centre, k = camera_from_colmap(im, cam)
        near = np.abs(cloud - centre).max(axis=1) < RENDER_RANGE_M
        pts, grey = cloud[near], cloud_grey[near]
        scores = {}
        for label, rot in (("dataset", r_c2w), ("rolled180", r_c2w @ flip), ("otherCamera", None)):
            if rot is None:      # the other camera of the same event: looks the opposite way
                e = by_name[im.name]
                other = next(x for x in entries if x["sequence"] == e["sequence"] and x["channel"] != e["channel"] and x["view"] == e["view"])
                rot = camera_from_colmap(ims_bin[other["imageId"]], cam)[0]
            grid = render_ids(pts, rot, centre, k, cam.width, cam.height, RENDER_W, RENDER_H)
            rendered = np.where(grid >= 0, grey[np.maximum(grid, 0)], np.nan)
            scores[label] = ncc(rendered, greys[im.name])
            if label == "dataset":
                vis = np.unique(voxel_of[np.nonzero(near)[0][grid[grid >= 0]]])
                vis_rows.append(np.full(len(vis), n))
                vis_cols.append(vis)
                depth = float(np.median(np.linalg.norm(pts[grid[grid >= 0]] - centre, axis=1))) if (grid >= 0).any() else None
        ncc_rows.append({"image": im.name, "medianDepthM": None if depth is None else round(depth, 2),
                         **{key: None if s is None else round(s, 4) for key, s in scores.items()}})
    scored = [r for r in ncc_rows if r["dataset"] is not None]
    wins = sum(r["dataset"] > max(x for x in (r["rolled180"], r["otherCamera"]) if x is not None) for r in scored
               if any(x is not None for x in (r["rolled180"], r["otherCamera"])))
    report.add("LiDAR rendering vs photo", "pass" if wins >= 0.9 * len(scored) else ("warn" if wins >= 0.7 * len(scored) else "fail"),
               f"grey NCC at {RENDER_W}×{RENDER_H}: dataset poses {np.mean([r['dataset'] for r in scored]):.3f} mean; camera rolled 180° "
               f"{np.mean([r['rolled180'] for r in scored if r['rolled180'] is not None]):.3f}; other camera's direction "
               f"{np.mean([r['otherCamera'] for r in scored if r['otherCamera'] is not None]):.3f}; dataset pose best in {wins}/{len(scored)} views",
               views=ncc_rows)

    rows_ = np.concatenate(vis_rows)
    matrix = sparse.csr_matrix((np.ones(len(rows_), np.float32), (rows_, np.concatenate(vis_cols))), shape=(len(ids), int(voxel_of.max()) + 1))
    shared = (matrix @ matrix.T).toarray()
    own = np.diag(shared).copy()
    np.fill_diagonal(shared, 0)
    overlap = shared / np.maximum(own[:, None], 1)
    best = overlap.max(axis=1)
    partners = (overlap >= 0.3).sum(axis=1)
    seen = np.asarray((matrix > 0).sum(axis=0)).ravel()
    isolated = [ims_bin[ids[i]].name for i in np.nonzero(best < 0.2)[0]]
    report.add("covisibility", "pass" if len(isolated) <= 0.05 * len(ids) else "warn",
               f"per view, share of its visible 20 cm LiDAR voxels also seen by its best partner: median {np.median(best):.2f}; "
               f"views with ≥ 3 partners sharing ≥ 30 %: {(partners >= 3).sum()}/{len(ids)}; views with no partner ≥ 20 %: {len(isolated)}; "
               f"voxels seen by ≥ 3 views: {(seen >= 3).sum():,} of {(seen >= 1).sum():,} seen at all",
               isolated=isolated)

    # --- 8. Image quality, duplicates, pose continuity ------------------------------------------------
    depths = {r["image"]: r["medianDepthM"] for r in ncc_rows}
    close = sorted(n for n, d in depths.items() if d is not None and d < 1.5)
    known = np.array([d for d in depths.values() if d is not None])
    report.add("scene depth", "pass" if len(close) <= 0.1 * len(ids) else "warn",
               f"median LiDAR depth per view: median {np.median(known):.1f} m (5th pct {np.percentile(known, 5):.1f}); "
               f"views with median depth < 1.5 m (most sensitive to the unknown lever arm): {len(close)}", close=close)
    sharp = np.array([quality[ims_bin[k].name]["sharpness"] for k in ids])
    blurry = [ims_bin[k].name for k, s in zip(ids, sharp) if s < np.median(sharp) / 3]
    selection = json.loads(Path(manifest["source"]["selection"]).read_text())
    rate = {e["sequence"]: e["turnRateDegS"] for e in selection["events"]}
    rates = np.array([rate[by_name[ims_bin[k].name]["sequence"]] for k in ids])
    order_s, order_r = np.argsort(np.argsort(sharp)), np.argsort(np.argsort(rates))
    spearman = float(np.corrcoef(order_s, order_r)[0, 1])
    low_close = sum(depths.get(n) is not None and depths[n] < 1.5 for n in blurry)
    report.add("sharpness", "pass" if len(blurry) <= 0.05 * len(ids) else "warn",
               f"Laplacian variance (800×600 grey): median {np.median(sharp):.0f}, 5th percentile {np.percentile(sharp, 5):.0f}; "
               f"views below a third of the median: {len(blurry)} ({low_close} of them face surfaces < 1.5 m away); rank correlation "
               f"with the scanner turn rate {spearman:+.2f} (near 0: low scores come from plain surfaces, not motion blur)",
               lowDetail=blurry, turnRateRankCorrelation=round(spearman, 3))
    exposure = [n for n, q in quality.items() if q["clipped"] > 0.25 or q["dark"] > 0.5]
    report.add("exposure", "pass" if not exposure else "warn",
               f"views with > 25 % clipped or > 50 % near-black pixels: {len(exposure)}; mean brightness "
               f"{np.percentile([q['mean'] for q in quality.values()], 5):.0f}–{np.percentile([q['mean'] for q in quality.values()], 95):.0f} (5th–95th pct)",
               flagged=exposure)
    dupes, steps, turns = [], [], []
    for ch in ("ch14", "ch18"):
        mine = sorted((e for e in entries if e["channel"] == ch and e["view"] == entries[0]["view"]), key=lambda e: e["timestampUs"])
        for a, b in zip(mine, mine[1:]):
            ra, rb_ = np.array(a["cameraToWorldOpenCV"])[:3, :3], np.array(b["cameraToWorldOpenCV"])[:3, :3]
            step = float(np.linalg.norm(np.array(b["cameraToWorldOpenCV"])[:3, 3] - np.array(a["cameraToWorldOpenCV"])[:3, 3]))
            turn = g.rotation_angle_deg(ra, rb_)
            diff = float(np.abs(greys[Path(a["file"]).name] - greys[Path(b["file"]).name]).mean())
            if ch == "ch14":
                steps.append(step)
                turns.append(turn)
            if step < 0.3 and turn < 10 and diff < 6:
                dupes.append([Path(a["file"]).name, Path(b["file"]).name, round(step, 3), round(turn, 2), round(diff, 2)])
    report.add("near-duplicates", "pass" if not dupes else "warn",
               f"consecutive views of one camera that moved < 0.3 m, turned < 10° and look alike: {len(dupes)}", pairs=dupes)
    steps_a, turns_a = np.array(steps), np.array(turns)
    # A sharp turn is harmless when the OTHER camera of the next event looks where this one looked.
    axes = defaultdict(dict)
    for e in entries:
        axes[e["sequence"]][e["channel"]] = np.array(e["cameraToWorldOpenCV"])[:3, 2]
    uncovered = 0
    for a, b in zip(events, events[1:]):
        for ch in ("ch14", "ch18"):
            best_angle = min(math.degrees(math.acos(np.clip(axes[a][ch] @ axes[b][other], -1, 1))) for other in ("ch14", "ch18"))
            uncovered += best_angle > 60
    far = int((steps_a > 5).sum())
    sharp_turns = int((turns_a > 90).sum())
    report.add("pose continuity", "pass" if far == 0 and uncovered == 0 else "warn",
               f"between consecutive events: step median {np.median(steps_a):.2f} m (max {steps_a.max():.2f}), turn median "
               f"{np.median(turns_a):.1f}° (max {turns_a.max():.1f}); steps > 5 m: {far}; turns > 90°: {sharp_turns}, "
               f"camera directions not continued by either camera of the next event (> 60°): {uncovered}")
    extent = centres_all.max(0) - centres_all.min(0)
    report.add("spatial coverage", "info",
               f"camera centres span {extent[0]:.1f} × {extent[1]:.1f} × {extent[2]:.1f} m (LAS x, y, z); path {steps_a.sum():.0f} m")

    # --- 9. Visual checks ---------------------------------------------------------------------------
    checks_dir.mkdir()
    scale = 20.0
    lo2, hi2 = centres_all[:, :2].min(0) - 12, centres_all[:, :2].max(0) + 12
    w, h = (int((hi2[0] - lo2[0]) * scale), int((hi2[1] - lo2[1]) * scale))
    zc = float(np.median(centres_all[:, 2]))
    sl = (cloud[:, 2] > zc - 0.3) & (cloud[:, 2] < zc + 1.2)
    px = ((cloud[sl, 0] - lo2[0]) * scale).astype(int)
    py = (h - 1 - (cloud[sl, 1] - lo2[1]) * scale).astype(int)
    keep = (px >= 0) & (px < w) & (py >= 0) & (py < h)
    counts = np.zeros((h, w))
    np.add.at(counts, (py[keep], px[keep]), 1)
    base = np.full((h, w), 255, np.uint8)
    base[counts > 0], base[counts > 3] = 170, 90
    top = Image.fromarray(base).convert("RGB")
    draw = ImageDraw.Draw(top)

    def to_px(p):
        return (p[0] - lo2[0]) * scale, h - 1 - (p[1] - lo2[1]) * scale

    colours = {"ch14": (220, 40, 40), "ch18": (30, 90, 220)}
    for e in entries:
        c2w = np.array(e["cameraToWorldOpenCV"])
        c, axis = c2w[:3, 3], c2w[:3, 2]
        half = math.radians(55)
        for sgn in (-1, 1):
            edge = c2w[:3, :3] @ np.array([sgn * math.tan(half), 0, 1.0])
            edge = edge / max(np.linalg.norm(edge[:2]), 1e-6)
            draw.line([to_px(c), to_px(c + 1.2 * edge)], fill=colours[e["channel"]], width=1)
        draw.line([to_px(c), to_px(c + 2.0 * axis / max(np.linalg.norm(axis[:2]), 1e-6))], fill=colours[e["channel"]], width=2)
        x, y = to_px(c)
        draw.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(0, 0, 0) if e["split"] == "train" else (250, 170, 0))
    for r in rows:
        e = by_name[r["image"]]
        x, y = to_px(np.array(e["cameraToWorldOpenCV"])[:3, 3])
        draw.ellipse([x - 7, y - 7, x + 7, y + 7], outline=(0, 160, 0), width=2)
    draw.rectangle([5, 5, 430, 70], fill=(255, 255, 255), outline=(0, 0, 0))
    draw.text((12, 10), "Lab 14A camera views over a LiDAR slice (top-down, LAS x right, y up)", fill=(0, 0, 0))
    draw.text((12, 26), "red = ch14 view, blue = ch18 view: axis 2 m, 110° field edges", fill=(0, 0, 0))
    draw.text((12, 42), "black dot = training view, orange dot = held-out view", fill=(0, 0, 0))
    draw.text((12, 56), "green ring = event with a hand-picked correspondence; 20 px = 1 m", fill=(0, 0, 0))
    top.save(checks_dir / "topdown-cameras.png")

    samples = sorted({r["image"] for r in rows if r["insideView"]})[: args.samples // 2]
    samples += [ims_bin[k].name for k in ids[:: max(1, len(ids) // (args.samples - len(samples)))]][: args.samples - len(samples)]
    (checks_dir / "reprojection").mkdir()
    for name in samples:
        e = by_name[name]
        im = ims_bin[e["imageId"]]
        cam = cams_bin[im.camera_id]
        r_c2w, centre, k = camera_from_colmap(im, cam)
        near = np.abs(cloud - centre).max(axis=1) < RENDER_RANGE_M
        pts = cloud[near]
        rgb_pts = raw["rgb"][box][near]
        grid = render_ids(pts, r_c2w, centre, k, cam.width, cam.height, cam.width // 4, cam.height // 4)
        lidar = np.where(grid[..., None] >= 0, rgb_pts[np.maximum(grid, 0)], 0).astype(np.uint8)
        photo = Image.open(root / "images" / name).convert("RGB").resize((cam.width // 4, cam.height // 4), Image.BOX)
        edges = np.asarray(photo.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32)
        overlay = np.asarray(Image.fromarray(lidar), dtype=np.float32) * 0.6
        overlay[edges > 40] = [255, 255, 0]
        panel = Image.new("RGB", (cam.width // 2, cam.height // 4 + 18), "white")
        panel.paste(photo, (0, 18))
        panel.paste(Image.fromarray(overlay.astype(np.uint8)), (cam.width // 4, 18))
        d = ImageDraw.Draw(panel)
        d.text((4, 3), f"{name}: photo view | LiDAR rendered through the dataset camera + photo edges (yellow)", fill=(0, 0, 0))
        for r in rows:
            if r["image"] == name and r["insideView"]:
                for off in (0, cam.width // 4):
                    x, y = r["pixelInView"][0] / 4 + off, r["pixelInView"][1] / 4 + 18
                    d.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(0, 255, 0), width=2)
                    if r["lidarInView"]:
                        lx, ly = r["lidarInView"][0] / 4 + off, r["lidarInView"][1] / 4 + 18
                        d.line([lx - 5, ly, lx + 5, ly], fill=(255, 0, 0), width=2)
                        d.line([lx, ly - 5, lx, ly + 5], fill=(255, 0, 0), width=2)
        panel.save(checks_dir / "reprojection" / name.replace(".jpg", ".png"))

    thumbs = [ims_bin[k].name for k in ids]
    cols = 16
    sheet = Image.new("RGB", (cols * 100, math.ceil(len(thumbs) / cols) * 75), "white")
    for i, name in enumerate(thumbs):
        sheet.paste(Image.open(root / "images" / name).resize((100, 75), Image.BOX), ((i % cols) * 100, (i // cols) * 75))
    sheet.save(checks_dir / "contact-sheet.jpg", quality=85)

    failed = [c["check"] for c in report.checks if c["status"] == "fail"]
    warned = [c["check"] for c in report.checks if c["status"] == "warn"]
    result = {"schema": "spatial-lab/xgrids-splat-validation", "version": 1, "dataset": str(root),
              "verdict": "fail" if failed else ("pass with warnings" if warned else "pass"),
              "failed": failed, "warnings": warned, "checks": report.checks,
              "files": ["topdown-cameras.png", "reprojection/*.png", "contact-sheet.jpg"]}
    with open(checks_dir / "validation.json", "x") as f:
        json.dump(result, f, indent=1)
        f.write("\n")
    print(f"Verdict: {result['verdict']}; wrote {checks_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
