"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { QualityPreset } from "@/lib/labs/experiences/qualityPresets";
import { buildCollisionMapOutline, type MapPolyline } from "@/lib/labs/experiences/collisionMapOutline";
import { loadCanonicalStagingVisual } from "@/lib/labs/experiences/stagingAssetPipeline";
import {
  buildProxyFromObject,
  constrainFurnitureAgainstEnvironment,
  createProxyDebugMesh,
  resolveFurnitureSlide,
  type FurnitureCollisionProxy,
} from "@/lib/labs/experiences/stagingCollision";
import { measureObject } from "@/lib/labs/experiences/stagingModels";
import type {
  StagingPlacement,
  StagingTransformMode,
  Vec3 as StagingVec3,
} from "@/lib/labs/experiences/stagingTypes";
import {
  fromVec3,
  isPlanarWallSuitable,
  surfaceLocalMatrix,
  toVec3,
  twistedBasis,
} from "@/lib/labs/experiences/surfaceGeometry";
import { buildSurfaceGroup, disposeSurfaceGroup, loadTextureFromUrl } from "@/lib/labs/experiences/surfaceMeshes";
import {
  clipBoxForSurface,
  measureOverlayWallGap,
  type SurfaceDepthDiag,
  type SurfaceRenderPreset,
} from "@/lib/labs/experiences/surfaceOcclusion";
import { getSurfaceImageUrl } from "@/lib/labs/experiences/surfaceStorage";
import type {
  SurfaceOverlay,
  SurfacePickMeta,
  Vec3 as SurfaceVec3,
} from "@/lib/labs/experiences/surfaceTypes";
import type {
  CheckpointTransitionMode,
  ExperienceFloor,
  ExperienceHotspot,
  ExperienceViewpoint,
  Vec3Tuple,
} from "@/lib/labs/experiences/types";
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
import {
  SmoothAvatarControls,
  type SmoothNavTuning,
} from "@/lib/labs/prod02a/smoothAvatarControls";
import { resolveCameraBoomAlong } from "@/lib/labs/prod02a/cameraBoom";
import { tuningForFollowStyle } from "@/lib/labs/prod02a/cameraPresets";

export type TourNavMode = "orbit" | "first-person" | "point-move";

/**
 * Walk camera style (PROD-02A). `first-person` = classic LccWalkControls;
 * `free` / `ecctrl` = invisible avatar + third-person follow camera.
 */
export type CameraFollowStyle = "first-person" | "free" | "ecctrl";

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
  pitch: number;
};

export type TourHostHandle = {
  setVirtualMove: (x: number, z: number) => void;
  setVirtualLook: (yawDir: number, pitchDir: number) => void;
  clearVirtualInput: () => void;
  /** Stop Point & Move / auto travel on both controllers. */
  cancelAutoMove: () => void;
  /** PNG data URL of the current WebGL canvas, or null if not ready. */
  captureScreenshot: () => string | null;
  /** Change walk / collision eye height (metres) and nudge the camera Y. */
  setEyeHeight: (metres: number) => void;
  getEyeHeight: () => number;
};

/** Soft walk blockers (floor-local AABB). */
export type TourBlockZone = {
  id: string;
  enabled: boolean;
  center: Vec3Tuple;
  size: Vec3Tuple;
};

type Props = {
  dataPath: string;
  navMode: TourNavMode;
  quality: QualityPreset;
  collisionEnabled: boolean;
  hotspots: ExperienceHotspot[];
  /** Checkpoints shown as clickable 3D pins (and used with fly-to). */
  viewpoints?: ExperienceViewpoint[];
  /** Floor used to UV-project collision wall guides for the 2D map. */
  floor?: ExperienceFloor | null;
  flyTo: {
    viewpoint: ExperienceViewpoint;
    token: number;
    preferFade?: boolean;
    transition?: CheckpointTransitionMode;
  } | null;
  placeHotspotMode: boolean;
  /** Live preview for a captured checkpoint pose (before save). */
  posePreview?: CameraPoseSample | null;
  /** Live preview for a placed hotspot click (before save). */
  hotspotPreview?: Vec3Tuple | null;
  onStats: (s: TourHostStats) => void;
  onHotspotSelect: (hs: ExperienceHotspot | null) => void;
  onViewpointSelect?: (vp: ExperienceViewpoint) => void;
  onHotspotPlaced: (position: Vec3Tuple) => void;
  onCameraSample: (sample: CameraPoseSample) => void;
  onPoseTick?: (pose: CameraPoseSample) => void;
  onFade?: (opaque: boolean) => void;
  onMapOutline?: (lines: MapPolyline[]) => void;
  resetToken: number;
  sampleCameraToken: number;
  /**
   * Optional authored start camera (floor-local). When set, overrides pose-based
   * interior framing after LCC load (LAB PROD-01).
   */
  startCamera?: { position: Vec3Tuple; target: Vec3Tuple; eyeHeight?: number } | null;
  /** Initial / controlled eye height (metres). Defaults to 1.55. */
  eyeHeight?: number;
  /** Soft barriers — reject walk into these boxes. */
  blockZones?: TourBlockZone[];
  /** Visitor-facing reason when Point & Move refuses a click. */
  onPointMoveRejected?: (reason: string) => void;
  /** Walk camera style. Defaults to classic first-person. */
  cameraFollowStyle?: CameraFollowStyle;
  /** Optional smooth-nav tuning override (else tuningForFollowStyle). */
  smoothTuning?: SmoothNavTuning | null;
  /** Fires once when the LCC model reaches ready (after camera applied). */
  onSceneReady?: () => void;
  /** EXP-04 virtual staging */
  stagingPlacements?: StagingPlacement[];
  stagingVisible?: boolean;
  stagingEditEnabled?: boolean;
  stagingPlaceMode?: boolean;
  stagingSelectedId?: string | null;
  stagingTransformMode?: StagingTransformMode;
  /** Dev: show OBB wireframes for furniture collision proxies. */
  stagingProxyDebug?: boolean;
  onStagingPlace?: (hit: { position: Vec3Tuple; normal?: Vec3Tuple }) => void;
  onStagingSelect?: (id: string | null) => void;
  onStagingTransform?: (id: string, next: { position: StagingVec3; rotation: StagingVec3; scale: StagingVec3 }) => void;
  onStagingDims?: (dims: { size: StagingVec3; position: StagingVec3; rotation: StagingVec3; scale: StagingVec3 } | null) => void;
  /** EXP-05 wall / surface overlays */
  surfaceOverlays?: SurfaceOverlay[];
  surfacesVisible?: boolean;
  surfaceEditEnabled?: boolean;
  surfaceMode?: "idle" | "pick" | "corners";
  surfaceSelectedId?: string | null;
  surfaceCornerHits?: { point: SurfaceVec3; normal: SurfaceVec3 }[];
  onSurfacePick?: (meta: SurfacePickMeta) => void;
  onSurfaceCornerHit?: (hit: { point: SurfaceVec3; normal: SurfaceVec3 }) => void;
  onSurfaceSelect?: (id: string | null) => void;
  /** Persist centre after dragging a panel along its wall plane. */
  onSurfaceTransform?: (id: string, next: { center: SurfaceVec3 }) => void;
  /** When false, clicking a surface only selects it (no drag) so look/orbit stay usable. */
  surfaceDragEnabled?: boolean;
  /** EXP-05B occlusion lab */
  surfaceRenderPreset?: SurfaceRenderPreset;
  surfaceClipTest?: boolean;
  surfaceSemanticProbe?: boolean;
  surfaceCollisionDepthProxy?: boolean;
  onSurfaceDepthDiag?: (diag: SurfaceDepthDiag | null) => void;
  onSurfaceLabNote?: (note: string) => void;
};

const FALLBACK_EYE = new THREE.Vector3(0, 1.5, 0.5);
const FALLBACK_TARGET = new THREE.Vector3(0, 1.35, -2.5);
const FLY_FADE_DURATION_S = 1.15;
const FLY_SMOOTH_DURATION_S = 2.4;
/** Keep capsule clear of the floor mesh so standing contact does not freeze walk. */
const CAPSULE_RADIUS = 0.22;
const EYE = 1.5;
const CAPSULE_FOOT_CLEARANCE = 0.35;

type FlyState = {
  fromEye: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toEye: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  fade: boolean;
  duration: number;
};

/**
 * Plain Three.js + LCC SDK host for Spatial Lab Experiences (EXP-01 / EXP-02).
 */
