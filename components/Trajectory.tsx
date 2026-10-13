"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { PoseData } from "@/lib/loadPoses";

/**
 * Above this many poses a dot per pose is clutter, not information (Basel
 * House has 24,198 poses at 10 Hz): only the path and the start are drawn.
 */
export const MAX_POSE_POINTS = 2_000;

/** Radius of the start-position sphere, in metres. */
const START_MARKER_RADIUS = 0.25;

/**
 * The path runs inside buildings, behind walls and roofs made of millions of
 * points, so it is drawn on top: no depth test, in the transparent pass (after
 * all opaque and soft points), last. Display only; the points are unchanged.
 */
const ON_TOP = { depthTest: false, depthWrite: false, transparent: true } as const;
const ON_TOP_RENDER_ORDER = 10;

type TrajectoryProps = {
  poses: PoseData;
  showPath: boolean;
  showPoses: boolean;
};

/**
 * The scanner's journey. One BufferGeometry holds the pose positions and is
 * drawn twice: as a THREE.Line (the path, on top of the cloud) and as <points>
 * (a marker per pose). A small sphere marks where the scan started (the first pose).
 */
export function Trajectory({ poses, showPath, showPoses }: TrajectoryProps) {
  const geometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(poses.positions, 3));
    return geometry;
  }, [poses]);

  // <line> in JSX means the SVG element, so the three.js Line is created
  // directly and added to the scene with <primitive>.
  const line = useMemo(() => {
    const material = new THREE.LineBasicMaterial({ color: "#ff9a3c", ...ON_TOP });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = ON_TOP_RENDER_ORDER;
    return line;
  }, [geometry]);

  useEffect(
    () => () => {
      geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [geometry, line],
  );

  const start = poses.count > 0 ? poses.positions.subarray(0, 3) : null;

  return (
    <group>
      {showPath && <primitive object={line} />}

      {showPath && start && (
        <mesh position={[start[0], start[1], start[2]]} renderOrder={ON_TOP_RENDER_ORDER}>
          <sphereGeometry args={[START_MARKER_RADIUS, 16, 12]} />
          <meshBasicMaterial color="#3cff7a" {...ON_TOP} />
        </mesh>
      )}

      {showPoses && poses.count <= MAX_POSE_POINTS && (
        <points geometry={geometry}>
          <pointsMaterial color="#ffffff" size={3} sizeAttenuation={false} transparent opacity={0.6} />
        </points>
      )}
    </group>
  );
}
