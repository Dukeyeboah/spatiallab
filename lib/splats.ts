/**
 * Gaussian splat scenes (Lab 8): trained 3D Gaussian splats imported through
 * the local backend (backend/splats.py) and shown with the official
 * SuperSplat Viewer. A separate store from the LiDAR datasets.
 *
 * Supported imports (the viewer loads every one of them directly):
 *   - a trained Gaussian .ply (binary little-endian, 3DGS properties) or .compressed.ply
 *   - a bundled .sog file
 *   - a SOG folder: meta.json + WebP images, or lod-meta.json + chunk folders
 *   - a .zip of any of these (e.g. a SuperSplat download); extracted by the backend
 * Other splat formats (.splat, .ksplat, .spz) are converted to .sog with
 * SplatTransform first (see docs/SPATIAL_LAB_REBUILD_GUIDE.md).
 *
 * A trained scene keeps its own frame (as trained): it is never assumed to
 * line up with a LiDAR capture, even in the same capture of the catalog.
 */

import { API_URL, errorMessage, type Vec3 } from "./datasets";

export type SplatFormat = "ply" | "compressed-ply" | "sog" | "sog-folder" | "sog-lod";

export type SplatScene = {
  schemaVersion: number;
  id: string;
  name: string;
  kind: "gaussian-scene";
  createdAt: string;
  format: SplatFormat;
  formatLabel: string;
  splatCount: number | null;
  /** Spherical-harmonic bands beyond the base colour (0..3). */
  shBands: number | null;
  lodLevels: number | null;
  source: { kind: "file" | "folder" | "zip"; filename: string; bytes: number; fileCount: number };
  servedFrom: "source" | "converted";
  /** The file the viewer opens (format chosen by its name), relative to servedFrom. */
  entry: string;
  /** Every file the viewer may fetch. */
  files: { path: string; bytes: number }[];
  sceneBytes: number;
  conversion: { step: string; detail: string } | null;
  /** license.txt shipped with the scene: credit the author as it says. */
  license: string | null;
  /** 2nd–98th percentile box of the splat centres, in the file's frame (null if unmeasured). */
  robustBounds: {
    min: Vec3;
    max: Vec3;
    percentiles: [number, number];
    sampledCentres: number;
    /** Share of centres in the middle half of the box: low for rooms (shells), high for objects. */
    centralFraction?: number;
    /** A camera spot in open space, looking along the longest clear line of sight (file frame). */
    insideViewpoint?: { position: Vec3; target: Vec3 } | null;
  } | null;
  warnings: string[];
  frame: { units: string; upAxis: string; alignedTo: string | null };
};

/** Scene URL for the viewer. Relative assets (WebP images, LOD chunks) resolve next to it. */
export function splatContentUrl(scene: SplatScene): string {
  const path = scene.entry.split("/").map(encodeURIComponent).join("/");
  return `${API_URL}/splats/${encodeURIComponent(scene.id)}/files/${path}`;
}

export type CameraPose = { position: Vec3; target: Vec3; fov: number };
export type StartView = "inside" | "outside";

const START_FOV = 60;
/** Above this centralFraction a scene is treated as an object (see backend/splat_bounds.py). */
const OBJECT_CENTRAL_FRACTION = 0.35;

/** Rooms and places are best seen from inside, objects from outside. A heuristic; the panel can switch. */
export function defaultStartView(scene: SplatScene): StartView {
  return (scene.robustBounds?.centralFraction ?? 0) > OBJECT_CENTRAL_FRACTION ? "outside" : "inside";
}

/**
 * The viewer's starting camera (also where Reset camera goes), from the
 * robust box rather than the full one: a few far-away floaters make the full
 * box many times bigger than the scene.
 *
 *   outside  framed like the viewer's own frameScene(): from direction
 *            (2, 1, 2), far enough for the box's bounding sphere to fit
 *   inside   the backend's free viewpoint (empty space near the middle,
 *            looking along the longest clear line of sight); without one,
 *            near the middle of the box looking at its centre
 *
 * The viewer turns every scene 180° about Z (trained frames are usually
 * Y-down, the viewer is Y-up), so file-frame values become
 * (x, y, z) -> (-x, -y, z) first.
 */
