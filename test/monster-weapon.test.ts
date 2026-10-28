import { sizeBandMul } from '../src/data/size-bands.js';
import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ENEMIES } from '../src/data/stages.js';
import { MONSTER_ROSTER, monsterRosterEntry, monsterRosterScale } from '../src/data/monster-roster.js';
import { attachMonsterWeapon, findMonsterHand } from '../src/game/monster-weapon.js';
import { createPreviewEnemy } from '../src/ui/enemy-preview.js';

// 합성 스켈레톤: cm 배율 0.01 이 섞인 Mixamo 이름 손 본(실제 Tripo 몸과 같은 상황).
function skeleton(rightName = 'mixamorigRightHand') {
  const root = new THREE.Group();
  const armature = new THREE.Group(); armature.scale.setScalar(0.01);
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips';
  const right = new THREE.Bone(); right.name = rightName; right.position.set(50, 100, 0);
  const left = new THREE.Bone(); left.name = 'mixamorigLeftHand'; left.position.set(-50, 100, 0);
  hips.add(right, left); armature.add(hips); root.add(armature);
  return { root, right, left };
}
function weaponGltf() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), new THREE.MeshStandardMaterial({ color: '#888888' })));
  return { scene, animations: [] };
}

test('findMonsterHand: mixamorigRightHand·mixamorig:RightHand 를 찾고 왼손과 구분한다', () => {
  for (const name of ['mixamorigRightHand', 'mixamorig:RightHand', 'mixamorig1:RightHand']) {
    const { root, right, left } = skeleton(name);
    expect(findMonsterHand(root, 'right')).toBe(right);
    expect(findMonsterHand(root, 'left')).toBe(left);
  }
  const { root } = skeleton('mixamorigRightArm');
  expect(findMonsterHand(root, 'right')).toBeNull();
});

test('attachMonsterWeapon: 손 본 자식 소켓에 붙고 손 본 cm 배율을 상쇄해 무기가 모델 1m 단위가 된다', () => {
  const { root, right } = skeleton();
  root.scale.setScalar(1.5);
  const held = attachMonsterWeapon(root, { asset: 'club', hand: 'right', grip: [0, 0.4, 0], at: [0, 0.1, 0], rot: [0, 0, -90] }, { club: weaponGltf() });
  expect(held).not.toBeNull();
  expect(held!.socket.parent).toBe(right);
  root.updateWorldMatrix(true, true);
  const weaponScale = new THREE.Vector3(), modelScale = new THREE.Vector3();
  held!.weapon.getWorldScale(weaponScale); root.getWorldScale(modelScale);
  expect(weaponScale.x / modelScale.x).toBeCloseTo(1, 6);
  // 무기 모델이 없거나 손 본이 없으면 붙이지 않는다.
  expect(attachMonsterWeapon(root, { asset: 'missing' }, { club: weaponGltf() })).toBeNull();
  expect(attachMonsterWeapon(skeleton('mixamorigRightArm').root, { asset: 'club' }, { club: weaponGltf() })).toBeNull();
});

test('로스터 scale: Tripo 몸이면 scale, 대체 모델이면 예전 fallbackScale 을 유지한다', () => {
  const warden = monsterRosterEntry('Bell_Warden'), sovereign = monsterRosterEntry('Bell_Sovereign'), ringer = monsterRosterEntry('Bell_Ringer');
  expect(monsterRosterScale(warden, { id: 'tll_ch7_midboss' })).toBe(0.53);
  expect(monsterRosterScale(warden, { id: 'bone_knight' })).toBe(1.1);
  expect(monsterRosterScale(sovereign, { id: 'tll_ch7_finalboss' })).toBe(0.5);
  expect(monsterRosterScale(sovereign, { id: 'frost_golem' })).toBe(0.72);
  expect(monsterRosterScale(ringer, { id: 'skeleton_mage' })).toBe((ringer as any).scale);
  expect(monsterRosterScale(null)).toBe(1);
  expect((MONSTER_ROSTER as any).Bell_Ringer.weapon.asset).toBe('tll_ch7_bellringer_club');
});

function enemyFixture(libraryId: string, defId: string, models: Record<string, any>) {
  const { root } = skeleton();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: '#ddd3ab' })); root.add(body);
  root.userData.libraryAsset = { id: libraryId };
  const gltf = { scene: root, animations: ['idle', 'walk', 'run', 'hit', 'death', 'attack'].map((name) => new THREE.AnimationClip(name, 1, [])) };
  const enemy = createPreviewEnemy(new THREE.Scene(), gltf, null, (ENEMIES as any)[defId], models);
  // 생성자가 장면을 복제하므로 소켓은 복제본(enemy.model)에서 찾는다.
  return { enemy, socket: enemy.model.getObjectByName('MonsterWeaponSocket') as THREE.Object3D | undefined };
}

test('Enemy: Tripo 몸이면 오른손에 무기가 붙고 색조 보정을 받으며, 대체 모델이면 붙지 않고 예전 scale 을 쓴다', () => {
  const models = { tll_ch7_midboss_flail: weaponGltf() };
  const primary = enemyFixture('tll_ch7_midboss', 'belltower_midboss', models);
  expect(primary.socket).toBeDefined();
  expect(primary.socket!.parent!.name).toBe('mixamorigRightHand');
  const def = (ENEMIES as any).belltower_midboss;
  expect(primary.enemy.model.scale.x).toBeCloseTo(def.scale * sizeBandMul(def) * 0.53);   // 크기 띠 보정 포함
  // 무기 재질도 몸과 같은 색조(def.tint 쪽으로 lerp 0.32)를 받는다.
  const weaponMesh = primary.socket!.getObjectByProperty('isMesh', true) as THREE.Mesh;
  const base = new THREE.Color('#888888'), expected = base.clone().lerp(new THREE.Color(def.tint), 0.32);
  expect((weaponMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(expected.getHex());
  const fallback = enemyFixture('bone_knight', 'belltower_midboss', models);
  expect(fallback.socket).toBeUndefined();
  expect(fallback.enemy.model.scale.x).toBeCloseTo(def.scale * 1.1);
});
