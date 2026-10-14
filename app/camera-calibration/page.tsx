"use client";

import { useEffect, useMemo, useState } from "react";
import { SpatialScene } from "@/components/SpatialScene";
import { CalibrationLayers, type CalibrationViewRequest, type ProvisionalCamera } from "@/components/calibration/CalibrationLayers";
import { CalibrationPanel } from "@/components/calibration/CalibrationPanel";
import { CameraPairPanel, type PairPanelSize } from "@/components/calibration/CameraPairPanel";
import { BASEL_HOUSE_DATASET, BUILTIN_DATASETS, API_URL, pointsUrl, posesUrl, type Vec3 } from "@/lib/datasets";
import { loadPointCloud, type PointCloudData } from "@/lib/loadPointCloud";
import { loadPreview } from "@/lib/previewDataset";
import { parsePoses } from "@/lib/loadPoses";
import { defaultViewSettings, type ViewSettings } from "@/lib/viewSettings";
import { lasBoxToDataset } from "@/lib/worldFrame";
import { NEUTRAL_ORIENTATION } from "@/lib/calibration";
import { eventReference, fetchRun, fetchRuns, positionAt, sha256Hex, type Run, type RunList } from "@/lib/xgrids";

/** Built-in LiDAR datasets with poses: the run's poses.csv must be one of their files (checked by SHA-256). */
const DATASETS = BUILTIN_DATASETS.filter((d) => d.poses?.status === "aligned");
const PREFERRED_RUN = "interval-10s";
const CHANNELS = ["ch14", "ch18"];

function toDataset(p: Vec3 | null, offset: Vec3): Vec3 | null {
  return p ? [p[0] - offset[0], p[1] - offset[1], p[2] - offset[2]] : null;
}

/**
 * Lab 13R: camera calibration workspace, phase 1 (visual inspection only).
 *
 * Shows one capture event of an XGRIDS extraction run: both camera images,
 * their exact timestamps, and the scanner pose interpolated at that time as a
 * marker in the LiDAR scene. Data: the run's manifest and selected JPEGs from
 * the local backend (SPATIAL_LAB_XGRIDS_DIR, outside the repo); the LiDAR
 * preview from public/. Camera intrinsics and extrinsics are unknown; the
 * orientation sliders are provisional experiments, not calibration.
 */
