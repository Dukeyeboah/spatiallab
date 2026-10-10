/**
 * View-dependent colour of a trained Gaussian from its spherical-harmonic (SH)
 * coefficients, exactly as the 3D Gaussian Splatting reference renderer does
 * it (utils/sh_utils.py and the CUDA rasteriser's computeColorFromSH).
 *
 * A colour that depends on direction is written as a sum of fixed "basis"
 * functions of the view direction, each weighted by a learned coefficient
 * per RGB channel:
 *
 *   colour(dir) = 0.5 + sum over l, m of  coeff[l,m] * Y[l,m](dir)
 *
 *   degree 0 (1 function):   a constant, the same from everywhere: the base colour (f_dc)
 *   degree 1 (3 functions):  one lobe per axis: brighter from one side than the other
 *   degree 2 (5 functions):  finer variations (e.g. two opposite bright sides)
 *   degree 3 (7 functions):  finer still (sharper highlights)
 *
 * `dir` is the unit vector from the camera to the Gaussian's centre, in the
 * scene file's frame (the frame the coefficients were trained in). Negative
 * results are clamped to 0, as in the reference; values above 1 are kept here
 * and saturate on screen.
 */

export const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const SH_C2 = [1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396];
const SH_C3 = [
  -0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154, -0.4570457994644658,
  1.445305721320277, -0.5900435899266435,
];

export type RGB = [number, number, number];

/** The 15 basis values for degrees 1..3 (index 0 = first f_rest coefficient), up to `degree`. */
export function shBasis(dir: [number, number, number], degree: number): number[] {
  const [x, y, z] = dir;
  const basis: number[] = [];
  if (degree >= 1) basis.push(-SH_C1 * y, SH_C1 * z, -SH_C1 * x);
  if (degree >= 2) {
    const [xx, yy, zz, xy, yz, xz] = [x * x, y * y, z * z, x * y, y * z, x * z];
    basis.push(
      SH_C2[0] * xy,
      SH_C2[1] * yz,
      SH_C2[2] * (2 * zz - xx - yy),
      SH_C2[3] * xz,
      SH_C2[4] * (xx - yy),
    );
    if (degree >= 3) {
      basis.push(
        SH_C3[0] * y * (3 * xx - yy),
        SH_C3[1] * xy * z,
        SH_C3[2] * y * (4 * zz - xx - yy),
        SH_C3[3] * z * (2 * zz - 3 * xx - 3 * yy),
        SH_C3[4] * x * (4 * zz - xx - yy),
        SH_C3[5] * z * (xx - yy),
        SH_C3[6] * x * (xx - 3 * yy),
      );
    }
  }
  return basis;
}

/**
 * Colour seen from direction `dir` using SH degrees up to `degree`.
 * fDc: the degree-0 coefficients; rest: f_rest as rows of [r, g, b] (coefficient 1, 2, ...).
 */
export function shColor(fDc: RGB, rest: RGB[], dir: [number, number, number], degree: number): RGB {
  const basis = shBasis(dir, degree);
  const out: RGB = [0.5 + SH_C0 * fDc[0], 0.5 + SH_C0 * fDc[1], 0.5 + SH_C0 * fDc[2]];
  for (let k = 0; k < basis.length && k < rest.length; k++) {
    for (let c = 0; c < 3; c++) out[c] += rest[k][c] * basis[k];
  }
  return [Math.max(0, out[0]), Math.max(0, out[1]), Math.max(0, out[2])];
}

/** Base colour <-> stored f_dc. */
export const dcToColor = (fDc: number) => 0.5 + SH_C0 * fDc;
export const colorToDc = (color: number) => (color - 0.5) / SH_C0;
