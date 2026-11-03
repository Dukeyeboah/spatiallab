import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { StagingAssetRef } from "./stagingTypes";

/** Target largest dimension for furniture when auto-fitting oversized assets (metres). */
export const STAGING_FIT_MAX_M = 1.05;
/** If longest bbox edge exceeds this (m), treat as wrong units and auto-fit. */
export const STAGING_OVERSIZE_M = 4;

/** Procedural test chair (~0.45 m wide, feet at y=0). Original geometry — free to use. */
export function createBuiltinChair(): THREE.Group {
  const group = new THREE.Group();
  group.name = "builtin-simple-chair";
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8b6914,
    roughness: 0.55,
    metalness: 0.05,
  });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.45), mat);
  seat.position.set(0, 0.45, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.06), mat);
  back.position.set(0, 0.72, -0.195);
  const legGeo = new THREE.BoxGeometry(0.05, 0.42, 0.05);
  for (const [x, y, z] of [
    [-0.18, 0.21, -0.18],
    [0.18, 0.21, -0.18],
    [-0.18, 0.21, 0.18],
    [0.18, 0.21, 0.18],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(x, y, z);
    group.add(leg);
  }
  group.add(seat, back);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.userData.stagingPick = true;
    }
  });
  return group;
}

export function measureObject(root: THREE.Object3D): { size: THREE.Vector3; center: THREE.Vector3 } {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return { size, center };
}

/** Ground the model so its bounding-box min Y sits at local y=0. */
export function groundObjectToFeet(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (!Number.isFinite(box.min.y)) return;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
}

/**
 * Many DCC exports use cm/mm as “1 unit”. If the asset is huge in metres,
 * scale it so the longest edge ≈ STAGING_FIT_MAX_M. Returns the uniform scale applied to `inner`.
 */
export function normalizeFurnitureScale(inner: THREE.Object3D): { applied: number; rawMax: number } {
  inner.updateMatrixWorld(true);
  const { size } = measureObject(inner);
  const rawMax = Math.max(size.x, size.y, size.z);
  if (!(rawMax > STAGING_OVERSIZE_M) || !(rawMax > 1e-6)) {
    return { applied: 1, rawMax };
  }
  const applied = STAGING_FIT_MAX_M / rawMax;
  inner.scale.multiplyScalar(applied);
  inner.updateMatrixWorld(true);
  return { applied, rawMax };
}

export type LoadedStagingObject = {
  object: THREE.Object3D;
  /** True when we auto-scaled a cm/mm-sized asset into metres. */
  autoFitted: boolean;
  rawMaxM: number;
  fitScale: number;
};

function markPickable(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.userData.stagingPick = true;
  });
}

function wrapNormalized(inner: THREE.Object3D): LoadedStagingObject {
  const wrapper = new THREE.Group();
  wrapper.name = "staging-asset";
  wrapper.add(inner);
  const { applied, rawMax } = normalizeFurnitureScale(inner);
  groundObjectToFeet(wrapper);
  markPickable(wrapper);
  return {
    object: wrapper,
    autoFitted: applied !== 1,
    rawMaxM: rawMax,
    fitScale: applied,
  };
}

const loader = typeof window !== "undefined" ? new GLTFLoader() : null;

export async function loadStagingObject(
  asset: StagingAssetRef,
  resolveIdbUrl: (assetId: string) => Promise<string | null>,
): Promise<LoadedStagingObject> {
  if (asset.kind === "builtin") {
    const g = createBuiltinChair();
    groundObjectToFeet(g);
    markPickable(g);
    return { object: g, autoFitted: false, rawMaxM: 0.72, fitScale: 1 };
  }
  if (!loader) throw new Error("GLTFLoader unavailable");
  let url: string | null = null;
  let revoke: string | null = null;
  if (asset.kind === "public") {
    url = asset.publicUrl;
  } else {
    url = await resolveIdbUrl(asset.assetId);
    revoke = url;
  }
  if (!url) throw new Error("Missing GLB asset bytes — re-upload the model.");
  try {
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene || gltf.scenes[0];
    // Clone so multiple placements don't share one scene graph
    const inner = root.clone(true);
    return wrapNormalized(inner);
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }
}
