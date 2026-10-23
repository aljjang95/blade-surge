// 라이브러리 몸체 재결합 패커(메시를 굽히지 않는 몸 교체).
// base GLB(저작이 끝난 1단계 런타임 몸체)의 골격 노드·클립·스킨 관절 순서는 바이트 그대로 두고, Tripo 자체 리그 몸(body GLB)의
// 정점·가중치·재질을 Tripo 가 만든 모양 그대로 싣는다. 대신 역바인드 행렬을 새로 계산한다:
//   1) body 를 base 세계로 옮기는 닮음 변환 A(배율 = Hips→Head 길이 비, 어깨선 90° 단위 회전, 발바닥 높이·골반 수평 위치 일치)
//   2) base 골격을 회전만으로 굽혀 각 뼈 방향이 body 뼈 방향(A포즈 등)과 같아지는 자세 F 를 푼다(뼈 길이·이동은 그대로)
//   3) 역바인드 = F 자세 관절 세계 행렬의 역. F 자세에서 몸은 Tripo 원본 모양과 정확히 같고, 클립은 v4 골격 그대로 돈다.
// swap-library-body.mjs(blender_swap_body.py) 는 몸을 v4 관절 길이로 늘이고 A→T 로 메시를 굽혀서 Tripo 자동 가중치(땋은 머리·망토에
// 섞인 어깨·팔 가중치) 때문에 땋은 머리가 어깨 위로 끌려가고 망토가 사라졌다(2026-10-23 궁수 v5). 이 패커는 메시 정점을 닮음 변환만 한다.
// 활 소켓(뼈 자식 노드)은 손 관절 위치 차이만큼 손 로컬에서 옮겨 보이는 손바닥에 남게 한다.
// --sockets=none(기본): 활 소켓을 base 그대로 둔다. draw: 아래 5) 규칙으로 옮김(궁수 v6 실측에서 활 아래 림이 다리에 더 들어가 쓰지 않음).
// --lift=<m>: 발바닥 맞춤 뒤 몸을 세계 Y 로 더 올린다(대기 자세 접지 여유. 궁수 v6 는 0.012).
// --no-clips: 출력에서 클립을 뺀다(2·3단계 body-fit·정규화본처럼 1단계 클립을 공유하는 메시 전용 파일). 골격 노드·역바인드 규약은 같다.
// body 관절이 base 골격에 없으면(마법사·야만전사 1단계는 손가락 없는 25·33관절) 그 가중치를 base 에 있는 가장 가까운 조상 관절로 합친다.
//   node tools/art/rebind-library-body.mjs <base.glb> <body.glb> <출력.glb> [기록 JSON 문자열] [--lift=<m>] [--sockets=none|draw] [--no-clips]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { attackPhase } from '../../src/game/combat-motion.js';

// 만작 표본: 궁수 1타(hitAt 0.42)의 진행 0.41(test/ranger-library-model 만작 검사와 같은 값).
const FULL_DRAW = 0.41, BOW_HIT_AT = 0.42;

const argv = process.argv.slice(2), flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [basePath, bodyPath, outputPath, extraJson] = argv.filter((a) => !a.startsWith('--'));
const lift = Number(flags.lift || 0), socketMode = flags.sockets || 'none', noClips = 'no-clips' in flags;
for (const k of Object.keys(flags)) if (!['lift', 'sockets', 'no-clips'].includes(k)) throw new Error('unknown flag --' + k);
if (!['none', 'draw'].includes(socketMode)) throw new Error('--sockets must be none|draw');
if (!Number.isFinite(lift) || Math.abs(lift) > 0.05) throw new Error('--lift must be within ±0.05 m');
if (!outputPath) throw new Error('Usage: node tools/art/rebind-library-body.mjs base.glb body.glb output.glb [extras-json]');

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

const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function floats(g, bin, accessorIndex) {
  const acc = g.accessors[accessorIndex], view = g.bufferViews[acc.bufferView], comps = COMPS[acc.type];
  if (acc.componentType !== 5126) throw new Error('float accessor expected');
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0), stride = view.byteStride || comps * 4, out = new Float32Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = bin.readFloatLE(start + i * stride + c * 4);
  return out;
}

