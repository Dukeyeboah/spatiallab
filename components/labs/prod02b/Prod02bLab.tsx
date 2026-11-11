"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WalkOnScreenControls } from "@/components/labs/experiences/WalkOnScreenControls";
import {
  Prod02aHost,
  type Prod02aHostHandle,
  type Prod02aHostStats,
  type Prod02aNavKind,
} from "@/components/labs/prod02a/Prod02aHost";
import {
  PROD02A_FLOOR_ORDER,
  PROD02A_FLOORS,
  resolveProd02aStartPose,
  type Prod02aFloorId,
  type Prod02aStartPose,
} from "@/lib/labs/prod02a/assets";
import {
  DEFAULT_SMOOTH_TUNING,
  normalizeTuning,
  type FollowCameraStyle,
  type SmoothNavTuning,
} from "@/lib/labs/prod02a/smoothAvatarControls";
import { APPROVED_ORB, approvedOrbCameraTuning } from "@/lib/labs/prod02b/orbConfig";
import {
  PROD02A_QUALITY_ORDER,
  type Prod02aQualityId,
} from "@/lib/labs/prod02a/qualityPresets";
import {
  DEFAULT_VISUAL_AVATAR_TUNING,
  type VisualAvatarDebug,
  type VisualAvatarTuning,
} from "@/lib/labs/prod02b/visualAvatar";
import type { Prod02bClipRole } from "@/lib/labs/prod02b/avatarAssets";
import { LCC_SDK_VERSION_LABEL } from "@/lib/labs/lccSdk";
import { HousePointsLoader } from "@/components/labs/experiences/HousePointsLoader";

import { robotStartPose } from "@/lib/labs/prod02b/grounding";

import { ROBOT_QUALITY } from "@/lib/labs/prod02b/performance";

import { PerformanceSession } from "@/lib/labs/prod02b/performanceSession";

type AvatarPresentation = "capsule" | "mixamo";

/**
 * Isolated PROD-02B — Mixamo visible avatar on top of PROD-02A navigation.
 * Does not modify PROD-01 / property-experience.
 */
