// 굳힌 뼈 경계 완화(2026-10-29 흡혈 백작 목 찢김). blender_clean_weights.py --head-rigid 1 은 얼굴·머리카락·턱을 Head 100% 로 묶어
// 얼굴이 따로 움직이던 결함을 고쳤지만, 그 경계 바로 바깥(옷깃·어깨·망토 깃) 정점은 Spine1·팔 가중치 그대로라 Head 100% 정점과 한
// 삼각형으로 이어진 곳이 고개·팔을 움직일 때마다 늘어나 찢겼다(달리기에서 찢긴 삼각형의 약 60%가 Head+Spine1/팔 조합, 몸 높이 60~75%).
// 이 도구는 굳힌 뼈(--bone, 기본 Head)를 100% 가진 정점은 그대로 두고(얼굴·머리카락 모양 불변), 그 바깥 --rings 고리 안의 정점만
// 이웃 평균으로 --iterations 번 고른다. 고리 바깥 정점과 굳힌 정점은 고정 기준이다. 같은 위치의 UV 이음 정점은 한 정점으로 묶어 같은
// 가중치를 받는다. GLB 의 JOINTS_0·WEIGHTS_0 바이트만 바꾼다(정점·UV·재질·노드·역바인드 불변, 허용 밖 변경은 실패).
//   --release=<관절> [--release-offset=<m>]: 그 관절 바인드 높이(+offset) 아래의 굳힌 정점은 굳힘을 풀어 함께 고른다. 흡혈 백작은 굳힌 Head 100%가
//   Head 관절 15~20cm 아래(어깨·가슴 깃, 몸 축에서 23cm 밖)까지 내려와 팔 가중치 정점과 바로 맞닿아 있었다.
//   node tools/art/soften-rigid-seam.mjs <입력.glb> <출력.glb> [보고.json] [--bone=Head] [--rings=3] [--iterations=8] [--release=Neck] [--release-offset=0]
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

const bare = (name) => String(name).replace(/^mixamorig:?/, '');

