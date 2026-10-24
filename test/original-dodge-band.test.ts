import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, loadHeroAsset, spawnCharacter, applyLibraryHeroBody, disposeCharacter } from '../src/engine/assets.js';
import { validateOriginalDodgeBand, createOriginalDodgeBandClip, prepareHeroBodyMotion, selectedBodyMotionIdentity } from '../src/engine/hero-body-motion.js';
import BUNDLE from '../src/data/original-dodge-band-v1.json';
import manifest from '../asset-library/manifest.json';

// 기사·야만전사·마법사 원본 몸(교정 기록 없음) 구르기 골반 높이 띠(original-dodge-band-v1).
// 공유 원본 구르기는 몸을 바닥 아래로 판다(기사 2단계 -0.29m 등). 띠 곡선은 올리기만(0~0.35m, 시작·끝 0) 하고 수평·다른 트랙·길이는 원본 그대로다.
let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const asset = (id: string) => manifest.assets.find((a: any) => a.id === id)!;
const HIPS = 'mixamorigHips.position';

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
// 240Hz 격자 + 모든 키 시각으로 클립 전체의 스킨 최저 y 를 잰다.
function denseMin(inst: any, clip: THREE.AnimationClip) {
  const times = new Set<number>(); const n = Math.ceil(clip.duration * 240);
  for (let i = 0; i <= n; i++) times.add(Math.min(clip.duration, i / 240));
  for (const track of clip.tracks) for (const t of track.times) times.add(t);
  let low = Infinity;
  for (const t of times) { play(inst, clip, t); low = Math.min(low, skinMinY(inst)); }
  return low;
}
const clone = () => structuredClone(BUNDLE) as any;
const bundleWith = (patch: (b: any) => void) => { const b = clone(); patch(b); return b; };

test('원본 몸 구르기 띠 묶음의 모든 기록이 검증을 통과하고 몸 출처가 manifest 원본과 같다', () => {
  expect(() => validateOriginalDodgeBand(BUNDLE)).not.toThrow();
  expect(BUNDLE.bodies.length).toBe(17);
  for (const body of BUNDLE.bodies as any[]) {
    const a: any = asset(body.asset); expect(a).toBeTruthy();
    expect(body.body.path).toBe(a.file); expect(body.body.sha256).toBe(a.sha256);
    expect(sha(readFileSync('asset-library/normalized' + body.body.path.replace('/models/library','')))).toBe(body.body.sha256);
    expect(selectedBodyMotionIdentity(a).revisionId).toBeNull();
    expect(body.validation.pass).toBe(true);
    expect(body.validation.densePenetrationMinMeters).toBeGreaterThan(-.03);
    expect(body.offsetsMeters[0]).toBe(0); expect(body.offsetsMeters.at(-1)).toBe(0);
    expect(Math.min(...body.offsetsMeters)).toBeGreaterThanOrEqual(0); expect(Math.max(...body.offsetsMeters)).toBeLessThanOrEqual(.35);
  }
  for (const base of Object.values(BUNDLE.bases) as any[]) {
    const a: any = asset(base.asset); expect(base.path).toBe(a.file); expect(base.sha256).toBe(a.sha256);
  }
});

const REPS = ['hero_knight_t1', 'hero_knight_t2', 'avatar_knight_sakura', 'hero_mage_t2', 'hero_barbarian_t1'];
for (const id of REPS) {
  test(id + ' 실제 spawn 의 구르기는 교체된 클립이고 골반 수직 성분만 다르며 접지 띠 안이다', async () => {
    const a: any = asset(id), gltf = await loadHeroAsset(a), inst = spawnCharacter(gltf);
    try {
      const rec: any = (BUNDLE.bodies as any[]).find(b => b.asset === id);
      const raw = gltf.animations.find((c: THREE.AnimationClip) => c.name === 'dodge')!, next = inst.clips.dodge;
      expect(next).not.toBe(raw); expect(next.duration).toBe(raw.duration);
      expect(inst.clips.Dodge_Forward).toBe(next);
      raw.tracks.forEach((track: THREE.KeyframeTrack, i: number) => { if (track.name !== HIPS) expect(next.tracks[i]).toBe(track); });
      const o = raw.tracks.find((t: THREE.KeyframeTrack) => t.name === HIPS)!, r = next.tracks.find((t: THREE.KeyframeTrack) => t.name === HIPS)!;
      expect(r).not.toBe(o);
      const ref = o.createInterpolant(), axis = rec.authoring.parentWorldYAxis;
      for (let i = 0; i < r.times.length; i++) {
        const v = ref.evaluate(r.times[i]);
        for (let c = 0; c < 3; c++) if (c !== axis) expect(r.values[i * 3 + c]).toBe(Math.fround(v[c]));
      }
      const low = denseMin(inst, next); expect(low).toBeGreaterThan(-.03);
      if (id === 'hero_knight_t2') expect(denseMin(inst, raw)).toBeLessThan(-.25);
    } finally { disposeCharacter(inst.root, inst.mixer); }
  }, 120_000);
}

