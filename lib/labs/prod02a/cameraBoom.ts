import * as THREE from "three";
import type { LccObject } from "@/lib/labs/lccSdk";

/**
 * Shared camera-boom probe used by PROD-02A and PROD-01 TourHost.
 * Sphere samples + offset rays; returns farthest safe point along target→desired.
 */
export function resolveCameraBoomAlong(
  lcc: LccObject | null,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  opts?: { enabled?: boolean; hasCollision?: boolean },
): {
  safePoint: THREE.Vector3;
  hit: boolean;
  hitPoint: THREE.Vector3 | null;
  safeDistance: number;
} {
  const clear = {
    safePoint: to.clone(),
    hit: false,
    hitPoint: null as THREE.Vector3 | null,
    safeDistance: from.distanceTo(to),
  };
  if (!lcc || opts?.enabled === false || !opts?.hasCollision) return clear;

  const boomDir = new THREE.Vector3().subVectors(to, from);
  const fullDist = boomDir.length();
  if (fullDist < 1e-4) return clear;
  boomDir.multiplyScalar(1 / fullDist);

  const startPad = Math.min(0.12, fullDist * 0.15);
  const boomFrom = from.clone().addScaledVector(boomDir, startPad);
  const travel = Math.max(0.05, fullDist - startPad);

  let bestDist = travel;
  let hit = false;
  let hitPoint: THREE.Vector3 | null = null;
  const probe = new THREE.Vector3();
  const hitTmp = new THREE.Vector3();

  if (lcc.intersectsSphere) {
    const steps = Math.max(6, Math.ceil(travel / Math.max(0.06, radius * 0.85)));
    for (let i = 1; i <= steps; i++) {
      const d = (travel * i) / steps;
      probe.copy(boomFrom).addScaledVector(boomDir, d);
      const sphereHit = lcc.intersectsSphere!({
        center: { x: probe.x, y: probe.y, z: probe.z },
        radius,
        noDelta: true,
      });
      if (sphereHit?.hit) {
        hit = true;
        bestDist = Math.max(0.05, d - radius);
        hitPoint = probe.clone();
        break;
      }
    }
  }

  if (lcc.intersectsRayFromOriginExt) {
    const offsets: Array<[number, number, number]> = [
      [0, 0, 0],
      [radius, 0, 0],
      [-radius, 0, 0],
      [0, radius, 0],
      [0, -radius * 0.5, 0],
    ];
    const up = Math.abs(boomDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(boomDir, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, boomDir).normalize();

    for (const [ox, oy, oz] of offsets) {
      const origin = {
        x: boomFrom.x + right.x * ox + up2.x * oy + boomDir.x * oz,
        y: boomFrom.y + right.y * ox + up2.y * oy + boomDir.y * oz,
        z: boomFrom.z + right.z * ox + up2.z * oy + boomDir.z * oz,
      };
      const rayHit = lcc.intersectsRayFromOriginExt({
        origin,
        direction: { x: boomDir.x, y: boomDir.y, z: boomDir.z },
        maxDistance: travel,
      });
      if (rayHit?.point) {
        hitTmp.set(rayHit.point.x, rayHit.point.y, rayHit.point.z);
        const d = boomFrom.distanceTo(hitTmp);
        if (d < bestDist) {
          hit = true;
          bestDist = d;
          hitPoint = hitTmp.clone();
        }
      }
    }
  }

  if (!hit) return clear;
  const safeDistance = startPad + bestDist;
  probe.copy(from).addScaledVector(boomDir, safeDistance);
  return { safePoint: probe.clone(), hit: true, hitPoint, safeDistance };
}
