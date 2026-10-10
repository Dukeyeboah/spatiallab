/**
 * Properties and captures (backend/catalog.py): how datasets are organised.
 *
 *   Property  a real-world place (resort, house, gallery)
 *     Capture   one scanning / photography session there
 *       Representations   what the session produced: "lidar" (an imported
 *                         dataset, ds_...) or "gaussian-splat" (a trained
 *                         splat scene, spl_..., Lab 8); later photos, meshes
 *
 * The catalog only references datasets by id; it never copies or changes
 * their files, metadata or offsets. A dataset is in at most one capture;
 * datasets in none are "unassigned". Captures are never merged and each keeps
 * its own coordinate frame: `alignment` and the property's `frame` are
 * reserved for future registration and are not applied anywhere yet.
 */

import { API_URL, errorMessage } from "./datasets";

/** `datasetId` is the referenced item's id in its own store (LiDAR dataset or splat scene). */
export type Representation = { kind: "lidar" | "gaussian-splat"; datasetId: string };

export type CaptureAlignment = {
  status: "unaligned";
  method: string | null;
  reference: string | null;
  transform: number[] | null;
};

export type Capture = {
  id: string;
  propertyId: string;
  name: string;
  createdAt: string;
  environment: string | null;
  representations: Representation[];
  alignment: CaptureAlignment;
};

export type Property = {
  id: string;
  name: string;
  createdAt: string;
  frame: unknown | null;
};

export type Catalog = {
  schemaVersion: number;
  properties: Property[];
  captures: Capture[];
};

export const EMPTY_CATALOG: Catalog = { schemaVersion: 1, properties: [], captures: [] };

/** The capture a dataset belongs to, if any. */
export function captureOfDataset(catalog: Catalog, datasetId: string): Capture | undefined {
  return catalog.captures.find((c) => c.representations.some((r) => r.datasetId === datasetId));
}

export function capturesOfProperty(catalog: Catalog, propertyId: string): Capture[] {
  return catalog.captures.filter((c) => c.propertyId === propertyId);
}

export function lidarDatasetIds(capture: Capture): string[] {
  return capture.representations.filter((r) => r.kind === "lidar").map((r) => r.datasetId);
}

export function splatSceneIds(capture: Capture): string[] {
  return capture.representations.filter((r) => r.kind === "gaussian-splat").map((r) => r.datasetId);
}

// ---------------------------------------------------------------------------
// Backend API. Every change returns the whole updated catalog.

async function request(method: string, path: string, body?: unknown): Promise<Catalog> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

const id = encodeURIComponent;

export const catalogApi = {
  fetch: () => request("GET", "/catalog"),
  createProperty: (name: string) => request("POST", "/properties", { name }),
  renameProperty: (propertyId: string, name: string) => request("PATCH", `/properties/${id(propertyId)}`, { name }),
  deleteProperty: (propertyId: string) => request("DELETE", `/properties/${id(propertyId)}`),
  createCapture: (propertyId: string, name: string) =>
    request("POST", `/properties/${id(propertyId)}/captures`, { name }),
  renameCapture: (captureId: string, name: string) => request("PATCH", `/captures/${id(captureId)}`, { name }),
  deleteCapture: (captureId: string) => request("DELETE", `/captures/${id(captureId)}`),
  assignDataset: (captureId: string, datasetId: string) =>
    request("POST", `/captures/${id(captureId)}/datasets`, { datasetId }),
  unassignDataset: (captureId: string, datasetId: string) =>
    request("DELETE", `/captures/${id(captureId)}/datasets/${id(datasetId)}`),
};
