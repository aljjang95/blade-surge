import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import { loadHeroModel, loadHeroAsset, preloadHeroBody, spawnCharacter, applyLibraryHeroBody, disposeCharacter } from '../src/engine/assets.js';
import { createBodyMotionClip, registerHeroBodyMotion, refreshHeroBodyMotion, disposeHeroBodyMotion } from '../src/engine/hero-body-motion.js';
import MOTION from '../src/data/fox-body-motion-v1.json';
import manifest from '../asset-library/manifest.json';

let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const asset = (id: string) => {
  const result = manifest.assets.find(entry => entry.id === id);
  if (!result) throw new Error('테스트 자산 없음: ' + id);
  return result;
};
function bytes(array: ArrayBufferView) {
  return createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
}
function fingerprint(clips: THREE.AnimationClip[]) {
  return clips.map(clip => ({ name: clip.name, duration: clip.duration, blendMode: clip.blendMode,
    tracks: clip.tracks.map(track => ({ name: track.name, type: track.ValueTypeName, interpolation: track.getInterpolation(),
      times: bytes(track.times), values: bytes(track.values) })) }));
}
function assertOverlay(base: THREE.AnimationClip, overlay: THREE.AnimationClip) {
  expect(overlay).not.toBe(base);
  expect(overlay.name).toBe(base.name); expect(overlay.duration).toBe(base.duration);
  expect(overlay.blendMode).toBe(base.blendMode); expect(overlay.tracks.length).toBe(base.tracks.length);
  let replaced = 0;
  base.tracks.forEach((track, index) => {
    if (track.name === 'mixamorigHips.position') {
      replaced++; expect(overlay.tracks[index]).not.toBe(track);
      expect(overlay.tracks[index]).toBeInstanceOf(THREE.VectorKeyframeTrack);
      const next = overlay.tracks[index];
      expect(next.values[0]).toBe(track.values[0]); expect(next.values[2]).toBe(track.values[2]);
      expect(Math.abs(next.values[1] - track.values[1] - (base.name === 'dodge' ? .3333334167 : 0))).toBeLessThanOrEqual(1e-4);
      if (base.name === 'dodge') expect(Array.from(next.values.slice(-3))).toEqual(Array.from(track.values.slice(-3)));
      else {
        expect(next.values[next.values.length - 3]).toBe(track.values[track.values.length - 3]);
        expect(next.values[next.values.length - 1]).toBe(track.values[track.values.length - 1]);
        const delta = next.values[next.values.length - 2] - track.values[track.values.length - 2];
        expect(delta).toBeGreaterThan(2.77); expect(delta).toBeLessThan(2.79);
      }
    } else expect(overlay.tracks[index]).toBe(track);
  });
  expect(replaced).toBe(1);
}

test('실제 direct 여우만 저작 골반 트랙을 쓰고 공유 궁수 GLB·다른 클립 바이트는 그대로다', async () => {
  const base = await loadHeroModel('ranger', 1), before = fingerprint(base.animations);
  const fox = await loadHeroAsset(asset('avatar_ranger_fox'));
  const baseDodge = base.animations.find((clip: THREE.AnimationClip) => clip.name === 'dodge')!;
  expect(fox.animations).toBe(base.animations);
  const direct = spawnCharacter(fox), second = spawnCharacter(fox), ordinary = spawnCharacter(base);
  try {
    expect(direct.root.userData.libraryBodyAssetId).toBe('avatar_ranger_fox');
    assertOverlay(baseDodge, direct.clips.dodge);
    expect(direct.clips.Dodge_Forward).toBe(direct.clips.dodge);
    expect(second.clips.dodge).toBe(direct.clips.dodge);
    expect(ordinary.clips.dodge).toBe(baseDodge);
    expect(ordinary.clips.Dodge_Forward).toBe(baseDodge);
    const death = ordinary.clips.death;
    assertOverlay(death, direct.clips.death);
    expect(direct.clips.Death_A).toBe(direct.clips.death); expect(direct.clips.Death_B).toBe(direct.clips.death);
    expect(second.clips.death).toBe(direct.clips.death);
    expect(ordinary.clips.Death_A).toBe(death);
    for (const clip of base.animations as THREE.AnimationClip[]) {
      if (['dodge', 'death'].includes(clip.name)) continue;
      // 대표님이 허용한 Interact 회전 저작만 별도 복제한다. 골반과 공유 원본 보호는 유지한다.
      if (clip.name === 'interact') {
        const authored = direct.clips.interact;
        expect(authored).not.toBe(clip); expect(authored.duration).toBe(clip.duration);
        expect(authored).toBe(ordinary.clips.interact); expect(authored).toBe(second.clips.interact);
        for (let i = 0; i < clip.tracks.length; i++) if (clip.tracks[i].ValueTypeName !== 'quaternion') expect(authored.tracks[i]).toBe(clip.tracks[i]);
      } else expect(direct.clips[clip.name]).toBe(clip);
    }
    expect(fingerprint(base.animations)).toEqual(before); expect(fingerprint(fox.animations)).toEqual(before);
  } finally {
    for (const instance of [direct, second, ordinary]) disposeCharacter(instance.root, instance.mixer);
  }
});

