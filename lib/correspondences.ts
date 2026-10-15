import type { ProvisionalOrientation } from "@/lib/calibration";
import { projectLasPoint, type FisheyeModel, type ProjectionResult } from "@/lib/fisheyeProjection";
import type { Quat } from "@/lib/xgrids";

/**
 * Lab 13U: manually collected 2D ↔ 3D correspondences between an XGRIDS
 * fisheye image and the LiDAR scan, for a later calibration lab.
 *
 * Pixels: original image pixels, u right, v down, (0, 0) = centre of the
 * top-left pixel (OpenCV). LiDAR: original LAS coordinates in metres (never
 * the viewer's offset-subtracted coordinates). Everything is provisional.
 *
 * Stored in this browser's localStorage; the durable copy is the exported
 * JSON (schema below, validated on import by `parseCorrespondenceFile`).
 */

export const SCHEMA = "spatial-lab/xgrids-correspondences";
export const SCHEMA_VERSION = 1;

export type FeatureQuality = "good" | "fair" | "poor";
export const QUALITIES: FeatureQuality[] = ["good", "fair", "poor"];

/** How the LiDAR coordinate was obtained (see lib/pointPicking.ts). */
export type PickMethod = "nearest-point" | "ray-plane";

export type Correspondence = {
  id: string;
  datasetId: string;
  /** SHA-256 of the dataset's poses.csv: identifies the LAS frame (Lab 13R frame check). */
  posesSha256: string;
  runId: string;
  sequence: number;
  channel: string;
  imageFile: string;
  /** Exact integer microseconds (UTC). */
  timestampUs: number;
  imageWidth: number;
  imageHeight: number;
  pixel: { u: number; v: number };
  lidar: {
    /** Original LAS coordinates, metres. */
    las: [number, number, number];
    method: PickMethod;
    /** Approximate for "nearest-point"; ray-plane gives fit details. */
    detail: string;
    /** Point budget the pick was made on, e.g. "5m". */
    budget: string;
  };
  /** Scanner pose interpolated at this image's time (LAS), copied from the run for the next lab. */
  scannerPose: { position: [number, number, number]; quaternion: Quat };
  feature: string;
  quality: FeatureQuality;
  notes: string;
  calibrationStatus: "provisional";
  created: string;
  updated: string;
  // --- Lab 13W review fields (optional; absent in older files) ---
  /** Left out of calibration fits (the record is kept). */
  excludedFromFit?: { reason: string; at: string } | null;
  /** Your own verdict after looking at the match; absent = "unreviewed". */
  reviewStatus?: ReviewStatus;
  scene?: Scene;
  /** Corrections and exclusions, oldest first; previous values are kept here. */
  history?: HistoryEntry[];
};

export type ReviewStatus = "unreviewed" | "verified" | "needs-fix";
export const REVIEW_STATUSES: ReviewStatus[] = ["unreviewed", "verified", "needs-fix"];
export type Scene = "courtyard" | "corridor" | "indoor" | "exterior" | "other";
export const SCENES: Scene[] = ["courtyard", "corridor", "indoor", "exterior", "other"];
export type HistoryEntry = {
  at: string;
  action: "pixel" | "lidar" | "exclude" | "restore";
  /** The replaced pixel / LiDAR value, or the exclusion reason. */
  previous?: unknown;
};
export const MAX_HISTORY = 100;

/** A changed copy of `r` with the change logged in its history (id and created are kept). */
export function withChange(r: Correspondence, change: Partial<Correspondence>, action: HistoryEntry["action"], previous?: unknown): Correspondence {
  const now = new Date().toISOString();
  const history = [...(r.history ?? []), { at: now, action, previous }].slice(-MAX_HISTORY);
  return { ...r, ...change, id: r.id, created: r.created, updated: now, history };
}

const STORAGE_KEY = "spatial-lab.correspondences.v1";

export function loadStored(): Correspondence[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = parseRecords(JSON.parse(raw));
    return parsed.records;
  } catch {
    return [];
  }
}

