/**
 * LAB EXP-05 — wall / surface overlays (non-destructive; LCC untouched).
 * Designed so overlays can later group under named design variants.
 */

import type { WallFinishSettingsV1 } from "./wallMaterialTypes";

export type Vec3 = [number, number, number];

export type { WallFinishSettingsV1 } from "./wallMaterialTypes";

export type SurfaceTextureMapping = {
  repeatU: number;
  repeatV: number;
  offsetU: number;
  offsetV: number;
  /** Radians in UV space. */
  rotation: number;
};

export type SurfaceColorMaterial = {
  kind: "color";
  color: string;
  opacity: number;
};

export type SurfaceTextureMaterial = {
  kind: "texture";
  assetId: string;
  fileName: string;
  /** Multiplies texture (white = unchanged). */
  color: string;
  opacity: number;
  mapping: SurfaceTextureMapping;
};

export type SurfaceMaterial = SurfaceColorMaterial | SurfaceTextureMaterial;

export type SurfaceArtwork = {
  id: string;
  imageAssetId: string;
  fileName: string;
  /** Metres from plane centre along tangent (right). */
  u: number;
  /** Metres from plane centre along bitangent (up). */
  v: number;
  width: number;
  height: number;
  /** Radians around wall normal. */
  rotation: number;
  frameColor: string;
  /** Outward frame depth (metres). */
  frameDepth: number;
  /** Border thickness in plane (metres). */
  frameBorder: number;
};

export type SurfacePickMeta = {
  hitPoint: Vec3;
  hitNormal: Vec3;
  source: "collision" | "splat";
  /** Roughly vertical wall (|ny| small) → good for planar overlay. */
  planarSuitable: boolean;
};

/** Axis-aligned hole in the overlay’s local UV (u = tangent, v = bitangent). */
export type SurfaceExcludeRect = {
  id: string;
  u: number;
  v: number;
  width: number;
  height: number;
};

/**
 * Oriented rectangle in the shared Y-up tour world frame.
 * Geometry is centre + normal + tangent + size (not Gaussian edits).
 */
export type SurfaceOverlay = {
  id: string;
  propertyId: string;
  modelDataPath?: string;
  label: string;
  center: Vec3;
  normal: Vec3;
  /** Unit “right” on the wall (world). */
  tangent: Vec3;
  width: number;
  height: number;
  /** Push along normal toward the room (positive = in front of splat wall). */
  offset: number;
  /** Extra rotation around normal (radians). */
  twist: number;
  material: SurfaceMaterial;
  /**
   * EXP-05E layered wall finish (procedural + optional map). When missing, built
   * from `material.color` + Smooth Matte Paint defaults at load time.
   */
  finish?: WallFinishSettingsV1;
  visible: boolean;
  /**
   * When false, hide the wall panel / wallpaper mesh so only framed artwork remains.
   * Missing on older saves → treated as true.
   */
  showBase?: boolean;
  /**
   * EXP-05D: `plane` (default) vs `thinBox` — box keeps the **front face** at the same
   * local z=0 as the plane and extends thickness back into the wall (−normal).
   */
  shellMode?: "plane" | "thinBox";
  /** Thin-box depth in metres (clamped ~0.01–0.03 in UI). Ignored for plane. */
  shellThickness?: number;
  /**
   * Rectangular holes in the wall panel (local UV metres from centre).
   * Used to leave protruding décor / existing wall art uncovered.
   */
  excludeRects?: SurfaceExcludeRect[];
  /** Reserved for future named design variants (no switching UI in EXP-05). */
  designVariantId?: string;
  artwork: SurfaceArtwork[];
  pickMeta?: SurfacePickMeta;
  createdAt: string;
  updatedAt: string;
};

export type SurfaceExportBundle = {
  version: 1;
  exportedAt: string;
  propertyId: string;
  surfaces: SurfaceOverlay[];
  assetNotes: {
    hint: string;
    assetId?: string;
    fileName?: string;
  }[];
};

export const SURFACE_COLOR_PRESETS = [
  { id: "white", label: "White", color: "#f4f1ea" },
  { id: "warm", label: "Warm grey", color: "#d4cfc4" },
  { id: "sage", label: "Sage", color: "#9caf88" },
  { id: "navy", label: "Navy", color: "#2c3e5a" },
  { id: "terracotta", label: "Terracotta", color: "#c4785a" },
  { id: "debug", label: "Debug magenta", color: "#e040a0" },
] as const;

export const DEFAULT_TEXTURE_MAPPING: SurfaceTextureMapping = {
  repeatU: 1,
  repeatV: 1,
  offsetU: 0,
  offsetV: 0,
  rotation: 0,
};

export function defaultColorMaterial(color = "#c8d0d8"): SurfaceColorMaterial {
  // Opaque by default — translucent pink was for debug only (EXP-05B).
  return { kind: "color", color, opacity: 1 };
}
