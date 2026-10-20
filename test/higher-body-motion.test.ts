import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHigherBodyMotionRegistry, createHigherBodyMotionClip, registerHeroBodyMotion, prepareHeroBodyMotion,
  commitHeroBodyMotion, refreshHeroBodyMotion, disposeHeroBodyMotion } from '../src/engine/hero-body-motion.js';
import { loadHeroModel, loadHeroAsset, preloadHeroBody, spawnCharacter, applyLibraryHeroBody, disposeCharacter } from '../src/engine/assets.js';
import { installRangerRuntimeLoader } from '../tools/art/ranger-runtime-loader.mjs';
import REVISIONS from '../src/data/higher-body-revisions-v1.json';
import MOTIONS from '../src/data/higher-body-motion-v1.json';
import R2_MOTION from '../src/data/rogue-t2-body-motion-v2.json';
const ACTIVE_MOTIONS = { schema: 'blade-surge.higher-body-motion.v2',
  bodies: [...MOTIONS.bodies.filter(body => body.asset !== 'hero_rogue_t2'), R2_MOTION] };
import RANGER from '../src/data/ranger-library-revision-v4.json';
import manifest from '../asset-library/manifest.json';

let restore = () => {};
beforeAll(() => { restore = installRangerRuntimeLoader(); });
afterAll(() => restore());
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function trackSha(track: THREE.KeyframeTrack) {
  const sizes = Buffer.alloc(8); sizes.writeUInt32LE(track.times.length, 0); sizes.writeUInt32LE(track.values.length, 4);
  const bytes = Buffer.alloc((track.times.length + track.values.length) * 4);
  [...track.times, ...track.values].forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return sha(Buffer.concat([Buffer.from(track.name + '\0'), sizes, bytes]));
}
function fixture(asset = 'hero_ranger_t2', height = .04) {
  // 아래 SHA와 생성 상태는 격리된 단위 테스트 fixture 전용이다. 제품 JSON에는 기록하지 않는다.
  const revisions = structuredClone(REVISIONS), revision = revisions.revisions.find(item => item.asset === asset)!;
  const fakeSha = sha('synthetic body ' + asset);
  const bodyOutput = { path: revision.output.path, sha256: fakeSha };
  Object.assign(revision, { status: 'GENERATED', useInGame: true, output: bodyOutput });
  const track = new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, .5], [0, 1, 0, 0, 1, 0]);
  const other = new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', [0, .5], [0, 0, 0, 1, 0, 0, 0, 1]);
  const clip = new THREE.AnimationClip('dodge', .5, [track, other]);
  const times = Array.from({ length: 61 }, (_, index) => index / 120);
  const prefix = asset === 'hero_ranger_t2' ? 'ranger-t2' : 'ranger-t3';
  const body = {
    asset, heroId: 'ranger', revisionId: revision.id, body: bodyOutput, base: { ...RANGER.output },
    motionRevisionId: prefix + '-body-motion-v1', output: { path: '/models/heroes-next/' + prefix + '-body-motion-v1.json', sha256: sha('fixture packet ' + height) },
    clipOverrides: [{ base: { clip: 'dodge', duration: .5, hipsTrack: track.name, interpolation: 'LINEAR',
      sourceTrackSha256: trackSha(track), times: Array.from(track.times), values: Array.from(track.values) },
    outputTrack: { name: track.name, type: 'vector', interpolation: 'LINEAR', times,
      values: times.flatMap(time => [0, 1 + height * Math.sin(2 * Math.PI * time) ** 2 / .018, 0]) },
    authoring: { profileId: 'synthetic-only', parentWorldYGain: .018, initialOffsetMeters: 0, finalOffsetMeters: 0, maxOffsetMeters: height },
    validation: { supportStartMeters: 0, supportEndMeters: 0 } }],
  };
  const bundle = { schema: MOTIONS.schema, bodies: [body] };
  return { revisions, bundle, body, clip, track, other };
}
function rootWith(clip: THREE.AnimationClip) {
  const root = new THREE.Group(), parent = new THREE.Group(), hips = new THREE.Bone();
  parent.scale.setScalar(.018); hips.name = 'mixamorigHips'; parent.add(hips); root.add(parent);
  root.userData.authoredContract = { heroId: 'ranger' }; root.userData.libraryBodyAssetId = 'hero_ranger_t1';
  const clips: Record<string, THREE.AnimationClip> = { dodge: clip, Dodge_Forward: clip };
  return { root, clips, parent };
}
const identity = (body: ReturnType<typeof fixture>['body']) => ({ asset: body.asset, heroId: body.heroId,
  revisionId: body.revisionId, path: body.body.path, sha256: body.body.sha256 });

