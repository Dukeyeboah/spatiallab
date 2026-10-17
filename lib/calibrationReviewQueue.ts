import type { Correspondence } from "@/lib/correspondences";
import { BASELINE_STAGE_B, type RecordReview, type Region } from "@/lib/correspondenceReview";
import type { FisheyeModel } from "@/lib/fisheyeProjection";

/**
 * Lab 14E.4 — Calibration Review Queue (local, no fitting).
 *
 * Flagged ids and guidance come from Lab 14E.3
 * (`docs/xgrids/lab14e3-calibration-validation.md`). Original pixel / LiDAR
 * values are never rewritten by queue actions — only optional reviewStatus
 * (and Reject → excludedFromFit).
 */

export const LAB14E3_BASELINE_ID = "x_c69aede71834";
export const LAB14E3_BASELINE_LABEL = BASELINE_STAGE_B.reference.label;

/** Lab 13V / glass / may-move — inspect first. */
export const QUESTIONABLE_IDS = [
  "c_74df63628df5", // 1633 ch14 shelf
  "c_c61d3721d061", // 3187 ch14 white board
  "c_b50667f52448", // 3037 ch18 window pane
  "c_1e7ff984220a", // 2317 ch14 Lab 13V vehicle id (feature now says roof apex)
] as const;

/**
 * Stage B cannot project the LiDAR hit into the usable fisheye circle
 * (observation may still sit in the outer third). Re-pick slightly inward or Reject.
 */
export const OUTSIDE_USABLE_IDS = [
  "c_52e5d51a7442", // 2661 ch18
  "c_5566b397d0fe", // 2959 ch14
  "c_933babbf4afa", // 2959 ch18
] as const;

/** Lab 14E.3 heuristic "verified" — leave alone unless you disagree. */
export const LEAVE_ALONE_RELIABLE_IDS = [
  "c_18cf4e2b5ef1",
  "c_2bf7e51e4362",
  "c_43c5885b79e8",
  "c_449cbe1a9b70",
  "c_45481e8dd5fb",
  "c_5b623a5c9dac",
  "c_6988c7fd1e5d",
  "c_992c09ac7241",
  "c_9b5b8d3b0c90",
  "c_a8f90b5a7202",
  "c_bfbbda003715",
  "c_d5ef4497003e",
] as const;

/**
 * Best approximate courtyard architectural corners to check *after* the flagged
 * seven — outer / middle usable, both cameras, rigid-looking features.
 */
export const NEXT_APPROXIMATE_CHECK_IDS = [
  "c_2f81f00db5ab", // 2827 ch18 wood roof corner · outer · ~16 px
  "c_4d8aff9646ac", // 2608 ch14 red arch / cream · outer · ~39 px
  "c_72dbd9060beb", // 2872 ch14 red window · outer · ~49 px
  "c_63ec7452ce58", // 2903 ch14 pipe–roof · outer · ~40 px
  "c_6caa6c78259f", // 2903 ch18 patio / wall · outer · ~45 px
  "c_150a0f88a66f", // 2647 ch14 roof edge · outer · ~37 px
  "c_779aa950bf0e", // 2768 ch18 pipe–roof · outer · ~76 px (large residual — check pick)
] as const;

/** Indoor / close sequences: do not hunt for new matches here during this review. */
export const INDOOR_LEAVE_SEQUENCES = [1633, 1663, 3187] as const;

export type QueueCategory = "questionable" | "outside-usable" | "next-check" | "leave-alone" | "other";

export type QueueConcern = {
  id: string;
  categories: QueueCategory[];
  reason: string;
  priority: number;
};

