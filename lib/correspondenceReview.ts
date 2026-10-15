import * as THREE from "three";
import { provisionalRotation, type ProvisionalOrientation } from "@/lib/calibration";
import { predict, type Correspondence, type Prediction } from "@/lib/correspondences";
import type { FisheyeModel } from "@/lib/fisheyeProjection";

/**
 * Lab 13W: review and coverage of saved correspondences.
 *
 * Every number here is a diagnostic under a *reference* parameter set: the
 * Stage B set of a loaded experiment, or the latest baseline Stage B result for
 * the built-in Basel House export. Both are experimental estimates, not a verified
 * calibration. Flags never delete or change a record; only the user's own
 * "exclude" (and the geometric "wrong-side" / "too-close") leave a record out
 * of fits, exactly as in backend/camera_calibration.py `audit`.
 */

export type ReferenceCamera = { orientation: ProvisionalOrientation; model: FisheyeModel };
export type ReviewReference = { label: string; cameras: Record<string, ReferenceCamera> };

const STAGE_B_MODEL = (focalPx: number): FisheyeModel => ({ model: "equidistant", focalPx, cx: 1999.5, cy: 1449.5, validRadiusPx: 1400, status: "experimental-estimate" });

/**
 * Latest experimental baseline: Stage B of experiment x_c69aede71834 (reviewed export of
 * 2026-10-15, docs/xgrids/calibration-experiments.md). Lab 13V's x_652068cf70da is kept for comparison.
 */
export const BASELINE_STAGE_B = {
  datasetId: "builtin-basel-house",
  posesSha256: "ba621b73eab425e7b4ad641f9847b51a6b7488189290675bfd3dd3be23e7680d",
  reference: {
    label: "latest baseline, Stage B of x_c69aede71834 (reviewed 2026-10-15 export), experimental estimate",
    cameras: {
      ch14: { orientation: { yawDeg: -88.953323, pitchDeg: 2.885573, rollDeg: 0.368913 }, model: STAGE_B_MODEL(961.439824) },
      ch18: { orientation: { yawDeg: 89.4391, pitchDeg: 4.334841, rollDeg: 0.77412 }, model: STAGE_B_MODEL(961.532298) },
    },
  } satisfies ReviewReference,
};

/** Matches Lab 13V found unreliable (numbers = position in the 2026-10-15 export). */
export const LAB_13V_REVIEW: Record<string, string> = {
  c_74df63628df5: "#1 in Lab 13V (shelf, 1.0 m): ~245 px from every fitted model; the 3D pick is probably on a different part of the shelf",
  c_c61d3721d061: "#5 in Lab 13V (white board, 0.7 m): very close to the scanner and an outlier under Stage B",
  c_249d61c76f93: "#11 in Lab 13V (window pane): the LiDAR point is behind ch18 (~170° off-axis); probably picked across the courtyard, re-pick it",
  c_1e7ff984220a: "#16 in Lab 13V (vehicle rear lights, 1.2 m): close, and the vehicle may have moved",
};

export const COVERAGE_TARGET = { min: 15, max: 25, events: 5 };
export const SECTORS = ["right", "upper right", "top", "upper left", "left", "lower left", "bottom", "lower right"] as const;
export const REGIONS = ["centre", "middle", "outer"] as const;
export const DISTANCE_BINS = ["< 3 m", "3–4 m", "4–15 m", "> 15 m"] as const;
export type Region = (typeof REGIONS)[number] | "outside";

const CLOSE_RANGE_M = 3;
const FIELD_OF_VIEW_LIMIT_DEG = 110;
const LEVER_ARM_PROBE_M = 0.05;
const MOVABLE = /\b(vehicle|car|truck|van|bus|bike|person|people|man|woman|curtain|cloth|flag|leaf|leaves|palm|plant|tree|branch|brank|stem|bush)\b/i;

export type ReviewFlag = { code: string; severity: "exclude" | "warn" | "info"; reason: string };
export type RecordReview = {
  record: Correspondence;
  index: number;
  distanceM: number;
  heightM: number;
  offAxisDeg: number | null;
  radiusPx: number;
  region: Region;
  sector: number;
  prediction: Prediction;
  flags: ReviewFlag[];
  included: boolean;
  reliable: boolean;
};

/** Thirds of the usable radius (same as backend image_region). */
export function imageRegion(radiusPx: number, model: FisheyeModel): Region {
  const limit = model.validRadiusPx;
  return radiusPx < limit / 3 ? "centre" : radiusPx < (2 * limit) / 3 ? "middle" : radiusPx <= limit ? "outer" : "outside";
}

/** One of 8 directions around the image centre, 0 = right, counter-clockwise as seen on screen. */
export function imageSector(u: number, v: number, model: FisheyeModel): number {
  const angle = (THREE.MathUtils.radToDeg(Math.atan2(-(v - model.cy), u - model.cx)) + 360) % 360;
  return Math.floor(((angle + 22.5) % 360) / 45);
}

