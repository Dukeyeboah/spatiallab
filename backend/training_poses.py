"""
Camera pose estimation (Lab 10B, step 1): structure from motion with COLMAP
on a training project's photos.

    spatial-data/training/<trn_id>/work/
        poses.json              the job: status, stage, progress, settings, summary (written by one process at a time)
        poses/
            images/<img_id>.jpg upright copies, longer side 1600 px, EXIF camera facts kept (never served)
            database.db         COLMAP features and matches
            sparse/<n>/         COLMAP models (binary); several when the photos split into unconnected groups
            model/              the largest model as text (cameras.txt, images.txt, points3D.txt)
            preview.json        camera centres/orientations and up to 60,000 points, for the 3D view
            *.log               COLMAP's output per step

Every number shown comes from COLMAP's result. Photos COLMAP couldn't place
are reported, never given a guessed pose. The model has no real-world scale
or up direction: COLMAP fixes neither (no GPS, no LiDAR link yet).

The job runs in a worker process. The API writes poses.json only before
submitting (queued) and on restart recovery; the worker writes it while
running. Cancelling = a CANCEL file the worker polls.
"""

import json
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
from PIL import Image, ImageOps

import training  # registers the HEIC opener
import training_env
from storage import now_iso

MAX_SIDE = 1600                    # px; COLMAP and later training read these copies
EXHAUSTIVE_LIMIT = 300             # photos; above this, only nearby photos (by name order) are matched
SEQUENTIAL_OVERLAP = 20
THREADS = 4                        # SIFT on the CPU needs RAM per thread; 8 GB machines swap with more
MIN_IMAGES = 3
PREVIEW_POINTS = 60_000
# Share of the progress bar per step (measured: 192 photos took 33 s, 52 s, 155 s, 67 s on an M2).
WEIGHTS = {"preprocess": 0.12, "features": 0.18, "matching": 0.45, "mapping": 0.25}
ACTIVE = ("queued", "running")


class PoseError(Exception):
    """Shown to the user."""


class Cancelled(Exception):
    pass


def colmap_binary() -> Optional[str]:
    return training_env.find_tool("colmap")


def work_dir(project_id: str) -> Path:
    return training.project_dir(project_id) / "work"


def poses_dir(project_id: str) -> Path:
    return work_dir(project_id) / "poses"


def read_job(project_id: str) -> Optional[dict[str, Any]]:
    path = work_dir(project_id) / "poses.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_job(project_id: str, job: dict[str, Any]) -> None:
    folder = work_dir(project_id)
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / ".poses.tmp"
    tmp.write_text(json.dumps(job, indent=2), encoding="utf-8")
    tmp.replace(folder / "poses.json")


def is_running(project_id: str) -> bool:
    job = read_job(project_id)
    return bool(job and job["status"] in ACTIVE)


def queue(project: dict[str, Any]) -> dict[str, Any]:
    """Checks and writes a queued job (the API then submits run()). Raises PoseError."""
    if is_running(project["id"]):
        raise PoseError("Pose estimation is already running for this project.")
    if not colmap_binary():
        raise PoseError("COLMAP isn't installed. Install it with: brew install colmap, then restart the backend.")
    count = len(project["images"])
    if count < MIN_IMAGES:
        raise PoseError(f"Pose estimation needs at least {MIN_IMAGES} photos (this project has {count}).")
    # Copies at 1600 px + database: roughly 1 MB per photo; keep the usual margin on top.
    training.check_disk(count * 1024 * 1024)
    job = {
        "kind": "poses",
        "status": "queued",
        "step": None,
        "stage": "Waiting to start",
        "progress": 0.0,
        "queuedAt": now_iso(),
        "startedAt": None,
        "finishedAt": None,
        "error": None,
        "logTail": None,
        "imageIds": sorted(i["id"] for i in project["images"]),
        "settings": {
            "maxSide": MAX_SIDE,
            "cameraModel": "OPENCV",
            "features": "SIFT (CPU, first octave 0)",
            "matching": "exhaustive" if count <= EXHAUSTIVE_LIMIT else f"sequential (overlap {SEQUENTIAL_OVERLAP})",
            "mapper": "incremental",
        },
        "summary": None,
    }
    work_dir(project["id"]).mkdir(parents=True, exist_ok=True)
    (work_dir(project["id"]) / "CANCEL").unlink(missing_ok=True)
    write_job(project["id"], job)
    return job


def request_cancel(project_id: str) -> bool:
    if not is_running(project_id):
        return False
    (work_dir(project_id) / "CANCEL").touch()
    return True


