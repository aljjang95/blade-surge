import * as THREE from 'three';
import FOX_BODY_MOTION from '../data/fox-body-motion-v1.json';
import RANGER_REVISION from '../data/ranger-library-revision-v4.json';
import ROGUE_REVISION from '../data/rogue-library-revision-v2.json';
import HIGHER_BODY_REVISIONS from '../data/higher-body-revisions-v1.json';
import HIGHER_BODY_MOTION from '../data/higher-body-motion-v1.json';
import { revisedLibraryFile, validateHigherBodyRevisions } from './library-assets.js';

const FOX = 'avatar_ranger_fox';
const DURATIONS = { dodge: .5, death: 1.25 };
const states = new WeakMap();
const bodyClips = new WeakMap();
const requireMotion = (condition, message) => { if (!condition) throw new Error('여우 저작 동작: ' + message); };

/** 번들에 저장된 저작 트랙만 읽는다. 캐릭터 위치·접지·현재 액션을 프레임마다 보정하지 않는다. */
export function createBodyMotionClip(baseClip, motion = FOX_BODY_MOTION) {
  requireMotion(motion?.schema === 'blade-surge.hero-body-motion.v1' && motion.asset === FOX, '잘못된 자산 계약');
  requireMotion(motion.base?.path === RANGER_REVISION.output.path && motion.base?.sha256 === RANGER_REVISION.output.sha256, '공유 궁수 v4 원본 불일치');
  requireMotion(Array.isArray(motion.clipOverrides) && motion.clipOverrides.length === 2
    && new Set(motion.clipOverrides.map(entry => entry.base?.clip)).size === 2
    && motion.clipOverrides.every(entry => Object.hasOwn(DURATIONS, entry.base?.clip)), '회피·사망 저작 목록 불일치');
  const entry = motion.clipOverrides.find(item => item.base.clip === baseClip?.name);
  requireMotion(entry && entry.base.duration === DURATIONS[baseClip.name] && entry.base.hipsTrack === 'mixamorigHips.position'
    && /^[a-f0-9]{64}$/.test(entry.base.sourceTrackSha256), '원본 트랙 메타데이터 불일치');
  requireMotion(Math.abs(baseClip.duration - entry.base.duration) < 1e-7, '클립 길이 불일치');
  const initialOffsetMeters = baseClip.name === 'dodge' ? .006 : 0;
  requireMotion(entry.authoring?.initialOffsetMeters === initialOffsetMeters, '시작 저작 높이 메타데이터 불일치');
  const matching = baseClip.tracks.filter(track => track.name === entry.base.hipsTrack);
  requireMotion(matching.length === 1, '원본 골반 위치 트랙 개수 불일치');
  const original = matching[0], output = entry.outputTrack;
  requireMotion(original.ValueTypeName === 'vector' && original.getValueSize() === 3 && original.getInterpolation() === THREE.InterpolateLinear, '원본 골반 트랙 형식 불일치');
  requireMotion(output?.name === original.name && output.type === 'vector' && (!output.interpolation || output.interpolation === 'LINEAR'), '저작 트랙 형식 불일치');
  const times = output.times, values = output.values;
  requireMotion(Array.isArray(times) && Array.isArray(values) && times.length >= Math.ceil(baseClip.duration * 120) + 1
    && times.length <= 1000 && values.length === times.length * 3, '저작 표본 배열 크기 불일치');
  requireMotion(times.every((time, index) => Number.isFinite(time) && time >= 0 && time <= baseClip.duration && (!index || time > times[index - 1]))
    && values.every(Number.isFinite) && times[0] === 0 && times[times.length - 1] === baseClip.duration, '저작 표본의 시간·값 불일치');
  requireMotion(Array.from(original.times).every(time => times.some(sample => Math.abs(sample - time) < 1e-7)), '원본 키 시간 누락');
  const interpolant = original.createInterpolant();
  for (let index = 0; index < times.length; index++) {
    const reference = interpolant.evaluate(times[index]), offset = index * 3;
    requireMotion(Math.abs(values[offset] - reference[0]) <= 1e-4 && Math.abs(values[offset + 2] - reference[2]) <= 1e-4, '골반 수평 이동은 변경할 수 없습니다.');
    const deltaY = values[offset + 1] - reference[1];
    requireMotion(deltaY >= -1e-4 && deltaY <= 6.2, '저작 골반 높이 범위 초과');
    // 고정 v4 본 단위에서 회피 시작 +6mm는 약 .3333334167이다. 새 저작 시작 자세만 검사한다.
    if (!index) requireMotion(Math.abs(deltaY - (baseClip.name === 'dodge' ? .3333334167 : 0)) <= 1e-4, '시작 저작 자세 불일치');
    if (baseClip.name === 'dodge' && index === times.length - 1) requireMotion(Math.abs(deltaY) <= 1e-4, '회피 끝 자세 불일치');
    // v4 본의 native 단위에서 사망 끝의 저작 +5cm는 약2.777778이다. 보정값을 계산·적용하지 않는 계약 검사다.
    if (baseClip.name === 'death' && index === times.length - 1) requireMotion(deltaY >= 2.77 && deltaY <= 2.79, '사망 끝 저작 접촉 높이 불일치');
  }
  const replacement = new THREE.VectorKeyframeTrack(original.name, times, values, THREE.InterpolateLinear);
  // 나머지 트랙은 원본 객체를 공유한다. 공유 GLB·클립 캐시·기존 트랙 배열은 수정하지 않는다.
  return new THREE.AnimationClip(baseClip.name, baseClip.duration,
    baseClip.tracks.map(track => track === original ? replacement : track), baseClip.blendMode);
}