// ---- 장면 그래프(rest) ----
function graph(g) {
  const parent = new Map();
  g.nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  const local = (i) => {
    const n = g.nodes[i];
    if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix);
    return new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1])));
  };
  const cache = new Map();
  const world = (i) => {
    if (!cache.has(i)) cache.set(i, parent.has(i) ? world(parent.get(i)).clone().multiply(local(i)) : local(i));
    return cache.get(i).clone();
  };
  const byName = new Map(g.nodes.map((n, i) => [n.name, i]));
  return { parent, local, world, byName };
}
const G1 = graph(j), G2 = graph(b);
const norm = (name) => name.replace(/^mixamorig:?/, '');
const joints1 = j.skins[0].joints, joints2 = b.skins[0].joints;
const idx2 = new Map(joints2.map((n) => [norm(b.nodes[n].name), n]));
// Tripo Mixamo 프리셋 55관절은 끝 관절(HeadTop_End·손가락 4번)이 없다. 끝 관절은 가중치를 받지 않으므로 빠져도 된다
// (그 관절 쪽 뼈 방향은 맞추지 않고 부모 회전을 따른다). 끝이 아닌 관절이 없으면 멈춘다.
const isLeaf = (n) => !(j.nodes[n].children || []).some((c) => joints1.includes(c));
const missingJoints = joints1.filter((n) => !idx2.has(norm(j.nodes[n].name))).map((n) => norm(j.nodes[n].name));
const missing = joints1.filter((n) => !idx2.has(norm(j.nodes[n].name)) && !isLeaf(n)).map((n) => norm(j.nodes[n].name));
if (missing.length) throw new Error('body skeleton lacks base joints: ' + missing.join(','));
const pos = (G, i) => new THREE.Vector3().setFromMatrixPosition(G.world(i));
const j1 = (name) => joints1.find((n) => norm(j.nodes[n].name) === name);
const P1 = (name) => pos(G1, j1(name)), P2 = (name) => pos(G2, idx2.get(name));

// ---- 1) 닮음 변환 A: body 세계 → base 세계 ----
function meshMinY(g, bin, M) {
  const meshNode = g.nodes.findIndex((n) => n.skin != null && n.mesh != null); let min = Infinity;
  for (const p of g.meshes[g.nodes[meshNode].mesh].primitives) {
    const v = floats(g, bin, p.attributes.POSITION), t = new THREE.Vector3();
    for (let i = 0; i < v.length; i += 3) min = Math.min(min, t.set(v[i], v[i + 1], v[i + 2]).applyMatrix4(M).y);
  }
  return min;
}
// glTF 스킨 정점의 바인드 자세 세계 위치는 관절 세계 × 역바인드 × 정점이다(메시 노드 변환은 쓰이지 않는다). Tripo 원본은 이것이
// 메시 노드 세계와 같지만, 이미 정리된 body-fit·정규화본은 정점이 세계 단위라 메시 노드 배율(0.01 등)을 곱하면 안 된다.
function bindFrame(g, G, bin) {
  const meshNode = g.nodes.findIndex((n) => n.skin != null && n.mesh != null), joints = g.skins[0].joints;
  const acc = g.accessors[g.skins[0].inverseBindMatrices], m = floats(g, bin, g.skins[0].inverseBindMatrices);
  if (acc.type !== 'MAT4') throw new Error('inverseBindMatrices must be MAT4');
  const frames = joints.map((n, k) => G.world(n).multiply(new THREE.Matrix4().fromArray(m, k * 16)));
  const close = (x, y) => x.elements.every((e, k) => Math.abs(e - y.elements[k]) < 1e-4 * Math.max(1, Math.abs(e)));
  if (!frames.every((f) => close(f, frames[0]))) throw new Error('skin is not in its bind pose (joint world × IBM differs per joint)');
  return close(frames[0], G.world(meshNode)) ? { M: G.world(meshNode), source: 'mesh-node' } : { M: frames[0], source: 'skin-bind' };
}
const s = P1('Head').distanceTo(P1('Hips')) / P2('Head').distanceTo(P2('Hips'));
const yawOf = (P) => { const v = P('LeftArm').sub(P('RightArm')); return Math.atan2(v.x, v.z); };
const turn = Math.round((yawOf(P1) - yawOf(P2)) / (Math.PI / 2)) * (Math.PI / 2);
const R = new THREE.Matrix4().makeRotationY(turn), S = new THREE.Matrix4().makeScale(s, s, s);
const A = new THREE.Matrix4().multiplyMatrices(R, S);
const h1 = P1('Hips'), h2 = P2('Hips').applyMatrix4(A);
const baseBind = bindFrame(j, G1, base.bin), bodyBind = bindFrame(b, G2, body.bin);
const ground = meshMinY(j, base.bin, baseBind.M) - (meshMinY(b, body.bin, bodyBind.M) * s) + lift;
A.premultiply(new THREE.Matrix4().makeTranslation(h1.x - h2.x, ground, h1.z - h2.z));
const P2a = (name) => P2(name).applyMatrix4(A);

