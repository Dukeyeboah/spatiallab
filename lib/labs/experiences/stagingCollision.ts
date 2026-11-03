import * as THREE from "three";

/**
 * Lightweight oriented-box proxies for staged furniture (EXP-04B).
 * Kept separate from visual meshes — debug wireframes optional.
 */

export type FurnitureCollisionProxy = {
  id: string;
  /** World-space centre of the OBB. */
  center: THREE.Vector3;
  /** Local half-extents (metres). */
  halfSize: THREE.Vector3;
  /** World orientation. */
  quaternion: THREE.Quaternion;
  /** Capsule Y-range overlap uses these world min/max Y. */
  minY: number;
  maxY: number;
};

const _invQ = new THREE.Quaternion();
const _local = new THREE.Vector3();
const _push = new THREE.Vector3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _box = new THREE.Box3();
const _invMat = new THREE.Matrix4();
const _tmpBox = new THREE.Box3();

/** Shrink proxy slightly so thin legs don't block as wide as the full AABB. */
const SHRINK = 0.88;
/** Extra horizontal padding so the player capsule does not clip into mesh. */
const PAD = 0.04;

/**
 * Build an OBB proxy from a staged root Object3D (already in world).
 * Uses local-space bounds of meshes transformed into the root's frame → oriented box.
 */
export function buildProxyFromObject(id: string, root: THREE.Object3D): FurnitureCollisionProxy | null {
  root.updateMatrixWorld(true);
  _invMat.copy(root.matrixWorld).invert();
  _box.makeEmpty();
  let any = false;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const gb = m.geometry.boundingBox;
    if (!gb) return;
    _tmpBox.copy(gb).applyMatrix4(m.matrixWorld).applyMatrix4(_invMat);
    _box.union(_tmpBox);
    any = true;
  });
  if (!any || _box.isEmpty()) return null;

  _box.getSize(_size);
  _box.getCenter(_center);
  // Shrink XZ more than Y so seat height stays honest
  const half = new THREE.Vector3(
    Math.max(0.05, (_size.x * 0.5) * SHRINK) + PAD,
    Math.max(0.05, _size.y * 0.5),
    Math.max(0.05, (_size.z * 0.5) * SHRINK) + PAD,
  );
  const centerWorld = _center.clone().applyMatrix4(root.matrixWorld);
  const q = new THREE.Quaternion();
  root.getWorldQuaternion(q);
  return {
    id,
    center: centerWorld,
    halfSize: half,
    quaternion: q,
    minY: centerWorld.y - half.y,
    maxY: centerWorld.y + half.y,
  };
}

/**
 * If a vertical capsule (eye at `eye`, radius `radius`, foot clearance) intersects the OBB,
 * return a horizontal depenetration delta in world XZ (Y untouched).
 */
export function capsuleDepenetrateXZ(
  eye: THREE.Vector3,
  radius: number,
  footY: number,
  headY: number,
  proxy: FurnitureCollisionProxy,
): THREE.Vector3 | null {
  // Vertical overlap (capsule vs furniture height)
  if (headY < proxy.minY || footY > proxy.maxY) return null;

  _invQ.copy(proxy.quaternion).invert();
  _local.copy(eye).sub(proxy.center).applyQuaternion(_invQ);

  const hx = proxy.halfSize.x + radius;
  const hz = proxy.halfSize.z + radius;
  const insideX = Math.abs(_local.x) <= hx;
  const insideZ = Math.abs(_local.z) <= hz;
  if (!insideX || !insideZ) return null;

  // Push out along the shallowest axis in local XZ
  const penX = hx - Math.abs(_local.x);
  const penZ = hz - Math.abs(_local.z);
  _push.set(0, 0, 0);
  if (penX < penZ) {
    _push.x = Math.sign(_local.x || 1) * penX;
  } else {
    _push.z = Math.sign(_local.z || 1) * penZ;
  }
  _push.applyQuaternion(proxy.quaternion);
  _push.y = 0;
  return _push.clone();
}

/**
 * Axis-separated slide against all furniture proxies (after environmental resolve).
 * Does not alter Y (floor stays LCC’s job). Skips when no proxies.
 */
