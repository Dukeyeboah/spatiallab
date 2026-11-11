"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckpointIcon } from "@/components/labs/experiences/CheckpointIcon";
import { FloorMapPanel, worldToUv } from "@/components/labs/experiences/FloorMapPanel";
import { FloorPlanAlignEditor } from "@/components/labs/experiences/FloorPlanAlignEditor";
import {
  ExperienceTourHost,
  type CameraPoseSample,
  type TourHostHandle,
  type TourHostStats,
  type TourNavMode,
} from "@/components/labs/experiences/ExperienceTourHost";
import { HousePointsLoader } from "@/components/labs/experiences/HousePointsLoader";
import {
  createPlacementFromHit,
  StagingEditor,
} from "@/components/labs/experiences/StagingEditor";
import { ExpDevSection } from "@/components/labs/experiences/ExpDevSection";
import {
  SurfaceEditor,
  type SurfaceEditorMode,
} from "@/components/labs/experiences/SurfaceEditor";
import { WalkOnScreenControls } from "@/components/labs/experiences/WalkOnScreenControls";
import { DEFAULT_EXPERIENCE_ID, EXPERIENCE_CATALOG, propertyById } from "@/lib/labs/experiences/catalog";
import {
  listStagingPlacements,
  saveStagingPlacement,
} from "@/lib/labs/experiences/stagingStorage";
import {
  BUILTIN_CHAIR_ASSET,
  type StagingAssetRef,
  type StagingPlacement,
  type StagingTransformMode,
  type Vec3 as StagingVec3,
} from "@/lib/labs/experiences/stagingTypes";
import type { SurfaceDepthDiag, SurfaceRenderPreset } from "@/lib/labs/experiences/surfaceOcclusion";
import { listSurfaceOverlays, saveSurfaceOverlay } from "@/lib/labs/experiences/surfaceStorage";
import type {
  SurfaceOverlay,
  SurfacePickMeta,
  Vec3 as SurfaceVec3,
} from "@/lib/labs/experiences/surfaceTypes";
import {
  CHECKPOINT_ICONS,
  DEFAULT_CHECKPOINT_ICON,
  type CheckpointIconId,
} from "@/lib/labs/experiences/checkpointIcons";
import type { MapPolyline } from "@/lib/labs/experiences/collisionMapOutline";
import {
  ensureSampleFloorPlan,
  getDefaultFloorPlan,
  getFloorPlanImageUrl,
} from "@/lib/labs/experiences/floorPlanStorage";
import type { FloorPlanRecord, FloorPlanRoom } from "@/lib/labs/experiences/floorPlanTypes";
import { QualityLever } from "@/components/labs/experiences/QualityLever";
import {
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESETS,
  loadQualityPresetId,
  resolveExperienceDataPath,
  saveQualityPresetId,
  type QualityPresetId,
} from "@/lib/labs/experiences/qualityPresets";
import {
  loadOverrides,
  mergeContent,
  removeOverrideViewpoint,
  replaceViewpointsOrder,
  saveViewpoint,
  type ExperienceOverrides,
} from "@/lib/labs/experiences/storage";
import type { CheckpointTransitionMode, ExperienceViewpoint } from "@/lib/labs/experiences/types";
import { LCC_SDK_VERSION_LABEL } from "@/lib/labs/lccSdk";

const HELP_KEY = "spatial-lab.experiences.help-seen.v1";
const PANEL_KEY = "spatial-lab.experiences.panel-open.v1";
const TRANSITION_KEY = "spatial-lab.experiences.transition.v1";
const EMPTY_OVERRIDES: ExperienceOverrides = { viewpoints: [], hotspots: [] };

/**
 * Spatial Lab Experiences tour (EXP-02 + EXP-03B floor-plan alignment).
 */