// ---- 2) 자세 F: base 골격을 회전만으로 body 뼈 방향에 맞춘다 ----
const NEXT = { Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End' };
for (const side of ['Left', 'Right']) {
  Object.assign(NEXT, { [side + 'Shoulder']: side + 'Arm', [side + 'Arm']: side + 'ForeArm', [side + 'ForeArm']: side + 'Hand', [side + 'Hand']: side + 'HandMiddle1',
    [side + 'UpLeg']: side + 'Leg', [side + 'Leg']: side + 'Foot', [side + 'Foot']: side + 'ToeBase', [side + 'ToeBase']: side + 'Toe_End' });
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) for (let k = 1; k < 4; k++) NEXT[side + 'Hand' + f + k] = side + 'Hand' + f + (k + 1);
}
const order = [...joints1].sort((x, y) => depth(x) - depth(y));
function depth(i) { let d = 0; while (G1.parent.has(i)) { i = G1.parent.get(i); d++; } return d; }
const worldF = new Map(), localRotF = new Map();
const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
let maxSwingDeg = 0;
for (const i of order) {
  const p = G1.parent.get(i), parentW = worldF.get(p) ?? G1.world(p);
  const restW = parentW.clone().multiply(G1.local(i));
  const name = norm(j.nodes[i].name), next = NEXT[name];
  let W = restW;
  if (next && j1(next) != null && idx2.has(next)) {
    const c = j1(next), cLocal = new THREE.Vector3(...(j.nodes[c].translation || [0, 0, 0]));
    const from = cLocal.clone().applyMatrix4(restW).sub(new THREE.Vector3().setFromMatrixPosition(restW));
    const to = P2a(next).sub(P2a(name));
    if (from.lengthSq() > 1e-12 && to.lengthSq() > 1e-12) {
      const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      maxSwingDeg = Math.max(maxSwingDeg, 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI);
      restW.decompose(tmpP, tmpQ, tmpS);
      W = new THREE.Matrix4().compose(tmpP.clone(), q.multiply(tmpQ.clone()), tmpS.clone());
    }
  }
  worldF.set(i, W);
  const pw = parentW.clone(); pw.decompose(tmpP, tmpQ, tmpS);
  const wq = new THREE.Quaternion(); W.decompose(new THREE.Vector3(), wq, new THREE.Vector3());
  localRotF.set(i, tmpQ.clone().invert().multiply(wq));
}
// 관절 위치 차이(F 자세 base 관절 ↔ body 관절)는 회전 중심 오차다. 기록으로 남긴다.
const jointGap = {};
for (const i of joints1) { const name = norm(j.nodes[i].name); if (!idx2.has(name)) continue; jointGap[name] = +(new THREE.Vector3().setFromMatrixPosition(worldF.get(i)).distanceTo(P2a(name))).toFixed(4); }

