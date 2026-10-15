"use client";

import { useEffect, useRef, useState } from "react";
import type { ProvisionalOrientation } from "@/lib/calibration";
import {
  auditCorrespondences,
  MAX_FILE_BYTES,
  parseExperimentFile,
  runExperiment,
  SET_ORDER,
  setLabel,
  type CameraResult,
  type Experiment,
  type Stats,
} from "@/lib/calibrationExperiment";
import { buildExport, downloadJson, type Correspondence } from "@/lib/correspondences";
import type { FisheyeModel } from "@/lib/fisheyeProjection";
import { sha256Hex, type Run } from "@/lib/xgrids";
import { CHANNEL_COLOURS } from "./CalibrationLayers";
import type { CalibrationOptimization } from "./useCalibrationOptimization";

type Props = {
  opt: CalibrationOptimization;
  run: Run;
  onEventIndexChange: (index: number) => void;
  onChannelChange: (channel: string) => void;
  onViewRecord: (record: Correspondence) => void;
  dataset: { id: string; name: string };
  /** The dataset's poses.csv hash when the frame check passed, else null. */
  posesSha256: string | null;
  /** Lab 13U records of this browser and the projection they are exported with. */
  browserRecords: Correspondence[];
  model: FisheyeModel;
  offsets: Record<string, ProvisionalOrientation>;
};

const num = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : v.toFixed(digits));
const PARAMS = [
  ["yawDeg", "yaw °", 2],
  ["pitchDeg", "pitch °", 2],
  ["rollDeg", "roll °", 2],
  ["focalPx", "f px/rad", 1],
] as const;

/**
 * Lab 13V: audit Lab 13U correspondences and run an EXPERIMENTAL camera
 * calibration in the local backend (rotation, then one focal parameter),
 * validated by leaving out one capture event at a time. Results are shown
 * here only: provisional presets, the direction offsets and the main viewer
 * are never changed.
 */
