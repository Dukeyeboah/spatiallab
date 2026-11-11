import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve('public/labs/prod02b/avatars');
const dracoPath = path.resolve('node_modules/three/examples/jsm/libs/draco/gltf/') + '/';

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath(pathToFileURL(dracoPath).href);
draco.setDecoderConfig({ type: 'js' });
loader.setDRACOLoader(draco);

function loadFile(filePath) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(filePath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    loader.parse(ab, '', resolve, reject);
  });
}

const files = ['standing.glb','walk.glb','left.glb','right.glb'];
for (const f of files) {
  const gltf = await loadFile(path.join(root, f));
  const bones = [];
  gltf.scene.traverse((o) => { if (o.isBone) bones.push(o.name); });
  const skinned = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push({ name: o.name, verts: o.geometry?.attributes?.position?.count }); });
  console.log('\n===', f, '===');
  console.log('skinnedMeshes:', JSON.stringify(skinned));
  console.log('bones:', bones.length, 'first=', bones[0], 'hips?', bones.includes('mixamorigHips') || bones.includes('mixamorig:Hips'));
  console.log('boneNames sample:', bones.slice(0, 8).join(', '));
  console.log('anims:', gltf.animations.length);
  for (const clip of gltf.animations) {
    const posHips = clip.tracks.find(t => /Hips\.position$/i.test(t.name));
    const quatHips = clip.tracks.find(t => /Hips\.quaternion$/i.test(t.name));
    let rootMotion = 'none';
    if (posHips && posHips.times.length > 1) {
      const arr = posHips.values;
      const n = posHips.times.length;
      const dx = arr[(n-1)*3] - arr[0];
      const dy = arr[(n-1)*3+1] - arr[1];
      const dz = arr[(n-1)*3+2] - arr[2];
      rootMotion = `hipsΔ=(${dx.toFixed(3)},${dy.toFixed(3)},${dz.toFixed(3)})`;
    }
    console.log(`  [${clip.name}] dur=${clip.duration.toFixed(3)}s tracks=${clip.tracks.length} ${rootMotion}`);
    console.log('    e.g.', clip.tracks.slice(0, 3).map(t => t.name).join(' | '));
  }
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  console.log('bbox:', size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));
}
