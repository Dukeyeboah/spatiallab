"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FisheyeModel } from "@/lib/fisheyeProjection";
import { imageNameMatches, runImageUrl, type RunEvent, type RunImage } from "@/lib/xgrids";

/** A press that moves further than this pans instead of picking. */
const CLICK_TOLERANCE_PX = 4;
const MAX_SCALE = 16;

export type ImageMarker = {
  id: string;
  label: string;
  u: number;
  v: number;
  predicted: { u: number; v: number } | null;
  active: boolean;
  /** "coverage": a match from another image of the same camera, shown for spread only. */
  kind?: "coverage";
};

type CorrespondenceViewerProps = {
  runId: string;
  event: RunEvent;
  channel: string;
  image: RunImage;
  markers: ImageMarker[];
  pending: { u: number; v: number } | null;
  /** Without it the viewer only displays (Lab 13V optimization mode). */
  onPick?: (u: number, v: number) => void;
  /** Projected LiDAR points: (u, v, range m) triplets, original pixels. */
  overlay: Float32Array | null;
  /** Drawn as the usable circle + principal point when set. */
  model: FisheyeModel | null;
  header: ReactNode;
  /** "small" leaves the centre of the 3D view free for picking. */
  size: "large" | "small";
  /** When set, pan/zoom so this original-pixel point is centred (Lab 14E.4 Jump). */
  focusPixel?: { u: number; v: number; token: number } | null;
};

/** screen = (pixel + 0.5) · scale + t: pixel centres are integers, the image's top-left corner is (−0.5, −0.5). */
type View = { scale: number; tx: number; ty: number };

/**
 * Lab 13U: one fisheye image at full resolution with zoom (wheel), pan (drag)
 * and click-to-pick. Picks are reported in original image pixels
 * (u right, v down, (0, 0) = centre of the top-left pixel), never in screen
 * pixels. Mount with a key per image so zoom and size checks reset.
 */
