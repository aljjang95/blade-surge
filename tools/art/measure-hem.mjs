// 몸 스킨의 부위별 최저점(망토 밑단·발)을 실제 게임 경로(loadHeroAsset → spawnCharacter)로 잰다.
// 정점을 다리 가중치 합으로 나눈다: 다리 ≥ 0.5 = 발·다리, 그 밖 = 망토·옷자락. bind 자세(클립 없음)와 클립 프레임 격자에서 각 무리의 최저 y(m)를 낸다.
//   bun tools/art/measure-hem.mjs <자산 id>[,<자산 id>…] [보고.json]
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import manifest from '../../asset-library/manifest.json' with { type: 'json' };
import { installRangerRuntimeLoader } from './ranger-runtime-loader.mjs';
import { loadHeroAsset, spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';

const LEG = /(UpLeg|Leg|Foot|ToeBase|ToeEnd)$/;
const CLIPS = ['idle', 'run', 'walk', 'dodge', 'attack', 'attack2', 'attack3', 'skill'];
const round4 = (x) => Math.round(x * 1e4) / 1e4;
const bare = (name) => String(name).replace(/[^A-Za-z0-9]/g, '').replace(/^mixamorig/i, '');

function groups(mesh) {
  const bones = mesh.skeleton.bones.map((b) => LEG.test(bare(b.name)));
  const { skinIndex, skinWeight } = mesh.geometry.attributes, leg = new Uint8Array(skinIndex.count);
  for (let i = 0; i < skinIndex.count; i++) {
    let w = 0;
    for (let c = 0; c < 4; c++) if (bones[skinIndex.getComponent(i, c)]) w += skinWeight.getComponent(i, c);
    leg[i] = w >= 0.5 ? 1 : 0;
  }
  return leg;
}

function minByGroup(root, legOf) {
  const out = { leg: Infinity, hem: Infinity }, p = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !legOf.has(o)) return;
    o.skeleton.update();
    const leg = legOf.get(o);
    for (let i = 0; i < o.geometry.attributes.position.count; i++) {
      o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld);
      const k = leg[i] ? 'leg' : 'hem'; if (p.y < out[k]) out[k] = p.y;
    }
  });
  return out;
}

export async function measureHem(assetId, { frames = 24 } = {}) {
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error('알 수 없는 자산: ' + assetId);
  const restore = installRangerRuntimeLoader();
  try {
    const gltf = await loadHeroAsset(asset), inst = spawnCharacter(gltf), legOf = new Map();
    inst.root.traverse((o) => { if (o.isSkinnedMesh && !o.userData?.heroBoots && !o.userData?.heroGearParts) legOf.set(o, groups(o)); });
    inst.mixer.stopAllAction(); inst.root.updateMatrixWorld(true);
    const bind = minByGroup(inst.root, legOf), out = { asset: assetId, bind: { leg: round4(bind.leg), hem: round4(bind.hem) }, clips: /** @type {Record<string, { leg: number, hem: number, hemAt: number }>} */ ({}) };
    for (const name of CLIPS) {
      const clip = gltf.animations.find((c) => c.name === name);
      if (!clip) continue;
      let lo = { leg: Infinity, hem: Infinity, hemAt: 0 };
      for (let i = 0; i <= frames; i++) {
        const t = clip.duration * i / frames;
        inst.mixer.stopAllAction(); const a = inst.mixer.clipAction(clip); a.reset(); a.play(); a.time = t; inst.mixer.update(0);
        inst.root.updateMatrixWorld(true);
        const m = minByGroup(inst.root, legOf);
        if (m.leg < lo.leg) lo.leg = m.leg;
        if (m.hem < lo.hem) { lo.hem = m.hem; lo.hemAt = t; }
      }
      out.clips[name] = { leg: round4(lo.leg), hem: round4(lo.hem), hemAt: round4(lo.hemAt) };
    }
    disposeCharacter(inst.root, inst.mixer);
    return out;
  } finally { restore(); }
}

if (import.meta.main) {
  const [ids, reportPath] = process.argv.slice(2);
  if (!ids) throw new Error('usage: bun tools/art/measure-hem.mjs <asset>[,<asset>…] [report.json]');
  const results = [];
  for (const id of ids.split(',')) { results.push(await measureHem(id)); console.log(JSON.stringify(results.at(-1))); }
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ tool: 'tools/art/measure-hem.mjs', results }, null, 2) + '\n');
}
