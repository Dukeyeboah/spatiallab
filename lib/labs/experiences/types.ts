/**
 * Spatial Lab Experiences — per-property tour configuration (LAB EXP-01 / EXP-02).
 * Kept separate from the LCC model files so each client project can define
 * branding, viewpoints, hotspots and floor maps without touching reconstruction data.
 */

export type Vec3Tuple = [number, number, number];

export type ExperienceViewpoint = {
  id: string;
  name: string;
  description?: string;
  /** Optional room / area label for the visitor room list. */
  roomId?: string;
  /** Sort order within the property (lower first). */
  order?: number;
  /** Three.js world eye position (after LCC modelMatrix). */
  position: Vec3Tuple;
  /** Orbit / look-at target in the same frame. */
  target: Vec3Tuple;
  sceneId: string;
  /** Optional 2D floor-map marker (normalized 0–1 on the map image / SVG). */
  mapUv?: { u: number; v: number };
};

export type ExperienceHotspot = {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  url?: string;
  position: Vec3Tuple;
  sceneId: string;
};

export type ExperienceFloor = {
  id: string;
  name: string;
  /** Optional plan image under public/. */
  imageUrl?: string;
  /**
   * Manual world AABB for map ↔ 3D (Three.js Y-up).
   * NOT the full LCC getBounds() shell — walkable interior only.
   */
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

export type ExperienceNavPrefs = {
  defaultMode: "orbit" | "first-person";
  maxSplats: number;
  collision?: boolean;
};

export type ExperienceProperty = {
  id: string;
  title: string;
  description: string;
  dataPath: string;
  sizeHint?: string;
  branding?: { accent?: string; tagline?: string };
  nav: ExperienceNavPrefs;
  floors: ExperienceFloor[];
  viewpoints: ExperienceViewpoint[];
  hotspots: ExperienceHotspot[];
  viewpointsReady: boolean;
};

export type ExperienceCatalog = {
  version: 1;
  properties: ExperienceProperty[];
};
