/**
 * Loads a point cloud from a small, browser-friendly binary file.
 *
 * Two layouts (little-endian), both returning the same PointCloudData:
 *
 * "counted-planar" (default), produced by scripts/convert_las.py and the backend:
 *   bytes 0..3                 uint32   N = number of points
 *   next N * 3 * 4 bytes       float32  X, Y, Z for each point (metres)
 *   next N * 3 * 1 bytes       uint8    R, G, B for each point (0..255)
 *
 * "interleaved-xyzrgb" (dataset previews such as Basel House), no header:
 *   N records of 15 bytes:     float32 X, Y, Z (12 bytes) + uint8 R, G, B (3 bytes)
 *   N comes from the file size and must match the preview's metadata.
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
  /** Size of the downloaded file. */
  fileBytes: number;
};

export type PointCloudFormat = "counted-planar" | "interleaved-xyzrgb";

const HEADER_BYTES = 4;
const INTERLEAVED_STRIDE = 15;

/** `signal` lets the caller cancel the download (e.g. when another dataset is selected). */
export async function loadPointCloud(
  url: string,
  signal?: AbortSignal,
  format: PointCloudFormat = "counted-planar",
): Promise<PointCloudData> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return format === "interleaved-xyzrgb" ? parseInterleaved(buffer) : parseCountedPlanar(buffer);
}

function parseCountedPlanar(buffer: ArrayBuffer): PointCloudData {
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

  return { count, positions, colors, fileBytes: buffer.byteLength };
}

/**
 * Splits the 15-byte records into the two arrays the renderer uses. The
 * float32s are unaligned (offset 15·i), so they are read through a DataView.
 */
function parseInterleaved(buffer: ArrayBuffer): PointCloudData {
  if (buffer.byteLength % INTERLEAVED_STRIDE !== 0) {
    throw new Error(
      `Unexpected file size: ${buffer.byteLength} bytes is not a whole number of ${INTERLEAVED_STRIDE}-byte points.`,
    );
  }
  const count = buffer.byteLength / INTERLEAVED_STRIDE;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);

  for (let i = 0; i < count; i++) {
    const record = i * INTERLEAVED_STRIDE;
    positions[i * 3] = view.getFloat32(record, true);
    positions[i * 3 + 1] = view.getFloat32(record + 4, true);
    positions[i * 3 + 2] = view.getFloat32(record + 8, true);
    colors[i * 3] = bytes[record + 12];
    colors[i * 3 + 1] = bytes[record + 13];
    colors[i * 3 + 2] = bytes[record + 14];
  }

  return { count, positions, colors, fileBytes: buffer.byteLength };
}
