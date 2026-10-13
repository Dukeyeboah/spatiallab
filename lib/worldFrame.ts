import * as THREE from "three";
import type { Vec3 } from "./datasets";
import { usefulBounds } from "./usefulBounds";

/**
 * Three.js is "Y-up", LiDAR data is "Z-up".
 * Rotating by -90° around X turns LiDAR Z into three.js Y.
 *
 * Each dataset's coordinate offset lives in its metadata (lib/datasets.ts),
 * not here: every budget and the poses of a dataset subtract that offset.
 *
 * The full chain from original LAS coordinates to the viewer, for every dataset:
 *
 *   dataset = LAS − offset                          (done by the converter; the files hold this)
 *   world   = R · dataset,  R = rotation −90° about X
 *           = (x, y, z) → (x, z, −y)                (LAS X stays X, LAS Z becomes up, LAS Y points to −Z)
 *
 * R is a proper rotation, so handedness and distances are preserved. Nothing
 * else (no extra rotation, scale or shift) is applied to the points.
 */
export const LIDAR_TO_THREE_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

const LIDAR_TO_THREE = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...LIDAR_TO_THREE_ROTATION));

/** A dataset-coordinate (LiDAR, Z-up) box in three.js world space (Y-up). */
export function lidarBoxToWorld(box: THREE.Box3): THREE.Box3 {
  return box.clone().applyMatrix4(LIDAR_TO_THREE);
}

/** A dataset-coordinate point in three.js world space. */
export function lidarPointToWorld(point: Vec3): THREE.Vector3 {
  return new THREE.Vector3(...point).applyMatrix4(LIDAR_TO_THREE);
}

/**
 * Checks the "LiDAR Z is up" assumption on the data instead of trusting it:
 * buildings and terrain are much wider than they are tall, so Z should be the
 * smallest extent of the useful (1st–99th percentile) box.
 */
export function describeVerticalAxis(positions: Float32Array): string {
  const size = usefulBounds(positions).getSize(new THREE.Vector3());
  const extents = `X ${size.x.toFixed(1)} × Y ${size.y.toFixed(1)} × Z ${size.z.toFixed(1)} m`;
  return size.z < Math.min(size.x, size.y)
    ? `Z up (checked: middle 98% of points spans ${extents})`
    : `⚠ Z may not be up: middle 98% of points spans ${extents}. Shown as LiDAR Z-up anyway.`;
}

/** An original-LAS box in dataset coordinates: subtract the dataset's offset. */
export function lasBoxToDataset(min: Vec3, max: Vec3, offset: Vec3): THREE.Box3 {
  const o = new THREE.Vector3(...offset);
  return new THREE.Box3(new THREE.Vector3(...min).sub(o), new THREE.Vector3(...max).sub(o));
}
