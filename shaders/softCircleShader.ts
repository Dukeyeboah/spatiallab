/**
 * Soft Circle experiment: like Circle, but the edge fades out smoothly
 * instead of being cut off. Used together with the baseline vertex shader.
 *
 * ALPHA is the fourth output channel: how much of this pixel's colour is
 * blended over what is already on screen. 1.0 = fully covers it,
 * 0.0 = invisible, 0.5 = half this colour, half the background.
 * (Only has an effect because the material has transparent blending on.)
 */
export const softCircleFragmentShader = /* glsl */ `
precision mediump float;

varying vec3 vColor;

// Radii in gl_PointCoord units (the point's square is 1.0 wide, so 0.5 = edge).
uniform float uInnerRadius;
uniform float uOuterRadius;

void main() {
  // gl_PointCoord runs 0..1 across this point's square; centre = (0.5, 0.5).
  float distanceFromCenter = length(gl_PointCoord - vec2(0.5));

  // smoothstep(a, b, x) = 0 when x <= a, 1 when x >= b, a smooth S-curve between.
  // So 1.0 - smoothstep(...) is:
  //   1.0 (opaque)      inside uInnerRadius
  //   fading 1 -> 0     between uInnerRadius and uOuterRadius
  //   0.0 (invisible)   beyond uOuterRadius
  float alpha = 1.0 - smoothstep(uInnerRadius, uOuterRadius, distanceFromCenter);

  // Skip pixels that would be (almost) invisible anyway. This matters when
  // depthWrite is on: otherwise they would still block points behind them.
  if (alpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(vColor, alpha);
}
`;
