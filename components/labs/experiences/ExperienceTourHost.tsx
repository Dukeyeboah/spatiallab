"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { QualityPreset } from "@/lib/labs/experiences/qualityPresets";
import type { ExperienceHotspot, ExperienceViewpoint, Vec3Tuple } from "@/lib/labs/experiences/types";
import { applyInteriorView, resolveInteriorView, type InteriorView } from "@/lib/labs/lccInteriorView";
import {
  absoluteDataUrl,
  defaultLccModelMatrixElements,
  importLccSdk,
  releaseLccSdk,
  type LccObject,
  type LCCRenderType,
} from "@/lib/labs/lccSdk";
import { LccWalkControls } from "@/lib/labs/lccWalkControls";

export type TourNavMode = "orbit" | "first-person";

export type TourHostStats = {
  fps: number;
  frameMs: number;
  progress: number;
  phase: "idle" | "loading" | "ready" | "error";
  error: string | null;
  metaSummary: string | null;
  boundsSummary: string | null;
  sdkVersion: string;
  hasCollision: boolean;
  collisionActive: boolean;
  maxSplats: number;
  maxDistance: number;
  pixelRatio: number;
  loadMs: number | null;
};

export type CameraPoseSample = {
  position: Vec3Tuple;
  target: Vec3Tuple;
  yaw: number;
};

type Props = {
  dataPath: string;
  navMode: TourNavMode;
  quality: QualityPreset;
  collisionEnabled: boolean;
  hotspots: ExperienceHotspot[];
  flyTo: { viewpoint: ExperienceViewpoint; token: number; preferFade?: boolean } | null;
  placeHotspotMode: boolean;
  onStats: (s: TourHostStats) => void;
  onHotspotSelect: (hs: ExperienceHotspot | null) => void;
  onHotspotPlaced: (position: Vec3Tuple) => void;
  onCameraSample: (sample: CameraPoseSample) => void;
  onPoseTick?: (pose: CameraPoseSample) => void;
  onFade?: (opaque: boolean) => void;
  resetToken: number;
  sampleCameraToken: number;
};

const FALLBACK_EYE = new THREE.Vector3(0, 1.55, 0.5);
const FALLBACK_TARGET = new THREE.Vector3(0, 1.4, -2.5);
const FLY_DURATION_S = 1.15;
const CAPSULE_RADIUS = 0.28;
const EYE = 1.55;

type FlyState = {
  fromEye: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toEye: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  fade: boolean;
};

/**
 * Plain Three.js + LCC SDK host for Spatial Lab Experiences (EXP-01 / EXP-02).
 */
