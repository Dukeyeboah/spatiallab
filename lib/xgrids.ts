/**
 * Lab 13R: XGRIDS camera extraction runs, served read-only by the local
 * backend (backend/xgrids_runs.py) from SPATIAL_LAB_XGRIDS_DIR, outside the
 * repository. A run = the output of scripts/xgrids/extract_frames.py.
 *
 * Scanner poses in a run are poses.csv values interpolated at each image time,
 * in poses.csv's frame (original LAS coordinates for Basel House). They are
 * the scanner's pose, not a camera's: camera extrinsics are unknown.
 */

import { API_URL, errorMessage, type Vec3 } from "./datasets";
import type { PoseData } from "./loadPoses";

export type Quat = [number, number, number, number];

export type RunImage = {
  /** null if the frame wasn't decoded (see decoderStatus). */
  file: string | null;
  /** Exact integer microseconds since 1970 UTC (< 2^53, so exact in JS). */
  timestampUs: number;
  timestampUtc: string;
  spsOffset: number;
  h264Bytes: number;
  decoderStatus: string;
  decoderMessage: string;
  jpegBytes: number | null;
  jpegSha256: string;
  width: number | null;
  height: number | null;
  pose: {
    status: string;
    beforeUs: number | null;
    afterUs: number | null;
    alpha: number | null;
    /** poses.csv frame (original LAS coordinates), metres. */
    position: Vec3 | null;
    /** (x, y, z, w) */
    quaternion: Quat | null;
  };
  /** Always "unknown" so far. */
  extrinsics: string;
};

export type RunEvent = {
  index: number;
  pairId: number;
  sequence: number;
  /** Keyed by camera channel, e.g. "ch14", "ch18". */
  images: Record<string, RunImage>;
};

export type RunSource = {
  xbin: string | null;
  xbinBytes: number | null;
  framesSha256: string | null;
  poses: string | null;
  posesSha256: string | null;
};

export type RunSummary = {
  id: string;
  mode?: string | null;
  eventCount?: number;
  imageStatus?: Record<string, number> | null;
  source?: RunSource;
  /** Set when the run's manifest couldn't be read. */
  error?: string;
};

export type Run = Required<Omit<RunSummary, "error">> & {
  excludedOutsidePoseRange: { events: number; sequences: number[]; firstUtc: string; lastUtc: string } | null;
  notes: string[];
  events: RunEvent[];
};

export type RunList = { configured: boolean; rootExists?: boolean; runs: RunSummary[] };

export async function fetchRuns(signal?: AbortSignal): Promise<RunList> {
  const response = await fetch(`${API_URL}/xgrids/runs`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function fetchRun(runId: string, signal?: AbortSignal): Promise<Run> {
  const response = await fetch(`${API_URL}/xgrids/runs/${encodeURIComponent(runId)}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export function runImageUrl(runId: string, file: string): string {
  return `${API_URL}/xgrids/runs/${encodeURIComponent(runId)}/images/${encodeURIComponent(file)}`;
}

/** Channels of an event in a fixed order (ch14 before ch18). */
export function eventChannels(event: RunEvent): string[] {
  return Object.keys(event.images).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

/** The event's earliest image: its time and pose stand for the capture event. */
export function eventReference(event: RunEvent): RunImage {
  return Object.values(event.images).reduce((a, b) => (b.timestampUs < a.timestampUs ? b : a));
}

/**
 * extract_frames.py names images seq<sequence>_<channel>_t<timestamp µs>.jpg:
 * true when the name agrees with the manifest row it is listed under.
 */
export function imageNameMatches(event: RunEvent, channel: string, image: RunImage): boolean {
  const match = image.file ? /^seq(\d+)_(ch\d+)_t(\d+)\.jpg$/.exec(image.file) : null;
  return !!match && Number(match[1]) === event.sequence && match[2] === channel && Number(match[3]) === image.timestampUs;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Position of the loaded poses at a time (µs), linearly interpolated, in
 * dataset coordinates (offset subtracted). An independent check of a run's
 * scanner position; null outside the pose range.
 */
export function positionAt(poses: PoseData, timestampUs: number): Vec3 | null {
  const t = timestampUs / 1e6;
  const times = poses.timestamps;
  if (poses.count < 2 || t < times[0] || t > times[poses.count - 1]) return null;
  let lo = 0;
  let hi = poses.count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = (t - times[lo]) / (times[hi] - times[lo]);
  const p = poses.positions;
  return [0, 1, 2].map((k) => p[lo * 3 + k] + a * (p[hi * 3 + k] - p[lo * 3 + k])) as Vec3;
}
