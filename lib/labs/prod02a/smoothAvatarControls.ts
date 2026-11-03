import * as THREE from "three";

export type SmoothCollisionResolve = (
  from: THREE.Vector3,
  to: THREE.Vector3,
) => THREE.Vector3;

/**
 * Probe boom from follow target → preferred camera position.
 * Return the farthest collision-safe world position (or `to` if clear).
 */
export type SmoothCameraBoomResolve = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
) => {
  safePoint: THREE.Vector3;
  hit: boolean;
  hitPoint: THREE.Vector3 | null;
  safeDistance: number;
};

export type FollowCameraStyle = "free" | "ecctrl";

export type FacingMode = "face-move" | "strafe";

export type ObstructionFallback = "close" | "first-person";

export type SmoothNavTuning = {
  walkSpeed: number;
  acceleration: number;
  deceleration: number;
  /** How fast the body turns to face travel (face-move mode). */
  turnSpeed: number;
  facingMode: FacingMode;

  followStyle: FollowCameraStyle;

  /** Preferred boom length in open space. */
  preferredDistance: number;
  minDistance: number;
  maxDistance: number;
  /** Follow target height above body (chest/head). */
  targetHeight: number;
  /** Lateral framing in camera-right space (m). */
  framingOffsetX: number;
  /** Vertical framing offset on top of targetHeight (m). */
  framingOffsetY: number;
  /** How quickly the follow target tracks the body (higher = snappier). */
  followResponsiveness: number;

  lookSpeed: number;
  pitchMin: number;
  pitchMax: number;
  /** Softness of yaw/pitch catch-up for virtual look pads (not mouse). */
  rotationResponsiveness: number;

  /**
   * Ecctrl-style optional recenter behind the body.
   * Free Follow ignores this (always off). Default off for Ecctrl too.
   */
  recenterEnabled: boolean;
  recenterDelay: number;
  recenterSpeed: number;

  cameraCollisionEnabled: boolean;
  cameraCollisionRadius: number;
  collisionMargin: number;
  /** Boom shorten rate when obstructed (higher = faster inward). */
  inwardResponsiveness: number;
  /** Boom lengthen rate when clear (lower = gentler outward). */
  outwardResponsiveness: number;
  obstructionFallback: ObstructionFallback;

  eyeHeight: number;

  /** @deprecated mapped to preferredDistance */
  cameraBackOffset?: number;
  /** @deprecated mapped to minDistance */
  cameraMinDistance?: number;
  /** @deprecated mapped to framingOffsetY / targetHeight */
  cameraHeightOffset?: number;
  /** @deprecated */
  positionDamping?: number;
  /** @deprecated */
  rotationDamping?: number;
  /** @deprecated use recenterEnabled */
  recenterBehind?: boolean;
  /** @deprecated use recenterSpeed */
  recenterDamping?: number;
};

export type SmoothDebugSnapshot = {
  followStyle: FollowCameraStyle;
  preferredDistance: number;
  actualDistance: number;
  boomDistance: number;
  obstructed: boolean;
  camYaw: number;
  camPitch: number;
  bodyYaw: number;
  facingMode: FacingMode;
  velocity: [number, number, number];
  target: [number, number, number];
  desiredCam: [number, number, number];
  actualCam: [number, number, number];
  hitPoint: [number, number, number] | null;
  fallbackActive: boolean;
};

export const DEFAULT_SMOOTH_TUNING: SmoothNavTuning = {
  walkSpeed: 2.45,
  acceleration: 9,
  deceleration: 11,
  turnSpeed: 2.15,
  facingMode: "face-move",

  followStyle: "free",

  preferredDistance: 1.35,
  minDistance: 0.38,
  maxDistance: 3.2,
  targetHeight: 1.35,
  framingOffsetX: 0,
  framingOffsetY: 0.08,
  followResponsiveness: 12,

  lookSpeed: 0.00155,
  pitchMin: -0.42,
  pitchMax: 0.55,
  rotationResponsiveness: 10,

  recenterEnabled: false,
  recenterDelay: 1.4,
  recenterSpeed: 1.1,

  cameraCollisionEnabled: true,
  cameraCollisionRadius: 0.14,
  collisionMargin: 0.12,
  inwardResponsiveness: 28,
  outwardResponsiveness: 4.5,
  obstructionFallback: "close",

  eyeHeight: 1.5,
};

