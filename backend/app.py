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

Only converted assets are served; original uploads never leave spatial-data/.
Conversions run one at a time in a separate worker process.
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

import storage
from converter import NORMALISED_POSES_FILE, convert_dataset
from uploads import UploadError, inspect_json, inspect_las, inspect_text_csv, save_upload

MAX_NAME_LENGTH = 80
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
    yield
    executor.shutdown(cancel_futures=True)


app = FastAPI(title="Spatial Lab datasets", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
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
            info = {"filename": os.path.basename(upload.filename or "")[:200], "bytes": size}
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
    storage.delete_dataset(dataset_id)


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
