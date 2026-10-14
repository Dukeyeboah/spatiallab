"""
Lab 13R: read-only access to XGRIDS camera extraction runs for the calibration
workspace. A run is a folder written by scripts/xgrids/extract_frames.py:

    <SPATIAL_LAB_XGRIDS_DIR>/<run>/manifest.csv
                                  /extraction-summary.json
                                  /seq03665_ch14_t1784111443....jpg ...

SPATIAL_LAB_XGRIDS_DIR is normally <recording>/reconstruction/xgrids/images,
i.e. outside the repository. Unset = no runs (the workspace explains how to
set it). Nothing is copied or written; only images named in a run's manifest
are served, and only from inside that run's folder.
"""

from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path
from typing import Optional

RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
IMAGE_NAME_PATTERN = re.compile(r"^seq\d{5,}_ch\d+_t\d+\.jpg$")
MAX_SAFE_INTEGER = 2**53 - 1  # JSON numbers must stay exact in JavaScript

MANIFEST_COLUMNS = {
    "image_file", "event_index", "pair_id", "sequence", "camera_channel", "timestamp_us", "timestamp_utc",
    "sps_offset", "h264_bytes", "decoder_status", "decoder_message", "jpeg_bytes", "jpeg_sha256", "width", "height",
    "pose_status", "pose_before_us", "pose_after_us", "pose_alpha",
    "scanner_x", "scanner_y", "scanner_z", "scanner_qx", "scanner_qy", "scanner_qz", "scanner_qw",
    "camera_extrinsics",
}

# Parsed runs, keyed by folder and the manifest's (mtime, size).
_cache: dict[str, tuple[tuple[int, int], dict]] = {}


class RunError(ValueError):
    """A run that doesn't look like extract_frames.py output."""


class RunNotFound(RunError):
    """No such run or image (or the folder isn't configured)."""


def root() -> Optional[Path]:
    value = os.environ.get("SPATIAL_LAB_XGRIDS_DIR", "").strip()
    return Path(value).expanduser().resolve() if value else None


def _run_dir(run_id: str) -> Path:
    base = root()
    if base is None or not RUN_ID_PATTERN.match(run_id):
        raise RunNotFound("Run not found.")
    folder = (base / run_id).resolve()
    if folder.parent != base or not (folder / "manifest.csv").is_file():
        raise RunNotFound("Run not found.")
    return folder


def list_runs() -> dict:
    base = root()
    if base is None:
        return {"configured": False, "runs": []}
    if not base.is_dir():
        return {"configured": True, "rootExists": False, "runs": []}
    runs = []
    for folder in sorted(base.iterdir()):
        if not (RUN_ID_PATTERN.match(folder.name) and (folder / "manifest.csv").is_file()):
            continue
        try:
            run = read_run(folder.name)
        except RunError as error:
            runs.append({"id": folder.name, "error": str(error)})
            continue
        runs.append({key: run[key] for key in ("id", "mode", "eventCount", "imageStatus", "source")})
    return {"configured": True, "rootExists": True, "runs": runs}


def _int(row: dict, column: str, line: int, optional: bool = False) -> Optional[int]:
    text = row[column]
    if text == "" and optional:
        return None
    try:
        value = int(text)
    except ValueError:
        raise RunError(f"manifest.csv line {line}: {column} {text!r} is not an integer") from None
    if abs(value) > MAX_SAFE_INTEGER:
        raise RunError(f"manifest.csv line {line}: {column} is too large to send exactly")
    return value


def _float(row: dict, column: str, line: int) -> Optional[float]:
    text = row[column]
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        raise RunError(f"manifest.csv line {line}: {column} {text!r} is not a number") from None


