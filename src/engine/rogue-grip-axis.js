import { Matrix4, Quaternion, Vector3 } from 'three';

export const ROGUE_KNIFE_GRIP_AXIS_REVISION = 'rogue-knife-grip-axis-v1';

const normalizedBoneName = name => name.toLowerCase().replace(/^mixamorig\d*[:_]?/, '');

function uniqueNode(scene, name, predicate = node => node.name === name) {
  const matches = [];
  scene.traverse(node => { if (predicate(node)) matches.push(node); });
  if (matches.length !== 1) throw new Error('도적 단검 그립 노드가 없거나 중복됨: ' + name);
  return matches[0];
}

function uniqueBone(scene, suffix) {
  return uniqueNode(scene, suffix, node => node.isBone && normalizedBoneName(node.name) === suffix);
}

/**
 * 라이브러리 도적의 rest 자세에서만 한 번 호출한다. 실제 손목과 손가락 첫 관절로 단검의 긴 축을 맞춘다.
 * 공용 소켓·뼈·클립·배율·지오메트리를 바꾸지 않고 Knife 루트 두 개의 위치·회전만 손목 주위로 돌린다.
 */
export function fitRogueKnifeGripAxes(scene, heroId, handBones) {
  if (heroId !== 'rogue') return 0;
  scene.updateMatrixWorld(true);
  const entries = [
    { name: 'Knife', side: 'right', key: 'r' },
    { name: 'Knife_Offhand', side: 'left', key: 'l' },
  ].map(spec => {
    const weapon = uniqueNode(scene, spec.name);
    const hand = uniqueBone(scene, spec.side + 'hand');
    const index = uniqueBone(scene, spec.side + 'handindex1');
    const pinky = uniqueBone(scene, spec.side + 'handpinky1');
    const middle = uniqueBone(scene, spec.side + 'handmiddle1');
    const socket = weapon.parent;
    if (weapon.userData.forgedWeapon !== 'dagger' || !weapon.userData.weaponForgeBounds
      || hand.name !== handBones[spec.key] || socket?.name !== 'LibrarySocket_' + spec.key || socket.parent !== hand
      || index.parent !== hand || pinky.parent !== hand || middle.parent !== hand || !weapon.matrixAutoUpdate) {
      throw new Error('도적 단검의 손·소켓·손가락 부모 계약 불일치: ' + spec.name);
    }
    return { ...spec, weapon, hand, index, pinky, middle, socket };
  });
  const marks = entries.map(entry => entry.weapon.userData.rogueKnifeGripAxis);
  if (marks.every(mark => mark?.revision === ROGUE_KNIFE_GRIP_AXIS_REVISION)) return 0;
  if (marks.some(Boolean)) throw new Error('도적 단검 그립 교정이 일부만 적용되었거나 다른 버전임');

  // 양쪽 모두 검증한 계획을 만든 뒤 한 번에 적용한다. 한쪽의 잘못된 랜드마크로 다른 쪽만 교정하지 않는다.
  const plans = entries.map(entry => {
    const { weapon, hand, index, pinky, middle, socket } = entry;
    const parentScale = socket.getWorldScale(new Vector3());
    if (!(parentScale.x > 0) || Math.max(Math.abs(parentScale.x - parentScale.y), Math.abs(parentScale.x - parentScale.z)) > parentScale.x * 1e-6) {
      throw new Error('도적 단검의 부모 배율이 균일하지 않음: ' + entry.name);
    }
    const wristWorld = hand.getWorldPosition(new Vector3());
    const acrossWorld = index.getWorldPosition(new Vector3()).sub(pinky.getWorldPosition(new Vector3()));
    const fingerWorld = middle.getWorldPosition(new Vector3()).sub(wristWorld);
    if (acrossWorld.length() < 1e-5 || fingerWorld.length() < 1e-5) throw new Error('도적 손 랜드마크가 퇴화함: ' + entry.name);
    acrossWorld.normalize(); fingerWorld.normalize();
    if (new Vector3().crossVectors(fingerWorld, acrossWorld).length() < .1) throw new Error('도적 손바닥 평면이 불분명함: ' + entry.name);
    const beforeWorld = weapon.matrixWorld.clone();
    const fromWorld = new Vector3(0, 1, 0).transformDirection(beforeWorld);
    const deltaWorld = new Quaternion().setFromUnitVectors(fromWorld, acrossWorld);
    const rotationAboutWrist = new Matrix4().makeTranslation(wristWorld.x, wristWorld.y, wristWorld.z)
      .multiply(new Matrix4().makeRotationFromQuaternion(deltaWorld))
      .multiply(new Matrix4().makeTranslation(-wristWorld.x, -wristWorld.y, -wristWorld.z));
    const wantedWorld = rotationAboutWrist.multiply(beforeWorld);
    const wantedLocal = socket.matrixWorld.clone().invert().multiply(wantedWorld);
    const position = new Vector3(), quaternion = new Quaternion(), unusedScale = new Vector3();
    wantedLocal.decompose(position, quaternion, unusedScale);
    const scale = weapon.scale.clone();
    const plannedWorld = socket.matrixWorld.clone().multiply(new Matrix4().compose(position, quaternion, scale));
    const plannedAxis = new Vector3(0, 1, 0).transformDirection(plannedWorld);
    const beforeRadius = new Vector3().setFromMatrixPosition(beforeWorld).distanceTo(wristWorld);
    const afterRadius = new Vector3().setFromMatrixPosition(plannedWorld).distanceTo(wristWorld);
    if (!position.toArray().concat(quaternion.toArray()).every(Number.isFinite)
      || plannedAxis.dot(acrossWorld) < 1 - 1e-8 || Math.abs(afterRadius - beforeRadius) > 1e-6) {
      throw new Error('도적 단검의 강체 회전 검증 실패: ' + entry.name);
    }
    return { weapon, position, quaternion, metadata: {
      revision: ROGUE_KNIFE_GRIP_AXIS_REVISION,
      target: 'Index1 minus Pinky1, normalized world vector in the unanimated attachment rest pose',
      pivot: 'own hand bone world point', wristWorld: wristWorld.toArray(), acrossWorld: acrossWorld.toArray(),
      worldDeltaQuaternionXYZW: deltaWorld.toArray(),
      originalLocalPosition: weapon.position.toArray(), originalLocalQuaternionXYZW: weapon.quaternion.toArray(),
      correctedLocalPosition: position.toArray(), correctedLocalQuaternionXYZW: quaternion.toArray(),
      originalScale: scale.toArray(),
    } };
  });
  for (const { weapon, position, quaternion, metadata } of plans) {
    weapon.position.copy(position); weapon.quaternion.copy(quaternion); weapon.updateMatrix();
    weapon.userData.rogueKnifeGripAxis = metadata;
  }
  scene.updateMatrixWorld(true);
  return plans.length;
}