test('빈 신규 모션 번들은 원본을 유지하고 실제 활성 패킷만 등록할 수 있다', () => {
  expect(createHigherBodyMotionRegistry({ schema: MOTIONS.schema, bodies: [] })).toEqual([]);
  expect(createHigherBodyMotionRegistry(ACTIVE_MOTIONS).length).toBe(5);
  expect(() => createHigherBodyMotionRegistry(MOTIONS)).toThrow();
  const f = fixture();
  expect(() => createHigherBodyMotionRegistry(f.bundle)).toThrow();
  const registry = createHigherBodyMotionRegistry(f.bundle, f.revisions);
  expect(Object.isFrozen(registry[0])).toBe(true);
  for (const mutate of [
    (body: typeof f.body) => { body.asset = 'avatar_ranger_fox'; },
    (body: typeof f.body) => { body.heroId = 'rogue'; },
    (body: typeof f.body) => { body.body.sha256 = sha('other body'); },
    (body: typeof f.body) => { body.body.path += '?other'; },
    (body: typeof f.body) => { body.base.sha256 = sha('wrong canonical'); },
    (body: typeof f.body) => { body.output.path = '/models/heroes-next/../wrong.json'; },
    (body: typeof f.body) => { body.clipOverrides[0].base.clip = 'attack'; },
    (body: typeof f.body) => { body.clipOverrides[0].authoring.maxOffsetMeters = .351; },
    (body: typeof f.body) => { body.clipOverrides[0].validation.supportEndMeters = .021; },
  ]) {
    const invalid = structuredClone(f.bundle); mutate(invalid.bodies[0]);
    expect(() => createHigherBodyMotionRegistry(invalid, f.revisions)).toThrow();
  }
  expect(() => createHigherBodyMotionRegistry({ ...f.bundle, bodies: [f.body, f.body] }, f.revisions)).toThrow();
});

test('decoded 원본 snapshot·수평 좌표·저작 범위를 검사하고 다른 트랙 reference를 보존한다', () => {
  const f = fixture(), before = Array.from(f.track.values), registry = createHigherBodyMotionRegistry(f.bundle, f.revisions);
  const overlay = createHigherBodyMotionClip(f.clip, registry[0]);
  expect(overlay.tracks[1]).toBe(f.other); expect(overlay.tracks[0]).not.toBe(f.track);
  expect(overlay.name).toBe(f.clip.name); expect(overlay.duration).toBe(f.clip.duration);
  for (const mutate of [
    (body: typeof f.body) => { body.clipOverrides[0].base.values[1] += .001; },
    (body: typeof f.body) => { body.clipOverrides[0].outputTrack.values[3] = .001; },
    (body: typeof f.body) => { body.clipOverrides[0].outputTrack.values[4] = 100; },
    (body: typeof f.body) => { body.clipOverrides[0].outputTrack.values[1] += .01; },
    (body: typeof f.body) => { body.clipOverrides[0].outputTrack.times[1] = 0; },
    (body: typeof f.body) => { body.clipOverrides[0].outputTrack.values = body.clipOverrides[0].outputTrack.times.flatMap(() => [0, 1, 0]); },
  ]) {
    const invalid = structuredClone(f.bundle); mutate(invalid.bodies[0]);
    const records = createHigherBodyMotionRegistry(invalid, f.revisions);
    expect(() => createHigherBodyMotionClip(f.clip, records[0])).toThrow();
  }
  expect(Array.from(f.track.values)).toEqual(before);
});

