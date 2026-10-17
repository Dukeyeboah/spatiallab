"use client";

import {
  distanceBand,
  flaggedQueueIds,
  gapSuggestions,
  imageHalf,
  imageSide,
  isFlaggedPriority,
  NEXT_APPROXIMATE_CHECK_IDS,
  OUTSIDE_USABLE_IDS,
  overlapQuestionableAndOutside,
  QUESTIONABLE_IDS,
  queueConcern,
  radiusPercent,
  recordInIndoorLeave,
  sortQueueReviews,
  directionalCoverage,
  LAB14E3_BASELINE_ID,
  LEAVE_ALONE_RELIABLE_IDS,
  INDOOR_LEAVE_SEQUENCES,
} from "@/lib/calibrationReviewQueue";
import { withChange, type Correspondence, type ReviewStatus } from "@/lib/correspondences";
import { BASELINE_STAGE_B, type RecordReview, type ReviewReference } from "@/lib/correspondenceReview";
import { CHANNEL_COLOURS } from "./CalibrationLayers";
import type { CorrespondenceLab } from "./useCorrespondenceLab";

const fmt = (p: [number, number, number]) => p.map((x) => x.toFixed(3)).join(", ");

type Props = {
  lab: CorrespondenceLab;
  reviews: RecordReview[];
  reference: ReviewReference;
  goTo: (r: Correspondence) => void;
  focusedId: string | null;
};

/**
 * Lab 14E.4: prioritized queue for the expanded Basel House set — flag first,
 * then optional courtyard approximate checks. Does not refit calibration.
 */
