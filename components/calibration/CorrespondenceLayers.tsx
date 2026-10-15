"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Vec3 } from "@/lib/datasets";
import type { PointCloudData } from "@/lib/loadPointCloud";
import { pickPoint, type PickOptions, type PickResult } from "@/lib/pointPicking";

const ON_TOP = { depthTest: false, depthWrite: false, transparent: true } as const;
const ON_TOP_RENDER_ORDER = 12;
/** A press that moves further than this is an orbit drag, not a pick. */
const CLICK_TOLERANCE_PX = 4;

type CorrespondenceLayersProps = {
  cloud: PointCloudData | null;
  armed: boolean;
  options: PickOptions;
  onPick: (result: PickResult) => void;
  /** Pending pick in dataset coordinates. */
  pending: { nearest: Vec3; refined: Vec3 | null; chosen: Vec3 } | null;
  /** Saved correspondences of this dataset, dataset coordinates. */
  saved: { id: string; label: string; position: Vec3; active: boolean }[];
};

/** Lab 13U layers. Must be placed inside the LiDAR (Z-up) group of SpatialScene. */
export function CorrespondenceLayers({ cloud, armed, options, onPick, pending, saved }: CorrespondenceLayersProps) {
  const anchor = useRef<THREE.Group>(null);
  return (
    // An untransformed group: its world matrix is the LiDAR group's (dataset → world).
    <group ref={anchor}>
      {armed && cloud && <PickHandler cloud={cloud} anchor={anchor} options={options} onPick={onPick} />}
      {saved.map((s) => (
        <group key={s.id} position={s.position}>
          <mesh renderOrder={ON_TOP_RENDER_ORDER}>
            <sphereGeometry args={[0.025, 12, 8]} />
            <meshBasicMaterial color={s.active ? "#40e0ff" : "#2a8aa0"} {...ON_TOP} />
          </mesh>
          <Html center className="helper-label pick-label" style={{ color: s.active ? "#40e0ff" : "#7ab" }} position={[0, 0, 0.08]}>
            {s.label}
          </Html>
        </group>
      ))}
      {pending && (
        <>
          <mesh position={pending.nearest} renderOrder={ON_TOP_RENDER_ORDER}>
            <sphereGeometry args={[0.018, 12, 8]} />
            <meshBasicMaterial color="#ffffff" {...ON_TOP} />
          </mesh>
          {pending.refined && (
            <mesh position={pending.refined} renderOrder={ON_TOP_RENDER_ORDER}>
              <sphereGeometry args={[0.018, 12, 8]} />
              <meshBasicMaterial color="#60ff60" {...ON_TOP} />
            </mesh>
          )}
          {/* Ring around the position that would be saved. */}
          <mesh position={pending.chosen} renderOrder={ON_TOP_RENDER_ORDER}>
            <sphereGeometry args={[0.06, 16, 12]} />
            <meshBasicMaterial color="#ffe040" opacity={0.35} {...ON_TOP} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** While mounted, a click (not a drag) on the canvas picks a LiDAR point. Renders nothing. */
function PickHandler({
  cloud,
  anchor,
  options,
  onPick,
}: {
  cloud: PointCloudData;
  anchor: RefObject<THREE.Group | null>;
  options: PickOptions;
  onPick: (result: PickResult) => void;
}) {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);
  // Latest values without re-binding the listeners.
  const latest = useRef({ cloud, options, onPick });
  latest.current = { cloud, options, onPick };

  useEffect(() => {
    let down: { x: number; y: number } | null = null;
    const previousCursor = element.style.cursor;
    element.style.cursor = "crosshair";
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || !anchor.current) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > CLICK_TOLERANCE_PX) return;
      const rect = element.getBoundingClientRect();
      const click = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      camera.updateMatrixWorld();
      anchor.current.updateWorldMatrix(true, false);
      const datasetToWorld = anchor.current.matrixWorld;
      const datasetToClip = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(datasetToWorld);
      const ndc = new THREE.Vector2((click.x / rect.width) * 2 - 1, -(click.y / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const ray = raycaster.ray.clone().applyMatrix4(datasetToWorld.clone().invert());
      ray.direction.normalize();
      const { cloud, options, onPick } = latest.current;
      const result = pickPoint(cloud.positions, cloud.count, datasetToClip, click, { width: rect.width, height: rect.height }, ray, options);
      if (result) onPick(result);
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
      element.style.cursor = previousCursor;
    };
  }, [camera, element, anchor]);

  return null;
}