test('A→B→기본 복원·캐시·다른 인스턴스·사용자 별칭과 진행 중 액션을 보존한다', () => {
  const a = fixture(), b = fixture('hero_ranger_t3', .06);
  const revisions = structuredClone(a.revisions); revisions.revisions[1] = b.revisions.revisions[1];
  const registry = createHigherBodyMotionRegistry({ schema: MOTIONS.schema, bodies: [a.body, b.body] }, revisions);
  const first = rootWith(a.clip), second = rootWith(a.clip);
  registerHeroBodyMotion(first.root, first.clips, registry); registerHeroBodyMotion(second.root, second.clips, registry);
  const mixer = new THREE.AnimationMixer(first.root), action = mixer.clipAction(a.clip).play(); mixer.update(.125);
  const time = action.time, custom = new THREE.AnimationClip('custom', .1, []);
  first.clips.PlayerCustom = a.clip;
  const use = (body: typeof a.body) => commitHeroBodyMotion(first.root, prepareHeroBodyMotion(first.root, identity(body)));
  expect(use(a.body)).toBe(true); const overlayA = first.clips.dodge;
  expect(first.clips.Dodge_Forward).toBe(overlayA); expect(second.clips.dodge).toBe(a.clip);
  expect(use(b.body)).toBe(true); expect(first.clips.dodge).not.toBe(overlayA);
  expect(first.clips.Dodge_Forward).toBe(first.clips.dodge);
  first.clips.Dodge_Forward = custom;
  expect(use(a.body)).toBe(true); expect(first.clips.dodge).toBe(overlayA); expect(first.clips.Dodge_Forward).toBe(custom);
  commitHeroBodyMotion(first.root, prepareHeroBodyMotion(first.root, { asset: 'hero_ranger_t1' }));
  expect(first.clips.dodge).toBe(a.clip); expect(first.clips.Dodge_Forward).toBe(custom); expect(first.clips.PlayerCustom).toBe(a.clip);
  expect(action.time).toBe(time); expect(action.getClip()).toBe(a.clip); expect(action.isRunning()).toBe(true);
  const plan = prepareHeroBodyMotion(first.root, identity(a.body));
  disposeHeroBodyMotion(first.root); expect(commitHeroBodyMotion(first.root, plan)).toBe(false);
  disposeHeroBodyMotion(second.root); mixer.stopAllAction(); mixer.uncacheRoot(first.root);
});

test('직접 등록과 전체 preflight는 body SHA·부모 축 오류 시 별칭을 일부 설치하지 않는다', () => {
  const f = fixture(), registry = createHigherBodyMotionRegistry(f.bundle, f.revisions), instance = rootWith(f.clip);
  instance.root.userData.libraryBodyMotionIdentity = identity(f.body);
  registerHeroBodyMotion(instance.root, instance.clips, registry);
  expect(instance.clips.dodge).not.toBe(f.clip);
  const before = instance.clips.dodge;
  expect(() => prepareHeroBodyMotion(instance.root, { ...identity(f.body), sha256: sha('bad') })).toThrow();
  instance.parent.scale.y = .019;
  expect(() => prepareHeroBodyMotion(instance.root, identity(f.body))).toThrow();
  expect(instance.clips.dodge).toBe(before); disposeHeroBodyMotion(instance.root);
});

