/**
 * Gaussian Point experiment: alpha follows a 2D Gaussian (bell curve) across
 * each point's square. Used together with the baseline vertex shader.
 *
 * This is a Gaussian-shaped point SPRITE: a flat, screen-facing square with a
 * round, fixed-width falloff. A real 3D Gaussian splat additionally has a 3D
 * shape (covariance), is projected into an ellipse, and is depth-sorted.
 */
export const gaussianFragmentShader = /* glsl */ `
precision mediump float;

varying vec3 vColor;

// Width of the bell curve, in gl_PointCoord units (the square is 1.0 wide).
// Small sigma = tight bright core; large sigma = wide soft blob.
uniform float uSigma;

// Extra multiplier on alpha, 0..1, to make every point fainter.
uniform float uOpacity;

void main() {
  // Re-centre gl_PointCoord (0..1) so the middle of the point is (0, 0):
  // p now runs from (-0.5, -0.5) to (0.5, 0.5).
  vec2 p = gl_PointCoord - vec2(0.5);

  // Squared distance from the centre: dot(p, p) = p.x*p.x + p.y*p.y = r^2.
  // The Gaussian formula is written in terms of r^2, so we never need r
  // itself. length(p) would compute sqrt(r^2) only for us to square it again.
  float r2 = dot(p, p);

  // The Gaussian: exp(-r^2 / (2 sigma^2)).
  //   r = 0       -> exp(0) = 1.0 (fully opaque centre)
  //   r = sigma   -> exp(-0.5) ~= 0.61
  //   r = 2 sigma -> exp(-2)   ~= 0.14
  //   r = 3 sigma -> exp(-4.5) ~= 0.01 (practically invisible)
  float alpha = exp(-r2 / (2.0 * uSigma * uSigma)) * uOpacity;

  // The Gaussian never truly reaches 0, but the square ends at r = 0.5.
  // With a large sigma the square's edge becomes visible: the bell curve
  // is cut off by the sprite. That is a real limitation of point sprites.

  // Skip (almost) invisible pixels; matters when depthWrite is on.
  if (alpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(vColor, alpha);
}
`;
