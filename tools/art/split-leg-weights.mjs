// 다리 가중치 좌우 분리(2026-10-29 여우 아바타 일그러짐). Tripo 자동 리그가 붙어 선 두 다리에 서로의 다리 뼈 가중치를 섞어
// (여우: 다리 정점 6,135개 중 4,112개가 반대쪽 다리 가중치 평균 27%) 달리기·피격·사망에서 다리를 벌리면 각 다리가 반대쪽으로 끌려
// 허벅지·부츠가 찢기고 뭉개졌다. 이 도구는 GLB 의 JOINTS_0·WEIGHTS_0 바이트만 고친다(정점·UV·재질·노드·역바인드·나머지 BIN 불변).
// 규칙(정점별, 바인드 세계 좌표):
//   - 좌우: 골반(Hips) 바인드 x 기준. 중앙 ±deadband 안은 건드리지 않는다.
//   - 높이: 사타구니(UpLeg 관절 높이)에서 fade 만큼 아래까지 0→1 로 늘어나는 비율 f 만큼, 반대쪽 다리 사슬(UpLeg·Leg·Foot·ToeBase·Toe_End)
//     가중치를 같은 쪽 같은 마디 뼈로 옮긴다(가중치 합·마디 수준 유지). 사타구니 위(치마·골반)는 그대로 둔다.
//   --floor=<m>: 이 높이 아래(발바닥·밑창)는 원래 가중치를 두고 위로 5cm 동안 비율을 0→1 로 올린다(접지 저작을 지킨다).
//   node tools/art/split-leg-weights.mjs <입력.glb> <출력.glb> [보고.json] [--fade=0.14] [--deadband=0.012] [--floor=0]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

const FLOOR_FADE = 0.05;
const LEG = /^(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End)$/;
const bare = (name) => String(name).replace(/^mixamorig:?/, '');

