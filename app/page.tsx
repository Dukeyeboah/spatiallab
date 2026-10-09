"use client";

import { useEffect, useState } from "react";
import { SpatialScene } from "@/components/SpatialScene";
import { Controls } from "@/components/Controls";
import { loadPointCloud, type PointCloudData } from "@/lib/loadPointCloud";
import { loadPoses, type PoseData } from "@/lib/loadPoses";
import { POINT_BUDGETS, type PointBudget } from "@/lib/pointBudgets";
import { defaultViewSettings, withDefaults, type ViewSettings } from "@/lib/viewSettings";

const POSES_URL = "/data/poses.csv";

export default function Home() {
  const [poses, setPoses] = useState<PoseData | null>(null);
  const [poseError, setPoseError] = useState<string | null>(null);
  const [budget, setBudget] = useState<PointBudget>(POINT_BUDGETS[0]);
  const [data, setData] = useState<PointCloudData | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storedSettings, setSettings] = useState<ViewSettings>(defaultViewSettings);
  const settings = withDefaults(storedSettings);

  // Selected pose for manual playback (0-based; shown as 1-based in the panel).
  const [poseIndex, setPoseIndex] = useState(0);
  const elapsedSeconds = poses ? poses.timestamps[poseIndex] - poses.timestamps[0] : 0;

  // Increases on every Reset View click; the scene restores the initial view.
  const [viewResetRequest, setViewResetRequest] = useState(0);

  // Load the selected dataset whenever the budget changes.
  useEffect(() => {
    const controller = new AbortController();

    // Drop the previous point cloud first, so only one dataset is in memory.
    setData(null);
    setError(null);
    setStatus(`Loading ${budget.label}…`);

    loadPointCloud(budget.url, controller.signal)
      .then((loaded) => {
        setData(loaded);
        setStatus(null);
      })
      .catch((err: Error) => {
        // Switching budgets mid-download cancels the old request; that's not an error.
        if (controller.signal.aborted) return;
        setError(err.message);
        setStatus(null);
      });

    return () => controller.abort();
  }, [budget]);

  // Poses are small and independent of the point budget: load them once.
  useEffect(() => {
    loadPoses(POSES_URL)
      .then(setPoses)
      .catch((err: Error) => setPoseError(err.message));
  }, []);

  return (
    <>
      <SpatialScene
        data={data}
        poses={poses}
        poseIndex={poseIndex}
        settings={settings}
        viewResetRequest={viewResetRequest}
      />
      <Controls
        budget={budget}
        onBudgetChange={setBudget}
        pointCount={data?.count ?? 0}
        poseCount={poses?.count ?? 0}
        poseError={poseError}
        poseIndex={poseIndex}
        onPoseIndexChange={setPoseIndex}
        elapsedSeconds={elapsedSeconds}
        status={status}
        error={error}
        settings={settings}
        onChange={setSettings}
        onResetView={() => setViewResetRequest((n) => n + 1)}
      />
    </>
  );
}
