"""
Spatial Lab dataset backend: a small local FastAPI service.

    cd backend && .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000

Endpoints (all JSON unless noted):
    GET    /health
    GET    /datasets                         list of dataset metadata
    POST   /datasets                         multipart upload -> new dataset (conversion starts)
    GET    /datasets/{id}                    one dataset's metadata (poll this for progress)
    DELETE /datasets/{id}                    delete source + converted files
    GET    /datasets/{id}/points/{budget}    converted point budget (binary, see lidar_conversion.py)
    GET    /datasets/{id}/poses              validated, header-less poses CSV (text)

Properties and captures (catalog.py; every change returns the whole catalog):
    GET    /catalog
    POST   /properties                       {"name"} -> new property
    PATCH  /properties/{id}                  {"name"} rename
    DELETE /properties/{id}                  property + its captures (datasets become unassigned)
    POST   /properties/{id}/captures         {"name"} -> new capture
    PATCH  /captures/{id}                    {"name"} rename
    DELETE /captures/{id}                    capture only (datasets become unassigned)
    POST   /captures/{id}/datasets           {"datasetId"} assign (moves it from another capture)
    DELETE /captures/{id}/datasets/{dsId}    unassign (dsId may be a LiDAR dataset or a splat scene)

Gaussian splat scenes (splats.py, Lab 8):
    GET    /splats                           list of scene metadata
    POST   /splats                           multipart: name + one file (.ply/.sog/.zip),
                                             or a SOG folder (files + matching relative paths)
    GET    /splats/{id}                      one scene's metadata
    DELETE /splats/{id}                      delete the scene's files
    GET    /splats/{id}/files/{path}         a file the scene's manifest references (whitelist)

Individual Gaussians of a trained PLY scene (gaussian_records.py, Lab 9; read-only):
    GET    /splats/{id}/gaussians?indices=0,17   stored + decoded records (at most 64)
    GET    /splats/{id}/gaussians/sample?seed=42&count=12   reproducible random sample
    GET    /splats/{id}/gaussians/summary?seed=1            statistics over 20,000 sampled Gaussians

Training projects (training.py, Lab 10A; photographs prepared for Gaussian training):
    GET    /training/environment             OS, hardware, GPUs, tools + a training assessment
    GET    /training                         list of projects (id, name, photo count, size)
    POST   /training                         {"name"} -> new project
    GET    /training/{id}                    project + analysis (warnings per photo) + planned stages
    DELETE /training/{id}                    delete the project and its photos
    POST   /training/{id}/images             multipart files (JPG/PNG/HEIC): accepted + rejected (with reasons) + project
    DELETE /training/{id}/images/{imageId}   remove one photo before processing
    DELETE /training/{id}/rejected           clear the list of refused files
    GET    /training/{id}/images/{imageId}/thumbnail   320 px JPEG (originals are never served)
    POST   /training/{id}/poses              start camera pose estimation (COLMAP, worker process) -> 202
    POST   /training/{id}/poses/cancel       stop it
    GET    /training/{id}/poses/preview      cameras + sampled points of the result (JSON)
    GET    /training/{id}/package            cloud training package: checks, size estimate, last build (Lab 10C)
    POST   /training/{id}/package            build it (registered photos + COLMAP model + scripts, zip)
    GET    /training/{id}/package/download   the zip (attachment)

XGRIDS camera extraction runs (xgrids_runs.py, Lab 13R; read-only, from SPATIAL_LAB_XGRIDS_DIR):
    GET    /xgrids/runs                      configured?, runs (id, mode, event count, statuses, source checksums)
    GET    /xgrids/runs/{run}                events: per channel image, timestamp, decoder status, scanner pose
    GET    /xgrids/runs/{run}/images/{file}  a JPEG listed in the run's manifest

XGRIDS calibration experiments (camera_calibration.py, Lab 13V; stateless, nothing stored):
    POST   /xgrids/calibration/audit         body = Lab 13U correspondence export (≤ 5 MB) -> audit + run cross-check
           ?datasetId=&posesSha256=          optional expected identity (refused on mismatch)
    POST   /xgrids/calibration/experiments   same body; ?exclude=id,id&include=id&sourceName= -> experiment JSON

Only converted assets are served; original uploads never leave spatial-data/.
Conversions run one at a time in a separate worker process; budgets added
after a dataset was converted (e.g. 5M) are generated there at startup.
"""