export default function SpatialExperiencesPage() {
  const [propertyId, setPropertyId] = useState(DEFAULT_EXPERIENCE_ID);
  const property = propertyById(propertyId) ?? EXPERIENCE_CATALOG.properties[0];

  const [overrides, setOverrides] = useState<ExperienceOverrides>(EMPTY_OVERRIDES);
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    setOverrides(loadOverrides(property.id));
    setStorageReady(true);
  }, [property.id]);

  const content = useMemo(() => mergeContent(property, overrides), [property, overrides]);
  const hostRef = useRef<TourHostHandle | null>(null);
  const walkApi = useMemo(
    () => ({
      setVirtualMove: (x: number, z: number) => hostRef.current?.setVirtualMove(x, z),
      setVirtualLook: (yawDir: number, pitchDir: number) => hostRef.current?.setVirtualLook(yawDir, pitchDir),
      clearVirtualInput: () => hostRef.current?.clearVirtualInput(),
    }),
    [],
  );

  const [navMode, setNavMode] = useState<TourNavMode>("first-person");
  const [qualityId, setQualityId] = useState<QualityPresetId>(DEFAULT_QUALITY_PRESET);
  const quality = QUALITY_PRESETS[qualityId];
  const setQuality = useCallback((id: QualityPresetId) => {
    setQualityId(id);
    saveQualityPresetId(id);
  }, []);
  useEffect(() => {
    setQualityId(loadQualityPresetId());
  }, []);
  const tourDataPath = useMemo(
    () => resolveExperienceDataPath(property.dataPath),
    [property.dataPath],
  );
  const [collisionOn, setCollisionOn] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [flyTo, setFlyTo] = useState<{
    viewpoint: ExperienceViewpoint;
    token: number;
    transition: CheckpointTransitionMode;
  } | null>(null);
  const [activeVpId, setActiveVpId] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [sampleToken, setSampleToken] = useState(0);
  const [pendingSample, setPendingSample] = useState<CameraPoseSample | null>(null);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [vpName, setVpName] = useState("");
  const [vpRoom, setVpRoom] = useState("");
  const [vpDesc, setVpDesc] = useState("");
  const [vpIcon, setVpIcon] = useState<CheckpointIconId>(DEFAULT_CHECKPOINT_ICON);
  const [editingVpId, setEditingVpId] = useState<string | null>(null);
  const [dragVpId, setDragVpId] = useState<string | null>(null);
  const [stats, setStats] = useState<TourHostStats | null>(null);
  const [pose, setPose] = useState<CameraPoseSample | null>(null);
  const [fade, setFade] = useState(false);
  const [loadLog, setLoadLog] = useState<string[]>([]);
  const [padsOpen, setPadsOpen] = useState(true);
  const [mapOutlines, setMapOutlines] = useState<MapPolyline[]>([]);
  const [transitionMode, setTransitionMode] = useState<CheckpointTransitionMode>("smooth");
  const [activePlan, setActivePlan] = useState<FloorPlanRecord | null>(null);
  const [planImageUrl, setPlanImageUrl] = useState<string | null>(null);
  const [planTick, setPlanTick] = useState(0);
  const [stagingPlacements, setStagingPlacements] = useState<StagingPlacement[]>([]);
  const [stagingSelectedId, setStagingSelectedId] = useState<string | null>(null);
  const [stagingPlaceMode, setStagingPlaceMode] = useState(false);
  const [stagingTransformMode, setStagingTransformMode] = useState<StagingTransformMode>("translate");
  const [stagedVisible, setStagedVisible] = useState(true);
  const [stagingProxyDebug, setStagingProxyDebug] = useState(false);
  const [stagingDraftAsset, setStagingDraftAsset] = useState<StagingAssetRef>(BUILTIN_CHAIR_ASSET);
  const [stagingDraftName, setStagingDraftName] = useState("Chair");
  const [stagingDims, setStagingDims] = useState<{
    size: StagingVec3;
    position: StagingVec3;
    rotation: StagingVec3;
    scale: StagingVec3;
  } | null>(null);
  const [surfaceOverlays, setSurfaceOverlays] = useState<SurfaceOverlay[]>([]);
  const [surfaceSelectedId, setSurfaceSelectedId] = useState<string | null>(null);
  const [surfacesVisible, setSurfacesVisible] = useState(true);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceEditorMode>("idle");
  const [surfaceLastPick, setSurfaceLastPick] = useState<SurfacePickMeta | null>(null);
  const [surfaceCornerHits, setSurfaceCornerHits] = useState<{ point: SurfaceVec3; normal: SurfaceVec3 }[]>([]);
  const [surfaceRenderPreset, setSurfaceRenderPreset] = useState<SurfaceRenderPreset>("opaque");
  const [surfaceDragEnabled, setSurfaceDragEnabled] = useState(false);
  const [surfaceClipTest, setSurfaceClipTest] = useState(false);
  const [surfaceSemanticProbe, setSurfaceSemanticProbe] = useState(false);
  const [surfaceCollisionDepthProxy, setSurfaceCollisionDepthProxy] = useState(false);
  const [surfaceDepthDiag, setSurfaceDepthDiag] = useState<SurfaceDepthDiag | null>(null);
  const [surfaceLabNote, setSurfaceLabNote] = useState<string | null>(null);
  const phaseGateRef = useRef({ id: "", phase: "" });

  useEffect(() => {
    try {
      if (window.localStorage.getItem(PANEL_KEY) === "0") setPanelOpen(false);
      const t = window.localStorage.getItem(TRANSITION_KEY);
      if (t === "fade" || t === "smooth") setTransitionMode(t);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setNavMode(property.nav.defaultMode);
    setCollisionOn(property.nav.collision !== false);
    setFlyTo(null);
    setActiveVpId(null);
    setPendingSample(null);
    setMapOpen(false);
    setMapOutlines([]);
    setResetToken(0);
    setStagingSelectedId(null);
    setStagingPlaceMode(false);
    setStagingPlacements(listStagingPlacements(property.id));
    setStagingDraftAsset(BUILTIN_CHAIR_ASSET);
    setStagingDraftName("Chair");
    setSurfaceSelectedId(null);
    setSurfaceMode("idle");
    setSurfaceLastPick(null);
    setSurfaceCornerHits([]);
    setSurfaceOverlays(listSurfaceOverlays(property.id));
    setSurfaceClipTest(false);
    setSurfaceSemanticProbe(false);
    setSurfaceCollisionDepthProxy(false);
    setSurfaceDepthDiag(null);
    setSurfaceLabNote(null);
    const floor0 = property.floors[0];
    if (floor0) {
      ensureSampleFloorPlan(property.id, floor0.id, property.dataPath);
      setPlanTick((n) => n + 1);
    }
  }, [property.id, property.nav.defaultMode, property.nav.collision, property.floors, property.dataPath]);

  const refreshStaging = useCallback(() => {
    setStagingPlacements(listStagingPlacements(property.id));
  }, [property.id]);

  const refreshSurfaces = useCallback(() => {
    setSurfaceOverlays(listSurfaceOverlays(property.id));
  }, [property.id]);

  useEffect(() => {
    const plan = getDefaultFloorPlan(property.id);
    setActivePlan(plan);
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      if (!plan) {
        setPlanImageUrl(null);
        return;
      }
      const url = await getFloorPlanImageUrl(plan.imageAssetId, plan.publicUrl);
      if (cancelled) {
        if (url && !plan.publicUrl) URL.revokeObjectURL(url);
        return;
      }
      if (url && !plan.publicUrl) revoked = url;
      setPlanImageUrl(url);
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [property.id, planTick]);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(HELP_KEY)) setHelpOpen(true);
    } catch {
      setHelpOpen(true);
    }
  }, []);

  const dismissHelp = () => {
    setHelpOpen(false);
    try {
      window.localStorage.setItem(HELP_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const setPanel = (open: boolean) => {
    setPanelOpen(open);
    try {
      window.localStorage.setItem(PANEL_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const setTransition = (mode: CheckpointTransitionMode) => {
    setTransitionMode(mode);
    try {
      window.localStorage.setItem(TRANSITION_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  const onStats = useCallback(
    (s: TourHostStats) => {
      setStats(s);
      if (s.phase !== "ready" && s.phase !== "error") return;
      const gate = phaseGateRef.current;
      if (gate.id === property.id && gate.phase === s.phase) return;
      phaseGateRef.current = { id: property.id, phase: s.phase };
      const line = `${property.id}: ${s.phase}${s.error ? ` — ${s.error}` : s.metaSummary ? ` — ${s.metaSummary}` : ""} · ${s.fps || "?"} fps · collision ${s.hasCollision ? "yes" : "no"}`;
      setLoadLog((prev) => [line, ...prev].slice(0, 6));
    },
    [property.id],
  );

  const goViewpoint = (vp: ExperienceViewpoint) => {
    setActiveVpId(vp.id);
    setFlyTo({ viewpoint: vp, token: Date.now(), transition: transitionMode });
  };

  const capturePose = () => {
    setSampleToken((n) => n + 1);
    setCaptureFlash(true);
    window.setTimeout(() => setCaptureFlash(false), 900);
  };

  const beginEditViewpoint = (vp: ExperienceViewpoint) => {
    setDevOpen(true);
    setEditingVpId(vp.id);
    setVpName(vp.name);
    setVpRoom(vp.roomId ?? "");
    setVpDesc(vp.description ?? "");
    setVpIcon((vp.icon as CheckpointIconId) || DEFAULT_CHECKPOINT_ICON);
    setPendingSample(null);
    goViewpoint(vp);
  };

  const cancelEditViewpoint = () => {
    setEditingVpId(null);
    setVpName("");
    setVpRoom("");
    setVpDesc("");
    setVpIcon(DEFAULT_CHECKPOINT_ICON);
    setPendingSample(null);
  };

  const deleteViewpoint = (id: string) => {
    removeOverrideViewpoint(property.id, id);
    setOverrides(loadOverrides(property.id));
    if (editingVpId === id) cancelEditViewpoint();
    if (activeVpId === id) setActiveVpId(null);
  };

  const recordViewpoint = () => {
    if (!vpName.trim()) return;
    const existing = editingVpId ? content.viewpoints.find((v) => v.id === editingVpId) : null;
    if (!pendingSample && !existing) return;
    const floor0 = property.floors[0];
    const position = pendingSample?.position ?? existing!.position;
    const target = pendingSample?.target ?? existing!.target;
    const yaw = pendingSample?.yaw ?? existing!.yaw;
    const pitch = pendingSample?.pitch ?? existing!.pitch;
    const mapUv = floor0 ? worldToUv(position[0], position[2], floor0.worldBounds) : existing?.mapUv;
    const vp: ExperienceViewpoint = {
      id: editingVpId ?? `vp_custom_${Date.now().toString(36)}`,
      name: vpName.trim(),
      roomId: vpRoom.trim() || vpName.trim(),
      order: existing?.order ?? content.viewpoints.length,
      sceneId: property.id,
      position,
      target,
      yaw,
      pitch,
      description: vpDesc.trim() || undefined,
      mapUv,
      showInScene: true,
      icon: vpIcon,
    };
    saveViewpoint(property.id, vp);
    setOverrides(loadOverrides(property.id));
    setActiveVpId(vp.id);
    cancelEditViewpoint();
  };

  const reorderViewpointDrop = (targetId: string) => {
    if (!dragVpId || dragVpId === targetId) {
      setDragVpId(null);
      return;
    }
    const list = [...content.viewpoints];
    const from = list.findIndex((v) => v.id === dragVpId);
    const to = list.findIndex((v) => v.id === targetId);
    if (from < 0 || to < 0) {
      setDragVpId(null);
      return;
    }
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    replaceViewpointsOrder(property.id, list);
    setOverrides(loadOverrides(property.id));
    setDragVpId(null);
  };

  const createCheckpointAtLive = (meta: { name: string; icon: CheckpointIconId }): ExperienceViewpoint | null => {
    if (!pose) return null;
    const floor0 = property.floors[0];
    const mapUv = floor0 ? worldToUv(pose.position[0], pose.position[2], floor0.worldBounds) : undefined;
    const vp: ExperienceViewpoint = {
      id: `vp_custom_${Date.now().toString(36)}`,
      name: meta.name.trim() || "New spot",
      roomId: meta.name.trim() || "New spot",
      order: content.viewpoints.length,
      sceneId: property.id,
      position: pose.position,
      target: pose.target,
      yaw: pose.yaw,
      pitch: pose.pitch,
      mapUv,
      showInScene: true,
      icon: meta.icon,
    };
    saveViewpoint(property.id, vp);
    setOverrides(loadOverrides(property.id));
    setActiveVpId(vp.id);
    return vp;
  };

  const startNewCheckpoint = () => {
    cancelEditViewpoint();
    setDevOpen(true);
  };

  const takeScreenshot = () => {
    const dataUrl = hostRef.current?.captureScreenshot();
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${property.id}-shot-${Date.now()}.png`;
    a.click();
  };

  const toggleFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  const progressPct = Math.round((stats?.progress ?? 0) * 1000) / 10;
  const accent = property.branding?.accent ?? "#c4a574";
  const floor = property.floors[0] ?? null;
  const sceneLabel = (id: string) =>
    id === "xgrids-room" ? "Room" : id === "xgrids-penthouse" ? "Penthouse" : "Revit Home";

  return (
    <div className={`exp-page${panelOpen ? "" : " panel-collapsed"}`} style={{ ["--exp-accent" as string]: accent }}>
      <ExperienceTourHost
        ref={hostRef}
        key={tourDataPath}
        dataPath={tourDataPath}
        navMode={navMode}
        quality={quality}
        collisionEnabled={collisionOn}
        hotspots={[]}
        viewpoints={content.viewpoints}
        floor={floor}
        flyTo={flyTo}
        placeHotspotMode={false}
        posePreview={pendingSample}
        hotspotPreview={null}
        onStats={onStats}
        onHotspotSelect={() => {}}
        onViewpointSelect={goViewpoint}
        onHotspotPlaced={() => {}}
        onCameraSample={setPendingSample}
        onPoseTick={setPose}
        onFade={setFade}
        onMapOutline={setMapOutlines}
        resetToken={resetToken}
        sampleCameraToken={sampleToken}
        stagingPlacements={stagingPlacements}
        stagingVisible={stagedVisible}
        stagingEditEnabled={devOpen}
        stagingPlaceMode={devOpen && stagingPlaceMode}
        stagingSelectedId={stagingSelectedId}
        stagingTransformMode={stagingTransformMode}
        stagingProxyDebug={devOpen && stagingProxyDebug}
        onStagingPlace={(hit) => {
          const p = createPlacementFromHit(
            property.id,
            property.dataPath,
            stagingDraftAsset,
            stagingDraftName,
            hit.position,
          );
          refreshStaging();
          setStagingSelectedId(p.id);
          setStagingPlaceMode(false);
          setStagingTransformMode("translate");
        }}
        onStagingSelect={setStagingSelectedId}
        onStagingTransform={(id, next) => {
          const cur = listStagingPlacements(property.id).find((p) => p.id === id);
          if (!cur) return;
          saveStagingPlacement({ ...cur, ...next });
          refreshStaging();
        }}
        surfaceOverlays={surfaceOverlays}
        surfacesVisible={surfacesVisible}
        surfaceEditEnabled={devOpen}
        surfaceMode={devOpen ? surfaceMode : "idle"}
        surfaceSelectedId={surfaceSelectedId}
        surfaceCornerHits={surfaceCornerHits}
        onSurfacePick={(meta) => {
          setSurfaceLastPick(meta);
          setStagingPlaceMode(false);
        }}
        onSurfaceCornerHit={(hit) => {
          setSurfaceCornerHits((prev) => (prev.length >= 4 ? [...prev.slice(1), hit] : [...prev, hit]));
        }}
        onSurfaceSelect={(id) => {
          setSurfaceSelectedId(id);
          setSurfaceMode("idle");
        }}
        onSurfaceTransform={(id, next) => {
          const cur = listSurfaceOverlays(property.id).find((s) => s.id === id);
          if (!cur) return;
          saveSurfaceOverlay({ ...cur, ...next });
          refreshSurfaces();
        }}
        surfaceDragEnabled={devOpen && surfaceDragEnabled}
        surfaceRenderPreset={surfaceRenderPreset}
        surfaceClipTest={devOpen && surfaceClipTest}
        surfaceSemanticProbe={devOpen && surfaceSemanticProbe}
        surfaceCollisionDepthProxy={devOpen && surfaceCollisionDepthProxy}
        onSurfaceDepthDiag={setSurfaceDepthDiag}
        onSurfaceLabNote={setSurfaceLabNote}
        onStagingDims={setStagingDims}
      />

      <div className={`exp-capture-flash${captureFlash ? " on" : ""}`} aria-hidden />
      <div className={`exp-fade${fade ? " on" : ""}`} aria-hidden />

      {(stats?.phase === "loading" ||
        (stats?.phase === "ready" && progressPct < 99.5 && (stats?.progress ?? 0) > 0 && (stats?.progress ?? 0) < 1)) && (
        <HousePointsLoader progress={Math.min(1, Math.max(0.02, stats?.progress ?? 0.05))} label="Loading space" />
      )}

      {navMode === "first-person" && (
        <>
          <div className="exp-nav-dock exp-nav-dock-left">
            <WalkOnScreenControls visible={padsOpen} api={walkApi} which="move" />
          </div>
          <div className="exp-nav-dock exp-nav-dock-right">
            <div className="exp-nav-dock-tools">
              <button type="button" className="exp-icon-btn" onClick={toggleFullscreen} title="Fullscreen">
                <IconFullscreen />
              </button>
              <button type="button" className="exp-icon-btn" onClick={takeScreenshot} title="Screenshot">
                <IconCamera />
              </button>
              <button
                type="button"
                className={`exp-pads-toggle${padsOpen ? " on" : ""}`}
                onClick={() => setPadsOpen((v) => !v)}
              >
                Pads
              </button>
            </div>
            <WalkOnScreenControls visible={padsOpen} api={walkApi} which="look" />
          </div>
        </>
      )}

      {navMode !== "first-person" && (
        <button type="button" className="exp-fs-fab" onClick={toggleFullscreen} title="Fullscreen">
          <IconFullscreen />
        </button>
      )}

      {!panelOpen && (
        <button type="button" className="exp-panel-tab" onClick={() => setPanel(true)} title="Show panel">
          <IconPanelShow />
        </button>
      )}

      {panelOpen && (
        <aside className="exp-panel">
          <div className="exp-panel-top">
            <div className="exp-panel-titles">
              <div className="exp-brand">{property.branding?.tagline ?? "Spatial Lab Experiences"}</div>
              <h1>{property.title}</h1>
              <p className="exp-desc">{property.description}</p>
            </div>
            <button
              type="button"
              className="exp-panel-collapse"
              onClick={() => setPanel(false)}
              title="Collapse panel"
              aria-label="Collapse panel"
            >
              <IconPanelHide />
            </button>
          </div>

          <div className="exp-scene-row">
            {EXPERIENCE_CATALOG.properties.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`exp-scene-chip${property.id === p.id ? " on" : ""}`}
                title={p.sizeHint}
                onClick={() => setPropertyId(p.id)}
              >
                {sceneLabel(p.id)}
              </button>
            ))}
          </div>

          <b className="exp-sub">Checkpoints</b>
          {!storageReady ? (
            <p className="exp-hint">Loading…</p>
          ) : content.viewpoints.length === 0 ? (
            <p className="exp-hint">{property.viewpointsReady ? "None yet — open Dev to capture." : "Inspect before inventing rooms."}</p>
          ) : (
            <div className={`exp-cp-grid${devOpen ? " editing" : ""}`}>
              {content.viewpoints.map((vp) => {
                const icon = (vp.icon as CheckpointIconId) || DEFAULT_CHECKPOINT_ICON;
                return (
                  <div
                    key={vp.id}
                    className={`exp-cp-tile${activeVpId === vp.id ? " on" : ""}${editingVpId === vp.id ? " editing" : ""}${dragVpId === vp.id ? " dragging" : ""}`}
                    draggable={devOpen}
                    onDragStart={() => {
                      if (devOpen) setDragVpId(vp.id);
                    }}
                    onDragOver={(e) => {
                      if (devOpen) e.preventDefault();
                    }}
                    onDrop={() => reorderViewpointDrop(vp.id)}
                    onDragEnd={() => setDragVpId(null)}
                    title={devOpen ? "Drag to reorder · click name to go" : vp.description || vp.name}
                  >
                    <button
                      type="button"
                      className="exp-cp-tile-main"
                      onClick={() => goViewpoint(vp)}
                      title={vp.description || vp.name}
                    >
                      <CheckpointIcon id={icon} className="exp-cp-tile-icon" />
                      <span>{vp.name}</span>
                    </button>
                    {devOpen && (
                      <span className="exp-cp-tile-actions">
                        <button type="button" title="Edit" onClick={() => beginEditViewpoint(vp)}>
                          ✎
                        </button>
                        <button type="button" title="Delete" onClick={() => deleteViewpoint(vp.id)}>
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="exp-staging-visitor">
            <button
              type="button"
              className={stagedVisible ? "on" : ""}
              onClick={() => setStagedVisible(true)}
              title="Show staged furniture"
            >
              Staged
            </button>
            <button
              type="button"
              className={!stagedVisible ? "on" : ""}
              onClick={() => setStagedVisible(false)}
              title="Hide staged furniture"
            >
              No furniture
            </button>
            <button
              type="button"
              className={surfacesVisible ? "on" : ""}
              onClick={() => setSurfacesVisible(true)}
              title="Show wall overlays"
            >
              Surfaces
            </button>
            <button
              type="button"
              className={!surfacesVisible ? "on" : ""}
              onClick={() => setSurfacesVisible(false)}
              title="Original scan walls (no overlays)"
            >
              Original walls
            </button>
          </div>

          <QualityLever value={qualityId} onChange={setQuality} />

          <div className="exp-toolbar">
            <button
              type="button"
              className={`exp-icon-btn${settingsOpen ? " on" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
              title="Settings"
            >
              <IconSettings />
            </button>
            <button
              type="button"
              className={`exp-icon-btn${devOpen ? " on" : ""}`}
              onClick={() => setDevOpen((v) => !v)}
              title="Dev tools"
            >
              <IconDev />
            </button>
            <button type="button" className="exp-icon-btn" onClick={() => setResetToken((n) => n + 1)} title="Reset view">
              <IconReset />
            </button>
            <button type="button" className="exp-icon-btn" onClick={() => setHelpOpen(true)} title="Help">
              <IconHelp />
            </button>
            <button type="button" className="exp-icon-btn" onClick={takeScreenshot} title="Screenshot">
              <IconCamera />
            </button>
          </div>

          {settingsOpen && (
            <div className="exp-settings">
              <label className="exp-select-field">
                Mode
                <select value={navMode} onChange={(e) => setNavMode(e.target.value as TourNavMode)}>
                  <option value="first-person">Walk</option>
                  <option value="orbit">Orbit</option>
                </select>
              </label>
              <label className="exp-select-field">
                Transition
                <select
                  value={transitionMode}
                  onChange={(e) => setTransition(e.target.value as CheckpointTransitionMode)}
                >
                  <option value="smooth">Smooth glide</option>
                  <option value="fade">Fade if blocked</option>
                </select>
              </label>
              <p className="exp-hint">Graphics quality is the lever above (Performance → Quality).</p>
            </div>
          )}

          {devOpen && (
            <div className="exp-dev">
              <div className="exp-dev-stats">
                {stats?.phase ?? "…"} · {stats?.fps ?? "—"} fps · {(quality.maxSplats / 1e6).toFixed(1)}M · SDK{" "}
                {LCC_SDK_VERSION_LABEL}
              </div>
              <label className="exp-check">
                <input type="checkbox" checked={collisionOn} onChange={(e) => setCollisionOn(e.target.checked)} />
                Collision
              </label>

              <ExpDevSection id="checkpoints" title="Checkpoints" defaultOpen={false}>
                <div className="exp-dev-row">
                  <b className="exp-sub">{editingVpId ? "Edit checkpoint" : "New checkpoint"}</b>
                  {editingVpId ? (
                    <button type="button" onClick={startNewCheckpoint}>
                      + New instead
                    </button>
                  ) : null}
                </div>
                <p className="exp-hint">
                  {editingVpId
                    ? "Change name/icon/notes, or Recapture pose to move it, then Update."
                    : "Walk in 3D → Capture pose → name it → Save checkpoint. Drag tiles above to reorder; ✎ / × to edit/delete."}
                </p>
                <div className="exp-dev-row">
                  <button type="button" className={pendingSample ? "on" : ""} onClick={capturePose}>
                    {editingVpId ? "Recapture pose" : "1. Capture pose"}
                  </button>
                  {editingVpId && (
                    <button type="button" onClick={cancelEditViewpoint}>
                      Cancel edit
                    </button>
                  )}
                </div>
                {pendingSample && (
                  <div className="exp-hint ok">
                    Pose locked · yaw {((pendingSample.yaw * 180) / Math.PI).toFixed(0)}° (blue marker in scene)
                  </div>
                )}
                <input
                  type="text"
                  placeholder="2. Name (e.g. Kitchen)"
                  value={vpName}
                  onChange={(e) => setVpName(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Room / area"
                  value={vpRoom}
                  onChange={(e) => setVpRoom(e.target.value)}
                />
                <textarea
                  placeholder="Description (optional)"
                  rows={2}
                  value={vpDesc}
                  onChange={(e) => setVpDesc(e.target.value)}
                />
                <div className="exp-icon-picker" role="listbox" aria-label="Checkpoint icon">
                  {CHECKPOINT_ICONS.map((ic) => (
                    <button
                      key={ic.id}
                      type="button"
                      className={vpIcon === ic.id ? "on" : ""}
                      title={ic.label}
                      onClick={() => setVpIcon(ic.id)}
                    >
                      <CheckpointIcon id={ic.id} />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!vpName.trim() || (!pendingSample && !editingVpId)}
                  onClick={recordViewpoint}
                >
                  {editingVpId ? "Update checkpoint" : "3. Save new checkpoint"}
                </button>
              </ExpDevSection>

              <ExpDevSection id="staging" title="Virtual staging" defaultOpen={false}>
                <StagingEditor
                  propertyId={property.id}
                  placements={stagingPlacements}
                  selectedId={stagingSelectedId}
                  placeMode={stagingPlaceMode}
                  transformMode={stagingTransformMode}
                  stagedVisible={stagedVisible}
                  draftAsset={stagingDraftAsset}
                  draftName={stagingDraftName}
                  onDraftAsset={setStagingDraftAsset}
                  onDraftName={setStagingDraftName}
                  onRefresh={refreshStaging}
                  onSelect={setStagingSelectedId}
                  onPlaceMode={(on) => {
                    setStagingPlaceMode(on);
                    if (on) setSurfaceMode("idle");
                  }}
                  onTransformMode={setStagingTransformMode}
                  onStagedVisible={setStagedVisible}
                  proxyDebug={stagingProxyDebug}
                  onProxyDebug={setStagingProxyDebug}
                  liveDims={stagingDims}
                />
              </ExpDevSection>

              <ExpDevSection id="surfaces" title="Wall / surfaces" defaultOpen>
                <SurfaceEditor
                  propertyId={property.id}
                  modelDataPath={property.dataPath}
                  surfaces={surfaceOverlays}
                  selectedId={surfaceSelectedId}
                  surfacesVisible={surfacesVisible}
                  mode={surfaceMode}
                  lastPick={surfaceLastPick}
                  cornerHits={surfaceCornerHits}
                  onRefresh={refreshSurfaces}
                  onSelect={setSurfaceSelectedId}
                  onSurfacesVisible={setSurfacesVisible}
                  onMode={(m) => {
                    setSurfaceMode(m);
                    if (m !== "idle") setStagingPlaceMode(false);
                  }}
                  onClearCorners={() => setSurfaceCornerHits([])}
                  depthDiag={surfaceDepthDiag}
                  labNote={surfaceLabNote}
                  renderPreset={surfaceRenderPreset}
                  onRenderPreset={setSurfaceRenderPreset}
                  clipTest={surfaceClipTest}
                  onClipTest={setSurfaceClipTest}
                  semanticProbe={surfaceSemanticProbe}
                  onSemanticProbe={setSurfaceSemanticProbe}
                  collisionDepthProxy={surfaceCollisionDepthProxy}
                  onCollisionDepthProxy={setSurfaceCollisionDepthProxy}
                  dragEnabled={surfaceDragEnabled}
                  onDragEnabled={setSurfaceDragEnabled}
                />
              </ExpDevSection>

              <ExpDevSection id="floorplan" title="Floor-plan align" defaultOpen={false}>
                <FloorPlanAlignEditor
                  propertyId={property.id}
                  floorId={floor?.id ?? "floor-1"}
                  floorName={floor?.name ?? "Main floor"}
                  modelDataPath={property.dataPath}
                  viewpoints={content.viewpoints}
                  livePose={pose ? { x: pose.position[0], z: pose.position[2] } : null}
                  onPlansChanged={() => setPlanTick((n) => n + 1)}
                  onPreviewViewpoint={goViewpoint}
                  onCreateCheckpointAtLive={createCheckpointAtLive}
                />
              </ExpDevSection>

              {loadLog.length > 0 && (
                <div className="exp-load-log">
                  {loadLog.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 40)}`}>{line}</div>
                  ))}
                </div>
              )}
              <Link href="/labs/lcc-web-sdk" className="exp-lab-link">
                SDK playground
              </Link>
              <Link href="/labs/property-experience?author=1" className="exp-lab-link">
                PROD-01 · Two-floor property
              </Link>
              <Link href="/labs/prod-03?author=1" className="exp-lab-link">
                PROD-03 · Henna Road (outdoor)
              </Link>
            </div>
          )}

          <Link href="/" className="exp-lab-link">
            ← Spatial Lab
          </Link>
        </aside>
      )}

      <div className="exp-map-dock">
        <FloorMapPanel
          floor={floor}
          viewpoints={content.viewpoints}
          outlines={mapOutlines}
          planImageUrl={planImageUrl}
          planTransform={activePlan?.transform ?? null}
          rooms={activePlan?.rooms ?? []}
          cameraPos={pose?.position ?? null}
          yaw={pose?.yaw ?? null}
          activeViewpointId={activeVpId}
          expanded={mapOpen}
          onToggle={() => setMapOpen((v) => !v)}
          onSelectViewpoint={goViewpoint}
          onSelectRoom={(room: FloorPlanRoom) => {
            const id = room.defaultViewpointId ?? room.viewpointIds[0];
            const vp = content.viewpoints.find((v) => v.id === id);
            if (vp) goViewpoint(vp);
          }}
        />
      </div>

      {helpOpen && (
        <div className="exp-help" role="dialog" aria-label="Navigation help">
          <h2>How to move</h2>
          <ul>
            <li>
              <b>Walk</b>: arrow keys or Move pad · Look pad to rotate · drag to look
            </li>
            <li>
              <b>Checkpoints</b>: jump between room views — pick <b>Smooth glide</b> or <b>Fade</b> in Settings
            </li>
            <li>
              <b>Graphics</b>: Performance ↔ Quality lever — lower if the walk feels choppy
            </li>
            <li>
              <b>Capture pose</b> (Dev): saves your current camera + optional note/icon — no scene click needed
            </li>
            <li>Map: aligned floor plan (Dev) · icon pins · chevron = you</li>
          </ul>
          <button type="button" onClick={dismissHelp}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19.4 13.1a1.4 1.4 0 0 0 .3 1.5l.1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.4 1.4 0 0 0-1.5-.3 1.4 1.4 0 0 0-.8 1.3V18a1.7 1.7 0 1 1-3.4 0v-.1a1.4 1.4 0 0 0-.9-1.3 1.4 1.4 0 0 0-1.5.3l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.4 1.4 0 0 0 .3-1.5 1.4 1.4 0 0 0-1.3-.8H6a1.7 1.7 0 1 1 0-3.4h.1a1.4 1.4 0 0 0 1.3-.9 1.4 1.4 0 0 0-.3-1.5l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.4 1.4 0 0 0 1.5.3h.1a1.4 1.4 0 0 0 .8-1.3V6a1.7 1.7 0 1 1 3.4 0v.1a1.4 1.4 0 0 0 .8 1.3 1.4 1.4 0 0 0 1.5-.3l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.4 1.4 0 0 0-.3 1.5v.1a1.4 1.4 0 0 0 1.3.8H18a1.7 1.7 0 1 1 0 3.4h-.1a1.4 1.4 0 0 0-1.3.8z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconReset() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12a8 8 0 1 0 2.2-5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4 5v5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconHelp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.6 1-1.6 2v.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}
function IconCamera() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 7l1.2-1.8A1 1 0 0 1 11 5h2a1 1 0 0 1 .8.4L15 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function IconFullscreen() {
  /* Four corner expand arrows */
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 4H4v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 4h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 20H4v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20l6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 20h5v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 20l-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconDev() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconPanelHide() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 8l-3 4 3 4M14 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconPanelShow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 8l3 4-3 4M10 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
