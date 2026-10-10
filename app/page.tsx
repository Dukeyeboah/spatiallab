"use client";

import { useCallback, useEffect, useState } from "react";
import { SpatialScene } from "@/components/SpatialScene";
import { Controls } from "@/components/Controls";
import { DatasetManager } from "@/components/DatasetManager";
import { loadPointCloud, type PointCloudData } from "@/lib/loadPointCloud";
import { loadPoses, type PoseData } from "@/lib/loadPoses";
import {
  API_URL,
  BUILTIN_DATASET,
  fetchDatasets,
  pickBudget,
  pointsUrl,
  posesUrl,
  type Dataset,
} from "@/lib/datasets";
import { EMPTY_CATALOG, catalogApi, type Catalog } from "@/lib/catalog";
import { defaultViewSettings, withDefaults, type ViewSettings } from "@/lib/viewSettings";

/** How often the dataset list is refreshed while a conversion is running. */
const POLL_MS = 1500;

export default function Home() {
  // Datasets: the built-in scan + whatever the local backend has.
  const [backendDatasets, setBackendDatasets] = useState<Dataset[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  // Properties and captures that organise the datasets (empty without the backend).
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(BUILTIN_DATASET.id);
  const datasets = [BUILTIN_DATASET, ...backendDatasets];
  // Falls back to the built-in scan if the selected dataset was deleted.
  const dataset = datasets.find((d) => d.id === selectedId) ?? BUILTIN_DATASET;

  // The user's preferred budget is kept across dataset switches; each dataset
  // shows the closest budget it actually has (see pickBudget).
  const [budgetKey, setBudgetKey] = useState("500k");
  const budget = pickBudget(dataset.budgets, budgetKey);
  const cloudUrl = dataset.status === "ready" && budget ? pointsUrl(dataset, budget.key) : null;
  const budgetLabel = budget?.label ?? "";

  // Loaded data is tagged with its dataset, so a scene never mixes the old
  // dataset's data with the new dataset's id while the new one loads.
  const [loaded, setLoaded] = useState<{
    datasetId: string;
    data: PointCloudData;
    /** Download + parse time and size of the budget file, shown in the panel. */
    seconds: number;
    bytes: number;
  } | null>(null);
  const [loadedPoses, setLoadedPoses] = useState<{ datasetId: string; poses: PoseData } | null>(null);
  const data = loaded?.datasetId === dataset.id ? loaded.data : null;
  const poses = loadedPoses?.datasetId === dataset.id ? loadedPoses.poses : null;

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poseError, setPoseError] = useState<string | null>(null);
  const [storedSettings, setSettings] = useState<ViewSettings>(defaultViewSettings);
  const settings = withDefaults(storedSettings);

  // Selected pose for manual playback (0-based; shown as 1-based in the panel).
  const [poseIndex, setPoseIndex] = useState(0);
  const elapsedSeconds = poses ? poses.timestamps[poseIndex] - poses.timestamps[0] : 0;

  // Increases on every Reset View click; the scene restores the initial view.
  const [viewResetRequest, setViewResetRequest] = useState(0);

  const refreshDatasets = useCallback(async () => {
    try {
      setBackendDatasets(await fetchDatasets());
      setBackendError(null);
      try {
        setCatalog(await catalogApi.fetch());
        setCatalogError(null);
      } catch {
        // An older backend (started before properties existed): datasets still work.
        setCatalogError("This backend has no properties support yet: restart it to organise datasets.");
      }
    } catch {
      setBackendError(
        `Local backend not reachable at ${API_URL}. Only the built-in dataset is available ` +
          "(start it with the instructions in docs/SPATIAL_LAB_REBUILD_GUIDE.md).",
      );
    }
  }, []);

  // Load the dataset list once, then poll while anything is converting or a
  // new budget (e.g. 5M) is being generated for an existing dataset.
  const converting = backendDatasets.some(
    (d) =>
      d.status === "queued" ||
      d.status === "converting" ||
      d.budgetJob?.status === "queued" ||
      d.budgetJob?.status === "running",
  );
  useEffect(() => {
    refreshDatasets();
    if (!converting) return;
    const timer = setInterval(refreshDatasets, POLL_MS);
    return () => clearInterval(timer);
  }, [converting, refreshDatasets]);

  // Load the point cloud whenever the dataset or budget changes.
  const datasetId = dataset.id;
  useEffect(() => {
    // Drop the previous point cloud first, so only one is in memory. Its GPU
    // buffers are disposed by <PointCloud> when its geometry changes/unmounts.
    setLoaded(null);
    setError(null);
    if (!cloudUrl) return;

    const controller = new AbortController();
    setStatus(`Loading ${budgetLabel} points…`);
    const started = performance.now();

    loadPointCloud(cloudUrl, controller.signal)
      .then((loadedData) => {
        setLoaded({
          datasetId,
          data: loadedData,
          seconds: (performance.now() - started) / 1000,
          bytes: loadedData.positions.byteLength + loadedData.colors.byteLength + 4,
        });
        setStatus(null);
      })
      .catch((err: Error) => {
        // Switching mid-download cancels the old request; that's not an error.
        if (controller.signal.aborted) return;
        // e.g. the backend stopped, or the browser couldn't allocate memory for a large budget.
        setError(`Couldn't load the ${budgetLabel} budget: ${err.message}. Try a smaller budget.`);
        setStatus(null);
      });

    return () => controller.abort();
  }, [cloudUrl, datasetId, budgetLabel]);

  // Poses: only if the dataset has poses that passed the frame checks.
  const posesSource =
    dataset.status === "ready" && dataset.poses?.status === "aligned" && dataset.offset
      ? { url: posesUrl(dataset), offset: dataset.offset }
      : null;
  const posesKey = posesSource ? `${posesSource.url}|${posesSource.offset.join(",")}` : null;
  useEffect(() => {
    setLoadedPoses(null);
    setPoseError(null);
    setPoseIndex(0);
    if (!posesKey) return;
    const [url, offsetText] = posesKey.split("|");
    const offset = offsetText.split(",").map(Number) as [number, number, number];
    const controller = new AbortController();
    loadPoses(url, offset, controller.signal)
      .then((loadedPoseData) => setLoadedPoses({ datasetId, poses: loadedPoseData }))
      .catch((err: Error) => {
        if (!controller.signal.aborted) setPoseError(err.message);
      });
    return () => controller.abort();
  }, [posesKey, datasetId]);

  // Why poses aren't shown (no file, failed checks), for the panel.
  const poseNote = !dataset.poses
    ? "No scanner poses in this dataset."
    : dataset.poses.status !== "aligned"
      ? dataset.poses.message
      : null;

  return (
    <>
      <SpatialScene
        datasetId={dataset.id}
        data={data}
        poses={poses}
        poseIndex={poseIndex}
        settings={settings}
        viewResetRequest={viewResetRequest}
      />
      <Controls
        datasetPanel={
          <DatasetManager
            datasets={datasets}
            catalog={catalog}
            onCatalogChange={setCatalog}
            catalogError={catalogError}
            selected={dataset}
            onSelect={setSelectedId}
            backendError={backendError}
            onChanged={refreshDatasets}
          />
        }
        budgets={dataset.budgets}
        budget={budget}
        onBudgetChange={setBudgetKey}
        pointCount={data?.count ?? 0}
        loadInfo={data && loaded ? `${(loaded.bytes / 1e6).toFixed(1)} MB in ${loaded.seconds.toFixed(1)} s` : null}
        poseCount={poses?.count ?? 0}
        poseError={poseError}
        poseNote={poseNote}
        poseIndex={poseIndex}
        onPoseIndexChange={setPoseIndex}
        elapsedSeconds={elapsedSeconds}
        status={dataset.status === "ready" ? status : null}
        error={error}
        settings={settings}
        onChange={setSettings}
        onResetView={() => setViewResetRequest((n) => n + 1)}
      />
    </>
  );
}
