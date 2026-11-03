import type { Vec3Tuple } from "../types";
import { DEFAULT_EYE_HEIGHT } from "./defaults";
import {
  emptyFloorCamera,
  type FloorBlockZone,
  type FloorCameraPose,
  type FloorConnection,
  type FloorRecord,
  type PropertyExperienceConfig,
} from "./types";

/**
 * Provisional Spintex House two-floor demo (LAB PROD-01).
 * Models: extracted locally under public/labs/properties/spintex-house/v1/ (gitignored).
 * Final client name TBD — provisionalName true until confirmed.
 */
export const SPINTEX_PROPERTY_ID = "spintex-house";

/**
 * First Floor stair threshold (author screenshots 2026-11-03).
 * Modal triggers at the void soft-block, not the mid-landing stop.
 */
export const FIRST_STAIR_STOP: Vec3Tuple = [-4.82, 0.45, -5.28];
export const FIRST_STAIR_BEYOND: Vec3Tuple = [-5.17, 0.35, -4.68];

/**
 * Ground Floor stair (on the steps, looking up) — author screenshots 2026-11-03.
 * False trigger was beside the stairs (~−0.29, 3.16); real stopper is on the treads.
 */
/** Author-updated block / popup pose 2026-11-03 15:59 — on stairs. */
export const GROUND_STAIR_STOP: Vec3Tuple = [-1.41, -2.96, 4.09];

export const FIRST_TO_GROUND_CONNECTION_ID = "conn-first-to-ground";
export const GROUND_TO_FIRST_CONNECTION_ID = "conn-ground-to-first";
export const FIRST_STAIR_BLOCK_ID = "block-stair-void";
export const GROUND_STAIR_BLOCK_ID = "block-stair-up";

function firstStairBlockZone(): FloorBlockZone {
  const dx = FIRST_STAIR_BEYOND[0] - FIRST_STAIR_STOP[0];
  const dz = FIRST_STAIR_BEYOND[2] - FIRST_STAIR_STOP[2];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const push = 0.55;
  return {
    id: FIRST_STAIR_BLOCK_ID,
    label: "Stair void",
    enabled: true,
    center: [
      FIRST_STAIR_BEYOND[0] + ux * push,
      1.1,
      FIRST_STAIR_BEYOND[2] + uz * push,
    ],
    size: [2.6, 2.8, 1.1],
  };
}

function groundStairBlockZone(): FloorBlockZone {
  // Soft wall on the stair treads — tight so the hallway beside the stairs stays clear
  return {
    id: GROUND_STAIR_BLOCK_ID,
    label: "Stair up",
    enabled: true,
    center: [GROUND_STAIR_STOP[0], GROUND_STAIR_STOP[1], GROUND_STAIR_STOP[2]],
    size: [1.55, 2.6, 1.55],
  };
}

function firstToGroundConnection(): FloorConnection {
  const block = firstStairBlockZone();
  const toLandingX = FIRST_STAIR_STOP[0] - block.center[0];
  const toLandingZ = FIRST_STAIR_STOP[2] - block.center[2];
  const len = Math.hypot(toLandingX, toLandingZ) || 1;
  const ux = toLandingX / len;
  const uz = toLandingZ / len;
  const triggerCenter: Vec3Tuple = [
    block.center[0] + ux * 0.65,
    1.1,
    block.center[2] + uz * 0.65,
  ];
  return {
    id: FIRST_TO_GROUND_CONNECTION_ID,
    label: "Go downstairs?",
    enabled: true,
    sourceFloorId: "first",
    destFloorId: "ground",
    triggerCenter,
    triggerSize: [2.2, 2.6, 1.35],
    arrivalCamera: emptyFloorCamera(),
    showMarker: false,
    transition: "fade",
  };
}

function groundToFirstConnection(): FloorConnection {
  const block = groundStairBlockZone();
  // Trigger coincides with the on-stair stopper — do not offset toward the hallway
  return {
    id: GROUND_TO_FIRST_CONNECTION_ID,
    label: "Go upstairs?",
    enabled: true,
    sourceFloorId: "ground",
    destFloorId: "first",
    triggerCenter: [block.center[0], block.center[1], block.center[2]],
    triggerSize: [1.5, 2.6, 1.5],
    arrivalCamera: emptyFloorCamera(),
    showMarker: false,
    transition: "fade",
  };
}

function nearVec(a: Vec3Tuple, b: Vec3Tuple, eps = 0.08): boolean {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps
  );
}

