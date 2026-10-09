import * as THREE from "three";

/**
 * Bounding box of the "useful" part of a point cloud, in LiDAR coordinates.
 *
 * A raw min/max box is stretched by a few stray points (reflections, noise).
 * In our scan the full box is ~28 x 31 x 7 m while 98% of the points sit in
 * ~6 x 8 x 1.5 m. So per axis we take the 1st and 99th percentile instead.
 *
 * Percentiles are estimated from an evenly spaced sample of the points.
 */
const SAMPLE_SIZE = 50_000;
const LOW_PERCENTILE = 0.01;
const HIGH_PERCENTILE = 0.99;

export function usefulBounds(positions: Float32Array): THREE.Box3 {
  const count = positions.length / 3;
  const stride = Math.max(1, Math.floor(count / SAMPLE_SIZE));

  const min = new THREE.Vector3();
  const max = new THREE.Vector3();

  for (let axis = 0; axis < 3; axis++) {
    const values: number[] = [];
    for (let i = 0; i < count; i += stride) {
      values.push(positions[i * 3 + axis]);
    }
    values.sort((a, b) => a - b);

    min.setComponent(axis, values[Math.floor(LOW_PERCENTILE * (values.length - 1))]);
    max.setComponent(axis, values[Math.floor(HIGH_PERCENTILE * (values.length - 1))]);
  }

  return new THREE.Box3(min, max);
}
