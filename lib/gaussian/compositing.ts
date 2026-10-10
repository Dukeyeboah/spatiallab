import * as THREE from "three";
import { LOW_PASS_PX2, MIN_DEPTH } from "./gaussianMath";

/**
 * Lab 7B: the per-frame math for many Gaussians.
 *
 * The formulas are exactly Lab 6's (`gaussianMath.ts`): Sigma3D = R S S^T R^T
 * and Sigma2D = J W Sigma3D W^T J^T, with the same low-pass term and clamps.
 * The difference is bookkeeping: these versions write into reusable objects
 * instead of allocating matrices, so hundreds of Gaussians can be projected
 * every frame without feeding the garbage collector. A unit test checks that
 * both versions produce the same numbers.
 */

/** Quad half-size in standard deviations (as Lab 6's default support). */
export const SUPPORT_SIGMAS = 3;
/** Alpha is capped below 1 (as in 3D Gaussian splatting), so light always leaks through a little. */
export const MAX_ALPHA = 0.99;
/** Contributions weaker than one 8-bit step are skipped (also as in 3D Gaussian splatting). */
export const MIN_ALPHA = 1 / 255;
/** Same clamp as Lab 6: footprint sigmas longer than 2 viewports / 3 are shortened. */
const MAX_FOOTPRINT_VIEWPORTS = 2;

// ---------------------------------------------------------------------------
// Camera, once per frame
// ---------------------------------------------------------------------------

export type FrameCamera = {
  /** World -> camera matrix, column-major (three.js `elements`). */
  view: number[];
  /** Camera -> clip matrix, column-major. */
  projection: number[];
  /** Focal length in pixels (vertical fov, square pixels). */
  focal: number;
  /** Limits on x/d and y/d, as in Lab 6 (1.3x the visible field). */
  limitX: number;
  limitY: number;
  width: number;
  height: number;
  maxSigmaPx: number;
};

export function frameCamera(
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
): FrameCamera {
  camera.updateMatrixWorld();
  const tanHalfFovY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  return {
    view: camera.matrixWorldInverse.elements,
    projection: camera.projectionMatrix.elements,
    focal: viewport.height / 2 / tanHalfFovY,
    limitX: 1.3 * tanHalfFovY * camera.aspect,
    limitY: 1.3 * tanHalfFovY,
    width: viewport.width,
    height: viewport.height,
    maxSigmaPx: (MAX_FOOTPRINT_VIEWPORTS * Math.max(viewport.width, viewport.height)) / 3,
  };
}

// ---------------------------------------------------------------------------
// 1. 3D covariance from scale + rotation
// ---------------------------------------------------------------------------

/** Symmetric 3x3 matrix stored as its 6 unique entries [xx, xy, xz, yy, yz, zz]. */
export type Covariance3 = Float64Array;

export function newCovariance3(): Covariance3 {
  return new Float64Array(6);
}

/**
 * Sigma3D = M M^T with M = R S (R from the unit quaternion, S = diag(scale)).
 * Column k of M is the Gaussian's k-th axis in world space, scaled by its sigma.
 */
export function covarianceFromScaleRotation(
  sx: number,
  sy: number,
  sz: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  out: Covariance3,
): Covariance3 {
  // Rotation matrix of a unit quaternion (row r, column c).
  const r00 = 1 - 2 * (qy * qy + qz * qz);
  const r01 = 2 * (qx * qy - qz * qw);
  const r02 = 2 * (qx * qz + qy * qw);
  const r10 = 2 * (qx * qy + qz * qw);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qx * qw);
  const r20 = 2 * (qx * qz - qy * qw);
  const r21 = 2 * (qy * qz + qx * qw);
  const r22 = 1 - 2 * (qx * qx + qy * qy);

  // M = R S: scale each column.
  const m00 = r00 * sx, m01 = r01 * sy, m02 = r02 * sz;
  const m10 = r10 * sx, m11 = r11 * sy, m12 = r12 * sz;
  const m20 = r20 * sx, m21 = r21 * sy, m22 = r22 * sz;

  // Sigma = M M^T: entry (r, c) is the dot product of rows r and c of M.
  out[0] = m00 * m00 + m01 * m01 + m02 * m02;
  out[1] = m00 * m10 + m01 * m11 + m02 * m12;
  out[2] = m00 * m20 + m01 * m21 + m02 * m22;
  out[3] = m10 * m10 + m11 * m11 + m12 * m12;
  out[4] = m10 * m20 + m11 * m21 + m12 * m22;
  out[5] = m20 * m20 + m21 * m21 + m22 * m22;
  return out;
}