export function softenRigidSeam(bytes, { bone = 'Head', rings = 3, iterations = 8, release = '', releaseOffset = 0 } = {}) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = bytes.readUInt32LE(12), j = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()), binStart = 20 + jsonLength + 8;
  if (j.skins?.length !== 1 || j.meshes?.length !== 1 || j.meshes[0].primitives.length !== 1) throw new Error('몸 메시·스킨·프리미티브 하나만 지원');
  const out = Buffer.from(bytes), names = j.skins[0].joints.map((n) => bare(j.nodes[n].name)), rigid = names.indexOf(bone);
  if (rigid < 0) throw new Error('관절 없음 ' + bone);
  const prim = j.meshes[0].primitives[0];
  const view = (i) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView]; return { a, off: binStart + (v.byteOffset || 0) + (a.byteOffset || 0), stride: v.byteStride }; };
  const pos = view(prim.attributes.POSITION), jo = view(prim.attributes.JOINTS_0), we = view(prim.attributes.WEIGHTS_0), ix = view(prim.indices);
  if (prim.attributes.JOINTS_1 || prim.attributes.WEIGHTS_1) throw new Error('JOINTS_1 미지원');
  if (pos.a.componentType !== 5126 || we.a.componentType !== 5126 || ![5121, 5123].includes(jo.a.componentType)) throw new Error('float 위치·가중치, ubyte/ushort 관절만 지원');
  const n = pos.a.count, js = jo.a.componentType === 5121 ? 1 : 2, jStride = jo.stride || 4 * js, wStride = we.stride || 16, pStride = pos.stride || 12;
  const readJ = (i, k) => js === 1 ? out.readUInt8(jo.off + i * jStride + k) : out.readUInt16LE(jo.off + i * jStride + k * 2);
  const writeJ = (i, k, v) => js === 1 ? out.writeUInt8(v, jo.off + i * jStride + k) : out.writeUInt16LE(v, jo.off + i * jStride + k * 2);
  // 같은 위치 정점 묶기(UV·법선 이음)
  const key = (i) => [0, 4, 8].map((o) => Math.round(out.readFloatLE(pos.off + i * pStride + o) * 1e5)).join(',');
  const groupOf = new Int32Array(n), groups = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (!groups.has(k)) groups.set(k, groups.size); groupOf[i] = groups.get(k); }
  const g = groups.size, members = Array.from({ length: g }, () => []);
  for (let i = 0; i < n; i++) members[groupOf[i]].push(i);
  const neighbors = Array.from({ length: g }, () => new Set());
  const indexSize = ix.a.componentType === 5125 ? 4 : ix.a.componentType === 5123 ? 2 : 1;
  const readI = (t) => indexSize === 4 ? out.readUInt32LE(ix.off + t * 4) : indexSize === 2 ? out.readUInt16LE(ix.off + t * 2) : out.readUInt8(ix.off + t);
  for (let t = 0; t < ix.a.count; t += 3) {
    const v = [groupOf[readI(t)], groupOf[readI(t + 1)], groupOf[readI(t + 2)]];
    for (let k = 0; k < 3; k++) if (v[k] !== v[(k + 1) % 3]) { neighbors[v[k]].add(v[(k + 1) % 3]); neighbors[v[(k + 1) % 3]].add(v[k]); }
  }
  // 묶음별 조밀 가중치(첫 정점 기준; 같은 위치 정점의 가중치가 다르면 평균)
  const dense = Array.from({ length: g }, () => new Map());
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const w = out.readFloatLE(we.off + i * wStride + k * 4); if (!(w > 0)) continue;
    const m = dense[groupOf[i]], jj = readJ(i, k); m.set(jj, (m.get(jj) || 0) + w / members[groupOf[i]].length);
  }
  // --release=<관절>: 그 관절 바인드 높이(+offset) 아래의 굳힌 정점은 굳힘을 풀어 고르기 대상에 넣는다(가슴·어깨까지 내려온 굳힘).
  let releaseY = -Infinity;
  if (release) {
    const ib = view(j.skins[0].inverseBindMatrices), k = names.indexOf(release); if (k < 0) throw new Error('관절 없음 ' + release);
    const m = Array.from({ length: 16 }, (_, c) => out.readFloatLE(ib.off + (k * 16 + c) * 4));
    releaseY = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(m).invert()).y + releaseOffset;
  }
  const groupY = members.map((list) => out.readFloatLE(pos.off + list[0] * pStride + 4));
  const isRigid = dense.map((m, v) => (m.get(rigid) || 0) >= 0.999 && groupY[v] >= releaseY);
  const released = dense.filter((m, v) => (m.get(rigid) || 0) >= 0.999 && groupY[v] < releaseY).length;
  // 굳힌 정점에서 고리 거리
  const ring = new Int32Array(g).fill(-1), queue = [];
  for (let v = 0; v < g; v++) if (isRigid[v]) { ring[v] = 0; queue.push(v); }
  for (let q = 0; q < queue.length; q++) { const v = queue[q]; if (ring[v] >= rings) continue; for (const u of neighbors[v]) if (ring[u] < 0) { ring[u] = ring[v] + 1; queue.push(u); } }
  const free = []; for (let v = 0; v < g; v++) if (ring[v] > 0) free.push(v);
  for (let it = 0; it < iterations; it++) {
    const next = free.map((v) => {
      const acc = new Map(); let count = 0;
      for (const src of [v, ...neighbors[v]]) { const wgt = src === v ? 2 : 1; count += wgt; for (const [jj, w] of dense[src]) acc.set(jj, (acc.get(jj) || 0) + w * wgt); }
      for (const [jj, w] of acc) acc.set(jj, w / count);
      return acc;
    });
    free.forEach((v, i) => { dense[v] = next[i]; });
  }
  // 상위 4개로 줄이고 정규화해 쓴다(고친 묶음만).
  let changed = 0, rigidSeam = 0;
  for (const v of free) {
    const top = [...dense[v]].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, [, w]) => s + w, 0);
    if (top.some(([jj]) => jj === rigid)) rigidSeam++;
    for (const i of members[v]) {
      for (let k = 0; k < 4; k++) { writeJ(i, k, top[k] ? top[k][0] : 0); out.writeFloatLE(top[k] ? top[k][1] / sum : 0, we.off + i * wStride + k * 4); }
      changed++;
    }
  }
  const allowed = [jo, we].map(({ off, a, stride }) => [off, off + (stride || (a === jo.a ? 4 * js : 16)) * a.count]);
  for (let b = 0; b < out.length; b++) if (out[b] !== bytes[b] && !allowed.some(([lo, hi]) => b >= lo && b < hi)) throw new Error('허용 밖 바이트 변경 ' + b);
  return { bytes: out, report: { bone, rings, iterations, release: release || null, releaseOffset, vertices: n, weldedGroups: g, rigidGroups: isRigid.filter(Boolean).length, releasedGroups: released, releaseY: Number.isFinite(releaseY) ? +releaseY.toFixed(4) : null, softenedGroups: free.length, changedVertices: changed, softenedWithRigidBone: rigidSeam } };
}

if (import.meta.main ?? import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const [inputPath, outputPath, reportPath] = argv.filter((a) => !a.startsWith('--'));
  for (const k of Object.keys(flags)) if (!['bone', 'rings', 'iterations', 'release', 'release-offset'].includes(k)) throw new Error('unknown flag --' + k);
  const opts = { bone: flags.bone || 'Head', rings: Number(flags.rings ?? 3), iterations: Number(flags.iterations ?? 8), release: flags.release || '', releaseOffset: Number(flags['release-offset'] ?? 0) };
  if (!outputPath) throw new Error('usage: node tools/art/soften-rigid-seam.mjs in.glb out.glb [report.json] [--bone=Head] [--rings=3] [--iterations=8]');
  if (!(opts.rings >= 1 && opts.rings <= 400 && opts.iterations >= 1 && opts.iterations <= 64)) throw new Error('rings 1~400, iterations 1~64');
  if (fs.existsSync(outputPath)) throw new Error('출력이 이미 있다(덮어쓰지 않음): ' + outputPath);
  const input = fs.readFileSync(inputPath), { bytes, report } = softenRigidSeam(input, opts);
  fs.writeFileSync(outputPath, bytes);
  const full = { tool: 'tools/art/soften-rigid-seam.mjs', input: { path: inputPath, sha256: createHash('sha256').update(input).digest('hex') },
    output: { path: outputPath, sha256: createHash('sha256').update(bytes).digest('hex') }, ...report };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(full, null, 2) + '\n');
  console.log(JSON.stringify(full));
}
