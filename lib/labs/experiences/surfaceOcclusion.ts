import * as THREE from "three";
import type { LccClipBoxParams, LccObject } from "@/lib/labs/lccSdk";
import { fromVec3, surfaceLocalMatrix, twistedBasis } from "./surfaceGeometry";
import type { SurfaceOverlay, Vec3 } from "./surfaceTypes";

export type SurfaceDepthDiag = {
  /** Metres from collision/splat hit along stored normal to overlay plane origin. */
  signedGapM: number | null;
  /** Overlay plane origin (centre + offset·normal). */
  planeOrigin: Vec3;
  /** Unit normal used for offset (points roughly into the room). */
  normal: Vec3;
  /** Human-readable offset convention. */
  offsetNote: string;
  source: "collision" | "splat" | "none";
  writeDepthLikely: boolean;
};

/**
 * Offset convention (EXP-05 / 05B):
 *   planeOrigin = center + normal * offset
 * Normal is flipped at create-time to face into the room (heuristic).
 * Positive offset → move overlay into the room (toward furniture).
 * Negative offset → push overlay back into / behind the wall surface.
 * Units are metres. −0.69 m is a large push into the wall (or into the room if normal is flipped wrong).
 */
export function describeOffsetConvention(): string {
  return "offset (m): plane = centre + normal×offset; + toward room, − into wall (if normal faces room).";
}

export function overlayPlaneOrigin(surface: SurfaceOverlay): THREE.Vector3 {
  const n = fromVec3(surface.normal).normalize();
  return fromVec3(surface.center).addScaledVector(n, surface.offset);
}

/**
 * Cast along ±normal from plane origin to measure gap to collision (preferred) or splat ray.
 */
export function measureOverlayWallGap(
  surface: SurfaceOverlay,
  lcc: LccObject | null | undefined,
): SurfaceDepthDiag {
  const n = fromVec3(surface.normal).normalize();
  const origin = overlayPlaneOrigin(surface);
  const planeOrigin: Vec3 = [origin.x, origin.y, origin.z];
  const normal: Vec3 = [n.x, n.y, n.z];
  const base = {
    planeOrigin,
    normal,
    offsetNote: describeOffsetConvention(),
    writeDepthLikely: true,
  };

  if (!lcc) {
    return { ...base, signedGapM: null, source: "none" };
  }

  // Probe from slightly into the room, back toward the wall (−normal)
  const probeOrigin = origin.clone().addScaledVector(n, 0.35);
  const dirIntoWall = n.clone().negate();

  if (lcc.intersectsRayFromOriginExt) {
    const hit = lcc.intersectsRayFromOriginExt({
      origin: { x: probeOrigin.x, y: probeOrigin.y, z: probeOrigin.z },
      direction: { x: dirIntoWall.x, y: dirIntoWall.y, z: dirIntoWall.z },
      maxDistance: 4,
    });
    if (hit?.point) {
      const hp = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      // Metres the plane sits in front of the wall along +normal (into room).
      const gapInFront = origin.clone().sub(hp).dot(n);
      return { ...base, signedGapM: gapInFront, source: "collision" };
    }
  }

  if (lcc.raycastFromOrigin) {
    const hit = lcc.raycastFromOrigin({
      origin: { x: probeOrigin.x, y: probeOrigin.y, z: probeOrigin.z },
      direction: { x: dirIntoWall.x, y: dirIntoWall.y, z: dirIntoWall.z },
      maxDistance: 4,
      radius: 0.08,
    });
    if (hit) {
      const hp = new THREE.Vector3(hit.x, hit.y, hit.z);
      const gapInFront = origin.clone().sub(hp).dot(n);
      return { ...base, signedGapM: gapInFront, source: "splat" };
    }
  }

  return { ...base, signedGapM: null, source: "none" };
}

/**
 * Thin oriented clip box hugging the selected wall region.
 * Whole-model clip — will also suppress Gaussians that fall inside the box (e.g. protruding décor).
 */
export function clipBoxForSurface(
  surface: SurfaceOverlay,
  thicknessM = 0.12,
): LccClipBoxParams {
  const n = fromVec3(surface.normal).normalize();
  const t0 = fromVec3(surface.tangent).normalize();
  const { tangent, bitangent } = twistedBasis(n, t0, surface.twist);
  const origin = overlayPlaneOrigin(surface);
  // Pull slightly into the wall so the replacement mesh can sit on the room side
  const pos = origin.clone().addScaledVector(n, -thicknessM * 0.35);

  const m = new THREE.Matrix4();
  m.makeBasis(tangent, bitangent, n);
  const e = new THREE.Euler().setFromRotationMatrix(m, "XYZ");

  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: e.x, y: e.y, z: e.z },
    scale: { x: surface.width, y: surface.height, z: thicknessM },
    clipSide: 0,
  };
}

export type SurfaceRenderPreset = "default" | "opaque" | "noDepthWrite" | "alwaysFront";

export function applyRenderPresetToMaterial(
  mat: THREE.MeshBasicMaterial,
  preset: SurfaceRenderPreset,
) {
  mat.transparent = preset !== "opaque";
  if (preset === "opaque") {
    mat.opacity = 1;
    mat.depthTest = true;
    mat.depthWrite = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
  } else if (preset === "noDepthWrite") {
    mat.depthTest = true;
    mat.depthWrite = false;
    mat.polygonOffset = false;
  } else if (preset === "alwaysFront") {
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.transparent = true;
  } else {
    mat.depthTest = true;
    mat.depthWrite = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }
  mat.needsUpdate = true;
}

/** Euler XYZ from surface local matrix — for diagnostics. */
export function surfaceEulerDeg(surface: SurfaceOverlay): Vec3 {
  const e = new THREE.Euler().setFromRotationMatrix(surfaceLocalMatrix(surface), "XYZ");
  return [((e.x * 180) / Math.PI), ((e.y * 180) / Math.PI), ((e.z * 180) / Math.PI)];
}
