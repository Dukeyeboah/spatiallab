"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WalkOnScreenControls } from "@/components/labs/experiences/WalkOnScreenControls";
import { HousePointsLoader } from "@/components/labs/experiences/HousePointsLoader";
import {
  Prod02aHost,
  type Prod02aBlockDenied,
  type Prod02aBlockVisual,
  type Prod02aBlockZone,
  type Prod02aHostHandle,
  type Prod02aHostStats,
  type Prod02aNavKind,
  type Prod02aSceneProp,
} from "@/components/labs/prod02a/Prod02aHost";
import {
  loadProd02aQualityId,
  PROD02A_QUALITY,
  PROD02A_QUALITY_ORDER,
  saveProd02aQualityId,
  type Prod02aQualityId,
} from "@/lib/labs/prod02a/qualityPresets";
import {
  DEFAULT_SMOOTH_TUNING,
  normalizeTuning,
  type FollowCameraStyle,
  type SmoothNavTuning,
} from "@/lib/labs/prod02a/smoothAvatarControls";
import { APPROVED_ORB, approvedOrbCameraTuning } from "@/lib/labs/prod02b/orbConfig";
import {
  DEFAULT_VISUAL_AVATAR_TUNING,
  type VisualAvatarTuning,
} from "@/lib/labs/prod02b/visualAvatar";
import {
  HENNA_DATA_PATH,
  HENNA_EXPERIENCE_JSON_PATH,
  HENNA_PROP_CATALOG,
  HENNA_PROPERTY_ID,
  HENNA_START_PREVIEW,
  hennaLocationPreview,
  hennaPropByKind,
  type HennaPropKind,
} from "@/lib/labs/prod03/assets";
import {
  clearProd03Draft,
  downloadProd03Json,
  loadProd03Draft,
  parseProd03Json,
  saveProd03Draft,
} from "@/lib/labs/prod03/storage";
import {
  createHennaSeed,
  PROD03_DEFAULT_BLOCK_MESSAGE,
  PROD03_SPRINT_PRESETS,
  type Prod03Barrier,
  type Prod03BlockVisual,
  type Prod03CameraPose,
  type Prod03ExperienceConfig,
  type Prod03Location,
  type Prod03NavMode,
  type Prod03PropPlacement,
  type Prod03SprintMultiplier,
} from "@/lib/labs/prod03/types";
import { LCC_SDK_VERSION_LABEL } from "@/lib/labs/lccSdk";
import type { Prod02aStartPose } from "@/lib/labs/prod02a/assets";

type Role = "visitor" | "author";

