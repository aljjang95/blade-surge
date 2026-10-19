import { Euler, Quaternion, MathUtils } from 'three';
import corrections from '../data/combat-pose-v1.json';
import { isAuthoredCombatClip } from './combat-motion-clips.js';

export const COMBAT_POSE_CORRECTIONS = corrections;
// 60Hz에서 보정 회전은 한 뼈당 프레임당 최대 14.5도(상한 15도에 여유). 원본 클립의 시간과 게임 판정에는 관여하지 않는다.
export const COMBAT_POSE_RATE = MathUtils.degToRad(870);

/** 정규화된 클립 시각의 연속 곡선. 끝점 밖은 끝값을 유지한다. 할당 없음. */
export function combatPoseWeight(curve, time) {
  if (time <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const next = curve[i];
    if (time > next[0]) continue;
    const before = curve[i - 1];
    const u = (time - before[0]) / (next[0] - before[0]);
    return before[1] + (next[1] - before[1]) * u * u * (3 - 2 * u);
  }
  return curve[curve.length - 1][1];
}

/**
 * 인스턴스가 소유하는 가산 회전 층. restore → mixer(재시각화 포함) → apply 순서다.
 * 로비 Idle은 별도 층(lobby-pose)의 소유이므로 이 표에는 없고, 같은 클립의 별칭은 한 번만 적용한다.
 * 외형 단계가 바뀌면 clips 안의 클립 객체가 오버레이로 교체될 수 있어(로그·궁수 회피·찌르기)
 * 클립은 별칭 이름으로 매 프레임 조회한다(조회는 객체를 만들지 않는다).
 * 액션은 existingAction으로 읽기만 한다. 클립·액션·히트 시각은 변경하지 않는다.
 * 기본 보정 차이는 프레임당 14.5도다. 일반 활 당기기의 오른팔은 저작 표의 32도 상한을 쓴다.
 * 클립에 구운 회전은 중복 적용하지 않고 믹서의 원래 교차 페이드로 연결한다.
 */
export function createCombatPose(root, heroId, mixer, clips, data = corrections[heroId]) {
  if (!data) return null;
  const bones = [], entries = [], byName = new Map();
  for (const name of Object.keys(data)) {
    const config = data[name];
    const keys = config.keys || config.curve.map(([t, weight]) => ({ t, bones: Object.fromEntries(
      Object.entries(config.bones).map(([boneName, xyz]) => [boneName, xyz.map(value => value * weight)])
    ) }));
    const aliases = (config.aliases || [name]).filter(alias => alias !== 'Idle' && clips[alias] && !isAuthoredCombatClip(clips[alias]));
    if (!aliases.length) continue;
    const offsets = [];
    for (const boneName of Object.keys(keys[0].bones)) {
      const node = root.getObjectByName(boneName);
      if (!node?.isBone) return null;
      let bone = byName.get(boneName);
      if (!bone) {
        bone = { node, base: new Quaternion(), corrected: new Quaternion(), target: new Quaternion(), current: new Quaternion(), rate: COMBAT_POSE_RATE };
        byName.set(boneName, bone); bones.push(bone);
      }
      const angles = new Float64Array(keys.length * 3);
      for (let k = 0; k < keys.length; k++) for (let axis = 0; axis < 3; axis++) {
        angles[k * 3 + axis] = MathUtils.degToRad(keys[k].bones[boneName][axis]);
      }
      offsets.push({ bone, angles });
    }
    entries.push({ aliases, offsets, times: keys.map(key => key.t), rate: MathUtils.degToRad((config.maxStepDegrees || 14.5) * 60) });
  }
  if (!entries.length) return null;
  const partial = new Quaternion(), rotation = new Quaternion(), euler = new Euler();
  let applied = false, suspended = false, disposed = false;
  return {
    restore() {
      if (!applied) return;
      for (let i = 0; i < bones.length; i++) bones[i].node.quaternion.copy(bones[i].base);
      applied = false; suspended = false;
    },
    /**
     * 판정에 쓰이는 뼈 위치(화살 발사 위치)는 보정 전 클립 자세로 읽어야 하므로 보정을 잠시 벗긴다.
     * 읽은 뒤 반드시 resume()을 부른다. 같은 프레임 안에서만 쓴다(할당 없음).
     */
    suspend() {
      if (!applied || suspended) return;
      for (let i = 0; i < bones.length; i++) bones[i].node.quaternion.copy(bones[i].base);
      suspended = true;
    },
    resume() {
      if (!suspended) return;
      for (let i = 0; i < bones.length; i++) bones[i].node.quaternion.copy(bones[i].corrected);
      suspended = false;
    },
    apply(dt = 1 / 60) {
      if (disposed || applied || suspended) return;
      for (let i = 0; i < bones.length; i++) { bones[i].target.identity(); bones[i].rate = COMBAT_POSE_RATE; }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i], names = entry.aliases, times = entry.times;
        for (let n = 0; n < names.length; n++) {
          const clip = clips[names[n]];
          if (!clip) continue;
          // 같은 클립을 가리키는 앞선 별칭이 있으면 한 번만 적용한다.
          let duplicate = false;
          for (let m = 0; m < n; m++) if (clips[names[m]] === clip) { duplicate = true; break; }
          if (duplicate) continue;
          const action = mixer.existingAction(clip);
          // clampWhenFinished의 일시 정지 액션도 최종 자세를 유지하므로 isRunning으로 버리지 않는다.
          if (!action?.enabled || !action.isScheduled()) continue;
          const weight = Math.min(1, Math.max(0, action.getEffectiveWeight()));
          if (!(weight > 0)) continue;
          const time = Math.max(0, Math.min(1, action.time / clip.duration));
          let key = 1;
          while (key < times.length - 1 && time > times[key]) key++;
          const u = Math.max(0, Math.min(1, (time - times[key - 1]) / (times[key] - times[key - 1])));
          const blend = u * u * (3 - 2 * u), a = (key - 1) * 3, b = key * 3;
          for (let j = 0; j < entry.offsets.length; j++) {
            const offset = entry.offsets[j], angles = offset.angles;
            offset.bone.rate = Math.max(offset.bone.rate, entry.rate);
            euler.set(angles[a] + (angles[b] - angles[a]) * blend,
              angles[a + 1] + (angles[b + 1] - angles[a + 1]) * blend,
              angles[a + 2] + (angles[b + 2] - angles[a + 2]) * blend, 'XYZ');
            rotation.setFromEuler(euler);
            offset.bone.target.multiply(partial.identity().slerp(rotation, weight));
          }
        }
      }
      const frameDt = Math.min(1 / 60, Math.max(0, dt));
      for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        bone.base.copy(bone.node.quaternion);
        bone.current.rotateTowards(bone.target, bone.rate * frameDt);
        bone.node.quaternion.multiply(bone.current);
        bone.corrected.copy(bone.node.quaternion);
      }
      applied = true;
    },
    dispose() {
      this.restore();
      entries.length = 0; bones.length = 0; byName.clear();
      disposed = true;
    },
  };
}
