/**
 * Lab 10B: puts COLMAP's result into a viewable frame. COLMAP fixes no origin,
 * up direction or scale, so for display only:
 *   - centre: the per-axis median of the points (stray points don't move it),
 *   - up: the average of the cameras' up directions (people hold phones
 *     roughly upright, so this approximates gravity; a heuristic),
 *   - scale: 90% of the points within DISPLAY_RADIUS units.
 * The stored model is unchanged; nothing here adds or moves a camera.
 */

import * as THREE from "three";
import type { PosePreview } from "./training";

export const DISPLAY_RADIUS = 4;

export type DisplayCamera = {
  imageId: string;
  filename: string;
  points: number;
  position: THREE.Vector3;
  /** Unit axes in display space: right, image-down, viewing direction. */
  right: THREE.Vector3;
  down: THREE.Vector3;
  forward: THREE.Vector3;
  /** Half the field of view as tangents (image half-size / focal length). */
  tanX: number;
  tanY: number;
};

export type PoseDisplay = {
  positions: Float32Array;
  colors: Float32Array;
  cameras: DisplayCamera[];
  /** Display units per COLMAP unit (COLMAP's unit itself is arbitrary). */
  scale: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

const column = (m: number[][], c: number) => new THREE.Vector3(m[0][c], m[1][c], m[2][c]);

export function poseDisplay(preview: PosePreview): PoseDisplay {
  const p = preview.positions;
  const count = p.length / 3;
  const axis = (k: number) => Array.from({ length: count }, (_, i) => p[3 * i + k]);
  const centre = new THREE.Vector3(median(axis(0)), median(axis(1)), median(axis(2)));

  // Image y points down, so a camera's up is minus its y axis.
  const up = new THREE.Vector3();
  for (const image of preview.images) up.sub(column(image.cameraToWorld, 1));
  if (up.lengthSq() === 0) up.set(0, -1, 0);
  const rotation = new THREE.Quaternion().setFromUnitVectors(up.normalize(), new THREE.Vector3(0, 1, 0));

  const distances = Array.from({ length: count }, (_, i) =>
    Math.hypot(p[3 * i] - centre.x, p[3 * i + 1] - centre.y, p[3 * i + 2] - centre.z),
  ).sort((a, b) => a - b);
  const spread = distances[Math.floor(0.9 * (distances.length - 1))] || 1;
  const scale = DISPLAY_RADIUS / spread;

  const place = (x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).sub(centre).multiplyScalar(scale).applyQuaternion(rotation);

  const positions = new Float32Array(p.length);
  const colors = new Float32Array(p.length);
  const colour = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const v = place(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
    positions.set([v.x, v.y, v.z], 3 * i);
    // COLMAP stores sRGB 0–255; the renderer works in linear colour.
    colour.setRGB(preview.colors[3 * i] / 255, preview.colors[3 * i + 1] / 255, preview.colors[3 * i + 2] / 255, THREE.SRGBColorSpace);
    colors.set([colour.r, colour.g, colour.b], 3 * i);
  }

  const cameras = preview.images.map((image) => {
    const intrinsics = preview.cameras[String(image.cameraId)];
    const [fx, fy] = intrinsics.params;
    return {
      imageId: image.imageId,
      filename: image.filename,
      points: image.points,
      position: place(...image.center),
      right: column(image.cameraToWorld, 0).applyQuaternion(rotation),
      down: column(image.cameraToWorld, 1).applyQuaternion(rotation),
      forward: column(image.cameraToWorld, 2).applyQuaternion(rotation),
      tanX: intrinsics.width / 2 / fx,
      tanY: intrinsics.height / 2 / fy,
    };
  });
  return { positions, colors, cameras, scale };
}

/** Line segments of a small pyramid per camera: apex at the camera, base = the image rectangle at `depth`. */
export function frustumSegments(cameras: DisplayCamera[], depth: number): Float32Array {
  const out = new Float32Array(cameras.length * 16 * 3);
  let k = 0;
  const push = (v: THREE.Vector3) => {
    out[k++] = v.x;
    out[k++] = v.y;
    out[k++] = v.z;
  };
  for (const c of cameras) {
    const corner = (sx: number, sy: number) =>
      c.position
        .clone()
        .addScaledVector(c.forward, depth)
        .addScaledVector(c.right, sx * c.tanX * depth)
        .addScaledVector(c.down, sy * c.tanY * depth);
    const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let i = 0; i < 4; i++) {
      push(c.position);
      push(corners[i]);
      push(corners[i]);
      push(corners[(i + 1) % 4]);
    }
  }
  return out;
}