export function CalibrationReviewQueue({ lab, reviews, reference, goTo, focusedId }: Props) {
  const usingStageB =
    reference.label.includes(LAB14E3_BASELINE_ID) || reference.label.includes("x_c69aede71834") || reference === BASELINE_STAGE_B.reference;
  const flaggedIds = new Set(flaggedQueueIds());
  const nextIds = new Set<string>(NEXT_APPROXIMATE_CHECK_IDS);
  const leaveIds = new Set<string>(LEAVE_ALONE_RELIABLE_IDS);
  const overlap = overlapQuestionableAndOutside();
  const flagged = sortQueueReviews(reviews.filter((rv) => flaggedIds.has(rv.record.id)));
  const nextCheck = sortQueueReviews(reviews.filter((rv) => nextIds.has(rv.record.id) && !flaggedIds.has(rv.record.id)));
  const leaveAlone = reviews.filter((rv) => leaveIds.has(rv.record.id) || recordInIndoorLeave(rv.record));
  const coverage = directionalCoverage(reviews);
  const gaps = gapSuggestions(reviews);
  const reviewedFlagged = flagged.filter((rv) => {
    const s = rv.record.reviewStatus ?? "unreviewed";
    return s !== "unreviewed";
  }).length;

  const setVerdict = (r: Correspondence, status: ReviewStatus) => {
    // Verdicts never rewrite pixel / LiDAR.
    // Reject → exclude from fits. Verified / Approximate / Needs correction → clear a prior Reject exclusion
    // so status and fit eligibility stay aligned (Lab 14E.5).
    if (status === "rejected") {
      lab.setRecords(
        lab.records.map((x) =>
          x.id === r.id
            ? withChange(
                r,
                {
                  reviewStatus: "rejected",
                  excludedFromFit: { reason: "rejected in calibration review queue", at: new Date().toISOString() },
                },
                "exclude",
                "rejected",
              )
            : x,
        ),
      );
      return;
    }
    const wasRejectedExclusion =
      !!r.excludedFromFit &&
      (r.reviewStatus === "rejected" || /rejected/i.test(r.excludedFromFit.reason ?? ""));
    if (wasRejectedExclusion) {
      lab.setRecords(
        lab.records.map((x) =>
          x.id === r.id
            ? withChange(r, { reviewStatus: status, excludedFromFit: null }, "restore", r.excludedFromFit?.reason)
            : x,
        ),
      );
      return;
    }
    const now = new Date().toISOString();
    lab.setRecords(lab.records.map((x) => (x.id === r.id ? { ...r, reviewStatus: status, updated: now } : x)));
  };

  const jump = (r: Correspondence) => {
    lab.setShowPredictions(true);
    goTo(r);
  };

  return (
    <div className="calibration-review-queue">
      <b className="sub">Calibration Review Queue · Lab 14E.4 / 14E.5</b>
      <div className="note warn">
        <b>reviewStatus</b> is your verdict; <b>excludedFromFit</b> controls fits separately. <i>Reject</i> sets both
        rejected + excluded. <i>Verified / Approximate / Needs correction</i> clear a prior Reject exclusion so you are
        not left silently out of fits. Manual Exclude (elsewhere) is unchanged. Original pixels / LiDAR are never
        rewritten here. Errors use <b>Stage B {LAB14E3_BASELINE_ID}</b>
        {usingStageB ? " (active reference)" : " — load the built-in Basel House dataset so the baseline applies"}.
      </div>

      <div className="queue-lanes">
        <div className="queue-lane must">
          <b>Inspect first — flagged ({flagged.length})</b>
          <div className="unit">
            {QUESTIONABLE_IDS.length} questionable · {OUTSIDE_USABLE_IDS.length} outside usable projection · overlap between
            those two lists: {overlap.length === 0 ? "none" : overlap.join(", ")} · your marks on flagged: {reviewedFlagged}/
            {flagged.length}
          </div>
        </div>
        <div className="queue-lane next">
          <b>Optional next — best approximate courtyard ({nextCheck.length})</b>
          <div className="unit">Architectural corners in the outer usable band. Skip if the flagged list already took long enough.</div>
        </div>
        <div className="queue-lane leave">
          <b>Leave alone ({leaveAlone.length} shown)</b>
          <div className="unit">
            Lab 14E.3 reliable ids ({LEAVE_ALONE_RELIABLE_IDS.length}) and other indoor sequences{" "}
            {INDOOR_LEAVE_SEQUENCES.join(", ")} that are <i>not</i> on the flagged list. Do not re-pick them for this
            review.
          </div>
        </div>
      </div>

      <QueueTable
        title="1 · Flagged — do these first"
        rows={flagged}
        reference={reference}
        focusedId={focusedId}
        onJump={jump}
        onVerdict={setVerdict}
        empty="Import correspondences-builtin-basel-house-2026-10-17.json if this list is empty."
      />

      <QueueTable
        title="2 · Optional approximate courtyard checks"
        rows={nextCheck}
        reference={reference}
        focusedId={focusedId}
        onJump={jump}
        onVerdict={setVerdict}
        empty="None of the suggested approximate ids are loaded."
      />

      <details className="queue-leave-details">
        <summary>3 · Leave alone (do not touch) — {leaveAlone.length} matches</summary>
        <ul className="queue-leave-list">
          {leaveAlone.map((rv) => (
            <li key={rv.record.id}>
              <span className="swatch" style={{ background: CHANNEL_COLOURS[rv.record.channel] }} />#{rv.index} · seq{" "}
              {rv.record.sequence} {rv.record.channel} · {rv.record.feature.slice(0, 48)}
              {leaveIds.has(rv.record.id) ? " · Lab 14E.3 reliable" : " · indoor leave"}
              {isFlaggedPriority(rv.record.id) ? " · (also flagged — use section 1)" : ""}
            </li>
          ))}
        </ul>
      </details>

      <b className="sub">Coverage · reliable matches (upper / middle / lower · left / right · distance)</b>
      {coverage.map((c) => (
        <div key={c.channel} className="queue-coverage">
          <div className="inline-row">
            <span className="swatch" style={{ background: CHANNEL_COLOURS[c.channel] }} />
            <b>{c.channel}</b>
            <span className="unit">{c.reliable} reliable</span>
          </div>
          <table className="attr-table stats">
            <tbody>
              <tr>
                <td>Vertical</td>
                <td>
                  upper {c.halves.upper} · middle {c.halves.middle} · lower {c.halves.lower}
                </td>
              </tr>
              <tr>
                <td>Horizontal</td>
                <td>
                  left {c.sides.left} · centre {c.sides.centre} · right {c.sides.right}
                </td>
              </tr>
              <tr>
                <td>Distance</td>
                <td>
                  near {c.distances["near (<3 m)"]} · medium {c.distances["medium (3–15 m)"]} · far {c.distances["far (>15 m)"]}
                </td>
              </tr>
              <tr>
                <td>Fisheye region</td>
                <td>
                  centre {c.regions.centre} · middle {c.regions.middle} · outer {c.regions.outer}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <b className="sub">Suggested new picks (only if gaps matter) · max 8</b>
      {gaps.length === 0 ? (
        <div className="unit">No strong coverage gaps beyond what the approximate queue already covers — do not add points just to raise the count.</div>
      ) : (
        <ol className="queue-gaps">
          {gaps.map((g) => (
            <li key={`${g.channel}-${g.where}`}>
              <b>{g.channel}</b> — {g.where}. {g.why}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function QueueTable({
  title,
  rows,
  reference,
  focusedId,
  onJump,
  onVerdict,
  empty,
}: {
  title: string;
  rows: RecordReview[];
  reference: ReviewReference;
  focusedId: string | null;
  onJump: (r: Correspondence) => void;
  onVerdict: (r: Correspondence, status: ReviewStatus) => void;
  empty: string;
}) {
  if (rows.length === 0) return <div className="unit">{empty}</div>;
  return (
    <div className="queue-table-block">
      <b className="sub">{title}</b>
      <div className="unit">
        Fit chips: <i>excluded from fits</i> vs <i>not excluded</i>. A valid Stage B projection inside the usable circle
        is still required for pixel-error fitting; outside-usable verified edges are kept but not forced in.
      </div>
      <ol className="corr-list review-list queue-list">
        {rows.map((rv) => {
          const r = rv.record;
          const concern = queueConcern(r.id);
          const model = reference.cameras[r.channel]?.model;
          const pct = model ? radiusPercent(rv.radiusPx, model) : 0;
          const p = rv.prediction;
          const status = r.reviewStatus ?? "unreviewed";
          const cats = concern?.categories.filter((c) => c === "questionable" || c === "outside-usable" || c === "next-check") ?? [];
          return (
            <li key={r.id} value={rv.index} className={`${focusedId === r.id ? "here" : ""} ${cats.includes("questionable") ? "lab13v" : ""}`}>
              <div className="inline-row">
                <b>#{rv.index}</b>
                <code className="queue-id">{r.id}</code>
                <span className="swatch" style={{ background: CHANNEL_COLOURS[r.channel] }} />
                <span>
                  seq {r.sequence} · {r.channel}
                </span>
                {cats.map((c) => (
                  <span key={c} className={`status-chip queue-cat ${c}`}>
                    {c}
                  </span>
                ))}
                <span className={`status-chip ${status}`}>{status}</span>
                <span className={`status-chip ${r.excludedFromFit ? "excluded" : "reliable"}`} title={r.excludedFromFit?.reason ?? "not excluded"}>
                  {r.excludedFromFit ? "excluded from fits" : "not excluded"}
                </span>
              </div>
              <div className="corr-title">{r.feature}</div>
              <div className="unit">
                Image ○ ({r.pixel.u.toFixed(1)}, {r.pixel.v.toFixed(1)}) · LiDAR ({fmt(r.lidar.las)}) · {rv.distanceM.toFixed(2)} m ·{" "}
                {distanceBand(rv.distanceM)}
                {model && (
                  <>
                    {" "}
                    · radius {pct.toFixed(0)}% of usable ({rv.radiusPx.toFixed(0)} px) · {rv.region} · {imageHalf(r.pixel.v, model)} /{" "}
                    {imageSide(r.pixel.u, model)}
                  </>
                )}
              </div>
              <div className="unit">
                Stage B {LAB14E3_BASELINE_ID}:{" "}
                {p.valid ? (
                  <>
                    × projected ({p.u.toFixed(1)}, {p.v.toFixed(1)}) · residual {p.errorPx.toFixed(1)} px (○ selected image · ×
                    projected LiDAR)
                  </>
                ) : (
                  <span className="check bad">no projection — {p.reason}</span>
                )}
              </div>
              {concern && <div className="note warn queue-reason">{concern.reason}</div>}
              <div className="dataset-actions">
                <button className="primary-jump" onClick={() => onJump(r)} title="Open this event/channel, aim 3D at the LiDAR pick, enable Stage B × overlay">
                  Jump to viewer
                </button>
                <button title="Looks correct — keep original picks" onClick={() => onVerdict(r, "verified")}>
                  Verified
                </button>
                <button title="Usable but soft (edge / density) — keep original picks" onClick={() => onVerdict(r, "approximate")}>
                  Approximate
                </button>
                <button title="Needs a new pixel or LiDAR pick later — originals kept until you Edit" onClick={() => onVerdict(r, "needs-fix")}>
                  Needs correction
                </button>
                <button title="Exclude from fits; originals kept in the file" onClick={() => onVerdict(r, "rejected")}>
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
