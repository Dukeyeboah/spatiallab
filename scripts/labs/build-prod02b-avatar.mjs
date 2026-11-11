/** Build the Spatial House outfit + authored locomotion on the user's original Mixamo rig.
 * Node 22+, three and draco3d. Originals are inputs only. Atlas is baked separately.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const require = createRequire(import.meta.url);
const assetDir = path.resolve(
  import.meta.dirname,
  "../../public/labs/prod02b/avatars",
);
const outFile =
  process.argv[2] ?? path.join(assetDir, "spatial-house-avatar.glb");
const atlasFile = process.argv[3] ?? path.join(assetDir, "shirt-atlas.png");
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
function readGlb(file) {
  const b = fs.readFileSync(file),
    n = b.readUInt32LE(12);
  return {
    j: JSON.parse(b.toString("utf8", 20, 20 + n)),
    bin: b.subarray(28 + n),
  };
}
function accessor(source, index) {
  const a = source.j.accessors[index],
    bv = source.j.bufferViews[a.bufferView];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const T = {
    5126: Float32Array,
    5125: Uint32Array,
    5123: Uint16Array,
    5121: Uint8Array,
  }[a.componentType];
  const copy = source.bin.subarray(
    (bv.byteOffset ?? 0) + (a.byteOffset ?? 0),
    (bv.byteOffset ?? 0) +
      (a.byteOffset ?? 0) +
      a.count * width * T.BYTES_PER_ELEMENT,
  );
  return new T(
    copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
  );
}
const sources = Object.fromEntries(
  ["standing", "walk", "left", "right"].map((n) => [
    n,
    readGlb(path.join(assetDir, n + ".glb")),
  ]),
);
const original = sources.standing;
const d = await require("draco3d").createDecoderModule();
const primitive = original.j.meshes[0].primitives[0],
  ex = primitive.extensions.KHR_draco_mesh_compression;
const view = original.j.bufferViews[ex.bufferView],
  decoder = new d.Decoder(),
  db = new d.DecoderBuffer(),
  dm = new d.Mesh();
const drc = original.bin.subarray(
  view.byteOffset,
  view.byteOffset + view.byteLength,
);
db.Init(new Int8Array(drc), drc.length);
if (!decoder.DecodeBufferToMesh(db, dm).ok())
  throw Error("Draco decode failed");
const attrs = {};
for (const [name, id] of Object.entries(ex.attributes)) {
  const att = decoder.GetAttributeByUniqueId(dm, id),
    arr = new d.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(dm, att, arr);
  attrs[name] = Float32Array.from({ length: arr.size() }, (_, i) =>
    arr.GetValue(i),
  );
  d.destroy(arr);
}
const indices = [];
for (let i = 0; i < dm.num_faces(); i++) {
  const f = new d.DracoInt32Array();
  decoder.GetFaceFromMesh(dm, i, f);
  indices.push(f.GetValue(0), f.GetValue(1), f.GetValue(2));
  d.destroy(f);
}
for (const o of [dm, db, decoder]) d.destroy(o);

// Load just the source rig/animations to recover its true bind-space transforms.
const rigJson = structuredClone(original.j);
delete rigJson.extensionsRequired;
delete rigJson.extensionsUsed;
delete rigJson.meshes;
delete rigJson.materials;
for (const n of rigJson.nodes) delete n.mesh;
rigJson.buffers = [
  {
    byteLength: original.bin.length,
    uri:
      "data:application/octet-stream;base64," + original.bin.toString("base64"),
  },
];
globalThis.ProgressEvent ??= class {
  constructor(type, init) {
    Object.assign(this, { type }, init);
  }
};
const rig = await new GLTFLoader().parseAsync(JSON.stringify(rigJson), "");
rig.scene.updateMatrixWorld(true);
const byOriginalName = new Map(),
  nodeIndex = new Map(original.j.nodes.map((n, i) => [n.name, i]));
rig.scene.traverse((o) => byOriginalName.set(o.name, o));
const clean = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const rest = new Map();
for (const n of original.j.nodes) {
  const o = byOriginalName.get(clean(n.name));
  if (o?.isBone) {
    const p = V(),
      q = Q(),
      s = V();
    o.matrixWorld.decompose(p, q, s);
    rest.set(n.name, { p, q });
  }
}
const jointNames = original.j.skins[0].joints.map(
  (i) => original.j.nodes[i].name,
);
const weightFor = (i, test) => {
  let sum = 0;
  for (let k = 0; k < 4; k++)
    if (test(jointNames[attrs.JOINTS_0[i * 4 + k]]))
      sum += attrs.WEIGHTS_0[i * 4 + k];
  return sum;
};
const head = rest.get("mixamorig:Head").p,
  neck = rest.get("mixamorig:Neck").p;
let positions = attrs.POSITION.slice();
let originalPositions = attrs.POSITION.slice();
for (let i = 0; i < positions.length / 3; i++) {
  const p = V().fromArray(positions, i * 3);
  const hw = weightFor(i, (n) => /Head/.test(n));
  if (hw > 0) {
    const scaled = p
      .clone()
      .sub(head)
      .multiply(V(0.48, 0.52, 0.52))
      .add(head);
    p.lerp(scaled, hw);
  }
  for (const side of ["Left", "Right"]) {
    const w = weightFor(i, (n) => n.includes(side + "Hand"));
    if (w > 0) {
      const pivot = rest.get("mixamorig:" + side + "Hand").p;
      p.lerp(p.clone().sub(pivot).multiplyScalar(0.8).add(pivot), w);
    }
  }
  const leg = weightFor(i, (n) => /UpLeg|Leg$/.test(n));
  if (leg > 0.05) {
    const side = p.x > 0 ? "Left" : "Right",
      hip = rest.get("mixamorig:" + side + "UpLeg").p,
      knee = rest.get("mixamorig:" + side + "Leg").p,
      ankle = rest.get("mixamorig:" + side + "Foot").p;
    const blend = THREE.MathUtils.clamp(
      (p.y - ankle.y) / (hip.y - ankle.y),
      0,
      1,
    );
    const cx = THREE.MathUtils.lerp(ankle.x, hip.x, blend),
      cz = THREE.MathUtils.lerp(ankle.z, hip.z, blend);
    const loosen = 1 + 0.42 * leg * (0.65 + 0.35 * Math.sin(blend * Math.PI));
    p.x = cx + (p.x - cx) * loosen;
    p.z = cz + (p.z - cz) * loosen;
  }
  const torso = weightFor(i, (n) => /Spine|Hips/.test(n));
  if (torso > 0.2 && p.y > 4.15) {
    p.x = 0.02 + (p.x - 0.02) * (1 + 0.075 * torso);
    p.z = -0.05 + (p.z + 0.05) * (1 + 0.1 * torso);
  }
  p.toArray(positions, i * 3);
}
let minY = Infinity,
  maxY = -Infinity;
for (let i = 1; i < positions.length; i += 3) {
  minY = Math.min(minY, positions[i]);
  maxY = Math.max(maxY, positions[i]);
}
const scale = 1.75 / (maxY - minY),
  origin = V(0, minY, 0);
for (let i = 0; i < positions.length / 3; i++) {
  const p = V()
    .fromArray(positions, i * 3)
    .sub(origin)
    .multiplyScalar(scale);
  p.toArray(positions, i * 3);
}
for (const r of rest.values()) r.p.sub(origin).multiplyScalar(scale);

// Normalize the original cm-scale, rotated armature to a conventional Y-up metre rig.
const nodes = structuredClone(original.j.nodes);
const parentOf = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
const restWorld = new Map(
  [...rest].map(([n, r]) => [
    n,
    new THREE.Matrix4().compose(r.p, r.q, V(1, 1, 1)),
  ]),
);
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  delete n.rotation;
  delete n.translation;
  delete n.scale;
  delete n.matrix;
  if (rest.has(n.name)) {
    const parent = nodes[parentOf.get(i)];
    const parentMat = restWorld.get(parent?.name) ?? new THREE.Matrix4();
    const local = parentMat.clone().invert().multiply(restWorld.get(n.name));
    const p = V(),
      q = Q(),
      s = V();
    local.decompose(p, q, s);
    n.translation = p.toArray();
    n.rotation = q.toArray();
  }
}
const meshIndex = nodes.findIndex((n) => n.mesh !== undefined);
nodes[meshIndex].mesh = 0;
const j = {
  asset: {
    version: "2.0",
    generator: "SpatialLab existing-rig outfit + authored locomotion",
  },
  scene: 0,
  scenes: structuredClone(original.j.scenes),
  nodes,
  skins: [
    {
      joints: original.j.skins[0].joints,
      skeleton: nodeIndex.get("mixamorig:Hips"),
    },
  ],
  meshes: [],
  materials: [],
  accessors: [],
  bufferViews: [],
  animations: [],
  images: [],
  textures: [],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  extensionsUsed: ["KHR_materials_unlit"],
};
// Keep skinned meshes at scene root for portable glTF skinning semantics.
for (const n of nodes)
  if (n.children) n.children = n.children.filter((i) => i !== meshIndex);
j.scenes[0].nodes.push(meshIndex);
let size = 0;
const parts = [];
function addBytes(buf) {
  const pad = (4 - (size % 4)) % 4;
  if (pad) {
    parts.push(Buffer.alloc(pad));
    size += pad;
  }
  const index =
    j.bufferViews.push({
      buffer: 0,
      byteOffset: size,
      byteLength: buf.length,
    }) - 1;
  parts.push(buf);
  size += buf.length;
  return index;
}
function add(
  a,
  type,
  componentType = 5126,
  normalized = false,
  bounds = false,
) {
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
  const index =
    j.accessors.push({
      bufferView: addBytes(Buffer.from(a.buffer, a.byteOffset, a.byteLength)),
      componentType,
      count: a.length / width,
      type,
      ...(normalized ? { normalized: true } : {}),
    }) - 1;
  if (bounds) {
    j.accessors[index].min = Array.from({ length: width }, (_, k) => {
      let m = Infinity;
      for (let i = k; i < a.length; i += width) m = Math.min(m, a[i]);
      return m;
    });
    j.accessors[index].max = Array.from({ length: width }, (_, k) => {
      let m = -Infinity;
      for (let i = k; i < a.length; i += width) m = Math.max(m, a[i]);
      return m;
    });
  }
  return index;
}
const ibm = Float32Array.from(
  j.skins[0].joints.flatMap(
    (i) => restWorld.get(nodes[i].name).clone().invert().elements,
  ),
);
j.skins[0].inverseBindMatrices = add(ibm, "MAT4");
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setIndex(indices);
geometry.computeVertexNormals();
const baseNormals = geometry.getAttribute("normal").array;
const expanded = {
  p: [],
  raw: [],
  normal: [],
  joints: [],
  weights: [],
  uv: [],
  cat: [],
};
const groups = Array.from({ length: 5 }, () => []);
function vertex(i) {
  return {
    p: V().fromArray(positions, i * 3),
    raw: V().fromArray(originalPositions, i * 3),
    n: V().fromArray(baseNormals, i * 3),
    j: Array.from(attrs.JOINTS_0.slice(i * 4, i * 4 + 4)),
    w: Array.from(attrs.WEIGHTS_0.slice(i * 4, i * 4 + 4)),
  };
}
function interpolate(a, b, t) {
  const jointWeights = new Map();
  for (const [v, k] of [
    [a, 1 - t],
    [b, t],
  ])
    for (let i = 0; i < 4; i++)
      jointWeights.set(v.j[i], (jointWeights.get(v.j[i]) ?? 0) + v.w[i] * k);
  const sorted = [...jointWeights].sort((a, b) => b[1] - a[1]).slice(0, 4);
  while (sorted.length < 4) sorted.push([0, 0]);
  const total = sorted.reduce((s, a) => s + a[1], 0);
  return {
    p: a.p.clone().lerp(b.p, t),
    raw: a.raw.clone().lerp(b.raw, t),
    n: a.n.clone().lerp(b.n, t).normalize(),
    j: sorted.map((a) => a[0]),
    w: sorted.map((a) => a[1] / total),
  };
}
function half(poly, axis, value, greater) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = a.raw[axis] - value,
      db = b.raw[axis] - value,
      ia = greater ? da >= -1e-7 : da <= 1e-7,
      ib = greater ? db >= -1e-7 : db <= 1e-7;
    if (ia) out.push(a);
    if (ia !== ib) out.push(interpolate(a, b, da / (da - db)));
  }
  return out;
}
function category(p) {
  if (p.y < 0.65) return 3;
  if (p.y < 4.25) return 2;
  if (
    p.y < 6.5 &&
    Math.abs(p.x) < 1.85 &&
    !(Math.abs(p.x) < 0.38 && p.y > 6.16)
  )
    return 1;
  if (p.y > 8.65) return 4;
  return 0;
}
const vertexCache = new Map();
function emit(v, cat, region) {
  let u = 0.01,
    vv = 0.98;
  if (cat === 1 && region !== 0) {
    const front = region === 1;
    u = THREE.MathUtils.clamp(
      (front ? 0.25 : 0.75) + ((front ? 1 : -1) * (v.raw.x - 0.02)) / 2.85,
      front ? 0.005 : 0.505,
      front ? 0.495 : 0.995,
    );
    vv = THREE.MathUtils.clamp(0.5 - (v.raw.y - 5.25) / 2.85, 0, 1);
  }
  const key = [cat, ...v.p, ...v.n, ...v.j, ...v.w, u, vv]
    .map((n) => Number(n).toFixed(6))
    .join(",");
  if (vertexCache.has(key)) return vertexCache.get(key);
  const index = expanded.p.length / 3;
  vertexCache.set(key, index);
  expanded.p.push(...v.p);
  expanded.raw.push(...v.raw);
  expanded.normal.push(...v.n);
  expanded.joints.push(...v.j);
  expanded.weights.push(...v.w);
  expanded.uv.push(u, vv);
  expanded.cat.push(cat);
  return index;
}
const planes = [
  ["y", 0.65],
  ["y", 4.25],
  ["y", 6.16],
  ["y", 6.5],
  ["y", 8.65],
  ["x", -1.85],
  ["x", -0.38],
  ["x", 0.38],
  ["x", 1.85],
  ["z", -0.05],
];
for (let t = 0; t < indices.length; t += 3) {
  let polygons = [indices.slice(t, t + 3).map(vertex)];
  for (const [axis, value] of planes) {
    const split = [];
    for (const poly of polygons) {
      const d = poly.map((v) => v.raw[axis]);
      if (Math.min(...d) < value - 1e-6 && Math.max(...d) > value + 1e-6) {
        const a = half(poly, axis, value, true),
          b = half(poly, axis, value, false);
        if (a.length >= 3) split.push(a);
        if (b.length >= 3) split.push(b);
      } else split.push(poly);
    }
    polygons = split;
  }
  for (const poly of polygons) {
    const center = poly
        .reduce((p, v) => p.add(v.raw), V())
        .multiplyScalar(1 / poly.length),
      cat = category(center);
    const region =
      cat === 1 && Math.abs(center.x) < 1.1 ? (center.z > -0.05 ? 1 : 2) : 0;
    for (let k = 1; k < poly.length - 1; k++) {
      const tri = [poly[0], poly[k], poly[k + 1]];
      if (
        tri[1].p
          .clone()
          .sub(tri[0].p)
          .cross(tri[2].p.clone().sub(tri[0].p))
          .lengthSq() < 1e-13
      )
        continue;
      groups[cat].push(...tri.map((v) => emit(v, cat, region)));
    }
  }
}
// Small facial features stay on the original Head joint; no new bones or materials.
const headJoint = jointNames.indexOf("mixamorig:Head");
const headBase = rest.get("mixamorig:Head").p;
function surfaceZ(x, y) {
  let z = -Infinity;
  for (let i = 0; i < positions.length / 3; i++)
    if (
      Math.abs(positions[i * 3] - x) < 0.038 &&
      Math.abs(positions[i * 3 + 1] - y) < 0.035
    )
      z = Math.max(z, positions[i * 3 + 2]);
  return Number.isFinite(z) ? z : 0.1;
}
function feature(g, center, cat) {
  const pos = g.getAttribute("position"),
    normal = g.getAttribute("normal"),
    idx = g.index?.array ?? Array.from({ length: pos.count }, (_, i) => i);
  for (let i = 0; i < idx.length; i += 3) {
    const ids = [];
    for (let k = 0; k < 3; k++) {
      const v = idx[i + k],
        p = V().fromBufferAttribute(pos, v).add(center),
        n = V().fromBufferAttribute(normal, v);
      ids.push(
        emit(
          { p, raw: V(0, 7.5, 0), n, j: [headJoint, 0, 0, 0], w: [1, 0, 0, 0] },
          cat,
          0,
        ),
      );
    }
    groups[cat].push(...ids);
  }
}
const eyeY = headBase.y + 0.17;
for (const sign of [-1, 1]) {
  const x = headBase.x + sign * 0.043,
    z = surfaceZ(x, eyeY);
  const eye = new THREE.SphereGeometry(1, 8, 4);
  eye.scale(0.014, 0.007, 0.007);
  feature(eye, V(x, eyeY, z + 0.003), 4);
}
const noseY = eyeY - 0.036,
  noseZ = surfaceZ(headBase.x, noseY);
const nose = new THREE.ConeGeometry(0.012, 0.027, 4);
nose.rotateX(Math.PI / 2);
feature(nose, V(headBase.x, noseY, noseZ + 0.008), 0);
const mouthY = eyeY - 0.075,
  mouthZ = surfaceZ(headBase.x, mouthY);
const mouth = new THREE.BoxGeometry(0.035, 0.003, 0.003);
feature(mouth, V(headBase.x, mouthY, mouthZ + 0.003), 4);
positions = Float32Array.from(expanded.p);
originalPositions = Float32Array.from(expanded.raw);
attrs.JOINTS_0 = Float32Array.from(expanded.joints);
attrs.WEIGHTS_0 = Float32Array.from(expanded.weights);
const normals = Float32Array.from(expanded.normal),
  uv = Float32Array.from(expanded.uv),
  cats = Uint8Array.from(expanded.cat);
// One 1K atlas, no clothing simulation, no lights/shadows, five inexpensive draws.
j.images = [
  {
    bufferView: addBytes(fs.readFileSync(atlasFile)),
    mimeType: "image/png",
    name: "Spatial House shirt: front and back",
  },
];
j.textures = [{ sampler: 0, source: 0 }];
const rgba = (hex) => new THREE.Color(hex).toArray().concat(1);
for (const [name, color, texture] of [
  ["Skin", "#a87554", false],
  ["Spatial House cream tee", "#ffffff", true],
  ["Charcoal baggy trousers", "#24211e", false],
  ["Sand sneakers", "#d6c6a9", false],
  ["Charcoal hair", "#201c19", false],
])
  j.materials.push({
    name,
    doubleSided: false,
    pbrMetallicRoughness: {
      baseColorFactor: rgba(color),
      roughnessFactor: 1,
      metallicFactor: 0,
      ...(texture ? { baseColorTexture: { index: 0 } } : {}),
    },
    extensions: { KHR_materials_unlit: {} },
  });
const shades = new Uint8Array((positions.length / 3) * 4);
const light = V(-0.4, 0.8, 0.5).normalize();
for (let i = 0; i < positions.length / 3; i++) {
  const n = V().fromArray(normals, i * 3);
  let s = 0.72 + 0.28 * Math.max(0, n.dot(light));
  if (cats[i] === 2) {
    const p = V().fromArray(originalPositions, i * 3);
    s *= 0.96 + 0.04 * Math.cos(p.y * 11 + Math.abs(p.x) * 3);
  }
  for (let k = 0; k < 3; k++) shades[i * 4 + k] = Math.round(s * 255);
  shades[i * 4 + 3] = 255;
}
const weights = new Uint8Array(attrs.WEIGHTS_0.length);
for (let i = 0; i < weights.length; i += 4) {
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    weights[i + k] = Math.round(attrs.WEIGHTS_0[i + k] * 255);
    sum += weights[i + k];
  }
  let max = 0;
  for (let k = 1; k < 4; k++) if (weights[i + k] > weights[i + max]) max = k;
  weights[i + max] += 255 - sum;
}
for (let i = 0; i < weights.length; i++)
  if (weights[i] === 0) attrs.JOINTS_0[i] = 0;
const common = {
  POSITION: add(positions, "VEC3", 5126, false, true),
  NORMAL: add(normals, "VEC3"),
  TEXCOORD_0: add(
    Uint16Array.from(uv, (v) =>
      Math.round(THREE.MathUtils.clamp(v, 0, 1) * 65535),
    ),
    "VEC2",
    5123,
    true,
  ),
  JOINTS_0: add(Uint8Array.from(attrs.JOINTS_0), "VEC4", 5121),
  WEIGHTS_0: add(weights, "VEC4", 5121, true),
  COLOR_0: add(shades, "VEC4", 5121, true),
};
j.meshes = [
  {
    name: "Spatial House character — original mesh, tailored outfit",
    primitives: groups.map((g, material) => ({
      attributes:
        material === 1
          ? common
          : Object.fromEntries(
              Object.entries(common).filter(([name]) => name !== "TEXCOORD_0"),
            ),
      indices: add(Uint16Array.from(g), "SCALAR", 5123),
      material,
      mode: 4,
    })),
  },
];
for (const p of j.meshes[0].primitives) {
  for (const a of Object.values(p.attributes))
    j.bufferViews[j.accessors[a].bufferView].target = 34962;
  j.bufferViews[j.accessors[p.indices].bufferView].target = 34963;
}
function animation(name, tracks) {
  const samplers = [],
    channels = [];
  for (const t of tracks) {
    samplers.push({
      input: add(Float32Array.from(t.times), "SCALAR", 5126, false, true),
      output: add(
        Float32Array.from(t.values),
        t.path === "rotation" ? "VEC4" : "VEC3",
      ),
      interpolation: "LINEAR",
    });
    channels.push({
      sampler: samplers.length - 1,
      target: { node: t.node, path: t.path },
    });
  }
  j.animations.push({ name, samplers, channels });
}
const armature = byOriginalName.get("Armature"),
  armatureQ = armature.getWorldQuaternion(Q());
for (const [name, source, index] of [
  ["Idle", sources.standing, 0],
  ["Walk", sources.walk, 1],
  ["TurnLeft", sources.left, 3],
  ["TurnRight", sources.right, 2],
]) {
  const a = source.j.animations[index];
  if (!a) throw Error("missing " + name);
  const tracks = [];
  for (const c of a.channels) {
    const boneName = source.j.nodes[c.target.node].name,
      s = a.samplers[c.sampler];
    if (c.target.path === "scale" || !rest.has(boneName)) continue;
    if (c.target.path === "translation" && boneName !== "mixamorig:Hips")
      continue;
    const times = accessor(source, s.input),
      values = accessor(source, s.output).slice();
    if (c.target.path === "translation") {
      for (let i = 0; i < values.length; i += 3) {
        const p = V()
          .fromArray(values, i)
          .applyMatrix4(armature.matrixWorld)
          .sub(origin)
          .multiplyScalar(scale);
        p.x = rest.get(boneName).p.x;
        p.z = rest.get(boneName).p.z;
        p.toArray(values, i);
      }
    }
    if (c.target.path === "rotation" && boneName === "mixamorig:Hips")
      for (let i = 0; i < values.length; i += 4)
        armatureQ
          .clone()
          .multiply(Q().fromArray(values, i))
          .normalize()
          .toArray(values, i);
    tracks.push({
      node: nodeIndex.get(boneName),
      path: c.target.path,
      times,
      values,
    });
  }
  animation(name, tracks);
}
// Pose authoring in world anatomical axes, converted to this same Mixamo rig.
const objects = new Map();
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i],
    o = new THREE.Object3D();
  o.name = n.name;
  o.position.fromArray(n.translation ?? [0, 0, 0]);
  o.quaternion.fromArray(n.rotation ?? [0, 0, 0, 1]);
  objects.set(i, o);
}
for (let i = 0; i < nodes.length; i++)
  for (const c of nodes[i].children ?? []) objects.get(i).add(objects.get(c));
const root = objects.get(j.scenes[0].nodes[0]);
root.updateMatrixWorld(true);
const object = (n) => objects.get(nodeIndex.get("mixamorig:" + n));
const baseQ = new Map(
  [...rest].map(([n]) => [n, objects.get(nodeIndex.get(n)).quaternion.clone()]),
);
const hips = object("Hips"),
  baseHips = hips.position.clone();
const axisX = V(1, 0, 0),
  axisY = V(0, 1, 0),
  axisZ = V(0, 0, 1);
function orient(name, child, dir) {
  const o = object(name),
    r = rest.get("mixamorig:" + name),
    end = rest.get("mixamorig:" + child);
  const from = end.p.clone().sub(r.p).normalize();
  const world = Q()
    .setFromUnitVectors(from, dir.clone().normalize())
    .multiply(r.q);
  const parent = o.parent.getWorldQuaternion(Q());
  o.quaternion.copy(parent.invert().multiply(world));
  root.updateMatrixWorld(true);
}
function worldRotation(name, x = 0, y = 0, z = 0) {
  const o = object(name),
    r = rest.get("mixamorig:" + name);
  const delta = Q().setFromEuler(new THREE.Euler(x, y, z, "YXZ"));
  o.quaternion.copy(
    o.parent.getWorldQuaternion(Q()).invert().multiply(delta).multiply(r.q),
  );
  root.updateMatrixWorld(true);
}
const bendDir = (a) => V(0, -Math.cos(a), Math.sin(a));
function resetPose() {
  for (const [n, q] of baseQ) objects.get(nodeIndex.get(n)).quaternion.copy(q);
  hips.position.copy(baseHips);
  root.updateMatrixWorld(true);
}
function minimumFoot() {
  const boneMatrices = j.skins[0].joints.map((i) =>
    objects
      .get(i)
      .matrixWorld.clone()
      .multiply(restWorld.get(nodes[i].name).clone().invert()),
  );
  let min = Infinity;
  for (let i = 0; i < positions.length / 3; i++) {
    if (originalPositions[i * 3 + 1] > 1.2) continue;
    const p = V().fromArray(positions, i * 3),
      v = V();
    for (let k = 0; k < 4; k++) {
      const w = weights[i * 4 + k] / 255;
      if (w)
        v.addScaledVector(
          p.clone().applyMatrix4(boneMatrices[attrs.JOINTS_0[i * 4 + k]]),
          w,
        );
    }
    min = Math.min(min, v.y);
  }
  return min;
}
function fingers() {
  for (const side of ["Left", "Right"])
    for (const digit of ["Index", "Middle", "Ring", "Pinky"])
      for (const n of [1, 2, 3]) {
        const o = object(side + "Hand" + digit + n);
        if (o) o.quaternion.multiply(Q().setFromAxisAngle(axisX, 0.65));
      }
  root.updateMatrixWorld(true);
}
function author(name, duration, pose, { ground = true } = {}) {
  const frames = Math.round(duration * 30),
    data = new Map([...rest].map(([n]) => [n, []])),
    ys = [],
    times = [];
  for (let f = 0; f <= frames; f++) {
    resetPose();
    const t = f / frames;
    const lift = pose(t) ?? 0;
    fingers();
    root.updateMatrixWorld(true);
    if (ground) hips.position.y -= minimumFoot();
    hips.position.y += lift;
    root.updateMatrixWorld(true);
    for (const [n] of rest) {
      const a = data.get(n),
        q = objects.get(nodeIndex.get(n)).quaternion.clone();
      if (
        a.length &&
        Q()
          .fromArray(a, a.length - 4)
          .dot(q) < 0
      )
        q.set(-q.x, -q.y, -q.z, -q.w);
      a.push(...q.toArray());
    }
    ys.push(...hips.position.toArray());
    times.push(t * duration);
  }
  animation(
    name,
    [...data]
      .map(([n, values]) => ({
        node: nodeIndex.get(n),
        path: "rotation",
        times,
        values,
      }))
      .concat([
        {
          node: nodeIndex.get("mixamorig:Hips"),
          path: "translation",
          times,
          values: ys,
        },
      ]),
  );
}
author("Run", 0.72, (t) => {
  const phase = t * Math.PI * 2;
  worldRotation("Hips", 0.08, Math.sin(phase) * 0.035, Math.cos(phase) * 0.025);
  worldRotation("Spine", 0.14, -Math.sin(phase) * 0.06);
  worldRotation("Spine1", 0.14, -Math.sin(phase) * 0.08);
  worldRotation("Spine2", 0.12, -Math.sin(phase) * 0.1);
  worldRotation("Neck", 0.035);
  worldRotation("Head", 0);
  for (const [side, offset] of [
    ["Left", 0],
    ["Right", Math.PI],
  ]) {
    const p = phase + offset,
      a = 0.78 * Math.sin(p),
      k = 0.3 + 1.3 * Math.pow(Math.max(0, -Math.sin(p)), 1.2),
      arm = -0.72 * Math.sin(p) - 0.08;
    orient(side + "UpLeg", side + "Leg", bendDir(a));
    orient(side + "Leg", side + "Foot", bendDir(a - k));
    orient(side + "Foot", side + "ToeBase", V(0, -0.12, 1));
    orient(
      side + "Arm",
      side + "ForeArm",
      V((side === "Left" ? 1 : -1) * 0.12, -Math.cos(arm), Math.sin(arm)),
    );
    orient(side + "ForeArm", side + "Hand", bendDir(arm + 1.4));
  }
  return 0.045 * Math.pow(Math.abs(Math.sin(phase)), 3);
});
function jumpPose(tuck, armLift) {
  worldRotation("Hips", 0.04);
  worldRotation("Spine", 0.08);
  worldRotation("Spine1", 0.13);
  worldRotation("Spine2", 0.12);
  worldRotation("Neck", 0.015);
  worldRotation("Head", 0);
  for (const side of ["Left", "Right"]) {
    const a = 0.08 + 0.72 * tuck,
      k = 0.12 + 1.18 * tuck;
    orient(side + "UpLeg", side + "Leg", bendDir(a));
    orient(side + "Leg", side + "Foot", bendDir(a - k));
    orient(side + "Foot", side + "ToeBase", V(0, -0.12, 1));
    const arm = -0.2 + armLift;
    orient(
      side + "Arm",
      side + "ForeArm",
      V((side === "Left" ? 1 : -1) * 0.18, -Math.cos(arm), Math.sin(arm)),
    );
    orient(side + "ForeArm", side + "Hand", bendDir(arm + 1.0));
  }
}
author("JumpStart", 0.12, (t) => {
  jumpPose(
    0.12 + 0.38 * Math.sin((t * Math.PI) / 2),
    -0.25 * Math.sin((t * Math.PI) / 2),
  );
});
author(
  "Jump",
  0.64,
  (t) => {
    const tuck = 0.5 * Math.sin(Math.PI * t);
    jumpPose(tuck, 0.85 * Math.sin(Math.PI * t) + 0.3);
  },
  { ground: false },
);
author("Land", 0.16, (t) => {
  jumpPose(0.52 * (1 - t), 0.1 * (1 - t));
});
// Use named actions, not accumulated index heuristics. Keep loops continuous.
j.animations.sort(
  (a, b) =>
    [
      "Idle",
      "Walk",
      "Run",
      "JumpStart",
      "Jump",
      "Land",
      "TurnLeft",
      "TurnRight",
    ].indexOf(a.name) -
    [
      "Idle",
      "Walk",
      "Run",
      "JumpStart",
      "Jump",
      "Land",
      "TurnLeft",
      "TurnRight",
    ].indexOf(b.name),
);
j.buffers = [{ byteLength: size }];
const jb = Buffer.from(JSON.stringify(j));
const jp = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 32)]),
  bb = Buffer.concat(parts),
  bp = Buffer.concat([bb, Buffer.alloc((4 - (bb.length % 4)) % 4)]),
  out = Buffer.alloc(28 + jp.length + bp.length);
out.write("glTF");
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(jp.length, 12);
out.write("JSON", 16);
jp.copy(out, 20);
out.writeUInt32LE(bp.length, 20 + jp.length);
out.write("BIN\0", 24 + jp.length);
bp.copy(out, 28 + jp.length);
fs.writeFileSync(outFile, out);
const report = {
  file: path.basename(outFile),
  bytes: out.length,
  triangles: groups.reduce((n, g) => n + g.length / 3, 0),
  vertices: positions.length / 3,
  drawCalls: 5,
  joints: jointNames.length,
  height: 1.75,
  texture: "1024×1024 embedded atlas",
  actions: j.animations.map((a) => ({
    name: a.name,
    tracks: a.channels.length,
  })),
  originalsUnchanged: true,
};
fs.writeFileSync(
  outFile.replace(/\.glb$/, ".meta.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
