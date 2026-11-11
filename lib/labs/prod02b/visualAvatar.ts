import * as THREE from "three";
import {
  OrbAssistantMotion,
  createOrbFloorGlow,
} from "@/lib/labs/prod02b/orbAssistant";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  PROD02B_AVATARS,
  type Prod02bAvatarId,
  PROD02B_CLIP_ROLES,
  type ClipInspection,
  type Prod02bClipRole,
} from "@/lib/labs/prod02b/avatarAssets";

export type VisualAvatarTuning = {
  visible: boolean;
  avatarId?: Prod02bAvatarId;
  scale: number;
  verticalOffset: number;
  /** Extra yaw (rad) relative to controller facing. */
  facingOffset: number;
  animSpeed: number;
  walkBlend: number;
  turnBlend: number;
  /** Fade avatar when boom distance is below this (0 = off). */
  closeFadeDistance: number;
  /** Force a clip for Dev preview; null = state machine. */
  previewClip: Prod02bClipRole | null;
};

/** Target standing height in scene metres (Mixamo GLBs are often cm-scale). */
export const PROD02B_TARGET_HEIGHT_M = 1.75;

export const DEFAULT_VISUAL_AVATAR_TUNING: VisualAvatarTuning = {
  visible: true,
  /** Multiplier on auto-fit base scale (1 = target height). */
  scale: 1,
  verticalOffset: 0,
  /** Mixamo faces +Z; controller forward is −Z at yaw 0. */
  facingOffset: Math.PI,
  animSpeed: 1,
  walkBlend: 0.18,
  turnBlend: 0.15,
  closeFadeDistance: 0.55,
  previewClip: null,
};

export type VisualAvatarDebug = {
  state: string;
  avatarId: Prod02bAvatarId;
  activeClip: string | null;
  speed: number;
  yawRate: number;
  fade: number;
  inspections: ClipInspection[];
  loadMs: number | null;
  error: string | null;
  /** How many Walk tracks successfully bound (0 = silent failure). */
  walkBindings: number;
};

type RoleActions = Partial<Record<Prod02bClipRole, THREE.AnimationAction>>;

/**
 * Visual Mixamo layer — does not move the controller.
 * Original mesh/rig, tailored in one optimized GLB with eight named actions.
 *
 * Actions are named explicitly. The original exports accumulate earlier actions;
 * selecting their longest clip used to play Idle while the character moved.
 */
export class VisualAvatar {
  readonly root = new THREE.Group();
  tuning: VisualAvatarTuning = { ...DEFAULT_VISUAL_AVATAR_TUNING };
  ready = false;

  private mixer: THREE.AnimationMixer | null = null;
  private orbMotion: OrbAssistantMotion | null = null;
  private orbGlow: ReturnType<typeof createOrbFloorGlow> | null = null;
  private actions: RoleActions = {};
  private current: Prod02bClipRole | null = null;
  private model: THREE.Object3D | null = null;
  private materials: THREE.Material[] = [];
  private prevYaw = 0;
  private yawRateSmoothed = 0;
  private fade = 1;
  private lastSpeed = 0;
  private walkBindings = 0;
  private inspections: ClipInspection[] = [];
  private loadMs: number | null = null;
  private error: string | null = null;
  private disposed = false;
  private loadPromise: Promise<void> | null = null;
  private loadedId: Prod02bAvatarId | null = null;
  private loadVersion = 0;
  private environment: THREE.WebGLRenderTarget | null = null;
  private materialDefaults = new Map<
    THREE.Material,
    { opacity: number; transparent: boolean }
  >();
  constructor(private renderer?: THREE.WebGLRenderer) {}

  private releaseModel() {
    this.mixer?.stopAllAction();
    if (this.model) {
      this.root.remove(this.model);
      disposeModel(this.model);
    }
    if (this.orbGlow) {
      this.root.remove(this.orbGlow);
      this.orbGlow.geometry.dispose();
      this.orbGlow.material.dispose();
      this.orbGlow = null;
    }
    this.orbMotion = null;
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.materials = [];
    this.materialDefaults.clear();
    this.current = null;
    this.ready = false;
  }

  private environmentMap() {
    if (!this.renderer) return null;
    if (!this.environment) {
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(room, 0.04);
      room.dispose();
      pmrem.dispose();
    }
    return this.environment.texture;
  }
  /** Converts Mixamo native units → metres so height ≈ PROD02B_TARGET_HEIGHT_M. */
  private baseScale = 1;
  /** Lifts feet onto the floor after auto-fit (model-space min.y × baseScale). */
  private feetLift = 0;