/**
 * Old bug: save wrote position.y = eyeHeight. On Ground Floor the real eye Y is ~−3,
 * so Y≈1.3–1.5 means the start is corrupt and must be re-saved.
 */
export function isCorruptGroundStartCamera(cam: FloorCameraPose | null | undefined): boolean {
  if (!cam) return false;
  const eye = cam.eyeHeight ?? DEFAULT_EYE_HEIGHT;
  return Math.abs(cam.position[1] - eye) < 0.12;
}

function upsertConnection(
  connections: FloorConnection[],
  desired: FloorConnection,
): { connections: FloorConnection[]; changed: boolean } {
  const idx = connections.findIndex(
    (c) =>
      c.id === desired.id ||
      (c.sourceFloorId === desired.sourceFloorId && c.destFloorId === desired.destFloorId),
  );
  if (idx < 0) {
    return { connections: [...connections, desired], changed: true };
  }
  let changed = false;
  const next = connections.map((c, i) => {
    if (i !== idx) return c;
    let out = c;
    if (
      !nearVec(c.triggerCenter, desired.triggerCenter) ||
      !nearVec(c.triggerSize, desired.triggerSize)
    ) {
      out = {
        ...out,
        id: desired.id,
        triggerCenter: desired.triggerCenter,
        triggerSize: desired.triggerSize,
        label: out.label?.includes("Go ") ? out.label : desired.label,
        enabled: true,
      };
      changed = true;
    }
    return out;
  });
  return { connections: next, changed };
}

function upsertBlockOnFloor(
  floor: FloorRecord,
  desired: FloorBlockZone,
): { floor: FloorRecord; changed: boolean } {
  const zones = floor.blockZones ?? [];
  const bi = zones.findIndex((z) => z.id === desired.id);
  if (bi < 0) {
    // Drop a generic author "Blocked area" that sits on the same stair spot (avoid double walls)
    const filtered = zones.filter((z) => {
      if (z.id === desired.id) return false;
      if (z.label === "Blocked area" && nearVec(z.center, desired.center, 1.2)) return false;
      return true;
    });
    return { floor: { ...floor, blockZones: [...filtered, desired] }, changed: true };
  }
  const z = zones[bi]!;
  if (!nearVec(z.center, desired.center) || !nearVec(z.size, desired.size)) {
    const nextZones = zones.slice();
    nextZones[bi] = { ...z, ...desired, enabled: true };
    return { floor: { ...floor, blockZones: nextZones }, changed: true };
  }
  return { floor, changed: false };
}

function syncArrival(
  connections: FloorConnection[],
  destFloorId: string,
  start: FloorCameraPose | null | undefined,
): { connections: FloorConnection[]; changed: boolean } {
  if (!start || isCorruptGroundStartCamera(destFloorId === "ground" ? start : null)) {
    return { connections, changed: false };
  }
  let changed = false;
  const next = connections.map((c) => {
    if (c.destFloorId !== destFloorId) return c;
    const arr = c.arrivalCamera;
    const isPlaceholder =
      !arr ||
      (Math.abs(arr.position[0]) < 0.01 &&
        Math.abs(arr.position[2] - 0.5) < 0.01 &&
        Math.abs((arr.eyeHeight ?? DEFAULT_EYE_HEIGHT) - DEFAULT_EYE_HEIGHT) < 0.05);
    const arrivalLooksCorrupt =
      destFloorId === "ground" && isCorruptGroundStartCamera(arr);
    if (!isPlaceholder && !arrivalLooksCorrupt) return c;
    changed = true;
    return { ...c, arrivalCamera: start };
  });
  return { connections: next, changed };
}

/**
 * Inject / refresh stair triggers + void blocks; repair corrupt Ground starts.
 * Returns the same object reference when nothing changed.
 */
