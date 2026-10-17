/**
 * Lab LCC-WEB-01: thin loader for the official XGRIDS LCC Web SDK (Three.js build).
 * The vendor bundle is served from public/ and imported at runtime so Next/Turbopack
 * does not try to analyse the opaque 1.8 MB ESM.
 */

export type IPoint2 = { x: number; y: number };
export type IPoint3 = { x: number; y: number; z: number };
export type LccBounds = { min: IPoint3; max: IPoint3 };

export type LccClipBoxParams = {
  scale: number[] | IPoint3;
  rotation: number[] | IPoint3;
  position: number[] | IPoint3;
  clipSide?: number;
};

export type LccMeta = {
  fileType: string;
  dataType: string;
  [key: string]: unknown;
};

export type LccObject = {
  maxLoadSplatCount: number;
  getMeta: () => LccMeta | undefined;
  getBounds: () => LccBounds | null;
  togglePointsDisplayMode: () => void;
  useEnvironment: (flag: boolean) => void;
  hasEnvironment: () => boolean;
  hasCollision: () => boolean;
  setLodAutoLevelUp: (flag: boolean) => void;
  setVisible: (flag: boolean) => void;
  setClipBox: (param?: LccClipBoxParams) => void;
  setClipPlane: (normal: number[], constant: number) => void;
  setStartLod: (value: number) => void;
  setMaxSplats: (value: number) => void;
  setMaxNodeSplats: (value: number) => void;
  setMaxDistance: (value: number) => void;
  getLodInfos: () => number[] | undefined;
  getCurrentConfig: () => unknown;
  raycast: (param: { evt: IPoint2; maxDistance: number; radius: number }) => IPoint3 | null;
  raycastFromOrigin?: (param: { origin: IPoint3; direction: IPoint3; maxDistance: number; radius: number }) => IPoint3 | null;
  intersectsRayExt?: (param: { evt: IPoint2; maxDistance: number }) => { point: IPoint3; normal: IPoint3 } | null;
  intersectsRayFromOriginExt?: (param: {
    origin: IPoint3;
    direction: IPoint3;
    maxDistance: number;
  }) => { point: IPoint3; normal: IPoint3 } | null;
  intersectsCapsule?: (param: {
    start: IPoint3;
    end: IPoint3;
    radius: number;
    noDelta?: boolean;
  }) => { hit: boolean; delta: IPoint3 };
  intersectsSphere?: (param: { center: IPoint3; radius: number; noDelta?: boolean }) => { hit: boolean; delta: IPoint3 };
  getCollisionGeometry?: () => { vertices: Float32Array; indices: Uint32Array; vertexCount: number; faceCount: number }[];
  setSmooth?: (flag: boolean) => void;
  setEndLod?: (value: number) => void;
  checkFrameStable?: () => boolean;
};

export type LoadOptions = {
  camera: unknown;
  scene: unknown;
  renderLib: unknown;
  renderer?: unknown;
  dataPath: string;
  canvas: HTMLCanvasElement;
  useEnv?: boolean;
  useIndexDB?: boolean;
  useLoadingEffect?: boolean;
  modelMatrix?: unknown;
  appKey?: string | null;
  usePage?: boolean;
  usePrecisionRaycast?: boolean;
  maxHostCacheSize?: number;
  maxGpuCacheSize?: number;
};

export type LCCRenderType = {
  load: (
    param: LoadOptions,
    successFunc: (model: unknown) => void,
    progressFunc: (progress: number) => void,
    failureFunc: () => void,
  ) => LccObject;
  setCamera: (camera: unknown) => void;
  update: () => void;
  unload: (lccobj: LccObject) => void;
  dispose: () => void;
  clearIndexDB: () => void;
  getVersion: () => string;
  setOffscreenRender: (flag: boolean) => void;
  setWriteDepth: (flag: boolean) => void;
};

/**
 * Vendor bundle under public/.
 * Prefer the **UMD** build: the ESM build does `from "three"` (bare specifier) and needs an
 * import map; UMD binds to `window.THREE` so we share Spatial Lab's single Three instance.
 */
export const LCC_SDK_ESM_URL = "/vendor/lcc-web-sdk/0.6.3/lcc-sdk-three.js";
export const LCC_SDK_UMD_URL = "/vendor/lcc-web-sdk/0.6.3/lcc-sdk-three.umd.js";
export const LCC_SDK_VERSION_LABEL = "0.6.3";

/** Default extracted XGRIDS sample (gitignored under public/labs/lcc-samples/). */
export const DEFAULT_LCC_SAMPLE_PATH = "/labs/lcc-samples/Room_tour_L2_PRO_P/meta.lcc2";

/**
 * Official example model matrix: LCC Z-up → Three.js Y-up (see SDK examples/three.html).
 * Column-major Matrix4 elements matching the sample.
 */
export function defaultLccModelMatrixElements(): number[] {
  // new THREE.Matrix4(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
  return [-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
}

type LccGlobal = { LCCRender?: LCCRenderType };

let cached: Promise<{ LCCRender: LCCRenderType }> | null = null;
/** Bumps when the singleton is disposed so a late import does not reuse a dead promise. */
let sdkEpoch = 0;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Always inject a fresh script after releaseLccSdk() removed the previous one.
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.lccSdk = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadLccSdkOnce(epoch: number): Promise<{ LCCRender: LCCRenderType }> {
  const THREE = await import("three");
  const g = window as unknown as { THREE?: unknown; LCC?: LccGlobal };
  g.THREE = THREE;
  // Cache-bust so the UMD IIFE runs again after dispose/release.
  await loadScript(`${LCC_SDK_UMD_URL}?epoch=${epoch}`);
  if (epoch !== sdkEpoch) {
    const err = new Error("LCC_SDK_RELEASED");
    throw err;
  }
  const LCCRender = g.LCC?.LCCRender;
  if (!LCCRender) throw new Error("LCC UMD loaded but window.LCC.LCCRender is missing");
  return { LCCRender };
}

/**
 * Load the LCC Three.js SDK against Spatial Lab's Three instance (client only).
 * Sets `window.THREE` then loads the UMD build → `window.LCC.LCCRender`.
 * Retries if a host switch/Strict Mode release() raced the script load.
 */
export async function importLccSdk(): Promise<{ LCCRender: LCCRenderType }> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("LCC SDK is browser-only"));
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const epoch = sdkEpoch;
    if (!cached) {
      cached = loadLccSdkOnce(epoch).catch((err) => {
        // Drop a failed attempt so the next caller can retry.
        if (cached) cached = null;
        throw err;
      });
    }
    try {
      return await cached;
    } catch (err) {
      const released = err instanceof Error && err.message === "LCC_SDK_RELEASED";
      cached = null;
      if (released && attempt < 5) {
        await new Promise((r) => setTimeout(r, 40 + attempt * 20));
        continue;
      }
      throw err;
    }
  }
  throw new Error("LCC SDK failed to load after retries");
}

/**
 * Tear down the SDK singleton when leaving a host (Plain ↔ R3F).
 * Without this, switching tabs leaves a half-dead renderer and the room never returns
 * until a full page reload.
 */
export function releaseLccSdk(): void {
  if (typeof window === "undefined") return;
  const g = window as unknown as { LCC?: LccGlobal };
  try {
    g.LCC?.LCCRender?.dispose();
  } catch {
    /* ignore */
  }
  g.LCC = undefined;
  cached = null;
  sdkEpoch += 1;
  document.querySelectorAll('script[data-lcc-sdk="1"]').forEach((node) => node.remove());
}

export function absoluteDataUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