  /** Idempotent — safe to call when Mixamo presentation turns on. */
  load(): Promise<void> {
    const id = this.tuning.avatarId ?? "human";
    if (this.loadedId === id && this.ready) return Promise.resolve();
    if (this.loadedId === id && this.loadPromise) return this.loadPromise;
    this.loadedId = id;
    const version = ++this.loadVersion;
    this.releaseModel();
    this.error = null;
    this.inspections = [];
    this.walkBindings = 0;
    this.loadPromise = this.loadInternal(id, version);
    return this.loadPromise;
  }

  private async loadInternal(
    id: Prod02bAvatarId,
    version: number,
  ): Promise<void> {
    const config = PROD02B_AVATARS[id];
    const t0 = performance.now();
    const loader = new GLTFLoader();

    try {
      const avatar = await loader.loadAsync(config.url);
      if (this.disposed || version !== this.loadVersion) {
        disposeModel(avatar.scene);
        return;
      }
      this.inspections = inspectFile(
        config.url.split("/").pop()!,
        avatar.animations,
      );
      this.model = avatar.scene;
      sanitizeMixamoHierarchy(this.model);
      this.model.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          // The baked atlas and vertex shading render without scene lights.
          mesh.material = mats.map((source) => {
            let material: THREE.Material;
            if (config.pbr) {
              const pbr = (source as THREE.MeshStandardMaterial).clone();
              pbr.envMap = this.environmentMap();
              // The LCC host renders without the studio's ACES tone mapping.
              pbr.envMapIntensity = 1.1;
              // Compress avatar highlights locally; leave the SDK scan pipeline intact.
              pbr.toneMapped = false;
              pbr.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                  "#include <tonemapping_fragment>",
                  `vec3 avatarHDR = max(gl_FragColor.rgb * 0.6, vec3(0.0));
                  gl_FragColor.rgb = clamp((avatarHDR * (2.51 * avatarHDR + 0.03)) /
                    (avatarHDR * (2.43 * avatarHDR + 0.59) + 0.14), 0.0, 1.0);`,
                );
              };
              pbr.customProgramCacheKey = () => "spatial-avatar-filmic-v1";
              material = pbr;
            } else {
              const m = source as THREE.MeshBasicMaterial;
              material = new THREE.MeshBasicMaterial({
                color: m.color,
                map: m.map,
                vertexColors: m.vertexColors,
                side: THREE.FrontSide,
              });
            }
            source.dispose();
            this.materials.push(material);
            this.materialDefaults.set(material, {
              opacity: material.opacity,
              transparent: material.transparent,
            });
            return material;
          });
          if (mats.length === 1) mesh.material = mesh.material[0];
        }
      });

      // Mixamo FBX→GLB is often centimetre-scale (~170 units tall). Fit to target metres.
      this.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const rawHeight = Math.max(size.y, 1e-4);
      this.baseScale = id === "orb" ? 1 : config.height / rawHeight;
      this.feetLift = id === "orb" ? 0 : -box.min.y * this.baseScale;

      this.root.add(this.model);
      if (id === "orb") {
        this.orbMotion = new OrbAssistantMotion(this.model);
        this.orbGlow = createOrbFloorGlow();
        this.root.add(this.orbGlow);
        this.current = "Idle";
        this.ready = true;
        this.loadMs = performance.now() - t0;
        return;
      }
      this.mixer = new THREE.AnimationMixer(this.model);

      for (const role of PROD02B_CLIP_ROLES) {
        const source = avatar.animations.find((clip) => clip.name === role);
        const fallback =
          role === "TurnLeft" || role === "TurnRight"
            ? avatar.animations.find(
                (clip) => clip.name === (id === "walker" ? "Walk" : "Idle"),
              )
            : avatar.animations.find((clip) => clip.name === "Idle");
        if (
          !source &&
          (role === "Idle" ||
            role === "Walk" ||
            role === "Run" ||
            id === "human")
        )
          throw new Error(`Avatar is missing its ${role} action`);
        const clip = prepareClip((source ?? fallback)!.clone())!;
        clip.name = role;
        const loop = role !== "JumpStart" && role !== "Jump" && role !== "Land";
        this.actions[role] = this.makeAction(clip, loop);
      }

      // Force bind so we can count successful Walk targets (debug).
      this.actions.Walk?.play();
      this.actions.Walk?.stop();
      this.walkBindings = countBoundTracks(this.actions.Walk);

      this.actions.Idle?.reset().setEffectiveWeight(1).play();
      this.current = "Idle";
      this.ready = true;
      this.loadMs = performance.now() - t0;
      this.error =
        this.walkBindings === 0
          ? "Walk clip bound 0 tracks — animations will not play"
          : null;
    } catch (err) {
      if (version !== this.loadVersion || this.disposed) return;
      this.releaseModel();
      this.error = (err as Error).message;
      this.ready = false;
      this.loadPromise = null;
    }
  }

  private makeAction(clip: THREE.AnimationClip, loop: boolean) {
    if (!this.mixer) throw new Error("mixer missing");
    const action = this.mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    if (!loop) action.clampWhenFinished = true;
    action.enabled = true;
    return action;
  }

  update(
    dt: number,
    pose: {
      body: THREE.Vector3;
      bodyYaw: number;
      groundY?: number;
      velocityX: number;
      velocityZ: number;
      speed: number;
      /** True while WASD / D-pad / Point&Move is driving the controller. */
      movingInput: boolean;
      boomDistance: number;
      grounded: boolean;
      sprinting: boolean;
      jumpPhase?: "grounded" | "takeoff" | "airborne" | "landing";
    },
  ) {
    this.root.visible = this.tuning.visible && this.ready;
    this.lastSpeed = pose.speed;
    if (!this.ready || !this.model || (!this.mixer && !this.orbMotion)) return;

    const t = this.tuning;
    const config = PROD02B_AVATARS[this.loadedId ?? "human"];
    const s = this.baseScale * Math.max(0.05, t.scale);

    // Use resolved velocity, so pushing into a wall does not march in place.
    const moving = pose.speed > 0.08;
    const faceYaw = pose.bodyYaw;

    this.root.position.set(
      pose.body.x,
      pose.body.y +
        this.feetLift * (s / this.baseScale) +
        t.verticalOffset +
        config.hoverHeight,
      pose.body.z,
    );
    this.root.rotation.set(0, faceYaw + t.facingOffset, 0);
    this.root.scale.setScalar(s);

    let dyaw = faceYaw - this.prevYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const yawRate = dt > 1e-6 ? dyaw / dt : 0;
    this.yawRateSmoothed = THREE.MathUtils.damp(
      this.yawRateSmoothed,
      yawRate,
      8,
      dt,
    );
    this.prevYaw = faceYaw;

    if (this.orbMotion) {
      this.current =
        t.previewClip ??
        (pose.sprinting && moving ? "Run" : moving ? "Walk" : "Idle");
      this.orbMotion.update(
        dt,
        pose.speed,
        this.yawRateSmoothed,
        !!t.previewClip && t.previewClip !== "Idle",
      );
      this.updateFade(dt, pose.boomDistance);
      if (this.orbGlow) {
        // Body follows a jump; projection stays on the collision-resolved ground.
        this.orbGlow.position.y =
          ((pose.groundY ?? pose.body.y) - this.root.position.y + 0.006) / s;
        this.orbGlow.material.uniforms.uOpacity.value = this.fade;
      }
      return;
    }

    let desired: Prod02bClipRole = "Idle";
    if (t.previewClip) {
      desired = t.previewClip;
    } else if (pose.jumpPhase === "takeoff") {
      desired = "JumpStart";
    } else if (pose.jumpPhase === "landing") {
      desired = "Land";
    } else if (!pose.grounded) {
      desired = "Jump";
    } else if (moving) {
      desired = pose.sprinting && config.canRun ? "Run" : "Walk";
    } else if (Math.abs(this.yawRateSmoothed) > 1.0 && pose.speed < 0.08) {
      desired = this.yawRateSmoothed > 0 ? "TurnLeft" : "TurnRight";
    }

    const jumping =
      desired === "JumpStart" || desired === "Jump" || desired === "Land";
    this.crossfadeTo(
      desired,
      jumping
        ? 0.05
        : desired === "Walk" || desired === "Idle" || desired === "Run"
          ? t.walkBlend
          : t.turnBlend,
    );

    const walk = this.current === "Run" ? this.actions.Run : this.actions.Walk;
    if (walk && (this.current === "Walk" || this.current === "Run")) {
      const rate =
        THREE.MathUtils.clamp(
          pose.speed /
            ((this.current === "Run"
              ? config.runCycleSpeed
              : config.walkCycleSpeed) *
              t.scale),
          0.6,
          2.2,
        ) * t.animSpeed;
      walk.setEffectiveTimeScale(rate);
    } else if (this.current && this.actions[this.current]) {
      this.actions[this.current]!.setEffectiveTimeScale(t.animSpeed);
    }

    this.updateFade(dt, pose.boomDistance);
    this.mixer!.update(dt);
  }

  private updateFade(dt: number, boomDistance: number) {
    const t = this.tuning;
    let targetFade = 1;
    if (t.closeFadeDistance > 0.05 && boomDistance < t.closeFadeDistance) {
      targetFade = THREE.MathUtils.clamp(
        (boomDistance - 0.25) / Math.max(0.05, t.closeFadeDistance - 0.25),
        this.orbMotion ? 0.65 : 0.15,
        1,
      );
    }
    this.fade = THREE.MathUtils.damp(this.fade, targetFade, 10, dt);
    for (const m of this.materials) {
      const original = this.materialDefaults.get(m)!;
      m.opacity = this.fade * original.opacity;
      m.transparent = original.transparent || this.fade < 0.999;
      m.depthWrite = !original.transparent && this.fade > 0.85;
    }
  }

  private crossfadeTo(role: Prod02bClipRole, duration: number) {
    if (this.current === role) return;
    const next = this.actions[role];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    const fade = Math.max(0.05, duration);
    next.enabled = true;
    next.reset();
    next.stopFading();
    next.setEffectiveWeight(1);
    next.fadeIn(fade).play();
    if (prev && prev !== next) {
      prev.fadeOut(fade);
    }
    this.current = role;
  }

  getDebug(): VisualAvatarDebug {
    return {
      avatarId: this.loadedId ?? "human",
      state: this.tuning.previewClip
        ? `preview:${this.tuning.previewClip}`
        : (this.current ?? "none"),
      activeClip: this.current,
      speed: this.lastSpeed,
      yawRate: this.yawRateSmoothed,
      fade: this.fade,
      inspections: this.inspections,
      loadMs: this.loadMs,
      error: this.error,
      walkBindings: this.walkBindings,
    };
  }

  dispose() {
    this.disposed = true;
    ++this.loadVersion;
    this.releaseModel();
    this.environment?.dispose();
    this.environment = null;
  }
}