import asyncio
import os
import re
import secrets
import shutil
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from multiprocessing import get_context
from typing import Annotated, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import catalog
import gaussian_records
import splats
import storage
import training
import training_env
import training_package
import training_poses
import xgrids_runs
from splat_bounds import robust_bounds
from catalog import CatalogError
from converter import NORMALISED_POSES_FILE, backfill_budgets, convert_dataset
try:
    import camera_calibration
except ImportError:  # SciPy missing: everything else still works
    camera_calibration = None
from uploads import (
    UploadError,
    infer_project_metadata,
    inspect_json,
    inspect_las,
    inspect_text_csv,
    is_blank,
    save_stream,
    save_upload,
)

MAX_NAME_LENGTH = 80
ROLE_LABELS = {"poses": "Poses", "project": "Project metadata", "control_points": "Control points", "gnss": "GNSS"}
ALLOWED_ORIGINS = os.environ.get(
    "SPATIAL_LAB_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

executor: Optional[ProcessPoolExecutor] = None
# Pose estimation runs for minutes: its own worker, so LiDAR conversions don't wait behind it.
training_executor: Optional[ProcessPoolExecutor] = None


def start_conversion(dataset_id: str) -> None:
    assert executor is not None
    executor.submit(convert_dataset, dataset_id)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global executor, training_executor
    storage.DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    # "spawn": a clean worker process (no copy of the server's state).
    executor = ProcessPoolExecutor(max_workers=1, mp_context=get_context("spawn"))
    training_executor = ProcessPoolExecutor(max_workers=1, mp_context=get_context("spawn"))
    # Pose jobs cut off by a restart are reported as interrupted, not silently re-run.
    for summary in training.list_projects():
        training_poses.recover_interrupted(summary["id"])
    # Conversions interrupted by a restart are simply run again.
    for metadata in storage.list_metadata():
        if metadata.get("status") in ("queued", "converting"):
            storage.update_metadata(metadata["id"], status="queued", progress=0.0, stage="Restarted after a backend restart")
            start_conversion(metadata["id"])
        elif missing := storage.missing_budgets(metadata):
            # A budget was added to BUDGETS after this dataset was converted:
            # generate it from the stored LAS (queued behind other jobs).
            labels = ", ".join(label for _, label, _ in missing)
            storage.update_metadata(metadata["id"], budgetJob={
                "status": "queued", "progress": 0.0, "stage": f"Waiting to generate {labels} budget", "error": None})
            assert executor is not None
            executor.submit(backfill_budgets, metadata["id"])
    yield
    # A running pose job stops its COLMAP process within a second when asked.
    for summary in training.list_projects():
        training_poses.request_cancel(summary["id"])
    training_executor.shutdown(cancel_futures=True)
    executor.shutdown(cancel_futures=True)


app = FastAPI(title="Spatial Lab datasets", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)


def get_metadata_or_404(dataset_id: str) -> dict:
    try:
        metadata = storage.read_metadata(dataset_id)
    except ValueError:
        metadata = None
    if metadata is None:
        raise HTTPException(404, "Dataset not found.")
    return metadata


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/datasets")
def list_datasets() -> list[dict]:
    return storage.list_metadata()


@app.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict:
    return get_metadata_or_404(dataset_id)


@app.post("/datasets", status_code=201)
async def create_dataset(
    name: Annotated[str, Form()],
    pointcloud: Annotated[UploadFile, File()],
    poses: Annotated[Optional[UploadFile], File()] = None,
    project: Annotated[Optional[UploadFile], File()] = None,
    control_points: Annotated[Optional[UploadFile], File()] = None,
    gnss: Annotated[Optional[UploadFile], File()] = None,
) -> dict:
    name = " ".join(name.split())  # collapse whitespace, drop control characters like newlines
    if not 1 <= len(name) <= MAX_NAME_LENGTH:
        raise HTTPException(400, f"Name must be 1–{MAX_NAME_LENGTH} characters.")

    uploads = {"pointcloud": pointcloud, "poses": poses, "project": project,
               "control_points": control_points, "gnss": gnss}
    uploads = {role: upload for role, upload in uploads.items() if upload is not None and upload.filename}

    dataset_id = storage.new_dataset_id()
    folder = storage.dataset_dir(dataset_id)
    source = folder / "source"
    source.mkdir(parents=True)
    metadata = storage.new_metadata(dataset_id, name)

    try:
        for role, upload in uploads.items():
            path = source / storage.SOURCE_FILES[role]
            size = await save_upload(role, upload, path)
            # The client's file name is kept only as display text.
            filename = os.path.basename(upload.filename or "")[:200]
            info = {"filename": filename, "bytes": size}

            # Empty optional files are skipped with a warning; only the LAS is required.
            if role != "pointcloud" and (size == 0 or is_blank(path)):
                path.unlink()
                metadata["skippedFiles"].append({"role": role, "filename": filename, "reason": "empty"})
                metadata["warnings"].append(f"{ROLE_LABELS[role]} file \"{filename}\" is empty and was skipped.")
                continue

            if role == "pointcloud":
                info.update(inspect_las(path))
            elif role == "project":
                info.update(inspect_json(path))
            else:
                info.update(inspect_text_csv(role, path))
            metadata["source"][role] = info
            if role in ("control_points", "gnss"):
                # Preserved for later analysis; schema deliberately not assumed.
                metadata["attachments"].append({"role": role, **info})

        # No project.json (or one without content): state what the LAS header
        # says and flag the unknown coordinate information.
        project = metadata["source"].get("project")
        if not project or not project.get("hasContent"):
            inferred, warnings = infer_project_metadata(metadata["source"]["pointcloud"])
            metadata["projectInferred"] = inferred
            metadata["warnings"].extend(warnings)
    except UploadError as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(400, str(error)) from error
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise

    storage.write_metadata(dataset_id, metadata)
    start_conversion(dataset_id)
    return metadata


@app.delete("/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str) -> None:
    metadata = get_metadata_or_404(dataset_id)
    if metadata.get("status") in ("queued", "converting"):
        raise HTTPException(409, "This dataset is still converting. Delete it when conversion has finished.")
    if (metadata.get("budgetJob") or {}).get("status") in ("queued", "running"):
        raise HTTPException(409, "A new point budget is being generated for this dataset. Delete it when that has finished.")
    storage.delete_dataset(dataset_id)
    # Drop the capture's reference too (the files are gone).
    with catalog.editing() as current:
        catalog.unassign_dataset(current, dataset_id)


@app.get("/datasets/{dataset_id}/points/{budget_key}")
def get_points(dataset_id: str, budget_key: str) -> FileResponse:
    metadata = get_metadata_or_404(dataset_id)
    # Only keys listed in the metadata are served (whitelist, not a path).
    if budget_key not in {b["key"] for b in metadata.get("budgets", [])}:
        raise HTTPException(404, "Point budget not found.")
    path = storage.dataset_dir(dataset_id) / "converted" / storage.budget_file(budget_key)
    return FileResponse(path, media_type="application/octet-stream")


@app.get("/datasets/{dataset_id}/poses")
def get_poses(dataset_id: str) -> FileResponse:
    metadata = get_metadata_or_404(dataset_id)
    poses = metadata.get("poses")
    path = storage.dataset_dir(dataset_id) / "converted" / NORMALISED_POSES_FILE
    if not poses or poses.get("status") == "invalid" or not path.is_file():
        raise HTTPException(404, "No valid poses for this dataset.")
    return FileResponse(path, media_type="text/csv")


# ---------------------------------------------------------------------------
# Properties and captures (see catalog.py). Only catalog.json changes here;
# no dataset file is ever created, moved or deleted by these endpoints.


class NameBody(BaseModel):
    name: str


class DatasetRefBody(BaseModel):
    datasetId: str


def catalog_change(change) -> dict:
    """Apply `change(catalog)` and return the updated catalog; CatalogError -> HTTP error."""
    try:
        with catalog.editing() as current:
            change(current)
    except CatalogError as error:
        raise HTTPException(error.status, str(error)) from error
    return catalog.load()


@app.get("/catalog")
def get_catalog() -> dict:
    return catalog.load()


@app.post("/properties", status_code=201)
def create_property(body: NameBody) -> dict:
    return catalog_change(lambda c: catalog.add_property(c, body.name))


@app.patch("/properties/{property_id}")
def rename_property(property_id: str, body: NameBody) -> dict:
    def rename(c: dict) -> None:
        catalog.find_property(c, property_id)["name"] = catalog.clean_name(body.name)
    return catalog_change(rename)


@app.delete("/properties/{property_id}")
def delete_property(property_id: str) -> dict:
    return catalog_change(lambda c: catalog.delete_property(c, property_id))


@app.post("/properties/{property_id}/captures", status_code=201)
def create_capture(property_id: str, body: NameBody) -> dict:
    return catalog_change(lambda c: catalog.add_capture(c, property_id, body.name))


@app.patch("/captures/{capture_id}")
def rename_capture(capture_id: str, body: NameBody) -> dict:
    def rename(c: dict) -> None:
        catalog.find_capture(c, capture_id)["name"] = catalog.clean_name(body.name)
    return catalog_change(rename)


@app.delete("/captures/{capture_id}")
def delete_capture(capture_id: str) -> dict:
    return catalog_change(lambda c: catalog.delete_capture(c, capture_id))


@app.post("/captures/{capture_id}/datasets")
def assign_dataset(capture_id: str, body: DatasetRefBody) -> dict:
    dataset_id = body.datasetId
    if not catalog.is_dataset_reference(dataset_id):
        raise HTTPException(400, "Invalid dataset id.")
    if catalog.is_splat_reference(dataset_id):
        get_splat_or_404(dataset_id)  # must exist
    elif dataset_id not in catalog.BUILTIN_DATASET_IDS:
        get_metadata_or_404(dataset_id)  # must exist
    return catalog_change(lambda c: catalog.assign_dataset(c, capture_id, dataset_id))


@app.delete("/captures/{capture_id}/datasets/{dataset_id}")
def unassign_dataset(capture_id: str, dataset_id: str) -> dict:
    def unassign(c: dict) -> None:
        capture = catalog.find_capture(c, capture_id)
        if not any(r.get("datasetId") == dataset_id for r in capture["representations"]):
            raise CatalogError("That dataset is not in this capture.", 404)
        catalog.unassign_dataset(c, dataset_id)
    return catalog_change(unassign)


# ---------------------------------------------------------------------------
# Gaussian splat scenes (see splats.py). Validated and, for zips, extracted
# during the upload request; the viewer then loads them directly.

SPLAT_MEDIA_TYPES = {".json": "application/json", ".webp": "image/webp"}


def get_splat_or_404(splat_id: str) -> dict:
    try:
        metadata = splats.read_metadata(splat_id)
    except ValueError:
        metadata = None
    if metadata is None:
        raise HTTPException(404, "Gaussian scene not found.")
    return metadata


@app.get("/splats")
def list_splats() -> list[dict]:
    return splats.list_metadata()


@app.get("/splats/{splat_id}")
def get_splat(splat_id: str) -> dict:
    return get_splat_or_404(splat_id)


@app.post("/splats", status_code=201)
async def create_splat(
    name: Annotated[str, Form()],
    files: Annotated[list[UploadFile], File()],
    paths: Annotated[Optional[list[str]], Form()] = None,
) -> dict:
    """One file (.ply / .compressed.ply / .sog / .zip), or a SOG folder: files + their relative paths."""
    name = " ".join(name.split())
    if not 1 <= len(name) <= MAX_NAME_LENGTH:
        raise HTTPException(400, f"Name must be 1–{MAX_NAME_LENGTH} characters.")

    splat_id = splats.new_splat_id()
    folder = splats.splat_dir(splat_id)
    source = folder / "source"
    source.mkdir(parents=True)
    metadata = splats.new_metadata(splat_id, name)
    try:
        if paths is None:
            if len(files) != 1:
                raise UploadError("Choose one scene file, or a SOG folder.")
            upload = files[0]
            filename = os.path.basename(upload.filename or "")[:200]
            kind = splats.single_file_kind(filename)
            size = await save_stream(upload, source / splats.SINGLE_FILE_NAMES[kind], splats.MAX_SINGLE_FILE, filename)
            metadata["source"] = {"kind": "zip" if kind == ".zip" else "file", "filename": filename,
                                  "bytes": size, "fileCount": 1}
            result, served_from = await run_in_threadpool(splats.inspect_single_file, folder, kind, filename)
        else:
            if len(paths) != len(files):
                raise UploadError("Each uploaded file needs its relative path.")
            # Relative paths are validated segment by segment and only package
            # file types are kept; the folder the browser prefixes is stripped.
            kept: list[tuple[str, UploadFile]] = []
            ignored = 0
            for upload, raw in zip(files, paths):
                relative = splats.clean_relative_path(raw)
                if relative is None:
                    continue
                if os.path.splitext(relative)[1].lower() not in splats.PACKAGE_EXTENSIONS:
                    ignored += 1
                    continue
                kept.append((relative, upload))
            if not kept:
                raise UploadError("The folder contains no SOG files (meta.json or lod-meta.json and .webp images).")
            if len(kept) > splats.MAX_PACKAGE_FILES:
                raise UploadError(f"More than {splats.MAX_PACKAGE_FILES} files in the folder.")
            root = splats.common_root([relative for relative, _ in kept])
            strip = len(root) + 1 if root else 0
            if len({relative for relative, _ in kept}) != len(kept):
                raise UploadError("The folder lists the same file twice.")
            label = root or "folder"
            total = 0
            for relative, upload in kept:
                destination = source / "package" / relative[strip:]
                destination.parent.mkdir(parents=True, exist_ok=True)
                total += await save_stream(upload, destination, splats.MAX_PACKAGE_BYTES - total, f"{label}/{relative[strip:]}")
            metadata["source"] = {"kind": "folder", "filename": label, "bytes": total, "fileCount": len(kept)}
            if ignored:
                metadata["warnings"].append(f"Ignored {ignored} file(s) that aren't part of a SOG package (e.g. .html, .js).")
            result, served_from = await run_in_threadpool(splats.inspect_uploaded_folder, folder, label)
        splats.apply_inspection(metadata, result, served_from)
        try:
            metadata["robustBounds"] = await run_in_threadpool(robust_bounds, folder / served_from, metadata)
        except Exception as error:  # a viewing aid only: never fails the import
            metadata["warnings"].append(f"Couldn't measure the scene's extent ({error}); the viewer frames everything.")
    except UploadError as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(400, str(error)) from error
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise

    splats.write_metadata(splat_id, metadata)
    return metadata


@app.delete("/splats/{splat_id}", status_code=204)
def delete_splat(splat_id: str) -> None:
    get_splat_or_404(splat_id)
    splats.delete_splat(splat_id)
    with catalog.editing() as current:
        catalog.unassign_dataset(current, splat_id)


@app.get("/splats/{splat_id}/files/{relative:path}")
def get_splat_file(splat_id: str, relative: str) -> FileResponse:
    metadata = get_splat_or_404(splat_id)
    path = splats.served_file(metadata, relative)
    if path is None:
        raise HTTPException(404, "File not found in this scene.")
    media_type = SPLAT_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type)


# ---------------------------------------------------------------------------
# XGRIDS camera extraction runs (xgrids_runs.py, Lab 13R). Read-only; the run
# folders live outside the repository (SPATIAL_LAB_XGRIDS_DIR).


@app.get("/xgrids/runs")
def list_xgrids_runs() -> dict:
    return xgrids_runs.list_runs()


@app.get("/xgrids/runs/{run_id}")
def get_xgrids_run(run_id: str) -> dict:
    try:
        return xgrids_runs.read_run(run_id)
    except xgrids_runs.RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except xgrids_runs.RunError as error:
        raise HTTPException(422, str(error)) from error


@app.get("/xgrids/runs/{run_id}/images/{filename}")
def get_xgrids_image(run_id: str, filename: str) -> FileResponse:
    try:
        path = xgrids_runs.image_path(run_id, filename)
    except xgrids_runs.RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except xgrids_runs.RunError as error:
        raise HTTPException(422, str(error)) from error
    return FileResponse(path, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Lab 13V calibration experiments (camera_calibration.py). Stateless: the body is
# the Lab 13U correspondence export's text (hashed as sent); nothing is stored.

_calibration_lock = asyncio.Lock()


async def _read_correspondences(request: Request, dataset_id: Optional[str], poses_sha256: Optional[str]) -> tuple[dict, list]:
    if camera_calibration is None:
        raise HTTPException(503, "Calibration needs SciPy: pip install -r backend/requirements.txt")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > camera_calibration.MAX_INPUT_BYTES:
        raise HTTPException(413, "Correspondence file larger than 5 MB.")
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > camera_calibration.MAX_INPUT_BYTES:
            raise HTTPException(413, "Correspondence file larger than 5 MB.")
    try:
        loaded = camera_calibration.load_correspondences(body.decode("utf-8"), dataset_id, poses_sha256)
    except UnicodeDecodeError as error:
        raise HTTPException(400, "The file is not UTF-8 text.") from error
    except camera_calibration.CalibrationInputError as error:
        raise HTTPException(422, f"Refused: {error}") from error
    problems = []
    if xgrids_runs.list_runs().get("configured"):
        problems = camera_calibration.verify_against_runs(loaded["records"], xgrids_runs.read_run)
    return loaded, problems


def _id_list(value: Optional[str]) -> list:
    ids = [item for item in (value or "").split(",") if item]
    if len(ids) > 1000 or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", item) for item in ids):
        raise HTTPException(400, "Invalid record id list.")
    return ids


@app.post("/xgrids/calibration/audit")
async def audit_correspondences(request: Request, datasetId: Optional[str] = None, posesSha256: Optional[str] = None) -> dict:
    loaded, problems = await _read_correspondences(request, datasetId, posesSha256)
    report = await run_in_threadpool(camera_calibration.audit, loaded["records"])
    return camera_calibration._rounded({
        "source": {"sha256": loaded["sourceSha256"], "dataset": loaded["dataset"], "exported": loaded["exported"]},
        "rejected": loaded["rejected"], "runProblems": problems, "audit": report,
    })


@app.post("/xgrids/calibration/experiments")
async def run_calibration_experiment(request: Request, datasetId: Optional[str] = None, posesSha256: Optional[str] = None,
                                     exclude: Optional[str] = None, include: Optional[str] = None,
                                     sourceName: Optional[str] = None) -> dict:
    exclude_ids, include_ids = _id_list(exclude), _id_list(include)
    loaded, problems = await _read_correspondences(request, datasetId, posesSha256)
    if problems:
        raise HTTPException(422, "Refused: records disagree with their extraction run: " +
                            "; ".join(f"{p['id']}: {p['reason']}" for p in problems[:5]))
    if sourceName is not None and not re.fullmatch(r"[\w .()-]{1,120}", sourceName):
        sourceName = None

    def work() -> dict:
        report = camera_calibration.audit(loaded["records"])
        return camera_calibration.run_experiment(loaded, report, exclude_ids=exclude_ids, include_ids=include_ids, source_name=sourceName)

    async with _calibration_lock:  # one fit at a time; each takes seconds of CPU
        return await run_in_threadpool(work)


# ---------------------------------------------------------------------------
# Individual Gaussians of a trained PLY scene (gaussian_records.py, Lab 9).
# Read-only: records are read from the memory-mapped file, never modified.

MAX_SEED = 2**63 - 1


def gaussian_call(splat_id: str, read, *args) -> dict:
    metadata = get_splat_or_404(splat_id)
    try:
        return read(metadata, *args)
    except gaussian_records.GaussianReadError as error:
        raise HTTPException(400, str(error)) from error


@app.get("/splats/{splat_id}/gaussians")
def get_gaussians(splat_id: str, indices: str) -> dict:
    """indices: comma-separated, e.g. 0,17,812345 (at most 64)."""
    try:
        parsed = [int(part) for part in indices.split(",") if part.strip()]
    except ValueError:
        raise HTTPException(400, "Indices must be whole numbers separated by commas.") from None
    return gaussian_call(splat_id, gaussian_records.read_records, parsed)


@app.get("/splats/{splat_id}/gaussians/sample")
def sample_gaussians(splat_id: str, seed: int, count: int = 12) -> dict:
    if not 0 <= seed <= MAX_SEED:
        raise HTTPException(400, f"Seed must be 0–{MAX_SEED}.")
    return gaussian_call(splat_id, gaussian_records.read_sample, seed, count)


@app.get("/splats/{splat_id}/gaussians/summary")
def summarise_gaussians(splat_id: str, seed: int = 1) -> dict:
    if not 0 <= seed <= MAX_SEED:
        raise HTTPException(400, f"Seed must be 0–{MAX_SEED}.")
    return gaussian_call(splat_id, gaussian_records.summarise, seed)


# ---------------------------------------------------------------------------
# Training projects (training.py, Lab 10A): photographs prepared for Gaussian
# training. Only thumbnails are served; the photos stay in spatial-data/.


@app.get("/training/environment")
def training_environment() -> dict:
    return training_env.report()


def get_project_or_404(project_id: str) -> dict:
    try:
        project = training.read_project(project_id)
    except ValueError:
        project = None
    if project is None:
        raise HTTPException(404, "Training project not found.")
    return project


def project_view(project_id: str) -> dict:
    project = get_project_or_404(project_id)
    return training.project_view(project, training_poses.view(project))


def refuse_while_estimating(project_id: str) -> None:
    """Photos are read by a running pose job (or a package build): changing them mid-run would break or silently skew it."""
    if training_poses.is_running(project_id):
        raise HTTPException(409, "Camera poses are being estimated for this project. Wait for it to finish, or cancel it first.")
    if training_package.is_building(project_id):
        raise HTTPException(409, "A training package is being built for this project. Wait a few seconds.")


@app.get("/training")
def list_training_projects() -> list[dict]:
    return training.list_projects()


@app.post("/training", status_code=201)
def create_training_project(body: NameBody) -> dict:
    name = " ".join(body.name.split())
    if not 1 <= len(name) <= MAX_NAME_LENGTH:
        raise HTTPException(400, f"Name must be 1–{MAX_NAME_LENGTH} characters.")
    return training.project_view(training.create_project(name))


@app.get("/training/{project_id}")
def get_training_project(project_id: str) -> dict:
    return project_view(project_id)


@app.delete("/training/{project_id}", status_code=204)
def delete_training_project(project_id: str) -> None:
    get_project_or_404(project_id)
    refuse_while_estimating(project_id)
    training.delete_project(project_id)


@app.post("/training/{project_id}/images")
async def add_training_images(project_id: str, files: Annotated[list[UploadFile], File()]) -> dict:
    """Each file is checked on its own: readable JPG/PNG/HEIC photos are added, the rest are listed with a reason."""
    get_project_or_404(project_id)
    refuse_while_estimating(project_id)
    folder = training.project_dir(project_id)
    accepted: list[str] = []
    rejected: list[dict[str, str]] = []
    try:
        for upload in files:
            filename = training.display_name(upload.filename)
            incoming = folder / f".incoming-{secrets.token_hex(6)}"
            try:
                training.check_extension(filename)
                training.check_disk(upload.size or 0)
                size = await save_stream(upload, incoming, training.MAX_IMAGE_BYTES, filename)
                await run_in_threadpool(training.add_image, project_id, incoming, filename, size)
                accepted.append(filename)
            except (training.ImageRejected, UploadError) as error:
                rejected.append({"filename": filename, "reason": str(error), "at": storage.now_iso()})
            finally:
                incoming.unlink(missing_ok=True)
    except training.TrainingError as error:
        raise HTTPException(400, f"{error} ({len(accepted)} photo(s) were added before stopping.)") from error
    finally:
        training.record_rejections(project_id, rejected)
    return {"accepted": accepted, "rejected": rejected, "project": project_view(project_id)}


@app.delete("/training/{project_id}/images/{image_id}")
def remove_training_image(project_id: str, image_id: str) -> dict:
    get_project_or_404(project_id)
    refuse_while_estimating(project_id)
    if not training.remove_image(project_id, image_id):
        raise HTTPException(404, "Photo not found in this project.")
    return project_view(project_id)


@app.delete("/training/{project_id}/rejected")
def clear_training_rejections(project_id: str) -> dict:
    get_project_or_404(project_id)
    training.clear_rejections(project_id)
    return project_view(project_id)


@app.get("/training/{project_id}/images/{image_id}/thumbnail")
def get_training_thumbnail(project_id: str, image_id: str) -> FileResponse:
    path = training.thumbnail_path(get_project_or_404(project_id), image_id)
    if path is None:
        raise HTTPException(404, "Thumbnail not found.")
    return FileResponse(path, media_type="image/jpeg")


# Camera pose estimation (training_poses.py, Lab 10B step 1): COLMAP in a worker process.


@app.post("/training/{project_id}/poses", status_code=202)
def start_pose_estimation(project_id: str) -> dict:
    project = get_project_or_404(project_id)
    if training_package.is_building(project_id):
        raise HTTPException(409, "A training package is being built from the current poses. Wait a few seconds.")
    try:
        training_poses.queue(project)
    except (training_poses.PoseError, training.TrainingError) as error:
        raise HTTPException(409 if training_poses.is_running(project_id) else 400, str(error)) from error
    assert training_executor is not None
    training_executor.submit(training_poses.run, project_id)
    return project_view(project_id)


@app.post("/training/{project_id}/poses/cancel")
def cancel_pose_estimation(project_id: str) -> dict:
    get_project_or_404(project_id)
    if not training_poses.request_cancel(project_id):
        raise HTTPException(409, "No pose estimation is running for this project.")
    return project_view(project_id)


@app.get("/training/{project_id}/poses/preview")
def get_pose_preview(project_id: str) -> FileResponse:
    get_project_or_404(project_id)
    path = training_poses.preview_path(project_id)
    if path is None:
        raise HTTPException(404, "No camera poses for this project yet.")
    return FileResponse(path, media_type="application/json")


# Cloud training package (training_package.py, Lab 10C stage 1): built locally, nothing is uploaded anywhere.


@app.get("/training/{project_id}/package")
async def get_training_package(project_id: str) -> dict:
    project = get_project_or_404(project_id)
    # Reads the model and every packaged photo (about 100 MB for 175 photos): off the event loop.
    try:
        return await run_in_threadpool(training_package.view, project)
    except training_package.PackageError as error:
        raise HTTPException(400, str(error)) from error


@app.post("/training/{project_id}/package")
async def build_training_package(project_id: str) -> dict:
    project = get_project_or_404(project_id)
    if training_poses.is_running(project_id):
        raise HTTPException(409, "Camera poses are being estimated. Build the package when they are done.")
    if training_package.is_building(project_id):
        raise HTTPException(409, "A package is already being built for this project.")
    try:
        await run_in_threadpool(training_package.build, project)
        return await run_in_threadpool(training_package.view, project)
    except (training_package.PackageError, training.TrainingError) as error:
        raise HTTPException(400, str(error)) from error


@app.get("/training/{project_id}/package/download")
def download_training_package(project_id: str) -> FileResponse:
    get_project_or_404(project_id)
    path = training_package.package_path(project_id)
    record = training_package.read_record(project_id)
    if path is None or record is None:
        raise HTTPException(404, "No training package has been built for this project.")
    return FileResponse(path, media_type="application/zip", filename=record["file"])
