"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { ScannerBody } from "@/components/ScannerMarker";
import type { Vec3 } from "@/lib/datasets";
import type { Quat } from "@/lib/xgrids";
import type { HelperShape } from "@/lib/directionTest";
import { provisionalAxes, provisionalRotation, type ProvisionalOrientation } from "@/lib/calibration";
import { lidarPointToWorld } from "@/lib/worldFrame";

/** Inside the building the markers would be hidden by walls: drawn on top, like the trajectory. */
const ON_TOP = { depthTest: false, depthWrite: false, transparent: true } as const;
const ON_TOP_RENDER_ORDER = 11;
const EVENT_DOT_RADIUS = 0.07;
const FOCUS_DISTANCE = 4;
const GIZMO_LENGTH = 0.6;

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
  shape: HelperShape;
  /** Labelled scanner-local X/Y/Z gizmo. */
  showAxes: boolean;
  view: { request: CalibrationViewRequest; serial: number } | null;
};

/** Lab 13R/13S layers. Must be placed inside the LiDAR (Z-up) group of SpatialScene. */
export function CalibrationLayers({
  eventPositions,
  selectedIndex,
  onSelect,
  scanner,
  cameras,
  shape,
  showAxes,
  view,
}: CalibrationLayersProps) {
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
            {showAxes && <AxisGizmo />}
            {cameras.filter((c) => c.visible).map((c) => (
              <DirectionHelper
                key={c.channel}
                channel={c.channel}
                orientation={c.orientation}
                shape={shape}
                colour={CHANNEL_COLOURS[c.channel] ?? "#fff"}
              />
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

/**
 * One channel's hypothesised viewing direction, in the scanner body frame:
 * origin dot, dashed centre ray (dashed = provisional), a translucent cone of
 * the chosen half-angle around it, an image-up tick at the tip and a label.
 * The cone only visualises "roughly this way"; it is not the lens's field of view.
 */
function DirectionHelper({
  channel,
  orientation,
  shape,
  colour,
}: {
  channel: string;
  orientation: ProvisionalOrientation;
  shape: HelperShape;
  colour: string;
}) {
  const quaternion = useMemo(() => provisionalRotation(orientation), [orientation]);
  const { coneLength: length, coneHalfAngleDeg } = shape;
  const radius = length * Math.tan(THREE.MathUtils.degToRad(coneHalfAngleDeg));
  // drei <Line> rebuilds its geometry for every new points array, so memoise them.
  const lines = useMemo(() => {
    const rim: [number, number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      rim.push([length, radius * Math.cos(a), radius * Math.sin(a)]);
    }
    return {
      ray: [[0, 0, 0], [length, 0, 0]] as [number, number, number][],
      upTick: [[length, 0, 0], [length, 0, Math.max(radius, 0.15) * 0.5]] as [number, number, number][],
      rim,
    };
  }, [length, radius]);

  return (
    <group quaternion={quaternion}>
      <mesh renderOrder={ON_TOP_RENDER_ORDER}>
        <sphereGeometry args={[0.05, 12, 8]} />
        <meshBasicMaterial color={colour} {...ON_TOP} />
      </mesh>
      <Line points={lines.ray} color={colour} lineWidth={2.5} dashed dashSize={0.1} gapSize={0.06} renderOrder={ON_TOP_RENDER_ORDER} {...ON_TOP} />
      <Line points={lines.upTick} color={colour} lineWidth={2.5} renderOrder={ON_TOP_RENDER_ORDER} {...ON_TOP} />
      <Line points={lines.rim} color={colour} lineWidth={1.5} renderOrder={ON_TOP_RENDER_ORDER} {...ON_TOP} />
      {/* ConeGeometry: tip at +Y·h/2. Rotated so the tip sits at the origin and the cone opens along +X. */}
      <mesh position={[length / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={ON_TOP_RENDER_ORDER}>
        <coneGeometry args={[radius, length, 48, 1, true]} />
        <meshBasicMaterial color={colour} opacity={0.14} side={THREE.DoubleSide} {...ON_TOP} />
      </mesh>
      <Html position={[length * 1.04, 0, 0]} center className="helper-label" style={{ borderColor: colour, color: colour }}>
        {channel}
      </Html>
    </group>
  );
}

/** The scanner's own body frame, labelled: the frame the offsets are defined in. */
function AxisGizmo() {
  const axes: { end: [number, number, number]; colour: string; label: string }[] = [
    { end: [GIZMO_LENGTH, 0, 0], colour: "#ff5050", label: "X forward" },
    { end: [0, GIZMO_LENGTH, 0], colour: "#50e050", label: "Y left" },
    { end: [0, 0, GIZMO_LENGTH], colour: "#5090ff", label: "Z up" },
  ];
  return (
    <>
      {axes.map((a) => (
        <group key={a.label}>
          <Line points={[[0, 0, 0], a.end]} color={a.colour} lineWidth={3} renderOrder={ON_TOP_RENDER_ORDER} {...ON_TOP} />
          <Html position={a.end} center className="helper-label axis" style={{ color: a.colour }}>
            {a.label}
          </Html>
        </group>
      ))}
    </>
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