const HIGHER_TARGETS = Object.freeze({
  hero_ranger_t2: ['ranger', 'ranger-t2'], hero_ranger_t3: ['ranger', 'ranger-t3'],
  hero_rogue_t2: ['rogue', 'rogue-t2'], hero_rogue_t3: ['rogue', 'rogue-t3'], avatar_rogue_crow: ['rogue', 'rogue-crow'],
});
const SHA = /^[a-f0-9]{64}$/;
const closeMeters = (a, b) => Math.abs(a - b) <= 2e-6;
const finiteArray = (value) => Array.isArray(value) && value.every(Number.isFinite);
const freezeTree = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeTree); Object.freeze(value); }
  return value;
};

/** 저작이 끝난 실제 패킷만 등록한다. 빈 bodies는 신규 모션 비활성 상태다. */
export function createHigherBodyMotionRegistry(bundle, revisions = HIGHER_BODY_REVISIONS) {
  requireMotion(bundle?.schema === 'blade-surge.higher-body-motion.v1' && Array.isArray(bundle.bodies), '상위 몸체 번들 형식 불일치');
  validateHigherBodyRevisions(revisions);
  const records = structuredClone(bundle.bodies), assets = new Set(), paths = new Set();
  for (const body of records) {
    const target = HIGHER_TARGETS[body.asset], revision = revisions.revisions.find(item => item.asset === body.asset);
    requireMotion(target && !assets.has(body.asset), '알 수 없거나 중복된 몸체'); assets.add(body.asset);
    const [heroId, prefix] = target, canonical = heroId === 'ranger' ? RANGER_REVISION : ROGUE_REVISION;
    requireMotion(body.heroId === heroId && body.revisionId === prefix + '-body-fit-v1'
      && revision?.id === body.revisionId && revision.status === 'GENERATED' && revision.useInGame === true
      && body.body?.path === revision.output.path && body.body.sha256 === revision.output.sha256 && SHA.test(body.body.sha256), '활성 몸체 revision·출력 SHA 불일치');
    requireMotion(body.base?.path === canonical.output.path && body.base.sha256 === canonical.output.sha256, '공유 클립 GLB 출처 불일치');
    requireMotion(body.motionRevisionId === prefix + '-body-motion-v1'
      && body.output?.path === '/models/heroes-next/' + body.motionRevisionId + '.json'
      && SHA.test(body.output.sha256) && !paths.has(body.output.path), '저작 패킷 출력 출처 불일치'); paths.add(body.output.path);
    requireMotion(Array.isArray(body.clipOverrides) && body.clipOverrides.length >= 1 && body.clipOverrides.length <= 2
      && new Set(body.clipOverrides.map(entry => entry.base?.clip)).size === body.clipOverrides.length, '저작 클립 중복·개수 불일치');
    for (const entry of body.clipOverrides) {
      const source = entry.base, profile = entry.authoring, validation = entry.validation;
      requireMotion(source && Object.hasOwn(DURATIONS, source.clip) && source.duration === DURATIONS[source.clip]
        && source.hipsTrack === 'mixamorigHips.position' && source.interpolation === 'LINEAR'
        && SHA.test(source.sourceTrackSha256) && finiteArray(source.times) && finiteArray(source.values)
        && source.times.length >= 2 && source.values.length === source.times.length * 3, '원본 트랙 snapshot 계약 불일치');
      requireMotion(typeof profile?.profileId === 'string' && profile.profileId.length > 0
        && Number.isFinite(profile.parentWorldYGain) && profile.parentWorldYGain > 0
        && Number.isFinite(profile.maxOffsetMeters) && profile.maxOffsetMeters > 0 && profile.maxOffsetMeters <= .35
        && [profile.initialOffsetMeters, profile.finalOffsetMeters].every(value => Number.isFinite(value) && value >= 0 && value <= profile.maxOffsetMeters), '자산별 고정 저작 프로필 불일치');
      requireMotion(validation && [validation.supportStartMeters, validation.supportEndMeters].every(value => Number.isFinite(value) && Math.abs(value) <= .02)
        && (source.clip !== 'death' || (Number.isFinite(validation.deathEndMeters) && Math.abs(validation.deathEndMeters) <= .02)), '저작 지지점·사망 끝 검증 기록 불일치');
    }
  }
  // 객체 identity는 전체 불변 패킷에 묶인다. 같은 자산의 다른 revision이 캐시를 공유하지 않는다.
  return freezeTree(records);
}

