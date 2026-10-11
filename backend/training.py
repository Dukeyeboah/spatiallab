"""
Training projects (Lab 10A): photographs of a physical space, prepared for
Gaussian splatting training. A separate store from LiDAR datasets and
trained Gaussian scenes:

    spatial-data/training/<trn_id>/
        project.json            name, images (validated facts), rejected files, planned stages
        source/<img_id>.jpg|png|heic   the photographs as uploaded (never served, never modified)
        thumbs/<img_id>.jpg     320 px previews (the only image files served)
        work/                   Lab 10B jobs: poses.json + poses/ (training_poses.py)
        exports/                Lab 10C: the cloud training package zip + package.json (training_package.py)
        output/                 reserved for trained results (PLY/SOG)

Photographs are only inspected here. The checks (resolution, a blur
heuristic, duplicates, dimensions) are warnings, never reasons to reject a
readable photo, and they say nothing about whether the photos overlap enough
for pose estimation or cover the space: only Lab 10B's structure-from-motion
step can tell that.

Client file names are display text only; files are stored under generated
ids. Content decides the format (Pillow), not the extension.
"""

import hashlib
import json
import secrets
import shutil
import statistics
import struct
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

import numpy as np
import pillow_heif
from PIL import Image, ImageOps

from storage import DATA_DIR, now_iso

# Lets Pillow open HEIC/HEIF (iPhone photos). Format name "HEIF"; the rotation is
# applied while decoding (EXIF orientation reads 1, the original is in info["original_orientation"]).
pillow_heif.register_heif_opener()

TRAINING_DIR = DATA_DIR / "training"
PROJECT_ID_PREFIX, IMAGE_ID_PREFIX = "trn_", "img_"
SCHEMA_VERSION = 1

MiB = 1024 * 1024
GiB = 1024 * MiB
MAX_IMAGE_BYTES = 64 * MiB
MAX_IMAGES = 2000
MAX_PIXELS = 120_000_000           # larger images are refused (decompression-bomb guard)
MIN_FREE_DISK = 2 * GiB            # refuse uploads that would leave less than this free
MAX_REJECTED_KEPT = 200
THUMB_SIZE = 320
# Pillow refuses images above 2 × MAX_IMAGE_PIXELS (it only warns between 1× and 2×).
Image.MAX_IMAGE_PIXELS = MAX_PIXELS // 2

ACCEPTED_EXTENSIONS = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".heic": "HEIF", ".heif": "HEIF"}
STORED_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "HEIF": ".heic"}
EXTENSION_HINTS = {
    ".dng": "RAW photos aren't supported: export them as JPG.",
    ".mov": "Videos aren't supported yet: extract frames as JPG first (e.g. ffmpeg -i video.mov -vf fps=2 frame_%04d.jpg).",
    ".mp4": "Videos aren't supported yet: extract frames as JPG first (e.g. ffmpeg -i video.mp4 -vf fps=2 frame_%04d.jpg).",
}

# Warning thresholds (heuristics; see docs/SPATIAL_LAB_REBUILD_GUIDE.md section 5.9).
LOW_RES_SHORT_SIDE = 1000          # px; phones give ~3000, structure from motion wants detail
VERY_LOW_RES_SHORT_SIDE = 480
SHARPNESS_SIDE = 1024              # sharpness is measured at this size, so resolutions compare
BLUR_ABSOLUTE = 30.0               # variance of the Laplacian below this: likely blurry anywhere
BLUR_RELATIVE = 0.35               # ... or below 35% of this project's median (with >= 5 photos)
NEAR_DUPLICATE_BITS = 4            # dHash bits that may differ (of 64)

