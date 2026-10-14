"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { Dataset, DatasetBudget, Vec3 } from "@/lib/datasets";
import type { ViewSettings } from "@/lib/viewSettings";
import { calibrationOf } from "@/lib/calibration";
import { eventChannels, eventReference, type Run, type RunEvent, type RunList } from "@/lib/xgrids";
import { CHANNEL_COLOURS, type CalibrationViewRequest, type ProvisionalCamera } from "./CalibrationLayers";

type CalibrationPanelProps = {
  datasets: Dataset[];
  dataset: Dataset;
  onDatasetChange: (id: string) => void;
  budget: DatasetBudget;
  onBudgetChange: (key: string) => void;
  cloudStatus: string | null;
  cloudFailed: boolean;
  settings: ViewSettings;
  onSettingsChange: (settings: ViewSettings) => void;
  showEvents: boolean;
  onShowEventsChange: (show: boolean) => void;
  runList: RunList | null;
  runId: string | null;
  onRunChange: (id: string) => void;
  run: Run | null;
  runError: string | null;
  /** Position of the selected event in run.events. */
  eventIndex: number;
  onEventIndexChange: (index: number) => void;
  event: RunEvent | null;
  frameCheck: { matches: boolean; runSha: string | null; datasetSha: string; datasetName: string } | null;
  offset: Vec3 | null;
  /** Distance between the run's scanner position and the dataset's own poses at the same time, metres. */
  crossCheckMetres: number | null;
  cameras: ProvisionalCamera[];
  onCamerasChange: (cameras: ProvisionalCamera[]) => void;
  onRequestView: (request: CalibrationViewRequest) => void;
  markerShown: boolean;
  /** Further sections below the calibration status (Lab 13S direction test). */
  children?: ReactNode;
};

const fixed = (values: number[], digits: number) => values.map((v) => v.toFixed(digits)).join(", ");
const short = (sha: string | null) => (sha ? sha.slice(0, 8) : "none");

/** Left-hand panel of the calibration workspace (Lab 13R). */
export function CalibrationPanel(props: CalibrationPanelProps) {
  const { run, event, settings } = props;
  return (
    <div className="controls wide calibration">
      <div className="title-row">
        <h1>Camera Calibration</h1>
        <Link href="/" className="lab-link">
          ← LiDAR viewer
        </Link>
      </div>
      <div className="note">
        Lab 13R, phase 1: visual inspection of the XGRIDS camera pairs against the LiDAR scan. Camera intrinsics and
        extrinsics are <b>unknown</b>; nothing here is a calibration.
      </div>

      <SourceSection {...props} />

      <div className="section">
        <b className="sub">LiDAR</b>
        <select value={props.dataset.id} onChange={(e) => props.onDatasetChange(e.target.value)}>
          {props.datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="segmented">
          {props.dataset.budgets.map((b) => (
            <button key={b.key} className={b.key === props.budget.key ? "selected" : ""} onClick={() => props.onBudgetChange(b.key)}>
              {b.label}
            </button>
          ))}
        </div>
        {props.cloudStatus && <div className={props.cloudFailed ? "error" : "status"}>{props.cloudStatus}</div>}
        <label>
          Point size
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={settings.pointSize}
            onChange={(e) => props.onSettingsChange({ ...settings, pointSize: Number(e.target.value) })}
          />
          <span className="value">{settings.pointSize}</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.showPath}
            onChange={(e) => props.onSettingsChange({ ...settings, showPath: e.target.checked })}
          />
          Scanner trajectory (green sphere = start)
        </label>
        <label>
          <input type="checkbox" checked={props.showEvents} onChange={(e) => props.onShowEventsChange(e.target.checked)} />
          Extracted event positions (click to select)
        </label>
        {props.frameCheck && <FrameCheck {...props.frameCheck} />}
      </div>

      {run && event && <EventSection {...props} run={run} event={event} />}

      {run && <CalibrationSection {...props} />}

      {props.children}
    </div>
  );
}

