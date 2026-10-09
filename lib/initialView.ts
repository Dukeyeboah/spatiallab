import * as THREE from "three";
import { usefulBounds } from "./usefulBounds";
import { LIDAR_TO_THREE_ROTATION } from "./worldFrame";

/** A camera position and the point OrbitControls orbits around (three.js world space). */
export type CameraView = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

/** Camera height angle above the target: 0° = eye level, 90° = straight down. */
const ELEVATION_DEGREES = 15;
/** Horizontal direction the camera looks from, around the vertical axis. */
const AZIMUTH_DEGREES = 45;

/**
 * Frame the useful scan volume:
 *   target   = centre of the useful bounding box
 *   position = target + a direction (low elevation) * a distance that fits
 *              the box's bounding sphere inside the camera's field of view.
 */
export function computeInitialView(
  positions: Float32Array,
  camera: THREE.PerspectiveCamera,
): CameraView {
  // The box is in LiDAR coordinates (Z-up). Rotate it into three.js world
  // space (Y-up) with the same rotation as the scene's LiDAR group.
  const lidarToThree = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(...LIDAR_TO_THREE_ROTATION),
  );
  const box = usefulBounds(positions).applyMatrix4(lidarToThree);

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
