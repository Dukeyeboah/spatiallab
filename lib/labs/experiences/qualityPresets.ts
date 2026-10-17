/**
 * LAB EXP-02 — rendering quality / performance presets for LCC2 tours.
 * Budgets are starting benchmarks; tune per device in Dev if needed.
 */

export type QualityPresetId = "performance" | "balanced" | "quality";

export type QualityPreset = {
  id: QualityPresetId;
  label: string;
  /** Cap for lcc.setMaxSplats (LCC2). */
  maxSplats: number;
  /** Cap for lcc.setMaxDistance (metres). */
  maxDistance: number;
  /** Renderer setPixelRatio upper bound. */
  pixelRatioCap: number;
  note: string;
};

export const QUALITY_PRESETS: Record<QualityPresetId, QualityPreset> = {
  performance: {
    id: "performance",
    label: "Performance",
    maxSplats: 750_000,
    maxDistance: 35,
    pixelRatioCap: 1,
    note: "Lower splat budget + 1× pixel ratio — prefer on M-series when choppy",
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    maxSplats: 1_500_000,
    maxDistance: 55,
    pixelRatioCap: 1.5,
    note: "Default — clarity vs smooth walk",
  },
  quality: {
    id: "quality",
    label: "Quality",
    maxSplats: 2_500_000,
    maxDistance: 80,
    pixelRatioCap: 2,
    note: "Higher detail when the GPU keeps up",
  },
};

export const DEFAULT_QUALITY_PRESET: QualityPresetId = "balanced";