export default function CameraCalibrationPage() {
  // --- LiDAR dataset -------------------------------------------------------
  const [datasetId, setDatasetId] = useState(BASEL_HOUSE_DATASET.id);
  const dataset = DATASETS.find((d) => d.id === datasetId) ?? BASEL_HOUSE_DATASET;
  const [budgetKey, setBudgetKey] = useState(dataset.budgets[0].key);
  const budget = dataset.budgets.find((b) => b.key === budgetKey) ?? dataset.budgets[0];

  const [cloud, setCloud] = useState<{ key: string; data: PointCloudData; offset: Vec3; bounds: { min: Vec3; max: Vec3 } | null } | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const cloudKey = `${dataset.id}|${budget.key}`;
  useEffect(() => {
    setCloudError(null);
    const controller = new AbortController();
    const files = dataset.preview?.files[budget.key];
    const load = files
      ? loadPreview(files.pointsUrl, files.metadataUrl, controller.signal).then(({ data, metadata }) => ({
          data,
          offset: metadata.coordinateCenter,
          bounds: metadata.sourceBounds,
        }))
      : loadPointCloud(pointsUrl(dataset, budget.key), controller.signal).then((data) => ({
          data,
          offset: dataset.offset as Vec3,
          bounds: dataset.originalBounds,
        }));
    load
      .then((loaded) => setCloud({ key: cloudKey, ...loaded }))
      .catch((err: Error) => !controller.signal.aborted && setCloudError(`Couldn't load the point cloud: ${err.message}`));
    return () => controller.abort();
    // cloudKey identifies dataset + budget.
  }, [cloudKey]);
  // Keep showing the previous budget of the same dataset while another loads (same frame).
  const cloudOfDataset = cloud && cloud.key.startsWith(`${dataset.id}|`) ? cloud : null;
  const offset = cloudOfDataset?.offset ?? null;

  // Poses: downloaded once as text, hashed (frame check) and parsed with the dataset's offset.
  const [posesText, setPosesText] = useState<{ datasetId: string; text: string; sha256: string } | null>(null);
  const [posesError, setPosesError] = useState<string | null>(null);
  useEffect(() => {
    setPosesError(null);
    const controller = new AbortController();
    fetch(posesUrl(dataset), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        setPosesText({ datasetId: dataset.id, text, sha256: await sha256Hex(text) });
      })
      .catch((err: Error) => !controller.signal.aborted && setPosesError(`Couldn't load the dataset's poses: ${err.message}`));
    return () => controller.abort();
  }, [dataset]);
  const datasetPoses = posesText?.datasetId === dataset.id ? posesText : null;
  const poses = useMemo(
    () => (datasetPoses && offset ? parsePoses(datasetPoses.text, offset) : null),
    [datasetPoses, offset],
  );

  // --- Extraction runs ----------------------------------------------------
  const [runList, setRunList] = useState<RunList | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchRuns(controller.signal)
      .then((list) => {
        setRunList(list);
        const usable = list.runs.filter((r) => !r.error);
        setRunId((usable.find((r) => r.id === PREFERRED_RUN) ?? usable[0])?.id ?? null);
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        setRunError(
          err instanceof TypeError
            ? `The local backend isn't reachable at ${API_URL}. Start it with SPATIAL_LAB_XGRIDS_DIR set (see docs/xgrids/calibration-workspace.md).`
            : `This backend has no extraction runs endpoint (${err.message}). Restart it with the current code.`,
        );
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setRun(null);
    if (!runId) return;
    const controller = new AbortController();
    fetchRun(runId, controller.signal)
      .then((loaded) => {
        setRun(loaded);
        setRunError(null);
      })
      .catch((err: Error) => !controller.signal.aborted && setRunError(`Couldn't load run ${runId}: ${err.message}`));
    return () => controller.abort();
  }, [runId]);

  const [eventIndex, setEventIndex] = useState(0);
  useEffect(() => setEventIndex(0), [runId]);
  const event = run?.events[Math.min(eventIndex, run.events.length - 1)] ?? null;

  // --- Frame check: the run's poses.csv must be this dataset's poses file --------------
  const runPosesSha = run?.source.posesSha256 ?? null;
  const frameMatches = !!(datasetPoses && runPosesSha && datasetPoses.sha256 === runPosesSha);

  // Scanner positions in dataset coordinates (LAS − offset, subtracted in float64).
  const eventPositions = useMemo(
    () => (run && frameMatches && offset ? run.events.map((e) => toDataset(eventReference(e).pose.position, offset)) : []),
    [run, frameMatches, offset],
  );
  const reference = event ? eventReference(event) : null;
  const scannerPosition = frameMatches && offset ? toDataset(reference?.pose.position ?? null, offset) : null;
  const scanner =
    scannerPosition && reference?.pose.quaternion ? { position: scannerPosition, quaternion: reference.pose.quaternion } : null;
  // Independent check: the dataset's own poses, interpolated at the same time, in the viewer's frame.
  const own = scannerPosition && poses && reference ? positionAt(poses, reference.timestampUs) : null;
  const crossCheck =
    own && scannerPosition
      ? Math.hypot(own[0] - scannerPosition[0], own[1] - scannerPosition[1], own[2] - scannerPosition[2])
      : null;

  // --- Provisional cameras + view --------------------------------------------
  const [cameras, setCameras] = useState<ProvisionalCamera[]>(() =>
    CHANNELS.map((channel) => ({ channel, orientation: NEUTRAL_ORIENTATION, visible: true })),
  );
  const [view, setView] = useState<{ request: CalibrationViewRequest; serial: number } | null>(null);
  const requestView = (request: CalibrationViewRequest) =>
    setView((previous) => ({ request, serial: (previous?.serial ?? 0) + 1 }));

  const [settings, setSettings] = useState<ViewSettings>({ ...defaultViewSettings, showMarker: false, showPoses: false });
  const [showEvents, setShowEvents] = useState(true);
  const [pairSize, setPairSize] = useState<PairPanelSize>("small");

  // Framing, as on the main page: scan area and full extent in dataset coordinates.
  const scanAreaSpec = dataset.preview?.scanArea;
  const scanArea = useMemo(
    () => (scanAreaSpec && offset ? lasBoxToDataset(scanAreaSpec.min, scanAreaSpec.max, offset) : null),
    [scanAreaSpec, offset],
  );
  const bounds = cloudOfDataset?.bounds;
  const fullExtent = useMemo(() => (bounds && offset ? lasBoxToDataset(bounds.min, bounds.max, offset) : null), [bounds, offset]);
  const helperOrigin: Vec3 = dataset.preview && offset ? [-offset[0], -offset[1], -offset[2]] : [0, 0, 0];

  return (
    <>
      <SpatialScene
        datasetId={dataset.id}
        data={cloudOfDataset?.data ?? null}
        poses={poses}
        poseIndex={0}
        settings={settings}
        scanArea={scanArea}
        fullExtent={fullExtent}
        viewRequest={null}
        helperOrigin={helperOrigin}
        lidarLayers={
          <CalibrationLayers
            eventPositions={showEvents ? eventPositions : []}
            selectedIndex={event?.index ?? -1}
            onSelect={(index) => setEventIndex(run?.events.findIndex((e) => e.index === index) ?? 0)}
            scanner={scanner}
            cameras={cameras}
            view={view}
          />
        }
      />
      <CalibrationPanel
        datasets={DATASETS}
        dataset={dataset}
        onDatasetChange={(id) => {
          setDatasetId(id);
          setBudgetKey(DATASETS.find((d) => d.id === id)?.budgets[0].key ?? "");
        }}
        budget={budget}
        onBudgetChange={setBudgetKey}
        cloudStatus={cloudError ?? posesError ?? (cloudOfDataset?.key === cloudKey ? null : `Loading ${budget.label} points…`)}
        cloudFailed={!!(cloudError || posesError)}
        settings={settings}
        onSettingsChange={setSettings}
        showEvents={showEvents}
        onShowEventsChange={setShowEvents}
        runList={runList}
        runId={runId}
        onRunChange={setRunId}
        run={run}
        runError={runError}
        eventIndex={Math.min(eventIndex, Math.max(0, (run?.events.length ?? 1) - 1))}
        onEventIndexChange={setEventIndex}
        event={event}
        frameCheck={
          !run || !datasetPoses
            ? null
            : { matches: frameMatches, runSha: runPosesSha, datasetSha: datasetPoses.sha256, datasetName: dataset.name }
        }
        offset={frameMatches ? offset : null}
        crossCheckMetres={crossCheck}
        cameras={cameras}
        onCamerasChange={setCameras}
        onRequestView={requestView}
        markerShown={!!scanner}
      />
      {run && event && <CameraPairPanel run={run} event={event} size={pairSize} onSizeChange={setPairSize} />}
    </>
  );
}
