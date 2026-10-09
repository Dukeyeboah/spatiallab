"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Perf } from "r3f-perf";
import { CameraFraming } from "./CameraFraming";
import { PointCloud } from "./PointCloud";
import { Trajectory } from "./Trajectory";
import { ScannerMarker } from "./ScannerMarker";
import type { PointCloudData } from "@/lib/loadPointCloud";
import type { PoseData } from "@/lib/loadPoses";
import type { ViewSettings } from "@/lib/viewSettings";
import { LIDAR_TO_THREE_ROTATION } from "@/lib/worldFrame";

type SpatialSceneProps = {
  /** The selected dataset's id: the camera is framed once per dataset. */
  datasetId: string;
  data: PointCloudData | null;
  poses: PoseData | null;
  /** 0-based index of the pose shown by the scanner marker. */
  poseIndex: number;
  settings: ViewSettings;
  /** Increases by one every time Reset View is clicked. */
  viewResetRequest: number;
};

export function SpatialScene({
  datasetId,
  data,
  poses,
  poseIndex,
  settings,
  viewResetRequest,
}: SpatialSceneProps) {
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
        <CameraFraming data={data} frameKey={datasetId} resetRequest={viewResetRequest} />

        {/* Grid lies on the ground plane (three.js XZ). 1 cell = 1 metre. */}
        {settings.showGrid && <gridHelper args={[100, 100, "#666", "#333"]} />}

        {/*
          Everything inside this group uses LiDAR coordinates (Z-up, metres).
          Future layers that share the scan's coordinate system go here too:
          scanner trajectory, measurements, annotations, clipping boxes, ...
        */}
        <group rotation={LIDAR_TO_THREE_ROTATION}>
          {/* Red = X, green = Y, blue = Z (up). Length 5 m. */}
          {settings.showAxes && <axesHelper args={[5]} />}

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
