/**
 * The fixed world-space offset subtracted from map.las by scripts/convert_las.py
 * ("Offset from full dataset (x, y, z)" in its output).
 *
 * Every dataset in the LAS coordinate frame (point clouds, poses, ...) must
 * subtract exactly this offset so they line up. If map.las changes, update it.
 */
export const WORLD_OFFSET: [number, number, number] = [
  -8.19650038931286, 13.09700062207412, -1.1450000543845817,
];

/**
 * Three.js is "Y-up", LiDAR data is "Z-up".
 * Rotating by -90° around X turns LiDAR Z into three.js Y.
 */
export const LIDAR_TO_THREE_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];