const higherMotionRegistry = createHigherBodyMotionRegistry(HIGHER_BODY_MOTION);

/** 로더 호출 시 선택한 몸체 revision을 캡처한다. 원본 fallback을 교정본으로 오인하지 않는다. */
export function selectedBodyMotionIdentity(asset) {
  const revision = HIGHER_BODY_REVISIONS.revisions.find(item => item.asset === asset.id);
  const revised = revisedLibraryFile(asset);
  return Object.freeze({ asset: asset.id, heroId: asset.heroId, revisionId: revised && revision ? revision.id : null,
    path: revised || asset.file, sha256: revised && revision ? revision.output.sha256 : asset.sha256 });
}

/** canonical decoded Float32 snapshot과 일치하는 저작 Hips 위치만 교체한다. */
export function createHigherBodyMotionClip(baseClip, body) {
  const entry = body.clipOverrides.find(item => item.base.clip === baseClip?.name);
  requireMotion(entry && baseClip.duration === entry.base.duration, '저작 클립 이름·길이 불일치');
  const matches = baseClip.tracks.filter(track => track.name === entry.base.hipsTrack), source = entry.base, output = entry.outputTrack;
  requireMotion(matches.length === 1, '골반 위치 트랙 개수 불일치');
  const original = matches[0];
  requireMotion(original.ValueTypeName === 'vector' && original.getValueSize() === 3 && original.getInterpolation() === THREE.InterpolateLinear
    && original.times.length === source.times.length && original.values.length === source.values.length
    && source.times.every((value, index) => Object.is(value, original.times[index]))
    && source.values.every((value, index) => Object.is(value, original.values[index])), '실제 decoded 원본 트랙 snapshot 불일치');
  requireMotion(output?.name === original.name && output.type === 'vector' && output.interpolation === 'LINEAR', '저작 위치 트랙 형식 불일치');
  const times = output.times, values = output.values, profile = entry.authoring;
  requireMotion(finiteArray(times) && finiteArray(values) && times.length >= Math.ceil(baseClip.duration * 120) + 1
    && times.length <= 1000 && values.length === times.length * 3 && times[0] === 0 && times.at(-1) === baseClip.duration
    && times.every((time, index) => time >= 0 && time <= baseClip.duration && (!index || time > times[index - 1]))
    && source.times.every(time => times.some(sample => Math.abs(sample - time) < 1e-7)), '저작 시간·값 배열 불일치');
  const interpolant = original.createInterpolant();
  let minOffset = Infinity, maxOffset = -Infinity;
  for (let index = 0; index < times.length; index++) {
    const reference = interpolant.evaluate(times[index]), offset = index * 3;
    // 실제 VectorKeyframeTrack의 Float32 저장값 기준으로 X/Z 불변을 검사한다.
    requireMotion(Object.is(Math.fround(values[offset]), reference[0]) && Object.is(Math.fround(values[offset + 2]), reference[2]), '골반 수평 이동 변경');
    const deltaMeters = (Math.fround(values[offset + 1]) - reference[1]) * profile.parentWorldYGain;
    minOffset = Math.min(minOffset, deltaMeters); maxOffset = Math.max(maxOffset, deltaMeters);
    requireMotion(deltaMeters >= -2e-6 && deltaMeters <= profile.maxOffsetMeters + 2e-6 && deltaMeters <= .35 + 2e-6, '고정 저작 높이 범위 초과');
    if (!index) requireMotion(closeMeters(deltaMeters, profile.initialOffsetMeters), '저작 시작 자세 불일치');
    if (index === times.length - 1) requireMotion(closeMeters(deltaMeters, profile.finalOffsetMeters), '저작 끝 자세 불일치');
  }
  requireMotion(maxOffset - minOffset > 2e-6, '전 동작 상수 높이 변경은 허용하지 않습니다.');
  const replacement = new THREE.VectorKeyframeTrack(original.name, times, values, THREE.InterpolateLinear);
  return new THREE.AnimationClip(baseClip.name, baseClip.duration, baseClip.tracks.map(track => track === original ? replacement : track), baseClip.blendMode);
}

