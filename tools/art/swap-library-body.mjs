// 라이브러리 몸체 교체 패커.
// base GLB(저작이 끝난 1단계 런타임 몸체: 골격·클립·소켓·역바인드)의 노드·애니메이션·스킨 바이트는 그대로 두고,
// 스킨 몸 메시(정점·가중치·재질·텍스처)만 body GLB(tools/asset-library/blender_swap_body.py 가 같은 골격에 다시 묶어 내보낸 것)로 바꾼다.
// body 의 관절 이름은 base 스킨에 모두 있어야 하고, 같은 이름의 역바인드 행렬이 base 와 같아야 한다(같은 rest 에 묶였다는 증거).
//   node tools/art/swap-library-body.mjs <base.glb> <body.glb> <출력.glb> [기록 JSON 문자열]
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const [basePath, bodyPath, outputPath, extraJson] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node tools/art/swap-library-body.mjs base.glb body.glb output.glb [extras-json]');

function read(path) {
  const bytes = fs.readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binOffset = 20 + jsonLength;
  const bin = bytes.subarray(binOffset + 8, binOffset + 8 + bytes.readUInt32LE(binOffset));
  return { json, bin, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const base = read(basePath), body = read(bodyPath), j = structuredClone(base.json), b = body.json;
for (const g of [j, b]) if (g.extensionsUsed?.includes('EXT_meshopt_compression')) throw new Error('meshopt input is not supported');
if (j.meshes.length !== 1 || j.skins.length !== 1 || b.skins?.length !== 1) throw new Error('expected one skinned body mesh in base and body');

// 스칼라·행렬 접근자 값을 읽는다(float 전용).
function floats(g, bin, accessorIndex) {
  const acc = g.accessors[accessorIndex], view = g.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  if (acc.componentType !== 5126) throw new Error('float accessor expected');
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0), stride = view.byteStride || comps * 4, out = [];
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < comps; c++) out.push(bin.readFloatLE(start + i * stride + c * 4));
  return out;
}

// 1) 관절 대응과 역바인드 일치
const baseJoints = j.skins[0].joints.map((n) => j.nodes[n].name), bodyJoints = b.skins[0].joints.map((n) => b.nodes[n].name);
const ibmBase = floats(j, base.bin, j.skins[0].inverseBindMatrices), ibmBody = floats(b, body.bin, b.skins[0].inverseBindMatrices);
const remap = bodyJoints.map((name) => {
  const k = baseJoints.indexOf(name);
  if (k < 0) throw new Error('body joint missing in base skin: ' + name);
  return k;
});
let ibmDrift = 0;
bodyJoints.forEach((_, i) => { for (let c = 0; c < 16; c++) ibmDrift = Math.max(ibmDrift, Math.abs(ibmBody[i * 16 + c] - ibmBase[remap[i] * 16 + c])); });
// 행렬 성분은 cm 단위 이동을 포함하므로 0.01 이내만 같은 rest 로 본다.
if (ibmDrift > 0.01) throw new Error('inverse bind drift ' + ibmDrift + ' (body was not bound at the base rest pose)');

