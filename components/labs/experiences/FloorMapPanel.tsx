"use client";

import { CheckpointIcon } from "@/components/labs/experiences/CheckpointIcon";
import type { MapPolyline } from "@/lib/labs/experiences/collisionMapOutline";
import { DEFAULT_CHECKPOINT_ICON, type CheckpointIconId } from "@/lib/labs/experiences/checkpointIcons";
import { worldToPlanUv } from "@/lib/labs/experiences/floorPlanAlign";
import type { FloorPlanRoom, FloorPlanTransform } from "@/lib/labs/experiences/floorPlanTypes";
import { worldToUv } from "@/lib/labs/experiences/mapCoords";
import type { ExperienceFloor, ExperienceViewpoint, Vec3Tuple } from "@/lib/labs/experiences/types";

export { worldToUv };

type Props = {
  floor: ExperienceFloor | null;
  viewpoints: ExperienceViewpoint[];
  outlines?: MapPolyline[];
  /** Aligned floor-plan image (object URL or public path). */
  planImageUrl?: string | null;
  planTransform?: FloorPlanTransform | null;
  rooms?: FloorPlanRoom[];
  cameraPos: Vec3Tuple | null;
  yaw: number | null;
  activeViewpointId?: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSelectViewpoint: (vp: ExperienceViewpoint) => void;
  onSelectRoom?: (room: FloorPlanRoom) => void;
};

function projectAligned(
  transform: FloorPlanTransform,
  x: number,
  z: number,
): { u: number; v: number; inBounds: boolean } {
  const p = worldToPlanUv(transform, x, z);
  const inBounds = p.u >= -0.02 && p.u <= 1.02 && p.v >= -0.02 && p.v <= 1.02;
  return {
    u: Math.min(1.05, Math.max(-0.05, p.u)),
    v: Math.min(1.05, Math.max(-0.05, p.v)),
    inBounds,
  };
}

/** Map heading: camera yaw in XZ + similarity plan rotation (so arrow matches the drawn plan). */
function mapHeadingDeg(yaw: number | null, transform: FloorPlanTransform | null | undefined): number {
  const yawDeg = -((yaw ?? 0) * 180) / Math.PI;
  if (transform?.kind === "similarity") {
    return yawDeg + (transform.rotation * 180) / Math.PI;
  }
  // Affine: approximate heading from local XZ → UV Jacobian column for forward (-Z)
  if (transform?.kind === "affine") {
    const du = -transform.b;
    const dv = -transform.e;
    return (Math.atan2(du, -dv) * 180) / Math.PI + yawDeg;
  }
  return yawDeg;
}

/**
 * Expandable 2D map — uploaded/aligned plan when available, else AABB + collision guides.
 *
 * Important: never project world→AABB UV onto a floor-plan *image* before alignment —
 * those UVs are a different coordinate system and look “flipped” (e.g. Entrance → Room 3).
 */
export function FloorMapPanel({
  floor,
  viewpoints,
  outlines = [],
  planImageUrl,
  planTransform,
  rooms = [],
  cameraPos,
  yaw,
  activeViewpointId,
  expanded,
  onToggle,
  onSelectViewpoint,
  onSelectRoom,
}: Props) {
  if (!floor) {
    return (
      <button type="button" className="exp-map-toggle" onClick={onToggle} disabled title="No floor map for this scene">
        Map
      </button>
    );
  }

  const usePlan = !!planImageUrl;
  const aligned = usePlan && !!planTransform;
  /** Only show live position / projected checkpoints when we have a real world↔plan transform, or when using the AABB sketch (no plan image). */
  const canProject = aligned || !usePlan;

  const you =
    canProject && cameraPos
      ? aligned
        ? projectAligned(planTransform!, cameraPos[0], cameraPos[2])
        : { ...worldToUv(cameraPos[0], cameraPos[2], floor.worldBounds), inBounds: true }
      : null;

  return (
    <div className={`exp-map${expanded ? " open" : ""}`}>
      <button type="button" className="exp-map-toggle" onClick={onToggle}>
        {expanded ? "Hide floor plan" : "Floor plan"}
      </button>
      {expanded && (
        <div className="exp-map-body" role="img" aria-label={`${floor.name} map`}>
          <div className="exp-map-canvas">
            {usePlan ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={planImageUrl!} alt="" className="exp-map-img" />
            ) : (
              <svg className="exp-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <rect width="100" height="100" className="exp-map-bg" />
                <path d="M6 6 H94 V94 H6 Z" className="exp-map-outline" />
                {outlines.map((line, i) => {
                  if (line.points.length < 2) return null;
                  const d = line.points.map((p, j) => `${j === 0 ? "M" : "L"} ${p.u * 100} ${p.v * 100}`).join(" ");
                  return <path key={`wall-${i}`} d={d} className="exp-map-wall" />;
                })}
              </svg>
            )}

            {!aligned && usePlan && (
              <div className="exp-map-unaligned">
                Plan shown for reference — markers stay off until you finish Dev alignment (otherwise Entrance would sit in the wrong room).
              </div>
            )}

            {aligned &&
              rooms.map((room) => {
                if (room.polygon.length < 3) return null;
                return (
                  <button
                    key={room.id}
                    type="button"
                    className="exp-map-room"
                    style={{
                      clipPath: `polygon(${room.polygon.map((p) => `${p.u * 100}% ${p.v * 100}%`).join(",")})`,
                    }}
                    title={room.name}
                    onClick={() => onSelectRoom?.(room)}
                  >
                    <span className="exp-map-room-label">{room.name}</span>
                  </button>
                );
              })}

            {canProject &&
              viewpoints.map((vp) => {
                const uv = aligned
                  ? projectAligned(planTransform!, vp.position[0], vp.position[2])
                  : {
                      ...(vp.mapUv ?? worldToUv(vp.position[0], vp.position[2], floor.worldBounds)),
                      inBounds: true,
                    };
                if (aligned && !uv.inBounds) return null;
                const icon = (vp.icon as CheckpointIconId) || DEFAULT_CHECKPOINT_ICON;
                const active = vp.id === activeViewpointId;
                return (
                  <button
                    key={vp.id}
                    type="button"
                    className={`exp-map-cp${active ? " active" : ""}`}
                    style={{ left: `${uv.u * 100}%`, top: `${uv.v * 100}%` }}
                    title={vp.name}
                    onClick={() => onSelectViewpoint(vp)}
                  >
                    <CheckpointIcon id={icon} />
                  </button>
                );
              })}

            {you && you.inBounds && (
              <div
                className="exp-map-you"
                style={{
                  left: `${you.u * 100}%`,
                  top: `${you.v * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${mapHeadingDeg(yaw, planTransform)}deg)`,
                }}
                title="You are here"
              >
                <span className="exp-map-you-ring" />
                <span className="exp-map-you-arrow" />
              </div>
            )}
            {you && !you.inBounds && (
              <div className="exp-map-offmap" title="Outside mapped area">
                Off map
              </div>
            )}
          </div>
          <div className="exp-map-hint">
            {usePlan
              ? aligned
                ? "Aligned plan · icons = checkpoints · chevron = you"
                : "Not aligned yet — open Dev → Floor plans (do not trust marker positions on this image)"
              : "Icons = checkpoints · chevron = you · lines ≈ walls"}
          </div>
        </div>
      )}
    </div>
  );
}
