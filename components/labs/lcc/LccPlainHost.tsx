"use client";

import { useEffect, useRef, useState } from "react";
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
import { applyInteriorView, resolveInteriorView, type InteriorView } from "@/lib/labs/lccInteriorView";
import { LccWalkControls } from "@/lib/labs/lccWalkControls";

export type NavMode = "orbit" | "first-person";
export type PickMode = "splat" | "collision";

export type LccHostStats = {
  fps: number;
  sdkVersion: string;
  progress: number;
  phase: "idle" | "loading" | "ready" | "error";
  error: string | null;
  metaSummary: string | null;
  boundsSummary: string | null;
  hasEnv: boolean;
  hasCollision: boolean;
  lastPick: string | null;
  threeRevision: string;
};

type Props = {
  dataPath: string;
  navMode: NavMode;
  pickMode: PickMode;
  useEnv: boolean;
  clipEnabled: boolean;
  appKey: string;
  onStats: (stats: LccHostStats) => void;
  resetToken: number;
};

const FALLBACK_EYE = new THREE.Vector3(0, 1.55, 0.5);
const FALLBACK_TARGET = new THREE.Vector3(0, 1.4, -2.5);

/**
 * Isolated plain Three.js host for the LCC Web SDK (Lab LCC-WEB-01).
 * Owns its own renderer and animation loop — does not touch LiDAR / SuperSplat viewers.
 */
