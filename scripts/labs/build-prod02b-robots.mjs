/** Node 22+. Native Blender samples preserve the original constrained walk.
 * Rebuild from the sampled fixture + the user-supplied R01 FBX and original mark.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import * as T from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
const repo = path.resolve(import.meta.dirname, "../.."),
  out = path.join(repo, "public/labs/prod02b/avatars/robots");
fs.mkdirSync(out, { recursive: true });
const mark = fs.readFileSync(
  process.argv[3] ??
    path.join(repo, "../SpatialHouse/public/images/brand/mark.png"),
);
const source = JSON.parse(
  zlib.gunzipSync(
    fs.readFileSync(
      path.join(import.meta.dirname, "robot-sources/walker-sampled.json.gz"),
    ),
  ),
);
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z),
  Q = () => new T.Quaternion();
function glb(j, bin) {
  const raw = Buffer.from(JSON.stringify(j)),
    json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)]),
    bb = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]),
    b = Buffer.alloc(28 + json.length + bb.length);
  b.write("glTF");
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(json.length, 12);
  b.write("JSON", 16);
  json.copy(b, 20);
  b.writeUInt32LE(bb.length, 20 + json.length);
  b.write("BIN\0", 24 + json.length);
  bb.copy(b, 28 + json.length);
  return b;
}
function writer(j, initial = Buffer.alloc(0)) {
  const parts = [initial];
  let size = initial.length;
  return {
    bytes(b) {
      const pad = (4 - (size % 4)) % 4;
      if (pad) {
        parts.push(Buffer.alloc(pad));
        size += pad;
      }
      const index =
        j.bufferViews.push({
          buffer: 0,
          byteOffset: size,
          byteLength: b.length,
        }) - 1;
      parts.push(b);
      size += b.length;
      return index;
    },
    access(a, type, componentType = 5126, target, normalized = false) {
      const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type],
        view = this.bytes(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      if (target) j.bufferViews[view].target = target;
      const index =
        j.accessors.push({
          bufferView: view,
          componentType,
          type,
          count: a.length / width,
          ...(normalized ? { normalized: true } : {}),
        }) - 1;
      if (type === "VEC3" || type === "SCALAR") {
        j.accessors[index].min = Array.from({ length: width }, (_, k) => {
          let v = Infinity;
          for (let i = k; i < a.length; i += width) v = Math.min(v, a[i]);
          return v;
        });
        j.accessors[index].max = Array.from({ length: width }, (_, k) => {
          let v = -Infinity;
          for (let i = k; i < a.length; i += width) v = Math.max(v, a[i]);
          return v;
        });
      }
      return index;
    },
    finish() {
      for (const node of j.nodes ?? [])
        if (node.children?.length === 0) delete node.children;
      j.buffers = [{ byteLength: size }];
      return glb(j, Buffer.concat(parts));
    },
  };
}
function logoMaterial(j, w) {
  j.images ??= [];
  j.textures ??= [];
  const image =
    j.images.push({
      bufferView: w.bytes(mark),
      mimeType: "image/png",
      name: "Spatial House original mark",
    }) - 1;
  const tex = j.textures.push({ source: image }) - 1;
  return (
    j.materials.push({
      name: "Spatial House logo",
      alphaMode: "BLEND",
      doubleSided: false,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: tex },
        metallicFactor: 0,
        roughnessFactor: 0.55,
      },
    }) - 1
  );
}
function logoGeometry(
  worldPositions,
  triangles,
  height,
  centerY,
  width,
  worldToLocal = new T.Matrix4(),
  side = 1,
) {
  const box = new T.Box3().setFromPoints(worldPositions),
    originZ = side === 1 ? box.max.z + height : box.min.z - height,
    ray = new T.Ray(),
    a = V(),
    b = V(),
    c = V(),
    hit = V(),
    positions = [],
    normals = [],
    uv = [],
    indices = [];
  const normalMatrix = new T.Matrix3().getNormalMatrix(worldToLocal),
    grid = 5;
  for (let row = 0; row <= grid; row++)
    for (let col = 0; col <= grid; col++) {
      const x = box.getCenter(V()).x + (col / grid - 0.5) * width * side,
        y = centerY + ((row / grid - 0.5) * width * 680) / 619;
      ray.set(V(x, y, originZ), V(0, 0, -side));
      let best = null,
        normal = V(0, 0, side),
        distance = Infinity;
      for (const t of triangles) {
        a.copy(worldPositions[t[0]]);
        b.copy(worldPositions[t[1]]);
        c.copy(worldPositions[t[2]]);
        if (ray.intersectTriangle(a, b, c, false, hit)) {
          const d = ray.origin.distanceToSquared(hit);
          if (d < distance) {
            distance = d;
            best = hit.clone();
            normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
            if (normal.z * side < 0) normal.negate();
          }
        }
      }
      const p = (best ?? V(x, y, side === 1 ? box.max.z : box.min.z))
        .addScaledVector(normal, height * 0.0015)
        .applyMatrix4(worldToLocal);
      normal.applyMatrix3(normalMatrix).normalize();
      positions.push(...p);
      normals.push(...normal);
      uv.push(col / grid, 1 - row / grid);
    }
  for (let r = 0; r < grid; r++)
    for (let c = 0; c < grid; c++) {
      const i = r * (grid + 1) + c;
      indices.push(i, i + 1, i + grid + 2, i, i + grid + 2, i + grid + 1);
    }
  return { positions, normals, uv, indices };
}
function twoSidedLogos(
  points,
  triangles,
  height,
  centerY,
  width,
  transform = new T.Matrix4(),
) {
  const front = logoGeometry(
    points,
    triangles,
    height,
    centerY,
    width,
    transform,
    1,
  );
  const back = logoGeometry(
    points,
    triangles,
    height,
    centerY,
    width,
    transform,
    -1,
  );
  const offset = front.positions.length / 3;
  return {
    positions: [...front.positions, ...back.positions],
    normals: [...front.normals, ...back.normals],
    uv: [...front.uv, ...back.uv],
    indices: [...front.indices, ...back.indices.map((i) => i + offset)],
  };
}
// The .blend source uses Z-up; store a standard Y-up metre rig and inverse binds.
const C = new T.Matrix4().makeRotationX(-Math.PI / 2),
  meshMatrix = C.clone().multiply(new T.Matrix4().set(...source.meshMatrix));
const world = source.positions.map((p) =>
    V().fromArray(p).applyMatrix4(meshMatrix),
  ),
  box = new T.Box3().setFromPoints(world),
  origin = V(0, box.min.y, 0),
  scale = 1.65 / (box.max.y - box.min.y);
world.forEach((p) => p.sub(origin).multiplyScalar(scale));
function normalized(m) {
  const matrix = C.clone().multiply(new T.Matrix4().set(...m)),
    p = V(),
    q = Q(),
    s = V();
  matrix.decompose(p, q, s);
  return new T.Matrix4().compose(
    p.sub(origin).multiplyScalar(scale),
    q.normalize(),
    V(1, 1, 1),
  );
}
const names = source.bones.map((b) => b.name),
  boneIndex = new Map(names.map((n, i) => [n, i])),
  rest = source.bones.map((b) => normalized(b.matrix));
const nodes = source.bones.map((b, i) => {
  const parent = boneIndex.get(b.parent),
    local = (
      parent === undefined ? new T.Matrix4() : rest[parent].clone().invert()
    ).multiply(rest[i]),
    p = V(),
    q = Q(),
    s = V();
  local.decompose(p, q, s);
  return {
    name: b.name,
    translation: p.toArray(),
    rotation: q.toArray(),
    children: [],
  };
});
source.bones.forEach((b, i) => {
  const p = boneIndex.get(b.parent);
  if (p !== undefined) nodes[p].children.push(i);
});
const armature =
  nodes.push({
    name: "WalkerRig",
    children: source.bones.flatMap((b, i) => (b.parent ? [] : [i])),
  }) - 1;
const j = {
    asset: {
      version: "2.0",
      generator: "SpatialLab native Blender walk samples",
    },
    scene: 0,
    scenes: [{ nodes: [armature] }],
    nodes,
    meshes: [],
    skins: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    animations: [],
  },
  w = writer(j);
j.skins = [
  {
    joints: names.map((_, i) => i),
    skeleton: armature,
    inverseBindMatrices: w.access(
      Float32Array.from(rest.flatMap((m) => m.clone().invert().elements)),
      "MAT4",
    ),
  },
];
for (const [name, color, metal, rough] of [
  ["Porcelain shell", "#f4f1eb", 0.15, 0.32],
  ["Charcoal joints", "#292723", 0.35, 0.4],
  ["Bronze panels", "#7a5a34", 0.45, 0.3],
])
  j.materials.push({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: new T.Color(color).toArray().concat(1),
      metallicFactor: metal,
      roughnessFactor: rough,
    },
  });
const groups = [[], [], []],
  pos = [],
  normals = [],
  skin = [],
  weights = [];
const nm = new T.Matrix3().getNormalMatrix(meshMatrix);
for (const t of source.triangles) {
  const cat = source.materials[t.material]?.includes("Plastic")
    ? 1
    : source.materials[t.material]?.includes("vinyl")
      ? 2
      : 0;
  for (let k = 0; k < 3; k++) {
    const id = t.vertices[k],
      index = pos.length / 3;
    pos.push(...world[id]);
    normals.push(...V().fromArray(t.normals[k]).applyMatrix3(nm).normalize());
    const influences = source.weights[id]
      .map(([g, weight]) => [boneIndex.get(source.groups[g]), weight])
      .filter(([b, weight]) => b !== undefined && weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    while (influences.length < 4) influences.push([0, 0]);
    const sum = influences.reduce((s, x) => s + x[1], 0) || 1;
    skin.push(...influences.map((x) => x[0]));
    weights.push(...influences.map((x) => x[1] / sum));
    groups[cat].push(index);
  }
}
const attrs = {
  POSITION: w.access(Float32Array.from(pos), "VEC3", 5126, 34962),
  NORMAL: w.access(Float32Array.from(normals), "VEC3", 5126, 34962),
  JOINTS_0: w.access(Uint16Array.from(skin), "VEC4", 5123, 34962),
  WEIGHTS_0: w.access(Float32Array.from(weights), "VEC4", 5126, 34962),
};
j.meshes = [
  {
    name: "Original walking robot",
    primitives: groups.map((indices, material) => ({
      attributes: attrs,
      indices: w.access(Uint16Array.from(indices), "SCALAR", 5123, 34963),
      material,
    })),
  },
];
j.scenes[0].nodes.push(
  nodes.push({ name: "WalkerShell", mesh: 0, skin: 0 }) - 1,
);
const chest = boneIndex.get("Chest"),
  badge = twoSidedLogos(
    world,
    source.triangles.map((t) => t.vertices),
    1.65,
    rest[chest].elements[13] + 0.01,
    0.12,
    rest[chest].clone().invert(),
  ),
  badgeMaterial = logoMaterial(j, w);
j.meshes.push({
  name: "Spatial House front and back badges",
  primitives: [
    {
      attributes: {
        POSITION: w.access(
          Float32Array.from(badge.positions),
          "VEC3",
          5126,
          34962,
        ),
        NORMAL: w.access(Float32Array.from(badge.normals), "VEC3", 5126, 34962),
        TEXCOORD_0: w.access(Float32Array.from(badge.uv), "VEC2", 5126, 34962),
      },
      indices: w.access(Uint16Array.from(badge.indices), "SCALAR", 5123, 34963),
      material: badgeMaterial,
    },
  ],
});
nodes[chest].children.push(
  nodes.push({ name: "Spatial House front and back marks", mesh: 1 }) - 1,
);
const rootIndex = source.bones.findIndex(
  (b) => !b.parent && b.name === "Pelvis",
);
let idleRoot;
// The supplied walk has opposite support-foot directions. Preserve the sampled
// left-leg motion, reverse it for forward travel, then mirror it half a cycle
// onto the right leg relative to the pelvis. This keeps the source IK gait while
// making both planted feet travel backward consistently.
const rawMatrix = (a) => new T.Matrix4().set(...a);
const rows = (m) => m.clone().transpose().toArray();
const boneRest = new Map(
  source.bones.map((b) => [b.name, rawMatrix(b.matrix)]),
);
const rootRestInverse = boneRest.get("Pelvis").clone().invert();
const reflect = new T.Matrix4().makeScale(-1, 1, 1);
function forwardWalk(original) {
  const cycle = original.length - 1;
  return original.map((s, frame) => {
    const index = (cycle - (frame % cycle)) % cycle;
    const opposite = (index + cycle / 2) % cycle;
    const current = original[index],
      phase = original[opposite];
    const bones = structuredClone(current.bones);
    const pelvis = rawMatrix(current.bones.Pelvis),
      phaseInverse = rawMatrix(phase.bones.Pelvis).invert();
    for (const part of ["thigh", "calf", "leg"]) {
      const left = part + ".l",
        right = part + ".r";
      const leftRest = rootRestInverse.clone().multiply(boneRest.get(left));
      const rightRest = rootRestInverse.clone().multiply(boneRest.get(right));
      const delta = phaseInverse
        .clone()
        .multiply(rawMatrix(phase.bones[left]))
        .multiply(leftRest.invert());
      bones[right] = rows(
        pelvis
          .clone()
          .multiply(reflect)
          .multiply(delta)
          .multiply(reflect)
          .multiply(rightRest),
      );
    }
    return { time: s.time, bones };
  });
}
for (const [role, originalSamples] of [
  ...Object.entries(source.actions),
  ["Run", source.actions.Walk],
]) {
  const samples =
    role === "Walk" || role === "Run"
      ? forwardWalk(originalSamples)
      : originalSamples;
  const tracks = names.map(() => ({ q: [], p: [] }));
  for (const sample of samples) {
    const matrices = names.map((n) => normalized(sample.bones[n]));
    for (let i = 0; i < names.length; i++) {
      const pidx = boneIndex.get(source.bones[i].parent),
        local = (
          pidx === undefined ? new T.Matrix4() : matrices[pidx].clone().invert()
        ).multiply(matrices[i]),
        p = V(),
        q = Q(),
        s = V();
      local.decompose(p, q, s);
      if (i === rootIndex) {
        idleRoot ??= p.clone();
        p.x = idleRoot.x;
        p.z = idleRoot.z;
      }
      if (role === "Run") {
        const phase = (sample.time / samples.at(-1).time) * Math.PI * 2;
        if (i === rootIndex) p.y += 0.025 * Math.pow(Math.sin(phase), 2);
        if (names[i] === "Chest")
          q.multiply(Q().setFromEuler(new T.Euler(0.1, 0, 0)));
      }
      const qs = tracks[i].q;
      if (
        qs.length &&
        Q()
          .fromArray(qs, qs.length - 4)
          .dot(q) < 0
      )
        q.set(-q.x, -q.y, -q.z, -q.w);
      qs.push(...q.normalize().toArray());
      tracks[i].p.push(...p);
    }
  }
  const animation = { name: role, samplers: [], channels: [] },
    times = w.access(
      Float32Array.from(
        samples.map((s) =>
          role === "Run" ? (s.time / samples.at(-1).time) * 0.8 : s.time,
        ),
      ),
      "SCALAR",
    );
  for (let i = 0; i < names.length; i++)
    for (const [role, pathName, type] of [
      ["q", "rotation", "VEC4"],
      ["p", "translation", "VEC3"],
    ]) {
      animation.samplers.push({
        input: times,
        output: w.access(Float32Array.from(tracks[i][role]), type),
        interpolation: "LINEAR",
      });
      animation.channels.push({
        sampler: animation.samplers.length - 1,
        target: { node: i, path: pathName },
      });
    }
  j.animations.push(animation);
}
const walker = w.finish();
fs.writeFileSync(path.join(out, "walker.glb"), walker);
const report = {
  walker: {
    bytes: walker.length,
    triangles: source.triangles.length + badge.indices.length / 3,
    bones: names.length,
    drawCalls: 4,
    height: 1.65,
    clips: j.animations.map((a) => a.name),
    source:
      "Native Blender IK walk, 24 fps; corrected forward direction and mirrored support phase",
  },
};
// R01: freeze the authored pose; remove demo/control curves and duplicate bone names.
globalThis.window = { innerWidth: 1280, innerHeight: 720 };
globalThis.FileReader = class {
  readAsArrayBuffer(b) {
    b.arrayBuffer().then((v) => {
      this.result = v;
      this.onloadend?.();
    });
  }
};
const textures = [];
T.TextureLoader.prototype.load = function (url) {
  const t = new T.Texture();
  t.userData.sourceUrl = url;
  textures.push(t);
  return t;
};
const input = fs.readFileSync(
  process.argv[2] ?? path.join(os.homedir(), "Downloads/R01_Animate_S.fbx"),
);
const fbx = new FBXLoader().parse(
  input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
  "",
);
fbx.updateMatrixWorld(true);
const originalBox = new T.Box3().setFromObject(fbx),
  h = originalBox.max.y - originalBox.min.y,
  center = originalBox.getCenter(V());
const remove = [];
let n = 0;
fbx.traverse((o) => {
  if (o.isBone) o.name = `r01_${o.name}_${n++}`;
  if (o.isLight || o.isCamera) remove.push(o);
  if (o.isLine) {
    o.isLine = false;
    o.isLineSegments = false;
    o.type = "Object3D";
  }
  if (o.isMesh) {
    o.geometry = mergeVertices(o.geometry, 1e-5);
    if (o.geometry.attributes.uv) {
      o.geometry.computeTangents();
      const tangent = o.geometry.attributes.tangent;
      const normal = o.geometry.attributes.normal;
      for (let i = 0; i < tangent.count; i++) {
        const t = new T.Vector3().fromBufferAttribute(tangent, i);
        if (t.lengthSq() < 0.5) {
          const n = new T.Vector3().fromBufferAttribute(normal, i).normalize();
          t.crossVectors(
            Math.abs(n.y) < 0.9
              ? new T.Vector3(0, 1, 0)
              : new T.Vector3(1, 0, 0),
            n,
          ).normalize();
          tangent.setXYZW(i, t.x, t.y, t.z, 1);
        }
      }
    }
    o.material = new T.MeshStandardMaterial({
      name: "R01 painted shell",
      color: 0xffffff,
      metalness: 0.22,
      roughness: 0.36,
    });
  }
});
remove.forEach((o) => o.removeFromParent());
const holder = new T.Group();
holder.name = "R01Fit";
holder.scale.setScalar(1.45 / h);
fbx.position.sub(V(center.x, originalBox.min.y, center.z));
holder.add(fbx);
const motion = new T.Group();
motion.name = "HoverMotion";
motion.add(holder);
const clips = [];
for (const [name, duration, lean] of [
  ["Idle", 2.4, 0],
  ["Walk", 1.6, 0.035],
  ["Run", 0.9, 0.09],
]) {
  const times = Array.from({ length: 49 }, (_, i) => (i / 48) * duration),
    p = [],
    q = [];
  for (let i = 0; i < 49; i++) {
    const t = (i / 48) * Math.PI * 2;
    p.push(0, 0.012 * Math.sin(t), 0);
    q.push(
      ...Q()
        .setFromEuler(new T.Euler(lean, 0, 0.01 * Math.sin(t)))
        .toArray(),
    );
  }
  clips.push(
    new T.AnimationClip(name, duration, [
      new T.VectorKeyframeTrack("HoverMotion.position", times, p),
      new T.QuaternionKeyframeTrack("HoverMotion.quaternion", times, q),
    ]),
  );
}
const exported = Buffer.from(
    await new GLTFExporter().parseAsync(motion, {
      binary: true,
      animations: clips,
      onlyVisible: false,
    }),
  ),
  jl = exported.readUInt32LE(12),
  jr = JSON.parse(exported.toString("utf8", 20, 20 + jl)),
  wr = writer(jr, exported.subarray(28 + jl));
jr.images = [];
jr.textures = [];
// Embedded FBX UVs use the opposite image origin; image bytes are flipped by the
// small texture preparation script, without editing the source FBX.
const colorFile = path.join(import.meta.dirname, "robot-sources/r01-color.jpg"),
  normalFile = path.join(import.meta.dirname, "robot-sources/r01-normal.png");
for (const [file, mime] of [
  [colorFile, "image/jpeg"],
  [normalFile, "image/png"],
]) {
  const image =
    jr.images.push({
      bufferView: wr.bytes(fs.readFileSync(file)),
      mimeType: mime,
    }) - 1;
  jr.textures.push({ source: image });
}
for (const m of jr.materials) {
  m.pbrMetallicRoughness.baseColorTexture = { index: 0 };
  m.normalTexture = { index: 1, scale: 0.3 };
}
// The hover robot's shell does not deform during its stable comparison loops;
// attach the badge to its upper-torso bone as a rigid mechanical plate.
const pbox = new T.Box3().setFromObject(motion),
  ph = pbox.max.y - pbox.min.y,
  points = [],
  tris = [];
motion.updateMatrixWorld(true);
motion.traverse((o) => {
  if (!o.isMesh) return;
  const geom = o.geometry,
    offset = points.length;
  for (let i = 0; i < geom.attributes.position.count; i++)
    points.push(o.getVertexPosition(i, V()).applyMatrix4(o.matrixWorld));
  const ids =
    geom.index?.array ??
    Array.from({ length: geom.attributes.position.count }, (_, i) => i);
  for (let i = 0; i < ids.length; i += 3)
    tris.push([ids[i] + offset, ids[i + 1] + offset, ids[i + 2] + offset]);
});
const chestTarget = pbox.min.y + ph * 0.64,
  rbadge = twoSidedLogos(points, tris, ph, chestTarget, ph * 0.08),
  rmat = logoMaterial(jr, wr);
// Badge coordinates are already in normalized model space, under the same motion node.
const motionNode = jr.nodes.findIndex((n) => n.name === "HoverMotion");
jr.meshes.push({
  name: "R01 Spatial House mark",
  primitives: [
    {
      attributes: {
        POSITION: wr.access(
          Float32Array.from(rbadge.positions),
          "VEC3",
          5126,
          34962,
        ),
        NORMAL: wr.access(
          Float32Array.from(rbadge.normals),
          "VEC3",
          5126,
          34962,
        ),
        TEXCOORD_0: wr.access(
          Float32Array.from(rbadge.uv),
          "VEC2",
          5126,
          34962,
        ),
      },
      indices: wr.access(
        Uint16Array.from(rbadge.indices),
        "SCALAR",
        5123,
        34963,
      ),
      material: rmat,
    },
  ],
});
jr.nodes.push({ name: "R01 front and back marks", mesh: jr.meshes.length - 1 });
(jr.nodes[motionNode].children ??= []).push(jr.nodes.length - 1);
// Skinned geometry follows its bones; keep its mesh node at scene root.
for (let i = 0; i < jr.nodes.length; i++) {
  const node = jr.nodes[i];
  if (node.skin === undefined) continue;
  for (const parent of jr.nodes)
    if (parent.children)
      parent.children = parent.children.filter((c) => c !== i);
  delete node.translation;
  delete node.rotation;
  delete node.scale;
  delete node.matrix;
  if (!jr.scenes[0].nodes.includes(i)) jr.scenes[0].nodes.push(i);
}
const r01 = wr.finish();
fs.writeFileSync(path.join(out, "r01.glb"), r01);
report.r01 = {
  bytes: r01.length,
  triangles: 3704 + rbadge.indices.length / 3,
  bones: n,
  drawCalls: 3,
  height: 1.45,
  clips: ["Idle", "Walk", "Run"],
  source:
    "Original shell/rig; new stable idle and forward hover loops, no demo gestures",
};
for (const [id, meta] of Object.entries(report))
  fs.writeFileSync(
    path.join(out, id + ".meta.json"),
    JSON.stringify(meta, null, 2),
  );
console.log(JSON.stringify(report, null, 2));
