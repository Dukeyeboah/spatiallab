"""
Validation of uploaded files. Nothing uploaded is ever executed; client file
names are only checked for their extension and kept as display text.

Each role has an allowed extension, a size limit and a content check:
    pointcloud      .las    "LASF" signature + readable LAS header, uncompressed
    poses           .csv    UTF-8 text (columns are validated by the converter)
    project         .json   valid JSON (schema not assumed; top-level keys recorded)
    control_points  .csv    UTF-8 text (schema not assumed; preserved for later)
    gnss            .csv    UTF-8 text (schema not assumed; preserved for later)
"""

import json
from pathlib import Path
from typing import Any

import laspy
from fastapi import UploadFile

MiB = 1024 * 1024
COPY_CHUNK = 4 * MiB

ROLE_RULES = {
    "pointcloud": {"extension": ".las", "max_bytes": 4096 * MiB},
    "poses": {"extension": ".csv", "max_bytes": 200 * MiB},
    "project": {"extension": ".json", "max_bytes": 10 * MiB},
    "control_points": {"extension": ".csv", "max_bytes": 200 * MiB},
    "gnss": {"extension": ".csv", "max_bytes": 200 * MiB},
}

# Helpful messages for formats people are likely to try.
KNOWN_UNSUPPORTED = {
    ".laz": "LAZ (compressed LAS) isn't supported yet. Decompress it to .las first "
    "(e.g. `pdal translate in.laz out.las` or `las2las -i in.laz -o out.las`).",
    ".ply": ".ply files (meshes or trained Gaussian splats) aren't supported in this lab. "
    "Point clouds must be .las.",
    ".splat": ".splat files are trained Gaussian splats, which this lab doesn't load yet.",
    ".ksplat": ".ksplat files are trained Gaussian splats, which this lab doesn't load yet.",
    ".e57": ".e57 isn't supported yet. Export the scan as .las.",
    ".xyz": "Plain-text .xyz point clouds aren't supported yet. Export the scan as .las.",
    ".pts": "Plain-text .pts point clouds aren't supported yet. Export the scan as .las.",
    ".obj": ".obj meshes aren't supported yet.",
    ".glb": ".glb meshes aren't supported yet.",
}


class UploadError(Exception):
    """A user-facing validation message."""


def check_extension(role: str, filename: str) -> None:
    rule = ROLE_RULES[role]
    extension = Path(filename or "").suffix.lower()
    if extension == rule["extension"]:
        return
    hint = KNOWN_UNSUPPORTED.get(extension, "")
    raise UploadError(
        f"{role.replace('_', ' ')}: expected a {rule['extension']} file, got "
        f"\"{Path(filename or '').name}\". {hint}".strip()
    )


async def save_upload(role: str, upload: UploadFile, destination: Path) -> int:
    """Stream an upload to disk, enforcing the size limit. Returns the size in bytes."""
    check_extension(role, upload.filename or "")
    limit = ROLE_RULES[role]["max_bytes"]
    size = 0
    with open(destination, "wb") as out:
        while chunk := await upload.read(COPY_CHUNK):
            size += len(chunk)
            if size > limit:
                raise UploadError(f"{role.replace('_', ' ')}: file is larger than {limit // MiB} MiB.")
            out.write(chunk)
    if size == 0:
        raise UploadError(f"{role.replace('_', ' ')}: the file is empty.")
    return size


def inspect_las(path: Path) -> dict[str, Any]:
    """Check that this really is an uncompressed LAS file; read header facts."""
    with open(path, "rb") as f:
        if f.read(4) != b"LASF":
            raise UploadError("point cloud: not a LAS file (missing the \"LASF\" signature).")
    try:
        with laspy.open(path) as reader:
            header = reader.header
            if reader.header.are_points_compressed:
                raise UploadError(KNOWN_UNSUPPORTED[".laz"])
            dimensions = set(header.point_format.dimension_names)
            georeferenced = any(
                vlr.user_id == "LASF_Projection" for vlr in list(header.vlrs) + list(reader.evlrs or [])
            )
            info = {
                "lasVersion": str(header.version),
                "pointFormat": header.point_format.id,
                "headerPointCount": int(header.point_count),
                "hasRgb": "red" in dimensions,
                # True if the file carries a coordinate reference system (CRS) record.
                "georeferenced": georeferenced,
            }
    except UploadError:
        raise
    except Exception as error:  # laspy raises various errors for broken files
        raise UploadError(f"point cloud: could not read the LAS header ({error}).") from error
    if info["headerPointCount"] == 0:
        raise UploadError("point cloud: the LAS file contains no points.")
    return info


def inspect_text_csv(role: str, path: Path) -> dict[str, Any]:
    """Generic CSV facts without assuming a schema: rows and the first line."""
    raw = path.read_bytes()
    if b"\x00" in raw:
        raise UploadError(f"{role.replace('_', ' ')}: binary data found; expected a text CSV.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise UploadError(f"{role.replace('_', ' ')}: not UTF-8 text.") from error
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise UploadError(f"{role.replace('_', ' ')}: no rows found.")
    return {
        "rows": len(lines),
        "firstLine": lines[0][:200],
        "columns": len(lines[0].split(",")),
    }


def inspect_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise UploadError(f"project metadata: not valid JSON ({error}).") from error
    keys = list(value.keys())[:50] if isinstance(value, dict) else []
    return {"topLevelType": type(value).__name__, "topLevelKeys": keys}
