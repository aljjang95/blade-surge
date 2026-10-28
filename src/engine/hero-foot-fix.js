import * as THREE from 'three';

/**
 * 전사 팔자걸음 보정(2026-10-28 대표님 실기기 피드백 "던전에서 전사 걸음이 팔자걸음").
 * 원인(측정): Tripo 몸체를 Mixamo 오토리그로 묶은 바인드 자세에서 발이 이미 바깥으로 벌어져 있다(검성 t1 약 +15°, 광전사 t1 약 +23°,
 * 마법사 −5°). 같은 Mixamo 달리기 클립이 영웅 모두에 약 +10°를 더하므로 전사만 발끝이 25~35° 벌어져 보였다. 무릎 방향·런타임 코드는 정상.
 * 골격(본 이름·바인드 자세)은 아바타·단계 몸체가 같이 묶여 있어 바꾸지 않는다. 대신 몸체마다 바인드 발각을 재서
 * 그 몸체가 쓰는 클립의 발 회전 트랙에만 '바인드 자세 기준 월드 Y 회전'을 곱한 복제 클립을 쓴다(원본 클립 캐시는 그대로).
 */
export const FOOT_FIX = Object.freeze({
  heroes: Object.freeze(['knight', 'barbarian']),
  // 바인드 자세 발끝 방위 목표(도, 바깥 +). 마법사 바인드(−5°)와 같게 맞추면 달리기 접지 때 약 +5°로 정상 보행 범위다.
  targetYaw: -5,
  // 이보다 작은 차이는 고치지 않는다(도). 너무 큰 값은 측정 이상으로 보고 막는다.
  minFix: 3, maxFix: 40,
});
const SIDES = Object.freeze([['Left', 1], ['Right', -1]]);
const DEG = 180 / Math.PI;

function skinnedBody(scene) {
  let found = null;
  scene?.traverse?.((node) => { if (!found && node.isSkinnedMesh && node.skeleton?.bones.some((b) => b.name === 'mixamorigLeftFoot')) found = node; });
  return found;
}

/** 바인드 자세의 본 월드 행렬(스킨 기준 공간). */
function bindMatrix(skeleton, name) {
  const i = skeleton.bones.findIndex((b) => b.name === name);
  return i < 0 ? null : skeleton.boneInverses[i].clone().invert();
}

/** 바인드 자세 발목→발끝 수평 방위(도, 정면 +Z, 바깥 +). 본이 없으면 null. */
export function bindFootYaw(skeleton, side) {
  const sign = side === 'Left' ? 1 : -1;
  const foot = bindMatrix(skeleton, `mixamorig${side}Foot`), toe = bindMatrix(skeleton, `mixamorig${side}Toe_End`);
  if (!foot || !toe) return null;
  const v = new THREE.Vector3().setFromMatrixPosition(toe).sub(new THREE.Vector3().setFromMatrixPosition(foot));
  if (Math.hypot(v.x, v.z) < 1e-4) return null;
  return Math.atan2(v.x * sign, v.z) * DEG;
}

/** 발 본 로컬 회전 뒤에 곱할 보정 쿼터니언. 바인드 자세에서 발을 월드 Y 축으로 안쪽으로 돌린 것과 같다. 보정이 필요 없으면 null. */
export function footToeCorrections(scene, heroId, cfg = FOOT_FIX) {
  if (!cfg.heroes.includes(heroId)) return null;
  const body = skinnedBody(scene); if (!body) return null;
  const out = {};
  let any = false;
  for (const [side, sign] of SIDES) {
    const yaw = bindFootYaw(body.skeleton, side);
    const fix = yaw === null ? 0 : yaw - cfg.targetYaw;
    if (!(Math.abs(fix) >= cfg.minFix && Math.abs(fix) <= cfg.maxFix)) continue;
    const rw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(bindMatrix(body.skeleton, `mixamorig${side}Foot`)));
    const ry = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sign * fix / DEG);
    out[side] = { yaw, fix, q: rw.clone().invert().multiply(ry).multiply(rw) };
    any = true;
  }
  return any ? out : null;
}

/** 발 회전 트랙만 보정한 복제 클립. 나머지 트랙 객체는 원본과 공유한다(메모리 증가 = 발 트랙 2개). */
export function correctFootClips(clips, corrections) {
  if (!corrections) return clips;
  const scratch = new THREE.Quaternion();
  return clips.map((clip) => {
    let changed = false;
    const tracks = clip.tracks.map((track) => {
      const side = SIDES.find(([s]) => track.name === `mixamorig${s}Foot.quaternion`)?.[0];
      const fix = side && corrections[side];
      if (!fix) return track;
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        scratch.fromArray(values, i).multiply(fix.q).normalize().toArray(values, i);
      }
      changed = true;
      return new THREE.QuaternionKeyframeTrack(track.name, track.times, values, track.getInterpolation?.());
    });
    if (!changed) return clip;
    const next = new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
    next.userData = { ...(clip.userData || {}), footToeFix: true };
    return next;
  });
}
