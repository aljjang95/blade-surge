import { test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heroAnkleHeight } from '../src/engine/hero-boots.js';
function strip(bytes: Buffer): ArrayBuffer {
  const jl = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jl).toString()), bin = bytes.subarray(20 + jl);
  for (const m of json.materials || []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; delete m.extensions; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  delete json.images; delete json.textures; delete json.samplers;
  for (const k of ['extensionsUsed', 'extensionsRequired']) if (json[k]) json[k] = json[k].filter((e: string) => e !== 'EXT_texture_webp');
  let t = Buffer.from(JSON.stringify(json)); t = Buffer.concat([t, Buffer.alloc((4 - t.length % 4) % 4, 32)]);
  const h = Buffer.alloc(20); h.write('glTF'); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + t.length + bin.length, 8); h.writeUInt32LE(t.length, 12); h.write('JSON', 16);
  const o = Buffer.concat([h, t, bin]); return o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength);
}
test('diag', async () => {
  for (const id of (process.env.IDS || 'hero_knight_t1,hero_knight_t1s,hero_knight_t2,hero_knight_t2u,hero_knight_t3').split(',')) {
    const g = await new GLTFLoader().parseAsync(strip(readFileSync('asset-library/normalized/' + id + '.glb')), '');
    let skin: any; g.scene.traverse((o: any) => { if (!skin && o.isSkinnedMesh) skin = o; });
    g.scene.updateMatrixWorld(true); skin.geometry.computeBoundingBox();
    const names = skin.skeleton.bones.map((b: any) => b.name.replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, ''));
    const bw = (n: string) => { const i = names.indexOf(n); return new THREE.Vector3().setFromMatrixPosition(skin.skeleton.boneInverses[i].clone().invert()); };
    const live = (n: string) => new THREE.Vector3().setFromMatrixPosition(skin.skeleton.bones[names.indexOf(n)].matrixWorld);
    // skinned bottom in scene rest pose
    const p = skin.geometry.attributes.position, v = new THREE.Vector3(); let smin = Infinity;
    for (let i = 0; i < p.count; i++) { skin.getVertexPosition(i, v); v.applyMatrix4(skin.matrixWorld); smin = Math.min(smin, v.y); }
    const footSet = new Set(['RightFoot', 'RightToeBase', 'LeftFoot', 'LeftToeBase'].map((n) => names.indexOf(n)));
    const si = skin.geometry.attributes.skinIndex, sw = skin.geometry.attributes.skinWeight; let fmin = Infinity;
    for (let i = 0; i < p.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (footSet.has(si.getComponent(i, k))) w += sw.getComponent(i, k); if (w > .5) fmin = Math.min(fmin, p.getY(i)); }
    console.log(id, JSON.stringify({ geoMinY: +skin.geometry.boundingBox.min.y.toFixed(3), geoMaxY: +skin.geometry.boundingBox.max.y.toFixed(3), footVertMinY: +fmin.toFixed(3), bindRFoot: bw('RightFoot').toArray().map((x) => +x.toFixed(3)), bindHips: bw('Hips').toArray().map((x) => +x.toFixed(3)), liveRFoot: live('RightFoot').toArray().map((x) => +x.toFixed(3)), liveHips: live('Hips').toArray().map((x) => +x.toFixed(3)), skinnedMinY: +smin.toFixed(3), ankle: heroAnkleHeight(skin)?.toFixed(3), bindMatrixIdentity: skin.bindMatrix.equals(new THREE.Matrix4()), meshMatrixWorldY: skin.matrixWorld.elements[13] }));
  }
});
