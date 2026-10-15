"use client";

import { useState } from "react";
import { describeDirection, type ProvisionalOrientation } from "@/lib/calibration";
import type { Vec3 } from "@/lib/datasets";
import {
  buildExport,
  downloadJson,
  errorStats,
  mergeRecords,
  newId,
  parseCorrespondenceFile,
  predict,
  QUALITIES,
  SCENES,
  type Correspondence,
  type FeatureQuality,
  type Scene,
} from "@/lib/correspondences";
import { reviewRecords, type ReviewReference } from "@/lib/correspondenceReview";
import { DEFAULT_FISHEYE_MODEL, type FisheyeModel } from "@/lib/fisheyeProjection";
import { eventChannels, type Run, type RunEvent } from "@/lib/xgrids";
import { CHANNEL_COLOURS, type ProvisionalCamera } from "./CalibrationLayers";
import { CoveragePanel, ReviewList } from "./CorrespondenceReview";
import { chosenPick, datasetToLas, type CorrespondenceLab } from "./useCorrespondenceLab";

/** Suggested events (Basel House, interval-10s run). Any other event works too. */
const SUGGESTED_EVENTS = [
  { sequence: 3877, note: "exterior, shuttered window" },
  { sequence: 2497, note: "courtyard" },
  { sequence: 3037, note: "courtyard" },
  { sequence: 4718, note: "upstairs corridor" },
];
/** Best offsets of the Lab 13S numerical test (docs/xgrids/provisional-camera-directions.json). */
const LAB_13S_BEST: Record<string, ProvisionalOrientation> = {
  ch14: { yawDeg: -90, pitchDeg: 0, rollDeg: 0 },
  ch18: { yawDeg: 100, pitchDeg: 0, rollDeg: 0 },
};
const MODEL_FIELDS = [
  ["focalPx", "f (px/rad)"],
  ["cx", "cx (px)"],
  ["cy", "cy (px)"],
  ["validRadiusPx", "Usable radius (px)"],
] as const;

type CorrespondenceSectionProps = {
  lab: CorrespondenceLab;
  run: Run;
  event: RunEvent;
  onEventIndexChange: (index: number) => void;
  dataset: { id: string; name: string };
  posesSha256: string | null;
  frameMatches: boolean;
  budgetKey: string;
  cameras: ProvisionalCamera[];
  onCamerasChange: (cameras: ProvisionalCamera[]) => void;
  /** Navigation aid: point the 3D view along the pending pixel's provisional ray. */
  onLookAlongPixel: () => void;
  /** Point the 3D view from a record's scanner pose at its LiDAR point. */
  onViewRecord: (record: Correspondence) => void;
  /** Lab 13W: parameters for review errors (a loaded experiment's Stage B or Lab 13V); null = the provisional ones. */
  reference: ReviewReference | null;
};

const fmt = (p: Vec3) => p.map((x) => x.toFixed(3)).join(", ");

/**
 * Lab 13U: collect image ↔ LiDAR correspondences. A record pairs a pixel in
 * one fisheye image (original pixels) with a LiDAR position (original LAS).
 * The optional projection is a provisional diagnostic with assumed intrinsics.
 */
