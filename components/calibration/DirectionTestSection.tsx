"use client";

import { useEffect, useState } from "react";
import { describeDirection, STARTING_HYPOTHESIS, type ProvisionalOrientation } from "@/lib/calibration";
import {
  BASEL_TEST_SET,
  DEFAULT_HELPER_SHAPE,
  exportSession,
  loadNotes,
  loadPresets,
  noteKey,
  saveNotes,
  savePresets,
  type EventNote,
  type HelperShape,
  type Offsets,
  type Preset,
  type Verdict,
} from "@/lib/directionTest";
import type { Run, RunEvent } from "@/lib/xgrids";
import { CHANNEL_COLOURS, type ProvisionalCamera } from "./CalibrationLayers";

type DirectionTestSectionProps = {
  run: Run;
  event: RunEvent;
  onEventIndexChange: (index: number) => void;
  cameras: ProvisionalCamera[];
  onCamerasChange: (cameras: ProvisionalCamera[]) => void;
  shape: HelperShape;
  onShapeChange: (shape: HelperShape) => void;
  showAxes: boolean;
  onShowAxesChange: (show: boolean) => void;
};

const ANGLES = [
  ["yawDeg", "Yaw", -180, 180, "+ = right"],
  ["pitchDeg", "Pitch", -90, 90, "+ = up"],
  ["rollDeg", "Roll", -180, 180, "+ = clockwise"],
] as const;
const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "match", label: "✓ centre matches" },
  { value: "roughly", label: "≈ roughly" },
  { value: "no", label: "✗ no" },
  { value: "unsure", label: "?" },
];
const START_PRESET: Preset = {
  name: "Starting hypothesis (ch14 yaw −90°, ch18 yaw +90°)",
  offsets: STARTING_HYPOTHESIS,
  shape: DEFAULT_HELPER_SHAPE,
  saved: "",
};

/** Mirror across the scanner's X–Z plane: left ↔ right, same pitch, opposite roll. */
const mirrored = (o: ProvisionalOrientation): ProvisionalOrientation => ({
  yawDeg: o.yawDeg === 0 || Math.abs(o.yawDeg) === 180 ? o.yawDeg : -o.yawDeg,
  pitchDeg: o.pitchDeg,
  rollDeg: -o.rollDeg || 0,
});

/**
 * Lab 13S: manual visual extrinsics hypothesis test. Per-channel offsets in
 * the scanner's body frame, helper shape, presets, a fixed test set of events
 * and per-event notes. Nothing here is calibration.
 */
