import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const repo = path.resolve(import.meta.dirname, "../..");
const file = path.join(
  repo,
  "public/labs/prod02b/avatars/robots/spatial-orb-assistant-v1.1.glb",
);
const bytes = await fs.readFile(file),
  length = bytes.readUInt32LE(12),
  json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
assert.ok(
  !json.skins?.length && !json.animations?.length,
  "no bones or baked animation",
);
assert.ok(!json.images?.length && !json.textures?.length, "no texture maps");
assert.ok(
  !json.cameras?.length &&
    !json.extensionsUsed?.includes("KHR_lights_punctual"),
  "studio excluded",
);
assert.equal(json.materials.length, 4);
assert.ok(json.meshes.length < 15);
const triangles = json.meshes.reduce(
  (sum, m) =>
    sum +
    m.primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0),
  0,
);
assert.ok(triangles <= 5000);
assert.ok(bytes.length < 120000);
assert.ok(
  !json.nodes.some((n) =>
    /Ground|STUDIO|core|armature|hand|leg/i.test(n.name ?? ""),
  ),
  "no hidden assembly or ground glow inside GLB",
);
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
const body = gltf.scene.getObjectByName("BodyShell");
assert.ok(body);
const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3());
assert.ok(
  Math.abs(size.x - 0.24) < 1e-5 && Math.abs(size.y - 0.24) < 1e-5,
  "actual 24 cm body",
);
assert.equal(gltf.scene.getObjectByName("VisualRoot").parent.name, "ORB_ROOT");
for (const side of ["L", "R"])
  assert.equal(
    gltf.scene.getObjectByName("Fin_" + side).parent.name,
    "FinPivot_" + side,
  );
