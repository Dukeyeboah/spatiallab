/**
 * Vertex shader: runs once per point (per vertex) on the GPU.
 * Its job is to decide WHERE the point appears on screen and HOW BIG it is.
 */
export const pointCloudVertexShader = /* glsl */ `
precision highp float;

// ---- Attributes: per-point data, read from our BufferGeometry ----

// "position" BufferAttribute: the point's XYZ in the object's local space.
// For us that is LiDAR metres with the world offset already subtracted.
attribute vec3 position;

// "color" BufferAttribute: the point's RGB. We store it as uint8 0..255 with
// normalized = true, so the GPU hands it to us as floats in 0.0..1.0.
attribute vec3 color;

// ---- Uniforms: values that are the same for every point in this draw ----

// modelViewMatrix = viewMatrix * modelMatrix, supplied by three.js every frame.
//   modelMatrix: object space -> world space (includes our Z-up -> Y-up rotation).
//   viewMatrix:  world space  -> camera space (changes as you orbit).
uniform mat4 modelViewMatrix;

// projectionMatrix: camera space -> clip space. Applies the perspective
// (field of view, aspect ratio, near/far planes). Also supplied by three.js.
uniform mat4 projectionMatrix;

// Our own uniform, connected to the Size slider (in device pixels).
uniform float uPointSize;

// ---- Varying: output passed on to the fragment shader ----
varying vec3 vColor;

void main() {
  // Hand the colour to the fragment shader unchanged.
  vColor = color;

  // gl_Position is the required output: the point's position in clip space.
  // vec4(position, 1.0): w = 1.0 marks it as a point (affected by translation).
  // The GPU then divides by w (perspective divide) and maps it to the screen.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  // gl_PointSize: width/height in pixels of the square drawn for this point.
  // Constant here, so points keep the same size at any distance.
  gl_PointSize = uPointSize;
}
`;
