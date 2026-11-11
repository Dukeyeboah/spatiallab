/** Run with Node 22+: node scripts/labs/test-prod02b-avatar.mjs */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import * as THREE from "three";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "prod02b-test-"));
const repo = path.resolve(import.meta.dirname, "../..");
const realFetch = globalThis.fetch;
const fakeWindow = new EventTarget();
globalThis.window = fakeWindow;
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, init) {
    super(type);
    Object.assign(this, init);
  }
};
try {
  // Compile only the modules under test; no app build, browser, or extra dependencies.
  for (const [source, name] of [
    ["lib/labs/prod02b/avatarAssets.ts", "avatarAssets"],
    ["lib/labs/prod02b/orbAssistant.ts", "orbAssistant"],
    ["lib/labs/prod02b/grounding.ts", "grounding"],
    ["lib/labs/prod02b/visualAvatar.ts", "visualAvatar"],
    ["lib/labs/prod02a/smoothAvatarControls.ts", "smoothAvatarControls"],
  ]) {
    let js = ts.transpileModule(
      await fs.readFile(path.join(repo, source), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      },
    ).outputText;
    js = js
      .replaceAll("@/lib/labs/prod02b/avatarAssets", "./avatarAssets.mjs")
      .replaceAll("@/lib/labs/prod02b/orbAssistant", "./orbAssistant.mjs");
    js = js.replace(
      /from "(three[^\"]*)"/g,
      (_, name) => `from "${import.meta.resolve(name)}"`,
    );
    await fs.writeFile(path.join(temp, name + ".mjs"), js);
  }
  const { robotGroundProbe, robotGroundEyeY, robotStartPose } = await import(
    pathToFileURL(path.join(temp, "grounding.mjs"))
  );
  const eyeY = -3.21,
    eyeHeight = 1.28,
    floorY = eyeY - eyeHeight;
  const probe = robotGroundProbe(eyeY, eyeHeight);
  assert.ok(
    probe.originY < floorY + 0.3,
    "ground probe stays at feet instead of above head",
  );
  assert.ok(probe.maxDistance < 1.5, "probe cannot reach another storey");
  assert.equal(robotGroundEyeY(eyeY, eyeHeight, floorY), eyeY);
  for (const noise of [-0.014, -0.003, 0.002, 0.014])
    assert.equal(
      robotGroundEyeY(eyeY, eyeHeight, floorY + noise),
      eyeY,
      "scan noise does not shake the floor height",
    );
  assert.ok(
    Math.abs(robotGroundEyeY(eyeY, eyeHeight, floorY + 0.16) - (eyeY + 0.16)) <
      1e-6,
    "ordinary doorstep allowed",
  );
  assert.equal(
    robotGroundEyeY(eyeY, eyeHeight, floorY + 1.8),
    eyeY,
    "rough upper geometry rejected",
  );
  assert.equal(
    robotGroundEyeY(eyeY, eyeHeight, undefined),
    eyeY,
    "scan gap retains ground",
  );
  assert.equal(robotGroundEyeY(eyeY, eyeHeight, NaN), eyeY);
  assert.equal(
    robotGroundEyeY(eyeY, eyeHeight, floorY - 3),
    eyeY,
    "unbounded floor drop rejected",
  );
  const start = {
    eye: [4.02, -3.21, 7.02],
    target: [3.2, -3.4, 4.8],
    eyeHeight,
    source: "fallback",
  };
  const shifted = robotStartPose(start, true);
  assert.ok(
    Math.abs(
      Math.hypot(shifted.eye[0] - start.eye[0], shifted.eye[2] - start.eye[2]) -
        Math.hypot(2, 1.2),
    ) < 1e-6,
  );
  const dx = start.eye[0] - start.target[0],
    dz = start.eye[2] - start.target[2],
    len = Math.hypot(dx, dz);
  const sx = shifted.eye[0] - start.eye[0],
    sz = shifted.eye[2] - start.eye[2];
  assert.ok(
    Math.abs((sx * dx + sz * dz) / len - 2) < 1e-6,
    "two metres backwards",
  );
  assert.ok(
    Math.abs((-sx * dz + sz * dx) / len - 1.2) < 1e-6,
    "1.2 metres to the left of the table",
  );
  assert.equal(shifted.eye[1], start.eye[1]);
  assert.equal(robotStartPose(start, false), start, "upstairs start untouched");
  assert.deepEqual(
    start.eye,
    [4.02, -3.21, 7.02],
    "shared source pose untouched",
  );
  console.log(
    "PASS downstairs start setback, doorstep, upper-storey rejection, scan gaps and floor continuity",
  );
  const { VisualAvatar } = await import(
    pathToFileURL(path.join(temp, "visualAvatar.mjs"))
  );
  const { SmoothAvatarControls } = await import(
    pathToFileURL(path.join(temp, "smoothAvatarControls.mjs"))
  );

  // Load the actual new geometry, joints and all eight actions. Omit only the PNG
  // texture reference in Node (ImageBitmap is browser-only); geometry is unchanged.
  globalThis.fetch = async (request) => {
    const url = typeof request === "string" ? request : request.url;
    const name = url.split("/").at(-1);
    assert.ok(["walker.glb", "r01.glb"].includes(name));
    const b = await fs.readFile(
      path.join(repo, "public/labs/prod02b/avatars/robots", name),
    );
    const length = b.readUInt32LE(12);
    const json = JSON.parse(b.toString("utf8", 20, 20 + length));
    const bin = b.subarray(28 + length);
    assert.ok(b.length < 1_200_000, "asset budget");
    assert.deepEqual(
      json.animations.map((a) => a.name),
      ["Idle", "Walk", "Run"],
    );
    delete json.textures;
    delete json.images;
    json.materials.forEach((m) => {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.normalTexture;
    });
    json.buffers = [
      {
        byteLength: bin.length,
        uri: "data:application/octet-stream;base64," + bin.toString("base64"),
      },
    ];
    const encoded = new TextEncoder().encode(JSON.stringify(json));
    const padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4).fill(32);
    padded.set(encoded);
    const glb = Buffer.alloc(20 + padded.length);
    glb.write("glTF");
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(padded.length, 12);
    glb.write("JSON", 16);
    glb.set(padded, 20);
    return new Response(glb, {
      headers: { "Content-Type": "model/gltf-binary" },
    });
  };
  // GLTFLoader also fetches embedded buffers; preserve native fetch for data URIs.
  const assetFetch = globalThis.fetch;
  globalThis.fetch = (r, ...args) =>
    (typeof r === "string" ? r : r.url).startsWith("data:")
      ? realFetch(r, ...args)
      : assetFetch(r, ...args);
  // Browser-relative URLs need a base in Node's Request implementation.
  const RealRequest = globalThis.Request;
  globalThis.Request = class extends RealRequest {
    constructor(url, init) {
      super(
        typeof url === "string" && url.startsWith("/")
          ? "http://localhost" + url
          : url,
        init,
      );
    }
  };
  const avatar = new VisualAvatar();
  const pose = {
    body: new THREE.Vector3(),
    bodyYaw: 0,
    velocityX: 0,
    velocityZ: -1.1,
    speed: 1.1,
    movingInput: true,
    boomDistance: 2,
    grounded: true,
    sprinting: false,
  };
  for (const id of ["walker", "r01", "walker"]) {
    avatar.tuning.avatarId = id;
    await avatar.load();
    assert.equal(avatar.ready, true, avatar.getDebug().error);
    assert.equal(avatar.getDebug().avatarId, id);
    assert.ok(avatar.getDebug().walkBindings > 0, "animation tracks bind");
    assert.equal(avatar.root.children.length, 1, "switch releases old model");
    const idlePose = { ...pose, speed: 0, movingInput: false };
    avatar.tuning.scale = 1;
    avatar.update(0.016, idlePose);
    const fullHeight = new THREE.Box3()
      .setFromObject(avatar.root)
      .getSize(new THREE.Vector3()).y;
    for (const scale of [2 / 3, 0.5]) {
      avatar.tuning.scale = scale;
      avatar.update(0.016, idlePose);
      const height = new THREE.Box3()
        .setFromObject(avatar.root)
        .getSize(new THREE.Vector3()).y;
      assert.ok(
        Math.abs(height / fullHeight - scale) < 0.02,
        "size preset scales the real mesh",
      );
    }
    avatar.tuning.scale = 1;

    avatar.update(0.1, pose);
    assert.equal(avatar.getDebug().activeClip, "Walk");
    const bone =
      id === "walker"
        ? avatar.root.getObjectByName("thighl")
        : avatar.root.getObjectByName("HoverMotion");
    assert.ok(bone, "animated node exists");
    const q = bone.quaternion.clone(),
      pos = bone.position.clone();
    avatar.update(0.2, pose);
    assert.ok(
      q.angleTo(bone.quaternion) > 0.001 ||
        pos.distanceTo(bone.position) > 0.001,
      "movement changes actual rig",
    );
    avatar.update(0.1, { ...pose, sprinting: true });
    assert.equal(
      avatar.getDebug().activeClip,
      "Run",
      "Shift chooses a dedicated robot Run",
    );
    const bounds = new THREE.Box3().setFromObject(avatar.root);
    assert.ok(
      Number.isFinite(bounds.max.y) && bounds.max.y - bounds.min.y < 2,
      "no exploded skin",
    );
    let alpha = false;
    avatar.root.traverse((o) => {
      if (o.isMesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m.transparent) alpha = true;
    });
    assert.ok(alpha, "logo alpha survives material conversion");
    if (id === "walker") {
      avatar.mixer.stopAllAction();
      const action = avatar.actions.Walk;
      action.reset().setEffectiveWeight(1).play();
      action.setEffectiveTimeScale(1);
      const frames = [];
      for (let i = 0; i <= 34; i++) {
        avatar.mixer.setTime(i / 24);
        avatar.root.updateMatrixWorld(true);
        frames.push(
          ["legl", "legr"].map((name) =>
            avatar.root
              .getObjectByName(name)
              .getWorldPosition(new THREE.Vector3()),
          ),
        );
      }
      const means = [];
      for (let f = 0; f < 2; f++) {
        const min = Math.min(...frames.map((p) => p[f].y)),
          speeds = [];
        for (let i = 1; i < 34; i++)
          if (frames[i][f].y < min + 0.045 && frames[i - 1][f].y < min + 0.045)
            speeds.push((frames[i][f].z - frames[i - 1][f].z) * 24);
        assert.ok(speeds.length >= 8, "measurable grounded support phase");
        const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        assert.ok(
          mean > 0.45 && mean < 0.8,
          "support foot moves against forward travel at source cadence",
        );
        means.push(mean);
      }
      assert.ok(
        Math.abs(means[0] - means[1]) < 0.03,
        "both support feet travel in the same direction and cadence",
      );
    }
  }
  avatar.dispose();
  console.log(
    "PASS both real rigs, animation bindings, motion, size budgets, logo alpha and repeated switching",
  );

  const dom = Object.assign(new EventTarget(), {
    style: {},
    contains: () => false,
  });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.5, 2);
  const controller = new SmoothAvatarControls(camera, dom);
  controller.enabled = true;
  controller.gameLocomotion = true;
  controller.setPose(
    new THREE.Vector3(0, 1.5, 0),
    new THREE.Vector3(0, 1.5, -1),
  );
  controller.resolveCollision = (_, to) => new THREE.Vector3(to.x, 1.5, to.z);
  const key = (type, code, repeat = false) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, {
      code: { value: code },
      repeat: { value: repeat },
    });
    fakeWindow.dispatchEvent(event);
    return event;
  };
  const step = (n) => {
    for (let i = 0; i < n; i++) controller.update(1 / 60);
  };
  key("keydown", "KeyW");
  step(60);
  const walkSpeed = Math.hypot(...controller.getDebugSnapshot().velocity);
  controller.allowSprint = false;
  key("keydown", "ShiftLeft");
  step(60);
  assert.ok(
    Math.abs(
      Math.hypot(...controller.getDebugSnapshot().velocity) - walkSpeed,
    ) < 0.01,
    "robot Shift does not accelerate",
  );
  controller.allowSprint = true;
  step(60);
  assert.ok(
    Math.hypot(...controller.getDebugSnapshot().velocity) > walkSpeed * 1.6,
  );
  key("keydown", "KeyD");
  step(60);
  assert.ok(
    Math.hypot(...controller.getDebugSnapshot().velocity) <= 2.45 * 1.7 + 0.001,
    "diagonal speed capped",
  );
  key("keyup", "KeyD");
  assert.equal(key("keydown", "Space").defaultPrevented, true);
  const oldCameraY = camera.position.y;
  step(1);
  assert.equal(controller.getDebugSnapshot().jumpPhase, "takeoff");
  assert.equal(
    controller.getDebugSnapshot().jumpHeight,
    0,
    "anticipation stays grounded",
  );
  step(19);
  assert.equal(controller.getDebugSnapshot().grounded, false);
  assert.ok(controller.body.y > 0.5);
  assert.ok(
    camera.position.y > oldCameraY + 0.1,
    "camera follows airborne body",
  );
  key("keydown", "Space", true);
  step(100);
  assert.equal(
    controller.getDebugSnapshot().grounded,
    true,
    "holding Space must not auto-bounce",
  );
  assert.ok(
    Math.abs(controller.body.y) < 0.001,
    "land exactly on resolved floor",
  );
  key("keyup", "Space");
  key("keydown", "Space");
  step(10);
  controller.setPose(
    new THREE.Vector3(0, 4.5, 0),
    new THREE.Vector3(0, 4.5, -1),
  );
  assert.equal(
    controller.getDebugSnapshot().jumpHeight,
    0,
    "teleport clears jump",
  );
  controller.resolveCollision = (_, to) => new THREE.Vector3(to.x, 4.5, to.z);
  controller.resolveJumpRise = () => 0;
  key("keydown", "Space");
  step(10);
  assert.equal(
    controller.getDebugSnapshot().jumpHeight,
    0,
    "ceiling blocks jump rise",
  );
  assert.equal(controller.getDebugSnapshot().jumpPhase, "landing");
  controller.resolveJumpRise = null;
  key("keydown", "KeyW");
  key("keydown", "ShiftLeft");
  step(30);
  fakeWindow.dispatchEvent(new Event("blur"));
  step(100);
  assert.ok(
    Math.hypot(...controller.getDebugSnapshot().velocity) < 0.001,
    "blur releases input",
  );
  key("keydown", "KeyQ");
  step(20);
  assert.ok(controller.getDebugSnapshot().bodyYaw > 0.5, "Q turns body");
  key("keyup", "KeyQ");
  controller.gameLocomotion = false;
  key("keydown", "Space");
  step(20);
  assert.equal(
    controller.getDebugSnapshot().jumpHeight,
    0,
    "other labs do not gain jumps",
  );
  controller.dispose();

  const orbCamera = new THREE.PerspectiveCamera(65, 16 / 9, 0.01, 100);
  const orb = new SmoothAvatarControls(orbCamera, dom);
  orb.enabled = true;
  orb.gameLocomotion = true;
  orb.cameraFocusHeight = 0.374;
  orb.cameraFocusRadius = 0.183;
  orb.tuning.preferredDistance = 2.8;
  orb.tuning.targetHeight = 1.0;
  orb.resolveCollision = (_, to) => new THREE.Vector3(to.x, 1.5, to.z);
  let tick = 0,
    clear = false,
    calls = 0;
  orb.resolveCameraBoom = (from, to) => {
    calls++;
    const hit = !clear && tick % 2 === 0;
    return {
      hit,
      safeDistance: hit ? 0.65 : from.distanceTo(to),
      safePoint: to.clone(),
      hitPoint: null,
    };
  };
  orb.setPose(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1.5, -1));
  const distances = [];
  calls = 0;
  for (tick = 0; tick < 120; tick++) {
    orb.update(1 / 60);
    distances.push(orb.getDebugSnapshot().boomDistance);
  }
  assert.ok(
    Math.max(...distances) - Math.min(...distances) < 0.002,
    "alternating wall hits do not pump the camera",
  );
  assert.equal(
    calls,
    120,
    "game camera uses one authoritative boom probe per frame",
  );
  clear = true;
  for (let i = 0; i < 180; i++) orb.update(1 / 60);
  assert.ok(
    orb.getDebugSnapshot().boomDistance > 2.79,
    "camera expands after sustained clearance",
  );
  orb.resolveCameraBoom = (_, to) => ({
    hit: true,
    safeDistance: 0.5,
    safePoint: to.clone(),
    hitPoint: null,
  });
  orb.update(1 / 60);
  assert.ok(
    orb.getDebugSnapshot().boomDistance <= 0.381,
    "new obstruction contracts immediately",
  );
  for (const scale of [1, 1.2, 1.5]) {
    orb.cameraFocusHeight = 0.27 * scale + 0.05;
    orb.cameraFocusRadius = 0.14 * scale + 0.015;
    for (const pitch of [-0.42, 0, 0.55]) {
      orb.camPitch = pitch;
      key("keydown", "KeyS");
      key("keydown", "ShiftLeft");
      for (let i = 0; i < 60; i++) {
        orb.update(1 / 60);
        orbCamera.updateMatrixWorld(true);
        const center = orb.body
          .clone()
          .add(new THREE.Vector3(0, orb.cameraFocusHeight, 0));
        const local = center.clone().applyMatrix4(orbCamera.matrixWorldInverse);
        const screen = center.project(orbCamera);
        assert.ok(
          local.z < 0,
          "reversing cannot leave Orb behind close camera " +
            JSON.stringify({
              scale,
              pitch,
              i,
              local: local.toArray(),
              body: orb.body.toArray(),
              cam: orbCamera.position.toArray(),
              euler: orb.euler.toArray(),
              debug: orb.getDebugSnapshot(),
            }),
        );
        assert.ok(
          Math.abs(screen.y) < 0.85,
          "Orb remains framed at close range and mouse-pitch limits",
        );
      }
      key("keyup", "KeyS");
      key("keyup", "ShiftLeft");
    }
  }
  orb.resolveCameraBoom = (_, to) => ({
    hit: true,
    safeDistance: 0.2,
    safePoint: to.clone(),
    hitPoint: null,
  });
  orb.update(1 / 60);
  assert.ok(
    orb.getDebugSnapshot().boomDistance <= 0.081,
    "zoom minimum cannot force camera through a closer wall",
  );
  key("keydown", "KeyS");
  for (let i = 0; i < 60; i++) {
    orb.update(1 / 60);
    orbCamera.updateMatrixWorld(true);
    const center = orb.body.clone().add(new THREE.Vector3(0, orb.cameraFocusHeight, 0));
    assert.ok(center.clone().applyMatrix4(orbCamera.matrixWorldInverse).z < 0, "Orb stays in front even below normal zoom minimum");
    assert.ok(Math.abs(center.project(orbCamera).y) < 0.85, "very close wall framing remains valid during reverse travel");
  }
  key("keyup", "KeyS");
  orb.dispose();
  console.log(
    "PASS camera obstruction chatter/release, immediate safety, bounded probe count and Orb framing at all three scales while reversing",
  );
  console.log(
    "PASS sprint, diagonal speed, jump/landing, follow camera, repeat guard, teleport, ceiling, blur, Q turn, opt-in isolation",
  );
} finally {
  globalThis.fetch = realFetch;
  await fs.rm(temp, { recursive: true, force: true });
}
