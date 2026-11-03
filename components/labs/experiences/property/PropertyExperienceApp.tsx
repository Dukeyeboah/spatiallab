"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExperienceTourHost,
  type CameraPoseSample,
  type TourHostHandle,
  type TourHostStats,
  type TourNavMode,
} from "@/components/labs/experiences/ExperienceTourHost";
import { ExpDevSection } from "@/components/labs/experiences/ExpDevSection";
import { HousePointsLoader } from "@/components/labs/experiences/HousePointsLoader";
import { QualityLever } from "@/components/labs/experiences/QualityLever";
import { WalkOnScreenControls } from "@/components/labs/experiences/WalkOnScreenControls";
import { FloorWelcome } from "@/components/labs/experiences/property/FloorWelcome";
import {
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESETS,
  loadQualityPresetId,
  saveQualityPresetId,
  type QualityPresetId,
} from "@/lib/labs/experiences/qualityPresets";
import {
  clearDraft,
  downloadExperienceJson,
  loadDraft,
  parseExperienceJson,
  pointInTrigger,
  saveDraft,
  validateExperience,
  type ValidationIssue,
} from "@/lib/labs/experiences/propertyExperience/storage";
import { DEFAULT_EYE_HEIGHT } from "@/lib/labs/experiences/propertyExperience/defaults";
import {
  createSpintexSeed,
  ensureSpintexStairDefaults,
  isCorruptGroundStartCamera,
  SPINTEX_PROPERTY_ID,
} from "@/lib/labs/experiences/propertyExperience/spintexSeed";
import {
  emptyFloorCamera,
  resolveFloorModelUrl,
  sortedFloors,
  type FloorBlockZone,
  type FloorCameraPose,
  type FloorConnection,
  type FloorRecord,
  type FloorViewpoint,
  type PropertyExperienceConfig,
} from "@/lib/labs/experiences/propertyExperience/types";
import type { ExperienceViewpoint } from "@/lib/labs/experiences/types";
import { LCC_SDK_VERSION_LABEL } from "@/lib/labs/lccSdk";

type Mode = "welcome" | "tour";
type Role = "visitor" | "author";

const TRIGGER_COOLDOWN_MS = 4000;
const ARRIVAL_SUPPRESS_MS = 5500;

function poseFromSample(sample: CameraPoseSample, eyeHeight?: number): FloorCameraPose {
  return {
    position: sample.position,
    target: sample.target,
    yaw: sample.yaw,
    pitch: sample.pitch,
    // eyeHeight is capsule height above feet — NOT world Y (Ground Floor Y ≈ −3, First ≈ +1).
    ...(eyeHeight != null ? { eyeHeight } : {}),
  };
}

function viewpointToExperience(vp: FloorViewpoint, sceneId: string): ExperienceViewpoint {
  return {
    id: vp.id,
    name: vp.name,
    description: vp.description,
    roomId: vp.roomId,
    order: vp.order,
    position: vp.position,
    target: vp.target,
    yaw: vp.yaw,
    pitch: vp.pitch,
    icon: vp.icon,
    showInScene: vp.showInScene !== false,
    sceneId,
  };
}

/**
 * LAB PROD-01 — multi-floor property authoring + visitor preview.
 * Same player path Spatial House will consume (no Dev chrome in visitor role).
 */
