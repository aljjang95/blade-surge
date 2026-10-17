import * as THREE from 'three';
import FOX_BODY_MOTION from '../data/fox-body-motion-v1.json';
import RANGER_REVISION from '../data/ranger-library-revision-v4.json';

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

/** spawnCharacter의 논리 별칭 생성 직후 한 번 등록한다. 이후 플레이어가 더한 전용 키는 건드리지 않는다. */
export function registerHeroBodyMotion(root, clips) {
  if (root.userData.authoredContract?.heroId !== 'ranger' || states.has(root)) return;
  const entries = [];
  for (const name of Object.keys(DURATIONS)) {
    const base = clips[name]; if (!base) continue;
    const aliases = Object.entries(clips).filter(([, clip]) => clip === base).map(([key]) => key);
    entries.push({ base, aliases });
  }
  states.set(root, { clips, entries });
  refreshHeroBodyMotion(root);
}

/** 몸체 교체 성공 뒤 미래의 클립 조회만 바꾼다. 재생 중 액션은 재시작·초기화하지 않는다. */
export function refreshHeroBodyMotion(root) {
  const state = states.get(root); if (!state) return;
  const fox = root.userData.libraryBodyAssetId === FOX;
  // 두 저작 클립 모두 유효한 것을 먼저 확인한 뒤 별칭을 한 번에 갱신한다.
  const changes = state.entries.map(entry => {
    let overlay = bodyClips.get(entry.base);
    if (fox && !overlay) {
      overlay = createBodyMotionClip(entry.base); bodyClips.set(entry.base, overlay);
    }
    return { ...entry, overlay, next: fox ? overlay : entry.base };
  });
  for (const { base, aliases, overlay, next } of changes) for (const key of aliases) {
    // 등록 뒤 명시적으로 덮어쓴 사용자 전용 별칭도 보존한다.
    if (state.clips[key] === base || state.clips[key] === overlay) state.clips[key] = next;
  }
}

export function disposeHeroBodyMotion(root) {
  states.delete(root);
}
