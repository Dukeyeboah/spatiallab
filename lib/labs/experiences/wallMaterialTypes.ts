/**
 * LAB EXP-05E — versioned wall-finish settings for layered overlay materials.
 * Designed so a future AI pass can suggest HEX / preset / strengths without
 * depending on temporary blob URLs (textures stay assetId-based).
 */

export type WallBlendMode = "normal" | "multiply" | "overlay" | "softLight";

export type WallFinishPresetId = "mattePaint" | "limewash" | "finePlaster" | "wallpaper";

/** Optional AI recommendation payload (not generated in EXP-05E). */
export type WallFinishAiSuggestion = {
  suggestedHex?: string;
  presetId?: WallFinishPresetId;
  textureStrength?: number;
  brightness?: number;
  contrast?: number;
  tint?: number;
  gradientIntensity?: number;
  blendMode?: WallBlendMode;
  note?: string;
};

/**
 * Version 1 finish schema — persisted on `SurfaceOverlay.finish`.
 * Procedural fields are seeded so reloads look identical.
 */
export type WallFinishSettingsV1 = {
  version: 1;
  presetId: WallFinishPresetId;
  /** User-chosen base colour (independent of preset). */
  baseColor: string;
  opacity: number;
  /** Deterministic procedural seed (integer). */
  seed: number;
  /** Fine high-frequency grain 0..1 */
  grainStrength: number;
  /** Low-frequency blotch / wash variation 0..1 */
  colorVariation: number;
  /** Strength of plaster/wallpaper layer 0..1 */
  textureStrength: number;
  /** Overall luminance multiplier (~0.55–1.45) */
  brightness: number;
  /** Contrast around mid-grey (~0.7–1.4) */
  contrast: number;
  /** Warm (+) / cool (−) balance −1..1 */
  warmCool: number;
  /** Top↔bottom brightness gradient amount 0..1 */
  verticalGradient: number;
  /** Soft “matte vs chalky” cue 0..1 (unlit approximation) */
  roughness: number;
  /**
   * How procedural / map layers composite onto the base colour.
   * These blend **material layers with each other**, not with LCC Gaussians.
   */
  blendMode: WallBlendMode;
  aiSuggestion?: WallFinishAiSuggestion;
};

export type WallFinishSettings = WallFinishSettingsV1;

export const WALL_FINISH_PRESET_META: {
  id: WallFinishPresetId;
  label: string;
  blurb: string;
}[] = [
  { id: "mattePaint", label: "Smooth Matte Paint", blurb: "Quiet flat finish, minimal grain" },
  { id: "limewash", label: "Limewash", blurb: "Soft blotchy wash, low-frequency variation" },
  { id: "finePlaster", label: "Fine Plaster", blurb: "Fine mineral texture, restrained" },
  { id: "wallpaper", label: "Wallpaper", blurb: "Upload map + soft pattern strength" },
];

/** Restrained defaults per preset (baseColor left to caller). */
export function presetFinishDefaults(
  presetId: WallFinishPresetId,
  baseColor = "#d8d2c8",
  seed = 42,
): WallFinishSettingsV1 {
  const base: WallFinishSettingsV1 = {
    version: 1,
    presetId,
    baseColor,
    opacity: 1,
    seed,
    grainStrength: 0.08,
    colorVariation: 0.06,
    textureStrength: 0.2,
    brightness: 1,
    contrast: 1,
    warmCool: 0.05,
    verticalGradient: 0.08,
    roughness: 0.75,
    blendMode: "multiply",
  };
  switch (presetId) {
    case "mattePaint":
      return {
        ...base,
        grainStrength: 0.05,
        colorVariation: 0.03,
        textureStrength: 0.08,
        verticalGradient: 0.06,
        roughness: 0.85,
        blendMode: "softLight",
        warmCool: 0.02,
      };
    case "limewash":
      return {
        ...base,
        grainStrength: 0.1,
        colorVariation: 0.22,
        textureStrength: 0.18,
        verticalGradient: 0.12,
        roughness: 0.9,
        blendMode: "overlay",
        warmCool: 0.08,
        brightness: 1.02,
      };
    case "finePlaster":
      return {
        ...base,
        grainStrength: 0.18,
        colorVariation: 0.1,
        textureStrength: 0.35,
        verticalGradient: 0.1,
        roughness: 0.7,
        blendMode: "multiply",
        warmCool: 0.04,
        contrast: 1.05,
      };
    case "wallpaper":
      return {
        ...base,
        grainStrength: 0.04,
        colorVariation: 0.05,
        textureStrength: 0.55,
        verticalGradient: 0.05,
        roughness: 0.65,
        blendMode: "normal",
        warmCool: 0,
        brightness: 1,
      };
    default:
      return base;
  }
}

export function normalizeWallFinish(
  raw: Partial<WallFinishSettingsV1> | null | undefined,
  fallbackColor = "#d8d2c8",
): WallFinishSettingsV1 {
  const presetId = (raw?.presetId ?? "mattePaint") as WallFinishPresetId;
  const defaults = presetFinishDefaults(presetId, raw?.baseColor ?? fallbackColor, raw?.seed ?? 42);
  if (!raw || raw.version !== 1) return defaults;
  return {
    ...defaults,
    ...raw,
    version: 1,
    presetId,
    baseColor: raw.baseColor ?? defaults.baseColor,
    opacity: clamp01(raw.opacity ?? defaults.opacity, 0.1, 1),
    seed: Number.isFinite(raw.seed) ? Math.floor(raw.seed as number) : defaults.seed,
    grainStrength: clamp01(raw.grainStrength ?? defaults.grainStrength),
    colorVariation: clamp01(raw.colorVariation ?? defaults.colorVariation),
    textureStrength: clamp01(raw.textureStrength ?? defaults.textureStrength),
    brightness: clamp01(raw.brightness ?? defaults.brightness, 0.55, 1.45),
    contrast: clamp01(raw.contrast ?? defaults.contrast, 0.7, 1.4),
    warmCool: clamp01(raw.warmCool ?? defaults.warmCool, -1, 1),
    verticalGradient: clamp01(raw.verticalGradient ?? defaults.verticalGradient),
    roughness: clamp01(raw.roughness ?? defaults.roughness),
    blendMode: raw.blendMode ?? defaults.blendMode,
    aiSuggestion: raw.aiSuggestion,
  };
}

function clamp01(n: number, lo = 0, hi = 1): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
