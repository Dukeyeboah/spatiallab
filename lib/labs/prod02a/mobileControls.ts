/**
 * PROD-02A.1 mobile / touch control defaults.
 * Joystick + look zone feed the same Smooth / Walk intent APIs — no separate mover.
 */

export type JoystickPlacement = "fixed" | "floating";
export type TouchControlLayout = "left-move" | "right-move";

export type MobileControlTuning = {
  /** Master enable (also auto on coarse pointers unless forced off). */
  enabled: boolean;
  /** Force-show on desktop for testing. */
  forceOnDesktop: boolean;
  joystickSize: number;
  joystickOpacity: number;
  /** 0–1 of knob radius; below this → no move. */
  deadZone: number;
  /** Scales stick magnitude into move intent (1 = full walkSpeed at rim). */
  moveSensitivity: number;
  /** Multiplier on pixel look deltas. */
  lookSensitivity: number;
  placement: JoystickPlacement;
  layout: TouchControlLayout;
};

export const DEFAULT_MOBILE_CONTROLS: MobileControlTuning = {
  /** Joystick disabled for production path (PROD-02A.1 experimental — keep code, do not activate). */
  enabled: false,
  forceOnDesktop: false,
  joystickSize: 128,
  joystickOpacity: 0.72,
  deadZone: 0.14,
  moveSensitivity: 1,
  lookSensitivity: 1.15,
  placement: "fixed",
  layout: "left-move",
};

const KEY = "spatial-lab.prod02a.mobile-controls.v1";

export function loadMobileControlTuning(): MobileControlTuning | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return { ...DEFAULT_MOBILE_CONTROLS, ...(JSON.parse(raw) as Partial<MobileControlTuning>) };
  } catch {
    return null;
  }
}

export function saveMobileControlTuning(t: MobileControlTuning) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(t));
}

export function preferTouchControls(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}
