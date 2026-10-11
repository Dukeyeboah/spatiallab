"""
Cloud training package (Lab 10C, stage 1): the registered photos and the
COLMAP reconstruction of a finished pose job, checked and zipped for
training on a rented GPU (Nerfstudio splatfacto; any COLMAP-reading trainer).

    spatial-data/training/<trn_id>/exports/
        package.json            what was built: when, from which pose job, size, SHA-256
        <slug>-training-package.zip

    inside the zip, one folder <slug>/:
        images/<img_id>.jpg     the copies COLMAP solved (1600 px, upright), registered photos only;
                                EXIF/XMP blocks removed (no GPS can leave), pixels byte-identical
        sparse/0/*.bin          COLMAP's binary model, byte-for-byte (frame and calibration unchanged)
        manifest.json           provenance, image ↔ pose ↔ original file name, train/eval split
        README.md, setup_env.sh, train.sh, requirements-nerfstudio.lock.txt   (cloud_training/)
        SHA256SUMS              to verify the upload on the GPU machine (sha256sum -c SHA256SUMS)

Validation reads the files that are shipped (the binary model, the image
files), never the summary alone. Nothing in the project's source/ or work/
is modified.
"""

import hashlib
import json
import math
import re
import struct
import subprocess
import threading
import zipfile
from pathlib import Path
from typing import Any, Optional

import numpy as np
from PIL import Image

import training
import training_poses
from storage import now_iso

CLOUD_FILES = Path(__file__).parent / "cloud_training"
SUPPORT_FILES = ["README.md", "setup_env.sh", "train.sh", "requirements-nerfstudio.lock.txt"]
MODEL_FILES = ["cameras.bin", "images.bin", "points3D.bin"]
OPTIONAL_MODEL_FILES = ["rigs.bin", "frames.bin"]  # COLMAP 4; older readers ignore them
EVAL_INTERVAL = 8                  # Nerfstudio's --eval-mode interval default: every 8th image held out
MAX_SIDE_NO_DOWNSCALE = 1600       # Nerfstudio's COLMAP loader asks (interactively) to downscale above this
ZIP_ENTRY_OVERHEAD = 120           # bytes per file for zip headers (estimate)

# COLMAP camera model ids -> (name, parameter count). Nerfstudio reads all but FULL_OPENCV and the thin-prism models.
CAMERA_MODELS = {
    0: ("SIMPLE_PINHOLE", 3), 1: ("PINHOLE", 4), 2: ("SIMPLE_RADIAL", 4), 3: ("RADIAL", 5),
    4: ("OPENCV", 8), 5: ("OPENCV_FISHEYE", 8), 6: ("FULL_OPENCV", 12), 7: ("FOV", 5),
    8: ("SIMPLE_RADIAL_FISHEYE", 4), 9: ("RADIAL_FISHEYE", 5), 10: ("THIN_PRISM_FISHEYE", 12),
    11: ("RAD_TAN_THIN_PRISM_FISHEYE", 16),
}
NERFSTUDIO_MODELS = {"SIMPLE_PINHOLE", "PINHOLE", "SIMPLE_RADIAL", "RADIAL", "OPENCV", "OPENCV_FISHEYE"}

_building: set[str] = set()
_building_guard = threading.Lock()


class PackageError(Exception):
    """Shown to the user."""


def exports_dir(project_id: str) -> Path:
    return training.project_dir(project_id) / "exports"


