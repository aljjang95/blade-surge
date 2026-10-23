// 궁수 3단계 v2 몸(ranger-t3-body-fit-v2) 전용 회피·사망 골반 높이 곡선 저작기(ranger-t3-body-motion-v2).
// v2 몸은 1단계 v6 와 같은 방식(v4 골격에 회전만으로 재결합)이라 1단계 v6 곡선 저작기(author-ranger-t1-body-motion.mjs)와
// 같은 방법·같은 PROFILE(띠·수용 기준·격자·평활 반복)을 그 파일에서 그대로 가져와 쓴다(1단계 기록이 그 파일 SHA 에 묶여 있어 고치지 않는다).
// 1) 실제 게임 경로(loadHeroAsset(hero_ranger_t3) → spawnCharacter)의 v2 몸 스킨 최저 높이 m(t)를 480Hz 격자(원본 키 시간 포함)에서 잰다.
// 2) 띠 band.low ≤ m(t)+o(t) ≤ band.high 안에서 [1,2,1]/4 평활 → 띠로 자르기를 수렴할 때까지 반복한다. 시작(과 회피 끝)은 0 으로 고정.
// 3) 격자 사이 4배 조밀 검사로 실제 수용 기준(구르기 ±0.03m, 사망 > -0.01m·끝 |y|<0.03m)을 다시 확인하고, 넘으면 실패로 끝낸다.
// 수평(X/Z)·다른 트랙·다른 클립은 바꾸지 않는다. 원본 클립은 1단계와 공유하는 v4 바이트다.
//   bun tools/art/author-ranger-t3-body-motion.mjs <출력.json> [보고.json]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import manifest from '../../asset-library/manifest.json' with { type: 'json' };
import { installRangerRuntimeLoader } from './ranger-runtime-loader.mjs';
import { PROFILE, keyValue, trackSha } from './author-ranger-t1-body-motion.mjs';
import { loadHeroAsset, spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';
import { higherBodyRevisions } from '../../src/engine/library-assets.js';
import RANGER_V4 from '../../src/data/ranger-library-revision-v4.json' with { type: 'json' };

const ASSET = 'hero_ranger_t3', MOTION_ID = 'ranger-t3-body-motion-v2';
const CLIPS = ['dodge', 'death'];
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

export async function authorRangerT3BodyMotion() {
  const restore = installRangerRuntimeLoader();
  try {
    const rev = higherBodyRevisions().revisions.find((r) => r.asset === ASSET);
    if (!rev || rev.id !== 'ranger-t3-body-fit-v2' || !rev.useInGame) throw new Error('3단계 v2 몸 개정이 활성 상태가 아님');
    const gltf = await loadHeroAsset(manifest.assets.find((a) => a.id === ASSET)), inst = spawnCharacter(gltf);
    const hips = inst.root.getObjectByName('mixamorigHips'), parent = hips.parent;
    parent.updateWorldMatrix(true, false);
    const gain = parent.matrixWorld.elements[5];
    // 원본(공유 v4) 클립을 그대로 재생한다. 저작 덮어쓰기(inst.clips)를 재지 않는다.
    const measure = (clip, t) => {
      inst.mixer.stopAllAction(); const a = inst.mixer.clipAction(clip); a.reset(); a.play(); a.time = t; inst.mixer.update(0);
      inst.root.updateMatrixWorld(true); return skinMinY(inst.root);
    };
    const overrides = [], report = { gain, clips: {} };
    for (const name of CLIPS) {
      const rule = PROFILE[name], clip = gltf.animations.find((c) => c.name === name);
      const track = clip.tracks.find((t) => t.name === 'mixamorigHips.position');
      const n = Math.round(clip.duration * PROFILE.gridHz), grid = Array.from({ length: n + 1 }, (_, i) => Math.fround(clip.duration * i / n));
      if (!Array.from(track.times).every((t) => grid.includes(t))) throw new Error('원본 키가 격자에 없음 ' + name);
      const m = grid.map((t) => measure(clip, t)), lo = m.map((y) => rule.band[0] - y), hi = m.map((y) => rule.band[1] - y);
      if (lo.some((x, i) => x > hi[i])) throw new Error('띠가 비었음 ' + name);
      const pinned = (i) => i === 0 || (rule.pinEnd && i === n);
      if ([0, ...(rule.pinEnd ? [n] : [])].some((i) => lo[i] > 0 || hi[i] < 0)) throw new Error('시작·끝 0 이 띠 밖 ' + name);
      let o = grid.map((_, i) => (pinned(i) ? 0 : Math.min(hi[i], Math.max(lo[i], 0))));
      let iter = 0;
      for (; iter < PROFILE.iterations; iter++) {
        let change = 0;
        const next = o.map((x, i) => {
          if (pinned(i)) return 0;
          const y = i === n ? (o[i - 1] + x) / 2 : (o[i - 1] + 2 * x + o[i + 1]) / 4, z = Math.min(hi[i], Math.max(lo[i], y));
          change = Math.max(change, Math.abs(z - x)); return z;
        });
        o = next; if (change < 1e-7) break;
      }
      o = o.map(round6);
      const keys = grid.map((t, i) => [t, o[i]]);
      // 격자 사이 조밀 검사(실제 수용 기준)
      let pen = { y: Infinity, t: 0 }, flo = { y: -Infinity, t: 0 };
      for (let i = 0; i <= n * PROFILE.checkFactor; i++) {
        const t = clip.duration * i / (n * PROFILE.checkFactor), y = measure(clip, t) + keyValue(keys, t);
        if (y < pen.y) pen = { y, t }; if (y > flo.y) flo = { y, t };
      }
      const endY = measure(clip, clip.duration) + o[n];
      const ok = pen.y > rule.accept[0] && flo.y < rule.accept[1] && (!rule.endAbs || Math.abs(endY) < rule.endAbs);
      const values = [];
      const interp = track.createInterpolant();
      for (let i = 0; i <= n; i++) { const r = interp.evaluate(grid[i]); values.push(r[0], Math.fround(r[1] + o[i] / gain), r[2]); }
      let step = 0; for (let i = 1; i <= n; i++) step = Math.max(step, Math.abs(o[i] - o[i - 1]));
      const raw = { min: round6(Math.min(...m)), minAt: round6(grid[m.indexOf(Math.min(...m))]), max: round6(Math.max(...m)), maxAt: round6(grid[m.indexOf(Math.max(...m))]), start: round6(m[0]), end: round6(m[n]) };
      overrides.push({
        base: { clip: name, duration: clip.duration, hipsTrack: track.name, interpolation: 'LINEAR', sourceTrackSha256: trackSha(track),
          times: Array.from(track.times), values: Array.from(track.values) },
        outputTrack: { name: track.name, type: 'vector', interpolation: 'LINEAR', times: grid, values },
        authoring: { profileId: 'ranger-t3-v2-' + name + '-contact-band-01', parentWorldYGain: gain, gridHz: PROFILE.gridHz, interpolation: 'LINEAR',
          bandMeters: rule.band, initialOffsetMeters: o[0], finalOffsetMeters: o[n], minOffsetMeters: Math.min(...o), maxOffsetMeters: Math.max(...o),
          smoothingIterations: iter, maxStepMetersPerSample: round6(step) },
        validation: { densePenetrationMinMeters: round6(pen.y), densePenetrationAt: round6(pen.t), denseFloatMaxMeters: round6(flo.y), denseFloatAt: round6(flo.t),
          endMeters: round6(endY), acceptance: { low: rule.accept[0], high: Number.isFinite(rule.accept[1]) ? rule.accept[1] : null, endAbs: rule.endAbs ?? null }, pass: ok,
          rawSkinMeters: raw },
      });
      report.clips[name] = { ...overrides.at(-1).validation, offsetRange: [Math.min(...o), Math.max(...o)], maxStep: round6(step), iter };
      if (!ok) report.fail = true;
    }
    disposeCharacter(inst.root, inst.mixer);
    return {
      motion: {
        schema: 'blade-surge.ranger-band-body-motion.v1', asset: ASSET, heroId: 'ranger', revisionId: rev.id, motionRevisionId: MOTION_ID,
        body: { path: rev.output.path, sha256: rev.output.sha256 }, base: { path: RANGER_V4.output.path, sha256: RANGER_V4.output.sha256 },
        supersedes: { motionRevisionId: 'ranger-t3-body-motion-v1', record: 'src/data/higher-body-motion-v1.json', reason: 'v1 곡선은 v1 몸(ranger-t3-body-fit-v1) 전용이다' },
        tool: { path: 'tools/art/author-ranger-t3-body-motion.mjs', sha256: sha(readFileSync(new URL(import.meta.url))),
          methodFrom: 'tools/art/author-ranger-t1-body-motion.mjs', profile: PROFILE,
          measurement: '실제 loadHeroAsset(hero_ranger_t3) → spawnCharacter 경로의 v2 SkinnedMesh 정점 월드 최저 y(three.js 스키닝, 게임과 같은 계산)' },
        clipOverrides: overrides,
      },
      report,
    };
  } finally { restore(); }
}

if (import.meta.main) {
  const [out, reportPath] = process.argv.slice(2);
  if (!out) throw new Error('usage: bun tools/art/author-ranger-t3-body-motion.mjs <out.json> [report.json]');
  const { motion, report } = await authorRangerT3BodyMotion();
  writeFileSync(out, JSON.stringify(motion, null, 1) + '\n');
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.fail) process.exit(2);
}
