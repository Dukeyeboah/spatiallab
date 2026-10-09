/**
 * Projected 3D Gaussian, drawn as a screen-space quad (two triangles).
 *
 * Written in GLSL ES 3.00 (material.glslVersion = THREE.GLSL3) because the
 * footprint outline uses fwidth(), which is built in there.
 *
 * Units: "pixels" are CSS pixels measured from the Gaussian's projected
 * centre, x to the right and y UP (same as clip space).
 */
export const projectedGaussianVertexShader = /* glsl */ `
precision highp float;

// The quad's corners: (-1,-1), (1,-1), (1,1), (-1,1) from a 2x2 PlaneGeometry.
in vec3 position;

// Gaussian centre in clip space (projectionMatrix * viewMatrix * centre).
uniform vec4 uCenterClip;
// Half-extent vectors of the quad in pixels: ellipse axis direction times
// (supportSigmas * sigma along that axis). The quad is the ellipse's
// oriented bounding rectangle, so it covers the support and nothing more.
uniform vec2 uMajorAxisPx;
uniform vec2 uMinorAxisPx;
// Canvas size in pixels.
uniform vec2 uViewportPx;

// Pixel offset of this corner from the centre; interpolated per fragment.
out vec2 vOffsetPx;
// The raw corner coordinate, used to draw the quad's border.
out vec2 vCorner;

void main() {
  vOffsetPx = position.x * uMajorAxisPx + position.y * uMinorAxisPx;
  vCorner = position.xy;

  // Pixels -> normalised device coordinates: NDC spans 2 units across the
  // viewport, so one pixel is 2 / viewport NDC units.
  vec2 offsetNdc = vOffsetPx * 2.0 / uViewportPx;

  // Clip space is divided by w afterwards (perspective divide). Multiplying
  // the offset by w makes it come out unchanged in NDC: a flat screen-space
  // quad around the projected centre. Every vertex shares the same w, so
  // varyings are interpolated linearly across the screen.
  gl_Position = uCenterClip + vec4(offsetNdc * uCenterClip.w, 0.0, 0.0);
}
`;

export const projectedGaussianFragmentShader = /* glsl */ `
precision highp float;

in vec2 vOffsetPx;
in vec2 vCorner;

// Inverse 2D covariance [[a, b], [b, c]] in 1/pixels^2 ("conic").
uniform vec3 uConic;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSupportSigmas;
uniform bool uShowOutline;

out vec4 fragColor;

void main() {
  vec2 d = vOffsetPx;

  // Squared Mahalanobis distance: d^T * inverse(Sigma2D) * d.
  // It measures distance in "standard deviations" along whatever direction
  // d points, so it is 1.0 on the 1-sigma ellipse, 4.0 on the 2-sigma one...
  float mahalanobis2 = uConic.x * d.x * d.x
                     + 2.0 * uConic.y * d.x * d.y
                     + uConic.z * d.y * d.y;
  float mahalanobis = sqrt(mahalanobis2);

  // 2D Gaussian: exp(-0.5 * d^T Sigma^-1 d), scaled by the peak opacity.
  float alpha = uOpacity * exp(-0.5 * mahalanobis2);

  if (uShowOutline) {
    // fwidth: how much a value changes between neighbouring pixels. Dividing
    // by it turns "distance in sigma units" into "distance in pixels", so the
    // lines are ~1.5 px thick everywhere on the ellipse.
    float lineWidth = 1.5;
    float on1Sigma = abs(mahalanobis - 1.0) / fwidth(mahalanobis);
    float onSupport = abs(mahalanobis - uSupportSigmas) / fwidth(mahalanobis);
    vec2 edge = (1.0 - abs(vCorner)) / fwidth(vCorner);
    float onQuadEdge = min(edge.x, edge.y);

    // Outputs are premultiplied: rgb already multiplied by alpha.
    if (on1Sigma < lineWidth) { fragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
    if (onSupport < lineWidth) { fragColor = vec4(0.3, 0.8, 1.0, 1.0); return; }
    if (onQuadEdge < lineWidth) { fragColor = vec4(0.25, 0.25, 0.25, 0.5) ; return; }
  }

  // Outside the support region: the quad's corners. Nothing to draw.
  if (mahalanobis > uSupportSigmas) {
    discard;
  }

  // PREMULTIPLIED ALPHA: store colour * alpha in rgb. Blending is then
  //   result = src.rgb + dst.rgb * (1 - src.a)
  // which is what the material's premultipliedAlpha + NormalBlending set up.
  fragColor = vec4(uColor * alpha, alpha);
}
`;