def slug(name: str) -> str:
    """A folder/file name from the project name (display text is never used as a path otherwise)."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "project"


def is_building(project_id: str) -> bool:
    return project_id in _building


def read_record(project_id: str) -> Optional[dict[str, Any]]:
    path = exports_dir(project_id) / "package.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def package_path(project_id: str) -> Optional[Path]:
    record = read_record(project_id)
    path = exports_dir(project_id) / record["file"] if record else None
    return path if path and path.is_file() else None


# ---------------------------------------------------------------------------
# COLMAP's binary model (https://colmap.github.io/format.html#binary-file-format)


def read_cameras_bin(path: Path) -> dict[int, dict[str, Any]]:
    data = path.read_bytes()
    (count,), offset = struct.unpack_from("<Q", data, 0), 8
    cameras = {}
    for _ in range(count):
        camera_id, model_id, width, height = struct.unpack_from("<iiQQ", data, offset)
        offset += 24
        if model_id not in CAMERA_MODELS:
            raise PackageError(f"cameras.bin: unknown camera model id {model_id}.")
        name, n = CAMERA_MODELS[model_id]
        params = struct.unpack_from(f"<{n}d", data, offset)
        offset += 8 * n
        cameras[camera_id] = {"model": name, "width": width, "height": height, "params": list(params)}
    return cameras


def read_images_bin(path: Path) -> dict[int, dict[str, Any]]:
    data = path.read_bytes()
    (count,), offset = struct.unpack_from("<Q", data, 0), 8
    images = {}
    for _ in range(count):
        image_id, qw, qx, qy, qz, tx, ty, tz, camera_id = struct.unpack_from("<i7di", data, offset)
        offset += 64
        end = data.index(b"\x00", offset)
        name = data[offset:end].decode("utf-8")
        offset = end + 1
        (n2d,) = struct.unpack_from("<Q", data, offset)
        offset += 8
        # Per 2D point: x, y (double) and the 3D point id (int64, -1 = none).
        points = np.frombuffer(data, dtype=[("x", "<f8"), ("y", "<f8"), ("id", "<i8")], count=n2d, offset=offset)
        offset += 24 * n2d
        images[image_id] = {"q": (qw, qx, qy, qz), "t": (tx, ty, tz), "cameraId": camera_id, "name": name,
                            "points2D": n2d, "point3DIds": points["id"]}
    return images


def read_points_bin(path: Path) -> dict[str, Any]:
    """Point count, mean error, and every track entry (image id, 2D point index)."""
    data = path.read_bytes()
    (count,), offset = struct.unpack_from("<Q", data, 0), 8
    ids, errors, track_images, track_points = [], [], [], []
    xyz_finite = True
    for _ in range(count):
        point_id, x, y, z = struct.unpack_from("<Q3d", data, offset)
        offset += 32 + 3  # + RGB
        error, length = struct.unpack_from("<dQ", data, offset)
        offset += 16
        track = np.frombuffer(data, dtype=[("image", "<i4"), ("point2D", "<i4")], count=length, offset=offset)
        offset += 8 * length
        ids.append(point_id)
        errors.append(error)
        track_images.append(track["image"])
        track_points.append(track["point2D"])
        xyz_finite = xyz_finite and math.isfinite(x + y + z)
    return {
        "ids": np.array(ids, dtype=np.int64),
        "errors": np.array(errors),
        "trackImages": np.concatenate(track_images) if track_images else np.array([], dtype=np.int32),
        "trackPoints": np.concatenate(track_points) if track_points else np.array([], dtype=np.int32),
        "finite": xyz_finite,
    }


# ---------------------------------------------------------------------------
# JPEG metadata removal without re-encoding


METADATA_PREFIXES = (b"Exif\x00\x00", b"http://ns.adobe.com/xap/1.0/\x00", b"http://ns.adobe.com/xmp/extension/\x00")


def strip_jpeg_metadata(data: bytes) -> bytes:
    """
    Drop APP1 segments holding EXIF or XMP (where GPS, dates and device data
    live). Every other segment and the compressed image data are copied
    unchanged, so the decoded pixels are identical. Raises PackageError if the
    file isn't a well-formed JPEG.
    """
    if data[:2] != b"\xff\xd8":
        raise PackageError("not a JPEG file")
    out, offset = bytearray(b"\xff\xd8"), 2
    while offset < len(data):
        if data[offset] != 0xFF:
            raise PackageError("malformed JPEG segment")
        marker = data[offset + 1]
        if marker == 0xFF:  # fill byte
            offset += 1
            continue
        if marker == 0xDA:  # start of scan: the rest is image data
            out += data[offset:]
            return bytes(out)
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:  # markers without a length
            out += data[offset:offset + 2]
            offset += 2
            continue
        (length,) = struct.unpack_from(">H", data, offset + 2)
        segment = data[offset:offset + 2 + length]
        if not (marker == 0xE1 and segment[4:].startswith(METADATA_PREFIXES)):
            out += segment
        offset += 2 + length
    raise PackageError("JPEG without image data")


def has_gps(path: Path) -> bool:
    with Image.open(path) as img:
        return len(img.getexif().get_ifd(0x8825)) > 0


# ---------------------------------------------------------------------------
# Validation and size report


def check(checks: list[dict[str, str]], key: str, label: str, level: str, detail: str) -> None:
    checks.append({"key": key, "label": label, "level": level, "detail": detail})


def inspect(project: dict[str, Any]) -> dict[str, Any]:
    """
    Everything the export would contain, and whether it is sound. Each check
    is "ok", "warn" (exportable, read the note) or "fail" (export refused).
    """
    project_id = project["id"]
    job = training_poses.view(project)
    checks: list[dict[str, str]] = []
    result: dict[str, Any] = {"checks": checks, "ready": False, "images": [], "excluded": []}

    if not job or job["status"] != "done" or not job.get("summary"):
        check(checks, "poses", "Camera poses", "fail", "Estimate camera poses first (Lab 10B).")
        return result
    if job["outdated"]:
        check(checks, "poses", "Camera poses", "fail",
              "Photos were added or removed after the poses were estimated. Run pose estimation again.")
        return result
    summary = job["summary"]
    check(checks, "poses", "Camera poses", "ok", f"Pose job finished {job['finishedAt']}; the photo set hasn't changed since.")

    folder = training_poses.poses_dir(project_id)
    model_dir = folder / summary["modelPath"].removeprefix("work/poses/")
    missing = [f for f in MODEL_FILES if not (model_dir / f).is_file()]
    if missing:
        check(checks, "model", "One reconstruction", "fail", f"{summary['modelPath']} lacks {', '.join(missing)}.")
        return result
    groups = summary["models"]
    if len(groups) > 1:
        check(checks, "model", "One reconstruction", "warn",
              f"COLMAP made {len(groups)} unconnected groups ({', '.join(map(str, groups))} photos). Only the largest "
              f"({summary['modelPath']}) is exported; the others can't share one coordinate frame with it.")
    else:
        check(checks, "model", "One reconstruction", "ok",
              f"All {summary['registered']} placed photos belong to one connected model ({summary['modelPath']}).")

    cameras = read_cameras_bin(model_dir / "cameras.bin")
    images = read_images_bin(model_dir / "images.bin")
    points = read_points_bin(model_dir / "points3D.bin")

    # Intrinsics: every camera usable by Nerfstudio, finite, principal point inside the image.
    problems = []
    for cid, cam in cameras.items():
        p = cam["params"]
        if cam["model"] not in NERFSTUDIO_MODELS:
            problems.append(f"camera {cid} uses {cam['model']}, which Nerfstudio can't read")
        if not all(math.isfinite(v) for v in p) or p[0] <= 0:
            problems.append(f"camera {cid} has invalid parameters")
        cx, cy = (p[1], p[2]) if cam["model"] in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL", "RADIAL") else (p[2], p[3])
        if not (0 < cx < cam["width"] and 0 < cy < cam["height"]):
            problems.append(f"camera {cid}'s principal point lies outside the image")
    models_used = {cameras[i["cameraId"]]["model"] for i in images.values() if i["cameraId"] in cameras}
    if len(models_used) > 1:
        problems.append(f"several camera models ({', '.join(sorted(models_used))}); Nerfstudio needs one")
    lenses = "; ".join(f"{c['model']} {c['width']}×{c['height']}, fx {c['params'][0]:.1f} px" for c in cameras.values())
    check(checks, "intrinsics", "Lens calibration (intrinsics)", "fail" if problems else "ok",
          "; ".join(problems) if problems else f"{len(cameras)} lens: {lenses}, distortion included.")

    # Extrinsics: a valid rotation and translation per registered photo, and a known lens.
    bad = [i["name"] for i in images.values()
           if i["cameraId"] not in cameras or not all(math.isfinite(v) for v in i["q"] + i["t"])
           or abs(math.sqrt(sum(v * v for v in i["q"])) - 1) > 1e-6]
    check(checks, "extrinsics", "Camera poses (extrinsics)", "fail" if bad else "ok",
          f"Invalid pose or lens for {', '.join(bad[:5])}." if bad
          else f"{len(images)} poses, each a unit quaternion + translation (world → camera) with a known lens.")

    # Sparse points: present, finite, and every observation points at a registered photo's 2D feature.
    track_images, track_points = points["trackImages"], points["trackPoints"]
    feature_counts = np.zeros(max(images, default=0) + 1, dtype=np.int64)  # COLMAP image id -> its 2D feature count
    for k, v in images.items():
        feature_counts[k] = v["points2D"]
    in_model = (track_images >= 0) & (track_images < len(feature_counts))
    in_model[in_model] = feature_counts[track_images[in_model]] > 0
    index_ok = bool(in_model.all()) and bool(((track_points >= 0) & (track_points < feature_counts[track_images])).all())
    referenced = np.unique(np.concatenate([i["point3DIds"][i["point3DIds"] >= 0] for i in images.values()]))
    dangling = int(np.count_nonzero(~np.isin(referenced, points["ids"])))
    points_ok = len(points["ids"]) > 0 and points["finite"] and index_ok and dangling == 0
    check(checks, "points", "Sparse points", "ok" if points_ok else "fail",
          f"{len(points['ids']):,} points, mean error {points['errors'].mean():.3f} px, {len(points['trackImages']):,} "
          "observations, all linked to placed photos (splatfacto starts its Gaussians from these)." if points_ok
          else "The point file is empty, has invalid coordinates, or references photos/features that don't exist.")

    # Images: every registered name is a file whose size matches its lens, and a current project photo.
    by_id = {i["id"]: i for i in project["images"]}
    image_problems, gps, largest = [], 0, 0
    entries = []
    for colmap_id in sorted(images):
        info = images[colmap_id]
        path = folder / "images" / info["name"]
        image_id = info["name"].rsplit(".", 1)[0]
        if image_id not in by_id:
            image_problems.append(f"{info['name']} isn't a photo of this project")
            continue
        if not path.is_file():
            image_problems.append(f"{info['name']} is missing")
            continue
        with Image.open(path) as img:
            size, fmt = img.size, img.format
        cam = cameras.get(info["cameraId"])
        if fmt != "JPEG" or not cam or size != (cam["width"], cam["height"]):
            image_problems.append(f"{info['name']} is {size[0]}×{size[1]} {fmt}, its lens says "
                                  f"{cam['width']}×{cam['height']}" if cam else f"{info['name']} has no lens")
            continue
        gps += has_gps(path)
        largest = max(largest, *size)
        head = path.read_bytes()
        stripped = len(strip_jpeg_metadata(head))
        entries.append({"colmapImageId": colmap_id, "file": f"images/{info['name']}", "imageId": image_id,
                        "originalFilename": by_id[image_id]["filename"], "width": size[0], "height": size[1],
                        "observations": int(np.count_nonzero(info["point3DIds"] >= 0)), "bytes": stripped})
    names = [i["name"] for i in images.values()]
    if len(set(names)) != len(names):
        image_problems.append("two poses share one image name")
    check(checks, "images", "Photos for every pose", "fail" if image_problems else "ok",
          "; ".join(image_problems[:5]) if image_problems
          else f"All {len(entries)} files exist, match their lens size and map one-to-one to this project's photos "
               "(file name = photo id; the original file names are in manifest.json).")

    # Nerfstudio reads the images as they are when the longer side is ≤ 1600 px (no resampling, intrinsics untouched).
    check(checks, "resolution", "Resolution for Nerfstudio", "ok" if largest <= MAX_SIDE_NO_DOWNSCALE else "warn",
          f"Longer side {largest} px: Nerfstudio uses the photos at the size COLMAP calibrated (downscale factor 1)."
          if largest <= MAX_SIDE_NO_DOWNSCALE else
          f"Longer side {largest} px: pass --downscale-factor explicitly or Nerfstudio stops to ask.")

    check(checks, "frame", "Coordinate frame and calibration", "ok",
          "The model files are copied byte-for-byte: COLMAP's own frame (arbitrary origin, orientation and scale) "
          "and calibration are preserved. Nerfstudio re-centres and re-orients them when training and records how "
          "in dataparser_transforms.json; keep that file with the result.")

    # Train/eval split: Nerfstudio sorts by COLMAP image id and holds out every 8th (index 0, 8, 16, …).
    for k, entry in enumerate(entries):
        entry["split"] = "eval" if k % EVAL_INTERVAL == 0 else "train"
    evals = sum(1 for e in entries if e["split"] == "eval")
    check(checks, "split", "Photos held out for evaluation", "ok",
          f"{evals} of {len(entries)} photos (every {EVAL_INTERVAL}th by COLMAP image id) are not trained on; the "
          "trained scene is rendered from their poses and compared with them (PSNR/SSIM/LPIPS).")

    check(checks, "privacy", "Metadata leaving this computer", "ok",
          ("EXIF/XMP blocks are removed from the packaged copies without re-encoding (pixels identical). "
           + (f"{gps} of them contained GPS positions." if gps else "None of them contains GPS positions.")))

    excluded = [{"imageId": i, "originalFilename": by_id[i]["filename"] if i in by_id else i,
                 "reason": "not placed by COLMAP (no pose)"} for i in summary["notRegistered"]]
    check(checks, "excluded", "Photos left out", "ok",
          f"{len(excluded)} photo(s) without a pose are not included: Nerfstudio's COLMAP loader only reads posed photos."
          if excluded else "Every photo has a pose.")

    model_files = [f for f in MODEL_FILES + OPTIONAL_MODEL_FILES if (model_dir / f).is_file()]
    model_bytes = sum((model_dir / f).stat().st_size for f in model_files)
    image_bytes = sum(e["bytes"] for e in entries)
    support_bytes = sum((CLOUD_FILES / f).stat().st_size for f in SUPPORT_FILES)
    manifest_estimate = 400 * len(entries) + 4000
    files = len(entries) + len(model_files) + len(SUPPORT_FILES) + 2
    result.update(
        ready=not any(c["level"] == "fail" for c in checks),
        images=entries,
        excluded=excluded,
        modelDir=model_dir,
        modelFiles=model_files,
        cameras=cameras,
        summary=summary,
        job=job,
        estimate={"images": image_bytes, "model": model_bytes, "other": support_bytes + manifest_estimate,
                  "total": image_bytes + model_bytes + support_bytes + manifest_estimate + files * ZIP_ENTRY_OVERHEAD,
                  "files": files, "imageCount": len(entries), "evalCount": evals},
    )
    return result


def view(project: dict[str, Any]) -> dict[str, Any]:
    """What the API returns: the checks, the size estimate, and the built package (if any)."""
    report = inspect(project)
    record = read_record(project["id"])
    job = report.get("job")
    if record:
        record = {**record, "outdated": not job or job.get("outdated") or record["poseJobFinishedAt"] != job["finishedAt"],
                  "available": package_path(project["id"]) is not None}
    return {
        "checks": report["checks"],
        "ready": report["ready"],
        "estimate": report.get("estimate"),
        "evalImages": [e["imageId"] for e in report["images"] if e.get("split") == "eval"],
        "built": record,
        "building": is_building(project["id"]),
    }


# ---------------------------------------------------------------------------
# Building the zip


def colmap_version() -> Optional[str]:
    binary = training_poses.colmap_binary()
    if not binary:
        return None
    try:
        out = subprocess.run([binary, "help"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.splitlines()[0].strip() if out else None


def manifest(project: dict[str, Any], report: dict[str, Any], checksums: dict[str, str]) -> dict[str, Any]:
    summary, job = report["summary"], report["job"]
    return {
        "schemaVersion": 1,
        "kind": "spatial-lab-training-package",
        "createdAt": now_iso(),
        "project": {"id": project["id"], "name": project["name"]},
        "poses": {
            "finishedAt": job["finishedAt"],
            "settings": job["settings"],
            "colmapAtExport": colmap_version(),
            "registered": summary["registered"],
            "photos": summary["imageCount"],
            "points": summary["points"],
            "meanReprojectionErrorPx": summary["meanReprojectionErrorPx"],
            "meanTrackLength": summary["meanTrackLength"],
            "groups": summary["models"],
            "modelPath": summary["modelPath"],
        },
        "frame": "COLMAP world as solved: arbitrary origin, orientation and scale (no GPS, no LiDAR link). Unchanged.",
        "layout": {"images": "images/", "colmap": "sparse/0/ (COLMAP binary, byte-for-byte)"},
        "cameras": {str(k): v for k, v in report["cameras"].items()},
        "split": {
            "rule": f"Nerfstudio --eval-mode interval --eval-interval {EVAL_INTERVAL}: images sorted by COLMAP image "
                    f"id, every {EVAL_INTERVAL}th (index 0, {EVAL_INTERVAL}, …) is held out for evaluation",
            "train": sum(1 for e in report["images"] if e["split"] == "train"),
            "eval": sum(1 for e in report["images"] if e["split"] == "eval"),
        },
        "images": [{k: v for k, v in e.items() if k != "bytes"} | {"sha256": checksums[e["file"]]} for e in report["images"]],
        "excluded": report["excluded"],
        "privacy": "EXIF/XMP removed from images/ without re-encoding; original photos are not included.",
        "trainer": {"name": "nerfstudio", "version": "1.1.5", "method": "splatfacto", "gsplat": "1.4.0",
                    "torch": "2.1.2+cu118", "presets": {"quick": {"iterations": 7000}, "quality": {"iterations": 30000}}},
        "files": checksums,
    }


def build(project: dict[str, Any]) -> dict[str, Any]:
    """Write the zip (replacing an earlier one). Raises PackageError."""
    project_id = project["id"]
    with _building_guard:
        if project_id in _building:
            raise PackageError("A package is already being built for this project.")
        _building.add(project_id)
    try:
        report = inspect(project)
        if not report["ready"]:
            failed = [c["label"] for c in report["checks"] if c["level"] == "fail"]
            raise PackageError(f"The package can't be built: {', '.join(failed)} failed. See the checks.")
        training.check_disk(report["estimate"]["total"])
        root = slug(project["name"])
        out = exports_dir(project_id)
        out.mkdir(exist_ok=True)
        tmp = out / ".building.zip"
        checksums: dict[str, str] = {}

        # JPEGs and binary models don't compress: stored, so the zip is fast to write and to open.
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            def add(name: str, data: bytes) -> None:
                checksums[name] = hashlib.sha256(data).hexdigest()
                archive.writestr(f"{root}/{name}", data)

            source = training_poses.poses_dir(project_id) / "images"
            for entry in report["images"]:
                add(entry["file"], strip_jpeg_metadata((source / Path(entry["file"]).name).read_bytes()))
            for name in report["modelFiles"]:
                add(f"sparse/0/{name}", (report["modelDir"] / name).read_bytes())
            for name in SUPPORT_FILES:
                text = (CLOUD_FILES / name).read_text(encoding="utf-8")
                add(name, text.replace("{{NAME}}", project["name"]).replace("{{SLUG}}", root).encode("utf-8"))
            add("manifest.json", json.dumps(manifest(project, report, dict(checksums)), indent=2).encode("utf-8"))
            sums = "".join(f"{digest}  {name}\n" for name, digest in sorted(checksums.items()))
            archive.writestr(f"{root}/SHA256SUMS", sums)

        filename = f"{root}-training-package.zip"
        digest = hashlib.sha256()
        with open(tmp, "rb") as f:
            while chunk := f.read(4 * training.MiB):
                digest.update(chunk)
        for old in out.glob("*.zip"):
            if old != tmp:
                old.unlink()
        tmp.replace(out / filename)
        record = {
            "createdAt": now_iso(),
            "file": filename,
            "folder": root,
            "bytes": (out / filename).stat().st_size,
            "sha256": digest.hexdigest(),
            "poseJobFinishedAt": report["job"]["finishedAt"],
            "imageCount": len(report["images"]),
            "evalCount": report["estimate"]["evalCount"],
            "excludedCount": len(report["excluded"]),
        }
        (out / "package.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
        return record
    except BaseException:
        (exports_dir(project_id) / ".building.zip").unlink(missing_ok=True)
        raise
    finally:
        _building.discard(project_id)