for (const id of ['hero_barbarian_t2u', 'avatar_mage_astral']) {
  test(id + ' 기록 없는 몸은 원본 구르기 클립 그대로다', async () => {
    expect((BUNDLE.bodies as any[]).some(b => b.asset === id)).toBe(false);
    const gltf = await loadHeroAsset(asset(id)), inst = spawnCharacter(gltf);
    try {
      expect(inst.clips.dodge).toBe(gltf.animations.find((c: THREE.AnimationClip) => c.name === 'dodge'));
    } finally { disposeCharacter(inst.root, inst.mixer); }
  }, 60_000);
}

test('기사 1단계 -> 2단계 -> 1단계 몸 교체 시 구르기 클립이 몸마다 바뀌고 되돌아오며 사망 클립은 그대로다', async () => {
  const t1 = asset('hero_knight_t1'), t2 = asset('hero_knight_t2');
  const g1 = await loadHeroAsset(t1), g2 = await loadHeroAsset(t2);
  const ref1 = spawnCharacter(g1), ref2 = spawnCharacter(g2);
  const base = await loadHeroModel('knight', 1), swapped = spawnCharacter(base);
  try {
    const death0 = swapped.clips.death;
    // 기본 knight 1단계가 이미 라이브러리 t1 몸이면 t1 으로의 교체는 no-op(false)이고, 아니면 교체된다. 어느 쪽이든 t1 몸 상태가 된다.
    applyLibraryHeroBody(swapped.root, t1);
    expect(swapped.root.userData.libraryBodyAssetId).toBe('hero_knight_t1');
    const d1 = swapped.clips.dodge; expect(d1).toBe(ref1.clips.dodge);
    expect(applyLibraryHeroBody(swapped.root, t2)).toBe(true);
    const d2 = swapped.clips.dodge; expect(d2).toBe(ref2.clips.dodge); expect(d2).not.toBe(d1);
    expect(swapped.clips.Dodge_Forward).toBe(d2);
    expect(applyLibraryHeroBody(swapped.root, t1)).toBe(true);
    expect(swapped.clips.dodge).toBe(d1); expect(swapped.clips.Dodge_Forward).toBe(d1);
    // 사망 클립은 기사에 띠 곡선이 없으므로 원본 그대로.
    expect(swapped.clips.death).toBe(death0);
    expect(swapped.clips.death).toBe(g1.animations.find((c: THREE.AnimationClip) => c.name === 'death'));
  } finally { for (const x of [ref1, ref2, swapped]) disposeCharacter(x.root, x.mixer); }
}, 120_000);

test('변조된 기록과 원본 트랙은 거절한다', async () => {
  expect(() => validateOriginalDodgeBand(clone())).not.toThrow();
  const mid = (b: any) => Math.floor(b.bodies[0].offsetsMeters.findIndex((x: number) => x > 0.01));
  expect(() => validateOriginalDodgeBand(bundleWith(b => { b.bodies[0].offsetsMeters[mid(b)] = -.01; }))).toThrow();
  expect(() => validateOriginalDodgeBand(bundleWith(b => { b.bodies[0].offsetsMeters[mid(b)] = .4; }))).toThrow();
  expect(() => validateOriginalDodgeBand(bundleWith(b => { b.bodies[0].offsetsMeters[0] = .01; }))).toThrow();
  expect(() => validateOriginalDodgeBand(bundleWith(b => { b.bodies[0].offsetsMeters[b.bodies[0].offsetsMeters.length - 1] = .01; }))).toThrow();
  expect(() => validateOriginalDodgeBand(bundleWith(b => { b.bodies[0].validation.pass = false; }))).toThrow();
  expect(() => validateOriginalDodgeBand(bundleWith(b => { b.schema = 'x'; }))).toThrow();
  expect(() => validateOriginalDodgeBand(bundleWith(b => { b.bodies[1].asset = b.bodies[0].asset; }))).toThrow();
  // base 트랙 값 변경: 묶음 검증은 통과해도 실제 디코딩된 원본과 달라 클립 생성이 거절한다.
  const gltf = await loadHeroAsset(asset('hero_knight_t1')), dodge = gltf.animations.find((c: THREE.AnimationClip) => c.name === 'dodge')!;
  const tampered = validateOriginalDodgeBand(bundleWith(b => { b.bases.hero_knight_t1.values[7] += .01; }));
  expect(() => createOriginalDodgeBandClip(dodge, tampered.bodies[0], tampered)).toThrow();
  expect(() => createOriginalDodgeBandClip(dodge, BUNDLE.bodies[0])).not.toThrow();
  // 다른 몸 SHA 의 선택은 prepare 가 거절한다.
  const inst = spawnCharacter(gltf);
  try {
    const identity = selectedBodyMotionIdentity(asset('hero_knight_t1'));
    expect(() => prepareHeroBodyMotion(inst.root, identity)).not.toThrow();
    expect(() => prepareHeroBodyMotion(inst.root, { ...identity, sha256: 'f'.repeat(64) })).toThrow();
  } finally { disposeCharacter(inst.root, inst.mixer); }
}, 60_000);
