import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { PROFILE } from '../tools/art/author-ranger-t1-body-motion.mjs';
import { loadHeroModel, loadHeroAsset, spawnCharacter, applyLibraryHeroBody, disposeCharacter } from '../src/engine/assets.js';
import { validateTierBandMotion, createRangerT1BodyMotionClip, prepareHeroBodyMotion, selectedBodyMotionIdentity } from '../src/engine/hero-body-motion.js';
import { t4BodyRevisions } from '../src/engine/library-assets.js';
import MOTION_T1S from '../src/data/rogue-t1s-body-motion-v1.json';
import MOTION_T2U from '../src/data/rogue-t2u-body-motion-v1.json';
import RANGER_T1S from '../src/data/ranger-t1s-body-motion-v1.json';
import RANGER_T2U from '../src/data/ranger-t2u-body-motion-v1.json';
import ROGUE_LIBRARY from '../src/data/rogue-library-revision-v2.json';
import RANGER_V4 from '../src/data/ranger-library-revision-v4.json';
import manifest from '../asset-library/manifest.json';

// 도적·궁수 S(1.5)·U(2.5) 등급 몸(heroes-next 교정 몸) 전용 회피·사망 골반 높이. 원본 클립 그대로면 도적 구르기 -0.116/-0.135m, 사망 -0.027/-0.109m,
// 궁수 구르기 -0.193/-0.139m, 사망 -0.083/-0.203m 로
// 바닥을 판다(tools/art/measure-body-contact.mjs). 궁수 2·3단계 v2 와 같은 띠 곡선 계약·같은 수용 기준(구르기 ±0.03m, 사망 > -0.01m·끝 |y| < 0.03m).
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const CASES = [['hero_rogue_t1s', MOTION_T1S], ['hero_rogue_t2u', MOTION_T2U], ['hero_ranger_t1s', RANGER_T1S], ['hero_ranger_t2u', RANGER_T2U]].map(([id, MOTION]: any) => ({
  id, MOTION, HERO: id.split('_')[1], ASSET: manifest.assets.find((a: any) => a.id === id)!, REV: t4BodyRevisions().revisions.find((r: any) => r.asset === id)!,
}));
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

// 클립 원본 = 재결합 base. 도적은 1단계 교정본 v2 출력, 궁수는 1단계 v6 의 클립 원본 v4.
const BASE: Record<string, { path: string, sha256: string }> = {
  rogue: { path: ROGUE_LIBRARY.output.path, sha256: ROGUE_LIBRARY.output.sha256 }, ranger: { path: RANGER_V4.output.path, sha256: RANGER_V4.output.sha256 },
};
const UNTUNED: Record<string, string[]> = { rogue: ['idle', 'run', 'hit', 'stab', 'slash_h', 'cheer'], ranger: ['idle', 'run', 'hit', 'cheer', 'bow_shoot', 'cast_shoot'] };

