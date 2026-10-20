import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installRangerRuntimeLoader, stripImages } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, loadHeroAsset, spawnCharacter, disposeCharacter } from '../src/engine/assets.js';
import { resolveAssetSource, revisedLibraryFile, rogueLibraryRevision } from '../src/engine/library-assets.js';
import manifest from '../asset-library/manifest.json';
import { finishLibraryGLB } from '../tools/art/finish-library-materials.mjs';
import REV_AXIS_V1 from '../src/data/rogue-library-revision-v1.json';

// 도적 1단계 채택본(rogue-library-v2 = 축 교정 rogue-library-axis-v1 클립 + 재질 마감): 궁수와 같은 Tripo 롤 결함을 같은 Blender 리타깃으로 고친 파일을 실제 loadHeroModel 경로로 잰다.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const REV = rogueLibraryRevision();
const sha = (path: string) => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const glbJson = (path: string) => { const b = readFileSync(new URL(path, import.meta.url)); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); };
const parse = (path: string) => new GLTFLoader().parseAsync(stripImages(readFileSync(new URL(path, import.meta.url))), '');
const v = () => new THREE.Vector3();
const wp = (root: any, n: string) => root.getObjectByName('mixamorig' + n).getWorldPosition(v());
function kneeBend(root: any, side: string) {
  const hip = wp(root, side + 'UpLeg'), knee = wp(root, side + 'Leg'), ankle = wp(root, side + 'Foot');
  const axis = ankle.clone().sub(hip).normalize(), off = knee.clone().sub(hip); off.sub(axis.multiplyScalar(off.dot(axis)));
  return { forward: off.z, lateral: Math.abs(off.x), depth: off.length() };
}
function skinMinY(root: any) {
  let min = Infinity; const p = v(); root.updateMatrixWorld(true);
  root.traverse((o: any) => { if (!o.isSkinnedMesh) return; o.skeleton.update(); for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; } });
  return min;
}
function pose(inst: any, name: string, k: number) {
  inst.mixer.stopAllAction(); const clip = inst.clips[name]; const a = inst.mixer.clipAction(clip); a.reset(); a.play(); a.time = clip.duration * k; inst.mixer.update(0); inst.root.updateMatrixWorld(true);
}

test('도적 교정본은 원본 SHA 에서 생성된 정확한 파일이고 메시·스킨·rest 는 원본 그대로다', () => {
  const asset = manifest.assets.find((a: any) => a.id === 'hero_rogue_t1')!;
  expect(sha('../asset-library/normalized/hero_rogue_t1.glb')).toBe(asset.sha256);
  expect(REV.source.sha256).toBe(asset.sha256);
  expect(sha('../public' + REV.output.path)).toBe(REV.output.sha256);
  expect(resolveAssetSource(asset)).toBe(REV.output.path);
  expect(() => revisedLibraryFile({ ...asset, sha256: 'f'.repeat(64) } as any)).toThrow('exact generated file');
  for (const id of ['hero_rogue_t2', 'hero_rogue_t3', 'avatar_rogue_crow', 'hero_knight_t1']) expect(revisedLibraryFile(manifest.assets.find((a: any) => a.id === id) as any, REV)).toBeNull();
  expect(revisedLibraryFile(manifest.assets.find((a: any) => a.id === 'hero_knight_t1') as any)).toBeNull();
  const a = glbJson('../asset-library/normalized/hero_rogue_t1.glb'), b = glbJson('../public' + REV.output.path);
  // 재질은 마감 규칙(library-skin-finish-v1) 세 필드만 원본과 다르다.
  expect(a.materials.every((m: any) => m.alphaMode === 'BLEND' && m.pbrMetallicRoughness.metallicFactor === undefined)).toBe(true);
  expect(b.materials).toEqual(a.materials.map((m: any) => ({ ...m, alphaMode: 'MASK', alphaCutoff: .5, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, metallicFactor: .22 } })));
  expect(b.skins.length).toBe(a.skins.length);
  for (const node of a.nodes) {
    const o = b.nodes.find((n: any) => n.name === node.name);
    for (const k of ['translation', 'rotation']) if (node[k]) node[k].forEach((x: number, i: number) => expect(Math.abs(o[k][i] - x)).toBeLessThan(.01));
  }
  expect(b.animations.map((c: any) => c.name).sort()).toEqual([...Object.keys(asset.clips), 'Dodge_Backward'].sort());
});

