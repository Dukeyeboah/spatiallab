"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { PoseData } from "@/lib/loadPoses";

type TrajectoryProps = {
  poses: PoseData;
  showPath: boolean;
  showPoses: boolean;
};

/**
 * The scanner's journey. One BufferGeometry holds the pose positions and is
 * drawn twice: as a THREE.Line (the path) and as <points> (a marker per pose).
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
    const material = new THREE.LineBasicMaterial({ color: "#ff9a3c" });
    return new THREE.Line(geometry, material);
  }, [geometry]);

  useEffect(
    () => () => {
      geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [geometry, line],
  );

  return (
    <group>
      {showPath && <primitive object={line} />}

      {showPoses && (
        <points geometry={geometry}>
          <pointsMaterial color="#ffffff" size={3} sizeAttenuation={false} transparent opacity={0.6} />
        </points>
      )}
    </group>
  );
}