// ---- 3) 몸 메시 복사(정점·법선은 닮음 변환만) ----
// base 에 없는 body 관절은 body 골격에서 가장 가까운 조상 중 base 에 있는 관절로 합친다(손가락 → 손).
const collapsed = {};
const remap = joints2.map((n) => {
  let i = n;
  while (i != null && j1(norm(b.nodes[i].name)) == null) i = G2.parent.get(i);
  if (i == null) throw new Error('joint remap failed: ' + b.nodes[n].name);
  if (i !== n) collapsed[norm(b.nodes[n].name)] = norm(b.nodes[i].name);
  return joints1.indexOf(j1(norm(b.nodes[i].name)));
});
const mergeWeights = Object.keys(collapsed).length > 0;
const meshNode2 = b.nodes.findIndex((n) => n.skin != null && n.mesh != null);
// base 정점은 메시 노드 변환과 무관하게 세계 단위로 저장돼 있다(IBM = inverse(관절 세계), 스킨 정점 = J·IBM·v). 같은 규약으로 싣는다.
const vertexM = A.clone().multiply(bodyBind.M);
const normalM = new THREE.Matrix3().getNormalMatrix(vertexM);
const chunks = [base.bin], matMap = new Map(), texMap = new Map(), imgMap = new Map(), smpMap = new Map(), viewMap = new Map();
let binLength = base.bin.length;
const pad4 = () => { const p = (4 - (binLength % 4)) % 4; if (p) { chunks.push(Buffer.alloc(p)); binLength += p; } };
function addView(bytes, target) {
  pad4(); chunks.push(bytes);
  const view = { buffer: 0, byteOffset: binLength, byteLength: bytes.length };
  if (target) view.target = target;
  binLength += bytes.length; j.bufferViews.push(view); return j.bufferViews.length - 1;
}
function copyView(i) {
  if (!viewMap.has(i)) { const v = b.bufferViews[i];
    if (v.byteStride) throw new Error('interleaved body buffer views are not supported'); viewMap.set(i, addView(Buffer.from(body.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)), v.target)); }
  return viewMap.get(i);
}
function addFloatAccessor(values, type, target, withBounds) {
  const buf = Buffer.alloc(values.length * 4); values.forEach((x, k) => buf.writeFloatLE(x, k * 4));
  const comps = COMPS[type], acc = { bufferView: addView(buf, target), componentType: 5126, count: values.length / comps, type };
  if (withBounds) {
    acc.min = Array(comps).fill(Infinity); acc.max = Array(comps).fill(-Infinity);
    for (let k = 0; k < values.length; k++) { const c = k % comps; acc.min[c] = Math.min(acc.min[c], values[k]); acc.max[c] = Math.max(acc.max[c], values[k]); }
  }
  j.accessors.push(acc); return j.accessors.length - 1;
}
function copyAccessor(i, attr) {
  const a = structuredClone(b.accessors[i]);
  if (attr === 'POSITION' || attr === 'NORMAL' || attr === 'TANGENT') {
    const v = floats(b, body.bin, i), comps = COMPS[a.type], out = [], t = new THREE.Vector3();
    for (let k = 0; k < v.length; k += comps) {
      t.set(v[k], v[k + 1], v[k + 2]);
      if (attr === 'POSITION') t.applyMatrix4(vertexM); else t.applyMatrix3(normalM).normalize();
      out.push(t.x, t.y, t.z); if (comps === 4) out.push(v[k + 3]);
    }
    return addFloatAccessor(out, a.type, 34962, attr === 'POSITION');
  }
  if (attr === 'JOINTS_0') {
    const v = b.bufferViews[a.bufferView], size = { 5121: 1, 5123: 2 }[a.componentType];
    if (!size || a.type !== 'VEC4') throw new Error('unsupported JOINTS_0 accessor');
    const stride = v.byteStride || size * 4, start = (v.byteOffset || 0) + (a.byteOffset || 0), out = Buffer.alloc(a.count * 8);
    for (let n = 0; n < a.count; n++) for (let c = 0; c < 4; c++) {
      const value = size === 1 ? body.bin.readUInt8(start + n * stride + c) : body.bin.readUInt16LE(start + n * stride + c * 2);
      if (remap[value] === undefined) throw new Error('JOINTS_0 index out of body skin range: ' + value);
      out.writeUInt16LE(remap[value], n * 8 + c * 2);
    }
    a.bufferView = addView(out, 34962); a.byteOffset = 0; a.componentType = 5123;
  } else { a.bufferView = copyView(a.bufferView); }
  j.accessors.push(a); return j.accessors.length - 1;
}
// JOINTS_0·WEIGHTS_0 을 함께 옮긴다. 합쳐진 관절(같은 base 관절로 가는 body 관절)의 가중치는 더하고, 정점마다 큰 순 4개를 다시 정규화한다.
function copySkinWeights(jointsIndex, weightsIndex) {
  const ja = b.accessors[jointsIndex], wa = b.accessors[weightsIndex], jv = b.bufferViews[ja.bufferView], wv = b.bufferViews[wa.bufferView];
  const jSize = { 5121: 1, 5123: 2 }[ja.componentType], wSize = { 5126: 4, 5121: 1, 5123: 2 }[wa.componentType];
  if (!jSize || ja.type !== 'VEC4' || !wSize || wa.type !== 'VEC4' || ja.count !== wa.count) throw new Error('unsupported JOINTS_0/WEIGHTS_0 accessor');
  if (wSize !== 4 && !wa.normalized) throw new Error('integer WEIGHTS_0 must be normalized');
  const jStride = jv.byteStride || jSize * 4, wStride = wv.byteStride || wSize * 4;
  const jStart = (jv.byteOffset || 0) + (ja.byteOffset || 0), wStart = (wv.byteOffset || 0) + (wa.byteOffset || 0);
  const outJ = Buffer.alloc(ja.count * 8), outW = new Float32Array(ja.count * 4);
  for (let n = 0; n < ja.count; n++) {
    const acc = new Map();
    for (let c = 0; c < 4; c++) {
      const value = jSize === 1 ? body.bin.readUInt8(jStart + n * jStride + c) : body.bin.readUInt16LE(jStart + n * jStride + c * 2);
      const at = wStart + n * wStride + c * wSize;
      const w = wSize === 4 ? body.bin.readFloatLE(at) : wSize === 1 ? body.bin.readUInt8(at) / 255 : body.bin.readUInt16LE(at) / 65535;
      if (w <= 0) continue;
      if (remap[value] === undefined) throw new Error('JOINTS_0 index out of body skin range: ' + value);
      acc.set(remap[value], (acc.get(remap[value]) || 0) + w);
    }
    const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4), total = top.reduce((t, [, w]) => t + w, 0) || 1;
    top.forEach(([k, w], c) => { outJ.writeUInt16LE(k, n * 8 + c * 2); outW[n * 4 + c] = w / total; });
  }
  const jointsOut = { bufferView: addView(outJ, 34962), componentType: 5123, count: ja.count, type: 'VEC4' };
  j.accessors.push(jointsOut);
  return { JOINTS_0: j.accessors.length - 1, WEIGHTS_0: addFloatAccessor([...outW], 'VEC4', 34962, false) };
}
function copySampler(i) {
  if (i == null) return undefined;
  if (!smpMap.has(i)) { (j.samplers ||= []).push(structuredClone(b.samplers[i])); smpMap.set(i, j.samplers.length - 1); }
  return smpMap.get(i);
}
function copyImage(i) {
  if (!imgMap.has(i)) { const img = structuredClone(b.images[i]); img.bufferView = copyView(img.bufferView); (j.images ||= []).push(img); imgMap.set(i, j.images.length - 1); }
  return imgMap.get(i);
}
function copyTexture(i) {
  if (!texMap.has(i)) {
    const t = structuredClone(b.textures[i]);
    if (t.source != null) t.source = copyImage(t.source);
    for (const ext of Object.values(t.extensions || {})) if (ext.source != null) ext.source = copyImage(ext.source);
    const smp = copySampler(t.sampler); if (smp == null) delete t.sampler; else t.sampler = smp;
    (j.textures ||= []).push(t); texMap.set(i, j.textures.length - 1);
  }
  return texMap.get(i);
}
function remapTextures(o) {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && typeof v.index === 'number' && /Texture$/.test(k)) v.index = copyTexture(v.index); else remapTextures(v);
  }
}
function copyMaterial(i) {
  if (!matMap.has(i)) { const m = structuredClone(b.materials[i]); remapTextures(m); j.materials.push(m); matMap.set(i, j.materials.length - 1); }
  return matMap.get(i);
}
for (const ext of b.extensionsRequired || []) if (!(j.extensionsRequired || []).includes(ext)) throw new Error('body requires extension not in base: ' + ext);
for (const ext of b.extensionsUsed || []) if (!(j.extensionsUsed ||= []).includes(ext)) j.extensionsUsed.push(ext);
const bodyMesh = b.meshes[b.nodes[meshNode2].mesh];
j.meshes[0] = {
  name: bodyMesh.name || j.meshes[0].name,
  primitives: bodyMesh.primitives.map((p) => {
    if (p.targets?.length) throw new Error('morph targets are not supported');
    const attributes = {};
    for (const [name, acc] of Object.entries(p.attributes)) {
      if (/^(JOINTS|WEIGHTS)_[1-9]/.test(name)) throw new Error('only one joint/weight set is supported');
      if (mergeWeights && (name === 'JOINTS_0' || name === 'WEIGHTS_0')) continue;
      attributes[name] = copyAccessor(acc, name);
    }
    // 합친 관절이 없으면 가중치 바이트를 그대로 둔다(궁수 v6 재현: 같은 입력이면 같은 바이트).
    if (mergeWeights && p.attributes.JOINTS_0 != null) Object.assign(attributes, copySkinWeights(p.attributes.JOINTS_0, p.attributes.WEIGHTS_0));
    const prim = { attributes, mode: p.mode ?? 4 };
    if (p.indices != null) prim.indices = copyAccessor(p.indices, 'INDICES');
    if (p.material != null) prim.material = copyMaterial(p.material);
    return prim;
  }),
};