export function LccPlainHost({ dataPath, navMode, pickMode, useEnv, clipEnabled, appKey, onStats, resetToken }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    LCCRender: LCCRenderType;
    lcc: LccObject | null;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    orbit: OrbitControls;
    walk: LccWalkControls;
    hotspot: THREE.Group;
    clock: THREE.Clock;
    home: InteriorView;
  } | null>(null);
  const pickModeRef = useRef(pickMode);
  const onStatsRef = useRef(onStats);
  const navModeRef = useRef(navMode);
  pickModeRef.current = pickMode;
  onStatsRef.current = onStats;
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
    let progress = 0;
    let phase: LccHostStats["phase"] = "idle";
    let error: string | null = null;
    let metaSummary: string | null = null;
    let boundsSummary: string | null = null;
    let hasEnv = false;
    let hasCollision = false;
    let lastPick: string | null = null;
    let sdkVersion = "?";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 150000);
    camera.position.copy(FALLBACK_EYE);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x111111);
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.copy(FALLBACK_TARGET);
    orbit.enableDamping = true;
    orbit.update();

    const walk = new LccWalkControls(camera, renderer.domElement);
    walk.enabled = false;

    const clock = new THREE.Clock();

    const hotspot = new THREE.Group();
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 8), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    stem.position.y = 0.2;
    hotspot.add(marker, stem);
    hotspot.visible = false;
    scene.add(hotspot);

    const pushStats = () => {
      onStatsRef.current({
        fps,
        sdkVersion,
        progress,
        phase,
        error,
        metaSummary,
        boundsSummary,
        hasEnv,
        hasCollision,
        lastPick,
        threeRevision: THREE.REVISION,
      });
    };

    const applyNavMode = (mode: NavMode) => {
      const fp = mode === "first-person";
      walk.enabled = fp;
      orbit.enabled = !fp;
      if (fp) walk.syncFromCamera();
    };
    applyNavMode(navModeRef.current);

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

    const onPointerDown = (evt: PointerEvent) => {
      if (!evt.ctrlKey || !lcc) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const mode = pickModeRef.current;
      if (mode === "splat") {
        const hit = lcc.raycast({ evt: { x, y }, maxDistance: 80, radius: 0.12 });
        if (!hit) {
          lastPick = "splat: miss";
          pushStats();
          return;
        }
        placeHotspot(hit);
        lastPick = `splat: (${hit.x.toFixed(3)}, ${hit.y.toFixed(3)}, ${hit.z.toFixed(3)})`;
      } else {
        const hit = lcc.intersectsRayExt?.({ evt: { x, y }, maxDistance: 80 });
        if (!hit) {
          lastPick = "collision: miss (or no collision mesh)";
          pushStats();
          return;
        }
        placeHotspot(hit.point, hit.normal);
        lastPick = `collision: (${hit.point.x.toFixed(3)}, ${hit.point.y.toFixed(3)}, ${hit.point.z.toFixed(3)}) n=(${hit.normal.x.toFixed(2)}, ${hit.normal.y.toFixed(2)}, ${hit.normal.z.toFixed(2)})`;
      }
      pushStats();
    };

    const placeHotspot = (p: { x: number; y: number; z: number }, normal?: { x: number; y: number; z: number }) => {
      hotspot.visible = true;
      hotspot.position.set(p.x, p.y, p.z);
      if (normal) {
        const up = new THREE.Vector3(0, 1, 0);
        const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
        hotspot.quaternion.setFromUnitVectors(up, n);
      } else {
        hotspot.quaternion.identity();
      }
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
          scene,
          orbit,
          walk,
          hotspot,
          clock,
          home: { eye: FALLBACK_EYE.clone(), target: FALLBACK_TARGET.clone(), source: "fallback" },
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
            appKey: appKey.trim() ? appKey.trim() : null,
            usePage: path.toLowerCase().endsWith(".lcc2"),
            usePrecisionRaycast: true,
          },
          () => {
            if (cancelled || !lcc) return;
            phase = "ready";
            try {
              const meta = lcc.getMeta();
              metaSummary = meta
                ? `${String(meta.name ?? meta.dataType ?? "model")} · ${String(meta.fileType ?? "?")} · splats ${String(meta.totalSplats ?? "?")}`
                : "meta unavailable";
              const b = lcc.getBounds();
              boundsSummary = b
                ? `min (${b.min.x.toFixed(2)}, ${b.min.y.toFixed(2)}, ${b.min.z.toFixed(2)}) → max (${b.max.x.toFixed(2)}, ${b.max.y.toFixed(2)}, ${b.max.z.toFixed(2)})`
                : "bounds unavailable";
              hasEnv = !!lcc.hasEnvironment?.();
              hasCollision = !!lcc.hasCollision?.();
              lcc.setLodAutoLevelUp?.(true);
              lcc.setMaxDistance?.(80);
              lcc.setMaxSplats?.(2_500_000);
              lcc.setMaxNodeSplats?.(1_200_000);
              void resolveInteriorView(path).then((view) => {
                if (cancelled) return;
                applyInteriorView(camera, orbit, (t) => walk.lookAt(t), view);
                walk.syncFromCamera();
                applyNavMode(navModeRef.current);
                if (apiRef.current) apiRef.current.home = view;
                if (b) {
                  boundsSummary += ` · view ${view.source}`;
                  pushStats();
                }
              });
            } catch (err) {
              metaSummary = `meta read error: ${(err as Error).message}`;
            }
            pushStats();
          },
          (p) => {
            progress = p;
            pushStats();
          },
          () => {
            phase = "error";
            error = "LCCRender.load failure callback (check dataPath, CORS, and appKey)";
            setBootError(error);
            pushStats();
          },
        );
        if (apiRef.current) apiRef.current.lcc = lcc;
      } catch (err) {
        // Strict Mode / host-switch can abort an in-flight load; ignore if we already cleaned up.
        if (cancelled) return;
        phase = "error";
        error = (err as Error).message === "LCC_SDK_RELEASED" ? "Reloading SDK…" : (err as Error).message;
        setBootError(error);
        pushStats();
      }
    })();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const api = apiRef.current;
      const dt = api?.clock.getDelta() ?? 0.016;
      if (api?.walk.enabled) api.walk.update(dt);
      else api?.orbit.update();
      api?.LCCRender.update();
      renderer.render(scene, camera);
      frames += 1;
      const now = performance.now();
      if (now - lastFpsAt >= 500) {
        fps = Math.round((frames * 1000) / (now - lastFpsAt));
        frames = 0;
        lastFpsAt = now;
        pushStats();
      }
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      if (LCCRender && lcc) {
        try {
          LCCRender.unload(lcc);
        } catch {
          /* ignore */
        }
      }
      // Full teardown so Plain ↔ R3F switches get a fresh SDK (avoids blank room until reload).
      releaseLccSdk();
      orbit.dispose();
      walk.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataPath, appKey]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const fp = navMode === "first-person";
    api.walk.enabled = fp;
    api.orbit.enabled = !fp;
    if (fp) api.walk.syncFromCamera();
  }, [navMode]);

  useEffect(() => {
    apiRef.current?.lcc?.useEnvironment?.(useEnv);
  }, [useEnv]);

  useEffect(() => {
    const lcc = apiRef.current?.lcc;
    if (!lcc) return;
    if (!clipEnabled) {
      lcc.setClipBox?.(undefined);
      return;
    }
    lcc.setClipBox?.({
      position: { x: 0, y: 1.2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 6, y: 4, z: 6 },
      clipSide: 0,
    });
  }, [clipEnabled]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || resetToken === 0) return;
    applyInteriorView(api.camera, api.orbit, (t) => api.walk.lookAt(t), api.home);
    api.walk.syncFromCamera();
  }, [resetToken]);

  return (
    <div className="lcc-host" ref={mountRef}>
      {bootError && <div className="lcc-host-error">{bootError}</div>}
    </div>
  );
}
