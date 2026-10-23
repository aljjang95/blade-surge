import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { PROFILE } from '../tools/art/author-ranger-t1-body-motion.mjs';
import { loadHeroModel, loadHeroAsset, spawnCharacter, applyLibraryHeroBody, disposeCharacter } from '../src/engine/assets.js';
import { validateRangerBandMotion, createRangerT1BodyMotionClip, prepareHeroBodyMotion, selectedBodyMotionIdentity } from '../src/engine/hero-body-motion.js';
import { higherBodyRevisions } from '../src/engine/library-assets.js';
import MOTION from '../src/data/ranger-t3-body-motion-v2.json';
import RANGER_V4 from '../src/data/ranger-library-revision-v4.json';
import manifest from '../asset-library/manifest.json';

// 궁수 3단계 v2 몸 전용 회피·사망 골반 높이(ranger-t3-body-motion-v2). v2 몸은 1단계 v6 와 같은 재결합이라 같은 띠 곡선 계약·같은 수용 기준을 쓴다.
// 클립 바이트(1단계와 공유하는 v4)는 그대로 두고 런타임 Hips 위치 트랙만 덮는다. 수치 경계: 구르기 ±0.03m, 사망 > -0.01m·끝 |y| < 0.03m.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const T3 = manifest.assets.find((a: any) => a.id === 'hero_ranger_t3')!;
const REV = higherBodyRevisions().revisions.find((r: any) => r.asset === 'hero_ranger_t3')!;
const TUNED = ['dodge', 'death'];
function skinMinY(inst: any) {
  let min = Infinity; const p = new THREE.Vector3();
  inst.root.traverse((o: any) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld); if (p.y < min) min = p.y; }
  });
  return min;
}
function play(inst: any, clip: THREE.AnimationClip, time: number) {
  inst.mixer.stopAllAction(); const action = inst.mixer.clipAction(clip); action.reset(); action.play(); action.time = time; inst.mixer.update(0);
  inst.root.updateMatrixWorld(true);
}

test('기록은 v2 몸·v4 클립 원본·저작 도구 SHA 에 묶이고, 1단계와 같은 수용 기준을 통과한다', () => {
  expect(REV.id).toBe('ranger-t3-body-fit-v2');
  expect(MOTION.revisionId).toBe(REV.id); expect(MOTION.motionRevisionId).toBe('ranger-t3-body-motion-v2');
  expect(MOTION.body).toEqual({ path: REV.output.path, sha256: REV.output.sha256 });
  expect(sha(readFileSync('public' + MOTION.body.path))).toBe(MOTION.body.sha256);
  expect(MOTION.base).toEqual({ path: RANGER_V4.output.path, sha256: RANGER_V4.output.sha256 });
  expect(sha(readFileSync(MOTION.tool.path))).toBe(MOTION.tool.sha256);
  // 1단계 저작기의 PROFILE 을 그대로 쓴다(기준을 바꾸지 않았다).
  expect(MOTION.tool.profile).toEqual(JSON.parse(JSON.stringify(PROFILE)));
  expect(PROFILE.dodge.accept).toEqual([-.03, .03]); expect(PROFILE.death.accept[0]).toBe(-.01); expect(PROFILE.death.endAbs).toBe(.03);
  for (const entry of MOTION.clipOverrides as any[]) {
    expect(entry.validation.pass).toBe(true);
    expect(entry.authoring.initialOffsetMeters).toBe(0);
    if (entry.base.clip === 'dodge') {
      expect(entry.authoring.finalOffsetMeters).toBe(0);
      expect(entry.validation.densePenetrationMinMeters).toBeGreaterThan(-.03); expect(entry.validation.denseFloatMaxMeters).toBeLessThan(.03);
    } else {
      expect(entry.validation.densePenetrationMinMeters).toBeGreaterThan(-.01); expect(Math.abs(entry.validation.endMeters)).toBeLessThan(.03);
    }
  }
  expect(() => validateRangerBandMotion(MOTION, REV)).not.toThrow();
});