test('도적 v2 는 공개 axis-v1 파일에 재질 마감만 더한 정확한 파일이다: BIN·비재질 JSON 동일, axis-v1 파일·기록은 그대로', () => {
  expect(sha('../public' + REV_AXIS_V1.output.path)).toBe(REV_AXIS_V1.output.sha256);
  expect(REV.id).toBe('rogue-library-v2'); expect(REV.supersedes).toBe(REV_AXIS_V1.id); expect(REV.license).toBe(REV_AXIS_V1.license);
  expect(REV.materialFinish.inputSha256).toBe(REV_AXIS_V1.output.sha256); expect(REV.clips).toEqual(REV_AXIS_V1.clips);
  const before = readFileSync(new URL('../public' + REV_AXIS_V1.output.path, import.meta.url)), after = readFileSync(new URL('../public' + REV.output.path, import.meta.url));
  expect(finishLibraryGLB(before, REV.id).output.equals(after)).toBe(true);
  const split = (b: Buffer) => { const n = b.readUInt32LE(12); return { json: JSON.parse(b.subarray(20, 20 + n).toString()), bin: b.subarray(20 + n) }; };
  const x = split(before), y = split(after);
  expect(y.bin.equals(x.bin)).toBe(true);
  expect(y.json.asset.extras.materialFinish).toEqual({ revision: REV.id, recipe: 'library-skin-finish-v1', tool: 'tools/art/finish-library-materials.mjs',
    inputSha256: REV_AXIS_V1.output.sha256, metallicFactorMax: .22, opaqueBlendAlphaCutoff: .5 });
  delete x.json.materials; delete y.json.materials; delete y.json.asset.extras.materialFinish;
  expect(JSON.stringify(y.json)).toBe(JSON.stringify(x.json));
});

test('원본 달리기는 무릎이 옆으로 꺾이고, 교정본은 무릎이 정면으로 굽으며 발이 지면에 닿는다', async () => {
  const raw = await parse('../asset-library/normalized/hero_rogue_t1.glb'), mixer = new THREE.AnimationMixer(raw.scene), run = raw.animations.find((c) => c.name === 'run')!;
  let rawLateral = 0;
  for (const k of [0, .25, .5, .75]) {
    mixer.stopAllAction(); const a = mixer.clipAction(run); a.reset(); a.play(); a.time = run.duration * k; mixer.update(0); raw.scene.updateMatrixWorld(true);
    for (const s of ['Left', 'Right']) { const b = kneeBend(raw.scene, s); if (b.depth > .03) rawLateral = Math.max(rawLateral, b.lateral / b.depth); }
  }
  expect(rawLateral).toBeGreaterThan(.6);
  const inst = spawnCharacter(await loadHeroModel('rogue', 1));
  for (const k of [0, .25, .5, .75]) {
    pose(inst, 'Running_A', k);
    for (const s of ['Left', 'Right']) { const b = kneeBend(inst.root, s); if (b.depth > .03) { expect(b.forward).toBeGreaterThan(0); expect(b.lateral / b.depth).toBeLessThan(.45); } }
  }
  for (const [name, k] of [['Idle', 0], ['Idle', .5], ['Hit_A', .3], ['Death_A', 1], ['Dodge_Forward', .5]] as const) { pose(inst, name, k); expect(Math.abs(skinMinY(inst.root))).toBeLessThan(.03); }
  expect(inst.clips.Dodge_Backward).toBeDefined();
  disposeCharacter(inst.root, inst.mixer);
});

test('도적 2·3단계와 까마귀 아바타는 교정 클립을 함께 쓴다', async () => {
  const t1 = await loadHeroModel('rogue', 1);
  for (const id of ['hero_rogue_t2', 'hero_rogue_t3', 'avatar_rogue_crow']) {
    const gltf = await loadHeroAsset(manifest.assets.find((a: any) => a.id === id)!);
    expect(gltf.animations).toBe(t1.animations);
    expect(gltf.animations.some((c: any) => c.name === 'Dodge_Backward')).toBe(true);
  }
});
