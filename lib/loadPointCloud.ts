/**
 * Loads a point cloud from a small, browser-friendly binary file.
 *
 * File layout (little-endian), produced by scripts/convert_las.py:
 *
 *   bytes 0..3                 uint32   N = number of points
 *   next N * 3 * 4 bytes       float32  X, Y, Z for each point (metres)
 *   next N * 3 * 1 bytes       uint8    R, G, B for each point (0..255)
 *
 * Coordinates are expected to be centred near the origin (the converter
 * subtracts an offset). Raw LiDAR coordinates are often huge (e.g. UTM
 * values in the hundreds of thousands) and would lose precision as float32.
 *
 * The coordinates keep the LiDAR convention: Z is "up".
 */

export type PointCloudData = {
  count: number;
  /** [x0, y0, z0, x1, y1, z1, ...] */
  positions: Float32Array;
  /** [r0, g0, b0, r1, g1, b1, ...] in 0..255 */
  colors: Uint8Array;
};

const HEADER_BYTES = 4;

/** `signal` lets the caller cancel the download (e.g. when another dataset is selected). */
export async function loadPointCloud(url: string, signal?: AbortSignal): Promise<PointCloudData> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  }
  const buffer = await response.arrayBuffer();

  const count = new DataView(buffer).getUint32(0, true);

  const positionBytes = count * 3 * 4;
  const colorBytes = count * 3;
  const expectedBytes = HEADER_BYTES + positionBytes + colorBytes;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `Unexpected file size: header says ${count} points (${expectedBytes} bytes), ` +
        `but the file has ${buffer.byteLength} bytes.`,
    );
  }

  // These are "views" into the same ArrayBuffer: no data is copied.
  const positions = new Float32Array(buffer, HEADER_BYTES, count * 3);
  const colors = new Uint8Array(buffer, HEADER_BYTES + positionBytes, count * 3);

  return { count, positions, colors };
}