/** Production-leaning preset (separate from experimental Dev fiddling). */
export const PRODUCTION_SMOOTH_TUNING: SmoothNavTuning = {
  ...DEFAULT_SMOOTH_TUNING,
  preferredDistance: 1.45,
  minDistance: 0.4,
  followResponsiveness: 11,
  inwardResponsiveness: 32,
  outwardResponsiveness: 3.8,
  lookSpeed: 0.0015,
};

const PRESET_KEY = "spatial-lab.prod02a.smooth-tuning.v2";

export function loadSmoothTuningPreset(): SmoothNavTuning | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SmoothNavTuning>;
    return normalizeTuning({ ...DEFAULT_SMOOTH_TUNING, ...parsed });
  } catch {
    return null;
  }
}

export function saveSmoothTuningPreset(tuning: SmoothNavTuning) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRESET_KEY, JSON.stringify(normalizeTuning(tuning)));
}

export function clearSmoothTuningPreset() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PRESET_KEY);
}

/** Merge legacy field names from earlier PROD-02A tuning. */
export function normalizeTuning(input: Partial<SmoothNavTuning>): SmoothNavTuning {
  const t: SmoothNavTuning = { ...DEFAULT_SMOOTH_TUNING, ...input };

  if (input.cameraBackOffset != null && input.preferredDistance == null) {
    t.preferredDistance = input.cameraBackOffset;
  }
  if (input.cameraMinDistance != null && input.minDistance == null) {
    t.minDistance = input.cameraMinDistance;
  }
  if (input.cameraHeightOffset != null && input.framingOffsetY == null) {
    t.framingOffsetY = input.cameraHeightOffset;
  }
  if (input.positionDamping != null && input.followResponsiveness == null) {
    t.followResponsiveness = input.positionDamping;
  }
  if (input.recenterBehind != null && input.recenterEnabled == null) {
    t.recenterEnabled = input.recenterBehind;
  }
  if (input.recenterDamping != null && input.recenterSpeed == null) {
    t.recenterSpeed = input.recenterDamping;
  }

  t.preferredDistance = THREE.MathUtils.clamp(t.preferredDistance, 0.35, 6);
  t.minDistance = THREE.MathUtils.clamp(t.minDistance, 0.15, t.preferredDistance);
  t.maxDistance = Math.max(t.preferredDistance, t.maxDistance);
  t.pitchMin = Math.min(t.pitchMin, t.pitchMax - 0.05);
  return t;
}

/**
 * Invisible avatar + third-person follow camera (PROD-02A V2).
 *
 * Movement controller state is independent of camera yaw/pitch.
 * Free Follow never recenters; Ecctrl may optionally recenter after idle delay.
 */
export class SmoothAvatarControls {
  enabled = false;
  tuning: SmoothNavTuning = { ...DEFAULT_SMOOTH_TUNING };
  resolveCollision: SmoothCollisionResolve | null = null;
  resolveCameraBoom: SmoothCameraBoomResolve | null = null;
  showCapsule = false;
  showDebug = false;
  /** Fired when scroll wheel adjusts preferred boom length (keep React state in sync). */
  onPreferredDistanceChange: ((distance: number) => void) | null = null;

  /** Intent interface for keyboard / pads / future Point & Move. */
  private moveIntentX = 0;
  private moveIntentZ = 0;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly keys = new Set<string>();
  private dragging = false;
  private mouseLookActive = false;
  private timeSinceLookInput = 999;
  private prevX = 0;
  private prevY = 0;

  readonly body = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private bodyYaw = 0;

  /** Absolute camera orbit yaw/pitch (world), independent of bodyYaw. */
  private camYaw = 0;
  private camPitch = 0.12;
  private boomDistance = DEFAULT_SMOOTH_TUNING.preferredDistance;
  private obstructed = false;
  private fallbackActive = false;
  private readonly lastHitPoint = new THREE.Vector3();
  private hasHitPoint = false;

