"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { computeInitialView, type CameraView } from "@/lib/initialView";
import type { PointCloudData } from "@/lib/loadPointCloud";

type OrbitControlsLike = { target: THREE.Vector3; enableDamping: boolean; update: () => void };

type CameraFramingProps = {
  /** Must belong to `frameKey`'s dataset (or be null while it loads). */
  data: PointCloudData | null;
  /** The dataset id. A new key = a new scene to frame. */
  frameKey: string;
  /** Increases by one every time Reset View is clicked. */
  resetRequest: number;
};

/**
 * Sets the camera and OrbitControls target. Renders nothing.
 *
 * The view is computed once per dataset, from the first point budget that
 * loads, and kept. Switching point budgets therefore never moves the camera,
 * switching datasets frames the new scene, and Reset View always returns to
 * exactly the same view of the current dataset.
 */
export function CameraFraming({ data, frameKey, resetRequest }: CameraFramingProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  // Registered by <OrbitControls makeDefault />.
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;

  const framed = useRef<{ key: string; view: CameraView } | null>(null);

  // First data of a dataset: compute and apply its initial view.
  useEffect(() => {
    if (!data || !controls || framed.current?.key === frameKey) return;
    framed.current = { key: frameKey, view: computeInitialView(data.positions, camera) };
    applyView(framed.current.view, camera, controls);
  }, [data, frameKey, camera, controls]);

  // Reset View button.
  useEffect(() => {
    if (resetRequest === 0 || !framed.current || !controls) return;
    applyView(framed.current.view, camera, controls);
  }, [resetRequest, camera, controls]);

  return null;
}

function applyView(view: CameraView, camera: THREE.Camera, controls: OrbitControlsLike) {
  // With damping, a recent drag leaves "momentum" that would keep moving the
  // camera after we set it. An update() with damping off flushes it.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();

  camera.position.copy(view.position);
  controls.target.copy(view.target);
  // Makes the camera look at the new target.
  controls.update();

  controls.enableDamping = damping;
}
