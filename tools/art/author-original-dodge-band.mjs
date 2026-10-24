// 교정 기록이 없는 원본 몸(기사·야만전사·마법사 1·S·2·U·3단계와 아바타) 전용 구르기 골반 높이 "접지 띠" 곡선 저작기.
// 2026-10-25 t8: 원본 클립(영웅 1단계 GLB 의 공유 Dodge_Forward)을 그대로 쓰면 기사 1단계 -0.20m, 2·3단계 -0.29~-0.30m, 벚꽃 무사 -0.35m 까지
// 몸이 바닥을 판다. 궁수·도적 띠 곡선(author-tier-body-motion.mjs)과 같은 평활·자르기 반복이지만 띠 위쪽이 다르다.
//  - 아래: m(t)+o(t) ≥ -0.02m(구르기 수용 기준 -0.03m 안쪽 여유).
//  - 위: o(t) ≤ max(0.02 - m(t), 0). 원래 바닥에 닿아 있던 순간(m ≤ 0.02)에는 올려도 바닥 위 2cm 를 넘지 않고, 원래 공중이던 순간(도약)은 올리지 않는다.
//    그래서 o ≥ 0(올리기만)이고 원본 도약 높이·수평 이동·속도·길이·무적 시간은 그대로다.
// 표본은 240Hz 격자(원본 키 포함, 2.33초 클립이 런타임 표본 상한 1000 안). 출력은 오프셋(m)만 적고 런타임이 원본 보간값에 더한다.
//   bun tools/art/author-original-dodge-band.mjs <자산 id>[,<자산 id>…] <출력.json> [보고.json] [--band-low=<자산 id>:-0.025]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import manifest from '../../asset-library/manifest.json' with { type: 'json' };
import { installRangerRuntimeLoader } from './ranger-runtime-loader.mjs';
import { keyValue, trackSha } from './author-ranger-t1-body-motion.mjs';
import { loadHeroAsset, spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';
import { selectedBodyMotionIdentity } from '../../src/engine/hero-body-motion.js';

export const ORIGINAL_DODGE_PROFILE = Object.freeze({
  gridHz: 240, checkFactor: 4, iterations: 6000, band: [-.02, .01], accept: { low: -.03, liftedHigh: .03 }, limitMeters: .35,
});
const P = ORIGINAL_DODGE_PROFILE, HEROES = ['knight', 'barbarian', 'mage'];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const round6 = (x) => Math.round(x * 1e6) / 1e6;

function skinMinY(root) {
  let min = Infinity; const p = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; }
  });
  return min;
}

/** 자산 하나의 구르기 띠 곡선. 원본이 이미 수용 기준 안이면 null(기록하지 않음). */
// band: 자산별로 아래쪽만 수용 기준 안에서 더 내릴 수 있다(호박 기사: -0.02 면 오프셋 0.354m 로 상한 0.35m 초과 → -0.025).
export async function authorOriginalDodgeBand(assetId, band = P.band) {
  if (!(band.length === 2 && band[0] > P.accept.low && band[0] < 0 && band[1] === P.band[1])) throw new Error('띠는 수용 기준 안쪽: ' + assetId);
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset || !HEROES.includes(asset.heroId)) throw new Error('기사·야만전사·마법사 자산이 아님: ' + assetId);
  const identity = selectedBodyMotionIdentity(asset);
  if (identity.revisionId !== null || identity.path !== asset.file || identity.sha256 !== asset.sha256) throw new Error('원본 몸이 아님(교정 기록 있음): ' + assetId);
  const clipAsset = manifest.assets.find((a) => a.id === 'hero_' + asset.heroId + '_t1');
  const gltf = await loadHeroAsset(asset), inst = spawnCharacter(gltf);
  try {
    const clip = gltf.animations.find((c) => c.name === 'dodge'), track = clip?.tracks.find((t) => t.name === 'mixamorigHips.position');
    if (!track) throw new Error('구르기 골반 트랙 없음 ' + assetId);
    const hips = inst.root.getObjectByName('mixamorigHips'), parent = hips.parent;
    parent.updateWorldMatrix(true, false);
    // 골반 부모(Armature)의 world Y 행. KayKit 원본은 Z-up 이라 local Z 가 world -Y 다(궁수 v4 는 local Y).
    const e = parent.matrixWorld.elements, row = [e[1], e[5], e[9]], big = Math.max(...row.map(Math.abs)), axis = row.findIndex((x) => Math.abs(x) === big), gain = row[axis];
    if (!(big > 0) || row.some((x, i) => i !== axis && Math.abs(x) > 1e-5 * big)) throw new Error('골반 부모 축 ' + assetId);
    const measure = (t) => {
      inst.mixer.stopAllAction(); const a = inst.mixer.clipAction(clip); a.reset(); a.play(); a.time = t; inst.mixer.update(0);
      inst.root.updateMatrixWorld(true); return skinMinY(inst.root);
    };
    // 격자 점 중 원본 키(24fps, float32)와 1e-5초 안인 점은 원본 키 시간 그대로 쓴다(런타임이 원본 키 포함을 Object.is 로 검사).
    const keysT = Array.from(track.times), n = Math.round(clip.duration * P.gridHz);
    const grid = Array.from({ length: n + 1 }, (_, i) => { const t = Math.fround(clip.duration * i / n); return keysT.find((k) => Math.abs(k - t) < 1e-5) ?? t; });
    if (!keysT.every((t) => grid.includes(t)) || grid.some((t, i) => i && !(t > grid[i - 1])) || grid[n] !== clip.duration) throw new Error('원본 키가 격자에 없음 ' + assetId);
    const m = grid.map(measure);
    const dense = Array.from({ length: n * P.checkFactor + 1 }, (_, i) => clip.duration * i / (n * P.checkFactor)), dm = dense.map(measure);
    const raw = { min: round6(Math.min(...dm)), minAt: round6(dense[dm.indexOf(Math.min(...dm))]), max: round6(Math.max(...dm)), start: round6(m[0]), end: round6(m[n]) };
    if (raw.min > P.accept.low) return { asset: assetId, skipped: true, raw };
    const lo = m.map((y) => band[0] - y), hi = m.map((y) => Math.max(band[1] - y, 0));
    if (lo.some((x, i) => x > hi[i])) throw new Error('띠가 비었음 ' + assetId);
    if (lo[0] > 0 || lo[n] > 0) throw new Error('시작·끝 0 이 띠 밖 ' + assetId);
    const pinned = (i) => i === 0 || i === n;
    let o = grid.map((_, i) => (pinned(i) ? 0 : Math.min(hi[i], Math.max(lo[i], 0)))), iter = 0;
    for (; iter < P.iterations; iter++) {
      let change = 0;
      o = o.map((x, i) => {
        if (pinned(i)) return 0;
        const z = Math.min(hi[i], Math.max(lo[i], (o[i - 1] + 2 * x + o[i + 1]) / 4));
        change = Math.max(change, Math.abs(z - x)); return z;
      });
      if (change < 1e-7) break;
    }
    o = o.map((x) => Math.max(0, round6(x)));
    const keys = grid.map((t, i) => [t, o[i]]);
    let pen = { y: Infinity, t: 0 }, lifted = { y: -Infinity, t: 0 };
    dense.forEach((t, i) => {
      const off = keyValue(keys, t), y = dm[i] + off;
      if (y < pen.y) pen = { y, t };
      if (off > 1e-6 && y > lifted.y) lifted = { y, t };
    });
    let step = 0; for (let i = 1; i <= n; i++) step = Math.max(step, Math.abs(o[i] - o[i - 1]));
    const maxOffset = Math.max(...o);
    const pass = pen.y > P.accept.low && lifted.y < P.accept.liftedHigh && maxOffset <= P.limitMeters;
    return {
      asset: assetId, heroId: asset.heroId, body: { path: identity.path, sha256: identity.sha256 },
      base: { asset: clipAsset.id, path: clipAsset.file, sha256: clipAsset.sha256, clip: 'dodge', duration: clip.duration, hipsTrack: track.name, sourceTrackSha256: trackSha(track) },
      authoring: { profileId: assetId + '-dodge-contact-band-01', parentWorldYAxis: axis, parentWorldYGain: gain, gridHz: P.gridHz, samples: n + 1, interpolation: 'LINEAR',
        bandMeters: band, maxOffsetMeters: maxOffset, smoothingIterations: iter, maxStepMetersPerSample: round6(step) },
      offsetsMeters: o,
      validation: { densePenetrationMinMeters: round6(pen.y), densePenetrationAt: round6(pen.t), denseLiftedMaxMeters: round6(lifted.y), denseLiftedAt: round6(lifted.t),
        acceptance: P.accept, pass, rawSkinMeters: raw },
    };
  } finally { disposeCharacter(inst.root, inst.mixer); }
}