test('같은 canonical에서 A→fox→A를 복원하고 다른 body SHA의 캐시는 격리한다', async () => {
  const canonical = await loadHeroModel('ranger', 1);
  const clip: THREE.AnimationClip = canonical.animations.find((item: THREE.AnimationClip) => item.name === 'dodge')!;
  const track = clip.tracks.find(item => item.name === 'mixamorigHips.position')!;
  const f = fixture(), entry = f.body.clipOverrides[0];
  entry.base.times = Array.from(track.times); entry.base.values = Array.from(track.values); entry.base.sourceTrackSha256 = trackSha(track);
  const times = [...new Set([...entry.outputTrack.times, ...track.times])].sort((a, b) => a - b);
  const interpolant = (track as THREE.KeyframeTrack & { createInterpolant: (buffer: Float32Array) => THREE.Interpolant }).createInterpolant(new Float32Array(3));
  entry.outputTrack.times = times;
  entry.outputTrack.values = times.flatMap(time => {
    const value = interpolant.evaluate(time);
    return [value[0], value[1] + .04 * Math.sin(2 * Math.PI * time) ** 2 / .018, value[2]];
  });
  const instance = rootWith(clip), registry = createHigherBodyMotionRegistry(f.bundle, f.revisions);
  registerHeroBodyMotion(instance.root, instance.clips, registry);
  commitHeroBodyMotion(instance.root, prepareHeroBodyMotion(instance.root, identity(f.body))); const overlay = instance.clips.dodge;
  commitHeroBodyMotion(instance.root, prepareHeroBodyMotion(instance.root, { asset: 'avatar_ranger_fox' }));
  expect(instance.clips.dodge).not.toBe(overlay); expect(instance.clips.Dodge_Forward).toBe(instance.clips.dodge);
  commitHeroBodyMotion(instance.root, prepareHeroBodyMotion(instance.root, identity(f.body)));
  expect(instance.clips.dodge).toBe(overlay); expect(instance.clips.Dodge_Forward).toBe(overlay);
  const changed = structuredClone(f.bundle), revisions = structuredClone(f.revisions), nextSha = sha('new synthetic body');
  changed.bodies[0].body.sha256 = nextSha;
  Object.assign(revisions.revisions[0].output, { sha256: nextSha });
  const other = rootWith(clip); other.root.userData.libraryBodyMotionIdentity = identity(changed.bodies[0]);
  registerHeroBodyMotion(other.root, other.clips, createHigherBodyMotionRegistry(changed, revisions));
  expect(other.clips.dodge).not.toBe(overlay);
  disposeHeroBodyMotion(instance.root); disposeHeroBodyMotion(other.root);
});