// ---- 4) 역바인드 = F 자세 관절 세계 행렬의 역(base 와 같은 규약: IBM = inverse(joint world)) ----
const ibm = [];
for (const i of joints1) ibm.push(...worldF.get(i).clone().invert().elements);
j.skins[0].inverseBindMatrices = addFloatAccessor(ibm, 'MAT4', undefined, false);

// ---- 5) 활 소켓: 보이는 손(Tripo 손 관절)이 base 손 관절에서 벗어난 만큼 옮긴다 ----
// 활 손(왼손) 그립은 F 자세 손 좌표계에서 Tripo 손 관절 위치만큼 옮긴다. 당김 노크(오른손)는 각자 옮기면 만작에서 시위가
// 활 평면을 벗어나므로, 만작 자세에서 활이 움직인 세계 변위와 같은 양만큼 오른손 로컬에서 옮긴다(만작의 활·노크 상대 자세 보존).
// 소켓 자체를 쓰는 다른 장비가 생기면 이 규칙을 다시 본다. 소켓이 없는 base 는 아무것도 하지 않는다.
function sampleRotation(anim, nodeIndex, time) {
  const ch = anim.channels.find((c) => c.target.node === nodeIndex && c.target.path === 'rotation');
  const rest = new THREE.Quaternion(...(j.nodes[nodeIndex].rotation || [0, 0, 0, 1]));
  if (!ch) return rest;
  const smp = anim.samplers[ch.sampler], times = floats(j, base.bin, smp.input), values = floats(j, base.bin, smp.output);
  let k = 0; while (k < times.length - 2 && times[k + 1] <= time) k++;
  const qa = new THREE.Quaternion().fromArray(values, k * 4), qb = new THREE.Quaternion().fromArray(values, Math.min(times.length - 1, k + 1) * 4);
  if (smp.interpolation === 'STEP' || times.length === 1) return qa;
  const u = Math.min(1, Math.max(0, (time - times[k]) / Math.max(1e-9, times[k + 1] - times[k])));
  return qa.slerp(qb, u);
}
function poseWorldQuat(anim, nodeIndex, time) {
  const chain = []; for (let i = nodeIndex; i != null; i = G1.parent.get(i)) chain.unshift(i);
  const out = new THREE.Quaternion();
  for (const i of chain) out.multiply(joints1.includes(i) ? sampleRotation(anim, i, time) : new THREE.Quaternion(...(j.nodes[i].rotation || [0, 0, 0, 1])));
  return out;
}
const sockets = {}, socketNodes = j.nodes.map((n, i) => i).filter((i) => {
  const p = G1.parent.get(i); return p != null && joints1.includes(p) && !joints1.includes(i) && j.nodes[i].mesh == null;
});
const handShift = (p) => P2a(norm(j.nodes[p].name)).applyMatrix4(worldF.get(p).clone().invert());
const scaleOf = (p) => new THREE.Vector3().setFromMatrixScale(G1.world(p)).x;
const grip = socketNodes.find((i) => j.nodes[i].name === 'RangerBowGrip_L'), nock = socketNodes.find((i) => j.nodes[i].name === 'RangerDrawNock_R');
const shifts = new Map();
if (grip != null && socketMode === 'draw') shifts.set(grip, handShift(G1.parent.get(grip)));
if (grip != null && nock != null && socketMode === 'draw') {
  const anim = j.animations.find((a) => a.name === 'bow_shoot');
  if (!anim) throw new Error('bow_shoot clip is required to place the draw nock');
  const tFull = attackPhase(FULL_DRAW, BOW_HIT_AT) * Math.max(...anim.samplers.map((smp) => j.accessors[smp.input].max[0]));
  const lp = G1.parent.get(grip), rp = G1.parent.get(nock);
  const worldShift = shifts.get(grip).clone().multiplyScalar(scaleOf(lp)).applyQuaternion(poseWorldQuat(anim, lp, tFull));
  shifts.set(nock, worldShift.applyQuaternion(poseWorldQuat(anim, rp, tFull).invert()).multiplyScalar(1 / scaleOf(rp)));
}
for (const i of socketNodes) {
  const delta = shifts.get(i); if (!delta) continue;
  const n = j.nodes[i], p = G1.parent.get(i), before = n.translation || [0, 0, 0];
  n.translation = before.map((x, k) => x + delta.getComponent(k));
  sockets[n.name] = { parent: j.nodes[p].name, shiftLocal: delta.toArray().map((x) => +x.toFixed(4)), shiftM: +(delta.length() * scaleOf(p)).toFixed(4) };
}

