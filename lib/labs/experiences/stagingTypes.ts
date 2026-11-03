/**
 * LAB EXP-04 / 04B — virtual staging placements.
 *
 * Canonical stored visual format is GLB (or builtin). See `stagingAssetPipeline.ts`
 * for future GLTF/OBJ/FBX/AI imports — they must convert to GLB before placements
 * reference them. Exports never depend on temporary object URLs or source format.
 */

export type Vec3 = [number, number, number];

export type StagingAssetRef =
  | { kind: "builtin"; builtinId: "simple-chair" }
  | { kind: "idb"; assetId: string; fileName: string; mimeType: string }
  | { kind: "public"; publicUrl: string; fileName: string };

export type StagingPlacement = {
  id: string;
  propertyId: string;
  /** LCC dataPath identity for this property. */
  modelDataPath?: string;
  asset: StagingAssetRef;
  displayName: string;
  position: Vec3;
  /** Euler radians XYZ (Three.js default order). */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  /**
   * When true, this placement blocks the walk capsule (and env wall-push while moving).
   * New placements default **false** so you can stage freely; turn on after you’re happy with pose.
   * Missing on older saves → treated as true (walk collision stays on).
   */
  collisionEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StagingExportBundle = {
  version: 1;
  exportedAt: string;
  propertyId: string;
  placements: StagingPlacement[];
  assetNotes: {
    hint: string;
    builtinId?: string;
    assetId?: string;
    publicUrl?: string;
    fileName?: string;
  }[];
};

export const BUILTIN_CHAIR_ASSET: StagingAssetRef = { kind: "builtin", builtinId: "simple-chair" };

export type StagingTransformMode = "translate" | "rotate" | "scale" | "scaleUniform";
