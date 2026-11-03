"use client";

import { useEffect, useRef } from "react";

export type WalkVirtualApi = {
  setVirtualMove: (x: number, z: number) => void;
  setVirtualLook: (yawDir: number, pitchDir: number) => void;
  clearVirtualInput: () => void;
};

type Props = {
  visible: boolean;
  api: WalkVirtualApi | null;
  /** Which pad(s) to render — page places Move left and Look right. */
  which?: "move" | "look" | "both";
};

type HoldKind = "move" | "look";

/** Curved rotate glyph with clear arrowhead (yaw left/right, pitch up/down). */
function RotateGlyph({ dir }: { dir: "left" | "right" | "up" | "down" }) {
  const rot = dir === "left" ? 0 : dir === "up" ? 90 : dir === "right" ? 180 : 270;
  return (
    <svg className="exp-curved" viewBox="0 0 24 24" aria-hidden style={{ transform: `rotate(${rot}deg)` }}>
      <path
        d="M8 17.5c0-4.2 3.2-7.5 7.2-7.5H18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path d="M15.2 6.2 L19.6 9.8 L14.8 11.6 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * On-screen Move and/or Look pads. Place Move on the left dock and Look on the right.
 */
export function WalkOnScreenControls({ visible, api, which = "both" }: Props) {
  const moveRef = useRef({ x: 0, z: 0 });
  const lookRef = useRef({ yaw: 0, pitch: 0 });
  const apiRef = useRef(api);
  apiRef.current = api;

  const syncMove = () => apiRef.current?.setVirtualMove(moveRef.current.x, moveRef.current.z);
  const syncLook = () => apiRef.current?.setVirtualLook(lookRef.current.yaw, lookRef.current.pitch);

  const bindHold = (kind: HoldKind, apply: (active: boolean) => void) => {
    const onDown = (evt: React.PointerEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      (evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId);
      apply(true);
      if (kind === "move") syncMove();
      else syncLook();
    };
    const onUp = (evt: React.PointerEvent) => {
      evt.preventDefault();
      apply(false);
      if (kind === "move") syncMove();
      else syncLook();
    };
    return {
      onPointerDown: onDown,
      onPointerUp: onUp,
      onPointerCancel: onUp,
      onLostPointerCapture: () => {
        apply(false);
        if (kind === "move") syncMove();
        else syncLook();
      },
    };
  };

  useEffect(() => {
    if (!visible) {
      moveRef.current = { x: 0, z: 0 };
      lookRef.current = { yaw: 0, pitch: 0 };
      apiRef.current?.clearVirtualInput();
    }
  }, [visible]);

  useEffect(() => {
    const clear = () => {
      moveRef.current = { x: 0, z: 0 };
      lookRef.current = { yaw: 0, pitch: 0 };
      apiRef.current?.clearVirtualInput();
    };
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);

  if (!visible) return null;

  const move = (axis: "x" | "z", dir: -1 | 1) =>
    bindHold("move", (active) => {
      moveRef.current[axis] = active ? dir : 0;
    });

  const look = (axis: "yaw" | "pitch", dir: -1 | 1) =>
    bindHold("look", (active) => {
      lookRef.current[axis] = active ? dir : 0;
    });

  const showMove = which === "move" || which === "both";
  const showLook = which === "look" || which === "both";

  return (
    <div className={`exp-walk-pads exp-walk-pads-${which}`} aria-label="On-screen walk controls">
      {showMove && (
        <div className="exp-pad" aria-label="Move">
          <div className="exp-pad-label">Move</div>
          <div className="exp-pad-grid">
            <span className="exp-pad-spacer" />
            <button type="button" className="exp-pad-btn" aria-label="Forward" {...move("z", -1)}>
              <b>↑</b>
            </button>
            <span className="exp-pad-spacer" />
            <button type="button" className="exp-pad-btn" aria-label="Strafe left" {...move("x", -1)}>
              <b>←</b>
            </button>
            <button type="button" className="exp-pad-btn" aria-label="Back" {...move("z", 1)}>
              <b>↓</b>
            </button>
            <button type="button" className="exp-pad-btn" aria-label="Strafe right" {...move("x", 1)}>
              <b>→</b>
            </button>
          </div>
          <p className="exp-pad-hint">Keyboard: WASD or ↑ ↓ ← →</p>
        </div>
      )}

      {showLook && (
        <div className="exp-pad" aria-label="Look / rotate">
          <div className="exp-pad-label">Look</div>
          <div className="exp-pad-grid">
            <span className="exp-pad-spacer" />
            <button type="button" className="exp-pad-btn look" aria-label="Tilt up" {...look("pitch", 1)}>
              <RotateGlyph dir="up" />
            </button>
            <span className="exp-pad-spacer" />
            <button type="button" className="exp-pad-btn look" aria-label="Turn left" {...look("yaw", 1)}>
              <RotateGlyph dir="left" />
            </button>
            <button type="button" className="exp-pad-btn look" aria-label="Tilt down" {...look("pitch", -1)}>
              <RotateGlyph dir="down" />
            </button>
            <button type="button" className="exp-pad-btn look" aria-label="Turn right" {...look("yaw", -1)}>
              <RotateGlyph dir="right" />
            </button>
          </div>
          <p className="exp-pad-hint">Or click &amp; drag the screen to look around</p>
        </div>
      )}
    </div>
  );
}
