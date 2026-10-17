"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { LccPlainHost, type LccHostStats, type NavMode, type PickMode } from "@/components/labs/lcc/LccPlainHost";
import { DEFAULT_LCC_SAMPLE_PATH, LCC_SDK_VERSION_LABEL } from "@/lib/labs/lccSdk";
import { LCC_SAMPLES, sampleByPath } from "@/lib/labs/lccSamples";

/**
 * Lab LCC-WEB-01 — XGRIDS LCC tour playground.
 *
 * Architecture (intentional):
 *   Next.js / React  → pages, panels, sample picker, branding
 *   Plain Three.js + LCC SDK → Gaussian rendering, camera, picking, collision
 *
 * R3F remains elsewhere in Spatial Lab (LiDAR, shader labs). The experimental
 * LCC↔R3F bridge is preserved in LccR3FHost.tsx but not offered in this UI.
 */
export default function LccWebSdkLabPage() {
  const [dataPath, setDataPath] = useState(DEFAULT_LCC_SAMPLE_PATH);
  const [appKey, setAppKey] = useState("");
  const [navMode, setNavMode] = useState<NavMode>("orbit");
  const [pickMode, setPickMode] = useState<PickMode>("splat");
  const [useEnv, setUseEnv] = useState(true);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [stats, setStats] = useState<LccHostStats | null>(null);

  const onStats = useCallback((s: LccHostStats) => setStats(s), []);
  const progressPct = useMemo(() => Math.round((stats?.progress ?? 0) * 1000) / 10, [stats?.progress]);
  const selected = sampleByPath(dataPath);

  return (
    <div className="lcc-lab">
      <aside className="controls lcc-panel">
        <div className="title-row">
          <h1>LCC Web SDK</h1>
        </div>
        <Link href="/" className="lab-link">
          ← Spatial Lab
        </Link>
        <Link href="/labs/spatial-experiences" className="lab-link">
          Spatial Lab Experiences →
        </Link>
        <div className="unit">
          Lab LCC-WEB-01 · SDK {LCC_SDK_VERSION_LABEL} · Plain Three.js tour playground (not LiDAR / not SuperSplat)
        </div>

        <div className="section">
          <b className="sub">How to open</b>
          <div className="note">
            1. <code>npm run dev</code> → open <a href="/labs/lcc-web-sdk">/labs/lcc-web-sdk</a>
            <br />
            2. Pick a <b>sample</b> below, then wait for <b>Phase ready</b> / Progress ~100%.
            <br />
            3. <b>Orbit:</b> left-drag rotate. <b>First person:</b> WASD + left-drag look. Ctrl+click picks.
            <br />
            4. First load of a scene streams <code>.sog</code> tiles (can take a while); later visits use
            IndexedDB cache. Only one scene is loaded at a time.
          </div>
        </div>

        <div className="section">
          <b className="sub">Sample scene</b>
          <label>
            Package
            <select
              value={dataPath}
              onChange={(e) => {
                setDataPath(e.target.value);
                setResetToken(0);
              }}
            >
              {LCC_SAMPLES.map((s) => (
                <option key={s.id} value={s.dataPath}>
                  {s.label} ({s.sizeHint})
                </option>
              ))}
            </select>
          </label>
          {selected?.note && <div className="unit">{selected.note}</div>}
          <div className="note">
            Entry: <code>{dataPath}</code> (LCC2 + <code>.sog</code> tiles). Larger packages (Church, Office) need more
            GPU/VRAM — if it stutters, stay on Room / Home / Sculpture first.
          </div>
          <label>
            appKey (optional)
            <input
              type="text"
              value={appKey}
              placeholder="leave empty for sample / null"
              onChange={(e) => setAppKey(e.target.value)}
            />
          </label>
        </div>

        <div className="section">
          <b className="sub">Navigation</b>
          <div className="segmented">
            <button className={navMode === "orbit" ? "selected" : ""} onClick={() => setNavMode("orbit")}>
              Orbit
            </button>
            <button className={navMode === "first-person" ? "selected" : ""} onClick={() => setNavMode("first-person")}>
              First person
            </button>
          </div>
          <div className="dataset-actions">
            <button onClick={() => setResetToken((n) => n + 1)}>Reset camera</button>
          </div>
          <div className="note">Orbit = click-drag rotate. First person = WASD walk + click-drag look.</div>
        </div>

        <div className="section">
          <b className="sub">Interaction</b>
          <div className="segmented">
            <button className={pickMode === "splat" ? "selected" : ""} onClick={() => setPickMode("splat")}>
              Pick splat
            </button>
            <button className={pickMode === "collision" ? "selected" : ""} onClick={() => setPickMode("collision")}>
              Pick collision
            </button>
          </div>
          <div className="note">Ctrl+click to pick. Collision needs mesh data + <code>intersectsRayExt</code>.</div>
          <label>
            <input type="checkbox" checked={useEnv} onChange={(e) => setUseEnv(e.target.checked)} /> Environment splats
          </label>
          <label>
            <input type="checkbox" checked={clipEnabled} onChange={(e) => setClipEnabled(e.target.checked)} /> Clip box
            (diagnostic)
          </label>
        </div>

        <div className="section">
          <b className="sub">Status</b>
          <table className="attr-table stats">
            <tbody>
              <tr>
                <td>Progress</td>
                <td>{progressPct}%</td>
              </tr>
              {stats && (
                <>
                  <tr>
                    <td>Phase</td>
                    <td>{stats.phase}</td>
                  </tr>
                  <tr>
                    <td>FPS</td>
                    <td>{stats.fps}</td>
                  </tr>
                  <tr>
                    <td>SDK</td>
                    <td>{stats.sdkVersion}</td>
                  </tr>
                  <tr>
                    <td>Three</td>
                    <td>r{stats.threeRevision} (app)</td>
                  </tr>
                  <tr>
                    <td>Env / collision</td>
                    <td>
                      {stats.hasEnv ? "env" : "no env"} · {stats.hasCollision ? "collision" : "no collision"}
                    </td>
                  </tr>
                  <tr>
                    <td>Meta</td>
                    <td>{stats.metaSummary ?? "—"}</td>
                  </tr>
                  <tr>
                    <td>Bounds</td>
                    <td>{stats.boundsSummary ?? "—"}</td>
                  </tr>
                  <tr>
                    <td>Last pick</td>
                    <td>{stats.lastPick ?? "—"}</td>
                  </tr>
                  {stats.error && (
                    <tr>
                      <td>Error</td>
                      <td className="error">{stats.error}</td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className="note">
          Host: Plain Three.js only (R3F option hidden for now — more lag, incomplete nav). Report:{" "}
          <code>docs/labs/lcc-web-sdk-feasibility.md</code>.
        </div>
      </aside>

      <main className="lcc-stage">
        <LccPlainHost
          key={`plain-${dataPath}-${appKey}`}
          dataPath={dataPath}
          navMode={navMode}
          pickMode={pickMode}
          useEnv={useEnv}
          clipEnabled={clipEnabled}
          appKey={appKey}
          onStats={onStats}
          resetToken={resetToken}
        />
      </main>
    </div>
  );
}
