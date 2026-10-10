/**
 * Lab 7B: many projected Gaussians in ONE instanced draw call.
 *
 * Same idea as Lab 6's projectedGaussianShader, but the per-Gaussian values
 * arrive as instanced attributes (one set per quad) instead of uniforms. The
 * CPU projects and sorts the Gaussians each frame and writes them into these
 * attributes in drawing order; the GPU draws the quads in exactly that order.
 *
 * GLSL ES 3.00 (material.glslVersion = THREE.GLSL3) for fwidth() and `flat`.
 */
export const compositedGaussianVertexShader = /* glsl */ `
precision highp float;

// Quad corner: (-1,-1), (1,-1), (1,1), (-1,1) from a 2x2 PlaneGeometry.
in vec3 position;

// Per instance (per Gaussian):
in vec4 aCenterClip;   // centre in clip space
in vec4 aAxesPx;       // quad half-axes in pixels: major.xy, minor.xy (already * support)
in vec3 aConic;        // inverse 2D covariance (a, b, c), 1/pixels^2
in vec4 aColorOpacity; // linear rgb, peak opacity

uniform vec2 uViewportPx;

out vec2 vOffsetPx;
flat out vec3 vConic;
flat out vec4 vColorOpacity;

void main() {
  vOffsetPx = position.x * aAxesPx.xy + position.y * aAxesPx.zw;
  vConic = aConic;
  vColorOpacity = aColorOpacity;

  // Pixels -> NDC, then times w so the perspective divide leaves it unchanged
  // (see projectedGaussianShader.ts).
  vec2 offsetNdc = vOffsetPx * 2.0 / uViewportPx;
  gl_Position = aCenterClip + vec4(offsetNdc * aCenterClip.w, 0.0, 0.0);
}
`;

export const compositedGaussianFragmentShader = /* glsl */ `
precision highp float;

in vec2 vOffsetPx;
flat in vec3 vConic;
flat in vec4 vColorOpacity;

uniform float uSupportSigmas;
uniform float uMaxAlpha;
uniform float uMinAlpha;
// false: the Gaussian itself. true: only its footprint outline (a separate pass).
uniform bool uOutlinePass;

out vec4 fragColor;

void main() {
  vec2 d = vOffsetPx;
  float mahalanobis2 = vConic.x * d.x * d.x + 2.0 * vConic.y * d.x * d.y + vConic.z * d.y * d.y;
  float mahalanobis = sqrt(mahalanobis2);

  if (uOutlinePass) {
    // A ~1.2 px line on the support ellipse (the footprint), in a lighter tint
    // of the Gaussian's colour. Drawn on top of everything, not composited.
    float onSupport = abs(mahalanobis - uSupportSigmas) / fwidth(mahalanobis);
    if (onSupport > 1.2) discard;
    vec3 tint = mix(vColorOpacity.rgb, vec3(1.0), 0.5);
    fragColor = vec4(tint * 0.85, 0.85); // premultiplied
    return;
  }

  if (mahalanobis > uSupportSigmas) discard;

  // alpha_i at this pixel: peak opacity times the 2D Gaussian falloff,
  // capped below 1 and dropped when it would not change an 8-bit pixel.
  float alpha = min(uMaxAlpha, vColorOpacity.a * exp(-0.5 * mahalanobis2));
  if (alpha < uMinAlpha) discard;

  // Premultiplied. The material's blend state turns this into front-to-back
  // compositing: dst += src * (1 - dst.a), where dst.a = 1 - transmittance.
  fragColor = vec4(vColorOpacity.rgb * alpha, alpha);
}
`;