// 2) body 의 메시가 쓰는 접근자·뷰·재질·텍스처·이미지·샘플러를 base 에 덧붙인다.
const bodyMeshes = b.nodes.filter((n) => n.mesh != null && n.skin != null).map((n) => b.meshes[n.mesh]);
if (bodyMeshes.length !== 1) throw new Error('expected exactly one skinned mesh in body, got ' + bodyMeshes.length);
const chunks = [base.bin], viewMap = new Map(), accMap = new Map(), matMap = new Map(), texMap = new Map(), imgMap = new Map(), smpMap = new Map();
let binLength = base.bin.length;
const pad4 = () => { const p = (4 - (binLength % 4)) % 4; if (p) { chunks.push(Buffer.alloc(p)); binLength += p; } };
function addView(v, bytes) {
  pad4(); chunks.push(bytes);
  const view = { buffer: 0, byteOffset: binLength, byteLength: bytes.length };
  if (v.byteStride) view.byteStride = v.byteStride;
  if (v.target) view.target = v.target;
  binLength += bytes.length; j.bufferViews.push(view); return j.bufferViews.length - 1;
}
function copyView(i) {
  if (viewMap.has(i)) return viewMap.get(i);
  const v = b.bufferViews[i], bytes = Buffer.from(body.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
  const k = addView(v, bytes); viewMap.set(i, k); return k;
}
function copyAccessor(i, joints = false) {
  const key = i + (joints ? ':j' : '');
  if (accMap.has(key)) return accMap.get(key);
  const a = structuredClone(b.accessors[i]);
  if (joints) {
    // JOINTS_0 값을 base 스킨 순서로 바꾼다.
    const v = b.bufferViews[a.bufferView], size = { 5121: 1, 5123: 2 }[a.componentType];
    if (!size || a.type !== 'VEC4') throw new Error('unsupported JOINTS_0 accessor');
    const stride = v.byteStride || size * 4, start = (v.byteOffset || 0) + (a.byteOffset || 0);
    const out = Buffer.alloc(a.count * 8);
    for (let n = 0; n < a.count; n++) for (let c = 0; c < 4; c++) {
      const value = size === 1 ? body.bin.readUInt8(start + n * stride + c) : body.bin.readUInt16LE(start + n * stride + c * 2);
      out.writeUInt16LE(remap[value] ?? 0, n * 8 + c * 2);
    }
    a.bufferView = addView({ target: v.target }, out); a.byteOffset = 0; a.componentType = 5123;
  } else a.bufferView = copyView(a.bufferView);
  j.accessors.push(a); accMap.set(key, j.accessors.length - 1); return j.accessors.length - 1;
}
function copySampler(i) {
  if (i == null) return undefined;
  if (!smpMap.has(i)) { (j.samplers ||= []).push(structuredClone(b.samplers[i])); smpMap.set(i, j.samplers.length - 1); }
  return smpMap.get(i);
}
function copyImage(i) {
  if (!imgMap.has(i)) {
    const img = structuredClone(b.images[i]); img.bufferView = copyView(img.bufferView);
    (j.images ||= []).push(img); imgMap.set(i, j.images.length - 1);
  }
  return imgMap.get(i);
}
function copyTexture(i) {
  if (!texMap.has(i)) {
    const t = structuredClone(b.textures[i]);
    if (t.source != null) t.source = copyImage(t.source);
    for (const ext of Object.values(t.extensions || {})) if (ext.source != null) ext.source = copyImage(ext.source);
    const s = copySampler(t.sampler); if (s == null) delete t.sampler; else t.sampler = s;
    (j.textures ||= []).push(t); texMap.set(i, j.textures.length - 1);
  }
  return texMap.get(i);
}
function remapTextures(o) {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && typeof v.index === 'number' && /Texture$/.test(k)) v.index = copyTexture(v.index);
    else remapTextures(v);
  }
}
function copyMaterial(i) {
  if (!matMap.has(i)) { const m = structuredClone(b.materials[i]); remapTextures(m); j.materials.push(m); matMap.set(i, j.materials.length - 1); }
  return matMap.get(i);
}
for (const ext of b.extensionsUsed || []) if (!(j.extensionsUsed ||= []).includes(ext)) j.extensionsUsed.push(ext);
j.meshes[0] = {
  name: bodyMeshes[0].name || j.meshes[0].name,
  primitives: bodyMeshes[0].primitives.map((p) => {
    const attributes = {};
    for (const [name, acc] of Object.entries(p.attributes)) attributes[name] = copyAccessor(acc, name === 'JOINTS_0');
    const prim = { attributes, mode: p.mode ?? 4 };
    if (p.indices != null) prim.indices = copyAccessor(p.indices);
    if (p.material != null) prim.material = copyMaterial(p.material);
    return prim;
  }),
};
if (j.meshes[0].primitives.some((p) => Object.keys(p.attributes).some((n) => /^(JOINTS|WEIGHTS)_[1-9]/.test(n)))) throw new Error('only one joint/weight set is supported');

