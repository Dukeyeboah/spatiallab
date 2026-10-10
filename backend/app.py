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
    DELETE /captures/{id}/datasets/{dsId}    unassign

Only converted assets are served; original uploads never leave spatial-data/.
Conversions run one at a time in a separate worker process; budgets added
after a dataset was converted (e.g. 5M) are generated there at startup.
"""

import os
import shutil
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from multiprocessing import get_context
from typing import Annotated, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import catalog
import storage
from catalog import CatalogError
from converter import NORMALISED_POSES_FILE, backfill_budgets, convert_dataset
from uploads import (
    UploadError,
    infer_project_metadata,
    inspect_json,
    inspect_las,
    inspect_text_csv,
    is_blank,
    save_upload,
)

MAX_NAME_LENGTH = 80
ROLE_LABELS = {"poses": "Poses", "project": "Project metadata", "control_points": "Control points", "gnss": "GNSS"}
ALLOWED_ORIGINS = os.environ.get(
    "SPATIAL_LAB_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

executor: Optional[ProcessPoolExecutor] = None


def start_conversion(dataset_id: str) -> None:
    assert executor is not None
    executor.submit(convert_dataset, dataset_id)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global executor
    storage.DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    # "spawn": a clean worker process (no copy of the server's state).
    executor = ProcessPoolExecutor(max_workers=1, mp_context=get_context("spawn"))
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
    if dataset_id != catalog.BUILTIN_DATASET_ID:
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
