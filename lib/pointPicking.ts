import * as THREE from "three";
import type { Vec3 } from "@/lib/datasets";

/**
 * Lab 13U: picking a 3D position in a rendered point cloud.
 *
 * Points have no surface to hit, so the click is resolved in screen space:
 * 1. Project every point (dataset coordinates) with the current camera and
 *    keep those within `radiusPx` of the cursor.
 * 2. Front surface: keep candidates no deeper than the nearest one plus a
 *    tolerance, so points seen through gaps behind it are ignored.
 * 3. "Nearest point" = the front candidate closest to the cursor. It is an
 *    existing scan point, but only approximately the clicked feature
 *    (points are ~1–3 cm apart in the 5M preview and drawn several px wide).
 * 4. Optional refinement: fit a plane (least squares, PCA) to the scan points
 *    within `neighbourRadiusM` of it; if the patch is planar, intersect the
 *    exact click ray with that plane ("ray ∩ local plane"). On corners and
 *    edges the patch is not planar and the refinement is refused.
 * All coordinates here are dataset coordinates (LAS − offset); the caller
 * adds the offset back before saving.
 */
export type PickOptions = { radiusPx: number; neighbourRadiusM: number };
export const DEFAULT_PICK_OPTIONS: PickOptions = { radiusPx: 8, neighbourRadiusM: 0.06 };

export type PickResult = {
  candidates: number;
  nearest: { position: Vec3; screenDistancePx: number; depthM: number };
  plane:
    | { ok: true; position: Vec3; neighbours: number; rmsM: number; shiftM: number }
    | { ok: false; reason: string; neighbours: number; rmsM: number | null };
};

/**
 * Planarity limit. Flat walls in the Basel 5M preview fit a plane with
 * ~4–6 mm rms; an ideal right-angle corner gives ≈ 0.19 × the neighbourhood
 * radius, so refuse above 0.11 × radius (at least 4 mm).
 */
const maxPlaneRms = (radius: number) => Math.max(0.004, 0.11 * radius);
const MIN_NEIGHBOURS = 12;

/**
 * @param datasetToClip projection · view · (LiDAR group world matrix)
 * @param rayDataset the click ray in dataset coordinates
 */
export function pickPoint(
  positions: Float32Array,
  count: number,
  datasetToClip: THREE.Matrix4,
  clickPx: { x: number; y: number },
  viewport: { width: number; height: number },
  rayDataset: THREE.Ray,
  options: PickOptions = DEFAULT_PICK_OPTIONS,
): PickResult | null {
  const e = datasetToClip.elements;
  const { width, height } = viewport;
  const r = options.radiusPx;
  const idx: number[] = [];
  const depth: number[] = [];
  const dist: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0.05) continue; // behind or at the camera
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) * 0.5 * width;
    const dx = sx - clickPx.x;
    if (dx > r || dx < -r) continue;
    const sy = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 * height;
    const dy = sy - clickPx.y;
    if (dy > r || dy < -r) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    idx.push(i);
    depth.push(w); // perspective camera: clip w = distance along the view axis
    dist.push(Math.sqrt(d2));
  }
  if (idx.length === 0) return null;

  const front = Math.min(...depth);
  const tolerance = Math.max(0.15, 0.02 * front);
  let best = -1;
  for (let k = 0; k < idx.length; k++) {
    if (depth[k] > front + tolerance) continue;
    if (best < 0 || dist[k] < dist[best]) best = k;
  }
  const i0 = idx[best];
  const nearest: Vec3 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];

  return {
    candidates: idx.length,
    nearest: { position: nearest, screenDistancePx: dist[best], depthM: depth[best] },
    plane: fitPlaneAndIntersect(positions, count, nearest, rayDataset, options.neighbourRadiusM),
  };
}

function fitPlaneAndIntersect(
  positions: Float32Array,
  count: number,
  centre: Vec3,
  ray: THREE.Ray,
  radius: number,
): PickResult["plane"] {
  const pts: number[] = [];
  const r2 = radius * radius;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - centre[0];
    if (dx > radius || dx < -radius) continue;
    const dy = positions[i * 3 + 1] - centre[1];
    if (dy > radius || dy < -radius) continue;
    const dz = positions[i * 3 + 2] - centre[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    pts.push(dx, dy, dz); // relative to the centre: keeps float64 sums well conditioned
  }
  const n = pts.length / 3;
  if (n < MIN_NEIGHBOURS) return { ok: false, reason: `only ${n} points within ${radius * 100} cm`, neighbours: n, rmsM: null };

  const mean = [0, 0, 0];
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) mean[a] += pts[k * 3 + a] / n;
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < n; k++)
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) cov[a][b] += ((pts[k * 3 + a] - mean[a]) * (pts[k * 3 + b] - mean[b])) / n;
  const { values, vectors } = symmetricEigen3(cov);
  const smallest = values.indexOf(Math.min(...values));
  const normal = new THREE.Vector3(vectors[0][smallest], vectors[1][smallest], vectors[2][smallest]).normalize();
  const rms = Math.sqrt(Math.max(0, values[smallest]));
  if (rms > maxPlaneRms(radius))
    return { ok: false, reason: `not planar (rms ${(rms * 1000).toFixed(0)} mm: edge, corner or clutter)`, neighbours: n, rmsM: rms };

  const point = new THREE.Vector3(centre[0] + mean[0], centre[1] + mean[1], centre[2] + mean[2]);
  const denominator = normal.dot(ray.direction);
  if (Math.abs(denominator) < 0.15) return { ok: false, reason: "surface seen almost edge-on", neighbours: n, rmsM: rms };
  const t = normal.dot(point.clone().sub(ray.origin)) / denominator;
  const hit = ray.origin.clone().addScaledVector(ray.direction, t);
  const shift = hit.distanceTo(new THREE.Vector3(...centre));
  if (t <= 0 || shift > radius * 1.5)
    return { ok: false, reason: `ray meets the plane ${(shift * 100).toFixed(0)} cm away`, neighbours: n, rmsM: rms };
  return { ok: true, position: hit.toArray() as Vec3, neighbours: n, rmsM: rms, shiftM: shift };
}

/**
 * Typical range of the nearest scan surface along a ray: the 10th percentile
 * of the ranges of points within `coneDeg` of it (null if none). Only used to
 * place the orbit target when navigating, never as a correspondence.
 */
export function surfaceRangeAlongRay(
  positions: Float32Array,
  count: number,
  origin: Vec3,
  direction: Vec3,
  coneDeg = 1.5,
  maxRangeM = 60,
): number | null {
  const d = new THREE.Vector3(...direction).normalize();
  const cos = Math.cos(THREE.MathUtils.degToRad(coneDeg));
  const ranges: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] - origin[0];
    const y = positions[i * 3 + 1] - origin[1];
    const z = positions[i * 3 + 2] - origin[2];
    const along = x * d.x + y * d.y + z * d.z;
    if (along <= 0.3 || along > maxRangeM) continue;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (along / r >= cos) ranges.push(r);
  }
  if (ranges.length < 5) return null;
  ranges.sort((a, b) => a - b);
  return ranges[Math.floor(ranges.length * 0.1)];
}

/** Jacobi eigen-decomposition of a symmetric 3×3 matrix. Columns of `vectors` are eigenvectors. */
export function symmetricEigen3(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}
