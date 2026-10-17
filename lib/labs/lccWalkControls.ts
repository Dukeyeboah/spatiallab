import * as THREE from "three";

export type WalkCollisionResolve = (
  from: THREE.Vector3,
  to: THREE.Vector3,
) => THREE.Vector3;

/**
 * First-person walk for LCC tours (LAB EXP-02).
 * WASD / arrows on XZ; look via drag or pointer-lock; Shift sprint; Esc exits lock.
 */
export class LccWalkControls {
  enabled = false;
  /** Base walk speed (m/s). */
  movementSpeed = 2.8;
  /** Sprint multiplier when Shift held. */
  sprintMultiplier = 1.85;
  lookSpeed = 0.0022;
  /** Eye height above “feet” for floor following (metres). */
  eyeHeight = 1.55;
  /** Keep camera Y stable unless collision resolver adjusts floor. */
  lockEyeHeight = true;

  /** Optional collision / floor resolver applied after wish movement. */
  resolveCollision: WalkCollisionResolve | null = null;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly keys = new Set<string>();
  private dragging = false;
  private pointerLocked = false;
  private prevX = 0;
  private prevY = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly next = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly accel = 18;
  private readonly friction = 14;

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
    if (!this.enabled) return;
    const dt = Math.min(0.05, Math.max(0, delta));

    this.euler.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(this.euler);

    this.wish.set(0, 0, 0);
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.wish.z -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.wish.z += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.wish.x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.wish.x += 1;

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
    if (this.wish.lengthSq() > 0) {
      this.wish.normalize();
      // W → move along look forward (wish.z is -1 for W)
      this.desired.addScaledVector(this.forward, -this.wish.z * speed);
      this.desired.addScaledVector(this.right, this.wish.x * speed);
    }

    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, this.desired.x, this.wish.lengthSq() > 0 ? this.accel : this.friction, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, this.desired.z, this.wish.lengthSq() > 0 ? this.accel : this.friction, dt);
    this.velocity.y = 0;

    if (this.velocity.lengthSq() < 1e-10 && this.desired.lengthSq() < 1e-10) return;

    const from = this.camera.position;
    this.next.set(from.x + this.velocity.x * dt, from.y, from.z + this.velocity.z * dt);
    if (this.lockEyeHeight) this.next.y = from.y;

    if (this.resolveCollision) {
      const resolved = this.resolveCollision(from, this.next);
      // Only kill velocity on axes that were hard-blocked (almost no progress)
      const dx = resolved.x - from.x;
      const dz = resolved.z - from.z;
      const wantX = this.next.x - from.x;
      const wantZ = this.next.z - from.z;
      if (Math.abs(wantX) > 1e-5 && Math.abs(dx) < Math.abs(wantX) * 0.05) this.velocity.x = 0;
      if (Math.abs(wantZ) > 1e-5 && Math.abs(dz) < Math.abs(wantZ) * 0.05) this.velocity.z = 0;
      this.camera.position.copy(resolved);
    } else {
      this.camera.position.copy(this.next);
    }
  }

  dispose() {
    this.exitPointerLock();
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
    try {
      this.dom.focus({ preventScroll: true });
    } catch {
      this.dom.focus();
    }
    // Double-click requests pointer lock for immersive look; single drag still works.
    if (evt.detail >= 2) void this.requestPointerLock();
    this.dragging = true;
    this.prevX = evt.clientX;
    this.prevY = evt.clientY;
    try {
      this.dom.setPointerCapture(evt.pointerId);
    } catch {
      /* ignore */
    }
  };

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