def read_run(run_id: str) -> dict:
    folder = _run_dir(run_id)
    manifest = folder / "manifest.csv"
    stat = manifest.stat()
    key = (stat.st_mtime_ns, stat.st_size)
    cached = _cache.get(str(folder))
    if cached and cached[0] == key:
        return cached[1]

    summary_path = folder / "extraction-summary.json"
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else {}
    except (OSError, json.JSONDecodeError) as error:
        raise RunError(f"extraction-summary.json is unreadable: {error}") from None
    source = summary.get("source", {})

    events: dict[int, dict] = {}
    with open(manifest, newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        missing = MANIFEST_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise RunError(f"manifest.csv lacks columns {sorted(missing)}")
        for row in reader:
            line = reader.line_num
            image_file = row["image_file"]
            if image_file and not IMAGE_NAME_PATTERN.match(image_file):
                raise RunError(f"manifest.csv line {line}: unexpected image name {image_file!r}")
            channel = row["camera_channel"]
            if not re.match(r"^ch\d+$", channel):
                raise RunError(f"manifest.csv line {line}: unexpected camera channel {channel!r}")
            position = [_float(row, f"scanner_{axis}", line) for axis in "xyz"]
            quaternion = [_float(row, f"scanner_q{axis}", line) for axis in "xyzw"]
            index = _int(row, "event_index", line)
            event = events.setdefault(index, {
                "index": index,
                "pairId": _int(row, "pair_id", line),
                "sequence": _int(row, "sequence", line),
                "images": {},
            })
            if channel in event["images"] or _int(row, "sequence", line) != event["sequence"]:
                raise RunError(f"manifest.csv line {line}: event {index} has a repeated channel or mixed sequences")
            event["images"][channel] = {
                "file": image_file or None,
                "timestampUs": _int(row, "timestamp_us", line),
                "timestampUtc": row["timestamp_utc"],
                "spsOffset": _int(row, "sps_offset", line),
                "h264Bytes": _int(row, "h264_bytes", line),
                "decoderStatus": row["decoder_status"],
                "decoderMessage": row["decoder_message"],
                "jpegBytes": _int(row, "jpeg_bytes", line, optional=True),
                "jpegSha256": row["jpeg_sha256"],
                "width": _int(row, "width", line, optional=True),
                "height": _int(row, "height", line, optional=True),
                "pose": {
                    "status": row["pose_status"],
                    "beforeUs": _int(row, "pose_before_us", line, optional=True),
                    "afterUs": _int(row, "pose_after_us", line, optional=True),
                    "alpha": _float(row, "pose_alpha", line),
                    "position": position if None not in position else None,
                    "quaternion": quaternion if None not in quaternion else None,
                },
                "extrinsics": row["camera_extrinsics"],
            }

    ordered = [events[i] for i in sorted(events)]
    run = {
        "id": run_id,
        "mode": summary.get("parameters", {}).get("mode"),
        "eventCount": len(ordered),
        "imageStatus": summary.get("imageStatus"),
        # File names and checksums only: absolute local paths stay on this machine.
        "source": {
            "xbin": Path(source["xbin"]).name if source.get("xbin") else None,
            "xbinBytes": source.get("bytes"),
            "framesSha256": source.get("framesSha256"),
            "poses": Path(source["poses"]).name if source.get("poses") else None,
            "posesSha256": source.get("posesSha256"),
        },
        "excludedOutsidePoseRange": summary.get("excludedOutsidePoseRange"),
        "notes": summary.get("notes", []),
        "events": ordered,
    }
    _cache[str(folder)] = (key, run)
    return run


def image_path(run_id: str, filename: str) -> Path:
    """An image of the run's manifest, inside the run's folder; RunError otherwise."""
    if not IMAGE_NAME_PATTERN.match(filename):
        raise RunNotFound("Image not found.")
    run = read_run(run_id)
    listed = {image["file"] for event in run["events"] for image in event["images"].values() if image["file"]}
    if filename not in listed:
        raise RunNotFound("Image not found.")
    folder = _run_dir(run_id)
    path = (folder / filename).resolve()
    if path.parent != folder or not path.is_file():
        raise RunNotFound("Image not found.")
    return path
