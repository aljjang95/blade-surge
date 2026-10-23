// Tripo 리그 GLB 받기 검사(PC·클라우드 공용, 의존성 없음). 몸 재결합 파이프라인에 넣기 전에 돌린다.
// 2026-10-23 궁수 3단계 t3: 받은 rigged.glb 의 관절 노드가 전부 원점(변환 없음)이고 정점 가중치가 모두 관절 하나에 1 이라 쓸 수 없었다.
//   node tools/art/check-tripo-rig.mjs <rigged.glb>   → 통과 exit 0, 실패 exit 1 (JSON 한 줄)
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/art/check-tripo-rig.mjs rigged.glb'); process.exit(2); }
const bytes = fs.readFileSync(file);
if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLength = bytes.readUInt32LE(12), j = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const bin = bytes.subarray(20 + jsonLength + 8);
const fails = [], skin = j.skins?.[0];
if (!skin) fails.push('스킨 없음');
const joints = skin?.joints || [];
const names = joints.map((n) => (j.nodes[n].name || '').replace(/^mixamorig:?/, ''));
for (const need of ['Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'LeftUpLeg', 'LeftFoot', 'RightUpLeg']) if (!names.includes(need)) fails.push('관절 없음: ' + need);
// 관절 노드 변환: 뼈가 실제로 놓여 있어야 한다(전부 원점이면 실패).
const moved = joints.filter((n) => { const x = j.nodes[n]; return (x.translation && x.translation.some((v) => Math.abs(v) > 1e-6)) || (x.matrix && x.matrix.slice(12, 15).some((v) => Math.abs(v) > 1e-6)); }).length;
if (joints.length && moved < joints.length / 2) fails.push(`관절 노드 ${joints.length}개 중 ${moved}개만 위치가 있음(뼈대가 원점에 겹침)`);
// 가중치: 여러 관절이 섞인 정점이 있어야 하고 쓰인 관절이 충분해야 한다.
let vertices = 0, multi = 0; const used = new Set();
for (const mesh of j.meshes || []) for (const p of mesh.primitives) {
  if (p.attributes.WEIGHTS_0 == null || p.attributes.JOINTS_0 == null) { fails.push('JOINTS_0/WEIGHTS_0 없음'); continue; }
  const wa = j.accessors[p.attributes.WEIGHTS_0], ja = j.accessors[p.attributes.JOINTS_0], wv = j.bufferViews[wa.bufferView], jv = j.bufferViews[ja.bufferView];
  const wSize = { 5126: 4, 5121: 1, 5123: 2 }[wa.componentType], jSize = { 5121: 1, 5123: 2 }[ja.componentType];
  const wStart = (wv.byteOffset || 0) + (wa.byteOffset || 0), jStart = (jv.byteOffset || 0) + (ja.byteOffset || 0);
  for (let i = 0; i < wa.count; i++) {
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const at = wStart + i * (wv.byteStride || wSize * 4) + k * wSize;
      const w = wSize === 4 ? bin.readFloatLE(at) : wSize === 1 ? bin.readUInt8(at) / 255 : bin.readUInt16LE(at) / 65535;
      if (w > 1e-4) { c++; const jt = jStart + i * (jv.byteStride || jSize * 4) + k * jSize; used.add(jSize === 1 ? bin.readUInt8(jt) : bin.readUInt16LE(jt)); }
    }
    vertices++; if (c > 1) multi++;
  }
}
if (vertices && multi / vertices < 0.1) fails.push(`여러 관절 가중치 정점 ${multi}/${vertices}(10% 미만, 스키닝 안 됨)`);
if (used.size < 15) fails.push(`가중치를 받는 관절 ${used.size}개(15개 미만)`);
const report = { file, ok: !fails.length, joints: joints.length, jointsWithTransform: moved, vertices, multiInfluence: multi, jointsUsed: used.size, bytes: bytes.length, fails };
console.log(JSON.stringify(report, null, 0));
process.exit(fails.length ? 1 : 0);