export function splitLegWeights(bytes, { fade: fadeLen = 0.14, deadband: dead = 0.012, floor: floorY = 0 } = {}) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = bytes.readUInt32LE(12), j = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binHeader = 20 + jsonLength, binStart = binHeader + 8, out = Buffer.from(bytes);
  if (j.skins?.length !== 1 || j.meshes?.length !== 1) throw new Error('몸 메시·스킨 하나만 지원');
  const skin = j.skins[0], names = skin.joints.map((n) => bare(j.nodes[n].name));
  const acc = (i) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView]; return { a, off: binStart + (v.byteOffset || 0) + (a.byteOffset || 0), stride: v.byteStride }; };
  const ib = acc(skin.inverseBindMatrices);
  const bindPos = (name) => {
    const k = names.indexOf(name); if (k < 0) throw new Error('관절 없음 ' + name);
    const m = new THREE.Matrix4().fromArray(Array.from({ length: 16 }, (_, c) => out.readFloatLE(ib.off + (k * 16 + c) * 4)));
    return new THREE.Vector3().setFromMatrixPosition(m.invert());
  };
  const hips = bindPos('Hips'), leftUp = bindPos('LeftUpLeg'), rightUp = bindPos('RightUpLeg');
  const leftSign = Math.sign(leftUp.x - hips.x);
  if (!leftSign || Math.sign(rightUp.x - hips.x) !== -leftSign) throw new Error('좌우 다리 관절 판정 실패');
  const crotch = (leftUp.y + rightUp.y) / 2;
  const counterpart = names.map((n) => { const m = LEG.exec(n); return m ? names.indexOf((m[1] === 'Left' ? 'Right' : 'Left') + m[2]) : -1; });
  const legSide = names.map((n) => { const m = LEG.exec(n); return m ? (m[1] === 'Left' ? 1 : -1) : 0; });
  // glTF 스킨 메시의 정점은 역바인드와 같은 공간이다(메시 노드 변환은 스킨에 쓰이지 않는다).
  const report = { crotchY: +crotch.toFixed(4), hipsX: +hips.x.toFixed(4), fade: fadeLen, deadband: dead, floor: floorY, primitives: [] };
  for (const prim of j.meshes[0].primitives) {
    const pos = acc(prim.attributes.POSITION), jo = acc(prim.attributes.JOINTS_0), we = acc(prim.attributes.WEIGHTS_0);
    if (prim.attributes.JOINTS_1 || prim.attributes.WEIGHTS_1) throw new Error('JOINTS_1 미지원');
    if (pos.a.componentType !== 5126 || we.a.componentType !== 5126 || ![5121, 5123].includes(jo.a.componentType)) throw new Error('float 위치·가중치, ubyte/ushort 관절만 지원');
    const js = jo.a.componentType === 5121 ? 1 : 2, jStride = jo.stride || 4 * js, wStride = we.stride || 16, pStride = pos.stride || 12;
    const readJ = (i, k) => js === 1 ? out.readUInt8(jo.off + i * jStride + k) : out.readUInt16LE(jo.off + i * jStride + k * 2);
    const writeJ = (i, k, v) => js === 1 ? out.writeUInt8(v, jo.off + i * jStride + k) : out.writeUInt16LE(v, jo.off + i * jStride + k * 2);
    const v = new THREE.Vector3(); let touched = 0, moved = 0, before = 0, after = 0;
    for (let i = 0; i < pos.a.count; i++) {
      v.set(out.readFloatLE(pos.off + i * pStride), out.readFloatLE(pos.off + i * pStride + 4), out.readFloatLE(pos.off + i * pStride + 8));
      const dx = v.x - hips.x, side = Math.abs(dx) <= dead ? 0 : Math.sign(dx) * leftSign;
      const slots = [0, 1, 2, 3].map((k) => ({ j: readJ(i, k), w: out.readFloatLE(we.off + i * wStride + k * 4) }));
      const opposite = slots.some((s) => s.w > 0 && legSide[s.j] === -side && side !== 0);
      if (slots.some((s) => s.w > 0.05 && legSide[s.j] === 1) && slots.some((s) => s.w > 0.05 && legSide[s.j] === -1)) before++;
      const f = side === 0 ? 0 : Math.min(1, Math.max(0, (crotch - v.y) / fadeLen), floorY > 0 ? Math.max(0, (v.y - floorY) / FLOOR_FADE) : 1);
      if (opposite && f > 0) {
        touched++;
        for (const s of slots) {
          if (!(s.w > 0) || legSide[s.j] !== -side) continue;
          const target = counterpart[s.j]; if (target < 0) continue;
          const give = s.w * f; moved += give;
          const into = slots.find((o) => o.j === target && o.w > 0) || (f === 1 ? s : slots.find((o) => !(o.w > 0)));
          if (into === s) { s.j = target; continue; }
          if (into) { into.j = target; into.w += give; s.w -= give; } else { s.j = target; }   // 빈 칸이 없으면 통째로 옮긴다
        }
        const sum = slots.reduce((a, s) => a + s.w, 0);
        slots.forEach((s, k) => { writeJ(i, k, s.w > 0 ? s.j : 0); out.writeFloatLE(s.w > 0 ? s.w / sum : 0, we.off + i * wStride + k * 4); });
      }
      const fin = [0, 1, 2, 3].map((k) => ({ j: readJ(i, k), w: out.readFloatLE(we.off + i * wStride + k * 4) }));
      if (fin.some((s) => s.w > 0.05 && legSide[s.j] === 1) && fin.some((s) => s.w > 0.05 && legSide[s.j] === -1)) after++;
    }
    report.primitives.push({ vertices: pos.a.count, touched, movedWeight: +moved.toFixed(3), bothLegsBefore: before, bothLegsAfter: after });
  }
  // JSON 청크·BIN 길이·다른 바이트는 그대로다. 바뀐 범위가 JOINTS_0·WEIGHTS_0 안인지 검사한다.
  const allowed = j.meshes[0].primitives.flatMap((p) => [p.attributes.JOINTS_0, p.attributes.WEIGHTS_0].map((index) => {
    const { off, a, stride } = acc(index); const size = a.type === 'VEC4' ? (a.componentType === 5126 ? 16 : a.componentType === 5123 ? 8 : 4) : 0;
    return [off, off + (stride || size) * a.count];
  }));
  for (let b = 0; b < out.length; b++) if (out[b] !== bytes[b] && !allowed.some(([lo, hi]) => b >= lo && b < hi)) throw new Error('허용 밖 바이트 변경 ' + b);
  return { bytes: out, report };
}

/**
 * 다리 번짐 진단(읽기 전용): 사타구니에서 below 만큼 아래·밑창(floor) 위에서, 몸 한쪽 정점이 반대쪽 다리 사슬 가중치를 threshold 넘게 가진 수.
 * @returns {{legVertices: number, bleeding: number, pct: number}}
 */
