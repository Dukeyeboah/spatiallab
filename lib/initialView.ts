import * as THREE from "three";
import { usefulBounds } from "./usefulBounds";
import { lidarBoxToWorld } from "./worldFrame";

/** A camera position and the point OrbitControls orbits around (three.js world space). */
export type CameraView = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

/** Camera height angle above the target: 0° = eye level, 90° = straight down. */
const ELEVATION_DEGREES = 15;
/** Horizontal direction the camera looks from, around the vertical axis. */
const AZIMUTH_DEGREES = 45;

/** Frame the useful scan volume (1st–99th percentile box of the points). */
export function computeInitialView(
  positions: Float32Array,
  camera: THREE.PerspectiveCamera,
): CameraView {
  return computeViewOfBox(usefulBounds(positions), camera);
}

/**
 * Frame a box given in dataset (LiDAR, Z-up) coordinates:
 *   target   = centre of the box in three.js world space (the same rotation
 *              as the scene's LiDAR group, lib/worldFrame.ts)
 *   position = target + a direction (low elevation) * a distance that fits
 *              the box's bounding sphere inside the camera's field of view.
 */
export function computeViewOfBox(lidarBox: THREE.Box3, camera: THREE.PerspectiveCamera): CameraView {
  const box = lidarBoxToWorld(lidarBox);

  const target = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;

  // Distance at which a sphere of `radius` just fits in the narrower of the
  // vertical and horizontal fields of view.
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2);

  const elevation = THREE.MathUtils.degToRad(ELEVATION_DEGREES);
  const azimuth = THREE.MathUtils.degToRad(AZIMUTH_DEGREES);
  const direction = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );

  const position = target.clone().addScaledVector(direction, distance);
  return { position, target };
}
