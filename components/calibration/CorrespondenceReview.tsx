"use client";

import { useState } from "react";
import type { Vec3 } from "@/lib/datasets";
import {
  QUALITIES,
  REVIEW_STATUSES,
  SCENES,
  withChange,
  type Correspondence,
  type FeatureQuality,
  type ReviewStatus,
  type Scene,
} from "@/lib/correspondences";
import {
  COVERAGE_TARGET,
  DISTANCE_BINS,
  REGIONS,
  SECTORS,
  coverage,
  type RecordReview,
  type ReviewReference,
} from "@/lib/correspondenceReview";
import type { Run, RunEvent } from "@/lib/xgrids";
import { CHANNEL_COLOURS } from "./CalibrationLayers";
import { chosenPick, type CorrespondenceLab } from "./useCorrespondenceLab";

const fmt = (p: Vec3) => p.map((x) => x.toFixed(3)).join(", ");
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

/**
 * Lab 13W: per-camera coverage of *reliable* matches (included, no warnings)
 * against a 15–25 target, drawn over the fisheye image. A guide, not a quota.
 */
export function CoveragePanel({ reviews, reference, onSelect }: { reviews: RecordReview[]; reference: ReviewReference; onSelect: (r: Correspondence) => void }) {
  const channels = coverage(reviews);
  return (
    <div className="coverage">
      <b className="sub">Coverage · reliable matches per camera</b>
      <div className="note warn">
        Expanded real-world dataset: <b>not complete</b>, waiting for your additional matches. Counts are a guide: an
        empty sector is better than a match you are unsure of.
      </div>
      <div className="unit">Reference for errors and flags: {reference.label}.</div>
      {channels.map((c) => (
        <div key={c.channel} className="coverage-camera">
          <div className="inline-row">
            <span className="swatch" style={{ background: CHANNEL_COLOURS[c.channel] }} />
            <b>{c.channel}</b>
            <span className={c.reliable >= COVERAGE_TARGET.min ? "" : "unit"}>
              {c.reliable} reliable / {COVERAGE_TARGET.min}–{COVERAGE_TARGET.max} target
            </span>
            <span className="unit">
              ({c.total} saved, {c.included} in fits, {c.verified} reliable and verified, {c.events} events)
            </span>
          </div>
          <div className="coverage-body">
            <CoverageDiagram reviews={reviews.filter((rv) => rv.record.channel === c.channel)} reference={reference} channel={c.channel} onSelect={onSelect} />
            <table className="attr-table stats">
              <tbody>
                <tr>
                  <td>Image region</td>
                  <td>{REGIONS.map((r) => `${r} ${c.regions[r]}`).join(" · ")}</td>
                </tr>
                <tr>
                  <td>Distance</td>
                  <td>{DISTANCE_BINS.map((d) => `${d} ${c.distances[d]}`).join(" · ")}</td>
                </tr>
                <tr>
                  <td>Height</td>
                  <td>
                    above {c.heights.above} · level {c.heights.level} · below {c.heights.below}
                  </td>
                </tr>
                <tr>
                  <td>Scene</td>
                  <td>
                    {Object.entries(c.scenes)
                      .map(([k, n]) => `${k} ${n}`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {c.guidance.length > 0 && (
            <ul className="warnings">
              {c.guidance.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="note">
        Diagram: the fisheye image with the usable circle split into centre, middle and outer thirds and eight directions.
        Shaded cells hold reliable matches. Dots: green reliable, amber flagged, grey excluded; a red ring marks the Lab
        13V review list. Click a dot to show that match.
      </div>
    </div>
  );
}

function CoverageDiagram({ reviews, reference, channel, onSelect }: { reviews: RecordReview[]; reference: ReviewReference; channel: string; onSelect: (r: Correspondence) => void }) {
  const model = reference.cameras[channel]?.model;
  if (!model) return null;
  const { cx, cy, validRadiusPx: R } = model;
  const width = Math.round(cx * 2 + 1);
  const height = Math.round(cy * 2 + 1);
  const point = (r: number, deg: number) => `${(cx + r * Math.cos((deg * Math.PI) / 180)).toFixed(1)} ${(cy - r * Math.sin((deg * Math.PI) / 180)).toFixed(1)}`;
  const cell = (r0: number, r1: number, a0: number, a1: number) =>
    `M ${point(r0, a0)} L ${point(r1, a0)} A ${r1} ${r1} 0 0 0 ${point(r1, a1)} L ${point(r0, a1)} A ${r0} ${r0} 0 0 1 ${point(r0, a0)} Z`;
  const reliable = reviews.filter((rv) => rv.reliable);
  const shade = (n: number) => (n === 0 ? 0 : Math.min(0.6, 0.2 + 0.15 * n));
  const centre = reliable.filter((rv) => rv.region === "centre").length;

  return (
    <svg className="coverage-diagram" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${channel} coverage diagram`}>
      <rect width={width} height={height} className="frame" />
      <circle cx={cx} cy={cy} r={R / 3} className="cell" style={{ fillOpacity: shade(centre) }} />
      {(["middle", "outer"] as const).map((region, k) =>
        SECTORS.map((name, s) => {
          const n = reliable.filter((rv) => rv.region === region && rv.sector === s).length;
          return (
            <path key={`${region}-${s}`} d={cell(((k + 1) * R) / 3, ((k + 2) * R) / 3, s * 45 - 22.5, s * 45 + 22.5)} className="cell" style={{ fillOpacity: shade(n) }}>
              <title>{`${region}, ${name}: ${n} reliable`}</title>
            </path>
          );
        }),
      )}
      {[R / 3, (2 * R) / 3, R].map((r) => (
        <circle key={r} cx={cx} cy={cy} r={r} className="ring" />
      ))}
      {SECTORS.map((_, s) => (
        <path key={s} d={`M ${point(R / 3, s * 45 + 22.5)} L ${point(R, s * 45 + 22.5)}`} className="ring" />
      ))}
      {reviews.map((rv) => (
        <g key={rv.record.id} className="dot-group" onClick={() => onSelect(rv.record)}>
          <circle
            cx={rv.record.pixel.u}
            cy={rv.record.pixel.v}
            r={55}
            className={`dot ${rv.reliable ? "reliable" : rv.included ? "flagged" : "excluded"} ${rv.flags.some((f) => f.code === "lab13v") ? "lab13v" : ""}`}
          />
          <title>{`#${rv.index} ${rv.record.sequence} · ${rv.record.feature}${rv.flags.length ? `\n${rv.flags.map((f) => f.reason).join("\n")}` : ""}`}</title>
        </g>
      ))}
    </svg>
  );
}

type Filter = "all" | "review" | "excluded" | "event";

/**
 * Lab 13W: the saved-match list with review details. Corrections keep the id
 * and log the replaced value; exclusion keeps the record and its data.
 */
export function ReviewList({
  lab,
  run,
  event,
  reviews,
  goTo,
  pixel,
  chosenLas,
  chosen,
  budget,
}: {
  lab: CorrespondenceLab;
  run: Run;
  event: RunEvent;
  reviews: RecordReview[];
  goTo: (r: Correspondence) => void;
  pixel: { u: number; v: number; imageFile: string } | null;
  chosenLas: Vec3 | null;
  chosen: ReturnType<typeof chosenPick> | null;
  budget: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const replace = (next: Correspondence) => lab.setRecords(lab.records.map((r) => (r.id === next.id ? next : r)));
  const update = (r: Correspondence, change: Partial<Correspondence>) => replace({ ...r, ...change, updated: new Date().toISOString() });

  if (lab.records.length === 0) return <div className="unit">No correspondences saved yet.</div>;
  const needsReview = (rv: RecordReview) => rv.included && (rv.flags.some((f) => f.severity === "warn") || rv.record.reviewStatus !== "verified");
  const shown = reviews.filter((rv) =>
    filter === "review" ? needsReview(rv) : filter === "excluded" ? !rv.included : filter === "event" ? rv.record.runId === run.id && rv.record.sequence === event.sequence : true,
  );
  const counts = { all: reviews.length, review: reviews.filter(needsReview).length, excluded: reviews.filter((rv) => !rv.included).length, event: reviews.filter((rv) => rv.record.runId === run.id && rv.record.sequence === event.sequence).length };

  return (
    <>
      <b className="sub">Saved ({lab.records.length}, this browser) · review</b>
      <div className="segmented">
        {(
          [
            ["all", "All"],
            ["review", "To review"],
            ["excluded", "Excluded"],
            ["event", "This event"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>
            {label} ({counts[key]})
          </button>
        ))}
      </div>
      <ol className="corr-list review-list">
        {shown.map((rv) => {
          const r = rv.record;
          const p = rv.prediction;
          const here = r.runId === run.id && r.sequence === event.sequence;
          const lab13v = rv.flags.some((f) => f.code === "lab13v");
          return (
            <li key={r.id} value={rv.index} className={`${here ? "here" : ""} ${rv.included ? "" : "unused"} ${lab13v ? "lab13v" : ""}`}>
              <div className="inline-row">
                <b>#{rv.index}</b>
                <span className="swatch" style={{ background: CHANNEL_COLOURS[r.channel] }} />
                <span className="corr-title" title={r.feature}>
                  {r.sequence} {r.channel} · {r.feature}
                </span>
                <span className={`quality ${r.quality}`}>{r.quality}</span>
                <span className={`status-chip ${r.reviewStatus ?? "unreviewed"}`}>{r.reviewStatus ?? "unreviewed"}</span>
                <span className={`status-chip ${rv.included ? (rv.reliable ? "reliable" : "flagged") : "excluded"}`}>
                  {rv.included ? (rv.reliable ? "in fits · reliable" : "in fits · flagged") : "excluded from fits"}
                </span>
              </div>
              <div className="unit">
                px ({r.pixel.u.toFixed(1)}, {r.pixel.v.toFixed(1)}) · LAS ({fmt(r.lidar.las)}) · {r.lidar.method === "nearest-point" ? "nearest point, approximate" : "ray ∩ plane"}
              </div>
              <div className="unit">
                {rv.distanceM.toFixed(2)} m from the scanner, {signed(rv.heightM)} m height · {rv.region} region ({rv.radiusPx.toFixed(0)} px from centre)
                {rv.offAxisDeg !== null && ` · ${rv.offAxisDeg.toFixed(0)}° off-axis`}
                {r.scene && ` · ${r.scene}`}
                {" · "}
                {p.valid ? `reference error ${p.errorPx.toFixed(1)} px` : `no reference prediction (${p.reason})`}
              </div>
              {rv.flags.length > 0 && (
                <ul className="flags">
                  {rv.flags.map((f) => (
                    <li key={f.code + f.reason} className={f.severity}>
                      {f.reason}
                    </li>
                  ))}
                </ul>
              )}
              {r.notes && <div className="unit">Notes: {r.notes}</div>}
              <div className="dataset-actions">
                <button onClick={() => goTo(r)}>Show</button>
                <button onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? "Done" : "Edit"}</button>
                {r.excludedFromFit ? (
                  <button onClick={() => replace(withChange(r, { excludedFromFit: null }, "restore", r.excludedFromFit?.reason))}>Restore</button>
                ) : (
                  <button
                    onClick={() => {
                      const reason = window.prompt(`Why exclude #${rv.index} from fits? (kept, can be restored)`, rv.flags.find((f) => f.severity === "warn")?.reason ?? "");
                      if (reason !== null) replace(withChange(r, { excludedFromFit: { reason: reason.trim().slice(0, 500), at: new Date().toISOString() } }, "exclude", reason.trim().slice(0, 500)));
                    }}
                  >
                    Exclude
                  </button>
                )}
                <button
                  onClick={() => {
                    if (window.confirm(`Delete #${rv.index} (${r.feature})? Excluding keeps it; deleting does not.`)) lab.setRecords(lab.records.filter((x) => x.id !== r.id));
                  }}
                >
                  Delete
                </button>
              </div>
              {editing === r.id && (
                <div className="corr-edit">
                  <input type="text" value={r.feature} maxLength={200} onChange={(e) => update(r, { feature: e.target.value })} />
                  <div className="inline-row">
                    <select value={r.quality} title="Quality" onChange={(e) => update(r, { quality: e.target.value as FeatureQuality })}>
                      {QUALITIES.map((q) => (
                        <option key={q}>{q}</option>
                      ))}
                    </select>
                    <select value={r.scene ?? ""} title="Scene" onChange={(e) => update(r, { scene: (e.target.value || undefined) as Scene | undefined })}>
                      <option value="">scene…</option>
                      {SCENES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <select value={r.reviewStatus ?? "unreviewed"} title="Your review" onChange={(e) => update(r, { reviewStatus: e.target.value as ReviewStatus })}>
                      {REVIEW_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <textarea rows={2} value={r.notes} maxLength={2000} placeholder="Notes" onChange={(e) => update(r, { notes: e.target.value })} />
                  <div className="dataset-actions">
                    <button
                      disabled={!pixel || pixel.imageFile !== r.imageFile}
                      title="Needs a new click in this record's image (press Show first)"
                      onClick={() => pixel && replace(withChange(r, { pixel: { u: pixel.u, v: pixel.v } }, "pixel", r.pixel))}
                    >
                      Replace pixel with the new click
                    </button>
                    <button
                      disabled={!chosenLas || !chosen || r.datasetId !== lab.pendingPick?.datasetId}
                      title="Needs a new 3D pick"
                      onClick={() => chosenLas && chosen && replace(withChange(r, { lidar: { las: chosenLas, method: chosen.method, detail: chosen.detail, budget } }, "lidar", r.lidar.las))}
                    >
                      Replace LiDAR with the new pick
                    </button>
                  </div>
                  {r.history && r.history.length > 0 && (
                    <details>
                      <summary>History ({r.history.length})</summary>
                      <ul className="flags">
                        {r.history.map((h, k) => (
                          <li key={k} className="info">
                            {h.at.slice(0, 19)}Z · {h.action}
                            {h.previous !== undefined && ` · previous ${JSON.stringify(h.previous)}`}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="unit">
                    id {r.id} (kept through edits) · created {r.created.slice(0, 19)}Z
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
