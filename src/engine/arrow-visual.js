import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const shaft = new THREE.CylinderGeometry(.025, .025, .85, 6).rotateX(Math.PI / 2);
const tip = new THREE.ConeGeometry(.095, .24, 4).rotateX(Math.PI / 2).translate(0, 0, .54);
const featherA = new THREE.BoxGeometry(.24, .018, .19).translate(0, 0, -.32);
const featherB = new THREE.BoxGeometry(.018, .24, .19).translate(0, 0, -.32);
const geometry = mergeGeometries([shaft, tip, featherA, featherB]);
for (const part of [shaft, tip, featherA, featherB]) part.dispose();
const forward = new THREE.Vector3(0, 0, 1);
// 바람 발광 겉껍질(2026-10-29 궁수 VFX): 축을 감싸는 굵은 빛 심 + 촉 앞 빛 방울. 가산 혼합이라 어두운 바닥에서도 화살이 '빛나는 창'으로 읽힌다.
const glowShaft = new THREE.CylinderGeometry(.07, .03, 1.15, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, -.05);
const glowTip = new THREE.SphereGeometry(.15, 10, 8).scale(1, 1, 1.8).translate(0, 0, .5);
const glowGeometry = mergeGeometries([glowShaft.toNonIndexed(), glowTip.toNonIndexed()]);
glowShaft.dispose(); glowTip.dispose();
const _hot = new THREE.Color();

/** One shared silhouette buffer, one disposable material per live arrow. */
export function createArrowVisual(color, size, direction) {
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Ranger_Arrow'; mesh.userData.arrowVisual = true;
  mesh.scale.setScalar(Math.max(.7, size * 2));
  mesh.quaternion.setFromUnitVectors(forward, direction.clone().normalize());
  // 겉껍질 색: 화살 색을 흰빛 쪽으로 당기고 1 이상으로 올려 블룸 임계를 넘긴다(몸통 색 0x7feac0 휘도 .67 < 임계 .84).
  _hot.set(color).lerp(new THREE.Color(1, 1, 1), .35).multiplyScalar(1.6);
  const glow = new THREE.Mesh(glowGeometry, new THREE.MeshBasicMaterial({ color: _hot.clone(), transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.name = 'Ranger_Arrow_Glow'; glow.renderOrder = 9; mesh.add(glow);
  mesh.userData.glow = glow;
  return mesh;
}

export function releaseProjectileVisual(mesh) {
  if (!mesh) return;
  mesh.removeFromParent();
  if (mesh.userData.arrowVisual) { mesh.material.dispose(); mesh.userData.glow?.material.dispose(); }
}
