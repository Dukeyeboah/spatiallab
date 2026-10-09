/**
 * Fragment shader: runs once per pixel covered by each point's square.
 * Its job is to decide the COLOUR of that pixel.
 */
export const pointCloudFragmentShader = /* glsl */ `
precision mediump float;

// The colour written by the vertex shader. For triangles a varying is
// interpolated across the surface; a point is a single vertex, so every
// pixel of its square receives exactly the same value.
varying vec3 vColor;

void main() {
  // Output RGBA. Alpha = 1.0 (fully opaque). No lighting, no textures.
  gl_FragColor = vec4(vColor, 1.0);
}
`;
