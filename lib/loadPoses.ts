import type { Vec3 } from "./datasets";

/**
 * Loads scanner poses from a header-less CSV. Each row:
 *
 *   timestamp, x, y, z, qx, qy, qz, qw
 *
 *   timestamp   Unix time in seconds (5 Hz for map.las, 10 Hz for Basel House)
 *   x, y, z     scanner position in metres, same frame as the dataset's LAS (Z-up)
 *   qx..qw      orientation quaternion, scalar (w) last
 *
 * Positions are shifted by the dataset's offset, exactly like its point cloud.
 * (Imported poses are validated by the backend before they are served.)
 */

export type PoseData = {
  count: number;
  timestamps: Float64Array;
  /** [x0, y0, z0, x1, y1, z1, ...], offset already subtracted */
  positions: Float32Array;
  /** [qx0, qy0, qz0, qw0, ...] */
  orientations: Float32Array;
};

const COLUMNS = 8;

export async function loadPoses(url: string, offset: Vec3, signal?: AbortSignal): Promise<PoseData> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  }
  const text = await response.text();

  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const count = lines.length;

  const timestamps = new Float64Array(count);
  const positions = new Float32Array(count * 3);
  const orientations = new Float32Array(count * 4);

  lines.forEach((line, i) => {
    const values = line.split(",").map(Number);
    if (values.length !== COLUMNS || values.some(Number.isNaN)) {
      throw new Error(`poses.csv line ${i + 1}: expected ${COLUMNS} numbers, got "${line}"`);
    }
    const [t, x, y, z, qx, qy, qz, qw] = values;

    timestamps[i] = t;

    // Subtract in float64 (plain JS numbers) before storing as float32.
    positions[i * 3 + 0] = x - offset[0];
    positions[i * 3 + 1] = y - offset[1];
    positions[i * 3 + 2] = z - offset[2];

    orientations.set([qx, qy, qz, qw], i * 4);
  });

  return { count, timestamps, positions, orientations };
}