// 3) 옛 몸 재질·텍스처·이미지와 아무도 쓰지 않는 버퍼 뷰를 걷어 내고 BIN 을 다시 채운다(전달 크기).
pad4();
const merged = Buffer.concat(chunks, binLength);
function compact() {
  const usedMat = new Set(j.meshes.flatMap((m) => m.primitives.map((p) => p.material)).filter((x) => x != null));
  const matIndex = new Map([...usedMat].sort((x, y) => x - y).map((m, k) => [m, k]));
  j.materials = [...matIndex.keys()].map((m) => j.materials[m]);
  for (const m of j.meshes) for (const p of m.primitives) if (p.material != null) p.material = matIndex.get(p.material);
  const usedTex = new Set();
  (function walk(o) { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && typeof v.index === 'number' && /Texture$/.test(k)) usedTex.add(v.index); else walk(v); } })(j.materials);
  const texIndex = new Map([...usedTex].sort((x, y) => x - y).map((t, k) => [t, k]));
  (function walk(o) { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && typeof v.index === 'number' && /Texture$/.test(k)) v.index = texIndex.get(v.index); else walk(v); } })(j.materials);
  j.textures = [...texIndex.keys()].map((t) => j.textures[t]);
  const usedImg = new Set(j.textures.flatMap((t) => [t.source, ...Object.values(t.extensions || {}).map((e) => e.source)]).filter((x) => x != null));
  const imgIndex = new Map([...usedImg].sort((x, y) => x - y).map((t, k) => [t, k]));
  j.images = [...imgIndex.keys()].map((i) => j.images[i]);
  for (const t of j.textures) { if (t.source != null) t.source = imgIndex.get(t.source); for (const e of Object.values(t.extensions || {})) if (e.source != null) e.source = imgIndex.get(e.source); }
  // 접근자는 스킨·애니메이션·메시가 인덱스로 가리키므로 남기고, 쓰이지 않는 접근자는 0바이트로만 줄이지 않는다(인덱스 보존). 옛 메시 접근자는 떼어 낸다.
  const usedAcc = new Set();
  for (const m of j.meshes) for (const p of m.primitives) { Object.values(p.attributes).forEach((a) => usedAcc.add(a)); if (p.indices != null) usedAcc.add(p.indices); for (const t of p.targets || []) Object.values(t).forEach((a) => usedAcc.add(a)); }
  for (const s of j.skins) if (s.inverseBindMatrices != null) usedAcc.add(s.inverseBindMatrices);
  for (const an of j.animations || []) for (const s of an.samplers) { usedAcc.add(s.input); usedAcc.add(s.output); }
  const accIndex = new Map([...usedAcc].sort((x, y) => x - y).map((a, k) => [a, k]));
  j.accessors = [...accIndex.keys()].map((a) => j.accessors[a]);
  for (const m of j.meshes) for (const p of m.primitives) {
    for (const n of Object.keys(p.attributes)) p.attributes[n] = accIndex.get(p.attributes[n]);
    if (p.indices != null) p.indices = accIndex.get(p.indices);
    for (const t of p.targets || []) for (const n of Object.keys(t)) t[n] = accIndex.get(t[n]);
  }
  for (const s of j.skins) if (s.inverseBindMatrices != null) s.inverseBindMatrices = accIndex.get(s.inverseBindMatrices);
  for (const an of j.animations || []) for (const s of an.samplers) { s.input = accIndex.get(s.input); s.output = accIndex.get(s.output); }
  if (j.accessors.some((a) => a.sparse)) throw new Error('sparse accessors are not supported');
  const usedView = new Set([...j.accessors.map((a) => a.bufferView), ...j.images.map((i) => i.bufferView)].filter((x) => x != null));
  const out = []; let length = 0; const viewIndex = new Map();
  for (const v of [...usedView].sort((x, y) => x - y)) {
    const view = j.bufferViews[v], bytes = merged.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const p = (4 - (length % 4)) % 4; if (p) { out.push(Buffer.alloc(p)); length += p; }
    viewIndex.set(v, { ...view, byteOffset: length }); out.push(bytes); length += bytes.length;
  }
  const order = [...viewIndex.keys()];
  j.bufferViews = order.map((v) => viewIndex.get(v));
  const remapView = new Map(order.map((v, k) => [v, k]));
  for (const a of j.accessors) if (a.bufferView != null) a.bufferView = remapView.get(a.bufferView);
  for (const i of j.images) if (i.bufferView != null) i.bufferView = remapView.get(i.bufferView);
  const p = (4 - (length % 4)) % 4; if (p) { out.push(Buffer.alloc(p)); length += p; }
  return Buffer.concat(out, length);
}
const bin = compact();
j.buffers = [{ byteLength: bin.length }];
j.asset.extras = { ...(j.asset.extras || {}), bodySwap: { baseSha256: base.sha256, bodySha256: body.sha256, ibmDrift, ...(extraJson ? JSON.parse(extraJson) : {}) } };

const jsonBytes = Buffer.from(JSON.stringify(j)), jsonPad = Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonBytes.length + jsonPad.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const out = Buffer.concat([header, jsonHeader, jsonBytes, jsonPad, binHeader, bin]);
out.writeUInt32LE(out.length, 8);
fs.writeFileSync(outputPath, out);
console.log(JSON.stringify({ output: outputPath, bytes: out.length, sha256: createHash('sha256').update(out).digest('hex'), ibmDrift, joints: bodyJoints.length }));
