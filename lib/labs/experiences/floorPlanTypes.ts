/**
 * LAB EXP-03B — floor-plan alignment config (separate from LCC tiles).
 * Image bytes live in IndexedDB; this JSON references asset ids.
 */

export type FloorPlanAnchor = {
  id: string;
  /** Optional link to a saved checkpoint / viewpoint. */
  viewpointId?: string;
  label?: string;
  /** Optional map pin glyph (same set as checkpoints). */
  icon?: string;
  /** World XZ (Three.js Y-up scene after modelMatrix). */
  worldX: number;
  worldZ: number;
  /** Normalized image coords (0–1), origin top-left. */
  u: number;
  v: number;
};

/** Similarity: world XZ → image UV (uniform scale + rotation + translation). */
export type FloorPlanSimilarity = {
  kind: "similarity";
  /** Radians, rotates world XZ into image space. */
  rotation: number;
  scale: number;
  tx: number;
  ty: number;
  /** Optional residuals per anchor id after fit. */
  residuals?: Record<string, number>;
  rms?: number;
};

export type FloorPlanAffine = {
  kind: "affine";
  /** [u] = [a b][x] + [c] ; warns when used (nonuniform / shear). */
  /** [v]   [d e][z]   [f] */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  residuals?: Record<string, number>;
  rms?: number;
  warning: string;
};

export type FloorPlanTransform = FloorPlanSimilarity | FloorPlanAffine;

export type FloorPlanRoom = {
  id: string;
  name: string;
  floorId: string;
  /** Polygon in normalized image UV. */
  polygon: { u: number; v: number }[];
  viewpointIds: string[];
  defaultViewpointId?: string;
};

export type FloorPlanRecord = {
  id: string;
  propertyId: string;
  floorId: string;
  floorName: string;
  /** IndexedDB asset key, or public URL for bundled samples. */
  imageAssetId: string;
  /** When set, image is served from /public (not IDB). */
  publicUrl?: string;
  width: number;
  height: number;
  mimeType: string;
  isDefault: boolean;
  anchors: FloorPlanAnchor[];
  transform: FloorPlanTransform | null;
  rooms: FloorPlanRoom[];
  coordSystemVersion: 1;
  modelDataPath?: string;
  updatedAt: string;
};

export type FloorPlanExportBundle = {
  version: 1;
  exportedAt: string;
  propertyId: string;
  plans: FloorPlanRecord[];
  /**
   * Images are NOT embedded by default (can be large).
   * `imageNotes` explains how to restore each asset.
   */
  imageNotes: { assetId: string; fileNameHint: string; publicUrl?: string }[];
};
