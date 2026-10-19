import { describe, expect, test } from 'bun:test';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, Quaternion, Euler } from 'three';
import { createCombatMotionClip, installCombatMotionClips, isAuthoredCombatClip } from '../src/engine/combat-motion-clips.js';

const config = { keys: [
  { t: 0, bones: { mixamorigRightArm: [0, 0, 0] } },
  { t: .5, bones: { mixamorigRightArm: [0, 0, 30] } },
  { t: 1, bones: { mixamorigRightArm: [0, 0, 0] } },
] };
function fixture() {
  const rotation = new QuaternionKeyframeTrack('mixamorigRightArm.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
  const hips = new VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 1, 0, 0, 1, 0]);
  return new AnimationClip('interact', 1, [rotation, hips]);
}
describe('저작 전투 클립의 분리와 시간 보존', () => {
  test('원본·위치 트랙·길이는 보존하고 저장 회전은 연속 곡선과 일치한다', () => {
    const base = fixture(), original = Array.from(base.tracks[0].values), clip = createCombatMotionClip(base, config);
    expect(clip.duration).toBe(base.duration); expect(clip.name).toBe(base.name); expect(clip.blendMode).toBe(base.blendMode);
    expect(clip.tracks[1]).toBe(base.tracks[1]); expect(Array.from(base.tracks[0].values)).toEqual(original);
    const interpolant = clip.tracks[0].createInterpolant(), current = new Quaternion(), expected = new Quaternion(), euler = new Euler();
    for (let i = 0; i <= 240; i++) {
      const t = i / 240, u = t <= .5 ? t * 2 : (1 - t) * 2, angle = 30 * u * u * (3 - 2 * u);
      expected.setFromEuler(euler.set(0, 0, angle * Math.PI / 180)); current.fromArray(interpolant.evaluate(t)).normalize();
      expect(current.angleTo(expected)).toBeLessThan(.0004);
    }
    expect(isAuthoredCombatClip(base)).toBe(false); expect(isAuthoredCombatClip(clip)).toBe(true);
  });
  test('동일 인스턴스의 별칭과 반복 설치는 한 복제 클립을 공유한다', () => {
    const base = fixture(), clips = { interact: base, Interact: base, custom: base };
    installCombatMotionClips(clips, 'knight');
    expect(clips.interact).not.toBe(base); expect(clips.Interact).toBe(clips.interact); expect(clips.custom).toBe(clips.interact);
    const installed = clips.interact; installCombatMotionClips(clips, 'knight'); expect(clips.interact).toBe(installed);
    const other = { interact: base }; installCombatMotionClips(other, 'ranger'); expect(other.interact).not.toBe(installed);
  });
  test('Euler 경계를 가로지르는 손목 키는 최단 회전으로 이어지고 길이를 보존한다', () => {
    const base = fixture(), clip = createCombatMotionClip(base, { interpolation: 'quaternion', sampleHz: 240, keys: [
      { t: 0, bones: { mixamorigRightArm: [0, 179, 0] } },
      { t: 1, bones: { mixamorigRightArm: [0, -179, 0] } },
    ] });
    const sample = clip.tracks[0].createInterpolant(), current = new Quaternion(), previous = new Quaternion();
    const middle = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0));
    current.fromArray(sample.evaluate(.5)).normalize(); expect(current.angleTo(middle)).toBeLessThan(.0001);
    for (let i = 0; i <= 240; i++) {
      current.fromArray(sample.evaluate(i / 240)).normalize();
      if (i) expect(previous.angleTo(current)).toBeLessThan(.001);
      previous.copy(current);
    }
    expect(clip.duration).toBe(base.duration); expect(clip.tracks[1]).toBe(base.tracks[1]);
  });
});
