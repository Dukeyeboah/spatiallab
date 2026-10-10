"use client";

import Link from "next/link";
import type * as THREE from "three";
import { MatrixDisplay } from "./MatrixDisplay";
import type { ViewReport } from "./InspectorScene";
import type { ProjectedGaussian } from "@/lib/gaussian/gaussianMath";
import {
  formatLength,
  fromHex,
  toHex,
  type GaussianEdits,
  type GaussianLayout,
  type GaussianRecord,
  type GaussianSummary,
} from "@/lib/gaussian/inspector";
import { colorToDc, SH_C0, type RGB } from "@/lib/gaussian/sphericalHarmonics";
import type { SplatScene } from "@/lib/splats";

export type PreviewOptions = { supportSigmas: number; showOutline: boolean; showEllipsoid: boolean };

type InspectorPanelProps = {
  scenes: SplatScene[];
  sceneId: string | null;
  onScene: (id: string) => void;
  layout: GaussianLayout | null;
  summary: GaussianSummary | null;
  record: GaussianRecord | null;
  onIndex: (index: number) => void;
  indexInput: string;
  onIndexInput: (value: string) => void;
  seed: string;
  onSeed: (value: string) => void;
  sample: GaussianRecord[];
  onSample: () => void;
  edits: GaussianEdits | null;
  edited: boolean;
  onEdits: (edits: GaussianEdits) => void;
  onResetGaussian: () => void;
  onResetCamera: () => void;
  options: PreviewOptions;
  onOptions: (options: PreviewOptions) => void;
  magnification: number;
  sigma3DReal: THREE.Matrix3 | null;
  projection: ProjectedGaussian | null;
  view: ViewReport | null;
  busy: boolean;
  error: string | null;
};

const AXES = ["X", "Y", "Z"] as const;
const f = (v: number | null, digits = 4) => (v === null ? "—" : v.toFixed(digits));
const swatch = (rgb: RGB) => <span className="swatch" style={{ background: toHex(rgb) }} />;