test('실제 swap preflight 거절은 기존 mesh·재질·skeleton·별칭을 유지한다', async () => {
  const base = await loadHeroModel('ranger', 1); await preloadHeroBody('ranger', 2);
  const instance = spawnCharacter(base), f = fixture();
  const target = manifest.assets.find(asset => asset.id === 'hero_ranger_t2')!;
  disposeHeroBodyMotion(instance.root);
  registerHeroBodyMotion(instance.root, instance.clips, createHigherBodyMotionRegistry(f.bundle, f.revisions));
  const meshes: THREE.SkinnedMesh[] = [];
  instance.root.traverse(node => { if (node instanceof THREE.SkinnedMesh && node.userData.libraryBody) meshes.push(node); });
  const before = meshes.map(mesh => ({ mesh, parent: mesh.parent, skeleton: mesh.skeleton, material: mesh.material }));
  const clips = { ...instance.clips }, body = instance.root.userData.libraryBodyAssetId;
  let disposed = false;
  for (const mesh of meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.addEventListener('dispose', () => { disposed = true; });
  try {
    expect(applyLibraryHeroBody(instance.root, target)).toBe(false);
    expect(instance.root.userData.libraryBodyAssetId).toBe(body); expect(instance.clips).toEqual(clips); expect(disposed).toBe(false);
    for (const entry of before) { expect(entry.mesh.parent).toBe(entry.parent); expect(entry.mesh.skeleton).toBe(entry.skeleton); expect(entry.mesh.material).toBe(entry.material); }
  } finally { disposeCharacter(instance.root, instance.mixer); }
});

test('활성 실제 패킷은 파일 SHA와 원본 decoded Float32 snapshot에 결합한다', async () => {
  const registry = createHigherBodyMotionRegistry(ACTIVE_MOTIONS);
  for (const body of registry) {
    expect(sha(readFileSync('public' + body.body.path))).toBe(body.body.sha256);
    const packet = readFileSync('public' + body.output.path);
    expect(sha(packet)).toBe(body.output.sha256);
    expect(JSON.parse(packet.toString()).clipOverrides).toEqual(body.clipOverrides);
    expect(sha(readFileSync('public' + body.base.path))).toBe(body.base.sha256);
    const canonical = await loadHeroModel(body.heroId, 1);
    for (const entry of body.clipOverrides) {
      const clip = canonical.animations.find((item: THREE.AnimationClip) => item.name === entry.base.clip)!;
      const track = clip.tracks.find((item: THREE.KeyframeTrack) => item.name === entry.base.hipsTrack)!;
      expect(trackSha(track)).toBe(entry.base.sourceTrackSha256);
      expect(Array.from(track.times)).toEqual(entry.base.times); expect(Array.from(track.values)).toEqual(entry.base.values);
      createHigherBodyMotionClip(clip, body);
    }
  }
});

// 통합 후 test/higher-body-motion.test.ts에 추가할 실제 R2 회귀검사 초안.
// 실제 후보 full14 PASS 전에는 제품에 설치하거나 실행하지 않는다.
// V02 source-only. 원 draft 보존; 이 파일 단독 실행용이 아니다.
// 통합 전제: 기존 assets import에 loadHeroAsset 추가; R2_MOTION은 실제 설치된
// ../src/data/rogue-t2-body-motion-v2.json registry record(output 포함)로 import.
// 기존 positive registry 검사는 schema v2의 [MOTIONS.bodies에서 old R2 제외, R2_MOTION]
// 조합을 사용한다. 기존 Ranger fixture와 historical R2 row는 변경하지 않는다.
test('실제 R2의 세 저작 동작은 직접 생성·교체에서 같고 다른 외형에서는 STAB 원본을 복원한다', async () => {
  const canonical = await loadHeroModel('rogue', 1);
  const target = manifest.assets.find(item => item.id === 'hero_rogue_t2')!;
  const r3 = manifest.assets.find(item => item.id === 'hero_rogue_t3')!;
  const t1 = manifest.assets.find(item => item.id === 'hero_rogue_t1')!;
  expect(await preloadHeroBody('rogue', 2)).toBe(true);
  expect(await preloadHeroBody('rogue', 3)).toBe(true);
  const loaded = await loadHeroAsset(target);
  expect(loaded.scene.userData.libraryAsset?.id).toBe(target.id);
  expect(loaded.animations).toBe(canonical.animations);
  const direct = spawnCharacter(loaded), swapped = spawnCharacter(canonical), untouched = spawnCharacter(canonical);
  const originalStab: THREE.AnimationClip = canonical.animations.find((clip: THREE.AnimationClip) => clip.name === 'stab')!;
  const aliases = Object.entries(swapped.clips).filter(([, clip]) => clip === originalStab).map(([key]) => key);
  const before = canonical.animations.map((clip: THREE.AnimationClip) => ({
    name: clip.name, duration: clip.duration, tracks: clip.tracks.map(trackSha),
  }));
  const playing = swapped.mixer.clipAction(originalStab).play(); swapped.mixer.update(.125);
  const actionTime = playing.time;
  swapped.clips.PlayerCustomStab = originalStab;
  try {
    expect(applyLibraryHeroBody(swapped.root, target)).toBe(true);
    expect(swapped.root.userData.libraryBodyMotionIdentity.sha256).toBe(R2_MOTION.body.sha256);
    expect(direct.root.userData.libraryBodyMotionIdentity).toEqual(swapped.root.userData.libraryBodyMotionIdentity);
    expect(aliases).toContain('stab');
    const overlay = swapped.clips.stab;
    expect(overlay).not.toBe(originalStab); expect(overlay).toBe(direct.clips.stab);
    for (const key of aliases) expect(swapped.clips[key]).toBe(overlay);
    expect(swapped.clips.PlayerCustomStab).toBe(originalStab);
    expect(untouched.clips.stab).toBe(originalStab);
    for (const entry of R2_MOTION.clipOverrides) {
      const base: THREE.AnimationClip = canonical.animations.find((clip: THREE.AnimationClip) => clip.name === entry.base.clip)!;
      const actual = swapped.clips[entry.base.clip];
      expect(actual).toBe(direct.clips[entry.base.clip]);
      base.tracks.forEach((track, index) => {
        if (track.name === entry.base.hipsTrack) {
          expect(Array.from(actual.tracks[index].times)).toEqual(entry.outputTrack.times.map(Math.fround));
          expect(Array.from(actual.tracks[index].values)).toEqual(entry.outputTrack.values.map(Math.fround));
        } else expect(actual.tracks[index]).toBe(track);
      });
    }
    expect(playing.getClip()).toBe(originalStab); expect(playing.time).toBe(actionTime);
    expect(playing.isRunning()).toBe(true);
    const clipsBefore = { ...swapped.clips };
    const identityBefore = swapped.root.userData.libraryBodyMotionIdentity;
    expect(() => prepareHeroBodyMotion(swapped.root, { ...identityBefore, sha256: 'f'.repeat(64) })).toThrow();
    expect(swapped.clips).toEqual(clipsBefore);
    expect(swapped.root.userData.libraryBodyMotionIdentity).toBe(identityBefore);
    expect(applyLibraryHeroBody(swapped.root, r3)).toBe(true);
    expect(swapped.root.userData.libraryBodyAssetId).toBe(r3.id);
    const r3Motion = MOTIONS.bodies.find(item => item.asset === r3.id)!;
    expect(swapped.root.userData.libraryBodyMotionIdentity.sha256).toBe(r3Motion.body.sha256);
    for (const key of aliases) expect(swapped.clips[key]).toBe(originalStab);
    for (const entry of r3Motion.clipOverrides) {
      const actual = swapped.clips[entry.base.clip];
      const hips = actual.tracks.find(track => track.name === entry.base.hipsTrack)!;
      expect(Array.from(hips.times)).toEqual(entry.outputTrack.times.map(Math.fround));
      expect(Array.from(hips.values)).toEqual(entry.outputTrack.values.map(Math.fround));
    }
    expect(direct.clips.stab).toBe(overlay);
    expect(applyLibraryHeroBody(swapped.root, target)).toBe(true);
    for (const key of aliases) expect(swapped.clips[key]).toBe(overlay);
    expect(swapped.root.userData.libraryBodyMotionIdentity.sha256).toBe(R2_MOTION.body.sha256);
    expect(applyLibraryHeroBody(swapped.root, t1)).toBe(true);
    expect(swapped.root.userData.libraryBodyAssetId).toBe(t1.id);
    for (const key of aliases) expect(swapped.clips[key]).toBe(originalStab);
    for (const name of ['dodge', 'death', 'stab']) expect(swapped.clips[name]).toBe(canonical.animations.find((clip: THREE.AnimationClip) => clip.name === name));
    expect(playing.getClip()).toBe(originalStab); expect(playing.time).toBe(actionTime);
    expect(playing.isRunning()).toBe(true);
    expect(swapped.clips.PlayerCustomStab).toBe(originalStab);
    expect(canonical.animations.map((clip: THREE.AnimationClip) => ({
      name: clip.name, duration: clip.duration, tracks: clip.tracks.map(trackSha),
    }))).toEqual(before);
  } finally {
    for (const inst of [direct, swapped, untouched]) disposeCharacter(inst.root, inst.mixer);
  }
});