STAGES = [
    {
        "key": "preprocess",
        "title": "Image preprocessing",
        "detail": "Apply EXIF orientation, convert HEIC to JPG (COLMAP and the trainers don't read HEIC), "
                  "downscale to the training resolution (e.g. 1600 px), leave out the photos you removed; "
                  "optional masks for moving objects.",
        "tools": ["Pillow", "pillow-heif"],
        "output": "work/poses/images/",
    },
    {
        "key": "poses",
        "title": "Camera pose estimation (structure from motion)",
        "detail": "Find matching features between photos and solve every camera's position, "
                  "orientation and lens, plus a sparse point cloud. Fails or drops photos when "
                  "overlap is insufficient; this is where coverage is actually tested.",
        "tools": ["COLMAP"],
        "output": "work/poses/sparse/<n>/ (cameras, images, points3D)",
    },
    {
        "key": "train",
        "title": "Gaussian training",
        "detail": "Optimise millions of Gaussians (position, scale, rotation, opacity, SH colour) "
                  "until renders from the solved cameras match the photos. Needs an NVIDIA GPU: done on a rented "
                  "one from the exported package (Lab 10C), never on this Mac.",
        "tools": ["Nerfstudio 1.1.5 splatfacto (gsplat 1.4.0, CUDA 11.8) on a cloud GPU"],
        "output": "exports/<name>-training-package.zip → the GPU machine's result folder",
    },
    {
        "key": "export",
        "title": "Export to Gaussian PLY",
        "detail": "Write the trained Gaussians in the 3DGS PLY layout read by Labs 8 and 9.",
        "tools": ["ns-export gaussian-splat"],
        "output": "splat.ply (+ run.json, eval.json), imported into the Gaussian scene store",
    },
    {
        "key": "sog",
        "title": "Convert to SOG (optional)",
        "detail": "Compress the PLY for fast viewing (about 15× smaller).",
        "tools": ["SplatTransform"],
        "output": "output/scene.sog",
    },
]


class TrainingError(Exception):
    """Shown to the user (HTTP 400)."""


class ImageRejected(Exception):
    """One file refused; the upload continues with the others."""


# ---------------------------------------------------------------------------
# Store


def new_id(prefix: str) -> str:
    return prefix + secrets.token_hex(6)


def valid_id(value: str, prefix: str) -> bool:
    rest = value[len(prefix):]
    return value.startswith(prefix) and len(rest) == 12 and all(c in "0123456789abcdef" for c in rest)


def project_dir(project_id: str) -> Path:
    """Raises ValueError for anything that isn't a valid project id."""
    if not valid_id(project_id, PROJECT_ID_PREFIX):
        raise ValueError("invalid project id")
    return TRAINING_DIR / project_id


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


@contextmanager
def editing(project_id: str) -> Iterator[dict[str, Any]]:
    """Read-modify-write of project.json under a per-project lock; written atomically."""
    with _locks_guard:
        lock = _locks.setdefault(project_id, threading.Lock())
    with lock:
        project = read_project(project_id)
        if project is None:
            raise KeyError(project_id)
        yield project
        write_project(project)


def read_project(project_id: str) -> Optional[dict[str, Any]]:
    path = project_dir(project_id) / "project.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_project(project: dict[str, Any]) -> None:
    folder = project_dir(project["id"])
    tmp = folder / ".project.tmp"
    tmp.write_text(json.dumps(project, indent=2), encoding="utf-8")
    tmp.replace(folder / "project.json")


def create_project(name: str) -> dict[str, Any]:
    project_id = new_id(PROJECT_ID_PREFIX)
    folder = project_dir(project_id)
    for sub in ("source", "thumbs"):
        (folder / sub).mkdir(parents=True)
    project = {
        "schemaVersion": SCHEMA_VERSION,
        "id": project_id,
        "name": name,
        "kind": "training-project",
        "createdAt": now_iso(),
        "images": [],
        "rejected": [],               # [{"filename", "reason", "at"}], newest last
        # Reserved: the property/capture these photos document (set through the
        # catalog later). Like LiDAR and splat scenes, never assumed.
        "association": {"propertyId": None, "captureId": None},
        # Lab 10B fills this with real jobs; nothing here is simulated.
        "jobs": [],
    }
    write_project(project)
    return project


def list_projects() -> list[dict[str, Any]]:
    if not TRAINING_DIR.is_dir():
        return []
    projects = []
    for entry in sorted(TRAINING_DIR.iterdir()):
        if valid_id(entry.name, PROJECT_ID_PREFIX) and (project := read_project(entry.name)):
            projects.append({
                "id": project["id"],
                "name": project["name"],
                "createdAt": project["createdAt"],
                "imageCount": len(project["images"]),
                "totalBytes": sum(i["bytes"] for i in project["images"]),
            })
    return sorted(projects, key=lambda p: p["createdAt"])


def delete_project(project_id: str) -> None:
    shutil.rmtree(project_dir(project_id))


def thumbnail_path(project: dict[str, Any], image_id: str) -> Optional[Path]:
    if not any(i["id"] == image_id for i in project["images"]):
        return None
    path = project_dir(project["id"]) / "thumbs" / f"{image_id}.jpg"
    return path if path.is_file() else None


# ---------------------------------------------------------------------------
# Inspecting one photograph