export function resolveFurnitureSlide(
  from: THREE.Vector3,
  to: THREE.Vector3,
  proxies: FurnitureCollisionProxy[],
  radius: number,
  eyeHeight: number,
  footClearance: number,
): THREE.Vector3 {
  if (!proxies.length) return to;

  const footY = to.y - eyeHeight + footClearance;
  const headY = to.y + 0.08;

  let x = to.x;
  let z = from.z;
  let y = to.y;

  const tryAxis = (nx: number, nz: number) => {
    const eye = new THREE.Vector3(nx, y, nz);
    let cx = nx;
    let cz = nz;
    for (const p of proxies) {
      const d = capsuleDepenetrateXZ(eye.set(cx, y, cz), radius, footY, headY, p);
      if (d) {
        cx += d.x;
        cz += d.z;
        eye.set(cx, y, cz);
      }
    }
    // If still deeply inside any proxy, revert this axis
    for (const p of proxies) {
      const d = capsuleDepenetrateXZ(eye.set(cx, y, cz), radius, footY, headY, p);
      if (d && Math.hypot(d.x, d.z) > 0.4) {
        return { x: from.x, z: from.z, failed: true as const };
      }
    }
    return { x: cx, z: cz, failed: false as const };
  };

  let step = tryAxis(x, z);
  if (step.failed) {
    x = from.x;
    z = from.z;
  } else {
    x = step.x;
    z = step.z;
  }

  z = to.z;
  step = tryAxis(x, z);
  if (step.failed) {
    return new THREE.Vector3(from.x, y, from.z);
  }
  return new THREE.Vector3(step.x, y, step.z);
}

type CapsuleHit = {
  hit?: boolean;
  delta?: { x?: number; y?: number; z?: number };
};

type LccCapsuleApi = {
  intersectsCapsule?: (param: {
    start: { x: number; y: number; z: number };
    end: { x: number; y: number; z: number };
    radius: number;
  }) => CapsuleHit | null | undefined;
};

/**
 * Keep a staged object from sinking into LCC environment collision while translating.
 * Samples a vertical capsule at the proxy centre (footprint radius). Applies horizontal delta only.
 * Returns true if a correction was applied.
 */
export function constrainFurnitureAgainstEnvironment(
  obj: THREE.Object3D,
  lcc: LccCapsuleApi | null | undefined,
): boolean {
  if (!lcc?.intersectsCapsule) return false;
  const proxy = buildProxyFromObject("tmp", obj);
  if (!proxy) return false;

  const radius = Math.max(0.12, Math.max(proxy.halfSize.x, proxy.halfSize.z) * 0.82);
  const y0 = proxy.minY + 0.12;
  const y1 = Math.min(proxy.maxY - 0.05, y0 + 1.55);

  // Centre + 4 footprint offsets (local XZ → world) for better wall contact than a single sample
  const offsets: [number, number][] = [
    [0, 0],
    [proxy.halfSize.x * 0.65, 0],
    [-proxy.halfSize.x * 0.65, 0],
    [0, proxy.halfSize.z * 0.65],
    [0, -proxy.halfSize.z * 0.65],
  ];

  let dx = 0;
  let dz = 0;
  let hits = 0;
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  for (const [lx, lz] of offsets) {
    local.set(lx, 0, lz).applyQuaternion(proxy.quaternion);
    world.set(proxy.center.x + local.x, 0, proxy.center.z + local.z);
    const hit = lcc.intersectsCapsule({
      start: { x: world.x, y: y0, z: world.z },
      end: { x: world.x, y: y1, z: world.z },
      radius,
    });
    if (hit?.hit) {
      dx += hit.delta?.x ?? 0;
      dz += hit.delta?.z ?? 0;
      hits += 1;
    }
  }
  if (!hits) return false;
  obj.position.x += dx / hits;
  obj.position.z += dz / hits;
  return true;
}

/** Debug wireframe box matching a proxy (Dev only). */
export function createProxyDebugMesh(proxy: FurnitureCollisionProxy): THREE.LineSegments {
  const geo = new THREE.BoxGeometry(proxy.halfSize.x * 2, proxy.halfSize.y * 2, proxy.halfSize.z * 2);
  const edges = new THREE.EdgesGeometry(geo);
  geo.dispose();
  const lines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.85, depthTest: false }),
  );
  lines.position.copy(proxy.center);
  lines.quaternion.copy(proxy.quaternion);
  lines.userData.stagingProxyId = proxy.id;
  lines.renderOrder = 10;
  return lines;
}