export const ExperienceTourHost = forwardRef<TourHostHandle, Props>(function ExperienceTourHost(
  {
    dataPath,
    navMode,
    quality,
    collisionEnabled,
    hotspots,
    viewpoints = [],
    floor = null,
    flyTo,
    placeHotspotMode,
    posePreview = null,
    hotspotPreview = null,
    onStats,
    onHotspotSelect,
    onViewpointSelect,
    onHotspotPlaced,
    onCameraSample,
    onPoseTick,
    onFade,
    onMapOutline,
    resetToken,
    sampleCameraToken,
    startCamera = null,
    eyeHeight: eyeHeightProp = EYE,
    blockZones = [],
    onPointMoveRejected,
    cameraFollowStyle = "first-person",
    smoothTuning = null,
    onSceneReady,
    stagingPlacements = [],
    stagingVisible = true,
    stagingEditEnabled = false,
    stagingPlaceMode = false,
    stagingSelectedId = null,
    stagingTransformMode = "translate",
    stagingProxyDebug = false,
    onStagingPlace,
    onStagingSelect,
    onStagingTransform,
    onStagingDims,
    surfaceOverlays = [],
    surfacesVisible = true,
    surfaceEditEnabled = false,
    surfaceMode = "idle",
    surfaceSelectedId = null,
    surfaceCornerHits = [],
    onSurfacePick,
    onSurfaceCornerHit,
    onSurfaceSelect,
    onSurfaceTransform,
    surfaceDragEnabled = false,
    surfaceRenderPreset = "default",
    surfaceClipTest = false,
    surfaceSemanticProbe = false,
    surfaceCollisionDepthProxy = false,
    onSurfaceDepthDiag,
    onSurfaceLabNote,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    LCCRender: LCCRenderType;
    lcc: LccObject | null;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    orbit: OrbitControls;
    walk: LccWalkControls;
    smooth: SmoothAvatarControls;
    applyNavMode: (mode: TourNavMode, resync?: boolean) => void;
    poseSmoothFromCamera: () => void;
    clock: THREE.Clock;
    home: InteriorView;
    markers: THREE.Group;
    preview: THREE.Group;
    stagingRoot: THREE.Group;
    surfaceRoot: THREE.Group;
    surfacePickPreview: THREE.Group;
    collisionDepthProxy: THREE.Group;
    placePreview: THREE.Group;
    proxyDebugRoot: THREE.Group;
    transform: TransformControls | null;
    transformHelper: THREE.Object3D | null;
    fly: FlyState | null;
    loadStarted: number;
    hasCollision: boolean;
    navSuspended: boolean;
    rebuildFurnitureProxies: () => void;
  } | null>(null);

  const hotspotsRef = useRef(hotspots);
  const viewpointsRef = useRef(viewpoints);
  const placeModeRef = useRef(placeHotspotMode);
  const qualityRef = useRef(quality);
  const collisionRef = useRef(collisionEnabled);
  const onStatsRef = useRef(onStats);
  const onHotspotSelectRef = useRef(onHotspotSelect);
  const onViewpointSelectRef = useRef(onViewpointSelect);
  const onHotspotPlacedRef = useRef(onHotspotPlaced);
  const onCameraSampleRef = useRef(onCameraSample);
  const onPoseTickRef = useRef(onPoseTick);
  const onFadeRef = useRef(onFade);
  const onMapOutlineRef = useRef(onMapOutline);
  const onSceneReadyRef = useRef(onSceneReady);
  const onPointMoveRejectedRef = useRef(onPointMoveRejected);
  const startCameraRef = useRef(startCamera);
  const eyeHeightRef = useRef(eyeHeightProp);
  const blockZonesRef = useRef(blockZones);
  const cameraFollowStyleRef = useRef<CameraFollowStyle>(cameraFollowStyle);
  const smoothTuningRef = useRef<SmoothNavTuning | null>(smoothTuning);
  const floorRef = useRef(floor);
  const navModeRef = useRef(navMode);
  const stagingPlaceModeRef = useRef(stagingPlaceMode);
  const stagingEditRef = useRef(stagingEditEnabled);
  const stagingVisibleRef = useRef(stagingVisible);
  const stagingProxyDebugRef = useRef(stagingProxyDebug);
  const stagingTransformModeRef = useRef(stagingTransformMode);
  const furnitureProxiesRef = useRef<FurnitureCollisionProxy[]>([]);
  const onStagingPlaceRef = useRef(onStagingPlace);
  const onStagingSelectRef = useRef(onStagingSelect);
  const onStagingTransformRef = useRef(onStagingTransform);
  const onStagingDimsRef = useRef(onStagingDims);
  const surfaceModeRef = useRef(surfaceMode);
  const surfaceEditRef = useRef(surfaceEditEnabled);
  const surfacesVisibleRef = useRef(surfacesVisible);
  const onSurfacePickRef = useRef(onSurfacePick);
  const onSurfaceCornerHitRef = useRef(onSurfaceCornerHit);
  const onSurfaceSelectRef = useRef(onSurfaceSelect);
  const onSurfaceTransformRef = useRef(onSurfaceTransform);
  const onSurfaceDepthDiagRef = useRef(onSurfaceDepthDiag);
  const onSurfaceLabNoteRef = useRef(onSurfaceLabNote);
  const surfaceUrlCacheRef = useRef(new Map<string, string>());
  const surfaceRenderPresetRef = useRef(surfaceRenderPreset);
  const surfaceOverlaysRef = useRef(surfaceOverlays);
  const surfaceSelectedIdRef = useRef(surfaceSelectedId);
  const surfaceDragEnabledRef = useRef(surfaceDragEnabled);
  const surfaceDragRef = useRef<{
    id: string;
    plane: THREE.Plane;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
    normal: THREE.Vector3;
    offset: number;
    grabU: number;
    grabV: number;
    center: THREE.Vector3;
  } | null>(null);
  hotspotsRef.current = hotspots;
  viewpointsRef.current = viewpoints;
  placeModeRef.current = placeHotspotMode;
  qualityRef.current = quality;
  collisionRef.current = collisionEnabled;
  onStatsRef.current = onStats;
  onHotspotSelectRef.current = onHotspotSelect;
  onViewpointSelectRef.current = onViewpointSelect;
  onHotspotPlacedRef.current = onHotspotPlaced;
  onCameraSampleRef.current = onCameraSample;
  onPoseTickRef.current = onPoseTick;
  onFadeRef.current = onFade;
  onMapOutlineRef.current = onMapOutline;
  onSceneReadyRef.current = onSceneReady;
  onPointMoveRejectedRef.current = onPointMoveRejected;
  startCameraRef.current = startCamera;
  eyeHeightRef.current = eyeHeightProp;
  blockZonesRef.current = blockZones;
  cameraFollowStyleRef.current = cameraFollowStyle;
  smoothTuningRef.current = smoothTuning;
  floorRef.current = floor;
  navModeRef.current = navMode;
  stagingPlaceModeRef.current = stagingPlaceMode;
  stagingEditRef.current = stagingEditEnabled;
  stagingVisibleRef.current = stagingVisible;
  stagingProxyDebugRef.current = stagingProxyDebug;
  stagingTransformModeRef.current = stagingTransformMode;
  onStagingPlaceRef.current = onStagingPlace;
  onStagingSelectRef.current = onStagingSelect;
  onStagingTransformRef.current = onStagingTransform;
  onStagingDimsRef.current = onStagingDims;
  surfaceModeRef.current = surfaceMode;
  surfaceEditRef.current = surfaceEditEnabled;
  surfacesVisibleRef.current = surfacesVisible;
  onSurfacePickRef.current = onSurfacePick;
  onSurfaceCornerHitRef.current = onSurfaceCornerHit;
  onSurfaceSelectRef.current = onSurfaceSelect;
  onSurfaceTransformRef.current = onSurfaceTransform;
  onSurfaceDepthDiagRef.current = onSurfaceDepthDiag;
  onSurfaceLabNoteRef.current = onSurfaceLabNote;
  surfaceRenderPresetRef.current = surfaceRenderPreset;
  surfaceOverlaysRef.current = surfaceOverlays;
  surfaceSelectedIdRef.current = surfaceSelectedId;
  surfaceDragEnabledRef.current = surfaceDragEnabled;

  useImperativeHandle(ref, () => ({
    setVirtualMove: (x, z) => {
      const api = apiRef.current;
      if (!api) return;
      if (api.smooth.enabled) api.smooth.setVirtualMove(x, z);
      else api.walk.setVirtualMove(x, z);
    },
    setVirtualLook: (yawDir, pitchDir) => {
      const api = apiRef.current;
      if (!api) return;
      if (api.smooth.enabled) api.smooth.setVirtualLook(yawDir, pitchDir);
      else api.walk.setVirtualLook(yawDir, pitchDir);
    },
    clearVirtualInput: () => {
      const api = apiRef.current;
      if (!api) return;
      if (api.smooth.enabled) api.smooth.clearVirtualInput();
      api.walk.clearVirtualInput();
    },
    cancelAutoMove: () => {
      const api = apiRef.current;
      if (!api) return;
      api.smooth.cancelMoveTarget();
      api.walk.cancelMoveTarget();
    },
    getEyeHeight: () => eyeHeightRef.current,
    setEyeHeight: (metres: number) => {
      const next = Math.max(0.9, Math.min(2.2, metres));
      const prev = eyeHeightRef.current;
      const dy = next - prev;
      eyeHeightRef.current = next;
      const api = apiRef.current;
      if (!api) return;
      api.walk.eyeHeight = next;
      api.smooth.tuning.eyeHeight = next;
      if (api.smooth.enabled) {
        // Feet stay on the floor (body.y is unchanged). The collision resolver re-derives the eye
        // Y from the floor + new eye height next step, and the boom follows the body — so there is
        // no need to re-seat from the (boom) camera, which would drag the body backwards.
        api.orbit.target.y += dy;
        return;
      }
      api.camera.position.y += dy;
      api.orbit.target.y += dy;
      api.orbit.update();
      api.walk.syncFromCamera();
    },
    captureScreenshot: () => {
      const api = apiRef.current;
      if (!api) return null;
      try {
        if (api.LCCRender && api.lcc) api.LCCRender.update();
        api.renderer.render(api.scene, api.camera);
        return api.renderer.domElement.toDataURL("image/png");
      } catch {
        return null;
      }
    },
  }));

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
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c0c);

    const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 150000);
    camera.position.copy(FALLBACK_EYE);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    const applyPixelRatio = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityRef.current.pixelRatioCap));
    };
    applyPixelRatio();
    renderer.setClearColor(0x0c0c0c);
    // Hide canvas until the authored (or poses) start camera is applied — avoids flash of fallback/recording pose.
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 0.35s ease";
    mount.appendChild(renderer.domElement);

    const revealCanvas = () => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        renderer.domElement.style.opacity = "1";
      });
    };

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.copy(FALLBACK_TARGET);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.update();

    const walk = new LccWalkControls(camera, renderer.domElement);
    walk.enabled = false;
    walk.eyeHeight = eyeHeightRef.current;
    walk.lockEyeHeight = true;

    // PROD-02A smooth avatar + follow camera (disabled unless style is free/ecctrl)
    const smooth = new SmoothAvatarControls(camera, renderer.domElement);
    smooth.enabled = false;
    smooth.showCapsule = false;
    smooth.showDebug = false;
    smooth.tuning = { ...smooth.tuning, eyeHeight: eyeHeightRef.current };

    const clock = new THREE.Clock();
    const markers = new THREE.Group();
    const preview = new THREE.Group();
    const stagingRoot = new THREE.Group();
    stagingRoot.name = "stagingRoot";
    const surfaceRoot = new THREE.Group();
    surfaceRoot.name = "surfaceRoot";
    const surfacePickPreview = new THREE.Group();
    surfacePickPreview.name = "surfacePickPreview";
    const hemi = new THREE.HemisphereLight(0xf0f4ff, 0x3a3028, 0.85);
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(2.5, 6, 1.5);
    stagingRoot.add(hemi, key);
    scene.add(markers);
    scene.add(preview);
    scene.add(stagingRoot);
    const collisionDepthProxy = new THREE.Group();
    collisionDepthProxy.name = "collisionDepthProxy";
    collisionDepthProxy.visible = false;
    scene.add(surfaceRoot);
    scene.add(surfacePickPreview);
    scene.add(collisionDepthProxy);

    const placePreview = new THREE.Group();
    placePreview.name = "stagingPlacePreview";
    placePreview.visible = false;
    const placeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.28, 40),
      new THREE.MeshBasicMaterial({
        color: 0x6eb5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    placeRing.rotation.x = -Math.PI / 2;
    const placeDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    placeDot.position.y = 0.06;
    placePreview.add(placeRing, placeDot);
    scene.add(placePreview);

    const proxyDebugRoot = new THREE.Group();
    proxyDebugRoot.name = "stagingProxyDebug";
    proxyDebugRoot.visible = false;
    scene.add(proxyDebugRoot);
    scene.add(smooth.capsuleMesh);
    scene.add(smooth.debugGroup);

    const rebuildFurnitureProxies = () => {
      const list: FurnitureCollisionProxy[] = [];
      if (stagingVisibleRef.current) {
        for (const child of stagingRoot.children) {
          const id = child.userData.stagingId as string | undefined;
          if (!id || child.visible === false) continue;
          // Opt-in collision: new placements default off; legacy saves without the flag stay on
          if (child.userData.stagingCollision === false) continue;
          const proxy = buildProxyFromObject(id, child);
          if (proxy) list.push(proxy);
        }
      }
      furnitureProxiesRef.current = list;

      while (proxyDebugRoot.children.length) {
        const c = proxyDebugRoot.children[0];
        proxyDebugRoot.remove(c);
        const ls = c as THREE.LineSegments;
        ls.geometry?.dispose();
        (ls.material as THREE.Material)?.dispose?.();
      }
      if (stagingProxyDebugRef.current) {
        for (const p of list) proxyDebugRoot.add(createProxyDebugMesh(p));
      }
      proxyDebugRoot.visible = stagingProxyDebugRef.current && list.length > 0;
    };

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate");
    transform.setSpace("world");
    const transformHelper = transform.getHelper();
    scene.add(transformHelper);
    transform.enabled = false;
    transformHelper.visible = false;
    const pushTransform = (persist: boolean) => {
      const api = apiRef.current;
      const obj = transform.object;
      if (!api || !obj) return;
      const id = obj.userData.stagingId as string | undefined;
      if (!id) return;
      const e = obj.rotation;
      const payload = {
        position: [obj.position.x, obj.position.y, obj.position.z] as StagingVec3,
        rotation: [e.x, e.y, e.z] as StagingVec3,
        scale: [obj.scale.x, obj.scale.y, obj.scale.z] as StagingVec3,
      };
      if (persist) {
        onStagingTransformRef.current?.(id, payload);
        api.rebuildFurnitureProxies();
      }
      const { size } = measureObject(obj);
      onStagingDimsRef.current?.({
        size: [size.x, size.y, size.z],
        ...payload,
      });
    };
    transform.addEventListener("mouseDown", () => {
      if (!apiRef.current) return;
      apiRef.current.navSuspended = true;
      apiRef.current.walk.enabled = false;
      apiRef.current.smooth.enabled = false;
      apiRef.current.smooth.cancelMotion();
      apiRef.current.orbit.enabled = false;
    });
    transform.addEventListener("mouseUp", () => {
      if (!apiRef.current) return;
      pushTransform(true);
      apiRef.current.navSuspended = false;
      restoreNavEnabled();
    });
    transform.addEventListener("objectChange", () => {
      const api = apiRef.current;
      const obj = transform.object;
      if (api && obj) {
        const mode = stagingTransformModeRef.current;
        // Uniform scale: keep proportions (XYZ stay equal)
        if (transform.mode === "scale" && mode === "scaleUniform") {
          const s = Math.cbrt(Math.abs(obj.scale.x * obj.scale.y * obj.scale.z)) || 1;
          const signX = Math.sign(obj.scale.x) || 1;
          obj.scale.set(signX * s, signX * s, signX * s);
        }
        // Wall push only while translating, and only if this object has walk collision on.
        // Off by default for new placements so staging stays free; rotate/scale never push.
        if (mode === "translate" && obj.userData.stagingCollision !== false) {
          constrainFurnitureAgainstEnvironment(obj, api.lcc);
        }
      }
      pushTransform(false);
      apiRef.current?.rebuildFurnitureProxies();
    });

    // Restore controller enable flags after a temporary nav suspend (staging / surface drag).
    const restoreNavEnabled = () => {
      const mode = navModeRef.current;
      const walkLike = mode === "first-person" || mode === "point-move";
      const useSmooth = walkLike && cameraFollowStyleRef.current !== "first-person";
      walk.enabled = walkLike && !useSmooth;
      smooth.enabled = useSmooth;
      orbit.enabled = mode === "orbit";
    };

    // Available before LCC finishes loading so staging sync effects can attach.
    apiRef.current = {
      LCCRender: null as unknown as LCCRenderType,
      lcc: null,
      camera,
      renderer,
      scene,
      orbit,
      walk,
      smooth,
      applyNavMode,
      poseSmoothFromCamera,
      clock,
      home: { eye: FALLBACK_EYE.clone(), target: FALLBACK_TARGET.clone(), source: "fallback" },
      markers,
      preview,
      stagingRoot,
      surfaceRoot,
      surfacePickPreview,
      collisionDepthProxy,
      placePreview,
      proxyDebugRoot,
      transform,
      transformHelper,
      fly: null,
      loadStarted: performance.now(),
      hasCollision: false,
      navSuspended: false,
      rebuildFurnitureProxies,
    };

    const tmpStart = { x: 0, y: 0, z: 0 };
    const tmpEnd = { x: 0, y: 0, z: 0 };
    const down = new THREE.Vector3(0, -1, 0);

    const capsuleAt = (x: number, y: number, z: number) => {
      const eye = eyeHeightRef.current;
      tmpStart.x = x;
      tmpStart.y = y - eye + CAPSULE_FOOT_CLEARANCE;
      tmpStart.z = z;
      tmpEnd.x = x;
      tmpEnd.y = y + 0.08;
      tmpEnd.z = z;
      return { start: tmpStart, end: tmpEnd, radius: CAPSULE_RADIUS };
    };

    const insideBlockZone = (x: number, y: number, z: number) => {
      for (const zone of blockZonesRef.current) {
        if (!zone.enabled) continue;
        const hx = zone.size[0] / 2;
        const hy = zone.size[1] / 2;
        const hz = zone.size[2] / 2;
        if (
          x >= zone.center[0] - hx &&
          x <= zone.center[0] + hx &&
          y >= zone.center[1] - hy &&
          y <= zone.center[1] + hy &&
          z >= zone.center[2] - hz &&
          z <= zone.center[2] + hz
        ) {
          return true;
        }
      }
      return false;
    };

    const resolveHorizontal = (lcc: NonNullable<typeof apiRef.current>["lcc"], x: number, y: number, z: number) => {
      if (!lcc?.intersectsCapsule) return { x, z, blocked: false };
      const hit = lcc.intersectsCapsule(capsuleAt(x, y, z));
      if (!hit?.hit) return { x, z, blocked: false };
      // delta is the depenetration offset — use horizontal only
      return { x: x + (hit.delta.x || 0), z: z + (hit.delta.z || 0), blocked: true };
    };

    const resolveCollision = (from: THREE.Vector3, to: THREE.Vector3) => {
      const lcc = apiRef.current?.lcc;
      const eye = eyeHeightRef.current;
      let x = to.x;
      let z = to.z;
      let y = from.y;

      // 1) LCC environment (walls / floor) — unchanged axis slide
      if (lcc && collisionRef.current && apiRef.current?.hasCollision && lcc.intersectsCapsule) {
        z = from.z;
        let step = resolveHorizontal(lcc, x, y, z);
        x = step.x;
        const checkX = lcc.intersectsCapsule(capsuleAt(x, y, z));
        if (checkX?.hit && Math.hypot(checkX.delta.x, checkX.delta.z) > 0.45) {
          x = from.x;
        }

        z = to.z;
        step = resolveHorizontal(lcc, x, y, z);
        x = step.x;
        z = step.z;
        const checkZ = lcc.intersectsCapsule(capsuleAt(x, y, z));
        if (checkZ?.hit && Math.hypot(checkZ.delta.x, checkZ.delta.z) > 0.45) {
          x = from.x;
          z = from.z;
        }

        if (lcc.intersectsRayFromOriginExt) {
          const floorHit = lcc.intersectsRayFromOriginExt({
            origin: { x, y: y + 0.2, z },
            direction: { x: 0, y: -1, z: 0 },
            maxDistance: eye + 0.9,
          });
          if (floorHit?.point && (floorHit.normal?.y === undefined || floorHit.normal.y > 0.45)) {
            const proposed = floorHit.point.y + eye;
            if (Math.abs(proposed - y) < 0.85) y = proposed;
          }
        } else if (lcc.raycastFromOrigin) {
          const floorHit = lcc.raycastFromOrigin({
            origin: { x, y: y + 0.2, z },
            direction: { x: down.x, y: down.y, z: down.z },
            maxDistance: eye + 0.9,
            radius: 0.05,
          });
          if (floorHit) {
            const proposed = floorHit.y + eye;
            if (Math.abs(proposed - y) < 0.85) y = proposed;
          }
        }
      }

      // 2) Authored block zones (soft walls) — reject entry on XZ
      if (insideBlockZone(x, y, z) && !insideBlockZone(from.x, from.y, from.z)) {
        // Try axis slide
        if (!insideBlockZone(x, y, from.z)) z = from.z;
        else if (!insideBlockZone(from.x, y, z)) x = from.x;
        else {
          x = from.x;
          z = from.z;
        }
      }

      // 3) Staged furniture OBB proxies (after env) — XZ only; does not affect fly/teleport
      const afterEnv = new THREE.Vector3(x, y, z);
      return resolveFurnitureSlide(
        from,
        afterEnv,
        furnitureProxiesRef.current,
        CAPSULE_RADIUS,
        eye,
        CAPSULE_FOOT_CLEARANCE,
      );
    };
    walk.resolveCollision = resolveCollision;
    // Same resolver (LCC + blockZones + furniture) drives the smooth avatar body.
    smooth.resolveCollision = resolveCollision;
    smooth.resolveCameraBoom = (from, to, radius) =>
      resolveCameraBoomAlong(apiRef.current?.lcc ?? null, from, to, radius, {
        enabled: collisionRef.current && smooth.tuning.cameraCollisionEnabled !== false,
        hasCollision: !!apiRef.current?.hasCollision,
      });

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

    let appliedSmoothKey = "";
    const smoothTuningKey = () =>
      `${cameraFollowStyleRef.current}|${smoothTuningRef.current ? JSON.stringify(smoothTuningRef.current) : ""}`;
    const applySmoothTuning = () => {
      const style = cameraFollowStyleRef.current;
      if (style === "first-person") return;
      const base = smoothTuningRef.current ?? tuningForFollowStyle(style);
      smooth.tuning = { ...base, eyeHeight: eyeHeightRef.current };
      appliedSmoothKey = smoothTuningKey();
    };
    /** Place the invisible body at the camera eye and let the boom pull the camera back. */
    function poseSmoothFromCamera() {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const eye = camera.position.clone();
      smooth.setPose(eye, eye.clone().add(dir));
    }
    /**
     * `resync` forces smooth to re-seat from the camera (after load / fly / reset) even when
     * smooth was already enabled.
     */
    function applyNavMode(mode: TourNavMode, resync = false) {
      const walkLike = mode === "first-person" || mode === "point-move";
      const useSmooth = walkLike && cameraFollowStyleRef.current !== "first-person";
      const wasSmooth = smooth.enabled;

      walk.cancelMoveTarget();
      smooth.cancelMoveTarget();
      smooth.cancelMotion();

      // Leaving smooth for classic walk: continue from the body eye, not the boom camera
      if (wasSmooth && !useSmooth && walkLike && !resync) {
        smooth.getEyePosition(camera.position);
      }

      walk.enabled = walkLike && !useSmooth;
      smooth.enabled = useSmooth;
      orbit.enabled = mode === "orbit";
      orbit.enableRotate = mode === "orbit";
      orbit.enablePan = mode === "orbit";
      orbit.enableZoom = true;
      if (!walkLike || useSmooth) walk.exitPointerLock();

      if (useSmooth) {
        if (!wasSmooth || resync || appliedSmoothKey !== smoothTuningKey()) applySmoothTuning();
        if (!wasSmooth || resync) poseSmoothFromCamera();
      } else if (walkLike) {
        walk.syncFromCamera();
      }
      if (walkLike) {
        try {
          renderer.domElement.focus({ preventScroll: true });
        } catch {
          renderer.domElement.focus();
        }
      }
    }
    applyNavMode(navModeRef.current);

    // Point & Move destination ring
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

    const snapFloorHit = (x: number, y: number): { x: number; y: number; z: number } | null => {
      if (!lcc) return null;
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

    const applySurfaceDrag = (clientX: number, clientY: number) => {
      const drag = surfaceDragRef.current;
      const api = apiRef.current;
      if (!drag || !api) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(drag.plane, hit)) return;
      // New centre so the grab point stays under the cursor (along the wall plane)
      const next = hit
        .clone()
        .addScaledVector(drag.tangent, -drag.grabU)
        .addScaledVector(drag.bitangent, -drag.grabV)
        .addScaledVector(drag.normal, -drag.offset);
      drag.center.copy(next);
      const group = api.surfaceRoot.children.find((c) => c.userData.surfaceId === drag.id);
      if (group) {
        const surf = surfaceOverlaysRef.current.find((s) => s.id === drag.id);
        if (surf) {
          const live = { ...surf, center: toVec3(next) as SurfaceVec3 };
          group.matrix.copy(surfaceLocalMatrix(live));
          group.matrixWorldNeedsUpdate = true;
        }
      }
    };

    const endSurfaceDrag = () => {
      const drag = surfaceDragRef.current;
      if (!drag || !apiRef.current) return;
      surfaceDragRef.current = null;
      onSurfaceTransformRef.current?.(drag.id, { center: toVec3(drag.center) });
      apiRef.current.navSuspended = false;
      restoreNavEnabled();
      renderer.domElement.style.cursor =
        surfaceEditRef.current && (surfaceModeRef.current === "pick" || surfaceModeRef.current === "corners")
          ? "crosshair"
          : "";
    };

    const onPointerMove = (evt: PointerEvent) => {
      if (!lcc || !apiRef.current) return;
      if (surfaceDragRef.current) {
        applySurfaceDrag(evt.clientX, evt.clientY);
        evt.preventDefault();
        return;
      }
      if (!(stagingEditRef.current && stagingPlaceModeRef.current)) {
        apiRef.current.placePreview.visible = false;
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const hit = snapFloorHit(x, y);
      if (!hit) {
        apiRef.current.placePreview.visible = false;
        return;
      }
      apiRef.current.placePreview.visible = true;
      apiRef.current.placePreview.position.set(hit.x, hit.y + 0.02, hit.z);
    };

    const pickSurfaceHit = (
      sx: number,
      sy: number,
    ): { point: SurfaceVec3; normal: SurfaceVec3; source: "collision" | "splat" } | null => {
      if (!lcc) return null;
      if (lcc.intersectsRayExt) {
        const hit = lcc.intersectsRayExt({ evt: { x: sx, y: sy }, maxDistance: 80 });
        if (hit?.point && hit.normal) {
          return {
            point: toVec3(hit.point),
            normal: toVec3(hit.normal),
            source: "collision",
          };
        }
      }
      const splat = lcc.raycast({ evt: { x: sx, y: sy }, maxDistance: 80, radius: 0.12 });
      if (!splat) return null;
      // Approximate outward normal from camera → hit (into the surface)
      const cam = camera.position;
      const nx = splat.x - cam.x;
      const ny = splat.y - cam.y;
      const nz = splat.z - cam.z;
      const len = Math.hypot(nx, ny, nz) || 1;
      return {
        point: [splat.x, splat.y, splat.z],
        normal: [-nx / len, -ny / len, -nz / len],
        source: "splat",
      };
    };

    // Own click-gesture tracking: walk's pointerdown only runs while walk.enabled (not in smooth mode)
    let downClientX = 0;
    let downClientY = 0;
    const onPointerDown = (evt: PointerEvent) => {
      if (evt.button === 0) {
        downClientX = evt.clientX;
        downClientY = evt.clientY;
      }
      if (!lcc || evt.button !== 0) return;
      if (apiRef.current?.navSuspended) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      pointer.x = (x / rect.width) * 2 - 1;
      pointer.y = -(y / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      // EXP-05: wall pick / corner region
      const surfMode = surfaceModeRef.current;
      if (surfaceEditRef.current && (surfMode === "pick" || surfMode === "corners")) {
        const hit = pickSurfaceHit(x, y);
        if (hit) {
          const meta: SurfacePickMeta = {
            hitPoint: hit.point,
            hitNormal: hit.normal,
            source: hit.source,
            planarSuitable: isPlanarWallSuitable({
              x: hit.normal[0],
              y: hit.normal[1],
              z: hit.normal[2],
            }),
          };
          onSurfacePickRef.current?.(meta);
          if (surfMode === "corners") {
            onSurfaceCornerHitRef.current?.(hit);
          }
          // Visual feedback
          if (apiRef.current) {
            const g = apiRef.current.surfacePickPreview;
            const marker = new THREE.Mesh(
              new THREE.SphereGeometry(0.05, 12, 12),
              new THREE.MeshBasicMaterial({ color: 0xff88aa, depthTest: false }),
            );
            marker.position.set(hit.point[0], hit.point[1], hit.point[2]);
            g.add(marker);
            const arrow = new THREE.ArrowHelper(
              new THREE.Vector3(hit.normal[0], hit.normal[1], hit.normal[2]).normalize(),
              marker.position,
              0.45,
              0x66ffaa,
            );
            g.add(arrow);
          }
        }
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      // Staging: place on floor — capture phase so walk/look does not steal the click
      if (stagingEditRef.current && stagingPlaceModeRef.current) {
        const hit = snapFloorHit(x, y);
        if (!hit) return;
        onStagingPlaceRef.current?.({ position: [hit.x, hit.y, hit.z] });
        if (apiRef.current) apiRef.current.placePreview.visible = false;
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      // Staging: select existing furniture (edit mode)
      if (stagingEditRef.current) {
        const stHits = raycaster.intersectObjects(stagingRoot.children, true);
        const pick = stHits.find((h) => {
          let o: THREE.Object3D | null = h.object;
          while (o) {
            if (o.userData.stagingId) return true;
            o = o.parent;
          }
          return false;
        });
        if (pick) {
          let o: THREE.Object3D | null = pick.object;
          while (o && !o.userData.stagingId) o = o.parent;
          if (o?.userData.stagingId) {
            onStagingSelectRef.current?.(o.userData.stagingId as string);
            evt.stopPropagation();
            return;
          }
        }
      }

      // EXP-05: select surface; drag only when surfaceDragEnabled (avoids accidental moves while looking)
      if (surfaceEditRef.current && apiRef.current?.surfaceRoot && surfaceModeRef.current === "idle") {
        const sfHits = raycaster.intersectObjects(apiRef.current.surfaceRoot.children, true);
        const pick = sfHits.find((h) => {
          let o: THREE.Object3D | null = h.object;
          while (o) {
            if (o.userData.surfaceId) return true;
            o = o.parent;
          }
          return false;
        });
        if (pick) {
          let o: THREE.Object3D | null = pick.object;
          while (o && !o.userData.surfaceId) o = o.parent;
          const sid = o?.userData.surfaceId as string | undefined;
          if (sid) {
            onSurfaceSelectRef.current?.(sid);
            if (!surfaceDragEnabledRef.current) {
              // Select only — let look / orbit keep the pointer
              return;
            }
            const surf = surfaceOverlaysRef.current.find((s) => s.id === sid);
            if (surf) {
              const n = fromVec3(surf.normal).normalize();
              const t0 = fromVec3(surf.tangent).normalize();
              const { tangent, bitangent } = twistedBasis(n, t0, surf.twist);
              const origin = fromVec3(surf.center).addScaledVector(n, surf.offset);
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, origin);
              const rel = pick.point.clone().sub(origin);
              surfaceDragRef.current = {
                id: sid,
                plane,
                tangent,
                bitangent,
                normal: n,
                offset: surf.offset,
                grabU: rel.dot(tangent),
                grabV: rel.dot(bitangent),
                center: fromVec3(surf.center),
              };
              if (apiRef.current) {
                apiRef.current.navSuspended = true;
                apiRef.current.walk.enabled = false;
                apiRef.current.smooth.enabled = false;
                apiRef.current.smooth.cancelMotion();
                apiRef.current.orbit.enabled = false;
              }
              renderer.domElement.style.cursor = "grabbing";
              try {
                renderer.domElement.setPointerCapture(evt.pointerId);
              } catch {
                /* optional */
              }
            }
            evt.preventDefault();
            evt.stopPropagation();
            return;
          }
        }
      }

      const hits = raycaster.intersectObjects(markers.children, false);
      if (hits.length && !placeModeRef.current) {
        const data = hits[0].object.userData as { hotspotId?: string; viewpointId?: string };
        if (data.viewpointId) {
          const vp = viewpointsRef.current.find((v) => v.id === data.viewpointId);
          if (vp) onViewpointSelectRef.current?.(vp);
          evt.stopPropagation();
          return;
        }
        const hs = hotspotsRef.current.find((h) => h.id === data.hotspotId) ?? null;
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
    const tryPointMoveOrOrbitPivot = (evt: PointerEvent) => {
      if (apiRef.current?.navSuspended) return;
      if (surfaceEditRef.current || stagingEditRef.current || stagingPlaceModeRef.current) return;
      if (placeModeRef.current) return;
      const mode = navModeRef.current;
      const rect = renderer.domElement.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;

      // Orbit: double-click sets pivot on a walkable / hit point
      if (mode === "orbit" && evt.detail >= 2) {
        const floor = snapFloorHit(x, y);
        const fallback = lcc?.raycast?.({ evt: { x, y }, maxDistance: 80, radius: 0.1 });
        const p = floor ?? (fallback ? { x: fallback.x, y: fallback.y, z: fallback.z } : null);
        if (p) {
          orbit.target.set(p.x, p.y, p.z);
          orbit.update();
        }
        return;
      }

      // Point & Move (also integrated into first-person Walk): click (not drag) on walkable floor
      if (mode !== "point-move" && mode !== "first-person") return;
      if (Math.hypot(evt.clientX - downClientX, evt.clientY - downClientY) > 6) return;
      if (document.pointerLockElement === renderer.domElement) return;
      // Clicking a hotspot / checkpoint pin should not also start a move
      {
        pointer.x = (x / rect.width) * 2 - 1;
        pointer.y = -(y / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.intersectObjects(markers.children, false).length) return;
      }
      const rejectMove = (reason: string) => {
        onPointMoveRejectedRef.current?.(reason);
      };
      if (!apiRef.current?.hasCollision && !lcc?.intersectsRayExt) {
        rejectMove("Can't walk there yet — collision mesh is still loading.");
        return;
      }
      const floor = snapFloorHit(x, y);
      if (!floor) {
        rejectMove("Can't reach that spot.");
        return;
      }
      // Prefer collision-aware hit with upward normal
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
      // Authored soft barriers (stairs stopper, etc.)
      if (insideBlockZone(dest.x, dest.y + eyeHeightRef.current * 0.4, dest.z)) {
        rejectMove("That area is blocked.");
        return;
      }
      // Line-of-sight probe at mid torso height (straight path only — no navmesh yet)
      if (lcc?.intersectsRayFromOriginExt) {
        const eye = smooth.enabled ? smooth.getEyePosition() : camera.position;
        const midY = Math.min(eye.y, dest.y + eyeHeightRef.current * 0.55);
        const ox = eye.x;
        const oy = midY;
        const oz = eye.z;
        const dx = dest.x - ox;
        const dy = dest.y + 0.05 - oy;
        const dz = dest.z - oz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const hit = lcc.intersectsRayFromOriginExt({
          origin: { x: ox, y: oy, z: oz },
          direction: { x: dx / len, y: dy / len, z: dz / len },
          maxDistance: len - 0.15,
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

    const onPointerUp = (evt: PointerEvent) => {
      if (surfaceDragRef.current) {
        try {
          renderer.domElement.releasePointerCapture(evt.pointerId);
        } catch {
          /* optional */
        }
        endSurfaceDrag();
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }
      tryPointMoveOrOrbitPivot(evt);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown, true);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp, true);
    renderer.domElement.addEventListener("pointercancel", onPointerUp, true);

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
        if (apiRef.current) {
          apiRef.current.LCCRender = LCCRender;
          apiRef.current.loadStarted = loadStarted;
        } else {
          apiRef.current = {
            LCCRender,
            lcc: null,
            camera,
            renderer,
            scene,
            orbit,
            walk,
            smooth,
            applyNavMode,
            poseSmoothFromCamera,
            clock,
            home: { eye: FALLBACK_EYE.clone(), target: FALLBACK_TARGET.clone(), source: "fallback" },
            markers,
            preview,
            stagingRoot,
            surfaceRoot,
            surfacePickPreview,
            collisionDepthProxy,
            placePreview,
            proxyDebugRoot,
            transform,
            transformHelper,
            fly: null,
            loadStarted,
            hasCollision: false,
            navSuspended: false,
            rebuildFurnitureProxies,
          };
        }

        const modelMatrix = new THREE.Matrix4().fromArray(defaultLccModelMatrixElements());
        const path = absoluteDataUrl(dataPath);
        const hasAuthoredStart = !!startCameraRef.current;

        /** Hold opaque loader while LCC LOD settles — avoids a brief rough Gaussian flash. */
        const LOD_SETTLE_MS = 1750;

        const finishCameraSetup = (view: InteriorView) => {
          if (cancelled) return;
          const authored = startCameraRef.current;
          if (authored?.eyeHeight != null && Number.isFinite(authored.eyeHeight)) {
            eyeHeightRef.current = authored.eyeHeight;
            walk.eyeHeight = authored.eyeHeight;
            smooth.tuning.eyeHeight = authored.eyeHeight;
          }
          applyInteriorView(camera, orbit, (t) => walk.lookAt(t), view);
          walk.syncFromCamera();
          applyNavMode(navModeRef.current, true);
          if (apiRef.current) apiRef.current.home = view;
          // Keep canvas hidden; keep rendering so LOD can refine behind the loader
          try {
            renderer.render(scene, camera);
          } catch {
            /* ignore */
          }
          pushStats();
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            if (cancelled) return;
            try {
              if (LCCRender && lcc) LCCRender.update();
              renderer.render(scene, camera);
            } catch {
              /* ignore */
            }
            revealCanvas();
            pushStats();
            onSceneReadyRef.current?.();
          }, LOD_SETTLE_MS);
        };

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
            // Skip SDK intro dolly when we own the start camera — that dolly is the “recording pose” flash.
            useLoadingEffect: !hasAuthoredStart,
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
              const fl = floorRef.current;
              if (fl && hasCol && lcc.getCollisionGeometry) {
                try {
                  const meshes = lcc.getCollisionGeometry();
                  onMapOutlineRef.current?.(buildCollisionMapOutline(meshes, fl));
                } catch {
                  onMapOutlineRef.current?.([]);
                }
              } else {
                onMapOutlineRef.current?.([]);
              }
              const authored = startCameraRef.current;
              if (authored) {
                finishCameraSetup({
                  eye: new THREE.Vector3(
                    authored.position[0],
                    authored.position[1],
                    authored.position[2],
                  ),
                  target: new THREE.Vector3(
                    authored.target[0],
                    authored.target[1],
                    authored.target[2],
                  ),
                  source: "fallback",
                });
              } else {
                void resolveInteriorView(path).then((autoView) => {
                  finishCameraSetup(autoView);
                });
              }
            } catch (err) {
              metaSummary = `meta error: ${(err as Error).message}`;
              revealCanvas();
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
        const dur = Math.max(0.4, api.fly.duration);
        if (api.fly.fade) {
          // Fade midpoint teleport
          if (api.fly.t < 0.45) {
            api.fly.t = Math.min(0.45, api.fly.t + dt / dur);
            onFadeRef.current?.(true);
          } else if (api.fly.t < 0.55) {
            camera.position.copy(api.fly.toEye);
            orbit.target.copy(api.fly.toTarget);
            orbit.update();
            walk.lookAt(orbit.target);
            walk.syncFromCamera();
            if (smooth.enabled) poseSmoothFromCamera();
            api.fly.t = 0.55;
          } else {
            api.fly.t = Math.min(1, api.fly.t + dt / dur);
            onFadeRef.current?.(api.fly.t < 0.95);
            if (api.fly.t >= 1) {
              api.fly = null;
              onFadeRef.current?.(false);
            }
          }
        } else {
          // Smooth glide through the space (no blanking)
          api.fly.t = Math.min(1, api.fly.t + dt / dur);
          const e = 1 - Math.pow(1 - api.fly.t, 3);
          camera.position.lerpVectors(api.fly.fromEye, api.fly.toEye, e);
          orbit.target.lerpVectors(api.fly.fromTarget, api.fly.toTarget, e);
          orbit.update();
          walk.lookAt(orbit.target);
          walk.syncFromCamera();
          if (api.fly.t >= 1) {
            api.fly = null;
            if (smooth.enabled) poseSmoothFromCamera();
          }
        }
      } else if (api && !api.navSuspended && smooth.enabled) {
        smooth.update(dt);
        // Keep orbit target in front of the camera so map/orbit stay coherent
        const ahead = new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion);
        orbit.target.copy(camera.position).add(ahead);
        const mt = smooth.getMoveTarget();
        if (mt) {
          destMarker.position.set(mt.x, mt.y + 0.03, mt.z);
          destMarker.visible = true;
        } else {
          destMarker.visible = false;
        }
      } else if (api && !api.navSuspended && api.walk.enabled) {
        api.walk.update(dt);
        // Keep orbit target in front so map/orbit stay coherent
        const ahead = new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion);
        orbit.target.copy(camera.position).add(ahead);
        const mt = api.walk.getMoveTarget();
        if (mt) {
          destMarker.position.set(mt.x, mt.y + 0.03, mt.z);
          destMarker.visible = true;
        } else {
          destMarker.visible = false;
        }
      } else if (api && !api.navSuspended) {
        api.orbit.update();
        destMarker.visible = false;
      }
      if (api?.LCCRender && api.lcc) api.LCCRender.update();
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
        if (smooth.enabled) {
          // Stairs / triggers must follow the body eye, not the boom camera
          const eye = smooth.getEyePosition();
          const bodyYaw = smooth.getDebugSnapshot().bodyYaw;
          onPoseTickRef.current({
            position: [eye.x, eye.y, eye.z],
            target: [eye.x - Math.sin(bodyYaw) * 2, eye.y, eye.z - Math.cos(bodyYaw) * 2],
            yaw: bodyYaw,
            pitch: euler.x,
          });
        } else {
          onPoseTickRef.current({
            position: [camera.position.x, camera.position.y, camera.position.z],
            target: [orbit.target.x, orbit.target.y, orbit.target.z],
            yaw: euler.y,
            pitch: euler.x,
          });
        }
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, true);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp, true);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp, true);
      walk.cancelMoveTarget();
      smooth.cancelMotion();
      walk.exitPointerLock();
      scene.remove(destMarker);
      scene.remove(smooth.capsuleMesh);
      scene.remove(smooth.debugGroup);
      destMarker.geometry.dispose();
      (destMarker.material as THREE.Material).dispose();
      transform.dispose();
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
      smooth.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataPath]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.applyNavMode(navMode);
  }, [navMode]);

  // Re-apply nav (walk vs smooth, tuning) when the follow style changes — no remount.
  const smoothTuningKeyProp = smoothTuning ? JSON.stringify(smoothTuning) : "";
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.applyNavMode(navModeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraFollowStyle, smoothTuningKeyProp]);

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
    for (const vp of viewpoints) {
      if (vp.showInScene === false) continue;
      // Checkpoint pin — distinct from gold hotspots
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x6eb5ff }),
      );
      mesh.position.set(vp.position[0], vp.position[1] - 0.35, vp.position[2]);
      mesh.userData.viewpointId = vp.id;
      api.markers.add(mesh);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8),
        new THREE.MeshBasicMaterial({ color: 0x6eb5ff }),
      );
      stem.position.set(vp.position[0], vp.position[1] - 0.55, vp.position[2]);
      stem.userData.viewpointId = vp.id;
      api.markers.add(stem);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.16, 20),
        new THREE.MeshBasicMaterial({ color: 0xb8d9ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(vp.position[0], vp.position[1] - 0.75, vp.position[2]);
      ring.userData.viewpointId = vp.id;
      api.markers.add(ring);
    }
  }, [hotspots, viewpoints]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !flyTo) return;
    api.smooth.cancelMotion();
    api.walk.cancelMoveTarget();
    const vp = flyTo.viewpoint;
    const toEye = new THREE.Vector3(...vp.position);
    const toTarget = new THREE.Vector3(...vp.target);
    const fromEye = api.camera.position.clone();
    const mode: CheckpointTransitionMode = flyTo.transition ?? "smooth";
    const pathBlocked = (() => {
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
    // smooth = always glide (even through walls) for testing; fade = blank when blocked
    const useFade = mode === "fade" && (flyTo.preferFade || pathBlocked);
    const dist = fromEye.distanceTo(toEye);
    const smoothDur = Math.min(4.5, Math.max(FLY_SMOOTH_DURATION_S, dist * 0.45));
    api.fly = {
      fromEye,
      fromTarget: api.orbit.target.clone(),
      toEye,
      toTarget,
      t: 0,
      fade: useFade,
      duration: useFade ? FLY_FADE_DURATION_S : smoothDur,
    };
    onFadeRef.current?.(false);
  }, [flyTo?.token]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || resetToken === 0) return;
    api.fly = null;
    api.smooth.cancelMotion();
    api.walk.cancelMoveTarget();
    onFadeRef.current?.(false);
    applyInteriorView(api.camera, api.orbit, (t) => api.walk.lookAt(t), api.home);
    api.walk.syncFromCamera();
    if (api.smooth.enabled) api.poseSmoothFromCamera();
  }, [resetToken]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || sampleCameraToken === 0) return;
    const euler = new THREE.Euler().setFromQuaternion(api.camera.quaternion, "YXZ");
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(api.camera.quaternion);
    const target = api.camera.position.clone().addScaledVector(forward, 2.5);
    onCameraSampleRef.current({
      position: [api.camera.position.x, api.camera.position.y, api.camera.position.z],
      target: [target.x, target.y, target.z],
      yaw: euler.y,
      pitch: euler.x,
    });
  }, [sampleCameraToken]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    while (api.preview.children.length) {
      const child = api.preview.children[0];
      api.preview.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    if (posePreview) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0x7ec8ff }),
      );
      eye.position.set(...posePreview.position);
      api.preview.add(eye);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.32, 28),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(posePreview.position[0], posePreview.position[1] - 0.5, posePreview.position[2]);
      api.preview.add(ring);
      const dir = new THREE.ArrowHelper(
        new THREE.Vector3(...posePreview.target).sub(new THREE.Vector3(...posePreview.position)).normalize(),
        new THREE.Vector3(...posePreview.position),
        1.2,
        0x7ec8ff,
        0.25,
        0.15,
      );
      api.preview.add(dir);
    }
    if (hotspotPreview) {
      const mark = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0xffc857 }),
      );
      mark.position.set(...hotspotPreview);
      api.preview.add(mark);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.36, 28),
        new THREE.MeshBasicMaterial({ color: 0xffe6a8, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(hotspotPreview[0], hotspotPreview[1] - 0.05, hotspotPreview[2]);
      api.preview.add(halo);
    }
  }, [posePreview, hotspotPreview]);

  // EXP-04: sync staged furniture meshes with placements (load once per id).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = apiRef.current;
      if (!api?.stagingRoot) return;
      const root = api.stagingRoot;
      const wanted = new Set(stagingPlacements.map((p) => p.id));

      for (const child of [...root.children]) {
        const id = child.userData.stagingId as string | undefined;
        if (!id) continue;
        if (!stagingVisible || !wanted.has(id)) {
          if (api.transform?.object === child) {
            api.transform.detach();
            api.transform.enabled = false;
            if (api.transformHelper) api.transformHelper.visible = false;
          }
          root.remove(child);
          child.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.geometry?.dispose();
              const mat = m.material;
              if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
              else mat?.dispose();
            }
          });
        }
      }

      if (!stagingVisible) {
        onStagingDimsRef.current?.(null);
        return;
      }

      for (const p of stagingPlacements) {
        if (cancelled) return;
        let obj = root.children.find((c) => c.userData.stagingId === p.id) as THREE.Object3D | undefined;
        if (!obj) {
          try {
            const loaded = await loadCanonicalStagingVisual(p.asset);
            obj = loaded.object;
            if (loaded.autoFitted) {
              console.info(
                `[staging] auto-fitted “${p.displayName}”: raw ~${loaded.rawMaxM.toFixed(1)} m → ×${loaded.fitScale.toExponential(2)}`,
              );
            }
          } catch (err) {
            console.warn("[staging] load failed", p.id, err);
            continue;
          }
          if (cancelled || !apiRef.current) return;
          obj.userData.stagingId = p.id;
          root.add(obj);
        }
        obj.visible = p.visible !== false;
        // Explicit false → off; true or missing (legacy saves) → on
        obj.userData.stagingCollision = p.collisionEnabled !== false;
        const editingThis = api.navSuspended && api.transform?.object === obj;
        if (!editingThis) {
          obj.position.set(p.position[0], p.position[1], p.position[2]);
          obj.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
          obj.scale.set(p.scale[0], p.scale[1], p.scale[2]);
        }
      }
      if (!cancelled) apiRef.current?.rebuildFurnitureProxies();
    })();
    return () => {
      cancelled = true;
    };
  }, [stagingPlacements, stagingVisible]);

  useEffect(() => {
    stagingProxyDebugRef.current = stagingProxyDebug;
    apiRef.current?.rebuildFurnitureProxies();
  }, [stagingProxyDebug]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const surfacePick = surfaceEditEnabled && (surfaceMode === "pick" || surfaceMode === "corners");
    api.renderer.domElement.style.cursor =
      (stagingEditEnabled && stagingPlaceMode) || surfacePick ? "crosshair" : "";
    if (!(stagingEditEnabled && stagingPlaceMode)) {
      api.placePreview.visible = false;
    }
    if (!surfacePick && api.surfacePickPreview) {
      while (api.surfacePickPreview.children.length) {
        const c = api.surfacePickPreview.children[0];
        api.surfacePickPreview.remove(c);
        c.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry?.dispose();
            (m.material as THREE.Material)?.dispose?.();
          }
        });
      }
    }
  }, [stagingEditEnabled, stagingPlaceMode, surfaceEditEnabled, surfaceMode]);

  // EXP-05: sync wall overlay meshes (rebuild when surface data changes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = apiRef.current;
      if (!api?.surfaceRoot) return;
      const root = api.surfaceRoot;
      const wanted = new Set(surfaceOverlays.map((s) => s.id));

      for (const child of [...root.children]) {
        const id = child.userData.surfaceId as string | undefined;
        if (!id) continue;
        if (!surfacesVisible || !wanted.has(id)) {
          root.remove(child);
          disposeSurfaceGroup(child);
        } else {
          // Always rebuild — materials / size / artwork change often
          root.remove(child);
          disposeSurfaceGroup(child);
        }
      }

      if (!surfacesVisible) return;

      const resolveTexture = async (assetId: string) => {
        let url = surfaceUrlCacheRef.current.get(assetId);
        if (!url) {
          url = (await getSurfaceImageUrl(assetId)) ?? undefined;
          if (!url) return null;
          surfaceUrlCacheRef.current.set(assetId, url);
        }
        return loadTextureFromUrl(url);
      };

      for (const s of surfaceOverlays) {
        if (cancelled) return;
        try {
          const group = await buildSurfaceGroup(s, resolveTexture, surfaceRenderPresetRef.current);
          if (cancelled || !apiRef.current) {
            disposeSurfaceGroup(group);
            return;
          }
          apiRef.current.surfaceRoot.add(group);
        } catch (err) {
          console.warn("[surface] build failed", s.id, err);
        }
      }

      // Depth gap diagnostic for selected overlay
      const selected = surfaceOverlays.find((s) => s.id === surfaceSelectedId) ?? surfaceOverlays[0];
      if (selected && apiRef.current?.lcc) {
        onSurfaceDepthDiagRef.current?.(measureOverlayWallGap(selected, apiRef.current.lcc));
      } else {
        onSurfaceDepthDiagRef.current?.(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [surfaceOverlays, surfacesVisible, surfaceSelectedId, surfaceRenderPreset]);

  // EXP-05B: reversible thin clip box on selected wall region (whole LCC object).
  useEffect(() => {
    const api = apiRef.current;
    const lcc = api?.lcc;
    if (!lcc?.setClipBox) return;
    if (!surfaceClipTest) {
      lcc.setClipBox(undefined);
      onSurfaceLabNoteRef.current?.("Clip box cleared.");
      return;
    }
    const selected =
      surfaceOverlays.find((s) => s.id === surfaceSelectedId) ?? surfaceOverlays[0] ?? null;
    if (!selected) {
      onSurfaceLabNoteRef.current?.("Clip test needs a surface overlay.");
      return;
    }
    try {
      lcc.setClipBox(clipBoxForSurface(selected, 0.14));
      onSurfaceLabNoteRef.current?.(
        "Clip box ON — suppresses Gaussians inside a thin wall box (whole model API; may clip décor that intersects the box).",
      );
    } catch (e) {
      onSurfaceLabNoteRef.current?.(`Clip box failed: ${(e as Error).message}`);
    }
    return () => {
      try {
        lcc.setClipBox?.(undefined);
      } catch {
        /* ignore */
      }
    };
  }, [surfaceClipTest, surfaceSelectedId, surfaceOverlays]);

  // EXP-05B: semantic colour probe (Room sample may have no labels).
  useEffect(() => {
    const lcc = apiRef.current?.lcc;
    if (!lcc) return;
    if (!surfaceSemanticProbe) {
      try {
        lcc.setSemantic?.(false);
        lcc.resetSemanticColor?.();
      } catch {
        /* optional */
      }
      return;
    }
    const meta = lcc.getMeta?.() ?? {};
    const keys = Object.keys(meta).filter((k) => /semant/i.test(k) || /label/i.test(k));
    try {
      lcc.setSemantic?.(true);
      // Distinct palette — if no labels, scene often unchanged or single tint
      lcc.setSemanticColor?.([
        [0.9, 0.2, 0.2],
        [0.2, 0.8, 0.3],
        [0.2, 0.4, 0.9],
        [0.9, 0.8, 0.2],
        [0.7, 0.3, 0.8],
      ]);
      onSurfaceLabNoteRef.current?.(
        keys.length
          ? `Semantic ON. Meta keys: ${keys.join(", ")}`
          : "Semantic ON — no semantic/label keys in getMeta(); Room sample likely has no per-wall labels. Cannot target one wall.",
      );
    } catch (e) {
      onSurfaceLabNoteRef.current?.(`Semantic probe failed: ${(e as Error).message}`);
    }
    return () => {
      try {
        lcc.setSemantic?.(false);
        lcc.resetSemanticColor?.();
      } catch {
        /* ignore */
      }
    };
  }, [surfaceSemanticProbe]);

  // EXP-05B: optional depth-only collision mesh (architecture only — not Gaussian sofa).
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.collisionDepthProxy) return;
    const root = api.collisionDepthProxy;
    while (root.children.length) {
      const c = root.children[0];
      root.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose?.();
    }
    root.visible = false;
    if (!surfaceCollisionDepthProxy || !api.lcc?.getCollisionGeometry) {
      onSurfaceLabNoteRef.current?.(
        surfaceCollisionDepthProxy
          ? "No getCollisionGeometry — cannot build depth proxy."
          : "Collision depth proxy off.",
      );
      return;
    }
    try {
      const meshes = api.lcc.getCollisionGeometry();
      const mat = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      for (const mesh of meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
        geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        geo.computeVertexNormals();
        const obj = new THREE.Mesh(geo, mat.clone());
        obj.renderOrder = -1;
        root.add(obj);
      }
      root.visible = true;
      onSurfaceLabNoteRef.current?.(
        `Collision depth proxy: ${meshes.length} mesh(es). Helps architecture depth only — sofa/décor Gaussians still lack solid depth.`,
      );
    } catch (e) {
      onSurfaceLabNoteRef.current?.(`Depth proxy failed: ${(e as Error).message}`);
    }
  }, [surfaceCollisionDepthProxy, resetToken]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api?.transform) return;
    const tc = api.transform;
    if (!stagingEditEnabled || !stagingVisible || !stagingSelectedId) {
      tc.detach();
      tc.enabled = false;
      if (api.transformHelper) api.transformHelper.visible = false;
      onStagingDimsRef.current?.(null);
      return;
    }
    const obj = api.stagingRoot.children.find((c) => c.userData.stagingId === stagingSelectedId);
    if (!obj) {
      tc.detach();
      tc.enabled = false;
      if (api.transformHelper) api.transformHelper.visible = false;
      return;
    }
    tc.attach(obj);
    tc.enabled = true;
    if (api.transformHelper) api.transformHelper.visible = true;

    const tcAxes = tc as TransformControls & {
      showX: boolean;
      showY: boolean;
      showZ: boolean;
      showXY: boolean;
      showYZ: boolean;
      showXZ: boolean;
      size: number;
    };
    tcAxes.size = 1.15;
    // Restore full gizmo axes for move/rotate (world). Scale uses local space so
    // red/green/blue stretch along the object's own axes, not world.
    if (stagingTransformMode === "scaleUniform") {
      tc.setMode("scale");
      tc.setSpace("local");
      // Centre handle only → proportional scale
      tcAxes.showX = false;
      tcAxes.showY = false;
      tcAxes.showZ = false;
      tcAxes.showXY = false;
      tcAxes.showYZ = false;
      tcAxes.showXZ = false;
    } else if (stagingTransformMode === "scale") {
      tc.setMode("scale");
      tc.setSpace("local");
      // Per-axis stretch (same idea as classic scale); hide plane handles so a
      // dual-axis drag doesn't feel like the object is translating away.
      tcAxes.showX = true;
      tcAxes.showY = true;
      tcAxes.showZ = true;
      tcAxes.showXY = false;
      tcAxes.showYZ = false;
      tcAxes.showXZ = false;
    } else if (stagingTransformMode === "translate") {
      tc.setMode("translate");
      tc.setSpace("world");
      tcAxes.showX = true;
      tcAxes.showY = true;
      tcAxes.showZ = true;
      tcAxes.showXY = true;
      tcAxes.showYZ = true;
      tcAxes.showXZ = true;
    } else {
      tc.setMode("rotate");
      tc.setSpace("world");
      tcAxes.showX = true;
      tcAxes.showY = true;
      tcAxes.showZ = true;
      tcAxes.showXY = true;
      tcAxes.showYZ = true;
      tcAxes.showXZ = true;
    }

    const { size } = measureObject(obj);
    onStagingDimsRef.current?.({
      size: [size.x, size.y, size.z],
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    });
  }, [stagingSelectedId, stagingEditEnabled, stagingVisible, stagingTransformMode, stagingPlacements]);

  return (
    <div className="exp-host" ref={mountRef}>
      {bootError && <div className="exp-host-error">{bootError}</div>}
    </div>
  );
});