export function ExperienceTourHost({
  dataPath,
  navMode,
  quality,
  collisionEnabled,
  hotspots,
  flyTo,
  placeHotspotMode,
  onStats,
  onHotspotSelect,
  onHotspotPlaced,
  onCameraSample,
  onPoseTick,
  onFade,
  resetToken,
  sampleCameraToken,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    LCCRender: LCCRenderType;
    lcc: LccObject | null;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    orbit: OrbitControls;
    walk: LccWalkControls;
    clock: THREE.Clock;
    home: InteriorView;
    markers: THREE.Group;
    fly: FlyState | null;
    loadStarted: number;
    hasCollision: boolean;
  } | null>(null);

  const hotspotsRef = useRef(hotspots);
  const placeModeRef = useRef(placeHotspotMode);
  const qualityRef = useRef(quality);
  const collisionRef = useRef(collisionEnabled);
  const onStatsRef = useRef(onStats);
  const onHotspotSelectRef = useRef(onHotspotSelect);
  const onHotspotPlacedRef = useRef(onHotspotPlaced);
  const onCameraSampleRef = useRef(onCameraSample);
  const onPoseTickRef = useRef(onPoseTick);
  const onFadeRef = useRef(onFade);
  const navModeRef = useRef(navMode);
  hotspotsRef.current = hotspots;
  placeModeRef.current = placeHotspotMode;
  qualityRef.current = quality;
  collisionRef.current = collisionEnabled;
  onStatsRef.current = onStats;
  onHotspotSelectRef.current = onHotspotSelect;
  onHotspotPlacedRef.current = onHotspotPlaced;
  onCameraSampleRef.current = onCameraSample;
  onPoseTickRef.current = onPoseTick;
  onFadeRef.current = onFade;
  navModeRef.current = navMode;

  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let raf = 0;
    let frames = 0;
    let lastFpsAt = performance.now();
    let fps = 0;
    let frameMs = 16;
    let progress = 0;
    let phase: TourHostStats["phase"] = "idle";
    let error: string | null = null;
    let metaSummary: string | null = null;
    let boundsSummary: string | null = null;
    let sdkVersion = "?";
    let loadMs: number | null = null;
    let lastPoseAt = 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c0c);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 150000);
    camera.position.copy(FALLBACK_EYE);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const applyPixelRatio = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityRef.current.pixelRatioCap));
    };
    applyPixelRatio();
    renderer.setClearColor(0x0c0c0c);
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.copy(FALLBACK_TARGET);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.update();

    const walk = new LccWalkControls(camera, renderer.domElement);
    walk.enabled = false;
    walk.eyeHeight = EYE;
    walk.lockEyeHeight = true;

    const clock = new THREE.Clock();
    const markers = new THREE.Group();
    scene.add(markers);

    const tmpStart = { x: 0, y: 0, z: 0 };
    const tmpEnd = { x: 0, y: 0, z: 0 };
    const down = new THREE.Vector3(0, -1, 0);

    const resolveCollision = (from: THREE.Vector3, to: THREE.Vector3) => {
      const lcc = apiRef.current?.lcc;
      if (!lcc || !collisionRef.current || !apiRef.current?.hasCollision || !lcc.intersectsCapsule) {
        return to;
      }
      const out = to.clone();
      // Horizontal capsule at intended XZ, current eye height
      const feetY = out.y - EYE + 0.15;
      const headY = out.y + 0.12;
      tmpStart.x = out.x;
      tmpStart.y = feetY;
      tmpStart.z = out.z;
      tmpEnd.x = out.x;
      tmpEnd.y = headY;
      tmpEnd.z = out.z;
      const hit = lcc.intersectsCapsule({ start: tmpStart, end: tmpEnd, radius: CAPSULE_RADIUS });
      if (hit?.hit) {
        out.x += hit.delta.x;
        out.z += hit.delta.z;
      }
      // Floor follow
      if (lcc.intersectsRayFromOriginExt) {
        const floor = lcc.intersectsRayFromOriginExt({
          origin: { x: out.x, y: out.y + 0.4, z: out.z },
          direction: { x: 0, y: -1, z: 0 },
          maxDistance: EYE + 1.2,
        });
        if (floor) {
          out.y = floor.point.y + EYE;
        }
      } else if (lcc.raycastFromOrigin) {
        const floor = lcc.raycastFromOrigin({
          origin: { x: out.x, y: out.y + 0.4, z: out.z },
          direction: { x: down.x, y: down.y, z: down.z },
          maxDistance: EYE + 1.2,
          radius: 0.05,
        });
        if (floor) out.y = floor.y + EYE;
      }
      // If still deeply penetrating, revert XZ
      tmpStart.x = out.x;
      tmpStart.y = out.y - EYE + 0.15;
      tmpStart.z = out.z;
      tmpEnd.x = out.x;
      tmpEnd.y = out.y + 0.12;
      tmpEnd.z = out.z;
      const again = lcc.intersectsCapsule?.({ start: tmpStart, end: tmpEnd, radius: CAPSULE_RADIUS });
      if (again?.hit && Math.hypot(again.delta.x, again.delta.z) > 0.35) {
        out.x = from.x;
        out.z = from.z;
      }
      return out;
    };
    walk.resolveCollision = resolveCollision;

    const pushStats = () => {
      const q = qualityRef.current;
      onStatsRef.current({
        fps,
        frameMs,
        progress,
        phase,
        error,
        metaSummary,
        boundsSummary,
        sdkVersion,
        hasCollision: !!apiRef.current?.hasCollision,
        collisionActive: !!collisionRef.current && !!apiRef.current?.hasCollision,
        maxSplats: q.maxSplats,
        maxDistance: q.maxDistance,
        pixelRatio: renderer.getPixelRatio(),
        loadMs,
      });
    };

    const applyNavMode = (mode: TourNavMode) => {
      const fp = mode === "first-person";
      walk.enabled = fp;
      orbit.enabled = !fp;
      if (!fp) walk.exitPointerLock();
      if (fp) walk.syncFromCamera();
    };
    applyNavMode(navModeRef.current);

    const applyQuality = (lccObj: LccObject | null) => {
      const q = qualityRef.current;
      applyPixelRatio();
      resize();
      if (!lccObj) return;
      lccObj.setLodAutoLevelUp?.(true);
      lccObj.setMaxDistance?.(q.maxDistance);
      lccObj.setMaxSplats?.(q.maxSplats);
      // setMaxNodeSplats is legacy LCC — skip for LCC2 packages
      try {
        lccObj.setSmooth?.(true);
      } catch {
        /* optional */
      }
    };

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

    let LCCRender: LCCRenderType | null = null;
    let lcc: LccObject | null = null;
    const loadStarted = performance.now();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (evt: PointerEvent) => {
      if (!lcc || evt.button !== 0) return;
      // Let walk handle look / pointer-lock; only intercept for hotspot hit-test / place mode
      const rect = renderer.domElement.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      pointer.x = (x / rect.width) * 2 - 1;
      pointer.y = -(y / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(markers.children, false);
      if (hits.length && !placeModeRef.current) {
        const id = hits[0].object.userData.hotspotId as string | undefined;
        const hs = hotspotsRef.current.find((h) => h.id === id) ?? null;
        onHotspotSelectRef.current(hs);
        evt.stopPropagation();
        return;
      }
      if (!placeModeRef.current) return;
      const hit = lcc.raycast({ evt: { x, y }, maxDistance: 80, radius: 0.12 });
      if (!hit) return;
      onHotspotPlacedRef.current([hit.x, hit.y, hit.z]);
      evt.stopPropagation();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    (async () => {
      try {
        phase = "loading";
        pushStats();
        const sdk = await importLccSdk();
        if (cancelled) return;
        LCCRender = sdk.LCCRender;
        try {
          LCCRender.setWriteDepth?.(true);
        } catch {
          /* optional */
        }
        sdkVersion = LCCRender.getVersion?.() ?? "?";
        apiRef.current = {
          LCCRender,
          lcc: null,
          camera,
          renderer,
          scene,
          orbit,
          walk,
          clock,
          home: { eye: FALLBACK_EYE.clone(), target: FALLBACK_TARGET.clone(), source: "fallback" },
          markers,
          fly: null,
          loadStarted,
          hasCollision: false,
        };

        const modelMatrix = new THREE.Matrix4().fromArray(defaultLccModelMatrixElements());
        const path = absoluteDataUrl(dataPath);

        lcc = LCCRender.load(
          {
            camera,
            scene,
            renderLib: THREE,
            renderer,
            canvas: renderer.domElement,
            dataPath: path,
            useEnv: true,
            useIndexDB: true,
            useLoadingEffect: true,
            modelMatrix,
            appKey: null,
            usePage: path.toLowerCase().endsWith(".lcc2"),
            usePrecisionRaycast: true,
          },
          () => {
            if (cancelled || !lcc) return;
            phase = "ready";
            loadMs = Math.round(performance.now() - loadStarted);
            try {
              const meta = lcc.getMeta();
              metaSummary = meta
                ? `${String(meta.name ?? "model")} · splats ${String(meta.totalSplats ?? "?")}`
                : "meta unavailable";
              const b = lcc.getBounds();
              boundsSummary = b
                ? `min (${b.min.x.toFixed(1)}, ${b.min.y.toFixed(1)}, ${b.min.z.toFixed(1)}) → max (${b.max.x.toFixed(1)}, ${b.max.y.toFixed(1)}, ${b.max.z.toFixed(1)})`
                : null;
              const hasCol = !!lcc.hasCollision?.();
              if (apiRef.current) apiRef.current.hasCollision = hasCol;
              applyQuality(lcc);
              void resolveInteriorView(path).then((view) => {
                if (cancelled) return;
                applyInteriorView(camera, orbit, (t) => walk.lookAt(t), view);
                walk.syncFromCamera();
                applyNavMode(navModeRef.current);
                if (apiRef.current) apiRef.current.home = view;
                pushStats();
              });
            } catch (err) {
              metaSummary = `meta error: ${(err as Error).message}`;
            }
            pushStats();
          },
          (p) => {
            const prev = progress;
            progress = p;
            if (p === 0 || p >= 0.999 || Math.abs(p - prev) >= 0.03) pushStats();
          },
          () => {
            phase = "error";
            error = "Failed to load LCC package (check public/labs/lcc-samples/).";
            setBootError(error);
            pushStats();
          },
        );
        if (apiRef.current) apiRef.current.lcc = lcc;
      } catch (err) {
        if (cancelled) return;
        phase = "error";
        error = (err as Error).message === "LCC_SDK_RELEASED" ? "Reloading…" : (err as Error).message;
        setBootError(error);
        pushStats();
      }
    })();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t0 = performance.now();
      const api = apiRef.current;
      const dt = api?.clock.getDelta() ?? 0.016;
      if (api?.fly) {
        if (api.fly.fade) {
          // Fade midpoint teleport
          if (api.fly.t < 0.45) {
            api.fly.t = Math.min(0.45, api.fly.t + dt / FLY_DURATION_S);
            onFadeRef.current?.(true);
          } else if (api.fly.t < 0.55) {
            camera.position.copy(api.fly.toEye);
            orbit.target.copy(api.fly.toTarget);
            orbit.update();
            walk.lookAt(orbit.target);
            walk.syncFromCamera();
            api.fly.t = 0.55;
          } else {
            api.fly.t = Math.min(1, api.fly.t + dt / FLY_DURATION_S);
            onFadeRef.current?.(api.fly.t < 0.95);
            if (api.fly.t >= 1) {
              api.fly = null;
              onFadeRef.current?.(false);
            }
          }
        } else {
          api.fly.t = Math.min(1, api.fly.t + dt / FLY_DURATION_S);
          const e = 1 - Math.pow(1 - api.fly.t, 3);
          camera.position.lerpVectors(api.fly.fromEye, api.fly.toEye, e);
          orbit.target.lerpVectors(api.fly.fromTarget, api.fly.toTarget, e);
          orbit.update();
          walk.lookAt(orbit.target);
          walk.syncFromCamera();
          if (api.fly.t >= 1) api.fly = null;
        }
      } else if (api?.walk.enabled) {
        api.walk.update(dt);
        // Keep orbit target in front so map/orbit stay coherent
        const ahead = new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion);
        orbit.target.copy(camera.position).add(ahead);
      } else {
        api?.orbit.update();
      }
      api?.LCCRender.update();
      renderer.render(scene, camera);
      frameMs = performance.now() - t0;
      frames += 1;
      const now = performance.now();
      if (now - lastFpsAt >= 500) {
        fps = Math.round((frames * 1000) / (now - lastFpsAt));
        frames = 0;
        lastFpsAt = now;
        pushStats();
      }
      if (onPoseTickRef.current && now - lastPoseAt > 120) {
        lastPoseAt = now;
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
        onPoseTickRef.current({
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [orbit.target.x, orbit.target.y, orbit.target.z],
          yaw: euler.y,
        });
      }
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      walk.exitPointerLock();
      if (LCCRender && lcc) {
        try {
          LCCRender.unload(lcc);
        } catch {
          /* ignore */
        }
      }
      releaseLccSdk();
      orbit.dispose();
      walk.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataPath]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const fp = navMode === "first-person";
    api.walk.enabled = fp;
    api.orbit.enabled = !fp;
    if (!fp) api.walk.exitPointerLock();
    if (fp) api.walk.syncFromCamera();
  }, [navMode]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api?.lcc) return;
    qualityRef.current = quality;
    api.lcc.setMaxDistance?.(quality.maxDistance);
    api.lcc.setMaxSplats?.(quality.maxSplats);
    api.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));
    const w = mountRef.current?.clientWidth || 1;
    const h = mountRef.current?.clientHeight || 1;
    api.camera.aspect = w / h;
    api.camera.updateProjectionMatrix();
    api.renderer.setSize(w, h, false);
  }, [quality]);

  useEffect(() => {
    collisionRef.current = collisionEnabled;
  }, [collisionEnabled]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    while (api.markers.children.length) api.markers.remove(api.markers.children[0]);
    for (const hs of hotspots) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0xd4a574 }),
      );
      mesh.position.set(...hs.position);
      mesh.userData.hotspotId = hs.id;
      api.markers.add(mesh);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.14, 0.18, 24),
        new THREE.MeshBasicMaterial({ color: 0xf0e6d8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(hs.position[0], hs.position[1] - 0.05, hs.position[2]);
      ring.userData.hotspotId = hs.id;
      api.markers.add(ring);
    }
  }, [hotspots]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !flyTo) return;
    const vp = flyTo.viewpoint;
    const toEye = new THREE.Vector3(...vp.position);
    const toTarget = new THREE.Vector3(...vp.target);
    const fromEye = api.camera.position.clone();
    const blocked =
      flyTo.preferFade ||
      (() => {
        const lcc = api.lcc;
        if (!lcc?.intersectsRayFromOriginExt) return false;
        const dir = toEye.clone().sub(fromEye);
        const dist = dir.length();
        if (dist < 0.2) return false;
        dir.multiplyScalar(1 / dist);
        return !!lcc.intersectsRayFromOriginExt({
          origin: { x: fromEye.x, y: fromEye.y, z: fromEye.z },
          direction: { x: dir.x, y: dir.y, z: dir.z },
          maxDistance: Math.max(0.1, dist - 0.25),
        });
      })();
    api.fly = {
      fromEye,
      fromTarget: api.orbit.target.clone(),
      toEye,
      toTarget,
      t: 0,
      fade: blocked,
    };
  }, [flyTo?.token]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || resetToken === 0) return;
    api.fly = null;
    onFadeRef.current?.(false);
    applyInteriorView(api.camera, api.orbit, (t) => api.walk.lookAt(t), api.home);
    api.walk.syncFromCamera();
  }, [resetToken]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || sampleCameraToken === 0) return;
    const euler = new THREE.Euler().setFromQuaternion(api.camera.quaternion, "YXZ");
    onCameraSampleRef.current({
      position: [api.camera.position.x, api.camera.position.y, api.camera.position.z],
      target: [api.orbit.target.x, api.orbit.target.y, api.orbit.target.z],
      yaw: euler.y,
    });
  }, [sampleCameraToken]);

  return (
    <div className="exp-host" ref={mountRef}>
      {bootError && <div className="exp-host-error">{bootError}</div>}
    </div>
  );
}
