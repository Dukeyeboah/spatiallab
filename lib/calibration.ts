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
 * A provisional camera-to-scanner rotation for the manual direction test: NOT
 * a calibration and never used as a camera pose. Angles in degrees, in the
 * scanner's body frame (X forward, Y left, Z up; checked against the walking
 * direction and gravity in poses.csv), applied in this order:
 *   yaw   about body Z: positive = turn right (seen from above), −90 = left;
 *   pitch about the new Y: positive = tilt up;
 *   roll  about the viewing axis: positive = clockwise seen from behind the camera.
 * Zero = looking along scanner +X with image up = scanner +Z.
 * No lever arm: the direction is drawn from the scanner's position.
 */
export type ProvisionalOrientation = { yawDeg: number; pitchDeg: number; rollDeg: number };

export const NEUTRAL_ORIENTATION: ProvisionalOrientation = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

/** Starting hypothesis of the direction test (Lab 13S): ch14 looks left, ch18 right. Not a claim of correctness. */
export const STARTING_HYPOTHESIS: Record<string, ProvisionalOrientation> = {
  ch14: { yawDeg: -90, pitchDeg: 0, rollDeg: 0 },
  ch18: { yawDeg: 90, pitchDeg: 0, rollDeg: 0 },
};

/** Rotation from the provisional camera frame (X = viewing direction, Y = image left, Z = image up) to the scanner body frame. */
export function provisionalRotation(o: ProvisionalOrientation): THREE.Quaternion {
  const d = THREE.MathUtils.degToRad;
  // Right-hand rotations about Z and Y turn left and down, hence the signs.
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(d(o.rollDeg), d(-o.pitchDeg), d(-o.yawDeg), "ZYX"));
}

/** The viewing direction in the scanner body frame, in words, e.g. "left 90°, up 10°". */
export function describeDirection(o: ProvisionalOrientation): string {
  const v = new THREE.Vector3(1, 0, 0).applyQuaternion(provisionalRotation(o));
  const deg = THREE.MathUtils.radToDeg;
  const azimuthRight = deg(Math.atan2(-v.y, v.x)); // 0 = forward, + = right
  const elevation = deg(Math.asin(THREE.MathUtils.clamp(v.z, -1, 1)));
  const side =
    Math.abs(azimuthRight) < 0.5
      ? "forward"
      : Math.abs(azimuthRight) > 179.5
        ? "backward"
        : `${azimuthRight > 0 ? "right" : "left"} ${Math.abs(azimuthRight).toFixed(0)}°`;
  const height = Math.abs(elevation) < 0.5 ? "level" : `${elevation > 0 ? "up" : "down"} ${Math.abs(elevation).toFixed(0)}°`;
  return `${side}, ${height}`;
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
