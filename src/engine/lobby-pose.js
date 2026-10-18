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
  return {
    // mixer가 덮어쓰지 않는 트랙과 reducedMotion에서도 추가 회전이 누적되지 않게 원본을 복원한다.
    restore() {
      if (!applied) return;
      for (let i = 0; i < entries.length; i++) entries[i].bone.quaternion.copy(entries[i].base);
      applied = false;
    },
    apply() {
      if (disposed || applied) return;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        entry.base.copy(entry.bone.quaternion);
        entry.bone.quaternion.multiply(entry.correction);
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
