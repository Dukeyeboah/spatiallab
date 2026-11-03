import type { FloorPlanAnchor, FloorPlanAffine, FloorPlanSimilarity, FloorPlanTransform } from "./floorPlanTypes";

export type WorldXZ = { x: number; z: number };
export type ImageUv = { u: number; v: number };

/** Apply saved transform: world XZ → normalized image UV. */
export function worldToPlanUv(t: FloorPlanTransform, x: number, z: number): ImageUv {
  if (t.kind === "similarity") {
    const c = Math.cos(t.rotation);
    const s = Math.sin(t.rotation);
    const xr = t.scale * (c * x - s * z);
    const zr = t.scale * (s * x + c * z);
    return { u: xr + t.tx, v: zr + t.ty };
  }
  return {
    u: t.a * x + t.b * z + t.c,
    v: t.d * x + t.e * z + t.f,
  };
}

/** Inverse for similarity only (used when placing provisional world from UV — rare). */
export function planUvToWorld(t: FloorPlanSimilarity, u: number, v: number): WorldXZ {
  const dx = u - t.tx;
  const dy = v - t.ty;
  const invS = 1 / Math.max(1e-9, t.scale);
  const c = Math.cos(-t.rotation);
  const s = Math.sin(-t.rotation);
  const xr = dx * invS;
  const zr = dy * invS;
  return { x: c * xr - s * zr, z: s * xr + c * zr };
}

function residualsFor(
  anchors: FloorPlanAnchor[],
  project: (x: number, z: number) => ImageUv,
): { residuals: Record<string, number>; rms: number } {
  const residuals: Record<string, number> = {};
  let sum = 0;
  for (const a of anchors) {
    const p = project(a.worldX, a.worldZ);
    const du = p.u - a.u;
    const dv = p.v - a.v;
    // Approximate pixel-free error as fraction of image diagonal (~1.4)
    const err = Math.hypot(du, dv);
    residuals[a.id] = err;
    sum += err * err;
  }
  return { residuals, rms: Math.sqrt(sum / Math.max(1, anchors.length)) };
}

/**
 * Fit similarity transform (uniform scale + rotation + translation) world→UV.
 * Needs ≥2 anchors; ≥3 recommended for residual checks.
 */
export function fitSimilarity(anchors: FloorPlanAnchor[]): FloorPlanSimilarity | { error: string } {
  if (anchors.length < 2) return { error: "Need at least 2 anchors for similarity alignment." };

  const n = anchors.length;
  let mx = 0;
  let mz = 0;
  let mu = 0;
  let mv = 0;
  for (const a of anchors) {
    mx += a.worldX;
    mz += a.worldZ;
    mu += a.u;
    mv += a.v;
  }
  mx /= n;
  mz /= n;
  mu /= n;
  mv /= n;

  let sxx = 0;
  let sxz = 0;
  let sux = 0;
  let suz = 0;
  let svx = 0;
  let svz = 0;
  let varW = 0;
  for (const a of anchors) {
    const x = a.worldX - mx;
    const z = a.worldZ - mz;
    const u = a.u - mu;
    const v = a.v - mv;
    sxx += x * x;
    sxz += z * z;
    varW += x * x + z * z;
    sux += u * x;
    suz += u * z;
    svx += v * x;
    svz += v * z;
  }
  if (varW < 1e-12) return { error: "Anchors are too close in world space — spread them across rooms." };

  // Kabsch-style 2D: R that maps world deltas → image deltas
  // Cross-covariance
  const h00 = sux;
  const h01 = suz;
  const h10 = svx;
  const h11 = svz;
  const theta = Math.atan2(h10 - h01, h00 + h11);
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  let num = 0;
  let den = 0;
  for (const a of anchors) {
    const x = a.worldX - mx;
    const z = a.worldZ - mz;
    const rx = c * x - s * z;
    const rz = s * x + c * z;
    const u = a.u - mu;
    const v = a.v - mv;
    num += rx * u + rz * v;
    den += rx * rx + rz * rz;
  }
  const scale = den > 1e-12 ? num / den : 1;
  if (!(scale > 1e-8)) return { error: "Degenerate scale — check that image clicks match the 3D points." };

  const tx = mu - scale * (c * mx - s * mz);
  const ty = mv - scale * (s * mx + c * mz);

  const draft: FloorPlanSimilarity = { kind: "similarity", rotation: theta, scale, tx, ty };
  const { residuals, rms } = residualsFor(anchors, (x, z) => worldToPlanUv(draft, x, z));
  return { ...draft, residuals, rms };
}

/** Optional affine (nonuniform). Use only when similarity residuals stay large. */
export function fitAffine(anchors: FloorPlanAnchor[]): FloorPlanAffine | { error: string } {
  if (anchors.length < 3) return { error: "Affine fit needs at least 3 anchors." };
  // Solve least squares for u and v rows separately via normal equations 3 unknowns.
  const solveRow = (getY: (a: FloorPlanAnchor) => number) => {
    // X^T X β = X^T y ; columns [x, z, 1]
    let a00 = 0;
    let a01 = 0;
    let a02 = 0;
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (const p of anchors) {
      const x = p.worldX;
      const z = p.worldZ;
      const y = getY(p);
      a00 += x * x;
      a01 += x * z;
      a02 += x;
      a11 += z * z;
      a12 += z;
      a22 += 1;
      b0 += x * y;
      b1 += z * y;
      b2 += y;
    }
    // 3x3 solve
    const A = [
      [a00, a01, a02],
      [a01, a11, a12],
      [a02, a12, a22],
    ];
    const B = [b0, b1, b2];
    return solve3(A, B);
  };
  const urow = solveRow((a) => a.u);
  const vrow = solveRow((a) => a.v);
  if (!urow || !vrow) return { error: "Affine solve failed (singular)." };
  const draft: FloorPlanAffine = {
    kind: "affine",
    a: urow[0],
    b: urow[1],
    c: urow[2],
    d: vrow[0],
    e: vrow[1],
    f: vrow[2],
    warning: "Affine allows nonuniform scale/shear — use only if the plan is distorted vs the scan.",
  };
  const { residuals, rms } = residualsFor(anchors, (x, z) => worldToPlanUv(draft, x, z));
  return { ...draft, residuals, rms };
}

function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  const n = 3;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

export function alignmentQuality(t: FloorPlanTransform | null, anchorCount: number): {
  ok: boolean;
  message: string;
} {
  if (!t) return { ok: false, message: "No alignment yet — add ≥3 well-spaced anchors." };
  if (anchorCount < 2) return { ok: false, message: "Underdetermined — need more anchors." };
  if (anchorCount < 3) return { ok: false, message: "Weak — add a third anchor in another room." };
  const rms = t.rms ?? 1;
  // RMS in normalized UV; ~0.02 ≈ 2% of image
  if (rms > 0.08) return { ok: false, message: `Large residuals (RMS ${(rms * 100).toFixed(1)}% of image) — recheck anchors.` };
  if (rms > 0.035) return { ok: true, message: `Usable with caution (RMS ${(rms * 100).toFixed(1)}%).` };
  return { ok: true, message: `Good alignment (RMS ${(rms * 100).toFixed(1)}% of image).` };
}