def recover_interrupted(project_id: str) -> None:
    """At startup: a job still marked active was cut off by a backend restart."""
    job = read_job(project_id)
    if job and job["status"] in ACTIVE:
        job.update(status="failed", error="Interrupted by a backend restart. Run it again.", finishedAt=now_iso())
        write_job(project_id, job)


def view(project: dict[str, Any]) -> Optional[dict[str, Any]]:
    """The job as the API shows it; `outdated` once photos were added or removed after it ran."""
    job = read_job(project["id"])
    if job is None:
        return None
    current = sorted(i["id"] for i in project["images"])
    return {**job, "outdated": job["status"] == "done" and job["imageIds"] != current}


def preview_path(project_id: str) -> Optional[Path]:
    job = read_job(project_id)
    path = poses_dir(project_id) / "preview.json"
    return path if job and job["status"] == "done" and path.is_file() else None


# ---------------------------------------------------------------------------
# The worker


def run(project_id: str) -> None:
    """Worker-process entry point. Never raises: the outcome is written to poses.json."""
    job = read_job(project_id) or {}
    cancel_file = work_dir(project_id) / "CANCEL"

    def update(**changes: Any) -> None:
        job.update(changes)
        write_job(project_id, job)

    def progress(step: str, fraction: float, stage: str) -> None:
        done = sum(w for key, w in WEIGHTS.items() if list(WEIGHTS).index(key) < list(WEIGHTS).index(step))
        update(step=step, stage=stage, progress=round(done + WEIGHTS[step] * min(max(fraction, 0.0), 1.0), 4))

    def check_cancel() -> None:
        if cancel_file.exists():
            raise Cancelled()

    folder = poses_dir(project_id)
    timings: dict[str, float] = {}
    try:
        update(status="running", startedAt=now_iso(), error=None, logTail=None)
        project = training.read_project(project_id)
        if project is None:
            raise PoseError("The project no longer exists.")
        images = [i for i in project["images"] if i["id"] in set(job["imageIds"])]
        shutil.rmtree(folder, ignore_errors=True)
        (folder / "images").mkdir(parents=True)

        start = time.monotonic()
        sizes = preprocess(project_id, images, folder / "images", check_cancel,
                           lambda k: progress("preprocess", k / len(images), f"Preparing photos {k}/{len(images)}"))
        timings["preprocess"] = time.monotonic() - start

        colmap = colmap_binary()
        if not colmap:
            raise PoseError("COLMAP isn't installed (brew install colmap).")
        db, imgs = str(folder / "database.db"), str(folder / "images")
        count = len(images)

        start = time.monotonic()
        run_colmap(
            [colmap, "feature_extractor", "--database_path", db, "--image_path", imgs,
             "--ImageReader.camera_model", "OPENCV",
             # One shared lens only when every copy has the same size (same phone, same orientation).
             "--ImageReader.single_camera", "1" if len(sizes) == 1 else "0",
             "--FeatureExtraction.use_gpu", "0", "--FeatureExtraction.num_threads", str(THREADS),
             # Default -1 doubles every image first: 4× the work and memory for little gain at 1600 px.
             "--SiftExtraction.first_octave", "0"],
            folder / "features.log", check_cancel,
            on_line=counter(r"Processed file \[(\d+)/(\d+)\]",
                            lambda i, n: progress("features", i / n, f"Finding features {i}/{n}")),
        )
        timings["features"] = time.monotonic() - start

        start = time.monotonic()
        if count <= EXHAUSTIVE_LIMIT:
            matcher = [colmap, "exhaustive_matcher", "--database_path", db]
            pattern = r"Processing block \[(\d+)/(\d+), (\d+)/(\d+)\]"

            def on_block(m: re.Match) -> None:
                i, n, j, _ = map(int, m.groups())
                done = (i - 1) * n + j
                progress("matching", done / (n * n), f"Matching photo pairs, block {done}/{n * n}")
        else:
            matcher = [colmap, "sequential_matcher", "--database_path", db,
                       "--SequentialMatching.overlap", str(SEQUENTIAL_OVERLAP),
                       "--SequentialMatching.quadratic_overlap", "1"]
            pattern = r"Matching image \[(\d+)/(\d+)\]"

            def on_block(m: re.Match) -> None:
                i, n = int(m.group(1)), int(m.group(2))
                progress("matching", i / n, f"Matching nearby photos {i}/{n}")
        run_colmap(matcher + ["--FeatureMatching.use_gpu", "0", "--FeatureMatching.num_threads", str(THREADS)],
                   folder / "matching.log", check_cancel, on_line=regex(pattern, on_block))
        timings["matching"] = time.monotonic() - start

        start = time.monotonic()
        (folder / "sparse").mkdir()
        registered = [0]

        def on_register(_: re.Match) -> None:
            registered[0] += 1
            progress("mapping", registered[0] / count, f"Placing cameras ({registered[0]} tried of {count} photos)")
        run_colmap([colmap, "mapper", "--database_path", db, "--image_path", imgs,
                    "--output_path", str(folder / "sparse"), "--Mapper.num_threads", str(THREADS)],
                   folder / "mapping.log", check_cancel, on_line=regex(r"Registering image #\d+", on_register))
        timings["mapping"] = time.monotonic() - start

        progress("mapping", 1.0, "Reading the result")
        summary = summarise(colmap, folder, images)
        summary["seconds"] = {k: round(v, 1) for k, v in timings.items()}
        update(status="done", step=None, stage="Done", progress=1.0, finishedAt=now_iso(), summary=summary)
    except Cancelled:
        update(status="cancelled", stage="Cancelled", finishedAt=now_iso())
    except Exception as error:  # noqa: BLE001 - every failure must end up in poses.json
        update(status="failed", finishedAt=now_iso(), error=str(error) or type(error).__name__,
               logTail=last_log_lines(folder))
    finally:
        cancel_file.unlink(missing_ok=True)