test('실제 몸체 swap은 미래 회피 조회만 바꾸고 기존 액션·추가 키·다른 인스턴스를 보존한다', async () => {
  const base = await loadHeroModel('ranger', 1), before = fingerprint(base.animations);
  await preloadHeroBody('ranger', 1, 'avatar_ranger_fox');
  const instance = spawnCharacter(base), unaffected = spawnCharacter(base);
  const baseDeath = instance.clips.death;
  const baseDodge = instance.clips.dodge, custom = new THREE.AnimationClip('RangerBowUpper', .2, []);
  instance.clips.RangerBowUpper = custom;
  instance.clips.PlayerCustomDodge = baseDodge;
  const playing = instance.mixer.clipAction(baseDodge); playing.play(); instance.mixer.update(.125);
  const actionBefore = { time: playing.time, enabled: playing.enabled, paused: playing.paused, weight: playing.getEffectiveWeight(), running: playing.isRunning() };
  try {
    expect(applyLibraryHeroBody(instance.root, asset('avatar_ranger_fox'))).toBe(true);
    const overlay = instance.clips.dodge;
    assertOverlay(baseDodge, overlay);
    expect(instance.clips.Dodge_Forward).toBe(overlay);
    const deathOverlay = instance.clips.death; assertOverlay(baseDeath, deathOverlay);
    expect(instance.clips.Death_A).toBe(deathOverlay); expect(instance.clips.Death_B).toBe(deathOverlay);
    expect(instance.clips.RangerBowUpper).toBe(custom); expect(instance.clips.PlayerCustomDodge).toBe(baseDodge);
    expect(unaffected.clips.dodge).toBe(baseDodge);
    expect(playing.getClip()).toBe(baseDodge);
    expect({ time: playing.time, enabled: playing.enabled, paused: playing.paused, weight: playing.getEffectiveWeight(), running: playing.isRunning() }).toEqual(actionBefore);
    expect(applyLibraryHeroBody(instance.root, asset('hero_ranger_t1'))).toBe(true);
    expect(instance.clips.dodge).toBe(baseDodge); expect(instance.clips.Dodge_Forward).toBe(baseDodge);
    expect(instance.clips.death).toBe(baseDeath); expect(instance.clips.Death_A).toBe(baseDeath); expect(instance.clips.Death_B).toBe(baseDeath);
    expect(instance.clips.RangerBowUpper).toBe(custom); expect(instance.clips.PlayerCustomDodge).toBe(baseDodge);
    expect(applyLibraryHeroBody(instance.root, asset('avatar_ranger_fox'))).toBe(true);
    expect(instance.clips.dodge).toBe(overlay); expect(instance.clips.death).toBe(deathOverlay);
    expect(fingerprint(base.animations)).toEqual(before);
  } finally {
    disposeCharacter(instance.root, instance.mixer); disposeCharacter(unaffected.root, unaffected.mixer);
  }
});

test('등록 뒤 덮어쓴 별칭과 다른 직업은 보존하고 해제된 root의 조회는 갱신하지 않는다', async () => {
  const base = await loadHeroModel('ranger', 1), dodge: THREE.AnimationClip = base.animations.find((clip: THREE.AnimationClip) => clip.name === 'dodge')!;
  const root = new THREE.Group(); root.userData.authoredContract = { heroId: 'ranger' }; root.userData.libraryBodyAssetId = 'hero_ranger_t1';
  const clips: Record<string, THREE.AnimationClip> = { dodge, Dodge_Forward: dodge };
  registerHeroBodyMotion(root, clips);
  const custom = new THREE.AnimationClip('custom', .1, []); clips.Dodge_Forward = custom;
  root.userData.libraryBodyAssetId = 'avatar_ranger_fox'; refreshHeroBodyMotion(root);
  expect(clips.dodge).not.toBe(dodge); expect(clips.Dodge_Forward).toBe(custom);
  const overlay = clips.dodge;
  disposeHeroBodyMotion(root); root.userData.libraryBodyAssetId = 'hero_ranger_t1'; refreshHeroBodyMotion(root);
  expect(clips.dodge).toBe(overlay);
  const rogue = new THREE.Group(); rogue.userData.authoredContract = { heroId: 'rogue' }; rogue.userData.libraryBodyAssetId = 'avatar_ranger_fox';
  const other = { dodge }; registerHeroBodyMotion(rogue, other); refreshHeroBodyMotion(rogue);
  expect(other.dodge).toBe(dodge);
});