export function DirectionTestSection(props: DirectionTestSectionProps) {
  const { run, event, cameras, onCamerasChange } = props;
  const offsets: Offsets = Object.fromEntries(cameras.map((c) => [c.channel, c.orientation]));
  const update = (channel: string, change: Partial<ProvisionalCamera>) =>
    onCamerasChange(cameras.map((c) => (c.channel === channel ? { ...c, ...change } : c)));
  const setOffsets = (next: Offsets) =>
    onCamerasChange(cameras.map((c) => ({ ...c, orientation: next[c.channel] ?? c.orientation })));
  const [a, b] = cameras;

  return (
    <div className="section provisional">
      <b className="sub">Direction hypothesis test · manual, not calibration</b>
      <div className="note">
        Each helper is a guessed camera direction relative to the scanner body (X forward, Y left, Z up), drawn from the
        scanner position without a lever arm. Compare it with the <b>centre</b> of that channel&apos;s fisheye image (the
        cross-hair); image edges are distorted and less reliable. The scanner&apos;s own direction is not assumed to be
        either camera&apos;s.
      </div>

      {cameras.map((c) => (
        <div key={c.channel} className="provisional-camera">
          <label>
            <input type="checkbox" checked={c.visible} onChange={(e) => update(c.channel, { visible: e.target.checked })} />
            <span className="swatch" style={{ background: CHANNEL_COLOURS[c.channel] }} /> <b>{c.channel}</b>
            <span className="unit">→ {describeDirection(c.orientation)}</span>
          </label>
          {ANGLES.map(([key, label, min, max, hint]) => (
            <label key={key} title={hint}>
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={c.orientation[key]}
                onChange={(e) => update(c.channel, { orientation: { ...c.orientation, [key]: Number(e.target.value) } })}
              />
              <input
                type="number"
                className="angle"
                min={min}
                max={max}
                step={1}
                value={c.orientation[key]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) update(c.channel, { orientation: { ...c.orientation, [key]: Math.max(min, Math.min(max, v)) } });
                }}
              />
              °
            </label>
          ))}
        </div>
      ))}
      <div className="note">Yaw + = right (−90 = left), pitch + = up, roll + = clockwise seen from behind the camera.</div>
      <div className="dataset-actions">
        <button onClick={() => setOffsets(STARTING_HYPOTHESIS)}>Reset both to ±90°</button>
        {a && b && (
          <>
            <button title={`${b.channel} := mirror of ${a.channel}`} onClick={() => setOffsets({ ...offsets, [b.channel]: mirrored(a.orientation) })}>
              Mirror {a.channel} → {b.channel}
            </button>
            <button title={`${a.channel} := mirror of ${b.channel}`} onClick={() => setOffsets({ ...offsets, [a.channel]: mirrored(b.orientation) })}>
              Mirror {b.channel} → {a.channel}
            </button>
            <button
              title="Test the opposite channel interpretation: exchange the two channels' offsets"
              onClick={() => setOffsets({ [a.channel]: b.orientation, [b.channel]: a.orientation })}
            >
              Swap {a.channel} ↔ {b.channel}
            </button>
          </>
        )}
      </div>

      <HelperShapeControls {...props} />
      <PresetControls offsets={offsets} shape={props.shape} onLoad={(p) => (setOffsets(p.offsets), props.onShapeChange(p.shape))} />
      <TestSetControls {...props} offsets={offsets} runId={run.id} event={event} />
    </div>
  );
}

function HelperShapeControls({ shape, onShapeChange, showAxes, onShowAxesChange }: DirectionTestSectionProps) {
  return (
    <>
      <label>
        Cone length
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={shape.coneLength}
          onChange={(e) => onShapeChange({ ...shape, coneLength: Number(e.target.value) })}
        />
        <span className="value">{shape.coneLength} m</span>
      </label>
      <label title="Only a visual aid around the centre ray, not the lens's field of view (unknown; the fisheyes see > 180°)">
        Cone half-angle
        <input
          type="range"
          min={5}
          max={85}
          step={1}
          value={shape.coneHalfAngleDeg}
          onChange={(e) => onShapeChange({ ...shape, coneHalfAngleDeg: Number(e.target.value) })}
        />
        <span className="value">{shape.coneHalfAngleDeg}°</span>
      </label>
      <label>
        <input type="checkbox" checked={showAxes} onChange={(e) => onShowAxesChange(e.target.checked)} />
        Scanner X/Y/Z gizmo (the frame of the offsets)
      </label>
    </>
  );
}

