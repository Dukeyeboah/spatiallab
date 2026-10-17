"use client";

import Link from "next/link";
import { useState } from "react";
import { captureOfDataset, type Catalog } from "@/lib/catalog";
import {
  defaultName,
  describeSelection,
  folderSelection,
  formatBytes,
  type SplatScene,
  type SplatSelection,
  type SplatUpAxis,
  type StartView,
} from "@/lib/splats";
import type { CameraNavMode, ViewerStats, ViewerStatus } from "./SplatViewer";

type TrainingStartPose = { position: [number, number, number]; target: [number, number, number]; fov: number };

type SplatPanelProps = {
  scenes: SplatScene[];
  catalog: Catalog | null;
  selected: SplatScene | null;
  onSelect: (id: string) => void;
  status: ViewerStatus;
  stats: ViewerStats | null;
  ministats: boolean;
  onMinistatsChange: (on: boolean) => void;
  onResetCamera: () => void;
  startView: StartView;
  onStartViewChange: (view: StartView) => void;
  upAxis: SplatUpAxis;
  onUpAxisChange: (axis: SplatUpAxis) => void;
  cameraMode: CameraNavMode;
  onCameraModeChange: (mode: CameraNavMode) => void;
  onApplyTrainingStart: (pose: TrainingStartPose) => void;
  onClearTrainingStart: () => void;
  onAssign: (captureId: string | null) => void;
  onDelete: () => void;
  onImport: (name: string, selection: SplatSelection, onProgress: (fraction: number) => void) => Promise<void>;
  /** Backend unreachable / request failed. */
  error: string | null;
  busy: boolean;
};

const STANDALONE = "";