test('실제 3단계 spawn·교체는 회피·사망만 v2 전용 곡선이고, 실제 런타임 스킨 접지가 수용 기준 안이다', async () => {
  const gltf = await loadHeroAsset(T3), inst = spawnCharacter(gltf);
  const base = await loadHeroModel('ranger', 1), swapped = spawnCharacter(base);
  try {
    expect(inst.root.userData.libraryBodyMotionIdentity).toEqual({ asset: 'hero_ranger_t3', heroId: 'ranger', revisionId: REV.id, path: REV.output.path, sha256: REV.output.sha256 });
    for (const name of TUNED) {
      const raw = gltf.animations.find((c: THREE.AnimationClip) => c.name === name)!, next = inst.clips[name];
      expect(next).not.toBe(raw); expect(next.duration).toBe(raw.duration);
      raw.tracks.forEach((track: THREE.KeyframeTrack, i: number) => { if (track.name !== 'mixamorigHips.position') expect(next.tracks[i]).toBe(track); });
    }
    for (const name of ['idle', 'run', 'hit', 'bow_shoot', 'cheer', 'Dodge_Backward']) {
      expect(inst.clips[name]).toBe(gltf.animations.find((c: THREE.AnimationClip) => c.name === name));
    }
    // 1단계 → 3단계 교체도 같은 덮어쓰기 클립을 쓴다.
    expect(applyLibraryHeroBody(swapped.root, T3)).toBe(true);
    for (const name of TUNED) expect(swapped.clips[name]).toBe(inst.clips[name]);
    // 실제 런타임 수용 검사: 원본 키 시간 + 균등 600 표본.
    for (const name of TUNED) {
      const clip = inst.clips[name], times = new Set<number>();
      for (let i = 0; i <= 600; i++) times.add(clip.duration * i / 600);
      for (const track of clip.tracks) for (const t of track.times) times.add(t);
      let low = Infinity, high = -Infinity;
      for (const t of times) { play(inst, clip, t); const y = skinMinY(inst); low = Math.min(low, y); high = Math.max(high, y); }
      if (name === 'dodge') { expect(low).toBeGreaterThan(-.03); expect(high).toBeLessThan(.03); }
      else {
        expect(low).toBeGreaterThan(-.01);
        play(inst, clip, clip.duration); expect(Math.abs(skinMinY(inst))).toBeLessThan(.03);
      }
    }
    // 대기 자세 발은 바닥 위(재결합 --lift=0.015, 1단계 v6 와 같은 높이대).
    play(inst, inst.clips.idle, 0); expect(skinMinY(inst)).toBeGreaterThan(0); expect(skinMinY(inst)).toBeLessThan(.015);
  } finally { disposeCharacter(inst.root, inst.mixer); disposeCharacter(swapped.root, swapped.mixer); }
}, 60_000);

test('잘못된 몸·개정·출처·범위 기록과 다른 몸 SHA 의 선택은 거절하고, 개정 id 없는 선택은 원본 클립을 쓴다', async () => {
  const bad = (patch: (m: any) => void) => { const m = structuredClone(MOTION) as any; patch(m); return () => validateRangerBandMotion(m, REV); };
  expect(bad(() => {})).not.toThrow();
  expect(bad((m) => { m.body.sha256 = 'f'.repeat(64); })).toThrow();
  expect(bad((m) => { m.revisionId = 'ranger-t3-body-fit-v1'; })).toThrow();
  expect(bad((m) => { m.motionRevisionId = 'ranger-t3-body-motion-v1'; })).toThrow();
  expect(bad((m) => { m.schema = 'blade-surge.ranger-t1-body-motion.v1'; })).toThrow();
  expect(bad((m) => { m.asset = 'hero_ranger_t2'; })).toThrow();
  expect(bad((m) => { m.base.sha256 = REV.output.sha256; })).toThrow();
  expect(bad((m) => { m.clipOverrides[0].authoring.maxOffsetMeters = .5; })).toThrow();
  expect(bad((m) => { m.clipOverrides[0].validation.pass = false; })).toThrow();
  expect(bad((m) => { m.clipOverrides[0].authoring.initialOffsetMeters = .01; })).toThrow();
  const gltf = await loadHeroAsset(T3), dodge = gltf.animations.find((c: THREE.AnimationClip) => c.name === 'dodge')!;
  const moved = structuredClone(MOTION) as any, entry = moved.clipOverrides.find((e: any) => e.base.clip === 'dodge');
  entry.outputTrack.values[30] += .5;   // 10번째 표본의 X
  expect(() => createRangerT1BodyMotionClip(dodge, validateRangerBandMotion(moved, REV))).toThrow('수평');
  const inst = spawnCharacter(gltf);
  try {
    const identity = selectedBodyMotionIdentity(T3);
    expect(identity.revisionId).toBe(REV.id);
    expect(() => prepareHeroBodyMotion(inst.root, { ...identity, sha256: 'f'.repeat(64) })).toThrow();
    const plan = prepareHeroBodyMotion(inst.root, { asset: 'hero_ranger_t3' })!;
    expect(plan.changes.find((c: any) => c.entry.base.name === 'dodge').next).toBe(dodge);
  } finally { disposeCharacter(inst.root, inst.mixer); }
});