if (import.meta.main) {
  const args = process.argv.slice(2), [ids, out, reportPath] = args.filter((a) => !a.startsWith('--'));
  const lows = Object.fromEntries(args.filter((a) => a.startsWith('--band-low=')).map((a) => { const [id, v] = a.slice(11).split(':'); return [id, [Number(v), P.band[1]]]; }));
  if (!out) throw new Error('usage: bun tools/art/author-original-dodge-band.mjs <id,id…> <out.json> [report.json]');
  const restore = installRangerRuntimeLoader(), bodies = [], report = [];
  try {
    for (const id of ids.split(',')) {
      const r = await authorOriginalDodgeBand(id, lows[id]);
      report.push(r.skipped ? r : { asset: id, raw: r.validation.rawSkinMeters, after: { min: r.validation.densePenetrationMinMeters, liftedMax: r.validation.denseLiftedMaxMeters }, maxOffset: r.authoring.maxOffsetMeters, maxStep: r.authoring.maxStepMetersPerSample, iter: r.authoring.smoothingIterations, pass: r.validation.pass });
      console.log(JSON.stringify(report.at(-1)));
      if (!r.skipped) bodies.push(r);
    }
  } finally { restore(); }
  // 같은 영웅의 원본 트랙 snapshot 은 한 번만 적는다(런타임이 decoded 트랙과 정확히 비교).
  const bases = {};
  for (const b of bodies) if (!bases[b.base.asset]) {
    const gltf = await (async () => { const r = installRangerRuntimeLoader(); try { return await loadHeroAsset(manifest.assets.find((a) => a.id === b.base.asset)); } finally { r(); } })();
    const t = gltf.animations.find((c) => c.name === 'dodge').tracks.find((x) => x.name === 'mixamorigHips.position');
    bases[b.base.asset] = { ...b.base, times: Array.from(t.times), values: Array.from(t.values) };
  }
  writeFileSync(out, JSON.stringify({ schema: 'blade-surge.original-dodge-band.v1',
    tool: { path: 'tools/art/author-original-dodge-band.mjs', sha256: sha(readFileSync(new URL(import.meta.url))), profile: P, ...(Object.keys(lows).length ? { bandLowOverrides: lows } : {}),
      measurement: '실제 loadHeroAsset → spawnCharacter 경로의 SkinnedMesh 정점 월드 최저 y(three.js 스키닝, 게임과 같은 계산)' },
    bases, bodies: bodies.map(({ base, ...rest }) => ({ ...rest, base: base.asset })) }) + '\n');
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (bodies.some((b) => !b.validation.pass)) process.exit(2);
}
