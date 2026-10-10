"use client";

import Link from "next/link";
import { ANIMATION_PRESETS, GAUSSIAN_COUNTS } from "@/lib/gaussian/compositingScene";
import type { CompositingControlsState } from "@/lib/gaussian/compositingControls";
import type { CompositingReport } from "./CompositedGaussians";

type CompositingPanelProps = {
  state: CompositingControlsState;
  onChange: (state: CompositingControlsState) => void;
  onReset: () => void;
  report: CompositingReport | null;
};

const PRESET_LABELS = { none: "None", breathing: "Breathing", wave: "Wave", dreamscape: "Dreamscape" };

/** Linear 0..1 rgb -> CSS colour (the canvas shows these values unconverted, see `linear`). */
function css([r, g, b]: readonly number[]) {
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

export function CompositingPanel({ state, onChange, onReset, report }: CompositingPanelProps) {
  function update<K extends keyof CompositingControlsState>(key: K, value: CompositingControlsState[K]) {
    onChange({ ...state, [key]: value });
  }

  return (
    <div className="controls wide">
      <div className="title-row">
        <h1>Gaussian Compositing</h1>
        <button onClick={onReset}>Reset</button>
      </div>
      <Link href="/" className="lab-link">
        ← LiDAR viewer
      </Link>
      <Link href="/gaussian-projection" className="lab-link">
        ← Lab 6: one Gaussian&apos;s projection
      </Link>
      <div className="note">
        Several 3D Gaussians in three depth layers (red front, green middle, blue back), each projected
        as in Lab 6 and blended into one image. Drag to orbit. The ring in the middle of the screen is
        the probe pixel analysed below.
      </div>

      <div className="section">
        <b>Scene</b>
        <div className="segmented">
          {GAUSSIAN_COUNTS.map((count) => (
            <button
              key={count}
              className={state.count === count ? "selected" : ""}
              onClick={() => update("count", count)}
            >
              {count.toLocaleString()}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button
            className={state.ordering === "correct" ? "selected" : ""}
            onClick={() => update("ordering", "correct")}
          >
            Correct order
          </button>
          <button
            className={state.ordering === "reversed" ? "selected" : ""}
            onClick={() => update("ordering", "reversed")}
          >
            Reversed
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={state.showOutlines}
            onChange={(e) => update("showOutlines", e.target.checked)}
          />
          Footprint outlines (3σ)
        </label>
        <label>
          Opacity ×
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={state.globalOpacity}
            onChange={(e) => update("globalOpacity", Number(e.target.value))}
          />
          {state.globalOpacity.toFixed(2)}
        </label>
        <label>
          Scale ×
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={state.globalScale}
            onChange={(e) => update("globalScale", Number(e.target.value))}
          />
          {state.globalScale.toFixed(2)}
        </label>
      </div>

      <div className="section">
        <b>Animation</b>
        <div className="segmented wrap">
          {ANIMATION_PRESETS.map((preset) => (
            <button
              key={preset}
              className={state.preset === preset ? "selected" : ""}
              onClick={() => update("preset", preset)}
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <div className="note">
          Breathing: scales follow a sine wave. Wave: a ripple moves the centres up and down along X.
          Dreamscape: slow rotations, scale and opacity, each Gaussian with its own phase.
        </div>
        <label>
          Speed
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={state.speed}
            onChange={(e) => update("speed", Number(e.target.value))}
          />
          {state.speed.toFixed(1)}×
        </label>
        <div className="segmented">
          <button onClick={() => update("playing", !state.playing)}>{state.playing ? "Pause" : "Play"}</button>
        </div>
        {report && (
          <div className="note animated-values">
            t = {report.time.toFixed(2)} s · {report.first.name}: scale ×{report.first.scaleFactor.toFixed(3)} ·
            Δy {report.first.dy.toFixed(3)} m · opacity {report.first.opacity.toFixed(3)} · rotated{" "}
            {report.first.rotationDeg.toFixed(1)}°
          </div>
        )}
      </div>

      {report && (
        <div className="section probe">
          <b>Probe pixel (screen centre)</b>
          <div className="note">
            Drawing order here: {report.drawOrder.join(" → ")}
            {report.drawn > report.drawOrder.length && " → …"}
          </div>
          {report.probe.covering === 0 ? (
            <div className="note">No Gaussian covers this pixel: it shows the background.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Gaussian</th>
                  <th title="Distance in front of the camera">depth</th>
                  <th title="This Gaussian's alpha at the pixel">α</th>
                  <th title="Transmittance before it: light left after everything drawn earlier">T</th>
                  <th title="Its share of the pixel colour: T × α">T·α</th>
                </tr>
              </thead>
              <tbody>
                {report.probe.rows.map((row) => (
                  <tr key={row.index}>
                    <td>
                      <span className="swatch" style={{ background: css(row.color) }} />
                    </td>
                    <td>{row.name}</td>
                    <td>{row.depth.toFixed(2)}</td>
                    <td>{row.alpha.toFixed(3)}</td>
                    <td>{row.transmittanceBefore.toFixed(3)}</td>
                    <td>{row.weight.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.probe.covering > report.probe.rows.length && (
            <div className="note">…and {report.probe.covering - report.probe.rows.length} more behind them.</div>
          )}
          <div className="note probe-result">
            Background weight (final T): {report.probe.transmittance.toFixed(3)} · pixel{" "}
            <span className="swatch" style={{ background: css(report.probe.color) }} /> (
            {report.probe.color.map((v) => v.toFixed(3)).join(", ")})
          </div>
          <div className="note">
            C = Σ cᵢ·αᵢ·Tᵢ + T_final·background, with Tᵢ = Π (1 − αⱼ) over the Gaussians drawn before i.
          </div>
        </div>
      )}

      <div className="section explain">
        <b>How it works</b>
        <details open>
          <summary>Alpha</summary>
          Each Gaussian has a peak opacity. At a pixel its alpha is that peak times the 2D Gaussian
          falloff exp(−½ dᵀΣ₂D⁻¹d) from Lab 6: strong at the centre, fading towards the edge. Alpha is
          the fraction of the light arriving from behind that this Gaussian blocks and replaces with its
          own colour.
        </details>
        <details>
          <summary>Transmittance</summary>
          Transmittance T is how much light still gets through. It starts at 1 and each Gaussian
          multiplies it by (1 − α). A Gaussian&apos;s contribution is its colour × α × the T left by the
          ones in front of it, so the same Gaussian counts for less when something opaque sits in front
          (see the T column above). Whatever T is left at the end lets the background through.
        </details>
        <details>
          <summary>Depth ordering</summary>
          Front-to-back compositing walks the Gaussians nearest first. The GPU does it with blending:
          the canvas alpha stores 1 − T and each new fragment is added × (1 − canvas alpha). That is
          only correct if the quads arrive nearest first, so every frame the CPU sorts them by the
          depth of their centres; orbit the camera and the order (and colours) change.
        </details>
        <details>
          <summary>Why footprints overlap</summary>
          A Gaussian never reaches zero; we cut it at 3σ (the outline), where it is about 1% of its
          peak. Footprints of neighbours, and of Gaussians at different depths that line up on screen,
          therefore cover the same pixels, and those pixels mix several colours.
        </details>
        <details>
          <summary>Why the wrong order looks wrong</summary>
          The formula is not symmetric: the first Gaussian drawn keeps its full α, later ones only get
          the leftover T. Reversed, the back (blue) layer is treated as nearest and dominates, the true
          front layer is washed out behind it, and depth cues contradict the motion when you orbit.
          The total coverage (final T) is the same either way; only the colour mix is wrong.
        </details>
        <details>
          <summary>Limits of sorting by centre</summary>
          We sort whole Gaussians by their centre depth: one order per frame for all pixels. Real
          visibility is per pixel. Two large or intersecting Gaussians can be in one order at one pixel
          and the opposite order at another, and when their centres swap depth during an orbit the whole
          footprint flips at once (&quot;popping&quot;). Exact results would need per-pixel sorting of
          every fragment (e.g. ray marching through the Gaussians or per-pixel lists). 3D Gaussian
          splatting accepts this approximation, sorted per screen tile, because the Gaussians are small.
        </details>
      </div>

      {report && (
        <div className="section note">
          {report.drawn.toLocaleString()} of {report.total.toLocaleString()} Gaussians drawn in 1 draw call
          {state.showOutlines && " (+1 for outlines)"} · CPU {report.cpuMs.toFixed(2)} ms/frame (animate,
          project, sort, upload)
        </div>
      )}
    </div>
  );
}
