// 망토·옷자락 밑단 맞춤. 다리 rest 맞춤(fit-leg-rest) 뒤 기사 2·3단계 몸은 다리가 짧아진 만큼 망토(팔·어깨·몸통 가중치)가
// 상대적으로 길어져 bind 자세에서 밑단이 바닥 아래 5~9cm까지 내려온다. 다리 밖 정점의 골반 아래 부분만 세로로 눌러 밑단을 바닥 위로 올린다:
//   y' = y + (1 - w다리)·(top - (top - y)·s - y)   (y < top, top = 골반 관절 rest 높이, s = (top - clearance) / (top - 밑단 최저))
// top 에서 이동량이 0 이고 다리 가중치에 비례해 줄어 이웃 정점과 이어진다(굽힘·회전 없음, 세로 배율만). 법선은 같은 세로 배율의 역전치로 고친다.
// 역바인드·가중치·UV·재질과 골반 위·다리 정점은 바이트 그대로다. 밑단이 이미 바닥 위면 거절한다(재적용 방지).
//   node tools/art/fit-cape-hem.mjs <입력.glb> [출력.glb] [--clearance=0.01]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { readGlb, readAccessor, accessorView, bare } from './fit-leg-rest.mjs';

const LEG = /^(Left|Right)(UpLeg|Leg|Foot|ToeBase|ToeEnd)$/;

export function planCapeHem(bytes, { clearance = 0.01 } = {}) {
  const { json, bin } = readGlb(bytes);
  if (json.skins?.length !== 1 || json.meshes?.length !== 1 || json.meshes[0].primitives.length !== 1) throw new Error('expected one skinned body mesh');
  const skin = json.skins[0], prim = json.meshes[0].primitives[0];
  const names = skin.joints.map((j) => bare(json.nodes[j].name)), hips = names.indexOf('Hips');
  if (hips < 0) throw new Error('joint missing: Hips');
  const inverses = readAccessor(json, bin, skin.inverseBindMatrices);
  const top = new THREE.Matrix4().fromArray(inverses, hips * 16).invert().elements[13];
  const pos = readAccessor(json, bin, prim.attributes.POSITION);
  const joints = readAccessor(json, bin, prim.attributes.JOINTS_0), weights = readAccessor(json, bin, prim.attributes.WEIGHTS_0);
  const legW = new Float32Array(pos.length / 3);
  let hem = Infinity;
  for (let i = 0; i < legW.length; i++) {
    for (let c = 0; c < 4; c++) if (LEG.test(names[joints[i * 4 + c]])) legW[i] += weights[i * 4 + c];
    if (legW[i] < 0.5) hem = Math.min(hem, pos[i * 3 + 1]);
  }
  if (hem >= 0) throw new Error(`hem already above floor (${hem.toFixed(4)}); nothing to fit`);
  const s = (top - clearance) / (top - hem);
  if (!(s > 0.8 && s < 1)) throw new Error(`hem squash out of range s=${s}`);
  const next = Float32Array.from(pos);
  let moved = 0, minAfter = Infinity;
  for (let i = 0; i < legW.length; i++) {
    const y = pos[i * 3 + 1], k = 1 - Math.min(1, legW[i]);
    if (y < top && k > 0) { next[i * 3 + 1] = y + k * (top - (top - y) * s - y); moved++; }
    if (legW[i] < 0.5) minAfter = Math.min(minAfter, next[i * 3 + 1]);
  }
  let normals = null;
  if (prim.attributes.NORMAL !== undefined) {
    const n = readAccessor(json, bin, prim.attributes.NORMAL);
    normals = Float32Array.from(n);
    for (let i = 0; i < legW.length; i++) {
      const k = 1 - Math.min(1, legW[i]);
      if (!(pos[i * 3 + 1] < top && k > 0)) continue;
      const sy = 1 + k * (s - 1), x = n[i * 3], y = n[i * 3 + 1] / sy, z = n[i * 3 + 2], len = Math.hypot(x, y, z) || 1;
      normals.set([x / len, y / len, z / len], i * 3);
    }
  }
  return { json, prim, next, normals, report: { top, hemBefore: hem, hemAfter: minAfter, squash: s, movedVertices: moved, vertices: legW.length } };
}

/** POSITION(과 NORMAL)·accessor min/max 만 다시 쓴 GLB(나머지 바이트 그대로). */
export function writeCapeHem(bytes, options) {
  const plan = planCapeHem(bytes, options), { binStart } = readGlb(bytes), out = Buffer.from(bytes);
  const write = (index, values) => {
    const { acc, start, stride } = accessorView(plan.json, index);
    if (acc.componentType !== 5126) throw new Error('float accessor expected');
    for (let i = 0; i < acc.count; i++) for (let c = 0; c < 3; c++) out.writeFloatLE(values[i * 3 + c], binStart + start + i * stride + c * 4);
  };
  write(plan.prim.attributes.POSITION, plan.next);
  if (plan.normals) write(plan.prim.attributes.NORMAL, plan.normals);
  // POSITION accessor 의 min.y 는 JSON 안이라 길이가 바뀔 수 있다. 바운딩은 런타임이 다시 계산하므로 min 은 그대로 두되 새 최저보다 낮아 유효하다.
  return { bytes: out, report: plan.report };
}

if (import.meta.main || process.argv[1]?.endsWith('fit-cape-hem.mjs')) {
  const args = process.argv.slice(2), flag = args.find((a) => a.startsWith('--clearance='));
  const [input, output] = args.filter((a) => !a.startsWith('--'));
  if (!input) throw new Error('Usage: node tools/art/fit-cape-hem.mjs input.glb [output.glb] [--clearance=0.01]');
  const bytes = fs.readFileSync(input);
  const { bytes: out, report } = writeCapeHem(bytes, flag ? { clearance: Number(flag.slice(12)) } : undefined);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  if (output) fs.writeFileSync(output, out);
  console.log(JSON.stringify({ input, inputSha256: sha(bytes), output: output || null, outputSha256: output ? sha(out) : null, bytes: out.length, ...report }, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v, 2));
}