export function legBleed(bytes, { below = 0.14, floor = 0.06, deadband: dead = 0.012, threshold = 0.05 } = {}) {
  const jsonLength = bytes.readUInt32LE(12), j = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()), binStart = 20 + jsonLength + 8;
  const skin = j.skins[0], names = skin.joints.map((n) => bare(j.nodes[n].name));
  const view = (i) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView]; return { a, off: binStart + (v.byteOffset || 0) + (a.byteOffset || 0), stride: v.byteStride }; };
  const ib = view(skin.inverseBindMatrices);
  const bindPos = (name) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(Array.from({ length: 16 }, (_, c) => bytes.readFloatLE(ib.off + (names.indexOf(name) * 16 + c) * 4))).invert());
  const hips = bindPos('Hips'), leftUp = bindPos('LeftUpLeg'), rightUp = bindPos('RightUpLeg'), leftSign = Math.sign(leftUp.x - hips.x), crotch = (leftUp.y + rightUp.y) / 2;
  const legSide = names.map((n) => { const m = LEG.exec(n); return m ? (m[1] === 'Left' ? 1 : -1) : 0; });
  let legVertices = 0, bleeding = 0;
  for (const prim of j.meshes[0].primitives) {
    const pos = view(prim.attributes.POSITION), jo = view(prim.attributes.JOINTS_0), we = view(prim.attributes.WEIGHTS_0);
    const js = jo.a.componentType === 5121 ? 1 : 2, jStride = jo.stride || 4 * js, wStride = we.stride || 16, pStride = pos.stride || 12;
    if (we.a.componentType !== 5126) throw new Error('float 가중치만 지원');
    for (let i = 0; i < pos.a.count; i++) {
      const x = bytes.readFloatLE(pos.off + i * pStride), y = bytes.readFloatLE(pos.off + i * pStride + 4);
      if (y > crotch - below || y < floor) continue;
      const side = Math.abs(x - hips.x) <= dead ? 0 : Math.sign(x - hips.x) * leftSign;
      let opposite = 0, leg = 0;
      for (let k = 0; k < 4; k++) {
        const joint = js === 1 ? bytes.readUInt8(jo.off + i * jStride + k) : bytes.readUInt16LE(jo.off + i * jStride + k * 2), w = bytes.readFloatLE(we.off + i * wStride + k * 4);
        if (legSide[joint]) leg += w; if (side && legSide[joint] === -side) opposite += w;
      }
      if (leg > threshold) legVertices++;
      if (opposite > threshold) bleeding++;
    }
  }
  return { legVertices, bleeding, pct: Math.round(1e4 * bleeding / Math.max(1, legVertices)) / 100 };
}

if (import.meta.main ?? import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const [inputPath, outputPath, reportPath] = argv.filter((a) => !a.startsWith('--'));
  for (const k of Object.keys(flags)) if (!['fade', 'deadband', 'floor'].includes(k)) throw new Error('unknown flag --' + k);
  const fade = Number(flags.fade ?? 0.14), deadband = Number(flags.deadband ?? 0.012), floor = Number(flags.floor ?? 0);
  if (!outputPath) throw new Error('usage: node tools/art/split-leg-weights.mjs in.glb out.glb [report.json] [--fade=0.14] [--deadband=0.012]');
  if (!(fade > 0 && fade < 0.5) || !(deadband >= 0 && deadband < 0.1) || !(floor >= 0 && floor < 0.5)) throw new Error('fade 0~0.5, deadband 0~0.1, floor 0~0.5');
  if (fs.existsSync(outputPath)) throw new Error('출력이 이미 있다(덮어쓰지 않음): ' + outputPath);
  const input = fs.readFileSync(inputPath);
  const { bytes, report } = splitLegWeights(input, { fade, deadband, floor });
  fs.writeFileSync(outputPath, bytes);
  const full = { tool: 'tools/art/split-leg-weights.mjs', input: { path: inputPath, sha256: createHash('sha256').update(input).digest('hex') },
    output: { path: outputPath, sha256: createHash('sha256').update(bytes).digest('hex') }, ...report };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(full, null, 2) + '\n');
  console.log(JSON.stringify(full));
}
