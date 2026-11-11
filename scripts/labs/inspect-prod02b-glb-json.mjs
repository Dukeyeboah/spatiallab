import fs from 'fs';
import path from 'path';

function readGlbJson(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.toString('utf8', 0, 4);
  if (magic !== 'glTF') throw new Error('not glb: ' + magic);
  const version = buf.readUInt32LE(4);
  let offset = 12;
  let json = null;
  while (offset < buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.toString('utf8', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + chunkLen);
    if (chunkType === 'JSON') json = JSON.parse(data.toString('utf8'));
    offset += 8 + chunkLen;
  }
  return { version, json };
}

const root = 'public/labs/prod02b/avatars';
for (const f of ['standing.glb','walk.glb','left.glb','right.glb']) {
  const { json } = readGlbJson(path.join(root, f));
  console.log('\n===', f, '===');
  console.log('nodes', json.nodes?.length, 'meshes', json.meshes?.length, 'skins', json.skins?.length, 'anims', json.animations?.length);
  const jointCount = json.skins?.[0]?.joints?.length;
  console.log('skin0 joints:', jointCount);
  // joint names from nodes
  if (json.skins?.[0]) {
    const names = json.skins[0].joints.map(i => json.nodes[i]?.name);
    console.log('first joints:', names.slice(0,6).join(', '));
    console.log('has mixamorigHips:', names.includes('mixamorigHips') || names.some(n => /Hips/.test(n||'')));
  }
  for (const [i, a] of (json.animations || []).entries()) {
    console.log(`  clip[${i}] name="${a.name}" channels=${a.channels?.length} samplers=${a.samplers?.length}`);
  }
  // extensions
  console.log('extensionsUsed:', json.extensionsUsed);
}
