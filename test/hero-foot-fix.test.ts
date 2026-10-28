import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FOOT_FIX, bindFootYaw, footToeCorrections, installFootToeFix } from '../src/engine/hero-foot-fix.js';

const RAD = Math.PI / 180;
// 발목→발끝을 바깥으로 outward 도 벌린 바인드 자세의 최소 골격. 발 본에는 임의의 로컬 회전을 넣어 축이 월드와 다른 리그를 흉내 낸다.
function rig(outward: number) {
  const root = new THREE.Group(), hips = new THREE.Bone(); hips.name = 'mixamorigHips'; root.add(hips);
  const bones = [hips];
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const foot = new THREE.Bone(); foot.name = `mixamorig${side}Foot`; foot.position.set(.1 * sign, .1, 0);
    foot.quaternion.setFromEuler(new THREE.Euler(.7, .3 * sign, -.4));
    const toe = new THREE.Bone(); toe.name = `mixamorig${side}Toe_End`;
    const dir = new THREE.Vector3(Math.sin(outward * RAD) * sign, 0, Math.cos(outward * RAD)).multiplyScalar(.2);
    toe.position.copy(dir.applyQuaternion(foot.quaternion.clone().invert()));
    hips.add(foot); foot.add(toe); bones.push(foot, toe);
  }
  root.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  root.add(mesh); mesh.bind(new THREE.Skeleton(bones));
  return { root, mesh, foot: (side: string) => bones.find(b => b.name === `mixamorig${side}Foot`)! };
}
const yawAfter = (r: ReturnType<typeof rig>, side: 'Left' | 'Right', local: THREE.Quaternion) => {
  r.foot(side).quaternion.copy(local); r.root.updateMatrixWorld(true);
  const toe = r.root.getObjectByName(`mixamorig${side}Toe_End`)!, a = r.foot(side).getWorldPosition(new THREE.Vector3()), b = toe.getWorldPosition(new THREE.Vector3()).sub(a);
  return Math.atan2(b.x * (side === 'Left' ? 1 : -1), b.z) / RAD;
};

test('바인드 발각을 재고, 전사만 목표 방위(−5°)로 안쪽으로 돌린다', () => {
  const r = rig(20);
  expect(bindFootYaw(r.mesh.skeleton, 'Left')).toBeCloseTo(20, 4);
  expect(bindFootYaw(r.mesh.skeleton, 'Right')).toBeCloseTo(20, 4);
  const fix = footToeCorrections(r.root, 'knight')!;
  expect(fix.Left!.fix).toBeCloseTo(20 - FOOT_FIX.targetYaw, 4);
  for (const side of ['Left', 'Right'] as const) {
    const bind = r.foot(side).quaternion.clone();
    expect(yawAfter(r, side, bind.clone().multiply(fix[side]!.q))).toBeCloseTo(FOOT_FIX.targetYaw, 3);
  }
  expect(footToeCorrections(r.root, 'mage')).toBeNull();
  // 이미 정상인 몸체·이상값은 건드리지 않는다.
  expect(footToeCorrections(rig(-4).root, 'knight')).toBeNull();
  expect(footToeCorrections(rig(60).root, 'barbarian')).toBeNull();
});

test('인스턴스 발 본은 행렬에만 보정을 곱하고(클립 값·quaternion 불변, 누적 없음) 몸 교체 때 다시 건다', () => {
  const r = rig(25), foot = r.foot('Left'), toe = r.root.getObjectByName('mixamorigLeftToe_End')!;
  const animated = foot.quaternion.clone();
  expect(installFootToeFix(r.root, 'barbarian')).not.toBeNull();
  const yawNow = () => { r.root.updateMatrixWorld(true); const a = foot.getWorldPosition(new THREE.Vector3()), b = toe.getWorldPosition(new THREE.Vector3()).sub(a); return Math.atan2(b.x, b.z) / RAD; };
  expect(yawNow()).toBeCloseTo(FOOT_FIX.targetYaw, 3);
  expect(yawNow()).toBeCloseTo(FOOT_FIX.targetYaw, 3);
  expect(foot.quaternion.equals(animated)).toBe(true);
  // 보정이 필요 없는 영웅(또는 몸)으로 다시 걸면 풀린다.
  installFootToeFix(r.root, 'mage');
  expect(yawNow()).toBeCloseTo(25, 3);
  // 클립 객체는 손대지 않으므로 몸 교체 모션·공유 클립 캐시의 동일성이 유지된다.
  expect(foot.userData.footToeFix).toBeUndefined();
});