for (const { id, HERO, MOTION, ASSET, REV } of CASES) {
  test(id + ' 기록은 교정 몸·1단계 교정 클립 원본·저작 도구 SHA 에 묶이고 궁수와 같은 수용 기준을 통과한다', () => {
    expect(MOTION.revisionId).toBe(REV.id); expect(MOTION.motionRevisionId).toBe(REV.id.replace('-body-fit-', '-body-motion-'));
    expect(MOTION.body).toEqual({ path: REV.output.path, sha256: REV.output.sha256 });
    expect(sha(readFileSync('public' + MOTION.body.path))).toBe(MOTION.body.sha256);
    expect(MOTION.base).toEqual(BASE[HERO]); expect(MOTION.heroId).toBe(HERO);
    expect(sha(readFileSync(MOTION.tool.path))).toBe(MOTION.tool.sha256);
    expect(MOTION.tool.profile).toEqual(JSON.parse(JSON.stringify(PROFILE)));
    // 저작 띠를 좁힌 기록(궁수 U 구르기)은 띠가 수용 기준 안쪽이고 기록 항목의 띠와 같다.
    for (const [name, band] of Object.entries((MOTION.tool as any).bandOverrides || {}) as [string, number[]][]) {
      const rule = (PROFILE as any)[name];
      expect(band[0]).toBeGreaterThan(rule.accept[0]); expect(band[1]).toBeLessThan(rule.accept[1]);
      expect((MOTION.clipOverrides as any[]).find(entry => entry.base.clip === name).authoring.bandMeters).toEqual(band);
    }
    for (const entry of MOTION.clipOverrides as any[]) {
      expect(entry.validation.pass).toBe(true);
      expect(entry.authoring.initialOffsetMeters).toBe(0);
      expect(Math.max(Math.abs(entry.authoring.minOffsetMeters), entry.authoring.maxOffsetMeters)).toBeLessThanOrEqual(.35);
      if (entry.base.clip === 'dodge') {
        expect(entry.authoring.finalOffsetMeters).toBe(0);
        expect(entry.validation.densePenetrationMinMeters).toBeGreaterThan(-.03); expect(entry.validation.denseFloatMaxMeters).toBeLessThan(.03);
      } else {
        expect(entry.validation.densePenetrationMinMeters).toBeGreaterThan(-.01); expect(Math.abs(entry.validation.endMeters)).toBeLessThan(.03);
      }
    }
    expect(() => validateTierBandMotion(MOTION, REV)).not.toThrow();
  });

  test(id + ' 실제 spawn·교체는 회피·사망만 전용 곡선이고, 실제 런타임 스킨 접지가 수용 기준 안이다', async () => {
    const gltf = await loadHeroAsset(ASSET), inst = spawnCharacter(gltf);
    const base = await loadHeroModel(HERO, 1), swapped = spawnCharacter(base);
    try {
      expect(inst.root.userData.libraryBodyMotionIdentity).toEqual({ asset: id, heroId: HERO, revisionId: REV.id, path: REV.output.path, sha256: REV.output.sha256 });
      for (const name of TUNED) {
        const raw = gltf.animations.find((c: THREE.AnimationClip) => c.name === name)!, next = inst.clips[name];
        expect(next).not.toBe(raw); expect(next.duration).toBe(raw.duration);
        raw.tracks.forEach((track: THREE.KeyframeTrack, i: number) => { if (track.name !== 'mixamorigHips.position') expect(next.tracks[i]).toBe(track); });
      }
      for (const name of UNTUNED[HERO]) {
        expect(inst.clips[name]).toBe(gltf.animations.find((c: THREE.AnimationClip) => c.name === name));
      }
      expect(applyLibraryHeroBody(swapped.root, ASSET)).toBe(true);
      for (const name of TUNED) expect(swapped.clips[name]).toBe(inst.clips[name]);
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
      // 대기 자세 발은 바닥 근처(1단계와 같은 골격·클립이라 높이 보정은 하지 않는다).
      play(inst, inst.clips.idle, 0); expect(Math.abs(skinMinY(inst))).toBeLessThan(.015);
    } finally { disposeCharacter(inst.root, inst.mixer); disposeCharacter(swapped.root, swapped.mixer); }
  }, 60_000);

  test(id + ' 잘못된 몸·개정·출처·범위 기록과 다른 몸 SHA 의 선택은 거절한다', async () => {
    const bad = (patch: (m: any) => void) => { const m = structuredClone(MOTION) as any; patch(m); return () => validateTierBandMotion(m, REV); };
    expect(bad(() => {})).not.toThrow();
    expect(bad((m) => { m.body.sha256 = 'f'.repeat(64); })).toThrow();
    expect(bad((m) => { m.revisionId = HERO + '-t2-body-fit-v1'; })).toThrow();
    expect(bad((m) => { m.motionRevisionId = m.motionRevisionId.replace(/v1$/, 'v2'); })).toThrow();
    expect(bad((m) => { m.schema = 'blade-surge.ranger-band-body-motion.v1'; })).toThrow();
    expect(bad((m) => { m.asset = 'hero_' + HERO + '_t1'; })).toThrow();
    expect(bad((m) => { m.heroId = HERO === 'rogue' ? 'ranger' : 'rogue'; })).toThrow();
    expect(bad((m) => { m.base = { ...BASE[HERO === 'rogue' ? 'ranger' : 'rogue'] }; })).toThrow();
    expect(bad((m) => { m.base.sha256 = REV.output.sha256; })).toThrow();
    expect(bad((m) => { m.clipOverrides[0].authoring.maxOffsetMeters = .36; })).toThrow();
    expect(bad((m) => { m.clipOverrides[0].validation.pass = false; })).toThrow();
    expect(bad((m) => { m.clipOverrides[0].authoring.initialOffsetMeters = .01; })).toThrow();
    const gltf = await loadHeroAsset(ASSET), dodge = gltf.animations.find((c: THREE.AnimationClip) => c.name === 'dodge')!;
    const moved = structuredClone(MOTION) as any, entry = moved.clipOverrides.find((e: any) => e.base.clip === 'dodge');
    entry.outputTrack.values[30] += .5;
    expect(() => createRangerT1BodyMotionClip(dodge, validateTierBandMotion(moved, REV))).toThrow('수평');
    const inst = spawnCharacter(gltf);
    try {
      const identity = selectedBodyMotionIdentity(ASSET);
      expect(identity.revisionId).toBe(REV.id);
      expect(() => prepareHeroBodyMotion(inst.root, { ...identity, sha256: 'f'.repeat(64) })).toThrow();
    } finally { disposeCharacter(inst.root, inst.mixer); }
  }, 60_000);
}
