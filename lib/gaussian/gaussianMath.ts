import * as THREE from "three";

/**
 * One 3D Gaussian, the building block of Gaussian splatting.
 * All values are in three.js world space (Y-up, metres).
 */
export type Gaussian3D = {
  /** Centre (the mean, mu). */
  position: THREE.Vector3;
  /** Standard deviation along the Gaussian's own X, Y, Z axes (1 sigma, metres). */
  scale: THREE.Vector3;
  /** Orientation of those axes. */
  rotation: THREE.Quaternion;
  /** Linear RGB, 0..1. */
  color: THREE.Color;
  /** Peak opacity at the centre, 0..1. */
  opacity: number;
};

/** Symmetric 2x2 matrix [[a, b], [b, c]]. */
export type Sym2 = { a: number; b: number; c: number };

/** Below this distance in front of the camera (metres) we do not draw the Gaussian. */
export const MIN_DEPTH = 0.2;

/**
 * Added to the 2D covariance diagonal (pixels^2), as in the reference 3D Gaussian
 * splatting implementation: guarantees the footprint is at least ~1 pixel wide,
 * so a very small or very distant Gaussian never becomes a sub-pixel speck.
 */
export const LOW_PASS_PX2 = 0.3;

/** Footprint half-axes longer than this many viewport sizes are clamped. */
const MAX_FOOTPRINT_VIEWPORTS = 2;

// ---------------------------------------------------------------------------
// 1. 3D covariance
// ---------------------------------------------------------------------------

/**
 * Sigma3D = R * S * S^T * R^T
 *
 *   S = diag(scale): stretches a unit sphere into an axis-aligned ellipsoid.
 *   R = rotation matrix from the quaternion: turns that ellipsoid.
 *   M = R * S maps "unit sphere" space to the ellipsoid, and the covariance of
 *   the transformed Gaussian is M * M^T. Written that way the result is
 *   symmetric and positive semi-definite by construction.
 */
export function covariance3D(gaussian: Gaussian3D): THREE.Matrix3 {
  const R = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(gaussian.rotation),
  );
  const { x, y, z } = gaussian.scale;
  const S = new THREE.Matrix3().set(x, 0, 0, 0, y, 0, 0, 0, z);

  const M = new THREE.Matrix3().multiplyMatrices(R, S);
  const Mt = M.clone().transpose();
  return new THREE.Matrix3().multiplyMatrices(M, Mt);
}

// ---------------------------------------------------------------------------
// 2. Projection to the screen
// ---------------------------------------------------------------------------

export type ProjectedGaussian =
  | {
      visible: false;
      reason: string;
      depth: number;
    }
  | {
      visible: true;
      /** Distance in front of the camera (metres). */
      depth: number;
      /** Centre in clip space (before the perspective divide). */
      centerClip: THREE.Vector4;
      /** Sigma2D in pixels^2, x to the right, y up. */
      cov2D: Sym2;
      /** Inverse of cov2D, used by the fragment shader. */
      conic: Sym2;
      /** 1-sigma lengths of the ellipse's major/minor axes (pixels). */
      sigmaMajorPx: number;
      sigmaMinorPx: number;
      /** Major-axis direction, degrees counter-clockwise from screen +X. */
      angleDeg: number;
      /** Unit vectors of the major/minor axes on screen (x right, y up). */
      majorDir: THREE.Vector2;
      minorDir: THREE.Vector2;
      /** True when the footprint had to be clamped (Gaussian huge on screen). */
      clamped: boolean;
    };

/**
 * Sigma2D = J * W * Sigma3D * W^T * J^T
 *
 *   W: world -> camera rotation (the rotation part of the view matrix).
 *      W * Sigma3D * W^T is the same Gaussian expressed in camera axes.
 *   J: Jacobian of the perspective projection at the Gaussian's centre.
 *      Perspective is not linear, so a Gaussian does not stay exactly Gaussian.
 *      J is the best LINEAR approximation of the projection near the centre;
 *      applying it to the covariance gives the projected 2D covariance.
 *
 * Camera conventions (three.js): the camera looks down its -Z axis, +X right,
 * +Y up. A point (x, y, z) in camera space with depth d = -z lands at
 *
 *   u = fx * x / d      v = fy * y / d          (pixels from the screen centre)
 *
 * Differentiating u and v with respect to x, y, z gives
 *
 *   J = [ fx/d   0      fx*x/d^2 ]
 *       [ 0      fy/d   fy*y/d^2 ]
 *
 * (d/dz of 1/d = d/dz of 1/(-z) = 1/z^2 = 1/d^2, which is where the third
 * column comes from: moving along the view direction also slides the point
 * sideways on screen unless it is exactly in the centre.)
 */