function SourceSection({ runList, runId, onRunChange, run, runError }: CalibrationPanelProps) {
  return (
    <div className="section">
      <b className="sub">Extraction run</b>
      {runError && <div className="error">{runError}</div>}
      {runList && !runList.configured && (
        <div className="error">
          The backend has no image folder configured. Restart it with{" "}
          <code>SPATIAL_LAB_XGRIDS_DIR=&lt;recording&gt;/reconstruction/xgrids/images</code>.
        </div>
      )}
      {runList?.configured && runList.rootExists === false && (
        <div className="error">SPATIAL_LAB_XGRIDS_DIR doesn&apos;t exist on the backend&apos;s machine.</div>
      )}
      {runList?.configured && runList.rootExists && runList.runs.length === 0 && (
        <div className="error">No runs found. Create one with scripts/xgrids/extract_frames.py.</div>
      )}
      {runList && runList.runs.length > 0 && (
        <select value={runId ?? ""} onChange={(e) => onRunChange(e.target.value)}>
          {runList.runs.map((r) => (
            <option key={r.id} value={r.id} disabled={!!r.error}>
              {r.id}
              {r.error ? " (unreadable)" : ` · ${r.eventCount} events`}
            </option>
          ))}
        </select>
      )}
      {run && (
        <div className="note">
          {run.mode} · {run.source.xbin} · images {Object.entries(run.imageStatus ?? {}).map(([s, n]) => `${n} ${s}`).join(", ")}
          {run.excludedOutsidePoseRange &&
            ` · ${run.excludedOutsidePoseRange.events} events outside the pose time range were not extracted`}
        </div>
      )}
    </div>
  );
}

function FrameCheck({ matches, runSha, datasetSha, datasetName }: NonNullable<CalibrationPanelProps["frameCheck"]>) {
  return matches ? (
    <div className="note ok">
      ✓ Same frame: the run&apos;s poses.csv is byte-identical to this dataset&apos;s (SHA-256 {short(runSha)}…), so its
      scanner positions are original LAS coordinates of this scan.
    </div>
  ) : (
    <div className="error">
      The run&apos;s poses.csv (SHA-256 {short(runSha)}…) is not {datasetName}&apos;s poses file ({short(datasetSha)}…): its
      positions may be in another frame, so no markers are shown. Choose the dataset of this recording.
    </div>
  );
}

