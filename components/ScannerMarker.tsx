"use client";

import type { PoseData } from "@/lib/loadPoses";

type ScannerMarkerProps = {
  poses: PoseData;
  /** 0-based pose index. */
  index: number;
};

/**
 * Fixed rotation from the scanner's body frame to the marker geometry's frame.
 * The geometry below points forward along local +X (ROS/LiDAR convention:
 * X forward, Y left, Z up). If the scanner turns out to use a different
 * forward axis, change this — never the recorded quaternions.
 */
const MARKER_FORWARD_CORRECTION: [number, number, number] = [0, 0, 0];

const MARKER_COLOR = "#3cc8ff";

/**
 * A simple stand-in for the scanner at one pose. Must be placed inside the
 * shared LiDAR (Z-up) group, so the recorded position and quaternion are used as-is.
 */
export function ScannerMarker({ poses, index }: ScannerMarkerProps) {
  const p = poses.positions;
  const q = poses.orientations;

  const position: [number, number, number] = [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
  // three.js Quaternion order is (x, y, z, w), same as poses.csv.
  const quaternion: [number, number, number, number] = [
    q[index * 4],
    q[index * 4 + 1],
    q[index * 4 + 2],
    q[index * 4 + 3],
  ];

  return (
    <group position={position} quaternion={quaternion}>
      {/* The recorded body frame: red = X, green = Y, blue = Z. 0.3 m long. */}
      <axesHelper args={[0.3]} />

      <group rotation={MARKER_FORWARD_CORRECTION}>
        {/* Body */}
        <mesh>
          <boxGeometry args={[0.08, 0.07, 0.055]} />
          <meshBasicMaterial color={MARKER_COLOR} />
        </mesh>

        {/* Forward cone. ConeGeometry points along +Y, so rotate it to +X. */}
        <mesh position={[0.095, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.035, 0.11, 16]} />
          <meshBasicMaterial color={MARKER_COLOR} />
        </mesh>
      </group>
    </group>
  );
}