function PresetControls({ offsets, shape, onLoad }: { offsets: Offsets; shape: HelperShape; onLoad: (preset: Preset) => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  // localStorage is read after mounting: the page is prerendered without it.
  useEffect(() => setPresets(loadPresets()), []);
  const all = [START_PRESET, ...presets];

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [...presets.filter((p) => p.name !== trimmed), { name: trimmed, offsets, shape, saved: new Date().toISOString() }];
    setPresets(next);
    savePresets(next);
    setSelected(trimmed);
    setName("");
  }
  function remove() {
    const next = presets.filter((p) => p.name !== selected);
    setPresets(next);
    savePresets(next);
    setSelected("");
  }

  return (
    <>
      <b className="sub">Offset presets (this browser only)</b>
      <div className="inline-row">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Choose a preset…</option>
          {all.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button disabled={!selected} onClick={() => onLoad(all.find((p) => p.name === selected)!)}>
          Load
        </button>
        <button disabled={!selected || selected === START_PRESET.name} onClick={remove}>
          Delete
        </button>
      </div>
      <form
        className="inline-row"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input type="text" placeholder="Name for the current offsets" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </>
  );
}

function TestSetControls({
  run,
  event,
  onEventIndexChange,
  cameras,
  offsets,
  runId,
}: DirectionTestSectionProps & { offsets: Offsets; runId: string }) {
  const [notes, setNotes] = useState<Record<string, EventNote>>({});
  useEffect(() => setNotes(loadNotes()), []);

  const inRun = BASEL_TEST_SET.map((t) => ({ ...t, index: run.events.findIndex((e) => e.sequence === t.sequence) }));
  const available = inRun.filter((t) => t.index >= 0);
  const position = available.findIndex((t) => t.sequence === event.sequence);
  const key = noteKey(runId, event.sequence);
  const note = notes[key];

  function edit(change: Partial<EventNote>) {
    const next = {
      ...notes,
      [key]: { ...(note ?? { verdicts: {}, text: "" }), ...change, offsets, updated: new Date().toISOString() },
    };
    setNotes(next);
    saveNotes(next);
  }
  const step = (delta: number) => {
    if (available.length === 0) return;
    const from = position < 0 ? (delta > 0 ? -1 : 0) : position;
    onEventIndexChange(available[(from + delta + available.length) % available.length].index);
  };
  const verdictClass = (t: { sequence: number }) => {
    const v = Object.values(notes[noteKey(runId, t.sequence)]?.verdicts ?? {});
    if (v.length === 0) return "";
    return v.every((x) => x === "match") ? "v-match" : v.some((x) => x === "no") ? "v-no" : "v-roughly";
  };

  return (
    <>
      <b className="sub">Test set</b>
      {available.length === 0 ? (
        <div className="note">None of the test events is in run {run.id}; choose interval-10s.</div>
      ) : (
        <>
          <div className="inline-row">
            <button onClick={() => step(-1)}>◀</button>
            <span className="unit">
              {position >= 0 ? `${position + 1} / ${available.length}` : "not a test event"}
              {available.length < BASEL_TEST_SET.length && ` · ${BASEL_TEST_SET.length - available.length} not in this run`}
            </span>
            <button onClick={() => step(1)}>▶</button>
          </div>
          <div className="test-chips">
            {available.map((t) => (
              <button
                key={t.sequence}
                className={`${t.sequence === event.sequence ? "selected" : ""} ${verdictClass(t)}`}
                title={`${t.setting}${t.note ? ` · ${t.note}` : ""}`}
                onClick={() => onEventIndexChange(t.index)}
              >
                {t.sequence}
                <small>{t.setting === "indoor" ? " in" : " out"}</small>
              </button>
            ))}
          </div>
          <div className="note">out = courtyard (open sky above), in = indoor (ceiling ≈ 2.2 m above). Chip colour = your verdicts.</div>
        </>
      )}

      <b className="sub">Notes · sequence {event.sequence}</b>
      {cameras.map((c) => (
        <div key={c.channel} className="inline-row verdicts">
          <span className="swatch" style={{ background: CHANNEL_COLOURS[c.channel] }} /> {c.channel}
          {VERDICTS.map((v) => (
            <button
              key={v.value}
              className={note?.verdicts[c.channel] === v.value ? "selected" : ""}
              onClick={() => edit({ verdicts: { ...note?.verdicts, [c.channel]: v.value } })}
            >
              {v.label}
            </button>
          ))}
        </div>
      ))}
      <textarea
        rows={3}
        placeholder="What do you see at the centre of each image? Landmarks, mismatch direction…"
        value={note?.text ?? ""}
        onChange={(e) => edit({ text: e.target.value })}
      />
      {note && (
        <div className="unit">
          Saved with {Object.entries(note.offsets).map(([ch, o]) => `${ch} ${o.yawDeg}/${o.pitchDeg}/${o.rollDeg}°`).join(", ")} (yaw/pitch/roll)
        </div>
      )}
      <div className="dataset-actions">
        <button onClick={() => exportSession(notes, loadPresets())}>
          Export notes + presets (JSON)
        </button>
      </div>
    </>
  );
}
