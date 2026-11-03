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
  clearSmoothTuningPreset,
  DEFAULT_SMOOTH_TUNING,
  loadSmoothTuningPreset,
  normalizeTuning,
  PRODUCTION_SMOOTH_TUNING,
  saveSmoothTuningPreset,
  type FollowCameraStyle,
  type SmoothNavTuning,
} from "@/lib/labs/prod02a/smoothAvatarControls";
// Joystick disabled — MobileNavControls / mobileControls kept in repo for later:
// import { MobileNavControls } from "@/components/labs/prod02a/MobileNavControls";
// import { DEFAULT_MOBILE_CONTROLS, loadMobileControlTuning, preferTouchControls, saveMobileControlTuning } from "@/lib/labs/prod02a/mobileControls";
import {
  loadProd02aQualityId,
  PROD02A_QUALITY,
  PROD02A_QUALITY_ORDER,
  saveProd02aQualityId,
  type Prod02aQualityId,
} from "@/lib/labs/prod02a/qualityPresets";
import { LCC_SDK_VERSION_LABEL } from "@/lib/labs/lccSdk";
import { HousePointsLoader } from "@/components/labs/experiences/HousePointsLoader";

/**
 * Isolated PROD-02A lab — smooth avatar nav + LCC2. Does not modify PROD-01 player.
 */