export function distanceBin(d: number): (typeof DISTANCE_BINS)[number] {
  return d < 3 ? "< 3 m" : d < 4 ? "3–4 m" : d <= 15 ? "4–15 m" : "> 15 m";
}

function offAxis(r: Correspondence, orientation: ProvisionalOrientation) {
  const cameraToLas = new THREE.Quaternion(...r.scannerPose.quaternion).normalize().multiply(provisionalRotation(orientation));
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraToLas);
  const d = new THREE.Vector3(...r.lidar.las).sub(new THREE.Vector3(...r.scannerPose.position));
  const length = d.length();
  return length > 0 ? THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, d.dot(axis) / length)))) : null;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function reviewRecords(records: Correspondence[], reference: ReviewReference): RecordReview[] {
  const reviews = records.map((r, i): RecordReview => {
    const camera = reference.cameras[r.channel];
    const model = camera?.model;
    const [px, py, pz] = r.scannerPose.position;
    const distanceM = Math.hypot(r.lidar.las[0] - px, r.lidar.las[1] - py, r.lidar.las[2] - pz);
    const radiusPx = model ? Math.hypot(r.pixel.u - model.cx, r.pixel.v - model.cy) : 0;
    const prediction: Prediction = camera ? predict(r, { [r.channel]: camera.orientation }, camera.model) : { valid: false, reason: `no reference for ${r.channel}` };
    const off = camera ? offAxis(r, camera.orientation) : null;
    const flags: ReviewFlag[] = [];
    if (r.excludedFromFit) flags.push({ code: "user-excluded", severity: "exclude", reason: `excluded during review: ${r.excludedFromFit.reason || "no reason given"}` });
    if (!camera) flags.push({ code: "unknown-channel", severity: "exclude", reason: `no reference camera for ${r.channel}` });
    if (distanceM < 0.2) flags.push({ code: "too-close", severity: "exclude", reason: `LiDAR point ${distanceM.toFixed(2)} m from the scanner` });
    if (off !== null && off > FIELD_OF_VIEW_LIMIT_DEG)
      flags.push({ code: "wrong-side", severity: "exclude", reason: `the LiDAR point is ${off.toFixed(0)}° from the camera axis (behind the lens): probably picked on the wrong side` });
    const corrected = r.history?.some((h) => h.action === "pixel" || h.action === "lidar");
    if (LAB_13V_REVIEW[r.id] && r.reviewStatus !== "verified" && !r.excludedFromFit && !corrected)
      flags.push({ code: "lab13v", severity: "warn", reason: LAB_13V_REVIEW[r.id] });
    if (r.reviewStatus === "needs-fix") flags.push({ code: "needs-fix", severity: "warn", reason: "you marked it 'needs fix'" });
    if (distanceM < CLOSE_RANGE_M && model)
      flags.push({ code: "close-range", severity: "warn", reason: `${distanceM.toFixed(2)} m away: an unknown 5 cm lever arm moves it by up to ~${((model.focalPx * LEVER_ARM_PROBE_M) / distanceM).toFixed(0)} px` });
    const movable = MOVABLE.exec(`${r.feature} ${r.notes}`);
    if (movable) flags.push({ code: "may-move", severity: "warn", reason: `'${movable[0]}' may have moved between the LiDAR pass and the image` });
    if (r.quality !== "good") flags.push({ code: "quality", severity: "warn", reason: `marked ${r.quality} when picked` });
    if (!prediction.valid && !flags.some((f) => f.code === "wrong-side")) flags.push({ code: "no-projection", severity: "warn", reason: `no prediction: ${prediction.reason}` });
    if (model && radiusPx > 0.9 * model.validRadiusPx) flags.push({ code: "image-edge", severity: "info", reason: `${radiusPx.toFixed(0)} px from the centre, near the fisheye edge` });
    return {
      record: r,
      index: i + 1,
      distanceM,
      heightM: r.lidar.las[2] - pz,
      offAxisDeg: off,
      radiusPx,
      region: model ? imageRegion(radiusPx, model) : "outside",
      sector: model ? imageSector(r.pixel.u, r.pixel.v, model) : 0,
      prediction,
      flags,
      included: true,
      reliable: false,
    };
  });

  for (let i = 0; i < records.length; i++)
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      const lasGap = Math.hypot(a.lidar.las[0] - b.lidar.las[0], a.lidar.las[1] - b.lidar.las[1], a.lidar.las[2] - b.lidar.las[2]);
      const pixelGap = a.imageFile === b.imageFile ? Math.hypot(a.pixel.u - b.pixel.u, a.pixel.v - b.pixel.v) : Infinity;
      if (lasGap < 0.02 || pixelGap < 5) {
        reviews[i].flags.push({ code: "duplicate", severity: "warn", reason: `near-duplicate of #${j + 1}` });
        reviews[j].flags.push({ code: "duplicate", severity: "warn", reason: `near-duplicate of #${i + 1}` });
      }
    }

  for (const rv of reviews) rv.included = !rv.flags.some((f) => f.severity === "exclude");
  // Large error: relative to the channel's included matches, like the backend outlier rule.
  for (const channel of new Set(records.map((r) => r.channel))) {
    const mine = reviews.filter((rv) => rv.record.channel === channel && rv.included && rv.prediction.valid);
    const m = median(mine.map((rv) => (rv.prediction.valid ? rv.prediction.errorPx : 0)));
    if (m === null) continue;
    const threshold = Math.max(3 * m, 40);
    for (const rv of mine)
      if (rv.prediction.valid && rv.prediction.errorPx > threshold)
        rv.flags.push({ code: "large-error", severity: "warn", reason: `${rv.prediction.errorPx.toFixed(0)} px from the reference prediction (threshold ${threshold.toFixed(0)} px = max(3 × median, 40))` });
  }
  for (const rv of reviews) rv.reliable = rv.included && !rv.flags.some((f) => f.severity === "warn");
  return reviews;
}

