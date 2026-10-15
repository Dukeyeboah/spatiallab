import type { ProvisionalOrientation } from "@/lib/calibration";
import { predict, type Correspondence, type Prediction } from "@/lib/correspondences";
import { API_URL, errorMessage } from "@/lib/datasets";
import type { FisheyeModel } from "@/lib/fisheyeProjection";

/**
 * Lab 13V: calibration experiments. The maths runs in the local backend
 * (backend/camera_calibration.py, SciPy); this module only sends a Lab 13U
 * correspondence export's text, and reads, validates and displays the result.
 *
 * Nothing here changes the provisional presets or the main viewer: a parameter
 * set from an experiment is only used to draw predictions in this workspace.
 */

export const EXPERIMENT_SCHEMA = "spatial-lab/xgrids-calibration-experiment";
export const EXPERIMENT_VERSION = 1;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type AuditFlag = { code: string; severity: "exclude" | "review"; reason: string };
export type AuditRow = {
  index: number;
  id: string;
  sequence: number;
  channel: string;
  feature: string;
  quality: string;
  method: string;
  distanceM: number;
  offAxisDeg: number | null;
  pixelRadiusPx: number;
  leverArm5cmPx: number | null;
  provisional: { valid: boolean; errorPx: number | null } | null;
  lidarSupport5cm: number | null;
  lineOfSightPoints: number | null;
  flags: AuditFlag[];
};
export type ChannelAudit = {
  records: number;
  usable: number;
  events: number;
  distanceM: { min: number; median: number; max: number } | null;
  closeRange: number;
  quadrants: Record<string, number>;
  radialRings: Record<string, number>;
};
export type Audit = {
  records: AuditRow[];
  channels: Record<string, ChannelAudit>;
  events: number[];
  scannerPositionsSpreadM: number;
  methods: Record<string, number>;
  duplicates: { ids: string[] }[];
  excludedByDefault: string[];
  reviewFlagged: string[];
  lidarChecks: string;
  notes: string[];
};
export type AuditResponse = {
  source: { sha256: string; dataset: { id: string; name: string | null; posesSha256: string }; exported: string | null };
  rejected: { index: number; id: string | null; reason: string }[];
  runProblems: { id: string; reason: string }[];
  audit: Audit;
};

export type Stats = { count: number; mean: number | null; median: number | null; rms: number | null };
export type RecordPrediction = { valid: boolean; u?: number; v?: number; errorPx: number | null; outlier?: boolean; reason?: string };
export type Evaluation = { perRecord: Record<string, RecordPrediction>; stats: Stats; invalid: number; outlierThresholdPx: number | null; outliers: string[] };
export type ParameterStatus = { status: string; reasons: string[] };
export type StageResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      orientation: ProvisionalOrientation;
      model: FisheyeModel;
      free: string[];
      std: Record<string, number>;
      correlation: number[][];
      conditionNumber: number;
      atBound: string[];
      training: Evaluation;
      validation: {
        folds: { heldOutEvent: number; ok: boolean; reason?: string; parameters?: Record<string, number> }[];
        foldsOk: number;
        foldsSkipped: number;
        heldOut: Record<string, RecordPrediction>;
        heldOutStats: Stats;
        heldOutInvalid: number;
        heldOutOutliers?: string[];
        parameterSpread: Record<string, { min: number; max: number; range: number }>;
      };
      sensitivity: {
        maxAbsDelta: Record<string, Record<string, number>>;
        strictSubset: unknown;
        withoutOutliers: { removed: string[]; ok?: boolean; parameters?: Record<string, number>; delta?: Record<string, number> } | null;
      };
      identifiability: Record<string, ParameterStatus>;
    };