export function startCamera(scene: SplatScene, view: StartView): CameraPose | null {
  const bounds = scene.robustBounds;
  if (!bounds) return null;
  const toViewer = ([x, y, z]: Vec3): Vec3 => [-x, -y, z];
  if (view === "inside" && bounds.insideViewpoint) {
    const { position, target } = bounds.insideViewpoint;
    return { position: toViewer(position), target: toViewer(target), fov: START_FOV };
  }
  const min: Vec3 = [-bounds.max[0], -bounds.max[1], bounds.min[2]];
  const max: Vec3 = [-bounds.min[0], -bounds.min[1], bounds.max[2]];
  const target = min.map((v, i) => (v + max[i]) / 2) as Vec3;
  const half = min.map((v, i) => (max[i] - v) / 2);
  let offset: number[];
  if (view === "outside") {
    const distance = Math.hypot(...half) / Math.sin((START_FOV * Math.PI) / 360);
    offset = [2, 1, 2].map((v) => (v / 3) * distance);
  } else {
    // 30% of the way to the box's side, slightly above the centre.
    offset = [0.3 * half[0], 0.1 * half[1], 0.3 * half[2]];
  }
  return { position: target.map((v, i) => v + offset[i]) as Vec3, target, fov: START_FOV };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function fetchSplats(signal?: AbortSignal): Promise<SplatScene[]> {
  const response = await fetch(`${API_URL}/splats`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function deleteSplat(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/splats/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response));
}

/** Upload with progress (XMLHttpRequest; fetch can't report upload progress). */
export function uploadSplat(form: FormData, onProgress: (fraction: number) => void): Promise<SplatScene> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/splats`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let body: { detail?: unknown } | null = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // not JSON
      }
      if (request.status === 201 && body) resolve(body as SplatScene);
      else reject(new Error(typeof body?.detail === "string" ? body.detail : `HTTP ${request.status}`));
    };
    request.onerror = () => reject(new Error(`Could not reach the local backend at ${API_URL}.`));
    request.send(form);
  });
}

// ---------------------------------------------------------------------------
// What the user picked, checked before uploading (the backend checks again,
// including contents).

export type SplatSelection =
  | { kind: "file"; file: File }
  | { kind: "folder"; files: { file: File; path: string }[] };

const SINGLE_FILE_EXTENSIONS = [".compressed.ply", ".ply", ".sog", ".zip"];
const PACKAGE_EXTENSIONS = [".json", ".webp", ".sog", ".txt"];

function hidden(path: string): boolean {
  return path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");
}

/** Folder picker -> the files with their relative paths (hidden files dropped). */
export function folderSelection(files: FileList): SplatSelection {
  return {
    kind: "folder",
    files: Array.from(files)
      .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
      .filter(({ path }) => !hidden(path)),
  };
}

/** A short description of the selection, or an error that stops the upload. */
export function describeSelection(selection: SplatSelection): { summary: string; error: string | null } {
  if (selection.kind === "file") {
    const { name, size } = selection.file;
    const lower = name.toLowerCase();
    const ok = SINGLE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
    return {
      summary: `${name} (${formatBytes(size)})`,
      error: ok
        ? null
        : `"${name}" isn't a scene file. Choose a trained Gaussian .ply, a .sog, a .zip, or a SOG folder.` +
          (/\.(splat|ksplat|spz)$/.test(lower) ? " Convert .splat/.ksplat/.spz to .sog with SplatTransform first." : ""),
    };
  }
  const parts = selection.files.filter(({ path }) => PACKAGE_EXTENSIONS.some((e) => path.toLowerCase().endsWith(e)));
  const bytes = parts.reduce((sum, { file }) => sum + file.size, 0);
  const lod = parts.some(({ path }) => path.endsWith("/lod-meta.json") || path === "lod-meta.json");
  const meta = parts.some(({ path }) => path.endsWith("/meta.json") || path === "meta.json");
  const webp = parts.filter(({ path }) => path.toLowerCase().endsWith(".webp")).length;
  const ignored = selection.files.length - parts.length;
  return {
    summary:
      `${parts.length} package files (${webp} WebP, ${formatBytes(bytes)})` +
      (lod ? ", levels of detail" : "") +
      (ignored ? `; ${ignored} other files ignored` : ""),
    error:
      lod || meta
        ? null
        : "No meta.json or lod-meta.json in this folder: choose the folder of a SOG scene (or import its .zip).",
  };
}

export function selectionForm(name: string, selection: SplatSelection): FormData {
  const form = new FormData();
  form.append("name", name);
  if (selection.kind === "file") {
    form.append("files", selection.file);
  } else {
    // Only package file types are sent (a SuperSplat export folder also holds html/js).
    for (const { file, path } of selection.files) {
      if (!PACKAGE_EXTENSIONS.some((e) => path.toLowerCase().endsWith(e))) continue;
      form.append("files", file);
      form.append("paths", path);
    }
  }
  return form;
}

/** A default scene name from the selection ("Ceramic Studio.zip" -> "Ceramic Studio"). */
export function defaultName(selection: SplatSelection): string {
  const raw =
    selection.kind === "file" ? selection.file.name : (selection.files[0]?.path.split("/")[0] ?? "Gaussian scene");
  return raw.replace(/(\.compressed)?\.(ply|sog|zip)$/i, "").slice(0, 80) || "Gaussian scene";
}
