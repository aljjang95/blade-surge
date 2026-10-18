import { Euler, Quaternion, MathUtils } from 'three';

// 로비 Idle 한 주기의 12·120시점 실측값. 로컬 XYZ 추가 회전(도)이며 전투 리그·클립은 수정하지 않는다.
export const LOBBY_POSE_CORRECTIONS = {
  mage: {
    mixamorigSpine1: [14.7, -1.2, 4.95],
    mixamorigSpine2: [-15.55, 21.65, 10.7],
    mixamorigLeftShoulder: [32.3, -52.2, -7.75],
    mixamorigRightShoulder: [1.5, -22.95, -40.55],
    mixamorigRightArm: [-74.55, 23.75, -21.2],
    mixamorigRightForeArm: [-35.4, 18.1, 29.15],
    mixamorigRightHand: [0.4, 12.8, 19.2],
  },
  barbarian: {
    mixamorigRightArm: [-20, -25, 30],
    mixamorigRightForeArm: [-3, 5, -2],
    mixamorigRightHand: [6, 0, 0],
  },
  ranger: {
    mixamorigLeftArm: [18, -2, 1],
    mixamorigLeftForeArm: [-13, -3, 24],
    mixamorigLeftHand: [5, 5, 41],
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
