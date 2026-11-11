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
    assert.equal(name, "spatial-house-avatar.glb");
    const b = await fs.readFile(
      path.join(repo, "public/labs/prod02b/avatars", name),
    );
    const length = b.readUInt32LE(12);
    const json = JSON.parse(b.toString("utf8", 20, 20 + length));
    const bin = b.subarray(28 + length);
    assert.equal(
      json.meshes[0].primitives.length,
      5,
      "five draw calls per character",
    );
    assert.equal(json.skins[0].joints.length, 65, "same original rig");
    assert.equal(json.images.length, 1, "one embedded atlas");
    assert.ok(b.length < 1_500_000, "asset size budget");
    delete json.textures;
    delete json.images;
    json.materials.forEach((m) => {
      delete m.pbrMetallicRoughness.baseColorTexture;
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
  await avatar.load();
  assert.equal(avatar.ready, true, avatar.getDebug().error);
  assert.ok(
    avatar.getDebug().walkBindings > 40,
    "real skeleton tracks must bind",
  );
  const clips = avatar.getDebug().inspections;
  assert.ok(
    clips.find((c) => c.suggestedRole === "Walk").duration < 1.1,
    "select walk, not accumulated 6s idle",
  );
  assert.deepEqual(
    clips.map((c) => c.name),
    [
      "Idle",
      "Walk",
      "Run",
      "JumpStart",
      "Jump",
      "Land",
      "TurnLeft",
      "TurnRight",
    ],
  );
  assert.notEqual(
    clips.find((c) => c.name === "Run").duration,
    clips.find((c) => c.name === "Walk").duration,
  );
  const bounds = new THREE.Box3().setFromObject(avatar.root);
  assert.ok(
    Math.abs(bounds.max.y - bounds.min.y - 1.75) < 0.01,
    "human height in metres",
  );
  const head = avatar.root.getObjectByName("mixamorigHead");
  assert.ok(
    head.getWorldPosition(new THREE.Vector3()).y > 1.4,
    "head proportion after mesh edit",
  );
  const pose = {
    body: new THREE.Vector3(),
    bodyYaw: 0,
    velocityX: 0,
    velocityZ: -2.45,
    speed: 2.45,
    movingInput: true,
    boomDistance: 2,
    grounded: true,
    sprinting: false,
  };
  const bone = avatar.root.getObjectByName("mixamorigLeftUpLeg");
  assert.ok(bone);
  avatar.update(0.1, pose);
  const a = bone.quaternion.clone();
  avatar.update(0.2, pose);
  assert.ok(
    a.angleTo(bone.quaternion) > 0.05,
    "walk must actually change the leg pose",
  );
  assert.equal(avatar.getDebug().activeClip, "Walk");
  avatar.update(0.1, { ...pose, sprinting: true, speed: 4.1 });
  assert.equal(avatar.getDebug().activeClip, "Run");
  avatar.update(0.1, { ...pose, jumpPhase: "takeoff" });
  assert.equal(avatar.getDebug().activeClip, "JumpStart");
  avatar.update(0.1, { ...pose, grounded: false, jumpPhase: "airborne" });
  assert.equal(avatar.getDebug().activeClip, "Jump");
  avatar.update(0.1, { ...pose, jumpPhase: "landing" });
  assert.equal(avatar.getDebug().activeClip, "Land");
  for (let i = 0; i < 60; i++)
    avatar.update(1 / 60, { ...pose, speed: 0, movingInput: false });
  assert.equal(avatar.getDebug().activeClip, "Idle");
  avatar.dispose();
  console.log(
    "PASS real geometry, original 65-joint rig, 5 draws, size/height budgets, named clips, leg movement, Run → Takeoff → Airborne → Land → Idle",
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
  key("keydown", "ShiftLeft");
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
  console.log(
    "PASS sprint, diagonal speed, jump/landing, follow camera, repeat guard, teleport, ceiling, blur, Q turn, opt-in isolation",
  );
} finally {
  globalThis.fetch = realFetch;
  await fs.rm(temp, { recursive: true, force: true });
}