export function CorrespondenceSection(props: CorrespondenceSectionProps) {
  const { lab, run, event, dataset, posesSha256, frameMatches, budgetKey, cameras } = props;
  const [feature, setFeature] = useState("");
  const [quality, setQuality] = useState<FeatureQuality>("good");
  const [notes, setNotes] = useState("");
  const [scene, setScene] = useState<Scene | "">("");
  const [message, setMessage] = useState<string | null>(null);

  const channels = eventChannels(event);
  const channel = channels.includes(lab.channel) ? lab.channel : channels[0];
  const image = event.images[channel];
  const pixel = lab.pendingPixel && lab.pendingPixel.runId === run.id && lab.pendingPixel.imageFile === image?.file ? lab.pendingPixel : null;
  const pick = lab.pendingPick && lab.pendingPick.datasetId === dataset.id ? lab.pendingPick : null;
  const chosen = pick ? chosenPick(pick.result, lab.preferRefined) : null;
  const offsets = Object.fromEntries(cameras.map((c) => [c.channel, c.orientation]));
  const reference: ReviewReference = props.reference ?? {
    label: "the provisional rotations with the assumed lens (no experiment loaded)",
    cameras: Object.fromEntries(cameras.map((c) => [c.channel, { orientation: c.orientation, model: lab.model }])),
  };
  const reviews = reviewRecords(lab.records, reference);

  const missing = [
    !frameMatches && "the run's poses.csv isn't this dataset's (frame check)",
    !image?.file && "this channel has no decoded image",
    !(image?.pose.position && image.pose.quaternion) && "no scanner pose at this image's time",
    !pixel && "an image pixel",
    !pick && "a LiDAR point",
    !feature.trim() && "a feature description",
  ].filter(Boolean) as string[];

  function save() {
    if (missing.length || !pixel || !pick || !chosen || !image?.file || !image.pose.position || !image.pose.quaternion || !posesSha256) return;
    const now = new Date().toISOString();
    const record: Correspondence = {
      id: newId(),
      datasetId: dataset.id,
      posesSha256,
      runId: run.id,
      sequence: event.sequence,
      channel,
      imageFile: image.file,
      timestampUs: image.timestampUs,
      imageWidth: image.width!,
      imageHeight: image.height!,
      pixel: { u: pixel.u, v: pixel.v },
      lidar: { las: datasetToLas(chosen.position, pick.offset), method: chosen.method, detail: chosen.detail, budget: pick.budget },
      scannerPose: { position: image.pose.position, quaternion: image.pose.quaternion },
      feature: feature.trim(),
      quality,
      notes: notes.trim(),
      calibrationStatus: "provisional",
      created: now,
      updated: now,
      ...(scene ? { scene } : {}),
    };
    lab.setRecords([...lab.records, record]);
    lab.setPendingPixel(null);
    lab.setPendingPick(null);
    setFeature("");
    setNotes("");
    setMessage(`Saved #${lab.records.length + 1}.`);
  }

  const goTo = (r: Correspondence) => {
    const index = run.events.findIndex((e) => e.sequence === r.sequence);
    if (r.runId !== run.id || index < 0) return setMessage(`#${lab.records.indexOf(r) + 1} belongs to run ${r.runId}, sequence ${r.sequence}.`);
    props.onEventIndexChange(index);
    lab.setChannel(r.channel);
    props.onViewRecord(r);
  };

  return (
    <div className="section provisional correspondences">
      <b className="sub">Image ↔ LiDAR correspondences · provisional</b>
      <div className="note">
        1. Choose an event and a channel. 2. Click a sharp feature in the image (wheel = zoom, drag = pan). 3. Press{" "}
        <i>Pick in 3D</i>, navigate the LiDAR and click the same feature. 4. Describe it and save. Aim for 15–25 reliable
        features per camera over several events, spread over the image; quality beats quantity.
      </div>
      <details>
        <summary>What makes a good feature?</summary>
        <div className="note">
          <b>Good:</b> window and door corners, wall corners, pillar edges, roof/eave intersections, other sharp
          geometric corners that the LiDAR also shows clearly. <br />
          <b>Avoid:</b> sky, grass, vegetation, people, reflections, glass, motion blur, the extreme fisheye edge, and
          anything that may have moved. <br />
          <b>Prefer:</b> fixed architecture 4–15 m away (closer points suffer from the unknown camera offset), at different
          heights and directions, in the middle and outer parts of the image, from courtyard, corridor and indoor events.
          Check the 3D pick lands on the same surface the pixel shows, not on something behind or in front of it.
        </div>
      </details>

      <div className="test-chips">
        {SUGGESTED_EVENTS.map((s) => {
          const index = run.events.findIndex((e) => e.sequence === s.sequence);
          return (
            <button
              key={s.sequence}
              disabled={index < 0}
              className={s.sequence === event.sequence ? "selected" : ""}
              title={index < 0 ? `not in run ${run.id}` : s.note}
              onClick={() => props.onEventIndexChange(index)}
            >
              {s.sequence}
            </button>
          );
        })}
        <span className="unit">or any event (slider above)</span>
      </div>
      <div className="segmented">
        {channels.map((c) => (
          <button key={c} className={c === channel ? "selected" : ""} onClick={() => lab.setChannel(c)}>
            <span className="swatch" style={{ background: CHANNEL_COLOURS[c] }} /> {c}
          </button>
        ))}
      </div>

      <b className="sub">New correspondence · sequence {event.sequence} {channel}</b>
      <div className="inline-row">
        <span className={pixel ? "" : "unit"}>
          Pixel: {pixel ? `u ${pixel.u.toFixed(2)}, v ${pixel.v.toFixed(2)}` : "click in the image"}
        </span>
        {pixel && <button onClick={() => lab.setPendingPixel(null)}>Clear</button>}
      </div>
      {pixel && (
        <div className="dataset-actions">
          <button
            disabled={!frameMatches}
            title="Stand at this image's scanner pose and look along the pixel's ray (assumed intrinsics + current rotation; navigation only, nothing is saved)"
            onClick={props.onLookAlongPixel}
          >
            Look along this pixel&apos;s ray in 3D
          </button>
        </div>
      )}
      <div className="inline-row">
        <button className={lab.pickArmed ? "armed" : ""} onClick={() => lab.setPickArmed(!lab.pickArmed)}>
          {lab.pickArmed ? "Picking: click the LiDAR (press to stop)" : "Pick in 3D"}
        </button>
        {pick && <button onClick={() => lab.setPendingPick(null)}>Clear</button>}
      </div>
      {lab.pickArmed && <div className="note">Click (without dragging) on the feature. Orbit and zoom still work; event dots are hidden.</div>}
      {pick && chosen && (
        <div className="pick-result">
          <label>
            <input type="radio" checked={chosen.method === "nearest-point"} onChange={() => lab.setPreferRefined(false)} />
            <span>
              <span className="pick-swatch nearest" /> Nearest point (approximate): {fmt(datasetToLas(pick.result.nearest.position, pick.offset))}
            </span>
          </label>
          <label title={pick.result.plane.ok ? "" : pick.result.plane.reason}>
            <input type="radio" disabled={!pick.result.plane.ok} checked={chosen.method === "ray-plane"} onChange={() => lab.setPreferRefined(true)} />
            <span>
              <span className="pick-swatch refined" /> Ray ∩ local plane:{" "}
              {pick.result.plane.ok ? fmt(datasetToLas(pick.result.plane.position, pick.offset)) : `refused: ${pick.result.plane.reason}`}
            </span>
          </label>
          <div className="unit">
            LAS metres (x, y, z) on the {pick.budget} preview. {chosen.detail}.
          </div>
        </div>
      )}
      <details>
        <summary>Picking settings</summary>
        <label>
          Search radius
          <input
            type="number"
            min={2}
            max={30}
            value={lab.pickOptions.radiusPx}
            onChange={(e) => lab.setPickOptions({ ...lab.pickOptions, radiusPx: Math.max(2, Math.min(30, Number(e.target.value) || 8)) })}
          />
          <span className="unit">screen px</span>
        </label>
        <label>
          Plane neighbourhood
          <input
            type="number"
            min={2}
            max={30}
            value={Math.round(lab.pickOptions.neighbourRadiusM * 100)}
            onChange={(e) =>
              lab.setPickOptions({ ...lab.pickOptions, neighbourRadiusM: Math.max(2, Math.min(30, Number(e.target.value) || 6)) / 100 })
            }
          />
          <span className="unit">cm</span>
        </label>
        <div className="note">
          Corners and edges are not planar, so the plane refinement is refused there: pick a point on one face a few cm
          from the corner only if that face is what the pixel shows, otherwise keep the approximate nearest point.
        </div>
      </details>
      <div className="inline-row">
        <input type="text" placeholder="Feature, e.g. top-left corner of shuttered window" value={feature} maxLength={200} onChange={(e) => setFeature(e.target.value)} />
        <select value={quality} onChange={(e) => setQuality(e.target.value as FeatureQuality)}>
          {QUALITIES.map((q) => (
            <option key={q}>{q}</option>
          ))}
        </select>
        <select value={scene} title="Scene (kept for the next match)" onChange={(e) => setScene(e.target.value as Scene | "")}>
          <option value="">scene…</option>
          {SCENES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <textarea rows={2} placeholder="Notes (optional)" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      <div className="dataset-actions">
        <button disabled={missing.length > 0} onClick={save}>
          Save correspondence
        </button>
      </div>
      {missing.length > 0 && <div className="unit">Needs: {missing.join(", ")}.</div>}
      {message && <div className="note">{message}</div>}

      {lab.records.length > 0 && <CoveragePanel reviews={reviews} reference={reference} onSelect={goTo} />}
      <label>
        <input type="checkbox" checked={lab.showCoverage} onChange={(e) => lab.setShowCoverage(e.target.checked)} />
        Mark this camera&apos;s matches from other events on the image (grey, spread only)
      </label>
      <ReviewList
        lab={lab}
        run={run}
        event={event}
        reviews={reviews}
        goTo={goTo}
        pixel={pixel}
        chosenLas={pick && chosen ? datasetToLas(chosen.position, pick.offset) : null}
        chosen={chosen}
        budget={pick?.budget ?? budgetKey}
      />
      <ProjectionControls {...props} offsets={offsets} />
      <ExportImport {...props} offsets={offsets} setMessage={setMessage} />
    </div>
  );
}

function ProjectionControls({ lab, cameras, onCamerasChange, offsets }: CorrespondenceSectionProps & { offsets: Record<string, ProvisionalOrientation> }) {
  const groups = [...new Set(lab.records.map((r) => r.channel))].sort();
  const statsFor = (records: Correspondence[]) => {
    const predictions = records.map((r) => predict(r, offsets, lab.model));
    return { ...errorStats(predictions.flatMap((p) => (p.valid ? [p.errorPx] : []))), invalid: predictions.filter((p) => !p.valid).length };
  };
  const rows = [...groups.map((g) => ({ name: g, ...statsFor(lab.records.filter((r) => r.channel === g)) })), { name: "all", ...statsFor(lab.records) }];

  return (
    <>
      <b className="sub">Provisional projection · assumed intrinsics</b>
      <div className="note">
        Equidistant fisheye r = f·θ around (cx, cy), camera at the scanner position (lever arm unknown), rotation = the
        channel offsets below. These values are guesses for diagnostics, <b>not</b> calibrated or manufacturer intrinsics.
      </div>
      <label>
        <input type="checkbox" checked={lab.showPredictions} onChange={(e) => lab.setShowPredictions(e.target.checked)} />
        Predicted pixels (×) for saved features
      </label>
      <label>
        <input type="checkbox" checked={lab.showOverlay} onChange={(e) => lab.setShowOverlay(e.target.checked)} />
        Project LiDAR points onto the image (≤ 20 m, red near → blue far)
      </label>
      {MODEL_FIELDS.map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            step={key === "focalPx" ? 5 : 10}
            value={lab.model[key]}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) lab.setModel({ ...lab.model, [key]: v } as FisheyeModel);
            }}
          />
        </label>
      ))}
      {cameras.map((c) => (
        <div key={c.channel} className="unit">
          <span className="swatch" style={{ background: CHANNEL_COLOURS[c.channel] }} /> {c.channel} rotation: yaw {c.orientation.yawDeg}°,
          pitch {c.orientation.pitchDeg}°, roll {c.orientation.rollDeg}° ({describeDirection(c.orientation)})
        </div>
      ))}
      <div className="dataset-actions">
        <button onClick={() => onCamerasChange(cameras.map((c) => ({ ...c, orientation: LAB_13S_BEST[c.channel] ?? c.orientation })))}>
          Use Lab 13S best (−90° / +100°)
        </button>
        <button onClick={() => lab.setModel(DEFAULT_FISHEYE_MODEL)}>Reset intrinsics</button>
      </div>
      <div className="note">Edit the rotations in the Direction hypothesis mode; they are shared.</div>
      {lab.records.length > 0 && (
        <table className="attr-table stats">
          <thead>
            <tr>
              <th />
              <th>n</th>
              <th>mean</th>
              <th>median</th>
              <th>RMS px</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>
                  {row.count}
                  {row.invalid > 0 && <span className="unit"> +{row.invalid} invalid</span>}
                </td>
                <td>{row.mean ?? "—"}</td>
                <td>{row.median ?? "—"}</td>
                <td>{row.rms ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lab.records.length > 0 && (
        <div className="note">
          Errors of an uncalibrated, assumed model: a starting point for the calibration lab, not a measure of calibration
          quality. Points outside the usable radius get no error.
        </div>
      )}
    </>
  );
}

