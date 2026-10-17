"use client";

import type { ExperienceFloor, ExperienceViewpoint, Vec3Tuple } from "@/lib/labs/experiences/types";

type Props = {
  floor: ExperienceFloor | null;
  viewpoints: ExperienceViewpoint[];
  /** Current camera eye in Three.js world. */
  cameraPos: Vec3Tuple | null;
  /** Horizontal look yaw (radians, Three YXZ). */
  yaw: number | null;
  expanded: boolean;
  onToggle: () => void;
  onSelectViewpoint: (vp: ExperienceViewpoint) => void;
};

function worldToUv(
  x: number,
  z: number,
  b: ExperienceFloor["worldBounds"],
): { u: number; v: number } {
  const u = (x - b.minX) / Math.max(1e-6, b.maxX - b.minX);
  const v = 1 - (z - b.minZ) / Math.max(1e-6, b.maxZ - b.minZ);
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
}

/**
 * Expandable 2D floor map — manual worldBounds + viewpoint mapUv / projection.
 * Does not use LCC getBounds() as the plan extent.
 */
export function FloorMapPanel({ floor, viewpoints, cameraPos, yaw, expanded, onToggle, onSelectViewpoint }: Props) {
  if (!floor) {
    return (
      <button type="button" className="exp-map-toggle" onClick={onToggle} disabled title="No floor map for this scene">
        Map
      </button>
    );
  }

  const markers = viewpoints.filter((vp) => vp.mapUv || floor);
  const you = cameraPos ? worldToUv(cameraPos[0], cameraPos[2], floor.worldBounds) : null;

  return (
    <div className={`exp-map${expanded ? " open" : ""}`}>
      <button type="button" className="exp-map-toggle" onClick={onToggle}>
        {expanded ? "Hide map" : "Floor map"}
      </button>
      {expanded && (
        <div className="exp-map-body" role="img" aria-label={`${floor.name} map`}>
          <div className="exp-map-canvas">
            {floor.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={floor.imageUrl} alt="" className="exp-map-img" />
            ) : (
              <svg className="exp-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <rect width="100" height="100" className="exp-map-bg" />
                <path d="M8 8 H92 V92 H8 Z" className="exp-map-outline" />
                <text x="50" y="52" textAnchor="middle" className="exp-map-label">
                  {floor.name}
                </text>
              </svg>
            )}
            {markers.map((vp) => {
              const uv = vp.mapUv ?? worldToUv(vp.position[0], vp.position[2], floor.worldBounds);
              return (
                <button
                  key={vp.id}
                  type="button"
                  className="exp-map-marker"
                  style={{ left: `${uv.u * 100}%`, top: `${uv.v * 100}%` }}
                  title={vp.name}
                  onClick={() => onSelectViewpoint(vp)}
                />
              );
            })}
            {you && (
              <div
                className="exp-map-you"
                style={{
                  left: `${you.u * 100}%`,
                  top: `${you.v * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${-((yaw ?? 0) * 180) / Math.PI}deg)`,
                }}
                title="You"
              />
            )}
          </div>
          <div className="exp-map-hint">Click a pin to go there · arrow ≈ your facing</div>
        </div>
      )}
    </div>
  );
}
