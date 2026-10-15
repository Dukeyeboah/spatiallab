#!/usr/bin/env python3
"""
Lab 14A: build a Gaussian splatting training dataset (COLMAP layout, PINHOLE
views) from an extract_frames.py run, the scanner poses it recorded and an
EXPERIMENTAL calibration. Writes nothing inside the repository and never
overwrites: --out must not exist.

    backend/.venv/bin/python scripts/xgrids/prepare_splat_dataset.py \
        --run RECON/xgrids/images/lab14a-5s --selection RECON/training/lab14a/selection-5s.json \
        --experiment RECON/xgrids/calibration/experiments/13w/reviewed-2026-10-15/experiment-x_c69aede71834.json \
        --cloud-bin public/datasets/basel-house/basel-preview-5m.bin \
        --cloud-metadata public/datasets/basel-house/basel-preview-5m-metadata.json \
        --out RECON/training/lab14a/basel-5s-forward12

Output
    images/seq01393_ch14_c.jpg   perspective views resampled from the fisheye frames
    sparse/0/                    COLMAP model (.txt and .bin): PINHOLE camera, image poses, LiDAR points
    sparse/poses-only/           the same cameras and poses without points (other initialisations)
    lidar_init.ply               the same LiDAR points as a PLY
    manifest.json                provenance of every view, conventions, assumptions, split
    SHA256SUMS

Geometry: scripts/xgrids/splat_geometry.py. Coordinates stay in the original LAS frame.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import splat_colmap as colmap  # noqa: E402
import splat_geometry as g  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA = "spatial-lab/xgrids-splat-dataset"
VERSION = 1
CAMERAS = ("ch14", "ch18")

ASSUMPTIONS = [
    "Camera rotations and the equidistant focal parameter are EXPERIMENTAL estimates (Stage B of the calibration experiment named in "
    "'calibration'), not a manufacturer or verified calibration.",
    "Principal point assumed at the image centre (1999.5, 1449.5); no distortion beyond the equidistant model.",
    "Lever arm (camera-to-scanner translation) assumed ZERO: every camera centre is the scanner position. The real lenses sit some "
    "centimetres from the pose reference point, so views carry a position error of that size.",
    "Camera and pose clocks assumed identical (no time offset); poses are interpolated at each image's own timestamp "
    "(XYZ linear, quaternion SLERP, by extract_frames.py). Rolling shutter is ignored.",
    "Views are perspective re-projections of the fisheye photos about the SAME optical centre; no view is a new physical viewpoint.",
    "Initial points are LiDAR samples (the 5 M-point preview of the LAS, cropped and thinned); they only initialise Gaussians.",
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load_preview_cloud(bin_path: Path, metadata_path: Path) -> tuple[np.ndarray, np.ndarray]:
    meta = json.loads(metadata_path.read_text())
    raw = np.fromfile(bin_path, dtype=np.dtype([("p", "<f4", 3), ("rgb", "u1", 3)]))
    return raw["p"].astype(np.float64) + np.asarray(meta["coordinateCenter"], float), raw["rgb"].copy()


def init_points(xyz: np.ndarray, rgb: np.ndarray, centres: np.ndarray, radius: float, voxel: float, max_points: int,
                min_neighbours: int, seed: int = 14) -> tuple[np.ndarray, np.ndarray, dict]:
    """Crop to `radius` m of any camera centre, average per voxel, drop isolated voxels, cap the count."""
    stats = {"input": len(xyz)}
    distance, _ = cKDTree(centres).query(xyz, distance_upper_bound=radius)
    keep = np.isfinite(distance)
    xyz, rgb = xyz[keep], rgb[keep]
    stats["withinRadius"] = len(xyz)
    keys = np.floor(xyz / voxel).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.ravel()
    sums = np.zeros((len(counts), 3))
    np.add.at(sums, inverse, xyz)
    colours = np.zeros((len(counts), 3))
    np.add.at(colours, inverse, rgb.astype(float))
    xyz, rgb = sums / counts[:, None], np.round(colours / counts[:, None]).astype(np.uint8)
    stats["voxels"] = len(xyz)
    if min_neighbours > 0:
        n = cKDTree(xyz).query_ball_point(xyz, r=4 * voxel, return_length=True) - 1
        xyz, rgb = xyz[n >= min_neighbours], rgb[n >= min_neighbours]
    stats["afterIsolatedRemoval"] = len(xyz)
    if len(xyz) > max_points:
        pick = np.sort(np.random.default_rng(seed).choice(len(xyz), max_points, replace=False))
        xyz, rgb = xyz[pick], rgb[pick]
    stats["output"] = len(xyz)
    return xyz, rgb, stats


def resample(job: tuple) -> dict:
    """One fisheye JPEG → one perspective JPEG (bilinear after a light anti-alias blur)."""
    source, target, view, model, blur, quality = job
    u, v, valid = g.view_source_map(view, model)
    image = Image.open(source).convert("RGB")
    if blur > 0:
        image = image.filter(ImageFilter.GaussianBlur(blur))
    array = np.asarray(image, dtype=np.float32)
    out = np.stack([ndimage.map_coordinates(array[:, :, c], [v, u], order=1, mode="nearest") for c in range(3)], axis=-1)
    out[~valid] = 0
    Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8)).save(target, quality=quality, subsampling=0)
    masked = int((~valid).sum())
    if masked:
        # Nerfstudio's masks_path: same name, .png; white = use, black = ignore.
        mask_path = target.parent.parent / "masks" / (target.stem + ".png")
        Image.fromarray(np.where(valid, 255, 0).astype(np.uint8)).save(mask_path)
    return {"file": target.name, "bytes": target.stat().st_size, "maskedPixels": masked}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", type=Path, required=True, help="extract_frames.py output folder (manifest.csv)")
    parser.add_argument("--selection", type=Path, required=True, help="select_splat_frames.py JSON the run was extracted from")
    parser.add_argument("--experiment", type=Path, required=True, help="calibration experiment JSON (read only)")
    parser.add_argument("--parameter-set", default="stageB")
    parser.add_argument("--layout", default="forward12", choices=sorted(g.LAYOUTS))
    parser.add_argument("--lever-arm", default="0,0,0", help="camera centre offset in the scanner body frame, metres (ASSUMED 0)")
    parser.add_argument("--cloud-bin", type=Path, required=True)
    parser.add_argument("--cloud-metadata", type=Path, required=True)
    parser.add_argument("--cloud-radius", type=float, default=25.0, help="keep LiDAR points within this many metres of a camera")
    parser.add_argument("--voxel", type=float, default=0.05, help="metres")
    parser.add_argument("--max-points", type=int, default=1_000_000)
    parser.add_argument("--min-neighbours", type=int, default=2, help="drop voxels with fewer neighbours within 4 voxels")
    parser.add_argument("--blur", type=float, default=0.8, help="Gaussian blur radius (source px) before resampling")
    parser.add_argument("--jpeg-quality", type=int, default=95)
    parser.add_argument("--eval-interval", type=int, default=9,
                        help="held-out views: image index %% N == 0 in image-id order, as Nerfstudio's 'interval' split")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    out = args.out.resolve()
    if out.is_relative_to(REPO_ROOT):
        parser.error("--out must be outside the repository")
    if out.exists():
        parser.error(f"{out} exists; datasets are never overwritten")
    lever = tuple(float(x) for x in args.lever_arm.split(","))
    if len(lever) != 3:
        parser.error("--lever-arm needs three numbers")

    experiment = json.loads(args.experiment.read_text())
    cameras_cal = experiment["parameterSets"][args.parameter_set]["cameras"]
    selection = json.loads(args.selection.read_text())
    with open(args.run / "manifest.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    extraction = json.loads((args.run / "extraction-summary.json").read_text())

    # The run must be exactly the selection, decoded without problems, with both cameras per event.
    wanted = [int(s) for s in selection["sequences"].split(",")]
    got = sorted({int(r["sequence"]) for r in rows})
    if got != sorted(wanted):
        raise SystemExit(f"error: run sequences differ from the selection ({len(got)} vs {len(wanted)})")
    bad = [r["image_file"] for r in rows if r["decoder_status"] != "ok" or r["pose_status"] != "interpolated"]
    if bad:
        raise SystemExit(f"error: images not decoded cleanly or without pose: {bad[:5]}")
    if extraction["source"]["posesSha256"] != selection["source"]["posesSha256"]:
        raise SystemExit("error: the run and the selection used different poses.csv files")
    rows.sort(key=lambda r: (int(r["event_index"]), CAMERAS.index(r["camera_channel"])))

    views = {ch: g.views_for_camera(args.layout, cameras_cal[ch]["orientation"]) for ch in CAMERAS}
    # One COLMAP camera per view shape (same for both channels: the virtual pinhole is ours, not the fisheye's).
    shapes = {}
    for vs in views.values():
        for v in vs:
            shapes.setdefault((v.width, v.height, round(v.focal_px, 9)), len(shapes) + 1)

    out.mkdir(parents=True)
    (out / "images").mkdir()
    needs_masks = any(not g.view_source_map(v, cameras_cal[ch]["model"])[2].all() for ch in CAMERAS for v in views[ch])
    if needs_masks:
        (out / "masks").mkdir()
    images, entries, jobs = [], [], []
    for row in rows:
        ch = row["camera_channel"]
        model = cameras_cal[ch]["model"]
        position = [float(row[f"scanner_{a}"]) for a in "xyz"]
        quaternion = [float(row[f"scanner_q{a}"]) for a in "xyzw"]
        for view in views[ch]:
            name = f"seq{int(row['sequence']):05d}_{ch}_{view.name}.jpg"
            rotation, centre = g.camera_to_world(position, quaternion, cameras_cal[ch]["orientation"], view, lever)
            qvec, tvec = g.world_to_colmap(rotation, centre)
            image_id = len(images) + 1
            camera_id = shapes[(view.width, view.height, round(view.focal_px, 9))]
            images.append(colmap.Image(image_id, tuple(qvec), tuple(tvec), camera_id, name))
            c2w = np.eye(4)
            c2w[:3, :3], c2w[:3, 3] = rotation, centre
            entries.append({
                "file": f"images/{name}", "imageId": image_id, "cameraId": camera_id,
                "split": "eval" if (image_id - 1) % args.eval_interval == 0 else "train",
                "sequence": int(row["sequence"]), "pairId": int(row["pair_id"]), "channel": ch, "view": view.name,
                "viewYawDeg": view.yaw_deg, "viewPitchDeg": view.pitch_deg,
                "timestampUs": int(row["timestamp_us"]), "timestampUtc": row["timestamp_utc"],
                "source": {"image": f"{args.run.name}/{row['image_file']}", "sha256": row["jpeg_sha256"],
                           "spsOffset": int(row["sps_offset"]), "messageOffset": int(row["message_offset"]),
                           "h264Bytes": int(row["h264_bytes"])},
                "scannerPose": {"position": position, "quaternionXyzw": quaternion, "beforeUs": int(row["pose_before_us"]),
                                "afterUs": int(row["pose_after_us"]), "alpha": float(row["pose_alpha"])},
                "cameraToWorldOpenCV": [[round(x, 12) for x in r] for r in c2w.tolist()],
                "colmap": {"qvec": [round(x, 12) for x in qvec], "tvec": [round(x, 12) for x in tvec]},
            })
            jobs.append((args.run / row["image_file"], out / "images" / name, view, model, args.blur, args.jpeg_quality))

    started = time.monotonic()
    print(f"Resampling {len(jobs)} views with {args.workers} workers …", flush=True)
    with ProcessPoolExecutor(args.workers) as pool:
        written = list(pool.map(resample, jobs, chunksize=4))
    resample_s = time.monotonic() - started

    centres = np.array([e["cameraToWorldOpenCV"] for e in entries])[:, :3, 3]
    cloud_xyz, cloud_rgb = load_preview_cloud(args.cloud_bin, args.cloud_metadata)
    xyz, rgb, point_stats = init_points(cloud_xyz, cloud_rgb, centres, args.cloud_radius, args.voxel, args.max_points, args.min_neighbours)

    cameras = [colmap.Camera(cid, w, h, (f, f, w / 2, h / 2)) for (w, h, f), cid in shapes.items()]
    # (w/2, h/2) is the OpenCV centre (w−1)/2 + 0.5: COLMAP's corner-origin convention.
    colmap.write_model(out / "sparse" / "0", cameras, images, xyz, rgb)
    colmap.write_model(out / "sparse" / "poses-only", cameras, images, np.zeros((0, 3)), np.zeros((0, 3), np.uint8))
    colmap.write_ply(out / "lidar_init.ply", xyz, rgb)

    def max_source_radius(view: g.PinholeView, model: dict) -> float:
        u, v, _ = g.view_source_map(view, model)
        return round(float(np.hypot(u - model["cx"], v - model["cy"]).max()), 1)

    view_info = {ch: [{"name": v.name, "yawDeg": v.yaw_deg, "pitchDeg": v.pitch_deg, "width": v.width, "height": v.height,
                       "hfovDeg": v.hfov_deg, "vfovDeg": round(v.vfov_deg, 4), "focalPx": round(v.focal_px, 6),
                       "maxSourceRadiusPx": max_source_radius(v, cameras_cal[ch]["model"])}
                      for v in views[ch]] for ch in CAMERAS}
    masked = {w["file"]: w["maskedPixels"] for w in written if w["maskedPixels"]}
    for e in entries:
        name = Path(e["file"]).name
        e["mask"] = f"masks/{Path(name).stem}.png" if name in masked else None
    manifest = {
        "schema": SCHEMA, "version": VERSION, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "masks": ("masks/ marks view pixels outside the usable fisheye circle; pass "
                  "--masks-path masks to Nerfstudio's colmap dataparser") if masked else None,
        "status": "experimental training dataset (Lab 14A); not trained",
        "trainer": {"intended": "Nerfstudio 1.1.5 splatfacto (COLMAP dataparser); any COLMAP-PINHOLE trainer",
                    "evalMode": "interval", "evalInterval": args.eval_interval},
        "source": {"run": str(args.run.resolve()), "extractionSummarySha256": sha256_file(args.run / "extraction-summary.json"),
                   "manifestSha256": sha256_file(args.run / "manifest.csv"), "xbin": extraction["source"]["xbin"],
                   "poses": extraction["source"]["poses"], "posesSha256": extraction["source"]["posesSha256"],
                   "framesSha256": extraction["source"]["framesSha256"],
                   "selection": str(args.selection.resolve()), "selectionSha256": sha256_file(args.selection)},
        "calibration": {"experimentId": experiment.get("experimentId"), "file": str(args.experiment.resolve()),
                        "sha256": sha256_file(args.experiment), "parameterSet": args.parameter_set,
                        "status": "experimental estimate", "cameras": cameras_cal, "leverArmBodyM": list(lever),
                        "leverArmStatus": "assumed (unknown)" if lever == (0.0, 0.0, 0.0) else "user supplied"},
        "conventions": {
            "world": "original LAS coordinates (metres, Z up); no global transform applied",
            "scannerPose": "v_las = R(q)·v_body + p, q = (x, y, z, w); body X forward, Y left, Z up",
            "fisheyeFrame": "X = optical axis, Y = image left, Z = image up; v_body = R_off·v_F, R_off = Rz(−yaw)·Ry(−pitch)·Rx(roll)",
            "R_F_CV": g.R_F_CV.tolist(),
            "viewRotation": "R_cv_view = Ry(viewYaw)·Rx(viewPitch) in the fisheye's OpenCV frame (yaw + = image right, pitch + = up)",
            "cameraToWorldOpenCV": "[R(q)·R_off·R_F_CV·R_cv_view | p + R(q)·leverArm]; camera x right, y down, z forward",
            "colmap": "qvec (w, x, y, z) and tvec of world→camera; PINHOLE cx, cy in COLMAP's corner-origin pixels (OpenCV + 0.5)",
            "fisheyeLens": "equidistant r = f·θ about (cx, cy) in OpenCV pixels; usable radius 1400 px",
        },
        "assumptions": ASSUMPTIONS,
        "layout": {"name": args.layout, "views": view_info,
                   "resampling": f"Gaussian blur radius {args.blur} px on the fisheye, then bilinear; JPEG q{args.jpeg_quality} 4:4:4"},
        "pointCloud": {"source": str(args.cloud_bin.resolve()), "sourceSha256": sha256_file(args.cloud_bin),
                       "sourceLas": json.loads(args.cloud_metadata.read_text()).get("source"),
                       "radiusM": args.cloud_radius, "voxelM": args.voxel, "minNeighbours": args.min_neighbours,
                       "maxPoints": args.max_points, "counts": point_stats,
                       "files": ["sparse/0/points3D.bin", "sparse/0/points3D.txt", "lidar_init.ply"],
                       "alternatives": "sparse/poses-only has no points: random initialisation, or COLMAP point_triangulator with fixed poses"},
        "counts": {"events": len({e["sequence"] for e in entries}), "sourceImages": len(rows), "views": len(entries),
                   "train": sum(e["split"] == "train" for e in entries), "eval": sum(e["split"] == "eval" for e in entries)},
        "timings": {"resampleSeconds": round(resample_s, 1)},
        "images": entries,
    }
    with open(out / "manifest.json", "x") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")
    files = sorted(p for p in out.rglob("*") if p.is_file())
    with open(out / "SHA256SUMS", "x") as f:
        f.writelines(f"{sha256_file(p)}  {p.relative_to(out)}\n" for p in files)

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"Views {len(entries)} ({manifest['counts']['train']} train / {manifest['counts']['eval']} eval) in {resample_s:.0f} s; "
          f"points {point_stats}; images {sum(w['bytes'] for w in written) / 1e6:.0f} MB; dataset {size / 1e6:.0f} MB → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
