/**
 * Depth Size experiment: keep RGB, but make near points bigger and far points
 * smaller. Used together with the baseline RGB fragment shader.
 */
export const depthSizeVertexShader = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 color;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

// Base size from the Size slider (device pixels).
uniform float uPointSize;
// Distance from the camera (metres) at which a point is exactly uPointSize.
uniform float uReferenceDepth;

varying vec3 vColor;

void main() {
  vColor = color;

  // mvPosition is the point in VIEW SPACE (camera space): the camera sits at
  // the origin, +X right, +Y up, and it looks down the NEGATIVE Z axis.
  // This is the step the baseline shader does inside one expression; here
  // we keep the intermediate result so we can read its depth.
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * mvPosition;

  // Points in front of the camera have negative z, so -mvPosition.z is the
  // distance in front of the camera (in metres, along the viewing direction).
  float depth = -mvPosition.z;

  // Perspective-like sizing: twice as far away -> half the size.
  float size = uPointSize * uReferenceDepth / depth;

  // Without a limit, points right next to the camera would cover the screen.
  gl_PointSize = clamp(size, 1.0, uPointSize * 4.0);
}
`;
