// 다리 rest 맞춤(메시 정점은 그대로, 역바인드 행렬만 고친다).
// 기사 2·3단계 몸(hero_knight_t2/t3)은 메시 다리가 1단계 골격 다리보다 약 30cm 길게 묶여 원래 발이 바닥 아래(-0.30m)에 있었다.
// 런타임은 몸을 영웅의 기존(1단계) 골격에 다시 묶으므로 뼈 길이는 못 바꾼다. 대신 다리 뼈마다 bind 공간 사상 M_b 를 역바인드에 곱한다:
//   발·발끝(과 자식): 세로 이동만(발바닥 → 몸 바닥 0). 발 모양·크기는 그대로라 등급 부츠 배율·접지 계산이 1단계와 같아진다.
//   정강이: 메시 무릎 → 뼈 무릎, 메시 발목 → 이동한 발목으로 세로 선형 사상.
//   허벅지: 뼈 골반 관절은 고정, 메시 무릎 → 뼈 무릎으로 세로 선형 사상.
// 관절 높이에서 이웃 사상이 같은 값을 내므로 관절 근처 섞인 가중치 정점이 찢어지지 않는다. 몸통·팔·머리 역바인드와 정점·가중치·UV·재질은 바이트 그대로다.
//   node tools/art/fit-leg-rest.mjs <입력.glb> <출력.glb>   (출력 없이 부르면 측정만)
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const SIDES = ['Left', 'Right'];

export function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binOffset = 20 + jsonLength, binStart = binOffset + 8;
  if (bytes.readUInt32LE(binOffset + 4) !== 0x004e4942) throw new Error('BIN chunk expected');
  return { json, binStart, bin: bytes.subarray(binStart, binStart + bytes.readUInt32LE(binOffset)) };
}

export function accessorView(json, index) {
  const acc = json.accessors[index], view = json.bufferViews[acc.bufferView], comps = COMPS[acc.type];
  const size = acc.componentType === 5126 ? 4 : acc.componentType === 5123 ? 2 : acc.componentType === 5121 ? 1 : 0;
  if (!size) throw new Error('unsupported componentType ' + acc.componentType);
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0), stride = view.byteStride || comps * size;
  return { acc, comps, size, start, stride };
}

export function readAccessor(json, bin, index) {
  const { acc, comps, size, start, stride } = accessorView(json, index);
  const out = new Float32Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < comps; c++) {
    const at = start + i * stride + c * size;
    let v = size === 4 ? bin.readFloatLE(at) : size === 2 ? bin.readUInt16LE(at) : bin.readUInt8(at);
    if (acc.normalized && size !== 4) v /= size === 2 ? 65535 : 255;
    out[i * comps + c] = v;
  }
  return out;
}

export const bare = (name) => String(name).replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, '');

