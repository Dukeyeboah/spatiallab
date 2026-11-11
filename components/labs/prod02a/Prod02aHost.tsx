"use client";

import { installOrbReview } from "@/lib/labs/prod02b/orbReview";

import { PROD02B_AVATARS } from "@/lib/labs/prod02b/avatarAssets";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
import {
  DEFAULT_VISUAL_AVATAR_TUNING,

  VisualAvatar,
  type VisualAvatarDebug,
  type VisualAvatarTuning,
} from "@/lib/labs/prod02b/visualAvatar";

import { robotGroundProbe, robotGroundEyeY } from "@/lib/labs/prod02b/grounding";

import { AdaptiveRenderBudget, FrameWindow, renderBudget, robotCacheBudget, type RobotPerfStats } from "@/lib/labs/prod02b/performance";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Prod02aNavKind = "current" | "smooth" | "orbit";

export type Prod02aHostStats = {
  phase: "idle" | "loading" | "ready" | "error";
  progress: number;
  fps: number;
  perf?: RobotPerfStats;
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
  getAvatarDebug: () => VisualAvatarDebug | null;
};

/** Soft oriented barrier (PROD-03 outdoor road segments, etc.). */
export type Prod02aBlockZone = {
  id: string;
  enabled: boolean;
  center: [number, number, number];
  size: [number, number, number];
  /** Yaw around world Y (radians). */
  yaw?: number;
  /** Visitor-facing copy when entry is refused. */
  message?: string;
};

export type Prod02aSceneProp = {
  id: string;
  url: string;
  position: [number, number, number];
  yaw?: number;
  scale?: number;
  visible?: boolean;
};

export type Prod02aBlockDenied = {
  id: string;
  message: string;
};

/** hidden = collision only; wire = author debug; glass = nearby frosted panel. */
export type Prod02aBlockVisual = "hidden" | "wire" | "glass";

const DEFAULT_BLOCK_MESSAGE = "That section is under construction.";
const BLOCK_GLASS_FADE_START = 10;
const BLOCK_GLASS_FADE_END = 26;

