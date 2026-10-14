"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { ScannerBody } from "@/components/ScannerMarker";
import type { Vec3 } from "@/lib/datasets";
import type { Quat } from "@/lib/xgrids";
import { provisionalAxes, provisionalRotation, type ProvisionalOrientation } from "@/lib/calibration";
import { lidarPointToWorld } from "@/lib/worldFrame";

/** Inside the building the markers would be hidden by walls: drawn on top, like the trajectory. */
const ON_TOP = { depthTest: false, depthWrite: false, transparent: true } as const;
const ON_TOP_RENDER_ORDER = 11;
const EVENT_DOT_RADIUS = 0.07;
const ARROW_LENGTH = 1.2;
const FOCUS_DISTANCE = 4;
// Module constants: drei <Line> rebuilds its geometry whenever `points` is a new array.
const ARROW_SHAFT: [number, number, number][] = [[0, 0, 0], [ARROW_LENGTH, 0, 0]];
const ARROW_UP_TICK: [number, number, number][] = [[ARROW_LENGTH, 0, 0], [ARROW_LENGTH, 0, 0.2]];

export const CHANNEL_COLOURS: Record<string, string> = { ch14: "#ff9f40", ch18: "#d070ff" };

export type ProvisionalCamera = { channel: string; orientation: ProvisionalOrientation; visible: boolean };

/** "marker": orbit around the scanner position; "look": stand there and look along a provisional camera direction. */
export type CalibrationViewRequest = { kind: "marker" } | { kind: "look"; channel: string };

type CalibrationLayersProps = {
  /** Scanner position of every event in the run, dataset coordinates (null = no pose). */
  eventPositions: (Vec3 | null)[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** The selected event's scanner pose: dataset coordinates + (x, y, z, w). Null hides the marker. */
  scanner: { position: Vec3; quaternion: Quat } | null;
  cameras: ProvisionalCamera[];
  view: { request: CalibrationViewRequest; serial: number } | null;
};

/** Lab 13R layers. Must be placed inside the LiDAR (Z-up) group of SpatialScene. */
export function CalibrationLayers({ eventPositions, selectedIndex, onSelect, scanner, cameras, view }: CalibrationLayersProps) {
  return (
    <>
      <EventDots positions={eventPositions} selectedIndex={selectedIndex} onSelect={onSelect} />
      {scanner && (
        <>
          {/* Halo so the selected position is found through walls. */}
          <mesh position={scanner.position} renderOrder={ON_TOP_RENDER_ORDER}>
            <sphereGeometry args={[0.18, 16, 12]} />
            <meshBasicMaterial color="#ffffff" opacity={0.35} {...ON_TOP} />
          </mesh>
          <ScannerBody position={scanner.position} quaternion={scanner.quaternion}>
            {cameras.filter((c) => c.visible).map((c) => (
              <ProvisionalArrow key={c.channel} orientation={c.orientation} colour={CHANNEL_COLOURS[c.channel] ?? "#fff"} />
            ))}
          </ScannerBody>
        </>
      )}
      <ApplyCalibrationView scanner={scanner} cameras={cameras} view={view} />
    </>
  );
}

function EventDots({
  positions,
  selectedIndex,
  onSelect,
}: {
  positions: (Vec3 | null)[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const placed = useMemo(
    () => positions.flatMap((p, index) => (p ? [{ index, position: p }] : [])),
    [positions],
  );
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    placed.forEach(({ index, position }, i) => {
      mesh.current?.setMatrixAt(i, matrix.makeTranslation(...position));
      mesh.current?.setColorAt(i, colour.set(index === selectedIndex ? "#ffffff" : "#8a9bb0"));
    });
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true;
      if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    }
  }, [placed, selectedIndex]);

  if (placed.length === 0) return null;
  return (
    <instancedMesh
      key={placed.length}
      ref={mesh}
      args={[undefined, undefined, placed.length]}
      renderOrder={ON_TOP_RENDER_ORDER}
      onClick={(e) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onSelect(placed[e.instanceId].index);
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <sphereGeometry args={[EVENT_DOT_RADIUS, 10, 8]} />
      <meshBasicMaterial opacity={0.85} {...ON_TOP} />
    </instancedMesh>
  );
}

/** Dashed = provisional: a guessed viewing direction (+X) with an image-up tick (+Z) at its tip. */
function ProvisionalArrow({ orientation, colour }: { orientation: ProvisionalOrientation; colour: string }) {
  const quaternion = useMemo(() => provisionalRotation(orientation), [orientation]);
  return (
    <group quaternion={quaternion}>
      <Line
        points={ARROW_SHAFT}
        color={colour}
        lineWidth={2}
        dashed
        dashSize={0.08}
        gapSize={0.05}
        renderOrder={ON_TOP_RENDER_ORDER}
        {...ON_TOP}
      />
      <Line
        points={ARROW_UP_TICK}
        color={colour}
        lineWidth={2}
        renderOrder={ON_TOP_RENDER_ORDER}
        {...ON_TOP}
      />
      <mesh position={[ARROW_LENGTH, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={ON_TOP_RENDER_ORDER}>
        <coneGeometry args={[0.04, 0.12, 12]} />
        <meshBasicMaterial color={colour} {...ON_TOP} />
      </mesh>
    </group>
  );
}

type OrbitControlsLike = { target: THREE.Vector3; enableDamping: boolean; update: () => void };

/** Moves the orbit camera on a view request. Renders nothing. */
function ApplyCalibrationView({
  scanner,
  cameras,
  view,
}: Pick<CalibrationLayersProps, "scanner" | "cameras" | "view">) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;
  const serial = view?.serial ?? 0;

  useEffect(() => {
    if (!view || !scanner || !controls) return;
    const at = lidarPointToWorld(scanner.position);
    let position: THREE.Vector3;
    let target: THREE.Vector3;
    if (view.request.kind === "marker") {
      // Keep the current viewing direction, at a fixed distance from the scanner.
      const direction = camera.getWorldDirection(new THREE.Vector3());
      position = at.clone().addScaledVector(direction, -FOCUS_DISTANCE);
      target = at;
    } else {
      const channel = view.request.channel;
      const orientation = cameras.find((c) => c.channel === channel)?.orientation;
      if (!orientation) return;
      const { forward } = provisionalAxes(scanner.quaternion, orientation);
      // forward is a LiDAR-frame direction; the LiDAR → world rotation has no translation.
      const worldForward = lidarPointToWorld(forward.toArray() as Vec3).normalize();
      position = at;
      target = at.clone().add(worldForward);
    }
    // Flush damping momentum first (see CameraFraming.applyView).
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
    controls.enableDamping = damping;
    // Only a new request moves the camera, not a new event or slider value.
  }, [serial]);

  return null;
}
