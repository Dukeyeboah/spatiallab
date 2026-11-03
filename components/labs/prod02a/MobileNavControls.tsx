"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MobileControlTuning } from "@/lib/labs/prod02a/mobileControls";

/** Shared nav input — keyboard, joystick, pads, future Point & Move cancel. */
export type NavInputApi = {
  setMoveIntent: (x: number, z: number) => void;
  clearMoveIntent: () => void;
  applyLookDelta: (dx: number, dy: number, sensitivity?: number) => void;
  /** Cancel auto travel when the player takes manual control. */
  cancelAutoMove?: () => void;
};

type Props = {
  visible: boolean;
  api: NavInputApi | null;
  tuning: MobileControlTuning;
};

type StickVisual = {
  active: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
};

/**
 * Left virtual joystick + right touch-look zone.
 * Feeds the existing Smooth / Walk controller — does not move the camera itself.
 */
export function MobileNavControls({ visible, api, tuning }: Props) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;

  const movePointerId = useRef<number | null>(null);
  const lookPointerId = useRef<number | null>(null);
  const lookPrev = useRef({ x: 0, y: 0 });
  const baseOrigin = useRef({ x: 0, y: 0 });
  const engagedMove = useRef(false);

  const [stick, setStick] = useState<StickVisual>({
    active: false,
    baseX: 0,
    baseY: 0,
    knobX: 0,
    knobY: 0,
  });

  const clearMove = useCallback(() => {
    movePointerId.current = null;
    engagedMove.current = false;
    apiRef.current?.clearMoveIntent();
    setStick((s) => ({ ...s, active: false, knobX: s.baseX, knobY: s.baseY }));
  }, []);

  const clearLook = useCallback(() => {
    lookPointerId.current = null;
  }, []);

  useEffect(() => {
    if (!visible) {
      clearMove();
      clearLook();
    }
  }, [visible, clearMove, clearLook]);

  useEffect(() => {
    const onBlur = () => {
      clearMove();
      clearLook();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      onBlur();
    };
  }, [clearMove, clearLook]);

  const applyStick = (clientX: number, clientY: number) => {
    const t = tuningRef.current;
    const radius = t.joystickSize * 0.5;
    const dx = clientX - baseOrigin.current.x;
    const dy = clientY - baseOrigin.current.y;
    const dist = Math.hypot(dx, dy);
    const max = radius;
    const clamped = dist > max ? max / dist : 1;
    const kx = dx * clamped;
    const ky = dy * clamped;
    const nx = kx / max;
    const nz = ky / max; // screen down → world +Z wish (backward), matches pad convention
    const mag = Math.hypot(nx, nz);
    const dead = t.deadZone;
    let intentX = 0;
    let intentZ = 0;
    if (mag > dead) {
      const remapped = Math.min(1, (mag - dead) / (1 - dead));
      const scale = (remapped / mag) * t.moveSensitivity;
      intentX = nx * scale;
      intentZ = nz * scale;
      const len = Math.hypot(intentX, intentZ);
      if (len > 1) {
        intentX /= len;
        intentZ /= len;
      }
    }
    if (!engagedMove.current && (intentX !== 0 || intentZ !== 0)) {
      engagedMove.current = true;
      apiRef.current?.cancelAutoMove?.();
    }
    apiRef.current?.setMoveIntent(intentX, intentZ);
    setStick({
      active: true,
      baseX: baseOrigin.current.x,
      baseY: baseOrigin.current.y,
      knobX: baseOrigin.current.x + kx,
      knobY: baseOrigin.current.y + ky,
    });
  };

  const onMoveZoneDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!visible || e.button !== 0) return;
    if (movePointerId.current != null) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    movePointerId.current = e.pointerId;

    const t = tuningRef.current;
    const rect = el.getBoundingClientRect();
    if (t.placement === "floating") {
      baseOrigin.current = { x: e.clientX, y: e.clientY };
    } else {
      const size = t.joystickSize;
      const pad = 8;
      const layoutRight = t.layout === "right-move";
      const cx = layoutRight
        ? rect.right - size * 0.5 - pad
        : rect.left + size * 0.5 + pad;
      const cy = rect.bottom - size * 0.5 - pad;
      baseOrigin.current = { x: cx, y: cy };
    }
    applyStick(e.clientX, e.clientY);
  };

  const onMoveZoneMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (movePointerId.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    applyStick(e.clientX, e.clientY);
  };

  const onMoveZoneUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (movePointerId.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    clearMove();
  };

  const onLookDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!visible || e.button !== 0) return;
    if (lookPointerId.current != null) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    lookPointerId.current = e.pointerId;
    lookPrev.current = { x: e.clientX, y: e.clientY };
  };

  const onLookMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - lookPrev.current.x;
    const dy = e.clientY - lookPrev.current.y;
    lookPrev.current = { x: e.clientX, y: e.clientY };
    apiRef.current?.applyLookDelta(dx, dy, tuningRef.current.lookSensitivity);
  };

  const onLookUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    clearLook();
  };

  if (!visible) return null;

  const size = tuning.joystickSize;
  const opacity = tuning.joystickOpacity;
  const moveLeft = tuning.layout === "left-move";
  const showFixedKnob = tuning.placement === "fixed" || stick.active;

  const fixedStyle: CSSProperties | undefined =
    tuning.placement === "fixed"
      ? {
          position: "absolute",
          width: size,
          height: size,
          left: moveLeft ? 12 : undefined,
          right: moveLeft ? undefined : 12,
          bottom: `max(18px, env(safe-area-inset-bottom, 0px))`,
          opacity,
        }
      : undefined;

  const floatingStyle: CSSProperties | undefined =
    stick.active && tuning.placement === "floating"
      ? {
          position: "fixed",
          width: size,
          height: size,
          left: stick.baseX - size / 2,
          top: stick.baseY - size / 2,
          opacity,
          pointerEvents: "none",
        }
      : undefined;

  const knobOffset =
    stick.active
      ? {
          transform: `translate(${stick.knobX - stick.baseX}px, ${stick.knobY - stick.baseY}px)`,
        }
      : undefined;

  return (
    <div className="p2a-mobile" aria-hidden={false}>
      <div
        className={`p2a-touch-zone p2a-touch-move${moveLeft ? " left" : " right"}`}
        onPointerDown={onMoveZoneDown}
        onPointerMove={onMoveZoneMove}
        onPointerUp={onMoveZoneUp}
        onPointerCancel={onMoveZoneUp}
        onLostPointerCapture={() => {
          if (movePointerId.current != null) clearMove();
        }}
      >
        {showFixedKnob && tuning.placement === "fixed" ? (
          <div className="p2a-joystick" style={fixedStyle}>
            <div className="p2a-joystick-base" />
            <div className="p2a-joystick-knob" style={knobOffset} />
          </div>
        ) : null}
      </div>

      {stick.active && tuning.placement === "floating" ? (
        <div className="p2a-joystick floating" style={floatingStyle}>
          <div className="p2a-joystick-base" />
          <div className="p2a-joystick-knob" style={knobOffset} />
        </div>
      ) : null}

      <div
        className={`p2a-touch-zone p2a-touch-look${moveLeft ? " right" : " left"}`}
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
        onLostPointerCapture={() => {
          if (lookPointerId.current != null) clearLook();
        }}
      />
    </div>
  );
}
