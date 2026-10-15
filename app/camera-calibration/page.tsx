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
import { NEUTRAL_ORIENTATION, STARTING_HYPOTHESIS } from "@/lib/calibration";
import { DEFAULT_HELPER_SHAPE, type HelperShape } from "@/lib/directionTest";
import { DirectionTestSection } from "@/components/calibration/DirectionTestSection";
import { CorrespondenceSection } from "@/components/calibration/CorrespondenceSection";
import { CorrespondenceLayers } from "@/components/calibration/CorrespondenceLayers";
import { CorrespondenceViewer, type ImageMarker } from "@/components/calibration/CorrespondenceViewer";
import { CHANNEL_COLOURS } from "@/components/calibration/CalibrationLayers";
import { chosenPick, datasetToLas, useCorrespondenceLab } from "@/components/calibration/useCorrespondenceLab";
import { predict } from "@/lib/correspondences";
import { makeProjector, pixelRayDirection, projectCloud } from "@/lib/fisheyeProjection";
import type { Correspondence } from "@/lib/correspondences";
import { surfaceRangeAlongRay } from "@/lib/pointPicking";
import { eventChannels, eventReference, fetchRun, fetchRuns, positionAt, sha256Hex, type Run, type RunList } from "@/lib/xgrids";
import { CalibrationOptimizationSection } from "@/components/calibration/CalibrationOptimizationSection";
import { useCalibrationOptimization } from "@/components/calibration/useCalibrationOptimization";
import { predictWith, setLabel } from "@/lib/calibrationExperiment";

