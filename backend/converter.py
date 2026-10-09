"""
Dataset conversion job. Runs in a separate worker process (see app.py), so the
API stays responsive; progress is written to metadata.json, which the browser
polls.

Steps:
  1. Read the full LAS (progress 0 -> 60%).
  2. Offset + bounds from ALL points.
  3. Write the point budgets, all with that same offset (60 -> 90%).
     Budgets larger than the dataset are replaced by one "All (N)" budget.
  4. Validate the scanner poses, if uploaded (90 -> 100%): schema checks, then
     frame-agreement checks against the point cloud. Poses are never moved to
     make them fit; if they don't agree, they are marked "suspect" and hidden.
"""

import math
import shutil
from pathlib import Path
from typing import Any, Optional

import numpy as np

from lidar_conversion import BYTES_PER_POINT, HEADER_BYTES, compute_offset, read_las, sample_indices, write_bin
from storage import BUDGETS, SOURCE_FILES, budget_file, dataset_dir, now_iso, update_metadata

POSE_COLUMNS = 8  # timestamp, x, y, z, qx, qy, qz, qw
NORMALISED_POSES_FILE = "poses.csv"

# Frame-agreement thresholds for poses vs. point cloud.
BOUNDS_MARGIN_M = 1.0
MIN_INSIDE_FRACTION = 0.95
MAX_MEDIAN_NEAREST_M = 2.0
MAX_QUATERNION_NORM_ERROR = 0.01
DISTANCE_SAMPLE_POINTS = 200_000
DISTANCE_SAMPLE_POSES = 2_000


def convert_dataset(dataset_id: str) -> None:
    """Entry point of the worker process. Never raises: failures go to metadata."""
    try:
        _convert(dataset_id)
    except Exception as error:  # noqa: BLE001 - report every failure to the UI
        # Remove partial output (it may be what filled the disk); sources are kept.
        shutil.rmtree(dataset_dir(dataset_id) / "converted", ignore_errors=True)
        update_metadata(dataset_id, status="failed", stage="Conversion failed", budgets=[], error=str(error))


def _progress(dataset_id: str, progress: float, stage: str) -> None:
    update_metadata(dataset_id, status="converting", progress=round(progress, 3), stage=stage)


def _convert(dataset_id: str) -> None:
    folder = dataset_dir(dataset_id)
    source = folder / "source"
    converted = folder / "converted"
    converted.mkdir(exist_ok=True)

    # 1. Read every point.
    _progress(dataset_id, 0.0, "Reading points")
    cloud = read_las(
        source / SOURCE_FILES["pointcloud"],
        on_progress=lambda f: _progress(dataset_id, 0.6 * f, f"Reading points {f:.0%}"),
    )
    total = len(cloud.xyz)
    if total == 0:
        raise ValueError("The LAS file contains no points.")

    # 2. One offset for everything, from the complete point cloud.
    offset, mins, maxs = compute_offset(cloud.xyz)
    update_metadata(
        dataset_id,
        originalPointCount=total,
        originalBounds={"min": mins.tolist(), "max": maxs.tolist()},
        offset=offset.tolist(),
        hasRgb=cloud.rgb is not None,
    )

    # 3. Point budgets.
    budgets = []
    for i, (key, label, max_points) in enumerate(BUDGETS):
        keep = sample_indices(total, max_points)
        if keep is None:
            key, label = "all", f"All ({_compact(total)})"
        _progress(dataset_id, 0.6 + 0.3 * i / len(BUDGETS), f"Writing {label} budget")
        count = write_bin(converted / budget_file(key), cloud.xyz, cloud.rgb, offset, keep)
        budgets.append(
            {"key": key, "label": label, "pointCount": count, "bytes": HEADER_BYTES + BYTES_PER_POINT * count}
        )
        if keep is None:
            break  # larger budgets would repeat exactly the same points
    update_metadata(dataset_id, budgets=budgets)

    # 4. Poses.
    poses_path = source / SOURCE_FILES["poses"]
    if poses_path.is_file():
        _progress(dataset_id, 0.9, "Validating poses")
        poses = validate_poses(poses_path, converted / NORMALISED_POSES_FILE, cloud.xyz, mins, maxs)
        update_metadata(dataset_id, poses=poses)

    update_metadata(dataset_id, status="ready", progress=1.0, stage="Ready", error=None, convertedAt=now_iso())