test('잘못된 출처·트랙·시간·수평 이동·끝 자세는 원본을 바꾸기 전에 거부한다', async () => {
  const base = await loadHeroModel('ranger', 1), before = fingerprint(base.animations);
  const dodge: THREE.AnimationClip = base.animations.find((clip: THREE.AnimationClip) => clip.name === 'dodge')!;
  const overriddenDodge = (motion: typeof MOTION) => {
    const entry = motion.clipOverrides.find(item => item.base.clip === 'dodge');
    if (!entry) throw new Error('테스트 회피 override 없음');
    return entry;
  };
  const mutations: Array<(motion: typeof MOTION) => void> = [
    motion => { motion.asset = 'hero_ranger_t1'; },
    motion => { motion.base.sha256 = 'wrong'; },
    motion => { motion.base.path = '/wrong.glb'; },
    motion => { overriddenDodge(motion).base.sourceTrackSha256 = 'wrong'; },
    motion => { overriddenDodge(motion).base.clip = 'run'; },
    motion => { overriddenDodge(motion).base.duration = .6; },
    motion => { overriddenDodge(motion).authoring.initialOffsetMeters = 0; },
    motion => { overriddenDodge(motion).outputTrack.name = 'mixamorigHips.quaternion'; },
    motion => { overriddenDodge(motion).outputTrack.type = 'quaternion'; },
    motion => { overriddenDodge(motion).outputTrack.times[1] = overriddenDodge(motion).outputTrack.times[0]; },
    motion => { overriddenDodge(motion).outputTrack.times[overriddenDodge(motion).outputTrack.times.length - 1] = .49; },
    motion => { overriddenDodge(motion).outputTrack.values.pop(); },
    motion => { overriddenDodge(motion).outputTrack.values[4] = NaN; },
    motion => { overriddenDodge(motion).outputTrack.values[3] += .1; },
    motion => { overriddenDodge(motion).outputTrack.values[1] += .1; },
    motion => { overriddenDodge(motion).outputTrack.values[1] -= .3333334167; },
    motion => { const values = overriddenDodge(motion).outputTrack.values; values[values.length - 2] += .1; },
    motion => { overriddenDodge(motion).outputTrack.values[4] += 100; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(MOTION); mutate(invalid);
    expect(() => createBodyMotionClip(dodge, invalid)).toThrow();
  }
  const death: THREE.AnimationClip = base.animations.find((clip: THREE.AnimationClip) => clip.name === 'death')!;
  for (const corruptMetadata of [false, true]) {
    const invalid = structuredClone(MOTION), entry = invalid.clipOverrides.find(item => item.base.clip === 'death')!;
    if (corruptMetadata) entry.authoring.initialOffsetMeters = .006;
    else entry.outputTrack.values[1] += .1;
    expect(() => createBodyMotionClip(death, invalid)).toThrow();
  }
  const wrong = dodge.clone(); wrong.name = 'run';
  expect(() => createBodyMotionClip(wrong)).toThrow();
  wrong.name = 'dodge'; wrong.duration = .6;
  expect(() => createBodyMotionClip(wrong)).toThrow();
  const missing = dodge.clone(); missing.tracks = missing.tracks.filter(track => track.name !== 'mixamorigHips.position');
  expect(() => createBodyMotionClip(missing)).toThrow();
  expect(fingerprint(base.animations)).toEqual(before);
});

test('저작 출처의 골반 트랙 SHA는 실제 v4 decoded Float32 원본과 일치한다', async () => {
  const base = await loadHeroModel('ranger', 1);
  for (const entry of MOTION.clipOverrides) {
    const clip: THREE.AnimationClip = base.animations.find((item: THREE.AnimationClip) => item.name === entry.base.clip)!;
    const track = clip.tracks.find((item: THREE.KeyframeTrack) => item.name === entry.base.hipsTrack)!;
    const name = Buffer.concat([Buffer.from(track.name, 'utf8'), Buffer.from([0])]), sizes = Buffer.alloc(8);
    sizes.writeUInt32LE(track.times.length, 0); sizes.writeUInt32LE(track.values.length, 4);
    const timeBytes = Buffer.alloc(track.times.length * 4), valueBytes = Buffer.alloc(track.values.length * 4);
    Array.from(track.times).forEach((value, index) => timeBytes.writeFloatLE(value, index * 4));
    Array.from(track.values).forEach((value, index) => valueBytes.writeFloatLE(value, index * 4));
    expect(createHash('sha256').update(Buffer.concat([name, sizes, timeBytes, valueBytes])).digest('hex')).toBe(entry.base.sourceTrackSha256);
  }
});
