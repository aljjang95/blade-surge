// 궁수 라이브러리 몸체 교정본 패커.
// 원본 hero_ranger_t1.glb 의 메시·스킨·재질·텍스처 바이트는 그대로 두고, Blender 가 구운 클립(animations)과
// 활 그립/시위 노크 소켓 노드만 이름으로 옮겨 붙인다. 관절 rest TRS 가 원본과 다르면 실패한다(갑옷 단계·아바타가
// 같은 골격의 원본 역바인드를 쓰므로 rest 가 바뀌면 안 된다).
//   node tools/art/pack-ranger-library.mjs <원본.glb> <blender-anim.glb> <출력.glb>
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const [sourcePath, animPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node tools/art/pack-ranger-library.mjs source.glb blender-anim.glb output.glb');
const SOCKETS = ['RangerBowGrip_L', 'RangerDrawNock_R'];

function read(path) {
  const bytes = fs.readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binOffset = 20 + jsonLength;
  const bin = bytes.subarray(binOffset + 8, binOffset + 8 + bytes.readUInt32LE(binOffset));
  return { json, bin, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const src = read(sourcePath), anim = read(animPath), j = src.json, a = anim.json;
if (j.extensionsUsed?.includes('EXT_meshopt_compression')) throw new Error('meshopt source is not supported');

// 1) 관절 rest 비교
const byName = new Map(j.nodes.map((n, i) => [n.name, i]));
let maxT = 0, maxR = 0;
for (const node of a.nodes) {
  if (SOCKETS.includes(node.name) || !byName.has(node.name)) continue;
  const o = j.nodes[byName.get(node.name)];
  const t0 = o.translation || [0, 0, 0], t1 = node.translation || [0, 0, 0];
  const r0 = o.rotation || [0, 0, 0, 1], r1 = node.rotation || [0, 0, 0, 1];
  maxT = Math.max(maxT, Math.hypot(t0[0] - t1[0], t0[1] - t1[1], t0[2] - t1[2]));
  maxR = Math.max(maxR, 1 - Math.abs(r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2] + r0[3] * r1[3]));
}
// 원본 단위는 cm(LibraryPivot 0.018 배율). 0.01cm·1e-6 이내만 같은 rest 로 본다.
if (maxT > 0.01 || maxR > 1e-6) throw new Error('rest pose drift: translation ' + maxT + ' rotation ' + maxR);

// 2) 원본에서 애니메이션 외 데이터가 쓰는 accessor/bufferView 만 남기고 압축한다.
const keepAccessors = new Set();
for (const mesh of j.meshes || []) for (const p of mesh.primitives) {
  for (const v of Object.values(p.attributes)) keepAccessors.add(v);
  if (p.indices !== undefined) keepAccessors.add(p.indices);
  for (const t of p.targets || []) for (const v of Object.values(t)) keepAccessors.add(v);
}
for (const skin of j.skins || []) if (skin.inverseBindMatrices !== undefined) keepAccessors.add(skin.inverseBindMatrices);
const keepViews = new Set();
for (const i of keepAccessors) { const acc = j.accessors[i]; if (acc.sparse) throw new Error('sparse accessor not supported'); if (acc.bufferView !== undefined) keepViews.add(acc.bufferView); }
for (const img of j.images || []) if (img.bufferView !== undefined) keepViews.add(img.bufferView);

const parts = []; let length = 0;
const push = (data) => { const pad = (4 - length % 4) % 4; if (pad) { parts.push(Buffer.alloc(pad)); length += pad; } const offset = length; parts.push(Buffer.from(data)); length += data.length; return offset; };
const views = [], viewMap = new Map();
for (const i of [...keepViews].sort((x, y) => x - y)) {
  const v = j.bufferViews[i], data = src.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  const next = { ...v, buffer: 0, byteOffset: push(data) }; viewMap.set(i, views.length); views.push(next);
}
const accessors = [], accMap = new Map();
for (const i of [...keepAccessors].sort((x, y) => x - y)) {
  const acc = { ...j.accessors[i] }; if (acc.bufferView !== undefined) acc.bufferView = viewMap.get(acc.bufferView);
  accMap.set(i, accessors.length); accessors.push(acc);
}
for (const mesh of j.meshes || []) for (const p of mesh.primitives) {
  for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap.get(p.attributes[k]);
  if (p.indices !== undefined) p.indices = accMap.get(p.indices);
  for (const t of p.targets || []) for (const k of Object.keys(t)) t[k] = accMap.get(t[k]);
}
for (const skin of j.skins || []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = accMap.get(skin.inverseBindMatrices);
for (const img of j.images || []) if (img.bufferView !== undefined) img.bufferView = viewMap.get(img.bufferView);

// 3) Blender 클립 복사(accessor 하나당 bufferView 하나, float32 밀집 배열)
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function copyAnimAccessor(index) {
  const acc = a.accessors[index], v = a.bufferViews[acc.bufferView];
  if (acc.componentType !== 5126 || acc.sparse || (v.byteStride && v.byteStride !== SIZE[acc.type] * 4)) throw new Error('unsupported animation accessor');
  const start = (v.byteOffset || 0) + (acc.byteOffset || 0), bytes = acc.count * SIZE[acc.type] * 4;
  const view = views.length; views.push({ buffer: 0, byteOffset: push(anim.bin.subarray(start, start + bytes)), byteLength: bytes });
  const out = { bufferView: view, componentType: 5126, count: acc.count, type: acc.type };
  if (acc.min) out.min = acc.min; if (acc.max) out.max = acc.max;
  accessors.push(out); return accessors.length - 1;
}
const animations = [];
for (const clip of a.animations) {
  const samplers = [], channels = [], samplerMap = new Map();
  for (const ch of clip.channels) {
    const name = a.nodes[ch.target.node].name;
    if (!byName.has(name)) throw new Error('animated node missing in source: ' + name);
    if (!samplerMap.has(ch.sampler)) {
      const s = clip.samplers[ch.sampler];
      samplerMap.set(ch.sampler, samplers.length);
      samplers.push({ input: copyAnimAccessor(s.input), output: copyAnimAccessor(s.output), interpolation: s.interpolation || 'LINEAR' });
    }
    channels.push({ sampler: samplerMap.get(ch.sampler), target: { node: byName.get(name), path: ch.target.path } });
  }
  animations.push({ name: clip.name, channels, samplers });
}

// 4) 소켓 노드: Blender 의 부모 관절 이름으로 원본 관절 아래에 붙인다.
for (const socket of SOCKETS) {
  const index = a.nodes.findIndex((n) => n.name === socket);
  if (index < 0) throw new Error('socket missing: ' + socket);
  if (byName.has(socket)) throw new Error('socket already present in source: ' + socket);
  const parent = a.nodes.find((n) => n.children?.includes(index));
  if (!parent || !byName.has(parent.name)) throw new Error('socket parent missing: ' + socket);
  const n = a.nodes[index], node = { name: socket };
  for (const k of ['translation', 'rotation', 'scale']) if (n[k]) node[k] = n[k];
  j.nodes.push(node);
  const p = j.nodes[byName.get(parent.name)]; p.children = [...(p.children || []), j.nodes.length - 1];
}

j.accessors = accessors; j.bufferViews = views; j.animations = animations; j.buffers = [{ byteLength: length }];
j.asset = { ...j.asset, extras: { ...(j.asset?.extras || {}), rangerLibraryRevision: 'ranger-library-v1', sourceSha256: src.sha256,
  authoring: 'Blender ' + (a.asset?.generator || '') + ' / art-src/ranger/author_ranger_library_v1.py', packer: 'tools/art/pack-ranger-library.mjs' } };
const json = Buffer.from(JSON.stringify(j)), jp = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
const bin = Buffer.concat(parts), bp = Buffer.alloc((4 - bin.length % 4) % 4);
const header = Buffer.alloc(12); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + jp.length + 8 + bin.length + bp.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length + jp.length); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length + bp.length); bh.writeUInt32LE(0x004e4942, 4);
const out = Buffer.concat([header, jh, json, jp, bh, bin, bp]); fs.writeFileSync(outputPath, out);
console.log(JSON.stringify({ output: outputPath, bytes: out.length, sha256: createHash('sha256').update(out).digest('hex'), sourceSha256: src.sha256,
  restDrift: { translation: maxT, rotation: maxR }, clips: animations.map((c) => c.name), sockets: SOCKETS }));

