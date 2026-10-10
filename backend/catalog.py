"""
Properties and captures: how datasets are organised.

    Property  a real-world place (a resort, a house, a gallery)
      Capture   one scanning / photography session at that property
        Representations   what that session produced: "lidar" (an imported
                          LiDAR dataset, ds_...) or "gaussian-splat" (a
                          trained splat scene, spl_..., Lab 8); later photos,
                          meshes...

Stored in spatial-data/catalog.json, separate from the datasets:

    {
      "schemaVersion": 1,
      "properties": [{ "id": "prop_<12 hex>", "name", "createdAt",
                       "frame": null }],
      "captures":   [{ "id": "cap_<12 hex>", "propertyId", "name", "createdAt",
                       "environment": null,
                       "representations": [{ "kind": "lidar", "datasetId": "ds_..." },
                                           { "kind": "gaussian-splat", "datasetId": "spl_..." }],
                       "alignment": { "status": "unaligned", "method": null,
                                      "reference": null, "transform": null } }]
    }

Rules:
  - The catalog only REFERENCES datasets. Dataset folders, metadata.json,
    offsets and converted files are never copied, moved or changed by it.
  - A dataset belongs to at most one capture (assigning it elsewhere moves it).
    Datasets in no capture are "unassigned"; no catalog.json = all unassigned.
  - Deleting a property or capture never deletes files: its datasets become
    unassigned. Only DELETE /datasets/{id} removes files (and its reference here).
  - Captures are never merged and are not assumed to share a coordinate frame.
    Each dataset keeps its own offset. "alignment" (a capture -> property
    transform, how it was obtained, against what) and the property's "frame"
    (its common coordinate system) are reserved for future registration and
    stay empty/"unaligned" until then. "environment" is reserved for
    indoor/outdoor organisation.
"""

import json
import os
import re
import secrets
import tempfile
import threading
from contextlib import contextmanager
from typing import Any, Iterator

from splats import SPLAT_ID_PATTERN
from storage import DATA_DIR, DATASET_ID_PATTERN, now_iso

CATALOG_FILE = DATA_DIR / "catalog.json"
CATALOG_SCHEMA_VERSION = 1
PROPERTY_ID_PATTERN = re.compile(r"^prop_[0-9a-f]{12}$")
CAPTURE_ID_PATTERN = re.compile(r"^cap_[0-9a-f]{12}$")
# The built-in sample (public/data) can be organised too; it is never deleted.
BUILTIN_DATASET_ID = "builtin-map"
MAX_NAME_LENGTH = 80

# One request at a time edits the file (FastAPI runs sync endpoints in threads).
_lock = threading.Lock()


class CatalogError(Exception):
    """A request that can't be applied (unknown id, bad name). Message is shown to the user."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def empty_catalog() -> dict[str, Any]:
    return {"schemaVersion": CATALOG_SCHEMA_VERSION, "properties": [], "captures": []}


def load() -> dict[str, Any]:
    if not CATALOG_FILE.is_file():
        return empty_catalog()
    return json.loads(CATALOG_FILE.read_text(encoding="utf-8"))


def _save(catalog: dict[str, Any]) -> None:
    """Atomic write (temp file + rename), as for metadata.json."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".catalog-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    os.replace(tmp, CATALOG_FILE)


@contextmanager
def editing() -> Iterator[dict[str, Any]]:
    """Read, let the caller change, write back; nothing is written if the caller raises."""
    with _lock:
        catalog = load()
        yield catalog
        _save(catalog)


def clean_name(name: str) -> str:
    name = " ".join(name.split())  # collapse whitespace, drop newlines/control spacing
    if not 1 <= len(name) <= MAX_NAME_LENGTH:
        raise CatalogError(f"Name must be 1–{MAX_NAME_LENGTH} characters.")
    return name


def find_property(catalog: dict[str, Any], property_id: str) -> dict[str, Any]:
    if PROPERTY_ID_PATTERN.match(property_id):
        for prop in catalog["properties"]:
            if prop["id"] == property_id:
                return prop
    raise CatalogError("Property not found.", 404)


def find_capture(catalog: dict[str, Any], capture_id: str) -> dict[str, Any]:
    if CAPTURE_ID_PATTERN.match(capture_id):
        for capture in catalog["captures"]:
            if capture["id"] == capture_id:
                return capture
    raise CatalogError("Capture not found.", 404)


def is_splat_reference(dataset_id: str) -> bool:
    return bool(SPLAT_ID_PATTERN.match(dataset_id))


def is_dataset_reference(dataset_id: str) -> bool:
    """A LiDAR dataset, the built-in sample, or a Gaussian splat scene."""
    return dataset_id == BUILTIN_DATASET_ID or bool(DATASET_ID_PATTERN.match(dataset_id)) or is_splat_reference(dataset_id)


# ---------------------------------------------------------------------------
# Changes (each called inside `with editing() as catalog:`)


def add_property(catalog: dict[str, Any], name: str) -> dict[str, Any]:
    prop = {
        "id": "prop_" + secrets.token_hex(6),
        "name": clean_name(name),
        "createdAt": now_iso(),
        # Future: the property's common coordinate system (e.g. a CRS or a
        # chosen reference capture). None until registration exists.
        "frame": None,
    }
    catalog["properties"].append(prop)
    return prop


def delete_property(catalog: dict[str, Any], property_id: str) -> list[str]:
    """Removes the property and its captures. Returns the dataset ids that become unassigned."""
    find_property(catalog, property_id)
    removed = [c for c in catalog["captures"] if c["propertyId"] == property_id]
    catalog["captures"] = [c for c in catalog["captures"] if c["propertyId"] != property_id]
    catalog["properties"] = [p for p in catalog["properties"] if p["id"] != property_id]
    return [r["datasetId"] for c in removed for r in c["representations"]]


def add_capture(catalog: dict[str, Any], property_id: str, name: str) -> dict[str, Any]:
    find_property(catalog, property_id)
    capture = {
        "id": "cap_" + secrets.token_hex(6),
        "propertyId": property_id,
        "name": clean_name(name),
        "createdAt": now_iso(),
        # Future: "indoor" | "outdoor" | ... for scene organisation.
        "environment": None,
        # What this session produced. A list, so photos, splats and meshes can
        # sit next to the LiDAR dataset later.
        "representations": [],
        # Future: transform from this capture's own frame into the property
        # frame (e.g. a 4x4 matrix), how it was found (registration, control
        # points) and against which reference. Never applied today.
        "alignment": {"status": "unaligned", "method": None, "reference": None, "transform": None},
    }
    catalog["captures"].append(capture)
    return capture


def delete_capture(catalog: dict[str, Any], capture_id: str) -> list[str]:
    """Removes the capture. Returns the dataset ids that become unassigned."""
    capture = find_capture(catalog, capture_id)
    catalog["captures"] = [c for c in catalog["captures"] if c["id"] != capture_id]
    return [r["datasetId"] for r in capture["representations"]]


def assign_dataset(catalog: dict[str, Any], capture_id: str, dataset_id: str) -> None:
    """Adds a dataset or splat scene to a capture, removing it from any other capture first."""
    capture = find_capture(catalog, capture_id)
    unassign_dataset(catalog, dataset_id)
    kind = "gaussian-splat" if is_splat_reference(dataset_id) else "lidar"
    capture["representations"].append({"kind": kind, "datasetId": dataset_id})


def unassign_dataset(catalog: dict[str, Any], dataset_id: str) -> None:
    """Removes every reference to the dataset (no files are touched)."""
    for capture in catalog["captures"]:
        capture["representations"] = [r for r in capture["representations"] if r.get("datasetId") != dataset_id]
