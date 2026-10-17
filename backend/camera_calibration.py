"""
Lab 13V: experimental camera calibration from Lab 13U image ↔ LiDAR correspondences.

EXPERIMENTAL. Nothing here is a production-verified calibration: the camera
centre is the scanner position (lever arm unknown), the lens model is a
single-parameter equidistant fisheye, and the input is a few manually picked
points. Results must be judged by held-out events, not by training error.

Conventions (docs/xgrids/provisional-camera-directions.json, unchanged):
- scanner pose: v_las = R(q) · v_body, q = (x, y, z, w), body X forward, Y left, Z up;
- provisional camera frame: X = optical axis, Y = image left, Z = image up;
- v_body = R_off · v_cam, R_off = Rz(−yaw) · Ry(−pitch) · Rx(roll) (degrees,
  yaw + = right, pitch + = up, roll + = clockwise seen from behind);
- so R_las_camera = R(q) · R_off, camera centre = scanner position + R(q) · lever_arm (0);
- equidistant fisheye: θ = angle from the optical axis, r = f · θ,
  u = cx + r · (−y / s), v = cy + r · (−z / s), s = √(y² + z²);
- pixels: OpenCV, u right, v down, (0, 0) = centre of the top-left pixel.

Pure NumPy/SciPy; no file or network access (the CLI and the API do that).
"""

from __future__ import annotations

import hashlib
import json
import math
import platform
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

import numpy as np
import scipy
from scipy.optimize import least_squares

MODULE_VERSION = "13W.1"
CORRESPONDENCE_SCHEMA = "spatial-lab/xgrids-correspondences"
CORRESPONDENCE_VERSION = 1
EXPERIMENT_SCHEMA = "spatial-lab/xgrids-calibration-experiment"
EXPERIMENT_VERSION = 1
MAX_INPUT_BYTES = 5 * 1024 * 1024

# Lab 13U defaults: assumptions, not manufacturer or calibrated values.
PROVISIONAL_MODEL = {"model": "equidistant", "focalPx": 750.0, "cx": 1999.5, "cy": 1449.5, "validRadiusPx": 1400.0}
PROVISIONAL_ORIENTATIONS = {
    "ch14": {"yawDeg": -90.0, "pitchDeg": 0.0, "rollDeg": 0.0},
    "ch18": {"yawDeg": 90.0, "pitchDeg": 0.0, "rollDeg": 0.0},
}

CONVENTIONS = {
    "reference": "docs/xgrids/provisional-camera-directions.json (unchanged)",
    "scannerPose": "v_las = R(q) · v_body, q = (x, y, z, w); body X forward, Y left, Z up",
    "cameraFrame": "X = optical axis, Y = image left, Z = image up (not the OpenCV camera frame)",
    "extrinsicRotation": "R_las_camera = R(q_scanner) · R_off, R_off = Rz(−yaw)·Ry(−pitch)·Rx(roll), degrees; yaw + = right, pitch + = up, roll + = clockwise from behind",
    "cameraCentre": "scanner position; camera-to-scanner translation (lever arm) NOT calibrated, assumed 0",
    "lens": "equidistant fisheye r = f·θ; u = cx + r·(−y/s), v = cy + r·(−z/s), s = √(y² + z²)",
    "pixel": "original image pixels; u right, v down; (0, 0) = centre of the top-left pixel (OpenCV)",
    "lidar": "original LAS coordinates, metres",
}

# Keywords in the feature text that suggest an object that may move or deform.
# Lab 13W review fields on records (same values as lib/correspondences.ts).
REVIEW_STATUSES = ("unreviewed", "verified", "approximate", "needs-fix", "held-out", "rejected")
SCENES = ("courtyard", "corridor", "indoor", "exterior", "other")
MAX_HISTORY = 100
MOVABLE_PATTERN = re.compile(r"\b(vehicle|car|truck|van|bus|bike|person|people|man|woman|curtain|cloth|flag|leaf|leaves|palm|plant|tree|branch|brank|stem|bush)\b", re.I)


class CalibrationInputError(ValueError):
    """The correspondence file can't be used (wrong schema, dataset or pose hash)."""


# --- Rotations and projection -------------------------------------------------


def quaternion_matrix(q_xyzw) -> np.ndarray:
    """Rotation matrix of a (x, y, z, w) quaternion, normalised; maps body → LAS."""
    x, y, z, w = np.asarray(q_xyzw, dtype=float) / np.linalg.norm(q_xyzw)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def offset_matrix(yaw_deg: float, pitch_deg: float, roll_deg: float) -> np.ndarray:
    """R_off = Rz(−yaw) · Ry(−pitch) · Rx(roll): camera frame → scanner body frame."""
    a, b, g = np.radians([-yaw_deg, -pitch_deg, roll_deg])
    rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    rx = np.array([[1, 0, 0], [0, math.cos(g), -math.sin(g)], [0, math.sin(g), math.cos(g)]])
    return rz @ ry @ rx


def to_camera(points_las, position, quaternion, orientation: dict, lever_arm_body=(0.0, 0.0, 0.0)) -> np.ndarray:
    """LAS points (N × 3) → provisional camera frame. Subtracts in float64 before rotating."""
    rb = quaternion_matrix(quaternion)
    r_las_camera = rb @ offset_matrix(orientation["yawDeg"], orientation["pitchDeg"], orientation["rollDeg"])
    centre = np.asarray(position, dtype=float) + rb @ np.asarray(lever_arm_body, dtype=float)
    return (np.atleast_2d(np.asarray(points_las, dtype=float)) - centre) @ r_las_camera