def display_name(raw: Optional[str]) -> str:
    """The client's file name, for display only (never used as a path)."""
    name = (raw or "unnamed").replace("\\", "/").split("/")[-1].strip()
    return "".join(c for c in name if c.isprintable())[:200] or "unnamed"


def check_extension(filename: str) -> None:
    extension = Path(filename).suffix.lower()
    if extension in ACCEPTED_EXTENSIONS:
        return
    hint = EXTENSION_HINTS.get(extension, f"Only JPG, PNG and HEIC photos are supported ({extension or 'no extension'}).")
    raise ImageRejected(hint)


def heif_complete(path: Path) -> bool:
    """
    A HEIF file is a chain of boxes (4-byte size, 4-byte type; size 1 = a 64-bit
    size follows, 0 = to the end of the file). If a box claims more bytes than
    the file holds, it was cut off. Needed because libheif decodes a truncated
    HEIC without an error, filling the missing tiles with garbage.
    """
    size = path.stat().st_size
    with open(path, "rb") as f:
        offset = 0
        while offset < size:
            f.seek(offset)
            header = f.read(16)
            if len(header) < 8:
                return False
            length, _ = struct.unpack(">I4s", header[:8])
            if length == 1:
                if len(header) < 16:
                    return False
                length = struct.unpack(">Q", header[8:16])[0]
            elif length == 0:
                length = size - offset
            if length < 8 or offset + length > size:
                return False
            offset += length
    return True


def sharpness(gray: Image.Image) -> float:
    """
    Variance of the Laplacian: how strongly brightness changes between
    neighbouring pixels. Sharp edges give large values, blur smooths them away.
    Measured on a copy whose longer side is SHARPNESS_SIDE, so photos of
    different resolutions are comparable. A heuristic: a plain wall is "blurry"
    by this measure, and noise looks "sharp".
    """
    scale = SHARPNESS_SIDE / max(gray.size)
    if scale < 1:
        gray = gray.resize((max(1, round(gray.width * scale)), max(1, round(gray.height * scale))), Image.Resampling.BOX)
    a = np.asarray(gray, dtype=np.float32)
    if a.shape[0] < 3 or a.shape[1] < 3:
        return 0.0
    laplacian = a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:] - 4 * a[1:-1, 1:-1]
    return float(laplacian.var())


def dhash(gray: Image.Image) -> str:
    """64-bit difference hash: is each of 8x8 cells brighter than its right neighbour? Survives resizing and re-encoding."""
    small = np.asarray(gray.resize((9, 8), Image.Resampling.BOX), dtype=np.int16)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return f"{int(''.join('1' if b else '0' for b in bits), 2):016x}"


def exif_facts(img: Image.Image) -> tuple[int, Optional[dict[str, Any]], Optional[str]]:
    """(orientation tag, camera facts or None, capture time or None). GPS is never read."""
    exif = img.getexif()
    orientation = int(exif.get(274, 1) or 1)
    detail = exif.get_ifd(0x8769)  # Exif sub-IFD

    def number(value: Any) -> Optional[float]:
        try:
            result = float(value)
        except (TypeError, ValueError, ZeroDivisionError):
            return None
        return round(result, 3) if result > 0 else None

    camera = {
        "make": str(exif.get(271)).strip("\x00 ").strip() if exif.get(271) else None,
        "model": str(exif.get(272)).strip("\x00 ").strip() if exif.get(272) else None,
        "focalLengthMm": number(detail.get(37386)),
        "focalLength35mm": number(detail.get(41989)),
    }
    taken = detail.get(36867)
    return orientation, (camera if any(camera.values()) else None), (str(taken) if taken else None)