export function SplatPanel(props: SplatPanelProps) {
  const { scenes, catalog, selected, status, stats } = props;
  const captureLabel = (captureId: string) => {
    const capture = catalog?.captures.find((c) => c.id === captureId);
    const property = catalog?.properties.find((p) => p.id === capture?.propertyId);
    return capture ? `${property?.name ?? "?"} › ${capture.name}` : "?";
  };
  const captureOf = (id: string) => (catalog ? captureOfDataset(catalog, id) : undefined);
  const standalone = scenes.filter((s) => !captureOf(s.id));
  const inCaptures = new Map<string, SplatScene[]>();
  for (const scene of scenes) {
    const capture = captureOf(scene.id);
    if (capture) inCaptures.set(capture.id, [...(inCaptures.get(capture.id) ?? []), scene]);
  }
  const selectedCapture = selected ? captureOf(selected.id) : undefined;

  return (
    <div className="controls wide">
      <div className="title-row">
        <h1>Gaussian Viewer</h1>
        <button onClick={props.onResetCamera} disabled={status.phase !== "loaded"}>
          Reset camera
        </button>
      </div>
      <Link href="/" className="lab-link">
        ← LiDAR viewer
      </Link>
      <Link href="/gaussian-compositing" className="lab-link">
        ← Lab 7B: how many Gaussians blend into one image
      </Link>
      <Link href="/gaussian-inspector" className="lab-link">
        Lab 9: inspect single Gaussians of a PLY scene →
      </Link>
      <div className="note">
        Real trained Gaussian splat scenes, rendered by the official SuperSplat Viewer (PlayCanvas). Orbit: drag
        to orbit, scroll to zoom, right-drag to pan. Fly: WASD + mouse look (enable Gaming Controls in the
        viewer if needed). For XGRIDS / Nerfstudio LAS Z-up PLYs, set World up to &quot;LAS Z-up&quot;.
      </div>

      {props.error && <div className="error">{props.error}</div>}

      <div className="section datasets">
        <b>Scene</b>
        {scenes.length === 0 ? (
          <div className="note">No Gaussian scenes yet: import one below.</div>
        ) : (
          <select value={selected?.id ?? ""} onChange={(e) => props.onSelect(e.target.value)} aria-label="Scene">
            {standalone.length > 0 && (
              <optgroup label="Standalone scenes">
                {standalone.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            {[...inCaptures].map(([captureId, list]) => (
              <optgroup key={captureId} label={captureLabel(captureId)}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {selected && <SceneInfo scene={selected} />}
        <ViewerState status={status} />

        {selected && (
          <>
            <span>World up</span>
            <div className="segmented">
              {(
                [
                  ["colmap-y-down", "COLMAP Y-down"],
                  ["las-z-up", "LAS Z-up"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={props.upAxis === value ? "selected" : ""}
                  disabled={props.busy}
                  onClick={() => props.onUpAxisChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="note">
              COLMAP Y-down is the Lab 8 default (Ceramic Studio). LAS Z-up is for Nerfstudio exports that kept
              the LiDAR Z-up world (Lab 14B). Switching reloads the scene.
            </div>

            <span>Navigate</span>
            <div className="segmented">
              {(["orbit", "fly"] as const).map((mode) => (
                <button
                  key={mode}
                  className={props.cameraMode === mode ? "selected" : ""}
                  onClick={() => props.onCameraModeChange(mode)}
                >
                  {mode === "orbit" ? "Orbit" : "Fly"}
                </button>
              ))}
            </div>
          </>
        )}

        {selected?.robustBounds && !selected.frame?.startPose && (
          <>
            <span>Start view</span>
            <div className="segmented">
              {(["inside", "outside"] as const).map((view) => (
                <button
                  key={view}
                  className={props.startView === view ? "selected" : ""}
                  onClick={() => props.onStartViewChange(view)}
                >
                  {view === "inside" ? "Inside" : "Outside"}
                </button>
              ))}
            </div>
            <div className="note">
              Inside suits rooms and places, outside suits objects; the default is a guess from how the splats
              are spread. Switching reloads the scene.
            </div>
          </>
        )}

        {selected && (
          <TrainingStartControls
            hasStartPose={!!selected.frame?.startPose}
            busy={props.busy}
            onApply={props.onApplyTrainingStart}
            onClear={props.onClearTrainingStart}
          />
        )}
      </div>

      {selected && (
        <div className="section dataset-info">
          <b>Performance</b>
          {stats ? (
            <>
              <span>Renderer: {stats.renderer}</span>
              <span>
                {Math.round(stats.fps)} fps · {stats.frameMs.toFixed(1)} ms per frame
              </span>
              {stats.splatsDrawn > 0 && <span>Splats drawn: {stats.splatsDrawn.toLocaleString()}</span>}
              <span>GPU memory: {formatBytes(stats.vramBytes)}</span>
            </>
          ) : (
            <span>—</span>
          )}
          <label>
            <input type="checkbox" checked={props.ministats} onChange={(e) => props.onMinistatsChange(e.target.checked)} />
            Performance graphs (reloads the scene)
          </label>
          <span className="note">
            The viewer renders only when the view changes, so fps drops to near zero while nothing moves.
          </span>
        </div>
      )}

      {selected && (
        <div className="section datasets">
          <b>Organisation</b>
          <select
            value={selectedCapture?.id ?? STANDALONE}
            disabled={!catalog || props.busy}
            onChange={(e) => props.onAssign(e.target.value || null)}
            aria-label="Capture"
          >
            <option value={STANDALONE}>Standalone scene (no capture)</option>
            {catalog?.properties.map((p) => (
              <optgroup key={p.id} label={p.name}>
                {catalog.captures
                  .filter((c) => c.propertyId === p.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <div className="note">
            A capture can hold this scene next to its LiDAR, but nothing is aligned: the splat keeps the frame it
            was trained in. Manage properties and captures in the LiDAR viewer.
          </div>
          <div className="dataset-actions">
            <button onClick={props.onDelete} disabled={props.busy} title="Permanently delete this scene's files">
              Delete scene files
            </button>
          </div>
        </div>
      )}

      <ImportForm onImport={props.onImport} disabled={props.busy || !!props.error} />
    </div>
  );
}

function SceneInfo({ scene }: { scene: SplatScene }) {
  const sourceKind = { file: "file", folder: "folder", zip: "zip archive" }[scene.source.kind];
  return (
    <div className="dataset-info">
      <span>Format: {scene.formatLabel}</span>
      <span>
        Splats: {scene.splatCount?.toLocaleString() ?? "unknown"}
        {scene.shBands != null && ` · SH bands: ${scene.shBands}`}
        {scene.lodLevels != null && ` · LOD levels: ${scene.lodLevels}`}
      </span>
      <span>
        Scene files: {formatBytes(scene.sceneBytes)} ({scene.files.length} file{scene.files.length === 1 ? "" : "s"})
      </span>
      <span>
        Imported from {sourceKind} &quot;{scene.source.filename}&quot; ({formatBytes(scene.source.bytes)})
      </span>
      {scene.conversion && <span>Conversion: {scene.conversion.detail} (original kept)</span>}
      <span>
        Frame: {scene.frame.upAxis}
        {scene.frame.startPose ? " · start at training camera" : ""} — not aligned to any LiDAR capture
      </span>
      {scene.robustBounds && (
        <span title="2nd–98th percentile of the splat centres; the full box includes stray splats far away">
          Extent (core): {scene.robustBounds.min.map((v, i) => (scene.robustBounds!.max[i] - v).toFixed(1)).join(" × ")}{" "}
          units
        </span>
      )}
      {scene.warnings.map((warning) => (
        <span key={warning} className="status">
          {warning}
        </span>
      ))}
      {scene.license && (
        <details>
          <summary>License / attribution</summary>
          <pre className="license">{scene.license}</pre>
        </details>
      )}
    </div>
  );
}

function TrainingStartControls({
  hasStartPose,
  busy,
  onApply,
  onClear,
}: {
  hasStartPose: boolean;
  busy: boolean;
  onApply: (pose: TrainingStartPose) => void;
  onClear: () => void;
}) {
  return (
    <details className="section datasets" style={{ marginTop: 8 }}>
      <summary>Start at a training camera</summary>
      <div className="note">
        Paste one camera from Lab 14C <code>training-cameras-quick.json</code> (use the{" "}
        <code>positionNs</code> / <code>targetNs</code> values — they are in the Nerfstudio file frame). Sets
        World up to LAS Z-up and reloads at that pose.
      </div>
      {hasStartPose ? (
        <button onClick={onClear} disabled={busy}>
          Clear training start (use Inside/Outside again)
        </button>
      ) : (
        <button
          disabled={busy}
          onClick={() => {
            const raw = window.prompt(
              'Paste JSON: {"position":[x,y,z],"target":[x,y,z],"fov":60} (Nerfstudio / file frame)',
            );
            if (!raw) return;
            try {
              const parsed = JSON.parse(raw) as {
                position?: number[];
                target?: number[];
                positionNs?: number[];
                targetNs?: number[];
                fov?: number;
                viewerZUpLas?: TrainingStartPose;
              };
              const position = (parsed.positionNs ?? parsed.position ?? parsed.viewerZUpLas?.position) as
                | number[]
                | undefined;
              const target = (parsed.targetNs ?? parsed.target ?? parsed.viewerZUpLas?.target) as
                | number[]
                | undefined;
              if (!position || !target || position.length !== 3 || target.length !== 3) {
                throw new Error("Need position and target arrays of length 3");
              }
              // Prefer file-frame Ns coords; if the user pasted viewerZUpLas only, convert back is not available —
              // require Ns / file frame.
              if (parsed.viewerZUpLas && !parsed.positionNs && !parsed.position) {
                window.alert("Paste positionNs/targetNs (file frame), not viewerZUpLas.");
                return;
              }
              onApply({
                position: position as [number, number, number],
                target: target as [number, number, number],
                fov: parsed.fov ?? parsed.viewerZUpLas?.fov ?? 60,
              });
            } catch (e) {
              window.alert(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Paste training camera JSON…
        </button>
      )}
    </details>
  );
}

function ViewerState({ status }: { status: ViewerStatus }) {
  if (status.phase === "loading") {
    return (
      <div className="dataset-info">
        <span className="status">Loading scene… {Math.round(status.progress)}%</span>
        <progress max={100} value={status.progress} />
      </div>
    );
  }
  if (status.phase === "loaded") return <div className="note">Loaded in {status.seconds.toFixed(1)} s</div>;
  if (status.phase === "error") return <div className="error">{status.message}</div>;
  return null;
}

function ImportForm({
  onImport,
  disabled,
}: {
  onImport: SplatPanelProps["onImport"];
  disabled: boolean;
}) {
  const [selection, setSelection] = useState<SplatSelection | null>(null);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const described = selection ? describeSelection(selection) : null;

  function choose(next: SplatSelection | null) {
    setSelection(next);
    setError(null);
    if (next) setName(defaultName(next));
  }

  async function submit() {
    if (!selection || described?.error) return;
    setError(null);
    setProgress(0);
    try {
      await onImport(name, selection, setProgress);
      setSelection(null);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <details className="section datasets">
      <summary>Import a Gaussian scene</summary>
      <div className="import-form">
        <div className="note">
          A trained Gaussian .ply, a .sog, a SOG folder (meta.json or lod-meta.json + WebP images), or a .zip of
          any of these, e.g. a SuperSplat download. Originals are kept; zips are extracted next to them.
        </div>
        <div className="dataset-actions">
          <label className="picker">
            Choose file…
            <input
              type="file"
              accept=".ply,.sog,.zip"
              disabled={disabled || progress !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                choose(file ? { kind: "file", file } : null);
                e.target.value = "";
              }}
            />
          </label>
          <label className="picker">
            Choose folder…
            <input
              type="file"
              // Not in React's types: lets the user pick a whole folder (all files inside, recursively).
              ref={(input) => input?.setAttribute("webkitdirectory", "")}
              disabled={disabled || progress !== null}
              onChange={(e) => {
                const files = e.target.files;
                choose(files && files.length ? folderSelection(files) : null);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {described && <div className="import-summary">{described.summary}</div>}
        {described?.error && <div className="error">{described.error}</div>}
        {selection && !described?.error && (
          <>
            <label className="stacked">
              Name
              <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </label>
            <button onClick={submit} disabled={disabled || progress !== null || !name.trim()}>
              {progress === null ? "Import" : progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Checking…"}
            </button>
          </>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </details>
  );
}