def project_camera(v_cam: np.ndarray, model: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Equidistant projection of camera-frame vectors: (u, v, θ in radians). No validity test."""
    x, y, z = v_cam[:, 0], v_cam[:, 1], v_cam[:, 2]
    s = np.hypot(y, z)
    theta = np.arctan2(s, x)
    r = model["focalPx"] * theta
    safe = np.where(s > 0, s, 1.0)
    u = model["cx"] + np.where(s > 0, r * -y / safe, 0.0)
    v = model["cy"] + np.where(s > 0, r * -z / safe, 0.0)
    return u, v, theta


def is_valid_projection(u, v, theta, model: dict) -> np.ndarray:
    """Valid = in front of the lens (θ < 180°) and within the usable image radius."""
    radius = np.hypot(np.asarray(u) - model["cx"], np.asarray(v) - model["cy"])
    return (np.asarray(theta) < math.pi - 1e-9) & (radius <= model["validRadiusPx"])


def pixel_ray_camera(u: float, v: float, model: dict) -> np.ndarray:
    """Inverse projection: unit camera-frame direction of pixel (u, v)."""
    du, dv = u - model["cx"], v - model["cy"]
    r = math.hypot(du, dv)
    if r == 0:
        return np.array([1.0, 0.0, 0.0])
    theta = r / model["focalPx"]
    return np.array([math.cos(theta), -math.sin(theta) * du / r, -math.sin(theta) * dv / r])


def predict_record(record: dict, orientation: dict, model: dict, lever_arm_body=(0.0, 0.0, 0.0)) -> dict:
    """Predicted pixel of a record's LiDAR point; error only when the projection is valid."""
    pose = record["scannerPose"]
    v_cam = to_camera(record["lidar"]["las"], pose["position"], pose["quaternion"], orientation, lever_arm_body)
    u, v, theta = project_camera(v_cam, model)
    u, v, theta = float(u[0]), float(v[0]), float(theta[0])
    if not is_valid_projection(u, v, theta, model):
        return {"valid": False, "u": None, "v": None, "thetaDeg": math.degrees(theta), "errorPx": None,
                "reason": f"outside the usable radius (θ = {math.degrees(theta):.0f}°)"}
    error = math.hypot(u - record["pixel"]["u"], v - record["pixel"]["v"])
    return {"valid": True, "u": u, "v": v, "thetaDeg": math.degrees(theta), "errorPx": error, "reason": None}


# --- Input validation -------------------------------------------------------------


def _is_vec(value, n) -> bool:
    return isinstance(value, list) and len(value) == n and all(isinstance(x, (int, float)) and math.isfinite(x) for x in value)


def record_problem(r) -> Optional[str]:
    """Same rules as lib/correspondences.ts invalidReason; None when the record is valid."""
    if not isinstance(r, dict):
        return "not an object"
    if not isinstance(r.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", r["id"]):
        return "bad id"
    for key in ("datasetId", "posesSha256", "runId", "channel", "imageFile", "feature", "notes", "created", "updated"):
        if not isinstance(r.get(key), str) or len(r[key]) > 2000:
            return f"{key} must be a string"
    if not re.fullmatch(r"ch\d+", r["channel"]):
        return "bad channel"
    for key in ("sequence", "timestampUs", "imageWidth", "imageHeight"):
        value = r.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > 2**53:
            return f"{key} must be a non-negative integer"
    px = r.get("pixel")
    if not isinstance(px, dict) or not all(isinstance(px.get(k), (int, float)) and math.isfinite(px[k]) for k in ("u", "v")):
        return "pixel must have numeric u, v"
    if not (-0.5 <= px["u"] <= r["imageWidth"] - 0.5 and -0.5 <= px["v"] <= r["imageHeight"] - 0.5):
        return "pixel outside the image"
    lidar = r.get("lidar")
    if not isinstance(lidar, dict) or not _is_vec(lidar.get("las"), 3):
        return "lidar.las must be [x, y, z]"
    if lidar.get("method") not in ("nearest-point", "ray-plane"):
        return "bad lidar.method"
    pose = r.get("scannerPose")
    if not isinstance(pose, dict) or not _is_vec(pose.get("position"), 3) or not _is_vec(pose.get("quaternion"), 4):
        return "bad scannerPose"
    if r.get("quality") not in ("good", "fair", "poor"):
        return "bad quality"
    if r.get("calibrationStatus") != "provisional":
        return "calibrationStatus must be provisional"
    # Lab 13W review fields (optional).
    excluded = r.get("excludedFromFit")
    if excluded is not None and not (isinstance(excluded, dict) and isinstance(excluded.get("reason"), str)
                                     and len(excluded["reason"]) <= 500 and isinstance(excluded.get("at"), str)):
        return "bad excludedFromFit"
    if r.get("reviewStatus") not in (None,) + REVIEW_STATUSES:
        return "bad reviewStatus"
    if r.get("scene") not in (None,) + SCENES:
        return "bad scene"
    history = r.get("history")
    if history is not None and not (isinstance(history, list) and len(history) <= MAX_HISTORY
                                    and all(isinstance(h, dict) and isinstance(h.get("at"), str) and isinstance(h.get("action"), str) for h in history)):
        return "bad history"
    return None


def load_correspondences(text: str, expected_dataset_id: Optional[str] = None, expected_poses_sha256: Optional[str] = None) -> dict:
    """
    Parse and validate a Lab 13U export. Raises CalibrationInputError when the
    file as a whole is unusable; individual invalid records are listed in
    `rejected`. Every record must belong to the file's dataset and pose file.
    """
    if len(text.encode("utf-8")) > MAX_INPUT_BYTES:
        raise CalibrationInputError("correspondence file larger than 5 MB")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise CalibrationInputError(f"not JSON: {error}") from None
    if not isinstance(data, dict) or data.get("schema") != CORRESPONDENCE_SCHEMA:
        raise CalibrationInputError(f"not a {CORRESPONDENCE_SCHEMA} file")
    if data.get("version") != CORRESPONDENCE_VERSION:
        raise CalibrationInputError(f"unsupported version {data.get('version')!r}")
    dataset = data.get("dataset")
    if not isinstance(dataset, dict) or not isinstance(dataset.get("id"), str) or not isinstance(dataset.get("posesSha256"), str):
        raise CalibrationInputError("the file has no dataset id or pose-file hash")
    if not re.fullmatch(r"[0-9a-f]{64}", dataset["posesSha256"]):
        raise CalibrationInputError("dataset.posesSha256 is not a SHA-256 hex digest")
    if expected_dataset_id is not None and dataset["id"] != expected_dataset_id:
        raise CalibrationInputError(f"dataset {dataset['id']!r}, expected {expected_dataset_id!r}")
    if expected_poses_sha256 is not None and dataset["posesSha256"] != expected_poses_sha256:
        raise CalibrationInputError("the file's pose-file hash differs from the dataset's poses.csv")
    if not isinstance(data.get("correspondences"), list):
        raise CalibrationInputError("correspondences must be an array")

    records, rejected, seen = [], [], set()
    for i, r in enumerate(data["correspondences"], 1):
        problem = record_problem(r)
        if problem is None and r["id"] in seen:
            problem = "duplicate id"
        if problem is None and (r["datasetId"] != dataset["id"] or r["posesSha256"] != dataset["posesSha256"]):
            problem = "belongs to another dataset or pose file"
        if problem:
            rejected.append({"index": i, "id": r.get("id") if isinstance(r, dict) else None, "reason": problem})
        else:
            seen.add(r["id"])
            records.append(r)
    return {
        "sourceSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "dataset": {"id": dataset["id"], "name": dataset.get("name"), "posesSha256": dataset["posesSha256"]},
        "exported": data.get("exported"),
        "provisional": data.get("projectionUsedForDiagnostics"),
        "records": records,
        "rejected": rejected,
    }


def verify_against_runs(records: list, read_run: Callable[[str], dict]) -> list:
    """
    Cross-check records with their extraction run's manifest: the run's pose
    file hash, the image's sequence/channel/timestamp/size and the scanner pose.
    Returns one problem dict per mismatching record (empty = all consistent).
    """
    problems, runs = [], {}
    for r in records:
        if r["runId"] not in runs:
            try:
                runs[r["runId"]] = read_run(r["runId"])
            except Exception as error:  # the reader raises its own error types
                runs[r["runId"]] = error
        run = runs[r["runId"]]
        if isinstance(run, Exception):
            problems.append({"id": r["id"], "reason": f"run {r['runId']} unreadable: {run}"})
            continue
        if run.get("source", {}).get("posesSha256") != r["posesSha256"]:
            problems.append({"id": r["id"], "reason": "the run was interpolated from a different poses.csv"})
            continue
        image = next((e["images"].get(r["channel"]) for e in run["events"] if e["sequence"] == r["sequence"]), None)
        if not image or image.get("file") != r["imageFile"]:
            problems.append({"id": r["id"], "reason": "image not found in the run's manifest"})
            continue
        pose = image["pose"]
        if (image["timestampUs"] != r["timestampUs"] or image.get("width") != r["imageWidth"] or image.get("height") != r["imageHeight"]
                or not pose.get("position") or not np.allclose(pose["position"], r["scannerPose"]["position"], atol=1e-6)
                or not np.allclose(pose["quaternion"], r["scannerPose"]["quaternion"], atol=1e-8)):
            problems.append({"id": r["id"], "reason": "timestamp, size or scanner pose differs from the manifest"})
    return problems


# --- Audit ----------------------------------------------------------------------

LEVER_ARM_PROBE_M = 0.05
CLOSE_RANGE_M = 3.0
FIELD_OF_VIEW_LIMIT_DEG = 110.0


def image_region(radius_px: float, model: dict) -> str:
    """Thirds of the usable radius: centre / middle / outer; beyond it: outside (same as lib/correspondenceReview.ts)."""
    limit = model["validRadiusPx"]
    return "centre" if radius_px < limit / 3 else "middle" if radius_px < 2 * limit / 3 else "outer" if radius_px <= limit else "outside"


def _flag(code: str, severity: str, reason: str) -> dict:
    return {"code": code, "severity": severity, "reason": reason}


def audit(records: list, cloud_las: Optional[np.ndarray] = None,
          model: dict = PROVISIONAL_MODEL, orientations: dict = PROVISIONAL_ORIENTATIONS) -> dict:
    """
    Diagnostic report before fitting. Flags never delete anything:
    severity "exclude" = left out of fits by default (geometrically impossible
    under any plausible rotation); "review" = kept, but listed with a reason.
    `cloud_las` (N × 3 LAS points) enables the LiDAR support and line-of-sight checks.
    """
    tree = None
    if cloud_las is not None:
        from scipy.spatial import cKDTree
        tree = cKDTree(cloud_las)

    rows = []
    for index, r in enumerate(records, 1):
        pose = r["scannerPose"]
        rb = quaternion_matrix(pose["quaternion"])
        point = np.asarray(r["lidar"]["las"], dtype=float)
        body = rb.T @ (point - np.asarray(pose["position"], dtype=float))
        distance = float(np.linalg.norm(body))
        nominal = orientations.get(r["channel"])
        axis = offset_matrix(nominal["yawDeg"], nominal["pitchDeg"], nominal["rollDeg"])[:, 0] if nominal else None
        off_axis = math.degrees(math.acos(np.clip(body @ axis / distance, -1, 1))) if axis is not None and distance > 0 else None
        du, dv = r["pixel"]["u"] - model["cx"], r["pixel"]["v"] - model["cy"]
        radius = math.hypot(du, dv)
        prediction = predict_record(r, nominal, model) if nominal else None
        flags = []
        if r.get("excludedFromFit"):
            flags.append(_flag("user-excluded", "exclude", f"excluded during review: {r['excludedFromFit']['reason'] or 'no reason given'}"))
        if r.get("reviewStatus") == "held-out":
            flags.append(_flag("held-out", "exclude", "marked held-out for validation (not used in fits)"))
        if r.get("reviewStatus") == "rejected":
            flags.append(_flag("rejected", "exclude", "rejected during review (not used in fits)"))
        if r.get("proposalSource") == "lab14e2-auto" or str(r.get("id", "")).startswith("auto_"):
            if not r.get("excludedFromFit") and r.get("reviewStatus") not in ("verified", "held-out", "rejected"):
                flags.append(_flag("lab14e2-auto", "exclude",
                                   "Lab 14E.2 auto-proposal: left out of fits until verified or explicitly restored"))
        if r.get("reviewStatus") == "needs-fix":
            flags.append(_flag("needs-fix", "review", "marked 'needs fix' during review"))
        if nominal is None:
            flags.append(_flag("unknown-channel", "exclude", f"no provisional orientation for {r['channel']}"))
        if distance < 0.2:
            flags.append(_flag("too-close", "exclude", f"LiDAR point {distance:.2f} m from the scanner"))
        if off_axis is not None and off_axis > FIELD_OF_VIEW_LIMIT_DEG:
            flags.append(_flag("wrong-side", "exclude",
                               f"the LiDAR point is {off_axis:.0f}° from the camera's provisional axis (behind the lens), "
                               f"but the pixel is {math.degrees(radius / model['focalPx']):.0f}° from the image centre: "
                               "probably picked on the wrong side or on another object"))
        lever_px = model["focalPx"] * LEVER_ARM_PROBE_M / distance if distance > 0 else None
        if distance < CLOSE_RANGE_M:
            flags.append(_flag("close-range", "review",
                               f"{distance:.2f} m from the scanner: an unknown 5 cm lever arm moves it by up to ~{lever_px:.0f} px"))
        match = MOVABLE_PATTERN.search(r["feature"] + " " + r["notes"])
        if match:
            flags.append(_flag("may-move", "review", f"'{match.group(0)}' may have moved or deformed between the LiDAR pass and the image"))
        if radius > 0.9 * model["validRadiusPx"]:
            flags.append(_flag("image-edge", "review", f"{radius:.0f} px from the image centre, near the edge of the fisheye circle"))
        if r["quality"] != "good":
            flags.append(_flag("quality", "review", f"marked {r['quality']} when picked"))
        support = line_of_sight = None
        if tree is not None:
            support = len(tree.query_ball_point(point, 0.05))
            if r["lidar"]["method"] == "nearest-point" and support <= 2:
                flags.append(_flag("sparse-lidar", "review", f"only {support} LiDAR point(s) within 5 cm: an isolated pick"))
            steps = max(2, int(distance / 0.05))
            start = np.asarray(pose["position"], dtype=float)
            ts = np.linspace(0.3 / distance, 1 - 0.3 / distance, steps) if distance > 0.7 else np.array([])
            hits = set()
            for p in start + np.outer(ts, point - start):
                hits.update(tree.query_ball_point(p, 0.04))
            line_of_sight = len(hits)
            if line_of_sight >= 10:
                flags.append(_flag("occluded", "review", f"{line_of_sight} LiDAR points lie on the line from the scanner to the point"))
        rows.append({
            "index": index,
            "id": r["id"],
            "sequence": r["sequence"],
            "channel": r["channel"],
            "feature": r["feature"],
            "quality": r["quality"],
            "method": r["lidar"]["method"],
            "distanceM": distance,
            "bodyAzimuthDeg": math.degrees(math.atan2(body[1], body[0])),
            "bodyElevationDeg": math.degrees(math.asin(np.clip(body[2] / distance, -1, 1))) if distance > 0 else None,
            "offAxisDeg": off_axis,
            "pixelRadiusPx": radius,
            "imageRegion": image_region(radius, model),
            "reviewStatus": r.get("reviewStatus", "unreviewed"),
            "scene": r.get("scene"),
            "pixelAngleDegAssumedF": math.degrees(radius / model["focalPx"]),
            "leverArm5cmPx": lever_px,
            "provisional": prediction,
            "lidarSupport5cm": support,
            "lineOfSightPoints": line_of_sight,
            "flags": flags,
        })

    # Duplicates: the same image point twice, or the same 3D point for one image.
    duplicates = []
    for i in range(len(records)):
        for j in range(i + 1, len(records)):
            a, b = records[i], records[j]
            same_image = a["imageFile"] == b["imageFile"]
            pixel_gap = math.hypot(a["pixel"]["u"] - b["pixel"]["u"], a["pixel"]["v"] - b["pixel"]["v"])
            las_gap = float(np.linalg.norm(np.subtract(a["lidar"]["las"], b["lidar"]["las"])))
            if (same_image and (pixel_gap < 5 or las_gap < 0.02)) or las_gap < 0.02:
                duplicates.append({"ids": [a["id"], b["id"]], "pixelGapPx": pixel_gap if same_image else None, "lasGapM": las_gap})
    for d in duplicates:
        for row in rows:
            if row["id"] in d["ids"]:
                row["flags"].append(_flag("duplicate", "review", f"near-duplicate of {[i for i in d['ids'] if i != row['id']][0]}"))

    channels = {}
    for channel in sorted({r["channel"] for r in records}):
        mine = [row for row in rows if row["channel"] == channel]
        usable = [row for row in mine if not any(f["severity"] == "exclude" for f in row["flags"])]
        quadrants = {"upper-left": 0, "upper-right": 0, "lower-left": 0, "lower-right": 0}
        rings = {"0-400px": 0, "400-800px": 0, "800-1200px": 0, ">1200px": 0}
        for row, r in ((row, next(x for x in records if x["id"] == row["id"])) for row in usable):
            quadrants[("upper" if r["pixel"]["v"] < model["cy"] else "lower") + "-" + ("left" if r["pixel"]["u"] < model["cx"] else "right")] += 1
            rr = row["pixelRadiusPx"]
            rings["0-400px" if rr < 400 else "400-800px" if rr < 800 else "800-1200px" if rr < 1200 else ">1200px"] += 1
        distances = [row["distanceM"] for row in usable]
        channels[channel] = {
            "records": len(mine),
            "usable": len(usable),
            "events": len({row["sequence"] for row in usable}),
            "distanceM": {"min": min(distances), "median": float(np.median(distances)), "max": max(distances)} if distances else None,
            "closeRange": sum(d < CLOSE_RANGE_M for d in distances),
            "quadrants": quadrants,
            "radialRings": rings,
            "pixelRadiusRangePx": [min(row["pixelRadiusPx"] for row in usable), max(row["pixelRadiusPx"] for row in usable)] if usable else None,
        }

    positions = {}
    for r in records:
        positions.setdefault(r["sequence"], r["scannerPose"]["position"])
    xyz = np.array(list(positions.values()))
    spread = float(np.max(np.linalg.norm(xyz[:, None] - xyz[None], axis=2))) if len(xyz) > 1 else 0.0
    return {
        "records": rows,
        "channels": channels,
        "events": sorted(positions),
        "scannerPositionsSpreadM": spread,
        "methods": {m: sum(r["lidar"]["method"] == m for r in records) for m in ("nearest-point", "ray-plane")},
        "duplicates": duplicates,
        "excludedByDefault": [row["id"] for row in rows if any(f["severity"] == "exclude" for f in row["flags"])],
        "reviewFlagged": [row["id"] for row in rows if row["flags"] and not any(f["severity"] == "exclude" for f in row["flags"])],
        "lidarChecks": "run" if tree is not None else "not run (needs the point cloud: scripts/xgrids/calibrate_cameras.py --cloud-bin)",
        "notes": [
            "Flags are for review; nothing is deleted. Only 'exclude' flags leave a record out of fits by default.",
            "The provisional error uses the assumed lens and the ±90° hypothesis; a large value alone does not make a point wrong.",
        ],
    }


# --- Solver ---------------------------------------------------------------------


@dataclass
class SolverConfig:
    loss: str = "soft_l1"
    f_scale_px: float = 20.0
    # Bounds around the provisional orientation (Lab 13S narrowed yaw to ~±10–20°;
    # these are wide enough not to bias the fit, narrow enough to exclude mirror solutions).
    yaw_bound_deg: float = 45.0
    pitch_bound_deg: float = 30.0
    roll_bound_deg: float = 30.0
    # f range: the image circle (~1425 px radius) then spans a 148°–272° field of view.
    focal_bounds_px: tuple = (600.0, 1100.0)
    outlier_factor: float = 3.0
    outlier_min_px: float = 40.0
    xtol: float = 1e-10
    ftol: float = 1e-10
    gtol: float = 1e-10
    max_nfev: int = 2000


STAGES = {
    "A": {"label": "Stage A: rotation only (lens fixed at the assumed model)", "free": ["yawDeg", "pitchDeg", "rollDeg"], "minRecords": 2},
    "B": {"label": "Stage B: rotation + one focal parameter (principal point fixed)", "free": ["yawDeg", "pitchDeg", "rollDeg", "focalPx"], "minRecords": 3},
}


def _unpack(stage: str, x, initial_orientation: dict, model: dict) -> tuple[dict, dict]:
    orientation = {"yawDeg": float(x[0]), "pitchDeg": float(x[1]), "rollDeg": float(x[2])}
    fitted = dict(model)
    if stage == "B":
        fitted["focalPx"] = float(x[3])
    return orientation, fitted


def _residuals(records, orientation, model, lever_arm_body=(0.0, 0.0, 0.0)) -> np.ndarray:
    out = []
    for r in records:
        pose = r["scannerPose"]
        v_cam = to_camera(r["lidar"]["las"], pose["position"], pose["quaternion"], orientation, lever_arm_body)
        u, v, _ = project_camera(v_cam, model)
        out += [u[0] - r["pixel"]["u"], v[0] - r["pixel"]["v"]]
    return np.asarray(out)


def error_stats(errors) -> dict:
    e = np.asarray([x for x in errors if x is not None], dtype=float)
    if e.size == 0:
        return {"count": 0, "mean": None, "median": None, "rms": None, "max": None}
    return {"count": int(e.size), "mean": float(e.mean()), "median": float(np.median(e)), "rms": float(np.sqrt((e ** 2).mean())), "max": float(e.max())}


def _central_jacobian(fun, x, steps=(1e-4, 1e-4, 1e-4, 1e-2)) -> np.ndarray:
    """d residuals / d parameters by central differences (degrees, px/rad)."""
    columns = []
    for i in range(len(x)):
        h = np.zeros(len(x))
        h[i] = steps[i]
        columns.append((fun(x + h) - fun(x - h)) / (2 * steps[i]))
    return np.stack(columns, axis=1)


def fit(records: list, stage: str, initial_orientation: dict, model: dict, config: SolverConfig,
        start: Optional[dict] = None, lever_arm_body=(0.0, 0.0, 0.0), loss: Optional[str] = None, f_scale: Optional[float] = None) -> dict:
    """Robust least squares for one camera. Bounds are centred on `initial_orientation`."""
    if len(records) < STAGES[stage]["minRecords"]:
        return {"ok": False, "reason": f"needs at least {STAGES[stage]['minRecords']} records, has {len(records)}"}
    o = initial_orientation
    lower = [o["yawDeg"] - config.yaw_bound_deg, o["pitchDeg"] - config.pitch_bound_deg, o["rollDeg"] - config.roll_bound_deg]
    upper = [o["yawDeg"] + config.yaw_bound_deg, o["pitchDeg"] + config.pitch_bound_deg, o["rollDeg"] + config.roll_bound_deg]
    s = start or {**o, "focalPx": model["focalPx"]}
    x0 = [s["yawDeg"], s["pitchDeg"], s["rollDeg"]]
    if stage == "B":
        lower.append(config.focal_bounds_px[0])
        upper.append(config.focal_bounds_px[1])
        x0.append(s.get("focalPx", model["focalPx"]))
    x0 = np.clip(x0, lower, upper)

    def fun(x):
        orientation, fitted = _unpack(stage, x, o, model)
        return _residuals(records, orientation, fitted, lever_arm_body)

    result = least_squares(fun, x0, bounds=(lower, upper), method="trf", loss=loss or config.loss,
                           f_scale=f_scale or config.f_scale_px, x_scale="jac",
                           xtol=config.xtol, ftol=config.ftol, gtol=config.gtol, max_nfev=config.max_nfev)
    orientation, fitted = _unpack(stage, result.x, o, model)
    names = STAGES[stage]["free"]
    # Local uncertainty from the Jacobian of the raw residuals at the solution
    # (Gauss-Newton; assumes independent Gaussian pixel noise, so it is optimistic).
    jac = _central_jacobian(fun, result.x)
    residuals = fun(result.x)
    dof = max(1, residuals.size - len(names))
    sigma2 = float(residuals @ residuals) / dof
    jtj = jac.T @ jac
    try:
        cov = np.linalg.inv(jtj) * sigma2
        std = np.sqrt(np.clip(np.diag(cov), 0, None))
        corr = cov / np.outer(std, std) if np.all(std > 0) else None
    except np.linalg.LinAlgError:
        cov, std, corr = None, np.full(len(names), np.inf), None
    singular = np.linalg.svd(jac, compute_uv=False)
    at_bound = [names[i] for i in range(len(names)) if min(result.x[i] - lower[i], upper[i] - result.x[i]) < 1e-6 * max(1, abs(upper[i] - lower[i]))]
    return {
        "ok": True,
        "stage": stage,
        "orientation": orientation,
        "model": fitted,
        "free": names,
        "x": [float(v) for v in result.x],
        "std": {names[i]: float(std[i]) for i in range(len(names))},
        "correlation": [[float(c) for c in row] for row in corr] if corr is not None else None,
        "conditionNumber": float(singular[0] / singular[-1]) if singular[-1] > 0 else math.inf,
        "atBound": at_bound,
        "solver": {"status": int(result.status), "message": result.message, "nfev": int(result.nfev),
                   "optimality": float(result.optimality), "cost": float(result.cost), "success": bool(result.success)},
        "rmsResidualPx": float(math.sqrt(residuals @ residuals / max(1, len(records)))),
        "trainingRecords": [r["id"] for r in records],
    }


def evaluate(records: list, orientation: dict, model: dict, config: SolverConfig) -> dict:
    """Per-record predictions and errors, inliers by a robust threshold, and stats."""
    per = {r["id"]: predict_record(r, orientation, model) for r in records}
    errors = [p["errorPx"] for p in per.values() if p["valid"]]
    median = float(np.median(errors)) if errors else None
    threshold = max(config.outlier_factor * median, config.outlier_min_px) if median is not None else None
    for p in per.values():
        p["outlier"] = bool(p["valid"] and threshold is not None and p["errorPx"] > threshold)
    return {"perRecord": per, "stats": error_stats(errors), "invalid": sum(not p["valid"] for p in per.values()),
            "outlierThresholdPx": threshold, "outliers": [i for i, p in per.items() if p["outlier"]]}


def leave_one_event_out(records: list, stage: str, initial_orientation: dict, model: dict, config: SolverConfig) -> dict:
    """
    Event-grouped validation: each event's records are predicted by a fit that
    never saw that event. A fold is skipped (and reported) when the remaining
    records or events can't identify the stage's parameters.
    """
    events = sorted({r["sequence"] for r in records})
    folds, held_out = [], {}
    for event in events:
        train = [r for r in records if r["sequence"] != event]
        test = [r for r in records if r["sequence"] == event]
        train_events = len({r["sequence"] for r in train})
        if len(train) < STAGES[stage]["minRecords"] + 1 or train_events < 2:
            folds.append({"heldOutEvent": event, "ok": False, "reason": f"only {len(train)} training records in {train_events} event(s)",
                          "trainingEvents": sorted({r["sequence"] for r in train}), "heldOutRecords": [r["id"] for r in test]})
            continue
        result = fit(train, stage, initial_orientation, model, config)
        if not result["ok"]:
            folds.append({"heldOutEvent": event, "ok": False, "reason": result["reason"]})
            continue
        predictions = {r["id"]: predict_record(r, result["orientation"], result["model"]) for r in test}
        held_out.update(predictions)
        folds.append({
            "heldOutEvent": event,
            "ok": True,
            "trainingEvents": sorted({r["sequence"] for r in train}),
            "trainingRecords": [r["id"] for r in train],
            "heldOutRecords": [r["id"] for r in test],
            "parameters": {k: v for k, v in zip(result["free"], result["x"])},
            "atBound": result["atBound"],
            "heldOutErrorsPx": {i: p["errorPx"] for i, p in predictions.items()},
        })
    ok = [f for f in folds if f["ok"]]
    spread = {}
    if ok:
        for name in STAGES[stage]["free"]:
            values = [f["parameters"][name] for f in ok]
            spread[name] = {"min": min(values), "max": max(values), "range": max(values) - min(values)}
    return {
        "stage": stage,
        "folds": folds,
        "foldsOk": len(ok),
        "foldsSkipped": len(folds) - len(ok),
        "heldOut": held_out,
        "heldOutStats": error_stats([p["errorPx"] for p in held_out.values() if p["valid"]]),
        "heldOutInvalid": sum(not p["valid"] for p in held_out.values()),
        "parameterSpread": spread,
    }


def sensitivity(records: list, stage: str, initial_orientation: dict, model: dict, config: SolverConfig, reference: dict,
                strict_ids: Optional[set] = None) -> dict:
    """How far the estimate moves under plausible changes of the assumptions."""
    names = STAGES[stage]["free"]

    def delta(result):
        if not result.get("ok"):
            return {"ok": False, "reason": result.get("reason")}
        return {"ok": True, "parameters": dict(zip(names, result["x"])),
                "delta": {n: result["x"][i] - reference["x"][i] for i, n in enumerate(names)}}

    out = {"leverArm": {}, "loss": {}, "start": {}, "strictSubset": None, "withoutOutliers": None}
    outliers = set(reference.get("training", {}).get("outliers", []))
    if outliers:
        kept = [r for r in records if r["id"] not in outliers]
        out["withoutOutliers"] = {"removed": sorted(outliers), **delta(fit(kept, stage, initial_orientation, model, config))}
    for axis, vec in (("+x", (1, 0, 0)), ("-x", (-1, 0, 0)), ("+y", (0, 1, 0)), ("-y", (0, -1, 0)), ("+z", (0, 0, 1)), ("-z", (0, 0, -1))):
        out["leverArm"][f"{axis} 5 cm"] = delta(fit(records, stage, initial_orientation, model, config,
                                                     lever_arm_body=tuple(LEVER_ARM_PROBE_M * c for c in vec)))
    for loss, scale in (("linear", None), ("huber", 20.0), ("soft_l1", 10.0), ("soft_l1", 40.0), ("cauchy", 20.0)):
        out["loss"][f"{loss}" + (f" f_scale {scale:g}" if scale else "")] = delta(fit(records, stage, initial_orientation, model, config, loss=loss, f_scale=scale))
    o = initial_orientation
    for dy, dp, dr in ((15, 10, 10), (-15, -10, -10), (15, -10, 10), (-15, 10, -10)):
        s = {"yawDeg": o["yawDeg"] + dy, "pitchDeg": o["pitchDeg"] + dp, "rollDeg": o["rollDeg"] + dr, "focalPx": 900.0 if dy > 0 else 650.0}
        out["start"][f"yaw{dy:+d} pitch{dp:+d} roll{dr:+d}"] = delta(fit(records, stage, initial_orientation, model, config, start=s))
    if strict_ids is not None:
        strict = [r for r in records if r["id"] in strict_ids]
        out["strictSubset"] = {"records": [r["id"] for r in strict], **delta(fit(strict, stage, initial_orientation, model, config))}

    def max_abs(group):
        values = {}
        for item in group.values():
            if item and item.get("ok"):
                for n, d in item["delta"].items():
                    values[n] = max(values.get(n, 0.0), abs(d))
        return values
    out["maxAbsDelta"] = {"leverArm": max_abs(out["leverArm"]), "loss": max_abs(out["loss"]), "start": max_abs(out["start"])}
    return out


# --- Identifiability and recommendation ------------------------------------------

# A parameter counts as identified only if all of these hold (documented in docs/xgrids/calibration-experiments.md).
LIMITS = {
    "angleStdDeg": 2.0, "angleFoldRangeDeg": 5.0, "angleLeverArmDeg": 3.0,
    "focalStdPx": 40.0, "focalFoldRangeRel": 0.10, "focalLeverArmPx": 60.0,
}


def assess(stage: str, result: dict, cv: dict, sens: dict) -> dict:
    status = {}
    for name in STAGES[stage]["free"]:
        reasons = []
        std = result["std"][name]
        spread = cv["parameterSpread"].get(name, {}).get("range")
        lever = sens["maxAbsDelta"]["leverArm"].get(name)
        start = sens["maxAbsDelta"]["start"].get(name)
        if name == "focalPx":
            if std > LIMITS["focalStdPx"]:
                reasons.append(f"1σ {std:.0f} px/rad > {LIMITS['focalStdPx']:.0f}")
            if spread is not None and spread > LIMITS["focalFoldRangeRel"] * result["x"][3]:
                reasons.append(f"leave-one-event-out range {spread:.0f} px/rad > {LIMITS['focalFoldRangeRel']:.0%}")
            if lever is not None and lever > LIMITS["focalLeverArmPx"]:
                reasons.append(f"moves {lever:.0f} px/rad with a 5 cm lever arm")
        else:
            if std > LIMITS["angleStdDeg"]:
                reasons.append(f"1σ {std:.1f}° > {LIMITS['angleStdDeg']}°")
            if spread is not None and spread > LIMITS["angleFoldRangeDeg"]:
                reasons.append(f"leave-one-event-out range {spread:.1f}° > {LIMITS['angleFoldRangeDeg']}°")
            if lever is not None and lever > LIMITS["angleLeverArmDeg"]:
                reasons.append(f"moves {lever:.1f}° with a 5 cm lever arm")
        if start is not None and start > (1.0 if name == "focalPx" else 0.01):
            reasons.append(f"different starting points end {start:.2f} apart (local minima)")
        if name in result["atBound"]:
            reasons.append("ended at its bound")
        if cv["foldsOk"] < 3:
            reasons.append(f"only {cv['foldsOk']} usable validation folds")
        status[name] = {"status": "estimated (experimental)" if not reasons else "poorly constrained", "reasons": reasons}
    return status


def _rounded(value, digits=6):
    if isinstance(value, float):
        return round(value, digits) if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _rounded(v, digits) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_rounded(v, digits) for v in value]
    return value


def run_experiment(loaded: dict, audit_report: dict, config: Optional[SolverConfig] = None,
                   exclude_ids: Optional[list] = None, include_ids: Optional[list] = None,
                   source_name: Optional[str] = None, now: Optional[str] = None) -> dict:
    """
    The full Lab 13V experiment: per channel Stage A, then Stage B if the data
    support it, leave-one-event-out validation, sensitivity and a recommendation.
    Deterministic for the same inputs (no random numbers); only `created` varies.
    """
    config = config or SolverConfig()
    records = loaded["records"]
    unknown = sorted((set(exclude_ids or []) | set(include_ids or [])) - {r["id"] for r in records})
    if unknown:
        raise ValueError(f"unknown record id(s) in exclude/include: {', '.join(unknown[:5])}")
    excluded = set(audit_report["excludedByDefault"]) | set(exclude_ids or [])
    excluded -= set(include_ids or [])
    review = set(audit_report["reviewFlagged"])
    used = [r for r in records if r["id"] not in excluded]
    warnings = []

    cameras = {}
    for channel in sorted({r["channel"] for r in records}):
        initial = PROVISIONAL_ORIENTATIONS.get(channel)
        if initial is None:
            warnings.append(f"{channel}: no provisional orientation; not fitted")
            continue
        train = [r for r in used if r["channel"] == channel]
        events = sorted({r["sequence"] for r in train})
        camera = {"records": [r["id"] for r in train], "events": events, "initial": {"orientation": initial, "model": PROVISIONAL_MODEL}}
        camera["provisional"] = evaluate(train, initial, PROVISIONAL_MODEL, config)
        stages = {}
        for stage in ("A", "B"):
            if stage == "B" and not (stages.get("A") or {}).get("ok"):
                stages["B"] = {"ok": False, "reason": "Stage A did not succeed"}
                continue
            if len(events) < 3:
                stages[stage] = {"ok": False, "reason": f"only {len(events)} event(s); at least 3 are needed for an event-grouped check"}
                continue
            start = None
            if stage == "B":
                a = stages["A"]
                start = {**a["orientation"], "focalPx": PROVISIONAL_MODEL["focalPx"]}
            result = fit(train, stage, initial, PROVISIONAL_MODEL, config, start=start)
            if not result["ok"]:
                stages[stage] = result
                continue
            result["training"] = evaluate(train, result["orientation"], result["model"], config)
            result["validation"] = leave_one_event_out(train, stage, initial, PROVISIONAL_MODEL, config)
            result["validation"]["heldOutOutliers"] = [i for i, p in result["validation"]["heldOut"].items()
                                                       if p["valid"] and result["training"]["outlierThresholdPx"] is not None
                                                       and p["errorPx"] > result["training"]["outlierThresholdPx"]]
            strict = {r["id"] for r in train if r["id"] not in review}
            result["sensitivity"] = sensitivity(train, stage, initial, PROVISIONAL_MODEL, config, result, strict)
            result["identifiability"] = assess(stage, result, result["validation"], result["sensitivity"])
            stages[stage] = result
        camera["stages"] = stages

        # Recommendation by held-out error only (never by training error).
        provisional_held_out = error_stats([camera["provisional"]["perRecord"][r["id"]]["errorPx"] for r in train])
        options = {"provisional": provisional_held_out}
        for stage, result in stages.items():
            if result.get("ok") and result["validation"]["heldOutInvalid"] == 0 and result["validation"]["foldsSkipped"] == 0:
                options[stage] = result["validation"]["heldOutStats"]
        best = min(options, key=lambda k: (options[k]["median"] if options[k]["median"] is not None else math.inf))
        if best != "provisional" and options[best]["rms"] is not None and provisional_held_out["rms"] is not None \
                and options[best]["rms"] > provisional_held_out["rms"]:
            warnings.append(f"{channel}: Stage {best} has the lowest held-out median but a higher held-out RMS than provisional")
        if "B" in options and "A" in options and options["B"]["median"] is not None and options["A"]["median"] is not None \
                and options["B"]["median"] >= options["A"]["median"]:
            warnings.append(f"{channel}: Stage B does not improve held-out error over Stage A; the focal estimate is not supported")
        camera["comparison"] = {"heldOut": options, "recommended": best,
                                "rule": "lowest held-out (leave-one-event-out) median error; provisional errors need no training"}
        cameras[channel] = camera

    for channel, camera in cameras.items():
        if len(camera["events"]) < 5:
            warnings.append(f"{channel}: {len(camera['events'])} events; every estimate is fragile")
        closes = [r for r in records if r["id"] in camera["records"] and audit_report_lookup(audit_report, r["id"])["distanceM"] < CLOSE_RANGE_M]
        if closes:
            warnings.append(f"{channel}: {len(closes)} of {len(camera['records'])} points are closer than {CLOSE_RANGE_M:g} m, where the unknown lever arm matters")
        recommended = camera["stages"].get(camera["comparison"]["recommended"], {})
        outliers = recommended.get("training", {}).get("outliers", [])
        if outliers:
            close_outliers = [i for i in outliers if audit_report_lookup(audit_report, i)["distanceM"] < CLOSE_RANGE_M]
            warnings.append(f"{channel}: {len(outliers)} outlier(s) under the recommended stage ({len(close_outliers)} closer than "
                            f"{CLOSE_RANGE_M:g} m); review them, they were kept in the fit and down-weighted by the robust loss")

    identity = {
        "sourceSha256": loaded["sourceSha256"],
        "used": sorted(r["id"] for r in used),
        "config": asdict(config),
        "module": MODULE_VERSION,
    }
    experiment_id = "x_" + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:12]
    experiment = {
        "schema": EXPERIMENT_SCHEMA,
        "version": EXPERIMENT_VERSION,
        "experimentId": experiment_id,
        "created": now or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "experimental: not a production-verified calibration",
        "source": {
            "file": source_name,
            "sha256": loaded["sourceSha256"],
            "dataset": loaded["dataset"],
            "exported": loaded["exported"],
            "correspondenceIds": [r["id"] for r in records],
            "rejectedOnLoad": loaded["rejected"],
            "excluded": [{"id": i, "reasons": [f["reason"] for f in audit_report_lookup(audit_report, i)["flags"]] or ["excluded by the user"]}
                         for i in sorted(excluded) if any(r["id"] == i for r in records)],
            "events": sorted({r["sequence"] for r in records}),
        },
        "conventions": CONVENTIONS,
        "initial": {"model": PROVISIONAL_MODEL, "orientations": PROVISIONAL_ORIENTATIONS, "status": "assumed"},
        "solver": {
            "library": "scipy.optimize.least_squares (trf, bounded)",
            "config": asdict(config),
            "stages": {k: {"label": v["label"], "free": v["free"]} for k, v in STAGES.items()},
            "fixed": {"cx": PROVISIONAL_MODEL["cx"], "cy": PROVISIONAL_MODEL["cy"], "leverArm": [0, 0, 0], "timeOffset": 0},
            "identifiabilityLimits": LIMITS,
            "software": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__, "module": MODULE_VERSION},
        },
        "audit": audit_report,
        "cameras": cameras,
        "parameterSets": parameter_sets(cameras),
        "warnings": warnings,
        "limitations": [
            "Camera centre = scanner position: the camera-to-scanner translation (lever arm) is not calibrated.",
            "Principal point (cx, cy) is fixed at the image centre; it is not estimated.",
            "Lens: one-parameter equidistant model; no distortion terms. Edge-of-image accuracy is unknown.",
            "Image timing (exposure, rolling shutter, clock offset) is assumed exact.",
            "LiDAR points come from the preview cloud; most are nearest-point picks (approximate to the point spacing).",
            "Few correspondences from one recording: estimates are experimental and must be re-checked with more, farther, well-spread points.",
        ],
    }
    return _rounded(experiment)


