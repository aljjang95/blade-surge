import * as THREE from 'three';
import { spawnCharacter } from '../engine/assets.js';

// 라이브러리 몬스터의 분리 무기(prop GLB)를 Mixamo 손 본에 붙인다. 영웅 무기는 KayKit handslot 계약(assets.js attachLegacyWeapons)이지만
// 몬스터 몸에는 그 소켓이 없으므로, 몸에서 잘라 낸 무기를 같은 방식(손 본 아래 축 보정 소켓)으로 얹는다.
//  - 몬스터 GLB 의 본은 cm 배율이 섞여 있어 손 본의 월드 배율이 모델 배율과 다르다. 소켓 배율로 이를 상쇄해 무기 1단위 = 모델 1m 로 맞춘다.
//  - 무기 prop 은 몸과 같은 좌표계(몸 키 = heightM)로 들였으므로 추가 배율은 없다.
//  - spec: { asset, hand: 'right'|'left', grip: 무기 로컬에서 손에 쥘 점(m), at: 손 본 로컬 위치(m, 모델 단위), rot: 손 본 기준 오일러 XYZ(도) }
const handPattern = (side) => new RegExp(`^(?:mixamorig\\d*[:_]?)?${side}_?hand(?:bone)?$`, 'i');

/** Mixamo 계열 손 본을 찾는다(이름은 'mixamorig:RightHand'·'mixamorigRightHand' 등). */
export function findMonsterHand(root, side = 'right') {
  const pattern = handPattern(side);
  let result = null;
  root.traverse((node) => { if (!result && node.isBone && pattern.test(node.name || '')) result = node; });
  return result;
}

const _boneScale = new THREE.Vector3(), _modelScale = new THREE.Vector3(), _euler = new THREE.Euler();

/**
 * 몬스터 모델(root)의 손 본에 무기를 붙이고 { socket, weapon } 을 돌려준다. 손 본이나 무기 모델이 없으면 null(몸만 그대로 둔다).
 * @param {THREE.Object3D} root Actor.model (스킨 본 포함)
 * @param {{ asset: string, hand?: string, grip?: number[], at?: number[], rot?: number[] }} spec
 * @param {Record<string, any>} models game.app.models
 */
export function attachMonsterWeapon(root, spec, models) {
  const source = spec && models?.[spec.asset];
  const hand = spec && findMonsterHand(root, spec.hand || 'right');
  if (!source || !hand) return null;
  root.updateWorldMatrix(true, true);
  hand.getWorldScale(_boneScale); root.getWorldScale(_modelScale);
  if (!(_boneScale.x > 0) || !(_modelScale.x > 0)) return null;
  // 손 본 로컬 1단위 = 모델 _boneScale/_modelScale m. 소켓 배율로 모델 1m 를 만든다.
  const compensate = _modelScale.x / _boneScale.x;
  const { root: weapon } = spawnCharacter(source);
  const socket = new THREE.Group(); socket.name = 'MonsterWeaponSocket';
  socket.scale.setScalar(compensate);
  const at = spec.at || [0, 0, 0];
  socket.position.set(at[0] * compensate, at[1] * compensate, at[2] * compensate);
  const holder = new THREE.Group(); holder.name = 'MonsterWeaponHolder';
  const rot = spec.rot || [0, 0, 0];
  _euler.set(THREE.MathUtils.degToRad(rot[0]), THREE.MathUtils.degToRad(rot[1]), THREE.MathUtils.degToRad(rot[2]), 'XYZ');
  holder.quaternion.setFromEuler(_euler);
  const grip = spec.grip || [0, 0, 0];
  weapon.position.set(-grip[0], -grip[1], -grip[2]);
  holder.add(weapon); socket.add(holder); hand.add(socket);
  return { socket, weapon };
}