export function CalibrationOptimizationSection(props: Props) {
  const { opt, dataset, posesSha256 } = props;
  const [busy, setBusy] = useState<"audit" | "run" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceSha, setSourceSha] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const text = opt.source?.text ?? null;
  useEffect(() => {
    setSourceSha(null);
    if (text) sha256Hex(text).then(setSourceSha);
  }, [text]);

  async function audit(sourceText: string) {
    if (!posesSha256) return setMessage("The run's poses.csv isn't this dataset's (frame check): audit refused.");
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy("audit");
    setMessage(null);
    try {
      opt.setAudit(await auditCorrespondences(sourceText, { datasetId: dataset.id, posesSha256 }, controller.current.signal));
    } catch (err) {
      if (!controller.current.signal.aborted) setMessage(backendError(err));
    } finally {
      setBusy(null);
    }
  }

  function load(sourceText: string, name: string, origin: "browser" | "file") {
    try {
      opt.setSource(sourceText, name, origin);
    } catch (err) {
      return setMessage(`Not loaded: ${(err as Error).message}`);
    }
    audit(sourceText);
  }

  async function optimize() {
    if (!opt.source || !opt.audit || !posesSha256) return;
    const rows = opt.audit.audit.records;
    const exclude = rows.filter((r) => !opt.isUsed(r.id) && !opt.excludedByDefault.has(r.id)).map((r) => r.id);
    const include = rows.filter((r) => opt.isUsed(r.id) && opt.excludedByDefault.has(r.id)).map((r) => r.id);
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy("run");
    setMessage(null);
    try {
      const experiment = await runExperiment(
        opt.source.text,
        { datasetId: dataset.id, posesSha256, exclude, include, sourceName: opt.source.origin === "file" ? opt.source.name : null },
        controller.current.signal,
      );
      opt.setExperiment(experiment);
      opt.setDisplaySet("provisional");
    } catch (err) {
      if (!controller.current.signal.aborted) setMessage(backendError(err));
    } finally {
      setBusy(null);
    }
  }

  async function importExperiment(file: File) {
    if (file.size > MAX_FILE_BYTES * 4) return setMessage("That file is larger than 20 MB; not imported.");
    try {
      const experiment = parseExperimentFile(await file.text());
      if (experiment.source.dataset.id !== dataset.id) throw new Error(`it belongs to dataset ${experiment.source.dataset.id}`);
      if (posesSha256 && experiment.source.dataset.posesSha256 !== posesSha256) throw new Error("its pose-file hash differs from this dataset's");
      opt.setExperiment(experiment);
      opt.setDisplaySet("provisional");
      setMessage(`Loaded experiment ${experiment.experimentId} (${experiment.created}).`);
    } catch (err) {
      setMessage(`Not loaded: ${(err as Error).message}`);
    }
  }

  const goTo = (id: string) => {
    const r = opt.source?.records.find((x) => x.id === id);
    if (!r) return setMessage("Load the experiment's correspondence file to show this point.");
    const index = props.run.events.findIndex((e) => e.sequence === r.sequence);
    if (r.runId !== props.run.id || index < 0) return setMessage(`That point belongs to run ${r.runId}, sequence ${r.sequence}.`);
    props.onEventIndexChange(index);
    props.onChannelChange(r.channel);
    props.onViewRecord(r);
  };

  const x = opt.experiment;
  const sourceMatches = !!(x && sourceSha && x.source.sha256 === sourceSha);

  return (
    <div className="section provisional optimization">
      <b className="sub">Calibration optimization · experimental</b>
      <div className="note">
        Fits each camera&apos;s rotation (Stage A), then also one focal parameter (Stage B), to your correspondences in the
        local backend (SciPy, robust least squares), and checks every fit on capture events it never saw. Results are
        shown here only: the provisional presets, the direction offsets and the main viewer are <b>not</b> changed.
      </div>

      <b className="sub">1 · Correspondences</b>
      <div className="dataset-actions">
        <button
          disabled={props.browserRecords.length === 0 || !!busy}
          title="Exports this browser's Lab 13U records (as Export JSON would) and uses that text"
          onClick={() =>
            load(
              JSON.stringify(
                buildExport(props.browserRecords, { dataset: { ...dataset, posesSha256 }, model: props.model, offsets: props.offsets }),
                null,
                2,
              ),
              `${props.browserRecords.length} records of this browser`,
              "browser",
            )
          }
        >
          Use this browser&apos;s {props.browserRecords.length} records
        </button>
        <label className="file-button">
          Load correspondence export
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > MAX_FILE_BYTES) return setMessage("That file is larger than 5 MB; not loaded.");
              load(await file.text(), file.name, "file");
            }}
          />
        </label>
      </div>
      {opt.source && (
        <div className="unit">
          {opt.source.name}: {opt.source.records.length} records
          {opt.source.rejected.length > 0 && `, ${opt.source.rejected.length} invalid (${opt.source.rejected.slice(0, 2).join("; ")})`}
          {sourceSha && ` · SHA-256 ${sourceSha.slice(0, 12)}…`} · read only, never modified
        </div>
      )}
      {busy === "audit" && <div className="note">Auditing…</div>}

      {opt.audit && <AuditView {...props} goTo={goTo} />}

      {opt.audit && (
        <>
          <b className="sub">3 · Optimization</b>
          <div className="dataset-actions">
            <button className="primary" disabled={!!busy || opt.audit.runProblems.length > 0} onClick={optimize}>
              {busy === "run" ? "Running…" : "Run optimization (experimental)"}
            </button>
          </div>
          <div className="unit">
            Uses{" "}
            {Object.keys(opt.audit.audit.channels)
              .map((ch) => `${opt.audit!.audit.records.filter((r) => r.channel === ch && opt.isUsed(r.id)).length} ${ch}`)
              .join(" + ")}{" "}
            points. Stage A: yaw, pitch, roll (lens fixed at f = 750). Stage B: + f. Fixed: cx, cy (image centre,
            assumed), lever arm 0, no distortion terms. Takes a few seconds.
          </div>
        </>
      )}
      {message && <div className="note warn">{message}</div>}

      {x && <ExperimentView {...props} experiment={x} sourceMatches={sourceMatches} goTo={goTo} />}

      <b className="sub">Experiment files</b>
      <div className="dataset-actions">
        <button disabled={!x} onClick={() => x && downloadJson(`calibration-experiment-${x.experimentId}.json`, x)}>
          Export experiment JSON
        </button>
        <label className="file-button">
          Import experiment JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importExperiment(file);
            }}
          />
        </label>
      </div>
      <div className="note">
        Save experiments outside the repository (e.g. &lt;recording&gt;/reconstruction/xgrids/calibration/experiments/). Schema and
        method: docs/xgrids/calibration-experiments.md.
      </div>
    </div>
  );
}

