"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  absoluteDataUrl,
  defaultLccModelMatrixElements,
  importLccSdk,
  releaseLccSdk,
  type LccObject,
  type LCCRenderType,
} from "@/lib/labs/lccSdk";
import { applyInteriorView, resolveInteriorView } from "@/lib/labs/lccInteriorView";
import { LccWalkControls } from "@/lib/labs/lccWalkControls";
import {
  DEFAULT_SMOOTH_TUNING,
  SmoothAvatarControls,
  type SmoothDebugSnapshot,
  type SmoothNavTuning,
} from "@/lib/labs/prod02a/smoothAvatarControls";
import type { Prod02aQualityPreset } from "@/lib/labs/prod02a/qualityPresets";
import type { Prod02aStartPose } from "@/lib/labs/prod02a/assets";

export type Prod02aNavKind = "current" | "smooth" | "orbit";

export type Prod02aHostStats = {
  phase: "idle" | "loading" | "ready" | "error";
  progress: number;
  fps: number;
  hasCollision: boolean;
  collisionActive: boolean;
  metaSummary: string | null;
  error: string | null;
  format: "lcc2" | "lcc" | "unknown";
  camera?: SmoothDebugSnapshot | null;
};

export type Prod02aHostHandle = {
  setVirtualMove: (x: number, z: number) => void;
  setVirtualLook: (yaw: number, pitch: number) => void;
  applyLookDelta: (dx: number, dy: number, sensitivity?: number) => void;
  clearMoveIntent: () => void;
  clearVirtualInput: () => void;
  cancelAutoMove: () => void;
  setFov: (fov: number) => void;
  getFov: () => number;
  getCameraDebug: () => SmoothDebugSnapshot | null;
};

type Props = {
  dataPath: string;
  navKind: Prod02aNavKind;
  quality: Prod02aQualityPreset;
  tuning: SmoothNavTuning;
  collisionEnabled: boolean;
  showCapsule: boolean;
  showCameraDebug?: boolean;
  /** Suppress canvas touch-look so mobile overlays own look (mouse still works). */
  suppressTouchLook?: boolean;
  fov: number;
  /** Prefer over poses.json (fixes Ground exterior spawn). */
  startPose?: Prod02aStartPose | null;
  onStats?: (s: Prod02aHostStats) => void;
  onReady?: () => void;
  onPreferredDistanceChange?: (distance: number) => void;
};

const FALLBACK_EYE = new THREE.Vector3(0, 1.5, 0.5);
const FALLBACK_TARGET = new THREE.Vector3(0, 1.35, -2.5);
const CAPSULE_RADIUS = 0.22;
const CAPSULE_FOOT_CLEARANCE = 0.35;

/**
 * Isolated PROD-02A Three.js + LCC host.
 * Does not share state with ExperienceTourHost / property player.
 */