type Props = {
  dataPath: string;
  navKind: Prod02aNavKind;
  quality: Prod02aQualityPreset;
  tuning: SmoothNavTuning;
  collisionEnabled: boolean;
  showCapsule: boolean;
  showCameraDebug?: boolean;
  /** PROD-02B: show Mixamo visual on the smooth controller. */
  showMixamoAvatar?: boolean;
  enableAvatarLocomotion?: boolean;
  adaptivePerformance?: boolean;
  mixamoTuning?: VisualAvatarTuning;
  /** Soft walk barriers (invisible unless blockVisual draws them). */
  blockZones?: Prod02aBlockZone[];
  /**
   * How to draw barriers. Visitor default should be `hidden` or `glass`.
   * `wire` is author/dev only — never leave on for visitor preview.
   */
  blockVisual?: Prod02aBlockVisual;
  /** @deprecated Prefer blockVisual="wire". Kept for older callers. */
  showBlockDebug?: boolean;
  /** Optional GLB/GLTF props parented into the LCC scene. */
  sceneProps?: Prod02aSceneProp[];
  /** Suppress canvas touch-look so mobile overlays own look (mouse still works). */
  suppressTouchLook?: boolean;
  fov: number;
  /** Prefer over poses.json (fixes Ground exterior spawn). */
  startPose?: Prod02aStartPose | null;
  onStats?: (s: Prod02aHostStats) => void;
  onReady?: () => void;
  onPreferredDistanceChange?: (distance: number) => void;
  onAvatarDebug?: (d: VisualAvatarDebug | null) => void;
  /** Fired when locomotion is bounced by an authored soft barrier. */
  onBlockDenied?: (info: Prod02aBlockDenied) => void;
  /** Click floor to walk there (Walk + Motion/Avatar). Default on. */
  enablePointMove?: boolean;
  /** Visitor-facing reason when a click destination is refused. */
  onPointMoveRejected?: (reason: string) => void;
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
    showMixamoAvatar = false,
    enableAvatarLocomotion = false,
    adaptivePerformance = false,
    mixamoTuning,
    blockZones = [],
    blockVisual,
    showBlockDebug = false,
    sceneProps = [],
    suppressTouchLook = false,
    fov,
    startPose = null,
    onStats,
    onReady,
    onPreferredDistanceChange,
    onAvatarDebug,
    onBlockDenied,
    enablePointMove = true,
    onPointMoveRejected,
  },
  ref,
) {
  const resolvedBlockVisual: Prod02aBlockVisual =
    blockVisual ?? (showBlockDebug ? "wire" : "hidden");
  const mountRef = useRef<HTMLDivElement>(null);
  const navKindRef = useRef(navKind);
  const qualityRef = useRef(quality);
  const tuningRef = useRef(tuning);
  const collisionRef = useRef(collisionEnabled);
  const showCapsuleRef = useRef(showCapsule);
  const showCameraDebugRef = useRef(showCameraDebug);
  const showMixamoAvatarRef = useRef(showMixamoAvatar);
  const adaptiveRef = useRef(adaptivePerformance);
  adaptiveRef.current = adaptivePerformance;
  const gameLocomotionRef = useRef(enableAvatarLocomotion);
  gameLocomotionRef.current = enableAvatarLocomotion;
  const mixamoTuningRef = useRef(mixamoTuning ?? DEFAULT_VISUAL_AVATAR_TUNING);
  const blockZonesRef = useRef(blockZones);
  const blockVisualRef = useRef(resolvedBlockVisual);
  const suppressTouchLookRef = useRef(suppressTouchLook);
  const startPoseRef = useRef(startPose);
  const onStatsRef = useRef(onStats);
  const onReadyRef = useRef(onReady);
  const onPreferredDistanceChangeRef = useRef(onPreferredDistanceChange);
  const onAvatarDebugRef = useRef(onAvatarDebug);
  const onBlockDeniedRef = useRef(onBlockDenied);
  const onPointMoveRejectedRef = useRef(onPointMoveRejected);
  const enablePointMoveRef = useRef(enablePointMove);
  const lastBlockDenyAtRef = useRef(0);
  /** Bumped when the Three.js host API is created so prop sync can retry after mount. */
  const [hostReadyTick, setHostReadyTick] = useState(0);
  navKindRef.current = navKind;
  qualityRef.current = quality;
  tuningRef.current = tuning;
  collisionRef.current = collisionEnabled;
  showCapsuleRef.current = showCapsule;
  showCameraDebugRef.current = showCameraDebug;
  blockVisualRef.current = resolvedBlockVisual;
  showMixamoAvatarRef.current = showMixamoAvatar;
  mixamoTuningRef.current = mixamoTuning ?? DEFAULT_VISUAL_AVATAR_TUNING;
  enablePointMoveRef.current = enablePointMove;
  onPointMoveRejectedRef.current = onPointMoveRejected;
  blockZonesRef.current = blockZones;
  suppressTouchLookRef.current = suppressTouchLook;
  startPoseRef.current = startPose;
  onStatsRef.current = onStats;
  onReadyRef.current = onReady;
  onPreferredDistanceChangeRef.current = onPreferredDistanceChange;
  onAvatarDebugRef.current = onAvatarDebug;
  onBlockDeniedRef.current = onBlockDenied;

  const apiRef = useRef<{
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    walk: LccWalkControls;
    smooth: SmoothAvatarControls;
    orbit: OrbitControls;
    visualAvatar: VisualAvatar | null;
    blockDebugGroup: THREE.Group;
    propsRoot: THREE.Group;
    propTemplates: Map<string, THREE.Object3D>;
    lcc: LccObject | null;
    LCCRender: LCCRenderType | null;
    hasCollision: boolean;
    refreshBudget?: () => void;
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
      apiRef.current?.smooth.cancelMoveTarget();
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
    getAvatarDebug: () => apiRef.current?.visualAvatar?.getDebug() ?? null,
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
      api.walk.cancelMoveTarget();
      api.smooth.cancelMoveTarget();
      // Do NOT syncFromCamera here — orbit/walk camera height is not body eye.
      // Place on the ground under the camera (or orbit pivot) then setPose.
      const eyeH = tuningRef.current.eyeHeight;
      const cam = api.camera.position;
      const pivot = api.orbit.target;
      const elevatedOrbit = cam.y - pivot.y > 1.5;
      let x = elevatedOrbit ? pivot.x : cam.x;
      let z = elevatedOrbit ? pivot.z : cam.z;
      let eyeY = elevatedOrbit ? pivot.y + eyeH : cam.y;
      const lcc = api.lcc;
      if (lcc?.intersectsRayFromOriginExt) {
        const probeY = Math.max(cam.y, eyeY) + 3.5;
        const hit = lcc.intersectsRayFromOriginExt({
          origin: { x, y: probeY, z },
          direction: { x: 0, y: -1, z: 0 },
          maxDistance: 16,
        });
        if (hit?.point?.y != null && Number.isFinite(hit.point.y)) {
          eyeY = hit.point.y + eyeH;
        }
      }
      const look = new THREE.Vector3();
      api.camera.getWorldDirection(look);
      look.y = 0;
      if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
      else look.normalize();
      const eye = new THREE.Vector3(x, eyeY, z);
      const target = eye.clone().addScaledVector(look, 2.5);
      target.y = eyeY - 0.1;
      api.smooth.setPose(eye, target);
    } else if (useCurrent) {
      api.smooth.cancelMotion();
      api.smooth.cancelMoveTarget();
      // First-person: keep XZ, snap eye onto floor so we don't inherit a buried boom cam.
      const eyeH = tuningRef.current.eyeHeight;
      const cam = api.camera.position;
      let eyeY = cam.y;
      const lcc = api.lcc;
      if (lcc?.intersectsRayFromOriginExt) {
        const hit = lcc.intersectsRayFromOriginExt({
          origin: { x: cam.x, y: cam.y + 3.5, z: cam.z },
          direction: { x: 0, y: -1, z: 0 },
          maxDistance: 16,
        });
        if (hit?.point?.y != null && Number.isFinite(hit.point.y)) {
          eyeY = hit.point.y + eyeH;
        }
      }
      api.camera.position.y = eyeY;
      api.walk.eyeHeight = eyeH;
      api.walk.syncFromCamera();
    } else {
      // Orbit: leave camera where it is; set target ahead of look
      api.smooth.cancelMotion();
      api.smooth.cancelMoveTarget();
      api.walk.clearVirtualInput();
      api.walk.cancelMoveTarget();
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
    api.smooth.showCapsule =
      showCapsule && navKindRef.current === "smooth" && !showMixamoAvatar;
    api.smooth.showDebug = showCameraDebug && navKindRef.current === "smooth";
    api.smooth.suppressTouchLook = suppressTouchLook;
    api.walk.suppressTouchLook = suppressTouchLook;
    api.walk.eyeHeight = tuning.eyeHeight;
    // Walk mode shares outdoor walkSpeed + Shift sprint presets with Avatar/smooth.
    api.walk.movementSpeed = tuning.walkSpeed;
    api.walk.sprintMultiplier = tuning.sprintMultiplier;
    if (api.visualAvatar) {
      api.visualAvatar.tuning = {
        ...DEFAULT_VISUAL_AVATAR_TUNING,
        ...mixamoTuning,
        visible: showMixamoAvatar && navKindRef.current === "smooth",
      };
      // Selection loading/notification is owned by ensureMixamoLoaded in the frame host.
    }
  }, [tuning, showCapsule, showCameraDebug, suppressTouchLook, showMixamoAvatar, mixamoTuning]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api?.lcc) return;
    api.refreshBudget?.();
  }, [quality, adaptivePerformance]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.camera.fov = fov;
    api.camera.updateProjectionMatrix();
  }, [fov]);

  // Barrier visuals: wire (author) / frosted glass (visitor option) / hidden
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const group = api.blockDebugGroup;
    while (group.children.length) {
      const child = group.children[0]!;
      group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
    const mode = resolvedBlockVisual;
    group.visible = mode !== "hidden";
    if (mode === "hidden") return;
    for (const zone of blockZones) {
      if (!zone.enabled) continue;
      const geo = new THREE.BoxGeometry(zone.size[0], zone.size[1], zone.size[2]);
      const mat =
        mode === "wire"
          ? new THREE.MeshBasicMaterial({
              color: 0xf0a050,
              wireframe: true,
              transparent: true,
              opacity: 0.85,
              depthTest: false,
            })
          : new THREE.MeshPhysicalMaterial({
              color: 0xb9cfe0,
              transparent: true,
              opacity: 0.28,
              roughness: 0.92,
              metalness: 0.02,
              transmission: 0.55,
              thickness: 0.35,
              ior: 1.2,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(zone.center[0], zone.center[1], zone.center[2]);
      mesh.rotation.y = zone.yaw ?? 0;
      mesh.renderOrder = mode === "wire" ? 10 : 2;
      mesh.userData.blockZoneId = zone.id;
      mesh.userData.blockVisual = mode;
      mesh.userData.baseOpacity = mode === "wire" ? 0.85 : 0.28;
      group.add(mesh);
    }
  }, [blockZones, resolvedBlockVisual]);

  // Authored construction / dressing props (always visible to visitors; independent of blockVisual)
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();

    const disposeObject = (obj: THREE.Object3D) => {
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    };

    void (async () => {
      const api = apiRef.current;
      if (!api?.propsRoot) return;
      const root = api.propsRoot;
      root.visible = true;
      const wanted = new Set(sceneProps.map((p) => p.id));

      for (const child of [...root.children]) {
        const id = child.userData.propId as string | undefined;
        if (!id || !wanted.has(id)) {
          root.remove(child);
          disposeObject(child);
        }
      }

      for (const prop of sceneProps) {
        if (cancelled) return;
        let obj = root.children.find((c) => c.userData.propId === prop.id) as
          | THREE.Object3D
          | undefined;
        if (!obj) {
          let template = api.propTemplates.get(prop.url);
          if (!template) {
            try {
              const gltf = await loader.loadAsync(prop.url);
              if (cancelled || !apiRef.current) return;
              template = gltf.scene;
              template.traverse((o) => {
                const m = o as THREE.Mesh;
                if (!m.isMesh) return;
                m.castShadow = false;
                m.receiveShadow = false;
                // LCC scenes have no IBL; tame metals so props aren't pure black.
                const mats = Array.isArray(m.material) ? m.material : [m.material];
                for (const mat of mats) {
                  if (!mat) continue;
                  const std = mat as THREE.MeshStandardMaterial;
                  if ("metalness" in std) {
                    std.metalness = Math.min(std.metalness ?? 0, 0.25);
                    std.roughness = Math.max(std.roughness ?? 0.5, 0.35);
                    std.envMapIntensity = 0.6;
                    std.needsUpdate = true;
                  }
                }
              });
              api.propTemplates.set(prop.url, template);
            } catch (err) {
              console.warn("[prod02a] prop load failed", prop.url, err);
              continue;
            }
          }
          obj = template.clone(true);
          obj.userData.propId = prop.id;
          obj.userData.propUrl = prop.url;
          root.add(obj);
        }
        // Dressing props stay visible for visitors; only explicit visible:false hides them.
        obj.visible = prop.visible !== false;
        obj.position.set(prop.position[0], prop.position[1], prop.position[2]);
        obj.rotation.set(0, prop.yaw ?? 0, 0);
        const s = prop.scale ?? 1;
        obj.scale.set(s, s, s);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sceneProps, hostReadyTick]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let raf = 0;
    let frames = 0;
    let lastAvatarDebugAt = 0;
    let contextLost = false;
    let contextLosses = 0;
    let cpuMs = 0;
    let frameDraws = 0, frameTriangles = 0;
    const startedAt = performance.now();
    let adaptAt = startedAt + 5000;
    let previousFrameAt = 0;
    const frameWindow = new FrameWindow();
    const adaptive = new AdaptiveRenderBudget();
    let budgetProfile = qualityRef.current;
    let budgetAuto = adaptiveRef.current;
    let effectiveSplats = qualityRef.current.maxSplats;
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
    // LCC/gaussians are self-lit; these lights only feed MeshStandard/Physical props.
    const hemi = new THREE.HemisphereLight(0xf2f5ff, 0x3d342c, 1.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.45);
    sun.position.set(35, 70, 18);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xa8bfff, 0.4);
    fill.position.set(-40, 25, -30);
    scene.add(fill);
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 150000);
    camera.position.copy(FALLBACK_EYE);

    const renderer = new THREE.WebGLRenderer({
      antialias: !enableAvatarLocomotion,
      powerPreference: "high-performance",
    });
    const applyDpr = () => {
      const q = qualityRef.current;
      if (budgetProfile !== q || budgetAuto !== adaptiveRef.current) {
        adaptive.reset(); frameWindow.reset(); adaptAt = performance.now() + 10000;
        budgetProfile = q; budgetAuto = adaptiveRef.current;
      }
      const budget = renderBudget(q, adaptiveRef.current ? adaptive.level : 0, mount.clientWidth, mount.clientHeight, window.devicePixelRatio || 1);
      const dpr = enableAvatarLocomotion ? budget.dpr : Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);
      if (Math.abs(renderer.getPixelRatio()-dpr) > .001) renderer.setPixelRatio(dpr);
      effectiveSplats = enableAvatarLocomotion ? budget.splats : q.maxSplats;
      if (apiRef.current?.lcc) applyQuality(apiRef.current.lcc, { ...q, maxSplats: effectiveSplats, maxDistance: enableAvatarLocomotion ? budget.distance : q.maxDistance }, !enableAvatarLocomotion);
    };
    applyDpr();
    renderer.info.autoReset = false;
    renderer.setClearColor(0x0c0c0c);
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 0.35s ease";
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enabled = false;
    orbit.target.copy(FALLBACK_TARGET);

    const walk = new LccWalkControls(camera, renderer.domElement);
    walk.enabled = false;
    walk.eyeHeight = tuningRef.current.eyeHeight;
    walk.movementSpeed = tuningRef.current.walkSpeed;
    walk.sprintMultiplier = tuningRef.current.sprintMultiplier;
    walk.lockEyeHeight = true;

    const smooth = new SmoothAvatarControls(camera, renderer.domElement);
    smooth.enabled = false;
    smooth.gameLocomotion = gameLocomotionRef.current;
    smooth.tuning = { ...tuningRef.current };
    smooth.suppressTouchLook = suppressTouchLookRef.current;
    walk.suppressTouchLook = suppressTouchLookRef.current;
    smooth.onPreferredDistanceChange = (d) => onPreferredDistanceChangeRef.current?.(d);
    scene.add(smooth.capsuleMesh);
    scene.add(smooth.debugGroup);

    const blockDebugGroup = new THREE.Group();
    blockDebugGroup.visible = blockVisualRef.current !== "hidden";
    scene.add(blockDebugGroup);

    const propsRoot = new THREE.Group();
    propsRoot.name = "prod02a-props";
    propsRoot.visible = true;
    scene.add(propsRoot);
    const propTemplates = new Map<string, THREE.Object3D>();

    const destMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.28, 32),
      new THREE.MeshBasicMaterial({
        color: 0xc4a574,
        transparent: true,
        opacity: 0.85,
        depthTest: true,
        side: THREE.DoubleSide,
      }),
    );
    destMarker.rotation.x = -Math.PI / 2;
    destMarker.visible = false;
    destMarker.name = "pointMoveDest";
    scene.add(destMarker);

    const visualAvatar = new VisualAvatar(renderer);
    visualAvatar.tuning = {
      ...DEFAULT_VISUAL_AVATAR_TUNING,
      ...mixamoTuningRef.current,
      visible: showMixamoAvatarRef.current,
    };
    scene.add(visualAvatar.root);
    // Lazy-load Mixamo only when PROD-02B enables it (keeps /labs/prod-02a free of GLB cost).
    let requestedAvatar: string | null = null;
    const ensureMixamoLoaded = () => {
      if (!showMixamoAvatarRef.current) return;
      const id = mixamoTuningRef.current.avatarId ?? "human";
      if (requestedAvatar === id) return;
      requestedAvatar = id;
      void visualAvatar.load().then(() => {
        if (cancelled) return;
        onAvatarDebugRef.current?.(visualAvatar.getDebug());
      });
    };
    ensureMixamoLoaded();

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
        perf: enableAvatarLocomotion ? {
          p95Ms: frameWindow.summary().p95, cpuMs,
          drawCalls: frameDraws, triangles: frameTriangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          heapMB: (performance as Performance & {memory?: {usedJSHeapSize:number}}).memory?.usedJSHeapSize != null ? (performance as Performance & {memory: {usedJSHeapSize:number}}).memory.usedJSHeapSize / 1048576 : null,
          width: renderer.domElement.width, height: renderer.domElement.height,
          dpr: renderer.getPixelRatio(), splatBudget: effectiveSplats,
          autoLevel: adaptiveRef.current ? adaptive.level : 0, contextLosses,
          elapsedSeconds: (performance.now()-startedAt)/1000,
        } : undefined,
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

    const worldToBlockLocal = (x: number, z: number, zone: Prod02aBlockZone) => {
      const yaw = zone.yaw ?? 0;
      const dx = x - zone.center[0];
      const dz = z - zone.center[2];
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      return {
        x: dx * c + dz * s,
        z: -dx * s + dz * c,
      };
    };

    const blockLocalToWorld = (lx: number, lz: number, zone: Prod02aBlockZone) => {
      const yaw = zone.yaw ?? 0;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      return {
        x: zone.center[0] + lx * c - lz * s,
        z: zone.center[2] + lx * s + lz * c,
      };
    };

    const pointInBlockZone = (x: number, y: number, z: number, zone: Prod02aBlockZone) => {
      const hx = zone.size[0] / 2;
      const hy = zone.size[1] / 2;
      const hz = zone.size[2] / 2;
      const local = worldToBlockLocal(x, z, zone);
      return (
        Math.abs(local.x) <= hx &&
        Math.abs(y - zone.center[1]) <= hy &&
        Math.abs(local.z) <= hz
      );
    };

    const findBlockZone = (x: number, y: number, z: number): Prod02aBlockZone | null => {
      for (const zone of blockZonesRef.current) {
        if (!zone.enabled) continue;
        if (pointInBlockZone(x, y, z, zone)) return zone;
      }
      return null;
    };

    const notifyBlockDenied = (zone: Prod02aBlockZone) => {
      const now = performance.now();
      if (now - lastBlockDenyAtRef.current < 2200) return;
      lastBlockDenyAtRef.current = now;
      onBlockDeniedRef.current?.({
        id: zone.id,
        message: zone.message?.trim() || DEFAULT_BLOCK_MESSAGE,
      });
    };

    const resolveCollision = (from: THREE.Vector3, to: THREE.Vector3) => {
      if (!collisionRef.current) {
        return to.clone();
      }
      const eye = tuningRef.current.eyeHeight;
      let x = to.x;
      let z = to.z;
      const y = from.y;

      if (lcc && hasCollision && lcc.intersectsCapsule) {
        const slide = (nx: number, nz: number) => {
          const hit = lcc!.intersectsCapsule!(capsuleAt(nx, y, nz, eye));
          if (!hit?.hit) return { x: nx, z: nz };
          return { x: nx + (hit.delta.x || 0), z: nz + (hit.delta.z || 0) };
        };

        // A stationary player must not be pushed back and forth by noisy furniture contacts.
        if (!gameLocomotionRef.current || Math.hypot(to.x - from.x, to.z - from.z) > 1e-6) {
          z = from.z;
          let s = slide(x, z);
          x = s.x;
          z = to.z;
          s = slide(x, z);
          x = s.x;
          z = s.z;
        }
      }

      // Soft authored barriers (oriented boxes along road edges / closed stretches)
      const enteringZone = findBlockZone(x, y, z);
      if (enteringZone && !findBlockZone(from.x, from.y, from.z)) {
        notifyBlockDenied(enteringZone);
        const fromL = worldToBlockLocal(from.x, from.z, enteringZone);
        const toL = worldToBlockLocal(x, z, enteringZone);
        let lx = toL.x;
        let lz = toL.z;
        const tryA = blockLocalToWorld(lx, fromL.z, enteringZone);
        const tryB = blockLocalToWorld(fromL.x, lz, enteringZone);
        if (!pointInBlockZone(tryA.x, y, tryA.z, enteringZone)) {
          lz = fromL.z;
        } else if (!pointInBlockZone(tryB.x, y, tryB.z, enteringZone)) {
          lx = fromL.x;
        } else {
          lx = fromL.x;
          lz = fromL.z;
        }
        const world = blockLocalToWorld(lx, lz, enteringZone);
        x = world.x;
        z = world.z;
      }

      let yOut = y;
      if (lcc && hasCollision && lcc.intersectsRayFromOriginExt) {
        const robotGrounding = gameLocomotionRef.current;
        const probe = robotGroundProbe(y, eye);
        const floorHit = lcc.intersectsRayFromOriginExt({
          origin: { x, y: robotGrounding ? probe.originY : y + 0.4, z },
          direction: { x: 0, y: -1, z: 0 },
          maxDistance: robotGrounding ? probe.maxDistance : 3.5,
        });
        if (robotGrounding) {
          yOut = robotGroundEyeY(y, eye, floorHit?.point?.y);
        } else if (floorHit?.point) {
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
        const steps = gameLocomotionRef.current && lcc.intersectsRayFromOriginExt ? 1 : Math.max(6, Math.ceil(travel / Math.max(0.06, radius * 0.85)));
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
    smooth.resolveJumpRise = (head, rise) => {
      if (!lcc || !collisionRef.current || !hasCollision || !lcc.intersectsRayFromOriginExt) return rise;
      const clearance = 0.08;
      const avatarHeight = mixamoTuningRef.current.avatarId === "orb" ? 0.41 : mixamoTuningRef.current.avatarId === "r01" ? 1.63 : mixamoTuningRef.current.avatarId === "walker" ? 1.65 : 1.75;
      const modelHeight = avatarHeight * Math.max(0.05, mixamoTuningRef.current.scale) +
        (mixamoTuningRef.current.avatarId === "orb" ? PROD02B_AVATARS.orb.hoverHeight : 0) +
        mixamoTuningRef.current.verticalOffset;
      const headY = head.y + Math.max(0, modelHeight - smooth.tuning.eyeHeight);
      const hit = lcc.intersectsRayFromOriginExt({
        origin: { x: head.x, y: headY, z: head.z },
        direction: { x: 0, y: 1, z: 0 },
        maxDistance: rise + clearance,
      });
      return hit?.point ? Math.min(rise, Math.max(0, hit.point.y - headY - clearance)) : rise;
    };
    smooth.resolveCameraBoom = resolveCameraBoom;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applyDpr();
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
      visualAvatar,
      blockDebugGroup,
      propsRoot,
      propTemplates,
      lcc: null,
      LCCRender: null,
      hasCollision: false,
      refreshBudget: applyDpr,
      eyeHeight: DEFAULT_SMOOTH_TUNING.eyeHeight,
    };
    // Let the props sync effect run now that propsRoot exists (draft may load before mount).
    setHostReadyTick((n) => n + 1);

    let downClientX = 0;
    let downClientY = 0;
    const snapFloorHit = (x: number, y: number): { x: number; y: number; z: number } | null => {
      if (!lcc?.raycast) return null;
      const hit = lcc.raycast({ evt: { x, y }, maxDistance: 80, radius: 0.12 });
      if (!hit) return null;
      let yPlace = hit.y;
      if (lcc.raycastFromOrigin) {
        const down = lcc.raycastFromOrigin({
          origin: { x: hit.x, y: hit.y + 1.5, z: hit.z },
          direction: { x: 0, y: -1, z: 0 },
          maxDistance: 4,
          radius: 0.08,
        });
        if (down) yPlace = down.y;
      }
      return { x: hit.x, y: yPlace, z: hit.z };
    };

    const onPointMovePointerDown = (evt: PointerEvent) => {
      downClientX = evt.clientX;
      downClientY = evt.clientY;
    };

    const tryPointMoveOrOrbitPivot = (evt: PointerEvent) => {
      if (evt.button !== 0) return;
      const kind = navKindRef.current;
      const rect = renderer.domElement.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;

      if (kind === "orbit" && evt.detail >= 2) {
        const floor = snapFloorHit(x, y);
        const fallback = lcc?.raycast?.({ evt: { x, y }, maxDistance: 80, radius: 0.1 });
        const p = floor ?? (fallback ? { x: fallback.x, y: fallback.y, z: fallback.z } : null);
        if (p) {
          orbit.target.set(p.x, p.y, p.z);
          orbit.update();
        }
        return;
      }

      if (!enablePointMoveRef.current) return;
      if (kind !== "current" && kind !== "smooth") return;
      if (Math.hypot(evt.clientX - downClientX, evt.clientY - downClientY) > 6) return;
      if (document.pointerLockElement === renderer.domElement) return;

      const rejectMove = (reason: string) => onPointMoveRejectedRef.current?.(reason);
      if (!hasCollision && !lcc?.intersectsRayExt && !lcc?.raycast) {
        rejectMove("Can't walk there yet — collision mesh is still loading.");
        return;
      }
      const floor = snapFloorHit(x, y);
      if (!floor) {
        rejectMove("Can't reach that spot.");
        return;
      }
      let dest = floor;
      if (lcc?.intersectsRayExt) {
        const ext = lcc.intersectsRayExt({ evt: { x, y }, maxDistance: 60 });
        if (ext?.point && (ext.normal?.y === undefined || ext.normal.y > 0.45)) {
          dest = { x: ext.point.x, y: ext.point.y, z: ext.point.z };
        } else if (ext?.point && ext.normal && ext.normal.y <= 0.45) {
          rejectMove("That's a wall — pick a spot on the floor.");
          return;
        }
      }
      const eyeH = tuningRef.current.eyeHeight;
      if (findBlockZone(dest.x, dest.y + eyeH * 0.4, dest.z)) {
        rejectMove("That section is under construction.");
        return;
      }
      if (lcc?.intersectsRayFromOriginExt) {
        const eye = smooth.enabled ? smooth.getEyePosition() : camera.position;
        const midY = Math.min(eye.y, dest.y + eyeH * 0.55);
        const dx = dest.x - eye.x;
        const dy = dest.y + 0.05 - midY;
        const dz = dest.z - eye.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const hit = lcc.intersectsRayFromOriginExt({
          origin: { x: eye.x, y: midY, z: eye.z },
          direction: { x: dx / len, y: dy / len, z: dz / len },
          maxDistance: Math.max(0.2, len - 0.15),
        });
        if (hit?.point) {
          rejectMove("Can't walk there directly — something is in the way.");
          return;
        }
      }
      if (smooth.enabled) smooth.setMoveTarget(dest.x, dest.y, dest.z);
      else walk.setMoveTarget(dest.x, dest.y, dest.z);
      destMarker.position.set(dest.x, dest.y + 0.03, dest.z);
      destMarker.visible = true;
    };

    const onPointMovePointerUp = (evt: PointerEvent) => {
      tryPointMoveOrOrbitPivot(evt);
    };

    renderer.domElement.addEventListener("pointerdown", onPointMovePointerDown, true);
    renderer.domElement.addEventListener("pointerup", onPointMovePointerUp, true);
    renderer.domElement.addEventListener("pointercancel", onPointMovePointerUp, true);

    let reviewVisible=true;
    const review = installOrbReview({renderer, camera, controller:smooth,
      visible(value) { reviewVisible=value; }, quality:()=>qualityRef.current.id });
    let previousReviewAt=performance.now();

    const applyNav = () => {
      const kind = navKindRef.current;
      smooth.enabled = kind === "smooth";
      walk.enabled = kind === "current";
      orbit.enabled = kind === "orbit";
      smooth.showCapsule =
        showCapsuleRef.current && kind === "smooth" && !showMixamoAvatarRef.current;
      visualAvatar.tuning = {
        ...visualAvatar.tuning,
        ...mixamoTuningRef.current,
        visible: showMixamoAvatarRef.current && kind === "smooth",
      };
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
            usePrecisionRaycast: !enableAvatarLocomotion,
            ...(enableAvatarLocomotion ? robotCacheBudget((navigator as Navigator & {deviceMemory?: number}).deviceMemory, navigator.hardwareConcurrency) : {}),
          },
          () => {
            if (cancelled || !lcc) return;
            phase = "ready";
            adaptAt = performance.now() + 10000; frameWindow.reset();
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

              /** Snap spawn eye onto collision mesh so checkpoints aren't buried. */
              const snapEyeToGround = (eye: THREE.Vector3, target: THREE.Vector3) => {
                const eh = tuningRef.current.eyeHeight;
                if (!lcc?.intersectsRayFromOriginExt || !collisionRef.current) {
                  return { eye, target };
                }
                const hit = lcc.intersectsRayFromOriginExt({
                  origin: { x: eye.x, y: eye.y + 3.5, z: eye.z },
                  direction: { x: 0, y: -1, z: 0 },
                  maxDistance: 12,
                });
                if (hit?.point?.y == null || !Number.isFinite(hit.point.y)) {
                  return { eye, target };
                }
                const eyeY = hit.point.y + eh;
                const dy = eyeY - eye.y;
                // Ignore tiny adjustments; accept lifts/drops so follow-target drafts recover.
                if (Math.abs(dy) < 0.04) return { eye, target };
                return {
                  eye: new THREE.Vector3(eye.x, eyeY, eye.z),
                  target: new THREE.Vector3(target.x, target.y + dy, target.z),
                };
              };

              const finish = (eyeIn: THREE.Vector3, targetIn: THREE.Vector3) => {
                const snapped = snapEyeToGround(eyeIn, targetIn);
                const eye = snapped.eye;
                const target = snapped.target;
                const kind = navKindRef.current;
                if (kind === "smooth") {
                  // Third-person: place body from authored eye (do not syncFromCamera boom).
                  smooth.setPose(eye, target);
                  orbit.target.copy(target);
                } else {
                  applyInteriorView(camera, orbit, (t) => {
                    camera.lookAt(t);
                  }, { eye, target, source: "fallback" });
                  walk.syncFromCamera();
                  smooth.syncFromCamera();
                }
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
        applyDpr();
      } catch (err) {
        phase = "error";
        error = (err as Error).message;
        pushStats();
      }
    })();

    const tick = () => {
      if (cancelled || contextLost || document.hidden) return;
      raf = requestAnimationFrame(tick);
      const frameStart = performance.now();
      if (previousFrameAt) frameWindow.add(frameStart - previousFrameAt);
      previousFrameAt = frameStart;
      renderer.info.reset();
      const dt = Math.min(clock.getDelta(), 0.05);
      frames += 1;
      const now = performance.now();
      if (now - lastFpsAt >= 500) {
        fps = Math.round((frames * 1000) / (now - lastFpsAt));
        frames = 0;
        lastFpsAt = now;
        pushStats();
        if (enableAvatarLocomotion && adaptiveRef.current && phase === "ready" && now >= adaptAt) {
          const previous = adaptive.level;
          adaptive.update(fps, frameWindow.summary().p95);
          if (adaptive.level !== previous) applyDpr();
          adaptAt = now + 5000;
          frameWindow.reset();
        }
      }
      const kind = navKindRef.current;
      if (kind === "smooth") {
        // Tuning is synced from React via effect (keeps wheel-adjusted preferredDistance).
        smooth.showCapsule =
          showCapsuleRef.current && !showMixamoAvatarRef.current;
        smooth.showDebug = showCameraDebugRef.current;
        smooth.gameLocomotion = gameLocomotionRef.current;
        smooth.allowSprint = true;
        const orbFocus = showMixamoAvatarRef.current && mixamoTuningRef.current.avatarId === "orb";
        smooth.cameraFocusHeight = orbFocus
          ? 0.27 * mixamoTuningRef.current.scale + PROD02B_AVATARS.orb.hoverHeight + mixamoTuningRef.current.verticalOffset
          : null;
        smooth.cameraFocusRadius = 0.14 * mixamoTuningRef.current.scale + 0.015;
        smooth.update(dt);
        const snap = smooth.getDebugSnapshot();
        const speed = Math.hypot(snap.velocity[0], snap.velocity[2]);
        visualAvatar.tuning = {
          ...visualAvatar.tuning,
          ...mixamoTuningRef.current,
          visible: showMixamoAvatarRef.current && reviewVisible,
        };
        if (showMixamoAvatarRef.current) ensureMixamoLoaded();
        visualAvatar.update(dt, {
          body: smooth.body,
          bodyYaw: snap.bodyYaw,
          groundY: smooth.body.y - snap.jumpHeight,
          velocityX: snap.velocity[0],
          velocityZ: snap.velocity[2],
          speed,
          movingInput: snap.movingInput,
          grounded: snap.grounded,
          jumpPhase: snap.jumpPhase,
          sprinting: snap.sprinting,
          boomDistance: snap.boomDistance,
        });
        if (showMixamoAvatarRef.current && now - lastAvatarDebugAt >= 500) {
          lastAvatarDebugAt = now;
          onAvatarDebugRef.current?.(visualAvatar.getDebug());
        }
      } else if (kind === "current") {
        walk.update(dt);
        visualAvatar.root.visible = false;
      } else {
        orbit.update();
        visualAvatar.root.visible = false;
      }
      const activeMove =
        (kind === "smooth" && smooth.hasMoveTarget()) ||
        (kind === "current" && walk.hasMoveTarget());
      if (activeMove) {
        const mt =
          kind === "smooth" ? smooth.getMoveTarget() : walk.getMoveTarget();
        if (mt) {
          destMarker.position.set(mt.x, mt.y + 0.03, mt.z);
          destMarker.visible = true;
        }
      } else {
        destMarker.visible = false;
      }
      // Frosted road blocks fade out with distance so far-side walls don't read across the scene.
      if (blockVisualRef.current === "glass") {
        const camX = camera.position.x;
        const camZ = camera.position.z;
        for (const child of blockDebugGroup.children) {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material as THREE.MeshPhysicalMaterial;
          if (!mat || !("opacity" in mat)) continue;
          const dx = mesh.position.x - camX;
          const dz = mesh.position.z - camZ;
          const dist = Math.hypot(dx, dz);
          const base = (mesh.userData.baseOpacity as number) ?? 0.28;
          let fade = 1;
          if (dist >= BLOCK_GLASS_FADE_END) fade = 0;
          else if (dist > BLOCK_GLASS_FADE_START) {
            fade =
              1 -
              (dist - BLOCK_GLASS_FADE_START) /
                (BLOCK_GLASS_FADE_END - BLOCK_GLASS_FADE_START);
          }
          mat.opacity = base * fade;
          mesh.visible = fade > 0.02;
        }
      }
      try {
        LCCRender?.update();
      } catch {
        /* ignore */
      }
      renderer.render(scene, camera);
      const reviewAt=performance.now();
      review.frame(reviewAt-previousReviewAt, reviewAt-frameStart);
      previousReviewAt=reviewAt;
      frameDraws = renderer.info.render.calls; frameTriangles = renderer.info.render.triangles;
      cpuMs = cpuMs * 0.9 + (performance.now() - frameStart) * 0.1;
    };
    const visibility = () => {
      cancelAnimationFrame(raf);
      smooth.clearVirtualInput();
      previousFrameAt = 0; frameWindow.reset(); clock.getDelta();
      frames = 0; lastFpsAt = performance.now(); adaptAt = performance.now() + 10000;
      if (!document.hidden && !contextLost) tick();
    };
    const lost = (event: Event) => {
      event.preventDefault(); contextLost = true; contextLosses++;
      cancelAnimationFrame(raf); phase = "error";
      error = "Graphics context lost. Reload scene to recover with a smaller budget.";
      pushStats();
    };
    document.addEventListener("visibilitychange", visibility);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    tick();

    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      cancelAnimationFrame(raf);
      review.dispose();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("pointerdown", onPointMovePointerDown, true);
      renderer.domElement.removeEventListener("pointerup", onPointMovePointerUp, true);
      renderer.domElement.removeEventListener("pointercancel", onPointMovePointerUp, true);
      ro.disconnect();
      walk.dispose();
      smooth.dispose();
      visualAvatar.dispose();
      scene.remove(visualAvatar.root);
      scene.remove(destMarker);
      destMarker.geometry.dispose();
      (destMarker.material as THREE.Material).dispose();
      while (blockDebugGroup.children.length) {
        const child = blockDebugGroup.children[0]!;
        blockDebugGroup.remove(child);
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      }
      scene.remove(blockDebugGroup);
      while (propsRoot.children.length) {
        const child = propsRoot.children[0]!;
        propsRoot.remove(child);
        child.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        });
      }
      propTemplates.clear();
      scene.remove(propsRoot);
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
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataPath]);

  return <div ref={mountRef} className="p2a-canvas" />;
});

function applyQuality(lcc: LccObject, q: Prod02aQualityPreset, allowLodUpgrade = true) {
  try {
    lcc.setMaxSplats?.(q.maxSplats);
    lcc.setMaxDistance?.(q.maxDistance);
    lcc.setSmooth?.(q.lodSmooth);
    lcc.setLodAutoLevelUp?.(allowLodUpgrade);
  } catch {
    /* ignore */
  }
}