const CONCERNS: Record<string, { categories: QueueCategory[]; reason: string; priority: number }> = {
  c_74df63628df5: {
    categories: ["questionable"],
    reason: "Lab 13V #1 (shelf, ~1 m): historically huge residual / ambiguous shelf pick — verify or Reject",
    priority: 1,
  },
  c_c61d3721d061: {
    categories: ["questionable"],
    reason: "Lab 13V #5 (white board, ~1.2 m): very close + edge/plane may slide on LiDAR — verify or Reject",
    priority: 2,
  },
  c_b50667f52448: {
    categories: ["questionable"],
    reason: "Glass / window pane — depth ambiguity between glass and far structure",
    priority: 3,
  },
  c_1e7ff984220a: {
    categories: ["questionable"],
    reason: "Lab 13V #16 id (was vehicle); feature text now says roof apex — confirm it is architecture, not a movable object",
    priority: 4,
  },
  c_52e5d51a7442: {
    categories: ["outside-usable", "next-check"],
    reason: "Stage B cannot project this LiDAR hit into the usable fisheye circle — re-pick slightly inward or Reject",
    priority: 5,
  },
  c_5566b397d0fe: {
    categories: ["outside-usable"],
    reason: "Stage B cannot project this LiDAR hit into the usable fisheye circle — re-pick slightly inward or Reject",
    priority: 6,
  },
  c_933babbf4afa: {
    categories: ["outside-usable"],
    reason: "Stage B cannot project this LiDAR hit into the usable fisheye circle — re-pick slightly inward or Reject",
    priority: 7,
  },
  c_2f81f00db5ab: {
    categories: ["next-check"],
    reason: "Strong courtyard architecture in outer usable ch18 — confirm corner vs edge slide",
    priority: 20,
  },
  c_4d8aff9646ac: {
    categories: ["next-check"],
    reason: "Outer ch14 window/arch corner — good region for f / edge residuals",
    priority: 21,
  },
  c_72dbd9060beb: {
    categories: ["next-check"],
    reason: "Outer ch14 red window corner — large Stage B residual; check LiDAR surface",
    priority: 22,
  },
  c_63ec7452ce58: {
    categories: ["next-check"],
    reason: "Outer ch14 pipe–roof geometric intersection",
    priority: 23,
  },
  c_6caa6c78259f: {
    categories: ["next-check"],
    reason: "Outer ch18 patio / wall meeting — lower-ish courtyard coverage",
    priority: 24,
  },
  c_150a0f88a66f: {
    categories: ["next-check"],
    reason: "Outer ch14 roof-edge corner at medium–far range",
    priority: 25,
  },
  c_779aa950bf0e: {
    categories: ["next-check"],
    reason: "Outer ch18 pipe–roof with ~76 px Stage B error — likely pick or edge ambiguity",
    priority: 26,
  },
};

for (const id of LEAVE_ALONE_RELIABLE_IDS) {
  if (!CONCERNS[id])
    CONCERNS[id] = {
      categories: ["leave-alone"],
      reason: "Lab 14E.3 heuristic verified — leave alone unless you spot a clear mistake",
      priority: 100,
    };
}

export function queueConcern(id: string): QueueConcern | null {
  const c = CONCERNS[id];
  return c ? { id, ...c } : null;
}

export function isFlaggedPriority(id: string): boolean {
  const c = CONCERNS[id];
  return !!c && c.categories.some((x) => x === "questionable" || x === "outside-usable");
}

export function flaggedQueueIds(): string[] {
  return [...QUESTIONABLE_IDS, ...OUTSIDE_USABLE_IDS];
}

export function overlapQuestionableAndOutside(): string[] {
  const q = new Set<string>(QUESTIONABLE_IDS);
  return OUTSIDE_USABLE_IDS.filter((id) => q.has(id));
}

export type ImageHalf = "upper" | "middle" | "lower";
export type ImageSide = "left" | "centre" | "right";
export type DistanceBand = "near (<3 m)" | "medium (3–15 m)" | "far (>15 m)";

export function imageHalf(v: number, model: FisheyeModel): ImageHalf {
  const band = model.validRadiusPx / 3;
  if (v < model.cy - band) return "upper";
  if (v > model.cy + band) return "lower";
  return "middle";
}

export function imageSide(u: number, model: FisheyeModel): ImageSide {
  const band = model.validRadiusPx / 3;
  if (u < model.cx - band) return "left";
  if (u > model.cx + band) return "right";
  return "centre";
}

export function distanceBand(d: number): DistanceBand {
  return d < 3 ? "near (<3 m)" : d <= 15 ? "medium (3–15 m)" : "far (>15 m)";
}