export const Prod02aHost = forwardRef<Prod02aHostHandle, Props>(function Prod02aHost(
  {
    dataPath,
    navKind,
    quality,
    tuning,
    collisionEnabled,
    showCapsule,
    showCameraDebug = false,
    suppressTouchLook = false,
    fov,
    startPose = null,
    onStats,
    onReady,
    onPreferredDistanceChange,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const navKindRef = useRef(navKind);
  const qualityRef = useRef(quality);
  const tuningRef = useRef(tuning);
  const collisionRef = useRef(collisionEnabled);
  const showCapsuleRef = useRef(showCapsule);
  const showCameraDebugRef = useRef(showCameraDebug);
  const suppressTouchLookRef = useRef(suppressTouchLook);
  const startPoseRef = useRef(startPose);
  const onStatsRef = useRef(onStats);
  const onReadyRef = useRef(onReady);
  const onPreferredDistanceChangeRef = useRef(onPreferredDistanceChange);
  navKindRef.current = navKind;
  qualityRef.current = quality;
  tuningRef.current = tuning;
  collisionRef.current = collisionEnabled;
  showCapsuleRef.current = showCapsule;
  showCameraDebugRef.current = showCameraDebug;
  suppressTouchLookRef.current = suppressTouchLook;
  startPoseRef.current = startPose;
  onStatsRef.current = onStats;
  onReadyRef.current = onReady;
  onPreferredDistanceChangeRef.current = onPreferredDistanceChange;

  const apiRef = useRef<{
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    walk: LccWalkControls;
    smooth: SmoothAvatarControls;
    orbit: OrbitControls;
    lcc: LccObject | null;
    LCCRender: LCCRenderType | null;
    hasCollision: boolean;
    eyeHeight: number;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    setVirtualMove: (x, z) => {
      const api = apiRef.current;
      if (!api || navKindRef.current === "orbit") return;
      if (navKindRef.current === "smooth") api.smooth.setVirtualMove(x, z);
      else api.walk.setVirtualMove(x, z);
    },
    setVirtualLook: (yaw, pitch) => {
      const api = apiRef.current;
      if (!api || navKindRef.current === "orbit") return;
      if (navKindRef.current === "smooth") api.smooth.setVirtualLook(yaw, pitch);
      else api.walk.setVirtualLook(yaw, pitch);
    },
    applyLookDelta: (dx, dy, sensitivity = 1) => {
      const api = apiRef.current;
      if (!api || navKindRef.current === "orbit") return;
      if (navKindRef.current === "smooth") api.smooth.applyLookDelta(dx, dy, sensitivity);
      else api.walk.applyLookDelta(dx, dy, sensitivity);
    },
    clearMoveIntent: () => {
      apiRef.current?.walk.clearMoveIntent();
      apiRef.current?.smooth.clearMoveIntent();
    },
    clearVirtualInput: () => {
      apiRef.current?.walk.clearVirtualInput();
      apiRef.current?.smooth.clearVirtualInput();
    },
    cancelAutoMove: () => {
      apiRef.current?.walk.cancelMoveTarget();
    },
    setFov: (v) => {
      const api = apiRef.current;
      if (!api) return;
      api.camera.fov = v;
      api.camera.updateProjectionMatrix();
    },
    getFov: () => apiRef.current?.camera.fov ?? 65,
    getCameraDebug: () =>
      apiRef.current && navKindRef.current === "smooth"
        ? apiRef.current.smooth.getDebugSnapshot()
        : null,
  }));

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const useSmooth = navKind === "smooth";
    const useOrbit = navKind === "orbit";
    const useCurrent = navKind === "current";
    api.smooth.enabled = useSmooth;
    api.walk.enabled = useCurrent;
    api.orbit.enabled = useOrbit;
    api.orbit.enableDamping = true;
    api.orbit.dampingFactor = 0.08;
    if (useSmooth) {
      api.smooth.tuning = { ...tuningRef.current };
      api.smooth.syncFromCamera();
      api.walk.cancelMoveTarget();
    } else if (useCurrent) {
      api.smooth.cancelMotion();
      api.walk.syncFromCamera();
    } else {
      // Orbit: leave camera where it is; set target ahead of look
      api.smooth.cancelMotion();
      api.walk.clearVirtualInput();
      const dir = new THREE.Vector3();
      api.camera.getWorldDirection(dir);
      api.orbit.target.copy(api.camera.position).addScaledVector(dir, 2.5);
      api.orbit.update();
    }
  }, [navKind]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.smooth.tuning = { ...tuning };
    api.smooth.showCapsule = showCapsule && navKindRef.current === "smooth";
    api.smooth.showDebug = showCameraDebug && navKindRef.current === "smooth";
    api.smooth.suppressTouchLook = suppressTouchLook;
    api.walk.suppressTouchLook = suppressTouchLook;
    api.walk.eyeHeight = tuning.eyeHeight;
  }, [tuning, showCapsule, showCameraDebug, suppressTouchLook]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api?.lcc) return;
    applyQuality(api.lcc, quality);
    api.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap),
    );
  }, [quality]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.camera.fov = fov;
    api.camera.updateProjectionMatrix();
  }, [fov]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let raf = 0;
    let frames = 0;
    let lastFpsAt = performance.now();
    let fps = 0;
    let progress = 0;
    let phase: Prod02aHostStats["phase"] = "idle";
    let error: string | null = null;
    let metaSummary: string | null = null;
    let hasCollision = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c0c);
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 150000);
    camera.position.copy(FALLBACK_EYE);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    const applyDpr = () => {
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, qualityRef.current.pixelRatioCap),
      );
    };
    applyDpr();
    renderer.setClearColor(0x0c0c0c);
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 0.35s ease";
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enabled = false;
    orbit.target.copy(FALLBACK_TARGET);

    const walk = new LccWalkControls(camera, renderer.domElement);
    walk.enabled = false;
    walk.eyeHeight = DEFAULT_SMOOTH_TUNING.eyeHeight;
    walk.lockEyeHeight = true;

    const smooth = new SmoothAvatarControls(camera, renderer.domElement);
    smooth.enabled = false;
    smooth.tuning = { ...tuningRef.current };
    smooth.suppressTouchLook = suppressTouchLookRef.current;
    walk.suppressTouchLook = suppressTouchLookRef.current;
    smooth.onPreferredDistanceChange = (d) => onPreferredDistanceChangeRef.current?.(d);
    scene.add(smooth.capsuleMesh);
    scene.add(smooth.debugGroup);

    const clock = new THREE.Clock();
    let lcc: LccObject | null = null;
    let LCCRender: LCCRenderType | null = null;

    const isLcc2 = dataPath.toLowerCase().endsWith(".lcc2");
    const format: Prod02aHostStats["format"] = isLcc2
      ? "lcc2"
      : dataPath.toLowerCase().endsWith(".lcc")
        ? "lcc"
        : "unknown";

    const pushStats = () => {
      onStatsRef.current?.({
        phase,
        progress,
        fps,
        hasCollision,
        collisionActive: collisionRef.current && hasCollision,
        metaSummary,
        error,
        format,
        camera:
          navKindRef.current === "smooth" && smooth.enabled
            ? smooth.getDebugSnapshot()
            : null,
      });
    };

    const capsuleAt = (x: number, y: number, z: number, eye: number) => ({
      start: { x, y: y - eye + CAPSULE_FOOT_CLEARANCE, z },
      end: { x, y: y + 0.08, z },
      radius: CAPSULE_RADIUS,
    });

    const resolveCollision = (from: THREE.Vector3, to: THREE.Vector3) => {
      if (!lcc || !collisionRef.current || !hasCollision || !lcc.intersectsCapsule) {
        return to.clone();
      }
      const eye = tuningRef.current.eyeHeight;
      let x = to.x;
      let z = to.z;
      const y = from.y;

      const slide = (nx: number, nz: number) => {
        const hit = lcc!.intersectsCapsule!(capsuleAt(nx, y, nz, eye));
        if (!hit?.hit) return { x: nx, z: nz };
        return { x: nx + (hit.delta.x || 0), z: nz + (hit.delta.z || 0) };
      };

      z = from.z;
      let s = slide(x, z);
      x = s.x;
      z = to.z;
      s = slide(x, z);
      x = s.x;
      z = s.z;

      let yOut = y;
      if (lcc.intersectsRayFromOriginExt) {
        const floorHit = lcc.intersectsRayFromOriginExt({
          origin: { x, y: y + 0.4, z },
          direction: { x: 0, y: -1, z: 0 },
          maxDistance: 3.5,
        });
        if (floorHit?.point) {
          yOut = floorHit.point.y + eye;
        }
      }
      return new THREE.Vector3(x, yOut, z);
    };

    const boomFrom = new THREE.Vector3();
    const boomTo = new THREE.Vector3();
    const boomDir = new THREE.Vector3();
    const boomProbe = new THREE.Vector3();
    const boomHit = new THREE.Vector3();
    const resolveCameraBoom = (
      from: THREE.Vector3,
      to: THREE.Vector3,
      radius: number,
    ) => {
      const clear = {
        safePoint: to.clone(),
        hit: false,
        hitPoint: null as THREE.Vector3 | null,
        safeDistance: from.distanceTo(to),
      };
      if (!lcc || !collisionRef.current || !hasCollision) return clear;
      if (!tuningRef.current.cameraCollisionEnabled) return clear;

      boomDir.subVectors(to, from);
      const fullDist = boomDir.length();
      if (fullDist < 1e-4) return clear;
      boomDir.multiplyScalar(1 / fullDist);

      // Start slightly off the target to avoid self-hits on floor/body proxies
      const startPad = Math.min(0.12, fullDist * 0.15);
      boomFrom.copy(from).addScaledVector(boomDir, startPad);
      const travel = Math.max(0.05, fullDist - startPad);

      let bestDist = travel;
      let hit = false;
      let hitPoint: THREE.Vector3 | null = null;

      // Sphere samples along the boom (swept volume approximation)
      if (lcc.intersectsSphere) {
        const steps = Math.max(6, Math.ceil(travel / Math.max(0.06, radius * 0.85)));
        for (let i = 1; i <= steps; i++) {
          const d = (travel * i) / steps;
          boomProbe.copy(boomFrom).addScaledVector(boomDir, d);
          const sphereHit = lcc.intersectsSphere!({
            center: { x: boomProbe.x, y: boomProbe.y, z: boomProbe.z },
            radius,
            noDelta: true,
          });
          if (sphereHit?.hit) {
            hit = true;
            bestDist = Math.max(0.05, d - radius);
            boomHit.copy(boomProbe);
            hitPoint = boomHit.clone();
            break;
          }
        }
      }

      // Center + offset rays as fallback / reinforcement (corners)
      if (lcc.intersectsRayFromOriginExt) {
        const offsets: Array<[number, number, number]> = [
          [0, 0, 0],
          [radius, 0, 0],
          [-radius, 0, 0],
          [0, radius, 0],
          [0, -radius * 0.5, 0],
        ];
        // Build orthonormal basis for offsets
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
            boomTo.set(rayHit.point.x, rayHit.point.y, rayHit.point.z);
            const d = boomFrom.distanceTo(boomTo);
            if (d < bestDist) {
              hit = true;
              bestDist = d;
              hitPoint = boomTo.clone();
            }
          }
        }
      }

      if (!hit) return clear;
      const safeDistance = startPad + bestDist;
      boomProbe.copy(from).addScaledVector(boomDir, safeDistance);
      return {
        safePoint: boomProbe.clone(),
        hit: true,
        hitPoint,
        safeDistance,
      };
    };

    walk.resolveCollision = resolveCollision;
    smooth.resolveCollision = resolveCollision;
    smooth.resolveCameraBoom = resolveCameraBoom;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    apiRef.current = {
      camera,
      renderer,
      walk,
      smooth,
      orbit,
      lcc: null,
      LCCRender: null,
      hasCollision: false,
      eyeHeight: DEFAULT_SMOOTH_TUNING.eyeHeight,
    };

    const applyNav = () => {
      const kind = navKindRef.current;
      smooth.enabled = kind === "smooth";
      walk.enabled = kind === "current";
      orbit.enabled = kind === "orbit";
      smooth.showCapsule = showCapsuleRef.current && kind === "smooth";
      if (kind === "orbit") {
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.08;
      }
    };

    void (async () => {
      try {
        phase = "loading";
        pushStats();
        const sdk = await importLccSdk();
        if (cancelled) return;
        LCCRender = sdk.LCCRender;
        const renderApi = LCCRender;
        renderApi.setWriteDepth?.(true);
        if (apiRef.current) apiRef.current.LCCRender = renderApi;

        const path = absoluteDataUrl(dataPath);
        const modelMatrix = new THREE.Matrix4().fromArray(defaultLccModelMatrixElements());

        lcc = renderApi.load(
          {
            camera,
            scene,
            renderLib: THREE,
            renderer,
            canvas: renderer.domElement,
            dataPath: path,
            useEnv: true,
            useIndexDB: true,
            useLoadingEffect: false,
            modelMatrix,
            appKey: null,
            usePage: isLcc2,
            usePrecisionRaycast: true,
          },
          () => {
            if (cancelled || !lcc) return;
            phase = "ready";
            try {
              const meta = lcc.getMeta();
              metaSummary = meta
                ? `${String(meta.name ?? meta.fileType ?? "model")} · ${String(meta.totalSplats ?? "?")} splats`
                : "meta unavailable";
              hasCollision = !!lcc.hasCollision?.();
              if (apiRef.current) {
                apiRef.current.lcc = lcc;
                apiRef.current.hasCollision = hasCollision;
              }
              applyQuality(lcc, qualityRef.current);
              applyDpr();

              const finish = (eye: THREE.Vector3, target: THREE.Vector3) => {
                applyInteriorView(camera, orbit, (t) => {
                  camera.lookAt(t);
                }, { eye, target, source: "fallback" });
                walk.syncFromCamera();
                smooth.syncFromCamera();
                applyNav();
                try {
                  renderer.render(scene, camera);
                } catch {
                  /* ignore */
                }
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => {
                  if (cancelled) return;
                  try {
                    LCCRender?.update();
                    renderer.render(scene, camera);
                  } catch {
                    /* ignore */
                  }
                  renderer.domElement.style.opacity = "1";
                  pushStats();
                  onReadyRef.current?.();
                }, 1400);
              };

              const authored = startPoseRef.current;
              if (authored) {
                if (authored.eyeHeight != null) {
                  walk.eyeHeight = authored.eyeHeight;
                  smooth.tuning = { ...smooth.tuning, eyeHeight: authored.eyeHeight };
                  tuningRef.current = { ...tuningRef.current, eyeHeight: authored.eyeHeight };
                }
                finish(
                  new THREE.Vector3(authored.eye[0], authored.eye[1], authored.eye[2]),
                  new THREE.Vector3(authored.target[0], authored.target[1], authored.target[2]),
                );
              } else {
                void resolveInteriorView(path).then((view) => {
                  if (cancelled) return;
                  finish(view.eye, view.target);
                });
              }
            } catch (err) {
              metaSummary = (err as Error).message;
            }
            pushStats();
          },
          (p) => {
            progress = p;
            if (p === 0 || p >= 0.99 || Math.abs(p - progress) > 0.03) pushStats();
          },
          () => {
            phase = "error";
            error = "Failed to load LCC package (check v1-lcc2 extract).";
            renderer.domElement.style.opacity = "1";
            pushStats();
          },
        );
        if (apiRef.current) apiRef.current.lcc = lcc;
      } catch (err) {
        phase = "error";
        error = (err as Error).message;
        pushStats();
      }
    })();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      frames += 1;
      const now = performance.now();
      if (now - lastFpsAt >= 500) {
        fps = Math.round((frames * 1000) / (now - lastFpsAt));
        frames = 0;
        lastFpsAt = now;
        pushStats();
      }
      const kind = navKindRef.current;
      if (kind === "smooth") {
        // Tuning is synced from React via effect (keeps wheel-adjusted preferredDistance).
        smooth.showCapsule = showCapsuleRef.current;
        smooth.showDebug = showCameraDebugRef.current;
        smooth.update(dt);
      } else if (kind === "current") {
        walk.update(dt);
      } else {
        orbit.update();
      }
      try {
        LCCRender?.update();
      } catch {
        /* ignore */
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      walk.dispose();
      smooth.dispose();
      orbit.dispose();
      if (LCCRender && lcc) {
        try {
          LCCRender.unload(lcc);
        } catch {
          /* ignore */
        }
      }
      releaseLccSdk();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataPath]);

  return <div ref={mountRef} className="p2a-canvas" />;
});

function applyQuality(lcc: LccObject, q: Prod02aQualityPreset) {
  try {
    lcc.setMaxSplats?.(q.maxSplats);
    lcc.setMaxDistance?.(q.maxDistance);
    lcc.setSmooth?.(q.lodSmooth);
    lcc.setLodAutoLevelUp?.(true);
  } catch {
    /* ignore */
  }
}
