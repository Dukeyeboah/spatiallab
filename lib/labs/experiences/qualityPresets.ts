/**
 * Graphics quality ladder for LCC tours.
 *
 * Spintex floors ship ~13M Gaussians total (5 LOD levels). setMaxSplats caps how
 * many may be drawn at once — it is a GPU budget, not the file size. LOD still
 * streams coarser levels in the distance within that budget.
 *
 * Ladder steps scale all three knobs together. Mix-test presets deliberately
 * uncouple them (e.g. high splats + short distance + 1× DPR) so we can see
 * which tradeoff looks best on a given machine.
 */

export type QualityPresetId =
  | "eco"
  | "performance"
  | "standard"
  | "balanced"
  | "plus"
  | "quality"
  | "high"
  | "ultra"
  | "nearDense"
  | "nearSharp"
  | "budgetDense"
  | "budgetFar"
  | "farLight"
  | "farCrisp"
  | "midMix";

export type QualityPreset = {
  id: QualityPresetId;
  label: string;
  /** Cap for lcc.setMaxSplats. */
  maxSplats: number;
  /** Cap for lcc.setMaxDistance (metres) — how far tiles may load. */
  maxDistance: number;
  /** Renderer setPixelRatio upper bound (screen sharpness vs fill-rate). */
  pixelRatioCap: number;
  note: string;
  /** Ladder = progressive; mix = deliberate tradeoff experiment. */
  group: "ladder" | "mix";
};

export const QUALITY_PRESETS: Record<QualityPresetId, QualityPreset> = {
  eco: {
    id: "eco",
    label: "Eco",
    maxSplats: 500_000,
    maxDistance: 28,
    pixelRatioCap: 1,
    note: "500k · 28 m · 1× — lightest; phones / thermal throttle",
    group: "ladder",
  },
  performance: {
    id: "performance",
    label: "Perf",
    maxSplats: 750_000,
    maxDistance: 35,
    pixelRatioCap: 1,
    note: "750k · 35 m · 1× — smooth on most laptops",
    group: "ladder",
  },
  standard: {
    id: "standard",
    label: "Std",
    maxSplats: 1_000_000,
    maxDistance: 45,
    pixelRatioCap: 1.25,
    note: "1.0M · 45 m · 1.25× — step up from Performance",
    group: "ladder",
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    maxSplats: 1_500_000,
    maxDistance: 55,
    pixelRatioCap: 1.5,
    note: "1.5M · 55 m · 1.5× — default clarity vs frame rate",
    group: "ladder",
  },
  plus: {
    id: "plus",
    label: "Plus",
    maxSplats: 2_000_000,
    maxDistance: 65,
    pixelRatioCap: 1.75,
    note: "2.0M · 65 m · 1.75× — richer mid-range",
    group: "ladder",
  },
  quality: {
    id: "quality",
    label: "Quality",
    maxSplats: 2_500_000,
    maxDistance: 80,
    pixelRatioCap: 2,
    note: "2.5M · 80 m · 2× — sharp when the GPU keeps up",
    group: "ladder",
  },
  high: {
    id: "high",
    label: "High",
    maxSplats: 4_000_000,
    maxDistance: 100,
    pixelRatioCap: 2,
    note: "4.0M · 100 m · 2× — heavy; desktop GPUs",
    group: "ladder",
  },
  ultra: {
    id: "ultra",
    label: "Ultra",
    maxSplats: 6_000_000,
    maxDistance: 120,
    pixelRatioCap: 2,
    note: "6.0M · 120 m · 2× — max practical browser budget (~half of Spintex)",
    group: "ladder",
  },

  // --- Mix tests: uncouple the three knobs ---
  nearDense: {
    id: "nearDense",
    label: "Near dense",
    maxSplats: 4_000_000,
    maxDistance: 30,
    pixelRatioCap: 1,
    note: "4.0M · 30 m · 1× — many Gaussians nearby; short reach; soft pixels",
    group: "mix",
  },
  nearSharp: {
    id: "nearSharp",
    label: "Near sharp",
    maxSplats: 3_000_000,
    maxDistance: 40,
    pixelRatioCap: 1.25,
    note: "3.0M · 40 m · 1.25× — dense mid-near with a little sharpness",
    group: "mix",
  },
  budgetDense: {
    id: "budgetDense",
    label: "Dense 1×",
    maxSplats: 2_500_000,
    maxDistance: 45,
    pixelRatioCap: 1,
    note: "2.5M · 45 m · 1× — Quality’s splat count without retina cost",
    group: "mix",
  },
  budgetFar: {
    id: "budgetFar",
    label: "Far 1×",
    maxSplats: 2_000_000,
    maxDistance: 90,
    pixelRatioCap: 1,
    note: "2.0M · 90 m · 1× — long reach, cheap pixels",
    group: "mix",
  },
  farLight: {
    id: "farLight",
    label: "Far light",
    maxSplats: 1_000_000,
    maxDistance: 100,
    pixelRatioCap: 1,
    note: "1.0M · 100 m · 1× — far tiles, light draw budget",
    group: "mix",
  },
  farCrisp: {
    id: "farCrisp",
    label: "Far crisp",
    maxSplats: 1_500_000,
    maxDistance: 110,
    pixelRatioCap: 2,
    note: "1.5M · 110 m · 2× — far + sharp (stresses fill-rate)",
    group: "mix",
  },
  midMix: {
    id: "midMix",
    label: "Mid mix",
    maxSplats: 3_500_000,
    maxDistance: 55,
    pixelRatioCap: 1.5,
    note: "3.5M · 55 m · 1.5× — denser than Balanced at the same reach",
    group: "mix",
  },
};

