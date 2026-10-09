/**
 * Height experiment: colour each point by its height instead of its RGB.
 *
 * Why position.z is height: the point cloud sits inside the scene's LiDAR
 * group, so the `position` attribute is still in LiDAR-local coordinates,
 * where Z is up. The group's Z-up -> Y-up rotation is applied later, through
 * modelViewMatrix. So before that matrix, z = height in metres (above the
 * lowest point of the scan, because the converter put the minimum Z at 0).
 */
export const heightVertexShader = /* glsl */ `
precision highp float;

attribute vec3 position;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPointSize;

// Vertical range of the scan in LiDAR-local metres, measured from the data
// (1st..99th percentile of Z, so a few stray points don't stretch the range).
uniform float uMinHeight;
uniform float uMaxHeight;

// Normalised height, 0.0 = lowest, 1.0 = highest. Sent to the fragment shader.
varying float vHeight;

void main() {
  // Normalisation: map [uMinHeight, uMaxHeight] to [0, 1].
  //   subtract the minimum -> 0 at the bottom
  //   divide by the range  -> 1 at the top
  // clamp() keeps points outside the range at 0 or 1.
  float height = (position.z - uMinHeight) / (uMaxHeight - uMinHeight);
  vHeight = clamp(height, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPointSize;
}
`;

export const heightFragmentShader = /* glsl */ `
precision mediump float;

varying float vHeight;

const vec3 LOW_COLOR = vec3(0.1, 0.2, 0.9);   // blue at the bottom
const vec3 HIGH_COLOR = vec3(1.0, 0.8, 0.1);  // yellow at the top

void main() {
  // mix(a, b, t) = a * (1 - t) + b * t: a straight blend from a (t=0) to b (t=1).
  vec3 color = mix(LOW_COLOR, HIGH_COLOR, vHeight);
  gl_FragColor = vec4(color, 1.0);
}
`;