export function CorrespondenceViewer({ runId, event, channel, image, markers, pending, onPick, overlay, model, header, size: layout, focusPixel }: CorrespondenceViewerProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<{ u: number; v: number } | null>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  const nameOk = imageNameMatches(event, channel, image);
  const sizeOk = !!natural && natural.width === image.width && natural.height === image.height;
  const canPick = nameOk && sizeOk && !!onPick;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = () => {
    if (!size || !natural) return;
    const scale = Math.min(size.width / natural.width, size.height / natural.height);
    setView({ scale, tx: (size.width - natural.width * scale) / 2, ty: (size.height - natural.height * scale) / 2 });
  };
  // Fit once both sizes are known, and again after a Large/Small switch (not on every resize).
  const needsFit = useRef(true);
  useEffect(() => {
    needsFit.current = true;
  }, [layout]);
  useEffect(() => {
    if (!needsFit.current || !size || !natural) return;
    needsFit.current = false;
    fit();
    // A layout switch changes the box size, which runs this again.
  }, [size, natural]);

  useEffect(() => {
    if (!focusPixel || !size || !natural) return;
    const targetScale = Math.min(MAX_SCALE, Math.max(2, Math.min(size.width / 400, size.height / 300)));
    setView({
      scale: targetScale,
      tx: size.width / 2 - (focusPixel.u + 0.5) * targetScale,
      ty: size.height / 2 - (focusPixel.v + 0.5) * targetScale,
    });
  }, [focusPixel?.token, focusPixel?.u, focusPixel?.v, size, natural]);

  /** Zoom to `scale` keeping the image point under (x, y) fixed. */
  const zoomAt = (x: number, y: number, scale: (current: number) => number) =>
    setView((v) => {
      if (!v || !size || !natural) return v;
      const minScale = Math.min(size.width / natural.width, size.height / natural.height) * 0.5;
      const next = Math.max(minScale, Math.min(MAX_SCALE, scale(v.scale)));
      return { scale: next, tx: x - ((x - v.tx) * next) / v.scale, ty: y - ((y - v.ty) * next) / v.scale };
    });

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, (s) => s * Math.exp(-e.deltaY * 0.0015));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  const toPixel = (x: number, y: number, v: View) => ({ u: (x - v.tx) / v.scale - 0.5, v: (y - v.ty) / v.scale - 0.5 });
  const toScreen = (u: number, vv: number, v: View) => ({ x: (u + 0.5) * v.scale + v.tx, y: (vv + 0.5) * v.scale + v.ty });
  const local = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Projected LiDAR points, coloured by range (red near → blue far).
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.width * dpr);
    c.height = Math.round(size.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (!view) return;
    if (overlay) {
      for (let i = 0; i < overlay.length; i += 3) {
        const p = toScreen(overlay[i], overlay[i + 1], view);
        if (p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height) continue;
        const t = Math.min(1, overlay[i + 2] / 20);
        ctx.fillStyle = `hsl(${Math.round(240 * t)}, 100%, 55%)`;
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }
    if (model) {
      const centre = toScreen(model.cx, model.cy, view);
      ctx.strokeStyle = "rgba(255, 224, 64, 0.8)";
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, model.validRadiusPx * view.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(centre.x - 8, centre.y);
      ctx.lineTo(centre.x + 8, centre.y);
      ctx.moveTo(centre.x, centre.y - 8);
      ctx.lineTo(centre.x, centre.y + 8);
      ctx.stroke();
    }
  }, [overlay, model, view, size]);

  const url = image.file ? runImageUrl(runId, image.file) : null;

  return (
    <div className={`corr-viewer ${layout}`}>
      <div className="corr-viewer-header">{header}</div>
      <div
        ref={box}
        className={`corr-viewer-image ${canPick ? "pickable" : ""}`}
        onPointerDown={(e) => {
          if (e.button !== 0 || !view) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = local(e);
          drag.current = { ...p, view, moved: false };
        }}
        onPointerMove={(e) => {
          if (!view) return;
          const p = local(e);
          setHover(toPixel(p.x, p.y, view));
          const d = drag.current;
          if (!d) return;
          if (Math.hypot(p.x - d.x, p.y - d.y) > CLICK_TOLERANCE_PX) d.moved = true;
          if (d.moved) setView({ ...d.view, tx: d.view.tx + p.x - d.x, ty: d.view.ty + p.y - d.y });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved || !view || !canPick || !natural || !onPick) return;
          const q = local(e);
          const p = toPixel(q.x, q.y, view);
          if (p.u < -0.5 || p.v < -0.5 || p.u > natural.width - 0.5 || p.v > natural.height - 0.5) return;
          onPick(Math.round(p.u * 100) / 100, Math.round(p.v * 100) / 100);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {url && (
          <img
            src={url}
            alt={`${channel}, sequence ${event.sequence}`}
            draggable={false}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            style={
              view && natural
                ? {
                    width: natural.width,
                    height: natural.height,
                    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
                    imageRendering: view.scale > 2 ? "pixelated" : "auto",
                  }
                : { visibility: "hidden" }
            }
          />
        )}
        <canvas ref={canvas} />
        {view && (
          <svg>
            {markers.map((m) => {
              const o = toScreen(m.u, m.v, view);
              const p = m.predicted && toScreen(m.predicted.u, m.predicted.v, view);
              return (
                <g key={m.id} className={`marker${m.active ? " active" : ""}${m.kind ? ` ${m.kind}` : ""}`}>
                  {p && (
                    <>
                      <line x1={o.x} y1={o.y} x2={p.x} y2={p.y} className="residual" />
                      <path d={`M${p.x - 5},${p.y - 5}L${p.x + 5},${p.y + 5}M${p.x - 5},${p.y + 5}L${p.x + 5},${p.y - 5}`} className="predicted" />
                    </>
                  )}
                  <circle cx={o.x} cy={o.y} r={6} />
                  <circle cx={o.x} cy={o.y} r={1.2} className="dot" />
                  <text x={o.x + 8} y={o.y - 8}>
                    {m.label}
                  </text>
                </g>
              );
            })}
            {pending &&
              (() => {
                const p = toScreen(pending.u, pending.v, view);
                return (
                  <path
                    className="pending"
                    d={`M${p.x - 16},${p.y}H${p.x - 4}M${p.x + 4},${p.y}H${p.x + 16}M${p.x},${p.y - 16}V${p.y - 4}M${p.x},${p.y + 4}V${p.y + 16}`}
                  />
                );
              })()}
          </svg>
        )}
      </div>
      <div className="corr-viewer-footer">
        <span>
          {hover && natural && hover.u >= -0.5 && hover.v >= -0.5 && hover.u <= natural.width - 0.5 && hover.v <= natural.height - 0.5
            ? `u ${hover.u.toFixed(1)}, v ${hover.v.toFixed(1)} px`
            : "—"}
          {view && ` · zoom ${Math.round(view.scale * 100)}%`}
        </span>
        <span className={nameOk && sizeOk ? "check ok" : natural ? "check bad" : "check"}>
          {!nameOk
            ? "⚠ file name doesn't match this event: picking disabled"
            : !natural
              ? "loading full resolution…"
              : sizeOk
                ? `✓ ${natural.width}×${natural.height} as recorded${onPick ? "" : " · display only"}`
                : `⚠ ${natural.width}×${natural.height}, expected ${image.width}×${image.height}: picking disabled`}
        </span>
        <span className="zoom-buttons">
          <button onClick={fit}>Fit</button>
          {[1, 4].map((s) => (
            <button key={s} onClick={() => size && zoomAt(size.width / 2, size.height / 2, () => s)}>
              {s * 100}%
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