def inspect_image(path: Path, filename: str) -> dict[str, Any]:
    """Validate and measure one stored upload. Raises ImageRejected if it isn't a readable JPG/PNG/HEIC."""
    try:
        with Image.open(path) as img:
            fmt = img.format
            img.verify()  # file structure, without decoding the pixels
    except Image.DecompressionBombError:
        raise ImageRejected(f"larger than {MAX_PIXELS // 1_000_000} megapixels.") from None
    except Exception:
        raise ImageRejected("not a readable image (corrupt, or not an image at all).") from None
    if fmt not in STORED_EXTENSIONS:
        raise ImageRejected(f"its content is {fmt}, not JPG, PNG or HEIC.")
    if fmt == "HEIF" and not heif_complete(path):
        raise ImageRejected("the image data is truncated or corrupt.")
    expected = ACCEPTED_EXTENSIONS[Path(filename).suffix.lower()]
    notes = [] if fmt == expected else [f"Named {Path(filename).suffix} but the content is {fmt} (read as {fmt})."]

    try:
        with Image.open(path) as img:
            width, height = img.size
            orientation, camera, taken = exif_facts(img)
            if fmt == "HEIF":
                orientation = int(img.info.get("original_orientation") or 1)
            if fmt == "JPEG":
                img.draft("RGB", (2 * SHARPNESS_SIDE, 2 * SHARPNESS_SIDE))  # decode at reduced size: faster, same checks
            img.load()  # decodes everything: truncated files fail here
            oriented = ImageOps.exif_transpose(img)
    except Exception:
        raise ImageRejected("the image data is truncated or corrupt.") from None
    if orientation in (5, 6, 7, 8) and fmt != "HEIF":  # rotated 90°: seen with swapped sides (HEIF: already applied)
        width, height = height, width

    gray = oriented.convert("L")
    thumb = oriented.convert("RGB")
    thumb.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)

    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(4 * MiB):
            digest.update(chunk)

    return {
        "format": fmt,
        "width": width,
        "height": height,
        "orientation": orientation,
        "camera": camera,
        "takenAt": taken,
        "sha256": digest.hexdigest(),
        "dhash": dhash(gray),
        "sharpness": round(sharpness(gray), 2),
        "notes": notes,
        "_thumbnail": thumb,
    }


def add_image(project_id: str, stored: Path, filename: str, size: int) -> dict[str, Any]:
    """Inspect an upload saved at `stored` (inside the project) and add it. Raises ImageRejected."""
    folder = project_dir(project_id)
    facts = inspect_image(stored, filename)
    image_id = new_id(IMAGE_ID_PREFIX)
    extension = STORED_EXTENSIONS[facts["format"]]
    record = {"id": image_id, "filename": filename, "storedAs": f"{image_id}{extension}", "bytes": size,
              "addedAt": now_iso(), **facts}
    thumbnail = record.pop("_thumbnail")
    with editing(project_id) as project:
        if len(project["images"]) >= MAX_IMAGES:
            raise ImageRejected(f"the project already has {MAX_IMAGES} photos.")
        thumbnail.save(folder / "thumbs" / f"{image_id}.jpg", "JPEG", quality=80)
        stored.replace(folder / "source" / record["storedAs"])
        project["images"].append(record)
    return record


def record_rejections(project_id: str, rejected: list[dict[str, str]]) -> None:
    if not rejected:
        return
    with editing(project_id) as project:
        project["rejected"] = (project["rejected"] + rejected)[-MAX_REJECTED_KEPT:]


def remove_image(project_id: str, image_id: str) -> bool:
    with editing(project_id) as project:
        image = next((i for i in project["images"] if i["id"] == image_id), None)
        if image is None:
            return False
        project["images"].remove(image)
    folder = project_dir(project_id)
    (folder / "source" / image["storedAs"]).unlink(missing_ok=True)
    (folder / "thumbs" / f"{image_id}.jpg").unlink(missing_ok=True)
    return True


def clear_rejections(project_id: str) -> None:
    with editing(project_id) as project:
        project["rejected"] = []


def check_disk(size_hint: int = 0) -> None:
    free = shutil.disk_usage(DATA_DIR).free
    if free - size_hint < MIN_FREE_DISK:
        raise TrainingError(
            f"Only {free / GiB:.1f} GiB free on the data disk; uploads stop at {MIN_FREE_DISK // GiB} GiB free. "
            "Free some space first."
        )


