import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FOOT_FIX, bindFootYaw, correctFootClips, footToeCorrections } from '../src/engine/hero-foot-fix.js';

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
  expect(fix.Left.fix).toBeCloseTo(20 - FOOT_FIX.targetYaw, 4);
  for (const side of ['Left', 'Right'] as const) {
    const bind = r.foot(side).quaternion.clone();
    expect(yawAfter(r, side, bind.clone().multiply(fix[side].q))).toBeCloseTo(FOOT_FIX.targetYaw, 3);
  }
  expect(footToeCorrections(r.root, 'mage')).toBeNull();
  // 이미 정상인 몸체·이상값은 건드리지 않는다.
  expect(footToeCorrections(rig(-4).root, 'knight')).toBeNull();
  expect(footToeCorrections(rig(60).root, 'barbarian')).toBeNull();
});

test('발 회전 트랙만 복제·보정하고 다른 트랙과 원본 클립은 그대로 둔다', () => {
  const r = rig(25), fix = footToeCorrections(r.root, 'barbarian')!;
  const q = r.foot('Left').quaternion.toArray();
  const foot = new THREE.QuaternionKeyframeTrack('mixamorigLeftFoot.quaternion', [0, 1], [...q, ...q]);
  const hips = new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0, 0, 0, 1, 0]);
  const run = new THREE.AnimationClip('run', 1, [foot, hips]), idle = new THREE.AnimationClip('idle', 1, [hips]);
  const before = Array.from(foot.values);
  const [fixedRun, fixedIdle] = correctFootClips([run, idle], fix);
  expect(fixedIdle).toBe(idle);
  expect(fixedRun).not.toBe(run);
  expect(fixedRun.tracks[1]).toBe(hips);
  expect(Array.from(foot.values)).toEqual(before);
  expect(fixedRun.duration).toBe(1); expect(fixedRun.name).toBe('run');
  const corrected = new THREE.Quaternion().fromArray(fixedRun.tracks[0].values as unknown as number[], 0);
  expect(yawAfter(r, 'Left', corrected)).toBeCloseTo(FOOT_FIX.targetYaw, 3);
  expect(correctFootClips([run], null)[0]).toBe(run);
});