/** spawn에서 canonical reference와 당시 별칭만 캡처한다. 사용자 추가 key는 소유하지 않는다. */
export function registerHeroBodyMotion(root, clips, registry = higherMotionRegistry) {
  const heroId = root.userData.authoredContract?.heroId;
  if (!['ranger', 'rogue'].includes(heroId) || states.has(root)) return;
  const entries = [];
  for (const name of Object.keys(DURATIONS)) {
    const base = clips[name]; if (!base) continue;
    const aliases = Object.entries(clips).filter(([, clip]) => clip === base).map(([key]) => ({ key, installed: base, owned: true }));
    entries.push({ base, aliases });
  }
  states.set(root, { clips, entries, registry, heroId, version: 0 });
  try { refreshHeroBodyMotion(root); } catch (error) { states.delete(root); throw error; }
}

/** 몸체 제거 전에 모든 대상 트랙을 검사한다. 이 함수는 root·별칭·현재 액션을 변경하지 않는다. */
export function prepareHeroBodyMotion(root, identity = root.userData.libraryBodyMotionIdentity || { asset: root.userData.libraryBodyAssetId }) {
  const state = states.get(root); if (!state) return null;
  const body = state.registry.find(item => item.asset === identity.asset);
  const fox = state.heroId === 'ranger' && identity.asset === FOX;
  if (body) requireMotion(body.heroId === state.heroId && identity.heroId === state.heroId && identity.revisionId === body.revisionId
    && identity.path === body.body.path && identity.sha256 === body.body.sha256, '실제 선택 몸체와 모션 불일치');
  if (body) requireMotion(body.clipOverrides.every(entry => state.entries.some(item => item.base.name === entry.base.clip)), '공유 원본 클립 누락');
  if (body) {
    const parent = root.getObjectByName('mixamorigHips')?.parent;
    requireMotion(parent, '실제 골반 부모 없음'); parent.updateWorldMatrix(true, false);
    const matrix = parent.matrixWorld.elements;
    requireMotion(Math.abs(matrix[1]) < 1e-7 && Math.abs(matrix[9]) < 1e-7 && matrix[5] > 0
      && body.clipOverrides.every(entry => Math.abs(entry.authoring.parentWorldYGain - matrix[5]) <= 1e-7), '골반 부모 world/native 축·배율 불일치');
  }
  const changes = state.entries.map(entry => {
    const active = fox || body?.clipOverrides.some(item => item.base.clip === entry.base.name);
    let next = entry.base;
    if (active) {
      let cache = bodyClips.get(entry.base);
      if (!cache) { cache = new Map(); bodyClips.set(entry.base, cache); }
      const key = fox ? FOX_BODY_MOTION : body;
      next = cache.get(key);
      if (!next) { next = fox ? createBodyMotionClip(entry.base) : createHigherBodyMotionClip(entry.base, body); cache.set(key, next); }
    }
    return { entry, next };
  });
  return { state, version: state.version, changes };
}

/** 검증이 끝난 계획만 설치한다. 재생 중 action을 재시작하거나 시간을 바꾸지 않는다. */
export function commitHeroBodyMotion(root, plan) {
  if (!plan) return true;
  if (states.get(root) !== plan.state || plan.state.version !== plan.version) return false;
  for (const { entry, next } of plan.changes) for (const alias of entry.aliases) {
    if (!alias.owned) continue;
    if (plan.state.clips[alias.key] !== alias.installed) { alias.owned = false; continue; }
    plan.state.clips[alias.key] = next; alias.installed = next;
  }
  plan.state.version++;
  return true;
}

/** 직접 spawn 및 기존 공개 호출용. swap은 prepare/commit을 별도로 사용한다. */
export function refreshHeroBodyMotion(root) {
  commitHeroBodyMotion(root, prepareHeroBodyMotion(root));
}

export function disposeHeroBodyMotion(root) {
  states.delete(root);
}