export function InspectorPanel(props: InspectorPanelProps) {
  const { scenes, sceneId, layout, record, edits, busy, error } = props;
  const plyScenes = scenes.filter((s) => s.format === "ply");

  return (
    <div className="controls inspector">
      <div className="title-row">
        <h1>Gaussian Inspector</h1>
        <button onClick={props.onResetCamera}>Reset camera</button>
      </div>
      <Link href="/" className="lab-link">
        ← LiDAR viewer
      </Link>
      <Link href="/gaussian-viewer" className="lab-link">
        ← Lab 8: Gaussian Splat Viewer
      </Link>
      <Link href="/gaussian-projection" className="lab-link">
        ← Lab 6: one Gaussian, projected
      </Link>
      <div className="note">
        One Gaussian at a time from a real trained scene: what the PLY file stores, what those numbers mean,
        and how the Gaussian looks through a camera. Your changes affect only this preview; the file is never
        modified.
      </div>
      {error && <div className="error">{error}</div>}

      <div className="section">
        <b>Scene</b>
        {scenes.length > 0 && (
          <select
            aria-label="Scene"
            value={sceneId ?? ""}
            onChange={(e) => props.onScene(e.target.value)}
            disabled={busy}
          >
            {plyScenes.length === 0 && <option value="">No Gaussian PLY scenes</option>}
            {scenes.map((s) => (
              <option key={s.id} value={s.id} disabled={s.format !== "ply"}>
                {s.name} ({s.format === "ply" ? `${(s.splatCount ?? 0).toLocaleString()} Gaussians` : `${s.formatLabel}: not inspectable`})
              </option>
            ))}
          </select>
        )}
        {plyScenes.length === 0 && (
          <div className="note">
            Import a trained Gaussian .ply in <Link href="/gaussian-viewer">Lab 8</Link> (e.g. SuperSplat&apos;s PLY
            download). SOG scenes store quantised images, not per-Gaussian records.
          </div>
        )}
        {layout && <LayoutInfo layout={layout} />}
      </div>

      {layout && (
        <div className="section">
          <b>Choose a Gaussian</b>
          <div className="inline-row">
            <button onClick={() => record && props.onIndex(record.index - 1)} disabled={busy || !record || record.index === 0} aria-label="Previous">
              ◀
            </button>
            <input
              type="number"
              aria-label="Gaussian index"
              min={0}
              max={layout.count - 1}
              value={props.indexInput}
              onChange={(e) => props.onIndexInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && props.onIndex(Number(props.indexInput))}
            />
            <button onClick={() => props.onIndex(Number(props.indexInput))} disabled={busy}>
              Show
            </button>
            <button
              onClick={() => record && props.onIndex(record.index + 1)}
              disabled={busy || !record || record.index >= layout.count - 1}
              aria-label="Next"
            >
              ▶
            </button>
          </div>
          <div className="inline-row">
            <label>
              Seed
              <input type="number" aria-label="Seed" min={0} value={props.seed} onChange={(e) => props.onSeed(e.target.value)} />
            </label>
            <button onClick={props.onSample} disabled={busy}>
              Random sample
            </button>
          </div>
          <div className="note">
            Index 0 to {(layout.count - 1).toLocaleString()}. Only the requested records are read from the file. A
            seed always gives the same 12 Gaussians.
          </div>
          {props.sample.length > 0 && (
            <div className="sample-list">
              {props.sample.map((r) => (
                <button
                  key={r.index}
                  className={record?.index === r.index ? "selected" : undefined}
                  onClick={() => props.onIndex(r.index)}
                  title={`Gaussian #${r.index}`}
                >
                  {swatch(r.decoded.baseColor.map((v) => v ?? 0) as RGB)} #{r.index}
                  <span className="unit">
                    {" "}
                    σ {formatLength(Math.max(...r.decoded.scale.map((v) => v ?? 0)))} · α {r.decoded.opacity.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {record && edits && <StoredValues record={record} />}
      {record && edits && <Experiments {...props} record={record} edits={edits} />}
      {record && edits && <Projection {...props} />}
      {props.summary && <SummaryInfo summary={props.summary} />}
    </div>
  );
}

function LayoutInfo({ layout }: { layout: GaussianLayout }) {
  const rest = layout.properties.filter((p) => p.name.startsWith("f_rest_")).length;
  const named = layout.properties.filter((p) => !p.name.startsWith("f_rest_")).map((p) => p.name);
  return (
    <div className="dataset-info">
      <span>
        {layout.count.toLocaleString()} Gaussians · {layout.stride} bytes each · SH degree {layout.shDegree}
      </span>
      <details className="explain">
        <summary>How one Gaussian is stored</summary>
        <div>
          Binary records of {layout.properties.length} float32 numbers ({layout.stride} bytes), one per Gaussian,
          after a {layout.dataOffset.toLocaleString()}-byte text header. Gaussian <i>i</i> starts at byte{" "}
          {layout.dataOffset} + {layout.stride}·<i>i</i>. Properties in file order: {named.join(", ")}
          {rest > 0 && `, f_rest_0…f_rest_${rest - 1} (${rest / 3} per colour channel: all red, then green, then blue)`}.
        </div>
      </details>
    </div>
  );
}

function StoredValues({ record }: { record: GaussianRecord }) {
  const d = record.decoded;
  const s = record.stored;
  const restMagnitude = Math.sqrt(d.shRest.flat().reduce<number>((sum, v) => sum + (v ?? 0) ** 2, 0));
  return (
    <div className="section">
      <b>Gaussian #{record.index.toLocaleString()}: stored → decoded</b>
      <table className="attr-table">
        <tbody>
          <tr>
            <th>Position</th>
            <td>
              x, y, z = {f(s.x, 3)}, {f(s.y, 3)}, {f(s.z, 3)}
            </td>
            <td>used as is (m)</td>
          </tr>
          {AXES.map((axis, i) => (
            <tr key={axis}>
              <th>{i === 0 ? "Scale" : ""}</th>
              <td>
                scale_{i} = {f(d.logScale[i], 3)}
              </td>
              <td>σ{axis.toLowerCase()} = e^v = {d.scale[i] === null ? "—" : formatLength(d.scale[i]!)}</td>
            </tr>
          ))}
          <tr>
            <th>Rotation</th>
            <td>rot_0..3 = {d.quaternionRaw.map((v) => f(v, 3)).join(", ")}</td>
            <td>
              q / |q| (|q| = {f(d.quaternionNorm, 4)}), w first
            </td>
          </tr>
          <tr>
            <th>Opacity</th>
            <td>opacity = {f(d.opacityLogit, 3)}</td>
            <td>α = 1/(1+e^−v) = {d.opacity.toFixed(4)}</td>
          </tr>
          <tr>
            <th>Colour</th>
            <td>f_dc = {d.fDc.map((v) => f(v, 3)).join(", ")}</td>
            <td>
              0.5 + {SH_C0.toFixed(4)}·v = {swatch(d.baseColor.map((v) => v ?? 0) as RGB)}{" "}
              {d.baseColor.map((v) => f(v, 3)).join(", ")}
            </td>
          </tr>
          <tr>
            <th>SH</th>
            <td>
              f_rest: {d.shRest.length * 3} numbers
            </td>
            <td>degree {d.shDegree}, size {restMagnitude.toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
      {record.checks.length === 0 ? (
        <div className="note ok">✓ All stored values are finite; decoded scale &gt; 0, opacity in (0, 1), unit quaternion.</div>
      ) : (
        record.checks.map((check) => (
          <div key={check} className="status">
            {check}
          </div>
        ))
      )}
      <details className="explain">
        <summary>Why the stored numbers look odd</summary>
        <div>
          Training adjusts plain, unconstrained numbers, and the renderer converts them: scales are stored as
          natural logs (so they stay positive and can span micrometres to metres), opacity as a logit (any
          number; the sigmoid squeezes it into 0..1), the rotation as a quaternion that need not have length 1,
          and the colour as spherical-harmonic coefficients (the constant term f_dc gives the base colour,
          f_rest the changes with viewing direction). Record at byte {record.byteOffset.toLocaleString()}.
        </div>
      </details>
    </div>
  );
}

function Experiments({
  record,
  edits,
  edited,
  onEdits,
  onResetGaussian,
  options,
  onOptions,
  view,
}: InspectorPanelProps & { record: GaussianRecord; edits: GaussianEdits }) {
  const original = record.decoded;
  function set<K extends keyof GaussianEdits>(key: K, value: GaussianEdits[K]) {
    onEdits({ ...edits, [key]: value });
  }
  function setAxis(key: "logScale" | "rotationDegrees", axis: number, value: number) {
    const next = [...edits[key]] as [number, number, number];
    next[axis] = value;
    set(key, next);
  }
  const logit = Math.log(edits.opacity / (1 - edits.opacity));

  return (
    <div className="section">
      <div className="title-row">
        <b>Experiment (preview only)</b>
        <button onClick={onResetGaussian} disabled={!edited}>
          Reset Gaussian
        </button>
      </div>

      <b className="sub">Scale</b>
      <div className="note">
        The slider moves the stored log value: +1 multiplies σ by e ≈ 2.7. Different σ per axis = an elongated
        or flat ellipsoid.
      </div>
      {AXES.map((axis, i) => {
        const stored = original.logScale[i] ?? -10;
        return (
          <label key={axis}>
            {axis}
            <input
              type="range"
              aria-label={`Scale ${axis}`}
              min={stored - 3}
              max={stored + 3}
              step="any"
              value={edits.logScale[i]}
              onChange={(e) => setAxis("logScale", i, Number(e.target.value))}
            />
            <span className="value">{formatLength(Math.exp(edits.logScale[i]))}</span>
          </label>
        );
      })}

      <b className="sub">Rotation (Euler XYZ, file frame)</b>
      <div className="note">
        Turns the ellipsoid; its shape doesn&apos;t change, but which way its long axis points does, and so does
        its outline on screen.
      </div>
      {AXES.map((axis, i) => (
        <label key={axis}>
          {axis}
          <input
            type="range"
            aria-label={`Rotation ${axis}`}
            min={-180}
            max={180}
            step="any"
            value={edits.rotationDegrees[i]}
            onChange={(e) => setAxis("rotationDegrees", i, Number(e.target.value))}
          />
          <span className="value">{edits.rotationDegrees[i].toFixed(0)}°</span>
        </label>
      ))}

      <label>
        Opacity
        <input
          type="range"
          aria-label="Opacity"
          min={0.005}
          max={0.995}
          step="any"
          value={edits.opacity}
          onChange={(e) => set("opacity", Number(e.target.value))}
        />
        <span className="value">{edits.opacity.toFixed(2)}</span>
      </label>
      <div className="note">Peak opacity at the centre. Stored as its logit: {logit.toFixed(2)}.</div>

      <label>
        Base colour
        <input
          type="color"
          aria-label="Base colour"
          value={toHex(edits.baseColor)}
          onChange={(e) => set("baseColor", fromHex(e.target.value))}
        />
        <span className="value">f_dc = {edits.baseColor.map((c) => colorToDc(c).toFixed(2)).join(", ")}</span>
      </label>

      {original.shDegree > 0 && (
        <>
          <b className="sub">View-dependent colour (spherical harmonics)</b>
          <div className="segmented">
            {Array.from({ length: original.shDegree + 1 }, (_, degree) => (
              <button
                key={degree}
                className={edits.shDegree === degree ? "selected" : undefined}
                onClick={() => set("shDegree", degree)}
              >
                {degree === 0 ? "Base only" : `Degree ≤ ${degree}`}
              </button>
            ))}
          </div>
          {view && (
            <div className="note">
              Seen from here: {swatch(view.color)} {view.color.map((c) => c.toFixed(3)).join(", ")} (base{" "}
              {swatch(edits.baseColor)}). View direction in the file frame:{" "}
              {view.direction.map((c) => c.toFixed(2)).join(", ")}.
            </div>
          )}
          <div className="note">
            The base colour is the same from every side. The higher degrees add terms that depend on the viewing
            direction (degree 1: one side brighter than the other; 2 and 3: finer variation, e.g. highlights).
            Orbit the camera and watch the colour change.
          </div>
        </>
      )}

      <b className="sub">Display</b>
      <label>
        Support
        <input
          type="range"
          aria-label="Support"
          min={1}
          max={4}
          step={0.5}
          value={options.supportSigmas}
          onChange={(e) => onOptions({ ...options, supportSigmas: Number(e.target.value) })}
        />
        <span className="value">{options.supportSigmas}σ</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.showOutline}
          onChange={(e) => onOptions({ ...options, showOutline: e.target.checked })}
        />
        Footprint outline (white 1σ, blue support)
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.showEllipsoid}
          onChange={(e) => onOptions({ ...options, showEllipsoid: e.target.checked })}
        />
        3D 1σ ellipsoid + own axes
      </label>
    </div>
  );
}

function Projection({ magnification, sigma3DReal, projection }: InspectorPanelProps) {
  if (!sigma3DReal) return null;
  const s = sigma3DReal.elements.map((v) => v * 1e6); // m² -> mm²
  return (
    <div className="section">
      <b>On screen</b>
      <MatrixDisplay
        label="Σ3D = R S Sᵀ Rᵀ"
        rows={[
          [s[0], s[3], s[6]],
          [s[1], s[4], s[7]],
          [s[2], s[5], s[8]],
        ]}
        digits={4}
        unit="mm²"
      />
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
            Camera {formatLength(projection.depth / magnification)} away · σ major {projection.sigmaMajorPx.toFixed(1)} px ·
            σ minor {projection.sigmaMinorPx.toFixed(1)} px · angle {projection.angleDeg.toFixed(0)}°
            {projection.clamped && " · footprint clamped"}
          </div>
        </>
      ) : (
        <div className="status">Not drawn: {projection ? projection.reason : "waiting for first frame"}</div>
      )}
      <div className="note">
        The same projection as Lab 6. Orbit: the 3D Gaussian stays put, but its 2D ellipse changes shape because
        the camera sees it from another side. Zoom: the ellipse grows as 1/distance. The preview is magnified ×
        {magnification.toPrecision(3)} (Gaussian and camera distance together), which changes nothing on screen;
        distances above are real.
      </div>
    </div>
  );
}

function SummaryInfo({ summary }: { summary: GaussianSummary }) {
  const p = (stats: GaussianSummary["opacity"], key: string, format: (v: number) => string) =>
    stats.percentiles[key] === undefined ? "—" : format(stats.percentiles[key]);
  const len = (v: number) => formatLength(v);
  const fixed = (v: number) => v.toFixed(2);
  return (
    <div className="section">
      <details className="explain">
        <summary>What&apos;s typical in this scene ({summary.sampled.toLocaleString()} sampled)</summary>
        <table className="attr-table">
          <thead>
            <tr>
              <th />
              <td>5%</td>
              <td>median</td>
              <td>95%</td>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Largest σ", summary.scaleLargest, len],
                ["Smallest σ", summary.scaleSmallest, len],
                ["Largest ÷ smallest", summary.anisotropy, (v: number) => (v > 1e4 ? v.toExponential(0) : v.toFixed(1))],
                ["Opacity", summary.opacity, fixed],
                ...(summary.shRestMagnitude ? [["SH size", summary.shRestMagnitude, fixed]] : []),
              ] as [string, GaussianSummary["opacity"], (v: number) => string][]
            ).map(([label, stats, format]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{p(stats, "5", format)}</td>
                <td>{p(stats, "50", format)}</td>
                <td>{p(stats, "95", format)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          Validity: {summary.nonFinite} non-finite records, {summary.zeroQuaternions} zero-length quaternions,{" "}
          {(summary.baseColorOutside01 * 100).toFixed(1)}% base colours outside 0..1. Many Gaussians are very flat
          (a huge largest ÷ smallest ratio): thin discs that line surfaces.
          {summary.opacityOn255Steps > 0.99 &&
            " Every opacity is a multiple of 1/255: this PLY was saved from compressed (quantised) data, e.g. a SuperSplat export, not straight from training."}
        </div>
      </details>
    </div>
  );
}