function EventSection({
  run,
  event,
  eventIndex,
  onEventIndexChange,
  offset,
  crossCheckMetres,
  onRequestView,
  markerShown,
  cameras,
}: CalibrationPanelProps & { run: Run; event: RunEvent }) {
  const [sequenceText, setSequenceText] = useState("");
  // Tied to the event it describes, so it disappears when any other control (buttons, slider, dots) moves on.
  const [jumpNote, setJumpNote] = useState<{ index: number; text: string } | null>(null);
  const last = run.events.length - 1;
  const reference = eventReference(event);
  const channels = eventChannels(event);
  const times = channels.map((c) => event.images[c].timestampUs);
  const pose = reference.pose;

  function jumpToSequence() {
    const wanted = Number(sequenceText);
    if (!Number.isInteger(wanted)) return;
    let best = 0;
    run.events.forEach((e, i) => {
      if (Math.abs(e.sequence - wanted) < Math.abs(run.events[best].sequence - wanted)) best = i;
    });
    onEventIndexChange(best);
    const found = run.events[best].sequence;
    setJumpNote(found === wanted ? null : { index: best, text: `Sequence ${wanted} isn't in this run; showing the nearest, ${found}.` });
  }

  return (
    <div className="section">
      <b className="sub">Capture event</b>
      <div className="inline-row">
        <button onClick={() => onEventIndexChange(Math.max(0, eventIndex - 1))} disabled={eventIndex === 0}>
          ◀
        </button>
        <input
          type="range"
          min={0}
          max={last}
          value={eventIndex}
          onChange={(e) => onEventIndexChange(Number(e.target.value))}
        />
        <button onClick={() => onEventIndexChange(Math.min(last, eventIndex + 1))} disabled={eventIndex === last}>
          ▶
        </button>
      </div>
      <form
        className="inline-row"
        onSubmit={(e) => {
          e.preventDefault();
          jumpToSequence();
        }}
      >
        Sequence
        <input type="number" min={0} value={sequenceText} placeholder={String(event.sequence)} onChange={(e) => setSequenceText(e.target.value)} />
        <button type="submit">Go</button>
      </form>
      {jumpNote?.index === eventIndex && <div className="note">{jumpNote.text}</div>}

      <table className="attr-table">
        <tbody>
          <tr>
            <th>Event</th>
            <td>
              {eventIndex + 1} / {run.events.length}
            </td>
          </tr>
          <tr>
            <th>Sequence</th>
            <td>{event.sequence}</td>
          </tr>
          {channels.map((c) => (
            <tr key={c}>
              <th>
                <span className="swatch" style={{ background: CHANNEL_COLOURS[c] }} /> {c} time
              </th>
              <td>
                {event.images[c].timestampUtc.slice(11)}
                <div className="unit">{event.images[c].timestampUs} µs</div>
              </td>
            </tr>
          ))}
          {times.length === 2 && (
            <tr>
              <th>
                Δt ({channels[1]} − {channels[0]})
              </th>
              <td>{times[1] - times[0]} µs</td>
            </tr>
          )}
        </tbody>
      </table>

      <b className="sub">Scanner pose at the {channels.find((c) => event.images[c] === reference)} time</b>
      {pose.position && pose.quaternion ? (
        <>
          <table className="attr-table">
            <tbody>
              <tr>
                <th>Position (LAS, m)</th>
                <td>{fixed(pose.position, 3)}</td>
              </tr>
              {offset && (
                <tr>
                  <th>In viewer (− offset)</th>
                  <td>{fixed(pose.position.map((v, k) => v - offset[k]), 3)}</td>
                </tr>
              )}
              <tr>
                <th>Quaternion (x, y, z, w)</th>
                <td>{fixed(pose.quaternion, 4)}</td>
              </tr>
              <tr>
                <th>Interpolated</th>
                <td>
                  {((pose.alpha ?? 0) * 100).toFixed(0)}% between poses {pose.beforeUs} and {pose.afterUs}
                </td>
              </tr>
            </tbody>
          </table>
          {crossCheckMetres !== null && (
            <div className={crossCheckMetres < 0.001 ? "note ok" : "error"}>
              {crossCheckMetres < 0.001 ? "✓" : "⚠"} Marker check: this dataset&apos;s own poses at the same time are{" "}
              {crossCheckMetres < 0.001 ? `${(crossCheckMetres * 1e6).toFixed(1)} µm` : `${(crossCheckMetres * 1000).toFixed(1)} mm`}{" "}
              from the run&apos;s position.
            </div>
          )}
        </>
      ) : (
        <div className="note">No scanner pose for this event ({pose.status}).</div>
      )}
      <div className="note">
        This is the scanner&apos;s pose (body frame: red X forward, green Y left, blue Z up), not a camera pose.
      </div>
      <div className="dataset-actions">
        <button disabled={!markerShown} onClick={() => onRequestView({ kind: "marker" })}>
          Focus marker
        </button>
        {cameras.map((c) => (
          <button key={c.channel} disabled={!markerShown} onClick={() => onRequestView({ kind: "look", channel: c.channel })}>
            Look along {c.channel}*
          </button>
        ))}
      </div>
      <div className="note">* from the scanner position along the provisional {cameras.map((c) => c.channel).join("/")} direction (perspective view; the images are fisheye).</div>
    </div>
  );
}

function CalibrationSection({ cameras }: CalibrationPanelProps) {
  return (
    <>
      <div className="section">
        <b className="sub">Calibration status</b>
        <table className="attr-table">
          <thead>
            <tr>
              <th>Camera</th>
              <th>Intrinsics</th>
              <th>Extrinsics</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => {
              const known = calibrationOf(c.channel);
              return (
                <tr key={c.channel}>
                  <th>{c.channel}</th>
                  <td className="unknown">{known.intrinsics.status}</td>
                  <td className="unknown">{known.extrinsics.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="note">
          Intrinsics = fisheye lens model. Extrinsics = camera-to-scanner rotation and offset. Which physical camera each
          channel is has not been established. See docs/xgrids/calibration-notes.md.
        </div>
      </div>
    </>
  );
}
