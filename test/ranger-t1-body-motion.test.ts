import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, spawnCharacter, disposeCharacter } from '../src/engine/assets.js';
import { validateRangerT1Motion, createRangerT1BodyMotionClip, prepareHeroBodyMotion, selectedBodyMotionIdentity } from '../src/engine/hero-body-motion.js';
import { rangerLibraryRevision, rangerClipSource } from '../src/engine/library-assets.js';
import MOTION from '../src/data/ranger-t1-body-motion-v2.json';
import manifest from '../asset-library/manifest.json';

// 궁수 1단계 v6 몸 전용 회피·사망 골반 높이(ranger-t1-body-motion-v2, 철회된 v5 기록은 v1). 클립 바이트는 그대로 두고 런타임 Hips 위치 트랙만 덮는다.
// 접지 수치(사망 > -0.01m·끝 |y|<0.03m, 구르기 ±0.03m)는 실제 런타임 경로로 test/ranger-death-contact·ranger-library-model 이 잰다.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const REV = rangerLibraryRevision();
const T1 = manifest.assets.find((a: any) => a.id === 'hero_ranger_t1')!;

test('기록은 v6 몸·v4 클립 원본·저작 도구 SHA 에 묶이고, 저작 검증 기록이 수용 기준을 통과한다', () => {
  expect(MOTION.revisionId).toBe(REV.id);
  expect(MOTION.body).toEqual({ path: REV.output.path, sha256: REV.output.sha256 });
  expect(sha(readFileSync('public' + MOTION.body.path))).toBe(MOTION.body.sha256);
  const source = rangerClipSource();
  expect(MOTION.base).toEqual({ path: source.path, sha256: source.sha256 });
  expect(sha(readFileSync(MOTION.tool.path))).toBe(MOTION.tool.sha256);
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
  expect(() => validateRangerT1Motion(MOTION)).not.toThrow();
});

test('실제 1단계 spawn 은 회피·사망만 1단계 전용 곡선으로 바뀌고 Hips Y 밖의 값·다른 클립은 원본 그대로다', async () => {
  const gltf = await loadHeroModel('ranger', 1), inst = spawnCharacter(gltf);
  try {
    expect(inst.root.userData.libraryBodyMotionIdentity).toEqual({ asset: 'hero_ranger_t1', heroId: 'ranger', revisionId: REV.id, path: REV.output.path, sha256: REV.output.sha256 });
    for (const name of ['dodge', 'death']) {
      const base = gltf.animations.find((c: THREE.AnimationClip) => c.name === name)!, next = inst.clips[name];
      expect(next).not.toBe(base); expect(next.duration).toBe(base.duration);
      base.tracks.forEach((track: THREE.KeyframeTrack, i: number) => {
        if (track.name !== 'mixamorigHips.position') { expect(next.tracks[i]).toBe(track); return; }
        const a = track.createInterpolant(), b = next.tracks[i].createInterpolant();
        let maxY = 0;
        for (let k = 0; k <= 200; k++) {
          const t = base.duration * k / 200, ra = Array.from(a.evaluate(t) as ArrayLike<number>), rb = Array.from(b.evaluate(t) as ArrayLike<number>);
          expect(Math.abs(rb[0] - ra[0])).toBeLessThan(1e-4); expect(Math.abs(rb[2] - ra[2])).toBeLessThan(1e-4);
          maxY = Math.max(maxY, Math.abs(rb[1] - ra[1]));
        }
        expect(maxY).toBeGreaterThan(0);
      });
    }
    expect(inst.clips.Dodge_Forward).toBe(inst.clips.dodge); expect(inst.clips.Death_A).toBe(inst.clips.death);
    // 대기·사격·피격 등은 덮지 않는다(서 있을 때 발 높이 불변).
    for (const name of ['idle', 'run', 'hit', 'bow_shoot', 'bow_shoot_rapid', 'cast_shoot', 'cheer', 'Dodge_Backward']) {
      expect(inst.clips[name]).toBe(gltf.animations.find((c: THREE.AnimationClip) => c.name === name));
    }
  } finally { disposeCharacter(inst.root, inst.mixer); }
});

test('잘못된 몸·개정·출처·범위·수평 이동 기록과 다른 몸 SHA 의 선택은 거절하고, 개정 id 없는 선택은 원본 클립을 쓴다', async () => {
  const bad = (patch: (m: any) => void) => { const m = structuredClone(MOTION) as any; patch(m); return () => validateRangerT1Motion(m); };
  expect(bad((m) => { m.body.sha256 = 'f'.repeat(64); })).toThrow();
  expect(bad((m) => { m.revisionId = 'ranger-library-v4'; })).toThrow();
  expect(bad((m) => { m.base.sha256 = REV.output.sha256; })).toThrow();
  expect(bad((m) => { m.clipOverrides[0].authoring.maxOffsetMeters = .5; })).toThrow();
  expect(bad((m) => { m.clipOverrides[0].validation.pass = false; })).toThrow();
  expect(bad((m) => { m.clipOverrides[0].authoring.initialOffsetMeters = .01; })).toThrow();
  const gltf = await loadHeroModel('ranger', 1), dodge = gltf.animations.find((c: THREE.AnimationClip) => c.name === 'dodge')!;
  const moved = structuredClone(MOTION) as any, entry = moved.clipOverrides.find((e: any) => e.base.clip === 'dodge');
  entry.outputTrack.values[30] += .5;   // 10번째 표본의 X
  expect(() => createRangerT1BodyMotionClip(dodge, validateRangerT1Motion(moved))).toThrow('수평');
  const inst = spawnCharacter(gltf);
  try {
    const identity = selectedBodyMotionIdentity(T1);
    expect(() => prepareHeroBodyMotion(inst.root, { ...identity, sha256: 'f'.repeat(64) })).toThrow();
    const plan = prepareHeroBodyMotion(inst.root, { asset: 'hero_ranger_t1' })!;
    expect(plan.changes.find((c: any) => c.entry.base.name === 'dodge').next).toBe(dodge);
  } finally { disposeCharacter(inst.root, inst.mixer); }
});
