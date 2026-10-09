"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Perf } from "r3f-perf";
import { ProjectedGaussianQuad } from "./ProjectedGaussianQuad";
import type { Gaussian3D, ProjectedGaussian } from "@/lib/gaussian/gaussianMath";

/** This experiment's own camera, independent of the LiDAR viewer. */
const START_CAMERA_POSITION = new THREE.Vector3(0, 0, 6);
const ORBIT_TARGET = new THREE.Vector3(0, 0, 0);

type GaussianProjectionSceneProps = {
  gaussian: Gaussian3D;
  sigma3D: THREE.Matrix3;
  supportSigmas: number;
  showOutline: boolean;
  showEllipsoid: boolean;
  /** Increases by one on every Reset click. */
  resetRequest: number;
  onProjection: (projection: ProjectedGaussian) => void;
};

export function GaussianProjectionScene({
  gaussian,
  sigma3D,
  supportSigmas,
  showOutline,
  showEllipsoid,
  resetRequest,
  onProjection,
}: GaussianProjectionSceneProps) {
  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: START_CAMERA_POSITION.toArray(), fov: 50, near: 0.1, far: 200 }}
        linear
        flat
      >
        <color attach="background" args={["#1a1a1a"]} />
        <Perf position="top-right" />
        <OrbitControls makeDefault target={ORBIT_TARGET.toArray()} />
        <CameraReset resetRequest={resetRequest} />

        {/* Reference: 1 m grid below the Gaussian, world axes at the origin. */}
        <gridHelper args={[20, 20, "#555", "#2a2a2a"]} position={[0, -1.5, 0]} />
        <axesHelper args={[1]} />

        {/*
          The 1-sigma surface of the 3D Gaussian in world space: a unit sphere
          scaled by `scale` and turned by `rotation` (the same R and S used for
          Sigma3D). The projected 2D ellipse should hug its silhouette's core.
          Drawn after (on top of) the projected footprint, which would
          otherwise hide it.
        */}
        {showEllipsoid && (
          <mesh
            position={gaussian.position}
            quaternion={gaussian.rotation}
            scale={gaussian.scale}
            renderOrder={11}
          >
            <sphereGeometry args={[1, 32, 16]} />
            <meshBasicMaterial color="#bbb" wireframe transparent opacity={0.25} depthTest={false} />
          </mesh>
        )}

        <ProjectedGaussianQuad
          gaussian={gaussian}
          sigma3D={sigma3D}
          supportSigmas={supportSigmas}
          showOutline={showOutline}
          onProjection={onProjection}
        />
      </Canvas>
    </div>
  );
}

type OrbitControlsLike = { target: THREE.Vector3; enableDamping: boolean; update: () => void };

/** Puts the camera back at its starting position (after the Reset button). */
function CameraReset({ resetRequest }: { resetRequest: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;

  useEffect(() => {
    if (resetRequest === 0 || !controls) return;
    // Flush any leftover damping momentum first (see CameraFraming.tsx).
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(START_CAMERA_POSITION);
    controls.target.copy(ORBIT_TARGET);
    controls.update();
    controls.enableDamping = damping;
  }, [resetRequest, camera, controls]);

  return null;
}
