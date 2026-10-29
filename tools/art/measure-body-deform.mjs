// 영웅·아바타 몸의 스킨 일그러짐을 잰다(2026-10-29 대표님 "궁수 아바타가 일그러져 있다").
// 실제 게임 경로(loadHeroAsset → spawnCharacter)의 SkinnedMesh 를 영웅 클립마다 9 시점(0, 1/8 … 1)으로 굽혀,
// 바인드 자세 대비 삼각형 변 길이 비를 잰다. 시점마다 전체 배율(변 길이 비 중앙값)로 나눠 크기 차이는 뺀다.
//   찢김(torn): 한 변이라도 1.6배 넘게 늘어난 삼각형. 관절 접힘(눌림)은 정상 변형에도 흔해 판정에서 뺀다.
//   tornPct = 찢긴 삼각형 수 / (삼각형 수 × 시점 수) × 100. 클립별·관절(첫 정점의 최대 가중치 뼈)별로 남긴다.
// 같은 영웅 기본 몸과 비교하는 것이 판정의 기준이다(test/avatar-body-deform.test.ts).
//   bun tools/art/measure-body-deform.mjs <자산 id>[,<자산 id>…] [보고.json] [--body=<자산 id>=<파일 경로>]
//   --body 는 교정 후보 GLB 를 그 자산의 게임 경로 대신 싣는다(파일 해시 계약은 건드리지 않는 측정 전용).
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as THREE from 'three';
import manifest from '../../asset-library/manifest.json' with { type: 'json' };
import { installRangerRuntimeLoader, overrides } from './ranger-runtime-loader.mjs';
import { loadHeroAsset, spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';
import { resolveAssetSource } from '../../src/engine/library-assets.js';

export const TORN_RATIO = 1.6;
export const SAMPLES = 8;
const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;

/** 몸 메시 하나를 준비한다(바인드 변 길이). */
function prepare(mesh) {
  const g = mesh.geometry, p = g.attributes.position, idx = g.index ? g.index.array : null;
  const tri = idx ? idx.length / 3 : p.count / 3, at = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k;
  const rest = new Float32Array(tri * 3), area = new Float32Array(tri), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  let total = 0;
  for (let t = 0; t < tri; t++) {
    for (let k = 0; k < 3; k++) { a.fromBufferAttribute(p, at(t, k)); b.fromBufferAttribute(p, at(t, (k + 1) % 3)); rest[t * 3 + k] = a.distanceTo(b); }
    a.fromBufferAttribute(p, at(t, 0)); b.fromBufferAttribute(p, at(t, 1)).sub(a); c.fromBufferAttribute(p, at(t, 2)).sub(a); area[t] = b.cross(c).length() / 2; total += area[t];
  }
  const sw = g.attributes.skinWeight, si = g.attributes.skinIndex, bone = new Uint16Array(tri);
  for (let t = 0; t < tri; t++) { const v = at(t, 0); let best = 0, w = -1; for (let k = 0; k < 4; k++) { const x = sw.getComponent(v, k); if (x > w) { w = x; best = si.getComponent(v, k); } } bone[t] = best; }
  return { mesh, tri, at, rest, area, totalArea: total, bone, minEdge: (hi - lo) * 1e-4, pos: new Float32Array(p.count * 3), count: p.count };
}

/** 현재 자세에서 찢긴 삼각형을 센다. */
function scan(q, torn, byBone) {
  const c = new THREE.Vector3(), pos = q.pos;
  for (let i = 0; i < q.count; i++) { q.mesh.getVertexPosition(i, c); pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z; }
  const len = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  const sample = [];
  for (let t = 0; t < q.tri; t += 7) if (q.rest[t * 3] > q.minEdge) sample.push(len(q.at(t, 0), q.at(t, 1)) / q.rest[t * 3]);
  sample.sort((x, y) => x - y);
  const norm = sample[sample.length >> 1] || 1;
  let count = 0, worst = 1, tornArea = 0;
  for (let t = 0; t < q.tri; t++) {
    let s = 1;
    for (let k = 0; k < 3; k++) { const r0 = q.rest[t * 3 + k]; if (r0 > q.minEdge) s = Math.max(s, len(q.at(t, k), q.at(t, (k + 1) % 3)) / r0 / norm); }
    worst = Math.max(worst, s);
    if (s > torn) { count++; tornArea += q.area[t]; const name = q.mesh.skeleton.bones[q.bone[t]].name.replace(/^mixamorig:?/, ''); byBone[name] = (byBone[name] || 0) + 1; }
  }
  return { count, worst, tornArea };
}

export async function measureBodyDeform(assetId, { torn = Number(process.env.BODY_DEFORM_TORN) || TORN_RATIO } = {}) {
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error('알 수 없는 자산: ' + assetId);
  const restore = installRangerRuntimeLoader();
  try {
    const gltf = await loadHeroAsset(asset), inst = spawnCharacter(gltf);
    const meshes = []; inst.root.traverse((o) => { if (o.isSkinnedMesh && o.userData.libraryBody) meshes.push(o); });
    if (!meshes.length) throw new Error('라이브러리 몸 메시 없음: ' + assetId);
    const prep = meshes.map(prepare), tris = prep.reduce((s, q) => s + q.tri, 0), totalArea = prep.reduce((s, q) => s + q.totalArea, 0);
    const clips = [...new Set(Object.values(inst.clips))].filter(Boolean);
    const out = { asset: assetId, body: resolveAssetSource(asset), tris, clips: {} };
    for (const clip of clips) {
      const byBone = {}; let count = 0, worst = 1, tornArea = 0;
      inst.mixer.stopAllAction(); const action = inst.mixer.clipAction(clip); action.reset().play();
      for (let s = 0; s <= SAMPLES; s++) {
        action.time = clip.duration * s / SAMPLES; inst.mixer.update(0); inst.root.updateMatrixWorld(true);
        for (const q of prep) { const r = scan(q, torn, byBone); count += r.count; tornArea += r.tornArea; worst = Math.max(worst, r.worst); }
      }
      action.stop();
      out.clips[clip.name] = { tornPct: round(100 * count / (tris * (SAMPLES + 1))), tornAreaPct: round(100 * tornArea / (totalArea * (SAMPLES + 1))), maxStretch: round(worst, 2),
        topBones: Object.fromEntries(Object.entries(byBone).sort((a, b) => b[1] - a[1]).slice(0, 5)) };
    }
    const list = Object.values(out.clips);
    out.maxTornPct = Math.max(...list.map((c) => c.tornPct));
    out.meanTornPct = round(list.reduce((s, c) => s + c.tornPct, 0) / list.length);
    out.maxTornAreaPct = Math.max(...list.map((c) => c.tornAreaPct));
    out.meanTornAreaPct = round(list.reduce((s, c) => s + c.tornAreaPct, 0) / list.length);
    disposeCharacter(inst.root, inst.mixer);
    return out;
  } finally { restore(); }
}

if (import.meta.main) {
  const args = process.argv.slice(2), plain = args.filter((a) => !a.startsWith('--'));
  for (const flag of args.filter((a) => a.startsWith('--body='))) {
    const [id, file] = flag.slice(7).split('=');
    const asset = manifest.assets.find((a) => a.id === id);
    if (!asset || !file) throw new Error('--body=<자산 id>=<파일>');
    overrides.set(resolveAssetSource(asset), pathToFileURL(resolve(file)));
  }
  const [ids, reportPath] = plain;
  if (!ids) throw new Error('usage: bun tools/art/measure-body-deform.mjs <asset>[,<asset>…] [report.json] [--body=<asset>=<file>]');
  const results = [];
  for (const id of ids.split(',')) {
    const r = await measureBodyDeform(id); results.push(r);
    const worstClip = Object.entries(r.clips).sort((a, b) => b[1].tornPct - a[1].tornPct)[0];
    console.log(`${id}\tmean ${r.meanTornPct}%\tmax ${r.maxTornPct}% (${worstClip[0]})\tarea mean ${r.meanTornAreaPct}% max ${r.maxTornAreaPct}%\t${JSON.stringify(worstClip[1].topBones)}`);
  }
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ tool: 'tools/art/measure-body-deform.mjs', tornRatio: TORN_RATIO, samples: SAMPLES + 1, results }, null, 2) + '\n');
}
