import * as THREE from 'three';
import corrections from '../data/combat-pose-v1.json';

// 빠른 근접 동작은 원본 회전 트랙의 복제본에 연속 저작 곡선을 120~240Hz로 굽는다.
// 공유 원본·골반·판정 시각은 보존하고 믹서가 교차 페이드를 소유한다.
// 현재 미사용 Interact도 즉시 전환 감사에서 안전하도록 같은 경로를 쓴다.
const AUTHORED = Object.freeze({ knight: ['interact', 'slash_h', 'spin'], barbarian: ['spin'], ranger: ['interact'] });
const authored = new WeakSet();
const cache = new WeakMap();
export const isAuthoredCombatClip = clip => authored.has(clip);

export function createCombatMotionClip(base, config) {
  const euler = new THREE.Euler(), delta = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const keys = config.keys, sampleHz = config.sampleHz || 120;
  const tracks = base.tracks.map(track => {
    const bone = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
    if (track.ValueTypeName !== 'quaternion' || !keys[0].bones[bone]) return track;
    const sampleTimes = new Set(Array.from(track.times));
    for (let i = 0; i <= Math.ceil(base.duration * sampleHz); i++) sampleTimes.add(Math.fround(Math.min(base.duration, i / sampleHz)));
    for (const key of keys) sampleTimes.add(Math.fround(key.t * base.duration));
    const times = [...sampleTimes].sort((a, b) => a - b), values = [], interpolant = track.createInterpolant();
    let previous = null;
    for (const time of times) {
      const t = Math.min(1, time / base.duration);
      let k = 1; while (k < keys.length - 1 && t > keys[k].t) k++;
      const a = keys[k - 1], b = keys[k], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))), w = u * u * (3 - 2 * u);
      const av = a.bones[bone], bv = b.bones[bone];
      if (config.interpolation === 'quaternion') {
        // 동등한 Euler 표현 사이를 축별로 돌면 손목이 뒤집히므로 회전의 최단 경로를 쓴다.
        qa.setFromEuler(euler.set(...av.map(THREE.MathUtils.degToRad), 'XYZ'));
        qb.setFromEuler(euler.set(...bv.map(THREE.MathUtils.degToRad), 'XYZ'));
        delta.copy(qa).slerp(qb, w);
      } else {
        delta.setFromEuler(euler.set(...av.map((x, axis) => THREE.MathUtils.degToRad(x + (bv[axis] - x) * w)), 'XYZ'));
      }
      rotation.fromArray(interpolant.evaluate(time)).multiply(delta).normalize();
      if (previous && rotation.dot(previous) < 0) rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
      values.push(...rotation.toArray()); previous = rotation.clone();
    }
    return new THREE.QuaternionKeyframeTrack(track.name, times, values, THREE.InterpolateLinear);
  });
  if (tracks.every((track, index) => track === base.tracks[index])) return base;
  const clip = new THREE.AnimationClip(base.name, base.duration, tracks, base.blendMode);
  authored.add(clip);
  return clip;
}

/** 공유 GLB·트랙을 바꾸지 않고 인스턴스 별칭만 같은 복제 클립으로 연결한다. */
export function installCombatMotionClips(clips, heroId) {
  for (const name of AUTHORED[heroId] || []) {
    const config = corrections[heroId][name], base = clips[name];
    if (!base || authored.has(base)) continue;
    let variants = cache.get(base);
    if (!variants) { variants = new Map(); cache.set(base, variants); }
    let clip = variants.get(config);
    if (!clip) { clip = createCombatMotionClip(base, config); variants.set(config, clip); }
    for (const alias of Object.keys(clips)) if (clips[alias] === base) clips[alias] = clip;
  }
}
