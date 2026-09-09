import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const shaft = new THREE.CylinderGeometry(.025, .025, .85, 6).rotateX(Math.PI / 2);
const tip = new THREE.ConeGeometry(.095, .24, 4).rotateX(Math.PI / 2).translate(0, 0, .54);
const featherA = new THREE.BoxGeometry(.24, .018, .19).translate(0, 0, -.32);
const featherB = new THREE.BoxGeometry(.018, .24, .19).translate(0, 0, -.32);
const geometry = mergeGeometries([shaft, tip, featherA, featherB]);
for (const part of [shaft, tip, featherA, featherB]) part.dispose();
const forward = new THREE.Vector3(0, 0, 1);

/** One shared silhouette buffer, one disposable material per live arrow. */
export function createArrowVisual(color, size, direction) {
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Ranger_Arrow'; mesh.userData.arrowVisual = true;
  mesh.scale.setScalar(Math.max(.7, size * 2));
  mesh.quaternion.setFromUnitVectors(forward, direction.clone().normalize());
  return mesh;
}

export function releaseProjectileVisual(mesh) {
  if (!mesh) return;
  mesh.removeFromParent();
  if (mesh.userData.arrowVisual) mesh.material.dispose();
}
