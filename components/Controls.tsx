"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { DatasetBudget } from "@/lib/datasets";
import { GaussianShapePanel } from "./GaussianShapePanel";
import {
  EXPERIMENT_PARAMETERS,
  TRANSPARENT_EXPERIMENTS,
  defaultSoftPointSettings,
  type RenderMode,
  type ShaderExperiment,
  type SoftPointSettings,
  type ViewSettings,
} from "@/lib/viewSettings";

const RENDER_MODES: { mode: RenderMode; label: string }[] = [
  { mode: "standard", label: "Standard Points" },
  { mode: "shader", label: "Shader Points" },
];

const SHADER_EXPERIMENTS: { experiment: ShaderExperiment; label: string }[] = [
  { experiment: "rgb", label: "RGB" },
  { experiment: "height", label: "Height" },
  { experiment: "depthSize", label: "Depth Size" },
  { experiment: "circle", label: "Circle" },
  { experiment: "softCircle", label: "Soft Circle" },
  { experiment: "gaussian", label: "Gaussian Point" },
  { experiment: "ellipticalGaussian", label: "Elliptical Gaussian" },
];

type ControlsProps = {
  /** The collapsible Datasets section (rendered at the top). */
  datasetPanel: ReactNode;
  /** The selected dataset's budgets. */
  budgets: DatasetBudget[];
  budget: DatasetBudget | null;
  onBudgetChange: (budgetKey: string) => void;
  pointCount: number;
  /** Size and load time of the current budget, e.g. "75.0 MB in 1.8 s". */
  loadInfo: string | null;
  poseCount: number;
  poseError: string | null;
  /** Why the dataset's poses aren't shown (none uploaded, failed checks). */
  poseNote: string | null;
  /** 0-based selected pose. */
  poseIndex: number;
  onPoseIndexChange: (index: number) => void;
  elapsedSeconds: number;
  status: string | null;
  error: string | null;
  settings: ViewSettings;
  onChange: (settings: ViewSettings) => void;
  onResetView: () => void;
};