export function PropertyExperienceApp() {
  // Seed only on first paint (SSR + client) — localStorage draft hydrates after mount to avoid img src mismatch.
  const [config, setConfig] = useState<PropertyExperienceConfig>(() => createSpintexSeed());
  /** Author/Dev tools on by default while we establish starts & blocks; switch to Visitor Preview when testing. */
  const [role, setRole] = useState<Role>("author");
  const [mode, setMode] = useState<Mode>("welcome");
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [pendingFloorId, setPendingFloorId] = useState<string | null>(null);
  const [arrivalCamera, setArrivalCamera] = useState<FloorCameraPose | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  const [qualityId, setQualityId] = useState<QualityPresetId>(DEFAULT_QUALITY_PRESET);
  const quality = QUALITY_PRESETS[qualityId];
  useEffect(() => setQualityId(loadQualityPresetId()), []);
  const setQuality = useCallback((id: QualityPresetId) => {
    setQualityId(id);
    saveQualityPresetId(id);
  }, []);

  const [navMode, setNavMode] = useState<TourNavMode>("first-person");
  const [collisionOn, setCollisionOn] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [padsOpen, setPadsOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stats, setStats] = useState<TourHostStats | null>(null);
  const [fade, setFade] = useState(false);
  const [pose, setPose] = useState<CameraPoseSample | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [sampleToken, setSampleToken] = useState(0);
  const [pendingSample, setPendingSample] = useState<CameraPoseSample | null>(null);
  const [flyTo, setFlyTo] = useState<{
    viewpoint: ExperienceViewpoint;
    token: number;
    transition: "fade" | "smooth";
  } | null>(null);

  const [vpName, setVpName] = useState("");
  const [vpRoom, setVpRoom] = useState("");
  const [connLabel, setConnLabel] = useState("Go upstairs?");
  const [connDestId, setConnDestId] = useState("first");
  const [validation, setValidation] = useState<ValidationIssue[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  /** First Floor → Ground: void soft-block + confirm modal (trigger at stopper). */
  const stairTransitionsEnabled = true;
  const [activeTrigger, setActiveTrigger] = useState<FloorConnection | null>(null);
  const [liveEyeHeight, setLiveEyeHeight] = useState(DEFAULT_EYE_HEIGHT);
  const [blockLabel, setBlockLabel] = useState("Blocked area");
  const cooldownUntilRef = useRef(0);
  const suppressUntilRef = useRef(0);
  const lastInsideRef = useRef<string | null>(null);
  /** Connection id that brought us to this floor — ignore until we leave its twin trigger. */
  const arrivalConnIdRef = useRef<string | null>(null);

  const hostRef = useRef<TourHostHandle | null>(null);
  const walkApi = useMemo(
    () => ({
      setVirtualMove: (x: number, z: number) => hostRef.current?.setVirtualMove(x, z),
      setVirtualLook: (yaw: number, pitch: number) => hostRef.current?.setVirtualLook(yaw, pitch),
      clearVirtualInput: () => hostRef.current?.clearVirtualInput(),
    }),
    [],
  );

  // Hydrate draft from localStorage after mount (starts, previews, stairs) — never in useState.
  useEffect(() => {
    const draft = loadDraft(SPINTEX_PROPERTY_ID);
    const prevGroundStart = draft?.floors.find((f) => f.id === "ground")?.startCamera;
    const base = draft ?? createSpintexSeed();
    const merged = ensureSpintexStairDefaults(base);
    setConfig(merged);
    if (draft && merged !== draft) saveDraft(merged);
    if (
      isCorruptGroundStartCamera(prevGroundStart) &&
      !merged.floors.find((f) => f.id === "ground")?.startCamera
    ) {
      setStatusMsg(
        "Ground Floor start was cleared (old save used eye height as world Y). Walk to the living room spot and Save again.",
      );
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("author") === "1") setRole("author");
    const floorParam = params.get("floor");
    if (floorParam && merged.visitor.allowDirectFloorLinks !== false) {
      const floor = merged.floors.find((f) => f.id === floorParam);
      if (floor) {
        // Defer so state from setConfig is available to enterFloor via merged directly
        const eye =
          floor.startCamera?.eyeHeight ??
          floor.defaultEyeHeight ??
          DEFAULT_EYE_HEIGHT;
        setLiveEyeHeight(eye);
        setPendingFloorId(floor.id);
        setArrivalCamera(floor.startCamera);
        setActiveFloorId(floor.id);
        setMode("tour");
        setLoadKey((k) => k + 1);
        cooldownUntilRef.current = performance.now() + TRIGGER_COOLDOWN_MS;
        suppressUntilRef.current = performance.now() + ARRIVAL_SUPPRESS_MS;
      }
    }
  }, []);

  const activeFloor: FloorRecord | null = useMemo(
    () => config.floors.find((f) => f.id === activeFloorId) ?? null,
    [config.floors, activeFloorId],
  );

  const dataPath = useMemo(() => {
    if (!activeFloor) return null;
    try {
      return resolveFloorModelUrl(activeFloor, "local");
    } catch {
      return null;
    }
  }, [activeFloor]);

  const startCamera = arrivalCamera ?? activeFloor?.startCamera ?? null;

  const hostViewpoints: ExperienceViewpoint[] = useMemo(() => {
    if (!activeFloor) return [];
    return activeFloor.viewpoints
      .filter((v) => role === "author" || v.visitorVisible !== false)
      .map((v) => viewpointToExperience(v, activeFloor.id));
  }, [activeFloor, role]);

  const patchConfig = useCallback((fn: (c: PropertyExperienceConfig) => PropertyExperienceConfig) => {
    setConfig((prev) => {
      const next = fn(prev);
      return next;
    });
  }, []);

  const persist = useCallback(() => {
    setConfig((prev) => {
      const saved = saveDraft(prev);
      setStatusMsg(`Draft saved · ${saved.updatedAt}`);
      return saved;
    });
  }, []);

  function enterFloor(
    floorId: string,
    camera: FloorCameraPose | null | undefined,
    opts?: { viaConnectionId?: string | null },
  ) {
    const floor = config.floors.find((f) => f.id === floorId);
    const resolved = camera ?? floor?.startCamera ?? null;
    const eye =
      resolved?.eyeHeight ??
      floor?.defaultEyeHeight ??
      floor?.startCamera?.eyeHeight ??
      DEFAULT_EYE_HEIGHT;
    setLiveEyeHeight(eye);
    setPendingFloorId(floorId);
    setArrivalCamera(resolved);
    setActiveFloorId(floorId);
    setMode("tour");
    setLoadKey((k) => k + 1);
    setActiveTrigger(null);
    setFlyTo(null);
    arrivalConnIdRef.current = opts?.viaConnectionId ?? null;
    cooldownUntilRef.current = performance.now() + TRIGGER_COOLDOWN_MS;
    suppressUntilRef.current = performance.now() + ARRIVAL_SUPPRESS_MS;
    lastInsideRef.current = null;
  }

  function leaveToWelcome() {
    setMode("welcome");
    setActiveFloorId(null);
    setPendingFloorId(null);
    setArrivalCamera(null);
    setActiveTrigger(null);
  }

  const onPoseTick = useCallback(
    (sample: CameraPoseSample) => {
      setPose(sample);
      if (!stairTransitionsEnabled || !activeFloorId || mode !== "tour") {
        setActiveTrigger(null);
        return;
      }
      const now = performance.now();
      if (now < cooldownUntilRef.current || now < suppressUntilRef.current) {
        setActiveTrigger(null);
        return;
      }
      const conns = config.connections.filter(
        (c) => c.enabled && c.sourceFloorId === activeFloorId,
      );
      let hit: FloorConnection | null = null;
      for (const c of conns) {
        if (pointInTrigger(sample.position, c.triggerCenter, c.triggerSize)) {
          hit = c;
          break;
        }
      }
      if (hit) {
        lastInsideRef.current = hit.id;
        setActiveTrigger(hit);
      } else {
        lastInsideRef.current = null;
        setActiveTrigger(null);
      }
    },
    [activeFloorId, config.connections, mode, stairTransitionsEnabled],
  );

  const confirmFloorChange = (conn: FloorConnection) => {
    const dest = config.floors.find((f) => f.id === conn.destFloorId);
    const arrival = dest?.startCamera ?? conn.arrivalCamera;
    enterFloor(conn.destFloorId, arrival, { viaConnectionId: conn.id });
  };

  const applyEyeHeight = (metres: number) => {
    const next = Math.max(0.9, Math.min(2.2, metres));
    setLiveEyeHeight(next);
    hostRef.current?.setEyeHeight(next);
  };

  const saveFloorStart = () => {
    if (!activeFloor || !pose) {
      setStatusMsg("Walk to the spot you want, then try again (camera pose not ready yet).");
      return;
    }
    // Keep world X/Y/Z exactly — Ground Floor reconstruction sits near Y≈−3; never replace Y with eyeHeight.
    const cam: FloorCameraPose = poseFromSample(pose, liveEyeHeight);
    setConfig((prev) => {
      let next: PropertyExperienceConfig = {
        ...prev,
        floors: prev.floors.map((f) =>
          f.id === activeFloor.id
            ? { ...f, startCamera: cam, defaultEyeHeight: liveEyeHeight }
            : f,
        ),
      };
      // Keep stair arrivals in sync when a floor start is authored
      next = {
        ...next,
        connections: next.connections.map((c) => {
          if (activeFloor.id === "ground" && c.destFloorId === "ground") {
            return { ...c, arrivalCamera: cam };
          }
          if (activeFloor.id === "first" && c.destFloorId === "first") {
            return { ...c, arrivalCamera: cam };
          }
          return c;
        }),
      };
      next = ensureSpintexStairDefaults(next);
      const saved = saveDraft(next);
      setStatusMsg(
        `Saved ${activeFloor.name} start @ (${cam.position[0].toFixed(2)}, ${cam.position[1].toFixed(2)}, ${cam.position[2].toFixed(2)}) · eye ${liveEyeHeight.toFixed(2)} m`,
      );
      return saved;
    });
  };

  const addBlockZoneHere = () => {
    if (!activeFloor || !pose) {
      setStatusMsg("Walk to where the barrier should be, then create the block zone.");
      return;
    }
    const zone: FloorBlockZone = {
      id: `block-${Date.now().toString(36)}`,
      label: blockLabel.trim() || "Blocked area",
      enabled: true,
      center: [pose.position[0], pose.position[1], pose.position[2]],
      // Wide / tall box — author can tighten in JSON later
      size: [2.4, 2.6, 1.2],
    };
    patchConfig((c) => ({
      ...c,
      floors: c.floors.map((f) =>
        f.id === activeFloor.id
          ? { ...f, blockZones: [...(f.blockZones ?? []), zone] }
          : f,
      ),
    }));
    setStatusMsg(`Block zone “${zone.label}” added on ${activeFloor.name}`);
  };

  const previewFloorStart = () => {
    if (!activeFloor?.startCamera) {
      setStatusMsg("No start camera saved for this floor.");
      return;
    }
    const vp: ExperienceViewpoint = {
      id: "preview-start",
      name: "Floor start",
      sceneId: activeFloor.id,
      position: activeFloor.startCamera.position,
      target: activeFloor.startCamera.target,
      yaw: activeFloor.startCamera.yaw,
      pitch: activeFloor.startCamera.pitch,
    };
    setFlyTo({
      viewpoint: vp,
      token: Date.now(),
      transition: "fade",
    });
  };

  const addCheckpoint = () => {
    if (!activeFloor || !pendingSample || !vpName.trim()) return;
    const vp: FloorViewpoint = {
      id: `vp-${Date.now().toString(36)}`,
      name: vpName.trim(),
      roomId: vpRoom.trim() || vpName.trim(),
      floorId: activeFloor.id,
      order: activeFloor.viewpoints.length,
      position: pendingSample.position,
      target: pendingSample.target,
      yaw: pendingSample.yaw,
      pitch: pendingSample.pitch,
      icon: "camera",
      visitorVisible: true,
      showInScene: true,
    };
    patchConfig((c) => ({
      ...c,
      floors: c.floors.map((f) =>
        f.id === activeFloor.id ? { ...f, viewpoints: [...f.viewpoints, vp] } : f,
      ),
    }));
    setPendingSample(null);
    setVpName("");
    setVpRoom("");
    setStatusMsg(`Checkpoint “${vp.name}” added on ${activeFloor.name}`);
  };

  const placeConnectionTrigger = () => {
    if (!activeFloor || !pose) {
      setStatusMsg("Walk to the stair entrance first.");
      return;
    }
    const dest =
      config.floors.find((f) => f.id === connDestId) ??
      config.floors.find((f) => f.id !== activeFloor.id);
    if (!dest) return;
    const conn: FloorConnection = {
      id: `conn-${Date.now().toString(36)}`,
      label: connLabel.trim() || `Go to ${dest.name}`,
      enabled: true,
      sourceFloorId: activeFloor.id,
      destFloorId: dest.id,
      triggerCenter: [pose.position[0], pose.position[1], pose.position[2]],
      triggerSize: [1.6, 2.4, 1.6],
      arrivalCamera: dest.startCamera ?? emptyFloorCamera(),
      showMarker: true,
      transition: "fade",
    };
    patchConfig((c) => ({ ...c, connections: [...c.connections, conn] }));
    setStatusMsg(
      `Connection created. Open ${dest.name}, set arrival with “Save arrival for last connection”, then Save Draft.`,
    );
  };

  const saveArrivalForLastConnection = () => {
    if (!activeFloor || !pose) return;
    const cam = poseFromSample(pose, liveEyeHeight);
    patchConfig((c) => {
      const conns = [...c.connections];
      // Prefer a connection that arrives on this floor
      let idx = -1;
      for (let i = conns.length - 1; i >= 0; i--) {
        if (conns[i]!.destFloorId === activeFloor.id) {
          idx = i;
          break;
        }
      }
      if (idx < 0 && conns.length) idx = conns.length - 1;
      if (idx < 0) {
        setStatusMsg("No connection to update.");
        return c;
      }
      conns[idx] = { ...conns[idx]!, arrivalCamera: cam };
      setStatusMsg(`Arrival camera saved on connection “${conns[idx]!.label}”`);
      return { ...c, connections: conns };
    });
  };

  const capturePreview = () => {
    if (!activeFloor) return;
    const dataUrl = hostRef.current?.captureScreenshot();
    if (!dataUrl) {
      setStatusMsg("Screenshot unavailable (scene not ready).");
      return;
    }
    patchConfig((c) => ({
      ...c,
      floors: c.floors.map((f) =>
        f.id === activeFloor.id ? { ...f, previewImageUrl: dataUrl } : f,
      ),
    }));
    setStatusMsg("Preview captured into draft (data URL). Export JSON will embed it — prefer replacing with a file under previews/ for production.");
  };

  const runValidate = () => {
    const issues = validateExperience(config);
    setValidation(issues);
    setStatusMsg(
      issues.length === 0
        ? "Validation OK"
        : `${issues.filter((i) => i.level === "error").length} errors · ${issues.filter((i) => i.level === "warn").length} warnings`,
    );
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseExperienceJson(text);
      setConfig(parsed);
      saveDraft(parsed);
      setStatusMsg(`Imported ${parsed.property.title}`);
      leaveToWelcome();
    } catch (e) {
      setStatusMsg((e as Error).message);
    }
  };

  const accent = config.visitor.brandAccent ?? "#c4a574";
  const isAuthor = role === "author";

  if (mode === "welcome") {
    return (
      <div className="pe-root" style={{ ["--pe-accent" as string]: accent }}>
        <div className="pe-topbar">
          <Link href="/labs/spatial-experiences" className="pe-topbar-link">
            ← Experiences
          </Link>
          <span className="pe-topbar-title">PROD-01 · Property experience</span>
          <div className="pe-topbar-actions">
            <button
              type="button"
              className={isAuthor ? "on" : ""}
              onClick={() => setRole((r) => (r === "author" ? "visitor" : "author"))}
            >
              {isAuthor ? "Author mode" : "Visitor preview"}
            </button>
          </div>
        </div>
        <FloorWelcome config={config} onSelectFloor={(id) => {
          const floor = config.floors.find((f) => f.id === id);
          enterFloor(id, floor?.startCamera);
        }} />
        {isAuthor && (
          <aside className="pe-author-dock">
            <AuthorDock
              config={config}
              statusMsg={statusMsg}
              validation={validation}
              onPersist={persist}
              onValidate={runValidate}
              onExport={() => downloadExperienceJson(config)}
              onImportFile={onImportFile}
              onResetSeed={() => {
                clearDraft(SPINTEX_PROPERTY_ID);
                setConfig(createSpintexSeed());
                setStatusMsg("Reset to seed (cleared draft)");
              }}
              onEnterFloor={(id) => {
                const floor = config.floors.find((f) => f.id === id);
                enterFloor(id, floor?.startCamera);
              }}
            />
          </aside>
        )}
      </div>
    );
  }

  if (!activeFloor || !dataPath) {
    return (
      <div className="pe-root pe-error">
        <p>Missing floor model path. Extract packages per public/labs/properties/spintex-house/README.md</p>
        <button type="button" onClick={leaveToWelcome}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="pe-root pe-tour" style={{ ["--pe-accent" as string]: accent }}>
      <ExperienceTourHost
        ref={hostRef}
        key={`${dataPath}-${loadKey}`}
        dataPath={dataPath}
        navMode={navMode}
        quality={quality}
        collisionEnabled={collisionOn}
        hotspots={[]}
        viewpoints={hostViewpoints}
        floor={null}
        flyTo={flyTo}
        placeHotspotMode={false}
        posePreview={isAuthor ? pendingSample : null}
        hotspotPreview={null}
        startCamera={
          startCamera
            ? { ...startCamera, eyeHeight: startCamera.eyeHeight ?? liveEyeHeight }
            : null
        }
        eyeHeight={liveEyeHeight}
        blockZones={(activeFloor.blockZones ?? []).map((z) => ({
          id: z.id,
          enabled: z.enabled,
          center: z.center,
          size: z.size,
        }))}
        onSceneReady={() => setPendingFloorId(null)}
        onStats={setStats}
        onHotspotSelect={() => {}}
        onViewpointSelect={(vp) => {
          setFlyTo({
            viewpoint: vp,
            token: Date.now(),
            transition: config.visitor.checkpointTransition ?? "fade",
          });
        }}
        onHotspotPlaced={() => {}}
        onCameraSample={setPendingSample}
        onPoseTick={onPoseTick}
        onFade={setFade}
        resetToken={resetToken}
        sampleCameraToken={sampleToken}
      />

      <div className={`exp-fade${fade ? " on" : ""}`} aria-hidden />

      {pendingFloorId && (
        <div className="pe-loading" role="status">
          <HousePointsLoader
            progress={Math.min(
              1,
              Math.max(
                0.04,
                stats?.phase === "ready" ? 1 : (stats?.progress ?? 0.05),
              ),
            )}
            label={`Preparing ${config.floors.find((f) => f.id === pendingFloorId)?.name ?? "floor"}`}
          />
          <p className="pe-loading-settle">
            {stats?.phase === "ready"
              ? "Settling detail…"
              : `${Math.round((stats?.progress ?? 0) * 100)}% · SDK ${LCC_SDK_VERSION_LABEL}`}
          </p>
        </div>
      )}

      {navMode === "first-person" && (
        <>
          <div className={`pe-nav-dock pe-nav-dock-left${panelOpen ? " clear-panel" : ""}`}>
            <WalkOnScreenControls api={walkApi} visible={padsOpen && !pendingFloorId} which="move" />
          </div>
          <div className="pe-nav-dock pe-nav-dock-right">
            <WalkOnScreenControls api={walkApi} visible={padsOpen && !pendingFloorId} which="look" />
          </div>
        </>
      )}

      {stairTransitionsEnabled && activeTrigger && !pendingFloorId && (
        <div className="pe-stair-modal" role="dialog" aria-labelledby="pe-stair-title">
          <h2 id="pe-stair-title">{activeTrigger.label || "Change floor?"}</h2>
          <p>
            Switch to the{" "}
            {config.floors.find((f) => f.id === activeTrigger.destFloorId)?.name ?? "other floor"}{" "}
            scene. You cannot walk the stairs inside this reconstruction.
          </p>
          <div className="pe-stair-modal-actions">
            <button type="button" onClick={() => confirmFloorChange(activeTrigger)}>
              {activeTrigger.destFloorId === "first"
                ? "Go upstairs"
                : activeTrigger.destFloorId === "ground"
                  ? "Go downstairs"
                  : "Confirm"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setActiveTrigger(null);
                cooldownUntilRef.current = performance.now() + TRIGGER_COOLDOWN_MS;
              }}
            >
              Stay here
            </button>
          </div>
        </div>
      )}

      {panelOpen && (
        <aside className={`pe-panel${isAuthor ? " author" : ""}`}>
          <div className="pe-panel-head">
            <div>
              <div className="pe-panel-brand">Spatial House</div>
              <h1>{config.property.title}</h1>
              <p className="pe-panel-floor">{activeFloor.name}</p>
            </div>
            <button type="button" className="pe-icon" onClick={() => setPanelOpen(false)} title="Hide panel">
              ‹
            </button>
          </div>

          <div className="pe-rooms">
            <b>Rooms</b>
            {hostViewpoints.length === 0 ? (
              <p className="exp-hint">No checkpoints on this floor yet.</p>
            ) : (
              <div className="pe-room-grid">
                {hostViewpoints.map((vp) => (
                  <button
                    key={vp.id}
                    type="button"
                    onClick={() =>
                      setFlyTo({
                        viewpoint: vp,
                        token: Date.now(),
                        transition: config.visitor.checkpointTransition ?? "fade",
                      })
                    }
                  >
                    {vp.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pe-nav-modes" role="group" aria-label="Navigation mode">
            {(
              [
                ["first-person", "Walk"],
                ["point-move", "Point & Move"],
                ["orbit", "Orbit"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={navMode === id ? "on" : ""}
                onClick={() => {
                  hostRef.current?.clearVirtualInput();
                  setNavMode(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="pe-toolbar">
            <button type="button" onClick={() => setHelpOpen(true)}>
              Help
            </button>
            <button type="button" onClick={() => setPadsOpen((v) => !v)}>
              Pads
            </button>
            <button
              type="button"
              onClick={() => {
                const el = document.documentElement;
                if (!document.fullscreenElement) void el.requestFullscreen?.();
                else void document.exitFullscreen?.();
              }}
            >
              Fullscreen
            </button>
            <button type="button" onClick={leaveToWelcome}>
              Floors
            </button>
            <FloorMenu
              floors={sortedFloors(config).filter((f) => f.visitorVisible)}
              activeId={activeFloor.id}
              onPick={(id) => {
                const f = config.floors.find((x) => x.id === id);
                enterFloor(id, f?.startCamera);
              }}
            />
          </div>

          {!isAuthor && <QualityLever value={qualityId} onChange={setQuality} />}

          {isAuthor && (
            <div className="pe-author">
              <div className="exp-dev-stats">
                {stats?.phase ?? "…"} · {stats?.fps ?? "—"} fps · collision{" "}
                {stats?.hasCollision ? "yes" : "no"}
              </div>
              <QualityLever value={qualityId} onChange={setQuality} />
              <label className="exp-check">
                <input type="checkbox" checked={collisionOn} onChange={(e) => setCollisionOn(e.target.checked)} />
                Collision
              </label>

              <ExpDevSection id="pe-start" title="Start point & eye height (Dev)" defaultOpen>
                <p className="exp-hint">
                  Work on <b>{activeFloor.name}</b>. Walk to the exact spot, set eye height, then save (keeps world
                  XYZ — Ground Floor Y is often negative). Stairs: bump the stopper → upstairs / downstairs prompt.
                </p>
                <label className="pe-eye-field">
                  Eye height {liveEyeHeight.toFixed(2)} m
                  <input
                    type="range"
                    min={1.0}
                    max={1.85}
                    step={0.01}
                    value={liveEyeHeight}
                    onChange={(e) => applyEyeHeight(Number(e.target.value))}
                  />
                </label>
                <div className="exp-dev-row">
                  <button type="button" onClick={() => applyEyeHeight(liveEyeHeight - 0.05)}>
                    Lower −5 cm
                  </button>
                  <button type="button" onClick={() => applyEyeHeight(liveEyeHeight + 0.05)}>
                    Raise +5 cm
                  </button>
                  <button type="button" onClick={() => applyEyeHeight(DEFAULT_EYE_HEIGHT)}>
                    Reset {DEFAULT_EYE_HEIGHT.toFixed(2)} m
                  </button>
                </div>
                <div className="exp-dev-row">
                  <button type="button" className="on" onClick={saveFloorStart}>
                    Save this spot as {activeFloor.name} start
                  </button>
                  <button type="button" onClick={previewFloorStart}>
                    Preview Floor Start
                  </button>
                  <button type="button" onClick={capturePreview}>
                    Capture floor preview
                  </button>
                </div>
                {activeFloor.startCamera ? (
                  <div className="exp-hint ok">
                    Start saved · eye{" "}
                    {(activeFloor.startCamera.eyeHeight ?? activeFloor.defaultEyeHeight ?? 1.55).toFixed(2)} m
                  </div>
                ) : (
                  <div className="exp-hint">No start camera yet for this floor</div>
                )}
              </ExpDevSection>

              <ExpDevSection id="pe-blocks" title="Block zones (Dev)" defaultOpen={false}>
                <p className="exp-hint">
                  Stand where visitors should not go (e.g. toward open stairs). Creates a soft box barrier on this floor
                  only.
                </p>
                <input
                  value={blockLabel}
                  onChange={(e) => setBlockLabel(e.target.value)}
                  placeholder="Label (e.g. Stair void)"
                />
                <button type="button" onClick={addBlockZoneHere}>
                  Add block zone here
                </button>
                <ul className="pe-vp-list">
                  {(activeFloor.blockZones ?? []).map((z) => (
                    <li key={z.id}>
                      <span>
                        {z.label} {z.enabled ? "" : "[off]"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patchConfig((c) => ({
                            ...c,
                            floors: c.floors.map((f) =>
                              f.id === activeFloor.id
                                ? { ...f, blockZones: (f.blockZones ?? []).filter((b) => b.id !== z.id) }
                                : f,
                            ),
                          }))
                        }
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </ExpDevSection>

              <ExpDevSection id="pe-rooms" title="Rooms / checkpoints" defaultOpen>
                <button type="button" className={pendingSample ? "on" : ""} onClick={() => setSampleToken((n) => n + 1)}>
                  1. Capture pose
                </button>
                {pendingSample && <div className="exp-hint ok">Pose locked</div>}
                <input placeholder="2. Name (e.g. Living Room)" value={vpName} onChange={(e) => setVpName(e.target.value)} />
                <input placeholder="Room label (optional)" value={vpRoom} onChange={(e) => setVpRoom(e.target.value)} />
                <button type="button" disabled={!pendingSample || !vpName.trim()} onClick={addCheckpoint}>
                  Add Room / Checkpoint
                </button>
                <ul className="pe-vp-list">
                  {activeFloor.viewpoints.map((vp) => (
                    <li key={vp.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setFlyTo({
                            viewpoint: viewpointToExperience(vp, activeFloor.id),
                            token: Date.now(),
                            transition: "fade",
                          })
                        }
                      >
                        Preview {vp.name}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchConfig((c) => ({
                            ...c,
                            floors: c.floors.map((f) =>
                              f.id === activeFloor.id
                                ? { ...f, viewpoints: f.viewpoints.filter((x) => x.id !== vp.id) }
                                : f,
                            ),
                          }))
                        }
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </ExpDevSection>

              <ExpDevSection id="pe-stairs" title="Floor connections (stairs)" defaultOpen={false}>
                <p className="exp-hint">
                  First→Ground is seeded from the upstairs stop point. Walking into the trigger shows the confirm
                  modal; a soft block zone stops the void. Edit or add more connections below.
                </p>
                <input value={connLabel} onChange={(e) => setConnLabel(e.target.value)} placeholder="Visitor label" />
                <select value={connDestId} onChange={(e) => setConnDestId(e.target.value)}>
                  {config.floors
                    .filter((f) => f.id !== activeFloor.id)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
                <button type="button" onClick={placeConnectionTrigger}>
                  Create Floor Connection
                </button>
                <button type="button" onClick={saveArrivalForLastConnection}>
                  Save arrival for connection → this floor
                </button>
                <ul className="pe-vp-list">
                  {config.connections.map((c) => (
                    <li key={c.id}>
                      <span>
                        {c.label} ({c.sourceFloorId} → {c.destFloorId}) {c.enabled ? "" : "[off]"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patchConfig((cfg) => ({
                            ...cfg,
                            connections: cfg.connections.filter((x) => x.id !== c.id),
                          }))
                        }
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </ExpDevSection>

              <ExpDevSection id="pe-io" title="Save / export" defaultOpen={false}>
                <div className="exp-dev-row">
                  <button type="button" onClick={persist}>
                    Save Draft
                  </button>
                  <button type="button" onClick={runValidate}>
                    Validate Experience
                  </button>
                  <button type="button" onClick={() => downloadExperienceJson(config)}>
                    Export Experience JSON
                  </button>
                </div>
                <label className="sv-file">
                  Import Experience JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => void onImportFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {statusMsg && <p className="exp-hint ok">{statusMsg}</p>}
                {validation.length > 0 && (
                  <ul className="pe-validation">
                    {validation.map((v, i) => (
                      <li key={i} className={v.level}>
                        {v.level}: {v.message}
                      </li>
                    ))}
                  </ul>
                )}
              </ExpDevSection>

              <button type="button" onClick={() => setRole("visitor")}>
                Switch to Visitor Preview
              </button>
            </div>
          )}
        </aside>
      )}

      {!panelOpen && (
        <button type="button" className="pe-panel-tab" onClick={() => setPanelOpen(true)}>
          Panel
        </button>
      )}

      {helpOpen && (
        <div className="pe-help" role="dialog">
          <h2>How to move</h2>
          <ul>
            <li>
              <b>Walk</b>: WASD / pads · drag to look · Esc cancels Point & Move
            </li>
            <li>
              <b>Point & Move</b>: click the floor to walk there (collision-checked). WASD or Esc cancels.
            </li>
            <li>
              <b>Orbit</b>: drag to orbit · double-click a surface to set the pivot
            </li>
            <li>
              <b>Floors</b>: Change Floor / Floors — each floor has its own start
            </li>
            <li>
              <b>Graphics</b>: Eco → Ultra caps how many Gaussians draw (your files have ~13M; the GPU never draws all at once)
            </li>
          </ul>
          <button type="button" onClick={() => setHelpOpen(false)}>
            Got it
          </button>
        </div>
      )}

      {isAuthor && pose && (
        <div className="pe-pose-chip">
          pos {pose.position.map((n) => n.toFixed(2)).join(", ")}
        </div>
      )}
    </div>
  );
}

function FloorMenu({
  floors,
  activeId,
  onPick,
}: {
  floors: FloorRecord[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <label className="pe-floor-select">
      Change Floor
      <select value={activeId} onChange={(e) => onPick(e.target.value)}>
        {floors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AuthorDock({
  config,
  statusMsg,
  validation,
  onPersist,
  onValidate,
  onExport,
  onImportFile,
  onResetSeed,
  onEnterFloor,
}: {
  config: PropertyExperienceConfig;
  statusMsg: string | null;
  validation: ValidationIssue[];
  onPersist: () => void;
  onValidate: () => void;
  onExport: () => void;
  onImportFile: (f: File | null) => void;
  onResetSeed: () => void;
  onEnterFloor: (id: string) => void;
}) {
  return (
    <div className="pe-dock-card">
      <b>Author tools</b>
      <p className="exp-hint">
        Models: {config.floors.map((f) => f.name).join(" · ")}. Extract LCC packages before entering a floor.
      </p>
      <div className="exp-dev-row">
        {sortedFloors(config).map((f) => (
          <button key={f.id} type="button" onClick={() => onEnterFloor(f.id)}>
            Author {f.name}
          </button>
        ))}
      </div>
      <div className="exp-dev-row">
        <button type="button" onClick={onPersist}>
          Save Draft
        </button>
        <button type="button" onClick={onValidate}>
          Validate
        </button>
        <button type="button" onClick={onExport}>
          Export JSON
        </button>
        <button type="button" onClick={onResetSeed}>
          Reset seed
        </button>
      </div>
      <label className="sv-file">
        Import JSON
        <input type="file" accept="application/json,.json" onChange={(e) => onImportFile(e.target.files?.[0] ?? null)} />
      </label>
      {statusMsg && <p className="exp-hint ok">{statusMsg}</p>}
      {validation.map((v, i) => (
        <p key={i} className={`exp-hint${v.level === "error" ? "" : " ok"}`}>
          {v.level}: {v.message}
        </p>
      ))}
    </div>
  );
}