// ---------------------------------------------------------------------------
// 2. Projection to a screen-space splat
// ---------------------------------------------------------------------------

/** One projected Gaussian: everything the shader and the probe need. */
export type Splat = {
  /** Distance in front of the camera (metres): the sort key. */
  depth: number;
  /** Centre in clip space (x, y, z, w). */
  clip: Float64Array;
  /** Centre in pixels from the screen centre (x right, y up). */
  centerPx: Float64Array;
  /** Quad half-axes in pixels: major (x, y) then minor (x, y), each = direction * SUPPORT_SIGMAS * sigma. */
  axesPx: Float64Array;
  /** Inverse 2D covariance [a, b, c] in 1/pixels^2. */
  conic: Float64Array;
};

export function newSplat(): Splat {
  return {
    depth: 0,
    clip: new Float64Array(4),
    centerPx: new Float64Array(2),
    axesPx: new Float64Array(4),
    conic: new Float64Array(3),
  };
}

/**
 * Lab 6's projectGaussian, written out by hand. Returns false (and leaves
 * `out` partly filled) when the Gaussian is behind or too close to the camera.
 */
export function projectSplat(
  px: number,
  py: number,
  pz: number,
  sigma: Covariance3,
  cam: FrameCamera,
  out: Splat,
): boolean {
  const v = cam.view;

  // Centre in camera space; the camera looks down -Z, so depth = -z.
  const tx = v[0] * px + v[4] * py + v[8] * pz + v[12];
  const ty = v[1] * px + v[5] * py + v[9] * pz + v[13];
  const tz = v[2] * px + v[6] * py + v[10] * pz + v[14];
  const depth = -tz;
  out.depth = depth;
  if (depth < MIN_DEPTH) return false;

  // Jacobian of the perspective projection at the centre (see gaussianMath.ts).
  const x = THREE.MathUtils.clamp(tx / depth, -cam.limitX, cam.limitX) * depth;
  const y = THREE.MathUtils.clamp(ty / depth, -cam.limitY, cam.limitY) * depth;
  const f = cam.focal;
  const j00 = f / depth;
  const j02 = (f * x) / (depth * depth);
  const j11 = f / depth;
  const j12 = (f * y) / (depth * depth);

  // T = J W, where W[r][c] = v[c * 4 + r] (rotation part of the view matrix).
  const t00 = j00 * v[0] + j02 * v[2];
  const t01 = j00 * v[4] + j02 * v[6];
  const t02 = j00 * v[8] + j02 * v[10];
  const t10 = j11 * v[1] + j12 * v[2];
  const t11 = j11 * v[5] + j12 * v[6];
  const t12 = j11 * v[9] + j12 * v[10];

  // Sigma2D = T Sigma3D T^T.
  const [sxx, sxy, sxz, syy, syz, szz] = sigma;
  const u0 = sxx * t00 + sxy * t01 + sxz * t02; // (Sigma T0^T)
  const u1 = sxy * t00 + syy * t01 + syz * t02;
  const u2 = sxz * t00 + syz * t01 + szz * t02;
  const w0 = sxx * t10 + sxy * t11 + sxz * t12; // (Sigma T1^T)
  const w1 = sxy * t10 + syy * t11 + syz * t12;
  const w2 = sxz * t10 + syz * t11 + szz * t12;
  const a = t00 * u0 + t01 * u1 + t02 * u2 + LOW_PASS_PX2;
  const b = (t00 * w0 + t01 * w1 + t02 * w2 + (t10 * u0 + t11 * u1 + t12 * u2)) / 2;
  const c = t10 * w0 + t11 * w1 + t12 * w2 + LOW_PASS_PX2;

  // Ellipse axes: eigen-decomposition of [[a, b], [b, c]].
  const mid = (a + c) / 2;
  const radius = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  const sigmaMajor = Math.min(Math.sqrt(mid + radius), cam.maxSigmaPx);
  const sigmaMinor = Math.min(Math.sqrt(Math.max(mid - radius, 1e-6)), cam.maxSigmaPx);
  const angle = 0.5 * Math.atan2(2 * b, a - c);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out.axesPx[0] = cos * SUPPORT_SIGMAS * sigmaMajor;
  out.axesPx[1] = sin * SUPPORT_SIGMAS * sigmaMajor;
  out.axesPx[2] = -sin * SUPPORT_SIGMAS * sigmaMinor;
  out.axesPx[3] = cos * SUPPORT_SIGMAS * sigmaMinor;

  const det = a * c - b * b;
  out.conic[0] = c / det;
  out.conic[1] = -b / det;
  out.conic[2] = a / det;

  // Clip-space centre = projection * (camera-space centre).
  const p = cam.projection;
  out.clip[0] = p[0] * tx + p[4] * ty + p[8] * tz + p[12];
  out.clip[1] = p[1] * tx + p[5] * ty + p[9] * tz + p[13];
  out.clip[2] = p[2] * tx + p[6] * ty + p[10] * tz + p[14];
  out.clip[3] = p[3] * tx + p[7] * ty + p[11] * tz + p[15];
  out.centerPx[0] = ((out.clip[0] / out.clip[3]) * cam.width) / 2;
  out.centerPx[1] = ((out.clip[1] / out.clip[3]) * cam.height) / 2;
  return true;
}

