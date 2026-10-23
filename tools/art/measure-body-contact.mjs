// 영웅 몸의 회피·사망 실제 스킨 접지를 원본 클립 그대로(저작 곡선 없이) 잰다. 곡선을 새로 만들지 판정하는 용도다.
// 실제 게임 경로(loadHeroAsset → spawnCharacter)의 SkinnedMesh 정점 월드 최저 y 를 궁수 곡선 저작기와 같은 격자(PROFILE.gridHz)와
// 조밀 검사 배수(PROFILE.checkFactor)로 재고, 같은 수용 기준(구르기 ±0.03m, 사망 > -0.01m·끝 |y| < 0.03m)으로 판정한다.
// 등록된 저작 동작(inst.clips 덮어쓰기)이 아니라 gltf.animations 의 원본 클립을 재생한다.
//   bun tools/art/measure-body-contact.mjs <자산 id>[,<자산 id>…] [보고.json]
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import manifest from '../../asset-library/manifest.json' with { type: 'json' };
import { installRangerRuntimeLoader } from './ranger-runtime-loader.mjs';
import { PROFILE } from './author-ranger-t1-body-motion.mjs';
import { loadHeroAsset, spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';
import { selectedBodyMotionIdentity } from '../../src/engine/hero-body-motion.js';

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

export async function measureBodyContact(assetId) {
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error('알 수 없는 자산: ' + assetId);
  const restore = installRangerRuntimeLoader();
  try {
    const identity = selectedBodyMotionIdentity(asset);
    const gltf = await loadHeroAsset(asset), inst = spawnCharacter(gltf);
    const measure = (clip, t) => {
      inst.mixer.stopAllAction(); const a = inst.mixer.clipAction(clip); a.reset(); a.play(); a.time = t; inst.mixer.update(0);
      inst.root.updateMatrixWorld(true); return skinMinY(inst.root);
    };
    const out = { asset: assetId, body: { path: identity.path, sha256: identity.sha256, revisionId: identity.revisionId }, clips: {}, pass: true };
    for (const name of ['dodge', 'death']) {
      const rule = PROFILE[name], clip = gltf.animations.find((c) => c.name === name);
      if (!clip) throw new Error('클립 없음 ' + name);
      const n = Math.round(clip.duration * PROFILE.gridHz) * PROFILE.checkFactor;
      let lo = { y: Infinity, t: 0 }, hi = { y: -Infinity, t: 0 };
      for (let i = 0; i <= n; i++) {
        const t = clip.duration * i / n, y = measure(clip, t);
        if (y < lo.y) lo = { y, t }; if (y > hi.y) hi = { y, t };
      }
      const start = measure(clip, 0), end = measure(clip, clip.duration);
      const pass = lo.y > rule.accept[0] && hi.y < rule.accept[1] && (!rule.endAbs || Math.abs(end) < rule.endAbs);
      out.clips[name] = { samples: n + 1, minMeters: round6(lo.y), minAt: round6(lo.t), maxMeters: round6(hi.y), maxAt: round6(hi.t),
        startMeters: round6(start), endMeters: round6(end), acceptance: { low: rule.accept[0], high: Number.isFinite(rule.accept[1]) ? rule.accept[1] : null, endAbs: rule.endAbs ?? null }, pass };
      if (!pass) out.pass = false;
    }
    disposeCharacter(inst.root, inst.mixer);
    return out;
  } finally { restore(); }
}

if (import.meta.main) {
  const [ids, reportPath] = process.argv.slice(2);
  if (!ids) throw new Error('usage: bun tools/art/measure-body-contact.mjs <asset>[,<asset>…] [report.json]');
  const results = [];
  for (const id of ids.split(',')) { results.push(await measureBodyContact(id)); console.log(JSON.stringify(results.at(-1))); }
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ tool: 'tools/art/measure-body-contact.mjs', profile: { gridHz: PROFILE.gridHz, checkFactor: PROFILE.checkFactor }, results }, null, 2) + '\n');
  if (results.some((r) => !r.pass)) process.exit(2);
}
