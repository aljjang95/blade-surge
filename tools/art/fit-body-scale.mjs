// 몸 전체 닮음 맞춤(메시 정점은 그대로, 모든 역바인드에 같은 균등 배율·이동을 곱한다).
// 1차 용암 오니 군주(avatar_barbarian_oni)는 메시가 1단계 골격보다 작게(키 1.24m, 어깨·손 폭 약 0.6배) 묶여 발바닥이 바닥 위 0.22m 에 떠 있었다.
// 런타임은 몸을 영웅의 기존(1단계) 골격에 다시 묶으므로 메시를 키우려면 역바인드에 닮음 사상 M 을 곱한다(rest 에서 그려지는 몸 = M·메시).
//   배율 s: 발바닥을 바닥(0)에 고정한 채, 메시가 실제로 접히는 관절 높이·폭(두 뼈 가중치 경계)이 골격 관절과 가장 가깝게 되는 최소제곱 값.
//   균등 배율이라 법선·비율·장식 모양이 그대로다(굽히거나 늘이지 않는다). 몸통·팔다리 관절 오차는 맞춤 전보다 줄어든다.
//   node tools/art/fit-body-scale.mjs <입력.glb> [출력.glb]   (출력 없이 부르면 측정만)
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { readGlb, accessorView, readAccessor, bare, bindMatchesRest } from './fit-leg-rest.mjs';

const PAIRS = [['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine2', 'Neck'], ['Neck', 'Head'],
  ...['Left', 'Right'].flatMap((s) => [[s + 'UpLeg', s + 'Leg'], [s + 'Leg', s + 'Foot'], [s + 'Shoulder', s + 'Arm'], [s + 'Arm', s + 'ForeArm'], [s + 'ForeArm', s + 'Hand']])];

export function planBodyScale(bytes) {
  const { json, bin } = readGlb(bytes);
  if (json.skins?.length !== 1 || json.meshes?.length !== 1 || json.meshes[0].primitives.length !== 1) throw new Error('expected one skinned body mesh');
  const skin = json.skins[0], prim = json.meshes[0].primitives[0];
  const inverses = readAccessor(json, bin, skin.inverseBindMatrices), pos = readAccessor(json, bin, prim.attributes.POSITION);
  const joints = readAccessor(json, bin, prim.attributes.JOINTS_0), weights = readAccessor(json, bin, prim.attributes.WEIGHTS_0);
  // 역바인드만 바꾸므로 원시 POSITION 으로는 이미 맞춘 파일을 알 수 없다. 역바인드가 노드 rest 와 같은 원본에만 적용한다.
  if (!bindMatchesRest(json, skin, inverses)) throw new Error('inverse binds differ from node rest (already fitted?); apply to the original only');
  const names = skin.joints.map((j) => bare(json.nodes[j].name));
  const rest = (k) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(inverses, k * 16).invert());
  let sole = Infinity, top = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { sole = Math.min(sole, pos[i]); top = Math.max(top, pos[i]); }
  const hips = names.indexOf('Hips'); if (hips < 0) throw new Error('Hips missing');
  const zc = rest(hips).z;
  // 관절별 (메시 경계 위치 - 축, 골격 관절 위치 - 축) 쌍. y 축은 바닥, x 축은 몸 중심선, z 는 골반 깊이.
  const samples = [];
  for (const [a, b] of PAIRS) {
    const ia = names.indexOf(a), ib = names.indexOf(b);
    if (ia < 0 || ib < 0) continue;
    let sx = 0, sy = 0, total = 0;
    for (let i = 0; i < pos.length / 3; i++) {
      let wa = 0, wb = 0;
      for (let c = 0; c < 4; c++) { const j = joints[i * 4 + c], w = weights[i * 4 + c]; if (j === ia) wa += w; else if (j === ib) wb += w; }
      const w = Math.min(wa, wb);
      if (w > 0.15) { sx += pos[i * 3] * w; sy += pos[i * 3 + 1] * w; total += w; }
    }
    if (!total) continue;
    const bone = rest(ib);
    samples.push({ joint: b, mesh: [sx / total, sy / total - sole], bone: [bone.x, bone.y] });
  }
  if (samples.length < 8) throw new Error('too few joint seams: ' + samples.length);
  let num = 0, den = 0;
  for (const { mesh, bone } of samples) for (let c = 0; c < 2; c++) { num += mesh[c] * bone[c]; den += mesh[c] * mesh[c]; }
  const s = num / den;
  if (!(s > 0.5 && s < 2)) throw new Error('scale out of range ' + s);
  const error = (k) => Math.sqrt(samples.reduce((sum, { mesh, bone }) => sum + (mesh[0] * k - bone[0]) ** 2 + (mesh[1] * k - bone[1]) ** 2, 0) / samples.length);
  // M: (x, y, z) → (x s, (y - sole) s, zc + (z - zc) s)
  const m = new THREE.Matrix4().set(s, 0, 0, 0, 0, s, 0, -sole * s, 0, 0, s, zc - zc * s, 0, 0, 0, 1);
  const next = new Float32Array(inverses.length);
  for (let k = 0; k < names.length; k++) next.set(new THREE.Matrix4().fromArray(inverses, k * 16).multiply(m).elements, k * 16);
  return { json, skin, next, report: { sole, top, heightBefore: top - sole, scale: s, heightAfter: (top - sole) * s, jointRmsBefore: Math.sqrt(samples.reduce((sum, { mesh, bone }) => sum + (mesh[0] - bone[0]) ** 2 + (mesh[1] + sole - bone[1]) ** 2, 0) / samples.length), jointRmsAfter: error(s), samples } };
}

export function writeBodyScale(bytes) {
  const plan = planBodyScale(bytes), { json, binStart } = readGlb(bytes);
  const { start, stride, acc } = accessorView(json, plan.skin.inverseBindMatrices);
  if (acc.componentType !== 5126 || stride !== 64) throw new Error('packed float MAT4 inverse binds expected');
  if (Math.abs(plan.report.sole) < 1e-3 && Math.abs(plan.report.scale - 1) < 0.02) throw new Error('already fits the skeleton (scale ≈ 1, sole 0)');
  const out = Buffer.from(bytes);
  for (let i = 0; i < plan.next.length; i++) out.writeFloatLE(plan.next[i], binStart + start + i * 4);
  return { bytes: out, report: plan.report };
}

if (process.argv[1]?.endsWith('fit-body-scale.mjs')) {
  const [input, output] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node tools/art/fit-body-scale.mjs input.glb [output.glb]');
  const bytes = fs.readFileSync(input), { bytes: out, report } = writeBodyScale(bytes);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  if (output) fs.writeFileSync(output, out);
  console.log(JSON.stringify({ input, inputSha256: sha(bytes), output: output || null, outputSha256: output ? sha(out) : null, ...report },
    (k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
}