export function store(records: Correspondence[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export const newId = () => `c_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

// --- Validation -------------------------------------------------------------

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isString = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length <= max;
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);

/** Returns a reason when `r` is not a valid record, null when it is. */
export function invalidReason(r: unknown): string | null {
  if (typeof r !== "object" || r === null) return "not an object";
  const c = r as Record<string, unknown>;
  if (!isString(c.id, 64) || !/^[A-Za-z0-9_-]{1,64}$/.test(c.id)) return "bad id";
  for (const key of ["datasetId", "posesSha256", "runId", "channel", "imageFile", "feature", "notes", "created", "updated"])
    if (!isString(c[key])) return `${key} must be a string`;
  if (!/^ch\d+$/.test(c.channel as string)) return "bad channel";
  for (const key of ["sequence", "timestampUs", "imageWidth", "imageHeight"])
    if (!Number.isSafeInteger(c[key]) || (c[key] as number) < 0) return `${key} must be a non-negative integer`;
  const w = c.imageWidth as number;
  const h = c.imageHeight as number;
  const px = c.pixel as Record<string, unknown> | undefined;
  if (!px || !isFiniteNumber(px.u) || !isFiniteNumber(px.v)) return "pixel must have numeric u, v";
  if (px.u < -0.5 || px.u > w - 0.5 || px.v < -0.5 || px.v > h - 0.5) return "pixel outside the image";
  const l = c.lidar as Record<string, unknown> | undefined;
  if (!l || !isVec3(l.las)) return "lidar.las must be [x, y, z]";
  if (l.method !== "nearest-point" && l.method !== "ray-plane") return "bad lidar.method";
  if (!isString(l.detail) || !isString(l.budget, 32)) return "bad lidar detail/budget";
  const p = c.scannerPose as Record<string, unknown> | undefined;
  if (!p || !isVec3(p.position) || !Array.isArray(p.quaternion) || p.quaternion.length !== 4 || !p.quaternion.every(isFiniteNumber))
    return "bad scannerPose";
  if (!QUALITIES.includes(c.quality as FeatureQuality)) return "bad quality";
  if (c.calibrationStatus !== "provisional") return "calibrationStatus must be provisional";
  const ex = c.excludedFromFit as Record<string, unknown> | null | undefined;
  if (ex !== undefined && ex !== null && !(typeof ex === "object" && isString(ex.reason, 500) && isString(ex.at, 64))) return "bad excludedFromFit";
  if (c.reviewStatus !== undefined && !REVIEW_STATUSES.includes(c.reviewStatus as ReviewStatus)) return "bad reviewStatus";
  if (c.scene !== undefined && !SCENES.includes(c.scene as Scene)) return "bad scene";
  const history = c.history;
  const validEntry = (e: unknown) => typeof e === "object" && e !== null && isString((e as HistoryEntry).at, 64) && isString((e as HistoryEntry).action, 32);
  if (history !== undefined && !(Array.isArray(history) && history.length <= MAX_HISTORY && history.every(validEntry))) return "bad history";
  return null;
}

function parseRecords(value: unknown): { records: Correspondence[]; rejected: string[] } {
  if (!Array.isArray(value)) throw new Error("correspondences must be an array");
  const records: Correspondence[] = [];
  const rejected: string[] = [];
  value.forEach((r, i) => {
    const reason = invalidReason(r);
    if (reason) rejected.push(`#${i + 1}: ${reason}`);
    else records.push(r as Correspondence);
  });
  return { records, rejected };
}

// --- Export / import --------------------------------------------------------

export type ExportContext = {
  dataset: { id: string; name: string; posesSha256: string | null };
  model: FisheyeModel;
  offsets: Record<string, ProvisionalOrientation>;
};

export function buildExport(records: Correspondence[], context: ExportContext) {
  const diagnostics = records.map((r) => {
    const p = predict(r, context.offsets, context.model);
    return { id: r.id, predicted: p.valid ? { u: round(p.u, 2), v: round(p.v, 2) } : null, errorPx: p.valid ? round(p.errorPx, 2) : null, invalidReason: p.valid ? null : p.reason };
  });
  return {
    schema: SCHEMA,
    version: SCHEMA_VERSION,
    exported: new Date().toISOString(),
    calibrationStatus: "provisional",
    dataset: context.dataset,
    conventions: {
      reference: "docs/xgrids/provisional-camera-directions.json (unchanged)",
      pixel: "original image pixels; u right, v down; (0, 0) = centre of the top-left pixel (OpenCV)",
      lidar: "original LAS coordinates, metres (dataset/viewer offset added back)",
      scannerPose: "v_las = R(q) · v_body, q = (x, y, z, w); body X forward, Y left, Z up",
      camera: "provisional frame X = optical axis, Y = image left, Z = image up; v_body = R_offset · v_cam, R_offset = Rz(−yaw)·Ry(−pitch)·Rx(roll); lever arm assumed 0",
    },
    projectionUsedForDiagnostics: {
      model: context.model,
      offsets: context.offsets,
      note: "Assumed intrinsics and provisional rotations, not a calibration. Errors are diagnostics only.",
      perRecord: diagnostics,
      stats: errorStats(diagnostics.flatMap((d) => (d.errorPx === null ? [] : [d.errorPx]))),
    },
    correspondences: records,
  };
}

/** Parse an exported file. Throws on a wrong schema; invalid records are listed, not imported. */
export function parseCorrespondenceFile(text: string): { records: Correspondence[]; rejected: string[] } {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (data?.schema !== SCHEMA) throw new Error(`not a ${SCHEMA} file`);
  if (data.version !== SCHEMA_VERSION) throw new Error(`unsupported version ${String(data.version)}`);
  return parseRecords(data.correspondences);
}

/** Add imported records; an id that already exists is kept as is and reported. */
export function mergeRecords(existing: Correspondence[], incoming: Correspondence[]) {
  const ids = new Set(existing.map((r) => r.id));
  const added = incoming.filter((r) => !ids.has(r.id));
  return { records: [...existing, ...added], added: added.length, duplicates: incoming.length - added.length };
}

// --- Diagnostics ------------------------------------------------------------

export type Prediction =
  | { valid: true; u: number; v: number; thetaDeg: number; rangeM: number; errorPx: number }
  | { valid: false; reason: string };

/** Project a record's LiDAR point with the provisional model; error only when the projection is valid. */
export function predict(r: Correspondence, offsets: Record<string, ProvisionalOrientation>, model: FisheyeModel): Prediction {
  const orientation = offsets[r.channel];
  if (!orientation) return { valid: false, reason: `no offset for ${r.channel}` };
  const p = projectLasPoint(r.lidar.las, r.scannerPose.position, r.scannerPose.quaternion, orientation, model);
  if (p.valid === false) return { valid: false, reason: p.reason };
  return { ...p, errorPx: Math.hypot(p.u - r.pixel.u, p.v - r.pixel.v) };
}

export function errorStats(errors: number[]) {
  if (errors.length === 0) return { count: 0, mean: null, median: null, rms: null };
  const sorted = [...errors].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    count: errors.length,
    mean: round(errors.reduce((a, b) => a + b, 0) / errors.length, 2),
    median: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, 2),
    rms: round(Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length), 2),
  };
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
