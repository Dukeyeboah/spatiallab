/**
 * Three.js is "Y-up", LiDAR data is "Z-up".
 * Rotating by -90° around X turns LiDAR Z into three.js Y.
 *
 * Each dataset's coordinate offset lives in its metadata (lib/datasets.ts),
 * not here: every budget and the poses of a dataset subtract that offset.
 */
export const LIDAR_TO_THREE_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];
