/** Isolated PROD-02A assets — LCC2 packages (do not alter PROD-01 portable v1). */

import { loadDraft } from "@/lib/labs/experiences/propertyExperience/storage";
import { isCorruptGroundStartCamera, SPINTEX_PROPERTY_ID } from "@/lib/labs/experiences/propertyExperience/spintexSeed";
import type { Vec3Tuple } from "@/lib/labs/experiences/types";

export type Prod02aFloorId = "ground" | "first";

export type Prod02aStartPose = {
  eye: Vec3Tuple;
  target: Vec3Tuple;
  eyeHeight?: number;
  source: "prod01-draft" | "fallback";
};

export type Prod02aFloorAsset = {
  id: Prod02aFloorId;
  name: string;
  /** Public URL to .lcc2 entry */
  dataPath: string;
  /** Portable .lcc fallback for A/B format comparison */
  portableDataPath: string;
};

export const PROD02A_FLOORS: Record<Prod02aFloorId, Prod02aFloorAsset> = {
  ground: {
    id: "ground",
    name: "Downstairs",
    dataPath: "/labs/properties/spintex-house/v1-lcc2/ground/SpintexHouseGroundFloor.lcc2",
    portableDataPath: "/labs/properties/spintex-house/v1/ground/SpintexHouseGroundFloor.lcc",
  },
  first: {
    id: "first",
    name: "Upstairs",
    dataPath: "/labs/properties/spintex-house/v1-lcc2/first/SpintexUpstairs.lcc2",
    portableDataPath: "/labs/properties/spintex-house/v1/first/SpintexUpstairs.lcc",
  },
};

export const PROD02A_FLOOR_ORDER: Prod02aFloorId[] = ["ground", "first"];

/**
 * Hardcoded Ground living-room start aligned with PROD-01 authoring
 * (poses.json for LCC2 often drops the camera outside / above the house).
 */
const GROUND_FALLBACK_START: Prod02aStartPose = {
  eye: [4.02, -3.21, 7.02],
  target: [3.2, -3.4, 4.8],
  eyeHeight: 1.28,
  source: "fallback",
};

/** SSR-safe fallback only (no localStorage). */
export function resolveProd02aStartPoseSsr(floorId: Prod02aFloorId): Prod02aStartPose | null {
  if (floorId === "ground") return GROUND_FALLBACK_START;
  return null;
}

/** Prefer PROD-01 draft start when present; else Ground fallback; First may return null (use poses). */
export function resolveProd02aStartPose(floorId: Prod02aFloorId): Prod02aStartPose | null {
  try {
    const draft = loadDraft(SPINTEX_PROPERTY_ID);
    const floor = draft?.floors.find((f) => f.id === floorId);
    const cam = floor?.startCamera;
    if (cam?.position && cam?.target) {
      if (!(floorId === "ground" && isCorruptGroundStartCamera(cam))) {
        return {
          eye: [cam.position[0], cam.position[1], cam.position[2]],
          target: [cam.target[0], cam.target[1], cam.target[2]],
          eyeHeight: cam.eyeHeight ?? floor?.defaultEyeHeight,
          source: "prod01-draft",
        };
      }
    }
  } catch {
    /* ignore */
  }
  return resolveProd02aStartPoseSsr(floorId);
}
