"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { computeInitialView, type CameraView } from "@/lib/initialView";
import type { PointCloudData } from "@/lib/loadPointCloud";

type OrbitControlsLike = { target: THREE.Vector3; enableDamping: boolean; update: () => void };

type CameraFramingProps = {
  data: PointCloudData | null;
  /** Increases by one every time Reset View is clicked. */
  resetRequest: number;
};

/**
 * Sets the camera and OrbitControls target. Renders nothing.
 *
 * The initial view is computed once, from the first dataset that loads, and
 * kept. Switching point budgets therefore never moves the camera, and
 * Reset View always returns to exactly the same view.
 */
export function CameraFraming({ data, resetRequest }: CameraFramingProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  // Registered by <OrbitControls makeDefault />.
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;

  const initialView = useRef<CameraView | null>(null);

  // First dataset: compute and apply the initial view.
  useEffect(() => {
    if (!data || !controls || initialView.current) return;
    initialView.current = computeInitialView(data.positions, camera);
    applyView(initialView.current, camera, controls);
  }, [data, camera, controls]);

  // Reset View button.
  useEffect(() => {
    if (resetRequest === 0 || !initialView.current || !controls) return;
    applyView(initialView.current, camera, controls);
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
