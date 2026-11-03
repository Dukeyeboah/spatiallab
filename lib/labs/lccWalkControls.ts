import * as THREE from "three";

export type WalkCollisionResolve = (
  from: THREE.Vector3,
  to: THREE.Vector3,
) => THREE.Vector3;

/**
 * First-person walk for LCC tours (LAB EXP-02 / PROD-02A).
 * WASD / arrows on XZ; look via drag or pointer-lock; Shift sprint; Esc exits lock.
 * Optional click-to-navigate target (Point & Move).
 */
export class LccWalkControls {
  enabled = false;
  /** Base walk speed (m/s). */
  movementSpeed = 2.6;
  /** Sprint multiplier when Shift held. */
  sprintMultiplier = 1.75;
  lookSpeed = 0.00185;
  /** Eye height above “feet” for floor following (metres). */
  eyeHeight = 1.5;
  /** Keep camera Y stable unless collision resolver adjusts floor. */
  lockEyeHeight = true;
  /** Auto-turn toward Point & Move destination (rad/s). */
  autoTurnSpeed = 2.4;
  /** Stop when within this horizontal distance of the click target (m). */
  arriveRadius = 0.28;

  /** Optional collision / floor resolver applied after wish movement. */
  resolveCollision: WalkCollisionResolve | null = null;

  /** On-screen / virtual strafe (x) and forward (z, −1 = forward). Combined with keys. */
  private virtualMoveX = 0;
  private virtualMoveZ = 0;
  /** On-screen look rates (rad/s). */
  private virtualLookYaw = 0;
  private virtualLookPitch = 0;
  /** Look pad angular speed when a direction is held. */
  lookHoldSpeed = 1.15;

  /** Active Point & Move destination on XZ (y ignored). */
  private moveTarget: THREE.Vector3 | null = null;
  private readonly tmpToTarget = new THREE.Vector3();

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly keys = new Set<string>();
  private dragging = false;
  private pointerLocked = false;
  private prevX = 0;
  private prevY = 0;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly next = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  /** Softer accel/friction for comfort (PROD-02A). */
  private readonly accel = 10;
  private readonly friction = 9;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.dom = domElement;
    this.dom.tabIndex = 0;
    this.dom.style.outline = "none";
    this.dom.style.touchAction = "none";
    this.syncFromCamera();
    this.dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  syncFromCamera() {
    this.euler.setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
    this.velocity.set(0, 0, 0);
  }

  lookAt(target: THREE.Vector3) {
    this.camera.lookAt(target);
    this.syncFromCamera();
  }

  /** Hold/release on-screen move pad (−1…1). */
  setVirtualMove(x: number, z: number) {
    this.virtualMoveX = THREE.MathUtils.clamp(x, -1, 1);
    this.virtualMoveZ = THREE.MathUtils.clamp(z, -1, 1);
  }

  /** Hold/release on-screen look pad (−1…1 → yaw/pitch rates). */
  setVirtualLook(yawDir: number, pitchDir: number) {
    this.virtualLookYaw = THREE.MathUtils.clamp(yawDir, -1, 1) * this.lookHoldSpeed;
    this.virtualLookPitch = THREE.MathUtils.clamp(pitchDir, -1, 1) * this.lookHoldSpeed;
  }

