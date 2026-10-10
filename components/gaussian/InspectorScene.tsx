"use client";

import { useCallback, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { Perf } from "r3f-perf";
import { CameraReset } from "./GaussianProjectionScene";
import { ProjectedGaussianQuad } from "./ProjectedGaussianQuad";
import type { Gaussian3D, ProjectedGaussian } from "@/lib/gaussian/gaussianMath";
import {
  viewColor,
  viewDirectionInFile,
  type GaussianEdits,
  type GaussianRecord,
} from "@/lib/gaussian/inspector";
import type { RGB } from "@/lib/gaussian/sphericalHarmonics";

/** Same start as Lab 6 (CameraReset returns here): 6 preview units in front, looking at the origin. */
const START_CAMERA_POSITION: [number, number, number] = [0, 0, 6];

export type ViewReport = {
  /** Colour seen from the current camera (degree-0 + higher SH up to edits.shDegree). */
  color: RGB;
  /** Camera -> Gaussian unit vector, in the file frame. */
  direction: [number, number, number];
  /** Camera distance in preview units. */
  distance: number;
};

type InspectorSceneProps = {
  record: GaussianRecord;
  edits: GaussianEdits;
  /** The edited Gaussian in preview space (see lib/gaussian/inspector.ts). */
  gaussian: Gaussian3D;
  sigma3D: THREE.Matrix3;
  supportSigmas: number;
  showOutline: boolean;
  showEllipsoid: boolean;
  resetRequest: number;
  onProjection: (projection: ProjectedGaussian) => void;
  onView: (view: ViewReport) => void;
};

/**
 * One trained Gaussian on its own, through Lab 6's projection: the grey
 * wireframe is its 1σ ellipsoid in 3D, the coloured ellipse its projection on
 * the screen, the red/green/blue lines its own axes (lengths = its 1σ scales).
 * The orientation gizmo (bottom right) shows the preview's X, Y, Z (Y up, as
 * in the Gaussian viewer).
 */
export function InspectorScene({
  record,
  edits,
  gaussian,
  sigma3D,
  supportSigmas,
  showOutline,
  showEllipsoid,
  resetRequest,
  onProjection,
  onView,
}: InspectorSceneProps) {
  const colorForCamera = useCallback(
    (cameraPosition: THREE.Vector3, target: THREE.Color) => {
      target.setRGB(...viewColor(record, edits, cameraPosition));
    },
    [record, edits],
  );

  return (
    <div className="canvas-container">
      <Canvas camera={{ position: START_CAMERA_POSITION, fov: 50, near: 0.01, far: 500 }} linear flat>
        <color attach="background" args={["#1a1a1a"]} />
        <Perf position="top-right" />
        <OrbitControls makeDefault target={[0, 0, 0]} />
        <CameraReset resetRequest={resetRequest} />
        <gridHelper args={[20, 20, "#555", "#2a2a2a"]} position={[0, -1.5, 0]} />
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>

        {showEllipsoid && (
          <group position={gaussian.position} quaternion={gaussian.rotation} scale={gaussian.scale}>
            <mesh renderOrder={11}>
              <sphereGeometry args={[1, 32, 16]} />
              <meshBasicMaterial color="#bbb" wireframe transparent opacity={0.25} depthTest={false} />
            </mesh>
            {/* The Gaussian's own axes: x = scale_0 (red), y = scale_1 (green), z = scale_2 (blue). */}
            <axesHelper args={[1]} renderOrder={12} material-depthTest={false} />
          </group>
        )}

        <ProjectedGaussianQuad
          gaussian={gaussian}
          sigma3D={sigma3D}
          supportSigmas={supportSigmas}
          showOutline={showOutline}
          onProjection={onProjection}
          colorForCamera={colorForCamera}
        />
        <ViewReporter record={record} edits={edits} onView={onView} />
      </Canvas>
    </div>
  );
}

/** Tells the panel the current view colour and direction, only when they visibly change. */
function ViewReporter({
  record,
  edits,
  onView,
}: {
  record: GaussianRecord;
  edits: GaussianEdits;
  onView: (view: ViewReport) => void;
}) {
  const last = useRef("");
  useFrame(({ camera }) => {
    const color = viewColor(record, edits, camera.position);
    const direction = viewDirectionInFile(camera.position);
    const distance = camera.position.length();
    const key = [...color, ...direction, distance].map((v) => v.toFixed(3)).join(",");
    if (key === last.current) return;
    last.current = key;
    onView({ color, direction, distance });
  });
  return null;
}