export function Prod02bLab() {
  const [floorId, setFloorId] = useState<Prod02aFloorId>("ground");
  const [useLcc2, setUseLcc2] = useState(true);
  const [navKind, setNavKind] = useState<Prod02aNavKind>("smooth");
  const [qualityId, setQualityId] = useState<Prod02aQualityId>("performance");
  const [autoPerformance, setAutoPerformance] = useState(true);
  const [showPerf, setShowPerf] = useState(true);
  const perfHistory = useRef<PerformanceSession | null>(null);
  if (!perfHistory.current) perfHistory.current = new PerformanceSession();
  const [devOpen, setDevOpen] = useState(true);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [collisionOn, setCollisionOn] = useState(true);
  const [presentation, setPresentation] =
    useState<AvatarPresentation>("mixamo");
  const [showCameraDebug, setShowCameraDebug] = useState(false);
  const [fov, setFov] = useState<number>(APPROVED_ORB.fov);
  const [followStyle, setFollowStyle] = useState<FollowCameraStyle>("free");
  const [tuning, setTuning] = useState<SmoothNavTuning>(() =>
    avatarCameraTuning("free"),
  );
  const [mixamo, setMixamo] = useState<VisualAvatarTuning>(() => ({
    ...DEFAULT_VISUAL_AVATAR_TUNING,
    visible: true,
    avatarId: "orb",
    scale: APPROVED_ORB.scale,
  }));
  const [avatarDebug, setAvatarDebug] = useState<VisualAvatarDebug | null>(
    null,
  );
  const [stats, setStats] = useState<Prod02aHostStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);
  const [padsOpen, setPadsOpen] = useState(true);
  const [startPose, setStartPose] = useState<Prod02aStartPose | null>(null);

  const hostRef = useRef<Prod02aHostHandle | null>(null);
  const quality = ROBOT_QUALITY[qualityId];
  const floor = PROD02A_FLOORS[floorId];
  const dataPath = useLcc2 ? floor.dataPath : floor.portableDataPath;
  const tuningSafe = useMemo(
    () =>
      normalizeTuning({
        ...DEFAULT_SMOOTH_TUNING,
        ...tuning,
        // Keep stride and travel in proportion as the visual robot shrinks.
        walkSpeed:
          tuning.walkSpeed *
          (presentation === "mixamo" && mixamo.avatarId !== "orb"
            ? mixamo.scale
            : 1),
        followStyle,
      }),
    [tuning, followStyle, presentation, mixamo.scale, mixamo.avatarId],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem("spatial-lab.prod02b.quality.v2");
      if (saved && ROBOT_QUALITY[saved])
        setQualityId(saved as Prod02aQualityId);
    } catch {
      /* optional persistence */
    }
  }, []);

  const receiveStats = useCallback(
    (value: Prod02aHostStats) => {
      setStats(value);
      perfHistory.current!.record(value, {
        robot: mixamo.avatarId,
        scale: mixamo.scale,
        floor: floorId,
        quality: qualityId,
        autoPerformance,
      });
    },
    [mixamo.avatarId, mixamo.scale, floorId, qualityId, autoPerformance],
  );
  const exportPerf = () => {
    const report = perfHistory.current!.report({
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      quality: qualityId,
      autoPerformance,
      robot: mixamo.avatarId,
      scale: mixamo.scale,
      floor: floorId,
    });
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/labs/prod-02b/report";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "report";
    input.value = JSON.stringify(report);
    form.append(input);
    document.body.append(form);
    form.submit();
    form.remove();
  };

  useEffect(() => {
    setStartPose(
      robotStartPose(resolveProd02aStartPose(floorId), floorId === "ground"),
    );
  }, [floorId, loadKey]);

  const setQuality = useCallback((id: Prod02aQualityId) => {
    setQualityId(id);
    try {
      localStorage.setItem("spatial-lab.prod02b.quality.v2", id);
    } catch {
      /* optional */
    }
  }, []);

  const walkApi = useMemo(
    () => ({
      setVirtualMove: (x: number, z: number) =>
        hostRef.current?.setVirtualMove(x, z),
      setVirtualLook: (yaw: number, pitch: number) =>
        hostRef.current?.setVirtualLook(yaw, pitch),
      clearVirtualInput: () => hostRef.current?.clearVirtualInput(),
    }),
    [],
  );

  const applyFollow = (style: FollowCameraStyle) => {
    setFollowStyle(style);
    setTuning(avatarCameraTuning(style));
  };

  const patchMixamo = (partial: Partial<VisualAvatarTuning>) => {
    setMixamo((m) => ({ ...m, ...partial }));
  };

  const showMixamo = presentation === "mixamo" && navKind === "smooth";
  const showCapsule = presentation === "capsule" && navKind === "smooth";

  return (
    <div className="p2a-root">
      <Prod02aHost
        key={`${dataPath}-${loadKey}-${startPose?.source ?? "auto"}`}
        ref={hostRef}
        dataPath={dataPath}
        navKind={navKind}
        quality={quality}
        tuning={tuningSafe}
        collisionEnabled={collisionOn}
        showCapsule={showCapsule && devOpen}
        showCameraDebug={showCameraDebug && devOpen}
        showMixamoAvatar={showMixamo}
        enableAvatarLocomotion
        adaptivePerformance={autoPerformance}
        mixamoTuning={mixamo}
        suppressTouchLook={false}
        fov={fov}
        startPose={startPose}
        onStats={receiveStats}
        onReady={() => setLoading(false)}
        onAvatarDebug={setAvatarDebug}
      />

      {showPerf && stats?.perf && (
        <div
          role="status"
          aria-label="Performance meter"
          style={{
            position: "absolute",
            right: 12,
            top: 12,
            zIndex: 15,
            background: "rgba(15,18,14,.9)",
            color: "#eee",
            borderRadius: 10,
            padding: "10px 14px",
            font: "12px/1.6 monospace",
            pointerEvents: "none",
            maxWidth: "calc(100vw - 24px)",
          }}
        >
          <strong>{stats.fps} FPS</strong> · p95 {stats.perf.p95Ms.toFixed(1)}{" "}
          ms · CPU {stats.perf.cpuMs.toFixed(1)} ms
          <br />
          {stats.perf.width}×{stats.perf.height} · DPR{" "}
          {stats.perf.dpr.toFixed(2)} ·{" "}
          {(stats.perf.splatBudget / 1000).toFixed(0)}k splat limit
          <br />
          {stats.perf.drawCalls} draws ·{" "}
          {(stats.perf.triangles / 1000).toFixed(1)}k triangles ·{" "}
          {stats.perf.geometries} geometries / {stats.perf.textures} textures
          <br />
          JS heap{" "}
          {stats.perf.heapMB == null
            ? "unavailable"
            : `${stats.perf.heapMB.toFixed(0)} MB`}{" "}
          · auto {autoPerformance ? `L${stats.perf.autoLevel}` : "off"} ·{" "}
          {stats.perf.elapsedSeconds.toFixed(0)}s<br />
          <span style={{ opacity: 0.65 }}>
            CPU = submission time · SDK memory / GPU time not exposed
          </span>
        </div>
      )}

      {loading && (
        <div className="p2a-loading">
          <HousePointsLoader
            progress={Math.min(
              1,
              Math.max(
                0.05,
                stats?.phase === "ready" ? 1 : (stats?.progress ?? 0.08),
              ),
            )}
            label={`PROD-02B · ${floor.name}`}
          />
        </div>
      )}

      <aside
        className={`p2a-panel${devOpen ? " open" : ""}${panelCollapsed ? " collapsed" : ""}`}
      >
        <div className="p2a-panel-head">
          <div>
            <div className="p2a-brand">PROD-02B</div>
            {!panelCollapsed ? (
              <>
                <h1>Robot comparison</h1>
                <p className="p2a-sub">
                  On PROD-02A nav · SDK {LCC_SDK_VERSION_LABEL}
                </p>
              </>
            ) : (
              <h1 className="p2a-panel-mini-title">02B</h1>
            )}
          </div>
          <div className="p2a-panel-actions">
            {!panelCollapsed ? (
              <Link href="/labs/prod-02a" className="p2a-link">
                ← 02A
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

        {panelCollapsed ? (
          <div className="p2a-stats p2a-panel-mini-stats">
            {stats?.fps ?? "—"} fps · {presentation} ·{" "}
            {avatarDebug?.activeClip ?? "…"}
          </div>
        ) : null}

        {!panelCollapsed ? (
          <>
            <div className="p2a-stats">
              {stats?.phase ?? "…"} · {stats?.fps ?? "—"} fps · collision{" "}
              {stats?.hasCollision ? "yes" : "no"} · {stats?.format ?? "?"}
            </div>
            {avatarDebug?.error ? (
              <p className="p2a-error">{avatarDebug.error}</p>
            ) : null}
            {avatarDebug?.loadMs != null ? (
              <p className="p2a-hint">
                Avatar {avatarDebug.loadMs.toFixed(0)} ms · anim{" "}
                {avatarDebug.activeClip ?? "—"} · speed{" "}
                {avatarDebug.speed.toFixed(2)} ·{" "}
                {mixamo.avatarId === "orb"
                  ? "procedural hover / fins"
                  : `walk binds ${avatarDebug.walkBindings}`}
              </p>
            ) : (
              <p className="p2a-hint">Loading robot…</p>
            )}

            <p className="p2a-hint">
              WASD / arrows: walk · Shift + direction: run · Space: jump · Q /
              E: turn · drag: look · wheel: zoom
            </p>
            <section className="p2a-section">
              <b>Robot candidate</b>
              <div className="p2a-row">
                {(
                  [
                    ["orb", "Orb Assistant V1.1"],
                    ["walker", "Walking robot"],
                    ["r01", "R01 hover robot"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    className={mixamo.avatarId === id ? "on" : ""}
                    onClick={() =>
                      patchMixamo({
                        avatarId: id,
                        scale: id === "orb" ? APPROVED_ORB.scale : 0.5,
                        previewClip: null,
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="p2a-hint">
                Size-adjusted pace · hold Shift + direction to run.
              </p>
              <b>Robot size</b>
              <div className="p2a-row">
                {(
                  [
                    [1, "Original size"],
                    [1.2, "+20%"],
                    [1.5, "+50%"],
                    [2 / 3, "⅔ size"],
                    [0.5, "½ size"],
                  ] as const
                ).map(([scale, label]) => (
                  <button
                    type="button"
                    key={label}
                    className={
                      Math.abs(mixamo.scale - scale) < 0.001 ? "on" : ""
                    }
                    aria-pressed={Math.abs(mixamo.scale - scale) < 0.001}
                    onClick={() => patchMixamo({ scale })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <section className="p2a-section">
              <b>Floor</b>
              <div className="p2a-row">
                {PROD02A_FLOOR_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={floorId === id ? "on" : ""}
                    onClick={() => {
                      setFloorId(id);
                      setLoading(true);
                    }}
                  >
                    {PROD02A_FLOORS[id].name}
                  </button>
                ))}
              </div>
              <label className="p2a-check">
                <input
                  type="checkbox"
                  checked={useLcc2}
                  onChange={(e) => {
                    setUseLcc2(e.target.checked);
                    setLoading(true);
                  }}
                />
                Use LCC2
              </label>
            </section>

            <section className="p2a-section">
              <Link href="/labs/prod-02b/avatar" className="p2a-link">
                Character & animation preview ↗
              </Link>
              <b>Navigation comparison</b>
              <div className="p2a-row">
                <button
                  type="button"
                  className={navKind === "current" ? "on" : ""}
                  onClick={() => setNavKind("current")}
                >
                  Current (1P)
                </button>
                <button
                  type="button"
                  className={navKind === "smooth" ? "on" : ""}
                  onClick={() => setNavKind("smooth")}
                >
                  Smooth (avatar)
                </button>
                <button
                  type="button"
                  className={navKind === "orbit" ? "on" : ""}
                  onClick={() => setNavKind("orbit")}
                >
                  Free Orbit
                </button>
              </div>
              <p className="p2a-hint">
                Current = first-person walk. Smooth = invisible controller +
                follow camera (Free / Ecctrl). Free Orbit = look-around only.
              </p>
            </section>

            <section className="p2a-section">
              <b>Rendering quality</b>
              <div className="p2a-row">
                {PROD02A_QUALITY_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={qualityId === id ? "on" : ""}
                    onClick={() => setQuality(id)}
                  >
                    {ROBOT_QUALITY[id].label}
                  </button>
                ))}
              </div>
              <p className="p2a-hint">{quality.note}</p>
              <label className="p2a-check">
                <input
                  type="checkbox"
                  checked={autoPerformance}
                  onChange={(e) => setAutoPerformance(e.target.checked)}
                />
                Auto-adjust performance
              </label>
              <label className="p2a-check">
                <input
                  type="checkbox"
                  checked={showPerf}
                  onChange={(e) => setShowPerf(e.target.checked)}
                />
                Performance meter
              </label>
              <div className="p2a-row">
                <button type="button" onClick={exportPerf}>
                  Download performance report
                </button>
                <button
                  type="button"
                  onClick={() => {
                    perfHistory.current = new PerformanceSession();
                    setLoadKey((k) => k + 1);
                  }}
                >
                  Reload scene
                </button>
              </div>
              {stats?.error && <p className="p2a-error">{stats.error}</p>}
            </section>

            <label className="p2a-check">
              <input
                type="checkbox"
                checked={devOpen}
                onChange={(e) => setDevOpen(e.target.checked)}
              />
              Dev Mode
            </label>

            {devOpen && (
              <div className="p2a-dev">
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
                    checked={padsOpen}
                    onChange={(e) => setPadsOpen(e.target.checked)}
                  />
                  On-screen D-pads
                </label>
                <label className="p2a-check">
                  <input
                    type="checkbox"
                    checked={showCameraDebug}
                    onChange={(e) => setShowCameraDebug(e.target.checked)}
                  />
                  Camera debug gizmos
                </label>

                <b className="p2a-dev-h">Visible avatar</b>
                <div className="p2a-row">
                  <button
                    type="button"
                    className={presentation === "mixamo" ? "on" : ""}
                    onClick={() => setPresentation("mixamo")}
                    disabled={navKind !== "smooth"}
                  >
                    Robot avatar
                  </button>
                  <button
                    type="button"
                    className={presentation === "capsule" ? "on" : ""}
                    onClick={() => setPresentation("capsule")}
                    disabled={navKind !== "smooth"}
                  >
                    Capsule (02A)
                  </button>
                </div>

                <b className="p2a-dev-h">Camera style</b>
                <div className="p2a-row">
                  <button
                    type="button"
                    className={followStyle === "free" ? "on" : ""}
                    onClick={() => applyFollow("free")}
                    disabled={navKind !== "smooth"}
                  >
                    Free Follow
                  </button>
                  <button
                    type="button"
                    className={followStyle === "ecctrl" ? "on" : ""}
                    onClick={() => applyFollow("ecctrl")}
                    disabled={navKind !== "smooth"}
                  >
                    Ecctrl Orbit
                  </button>
                </div>

                <b className="p2a-dev-h">Animation preview</b>
                <div className="p2a-row">
                  {(
                    [
                      [null, "Auto"],
                      ["Idle", "Idle"],
                      ["Walk", "Walk"],
                      ["Run", "Run"],
                      ["TurnLeft", "Turn L"],
                      ["TurnRight", "Turn R"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={label}
                      type="button"
                      className={mixamo.previewClip === id ? "on" : ""}
                      onClick={() =>
                        patchMixamo({
                          previewClip: id as Prod02bClipRole | null,
                        })
                      }
                      disabled={!showMixamo}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <TuningSlider
                  label="Model scale"
                  value={mixamo.scale}
                  min={0.4}
                  max={1.6}
                  step={0.02}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(v) => patchMixamo({ scale: v })}
                />
                <TuningSlider
                  label="Vertical offset"
                  value={mixamo.verticalOffset}
                  min={-0.5}
                  max={0.5}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)} m`}
                  onChange={(v) => patchMixamo({ verticalOffset: v })}
                />
                <TuningSlider
                  label="Facing offset"
                  value={mixamo.facingOffset}
                  min={-Math.PI}
                  max={Math.PI}
                  step={0.05}
                  format={(v) => `${((v * 180) / Math.PI).toFixed(0)}°`}
                  onChange={(v) => patchMixamo({ facingOffset: v })}
                />
                <TuningSlider
                  label="Anim speed"
                  value={mixamo.animSpeed}
                  min={0.5}
                  max={1.8}
                  step={0.05}
                  onChange={(v) => patchMixamo({ animSpeed: v })}
                />
                <TuningSlider
                  label="Walk blend"
                  value={mixamo.walkBlend}
                  min={0.05}
                  max={0.6}
                  step={0.05}
                  onChange={(v) => patchMixamo({ walkBlend: v })}
                />
                <TuningSlider
                  label="Turn blend"
                  value={mixamo.turnBlend}
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  onChange={(v) => patchMixamo({ turnBlend: v })}
                />
                <TuningSlider
                  label="Close-camera fade distance"
                  value={mixamo.closeFadeDistance}
                  min={0}
                  max={1.2}
                  step={0.05}
                  format={(v) => (v <= 0 ? "off" : `${v.toFixed(2)} m`)}
                  onChange={(v) => patchMixamo({ closeFadeDistance: v })}
                />
                <TuningSlider
                  label="FOV"
                  value={fov}
                  min={40}
                  max={75}
                  step={1}
                  format={(v) => `${v.toFixed(0)}°`}
                  onChange={(v) => {
                    setFov(v);
                    hostRef.current?.setFov(v);
                  }}
                />

                {avatarDebug?.inspections?.length ? (
                  <pre className="p2a-debug-readout">
                    {avatarDebug.inspections
                      .map(
                        (c) =>
                          `${c.sourceFile}[${c.index}] "${c.name}" ${c.duration.toFixed(2)}s → ${c.suggestedRole}`,
                      )
                      .join("\n")}
                  </pre>
                ) : null}

                <p className="p2a-hint">
                  Original robot assets · Spatial House branding · walk / hover
                  comparison.
                </p>
              </div>
            )}
          </>
        ) : null}
      </aside>

      {!loading && navKind !== "orbit" && (
        <>
          <div className="p2a-pads left">
            <WalkOnScreenControls
              api={walkApi}
              visible={padsOpen}
              which="move"
            />
          </div>
          <div className="p2a-pads right">
            <WalkOnScreenControls
              api={walkApi}
              visible={padsOpen}
              which="look"
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Frame the whole 1.75 m character; leave the approved 02A presets unchanged. */
function avatarCameraTuning(style: FollowCameraStyle): SmoothNavTuning {
  return approvedOrbCameraTuning(style);
}

function TuningSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const safe = Number.isFinite(value) ? value : min;
  return (
    <label className="p2a-slider">
      <span>
        {label} <i>{format ? format(safe) : safe.toFixed(2)}</i>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safe}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
