/**
 * Lab 10A: training projects. Photographs of a physical space, uploaded to
 * the local backend (backend/training.py), validated and prepared for
 * Gaussian splatting training. Nothing is trained here: the stages are a
 * plan for Lab 10B, and the checks are warnings that can't tell whether the
 * photos overlap enough (only camera pose estimation can).
 */

import { API_URL, errorMessage } from "./datasets";

export const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"];
const UPLOAD_BATCH = 8;

export type WarningKind = "low-resolution" | "blur" | "duplicate" | "near-duplicate" | "dimensions" | "orientation";

export type TrainingImage = {
  id: string;
  /** The client's file name: display text only. */
  filename: string;
  bytes: number;
  addedAt: string;
  format: "JPEG" | "PNG" | "HEIF";
  /** As seen (EXIF orientation applied). */
  width: number;
  height: number;
  orientation: number;
  camera: { make: string | null; model: string | null; focalLengthMm: number | null; focalLength35mm: number | null } | null;
  takenAt: string | null;
  sha256: string;
  dhash: string;
  /** Variance of the Laplacian at 1024 px: higher = more fine detail (blur heuristic). */
  sharpness: number;
  notes: string[];
};

export type Stage = { key: string; title: string; detail: string; tools: string[]; output: string; status: "planned" };

export type TrainingProject = {
  id: string;
  name: string;
  createdAt: string;
  images: TrainingImage[];
  rejected: { filename: string; reason: string; at: string }[];
  association: { propertyId: string | null; captureId: string | null };
  jobs: unknown[];
  analysis: {
    imageCount: number;
    totalBytes: number;
    sizes: { width: number; height: number; count: number }[];
    cameras: { label: string; count: number }[];
    medianSharpness: number;
    warningCounts: Partial<Record<WarningKind, number>>;
    imagesWithWarnings: number;
    duplicateGroups: string[][];
    warnings: Record<string, { kind: WarningKind; message: string }[]>;
  };
  stages: Stage[];
};

export type ProjectSummary = { id: string; name: string; createdAt: string; imageCount: number; totalBytes: number };

export type Environment = {
  os: string;
  architecture: string;
  cpu: string;
  cpuCores: number | null;
  memoryBytes: number | null;
  gpus: { name: string; vendor: string; api: string; memoryBytes: number | null; detail: string }[];
  tools: Record<string, { label: string; path: string | null }>;
  pythonPackages: Record<string, boolean>;
  diskFreeBytes: number;
  assessment: { verdict: "local-cuda" | "local-metal-limited" | "cpu-only"; summary: string; notes: string[] };
};

/** What each warning means, in plain language (shown in the panel). */
export const WARNING_LABELS: Record<WarningKind, { label: string; explain: string }> = {
  "low-resolution": {
    label: "Low resolution",
    explain: "Shorter side under 1000 px. Fewer details to match between photos and to train from.",
  },
  blur: {
    label: "Possibly blurry",
    explain:
      "Little fine detail compared with the other photos (a heuristic: plain walls also score low). Motion blur weakens feature matching and softens the result.",
  },
  duplicate: { label: "Duplicate", explain: "Byte-for-byte the same file as another photo. Adds nothing." },
  "near-duplicate": {
    label: "Near-duplicate",
    explain:
      "Almost the same picture as another photo (same view, or a resized/re-encoded copy). Harmless, but adds little; real photo sets need different viewpoints.",
  },
  dimensions: {
    label: "Different size",
    explain: "Not the same width × height as most photos (another camera, zoom or crop). Each size needs its own camera model in pose estimation.",
  },
  orientation: {
    label: "Rotated",
    explain: "Portrait vs landscape compared with most photos. Fine, but handled as a separate camera size.",
  },
};

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

const base = `${API_URL}/training`;
const id = encodeURIComponent;

