// Decode local meshopt delivery copies for Blender; original bytes stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
await MeshoptDecoder.ready;
const out = path.resolve('work/overhaul-v3/sources'); fs.mkdirSync(out, { recursive: true });
for (const hero of ['Knight','Barbarian','Mage','Rogue','Ranger']) {
  const bytes = fs.readFileSync(`public/models/${hero}.glb`), len = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20,20+len)), bin = bytes.subarray(28+len);
  // Blender names imported skinned objects after the mesh, not always the node.
  const nameMeshes = (index, inherited = '') => {
    const node = doc.nodes[index], name = node.name || inherited;
    if (node.mesh !== undefined && name) doc.meshes[node.mesh].name = name;
    for (const child of node.children || []) nameMeshes(child, name);
  };
  for (const scene of doc.scenes) for (const index of scene.nodes) nameMeshes(index);
  let offset = 0; const parts = [];
  doc.bufferViews = doc.bufferViews.map(view => {
    const ext = view.extensions?.EXT_meshopt_compression; let data;
    if (ext) {
      data = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(data,ext.count,ext.byteStride,bin.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength),ext.mode,ext.filter);
    } else data = bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
    const pad = (4-offset%4)%4; parts.push(Buffer.alloc(pad),Buffer.from(data)); offset += pad;
    const result = { ...view, buffer:0, byteOffset:offset, byteLength:data.length };
    delete result.extensions; offset += data.length; return result;
  });
  doc.buffers = [{byteLength:offset}];
  for (const k of ['extensionsUsed','extensionsRequired']) if (doc[k]) doc[k] = doc[k].filter(e=>e!=='EXT_meshopt_compression');
  const json = Buffer.from(JSON.stringify(doc)), jp = Buffer.alloc((4-json.length%4)%4,32);
  const data = Buffer.concat(parts), bp = Buffer.alloc((4-data.length%4)%4);
  const header=Buffer.alloc(20); header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4); header.writeUInt32LE(28+json.length+jp.length+data.length+bp.length,8); header.writeUInt32LE(json.length+jp.length,12); header.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8); bh.writeUInt32LE(data.length+bp.length,0);bh.writeUInt32LE(0x004e4942,4);
  fs.writeFileSync(path.join(out,hero+'.glb'),Buffer.concat([header,json,jp,bh,data,bp]));
  console.log(hero+' decoded for local Blender inspection');
}