/** GLB 하나의 다리 관절 높이(뼈 rest·메시 추정)와 새 역바인드를 계산한다. */
export function planLegRest(bytes) {
  const { json, bin } = readGlb(bytes);
  if (json.skins?.length !== 1 || json.meshes?.length !== 1) throw new Error('expected one skinned body mesh');
  const skin = json.skins[0], prim = json.meshes[0].primitives[0];
  if (json.meshes[0].primitives.length !== 1) throw new Error('expected one primitive');
  const node = json.nodes.find((n) => n.mesh === 0);
  if (node?.matrix || node?.translation || node?.rotation || node?.scale) throw new Error('mesh node must have identity transform');
  const inverses = readAccessor(json, bin, skin.inverseBindMatrices);
  const pos = readAccessor(json, bin, prim.attributes.POSITION);
  const joints = readAccessor(json, bin, prim.attributes.JOINTS_0), weights = readAccessor(json, bin, prim.attributes.WEIGHTS_0);
  const names = skin.joints.map((j) => bare(json.nodes[j].name));
  const slot = (n) => { const k = names.indexOf(n); if (k < 0) throw new Error('joint missing: ' + n); return k; };
  const restY = (k) => new THREE.Matrix4().fromArray(inverses, k * 16).invert().elements[13];
  let floor = Infinity;
  for (let i = 1; i < pos.length; i += 3) floor = Math.min(floor, pos[i]);
  // 자식 관계(발 아래 모든 관절은 발 사상을 따른다)
  const parentOf = new Map();
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));
  const under = (k, ancestor) => { for (let n = skin.joints[k]; n !== undefined; n = parentOf.get(n)) if (n === skin.joints[ancestor]) return true; return false; };
  // 두 뼈 가중치가 모두 있는 정점의 높이 평균(가중치 min 으로 가중) = 메시가 실제로 접히는 관절 높이
  const seam = (a, b) => {
    let sum = 0, total = 0;
    for (let i = 0; i < pos.length / 3; i++) {
      let wa = 0, wb = 0;
      for (let c = 0; c < 4; c++) { const j = joints[i * 4 + c], w = weights[i * 4 + c]; if (j === a) wa += w; else if (j === b) wb += w; }
      const w = Math.min(wa, wb);
      if (w > 0.15) { sum += pos[i * 3 + 1] * w; total += w; }
    }
    if (!total) throw new Error('no seam vertices between ' + names[a] + ' and ' + names[b]);
    return sum / total;
  };
  const maps = new Map(), report = { floor, sides: {} };
  for (const side of SIDES) {
    const up = slot(side + 'UpLeg'), leg = slot(side + 'Leg'), foot = slot(side + 'Foot');
    const hip = restY(up), knee = restY(leg), ankle = restY(foot);
    const meshKnee = seam(up, leg), meshAnkle = seam(leg, foot);
    let sole = Infinity;
    for (let i = 0; i < pos.length / 3; i++) {
      let w = 0;
      for (let c = 0; c < 4; c++) { const k = joints[i * 4 + c]; if (k === foot || under(k, foot)) w += weights[i * 4 + c]; }
      if (w > 0.5) sole = Math.min(sole, pos[i * 3 + 1]);
    }
    // 이미 맞춘 파일(발 rest 가 메시 발목 근처)에 다시 적용하면 두 번 옮겨진다.
    if (ankle - meshAnkle < 0.1) throw new Error(`${side} foot rest already near mesh ankle (${ankle.toFixed(3)} vs ${meshAnkle.toFixed(3)}); apply to the original only`);
    const lift = floor < -1e-4 ? -sole : 0;          // 발바닥을 몸 바닥 0 으로
    const ankleTarget = meshAnkle + lift;
    const thigh = (hip - knee) / (hip - meshKnee), shin = (knee - ankleTarget) / (meshKnee - meshAnkle);
    if (!(thigh > 0.3 && thigh <= 1.0001 && shin > 0.3 && shin <= 1.0001)) throw new Error(`${side} leg ratios out of range thigh=${thigh} shin=${shin}`);
    // 세로 사상 y' = a + (y - b) * s 를 4x4 로
    const vertical = (a, b, s) => new THREE.Matrix4().set(1, 0, 0, 0, 0, s, 0, a - b * s, 0, 0, 1, 0, 0, 0, 0, 1);
    maps.set(up, vertical(hip, hip, thigh));
    maps.set(leg, vertical(knee, meshKnee, shin));
    for (let k = 0; k < names.length; k++) if (k === foot || under(k, foot)) maps.set(k, vertical(ankleTarget, meshAnkle, 1));
    report.sides[side] = { hip, knee, ankle, meshKnee, meshAnkle, sole, lift, ankleTarget, thigh, shin };
  }
  const next = Float32Array.from(inverses);
  for (const [k, m] of maps) {
    const inv = new THREE.Matrix4().fromArray(inverses, k * 16).multiply(m);
    next.set(inv.elements, k * 16);
  }
  report.changedJoints = [...maps.keys()].map((k) => names[k]).sort();
  return { json, skin, inverses, next, report };
}

/** 역바인드 accessor 만 다시 쓴 GLB(나머지 바이트 그대로). */
export function writeLegRest(bytes) {
  const plan = planLegRest(bytes), { json, binStart } = readGlb(bytes);
  const { start, stride, acc } = accessorView(json, plan.skin.inverseBindMatrices);
  if (acc.componentType !== 5126 || stride !== 64) throw new Error('packed float MAT4 inverse binds expected');
  const out = Buffer.from(bytes);
  for (let i = 0; i < plan.next.length; i++) out.writeFloatLE(plan.next[i], binStart + start + i * 4);
  return { bytes: out, report: plan.report };
}

if (import.meta.main || process.argv[1]?.endsWith('fit-leg-rest.mjs')) {
  const [input, output] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node tools/art/fit-leg-rest.mjs input.glb [output.glb]');
  const bytes = fs.readFileSync(input);
  const { bytes: out, report } = writeLegRest(bytes);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  if (output) fs.writeFileSync(output, out);
  console.log(JSON.stringify({ input, inputSha256: sha(bytes), output: output || null, outputSha256: output ? sha(out) : null, bytes: out.length, ...report }, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v, 2));
}
