/**
 * Lab 9: Gaussian Inspector. Individual Gaussians of a trained Gaussian PLY,
 * read on demand by the backend (backend/gaussian_records.py: memory-mapped,
 * read-only) and shown one at a time in an isolated preview built on Lab 6's
 * projection (gaussianMath.ts).
 *
 * Edits ("experiments") live only in this page's state; nothing is sent back.
 */

import * as THREE from "three";
import { API_URL, errorMessage, type Vec3 } from "@/lib/datasets";
import type { Gaussian3D } from "./gaussianMath";
import { colorToDc, shColor, type RGB } from "./sphericalHarmonics";

export type GaussianLayout = {
  count: number;
  /** Byte offset of record 0 (the header length for a plain Gaussian PLY). */
  dataOffset: number;
  /** Bytes per record. */
  stride: number;
  properties: { name: string; type: string }[];
  shDegree: number;
  shCoefficientsPerChannel: number;
  fileBytes: number;
};

/** null = a non-finite stored value (the backend flags it in `checks`). */
type N = number | null;

export type GaussianRecord = {
  index: number;
  byteOffset: number;
  /** Every property exactly as stored (float32 widened to float64). */
  stored: Record<string, N>;
  decoded: {
    position: [N, N, N];
    logScale: [N, N, N];
    /** exp(logScale): standard deviation along the Gaussian's own axes, metres. */
    scale: [N, N, N];
    /** As stored: (w, x, y, z), not normalised. */
    quaternionRaw: [N, N, N, N];
    quaternionNorm: N;
    /** Normalised (w, x, y, z). */
    quaternion: [number, number, number, number];
    opacityLogit: N;
    /** sigmoid(opacityLogit). */
    opacity: number;
    fDc: [N, N, N];
    /** 0.5 + C0 * f_dc. */
    baseColor: [N, N, N];
    shDegree: number;
    /** f_rest as rows of [r, g, b]: coefficient 1, 2, ... (3, 8 or 15 rows). */
    shRest: [N, N, N][];
  };
  checks: string[];
};

type Stats = { percentiles: Record<string, number>; min: number | null; max: number | null };

export type GaussianSummary = {
  seed: number;
  sampled: number;
  nonFinite: number;
  scaleLargest: Stats;
  scaleSmallest: Stats;
  anisotropy: Stats;
  opacity: Stats;
  opacityLogit: Stats;
  quaternionNorm: Stats;
  zeroQuaternions: number;
  baseColorOutside01: number;
  opacityOn255Steps: number;
  shRestMagnitude?: Stats;
};

const base = (sceneId: string) => `${API_URL}/splats/${encodeURIComponent(sceneId)}/gaussians`;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export const gaussianApi = {
  records: (sceneId: string, indices: number[]) =>
    getJson<{ layout: GaussianLayout; records: GaussianRecord[] }>(`${base(sceneId)}?indices=${indices.join(",")}`),
  sample: (sceneId: string, seed: number, count: number) =>
    getJson<{ layout: GaussianLayout; records: GaussianRecord[]; seed: number }>(
      `${base(sceneId)}/sample?seed=${seed}&count=${count}`,
    ),
  summary: (sceneId: string, seed: number) =>
    getJson<{ layout: GaussianLayout; summary: GaussianSummary }>(`${base(sceneId)}/summary?seed=${seed}`),
};

// ---------------------------------------------------------------------------
// Experiments: what the sliders change. Initialised from the decoded record;
// "Reset Gaussian" goes back to exactly that.

export type GaussianEdits = {
  /** Stored log of the standard deviations (the slider works in the file's own units). */
  logScale: Vec3;
  /** Euler XYZ (degrees) of the stored rotation, in the file's frame. */
  rotationDegrees: Vec3;
  /** Decoded opacity, 0..1. */
  opacity: number;
  /** Decoded base colour (degree-0 SH), display values 0..1. */
  baseColor: RGB;
  /** Highest SH degree used for the view-dependent colour (0 = base colour only). */
  shDegree: number;
};

