// 여우 아바타 회피·사망 골반 높이 곡선 v2 저작기(2026-10-29 몸 v2 다리 가중치 분리 후속).
// 몸 v2(fox-body-fit-v2)는 다리마다 자기 다리 뼈만 따르게 되어, v1 몸에 맞춰 저작한 fox-body-motion-v1 의 회피 착지(약 0.44초)에서
// 오른쪽 정강이 외피가 바닥 아래 3cm 로 내려갔다(v1 은 반대쪽 다리 가중치가 끌어올려 가려졌다).
// 방법: v1 곡선을 그대로 두고, 실제 게임 경로(loadHeroAsset → spawnCharacter → createBodyMotionClip)로 각 표본 시점의 외피 최저 y 를 재서
// 목표(target) 아래로 내려간 만큼만 골반 Y 를 더 올린다. 들어올림은 이웃 표본으로 넓히고 [1,2,1]/4 로 고른 뒤, 계약 고정점(회피 시작 +6mm,
// 회피 끝 0, 사망 끝 +5cm)은 0 으로 둔다. 수평(X/Z)·다른 트랙은 바꾸지 않는다. 조밀(표본 사이 4배) 검사로 다시 확인한다.
//   bun tools/art/author-fox-body-motion-v2.mjs <v1.json> <출력.json> [보고.json] [--target=0.002]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import manifest from '../../asset-library/manifest.json' with { type: 'json' };
import { installRangerRuntimeLoader } from './ranger-runtime-loader.mjs';
import { loadHeroAsset, loadHeroModel, spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';
import { createBodyMotionClip } from '../../src/engine/hero-body-motion.js';
import { foxBodyRevision } from '../../src/engine/library-assets.js';

const NATIVE_PER_METER = .3333334167 / .006;   // v4 본 단위(회피 시작 +6mm 계약과 같은 환산)
const args = process.argv.slice(2), plain = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [inputPath, outputPath, reportPath] = plain;
const target = Number(flags.target ?? .002);
if (!outputPath) throw new Error('usage: bun tools/art/author-fox-body-motion-v2.mjs v1.json out.json [report.json] [--target=0.002]');
if (existsSync(outputPath)) throw new Error('출력이 이미 있다(덮어쓰지 않음): ' + outputPath);

function skinMinY(root) {
  let min = Infinity; const p = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.userData.libraryBody) return;
    o.skeleton.update();
    for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, p).applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; }
  });
  return min;
}

const restore = installRangerRuntimeLoader();
try {
  const v1 = JSON.parse(readFileSync(inputPath, 'utf8')), motion = structuredClone(v1);
  const base = await loadHeroModel('ranger', 1), fox = await loadHeroAsset(manifest.assets.find((a) => a.id === 'avatar_ranger_fox'));
  const inst = spawnCharacter(fox);
  const measureAt = (clip, times) => {
    inst.mixer.stopAllAction(); const action = inst.mixer.clipAction(clip); action.reset(); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    const out = times.map((t) => { action.time = t; inst.mixer.update(0); return skinMinY(inst.root); });
    action.stop(); inst.mixer.uncacheAction(clip); return out;
  };
  const report = { tool: 'tools/art/author-fox-body-motion-v2.mjs', body: foxBodyRevision().output, input: { path: inputPath, sha256: createHash('sha256').update(readFileSync(inputPath)).digest('hex') }, target, clips: {} };
  for (const entry of motion.clipOverrides) {
    const baseClip = base.animations.find((c) => c.name === entry.base.clip), times = entry.outputTrack.times, values = entry.outputTrack.values;
    const fixedEnd = true; let lift = new Float64Array(times.length), before = null, iterations = 0;
    for (; iterations < 40; iterations++) {
      const clip = createBodyMotionClip(baseClip, motion), mins = measureAt(clip, times);
      if (!before) before = Math.min(...mins);
      // 계약 고정점(시작·끝)은 올릴 수 없으니 부족분에서 뺀다(그 점의 접지는 v1 그대로 검사된다).
      const need = mins.map((m, i) => i === 0 || i === times.length - 1 ? 0 : Math.max(0, target - m));
      if (need.every((n) => n < 1e-4)) break;
      // 부족분을 이웃 ±3 표본으로 넓히고 고른다. 끝점(계약 고정)은 0.
      const add = new Float64Array(times.length);
      for (let i = 0; i < times.length; i++) for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < times.length) add[j] = Math.max(add[j], need[i]); }
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < times.length - 1; i++) add[i] = Math.max(add[i], (add[i - 1] + 2 * add[i] + add[i + 1]) / 4);
      add[0] = 0; if (fixedEnd) add[times.length - 1] = 0;
      for (let i = 0; i < times.length; i++) { lift[i] += add[i] * 1.05; values[i * 3 + 1] = v1.clipOverrides.find((e) => e.base.clip === entry.base.clip).outputTrack.values[i * 3 + 1] + lift[i] * NATIVE_PER_METER; }
    }
    // 조밀 검사(표본 사이 4배)
    const dense = []; for (let i = 0; i < times.length - 1; i++) for (let k = 0; k < 4; k++) dense.push(times[i] + (times[i + 1] - times[i]) * k / 4);
    dense.push(times.at(-1));
    const final = measureAt(createBodyMotionClip(baseClip, motion), dense);
    const after = Math.min(...final);
    report.clips[entry.base.clip] = { samples: times.length, denseSamples: dense.length, iterations, minBeforeMeters: +before.toFixed(6), minAfterMeters: +after.toFixed(6),
      maxLiftMeters: +Math.max(...lift).toFixed(6), endMeters: +final.at(-1).toFixed(6) };
    entry.authoring = { ...entry.authoring, v2: { tool: 'tools/art/author-fox-body-motion-v2.mjs', body: foxBodyRevision().id, target, maxLiftMeters: +Math.max(...lift).toFixed(6) } };
    if (after < -.01) throw new Error(`${entry.base.clip} 조밀 검사 실패 ${after}`);
  }
  motion.previous = { path: 'src/data/fox-body-motion-v1.json', sha256: report.input.sha256 };
  const text = JSON.stringify(motion, null, 2) + '\n';
  writeFileSync(outputPath, text);
  report.output = { path: outputPath, sha256: createHash('sha256').update(text).digest('hex') };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  disposeCharacter(inst.root, inst.mixer);
} finally { restore(); }
