"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Perf } from "r3f-perf";
import type * as THREE from "three";
import { CameraFraming, type ViewRequest } from "./CameraFraming";
import { PointCloud } from "./PointCloud";
import { Trajectory } from "./Trajectory";
import { ScannerMarker } from "./ScannerMarker";
import type { Vec3 } from "@/lib/datasets";
import type { PointCloudData } from "@/lib/loadPointCloud";
import type { PoseData } from "@/lib/loadPoses";
import type { ViewSettings } from "@/lib/viewSettings";
import { LIDAR_TO_THREE_ROTATION, lidarPointToWorld } from "@/lib/worldFrame";

type SpatialSceneProps = {
  /** The selected dataset's id: the camera is framed once per dataset. */
  datasetId: string;
  data: PointCloudData | null;
  poses: PoseData | null;
  /** 0-based index of the pose shown by the scanner marker. */
  poseIndex: number;
  settings: ViewSettings;
  /** Dataset-coordinate boxes for the framing actions (see CameraFraming). */
  scanArea: THREE.Box3 | null;
  fullExtent: THREE.Box3 | null;
  /** Reset View / Focus on Scan Area / Frame Entire Cloud clicks. */
  viewRequest: ViewRequest | null;
  /**
   * Where the axes and grid are drawn, in dataset coordinates. [0, 0, 0] (the
   * dataset origin) except for previews, which mark the original LAS origin.
   * Display only: the points are never moved.
   */
  helperOrigin: Vec3;
};

export function SpatialScene({
  datasetId,
  data,
  poses,
  poseIndex,
  settings,
  scanArea,
  fullExtent,
  viewRequest,
  helperOrigin,
}: SpatialSceneProps) {
  const gridPosition = lidarPointToWorld(helperOrigin);
  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: [30, 30, 30], fov: 60, near: 0.1, far: 10000 }}
        // `linear` + `flat`: show the scanner's RGB bytes exactly as stored,
        // without colour-space conversion or tone mapping.
        linear
        flat
      >
        <color attach="background" args={["#1a1a1a"]} />

        {/* Performance monitor: FPS, CPU/GPU frame time, draw calls, points. */}
        <Perf position="top-right" />

        {/* makeDefault registers the controls so <CameraFraming> can set their target. */}
        <OrbitControls makeDefault />

        {/* Initial camera + OrbitControls target, and Reset View. */}
        <CameraFraming
          data={data}
          frameKey={datasetId}
          scanArea={scanArea}
          fullExtent={fullExtent}
          request={viewRequest}
        />

        {/* Grid lies on the horizontal plane (three.js XZ) through the helper origin. 1 cell = 1 metre. */}
        {settings.showGrid && (
          <gridHelper args={[100, 100, "#666", "#333"]} position={gridPosition.toArray()} />
        )}

        {/*
          Everything inside this group uses LiDAR coordinates (Z-up, metres).
          Future layers that share the scan's coordinate system go here too:
          scanner trajectory, measurements, annotations, clipping boxes, ...
        */}
        <group rotation={LIDAR_TO_THREE_ROTATION}>
          {/* Red = X, green = Y, blue = Z (up). Length 5 m. */}
          {settings.showAxes && <axesHelper args={[5]} position={helperOrigin} />}

          {data && (
            <PointCloud
              data={data}
              pointSize={settings.pointSize}
              showRgb={settings.showRgb}
              renderMode={settings.renderMode}
              shaderExperiment={settings.shaderExperiment}
              softPoints={settings.softPoints}
            />
          )}

          {/* Scanner path: same LiDAR frame and same dataset offset as the point cloud. */}
          {poses && (
            <Trajectory
              poses={poses}
              showPath={settings.showPath}
              showPoses={settings.showPoses}
            />
          )}

          {/* Recorded position + quaternion, used as-is in the shared Z-up frame. */}
          {poses && settings.showMarker && <ScannerMarker poses={poses} index={poseIndex} />}
        </group>
      </Canvas>
    </div>
  );
}