/** `:` is reserved in Three track paths — rename Mixamo bones so clips can bind. */
function sanitizeMixamoHierarchy(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj.name.includes(":")) {
      obj.name = obj.name.replace(/:/g, "_");
    }
  });
}

function sanitizeClipTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const nextName = track.name
      .replace(/mixamorig:/g, "mixamorig_")
      .replace(/:/g, "_");
    if (nextName === track.name) return track;
    const copy = track.clone();
    copy.name = nextName;
    return copy;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Preserve vertical pelvis motion (run flight, crouch and landing); remove X/Z drift. */
function stripRootTranslation(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (!/Hips.*\.position$/i.test(track.name)) return track;
    const copy = track.clone();
    for (let i = 0; i < copy.values.length; i += 3) {
      copy.values[i] = copy.values[0];
      copy.values[i + 2] = copy.values[2];
    }
    return copy;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function prepareClip(
  clip: THREE.AnimationClip | null,
): THREE.AnimationClip | null {
  return clip ? stripRootTranslation(sanitizeClipTracks(clip)) : null;
}

function countBoundTracks(action: THREE.AnimationAction | undefined): number {
  if (!action) return 0;
  const bindings = (
    action as unknown as {
      _propertyBindings?: Array<{ binding?: { node?: unknown } }>;
    }
  )._propertyBindings;
  return bindings?.filter((b) => b?.binding?.node != null).length ?? 0;
}

function inspectFile(
  sourceFile: string,
  clips: THREE.AnimationClip[],
): ClipInspection[] {
  return clips.map((clip, index) => ({
    sourceFile,
    index,
    name: clip.name,
    duration: clip.duration,
    trackCount: clip.tracks.length,
    suggestedRole: PROD02B_CLIP_ROLES.includes(clip.name as Prod02bClipRole)
      ? (clip.name as Prod02bClipRole)
      : "unused",
  }));
}

function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh)
      skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
    for (const m of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      materials.add(m);
      for (const [key, value] of Object.entries(m)) {
        if (key !== "envMap" && value instanceof THREE.Texture)
          textures.add(value);
      }
    }
  });
  skeletons.forEach((s) => s.dispose());
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    (t.source.data as ImageBitmap | null)?.close?.();
  });
}