if (noClips) delete j.animations;

// ---- 6) 옛 몸 재질·텍스처·이미지·접근자·뷰 정리 후 BIN 재구성 ----
pad4();
const merged = Buffer.concat(chunks, binLength);
function compact() {
  const usedMat = new Set(j.meshes.flatMap((m) => m.primitives.map((p) => p.material)).filter((x) => x != null));
  const matIndex = new Map([...usedMat].sort((x, y) => x - y).map((m, k) => [m, k]));
  j.materials = [...matIndex.keys()].map((m) => j.materials[m]);
  for (const m of j.meshes) for (const p of m.primitives) if (p.material != null) p.material = matIndex.get(p.material);
  const walkTex = (o, fn) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && typeof v.index === 'number' && /Texture$/.test(k)) fn(v); else walkTex(v, fn); } };
  const usedTex = new Set(); walkTex(j.materials, (v) => usedTex.add(v.index));
  const texIndex = new Map([...usedTex].sort((x, y) => x - y).map((t, k) => [t, k]));
  walkTex(j.materials, (v) => { v.index = texIndex.get(v.index); });
  j.textures = [...texIndex.keys()].map((t) => j.textures[t]);
  const usedImg = new Set(j.textures.flatMap((t) => [t.source, ...Object.values(t.extensions || {}).map((e) => e.source)]).filter((x) => x != null));
  const imgIndex = new Map([...usedImg].sort((x, y) => x - y).map((t, k) => [t, k]));
  j.images = [...imgIndex.keys()].map((i) => j.images[i]);
  for (const t of j.textures) { if (t.source != null) t.source = imgIndex.get(t.source); for (const e of Object.values(t.extensions || {})) if (e.source != null) e.source = imgIndex.get(e.source); }
  const usedSmp = new Set(j.textures.map((t) => t.sampler).filter((x) => x != null));
  const smpIndex = new Map([...usedSmp].sort((x, y) => x - y).map((t, k) => [t, k]));
  j.samplers = [...smpIndex.keys()].map((i) => j.samplers[i]);
  for (const t of j.textures) if (t.sampler != null) t.sampler = smpIndex.get(t.sampler);
  const usedAcc = new Set();
  for (const m of j.meshes) for (const p of m.primitives) { Object.values(p.attributes).forEach((a) => usedAcc.add(a)); if (p.indices != null) usedAcc.add(p.indices); }
  for (const sk of j.skins) if (sk.inverseBindMatrices != null) usedAcc.add(sk.inverseBindMatrices);
  for (const an of j.animations || []) for (const smp of an.samplers) { usedAcc.add(smp.input); usedAcc.add(smp.output); }
  const accIndex = new Map([...usedAcc].sort((x, y) => x - y).map((a, k) => [a, k]));
  j.accessors = [...accIndex.keys()].map((a) => j.accessors[a]);
  for (const m of j.meshes) for (const p of m.primitives) {
    for (const n of Object.keys(p.attributes)) p.attributes[n] = accIndex.get(p.attributes[n]);
    if (p.indices != null) p.indices = accIndex.get(p.indices);
  }
  for (const sk of j.skins) if (sk.inverseBindMatrices != null) sk.inverseBindMatrices = accIndex.get(sk.inverseBindMatrices);
  for (const an of j.animations || []) for (const smp of an.samplers) { smp.input = accIndex.get(smp.input); smp.output = accIndex.get(smp.output); }
  if (j.accessors.some((a) => a.sparse)) throw new Error('sparse accessors are not supported');
  const usedView = new Set([...j.accessors.map((a) => a.bufferView), ...j.images.map((i) => i.bufferView)].filter((x) => x != null));
  const out = []; let length = 0; const viewIndex = new Map();
  for (const v of [...usedView].sort((x, y) => x - y)) {
    const view = j.bufferViews[v], bytes = merged.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const p = (4 - (length % 4)) % 4; if (p) { out.push(Buffer.alloc(p)); length += p; }
    viewIndex.set(v, { ...view, byteOffset: length }); out.push(bytes); length += bytes.length;
  }
  const keep = [...viewIndex.keys()];
  j.bufferViews = keep.map((v) => viewIndex.get(v));
  const remapView = new Map(keep.map((v, k) => [v, k]));
  for (const a of j.accessors) if (a.bufferView != null) a.bufferView = remapView.get(a.bufferView);
  for (const i of j.images) if (i.bufferView != null) i.bufferView = remapView.get(i.bufferView);
  const p = (4 - (length % 4)) % 4; if (p) { out.push(Buffer.alloc(p)); length += p; }
  return Buffer.concat(out, length);
}
const bin = compact();
j.buffers = [{ byteLength: bin.length }];
const { materialFinish: _staleFinish, bodySwap: _staleSwap, ...baseExtras } = j.asset.extras || {};
const rebind = { method: 'rotation-only-bind-pose', baseSha256: base.sha256, bodySha256: body.sha256, scale: +s.toFixed(6), liftM: lift, socketMode, ...(noClips ? { clips: 'none' } : {}),
  ...(Object.keys(collapsed).length ? { collapsedJoints: collapsed } : {}), ...(missingJoints.length ? { bodyMissingLeafJoints: missingJoints } : {}), ...(bodyBind.source !== 'mesh-node' ? { bodyBindFrame: bodyBind.source } : {}), yawDeg: Math.round(turn * 180 / Math.PI),
  maxSwingDeg: +maxSwingDeg.toFixed(2), maxJointGapM: Math.max(...Object.values(jointGap)), jointGapM: jointGap, sockets, ...(extraJson ? JSON.parse(extraJson) : {}) };
j.asset.extras = { ...baseExtras, bodyRebind: rebind };

const jsonBytes = Buffer.from(JSON.stringify(j)), jsonPad = Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonBytes.length + jsonPad.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const out = Buffer.concat([header, jsonHeader, jsonBytes, jsonPad, binHeader, bin]);
out.writeUInt32LE(out.length, 8);
fs.writeFileSync(outputPath, out);
console.log(JSON.stringify({ output: outputPath, bytes: out.length, sha256: createHash('sha256').update(out).digest('hex'), scale: rebind.scale, yawDeg: rebind.yawDeg,
  maxSwingDeg: rebind.maxSwingDeg, worstGaps: Object.entries(jointGap).sort((x, y) => y[1] - x[1]).slice(0, 6), sockets }));