export function ensureSpintexStairDefaults(
  config: PropertyExperienceConfig,
): PropertyExperienceConfig {
  if (config.property.id !== SPINTEX_PROPERTY_ID) return config;

  let changed = false;
  let connections = config.connections;

  const down = upsertConnection(connections, firstToGroundConnection());
  connections = down.connections;
  changed = changed || down.changed;

  const up = upsertConnection(connections, groundToFirstConnection());
  connections = up.connections;
  changed = changed || up.changed;

  const floors = config.floors.map((f) => {
    let floor = f;
    let floorChanged = false;

    if (f.id === "ground") {
      // Clear Ground start that stored eyeHeight as world Y (broken living-room teleport)
      if (isCorruptGroundStartCamera(f.startCamera)) {
        floor = { ...floor, startCamera: null };
        floorChanged = true;
      }
      if (floor.name === "Ground Floor") {
        floor = { ...floor, name: "Downstairs" };
        floorChanged = true;
      }
      const desiredPreview = "/labs/properties/spintex-house/v1/previews/downstairs.jpg";
      if (
        !floor.previewImageUrl ||
        floor.previewImageUrl.endsWith("/previews/ground.jpg") ||
        floor.previewImageUrl.startsWith("data:")
      ) {
        // Prefer authored photo thumbnails over package thumbs / huge data-URLs
        if (!floor.previewImageUrl?.startsWith("data:")) {
          floor = { ...floor, previewImageUrl: desiredPreview };
          floorChanged = true;
        } else if (floor.previewImageUrl.startsWith("data:")) {
          floor = { ...floor, previewImageUrl: desiredPreview };
          floorChanged = true;
        }
      }
      const block = upsertBlockOnFloor(floor, groundStairBlockZone());
      floor = block.floor;
      floorChanged = floorChanged || block.changed;
    }

    if (f.id === "first") {
      if (floor.name === "First Floor") {
        floor = { ...floor, name: "Upstairs" };
        floorChanged = true;
      }
      const desiredPreview = "/labs/properties/spintex-house/v1/previews/upstairs.jpg";
      if (
        !floor.previewImageUrl ||
        floor.previewImageUrl.endsWith("/previews/first.jpg") ||
        floor.previewImageUrl.startsWith("data:")
      ) {
        floor = { ...floor, previewImageUrl: desiredPreview };
        floorChanged = true;
      }
      const block = upsertBlockOnFloor(floor, firstStairBlockZone());
      floor = block.floor;
      floorChanged = floorChanged || block.changed;
    }

    changed = changed || floorChanged;
    return floor;
  });

  const ground = floors.find((f) => f.id === "ground");
  const first = floors.find((f) => f.id === "first");
  const syncG = syncArrival(connections, "ground", ground?.startCamera);
  connections = syncG.connections;
  changed = changed || syncG.changed;
  const syncF = syncArrival(connections, "first", first?.startCamera);
  connections = syncF.connections;
  changed = changed || syncF.changed;

  if (!changed) return config;
  return { ...config, floors, connections };
}

export function createSpintexSeed(): PropertyExperienceConfig {
  return ensureSpintexStairDefaults({
    schema: "spatial-lab/property-experience",
    version: 1,
    property: {
      id: SPINTEX_PROPERTY_ID,
      slug: "spintex-house",
      title: "Spintex House (provisional)",
      description:
        "Two-floor XGRIDS walkthrough — Downstairs and Upstairs as separate reconstructions.",
      status: "draft",
      provisionalName: true,
    },
    floors: [
      {
        id: "ground",
        name: "Downstairs",
        order: 0,
        model: {
          entry: "SpintexHouseGroundFloor.lcc",
          localBasePath: "/labs/properties/spintex-house/v1/ground",
        },
        previewImageUrl: "/labs/properties/spintex-house/v1/previews/downstairs.jpg",
        startCamera: null,
        defaultEyeHeight: DEFAULT_EYE_HEIGHT,
        viewpoints: [],
        floorPlan: null,
        visitorVisible: true,
        notes: "Source archive: Spintex House Ground Floor_render.zip (~13M splats, Portable .lcc)",
        blockZones: [groundStairBlockZone()],
      },
      {
        id: "first",
        name: "Upstairs",
        order: 1,
        model: {
          entry: "SpintexUpstairs.lcc",
          localBasePath: "/labs/properties/spintex-house/v1/first",
        },
        previewImageUrl: "/labs/properties/spintex-house/v1/previews/upstairs.jpg",
        startCamera: null,
        defaultEyeHeight: DEFAULT_EYE_HEIGHT,
        viewpoints: [],
        floorPlan: null,
        visitorVisible: true,
        notes: "Source archive: Spintex Upstairs_render.zip (~Portable .lcc)",
        blockZones: [firstStairBlockZone()],
      },
    ],
    connections: [firstToGroundConnection(), groundToFirstConnection()],
    visitor: {
      defaultFloorId: null,
      allowDirectFloorLinks: true,
      checkpointTransition: "fade",
      showFloorPlan: true,
      brandAccent: "#c4a574",
      intro: "Choose a floor to begin exploring this property in 3D.",
    },
  });
}