IMAGE_CHECK_SCALE = 10      # 4000 × 3000 → 400 × 300 cells
IMAGE_CHECK_RANGE_M = 30.0
IMAGE_CHECK_NEAR_M = 0.5


def render_cloud_grey(points_las: np.ndarray, grey: np.ndarray, position, quaternion, orientation: dict, model: dict,
                      width: int, height: int, scale: int = IMAGE_CHECK_SCALE) -> np.ndarray:
    """Grey LiDAR rendering through a camera (nearest point per cell wins); NaN where empty."""
    v = to_camera(points_las, position, quaternion, orientation)
    u, vv, theta = project_camera(v, model)
    ok = is_valid_projection(u, vv, theta, model) & (np.linalg.norm(v, axis=1) > IMAGE_CHECK_NEAR_M)
    w, h = width // scale, height // scale
    xi, yi = (u[ok] // scale).astype(int), (vv[ok] // scale).astype(int)
    inside = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
    distance, values = np.linalg.norm(v[ok], axis=1)[inside], grey[ok][inside]
    order = np.argsort(-distance)
    image = np.full((h, w), np.nan)
    image[yi[inside][order], xi[inside][order]] = values[order]
    return image


def normalised_cross_correlation(a: np.ndarray, b: np.ndarray) -> Optional[float]:
    both = ~np.isnan(a) & ~np.isnan(b)
    if both.sum() < 100:
        return None
    x, y = a[both] - a[both].mean(), b[both] - b[both].mean()
    denominator = math.sqrt(float((x * x).sum() * (y * y).sum()))
    return float((x * y).sum() / denominator) if denominator > 0 else None


def image_agreement(parameter_sets_: dict, run: dict, read_photo_grey: Callable[[str, int, int], np.ndarray],
                    cloud_las: np.ndarray, cloud_grey: np.ndarray, skip_sequences=(), max_events: int = 24) -> dict:
    """
    Independent check: correlation (NCC) between each photo and the coloured LiDAR
    rendered through each parameter set, on events NOT used for fitting (at most
    `max_events`, evenly spaced). Whole-image evidence; it does not depend on the
    hand-picked points. Higher is better; the absolute value is low because LiDAR
    colour ≠ photo exposure.
    """
    rows, skipped = [], sorted(set(skip_sequences))
    candidates = [e for e in run["events"] if e["sequence"] not in skip_sequences]
    if len(candidates) > max_events:
        candidates = [candidates[i] for i in np.linspace(0, len(candidates) - 1, max_events).round().astype(int)]
    for event in candidates:
        for channel, image in sorted(event["images"].items()):
            if not image.get("file") or not image.get("pose"):
                continue
            w, h = image["width"], image["height"]
            photo = read_photo_grey(image["file"], w // IMAGE_CHECK_SCALE, h // IMAGE_CHECK_SCALE)
            near = np.linalg.norm(cloud_las - np.asarray(image["pose"]["position"], float), axis=1) < IMAGE_CHECK_RANGE_M
            points, grey = cloud_las[near], cloud_grey[near]
            row = {"sequence": event["sequence"], "channel": channel, "file": image["file"], "ncc": {}}
            for name, entry in parameter_sets_.items():
                camera = entry["cameras"].get(channel)
                if camera is None:
                    continue
                model = camera["model"]
                yy, xx = np.mgrid[0:photo.shape[0], 0:photo.shape[1]]
                circle = np.hypot((xx + 0.5) * IMAGE_CHECK_SCALE - model["cx"], (yy + 0.5) * IMAGE_CHECK_SCALE - model["cy"]) <= model["validRadiusPx"]
                rendered = render_cloud_grey(points, grey, image["pose"]["position"], image["pose"]["quaternion"],
                                             camera["orientation"], model, w, h)
                row["ncc"][name] = normalised_cross_correlation(rendered, np.where(circle, photo, np.nan))
            rows.append(row)
    summary = {}
    for channel in sorted({r["channel"] for r in rows}):
        mine = [r for r in rows if r["channel"] == channel]
        names = sorted({n for r in mine for n in r["ncc"]})
        means = {n: (float(np.mean(vals)) if (vals := [r["ncc"][n] for r in mine if r["ncc"].get(n) is not None]) else None) for n in names}
        best = {n: 0 for n in names}
        for r in mine:
            scored = {n: s for n, s in r["ncc"].items() if s is not None}
            if scored:
                best[max(scored, key=scored.get)] += 1
        summary[channel] = {"images": len(mine), "meanNcc": means, "bestCount": best}
    return {"method": "NCC of grey photo vs grey LiDAR rendering (400 × 300 cells, inside the valid circle, points 0.5–30 m)",
            "runId": run.get("id"), "skippedSequences": skipped, "maxEvents": max_events, "images": rows, "summary": summary}


def audit_report_lookup(report: dict, record_id: str) -> dict:
    return next(row for row in report["records"] if row["id"] == record_id)


def parameter_sets(cameras: dict) -> dict:
    """Ready-to-use settings per set and channel, in the frontend's shapes (lib/fisheyeProjection.ts)."""
    sets = {"provisional": {"label": "Provisional (Lab 13U, assumed)", "cameras": {}}}
    for channel, camera in cameras.items():
        sets["provisional"]["cameras"][channel] = {
            "orientation": camera["initial"]["orientation"],
            "model": {**camera["initial"]["model"], "status": "assumed"},
            "parameterStatus": {"orientation": "provisional hypothesis", "focalPx": "assumed", "principalPoint": "assumed"},
        }
        for stage, result in camera["stages"].items():
            if not result.get("ok"):
                continue
            entry = sets.setdefault(f"stage{stage}", {"label": STAGES[stage]["label"] + " (experimental)", "cameras": {}})
            status = {name: info["status"] for name, info in result["identifiability"].items()}
            entry["cameras"][channel] = {
                "orientation": result["orientation"],
                "model": {**result["model"], "status": "experimental-estimate" if stage == "B" else "assumed"},
                "parameterStatus": {
                    "orientation": "estimated (experimental)" if all(status[n] == "estimated (experimental)" for n in ("yawDeg", "pitchDeg", "rollDeg")) else "poorly constrained",
                    "focalPx": status.get("focalPx", "assumed (fixed)"),
                    "principalPoint": "assumed (fixed)",
                },
            }
    return sets


def load_experiment(text: str) -> dict:
    """Parse an exported experiment (for re-display); raises CalibrationInputError."""
    data = json.loads(text)
    if not isinstance(data, dict) or data.get("schema") != EXPERIMENT_SCHEMA:
        raise CalibrationInputError(f"not a {EXPERIMENT_SCHEMA} file")
    if data.get("version") != EXPERIMENT_VERSION:
        raise CalibrationInputError(f"unsupported experiment version {data.get('version')!r}")
    for key in ("experimentId", "source", "cameras", "parameterSets"):
        if key not in data:
            raise CalibrationInputError(f"missing {key}")
    return data
