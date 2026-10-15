import * as THREE from "three";
import { provisionalRotation, type ProvisionalOrientation } from "@/lib/calibration";
import type { Quat } from "@/lib/xgrids";

/**
 * Lab 13U: a provisional fisheye projection for diagnostics only.
 *
 * ASSUMED, not calibrated: an equidistant model r = f·θ with a configurable
 * focal parameter, principal point and usable image radius. The defaults are
 * the rough values of the Lab 13S direction test, not manufacturer intrinsics.
 *
 * Conventions (docs/xgrids/provisional-camera-directions.json, unchanged):
 * - scanner pose: v_las = R(q) · v_body, q = (x, y, z, w);
 * - provisional camera frame: X = optical axis, Y = image left, Z = image up;
 * - v_body = R_offset · v_cam, R_offset = Rz(−yaw)·Ry(−pitch)·Rx(roll);
 * - camera centre = scanner position (lever arm unknown, assumed 0).
 * Pixels: u right, v down, (0, 0) = centre of the top-left pixel (OpenCV),
 * so a 4000 × 3000 image spans u ∈ [−0.5, 3999.5], v ∈ [−0.5, 2999.5].
 */
export type FisheyeModel = {
  model: "equidistant";
  /** Pixels per radian of angle from the optical axis. */
  focalPx: number;
  cx: number;
  cy: number;
  /** Beyond this distance from (cx, cy) the projection is treated as invalid. */
  validRadiusPx: number;
  status: "assumed";
};

/** Lab 13S test values scaled to 4000 × 3000 (f = 30 px/rad at 160 × 120 → 750). Assumed. */
export const DEFAULT_FISHEYE_MODEL: FisheyeModel = {
  model: "equidistant",
  focalPx: 750,
  cx: 1999.5,
  cy: 1449.5,
  validRadiusPx: 1400,
  status: "assumed",
};

export type ProjectionResult =
  | { valid: true; u: number; v: number; thetaDeg: number; rangeM: number }
  | { valid: false; reason: string };

/**
 * A projector for one camera at one scanner pose: (x, y, z) in original LAS
 * coordinates (metres) → pixel. Built once, used for many points.
 */
export function makeProjector(
  scannerPositionLas: [number, number, number],
  scannerQuaternion: Quat,
  orientation: ProvisionalOrientation,
  model: FisheyeModel,
): (x: number, y: number, z: number) => ProjectionResult {
  // LAS → camera: v_cam = R_offsetᵀ · R(q)ᵀ · (p − t).
  const cameraToLas = new THREE.Quaternion(...scannerQuaternion).normalize().multiply(provisionalRotation(orientation));
  const m = new THREE.Matrix4().makeRotationFromQuaternion(cameraToLas.invert()).elements; // column-major
  const [tx, ty, tz] = scannerPositionLas;
  return (x, y, z) => {
    // Subtract in float64 before rotating: LAS values are large.
    const dx = x - tx;
    const dy = y - ty;
    const dz = z - tz;
    const cx = m[0] * dx + m[4] * dy + m[8] * dz;
    const cy = m[1] * dx + m[5] * dy + m[9] * dz;
    const cz = m[2] * dx + m[6] * dy + m[10] * dz;
    const range = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (range < 1e-6) return { valid: false, reason: "point at the camera centre" };
    const theta = Math.acos(Math.max(-1, Math.min(1, cx / range)));
    const r = model.focalPx * theta;
    if (r > model.validRadiusPx)
      return { valid: false, reason: `outside the usable radius (θ = ${THREE.MathUtils.radToDeg(theta).toFixed(0)}°)` };
    const s = Math.hypot(cy, cz);
    // On the axis the direction in the image is undefined but r = 0.
    const u = model.cx + (s > 0 ? (r * -cy) / s : 0);
    const v = model.cy + (s > 0 ? (r * -cz) / s : 0);
    return { valid: true, u, v, thetaDeg: THREE.MathUtils.radToDeg(theta), rangeM: range };
  };
}

/**
 * Project a subsample of a point cloud (dataset coordinates + offset = LAS)
 * for an image overlay. Returns (u, v, range) triplets of valid projections
 * within `maxRangeM`; invalid points are left out.
 */
export function projectCloud(
  positions: Float32Array,
  count: number,
  offset: [number, number, number],
  projector: (x: number, y: number, z: number) => ProjectionResult,
  maxRangeM = 20,
  maxSamples = 400_000,
): Float32Array {
  const stride = Math.max(1, Math.ceil(count / maxSamples));
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) {
    const p = projector(positions[i * 3] + offset[0], positions[i * 3 + 1] + offset[1], positions[i * 3 + 2] + offset[2]);
    if (p.valid && p.rangeM <= maxRangeM) out.push(p.u, p.v, p.rangeM);
  }
  // Far to near, so nearer points are drawn over the ones they hide (no depth test in 2D).
  const order = Array.from({ length: out.length / 3 }, (_, k) => k).sort((a, b) => out[b * 3 + 2] - out[a * 3 + 2]);
  const sorted = new Float32Array(out.length);
  order.forEach((k, j) => {
    sorted[j * 3] = out[k * 3];
    sorted[j * 3 + 1] = out[k * 3 + 1];
    sorted[j * 3 + 2] = out[k * 3 + 2];
  });
  return sorted;
}

/**
 * Inverse of the provisional model: the LAS-frame unit direction of the ray
 * through pixel (u, v). Only for navigating to a feature, never stored.
 */
export function pixelRayDirection(
  u: number,
  v: number,
  scannerQuaternion: Quat,
  orientation: ProvisionalOrientation,
  model: FisheyeModel,
): THREE.Vector3 {
  const du = u - model.cx;
  const dv = v - model.cy;
  const r = Math.hypot(du, dv);
  const theta = r / model.focalPx;
  // Camera frame: X optical axis, Y image left (−u), Z image up (−v).
  const camera = r > 0 ? new THREE.Vector3(Math.cos(theta), (-Math.sin(theta) * du) / r, (-Math.sin(theta) * dv) / r) : new THREE.Vector3(1, 0, 0);
  const cameraToLas = new THREE.Quaternion(...scannerQuaternion).normalize().multiply(provisionalRotation(orientation));
  return camera.applyQuaternion(cameraToLas);
}

/** Project one LAS point (see makeProjector). */
export function projectLasPoint(
  pointLas: [number, number, number],
  scannerPositionLas: [number, number, number],
  scannerQuaternion: Quat,
  orientation: ProvisionalOrientation,
  model: FisheyeModel,
): ProjectionResult {
  return makeProjector(scannerPositionLas, scannerQuaternion, orientation, model)(...pointLas);
}