# ---------------------------------------------------------------------------
# Project-wide analysis (recomputed on every read, so removing a photo updates it)


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def analyse(project: dict[str, Any]) -> dict[str, Any]:
    images = project["images"]
    warnings: dict[str, list[dict[str, str]]] = {i["id"]: [] for i in images}

    def warn(image_id: str, kind: str, message: str) -> None:
        warnings[image_id].append({"kind": kind, "message": message})

    # Resolution.
    for image in images:
        short = min(image["width"], image["height"])
        if short < VERY_LOW_RES_SHORT_SIDE:
            warn(image["id"], "low-resolution", f"Very low resolution: shorter side {short} px.")
        elif short < LOW_RES_SHORT_SIDE:
            warn(image["id"], "low-resolution", f"Low resolution: shorter side {short} px (< {LOW_RES_SHORT_SIDE}).")

    # Blur: absolute floor, and relative to this project's typical photo.
    median = statistics.median(i["sharpness"] for i in images) if images else 0.0
    for image in images:
        s = image["sharpness"]
        if s < BLUR_ABSOLUTE:
            warn(image["id"], "blur", f"Possibly blurry: sharpness {s:.0f} (below {BLUR_ABSOLUTE:.0f}).")
        elif len(images) >= 5 and s < BLUR_RELATIVE * median:
            warn(image["id"], "blur", f"Possibly blurry: sharpness {s:.0f} vs {median:.0f} typical here.")

    # Duplicates: identical bytes, or nearly the same picture (dHash). Each photo is compared
    # with earlier ones only, so the first copy stays clean; an exact match wins over a near one.
    by_name = {i["id"]: i["filename"] for i in images}
    groups: list[list[str]] = []
    for index, image in enumerate(images):
        earlier = images[:index]
        exact = next((e for e in earlier if e["sha256"] == image["sha256"]), None)
        if exact:
            warn(image["id"], "duplicate", f"Identical to {by_name[exact['id']]}.")
            groups.append([exact["id"], image["id"]])
            continue
        near = min(((hamming(image["dhash"], e["dhash"]), e) for e in earlier), key=lambda t: t[0], default=None)
        if near and near[0] <= NEAR_DUPLICATE_BITS:
            bits, match = near
            warn(image["id"], "near-duplicate", f"Nearly the same picture as {by_name[match['id']]} ({bits}/64 hash bits differ).")
            groups.append([match["id"], image["id"]])

    # Dimensions: compare with the most common size. Same sensor turned 90° is noted separately.
    sizes: dict[tuple[int, int], int] = {}
    for image in images:
        sizes[(image["width"], image["height"])] = sizes.get((image["width"], image["height"]), 0) + 1
    common = max(sizes, key=lambda k: sizes[k]) if sizes else None
    if common and len(sizes) > 1:
        for image in images:
            size = (image["width"], image["height"])
            if size == common:
                continue
            if size == common[::-1]:
                warn(image["id"], "orientation", f"Portrait/landscape differs from most photos ({size[0]}×{size[1]} vs {common[0]}×{common[1]}).")
            else:
                warn(image["id"], "dimensions", f"Different size from most photos ({size[0]}×{size[1]} vs {common[0]}×{common[1]}).")

    cameras: dict[str, int] = {}
    for image in images:
        camera = image.get("camera") or {}
        label = " ".join(filter(None, [camera.get("make"), camera.get("model")])) or "unknown camera"
        cameras[label] = cameras.get(label, 0) + 1

    counts: dict[str, int] = {}
    for items in warnings.values():
        for kind in {w["kind"] for w in items}:
            counts[kind] = counts.get(kind, 0) + 1

    return {
        "imageCount": len(images),
        "totalBytes": sum(i["bytes"] for i in images),
        "sizes": [{"width": w, "height": h, "count": n} for (w, h), n in sorted(sizes.items(), key=lambda kv: -kv[1])],
        "cameras": [{"label": k, "count": v} for k, v in sorted(cameras.items(), key=lambda kv: -kv[1])],
        "medianSharpness": round(median, 2),
        "warningCounts": counts,
        "imagesWithWarnings": sum(1 for items in warnings.values() if items),
        "duplicateGroups": groups,
        "warnings": warnings,
    }


def stage_statuses(poses: Optional[dict[str, Any]]) -> dict[str, str]:
    """Preprocessing and pose estimation run as one job (training_poses.py); the later stages are still planned."""
    if poses is None:
        return {}
    status, step = poses["status"], poses.get("step")
    if status == "queued":
        return {"preprocess": "queued", "poses": "queued"}
    if status == "done":
        return {"preprocess": "done", "poses": "outdated" if poses.get("outdated") else "done"}
    in_preprocess = step in (None, "preprocess")
    if status == "running":
        return {"preprocess": "running", "poses": "queued"} if in_preprocess else {"preprocess": "done", "poses": "running"}
    # failed / cancelled: attribute it to the step it stopped in.
    return {"preprocess": status} if in_preprocess else {"preprocess": "done", "poses": status}


def project_view(project: dict[str, Any], poses: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """What the API returns: the stored project, its analysis, the pose job and the stages with their status."""
    view = {k: v for k, v in project.items() if k != "images"}
    view["images"] = [{k: v for k, v in i.items() if k != "storedAs"} for i in project["images"]]
    view["analysis"] = analyse(project)
    view["poses"] = poses
    statuses = stage_statuses(poses)
    view["stages"] = [{**stage, "status": statuses.get(stage["key"], "planned")} for stage in STAGES]
    return view
