/**
 * PROD-02A visitor rendering presets (3 choices). Tunable in Dev Mode.
 * LCC2 Spintex packages — budgets measured experimentally; adjust via Dev panel.
 */

export type Prod02aQualityId = "performance" | "balanced" | "high";

export type Prod02aQualityPreset = {
  id: Prod02aQualityId;
  label: string;
  maxSplats: number;
  maxDistance: number;
  pixelRatioCap: number;
  lodSmooth: boolean;
  note: string;
};

export const PROD02A_QUALITY: Record<Prod02aQualityId, Prod02aQualityPreset> = {
  performance: {
    id: "performance",
    label: "Performance",
    maxSplats: 750_000,
    maxDistance: 40,
    pixelRatioCap: 1,
    lodSmooth: true,
    note: "750k · 40 m · 1× — stable FPS on laptops",
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    maxSplats: 1_500_000,
    maxDistance: 55,
    pixelRatioCap: 1.5,
    lodSmooth: true,
    note: "1.5M · 55 m · 1.5× — default clarity vs frame rate",
  },
  high: {
    id: "high",
    label: "High Quality",
    maxSplats: 3_000_000,
    maxDistance: 80,
    pixelRatioCap: 2,
    lodSmooth: true,
    note: "3.0M · 80 m · 2× — richer detail when the GPU keeps up",
  },
};

export const PROD02A_DEFAULT_QUALITY: Prod02aQualityId = "balanced";

export const PROD02A_QUALITY_ORDER: Prod02aQualityId[] = [
  "performance",
  "balanced",
  "high",
];

const STORE_KEY = "spatial-lab.prod02a.quality.v1";

export function loadProd02aQualityId(): Prod02aQualityId {
  if (typeof window === "undefined") return PROD02A_DEFAULT_QUALITY;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw === "performance" || raw === "balanced" || raw === "high") return raw;
  } catch {
    /* ignore */
  }
  return PROD02A_DEFAULT_QUALITY;
}

export function saveProd02aQualityId(id: Prod02aQualityId) {
  try {
    window.localStorage.setItem(STORE_KEY, id);
  } catch {
    /* ignore */
  }
}