def validate_poses(
    path: Path, normalised_path: Path, xyz: np.ndarray, mins: np.ndarray, maxs: np.ndarray
) -> dict[str, Any]:
    """
    Returns {"status": "aligned" | "suspect" | "invalid", "count", "message", "checks"}.

    Schema (not assumed blindly; each part is checked):
        timestamp, x, y, z, qx, qy, qz, qw     (an optional text header row is skipped)
    Frame agreement (poses must be in the LAS frame to be shown):
        - >= 95% of poses inside the point-cloud bounds (+1 m margin)
        - median distance from a pose to its nearest scan point <= 2 m
    """
    rows, header = _parse_pose_rows(path)
    if isinstance(rows, str):
        return {"status": "invalid", "count": 0, "message": rows, "checks": {}}

    poses = np.array(rows, dtype=np.float64)
    t, positions, quaternions = poses[:, 0], poses[:, 1:4], poses[:, 4:8]
    checks: dict[str, Any] = {"hasHeaderRow": header is not None}

    increasing = bool(np.all(np.diff(t) > 0)) if len(t) > 1 else True
    checks["timestampsIncreasing"] = increasing
    checks["durationSeconds"] = float(t[-1] - t[0])
    if len(t) > 1 and checks["durationSeconds"] > 0:
        checks["rateHz"] = round((len(t) - 1) / checks["durationSeconds"], 3)

    norm_error = float(np.max(np.abs(np.linalg.norm(quaternions, axis=1) - 1)))
    checks["maxQuaternionNormError"] = norm_error

    inside = np.all((positions >= mins - BOUNDS_MARGIN_M) & (positions <= maxs + BOUNDS_MARGIN_M), axis=1)
    checks["insideBoundsFraction"] = float(inside.mean())

    nearest = _nearest_point_distances(positions, xyz)
    checks["medianNearestPointM"] = float(np.median(nearest))
    checks["p95NearestPointM"] = float(np.percentile(nearest, 95))

    problems = []
    if not increasing:
        problems.append("timestamps are not strictly increasing")
    if norm_error > MAX_QUATERNION_NORM_ERROR:
        problems.append(
            f"quaternions are not unit length (max error {norm_error:.3f}); the columns may not be qx, qy, qz, qw"
        )
    frame_problems = []
    if checks["insideBoundsFraction"] < MIN_INSIDE_FRACTION:
        frame_problems.append(
            f"only {checks['insideBoundsFraction']:.0%} of poses lie inside the point-cloud bounds"
        )
    if checks["medianNearestPointM"] > MAX_MEDIAN_NEAREST_M:
        frame_problems.append(f"poses are a median {checks['medianNearestPointM']:.1f} m from the nearest scan point")
    if frame_problems:
        frame_problems[-1] += ", so they are probably in a different coordinate frame than the point cloud"
    problems += frame_problems

    # Normalised copy (header-less, 8 columns) for the browser; positions stay in
    # real-world coordinates, the frontend subtracts the dataset offset.
    with open(normalised_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(",".join(repr(v) for v in row) + "\n")

    if problems:
        return {
            "status": "suspect",
            "count": len(rows),
            "message": "Not displayed: " + "; ".join(problems) + ".",
            "checks": checks,
        }
    return {
        "status": "aligned",
        "count": len(rows),
        "message": f"Poses agree with the point cloud (median {checks['medianNearestPointM']:.2f} m "
        "from the nearest scan point). Quaternion order assumed qx, qy, qz, qw.",
        "checks": checks,
    }


def _parse_pose_rows(path: Path) -> tuple[list[list[float]] | str, Optional[str]]:
    """Rows of 8 finite numbers, or an error message. Skips one text header row."""
    lines = [line.strip() for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    header = None
    rows: list[list[float]] = []
    for number, line in enumerate(lines, start=1):
        fields = [field.strip() for field in line.split(",")]
        try:
            values = [float(field) for field in fields]
        except ValueError:
            if number == 1:
                header = line[:200]
                continue
            return f"Line {number} is not numeric: \"{line[:80]}\"", header
        if len(values) != POSE_COLUMNS:
            return (
                f"Line {number} has {len(values)} columns; expected {POSE_COLUMNS} "
                "(timestamp, x, y, z, qx, qy, qz, qw).",
                header,
            )
        if not all(math.isfinite(v) for v in values):
            return f"Line {number} contains NaN or infinity.", header
        rows.append(values)
    if len(rows) < 2:
        return "At least two pose rows are needed.", header
    return rows, header


def _nearest_point_distances(positions: np.ndarray, xyz: np.ndarray) -> np.ndarray:
    """Distance from each (sampled) pose to the nearest of a random subset of scan points."""
    rng = np.random.default_rng(1)
    points = xyz if len(xyz) <= DISTANCE_SAMPLE_POINTS else xyz[rng.choice(len(xyz), DISTANCE_SAMPLE_POINTS, replace=False)]
    if len(positions) > DISTANCE_SAMPLE_POSES:
        positions = positions[np.linspace(0, len(positions) - 1, DISTANCE_SAMPLE_POSES).astype(int)]
    nearest = np.empty(len(positions))
    for i, p in enumerate(positions):
        nearest[i] = np.sqrt(np.min(np.sum((points - p) ** 2, axis=1)))
    return nearest


def _compact(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}".rstrip("0").rstrip(".") + "M"
    if n >= 1_000:
        return f"{round(n / 1_000)}K"
    return str(n)
