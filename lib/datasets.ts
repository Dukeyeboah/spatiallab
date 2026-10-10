/**
 * Datasets: one LiDAR capture each, with its own coordinate offset.
 *
 * Two origins:
 *   - "builtin": the original map.las scan, converted earlier into public/data/.
 *     Always available, even when the backend isn't running.
 *   - "local-backend": imported through the Datasets panel, converted and
 *     served by the local FastAPI service in backend/ (see backend/app.py).
 *
 * Both use the same metadata shape (backend/storage.py: new_metadata), so the
 * viewer never needs to know where a dataset came from — only these URLs do.
 *
 * Coordinate rule: every point budget AND the poses of a dataset subtract the
 * dataset's own `offset`, computed once from its full original point cloud.
 * Datasets are never re-centred independently per budget.
 */

export type Vec3 = [number, number, number];

export type DatasetStatus = "queued" | "converting" | "ready" | "failed";
/** aligned = poses passed the frame checks and are displayed; otherwise hidden with a reason. */
export type PoseStatus = "aligned" | "suspect" | "invalid";
export type UploadRole = "pointcloud" | "poses" | "project" | "control_points" | "gnss";

export type DatasetBudget = {
  /** "500k" | "1m" | "2m" | "all" */
  key: string;
  label: string;
  pointCount: number;
};

export type DatasetPoses = {
  status: PoseStatus;
  count: number;
  message: string;
  checks?: Record<string, unknown>;
};

export type SourceFileInfo = {
  /** The uploader's file name, display only (stored under a fixed name). */
  filename: string;
  bytes: number;
  [fact: string]: unknown;
};

export type Dataset = {
  schemaVersion: number;
  id: string;
  name: string;
  kind: string;
  origin: "builtin" | "local-backend";
  createdAt: string;
  status: DatasetStatus;
  /** 0..1 while converting. */
  progress: number;
  stage: string;
  error: string | null;
  source: Partial<Record<UploadRole, SourceFileInfo>>;
  originalPointCount: number | null;
  /** Real-world coordinates of the full original point cloud. */
  originalBounds: { min: Vec3; max: Vec3 } | null;
  /** Subtracted from every budget and from the poses: X/Y centre, lowest Z. */
  offset: Vec3 | null;
  hasRgb: boolean | null;
  budgets: DatasetBudget[];
  poses: DatasetPoses | null;
  /** control_points.csv / gnss.csv: preserved for later, schema not assumed. */
  attachments: (SourceFileInfo & { role: UploadRole })[];
};

/** The original scan (Labs 1–6). Values printed by scripts/convert_las.py for map.las. */
export const BUILTIN_DATASET: Dataset = {
  schemaVersion: 1,
  id: "builtin-map",
  name: "map.las (built-in)",
  kind: "lidar-capture",
  origin: "builtin",
  createdAt: "2025-08-21T00:00:00Z",
  status: "ready",
  progress: 1,
  stage: "Ready",
  error: null,
  source: {
    pointcloud: { filename: "map.las", bytes: 178_258_147, lasVersion: "1.2", pointFormat: 3, hasRgb: true },
    poses: { filename: "poses.csv", bytes: 20_480 },
  },
  originalPointCount: 5_242_880,
  originalBounds: {
    min: [-23.418001112295315, -5.199000246939249, -1.1450000543845817],
    max: [7.025000333669595, 31.39300149108749, 6.175000293296762],
  },
  offset: [-8.19650038931286, 13.09700062207412, -1.1450000543845817],
  hasRgb: true,
  budgets: [
    { key: "500k", label: "500K", pointCount: 500_000 },
    { key: "1m", label: "1M", pointCount: 1_000_000 },
    { key: "2m", label: "2M", pointCount: 2_000_000 },
  ],
  poses: {
    status: "aligned",
    count: 208,
    message:
      "Poses agree with the point cloud (median 0.30 m from the nearest scan point). " +
      "Quaternion order assumed qx, qy, qz, qw.",
  },
  attachments: [],
};

/** The local backend. Override with NEXT_PUBLIC_SPATIAL_API_URL. */
export const API_URL = process.env.NEXT_PUBLIC_SPATIAL_API_URL ?? "http://127.0.0.1:8000";

export function pointsUrl(dataset: Dataset, budgetKey: string): string {
  return dataset.origin === "builtin"
    ? `/data/pointcloud-${budgetKey}.bin`
    : `${API_URL}/datasets/${dataset.id}/points/${budgetKey}`;
}

export function posesUrl(dataset: Dataset): string {
  return dataset.origin === "builtin" ? "/data/poses.csv" : `${API_URL}/datasets/${dataset.id}/poses`;
}

const NOMINAL_POINTS: Record<string, number> = { "500k": 5e5, "1m": 1e6, "2m": 2e6, all: Infinity };

/**
 * The budget to show for a preferred budget key. Same key if the dataset has
 * it; otherwise the largest budget that isn't bigger than the preference
 * (a 300K-point dataset only has "All (300K)").
 */
export function pickBudget(budgets: DatasetBudget[], preferredKey: string): DatasetBudget | null {
  const exact = budgets.find((b) => b.key === preferredKey);
  if (exact) return exact;
  const limit = NOMINAL_POINTS[preferredKey] ?? Infinity;
  const fitting = budgets.filter((b) => b.pointCount <= limit);
  return fitting.at(-1) ?? budgets[0] ?? null;
}

// ---------------------------------------------------------------------------
// Backend API

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // not JSON
  }
  return `HTTP ${response.status}`;
}

export async function fetchDatasets(signal?: AbortSignal): Promise<Dataset[]> {
  const response = await fetch(`${API_URL}/datasets`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  const list = (await response.json()) as Omit<Dataset, "origin">[];
  return list.map((metadata) => ({ ...metadata, origin: "local-backend" }));
}

export async function deleteDataset(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/datasets/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response));
}

/**
 * Upload files for a new dataset. Uses XMLHttpRequest because fetch() can't
 * report upload progress. Conversion progress is then read by polling.
 */
export function uploadDataset(
  form: FormData,
  onProgress: (fraction: number) => void,
): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/datasets`);
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
      if (request.status === 201 && body) {
        resolve({ ...(body as Omit<Dataset, "origin">), origin: "local-backend" });
      } else {
        const detail = typeof body?.detail === "string" ? body.detail : `HTTP ${request.status}`;
        reject(new Error(detail));
      }
    };
    request.onerror = () => reject(new Error(`Could not reach the local backend at ${API_URL}.`));
    request.send(form);
  });
}

// ---------------------------------------------------------------------------
// Upload roles (one file each). File detection lives in lib/importPlan.ts;
// the backend checks again, including contents.

export const UPLOAD_ROLES: { role: UploadRole; label: string; extension: string; required: boolean }[] = [
  { role: "pointcloud", label: "Point cloud", extension: ".las", required: true },
  { role: "poses", label: "Scanner poses", extension: ".csv", required: false },
  { role: "project", label: "Project metadata", extension: ".json", required: false },
  { role: "control_points", label: "Control points", extension: ".csv", required: false },
  { role: "gnss", label: "GNSS", extension: ".csv", required: false },
];