  /** Pixel drag look (touch zone) — immediate, no residual rate. */
  applyLookDelta(dx: number, dy: number, sensitivity = 1) {
    const speed = this.lookSpeed * sensitivity;
    this.yaw -= dx * speed;
    this.pitch -= dy * speed;
    const limit = Math.PI / 2 - 0.08;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  clearMoveIntent() {
    this.virtualMoveX = 0;
    this.virtualMoveZ = 0;
  }

  clearVirtualInput() {
    this.clearMoveIntent();
    this.virtualLookYaw = 0;
    this.virtualLookPitch = 0;
  }

  /** When true, touch pointers on the canvas do not start look-drag. */
  suppressTouchLook = false;

  /** Begin smooth travel toward a floor point (XZ). */
  setMoveTarget(x: number, y: number, z: number) {
    this.moveTarget = new THREE.Vector3(x, y, z);
  }

  cancelMoveTarget() {
    this.moveTarget = null;
  }

  hasMoveTarget() {
    return this.moveTarget != null;
  }

  getMoveTarget(): THREE.Vector3 | null {
    return this.moveTarget ? this.moveTarget.clone() : null;
  }

  async requestPointerLock() {
    if (!this.enabled || document.pointerLockElement === this.dom) return;
    try {
      await this.dom.requestPointerLock();
    } catch {
      /* user gesture / unsupported */
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  update(delta: number) {
    if (!this.enabled) {
      this.clearVirtualInput();
      return;
    }
    const dt = Math.min(0.05, Math.max(0, delta));

    // Manual WASD / pads cancel click-to-move
    const manualWish =
      Math.abs(this.virtualMoveX) > 0.01 ||
      Math.abs(this.virtualMoveZ) > 0.01 ||
      this.keys.has("KeyW") ||
      this.keys.has("KeyA") ||
      this.keys.has("KeyS") ||
      this.keys.has("KeyD") ||
      this.keys.has("ArrowUp") ||
      this.keys.has("ArrowDown") ||
      this.keys.has("ArrowLeft") ||
      this.keys.has("ArrowRight");
    if (manualWish && this.moveTarget) this.moveTarget = null;

    if (this.virtualLookYaw !== 0 || this.virtualLookPitch !== 0) {
      this.yaw -= this.virtualLookYaw * dt;
      this.pitch -= this.virtualLookPitch * dt;
      const limit = Math.PI / 2 - 0.08;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    }

    // Point & Move: ease yaw toward destination
    if (this.moveTarget) {
      this.tmpToTarget.set(
        this.moveTarget.x - this.camera.position.x,
        0,
        this.moveTarget.z - this.camera.position.z,
      );
      const dist = this.tmpToTarget.length();
      if (dist <= this.arriveRadius) {
        this.moveTarget = null;
        this.velocity.set(0, 0, 0);
      } else {
        this.tmpToTarget.normalize();
        const desiredYaw = Math.atan2(-this.tmpToTarget.x, -this.tmpToTarget.z);
        let dyaw = desiredYaw - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const maxStep = this.autoTurnSpeed * dt;
        this.yaw += THREE.MathUtils.clamp(dyaw, -maxStep, maxStep);
      }
    }

    this.euler.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(this.euler);

    this.wish.set(this.virtualMoveX, 0, this.virtualMoveZ);
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.wish.z -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.wish.z += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.wish.x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.wish.x += 1;
    this.wish.x = THREE.MathUtils.clamp(this.wish.x, -1, 1);
    this.wish.z = THREE.MathUtils.clamp(this.wish.z, -1, 1);

    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    else this.forward.normalize();
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    else this.right.normalize();

    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = this.movementSpeed * (sprint ? this.sprintMultiplier : 1);

    this.desired.set(0, 0, 0);
    if (this.moveTarget && !manualWish) {
      this.tmpToTarget.set(
        this.moveTarget.x - this.camera.position.x,
        0,
        this.moveTarget.z - this.camera.position.z,
      );
      const dist = this.tmpToTarget.length();
      if (dist > this.arriveRadius) {
        this.tmpToTarget.normalize();
        // Ease near arrival
        const scale = Math.min(1, dist / 1.2);
        this.desired.copy(this.tmpToTarget).multiplyScalar(speed * scale);
      }
    } else if (this.wish.lengthSq() > 0) {
      this.wish.normalize();
      // W → move along look forward (wish.z is -1 for W)
      this.desired.addScaledVector(this.forward, -this.wish.z * speed);
      this.desired.addScaledVector(this.right, this.wish.x * speed);
    }

    const driving = this.desired.lengthSq() > 0;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, this.desired.x, driving ? this.accel : this.friction, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, this.desired.z, driving ? this.accel : this.friction, dt);
    this.velocity.y = 0;

    if (this.velocity.lengthSq() < 1e-10 && this.desired.lengthSq() < 1e-10) return;

    const from = this.camera.position;
    this.next.set(from.x + this.velocity.x * dt, from.y, from.z + this.velocity.z * dt);
    if (this.lockEyeHeight) this.next.y = from.y;

    if (this.resolveCollision) {
      const resolved = this.resolveCollision(from, this.next);
      const dx = resolved.x - from.x;
      const dz = resolved.z - from.z;
      const wantX = this.next.x - from.x;
      const wantZ = this.next.z - from.z;
      if (Math.abs(wantX) > 1e-5 && Math.abs(dx) < Math.abs(wantX) * 0.05) this.velocity.x = 0;
      if (Math.abs(wantZ) > 1e-5 && Math.abs(dz) < Math.abs(wantZ) * 0.05) this.velocity.z = 0;
      // If click-to-move is jammed against a wall, cancel path
      if (this.moveTarget && Math.hypot(dx, dz) < 1e-4 && this.desired.lengthSq() > 0.01) {
        this.moveTarget = null;
      }
      this.camera.position.copy(resolved);
    } else {
      this.camera.position.copy(this.next);
    }
  }

  dispose() {
    this.exitPointerLock();
    this.clearVirtualInput();
    this.dom.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("keydown", this.onKeyDown, { capture: true } as AddEventListenerOptions);
    window.removeEventListener("keyup", this.onKeyUp, { capture: true } as AddEventListenerOptions);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.keys.clear();
  }

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.dom;
    if (!this.pointerLocked) this.dragging = false;
  };

  private onPointerDown = (evt: PointerEvent) => {
    if (!this.enabled || evt.button !== 0 || evt.ctrlKey) return;
    if (this.suppressTouchLook && evt.pointerType === "touch") return;
    try {
      this.dom.focus({ preventScroll: true });
    } catch {
      this.dom.focus();
    }
    // Triple-click (or keep double in walk) for pointer lock — leave double free for orbit pivot / point-move UX.
    if (evt.detail >= 3) void this.requestPointerLock();
    this.dragging = true;
    this.prevX = evt.clientX;
    this.prevY = evt.clientY;
    this.pointerDownX = evt.clientX;
    this.pointerDownY = evt.clientY;
    try {
      this.dom.setPointerCapture(evt.pointerId);
    } catch {
      /* ignore */
    }
  };

  /** True if the last pointer gesture was a click (little movement), not a drag-look. */
  wasClickGesture(upX: number, upY: number, maxPx = 6) {
    return Math.hypot(upX - this.pointerDownX, upY - this.pointerDownY) <= maxPx;
  }

  private onPointerUp = (evt: PointerEvent) => {
    this.dragging = false;
    try {
      this.dom.releasePointerCapture(evt.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onPointerMove = (evt: PointerEvent) => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      this.yaw -= evt.movementX * this.lookSpeed;
      this.pitch -= evt.movementY * this.lookSpeed;
    } else if (this.dragging) {
      const dx = evt.clientX - this.prevX;
      const dy = evt.clientY - this.prevY;
      this.prevX = evt.clientX;
      this.prevY = evt.clientY;
      this.yaw -= dx * this.lookSpeed;
      this.pitch -= dy * this.lookSpeed;
    } else {
      return;
    }
    const limit = Math.PI / 2 - 0.08;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  };

  private isWalkKey(code: string) {
    return (
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight" ||
      code === "ShiftLeft" ||
      code === "ShiftRight"
    );
  }

  private onKeyDown = (evt: KeyboardEvent) => {
    if (!this.enabled) return;
    if (evt.code === "Escape") {
      this.cancelMoveTarget();
      this.exitPointerLock();
      return;
    }
    // Don't steal typing from Dev form fields
    const t = evt.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    if (this.isWalkKey(evt.code)) {
      this.keys.add(evt.code);
      evt.preventDefault();
    }
  };

  private onKeyUp = (evt: KeyboardEvent) => {
    this.keys.delete(evt.code);
  };
}