type WorkspaceMode = "direction" | "correspondences" | "optimization";

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
 * preview from public/. Camera intrinsics and extrinsics are unknown.
 * Lab 13S adds a manual visual extrinsics hypothesis test: per-channel
 * offsets relative to the scanner (default ch14 −90°, ch18 +90° yaw), drawn
 * as direction helpers. That is not calibration.
 * Lab 13U adds a second mode: collecting image ↔ LiDAR correspondences
 * (pixel in a fisheye image + LAS point), with a provisional projection
 * (assumed intrinsics) for diagnostics.
 * Lab 13V adds a third mode: an experimental calibration of the rotations
 * and one focal parameter from those correspondences (local backend, SciPy),
 * shown in the image viewer only; presets and offsets are never changed.
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
    CHANNELS.map((channel) => ({ channel, orientation: STARTING_HYPOTHESIS[channel] ?? NEUTRAL_ORIENTATION, visible: true })),
  );
  const [helperShape, setHelperShape] = useState<HelperShape>(DEFAULT_HELPER_SHAPE);
  const [showAxes, setShowAxes] = useState(true);
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

  // --- Lab 13U: image ↔ LiDAR correspondences ---------------------------------
  const [mode, setMode] = useState<WorkspaceMode>("direction");
  const lab = useCorrespondenceLab();
  const [viewerSize, setViewerSize] = useState<"large" | "small">("large");
  const correspondenceMode = mode === "correspondences" && !!run && !!event;
  const picking = correspondenceMode && lab.pickArmed && frameMatches;
  const labChannel = event && !eventChannels(event).includes(lab.channel) ? eventChannels(event)[0] : lab.channel;
  const labImage = event?.images[labChannel] ?? null;
  const labOrientation = cameras.find((c) => c.channel === labChannel)?.orientation ?? null;

  // --- Lab 13V: calibration optimization (display only) ------------------------
  const opt = useCalibrationOptimization();
  const optimizationMode = mode === "optimization" && !!run && !!event;
  const optCamera = opt.cameras?.[labChannel] ?? null;

  // LAS ↔ the current cloud's dataset coordinates (picks may come from another budget of the same dataset).
  const pending = lab.pendingPick?.datasetId === dataset.id ? lab.pendingPick : null;
  const toView = (las: Vec3) => (offset ? toDataset(las, offset)! : null);
  const pendingMarker =
    pending && offset
      ? {
          nearest: toView(datasetToLas(pending.result.nearest.position, pending.offset))!,
          refined: pending.result.plane.ok ? toView(datasetToLas(pending.result.plane.position, pending.offset)) : null,
          chosen: toView(datasetToLas(chosenPick(pending.result, lab.preferRefined).position, pending.offset))!,
        }
      : null;
  const savedMarkers =
    offset && frameMatches
      ? lab.records.flatMap((r, i) =>
          r.datasetId === dataset.id && r.posesSha256 === datasetPoses?.sha256
            ? [{ id: r.id, label: `#${i + 1}`, position: toView(r.lidar.las)!, active: r.sequence === event?.sequence && r.runId === run?.id }]
            : [],
        )
      : [];
  const offsets = useMemo(() => Object.fromEntries(cameras.map((c) => [c.channel, c.orientation])), [cameras]);
  const imageMarkers: ImageMarker[] = optimizationMode
    ? (opt.source?.records ?? []).flatMap((r, i) => {
        if (r.runId !== run?.id || r.imageFile !== labImage?.file) return [];
        const p = opt.experiment ? predictWith(r, optCamera ?? undefined) : null;
        const used = !opt.experiment || opt.experiment.cameras[r.channel]?.records.includes(r.id);
        return [{ id: r.id, label: `#${i + 1}`, u: r.pixel.u, v: r.pixel.v, predicted: p?.valid ? { u: p.u, v: p.v } : null, active: !!used }];
      })
    : lab.records.flatMap((r, i) => {
        if (r.runId !== run?.id || r.imageFile !== labImage?.file) return [];
        const p = lab.showPredictions ? predict(r, offsets, lab.model) : null;
        return [{ id: r.id, label: `#${i + 1}`, u: r.pixel.u, v: r.pixel.v, predicted: p?.valid ? { u: p.u, v: p.v } : null, active: true }];
      });
  const overlayCamera = correspondenceMode
    ? lab.showOverlay && labOrientation
      ? { orientation: labOrientation, model: lab.model }
      : null
    : optimizationMode && opt.showOverlay && optCamera
      ? optCamera
      : null;
  const overlay = useMemo(() => {
    const pose = labImage?.pose;
    if (!overlayCamera || !cloudOfDataset || !frameMatches || !pose?.position || !pose.quaternion) return null;
    const projector = makeProjector(pose.position, pose.quaternion, overlayCamera.orientation, overlayCamera.model);
    return projectCloud(cloudOfDataset.data.positions, cloudOfDataset.data.count, cloudOfDataset.offset, projector);
    // overlayCamera is rebuilt every render; its contents are the real dependencies.
  }, [overlayCamera?.orientation, overlayCamera?.model, cloudOfDataset, frameMatches, labImage]);

  // Navigation aids (3D camera moves only; nothing is stored).
  const lookAlongPixel = () => {
    const pixel = lab.pendingPixel;
    const pose = labImage?.pose;
    if (!pixel || pixel.imageFile !== labImage?.file || !pose?.position || !pose.quaternion || !labOrientation || !offset || !frameMatches) return;
    const direction = pixelRayDirection(pixel.u, pixel.v, pose.quaternion, labOrientation, lab.model).toArray() as Vec3;
    const origin = toDataset(pose.position, offset)!;
    // Orbit target at the scan surface along the ray, so zooming approaches the feature.
    const range = cloudOfDataset ? surfaceRangeAlongRay(cloudOfDataset.data.positions, cloudOfDataset.data.count, origin, direction) : null;
    requestView({ kind: "ray", origin, direction, distance: range ?? 3 });
  };
  const viewRecord = (r: Correspondence) => {
    if (!offset || !frameMatches || r.datasetId !== dataset.id) return;
    const p = r.scannerPose.position;
    const d: Vec3 = [r.lidar.las[0] - p[0], r.lidar.las[1] - p[1], r.lidar.las[2] - p[2]];
    requestView({ kind: "ray", origin: toDataset(p, offset)!, direction: d, distance: Math.hypot(...d) });
  };

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
          <>
            <CalibrationLayers
              // While picking, a click must reach the point cloud, not select an event.
              eventPositions={showEvents && !picking ? eventPositions : []}
              selectedIndex={event?.index ?? -1}
              onSelect={(index) => setEventIndex(run?.events.findIndex((e) => e.index === index) ?? 0)}
              scanner={scanner}
              // The direction-test helpers would clutter picking; "Look along" still uses the orientations.
              cameras={correspondenceMode ? cameras.map((c) => ({ ...c, visible: false })) : cameras}
              shape={helperShape}
              showAxes={showAxes && !correspondenceMode}
              view={view}
            />
            {correspondenceMode && (
              <CorrespondenceLayers
                cloud={cloudOfDataset?.data ?? null}
                armed={picking}
                options={lab.pickOptions}
                onPick={(result) =>
                  cloudOfDataset &&
                  // The displayed cloud's budget: during a budget switch the previous one is still shown.
                  lab.setPendingPick({ datasetId: dataset.id, budget: cloudOfDataset.key.split("|")[1], offset: cloudOfDataset.offset, result })
                }
                pending={pendingMarker}
                saved={savedMarkers}
              />
            )}
          </>
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
      >
        {run && event && (
          <div className="section">
            <b className="sub">Workspace mode</b>
            <div className="segmented">
              <button className={mode === "direction" ? "selected" : ""} onClick={() => (setMode("direction"), lab.setPickArmed(false))}>
                Direction hypothesis
              </button>
              <button className={mode === "correspondences" ? "selected" : ""} onClick={() => setMode("correspondences")}>
                Image ↔ LiDAR correspondences
              </button>
              <button className={mode === "optimization" ? "selected" : ""} onClick={() => (setMode("optimization"), lab.setPickArmed(false))}>
                Calibration optimization
              </button>
            </div>
          </div>
        )}
        {run && event && mode === "direction" && (
          <DirectionTestSection
            run={run}
            event={event}
            onEventIndexChange={setEventIndex}
            cameras={cameras}
            onCamerasChange={setCameras}
            shape={helperShape}
            onShapeChange={setHelperShape}
            showAxes={showAxes}
            onShowAxesChange={setShowAxes}
          />
        )}
        {run && event && mode === "correspondences" && (
          <CorrespondenceSection
            lab={lab}
            run={run}
            event={event}
            onEventIndexChange={setEventIndex}
            dataset={{ id: dataset.id, name: dataset.name }}
            posesSha256={frameMatches ? (datasetPoses?.sha256 ?? null) : null}
            frameMatches={frameMatches}
            budgetKey={budget.key}
            cameras={cameras}
            onCamerasChange={setCameras}
            onLookAlongPixel={lookAlongPixel}
            onViewRecord={viewRecord}
          />
        )}
        {run && event && mode === "optimization" && (
          <CalibrationOptimizationSection
            opt={opt}
            run={run}
            onEventIndexChange={setEventIndex}
            onChannelChange={lab.setChannel}
            onViewRecord={viewRecord}
            dataset={{ id: dataset.id, name: dataset.name }}
            posesSha256={frameMatches ? (datasetPoses?.sha256 ?? null) : null}
            browserRecords={lab.records}
            model={lab.model}
            offsets={offsets}
          />
        )}
      </CalibrationPanel>
      {run && event && mode === "direction" && <CameraPairPanel run={run} event={event} size={pairSize} onSizeChange={setPairSize} />}
      {(correspondenceMode || optimizationMode) && run && event && labImage?.file && (
        <CorrespondenceViewer
          key={`${run.id}/${labImage.file}`}
          runId={run.id}
          event={event}
          channel={labChannel}
          image={labImage}
          markers={imageMarkers}
          pending={
            correspondenceMode && lab.pendingPixel?.runId === run.id && lab.pendingPixel.imageFile === labImage.file ? lab.pendingPixel : null
          }
          onPick={correspondenceMode ? (u, v) => lab.setPendingPixel({ runId: run.id, imageFile: labImage.file!, u, v }) : undefined}
          overlay={overlay}
          model={optimizationMode ? (optCamera?.model ?? null) : lab.showOverlay || lab.showPredictions ? lab.model : null}
          size={viewerSize}
          header={
            <>
              <div className="segmented">
                {eventChannels(event).map((c) => (
                  <button key={c} className={c === labChannel ? "selected" : ""} onClick={() => lab.setChannel(c)}>
                    <span className="swatch" style={{ background: CHANNEL_COLOURS[c] }} /> {c}
                  </button>
                ))}
              </div>
              <span>
                Sequence {event.sequence} · {labImage.timestampUtc.slice(11)} UTC · {labImage.file} · fisheye as recorded ·{" "}
                {optimizationMode
                  ? opt.experiment
                    ? `○ measured, × projected with ${setLabel(opt.displaySet)} (experiment ${opt.experiment.experimentId}) · wheel = zoom, drag = pan`
                    : "○ measured pixels of the loaded correspondences · wheel = zoom, drag = pan"
                  : "click = pick, wheel = zoom, drag = pan"}
              </span>
              <div className="segmented">
                {(["large", "small"] as const).map((s) => (
                  <button key={s} className={s === viewerSize ? "selected" : ""} onClick={() => setViewerSize(s)}>
                    {s === "large" ? "Large" : "Small"}
                  </button>
                ))}
              </div>
            </>
          }
        />
      )}
    </>
  );
}
