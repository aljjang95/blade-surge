import { Euler, Quaternion, MathUtils } from 'three';

// 로비 Idle 한 주기의 12·120시점 실측값. 로컬 XYZ 추가 회전(도)이며 전투 리그·클립은 수정하지 않는다.
// 2026-10-19: 몸통 축 기준 좌우 팔꿈치 거리·높이 차 5cm 이하가 되도록 마법사 빈 왼팔과 야만전사 왼팔을 다시 맞췄다.
export const LOBBY_POSE_CORRECTIONS = {
  mage: {
    mixamorigSpine1: [12.7, -12.2, -3.05],
    mixamorigSpine2: [-15.55, 24.65, 10.7],
    mixamorigLeftShoulder: [9.3, -86.2, -7.75],
    mixamorigRightShoulder: [5.5, -22.95, -36.05],
    mixamorigRightArm: [-66.05, 23.75, -19.2],
    mixamorigRightForeArm: [-34.9, 9.6, 29.15],
    mixamorigRightHand: [0.9, 16.8, 19.2],
    mixamorigLeftArm: [3, -33.5, 8],
    mixamorigLeftForeArm: [-38, -1.5, 3.5],
  },
  barbarian: {
    mixamorigRightArm: [-19.5, -25.5, 30],
    mixamorigRightForeArm: [-3, 5, -2],
    mixamorigRightHand: [6, 0, 0],
    mixamorigLeftArm: [-16, 30.5, -17.5],
    mixamorigLeftForeArm: [33.5, 13.5, 33],
  },
  ranger: {
    mixamorigLeftArm: [21, -1.5, -3],
    mixamorigLeftForeArm: [-13, -4, 24.5],
    mixamorigLeftHand: [5, 5, 41],
    mixamorigRightArm: [-0.5, 0, -10],
    // 로비 카메라(고도 약 30°)에서 오른쪽 눈이 앞머리·윗눈꺼풀에 가려 애꾸처럼 보이던 문제: 턱을 12° 들어 두 눈을 드러낸다(2026-10-19 S26 실기기 확인).
    mixamorigHead: [12, 0, 0],
  },
  knight: {
    mixamorigRightHand: [0, -7, 6],
    mixamorigLeftHand: [20, 0, 0],
    mixamorigRightArm: [-30, -17, 6],
    mixamorigLeftArm: [-23, -3, -3],
  },
  rogue: {
    mixamorigRightHand: [-2, -3, 7],
  },
};
for (const data of Object.values(LOBBY_POSE_CORRECTIONS)) {
  for (const angles of Object.values(data)) Object.freeze(angles);
  Object.freeze(data);
}
Object.freeze(LOBBY_POSE_CORRECTIONS);

/**
 * 교정은 Idle 한 주기에서 잰 값이므로 Idle 자세에만 맞는다. Running_A 같은 다른 클립 위에 그대로 얹으면 팔이 몸을 뚫는다
 * (2026-10-19 전투 자세 감사: 마을 걷기에서 기사 무기가 몸통 16cm, 궁수 팔 5cm 관통). 그래서 Idle 액션의 실효 가중치만큼만 적용한다.
 * Idle→달리기 전환(0.16초 교차 페이드)에서는 교정이 같은 속도로 사라졌다가 돌아온다. 할당 없음.
 * @param {{ isRunning: () => boolean, getEffectiveWeight: () => number } | null | undefined} idleAction
 */
export function lobbyPoseWeight(idleAction) {
  if (!idleAction) return 1;
  if (!idleAction.isRunning()) return 0;
  const w = idleAction.getEffectiveWeight();
  return w > 1 ? 1 : w > 0 ? w : 0;
}

/** 쇼케이스만 명시적으로 소유한다. 교정 없는 직업·호환되지 않는 골격은 그대로 둔다. */
export function createLobbyPose(root, heroId) {
  const data = LOBBY_POSE_CORRECTIONS[heroId];
  if (!data) return null;
  const entries = [];
  for (const [name, degrees] of Object.entries(data)) {
    const bone = root.getObjectByName(name);
    if (!bone?.isBone) return null;
    entries.push({ bone, base: new Quaternion(), correction: new Quaternion().setFromEuler(new Euler(
      MathUtils.degToRad(degrees[0]), MathUtils.degToRad(degrees[1]), MathUtils.degToRad(degrees[2]), 'XYZ'
    )) });
  }
  let applied = false, disposed = false;
  const partial = new Quaternion();
  return {
    // mixer가 덮어쓰지 않는 트랙과 reducedMotion에서도 추가 회전이 누적되지 않게 원본을 복원한다.
    restore() {
      if (!applied) return;
      for (let i = 0; i < entries.length; i++) entries[i].bone.quaternion.copy(entries[i].base);
      applied = false;
    },
    /** @param {number} [weight] 0~1. 1이면 교정 전체, 0이면 원본 그대로(복원할 것이 없다). */
    apply(weight = 1) {
      if (disposed || applied || !(weight > 0)) return;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        entry.base.copy(entry.bone.quaternion);
        if (weight >= 1) entry.bone.quaternion.multiply(entry.correction);
        else entry.bone.quaternion.multiply(partial.identity().slerp(entry.correction, weight));
      }
      applied = true;
    },
    dispose() {
      this.restore();
      entries.length = 0;
      disposed = true;
    },
  };
}

