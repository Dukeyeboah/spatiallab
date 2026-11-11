/**
 * PROD-02B original Mixamo imports, retained as immutable build inputs.
 * Joint names use Mixamo Blender style: `mixamorig:Hips`, …
 */

export const PROD02B_AVATAR_DIR = "/labs/prod02b/avatars";

export const PROD02B_AVATAR_FILES = {
  standing: `${PROD02B_AVATAR_DIR}/standing.glb`,
  walk: `${PROD02B_AVATAR_DIR}/walk.glb`,
  left: `${PROD02B_AVATAR_DIR}/left.glb`,
  right: `${PROD02B_AVATAR_DIR}/right.glb`,
} as const;

export type Prod02bClipRole =
  | "Idle"
  | "Walk"
  | "Run"
  | "JumpStart"
  | "Jump"
  | "Land"
  | "TurnLeft"
  | "TurnRight";

export type ClipInspection = {
  sourceFile: string;
  index: number;
  name: string;
  duration: number;
  trackCount: number;
  /** Suggested role after heuristics (may be overridden in Dev). */
  suggestedRole: Prod02bClipRole | "unused";
};

/** Draco decoder for KHR_draco_mesh_compression (vendored from three.js). */
export const PROD02B_DRACO_DECODER_PATH = "/vendor/draco/gltf/";

/** These exports accumulate earlier actions: longest is always the old Idle. */
export const PROD02B_CLIP_INDEX = {
  "standing.glb": { Idle: 0 },
  "walk.glb": { Walk: 1 },
  "left.glb": { TurnLeft: 3 },
  "right.glb": { TurnRight: 2 },
} as const;

/** Tailored original rig + eight explicitly named actions; one lazy-loaded file. */
export const PROD02B_AVATAR_FILE = `${PROD02B_AVATAR_DIR}/spatial-house-avatar.glb`;
export const PROD02B_CLIP_ROLES: Prod02bClipRole[] = [
  "Idle",
  "Walk",
  "Run",
  "JumpStart",
  "Jump",
  "Land",
  "TurnLeft",
  "TurnRight",
];

export type Prod02bAvatarId = "walker" | "r01" | "human" | "orb";
export const PROD02B_AVATARS = {
  orb: {
    label: "Orb Assistant V1.1",
    url: `${PROD02B_AVATAR_DIR}/robots/spatial-orb-assistant-v1.1.glb`,
    height: 0.257,
    hoverHeight: 0.05,
    pbr: true,
    canRun: true,
    walkCycleSpeed: 1.25,
    runCycleSpeed: 2.125,
  },
  walker: {
    label: "Walking robot",
    url: `${PROD02B_AVATAR_DIR}/robots/walker.glb`,
    height: 1.65,
    hoverHeight: 0,
    pbr: true,
    canRun: true,
    walkCycleSpeed: 0.63,
    runCycleSpeed: 1.12,
  },
  r01: {
    label: "R01 hover robot",
    url: `${PROD02B_AVATAR_DIR}/robots/r01.glb`,
    height: 1.45,
    hoverHeight: 0.18,
    pbr: true,
    canRun: true,
    walkCycleSpeed: 1.6,
    runCycleSpeed: 3.0,
  },
  human: {
    label: "Previous character",
    url: PROD02B_AVATAR_FILE,
    height: 1.75,
    hoverHeight: 0,
    pbr: false,
    canRun: true,
    walkCycleSpeed: 1.8,
    runCycleSpeed: 3.0,
  },
} as const;
