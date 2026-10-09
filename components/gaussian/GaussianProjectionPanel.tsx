"use client";

import Link from "next/link";
import type * as THREE from "three";
import { MatrixDisplay } from "./MatrixDisplay";
import type { ProjectedGaussian } from "@/lib/gaussian/gaussianMath";
import type { GaussianControlsState } from "@/lib/gaussian/gaussianControls";

type GaussianProjectionPanelProps = {
  state: GaussianControlsState;
  onChange: (state: GaussianControlsState) => void;
  onReset: () => void;
  sigma3D: THREE.Matrix3;
  projection: ProjectedGaussian | null;
};

const AXES = ["X", "Y", "Z"] as const;

export function GaussianProjectionPanel({
  state,
  onChange,
  onReset,
  sigma3D,
  projection,
}: GaussianProjectionPanelProps) {
  function update<K extends keyof GaussianControlsState>(key: K, value: GaussianControlsState[K]) {
    onChange({ ...state, [key]: value });
  }

  // Change one component of a [x, y, z] setting.
  function updateAxis(
    key: "position" | "scale" | "rotationDegrees",
    axis: number,
    value: number,
  ) {
    const next = [...state[key]] as [number, number, number];
    next[axis] = value;
    update(key, next);
  }

  const s = sigma3D.elements; // column-major, symmetric
  const sigma3DRows = [
    [s[0], s[3], s[6]],
    [s[1], s[4], s[7]],
    [s[2], s[5], s[8]],
  ];

  return (
    <div className="controls wide">
      <div className="title-row">
        <h1>3D Gaussian Projection</h1>
        <button onClick={onReset}>Reset</button>
      </div>
      <Link href="/" className="lab-link">
        ← LiDAR viewer
      </Link>
      <div className="note">
        One 3D Gaussian (grey wireframe = its 1σ surface) projected through the camera into a 2D
        ellipse (orange). Drag to orbit: the Gaussian stays fixed in the world, its projection
        changes.
      </div>

      <div className="section">
        <b>Position</b>
        <div className="note">Where the centre sits in the world. Z moves it towards (+) or away from (−) the starting camera.</div>
        {AXES.map((axis, i) => (
          <label key={axis}>
            {axis}
            <input
              type="range"
              min={i === 2 ? -30 : -4}
              max={i === 2 ? 8 : 4}
              step={0.05}
              value={state.position[i]}
              onChange={(e) => updateAxis("position", i, Number(e.target.value))}
            />
            {state.position[i].toFixed(2)}
          </label>
        ))}
      </div>

      <div className="section">
        <b>Scale (1σ, metres)</b>
        <div className="note">Spread along the Gaussian&apos;s own axes. Equal values = a sphere.</div>
        {AXES.map((axis, i) => (
          <label key={axis}>
            {axis}
            <input
              type="range"
              min={0.02}
              max={2}
              step={0.01}
              value={state.scale[i]}
              onChange={(e) => updateAxis("scale", i, Number(e.target.value))}
            />
            {state.scale[i].toFixed(2)}
          </label>
        ))}
      </div>

      <div className="section">
        <b>Rotation (Euler XYZ, degrees)</b>
        <div className="note">Turns the Gaussian&apos;s axes. Converted to a quaternion internally.</div>
        {AXES.map((axis, i) => (
          <label key={axis}>
            {axis}
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={state.rotationDegrees[i]}
              onChange={(e) => updateAxis("rotationDegrees", i, Number(e.target.value))}
            />
            {state.rotationDegrees[i]}°
          </label>
        ))}
      </div>

      <div className="section">
        <label>
          Opacity
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={state.opacity}
            onChange={(e) => update("opacity", Number(e.target.value))}
          />
          {state.opacity.toFixed(2)}
        </label>
        <label>
          Support
          <input
            type="range"
            min={1}
            max={4}
            step={0.5}
            value={state.supportSigmas}
            onChange={(e) => update("supportSigmas", Number(e.target.value))}
          />
          {state.supportSigmas}σ
        </label>
        <div className="note">Support: how many standard deviations the quad covers; outside it nothing is drawn.</div>
        <label>
          <input
            type="checkbox"
            checked={state.showOutline}
            onChange={(e) => update("showOutline", e.target.checked)}
          />
          Footprint outline
        </label>
        <div className="note">White = 1σ ellipse, blue = support ellipse, grey = the quad.</div>
        <label>
          <input
            type="checkbox"
            checked={state.showEllipsoid}
            onChange={(e) => update("showEllipsoid", e.target.checked)}
          />
          3D 1σ ellipsoid
        </label>
      </div>

      <div className="section">
        <MatrixDisplay label="Σ3D = R S Sᵀ Rᵀ" rows={sigma3DRows} digits={4} unit="m²" />
        {projection?.visible ? (
          <>
            <MatrixDisplay
              label="Σ2D = J W Σ3D Wᵀ Jᵀ"
              rows={[
                [projection.cov2D.a, projection.cov2D.b],
                [projection.cov2D.b, projection.cov2D.c],
              ]}
              digits={1}
              unit="px²"
            />
            <div className="note">
              depth {projection.depth.toFixed(2)} m · σ major {projection.sigmaMajorPx.toFixed(1)} px ·
              σ minor {projection.sigmaMinorPx.toFixed(1)} px · angle {projection.angleDeg.toFixed(0)}°
              {projection.clamped && " · footprint clamped"}
            </div>
          </>
        ) : (
          <div className="status">
            Not drawn: {projection ? projection.reason : "waiting for first frame"}
          </div>
        )}
      </div>
    </div>
  );
}