def preprocess(project_id: str, images: list[dict], out: Path, check_cancel: Callable[[], None],
               on_progress: Callable[[int], None]) -> set[tuple[int, int]]:
    """Upright JPEG copies, longer side MAX_SIDE, camera EXIF kept (COLMAP reads the focal length from it)."""
    source = training.project_dir(project_id) / "source"
    sizes: set[tuple[int, int]] = set()
    for k, image in enumerate(images, 1):
        check_cancel()
        path = source / image["storedAs"]
        if not path.is_file():
            raise PoseError(f"The stored copy of {image['filename']} is missing.")
        with Image.open(path) as img:
            exif = img.getexif()
            upright = ImageOps.exif_transpose(img).convert("RGB")
        upright.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
        exif[274] = 1  # already upright
        upright.save(out / f"{image['id']}.jpg", "JPEG", quality=95, exif=exif.tobytes())
        sizes.add(upright.size)
        on_progress(k)
    return sizes


def counter(pattern: str, on: Callable[[int, int], None]) -> Callable[[str], None]:
    return regex(pattern, lambda m: on(int(m.group(1)), int(m.group(2))))


def regex(pattern: str, on: Callable[[re.Match], None]) -> Callable[[str], None]:
    compiled = re.compile(pattern)

    def handle(line: str) -> None:
        if match := compiled.search(line):
            on(match)
    return handle


def run_colmap(args: list[str], log: Path, check_cancel: Callable[[], None], on_line: Callable[[str], None]) -> None:
    """Runs one COLMAP step, logging to a file; follows the log for progress; stops it on cancel."""
    with open(log, "w", encoding="utf-8") as out:
        process = subprocess.Popen(args, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    position, pending = 0, ""
    try:
        while True:
            finished = process.poll() is not None
            with open(log, encoding="utf-8", errors="replace") as f:
                f.seek(position)
                chunk = f.read()
                position = f.tell()
            pending += chunk
            *lines, pending = pending.split("\n")
            for line in lines:
                on_line(line)
            if finished:
                break
            check_cancel()
            time.sleep(0.5)
    except BaseException:
        # COLMAP ignores SIGTERM; its partial output is discarded anyway (each run starts clean).
        process.kill()
        process.wait()
        raise
    if process.returncode != 0:
        raise PoseError(f"COLMAP {args[1]} failed (exit code {process.returncode}). See the log below.")


def last_log_lines(folder: Path, count: int = 12) -> Optional[str]:
    logs = sorted(folder.glob("*.log"), key=lambda p: p.stat().st_mtime) if folder.is_dir() else []
    if not logs:
        return None
    lines = logs[-1].read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-count:])


# ---------------------------------------------------------------------------
# Reading COLMAP's text model


def quaternion_to_matrix(w: float, x: float, y: float, z: float) -> np.ndarray:
    n = np.sqrt(w * w + x * x + y * y + z * z)
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def data_lines(path: Path) -> list[str]:
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line and not line.startswith("#")]


