/**
 * Named Spatial House camera presets — real tested PROD-02A values.
 * Do not invent replacements; edit only after another approval pass.
 */
import {
  DEFAULT_SMOOTH_TUNING,
  PRODUCTION_SMOOTH_TUNING,
  type SmoothNavTuning,
} from "@/lib/labs/prod02a/smoothAvatarControls";

export type NamedCameraPreset = {
  id: string;
  label: string;
  tuning: SmoothNavTuning;
};

/** Spatial House — Free Follow v1 (approved PROD-02A Free Follow). */
export const SPATIAL_HOUSE_FREE_FOLLOW_V1: NamedCameraPreset = {
  id: "spatial-house-free-follow-v1",
  label: "Spatial House — Free Follow v1",
  tuning: {
    ...PRODUCTION_SMOOTH_TUNING,
    followStyle: "free",
    recenterEnabled: false,
  },
};

/** Spatial House — Orbit Follow v1 (approved Ecctrl-style; recenter still off). */
export const SPATIAL_HOUSE_ORBIT_FOLLOW_V1: NamedCameraPreset = {
  id: "spatial-house-orbit-follow-v1",
  label: "Spatial House — Orbit Follow v1",
  tuning: {
    ...DEFAULT_SMOOTH_TUNING,
    followStyle: "ecctrl",
    preferredDistance: PRODUCTION_SMOOTH_TUNING.preferredDistance,
    minDistance: PRODUCTION_SMOOTH_TUNING.minDistance,
    followResponsiveness: PRODUCTION_SMOOTH_TUNING.followResponsiveness,
    inwardResponsiveness: PRODUCTION_SMOOTH_TUNING.inwardResponsiveness,
    outwardResponsiveness: PRODUCTION_SMOOTH_TUNING.outwardResponsiveness,
    lookSpeed: PRODUCTION_SMOOTH_TUNING.lookSpeed,
    recenterEnabled: false,
    recenterDelay: 1.4,
    recenterSpeed: 1.1,
  },
};

export const SPATIAL_HOUSE_CAMERA_PRESETS = [
  SPATIAL_HOUSE_FREE_FOLLOW_V1,
  SPATIAL_HOUSE_ORBIT_FOLLOW_V1,
] as const;

export function tuningForFollowStyle(style: "free" | "ecctrl"): SmoothNavTuning {
  return style === "ecctrl"
    ? { ...SPATIAL_HOUSE_ORBIT_FOLLOW_V1.tuning }
    : { ...SPATIAL_HOUSE_FREE_FOLLOW_V1.tuning };
}