export type CameraResult = {
  records: string[];
  events: number[];
  initial: { orientation: ProvisionalOrientation; model: FisheyeModel };
  provisional: Evaluation;
  stages: Record<string, StageResult>;
  comparison: { heldOut: Record<string, Stats>; recommended: string; rule: string };
};
export type SetCamera = { orientation: ProvisionalOrientation; model: FisheyeModel; parameterStatus: Record<string, string> };
export type ParameterSet = { label: string; cameras: Record<string, SetCamera> };
export type ImageAgreement = {
  method: string;
  runId: string;
  summary: Record<string, { images: number; meanNcc: Record<string, number | null>; bestCount: Record<string, number> }>;
};
export type Experiment = {
  schema: string;
  version: number;
  experimentId: string;
  created: string;
  status: string;
  source: {
    file: string | null;
    sha256: string;
    dataset: { id: string; name: string | null; posesSha256: string };
    correspondenceIds: string[];
    excluded: { id: string; reasons: string[] }[];
    events: number[];
  };
  conventions: Record<string, string>;
  solver: { library: string; software: Record<string, string>; fixed: Record<string, unknown>; stages: Record<string, { label: string; free: string[] }> };
  audit: Audit;
  cameras: Record<string, CameraResult>;
  parameterSets: Record<string, ParameterSet>;
  independentChecks?: { imageAgreement?: ImageAgreement };
  warnings: string[];
  limitations: string[];
};

type Identity = { datasetId: string; posesSha256: string };

function query(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return q.toString();
}

/** The export text is sent unchanged, so the backend's SHA-256 is the file's. */
export async function auditCorrespondences(text: string, identity: Identity, signal?: AbortSignal): Promise<AuditResponse> {
  const response = await fetch(`${API_URL}/xgrids/calibration/audit?${query({ ...identity })}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function runExperiment(
  text: string,
  identity: Identity & { exclude: string[]; include: string[]; sourceName: string | null },
  signal?: AbortSignal,
): Promise<Experiment> {
  const params = query({
    datasetId: identity.datasetId,
    posesSha256: identity.posesSha256,
    exclude: identity.exclude.join(","),
    include: identity.include.join(","),
    sourceName: identity.sourceName ?? undefined,
  });
  const response = await fetch(`${API_URL}/xgrids/calibration/experiments?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return parseExperiment(await response.json());
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate an experiment (from the backend or an imported file). Throws with a reason. */
export function parseExperiment(data: unknown): Experiment {
  const x = data as Partial<Experiment> | null;
  if (!x || typeof x !== "object" || x.schema !== EXPERIMENT_SCHEMA) throw new Error(`not a ${EXPERIMENT_SCHEMA} file`);
  if (x.version !== EXPERIMENT_VERSION) throw new Error(`unsupported experiment version ${String(x.version)}`);
  if (typeof x.experimentId !== "string" || !/^x_[0-9a-f]{12}$/.test(x.experimentId)) throw new Error("bad experimentId");
  if (!x.source || typeof x.source.sha256 !== "string" || !x.source.dataset) throw new Error("missing source");
  if (!x.cameras || !x.parameterSets?.provisional) throw new Error("missing cameras or parameter sets");
  for (const [name, set] of Object.entries(x.parameterSets))
    for (const [channel, camera] of Object.entries(set.cameras ?? {})) {
      const o = camera?.orientation;
      const m = camera?.model;
      if (!o || ![o.yawDeg, o.pitchDeg, o.rollDeg].every(finite) || !m || ![m.focalPx, m.cx, m.cy, m.validRadiusPx].every(finite) || m.focalPx <= 0)
        throw new Error(`bad parameters in ${name} ${channel}`);
    }
  return x as Experiment;
}

export function parseExperimentFile(text: string): Experiment {
  return parseExperiment(JSON.parse(text));
}

/** Predict a record with one parameter set's camera (same projection as Lab 13U). */
export function predictWith(record: Correspondence, camera: SetCamera | undefined): Prediction {
  if (!camera) return { valid: false, reason: `no parameters for ${record.channel}` };
  return predict(record, { [record.channel]: camera.orientation }, camera.model);
}

export const SET_ORDER = ["provisional", "stageA", "stageB"];
export const setLabel = (name: string) => (name === "provisional" ? "Provisional" : name === "stageA" ? "Stage A" : name === "stageB" ? "Stage B" : name);
