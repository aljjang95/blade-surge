// 궁수 1단계 v5 몸 전용 회피·사망 골반 높이 곡선 저작기(ranger-t1-body-motion-v1).
// 클립 바이트(v4 와 같은 v5 GLB 의 dodge/death)는 그대로 두고, 런타임이 덮어 쓸 Hips.position 트랙의 높이(Y)만 만든다.
// 1) 실제 게임 경로(loadHeroModel → spawnCharacter)의 v5 몸 스킨 최저 높이 m(t)를 480Hz 격자(원본 키 시간 포함)에서 잰다.
// 2) 오프셋 o(t)가 지켜야 할 띠: band.low ≤ m(t)+o(t) ≤ band.high. 시작(과 회피 끝)은 0 으로 고정해 대기 전환에 튐이 없게 한다.
// 3) 띠 안에서 가장 매끈한 곡선을 찾는다: [1,2,1]/4 평활 → 띠로 자르기를 수렴할 때까지 반복(프레임별 접지 맞춤이 아닌 연속 곡선).
// 4) 격자 사이 4배 조밀 검사로 실제 수용 기준(테스트와 같은 값)을 다시 확인하고, 넘으면 실패로 끝낸다.
// 수평(X/Z)·다른 트랙·다른 9개 클립은 바꾸지 않는다.
//   bun tools/art/author-ranger-t1-body-motion.mjs <출력.json> [보고.json]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { installRangerRuntimeLoader } from './ranger-runtime-loader.mjs';
import { loadHeroModel, spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';
import { rangerLibraryRevision, rangerClipSource } from '../../src/engine/library-assets.js';

export const PROFILE = Object.freeze({
  gridHz: 480, checkFactor: 4, iterations: 4000,
  // 저작 띠(수용 기준보다 안쪽 여유)와 실제 수용 기준(test/ranger-library-model·ranger-death-contact 와 같은 값)
  dodge: { band: [-.02, .025], accept: [-.03, .03], pinEnd: true },
  death: { band: [-.006, .025], accept: [-.01, Infinity], endAbs: .03, pinEnd: false },
});
const CLIPS = ['dodge', 'death'];
const sha = (value) => createHash('sha256').update(value).digest('hex');
export function trackSha(track) {
  const sizes = Buffer.alloc(8); sizes.writeUInt32LE(track.times.length, 0); sizes.writeUInt32LE(track.values.length, 4);
  const bytes = Buffer.alloc((track.times.length + track.values.length) * 4);
  [...track.times, ...track.values].forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return sha(Buffer.concat([Buffer.from(track.name + '\0'), sizes, bytes]));
}
/** 정렬된 [t, v] 키의 선형 보간(양 끝은 고정). */
export function keyValue(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [ta, a] = keys[i - 1], [tb, b] = keys[i]; return a + (b - a) * (t - ta) / (tb - ta); }
  return keys.at(-1)[1];
}
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

export async function authorRangerT1BodyMotion() {
  const restore = installRangerRuntimeLoader();
  try {
    const gltf = await loadHeroModel('ranger', 1), inst = spawnCharacter(gltf), rev = rangerLibraryRevision();
    const hips = inst.root.getObjectByName('mixamorigHips'), parent = hips.parent;
    parent.updateWorldMatrix(true, false);
    const gain = parent.matrixWorld.elements[5];
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
      overrides.push({
        base: { clip: name, duration: clip.duration, hipsTrack: track.name, interpolation: 'LINEAR', sourceTrackSha256: trackSha(track),
          times: Array.from(track.times), values: Array.from(track.values) },
        outputTrack: { name: track.name, type: 'vector', interpolation: 'LINEAR', times: grid, values },
        authoring: { profileId: 'ranger-t1-v5-' + name + '-contact-band-01', parentWorldYGain: gain, gridHz: PROFILE.gridHz, interpolation: 'LINEAR',
          bandMeters: rule.band, initialOffsetMeters: o[0], finalOffsetMeters: o[n], minOffsetMeters: Math.min(...o), maxOffsetMeters: Math.max(...o),
          smoothingIterations: iter, maxStepMetersPerSample: round6(step) },
        validation: { densePenetrationMinMeters: round6(pen.y), densePenetrationAt: round6(pen.t), denseFloatMaxMeters: round6(flo.y), denseFloatAt: round6(flo.t),
          endMeters: round6(endY), acceptance: { low: rule.accept[0], high: Number.isFinite(rule.accept[1]) ? rule.accept[1] : null, endAbs: rule.endAbs ?? null }, pass: ok },
      });
      report.clips[name] = { ...overrides.at(-1).validation, offsetRange: [Math.min(...o), Math.max(...o)], maxStep: round6(step), iter };
      if (!ok) report.fail = true;
    }
    disposeCharacter(inst.root, inst.mixer);
    const clipSource = rangerClipSource(rev);
    return {
      motion: {
        schema: 'blade-surge.ranger-t1-body-motion.v1', asset: 'hero_ranger_t1', heroId: 'ranger', revisionId: rev.id,
        body: { path: rev.output.path, sha256: rev.output.sha256 }, base: { path: clipSource.path, sha256: clipSource.sha256 },
        tool: { path: 'tools/art/author-ranger-t1-body-motion.mjs', sha256: sha(readFileSync(new URL(import.meta.url))), profile: PROFILE,
          measurement: '실제 loadHeroModel → spawnCharacter 경로의 v5 SkinnedMesh 정점 월드 최저 y(three.js 스키닝, 게임과 같은 계산)' },
        clipOverrides: overrides,
      },
      report,
    };
  } finally { restore(); }
}

if (import.meta.main) {
  const [out, reportPath] = process.argv.slice(2);
  if (!out) throw new Error('usage: bun tools/art/author-ranger-t1-body-motion.mjs <out.json> [report.json]');
  const { motion, report } = await authorRangerT1BodyMotion();
  writeFileSync(out, JSON.stringify(motion, null, 1) + '\n');
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
