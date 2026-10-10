import type { AnimationPreset, GaussianCount } from "./compositingScene";

/** What the Lab 7B panel edits. */
export type CompositingControlsState = {
  count: GaussianCount;
  /** "correct" = nearest first (front-to-back); "reversed" = farthest first, deliberately wrong. */
  ordering: "correct" | "reversed";
  /** Multiplies every Gaussian's opacity (the result is capped at 0.99 when drawn). */
  globalOpacity: number;
  /** Multiplies every Gaussian's scale. */
  globalScale: number;
  preset: AnimationPreset;
  /** Animation time runs this many times faster than real time. */
  speed: number;
  playing: boolean;
  showOutlines: boolean;
};

export const defaultCompositingControls: CompositingControlsState = {
  count: 3,
  ordering: "correct",
  globalOpacity: 1,
  globalScale: 1,
  preset: "none",
  speed: 1,
  playing: true,
  showOutlines: true,
};