export const DEFAULT_QUALITY_PRESET: QualityPresetId = "balanced";

const QUALITY_STORE_KEY = "spatial-lab.experiences.quality.v3";
const LEGACY_STORE_KEYS = [
  "spatial-lab.experiences.quality.v2",
  "spatial-lab.experiences.quality.v1",
];

const LADDER_ORDER: QualityPresetId[] = [
  "eco",
  "performance",
  "standard",
  "balanced",
  "plus",
  "quality",
  "high",
  "ultra",
];

const MIX_ORDER: QualityPresetId[] = [
  "nearDense",
  "nearSharp",
  "budgetDense",
  "budgetFar",
  "farLight",
  "farCrisp",
  "midMix",
];

/** Full order for the range slider (ladder first, then mix tests). */
const PRESET_ORDER: QualityPresetId[] = [...LADDER_ORDER, ...MIX_ORDER];

export function isQualityPresetId(v: string): v is QualityPresetId {
  return v in QUALITY_PRESETS;
}

/** Ordered list for lever UI. */
export function qualityPresetOrder(): QualityPresetId[] {
  return PRESET_ORDER;
}

export function qualityLadderOrder(): QualityPresetId[] {
  return LADDER_ORDER;
}

export function qualityMixOrder(): QualityPresetId[] {
  return MIX_ORDER;
}

export function loadQualityPresetId(): QualityPresetId {
  if (typeof window === "undefined") return DEFAULT_QUALITY_PRESET;
  try {
    for (const key of [QUALITY_STORE_KEY, ...LEGACY_STORE_KEYS]) {
      const raw = window.localStorage.getItem(key);
      if (raw && isQualityPresetId(raw)) return raw;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_QUALITY_PRESET;
}

export function saveQualityPresetId(id: QualityPresetId) {
  try {
    window.localStorage.setItem(QUALITY_STORE_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Optional CDN / blob base for LCC sample packages (no trailing slash).
 */
export function resolveExperienceDataPath(dataPath: string): string {
  if (dataPath.startsWith("http://") || dataPath.startsWith("https://")) return dataPath;
  const base = (process.env.NEXT_PUBLIC_LCC_ASSET_BASE ?? "").replace(/\/$/, "");
  if (!base) return dataPath;
  return `${base}${dataPath.startsWith("/") ? dataPath : `/${dataPath}`}`;
}

export const QUALITY_LEVER_HELP =
  "Ladder steps scale splats, distance and pixel ratio together. Mix tests uncouple them (e.g. high Gaussians + short distance + 1×) so you can compare tradeoffs. Spintex floors hold ~13M Gaussians in the file; these caps never draw all of them at once.";