function navModeToKind(mode: Prod03NavMode): Prod02aNavKind {
  if (mode === "walk") return "current";
  if (mode === "orbit") return "orbit";
  return "smooth";
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Keep yaw in (−π, π] so the range slider stays in sync. */
function wrapYaw(rad: number) {
  let y = rad;
  while (y > Math.PI) y -= Math.PI * 2;
  while (y <= -Math.PI) y += Math.PI * 2;
  return y;
}

const YAW_STEP_DEG = [15, 30, 45, 60, 90] as const;

/**
 * Isolated PROD-03 — outdoor Henna Road. Does not modify PROD-01 / PROD-02.
 */
export function Prod03Lab() {
  const [role, setRole] = useState<Role>("visitor");
  const [config, setConfig] = useState<Prod03ExperienceConfig>(() => createHennaSeed());
  const [navMode, setNavMode] = useState<Prod03NavMode>("avatar");
  const [followStyle, setFollowStyle] = useState<FollowCameraStyle>("free");
  const [qualityId, setQualityId] = useState<Prod02aQualityId>("high");
  const [collisionOn, setCollisionOn] = useState(true);
  const [showBlockDebug, setShowBlockDebug] = useState(true);
  const [devOpen, setDevOpen] = useState(true);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  /** On by default (phones + desktop); forced back on when entering Visitor Preview. */
  const [padsOpen, setPadsOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);
  const [stats, setStats] = useState<Prod02aHostStats | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [liveEye, setLiveEye] = useState<[number, number, number] | null>(null);
  const [barrierLabel, setBarrierLabel] = useState("Road barrier");
  const [locationName, setLocationName] = useState("Viewpoint");
  const [selectedBarrierId, setSelectedBarrierId] = useState<string | null>(null);
  const [propKind, setPropKind] = useState<HennaPropKind>("cone");
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [blockNotice, setBlockNotice] = useState<string | null>(null);
  /** One-shot arrival (location shortcut) — does not overwrite authored start. */
  const [arrivalPose, setArrivalPose] = useState<Prod02aStartPose | null>(null);

  const hostRef = useRef<Prod02aHostHandle | null>(null);
  const blockNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quality = PROD02A_QUALITY[qualityId];
  const isAuthor = role === "author";
  const showOrb = navMode === "avatar";

  const mixamo: VisualAvatarTuning = useMemo(
    () => ({
      ...DEFAULT_VISUAL_AVATAR_TUNING,
      visible: showOrb,
      avatarId: "orb",
      scale: config.avatar.scale || APPROVED_ORB.scale,
      facingOffset: APPROVED_ORB.facingOffset,
      closeFadeDistance: APPROVED_ORB.closeFadeDistance,
    }),
    [showOrb, config.avatar.scale],
  );

  const sprintMultiplier: Prod03SprintMultiplier =
    config.avatar.sprintMultiplier === 2.5 ||
    config.avatar.sprintMultiplier === 3.5 ||
    config.avatar.sprintMultiplier === 4.5 ||
    config.avatar.sprintMultiplier === 5.5
      ? config.avatar.sprintMultiplier
      : 4.5;

  const AXIS_NUDGE_M = [0.25, 1, 5] as const;

  const tuning: SmoothNavTuning = useMemo(
    () =>
      normalizeTuning({
        ...DEFAULT_SMOOTH_TUNING,
        ...approvedOrbCameraTuning(followStyle),
        followStyle,
        // Outdoor road: brisk walk + selectable Shift sprint.
        walkSpeed: 2.4,
        sprintMultiplier,
        acceleration: 14,
        deceleration: 12,
      }),
    [sprintMultiplier, followStyle],
  );

  const startPose: Prod02aStartPose | null = useMemo(() => {
    if (arrivalPose) return arrivalPose;
    const cam = config.startCamera;
    if (!cam) return null;
    return {
      eye: cam.position,
      target: cam.target,
      eyeHeight: cam.eyeHeight,
      source: "prod01-draft",
    };
  }, [arrivalPose, config.startCamera]);

  const blockZones: Prod02aBlockZone[] = useMemo(
    () =>
      config.barriers.map((b) => ({
        id: b.id,
        enabled: b.enabled,
        center: b.center,
        size: b.size,
        yaw: b.yaw ?? 0,
        message: b.denyMessage?.trim() || PROD03_DEFAULT_BLOCK_MESSAGE,
      })),
    [config.barriers],
  );

  const hostBlockVisual: Prod02aBlockVisual = useMemo(() => {
    if (isAuthor && showBlockDebug && devOpen) return "wire";
    return config.blockVisual === "glass" ? "glass" : "hidden";
  }, [isAuthor, showBlockDebug, devOpen, config.blockVisual]);

  // Construction props stay visible in Visitor Preview; only road blocks use blockVisual=hidden.
  const sceneProps: Prod02aSceneProp[] = useMemo(
    () =>
      (config.props ?? []).map((p) => ({
        id: p.id,
        url: hennaPropByKind(p.kind).url,
        position: p.position,
        yaw: p.yaw,
        scale: p.scale,
        visible: p.visible !== false,
      })),
    [config.props],
  );

  useEffect(() => {
    let cancelled = false;
    setQualityId(loadProd02aQualityId());
    const params = new URLSearchParams(window.location.search);
    if (params.get("author") === "1") setRole("author");
    const draft = loadProd03Draft(HENNA_PROPERTY_ID);
    if (draft) {
      setConfig(draft);
      setNavMode(draft.defaultNavMode);
      setQualityId(draft.defaultQualityId);
      return;
    }
    void fetch(HENNA_EXPERIENCE_JSON_PATH)
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => {
        if (cancelled || !text) return;
        try {
          const packed = parseProd03Json(text);
          setConfig(packed);
          setNavMode(packed.defaultNavMode);
          setQualityId(packed.defaultQualityId);
          setStatusMsg("Loaded packaged Henna Road draft (9 road blocks).");
        } catch (err) {
          console.warn("[prod03] packaged experience failed", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (blockNoticeTimer.current) clearTimeout(blockNoticeTimer.current);
    };
  }, []);

  const persist = useCallback(() => {
    setConfig((prev) => {
      const saved = saveProd03Draft(prev);
      setStatusMsg(`Draft saved · ${saved.updatedAt}`);
      return saved;
    });
  }, []);

  const patchConfig = useCallback((fn: (c: Prod03ExperienceConfig) => Prod03ExperienceConfig) => {
    setConfig((prev) => fn(prev));
  }, []);

  const setQuality = (id: Prod02aQualityId) => {
    setQualityId(id);
    saveProd02aQualityId(id);
    patchConfig((c) => ({ ...c, defaultQualityId: id }));
  };

  const samplePose = (): Prod03CameraPose | null => {
    const snap = hostRef.current?.getCameraDebug() ?? stats?.camera ?? null;
    // Prefer body eye height — follow `target` sits ~chest and buried checkpoints.
    if (snap?.eye) {
      const yaw = snap.bodyYaw ?? 0;
      const pos: [number, number, number] = [snap.eye[0], snap.eye[1], snap.eye[2]];
      const target: [number, number, number] = [
        pos[0] - Math.sin(yaw) * 2.5,
        pos[1] - 0.1,
        pos[2] - Math.cos(yaw) * 2.5,
      ];
      return { position: pos, target, yaw, eyeHeight: tuning.eyeHeight };
    }
    if (liveEye) {
      return {
        position: liveEye,
        target: [liveEye[0], liveEye[1] - 0.1, liveEye[2] - 2.5],
        eyeHeight: tuning.eyeHeight,
      };
    }
    return null;
  };

  const onStats = useCallback((s: Prod02aHostStats) => {
    setStats(s);
    if (s.camera?.eye) {
      setLiveEye([s.camera.eye[0], s.camera.eye[1], s.camera.eye[2]]);
    }
  }, []);

  const saveStartHere = () => {
    const pose = samplePose();
    if (!pose) {
      setStatusMsg("Walk to the spot first (pose not ready).");
      return;
    }
    setConfig((prev) => {
      const saved = saveProd03Draft({ ...prev, startCamera: pose });
      setStatusMsg("Starting point set and saved. Reloads / visitors begin here.");
      return saved;
    });
    setArrivalPose(null);
  };

  const onBlockDenied = useCallback((info: Prod02aBlockDenied) => {
    setBlockNotice(info.message);
    if (blockNoticeTimer.current) clearTimeout(blockNoticeTimer.current);
    blockNoticeTimer.current = setTimeout(() => setBlockNotice(null), 3200);
  }, []);

  const addBarrierHere = () => {
    const pose = samplePose();
    if (!pose) {
      setStatusMsg("Walk to the barrier spot first.");
      return;
    }
    const barrier: Prod03Barrier = {
      id: newId("barrier"),
      label: barrierLabel.trim() || "Barrier",
      enabled: true,
      center: [pose.position[0], pose.position[1] - 0.2, pose.position[2]],
      size: [4.0, 2.8, 0.45],
      yaw: pose.yaw ?? 0,
      denyMessage: PROD03_DEFAULT_BLOCK_MESSAGE,
    };
    patchConfig((c) => ({ ...c, barriers: [...c.barriers, barrier] }));
    setSelectedBarrierId(barrier.id);
    setStatusMsg(`Added “${barrier.label}” — Save draft to keep it.`);
  };

  const addPropHere = () => {
    const pose = samplePose();
    if (!pose) {
      setStatusMsg("Walk to where the prop should stand first.");
      return;
    }
    const catalog = hennaPropByKind(propKind);
    const yaw = pose.yaw ?? 0;
    const prop: Prod03PropPlacement = {
      id: newId("prop"),
      kind: catalog.kind,
      label: catalog.label,
      position: [pose.position[0], pose.position[1] - (tuning.eyeHeight - 0.02), pose.position[2]],
      yaw,
      scale: catalog.defaultScale,
      visible: true,
    };
    patchConfig((c) => ({ ...c, props: [...(c.props ?? []), prop] }));
    setSelectedPropId(prop.id);
    setStatusMsg(`Placed “${prop.label}” — scale/rotate below, then Save draft.`);
  };

  const updateProp = (id: string, partial: Partial<Prod03PropPlacement>) => {
    patchConfig((c) => ({
      ...c,
      props: (c.props ?? []).map((p) => (p.id === id ? { ...p, ...partial } : p)),
    }));
  };

  const nudgeProp = (id: string, axis: 0 | 1 | 2, delta: number) => {
    const prop = (config.props ?? []).find((p) => p.id === id);
    if (!prop) return;
    const position: [number, number, number] = [
      prop.position[0],
      prop.position[1],
      prop.position[2],
    ];
    position[axis] += delta;
    updateProp(id, { position });
  };

  const deleteProp = (id: string) => {
    patchConfig((c) => ({ ...c, props: (c.props ?? []).filter((p) => p.id !== id) }));
    if (selectedPropId === id) setSelectedPropId(null);
  };

  const duplicateBarrier = (id: string) => {
    const src = config.barriers.find((b) => b.id === id);
    if (!src) return;
    const copy: Prod03Barrier = {
      ...src,
      id: newId("barrier"),
      label: `${src.label} copy`,
      center: [src.center[0] + 1.2, src.center[1], src.center[2]],
    };
    patchConfig((c) => ({ ...c, barriers: [...c.barriers, copy] }));
    setSelectedBarrierId(copy.id);
  };

  const updateBarrier = (id: string, partial: Partial<Prod03Barrier>) => {
    patchConfig((c) => ({
      ...c,
      barriers: c.barriers.map((b) => (b.id === id ? { ...b, ...partial } : b)),
    }));
  };

  const nudgeBarrier = (id: string, axis: 0 | 1 | 2, delta: number) => {
    const barrier = config.barriers.find((b) => b.id === id);
    if (!barrier) return;
    const center: [number, number, number] = [
      barrier.center[0],
      barrier.center[1],
      barrier.center[2],
    ];
    center[axis] += delta;
    updateBarrier(id, { center });
  };

  const deleteBarrier = (id: string) => {
    patchConfig((c) => ({ ...c, barriers: c.barriers.filter((b) => b.id !== id) }));
    if (selectedBarrierId === id) setSelectedBarrierId(null);
  };

  const addLocationHere = () => {
    const pose = samplePose();
    if (!pose) {
      setStatusMsg("Walk to the location first.");
      return;
    }
    const name = locationName.trim() || "Viewpoint";
    const loc: Prod03Location = {
      id: newId("loc"),
      name,
      order: config.locations.length,
      position: pose.position,
      target: pose.target,
      yaw: pose.yaw,
      previewImageUrl: hennaLocationPreview(name) ?? undefined,
      visitorVisible: true,
      showInScene: true,
    };
    patchConfig((c) => ({ ...c, locations: [...c.locations, loc] }));
    setStatusMsg(`Location “${loc.name}” added — Save draft to keep it.`);
  };

  const goToLocation = (loc: Prod03Location) => {
    setLoading(true);
    setArrivalPose({
      eye: loc.position,
      target: loc.target,
      eyeHeight: config.startCamera?.eyeHeight ?? tuning.eyeHeight,
      source: "prod01-draft",
    });
    setLoadKey((k) => k + 1);
  };

  const selected = config.barriers.find((b) => b.id === selectedBarrierId) ?? null;
  const selectedProp = (config.props ?? []).find((p) => p.id === selectedPropId) ?? null;
  const selectedCatalog = hennaPropByKind(propKind);

  const visitorLocations = useMemo(() => {
    const locs = config.locations
      .filter((l) => l.visitorVisible !== false)
      .map((l) => ({
        ...l,
        previewImageUrl: hennaLocationPreview(l.name, l.previewImageUrl) ?? undefined,
      }));
    const start = config.startCamera;
    if (!start) return locs;
    const startLoc: Prod03Location = {
      id: "__start__",
      name: "Starting point",
      order: -1,
      position: start.position,
      target: start.target,
      yaw: start.yaw,
      previewImageUrl:
        config.startPreviewImageUrl?.trim() ||
        hennaLocationPreview("Starting point") ||
        HENNA_START_PREVIEW,
      visitorVisible: true,
      showInScene: false,
    };
    return [startLoc, ...locs];
  }, [config.locations, config.startCamera, config.startPreviewImageUrl]);

  useEffect(() => {
    if (!isAuthor) setPadsOpen(true);
  }, [isAuthor]);

  const walkApi = useMemo(
    () => ({
      setVirtualMove: (x: number, z: number) => hostRef.current?.setVirtualMove(x, z),
      setVirtualLook: (yaw: number, pitch: number) => hostRef.current?.setVirtualLook(yaw, pitch),
      clearVirtualInput: () => hostRef.current?.clearVirtualInput(),
    }),
    [],
  );

  return (
    <div className="p2a-root">
      <Prod02aHost
        key={`${HENNA_DATA_PATH}-${loadKey}-${startPose?.source ?? "auto"}`}
        ref={hostRef}
        dataPath={HENNA_DATA_PATH}
        navKind={navModeToKind(navMode)}
        quality={quality}
        tuning={tuning}
        collisionEnabled={collisionOn}
        showCapsule={false}
        showCameraDebug={false}
        showMixamoAvatar={showOrb}
        enableAvatarLocomotion={showOrb}
        mixamoTuning={mixamo}
        blockZones={blockZones}
        blockVisual={hostBlockVisual}
        sceneProps={sceneProps}
        suppressTouchLook={false}
        fov={APPROVED_ORB.fov}
        startPose={startPose}
        onStats={onStats}
        onReady={() => setLoading(false)}
        onBlockDenied={onBlockDenied}
        enablePointMove={navMode !== "orbit"}
        onPointMoveRejected={(reason) => {
          setStatusMsg(reason);
          setBlockNotice(reason);
          if (blockNoticeTimer.current) clearTimeout(blockNoticeTimer.current);
          blockNoticeTimer.current = setTimeout(() => setBlockNotice(null), 2800);
        }}
      />

      {loading && (
        <div className="p2a-loading">
          <HousePointsLoader
            progress={Math.min(1, Math.max(0.05, stats?.phase === "ready" ? 1 : (stats?.progress ?? 0.08)))}
            label={`PROD-03 · ${config.property.title}`}
          />
        </div>
      )}

      {blockNotice ? (
        <div className="p2a-block-toast" role="status" aria-live="polite">
          <strong>No access</strong>
          <p>{blockNotice}</p>
        </div>
      ) : null}

      <aside className={`p2a-panel${devOpen || !isAuthor ? " open" : ""}${panelCollapsed ? " collapsed" : ""}`}>
        <div className="p2a-panel-head">
          <div>
            <div className="p2a-brand">PROD-03</div>
            {!panelCollapsed ? (
              <>
                <h1>{config.property.title}</h1>
                <p className="p2a-sub">
                  {config.property.category} · SDK {LCC_SDK_VERSION_LABEL}
                </p>
              </>
            ) : (
              <h1 className="p2a-panel-mini-title">03</h1>
            )}
          </div>
          <div className="p2a-panel-actions">
            {!panelCollapsed ? (
              <Link href="/labs/prod-02b" className="p2a-link">
                02B
              </Link>
            ) : null}
            <button
              type="button"
              className="p2a-panel-toggle"
              onClick={() => setPanelCollapsed((c) => !c)}
            >
              {panelCollapsed ? "Expand" : "Minimize"}
            </button>
          </div>
        </div>

        {!panelCollapsed ? (
          <>
            <div className="p2a-stats">
              {stats?.phase ?? "…"} · {stats?.fps ?? "—"} fps · collision{" "}
              {stats?.hasCollision ? "yes" : "no"} · {stats?.format ?? "?"}
            </div>
            {statusMsg ? <p className="p2a-hint">{statusMsg}</p> : null}

            <div className="pe-section-label">Locations</div>
            {visitorLocations.length > 0 ? (
              <div className="p2a-loc-grid">
                {visitorLocations.map((loc) => {
                  const thumb = hennaLocationPreview(loc.name, loc.previewImageUrl);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      className="p2a-loc-card"
                      onClick={() => goToLocation(loc)}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="p2a-loc-thumb" />
                      ) : (
                        <span className="p2a-loc-thumb p2a-loc-thumb-empty" />
                      )}
                      <span className="p2a-loc-label">{loc.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="exp-hint pe-nav-hint">No start or checkpoints yet.</p>
            )}

            <div className="pe-section-label">Motion</div>
            <div className="pe-nav-modes" role="group" aria-label="Motion mode">
              {(
                [
                  ["walk", "Walk"],
                  ["avatar", "Avatar"],
                  ["orbit", "Orbit"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={navMode === id ? "on" : ""}
                  onClick={() => {
                    setNavMode(id);
                    patchConfig((c) => ({ ...c, defaultNavMode: id }));
                    hostRef.current?.clearVirtualInput();
                    hostRef.current?.cancelAutoMove();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="exp-hint pe-nav-hint">
              Walk = first-person. Avatar = Orb Assistant + follow camera. Orbit = look around. Click
              the ground to walk there.
            </p>

            {navMode === "avatar" ? (
              <div className="pe-nav-modes" role="group" aria-label="Camera follow style">
                {(
                  [
                    ["free", "Free Follow"],
                    ["ecctrl", "Ecctrl Orbit"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={followStyle === id ? "on" : ""}
                    onClick={() => {
                      setFollowStyle(id);
                      hostRef.current?.clearVirtualInput();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {navMode !== "orbit" ? (
              <label className="p2a-slider p2a-sprint-lever">
                <span>
                  Shift sprint <i>{sprintMultiplier.toFixed(1)}×</i>
                </span>
                <input
                  type="range"
                  min={2.5}
                  max={5.5}
                  step={1}
                  value={sprintMultiplier}
                  onChange={(e) => {
                    const v = Number(e.target.value) as Prod03SprintMultiplier;
                    const snapped = (PROD03_SPRINT_PRESETS as readonly number[]).includes(v)
                      ? v
                      : 4.5;
                    patchConfig((c) => ({
                      ...c,
                      avatar: { ...c.avatar, sprintMultiplier: snapped },
                    }));
                  }}
                />
                <span className="p2a-sprint-ticks">
                  {PROD03_SPRINT_PRESETS.map((m) => (
                    <i key={m}>{m}×</i>
                  ))}
                </span>
              </label>
            ) : null}

            <div className="pe-section-label">Rendering quality</div>
            <div className="pe-nav-modes" role="group" aria-label="Rendering quality">
              {PROD02A_QUALITY_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={qualityId === id ? "on" : ""}
                  onClick={() => setQuality(id)}
                  title={PROD02A_QUALITY[id].note}
                >
                  {PROD02A_QUALITY[id].label}
                </button>
              ))}
            </div>
            <p className="exp-hint pe-nav-hint">{quality.note}</p>

            <div className="p2a-row">
              <button
                type="button"
                className={role === "author" ? "on" : ""}
                onClick={() => setRole((r) => (r === "author" ? "visitor" : "author"))}
              >
                {role === "author" ? "Author" : "Visitor Preview"}
              </button>
              <button
                type="button"
                className={padsOpen ? "on" : ""}
                onClick={() => setPadsOpen((v) => !v)}
              >
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
            </div>

            {isAuthor && (
              <div className="p2a-dev">
                <label className="p2a-check">
                  <input
                    type="checkbox"
                    checked={devOpen}
                    onChange={(e) => setDevOpen(e.target.checked)}
                  />
                  Dev Mode
                </label>
                <label className="p2a-check">
                  <input
                    type="checkbox"
                    checked={collisionOn}
                    onChange={(e) => setCollisionOn(e.target.checked)}
                  />
                  Walk + camera collision
                </label>
                <label className="p2a-check">
                  <input
                    type="checkbox"
                    checked={showBlockDebug}
                    onChange={(e) => setShowBlockDebug(e.target.checked)}
                  />
                  Author wireframes (Dev only)
                </label>
                <b className="p2a-dev-h">Visitor block look</b>
                <div className="p2a-row">
                  {(
                    [
                      ["hidden", "Invisible"],
                      ["glass", "Frosted glass"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={(config.blockVisual ?? "hidden") === id ? "on" : ""}
                      onClick={() =>
                        patchConfig((c) => ({ ...c, blockVisual: id as Prod03BlockVisual }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="p2a-hint">
                  Visitor Preview never shows wireframes. Frosted glass only appears nearby and fades
                  with distance.
                </p>

                <b className="p2a-dev-h">Starting point</b>
                <p className="p2a-hint">
                  {config.startCamera
                    ? `Saved @ (${config.startCamera.position.map((n) => n.toFixed(2)).join(", ")})`
                    : "None yet — walk to a safe road spot, then set it."}
                </p>
                <button type="button" onClick={saveStartHere}>
                  Set as starting point
                </button>

                <b className="p2a-dev-h">Road blocks</b>
                <p className="p2a-hint">
                  Place blockers where the road is closed. Visitors bounce back and see “under
                  construction”. Wireframes only in Dev.
                </p>
                <label className="p2a-slider">
                  <span>Label</span>
                  <input
                    type="text"
                    value={barrierLabel}
                    onChange={(e) => setBarrierLabel(e.target.value)}
                  />
                </label>
                <button type="button" onClick={addBarrierHere}>
                  Add road block here
                </button>
                {config.barriers.map((b) => (
                  <div key={b.id} className="p2a-hint" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className={selectedBarrierId === b.id ? "on" : ""}
                      onClick={() => setSelectedBarrierId(b.id)}
                    >
                      {b.enabled ? "●" : "○"} {b.label}
                    </button>{" "}
                    <button type="button" onClick={() => duplicateBarrier(b.id)}>
                      Dup
                    </button>{" "}
                    <button type="button" onClick={() => deleteBarrier(b.id)}>
                      Del
                    </button>
                  </div>
                ))}
                {selected ? (
                  <div style={{ marginTop: 8 }}>
                    <label className="p2a-check">
                      <input
                        type="checkbox"
                        checked={selected.enabled}
                        onChange={(e) => updateBarrier(selected.id, { enabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                    <label className="p2a-slider">
                      <span>Access message</span>
                      <input
                        type="text"
                        value={selected.denyMessage ?? PROD03_DEFAULT_BLOCK_MESSAGE}
                        onChange={(e) => updateBarrier(selected.id, { denyMessage: e.target.value })}
                      />
                    </label>
                    <label className="p2a-slider">
                      <span>
                        Yaw <i>{(((selected.yaw ?? 0) * 180) / Math.PI).toFixed(0)}°</i>
                      </span>
                      <input
                        type="range"
                        min={-Math.PI}
                        max={Math.PI}
                        step={Math.PI / 180}
                        value={selected.yaw ?? 0}
                        onChange={(e) =>
                          updateBarrier(selected.id, { yaw: wrapYaw(Number(e.target.value)) })
                        }
                      />
                    </label>
                    <p className="p2a-hint">Rotate by</p>
                    <div className="p2a-row" style={{ flexWrap: "wrap" }}>
                      {[...YAW_STEP_DEG].reverse().map((deg) => (
                        <button
                          key={`b-${deg}`}
                          type="button"
                          onClick={() =>
                            updateBarrier(selected.id, {
                              yaw: wrapYaw((selected.yaw ?? 0) - (deg * Math.PI) / 180),
                            })
                          }
                        >
                          −{deg}°
                        </button>
                      ))}
                      {YAW_STEP_DEG.map((deg) => (
                        <button
                          key={`b+${deg}`}
                          type="button"
                          onClick={() =>
                            updateBarrier(selected.id, {
                              yaw: wrapYaw((selected.yaw ?? 0) + (deg * Math.PI) / 180),
                            })
                          }
                        >
                          +{deg}°
                        </button>
                      ))}
                    </div>
                    {(
                      [
                        ["size.0", "Length X", selected.size[0], 0.4, 40],
                        ["size.1", "Height Y", selected.size[1], 0.5, 8],
                        ["size.2", "Thickness Z", selected.size[2], 0.2, 8],
                      ] as const
                    ).map(([key, label, value, min, max]) => (
                      <label key={key} className="p2a-slider">
                        <span>
                          {label} <i>{value.toFixed(2)} m</i>
                        </span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={0.05}
                          value={value}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            const idx = Number(key.split(".")[1]) as 0 | 1 | 2;
                            const size = [...selected.size] as [number, number, number];
                            size[idx] = v;
                            updateBarrier(selected.id, { size });
                          }}
                        />
                      </label>
                    ))}
                    <b className="p2a-dev-h" style={{ marginTop: 8 }}>
                      Block position
                    </b>
                    {(
                      [
                        [0, "X (side)", -300, 300],
                        [1, "Y (raise)", -20, 30],
                        [2, "Z (along)", -300, 300],
                      ] as const
                    ).map(([axis, label, min, max]) => (
                      <div key={`barrier-pos-${axis}`} style={{ marginBottom: 8 }}>
                        <label className="p2a-slider">
                          <span>
                            {label} <i>{selected.center[axis].toFixed(2)} m</i>
                          </span>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={0.05}
                            value={selected.center[axis]}
                            onChange={(e) => {
                              const center: [number, number, number] = [
                                selected.center[0],
                                selected.center[1],
                                selected.center[2],
                              ];
                              center[axis] = Number(e.target.value);
                              updateBarrier(selected.id, { center });
                            }}
                          />
                        </label>
                        <div className="p2a-row" style={{ flexWrap: "wrap" }}>
                          {[...AXIS_NUDGE_M].reverse().map((m) => (
                            <button
                              key={`b${axis}-n${m}`}
                              type="button"
                              onClick={() => nudgeBarrier(selected.id, axis, -m)}
                            >
                              −{m}
                            </button>
                          ))}
                          {AXIS_NUDGE_M.map((m) => (
                            <button
                              key={`b${axis}+${m}`}
                              type="button"
                              onClick={() => nudgeBarrier(selected.id, axis, m)}
                            >
                              +{m}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="p2a-row">
                      <button
                        type="button"
                        onClick={() => {
                          const pose = samplePose();
                          if (!pose) return;
                          updateBarrier(selected.id, { yaw: wrapYaw(pose.yaw ?? 0) });
                        }}
                      >
                        Face my view
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const pose = samplePose();
                          if (!pose) return;
                          updateBarrier(selected.id, {
                            center: [
                              pose.position[0],
                              pose.position[1] - 0.2,
                              pose.position[2],
                            ],
                            yaw: wrapYaw(pose.yaw ?? selected.yaw ?? 0),
                          });
                        }}
                      >
                        Move to me
                      </button>
                    </div>
                    <p className="p2a-hint">
                      Tip: Dup a block, then nudge X/Z to build connected road-edge segments.
                    </p>
                  </div>
                ) : null}

                <b className="p2a-dev-h">Construction props</b>
                <p className="p2a-hint">
                  Dress blocked stretches with signs / barricades / cones. Place at your feet, then scale.
                  {selectedCatalog.note ? ` ${selectedCatalog.note}` : ""}
                </p>
                <label className="p2a-slider">
                  <span>Prop</span>
                  <select
                    value={propKind}
                    onChange={(e) => setPropKind(e.target.value as HennaPropKind)}
                  >
                    {HENNA_PROP_CATALOG.map((item) => (
                      <option key={item.kind} value={item.kind}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={addPropHere}>
                  Place prop here
                </button>
                {(config.props ?? []).map((p) => (
                  <div key={p.id} className="p2a-hint" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className={selectedPropId === p.id ? "on" : ""}
                      onClick={() => setSelectedPropId(p.id)}
                    >
                      {p.label}
                    </button>{" "}
                    <button type="button" onClick={() => deleteProp(p.id)}>
                      Del
                    </button>
                  </div>
                ))}
                {selectedProp ? (
                  <div style={{ marginTop: 8 }}>
                    <label className="p2a-slider">
                      <span>
                        Scale <i>×{selectedProp.scale.toFixed(2)}</i>
                      </span>
                      <input
                        type="range"
                        min={0.05}
                        max={8}
                        step={0.05}
                        value={selectedProp.scale}
                        onChange={(e) => updateProp(selectedProp.id, { scale: Number(e.target.value) })}
                      />
                    </label>
                    <label className="p2a-slider">
                      <span>
                        Yaw <i>{((selectedProp.yaw * 180) / Math.PI).toFixed(0)}°</i>
                      </span>
                      <input
                        type="range"
                        min={-Math.PI}
                        max={Math.PI}
                        step={Math.PI / 180}
                        value={selectedProp.yaw}
                        onChange={(e) =>
                          updateProp(selectedProp.id, { yaw: wrapYaw(Number(e.target.value)) })
                        }
                      />
                    </label>
                    <p className="p2a-hint">Rotate by</p>
                    <div className="p2a-row" style={{ flexWrap: "wrap" }}>
                      {[...YAW_STEP_DEG].reverse().map((deg) => (
                        <button
                          key={`p-${deg}`}
                          type="button"
                          onClick={() =>
                            updateProp(selectedProp.id, {
                              yaw: wrapYaw(selectedProp.yaw - (deg * Math.PI) / 180),
                            })
                          }
                        >
                          −{deg}°
                        </button>
                      ))}
                      {YAW_STEP_DEG.map((deg) => (
                        <button
                          key={`p+${deg}`}
                          type="button"
                          onClick={() =>
                            updateProp(selectedProp.id, {
                              yaw: wrapYaw(selectedProp.yaw + (deg * Math.PI) / 180),
                            })
                          }
                        >
                          +{deg}°
                        </button>
                      ))}
                    </div>
                    <b className="p2a-dev-h" style={{ marginTop: 8 }}>
                      Position
                    </b>
                    {(
                      [
                        [0, "X (side)", -300, 300],
                        [1, "Y (raise)", -15, 25],
                        [2, "Z (along)", -300, 300],
                      ] as const
                    ).map(([axis, label, min, max]) => (
                      <div key={axis} style={{ marginBottom: 8 }}>
                        <label className="p2a-slider">
                          <span>
                            {label} <i>{selectedProp.position[axis].toFixed(2)} m</i>
                          </span>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={0.05}
                            value={selectedProp.position[axis]}
                            onChange={(e) => {
                              const position: [number, number, number] = [
                                selectedProp.position[0],
                                selectedProp.position[1],
                                selectedProp.position[2],
                              ];
                              position[axis] = Number(e.target.value);
                              updateProp(selectedProp.id, { position });
                            }}
                          />
                        </label>
                        <div className="p2a-row" style={{ flexWrap: "wrap" }}>
                          {[...AXIS_NUDGE_M].reverse().map((m) => (
                            <button
                              key={`${axis}-n${m}`}
                              type="button"
                              onClick={() => nudgeProp(selectedProp.id, axis, -m)}
                            >
                              −{m}
                            </button>
                          ))}
                          {AXIS_NUDGE_M.map((m) => (
                            <button
                              key={`${axis}+${m}`}
                              type="button"
                              onClick={() => nudgeProp(selectedProp.id, axis, m)}
                            >
                              +{m}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="p2a-row">
                      <button
                        type="button"
                        onClick={() => {
                          const pose = samplePose();
                          if (!pose) return;
                          updateProp(selectedProp.id, {
                            position: [
                              pose.position[0],
                              pose.position[1] - (tuning.eyeHeight - 0.02),
                              pose.position[2],
                            ],
                            yaw: wrapYaw(pose.yaw ?? selectedProp.yaw),
                          });
                        }}
                      >
                        Move to me
                      </button>
                    </div>
                  </div>
                ) : null}

                <b className="p2a-dev-h">Locations</b>
                <label className="p2a-slider">
                  <span>Name</span>
                  <input
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                  />
                </label>
                <button type="button" onClick={addLocationHere}>
                  Add location here
                </button>
                {config.locations.map((loc) => {
                  const thumb = hennaLocationPreview(loc.name, loc.previewImageUrl);
                  return (
                    <div key={loc.id} className="p2a-author-loc" style={{ marginTop: 6 }}>
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="p2a-author-loc-thumb" />
                      ) : null}
                      <span className="p2a-hint" style={{ margin: 0 }}>
                        {loc.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patchConfig((c) => ({
                            ...c,
                            locations: c.locations.filter((l) => l.id !== loc.id),
                          }))
                        }
                      >
                        Del
                      </button>
                    </div>
                  );
                })}

                <b className="p2a-dev-h">Draft</b>
                <div className="p2a-row">
                  <button type="button" onClick={persist}>
                    Save draft
                  </button>
                  <button type="button" onClick={() => downloadProd03Json(config)}>
                    Export JSON
                  </button>
                  <label className="p2a-file-import">
                    Import JSON
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        void file.text().then((text) => {
                          try {
                            const next = saveProd03Draft(parseProd03Json(text));
                            setConfig(next);
                            setNavMode(next.defaultNavMode);
                            setQualityId(next.defaultQualityId);
                            setArrivalPose(null);
                            setLoadKey((k) => k + 1);
                            setLoading(true);
                            setStatusMsg(
                              `Imported “${file.name}” · ${next.barriers.length} blocks · ${(next.props ?? []).length} props`,
                            );
                          } catch (err) {
                            setStatusMsg(`Import failed: ${(err as Error).message}`);
                          }
                        });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      void fetch(HENNA_EXPERIENCE_JSON_PATH)
                        .then((r) => {
                          if (!r.ok) throw new Error(`HTTP ${r.status}`);
                          return r.text();
                        })
                        .then((text) => {
                          const next = saveProd03Draft(parseProd03Json(text));
                          setConfig(next);
                          setNavMode(next.defaultNavMode);
                          setQualityId(next.defaultQualityId);
                          setArrivalPose(null);
                          setLoadKey((k) => k + 1);
                          setLoading(true);
                          setStatusMsg(
                            `Restored packaged draft · ${next.barriers.length} road blocks`,
                          );
                        })
                        .catch((err) =>
                          setStatusMsg(`Restore failed: ${(err as Error).message}`),
                        );
                    }}
                  >
                    Restore packaged
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearProd03Draft(HENNA_PROPERTY_ID);
                      setConfig(createHennaSeed());
                      setArrivalPose(null);
                      setLoadKey((k) => k + 1);
                      setLoading(true);
                      setStatusMsg("Draft cleared to empty seed.");
                    }}
                  >
                    Reset
                  </button>
                </div>
                <p className="p2a-hint">
                  Barriers, props &amp; starts survive refresh after Save draft. Use Restore packaged
                  for your 9-block Henna draft, or Import JSON from an export.
                </p>
              </div>
            )}
          </>
        ) : null}
      </aside>

      {!loading && navMode !== "orbit" && (
        <>
          <div className="pe-nav-dock pe-nav-dock-left">
            <WalkOnScreenControls api={walkApi} visible={padsOpen} which="move" />
          </div>
          <div className="pe-nav-dock pe-nav-dock-right">
            <WalkOnScreenControls api={walkApi} visible={padsOpen} which="look" />
          </div>
        </>
      )}

      {!loading && !isAuthor && navMode !== "orbit" ? (
        <div className="p2a-visitor-guide" role="note">
          <strong>How to move</strong>
          <p>
            <b>Arrow keys / WASD</b> — move · <b>Shift + arrows</b> — run · <b>Q / E</b> — turn ·
            drag to look · <b>click the ground</b> to walk there
          </p>
          <p className="p2a-visitor-guide-mobile">On phone: use the Move and Look pads.</p>
        </div>
      ) : null}
    </div>
  );
}