def read_model(folder: Path) -> dict[str, Any]:
    """cameras.txt, images.txt, points3D.txt -> plain data. Image names are '<img_id>.jpg'."""
    cameras = {}
    for line in data_lines(folder / "cameras.txt"):
        f = line.split()
        cameras[int(f[0])] = {"model": f[1], "width": int(f[2]), "height": int(f[3]), "params": [float(v) for v in f[4:]]}
    images = []
    # images.txt has two lines per image; the second (2D points) may be empty, so read it positionally.
    raw = (folder / "images.txt").read_text(encoding="utf-8").splitlines()
    body = [line for line in raw if not line.startswith("#")]
    for k in range(0, len(body) - 1, 2):
        f = body[k].split()
        if len(f) < 10:
            continue
        observations = body[k + 1].split()
        points = sum(1 for p in observations[2::3] if p != "-1")
        # COLMAP stores world-to-camera (R, t); the camera centre in the world is -Rᵀ t.
        rotation = quaternion_to_matrix(*map(float, f[1:5]))
        t = np.array(list(map(float, f[5:8])))
        images.append({
            "imageId": f[9].rsplit(".", 1)[0],
            "cameraId": int(f[8]),
            "center": (-rotation.T @ t).tolist(),
            # Columns = the camera's x (right), y (down), z (viewing direction) axes in world coordinates.
            "cameraToWorld": rotation.T.tolist(),
            "points": points,
        })
    xyz, rgb, errors, tracks = [], [], [], []
    for line in data_lines(folder / "points3D.txt"):
        f = line.split()
        xyz.append([float(f[1]), float(f[2]), float(f[3])])
        rgb.append([int(f[4]), int(f[5]), int(f[6])])
        errors.append(float(f[7]))
        tracks.append((len(f) - 8) // 2)
    return {"cameras": cameras, "images": images, "xyz": np.array(xyz).reshape(-1, 3),
            "rgb": np.array(rgb, dtype=np.uint8).reshape(-1, 3), "errors": np.array(errors), "tracks": np.array(tracks)}


def summarise(colmap: str, folder: Path, images: list[dict]) -> dict[str, Any]:
    models = sorted(p for p in (folder / "sparse").iterdir() if p.is_dir()) if (folder / "sparse").is_dir() else []
    if not models:
        raise PoseError("COLMAP couldn't place any cameras: the photos don't share enough matching features.")
    read: list[tuple[Path, dict]] = []
    for model in models:
        out = folder / "model_txt" / model.name
        out.mkdir(parents=True, exist_ok=True)
        subprocess.run([colmap, "model_converter", "--input_path", str(model), "--output_path", str(out),
                        "--output_type", "TXT"], check=True, capture_output=True)
        read.append((model, read_model(out)))
    model_path, model = max(read, key=lambda m: len(m[1]["images"]))
    shutil.rmtree(folder / "model", ignore_errors=True)
    shutil.copytree(folder / "model_txt" / model_path.name, folder / "model")
    shutil.rmtree(folder / "model_txt")

    placed = {i["imageId"]: i for i in model["images"]}
    names = {i["id"]: i["filename"] for i in images}
    write_preview(folder / "preview.json", model, names)
    camera = next(iter(model["cameras"].values()))
    return {
        "modelPath": f"work/poses/sparse/{model_path.name}",
        "models": [len(m["images"]) for _, m in read],   # photos per model; >1 model = unconnected groups
        "imageCount": len(images),
        "registered": len(placed),
        "notRegistered": [i["id"] for i in images if i["id"] not in placed],
        "observations": {k: v["points"] for k, v in placed.items()},
        "points": int(len(model["xyz"])),
        "meanReprojectionErrorPx": round(float(model["errors"].mean()), 3) if len(model["errors"]) else None,
        "meanTrackLength": round(float(model["tracks"].mean()), 2) if len(model["tracks"]) else None,
        "cameraCount": len(model["cameras"]),
        "camera": {"model": camera["model"], "width": camera["width"], "height": camera["height"],
                   "focalPx": [round(v, 1) for v in camera["params"][:2]]},
    }


def write_preview(path: Path, model: dict[str, Any], names: dict[str, str]) -> None:
    """Cameras and a reproducible sample of points, in COLMAP's frame (the page orients them for display)."""
    xyz, rgb = model["xyz"], model["rgb"]
    if len(xyz) > PREVIEW_POINTS:
        keep = np.sort(np.random.default_rng(0).choice(len(xyz), PREVIEW_POINTS, replace=False))
        xyz, rgb = xyz[keep], rgb[keep]
    cameras = {str(k): v for k, v in model["cameras"].items()}
    preview = {
        "frame": "COLMAP world (arbitrary origin, orientation and scale)",
        "cameras": cameras,
        "images": [{**i, "filename": names.get(i["imageId"], i["imageId"])} for i in model["images"]],
        "pointCount": int(len(model["xyz"])),
        "positions": np.round(xyz, 5).flatten().tolist(),
        "colors": rgb.flatten().tolist(),
    }
    path.write_text(json.dumps(preview), encoding="utf-8")
