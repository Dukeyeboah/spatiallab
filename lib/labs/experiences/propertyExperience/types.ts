/**
 * LAB PROD-01 — versioned multi-floor property experience configuration.
 * Coordinates are always local to the floor that owns them (no shared world frame).
 */

import type { CheckpointTransitionMode, Vec3Tuple } from "../types";
import { DEFAULT_EYE_HEIGHT } from "./defaults";

export const PROPERTY_EXPERIENCE_SCHEMA = "spatial-lab/property-experience" as const;
export const PROPERTY_EXPERIENCE_VERSION = 1 as const;

export type PropertyPublicationStatus = "draft" | "ready" | "published";

/** Camera pose in a single floor's Three.js frame (after LCC modelMatrix). */
export type FloorCameraPose = {
  position: Vec3Tuple;
  target: Vec3Tuple;
  yaw?: number;
  pitch?: number;
  /** Eye height hint (metres); optional. */
  eyeHeight?: number;
};

export type FloorModelRef = {
  /**
   * Entry file relative to the floor's asset base (e.g. SpintexHouseGroundFloor.lcc).
   */
  entry: string;
  /**
   * Local public path prefix ending without trailing slash when possible,
   * e.g. /labs/properties/spintex-house/v1/ground
   */
  localBasePath?: string;
  /**
   * Optional remote HTTPS base (R2 / CDN), same relative layout as local.
   * When set and preferred, resolveModelUrl uses remoteBaseUrl + entry.
   */
  remoteBaseUrl?: string;
};

export type FloorViewpoint = {
  id: string;
  name: string;
  description?: string;
  roomId?: string;
  order?: number;
  /** Always the owning floor id. */
  floorId: string;
  position: Vec3Tuple;
  target: Vec3Tuple;
  yaw?: number;
  pitch?: number;
  icon?: string;
  showInScene?: boolean;
  /** Hidden from visitor room list when false. */
  visitorVisible?: boolean;
};

export type FloorPlanRef = {
  /** Public URL or /labs/... path for the plan image. */
  imageUrl?: string;
  /** Alignment stored separately in floor-plan tools; optional link by plan id. */
  planRecordId?: string;
};

/** Invisible walk blocker in floor-local coords (keeps the camera out of a region). */
export type FloorBlockZone = {
  id: string;
  label: string;
  enabled: boolean;
  /** Box centre (Three Y-up). */
  center: Vec3Tuple;
  /** Full width / height / depth in metres. */
  size: Vec3Tuple;
};

export type FloorRecord = {
  id: string;
  name: string;
  /** Sort order (0 = ground typically). */
  order: number;
  model: FloorModelRef;
  /** Preview for floor-selection screen (not an LCC load). */
  previewImageUrl?: string;
  startCamera: FloorCameraPose | null;
  /**
   * Default eye height for this floor (metres). Applied on load and when authoring.
   * Falls back to startCamera.eyeHeight, then DEFAULT_EYE_HEIGHT (1.50).
   */
  defaultEyeHeight?: number;
  /** Soft barriers — visitor cannot walk into these boxes. */
  blockZones?: FloorBlockZone[];
  viewpoints: FloorViewpoint[];
  floorPlan?: FloorPlanRef | null;
  visitorVisible: boolean;
  notes?: string;
};

/**
 * Authored link between two separate reconstructions.
 * Source trigger is in sourceFloor local coords; arrival is in destFloor local coords.
 */
export type FloorConnection = {
  id: string;
  label: string;
  enabled: boolean;
  sourceFloorId: string;
  destFloorId: string;
  /** Axis-aligned box centre (Three Y-up, source floor). */
  triggerCenter: Vec3Tuple;
  /** Full width/height/depth in metres. */
  triggerSize: Vec3Tuple;
  arrivalCamera: FloorCameraPose;
  showMarker?: boolean;
  transition?: CheckpointTransitionMode;
};

export type VisitorUiSettings = {
  /** Floor opened when ?floor= is absent and selection is skipped. */
  defaultFloorId?: string | null;
  /** When true, /experiences/[slug]?floor=ground skips welcome. */
  allowDirectFloorLinks?: boolean;
  checkpointTransition?: CheckpointTransitionMode;
  showFloorPlan?: boolean;
  brandAccent?: string;
  intro?: string;
};

export type PropertyExperienceConfig = {
  schema: typeof PROPERTY_EXPERIENCE_SCHEMA;
  version: typeof PROPERTY_EXPERIENCE_VERSION;
  property: {
    id: string;
    /** URL slug for Spatial House `/experiences/[slug]`. */
    slug: string;
    title: string;
    description: string;
    status: PropertyPublicationStatus;
    provisionalName?: boolean;
  };
  floors: FloorRecord[];
  connections: FloorConnection[];
  visitor: VisitorUiSettings;
  updatedAt?: string;
};

export function emptyFloorCamera(): FloorCameraPose {
  const eye = DEFAULT_EYE_HEIGHT;
  return {
    position: [0, eye, 0.5],
    target: [0, eye - 0.15, -2.5],
    yaw: 0,
    pitch: 0,
    eyeHeight: eye,
  };
}

export function resolveFloorModelUrl(
  floor: FloorRecord,
  prefer: "local" | "remote" = "local",
): string {
  const entry = floor.model.entry.replace(/^\//, "");
  if (prefer === "remote" && floor.model.remoteBaseUrl) {
    const base = floor.model.remoteBaseUrl.replace(/\/$/, "");
    return `${base}/${entry}`;
  }
  const local = (floor.model.localBasePath ?? "").replace(/\/$/, "");
  if (!local) {
    throw new Error(`Floor ${floor.id} has no localBasePath or remoteBaseUrl`);
  }
  return `${local}/${entry}`;
}

export function floorById(config: PropertyExperienceConfig, id: string): FloorRecord | undefined {
  return config.floors.find((f) => f.id === id);
}

export function sortedFloors(config: PropertyExperienceConfig): FloorRecord[] {
  return [...config.floors].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