  private virtualLookYaw = 0;
  private virtualLookPitch = 0;
  private lookHoldSpeed = 1.05;

  private readonly wish = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly next = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly followTarget = new THREE.Vector3();
  private readonly followTargetSmooth = new THREE.Vector3();
  private readonly camDesired = new THREE.Vector3();
  private readonly boomDir = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private followTargetReady = false;

  readonly capsuleMesh: THREE.Mesh;
  readonly debugGroup: THREE.Group;
  private readonly dbgDesired: THREE.Mesh;
  private readonly dbgActual: THREE.Mesh;
  private readonly dbgTarget: THREE.Mesh;
  private readonly dbgHit: THREE.Mesh;
  private readonly dbgBoomPreferred: THREE.Line;
  private readonly dbgBoomActual: THREE.Line;
  private readonly dbgForward: THREE.ArrowHelper;
  private readonly dbgVelocity: THREE.ArrowHelper;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    this.dom.tabIndex = 0;
    this.dom.style.outline = "none";
    this.dom.style.touchAction = "none";

    const geo = new THREE.CapsuleGeometry(0.18, 0.85, 3, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc4a574,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
    });
    this.capsuleMesh = new THREE.Mesh(geo, mat);
    this.capsuleMesh.visible = false;
    this.capsuleMesh.renderOrder = 2;

    this.debugGroup = new THREE.Group();
    this.debugGroup.visible = false;

    const mkSphere = (color: number, r: number) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 10, 10),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }),
      );
      m.renderOrder = 5;
      return m;
    };
    this.dbgDesired = mkSphere(0x6ea8fe, 0.06);
    this.dbgActual = mkSphere(0xf0c14a, 0.05);
    this.dbgTarget = mkSphere(0x7dcea0, 0.07);
    this.dbgHit = mkSphere(0xe74c3c, 0.05);
    this.dbgHit.visible = false;

    const mkLine = (color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, 1),
      ]);
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
      );
      line.renderOrder = 5;
      return line;
    };
    this.dbgBoomPreferred = mkLine(0x6ea8fe);
    this.dbgBoomActual = mkLine(0xf0c14a);

    this.dbgForward = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
      0.7,
      0x5dade2,
      0.12,
      0.08,
    );
    this.dbgVelocity = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
      0.4,
      0xe67e22,
      0.1,
      0.06,
    );

    this.debugGroup.add(
      this.dbgDesired,
      this.dbgActual,
      this.dbgTarget,
      this.dbgHit,
      this.dbgBoomPreferred,
      this.dbgBoomActual,
      this.dbgForward,
      this.dbgVelocity,
    );

    this.syncFromCamera();
    this.dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
  }

  /** Keyboard / pad / future Point & Move share this intent. */
  setMoveIntent(x: number, z: number) {
    this.moveIntentX = THREE.MathUtils.clamp(x, -1, 1);
    this.moveIntentZ = THREE.MathUtils.clamp(z, -1, 1);
  }

  setVirtualMove(x: number, z: number) {
    this.setMoveIntent(x, z);
  }

  setVirtualLook(yawDir: number, pitchDir: number) {
    this.virtualLookYaw = THREE.MathUtils.clamp(yawDir, -1, 1) * this.lookHoldSpeed;
    this.virtualLookPitch = THREE.MathUtils.clamp(pitchDir, -1, 1) * this.lookHoldSpeed;
    if (yawDir !== 0 || pitchDir !== 0) {
      this.timeSinceLookInput = 0;
      this.mouseLookActive = true;
    }
  }

  /** Pixel drag look (touch zone / mouse) — immediate, no residual rate. */
  applyLookDelta(dx: number, dy: number, sensitivity = 1) {
    const speed = this.tuning.lookSpeed * sensitivity;
    this.camYaw -= dx * speed;
    this.camPitch += dy * speed;
    this.camPitch = THREE.MathUtils.clamp(
      this.camPitch,
      this.tuning.pitchMin,
      this.tuning.pitchMax,
    );
    this.timeSinceLookInput = 0;
    this.mouseLookActive = true;
  }

  clearMoveIntent() {
    this.moveIntentX = 0;
    this.moveIntentZ = 0;
  }

  clearVirtualInput() {
    this.clearMoveIntent();
    this.virtualLookYaw = 0;
    this.virtualLookPitch = 0;
  }

  /** When true, touch pointers on the canvas do not start look-drag (mobile overlays own look). */
  suppressTouchLook = false;

  cancelMotion() {
    this.velocity.set(0, 0, 0);
    this.clearVirtualInput();
  }

  getDebugSnapshot(): SmoothDebugSnapshot {
    return {
      followStyle: this.tuning.followStyle,
      preferredDistance: this.tuning.preferredDistance,
      actualDistance: this.camera.position.distanceTo(this.followTargetSmooth),
      boomDistance: this.boomDistance,
      obstructed: this.obstructed,
      camYaw: this.camYaw,
      camPitch: this.camPitch,
      bodyYaw: this.bodyYaw,
      facingMode: this.tuning.facingMode,
      velocity: [this.velocity.x, this.velocity.y, this.velocity.z],
      target: [this.followTargetSmooth.x, this.followTargetSmooth.y, this.followTargetSmooth.z],
      desiredCam: [this.camDesired.x, this.camDesired.y, this.camDesired.z],
      actualCam: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      hitPoint: this.hasHitPoint
        ? [this.lastHitPoint.x, this.lastHitPoint.y, this.lastHitPoint.z]
        : null,
      fallbackActive: this.fallbackActive,
    };
  }

  syncFromCamera() {
    this.euler.setFromQuaternion(this.camera.quaternion, "YXZ");
    this.camYaw = this.euler.y;
    this.camPitch = THREE.MathUtils.clamp(this.euler.x, this.tuning.pitchMin, this.tuning.pitchMax);
    this.bodyYaw = this.camYaw;
    const back = Math.max(0.5, this.tuning.preferredDistance);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    else dir.normalize();
    this.body.set(
      this.camera.position.x + dir.x * back,
      this.camera.position.y - this.tuning.eyeHeight,
      this.camera.position.z + dir.z * back,
    );
    this.velocity.set(0, 0, 0);
    this.boomDistance = this.tuning.preferredDistance;
    this.followTargetReady = false;
    this.obstructed = false;
    this.fallbackActive = false;
    this.applyCameraPose(true, 1 / 60);
  }

  setPose(eye: THREE.Vector3, target: THREE.Vector3) {
    this.body.set(eye.x, eye.y - this.tuning.eyeHeight, eye.z);
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    this.bodyYaw = Math.atan2(-dx, -dz);
    this.camYaw = this.bodyYaw;
    this.camPitch = 0.12;
    this.velocity.set(0, 0, 0);
    this.boomDistance = this.tuning.preferredDistance;
    this.followTargetReady = false;
    this.obstructed = false;
    this.fallbackActive = false;
    this.applyCameraPose(true, 1 / 60);
  }

  update(delta: number) {
    if (!this.enabled) {
      this.clearVirtualInput();
      this.capsuleMesh.visible = false;
      this.debugGroup.visible = false;
      return;
    }
    const dt = Math.min(0.05, Math.max(0, delta));
    const t = normalizeTuning(this.tuning);
    this.tuning = t;

    this.timeSinceLookInput += dt;

    if (this.virtualLookYaw !== 0 || this.virtualLookPitch !== 0) {
      this.camYaw -= this.virtualLookYaw * dt;
      this.camPitch -= this.virtualLookPitch * dt;
      this.timeSinceLookInput = 0;
    } else if (!this.dragging) {
      this.mouseLookActive = false;
    }
    this.camPitch = THREE.MathUtils.clamp(this.camPitch, t.pitchMin, t.pitchMax);

    // Horizontal camera heading = movement basis (never includes pitch lift)
    this.camForward.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camYaw);
    this.camForward.y = 0;
    if (this.camForward.lengthSq() < 1e-6) this.camForward.set(0, 0, -1);
    else this.camForward.normalize();
    this.camRight.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camYaw);
    this.camRight.y = 0;
    if (this.camRight.lengthSq() < 1e-6) this.camRight.set(1, 0, 0);
    else this.camRight.normalize();

    this.wish.set(this.moveIntentX, 0, this.moveIntentZ);
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.wish.z -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.wish.z += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.wish.x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.wish.x += 1;
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    else {
      this.wish.x = THREE.MathUtils.clamp(this.wish.x, -1, 1);
      this.wish.z = THREE.MathUtils.clamp(this.wish.z, -1, 1);
    }

    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = t.walkSpeed * (sprint ? 1.7 : 1);

    this.desired.set(0, 0, 0);
    if (this.wish.lengthSq() > 0) {
      this.desired.addScaledVector(this.camForward, -this.wish.z * speed);
      this.desired.addScaledVector(this.camRight, this.wish.x * speed);
      if (t.facingMode === "face-move") {
        const moveYaw = Math.atan2(-this.desired.x, -this.desired.z);
        let dyaw = moveYaw - this.bodyYaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this.bodyYaw += THREE.MathUtils.clamp(dyaw, -t.turnSpeed * dt, t.turnSpeed * dt);
      }
    }

    const driving = this.desired.lengthSq() > 0;
    const damp = driving ? t.acceleration : t.deceleration;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, this.desired.x, damp, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, this.desired.z, damp, dt);
    this.velocity.y = 0;

    // Ecctrl optional recenter — Free Follow never auto-repositions behind body
    const allowRecenter =
      t.followStyle === "ecctrl" &&
      t.recenterEnabled &&
      !this.mouseLookActive &&
      this.timeSinceLookInput >= t.recenterDelay;
    if (allowRecenter) {
      let dyaw = this.bodyYaw - this.camYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.camYaw += THREE.MathUtils.clamp(dyaw, -t.recenterSpeed * dt, t.recenterSpeed * dt);
    }

    this.eye.set(this.body.x, this.body.y + t.eyeHeight, this.body.z);
    this.next.set(
      this.eye.x + this.velocity.x * dt,
      this.eye.y,
      this.eye.z + this.velocity.z * dt,
    );

    let resolved = this.next;
    if (this.resolveCollision) {
      resolved = this.resolveCollision(this.eye, this.next);
      const dx = resolved.x - this.eye.x;
      const dz = resolved.z - this.eye.z;
      const wantX = this.next.x - this.eye.x;
      const wantZ = this.next.z - this.eye.z;
      if (Math.abs(wantX) > 1e-5 && Math.abs(dx) < Math.abs(wantX) * 0.05) this.velocity.x = 0;
      if (Math.abs(wantZ) > 1e-5 && Math.abs(dz) < Math.abs(wantZ) * 0.05) this.velocity.z = 0;
    }

    this.body.set(resolved.x, resolved.y - t.eyeHeight, resolved.z);
    this.eye.set(resolved.x, resolved.y, resolved.z);

    this.applyCameraPose(false, dt);
    this.updateCapsule(t);
    this.updateDebugHelpers(t);
  }

  private computeFollowTarget(t: SmoothNavTuning) {
    // Framing offsets in camera-horizontal space so A/D framing stays screen-stable
    this.followTarget.set(
      this.body.x + this.camRight.x * t.framingOffsetX,
      this.body.y + t.targetHeight + t.framingOffsetY,
      this.body.z + this.camRight.z * t.framingOffsetX,
    );
  }

  private applyCameraPose(instant: boolean, dt: number) {
    const t = this.tuning;
    this.computeFollowTarget(t);

    if (!this.followTargetReady || instant) {
      this.followTargetSmooth.copy(this.followTarget);
      this.followTargetReady = true;
    } else {
      const k = t.followResponsiveness;
      this.followTargetSmooth.x = THREE.MathUtils.damp(
        this.followTargetSmooth.x,
        this.followTarget.x,
        k,
        dt,
      );
      this.followTargetSmooth.y = THREE.MathUtils.damp(
        this.followTargetSmooth.y,
        this.followTarget.y,
        k,
        dt,
      );
      this.followTargetSmooth.z = THREE.MathUtils.damp(
        this.followTargetSmooth.z,
        this.followTarget.z,
        k,
        dt,
      );
    }

    const preferred = THREE.MathUtils.clamp(t.preferredDistance, t.minDistance, t.maxDistance);
    const pitch = this.camPitch;
    const yaw = this.camYaw;
    const horizScale = Math.cos(pitch);
    this.boomDir.set(Math.sin(yaw) * horizScale, Math.sin(pitch), Math.cos(yaw) * horizScale);
    if (this.boomDir.lengthSq() < 1e-8) this.boomDir.set(0, 0, 1);
    else this.boomDir.normalize();

    // Ideal camera at preferred distance (before collision)
    this.camDesired
      .copy(this.followTargetSmooth)
      .addScaledVector(this.boomDir, preferred);

    let safeDistance = preferred;
    this.obstructed = false;
    this.hasHitPoint = false;
    this.fallbackActive = false;

    if (t.cameraCollisionEnabled && this.resolveCameraBoom) {
      const probe = this.resolveCameraBoom(
        this.followTargetSmooth,
        this.camDesired,
        t.cameraCollisionRadius,
      );
      if (probe.hit) {
        this.obstructed = true;
        safeDistance = Math.max(t.minDistance, probe.safeDistance - t.collisionMargin);
        if (probe.hitPoint) {
          this.lastHitPoint.copy(probe.hitPoint);
          this.hasHitPoint = true;
        }
      } else {
        safeDistance = preferred;
      }
    }

    if (safeDistance <= t.minDistance * 1.05 && t.obstructionFallback === "first-person") {
      this.fallbackActive = true;
      this.boomDistance = 0;
      this.camera.position.set(
        this.body.x,
        this.body.y + t.eyeHeight,
        this.body.z,
      );
      this.euler.set(this.camPitch, this.camYaw, 0, "YXZ");
      this.camera.quaternion.setFromEuler(this.euler);
      return;
    }

    if (instant) {
      this.boomDistance = safeDistance;
    } else if (safeDistance < this.boomDistance - 1e-4) {
      // Inward: respond faster than ordinary follow — never lag into a wall
      this.boomDistance = THREE.MathUtils.damp(
        this.boomDistance,
        safeDistance,
        t.inwardResponsiveness,
        dt,
      );
      // Hard clamp: never remain beyond safe this frame
      this.boomDistance = Math.min(this.boomDistance, safeDistance);
    } else {
      this.boomDistance = THREE.MathUtils.damp(
        this.boomDistance,
        safeDistance,
        t.outwardResponsiveness,
        dt,
      );
    }
    this.boomDistance = THREE.MathUtils.clamp(this.boomDistance, t.minDistance, t.maxDistance);

    this.camDesired
      .copy(this.followTargetSmooth)
      .addScaledVector(this.boomDir, this.boomDistance);

    // Final safety validation against boom resolver
    if (t.cameraCollisionEnabled && this.resolveCameraBoom) {
      const finalProbe = this.resolveCameraBoom(
        this.followTargetSmooth,
        this.camDesired,
        t.cameraCollisionRadius,
      );
      if (finalProbe.hit) {
        this.obstructed = true;
        const hard = Math.max(t.minDistance, finalProbe.safeDistance - t.collisionMargin);
        this.boomDistance = Math.min(this.boomDistance, hard);
        this.camDesired
          .copy(this.followTargetSmooth)
          .addScaledVector(this.boomDir, this.boomDistance);
        if (finalProbe.hitPoint) {
          this.lastHitPoint.copy(finalProbe.hitPoint);
          this.hasHitPoint = true;
        }
      }
    }

    if (instant) {
      this.camera.position.copy(this.camDesired);
    } else if (this.obstructed) {
      // When obstructed, snap position to validated boom (no soft damp through walls)
      this.camera.position.copy(this.camDesired);
    } else {
      const k = Math.max(6, t.followResponsiveness * 0.85);
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.camDesired.x,
        k,
        dt,
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.camDesired.y,
        k,
        dt,
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        this.camDesired.z,
        k,
        dt,
      );
    }

    // Orientation from user yaw/pitch only — never from body facing
    this.euler.set(this.camPitch, this.camYaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(this.euler);
  }

  private updateCapsule(t: SmoothNavTuning) {
    this.capsuleMesh.visible = this.showCapsule;
    if (!this.showCapsule) return;
    this.capsuleMesh.position.set(
      this.body.x,
      this.body.y + Math.max(0.55, t.eyeHeight * 0.48),
      this.body.z,
    );
    this.capsuleMesh.rotation.set(0, this.bodyYaw, 0);
  }

  private updateDebugHelpers(t: SmoothNavTuning) {
    this.debugGroup.visible = this.showDebug;
    if (!this.showDebug) return;

    this.dbgTarget.position.copy(this.followTargetSmooth);
    this.dbgDesired.position
      .copy(this.followTargetSmooth)
      .addScaledVector(this.boomDir, t.preferredDistance);
    this.dbgActual.position.copy(this.camera.position);
    this.dbgHit.visible = this.hasHitPoint;
    if (this.hasHitPoint) this.dbgHit.position.copy(this.lastHitPoint);

    const setLine = (line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) => {
      const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    };
    setLine(this.dbgBoomPreferred, this.followTargetSmooth, this.dbgDesired.position);
    setLine(this.dbgBoomActual, this.followTargetSmooth, this.camera.position);

    const fwd = new THREE.Vector3(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    this.dbgForward.position.copy(this.body);
    this.dbgForward.position.y += 0.2;
    this.dbgForward.setDirection(fwd);
    this.dbgForward.setLength(0.7, 0.12, 0.08);

    const speed = this.velocity.length();
    this.dbgVelocity.position.copy(this.body);
    this.dbgVelocity.position.y += 0.35;
    if (speed > 0.05) {
      this.dbgVelocity.visible = true;
      this.dbgVelocity.setDirection(this.velocity.clone().normalize());
      this.dbgVelocity.setLength(Math.min(1.2, speed * 0.35), 0.1, 0.06);
    } else {
      this.dbgVelocity.visible = false;
    }
  }

  dispose() {
    this.clearVirtualInput();
    this.dom.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown, { capture: true } as AddEventListenerOptions);
    window.removeEventListener("keyup", this.onKeyUp, { capture: true } as AddEventListenerOptions);
    this.capsuleMesh.geometry.dispose();
    (this.capsuleMesh.material as THREE.Material).dispose();
    this.debugGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    if (this.suppressTouchLook && e.pointerType === "touch") return;
    this.dragging = true;
    this.mouseLookActive = true;
    this.timeSinceLookInput = 0;
    this.prevX = e.clientX;
    this.prevY = e.clientY;
    this.dom.setPointerCapture?.(e.pointerId);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.dragging = false;
    this.mouseLookActive = false;
    try {
      this.dom.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging) return;
    const dx = e.clientX - this.prevX;
    const dy = e.clientY - this.prevY;
    this.prevX = e.clientX;
    this.prevY = e.clientY;
    this.camYaw -= dx * this.tuning.lookSpeed;
    this.camPitch += dy * this.tuning.lookSpeed;
    this.camPitch = THREE.MathUtils.clamp(
      this.camPitch,
      this.tuning.pitchMin,
      this.tuning.pitchMax,
    );
    this.timeSinceLookInput = 0;
    this.mouseLookActive = true;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    const target = e.target as Node | null;
    if (target && !this.dom.contains(target) && target !== this.dom) return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * 0.12;
    const next = THREE.MathUtils.clamp(
      this.tuning.preferredDistance + delta,
      this.tuning.minDistance,
      this.tuning.maxDistance,
    );
    this.tuning.preferredDistance = next;
    this.onPreferredDistanceChange?.(next);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
}