/** A plain HTML panel drawn on top of the canvas. */
export function Controls({
  datasetPanel,
  budgets,
  budget,
  onBudgetChange,
  pointCount,
  loadInfo,
  poseCount,
  poseError,
  poseNote,
  poseIndex,
  onPoseIndexChange,
  elapsedSeconds,
  status,
  error,
  settings,
  onChange,
  onResetView,
}: ControlsProps) {
  // Helper: copy the settings and change one field.
  function update<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  // Same, for one field inside settings.softPoints.
  function updateSoft<K extends keyof SoftPointSettings>(key: K, value: SoftPointSettings[K]) {
    onChange({ ...settings, softPoints: { ...settings.softPoints, [key]: value } });
  }

  const soft = settings.softPoints;
  const experiment = settings.shaderExperiment;
  const experimentParameters = EXPERIMENT_PARAMETERS[experiment];

  // Put this experiment's parameters back to their defaults; leave the others alone.
  function resetExperiment() {
    const softPoints = { ...soft };
    for (const key of experimentParameters ?? []) {
      Object.assign(softPoints, { [key]: defaultSoftPointSettings[key] });
    }
    onChange({ ...settings, softPoints });
  }

  return (
    <div className="controls">
      <div className="title-row">
        <h1>Spatial Lab</h1>
        <button onClick={onResetView}>Reset View</button>
      </div>
      <Link href="/gaussian-projection" className="lab-link">
        Lab 6: 3D Gaussian Projection →
      </Link>
      <Link href="/gaussian-compositing" className="lab-link">
        Lab 7B: Gaussian Compositing →
      </Link>
      <Link href="/gaussian-viewer" className="lab-link">
        Lab 8: Gaussian Splat Viewer →
      </Link>

      {datasetPanel}

      <div className="budget">
        Point Budget
        <div className="segmented">
          {budgets.map((option) => (
            <button
              key={option.key}
              className={option.key === budget?.key ? "selected" : ""}
              onClick={() => onBudgetChange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        Renderer
        <div className="segmented">
          {RENDER_MODES.map((option) => (
            <button
              key={option.mode}
              className={option.mode === settings.renderMode ? "selected" : ""}
              onClick={() => update("renderMode", option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {settings.renderMode === "shader" && (
        <div>
          Shader Experiment
          <div className="segmented wrap">
            {SHADER_EXPERIMENTS.map((option) => (
              <button
                key={option.experiment}
                className={option.experiment === experiment ? "selected" : ""}
                onClick={() => update("shaderExperiment", option.experiment)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {settings.renderMode === "shader" && experiment === "softCircle" && (
        <div className="section">
          {/* Inner must stay below outer, so each slider is limited by the other. */}
          <label>
            Inner radius
            <input
              type="range"
              min={0}
              max={soft.outerRadius - 0.01}
              step={0.01}
              value={soft.innerRadius}
              onChange={(e) => updateSoft("innerRadius", Number(e.target.value))}
            />
            {soft.innerRadius.toFixed(2)}
          </label>
          <label>
            Outer radius
            <input
              type="range"
              min={soft.innerRadius + 0.01}
              max={0.5}
              step={0.01}
              value={soft.outerRadius}
              onChange={(e) => updateSoft("outerRadius", Number(e.target.value))}
            />
            {soft.outerRadius.toFixed(2)}
          </label>
        </div>
      )}

      {settings.renderMode === "shader" && experiment === "gaussian" && (
        <div className="section">
          <label>
            Sigma
            <input
              type="range"
              min={0.05}
              max={0.5}
              step={0.01}
              value={soft.sigma}
              onChange={(e) => updateSoft("sigma", Number(e.target.value))}
            />
            {soft.sigma.toFixed(2)}
          </label>
          <label>
            Opacity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={soft.opacity}
              onChange={(e) => updateSoft("opacity", Number(e.target.value))}
            />
            {soft.opacity.toFixed(2)}
          </label>
          <div className="note">
            A Gaussian-shaped point sprite: each point is still a flat, screen-facing square whose
            alpha fades like a bell curve. Not a full Gaussian splat (no 3D shape, no sorting).
          </div>
        </div>
      )}

      {settings.renderMode === "shader" && experiment === "ellipticalGaussian" && (
        <div className="section">
          <label>
            Sigma X
            <input
              type="range"
              min={0.03}
              max={0.5}
              step={0.01}
              value={soft.sigmaX}
              onChange={(e) => updateSoft("sigmaX", Number(e.target.value))}
            />
            {soft.sigmaX.toFixed(2)}
          </label>
          <label>
            Sigma Y
            <input
              type="range"
              min={0.03}
              max={0.5}
              step={0.01}
              value={soft.sigmaY}
              onChange={(e) => updateSoft("sigmaY", Number(e.target.value))}
            />
            {soft.sigmaY.toFixed(2)}
          </label>
          <label>
            Rotation
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={soft.rotationDegrees}
              onChange={(e) => updateSoft("rotationDegrees", Number(e.target.value))}
            />
            {soft.rotationDegrees}°
          </label>
          <GaussianShapePanel
            sigmaX={soft.sigmaX}
            sigmaY={soft.sigmaY}
            rotationDegrees={soft.rotationDegrees}
          />
          <div className="note">
            Point-sprite experiment, not 3D Gaussian splatting: every point gets the same ellipse,
            clipped to its screen-aligned square.
          </div>
        </div>
      )}

      {settings.renderMode === "shader" && experimentParameters && (
        <button className="reset-experiment" onClick={resetExperiment}>
          Reset Experiment
        </button>
      )}

      {settings.renderMode === "shader" && TRANSPARENT_EXPERIMENTS.includes(experiment) && (
        <label>
          <input
            type="checkbox"
            checked={soft.depthWrite}
            onChange={(e) => updateSoft("depthWrite", e.target.checked)}
          />
          Depth write (compare halos)
        </label>
      )}

      <div>
        <div>Budget: {budget?.label ?? "—"}</div>
        <div>Loaded points: {pointCount.toLocaleString()}</div>
        {loadInfo && <div className="note">Loaded {loadInfo}</div>}
        <div>Point size: {settings.pointSize}px</div>
        <div>Poses loaded: {poseCount.toLocaleString()}</div>
      </div>
      {status && <div className="status">{status}</div>}
      {error && <div className="error">{error}</div>}
      {poseError && <div className="error">{poseError}</div>}
      {poseNote && <div className="note">{poseNote}</div>}

      <label>
        Size
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={settings.pointSize}
          onChange={(e) => update("pointSize", Number(e.target.value))}
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={settings.showRgb}
          disabled={settings.renderMode === "shader"}
          onChange={(e) => update("showRgb", e.target.checked)}
        />
        RGB colours {settings.renderMode === "shader" && "(Standard only)"}
      </label>

      <label>
        <input
          type="checkbox"
          checked={settings.showAxes}
          onChange={(e) => update("showAxes", e.target.checked)}
        />
        Axes
      </label>

      <label>
        <input
          type="checkbox"
          checked={settings.showGrid}
          onChange={(e) => update("showGrid", e.target.checked)}
        />
        Grid
      </label>

      <label>
        <input
          type="checkbox"
          checked={settings.showPath}
          onChange={(e) => update("showPath", e.target.checked)}
        />
        Show scanner path
      </label>

      <label>
        <input
          type="checkbox"
          checked={settings.showPoses}
          onChange={(e) => update("showPoses", e.target.checked)}
        />
        Show pose points
      </label>

      <div className="section">
        Scan Playback
        <div>
          Pose: {poseCount > 0 ? poseIndex + 1 : 0} / {poseCount}
        </div>
        <div>Elapsed: {elapsedSeconds.toFixed(1)} s</div>
        {/* The slider is 1-based like the display; state is 0-based. */}
        <input
          type="range"
          min={1}
          max={Math.max(poseCount, 1)}
          step={1}
          value={poseIndex + 1}
          disabled={poseCount === 0}
          onChange={(e) => onPoseIndexChange(Number(e.target.value) - 1)}
        />
        <label>
          <input
            type="checkbox"
            checked={settings.showMarker}
            onChange={(e) => update("showMarker", e.target.checked)}
          />
          Show scanner marker
        </label>
      </div>
    </div>
  );
}
