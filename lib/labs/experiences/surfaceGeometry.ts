import * as THREE from "three";
import {
  defaultColorMaterial,
  type SurfaceOverlay,
  type SurfacePickMeta,
  type Vec3,
} from "./surfaceTypes";
import { presetFinishDefaults } from "./wallMaterialTypes";

const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export function toVec3(v: THREE.Vector3 | { x: number; y: number; z: number }): Vec3 {
  return [v.x, v.y, v.z];
}

export function fromVec3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

/** Prefer nearly vertical surfaces for wall overlays. */
export function isPlanarWallSuitable(normal: { x: number; y: number; z: number }): boolean {
  const ny = Math.abs(normal.y);
  const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
  return ny / len < 0.45;
}

/**
 * Build orthonormal tangent (right) + bitangent (up) for a wall normal.
 * Prefer world-up for “up the wall” when the surface is vertical.
 */
export function wallBasis(normal: THREE.Vector3): { tangent: THREE.Vector3; bitangent: THREE.Vector3 } {
  _n.copy(normal).normalize();
  if (Math.abs(_n.dot(UP)) > 0.92) {
    // Floor/ceiling — use world +Z as reference
    _t.set(1, 0, 0).cross(_n).normalize();
    if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
  } else {
    _t.copy(UP).cross(_n).normalize();
  }
  _b.copy(_n).cross(_t).normalize();
  // Keep bitangent pointing roughly up
  if (_b.y < 0) {
    _t.negate();
    _b.negate();
  }
  return { tangent: _t.clone(), bitangent: _b.clone() };
}

export function projectToPlane(
  point: THREE.Vector3,
  planePoint: THREE.Vector3,
  planeNormal: THREE.Vector3,
): THREE.Vector3 {
  _n.copy(planeNormal).normalize();
  _tmp.copy(point).sub(planePoint);
  const d = _tmp.dot(_n);
  return point.clone().sub(_n.multiplyScalar(d));
}

/** Twist tangent/bitangent around normal. */
export function twistedBasis(
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  twist: number,
): { tangent: THREE.Vector3; bitangent: THREE.Vector3 } {
  _q.setFromAxisAngle(normal.clone().normalize(), twist);
  const t = tangent.clone().normalize().applyQuaternion(_q);
  const b = new THREE.Vector3().crossVectors(normal.clone().normalize(), t).normalize();
  return { tangent: t, bitangent: b };
}

export function overlayCornerWorld(surface: SurfaceOverlay, su: -1 | 1, sv: -1 | 1): THREE.Vector3 {
  const n = fromVec3(surface.normal).normalize();
  const t0 = fromVec3(surface.tangent).normalize();
  const { tangent, bitangent } = twistedBasis(n, t0, surface.twist);
  const c = fromVec3(surface.center).addScaledVector(n, surface.offset);
  return c
    .addScaledVector(tangent, su * (surface.width * 0.5))
    .addScaledVector(bitangent, sv * (surface.height * 0.5));
}

/** Four corners BL, BR, TR, TL in world space (facing along +normal into room). */
export function overlayCorners(surface: SurfaceOverlay): THREE.Vector3[] {
  return [
    overlayCornerWorld(surface, -1, -1),
    overlayCornerWorld(surface, 1, -1),
    overlayCornerWorld(surface, 1, 1),
    overlayCornerWorld(surface, -1, 1),
  ];
}

/**
 * Fit an oriented rectangle from 2–4 picks on a wall.
 * Uses first hit normal; projects later points onto that plane.
 */
export function overlayFromCornerPicks(
  propertyId: string,
  modelDataPath: string | undefined,
  hits: { point: Vec3; normal: Vec3 }[],
  pickMeta: SurfacePickMeta,
): SurfaceOverlay | null {
  if (hits.length < 2) return null;
  const n = fromVec3(hits[0].normal).normalize();
  // Flip so normal faces roughly toward origin / room (heuristic: prefer +dot with -point)
  const p0 = fromVec3(hits[0].point);
  if (n.dot(p0) > 0) n.negate();

  const planePt = p0.clone();
  const projected = hits.map((h) => projectToPlane(fromVec3(h.point), planePt, n));
  const { tangent, bitangent } = wallBasis(n);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of projected) {
    const rel = p.clone().sub(planePt);
    const u = rel.dot(tangent);
    const v = rel.dot(bitangent);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const width = Math.max(0.25, maxU - minU);
  const height = Math.max(0.25, maxV - minV);
  const center = planePt
    .clone()
    .addScaledVector(tangent, (minU + maxU) * 0.5)
    .addScaledVector(bitangent, (minV + maxV) * 0.5);

  const now = new Date().toISOString();
  return {
    id: `surf_${Date.now().toString(36)}`,
    propertyId,
    modelDataPath,
    label: "Wall overlay",
    center: toVec3(center),
    normal: toVec3(n),
    tangent: toVec3(tangent),
    width,
    height,
    offset: 0.02,
    twist: 0,
    material: defaultColorMaterial("#c8d0d8"),
    finish: presetFinishDefaults("mattePaint", "#c8d0d8"),
    visible: true,
    showBase: true,
    designVariantId: "default",
    artwork: [],
    pickMeta,
    createdAt: now,
    updatedAt: now,
  };
}

export function createOverlayFromHit(
  propertyId: string,
  modelDataPath: string | undefined,
  hit: Vec3,
  normal: Vec3,
  source: "collision" | "splat",
  width = 2.2,
  height = 2.4,
): SurfaceOverlay {
  const n = fromVec3(normal).normalize();
  const p = fromVec3(hit);
  // Face into the room: if normal points away from a typical indoor origin heuristic, flip
  if (n.dot(p) > 0) n.negate();
  const { tangent } = wallBasis(n);
  const planarSuitable = isPlanarWallSuitable(n);
  const now = new Date().toISOString();
  return {
    id: `surf_${Date.now().toString(36)}`,
    propertyId,
    modelDataPath,
    label: "Wall overlay",
    center: toVec3(p),
    normal: toVec3(n),
    tangent: toVec3(tangent),
    width,
    height,
    offset: 0.02,
    twist: 0,
    material: defaultColorMaterial(planarSuitable ? "#c8d0d8" : "#e040a0"),
    finish: presetFinishDefaults("mattePaint", planarSuitable ? "#c8d0d8" : "#e040a0"),
    visible: true,
    showBase: true,
    designVariantId: "default",
    artwork: [],
    pickMeta: {
      hitPoint: hit,
      hitNormal: normal,
      source,
      planarSuitable,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Local → world matrix for a surface plane (origin at centre+offset, Z = normal). */
export function surfaceLocalMatrix(surface: SurfaceOverlay): THREE.Matrix4 {
  const n = fromVec3(surface.normal).normalize();
  const t0 = fromVec3(surface.tangent).normalize();
  const { tangent, bitangent } = twistedBasis(n, t0, surface.twist);
  const origin = fromVec3(surface.center).addScaledVector(n, surface.offset);
  const m = new THREE.Matrix4();
  m.makeBasis(tangent, bitangent, n);
  m.setPosition(origin);
  return m;
}
