/**
 * Dataset previews: a static point subset in public/datasets/<name>/ plus a
 * metadata JSON written by the converter (e.g. BM Heritage Basel House):
 *
 *   {
 *     "source": "map-002.las", "sourcePointCount": 259986436, "previewPointCount": 1003809,
 *     "coordinateCenter": [x, y, z],              subtracted from every preview point
 *     "sourceBounds": { "min": [...], "max": [...] },   original LAS coordinates
 *     "strideBytes": 15, "layout": "float32 xyz + uint8 rgb",
 *     "coordinateSystem": "Original LAS axes; centered only"
 *   }
 *
 * "Centered only" means: preview = LAS − coordinateCenter, with no rotation or
 * scaling, so the preview keeps the LAS axes (checked for Basel House: X and Y
 * horizontal, Z up). That is the same convention as every other dataset, with
 * coordinateCenter playing the role of the dataset's `offset`.
 */

import { loadPointCloud, type PointCloudData } from "./loadPointCloud";
import type { Vec3 } from "./datasets";

export type PreviewMetadata = {
  source: string;
  sourcePointCount: number;
  previewPointCount: number;
  coordinateCenter: Vec3;
  sourceBounds: { min: Vec3; max: Vec3 };
  strideBytes: number;
  layout: string;
  coordinateSystem: string;
};

const SUPPORTED_STRIDE = 15;

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((v) => Number.isFinite(v));
}

function parseMetadata(json: unknown): PreviewMetadata {
  const m = json as Partial<PreviewMetadata> | null;
  if (!m || typeof m !== "object") throw new Error("metadata is not a JSON object");
  if (m.strideBytes !== SUPPORTED_STRIDE) {
    throw new Error(`unsupported layout: ${m.strideBytes} bytes per point (expected ${SUPPORTED_STRIDE})`);
  }
  if (!isVec3(m.coordinateCenter)) throw new Error("coordinateCenter must be three numbers");
  if (!m.sourceBounds || !isVec3(m.sourceBounds.min) || !isVec3(m.sourceBounds.max)) {
    throw new Error("sourceBounds must have min and max of three numbers");
  }
  if (!Number.isInteger(m.previewPointCount)) throw new Error("previewPointCount is missing");
  return m as PreviewMetadata;
}

/** Downloads the metadata and the points together and checks that they belong together. */
export async function loadPreview(
  pointsUrl: string,
  metadataUrl: string,
  signal?: AbortSignal,
): Promise<{ data: PointCloudData; metadata: PreviewMetadata }> {
  const [metadata, data] = await Promise.all([
    fetch(metadataUrl, { signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${metadataUrl} (HTTP ${response.status})`);
      try {
        return parseMetadata(await response.json());
      } catch (err) {
        throw new Error(`${metadataUrl}: ${(err as Error).message}`);
      }
    }),
    loadPointCloud(pointsUrl, signal, "interleaved-xyzrgb"),
  ]);
  if (data.count !== metadata.previewPointCount) {
    throw new Error(
      `The binary has ${data.count} points but its metadata says ${metadata.previewPointCount}.`,
    );
  }
  return { data, metadata };
}
