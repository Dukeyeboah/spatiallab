"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { DISPLAY_RADIUS, frustumSegments, poseDisplay, type DisplayCamera } from "@/lib/poseView";
import { thumbnailUrl, type PosePreview } from "@/lib/training";

const START = new THREE.Vector3(0, DISPLAY_RADIUS * 1.6, DISPLAY_RADIUS * 2.2);
const START_FOV = 60;
const FRUSTUM_DEPTH = 0.3;
const CAMERA_COLOUR = new THREE.Color("#f0a030");
const SELECTED_COLOUR = new THREE.Color("#ffffff");

type View = { position: THREE.Vector3; target: THREE.Vector3; fov: number; key: number };
const startView = (key: number): View => ({ position: START, target: new THREE.Vector3(), fov: START_FOV, key });

type PoseSceneProps = {
  projectId: string;
  preview: PosePreview;
  unplaced: number;
};

/**
 * Lab 10B: COLMAP's sparse points and solved cameras, shown upright and
 * scaled for viewing (lib/poseView.ts). Click a camera to see its photo;
 * "Look through this camera" places the view at the solved pose, so the
 * photo and the points can be compared.
 */
export function PoseScene({ projectId, preview, unplaced }: PoseSceneProps) {
  const display = useMemo(() => poseDisplay(preview), [preview]);
  const [selected, setSelected] = useState<DisplayCamera | null>(null);
  const [view, setView] = useState<View>(() => startView(0));

  // Same vertical field of view as the photo, so its content lines up with the points at the same size.
  const lookThrough = (camera: DisplayCamera) =>
    setView((v) => ({
      position: camera.position.clone(),
      target: camera.position.clone().addScaledVector(camera.forward, 1),
      fov: THREE.MathUtils.radToDeg(2 * Math.atan(camera.tanY)),
      key: v.key + 1,
    }));

  return (
    <div className="pose-area">
      <Canvas camera={{ position: START.toArray(), fov: START_FOV, near: 0.01, far: 200 }}>
        <color attach="background" args={["#111"]} />
        <ApplyView view={view} />
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[display.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[display.colors, 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.03} vertexColors sizeAttenuation />
        </points>
        <Frustums cameras={display.cameras} selected={selected} onSelect={setSelected} />
        <axesHelper args={[0.5]} />
      </Canvas>

      <div className="pose-overlay">
        <div>
          {preview.images.length} cameras · {preview.pointCount.toLocaleString()} points
          {preview.positions.length / 3 < preview.pointCount && ` (${(preview.positions.length / 3).toLocaleString()} shown)`}
          {unplaced > 0 && ` · ${unplaced} photos not placed (not shown)`}
        </div>
        <div className="note">
          Upright and scaled for viewing only: COLMAP&apos;s model has no real up direction or units. Up = the
          cameras&apos; average up direction. Click a camera (orange) to see its photo.
        </div>
        <button onClick={() => setView((v) => startView(v.key + 1))}>Reset view</button>
        {selected && (
          <figure className="pose-selected">
            <img src={thumbnailUrl(projectId, selected.imageId)} alt={selected.filename} />
            <figcaption>
              <b>{selected.filename}</b> · {selected.points} matched points
              <div className="dataset-actions">
                <button onClick={() => lookThrough(selected)}>Look through this camera</button>
                <button onClick={() => setSelected(null)}>Close</button>
              </div>
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

/** Moves the orbit camera when `view.key` changes (reset, or look through a solved camera). */
function ApplyView({ view }: { view: View }) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<OrbitControlsImpl>(null);
  useEffect(() => {
    camera.position.copy(view.position);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
    }
    controls.current?.target.copy(view.target);
    controls.current?.update();
  }, [view, camera]);
  return <OrbitControls ref={controls} makeDefault enableDamping={false} />;
}

function Frustums({
  cameras,
  selected,
  onSelect,
}: {
  cameras: DisplayCamera[];
  selected: DisplayCamera | null;
  onSelect: (camera: DisplayCamera) => void;
}) {
  const lines = useMemo(() => frustumSegments(cameras, FRUSTUM_DEPTH), [cameras]);
  const lineColours = useMemo(() => {
    const colours = new Float32Array(lines.length);
    cameras.forEach((c, i) => {
      const colour = c === selected ? SELECTED_COLOUR : CAMERA_COLOUR;
      for (let v = 0; v < 16; v++) colours.set([colour.r, colour.g, colour.b], (i * 16 + v) * 3);
    });
    return colours;
  }, [cameras, lines, selected]);

  const markers = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    cameras.forEach((c, i) => markers.current?.setMatrixAt(i, matrix.makeTranslation(c.position)));
    if (markers.current) markers.current.instanceMatrix.needsUpdate = true;
  }, [cameras]);

  return (
    <>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
          <bufferAttribute attach="attributes-color" args={[lineColours, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      {/* Invisible click targets at the camera centres. */}
      <instancedMesh
        ref={markers}
        args={[undefined, undefined, cameras.length]}
        onClick={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onSelect(cameras[e.instanceId]);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <sphereGeometry args={[0.08, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </>
  );
}
