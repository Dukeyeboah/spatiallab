"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { computeInitialView, computeViewOfBox, type CameraView } from "@/lib/initialView";
import type { PointCloudData } from "@/lib/loadPointCloud";

type OrbitControlsLike = { target: THREE.Vector3; enableDamping: boolean; update: () => void };

/** initial = what Reset View returns to; scanArea / entire = the two framing buttons. */
export type ViewKind = "initial" | "scanArea" | "entire";
/** A button click: `serial` increases on every click, so the same kind can be requested twice. */
export type ViewRequest = { kind: ViewKind; serial: number };

type CameraFramingProps = {
  /** Must belong to `frameKey`'s dataset (or be null while it loads). */
  data: PointCloudData | null;
  /** The dataset id. A new key = a new scene to frame. */
  frameKey: string;
  /** The dataset's scan area in dataset (LiDAR) coordinates, if it defines one. Becomes the initial view. */
  scanArea: THREE.Box3 | null;
  /** The dataset's full LiDAR extent in dataset coordinates; null = min/max of the loaded points. */
  fullExtent: THREE.Box3 | null;
  request: ViewRequest | null;
};

/**
 * Sets the camera and OrbitControls target. Renders nothing.
 *
 * The views are computed once per dataset, from the first point budget that
 * loads, and kept. Switching point budgets therefore never moves the camera,
 * switching datasets frames the new scene, and Reset View always returns to
 * exactly the same view of the current dataset. Every view's target is the
 * centre of its box in world space, so orbiting always pivots on what is framed.
 */
export function CameraFraming({ data, frameKey, scanArea, fullExtent, request }: CameraFramingProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  // Registered by <OrbitControls makeDefault />.
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;

  const framed = useRef<{ key: string; views: Record<ViewKind, CameraView | null> } | null>(null);

  // First data of a dataset: compute its views and apply the initial one.
  useEffect(() => {
    if (!data || !controls || framed.current?.key === frameKey) return;
    const scanAreaView = scanArea ? computeViewOfBox(scanArea, camera) : null;
    const entireBox = fullExtent ?? new THREE.Box3().setFromArray(data.positions);
    framed.current = {
      key: frameKey,
      views: {
        initial: scanAreaView ?? computeInitialView(data.positions, camera),
        scanArea: scanAreaView,
        entire: computeViewOfBox(entireBox, camera),
      },
    };
    applyView(framed.current.views.initial!, camera, controls);
  }, [data, frameKey, scanArea, fullExtent, camera, controls]);

  // Reset View / Focus on Scan Area / Frame Entire Cloud.
  const serial = request?.serial ?? 0;
  const kind = request?.kind;
  useEffect(() => {
    if (!kind || !framed.current || !controls) return;
    const view = framed.current.views[kind];
    if (view) applyView(view, camera, controls);
  }, [serial, kind, camera, controls]);

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