/**
 * The alpha one splat contributes at a pixel, computed exactly as the fragment
 * shader does: zero outside its quad or its support ellipse, otherwise
 * opacity * exp(-0.5 * d^T conic d), capped at MAX_ALPHA, dropped below MIN_ALPHA.
 *
 * (dx, dy): pixel position relative to the screen centre, y up.
 */
export function splatAlphaAt(splat: Splat, opacity: number, dx: number, dy: number): number {
  const ox = dx - splat.centerPx[0];
  const oy = dy - splat.centerPx[1];

  // Inside the quad? Its half-axes are perpendicular, so each corner coordinate
  // is the projection onto that axis divided by the axis length squared.
  const [ax, ay, bx, by] = splat.axesPx;
  if (Math.abs(ox * ax + oy * ay) > ax * ax + ay * ay) return 0;
  if (Math.abs(ox * bx + oy * by) > bx * bx + by * by) return 0;

  const [ca, cb, cc] = splat.conic;
  const mahalanobis2 = ca * ox * ox + 2 * cb * ox * oy + cc * oy * oy;
  if (mahalanobis2 > SUPPORT_SIGMAS * SUPPORT_SIGMAS) return 0;
  const alpha = Math.min(MAX_ALPHA, opacity * Math.exp(-0.5 * mahalanobis2));
  return alpha < MIN_ALPHA ? 0 : alpha;
}

// ---------------------------------------------------------------------------
// 3. Front-to-back compositing at one pixel
// ---------------------------------------------------------------------------

export type Contribution = {
  /** Index into the scene's Gaussian list. */
  index: number;
  depth: number;
  /** This Gaussian's alpha at the pixel. */
  alpha: number;
  /** Transmittance before this Gaussian: the fraction of light that gets past everything drawn before it. */
  transmittanceBefore: number;
  /** Its share of the final colour: transmittanceBefore * alpha. */
  weight: number;
};

/**
 * C = sum_i  c_i * alpha_i * T_i,   T_i = product_{j < i} (1 - alpha_j)
 * pixel = C + T_final * background
 *
 * `order` is the drawing order. With nearest-first order this is correct
 * front-to-back compositing; with any other order it is still the same
 * formula, just fed the wrong sequence (Lab 7B's "reversed" mode).
 */
export function compositePixel(
  order: ArrayLike<number>,
  count: number,
  splats: Splat[],
  opacities: ArrayLike<number>,
  colors: ArrayLike<number>,
  background: readonly [number, number, number],
  dx: number,
  dy: number,
): { contributions: Contribution[]; transmittance: number; color: [number, number, number] } {
  const contributions: Contribution[] = [];
  const color: [number, number, number] = [0, 0, 0];
  let transmittance = 1;
  for (let k = 0; k < count; k++) {
    const i = order[k];
    const alpha = splatAlphaAt(splats[i], opacities[i], dx, dy);
    if (alpha === 0) continue;
    const weight = transmittance * alpha;
    color[0] += weight * colors[i * 3];
    color[1] += weight * colors[i * 3 + 1];
    color[2] += weight * colors[i * 3 + 2];
    contributions.push({ index: i, depth: splats[i].depth, alpha, transmittanceBefore: transmittance, weight });
    transmittance *= 1 - alpha;
  }
  for (let ch = 0; ch < 3; ch++) color[ch] += transmittance * background[ch];
  return { contributions, transmittance, color };
}
