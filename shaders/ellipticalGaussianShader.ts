/**
 * Elliptical Gaussian experiment: like Gaussian Point, but with a separate
 * spread along two axes and a rotation, so each point becomes a soft ellipse.
 * Used together with the baseline vertex shader.
 *
 * Still a point SPRITE: the ellipse is drawn inside the point's screen-aligned
 * square and is cut off at its edges. All points share the same shape; in real
 * Gaussian splatting each splat has its own 3D shape projected to the screen.
 */
export const ellipticalGaussianFragmentShader = /* glsl */ `
precision mediump float;

varying vec3 vColor;

// Spread along the ellipse's own X and Y axes, in gl_PointCoord units
// (the point's square is 1.0 wide, so 0.5 reaches its edge).
uniform float uSigmaX;
uniform float uSigmaY;

// Ellipse orientation in radians, counter-clockwise on screen.
uniform float uRotation;

// Rotate a 2D vector counter-clockwise by "angle" radians:
//   [ cos -sin ] [x]
//   [ sin  cos ] [y]
vec2 rotate2D(vec2 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
  // Local coordinates centred on the point: (-0.5, -0.5) .. (0.5, 0.5).
  vec2 p = gl_PointCoord - vec2(0.5);

  // gl_PointCoord's Y grows DOWNWARDS (0 at the top of the square).
  // Flip it so +Y is up and positive angles turn counter-clockwise on screen.
  p.y = -p.y;

  // Express this pixel in the ellipse's own frame, where its axes are aligned
  // with X and Y. The ellipse is rotated by +uRotation, so we rotate the
  // pixel by -uRotation to "undo" that.
  vec2 q = rotate2D(p, -uRotation);

  // Elliptical Gaussian: each axis gets its own sigma.
  //   exponent = x^2 / (2 sigmaX^2) + y^2 / (2 sigmaY^2)
  // With sigmaX == sigmaY this is exactly the circular Gaussian r^2 / (2 sigma^2).
  //
  // In matrix form this is 0.5 * p^T * inverse(Sigma) * p, where the
  // covariance matrix Sigma = R * diag(sigmaX^2, sigmaY^2) * R^T holds both
  // the spread (diagonal) and the orientation (R = rotation matrix).
  float exponent = (q.x * q.x) / (2.0 * uSigmaX * uSigmaX)
                 + (q.y * q.y) / (2.0 * uSigmaY * uSigmaY);

  // alpha: 1.0 at the centre, falling smoothly towards 0 along the ellipse.
  float alpha = exp(-exponent);

  // Skip (almost) invisible pixels; matters when depthWrite is on.
  if (alpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(vColor, alpha);
}
`;
