/**
 * Circle experiment: keep RGB and normal sizing, but cut each square point
 * into a circle. Used together with the baseline vertex shader.
 */
export const circleFragmentShader = /* glsl */ `
precision mediump float;

varying vec3 vColor;

void main() {
  // gl_PointCoord: built-in, only for points. Within each individual point's
  // square it runs from (0, 0) in one corner to (1, 1) in the opposite
  // corner, like local 0-1 coordinates. The centre is (0.5, 0.5).
  vec2 fromCenter = gl_PointCoord - vec2(0.5);

  // Distance from the centre: 0.0 at the centre, 0.5 at the middle of each
  // edge, ~0.707 in the corners.
  float distanceFromCenter = length(fromCenter);

  // discard throws this pixel away (nothing is drawn). Removing everything
  // beyond radius 0.5 leaves the inscribed circle.
  if (distanceFromCenter > 0.5) {
    discard;
  }

  gl_FragColor = vec4(vColor, 1.0);
}
`;