export function projectGaussian(
  gaussian: Gaussian3D,
  sigma3D: THREE.Matrix3,
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
): ProjectedGaussian {
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse;

  // Centre in camera space.
  const t = gaussian.position.clone().applyMatrix4(view);
  const depth = -t.z;

  // Behind the camera or too close: the projection blows up (1/d), skip it.
  if (depth < MIN_DEPTH) {
    return {
      visible: false,
      depth,
      reason: depth <= 0 ? "behind the camera" : "too close to the camera",
    };
  }

  // Focal length in pixels. three.js `fov` is vertical; pixels are square, so
  // the same focal length applies horizontally.
  const halfFovY = THREE.MathUtils.degToRad(camera.fov) / 2;
  const focal = viewport.height / 2 / Math.tan(halfFovY);
  const fx = focal;
  const fy = focal;

  // Keep x/d and y/d within ~1.3x the visible field (as the reference
  // implementation does). Far off-screen centres would otherwise produce a
  // huge, meaningless Jacobian.
  const limitX = 1.3 * Math.tan(halfFovY) * camera.aspect;
  const limitY = 1.3 * Math.tan(halfFovY);
  const x = THREE.MathUtils.clamp(t.x / depth, -limitX, limitX) * depth;
  const y = THREE.MathUtils.clamp(t.y / depth, -limitY, limitY) * depth;

  // J as two rows of three.
  const J = [
    [fx / depth, 0, (fx * x) / (depth * depth)],
    [0, fy / depth, (fy * y) / (depth * depth)],
  ];

  // W: rotation part of the view matrix (row-major copy for readability).
  const e = new THREE.Matrix3().setFromMatrix4(view).elements; // column-major
  const W = [
    [e[0], e[3], e[6]],
    [e[1], e[4], e[7]],
    [e[2], e[5], e[8]],
  ];

  // T = J * W  (2x3): world directions -> screen pixels, near the centre.
  const T = multiply(J, W);

  // Sigma2D = T * Sigma3D * T^T
  const s = sigma3D.elements; // column-major, symmetric
  const Sigma = [
    [s[0], s[3], s[6]],
    [s[1], s[4], s[7]],
    [s[2], s[5], s[8]],
  ];
  const TS = multiply(T, Sigma); // 2x3
  const cov = multiply(TS, transpose(T)); // 2x2

  // Symmetrise (removes tiny floating-point asymmetry) and add the low-pass term.
  const cov2D: Sym2 = {
    a: cov[0][0] + LOW_PASS_PX2,
    b: (cov[0][1] + cov[1][0]) / 2,
    c: cov[1][1] + LOW_PASS_PX2,
  };

  // Eigen-decomposition of the symmetric 2x2 matrix:
  //   lambda = mid +- sqrt(((a - c) / 2)^2 + b^2),   mid = (a + c) / 2
  // The eigenvalues are the variances along the ellipse's axes.
  const mid = (cov2D.a + cov2D.c) / 2;
  const radius = Math.sqrt(((cov2D.a - cov2D.c) / 2) ** 2 + cov2D.b ** 2);
  const lambdaMajor = mid + radius;
  const lambdaMinor = Math.max(mid - radius, 1e-6);

  // Major-axis direction: angle = 0.5 * atan2(2b, a - c).
  const angle = 0.5 * Math.atan2(2 * cov2D.b, cov2D.a - cov2D.c);
  const majorDir = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  const minorDir = new THREE.Vector2(-majorDir.y, majorDir.x);

  // Inverse ("conic"): [[a, b], [b, c]]^-1 = [[c, -b], [-b, a]] / det.
  const det = cov2D.a * cov2D.c - cov2D.b * cov2D.b;
  const conic: Sym2 = { a: cov2D.c / det, b: -cov2D.b / det, c: cov2D.a / det };

  const maxSigma = (MAX_FOOTPRINT_VIEWPORTS * Math.max(viewport.width, viewport.height)) / 3;
  const sigmaMajorPx = Math.sqrt(lambdaMajor);
  const sigmaMinorPx = Math.sqrt(lambdaMinor);

  const centerClip = new THREE.Vector4(
    gaussian.position.x,
    gaussian.position.y,
    gaussian.position.z,
    1,
  )
    .applyMatrix4(view)
    .applyMatrix4(camera.projectionMatrix);

  return {
    visible: true,
    depth,
    centerClip,
    cov2D,
    conic,
    sigmaMajorPx: Math.min(sigmaMajorPx, maxSigma),
    sigmaMinorPx: Math.min(sigmaMinorPx, maxSigma),
    angleDeg: THREE.MathUtils.radToDeg(angle),
    majorDir,
    minorDir,
    clamped: sigmaMajorPx > maxSigma,
  };
}

// ---------------------------------------------------------------------------
// Small matrix helpers on row-major number[][] (clearer than packed arrays here)
// ---------------------------------------------------------------------------

function multiply(A: number[][], B: number[][]): number[][] {
  return A.map((row) => B[0].map((_, j) => row.reduce((sum, value, k) => sum + value * B[k][j], 0)));
}

function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((row) => row[j]));
}
