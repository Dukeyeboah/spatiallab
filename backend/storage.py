"""
The local dataset store. One folder per dataset:

    spatial-data/datasets/<id>/
        metadata.json           everything the frontend needs (see new_metadata)
        source/                 original uploads, renamed to fixed names
            pointcloud.las
            poses.csv           optional
            project.json        optional
            control_points.csv  optional, kept for later analysis
            gnss.csv            optional, kept for later analysis
        converted/              generated, served to the browser
            pointcloud-500k.bin, -1m, -2m, -5m (or pointcloud-all.bin for smaller clouds)

    spatial-data/catalog.json   properties and captures that reference datasets (see catalog.py)

Paths are never built from user input: dataset ids are generated here and
checked against DATASET_ID_PATTERN, and file names come from fixed tables.
"""

import json
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("SPATIAL_LAB_DATA_DIR", REPO_ROOT / "spatial-data")).resolve()
DATASETS_DIR = DATA_DIR / "datasets"

DATASET_ID_PATTERN = re.compile(r"^ds_[0-9a-f]{12}$")
METADATA_SCHEMA_VERSION = 1

# Fixed storage names for each upload role (never the client's file name).
SOURCE_FILES = {
    "pointcloud": "pointcloud.las",
    "poses": "poses.csv",
    "project": "project.json",
    "control_points": "control_points.csv",
    "gnss": "gnss.csv",
}

# Point budgets: key -> (label, max points). "all" is used when a dataset is
# smaller than a budget, so no budget ever repeats the same points.
# Adding a budget here is enough for existing datasets too: the backend
# generates missing budgets from the stored LAS at startup (converter.backfill_budgets).
BUDGETS = [
    ("500k", "500K", 500_000),
    ("1m", "1M", 1_000_000),
    ("2m", "2M", 2_000_000),
    ("5m", "5M", 5_000_000),
]


def budget_file(key: str) -> str:
    return f"pointcloud-{key}.bin"


def planned_budgets(total: int) -> list[tuple[str, str, Optional[int]]]:
    """
    (key, label, max points or None for "all") for a cloud of `total` points:
    every budget smaller than the cloud, then one "All (N)" if the cloud is
    not bigger than the largest budget. Larger budgets would repeat the same points.
    """
    plan: list[tuple[str, str, Optional[int]]] = []
    for key, label, max_points in BUDGETS:
        if total <= max_points:
            plan.append(("all", f"All ({compact_count(total)})", None))
            break
        plan.append((key, label, max_points))
    return plan


def missing_budgets(metadata: dict[str, Any]) -> list[tuple[str, str, Optional[int]]]:
    """Budgets a ready dataset should have (per BUDGETS) but doesn't yet."""
    total = metadata.get("originalPointCount")
    if metadata.get("status") != "ready" or not total:
        return []
    have = {b["key"] for b in metadata.get("budgets", [])}
    return [entry for entry in planned_budgets(total) if entry[0] not in have]


def compact_count(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}".rstrip("0").rstrip(".") + "M"
    if n >= 1_000:
        return f"{round(n / 1_000)}K"
    return str(n)


def new_dataset_id() -> str:
    return "ds_" + secrets.token_hex(6)


def dataset_dir(dataset_id: str) -> Path:
    """The folder of a dataset. Raises ValueError for anything that isn't a valid id."""
    if not DATASET_ID_PATTERN.match(dataset_id):
        raise ValueError("invalid dataset id")
    path = (DATASETS_DIR / dataset_id).resolve()
    if path.parent != DATASETS_DIR:  # defence in depth: must stay inside the store
        raise ValueError("invalid dataset id")
    return path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_metadata(dataset_id: str, name: str) -> dict[str, Any]:
    """
    Metadata of a freshly uploaded dataset. Filled in by the converter.

    Extensibility: future asset types (trained Gaussian splats, meshes,
    measurements, annotations) become new optional keys next to "budgets" and
    "poses", each with its own status; alignment between captures becomes a
    "frame" transform on top of "offset". Bump METADATA_SCHEMA_VERSION when
    the meaning of an existing key changes.
    """
    return {
        "schemaVersion": METADATA_SCHEMA_VERSION,
        "id": dataset_id,
        "name": name,
        "kind": "lidar-capture",
        "createdAt": now_iso(),
        # queued -> converting -> ready | failed
        "status": "queued",
        "progress": 0.0,
        "stage": "Waiting for the converter",
        "error": None,
        "source": {},
        "originalPointCount": None,
        # Real-world coordinates of the full point cloud, before the offset.
        "originalBounds": None,
        # Subtracted from every budget AND from the poses (one shared frame).
        "offset": None,
        "hasRgb": None,
        "budgets": [],
        # Set while budgets added later (e.g. 5M) are generated for an existing
        # dataset: {"status": "queued" | "running" | "failed", "progress", "stage", "error"}.
        "budgetJob": None,
        "poses": None,
        "attachments": [],
        # Non-fatal import notes (skipped empty files, unknown coordinate info).
        "warnings": [],
        # Optional uploads that were empty: [{"role", "filename", "reason"}].
        "skippedFiles": [],
        # Set when project.json is missing or empty (see uploads.infer_project_metadata).
        "projectInferred": None,
    }


def read_metadata(dataset_id: str) -> Optional[dict[str, Any]]:
    path = dataset_dir(dataset_id) / "metadata.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_metadata(dataset_id: str, metadata: dict[str, Any]) -> None:
    """Atomic write (temp file + rename), so readers never see half a file."""
    folder = dataset_dir(dataset_id)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".metadata-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    os.replace(tmp, folder / "metadata.json")


def update_metadata(dataset_id: str, **changes: Any) -> dict[str, Any]:
    metadata = read_metadata(dataset_id) or {}
    metadata.update(changes)
    write_metadata(dataset_id, metadata)
    return metadata


def list_metadata() -> list[dict[str, Any]]:
    if not DATASETS_DIR.is_dir():
        return []
    result = []
    for entry in sorted(DATASETS_DIR.iterdir()):
        if DATASET_ID_PATTERN.match(entry.name):
            metadata = read_metadata(entry.name)
            if metadata:
                result.append(metadata)
    return sorted(result, key=lambda m: m.get("createdAt", ""))


def delete_dataset(dataset_id: str) -> None:
    shutil.rmtree(dataset_dir(dataset_id))
