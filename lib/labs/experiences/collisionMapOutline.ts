import { worldToUv } from "./mapCoords";
import type { ExperienceFloor } from "./types";

export type MapPolyline = { points: { u: number; v: number }[] };

type CollisionMesh = {
  vertices: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  faceCount: number;
};

/**
 * Build approximate wall footprints for the 2D map from LCC collision meshes.
 * Takes a horizontal slice near floor height and projects edges to UV.
 * Coarse guide only — real floor plans can replace this later.
 */
export function buildCollisionMapOutline(
  meshes: CollisionMesh[] | null | undefined,
  floor: ExperienceFloor,
  opts?: { sliceY?: number; sliceThickness?: number; maxSegments?: number },
): MapPolyline[] {
  if (!meshes?.length) return [];
  const sliceY = opts?.sliceY ?? 0.35;
  const thick = opts?.sliceThickness ?? 1.4;
  const maxSegments = opts?.maxSegments ?? 400;
  const y0 = sliceY - thick * 0.5;
  const y1 = sliceY + thick * 0.5;
  const segs: { x0: number; z0: number; x1: number; z1: number }[] = [];

  for (const mesh of meshes) {
    const { vertices: v, indices: idx, faceCount } = mesh;
    const faces = Math.min(faceCount, Math.floor(idx.length / 3));
    for (let f = 0; f < faces; f++) {
      const i0 = idx[f * 3] * 3;
      const i1 = idx[f * 3 + 1] * 3;
      const i2 = idx[f * 3 + 2] * 3;
      const tri = [
        { x: v[i0], y: v[i0 + 1], z: v[i0 + 2] },
        { x: v[i1], y: v[i1 + 1], z: v[i1 + 2] },
        { x: v[i2], y: v[i2 + 1], z: v[i2 + 2] },
      ];
      // Vertical-ish edges (walls): large |dy|, project XZ endpoints
      for (let e = 0; e < 3; e++) {
        const a = tri[e];
        const b = tri[(e + 1) % 3];
        const dy = Math.abs(a.y - b.y);
        const dxz = Math.hypot(a.x - b.x, a.z - b.z);
        if (dy < 0.35 || dxz > 0.15) continue;
        // Keep if the edge spans or sits near the slice band
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        if (maxY < y0 || minY > y1 + 1.2) continue;
        segs.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z });
        if (segs.length >= maxSegments) break;
      }
      if (segs.length >= maxSegments) break;
    }
    if (segs.length >= maxSegments) break;
  }

  // Quantize + dedupe short segments into polylines (each segment as its own line for simplicity)
  const out: MapPolyline[] = [];
  const seen = new Set<string>();
  for (const s of segs) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    if (len < 0.02 || len > 8) continue;
    const p0 = worldToUv(s.x0, s.z0, floor.worldBounds);
    const p1 = worldToUv(s.x1, s.z1, floor.worldBounds);
    const key = `${(p0.u * 200) | 0},${(p0.v * 200) | 0}-${(p1.u * 200) | 0},${(p1.v * 200) | 0}`;
    const keyR = `${(p1.u * 200) | 0},${(p1.v * 200) | 0}-${(p0.u * 200) | 0},${(p0.v * 200) | 0}`;
    if (seen.has(key) || seen.has(keyR)) continue;
    seen.add(key);
    out.push({ points: [p0, p1] });
  }
  return out;
}
