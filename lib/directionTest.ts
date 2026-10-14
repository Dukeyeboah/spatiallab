import type { ProvisionalOrientation } from "@/lib/calibration";

/**
 * Lab 13S: manual visual extrinsics hypothesis test.
 *
 * A fixed set of capture events to check one pair of channel offsets against,
 * plus the user's notes and named offset presets. Notes and presets live in
 * the browser's localStorage only (nothing is sent to the backend); "Export"
 * downloads them as JSON.
 */

export type TestEvent = { sequence: number; setting: "courtyard" | "indoor"; note?: string };

/**
 * Events of the Basel House `interval-10s` run. Settings from the 5M preview:
 * "courtyard" = no LiDAR point within ±1 m horizontally above the scanner
 * (open sky), "indoor" = a ceiling about 2.2 m above it.
 */
export const BASEL_TEST_SET: TestEvent[] = [
  { sequence: 2497, setting: "courtyard", note: "seed event" },
  { sequence: 2527, setting: "courtyard", note: "seed event" },
  { sequence: 3037, setting: "courtyard", note: "seed event" },
  { sequence: 2466, setting: "courtyard" },
  { sequence: 2557, setting: "courtyard" },
  { sequence: 2646, setting: "courtyard" },
  { sequence: 2706, setting: "courtyard" },
  { sequence: 2766, setting: "courtyard" },
  { sequence: 2827, setting: "courtyard" },
  { sequence: 3007, setting: "courtyard" },
  { sequence: 3067, setting: "courtyard" },
  { sequence: 1335, setting: "indoor" },
  { sequence: 4718, setting: "indoor" },
  { sequence: 7178, setting: "indoor" },
];

export type Offsets = Record<string, ProvisionalOrientation>;
export type HelperShape = { coneLength: number; coneHalfAngleDeg: number };
export const DEFAULT_HELPER_SHAPE: HelperShape = { coneLength: 2, coneHalfAngleDeg: 30 };

/** Per channel: does the centre of this fisheye image match the helper's direction? */
export type Verdict = "match" | "roughly" | "no" | "unsure";
export type EventNote = {
  verdicts: Record<string, Verdict | undefined>;
  text: string;
  /** The offsets in use when the note was last edited. */
  offsets: Offsets;
  updated: string;
};
export type Preset = { name: string; offsets: Offsets; shape: HelperShape; saved: string };

const NOTES_KEY = "spatial-lab.direction-test.notes.v1";
const PRESETS_KEY = "spatial-lab.direction-test.presets.v1";

export const noteKey = (runId: string, sequence: number) => `${runId}/${sequence}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const loadNotes = () => read<Record<string, EventNote>>(NOTES_KEY, {});
export const saveNotes = (notes: Record<string, EventNote>) => window.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
export const loadPresets = () => read<Preset[]>(PRESETS_KEY, []);
export const savePresets = (presets: Preset[]) => window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));

/** Download notes + presets as one JSON file (for the investigation log). */
export function exportSession(notes: Record<string, EventNote>, presets: Preset[]) {
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), notes, presets }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "direction-test-session.json";
  a.click();
  URL.revokeObjectURL(url);
}
