import * as THREE from "three";
import { defaultLccModelMatrixElements } from "@/lib/labs/lccSdk";

/**
 * Interior viewpoint for LCC samples.
 *
 * `getBounds()` often includes a huge environment shell, so framing the AABB
 * puts the camera on the edge of the outdoor/sky volume. Capture poses in
 * `info/poses.json` sit inside the scanned space — prefer those.
 */

export type InteriorView = {
  eye: THREE.Vector3;
  target: THREE.Vector3;
  source: "poses" | "fallback";
};

/** Apply the same modelMatrix as LCCRender.load (LCC Z-up → Three Y-up). */
export function lccPointToThree(x: number, y: number, z: number, matrix = new THREE.Matrix4().fromArray(defaultLccModelMatrixElements())): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(matrix);
}

function posesUrlFromMeta(dataPath: string): string | null {
  try {
    const url = dataPath.startsWith("http") ? new URL(dataPath) : new URL(dataPath, typeof window !== "undefined" ? window.location.origin : "http://local");
    // …/Something/meta.lcc2 → …/Something/info/poses.json
    const parts = url.pathname.split("/");
    const file = parts.pop() ?? "";
    if (!/\.lcc2?$/i.test(file) && file !== "meta.lcc" && file !== "meta.lcc2") {
      // still try sibling info/
    }
    parts.push("info", "poses.json");
    url.pathname = parts.join("/");
    return url.toString();
  } catch {
    return null;
  }
}

type PoseRow = { T?: number[]; R?: number[] };

/** Build an interior eye/target from capture poses, or a modest fallback near the origin. */
export async function resolveInteriorView(dataPath: string): Promise<InteriorView> {
  const posesUrl = posesUrlFromMeta(dataPath);
  if (posesUrl) {
    try {
      const res = await fetch(posesUrl);
      if (res.ok) {
        const json = (await res.json()) as { poses?: PoseRow[] } | PoseRow[];
        const rows = Array.isArray(json) ? json : (json.poses ?? []);
        const translations = rows.map((p) => p.T).filter((t): t is number[] => Array.isArray(t) && t.length >= 3);
        if (translations.length >= 8) {
          const worlds = translations.map((t) => lccPointToThree(t[0], t[1], t[2]));
          const sorted = (axis: "x" | "y" | "z") => [...worlds].sort((a, b) => a[axis] - b[axis]);
          const mid = (axis: "x" | "y" | "z") => {
            const s = sorted(axis);
            const m = s[Math.floor(s.length / 2)];
            return m[axis];
          };
          // Median of capture positions ≈ middle of the walked room.
          const eye = new THREE.Vector3(mid("x"), mid("y"), mid("z"));
          // Nudge eye height slightly if the scanner was very low.
          if (eye.y < 0.8) eye.y = 1.35;

          const mean = worlds.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / worlds.length);
          let forward = mean.clone().sub(eye);
          if (forward.lengthSq() < 0.05) {
            // Pose cloud collapsed — look along −Z in Three space.
            forward.set(0, 0, -1);
          } else {
            forward.y = 0;
            if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
            else forward.normalize();
          }
          const target = eye.clone().add(forward.multiplyScalar(2.5));
          target.y = eye.y - 0.15;
          return { eye, target, source: "poses" };
        }
      }
    } catch {
      /* fall through */
    }
  }

  // Fallback: stand near the origin looking slightly forward (SDK sample style).
  return {
    eye: new THREE.Vector3(0, 1.55, 0.5),
    target: new THREE.Vector3(0, 1.4, -2.5),
    source: "fallback",
  };
}

export function applyInteriorView(
  camera: THREE.PerspectiveCamera,
  orbit: { target: THREE.Vector3; update: () => void },
  fpsLookAt: (v: THREE.Vector3) => void,
  view: InteriorView,
) {
  camera.position.copy(view.eye);
  orbit.target.copy(view.target);
  orbit.update();
  camera.lookAt(view.target);
  fpsLookAt(view.target);
}