export function radiusPercent(radiusPx: number, model: FisheyeModel): number {
  return model.validRadiusPx > 0 ? (100 * radiusPx) / model.validRadiusPx : 0;
}

export type CoverageCell = {
  channel: string;
  halves: Record<ImageHalf, number>;
  sides: Record<ImageSide, number>;
  distances: Record<DistanceBand, number>;
  regions: Record<Region | string, number>;
  reliable: number;
};

/** Coverage of *reliable* reviews only (same spirit as Lab 13W). */
export function directionalCoverage(reviews: RecordReview[]): CoverageCell[] {
  const halves: ImageHalf[] = ["upper", "middle", "lower"];
  const sides: ImageSide[] = ["left", "centre", "right"];
  const distances: DistanceBand[] = ["near (<3 m)", "medium (3–15 m)", "far (>15 m)"];
  return [...new Set(reviews.map((rv) => rv.record.channel))].sort().map((channel) => {
    const good = reviews.filter((rv) => rv.record.channel === channel && rv.reliable);
    const model = (BASELINE_STAGE_B.reference.cameras as Record<string, { model: FisheyeModel }>)[channel]?.model;
    const count = <K extends string>(keys: readonly K[], key: (rv: RecordReview) => K) =>
      Object.fromEntries(keys.map((k) => [k, good.filter((rv) => key(rv) === k).length])) as Record<K, number>;
    return {
      channel,
      reliable: good.length,
      halves: model
        ? count(halves, (rv) => imageHalf(rv.record.pixel.v, model))
        : { upper: 0, middle: 0, lower: 0 },
      sides: model
        ? count(sides, (rv) => imageSide(rv.record.pixel.u, model))
        : { left: 0, centre: 0, right: 0 },
      distances: count(distances, (rv) => distanceBand(rv.distanceM)),
      regions: {
        centre: good.filter((rv) => rv.region === "centre").length,
        middle: good.filter((rv) => rv.region === "middle").length,
        outer: good.filter((rv) => rv.region === "outer").length,
        outside: good.filter((rv) => rv.region === "outside").length,
      },
    };
  });
}

export type GapSuggestion = { priority: number; channel: string; where: string; why: string };

/**
 * At most 5–8 *new* pick suggestions from real coverage holes among reliable matches.
 * Empty when gaps are not meaningful enough to bother.
 */
export function gapSuggestions(reviews: RecordReview[]): GapSuggestion[] {
  const cells = directionalCoverage(reviews);
  const out: GapSuggestion[] = [];
  let n = 1;
  for (const c of cells) {
    if (c.halves.lower === 0)
      out.push({
        priority: n++,
        channel: c.channel,
        where: "lower image third · courtyard architecture 6–12 m",
        why: "no reliable match in the lower band — one sill / patio / door-foot corner would help pitch",
      });
    if (c.sides.right === 0 && c.channel === "ch18")
      out.push({
        priority: n++,
        channel: "ch18",
        where: "right outer usable · pillar / window corner 8–15 m",
        why: "no reliable match on the right side of ch18",
      });
    if (c.distances["near (<3 m)"] === 0 && c.distances["medium (3–15 m)"] < 4)
      out.push({
        priority: n++,
        channel: c.channel,
        where: "medium distance (4–10 m) · sharp courtyard corner",
        why: "medium-range rigid corners are under-represented vs far roofs",
      });
  }
  // Cap at 8; prefer unique channels/regions.
  const capped = out.slice(0, 8);
  if (capped.length < 2) {
    // Still recommend a complementary pair if both cameras lack lower coverage already listed.
    return capped;
  }
  return capped.slice(0, 8);
}

export function sortQueueReviews(reviews: RecordReview[]): RecordReview[] {
  return [...reviews].sort((a, b) => {
    const ca = queueConcern(a.record.id);
    const cb = queueConcern(b.record.id);
    const pa = ca?.priority ?? 500;
    const pb = cb?.priority ?? 500;
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });
}

export function recordInIndoorLeave(r: Correspondence): boolean {
  return (INDOOR_LEAVE_SEQUENCES as readonly number[]).includes(r.sequence) && !isFlaggedPriority(r.id);
}