for (const side of ["L", "R"]) {
  const materials = [];
  gltf.scene.getObjectByName("Eye_" + side).traverse((node) => {
    if (node.isMesh)
      materials.push(
        ...(Array.isArray(node.material) ? node.material : [node.material]),
      );
  });
  assert.ok(
    materials.some(
      (m) => m.emissiveIntensity >= 1.8 && m.emissive.getHex() !== 0,
    ),
    "rings self-illuminate",
  );
  assert.ok(
    materials.some((m) => m.emissive.getHex() === 0),
    "dark lens and non-emissive highlight",
  );
}
// The original V1 remains a byte-identical fallback; V1.1 retains named parents.
const fallbackBytes = await fs.readFile(file.replace("v1.1.glb", "v1.glb"));
const fallback = await new GLTFLoader().parseAsync(
  fallbackBytes.buffer.slice(
    fallbackBytes.byteOffset,
    fallbackBytes.byteOffset + fallbackBytes.byteLength,
  ),
  "",
);
for (const name of ["ORB_ROOT", "VisualRoot", "FinPivot_L", "FinPivot_R"]) {
  const original = fallback.scene.getObjectByName(name),
    refined = gltf.scene.getObjectByName(name);
  assert.ok(original && refined);
  if (name !== "ORB_ROOT")
    assert.equal(refined.parent.name, original.parent.name);
  assert.deepEqual(refined.position.toArray(), original.position.toArray());
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "orb-test-"));
const realFetch = globalThis.fetch,
  RealRequest = globalThis.Request;
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, init) {
    super(type);
    Object.assign(this, init);
  }
};
try {
  for (const name of ["avatarAssets", "orbAssistant", "visualAvatar"]) {
    let js = ts.transpileModule(
      await fs.readFile(
        path.join(repo, "lib/labs/prod02b/" + name + ".ts"),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      },
    ).outputText;
    js = js
      .replaceAll("@/lib/labs/prod02b/avatarAssets", "./avatarAssets.mjs")
      .replaceAll("@/lib/labs/prod02b/orbAssistant", "./orbAssistant.mjs")
      .replace(
        /from "(three[^\"]*)"/g,
        (_, id) => `from "${import.meta.resolve(id)}"`,
      );
    await fs.writeFile(path.join(temp, name + ".mjs"), js);
  }
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
  globalThis.fetch = async (request) => {
    const url = typeof request === "string" ? request : request.url;
    assert.ok(url.endsWith("spatial-orb-assistant-v1.1.glb"));
    return new Response(bytes, {
      headers: { "Content-Type": "model/gltf-binary" },
    });
  };
  const { VisualAvatar } = await import(
    pathToFileURL(path.join(temp, "visualAvatar.mjs"))
  );
  const avatar = new VisualAvatar();
  avatar.tuning.avatarId = "orb";
  avatar.tuning.scale = 1;
  await avatar.load();
  assert.equal(avatar.ready, true, avatar.getDebug().error);
  const pose = {
    body: new THREE.Vector3(2, 3, 4),
    groundY: 3,
    bodyYaw: 0,
    velocityX: 0,
    velocityZ: 0,
    speed: 0,
    movingInput: false,
    boomDistance: 2,
    grounded: true,
    sprinting: false,
  };
  avatar.update(0.016, pose);
  avatar.root.updateMatrixWorld(true);
  const root = avatar.root.getObjectByName("ORB_ROOT"),
    visual = avatar.root.getObjectByName("VisualRoot"),
    fin = avatar.root.getObjectByName("FinPivot_L"),
    glow = avatar.root.getObjectByName("OrbGroundProjection");
  assert.ok(
    glow && !root.getObjectByName("OrbGroundProjection"),
    "ground glow is outside GLB hierarchy",
  );
  const position = avatar.root.position.clone(),
    initialFin = fin.rotation.z,
    initialY = visual.position.y;
  for (let i = 0; i < 60; i++) avatar.update(1 / 60, pose);
  assert.ok(
    Math.abs(fin.rotation.z - initialFin) > 0.005 &&
      Math.abs(visual.position.y - initialY) > 0.005,
    "actual exported fin pivots and VisualRoot animate",
  );
  assert.deepEqual(
    avatar.root.position.toArray(),
    position.toArray(),
    "bobbing never moves navigation root",
  );
  assert.equal(root.position.length(), 0);
  avatar.update(0.016, {
    ...pose,
    body: new THREE.Vector3(2, 3.5, 4),
    grounded: false,
  });
  avatar.root.updateMatrixWorld(true);
  assert.ok(
    Math.abs(glow.getWorldPosition(new THREE.Vector3()).y - 3.006) < 1e-5,
    "projection stays on ground during jump",
  );
  avatar.update(0.016, {
    ...pose,
    body: new THREE.Vector3(2, 7, 4),
    groundY: 7,
  });
  avatar.root.updateMatrixWorld(true);
  assert.ok(
    Math.abs(glow.getWorldPosition(new THREE.Vector3()).y - 7.006) < 1e-5,
    "projection follows a new floor",
  );
  // Scale and hover offsets must never lift the independently grounded marker.
  for (const scale of [1, 1.2, 1.5]) {
    avatar.tuning.scale = scale;
    avatar.tuning.verticalOffset = 0.035;
    avatar.update(0.016, {
      ...pose,
      body: new THREE.Vector3(2, 3.5, 4),
      groundY: 3,
    });
    avatar.root.updateMatrixWorld(true);
    assert.ok(
      Math.abs(glow.getWorldPosition(new THREE.Vector3()).y - 3.006) < 1e-5,
      "scale/hover/offset never lift floor glow",
    );
    assert.ok(
      Math.abs(avatar.root.position.y - 3.585) < 1e-5,
      "Orb gains a 5cm hover lift independently of scale",
    );
  }
  avatar.tuning.visible = false;
  avatar.update(0.016, pose);
  assert.equal(avatar.root.visible, false);
  assert.deepEqual(pose.body.toArray(), [2, 3, 4]);
  let geometryDisposed = false,
    materialDisposed = false;
  glow.geometry.addEventListener("dispose", () => (geometryDisposed = true));
  glow.material.addEventListener("dispose", () => (materialDisposed = true));
  avatar.dispose();
  assert.ok(
    geometryDisposed && materialDisposed,
    "projection resources released",
  );
  assert.equal(avatar.root.children.length, 0);
  console.log(
    `PASS Orb GLB: ${triangles} triangles, ${json.meshes.length} meshes, 4 materials, ${bytes.length} bytes; 24cm body, hierarchy, emission, real fin motion, stable navigation root, grounded projection and disposal`,
  );
} finally {
  globalThis.fetch = realFetch;
  globalThis.Request = RealRequest;
  await fs.rm(temp, { recursive: true, force: true });
}