export function Prod02aLab() {
  const [floorId, setFloorId] = useState<Prod02aFloorId>("ground");
  const [useLcc2, setUseLcc2] = useState(true);
  const [navKind, setNavKind] = useState<Prod02aNavKind>("smooth");
  const [qualityId, setQualityId] = useState<Prod02aQualityId>("balanced");
  const [devOpen, setDevOpen] = useState(true);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [collisionOn, setCollisionOn] = useState(true);
  const [showCapsule, setShowCapsule] = useState(false);
  const [showCameraDebug, setShowCameraDebug] = useState(false);
  const [fov, setFov] = useState(65);
  const [tuning, setTuning] = useState<SmoothNavTuning>(() => ({ ...DEFAULT_SMOOTH_TUNING }));
  const [stats, setStats] = useState<Prod02aHostStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);
  const [padsOpen, setPadsOpen] = useState(true);
  const [startPose, setStartPose] = useState<Prod02aStartPose | null>(null);
  const [startLabelReady, setStartLabelReady] = useState(false);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);

  const hostRef = useRef<Prod02aHostHandle | null>(null);
  const quality = PROD02A_QUALITY[qualityId];
  const floor = PROD02A_FLOORS[floorId];
  const dataPath = useLcc2 ? floor.dataPath : floor.portableDataPath;
  const tuningSafe: SmoothNavTuning = normalizeTuning({ ...DEFAULT_SMOOTH_TUNING, ...tuning });

  useEffect(() => {
    setQualityId(loadProd02aQualityId());
    const saved = loadSmoothTuningPreset();
    if (saved) setTuning(saved);
  }, []);

  useEffect(() => {
    const pose = resolveProd02aStartPose(floorId);
    setStartPose(pose);
    setStartLabelReady(true);
    if (pose?.eyeHeight != null) {
      setTuning((t) => ({ ...t, eyeHeight: pose.eyeHeight! }));
    }
  }, [floorId, loadKey]);

  const setQuality = useCallback((id: Prod02aQualityId) => {
    setQualityId(id);
    saveProd02aQualityId(id);
  }, []);

  const walkApi = useMemo(
    () => ({
      setVirtualMove: (x: number, z: number) => hostRef.current?.setVirtualMove(x, z),
      setVirtualLook: (yaw: number, pitch: number) => hostRef.current?.setVirtualLook(yaw, pitch),
      clearVirtualInput: () => hostRef.current?.clearVirtualInput(),
    }),
    [],
  );

  const patchTuning = (partial: Partial<SmoothNavTuning>) => {
    setTuning((t) => normalizeTuning({ ...t, ...partial }));
    setPresetMsg(null);
  };

  const setFollowStyle = (style: FollowCameraStyle) => {
    patchTuning({
      followStyle: style,
      // Free Follow never recenters; Ecctrl keeps recenter off by default
      recenterEnabled: style === "free" ? false : tuningSafe.recenterEnabled,
    });
  };

  const reload = () => {
    setLoading(true);
    setLoadKey((k) => k + 1);
  };

  const cam = stats?.camera;

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
        suppressTouchLook={false}
        fov={fov}
        startPose={startPose}
        onStats={setStats}
        onReady={() => setLoading(false)}
        onPreferredDistanceChange={(d) =>
          setTuning((t) => normalizeTuning({ ...t, preferredDistance: d }))
        }
      />

      {loading && (
        <div className="p2a-loading">
          <HousePointsLoader
            progress={Math.min(1, Math.max(0.05, stats?.phase === "ready" ? 1 : (stats?.progress ?? 0.08)))}
            label={`Loading ${floor.name} (${useLcc2 ? "LCC2" : "Portable"})`}
          />
        </div>
      )}

      <aside
        className={`p2a-panel${devOpen ? " open" : ""}${panelCollapsed ? " collapsed" : ""}`}
      >
        <div className="p2a-panel-head">
          <div>
            <div className="p2a-brand">PROD-02A</div>
            {!panelCollapsed ? (
              <>
                <h1>Smooth navigation lab</h1>
                <p className="p2a-sub">
                  Isolated from PROD-01 · SDK {LCC_SDK_VERSION_LABEL}
                </p>
              </>
            ) : (
              <h1 className="p2a-panel-mini-title">Lab</h1>
            )}
          </div>
          <div className="p2a-panel-actions">
            {!panelCollapsed ? (
              <Link href="/labs/property-experience" className="p2a-link">
                ← PROD-01
              </Link>
            ) : null}
            <button
              type="button"
              className="p2a-panel-toggle"
              aria-expanded={!panelCollapsed}
              aria-label={panelCollapsed ? "Expand panel" : "Minimize panel"}
              onClick={() => setPanelCollapsed((c) => !c)}
            >
              {panelCollapsed ? "Expand" : "Minimize"}
            </button>
          </div>
        </div>

        {panelCollapsed ? (
          <div className="p2a-stats p2a-panel-mini-stats">
            {stats?.fps ?? "—"} fps · {navKind}
          </div>
        ) : null}

        {!panelCollapsed ? (
          <>

        <div className="p2a-stats">
          {stats?.phase ?? "…"} · {stats?.fps ?? "—"} fps · collision{" "}
          {stats?.hasCollision ? "yes" : "no"}
          {stats?.hasCollision && !collisionOn ? " (off)" : ""} · {stats?.format ?? "?"}
        </div>
        {stats?.metaSummary ? <p className="p2a-meta">{stats.metaSummary}</p> : null}
        {stats?.error ? <p className="p2a-error">{stats.error}</p> : null}

        {navKind === "smooth" && cam ? (
          <div className="p2a-stats p2a-cam-stats">
            {cam.followStyle === "free" ? "Free Follow" : "Ecctrl Orbit"} · boom{" "}
            {cam.boomDistance.toFixed(2)}m / pref {cam.preferredDistance.toFixed(2)}m · obstructed{" "}
            {cam.obstructed ? "yes" : "no"}
            {cam.fallbackActive ? " · FP fallback" : ""}
          </div>
        ) : null}

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
            Use LCC2 package (uncheck = portable .lcc fallback)
          </label>
        </section>

        <section className="p2a-section">
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
            Current = first-person walk. Smooth = invisible avatar + follow camera (Free / Ecctrl).
            Free Orbit = Three.js look-around only.
          </p>
          <p className="p2a-hint" suppressHydrationWarning>
            {!startLabelReady
              ? "Start: resolving…"
              : startPose
                ? `Start: ${startPose.source === "prod01-draft" ? "PROD-01 draft" : "Ground fallback"} @ (${startPose.eye.map((n) => n.toFixed(2)).join(", ")})`
                : "Start: package poses.json (no PROD-01 draft for this floor)"}
          </p>
          <div className="p2a-row">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setLoadKey((k) => k + 1);
              }}
            >
              Respawn at start
            </button>
          </div>
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
                title={PROD02A_QUALITY[id].note}
              >
                {PROD02A_QUALITY[id].label}
              </button>
            ))}
          </div>
          <p className="p2a-hint">{quality.note}</p>
        </section>

        <label className="p2a-check">
          <input type="checkbox" checked={devOpen} onChange={(e) => setDevOpen(e.target.checked)} />
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
                checked={showCapsule}
                onChange={(e) => setShowCapsule(e.target.checked)}
              />
              Show avatar capsule
            </label>
            <label className="p2a-check">
              <input
                type="checkbox"
                checked={showCameraDebug}
                onChange={(e) => setShowCameraDebug(e.target.checked)}
              />
              Camera debug gizmos
            </label>
            <label className="p2a-check">
              <input
                type="checkbox"
                checked={padsOpen}
                onChange={(e) => setPadsOpen(e.target.checked)}
              />
              On-screen D-pads (legacy)
            </label>

            {/* Joystick / mobile touch overlays — disabled for PROD-01 integration (keep code).
            <b className="p2a-dev-h">Mobile controls</b>
            ... see MobileNavControls + lib/labs/prod02a/mobileControls.ts
            */}
            <p className="p2a-hint">
              Mobile joystick is disabled. Using on-screen D-pads + mouse/keyboard. Experimental
              touch code remains in the repo but is not registered in the player.
            </p>

            <b className="p2a-dev-h">Camera style</b>
            <div className="p2a-row">
              <button
                type="button"
                className={tuningSafe.followStyle === "free" ? "on" : ""}
                onClick={() => setFollowStyle("free")}
                disabled={navKind !== "smooth"}
              >
                Free Follow
              </button>
              <button
                type="button"
                className={tuningSafe.followStyle === "ecctrl" ? "on" : ""}
                onClick={() => setFollowStyle("ecctrl")}
                disabled={navKind !== "smooth"}
              >
                Ecctrl Orbit
              </button>
            </div>
            <p className="p2a-hint">
              Free = XGRIDS-inspired (never auto-recenter). Ecctrl = same boom + optional delayed
              recenter behind body.
            </p>

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

            <b className="p2a-dev-h">Follow boom</b>
            <TuningSlider
              label="Preferred distance"
              value={tuningSafe.preferredDistance}
              min={0.4}
              max={4}
              step={0.05}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ preferredDistance: v })}
            />
            <TuningSlider
              label="Min distance"
              value={tuningSafe.minDistance}
              min={0.2}
              max={1.5}
              step={0.02}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ minDistance: v })}
            />
            <TuningSlider
              label="Max distance"
              value={tuningSafe.maxDistance}
              min={1}
              max={6}
              step={0.05}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ maxDistance: v })}
            />
            <TuningSlider
              label="Target height"
              value={tuningSafe.targetHeight}
              min={0.6}
              max={1.9}
              step={0.02}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ targetHeight: v })}
            />
            <TuningSlider
              label="Framing offset X"
              value={tuningSafe.framingOffsetX}
              min={-0.6}
              max={0.6}
              step={0.02}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ framingOffsetX: v })}
            />
            <TuningSlider
              label="Framing offset Y"
              value={tuningSafe.framingOffsetY}
              min={-0.4}
              max={0.6}
              step={0.02}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ framingOffsetY: v })}
            />
            <TuningSlider
              label="Follow responsiveness"
              value={tuningSafe.followResponsiveness}
              min={2}
              max={30}
              step={0.5}
              onChange={(v) => patchTuning({ followResponsiveness: v })}
            />

            <b className="p2a-dev-h">Rotation</b>
            <TuningSlider
              label="Mouse sensitivity"
              value={tuningSafe.lookSpeed}
              min={0.0004}
              max={0.004}
              step={0.00005}
              format={(v) => v.toFixed(5)}
              onChange={(v) => patchTuning({ lookSpeed: v })}
            />
            <TuningSlider
              label="Pitch min"
              value={tuningSafe.pitchMin}
              min={-1.2}
              max={0}
              step={0.02}
              onChange={(v) => patchTuning({ pitchMin: v })}
            />
            <TuningSlider
              label="Pitch max"
              value={tuningSafe.pitchMax}
              min={0.1}
              max={1.2}
              step={0.02}
              onChange={(v) => patchTuning({ pitchMax: v })}
            />
            {tuningSafe.followStyle === "ecctrl" ? (
              <>
                <label className="p2a-check">
                  <input
                    type="checkbox"
                    checked={!!tuningSafe.recenterEnabled}
                    onChange={(e) => patchTuning({ recenterEnabled: e.target.checked })}
                  />
                  Optional recenter behind body (off by default)
                </label>
                <TuningSlider
                  label="Recenter delay"
                  value={tuningSafe.recenterDelay}
                  min={0.2}
                  max={4}
                  step={0.1}
                  format={(v) => `${v.toFixed(1)} s`}
                  onChange={(v) => patchTuning({ recenterDelay: v })}
                />
                <TuningSlider
                  label="Recenter speed"
                  value={tuningSafe.recenterSpeed}
                  min={0.2}
                  max={6}
                  step={0.1}
                  onChange={(v) => patchTuning({ recenterSpeed: v })}
                />
              </>
            ) : (
              <p className="p2a-hint">Free Follow never auto-recenters — mouse owns yaw/pitch.</p>
            )}

            <b className="p2a-dev-h">Camera collision</b>
            <label className="p2a-check">
              <input
                type="checkbox"
                checked={!!tuningSafe.cameraCollisionEnabled}
                onChange={(e) => patchTuning({ cameraCollisionEnabled: e.target.checked })}
              />
              Camera boom collision
            </label>
            <TuningSlider
              label="Collision radius"
              value={tuningSafe.cameraCollisionRadius}
              min={0.04}
              max={0.35}
              step={0.01}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ cameraCollisionRadius: v })}
            />
            <TuningSlider
              label="Collision margin"
              value={tuningSafe.collisionMargin}
              min={0.02}
              max={0.35}
              step={0.01}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ collisionMargin: v })}
            />
            <TuningSlider
              label="Inward correction"
              value={tuningSafe.inwardResponsiveness}
              min={6}
              max={48}
              step={1}
              onChange={(v) => patchTuning({ inwardResponsiveness: v })}
            />
            <TuningSlider
              label="Outward recovery"
              value={tuningSafe.outwardResponsiveness}
              min={1}
              max={16}
              step={0.5}
              onChange={(v) => patchTuning({ outwardResponsiveness: v })}
            />
            <label className="p2a-check">
              <input
                type="checkbox"
                checked={tuningSafe.obstructionFallback === "first-person"}
                onChange={(e) =>
                  patchTuning({
                    obstructionFallback: e.target.checked ? "first-person" : "close",
                  })
                }
              />
              First-person fallback when boom collapses
            </label>

            <b className="p2a-dev-h">Movement</b>
            <TuningSlider
              label="Walk speed"
              value={tuningSafe.walkSpeed}
              min={0.8}
              max={5}
              step={0.05}
              onChange={(v) => patchTuning({ walkSpeed: v })}
            />
            <TuningSlider
              label="Acceleration"
              value={tuningSafe.acceleration}
              min={2}
              max={20}
              step={0.5}
              onChange={(v) => patchTuning({ acceleration: v })}
            />
            <TuningSlider
              label="Deceleration"
              value={tuningSafe.deceleration}
              min={2}
              max={24}
              step={0.5}
              onChange={(v) => patchTuning({ deceleration: v })}
            />
            <TuningSlider
              label="Character turn speed"
              value={tuningSafe.turnSpeed}
              min={0.5}
              max={10}
              step={0.1}
              onChange={(v) => patchTuning({ turnSpeed: v })}
            />
            <TuningSlider
              label="Eye height"
              value={tuningSafe.eyeHeight}
              min={1.0}
              max={1.85}
              step={0.01}
              format={(v) => `${v.toFixed(2)} m`}
              onChange={(v) => patchTuning({ eyeHeight: v })}
            />
            <div className="p2a-row">
              <button
                type="button"
                className={tuningSafe.facingMode === "face-move" ? "on" : ""}
                onClick={() => patchTuning({ facingMode: "face-move" })}
              >
                Face travel
              </button>
              <button
                type="button"
                className={tuningSafe.facingMode === "strafe" ? "on" : ""}
                onClick={() => patchTuning({ facingMode: "strafe" })}
              >
                Strafe (lock facing)
              </button>
            </div>

            <div className="p2a-row">
              <button
                type="button"
                onClick={() => {
                  saveSmoothTuningPreset(tuningSafe);
                  setPresetMsg("Saved Dev preset");
                }}
              >
                Save preset
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = loadSmoothTuningPreset();
                  if (p) {
                    setTuning(p);
                    setPresetMsg("Restored saved preset");
                  } else setPresetMsg("No saved preset");
                }}
              >
                Restore preset
              </button>
              <button
                type="button"
                onClick={() => {
                  setTuning({ ...DEFAULT_SMOOTH_TUNING });
                  setPresetMsg("Reset to lab defaults");
                }}
              >
                Reset defaults
              </button>
            </div>
            <div className="p2a-row">
              <button
                type="button"
                onClick={() => {
                  setTuning({ ...PRODUCTION_SMOOTH_TUNING });
                  setPresetMsg("Applied production-leaning preset");
                }}
              >
                Production preset
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSmoothTuningPreset();
                  setPresetMsg("Cleared saved preset");
                }}
              >
                Clear saved
              </button>
              <button type="button" onClick={reload}>
                Reload scene
              </button>
            </div>
            {presetMsg ? <p className="p2a-hint">{presetMsg}</p> : null}

            {cam && showCameraDebug ? (
              <pre className="p2a-debug-readout">
                {`style ${cam.followStyle}
yaw ${(cam.camYaw * 180) / Math.PI | 0}°  pitch ${((cam.camPitch * 180) / Math.PI).toFixed(0)}°
bodyYaw ${(cam.bodyYaw * 180) / Math.PI | 0}°
pref ${cam.preferredDistance.toFixed(2)}  boom ${cam.boomDistance.toFixed(2)}  actual ${cam.actualDistance.toFixed(2)}
obstructed ${cam.obstructed ? "yes" : "no"}  fallback ${cam.fallbackActive ? "yes" : "no"}
vel ${cam.velocity[0].toFixed(2)}, ${cam.velocity[2].toFixed(2)}`}
              </pre>
            ) : null}

            <p className="p2a-hint">
              Scroll wheel adjusts preferred boom. A/D must not turn the camera — only mouse / look
              pad. Collision verified only when stats say collision yes. Minimize the panel to free
              the joystick.
            </p>
          </div>
        )}
          </>
        ) : null}
      </aside>

      {/* <MobileNavControls visible={mobileActive} api={navInputApi} tuning={mobile} /> */}

      {!loading && navKind !== "orbit" && (
        <>
          <div className="p2a-pads left">
            <WalkOnScreenControls api={walkApi} visible={padsOpen} which="move" />
          </div>
          <div className="p2a-pads right">
            <WalkOnScreenControls api={walkApi} visible={padsOpen} which="look" />
          </div>
        </>
      )}
    </div>
  );
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