export type ChannelCoverage = {
  channel: string;
  total: number;
  included: number;
  reliable: number;
  verified: number;
  events: number;
  regions: Record<string, number>;
  sectors: number[];
  distances: Record<string, number>;
  heights: { above: number; level: number; below: number };
  scenes: Record<string, number>;
  guidance: string[];
};

/** Coverage counts only reliable matches: flagged ones are listed for review, never counted towards the target. */
export function coverage(reviews: RecordReview[]): ChannelCoverage[] {
  return [...new Set(reviews.map((rv) => rv.record.channel))].sort().map((channel) => {
    const mine = reviews.filter((rv) => rv.record.channel === channel);
    const good = mine.filter((rv) => rv.reliable);
    const count = <K extends string>(keys: readonly K[], key: (rv: RecordReview) => K) =>
      Object.fromEntries(keys.map((k) => [k, good.filter((rv) => key(rv) === k).length])) as Record<K, number>;
    const regions = count(REGIONS, (rv) => rv.region as (typeof REGIONS)[number]);
    const sectors = SECTORS.map((_, s) => good.filter((rv) => rv.sector === s && rv.region !== "centre").length);
    const distances = count(DISTANCE_BINS, (rv) => distanceBin(rv.distanceM));
    const heights = { above: good.filter((rv) => rv.heightM > 0.3).length, level: good.filter((rv) => Math.abs(rv.heightM) <= 0.3).length, below: good.filter((rv) => rv.heightM < -0.3).length };
    const scenes: Record<string, number> = {};
    for (const rv of good) scenes[rv.record.scene ?? "untagged"] = (scenes[rv.record.scene ?? "untagged"] ?? 0) + 1;
    const events = new Set(good.map((rv) => rv.record.sequence)).size;

    const guidance: string[] = [];
    if (good.length < COVERAGE_TARGET.min)
      guidance.push(`${good.length} reliable of the ${COVERAGE_TARGET.min}–${COVERAGE_TARGET.max} target: add only features you can place with confidence in both the image and the LiDAR.`);
    if (events < COVERAGE_TARGET.events) guidance.push(`Reliable matches come from ${events} event(s); spread them over at least ${COVERAGE_TARGET.events} scanner positions.`);
    const emptySectors = SECTORS.filter((_, s) => sectors[s] === 0);
    if (emptySectors.length) guidance.push(`No reliable match in the middle/outer image towards: ${emptySectors.join(", ")}.`);
    if (regions.outer === 0) guidance.push("Nothing reliable in the outer third of the fisheye circle; that is where f and the distortion show most.");
    if (distances["4–15 m"] < Math.ceil(good.length / 2) || good.length === 0) guidance.push("Prefer fixed features 4–15 m away: close points are sensitive to the unknown lever arm.");
    if (heights.above === 0 || heights.below === 0) guidance.push(`Vary height: ${heights.above} above and ${heights.below} below the scanner (e.g. eaves, sills, floor or ground corners).`);
    const tagged = Object.keys(scenes).filter((k) => k !== "untagged");
    if (tagged.length < 2) guidance.push("Mix courtyard, corridor and indoor scenes (tag the scene when you save or edit a match).");
    return { channel, total: mine.length, included: mine.filter((rv) => rv.included).length, reliable: good.length, verified: good.filter((rv) => rv.record.reviewStatus === "verified").length, events, regions, sectors, distances, heights, scenes, guidance };
  });
}

/** The reference used in the workspace: a loaded experiment's Stage B, else the latest baseline for the built-in export, else none. */
export function chooseReference(
  datasetId: string,
  posesSha256: string | null,
  experimentStageB: { label: string; cameras: Record<string, ReferenceCamera> } | null,
): ReviewReference | null {
  if (experimentStageB) return experimentStageB;
  if (datasetId === BASELINE_STAGE_B.datasetId && posesSha256 === BASELINE_STAGE_B.posesSha256) return BASELINE_STAGE_B.reference;
  return null;
}