function ExportImport({
  lab,
  dataset,
  posesSha256,
  offsets,
  setMessage,
}: CorrespondenceSectionProps & { offsets: Record<string, ProvisionalOrientation>; setMessage: (m: string) => void }) {
  async function importFile(file: File) {
    if (file.size > 5_000_000) return setMessage("That file is larger than 5 MB; not imported.");
    try {
      const { records, rejected } = parseCorrespondenceFile(await file.text());
      const merged = mergeRecords(lab.records, records);
      lab.setRecords(merged.records);
      setMessage(
        `Imported ${merged.added}` +
          (merged.duplicates ? `, skipped ${merged.duplicates} already present` : "") +
          (rejected.length ? `, rejected ${rejected.length} invalid (${rejected.slice(0, 3).join("; ")})` : "") +
          ".",
      );
    } catch (err) {
      setMessage(`Not imported: ${(err as Error).message}`);
    }
  }
  return (
    <>
      <b className="sub">Export / import</b>
      <div className="dataset-actions">
        <button
          disabled={lab.records.length === 0}
          onClick={() =>
            downloadJson(
              `correspondences-${dataset.id}-${new Date().toISOString().slice(0, 10)}.json`,
              buildExport(lab.records, { dataset: { ...dataset, posesSha256 }, model: lab.model, offsets }),
            )
          }
        >
          Export JSON
        </button>
        <label className="file-button">
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importFile(file);
            }}
          />
        </label>
      </div>
      <div className="note">Schema: docs/xgrids/correspondences.md. Import validates every record and keeps existing ids.</div>
    </>
  );
}
