"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloorMapPanel } from "@/components/labs/experiences/FloorMapPanel";
import {
  ExperienceTourHost,
  type CameraPoseSample,
  type TourHostStats,
  type TourNavMode,
} from "@/components/labs/experiences/ExperienceTourHost";
import { DEFAULT_EXPERIENCE_ID, EXPERIENCE_CATALOG, propertyById } from "@/lib/labs/experiences/catalog";
import {
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESETS,
  type QualityPresetId,
} from "@/lib/labs/experiences/qualityPresets";
import {
  loadOverrides,
  mergeContent,
  removeOverrideHotspot,
  removeOverrideViewpoint,
  replaceViewpointsOrder,
  saveHotspot,
  saveViewpoint,
} from "@/lib/labs/experiences/storage";
import type { ExperienceHotspot, ExperienceViewpoint, Vec3Tuple } from "@/lib/labs/experiences/types";
import { LCC_SDK_VERSION_LABEL } from "@/lib/labs/lccSdk";

const HELP_KEY = "spatial-lab.experiences.help-seen.v1";

/**
 * LAB EXP-02 — Spatial Lab Experiences tour (performance, walk, map, collision).
 */
export default function SpatialExperiencesPage() {
  const [propertyId, setPropertyId] = useState(DEFAULT_EXPERIENCE_ID);
  const property = propertyById(propertyId) ?? EXPERIENCE_CATALOG.properties[0];

  const [overrides, setOverrides] = useState(() => loadOverrides(DEFAULT_EXPERIENCE_ID));
  useEffect(() => {
    setOverrides(loadOverrides(property.id));
  }, [property.id]);

  const content = useMemo(() => mergeContent(property, overrides), [property, overrides]);
  const rooms = useMemo(() => {
    const names = content.viewpoints.map((v) => v.roomId || v.name);
    return [...new Set(names)];
  }, [content.viewpoints]);

  const [navMode, setNavMode] = useState<TourNavMode>("first-person");
  const [qualityId, setQualityId] = useState<QualityPresetId>(DEFAULT_QUALITY_PRESET);
  const quality = QUALITY_PRESETS[qualityId];
  const [collisionOn, setCollisionOn] = useState(true);
  const [uiHidden, setUiHidden] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [placeMode, setPlaceMode] = useState(false);
  const [selectedHs, setSelectedHs] = useState<ExperienceHotspot | null>(null);
  const [flyTo, setFlyTo] = useState<{ viewpoint: ExperienceViewpoint; token: number } | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [sampleToken, setSampleToken] = useState(0);
  const [pendingSample, setPendingSample] = useState<CameraPoseSample | null>(null);
  const [vpName, setVpName] = useState("");
  const [vpRoom, setVpRoom] = useState("");
  const [hsTitle, setHsTitle] = useState("");
  const [hsDesc, setHsDesc] = useState("");
  const [pendingPlace, setPendingPlace] = useState<Vec3Tuple | null>(null);
  const [stats, setStats] = useState<TourHostStats | null>(null);
  const [pose, setPose] = useState<CameraPoseSample | null>(null);
  const [fade, setFade] = useState(false);
  const [loadLog, setLoadLog] = useState<string[]>([]);
  const phaseGateRef = useRef({ id: "", phase: "" });

  useEffect(() => {
    setNavMode(property.nav.defaultMode);
    setCollisionOn(property.nav.collision !== false);
    setSelectedHs(null);
    setFlyTo(null);
    setPlaceMode(false);
    setPendingPlace(null);
    setMapOpen(false);
    setResetToken(0);
  }, [property.id, property.nav.defaultMode, property.nav.collision]);

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

  const onStats = useCallback(
    (s: TourHostStats) => {
      setStats(s);
      if (s.phase !== "ready" && s.phase !== "error") return;
      const gate = phaseGateRef.current;
      if (gate.id === property.id && gate.phase === s.phase) return;
      phaseGateRef.current = { id: property.id, phase: s.phase };
      const line = `${property.id}: ${s.phase}${s.error ? ` — ${s.error}` : s.metaSummary ? ` — ${s.metaSummary}` : ""} · ${s.fps || "?"} fps · load ${s.loadMs ?? "?"}ms · collision ${s.hasCollision ? "yes" : "no"}`;
      setLoadLog((prev) => [line, ...prev].slice(0, 6));
    },
    [property.id],
  );

  const goViewpoint = (vp: ExperienceViewpoint) => {
    setFlyTo({ viewpoint: vp, token: Date.now() });
    setSelectedHs(null);
  };

  const recordViewpoint = () => {
    if (!pendingSample || !vpName.trim()) return;
    const floor = property.floors[0];
    let mapUv: ExperienceViewpoint["mapUv"];
    if (floor) {
      const b = floor.worldBounds;
      mapUv = {
        u: (pendingSample.position[0] - b.minX) / Math.max(1e-6, b.maxX - b.minX),
        v: 1 - (pendingSample.position[2] - b.minZ) / Math.max(1e-6, b.maxZ - b.minZ),
      };
    }
    const vp: ExperienceViewpoint = {
      id: `vp_custom_${Date.now().toString(36)}`,
      name: vpName.trim(),
      roomId: vpRoom.trim() || vpName.trim(),
      order: content.viewpoints.length,
      sceneId: property.id,
      position: pendingSample.position,
      target: pendingSample.target,
      description: "Recorded in Experiences editor",
      mapUv,
    };
    saveViewpoint(property.id, vp);
    setOverrides(loadOverrides(property.id));
    setVpName("");
    setVpRoom("");
    setPendingSample(null);
  };

  const savePlacedHotspot = () => {
    if (!pendingPlace || !hsTitle.trim()) return;
    const hs: ExperienceHotspot = {
      id: `hs_custom_${Date.now().toString(36)}`,
      title: hsTitle.trim(),
      description: hsDesc.trim() || "Custom hotspot",
      position: pendingPlace,
      sceneId: property.id,
    };
    saveHotspot(property.id, hs);
    setOverrides(loadOverrides(property.id));
    setHsTitle("");
    setHsDesc("");
    setPendingPlace(null);
    setPlaceMode(false);
  };

  const moveViewpoint = (id: string, dir: -1 | 1) => {
    const list = [...content.viewpoints];
    const i = list.findIndex((v) => v.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    replaceViewpointsOrder(property.id, list);
    setOverrides(loadOverrides(property.id));
  };

  const progressPct = Math.round((stats?.progress ?? 0) * 1000) / 10;
  const accent = property.branding?.accent ?? "#c4a574";
  const floor = property.floors[0] ?? null;

  const toggleFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  return (
    <div className={`exp-page${uiHidden ? " ui-hidden" : ""}`} style={{ ["--exp-accent" as string]: accent }}>
      <ExperienceTourHost
        key={property.dataPath}
        dataPath={property.dataPath}
        navMode={navMode}
        quality={quality}
        collisionEnabled={collisionOn}
        hotspots={content.hotspots}
        flyTo={flyTo}
        placeHotspotMode={placeMode}
        onStats={onStats}
        onHotspotSelect={setSelectedHs}
        onHotspotPlaced={(p) => {
          setPendingPlace(p);
          setPlaceMode(false);
        }}
        onCameraSample={setPendingSample}
        onPoseTick={setPose}
        onFade={setFade}
        resetToken={resetToken}
        sampleCameraToken={sampleToken}
      />

      <div className={`exp-fade${fade ? " on" : ""}`} aria-hidden />

      {(stats?.phase === "loading" || (stats?.phase === "ready" && progressPct < 99.5 && (stats?.progress ?? 0) > 0 && (stats?.progress ?? 0) < 1)) && (
        <div className="exp-loading" aria-live="polite">
          <div className="exp-loading-bar">
            <i style={{ width: `${Math.min(100, progressPct)}%` }} />
          </div>
          <span>Loading · {progressPct}%</span>
        </div>
      )}

      {!uiHidden && (
        <aside className="exp-panel">
          <div className="exp-brand">{property.branding?.tagline ?? "Spatial Lab Experiences"}</div>
          <h1>{property.title}</h1>
          <p className="exp-desc">{property.description}</p>

          <div className="exp-field">
            Scene
            <div className="exp-nav-seg wrap">
              {EXPERIENCE_CATALOG.properties.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={property.id === p.id ? "on" : ""}
                  title={p.sizeHint}
                  onClick={() => setPropertyId(p.id)}
                >
                  {p.id === "xgrids-room" ? "Room" : p.id === "xgrids-penthouse" ? "Penthouse" : "Revit Home"}
                </button>
              ))}
            </div>
          </div>

          <div className="exp-field">
            Quality
            <div className="exp-nav-seg wrap">
              {(Object.keys(QUALITY_PRESETS) as QualityPresetId[]).map((id) => (
                <button key={id} type="button" className={qualityId === id ? "on" : ""} onClick={() => setQualityId(id)} title={QUALITY_PRESETS[id].note}>
                  {QUALITY_PRESETS[id].label}
                </button>
              ))}
            </div>
          </div>

          <div className="exp-nav-seg">
            <button type="button" className={navMode === "first-person" ? "on" : ""} onClick={() => setNavMode("first-person")}>
              Walk
            </button>
            <button type="button" className={navMode === "orbit" ? "on" : ""} onClick={() => setNavMode("orbit")}>
              Orbit
            </button>
            <button type="button" onClick={() => setResetToken((n) => n + 1)}>
              Reset
            </button>
            <button type="button" onClick={() => setHelpOpen(true)}>
              Help
            </button>
          </div>
          <p className="exp-hint">
            {navMode === "first-person"
              ? "Click the scene, then WASD move · drag look · double-click lock · Shift faster · Esc unlock"
              : "Drag orbit · scroll zoom"}
            {stats?.collisionActive ? " · collision on" : stats?.hasCollision === false ? " · no collision mesh" : ""}
          </p>

          <b className="exp-sub">Rooms</b>
          {rooms.length === 0 ? (
            <p className="exp-hint">
              {property.viewpointsReady ? "No rooms yet." : "Inspect this scene before inventing room names."}
            </p>
          ) : (
            <ul className="exp-list">
              {rooms.map((room) => {
                const vp = content.viewpoints.find((v) => (v.roomId || v.name) === room);
                if (!vp) return null;
                return (
                  <li key={room}>
                    <button type="button" onClick={() => goViewpoint(vp)}>
                      {room}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <b className="exp-sub">Hotspots</b>
          {content.hotspots.length === 0 ? (
            <p className="exp-hint">None yet.</p>
          ) : (
            <ul className="exp-list">
              {content.hotspots.map((hs) => (
                <li key={hs.id}>
                  <button type="button" className={selectedHs?.id === hs.id ? "on" : ""} onClick={() => setSelectedHs(hs)}>
                    {hs.title}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="exp-actions">
            <button type="button" onClick={() => setUiHidden(true)}>
              Hide UI
            </button>
            <button type="button" onClick={toggleFullscreen}>
              Fullscreen
            </button>
            <button type="button" className={devOpen ? "on" : ""} onClick={() => setDevOpen((v) => !v)}>
              Dev
            </button>
          </div>

          {devOpen && (
            <div className="exp-dev">
              <div className="exp-dev-stats">
                {stats?.phase ?? "…"} · {stats?.fps ?? "—"} fps · {stats?.frameMs?.toFixed?.(1) ?? "—"} ms/frame · DPR{" "}
                {stats?.pixelRatio?.toFixed?.(2) ?? "—"} · budget {(quality.maxSplats / 1e6).toFixed(1)}M · dist{" "}
                {quality.maxDistance}m · SDK {LCC_SDK_VERSION_LABEL}
                {stats?.metaSummary ? ` · ${stats.metaSummary}` : ""}
              </div>
              <label className="exp-check">
                <input type="checkbox" checked={collisionOn} onChange={(e) => setCollisionOn(e.target.checked)} />
                Capsule collision / floor follow
              </label>
              <div className="exp-dev-row">
                <button type="button" onClick={() => setSampleToken((n) => n + 1)}>
                  Capture camera
                </button>
                <input type="text" placeholder="Viewpoint name" value={vpName} onChange={(e) => setVpName(e.target.value)} />
                <input type="text" placeholder="Room label" value={vpRoom} onChange={(e) => setVpRoom(e.target.value)} />
                <button type="button" disabled={!pendingSample || !vpName.trim()} onClick={recordViewpoint}>
                  Save viewpoint
                </button>
              </div>
              {pendingSample && (
                <div className="exp-hint">
                  Eye [{pendingSample.position.map((n) => n.toFixed(2)).join(", ")}]
                </div>
              )}
              <div className="exp-dev-row">
                <button type="button" className={placeMode ? "on" : ""} onClick={() => setPlaceMode((v) => !v)}>
                  {placeMode ? "Click scene…" : "Place hotspot"}
                </button>
              </div>
              {pendingPlace && (
                <>
                  <input type="text" placeholder="Title" value={hsTitle} onChange={(e) => setHsTitle(e.target.value)} />
                  <textarea placeholder="Description" rows={2} value={hsDesc} onChange={(e) => setHsDesc(e.target.value)} />
                  <button type="button" disabled={!hsTitle.trim()} onClick={savePlacedHotspot}>
                    Save hotspot
                  </button>
                </>
              )}
              <b className="exp-sub">Edit viewpoints</b>
              <ul className="exp-list compact">
                {content.viewpoints.map((vp) => (
                  <li key={vp.id}>
                    <span>
                      {vp.name}
                      {vp.roomId ? ` · ${vp.roomId}` : ""}
                    </span>
                    <span className="exp-dev-row">
                      <button type="button" onClick={() => moveViewpoint(vp.id, -1)}>
                        ↑
                      </button>
                      <button type="button" onClick={() => moveViewpoint(vp.id, 1)}>
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeOverrideViewpoint(property.id, vp.id);
                          setOverrides(loadOverrides(property.id));
                        }}
                      >
                        Del
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {overrides.hotspots.length > 0 && (
                <ul className="exp-list compact">
                  {overrides.hotspots.map((hs) => (
                    <li key={hs.id}>
                      <span>{hs.title}</span>
                      <button
                        type="button"
                        onClick={() => {
                          removeOverrideHotspot(property.id, hs.id);
                          setOverrides(loadOverrides(property.id));
                        }}
                      >
                        Del
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {loadLog.length > 0 && (
                <div className="exp-load-log">
                  {loadLog.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 48)}`}>{line}</div>
                  ))}
                </div>
              )}
              <Link href="/labs/lcc-web-sdk" className="exp-lab-link">
                SDK playground
              </Link>
            </div>
          )}

          <Link href="/" className="exp-lab-link">
            ← Spatial Lab
          </Link>
        </aside>
      )}

      {!uiHidden && (
        <div className="exp-map-dock">
          <FloorMapPanel
            floor={floor}
            viewpoints={content.viewpoints}
            cameraPos={pose?.position ?? null}
            yaw={pose?.yaw ?? null}
            expanded={mapOpen}
            onToggle={() => setMapOpen((v) => !v)}
            onSelectViewpoint={goViewpoint}
          />
        </div>
      )}

      {uiHidden && (
        <button type="button" className="exp-show-ui" onClick={() => setUiHidden(false)}>
          Show UI
        </button>
      )}

      {helpOpen && (
        <div className="exp-help" role="dialog" aria-label="Navigation help">
          <h2>How to move</h2>
          <ul>
            <li>
              <b>Walk</b> (default): click the 3D view first · WASD or arrows · drag to look · double-click for pointer lock · Shift faster · Esc unlock
            </li>
            <li>
              <b>Orbit</b>: drag to orbit · scroll to zoom
            </li>
            <li>Gold markers open notes · Rooms list and floor map jump to saved views</li>
            <li>Quality: Performance / Balanced / Quality if the tour feels choppy</li>
          </ul>
          <button type="button" onClick={dismissHelp}>
            Got it
          </button>
        </div>
      )}

      {selectedHs && !uiHidden && (
        <div className="exp-hotspot-card">
          <button type="button" className="exp-card-close" onClick={() => setSelectedHs(null)} aria-label="Close">
            ×
          </button>
          <h2>{selectedHs.title}</h2>
          <p>{selectedHs.description}</p>
          {selectedHs.url && (
            <a href={selectedHs.url} target="_blank" rel="noreferrer">
              Open link
            </a>
          )}
        </div>
      )}
    </div>
  );
}