/** /training itself answering 404 (or 405 for POST) means a backend started before Lab 10A. */
function checkTrainingRoute(response: Response): Response {
  if (response.status === 404 || response.status === 405) {
    throw new Error(
      `The backend at ${API_URL} is running but has no /training endpoint: it was started before Lab 10A. ` +
        "Restart it (Ctrl+C, then uvicorn again) after pip install -r requirements.txt.",
    );
  }
  return response;
}

export const trainingApi = {
  list: () => fetch(base, { cache: "no-store" }).then((r) => json<ProjectSummary[]>(checkTrainingRoute(r))),
  get: (projectId: string) => fetch(`${base}/${id(projectId)}`, { cache: "no-store" }).then((r) => json<TrainingProject>(r)),
  create: (name: string) =>
    fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then(
      (r) => json<TrainingProject>(checkTrainingRoute(r)),
    ),
  remove: async (projectId: string) => {
    const response = await fetch(`${base}/${id(projectId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await errorMessage(response));
  },
  removeImage: (projectId: string, imageId: string) =>
    fetch(`${base}/${id(projectId)}/images/${id(imageId)}`, { method: "DELETE" }).then((r) => json<TrainingProject>(r)),
  clearRejected: (projectId: string) =>
    fetch(`${base}/${id(projectId)}/rejected`, { method: "DELETE" }).then((r) => json<TrainingProject>(r)),
  environment: () => fetch(`${base}/environment`, { cache: "no-store" }).then((r) => json<Environment>(r)),
};

export const thumbnailUrl = (projectId: string, imageId: string) =>
  `${base}/${id(projectId)}/images/${id(imageId)}/thumbnail`;

/** Splits a selection: photos to upload, and files skipped before uploading (hidden files are ignored silently). */
export function partitionFiles(files: File[]): { photos: File[]; skipped: { filename: string; reason: string }[] } {
  const photos: File[] = [];
  const skipped: { filename: string; reason: string }[] = [];
  for (const file of files) {
    if (file.name.startsWith(".")) continue;
    const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
    if (ACCEPTED_EXTENSIONS.includes(extension)) photos.push(file);
    else
      skipped.push({
        filename: file.name,
        reason: `Not uploaded: only JPG, PNG and HEIC photos are supported (${extension || "no extension"}).`,
      });
  }
  return { photos, skipped };
}

type BatchResult = { accepted: string[]; rejected: { filename: string; reason: string }[]; project: TrainingProject };

function uploadBatch(projectId: string, files: File[], onProgress: (loaded: number) => void): Promise<BatchResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);
    const request = new XMLHttpRequest();
    request.open("POST", `${base}/${id(projectId)}/images`);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      let body: { detail?: string } & Partial<BatchResult> = {};
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // not JSON
      }
      if (request.status >= 200 && request.status < 300) resolve(body as BatchResult);
      else reject(new Error(body.detail ?? `Upload failed (HTTP ${request.status}).`));
    };
    request.onerror = () => reject(new Error(`The local backend isn't reachable at ${API_URL}.`));
    request.send(form);
  });
}

/** Uploads in small batches (one request each), reporting overall progress 0..1. */
export async function uploadPhotos(
  projectId: string,
  photos: File[],
  onProgress: (fraction: number) => void,
): Promise<{ accepted: number; rejected: { filename: string; reason: string }[]; project: TrainingProject | null }> {
  const total = photos.reduce((sum, f) => sum + f.size, 0) || 1;
  let done = 0;
  let accepted = 0;
  const rejected: { filename: string; reason: string }[] = [];
  let project: TrainingProject | null = null;
  for (let i = 0; i < photos.length; i += UPLOAD_BATCH) {
    const batch = photos.slice(i, i + UPLOAD_BATCH);
    const result = await uploadBatch(projectId, batch, (loaded) => onProgress((done + loaded) / total));
    done += batch.reduce((sum, f) => sum + f.size, 0);
    accepted += result.accepted.length;
    rejected.push(...result.rejected);
    project = result.project;
  }
  onProgress(1);
  return { accepted, rejected, project };
}
