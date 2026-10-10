"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Perf } from "r3f-perf";
import { CameraReset } from "./GaussianProjectionScene";
import { CompositedGaussians, UNDER_BLENDING, type CompositingReport } from "./CompositedGaussians";
import type { SceneGaussian } from "@/lib/gaussian/compositingScene";
import type { CompositingControlsState } from "@/lib/gaussian/compositingControls";

type CompositingSceneProps = {
  scene: SceneGaussian[];
  controls: CompositingControlsState;
  resetRequest: number;
  onReport: (report: CompositingReport) => void;
};

/**
 * Lab 7B's own canvas and camera (same start as Lab 6: (0, 0, 6), fov 50,
 * orbiting the origin).
 *
 * The canvas is cleared to TRANSPARENT (no <color attach="background">): front-to-back
 * compositing keeps the accumulated opacity in the canvas alpha, and the
 * page's #1a1a1a background shows through what is left.
 */
export function CompositingScene({ scene, controls, resetRequest, onReport }: CompositingSceneProps) {
  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 50, near: 0.1, far: 200 }}
        gl={{ alpha: true, premultipliedAlpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        linear
        flat
      >
        <Perf position="top-right" />
        <OrbitControls makeDefault target={[0, 0, 0]} />
        <CameraReset resetRequest={resetRequest} />
        <BackgroundGrid />
        <CompositedGaussians scene={scene} controls={controls} resetRequest={resetRequest} onReport={onReport} />
      </Canvas>
      {/* The probe pixel the panel analyses: the centre of the canvas. */}
      <div className="probe-marker" aria-hidden />
    </div>
  );
}

/**
 * 1 m reference grid below the Gaussians. Drawn AFTER them with the same
 * front-to-back blending, so it always sits behind every Gaussian (it is the
 * farthest "layer"), even when viewed from below.
 */
function BackgroundGrid() {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(20, 20, "#555", "#2a2a2a");
    const material = helper.material as THREE.LineBasicMaterial;
    Object.assign(material, UNDER_BLENDING, { transparent: true });
    helper.position.y = -1.8;
    helper.renderOrder = 2;
    return helper;
  }, []);

  useEffect(
    () => () => {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    },
    [grid],
  );

  return <primitive object={grid} />;
}