const num = (v: N, fallback = 0) => (v === null ? fallback : v);

export function fileQuaternion([w, x, y, z]: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w); // three.js order is (x, y, z, w)
}

export function editsFromRecord(record: GaussianRecord): GaussianEdits {
  const d = record.decoded;
  const euler = new THREE.Euler().setFromQuaternion(fileQuaternion(d.quaternion), "XYZ");
  return {
    logScale: d.logScale.map((v) => num(v, -10)) as Vec3,
    rotationDegrees: [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg) as Vec3,
    opacity: d.opacity,
    baseColor: d.baseColor.map((v) => num(v, 0.5)) as RGB,
    shDegree: d.shDegree,
  };
}

/** The edited Gaussian's rotation in the file frame. */
export function editedQuaternion(edits: GaussianEdits): THREE.Quaternion {
  const [rx, ry, rz] = edits.rotationDegrees.map(THREE.MathUtils.degToRad);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "XYZ"));
}

// ---------------------------------------------------------------------------
// The isolated preview.
//
// Frame: shown upright the way the Gaussian viewer (Lab 8) shows the scene,
// i.e. turned 180° about Z: file (x, y, z) -> preview (-x, -y, z). That is a
// rotation, so the shape is unchanged; it only decides which way is "up".
//
// Size: trained Gaussians are millimetres to centimetres. The preview is
// magnified uniformly so the original's largest axis is PREVIEW_SIGMA units
// long and the camera starts PREVIEW camera distance away (Lab 6's setup).
// Magnifying the Gaussian AND the camera distance together changes nothing on
// screen: the projected ellipse depends only on size / distance. Depths are
// therefore reported back in real metres (preview depth / magnification).
// The magnification is fixed per Gaussian (from its stored scale), so the
// scale sliders visibly grow and shrink it.

export const PREVIEW_SIGMA = 0.6;
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

export function magnificationFor(record: GaussianRecord): number {
  const largest = Math.max(...record.decoded.scale.map((v) => num(v, 0)));
  return largest > 0 ? PREVIEW_SIGMA / largest : 1;
}

export function previewGaussian(edits: GaussianEdits, magnification: number): Gaussian3D {
  return {
    position: new THREE.Vector3(0, 0, 0),
    scale: new THREE.Vector3(...edits.logScale.map((v) => Math.exp(v) * magnification)),
    rotation: FLIP.clone().multiply(editedQuaternion(edits)),
    color: new THREE.Color(...edits.baseColor), // display values, used as-is (the canvas is `linear`)
    opacity: edits.opacity,
  };
}

/** Unit vector from the camera to the Gaussian, in the file frame (what the SH coefficients expect). */
export function viewDirectionInFile(cameraPosition: THREE.Vector3): [number, number, number] {
  const d = cameraPosition.clone().negate().normalize(); // the Gaussian sits at the preview origin
  return [-d.x, -d.y, d.z]; // undo the 180° turn about Z
}

/** Colour seen from that camera, with the edited base colour and the stored higher SH coefficients. */
export function viewColor(record: GaussianRecord, edits: GaussianEdits, cameraPosition: THREE.Vector3): RGB {
  const fDc = edits.baseColor.map(colorToDc) as RGB;
  const rest = record.decoded.shRest.map((row) => row.map((v) => num(v)) as RGB);
  return shColor(fDc, rest, viewDirectionInFile(cameraPosition), edits.shDegree);
}

export function sameEdits(a: GaussianEdits, b: GaussianEdits): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Lengths in a readable unit. */
export function formatLength(metres: number): string {
  const abs = Math.abs(metres);
  if (abs >= 1) return `${metres.toFixed(3)} m`;
  if (abs >= 0.001) return `${(metres * 1000).toFixed(2)} mm`;
  if (abs >= 1e-6) return `${(metres * 1e6).toFixed(2)} µm`;
  return `${metres.toExponential(2)} m`;
}

export const toHex = (rgb: RGB) =>
  "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): RGB =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
