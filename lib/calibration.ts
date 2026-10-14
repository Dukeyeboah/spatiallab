import * as THREE from "three";

/**
 * Lab 13R: what is known about each XGRIDS camera's geometry, kept explicit so
 * the workspace never presents a guess as a calibration.
 *
 * Today both parts are unknown for both cameras (docs/xgrids/calibration-notes.md).
 * A later lab adds verified variants to these unions (e.g. a fisheye model
 * with parameters and reprojection error, a camera-to-scanner rotation and
 * translation with its source); the panel already shows each part's status.
 */
export type Intrinsics = { status: "unknown" };
export type Extrinsics = { status: "unknown" };

export type CameraCalibration = {
  channel: string;
  intrinsics: Intrinsics;
  extrinsics: Extrinsics;
};

export const KNOWN_CALIBRATION: Record<string, CameraCalibration> = {
  ch14: { channel: "ch14", intrinsics: { status: "unknown" }, extrinsics: { status: "unknown" } },
  ch18: { channel: "ch18", intrinsics: { status: "unknown" }, extrinsics: { status: "unknown" } },
};

export function calibrationOf(channel: string): CameraCalibration {
  return KNOWN_CALIBRATION[channel] ?? { channel, intrinsics: { status: "unknown" }, extrinsics: { status: "unknown" } };
}

/**
 * A provisional camera orientation for visual experiments only: NOT a
 * calibration, not saved, never used as a camera pose. Angles in degrees,
 * relative to the scanner's body frame (X forward, Y left, Z up):
 * yaw about Z, then pitch about the new Y (positive = down, right-hand rule),
 * then roll about the viewing axis. Zero = looking along scanner +X.
 * No lever arm: the direction is drawn from the scanner's position.
 */
export type ProvisionalOrientation = { yawDeg: number; pitchDeg: number; rollDeg: number };

export const NEUTRAL_ORIENTATION: ProvisionalOrientation = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

/** Rotation from the provisional camera frame (X = viewing direction, Z = image up) to the scanner body frame. */
export function provisionalRotation(o: ProvisionalOrientation): THREE.Quaternion {
  const d = THREE.MathUtils.degToRad;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(d(o.rollDeg), d(o.pitchDeg), d(o.yawDeg), "ZYX"));
}

/** Viewing direction and image-up direction of a provisional camera, in the LiDAR frame. */
export function provisionalAxes(
  scanner: [number, number, number, number],
  o: ProvisionalOrientation,
): { forward: THREE.Vector3; up: THREE.Vector3 } {
  const rotation = new THREE.Quaternion(...scanner).normalize().multiply(provisionalRotation(o));
  return {
    forward: new THREE.Vector3(1, 0, 0).applyQuaternion(rotation),
    up: new THREE.Vector3(0, 0, 1).applyQuaternion(rotation),
  };
}