function backendError(err: unknown) {
  return err instanceof TypeError
    ? "The local backend isn't reachable, or is an older version without /xgrids/calibration (restart it with the current code and SciPy installed)."
    : (err as Error).message;
}

function AuditView({ opt, goTo }: Props & { goTo: (id: string) => void }) {
  const a = opt.audit!;
  return (
    <>
      <b className="sub">2 · Audit (before fitting)</b>
      {a.runProblems.length > 0 && (
        <div className="note warn">
          Refused: {a.runProblems.length} record(s) disagree with their extraction run ({a.runProblems.slice(0, 2).map((p) => p.reason).join("; ")}).
        </div>
      )}
      {a.rejected.length > 0 && <div className="note warn">{a.rejected.length} record(s) were invalid and are ignored.</div>}
      <table className="attr-table stats">
        <thead>
          <tr>
            <th />
            <th>usable</th>
            <th>events</th>
            <th>distance m</th>
            <th>&lt; 3 m</th>
            <th>&gt; 800 px</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(a.audit.channels).map(([ch, c]) => (
            <tr key={ch}>
              <td>
                <span className="swatch" style={{ background: CHANNEL_COLOURS[ch] }} /> {ch}
              </td>
              <td>
                {c.usable}/{c.records}
              </td>
              <td>{c.events}</td>
              <td>{c.distanceM ? `${num(c.distanceM.min)}–${num(c.distanceM.max)} (med ${num(c.distanceM.median)})` : "—"}</td>
              <td>{c.closeRange}</td>
              <td>{(c.radialRings["800-1200px"] ?? 0) + (c.radialRings[">1200px"] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="unit">
        {a.audit.events.length} events, scanner positions spread over {num(a.audit.scannerPositionsSpreadM)} m · picks:{" "}
        {Object.entries(a.audit.methods)
          .map(([m, n]) => `${n} ${m}`)
          .join(", ")}{" "}
        · {a.audit.duplicates.length} duplicates · LiDAR support / line-of-sight checks: {a.audit.lidarChecks}
      </div>
      <div className="note">
        Flags are for review; nothing is deleted. <i>exclude</i> = left out by default (geometrically impossible for this
        camera); <i>review</i> = used, with a reason to check it. Untick a point to leave it out of the next run; tick an
        excluded one to force it in. A high provisional error alone does not make a point wrong.
      </div>
      <ol className="corr-list audit-list">
        {a.audit.records.map((r) => (
          <li key={r.id} className={opt.isUsed(r.id) ? "" : "unused"}>
            <div className="inline-row">
              <input
                type="checkbox"
                checked={opt.isUsed(r.id)}
                title={opt.isUsed(r.id) ? "Used in the fit (untick to leave out)" : "Left out of the fit (tick to use)"}
                onChange={(e) => opt.setUse({ ...opt.use, [r.id]: e.target.checked })}
              />
              <b>#{r.index}</b>
              <span className="swatch" style={{ background: CHANNEL_COLOURS[r.channel] }} />
              <span className="corr-title" title={r.feature}>
                {r.sequence} {r.channel} · {r.feature}
              </span>
              <button onClick={() => goTo(r.id)}>Show</button>
            </div>
            <div className="unit">
              {num(r.distanceM, 2)} m · {num(r.offAxisDeg, 0)}° off the provisional axis · {num(r.pixelRadiusPx, 0)} px from the centre ·{" "}
              {r.method === "nearest-point" ? "nearest point (approximate)" : "ray ∩ plane"} · provisional error{" "}
              {r.provisional?.valid ? `${num(r.provisional.errorPx)} px` : "—"}
            </div>
            {r.flags.map((f) => (
              <div key={f.code} className={`flag ${f.severity}`}>
                <b>{f.severity === "exclude" ? "exclude" : "review"}: {f.code}</b> — {f.reason}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}

function ExperimentView({ opt, experiment: x, sourceMatches, goTo }: Props & { experiment: Experiment; sourceMatches: boolean; goTo: (id: string) => void }) {
  const sets = SET_ORDER.filter((s) => x.parameterSets[s]);
  const image = x.independentChecks?.imageAgreement;
  return (
    <>
      <b className="sub">4 · Results · experiment {x.experimentId}</b>
      <div className="unit">
        {x.status} · {x.created} · source {x.source.file ?? "browser records"} (SHA-256 {x.source.sha256.slice(0, 12)}…)
        {opt.source && !sourceMatches && " · ⚠ not the loaded correspondence file: image markers use the loaded records"}
      </div>
      <div className="inline-row">
        <span>Show in the image:</span>
        <div className="segmented">
          {sets.map((s) => (
            <button key={s} className={s === opt.displaySet ? "selected" : ""} onClick={() => opt.setDisplaySet(s)}>
              {setLabel(s)}
            </button>
          ))}
        </div>
      </div>
      <label>
        <input type="checkbox" checked={opt.showOverlay} onChange={(e) => opt.setShowOverlay(e.target.checked)} />
        Project LiDAR points with this set (≤ 20 m, red near → blue far)
      </label>
      <div className="note">
        Image view only: ○ measured pixel, × projected with <b>{setLabel(opt.displaySet)}</b>, line = error. Nothing is applied to
        the presets or the main viewer.
      </div>

      {Object.entries(x.cameras).map(([ch, camera]) => (
        <CameraView key={ch} channel={ch} camera={camera} experiment={x} displaySet={opt.displaySet} goTo={goTo} />
      ))}

      {image && (
        <>
          <b className="sub">Independent image check</b>
          <div className="note">
            Correlation between each photo and the coloured LiDAR rendered with each set, on {image.summary && Object.values(image.summary)[0]?.images}{" "}
            photos per camera of events <b>not</b> used for fitting (run {image.runId}). Higher = the LiDAR lines up better
            with the photo; it does not depend on the hand-picked points.
          </div>
          <table className="attr-table stats">
            <thead>
              <tr>
                <th />
                {sets.map((s) => (
                  <th key={s}>{setLabel(s)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(image.summary).map(([ch, info]) => (
                <tr key={ch}>
                  <td>{ch} mean NCC</td>
                  {sets.map((s) => (
                    <td key={s}>
                      {num(info.meanNcc[s], 3)} <span className="unit">best {info.bestCount[s] ?? 0}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {x.warnings.length > 0 && (
        <>
          <b className="sub">Warnings</b>
          <ul className="warnings">
            {x.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>Limitations and solver</summary>
        <ul className="warnings">
          {x.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="unit">
          {x.solver.library} · {Object.entries(x.solver.software)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}
        </div>
        {x.source.excluded.length > 0 && (
          <div className="unit">Left out: {x.source.excluded.map((e) => `${e.id} (${e.reasons.join("; ")})`).join(" · ")}</div>
        )}
      </details>
    </>
  );
}

function StatsCells({ stats }: { stats: Stats | undefined }) {
  return (
    <>
      <td>{num(stats?.median)}</td>
      <td>{num(stats?.rms)}</td>
    </>
  );
}

function CameraView({ channel, camera, experiment: x, displaySet, goTo }: { channel: string; camera: CameraResult; experiment: Experiment; displaySet: string; goTo: (id: string) => void }) {
  const stageKey = displaySet === "provisional" ? null : displaySet.replace("stage", "");
  const stage = stageKey ? camera.stages[stageKey] : null;
  const rows = SET_ORDER.filter((s) => x.parameterSets[s]?.cameras[channel]);
  const recommended = camera.comparison.recommended;
  return (
    <div className="camera-result">
      <b className="sub">
        <span className="swatch" style={{ background: CHANNEL_COLOURS[channel] }} /> {channel}: {camera.records.length} points in {camera.events.length} events · lowest
        held-out error: {recommended === "provisional" ? "provisional" : `Stage ${recommended}`}
      </b>
      <table className="attr-table stats">
        <thead>
          <tr>
            <th />
            {PARAMS.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const c = x.parameterSets[s].cameras[channel];
            const result = s === "provisional" ? null : camera.stages[s.replace("stage", "")];
            return (
              <tr key={s} className={s === displaySet ? "selected" : ""}>
                <td>{setLabel(s)}</td>
                {PARAMS.map(([key, , digits]) => {
                  const value = key === "focalPx" ? c.model.focalPx : c.orientation[key];
                  const free = result?.ok && result.free.includes(key);
                  const status = result?.ok ? result.identifiability[key] : null;
                  return (
                    <td key={key} title={status?.reasons.join("; ") || undefined}>
                      {num(value, digits)}
                      {free && result?.ok && <span className="unit"> ±{num(result.std[key], digits === 1 ? 0 : 1)}</span>}
                      <div className={`param-status ${!free ? "assumed" : status?.status.startsWith("estimated") ? "estimated" : "weak"}`}>
                        {!free ? (s === "provisional" ? "provisional" : "fixed") : status?.status.startsWith("estimated") ? "estimated" : "poorly constrained"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="unit">cx 1999.5, cy 1449.5 (image centre) and the lever arm (0) are assumed in every set; ± = 1σ from the fit.</div>
      <table className="attr-table stats">
        <thead>
          <tr>
            <th />
            <th colSpan={2}>training px</th>
            <th colSpan={2}>held-out px</th>
          </tr>
          <tr>
            <th />
            <th>median</th>
            <th>RMS</th>
            <th>median</th>
            <th>RMS</th>
          </tr>
        </thead>
        <tbody>
          <tr className={displaySet === "provisional" ? "selected" : ""}>
            <td>Provisional</td>
            <StatsCells stats={camera.provisional.stats} />
            <StatsCells stats={camera.provisional.stats} />
          </tr>
          {Object.entries(camera.stages).map(([key, r]) => (
            <tr key={key} className={displaySet === `stage${key}` ? "selected" : ""}>
              <td>Stage {key}</td>
              {r.ok ? (
                <>
                  <StatsCells stats={r.training.stats} />
                  <StatsCells stats={r.validation.heldOutStats} />
                </>
              ) : (
                <td colSpan={4} className="unit">
                  not run: {r.reason}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="unit">
        Held-out = each event predicted by a fit that never saw it (leave one event out). Provisional needs no fitting, so
        its training and held-out errors are the same. Training error alone proves nothing.
      </div>
      {stage?.ok && (
        <details>
          <summary>Stage {stageKey} diagnostics</summary>
          <div className="unit">
            {stage.validation.foldsOk} validation folds ({stage.validation.foldsSkipped} skipped) · condition number {num(stage.conditionNumber, 0)}
            {stage.atBound.length > 0 && ` · at bound: ${stage.atBound.join(", ")}`}
          </div>
          <div className="unit">
            Range over folds:{" "}
            {Object.entries(stage.validation.parameterSpread)
              .map(([k, s]) => `${k} ${num(s.range, 2)}`)
              .join(", ")}
          </div>
          <div className="unit">
            Shift with a 5 cm lever arm:{" "}
            {Object.entries(stage.sensitivity.maxAbsDelta.leverArm ?? {})
              .map(([k, v]) => `${k} ${num(v, 2)}`)
              .join(", ")}{" "}
            · other loss functions:{" "}
            {Object.entries(stage.sensitivity.maxAbsDelta.loss ?? {})
              .map(([k, v]) => `${k} ${num(v, 2)}`)
              .join(", ")}
          </div>
          {stage.sensitivity.withoutOutliers?.parameters && (
            <div className="unit">
              Refit without its {stage.sensitivity.withoutOutliers.removed.length} outlier(s):{" "}
              {Object.entries(stage.sensitivity.withoutOutliers.parameters)
                .map(([k, v]) => `${k} ${num(v, 2)}`)
                .join(", ")}
            </div>
          )}
          {Object.entries(stage.identifiability).map(([k, s]) => (
            <div key={k} className="unit">
              {k}: {s.status}
              {s.reasons.length > 0 && ` (${s.reasons.join("; ")})`}
            </div>
          ))}
        </details>
      )}
      <details>
        <summary>Per-point errors ({setLabel(displaySet)})</summary>
        <ol className="corr-list">
          {camera.records.map((id) => {
            const row = x.audit.records.find((r) => r.id === id);
            const train = stage?.ok ? stage.training.perRecord[id] : camera.provisional.perRecord[id];
            const held = stage?.ok ? stage.validation.heldOut[id] : null;
            return (
              <li key={id} className={train?.outlier ? "outlier" : ""}>
                <div className="inline-row">
                  <b>#{row?.index}</b>
                  <span className="corr-title" title={row?.feature}>
                    {row?.sequence} · {row?.feature}
                  </span>
                  <button onClick={() => goTo(id)}>Show</button>
                </div>
                <div className="unit">
                  {num(row?.distanceM, 2)} m · fit {train?.valid ? `${num(train.errorPx)} px` : "invalid"}
                  {held && ` · held out ${held.valid ? `${num(held.errorPx)} px` : "invalid"}`}
                  {train?.outlier && " · outlier (kept, down-weighted)"}
                </div>
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}
