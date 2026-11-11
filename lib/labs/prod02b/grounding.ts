import type { Prod02aStartPose } from "@/lib/labs/prod02a/assets";

export const ROBOT_GROUND_STEP_UP = 0.28;
export const ROBOT_GROUND_MAX_DROP = 1.2;

/** Probe from the feet, never from above the player's head into another storey. */
export function robotGroundProbe(eyeY: number, eyeHeight: number) {
  return {
    originY: eyeY - eyeHeight + ROBOT_GROUND_STEP_UP,
    maxDistance: ROBOT_GROUND_STEP_UP + ROBOT_GROUND_MAX_DROP,
  };
}

/** Defend against stray SDK hits and gaps in the incomplete exterior scan. */
export function robotGroundEyeY(
  eyeY: number,
  eyeHeight: number,
  hitY?: number,
) {
  if (hitY == null || !Number.isFinite(hitY)) return eyeY;
  const rise = hitY - (eyeY - eyeHeight);
  if (Math.abs(rise) < 0.015) return eyeY; // Ignore scan-floor noise below 1.5 cm.
  return rise <= ROBOT_GROUND_STEP_UP + 1e-4 &&
    rise >= -ROBOT_GROUND_MAX_DROP - 1e-4
    ? hitY + eyeHeight
    : eyeY;
}

/** Shift this lab's downstairs spawn back two metres and 1.2 m left, preserving floor height/look. */
export function robotStartPose(
  pose: Prod02aStartPose | null,
  downstairs: boolean,
): Prod02aStartPose | null {
  if (!pose || !downstairs) return pose;
  const dx = pose.eye[0] - pose.target[0],
    dz = pose.eye[2] - pose.target[2];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return pose;
  const x = (2 * dx - 1.2 * dz) / length,
    z = (2 * dz + 1.2 * dx) / length;
  return {
    ...pose,
    eye: [pose.eye[0] + x, pose.eye[1], pose.eye[2] + z],
    target: [pose.target[0] + x, pose.target[1], pose.target[2] + z],
  };
}
