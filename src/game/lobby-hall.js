import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The oath hall: fixed architecture, batched by material, owned by one lobby. */
export function buildOathHall() {
  const group = new THREE.Group(); group.name = 'TLL_OathHall';
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x426b60, roughness: .9, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x96b09a, roughness: .85, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0xdfb879, roughness: .8, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x4d9179, roughness: .94, metalness: 0, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0xffefd5, emissive: 0xe6c99a, emissiveIntensity: .1, roughness: .8 }),
  ];
  const batches = materials.map(() => []);
  const transform = new THREE.Object3D();
  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    transform.position.set(x, y, z); transform.rotation.set(rx, ry, rz); transform.updateMatrix();
    geo.applyMatrix4(transform.matrix); batches[material].push(geo);
  };
  const box = (w, h, d, m, x, y, z, ry = 0) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, 0, ry);
  const ring = (r, tube, m, x, y, z, rx = -Math.PI / 2) => add(new THREE.TorusGeometry(r, tube, 4, 64), m, x, y, z, rx);
  box(34, .3, 28, 0, 0, -.4, -4);
  add(new THREE.CylinderGeometry(2.05, 2.2, .18, 48), 1, 0, -.16, 0);
  add(new THREE.CylinderGeometry(1.9, 1.97, .08, 64), 0, 0, -.03, 0);
  ring(1.86, .018, 2, 0, .018, 0); ring(2.12, .026, 2, 0, -.08, 0);
  // Stone joints converge on the dais, without objects crossing the hero.
  for (let i = -6; i <= 6; i++) {
    box(.025, .008, 24, 1, i * 2.6, -.24, -4);
    box(32, .008, .025, 1, 0, -.24, i * 2.6 - 4);
  }
  // Receding pointed arches are the room's silhouette.
  const arch = (cx, z, width, height, depth) => {
    const r = width / 2, shoulder = height - r;
    for (const side of [-1, 1]) {
      box(.3, shoulder, depth, 1, cx + side * r, shoulder / 2 - .2, z);
      box(.46, .2, depth + .15, 2, cx + side * r, .1, z);
      box(.4, .12, depth + .08, 2, cx + side * r, shoulder - .35, z);
    }
    add(new THREE.TorusGeometry(r, .2, 8, 40, Math.PI), 1, cx, shoulder - .2, z);
    add(new THREE.TorusGeometry(r, .025, 6, 40, Math.PI), 2, cx, shoulder - .2, z + .195);
  };
  arch(0, -4.8, 5.6, 5, .42);
  arch(0, -8.1, 5.6, 5.2, .42);
  arch(-6.5, -5.5, 4, 4.7, .42); arch(6.5, -5.5, 4, 4.7, .42);
  box(32, 8, .5, 0, 0, 3.6, -11);
  // Tall slit windows supply a calm rim rather than full-screen glow.
  for (const x of [-7.8, -5.2, -1.35, 1.35, 5.2, 7.8]) {
    box(.13, 4.8, .04, 4, x, 3, -10.7);
    box(.35, 5.1, .07, 1, x, 3, -10.78);
  }
  // Fabric banners with a split blade inlay, a shared TLL house signature.
  for (const x of [-3.45, 3.45]) {
    const shape = new THREE.Shape(); shape.moveTo(-.48, 0); shape.lineTo(.48, 0);
    shape.lineTo(.48, -2.5); shape.lineTo(0, -2.95); shape.lineTo(-.48, -2.5); shape.closePath();
    add(new THREE.ShapeGeometry(shape), 3, x, 4.7, -4.65);
    box(1.12, .07, .1, 2, x, 4.74, -4.64);
    for (const side of [-1, 1]) {
      const blade = new THREE.Shape(); blade.moveTo(side * .04, 0); blade.lineTo(side * .15, -.2);
      blade.lineTo(side * .13, -1.2); blade.lineTo(side * .04, -1.48); blade.closePath();
      add(new THREE.ShapeGeometry(blade), 2, x, 4.25, -4.63);
    }
    ring(.33, .016, 2, x, 3.5, -4.61, 0);
  }
  for (let i = 0; i < batches.length; i++) {
    const geometry = mergeGeometries(batches[i]);
    for (const part of batches[i]) part.dispose();
    const mesh = new THREE.Mesh(geometry, materials[i]);
    mesh.name = `TLL_Hall_${i}`; mesh.receiveShadow = true; mesh.castShadow = i < 4;
    group.add(mesh);
  }
  group.userData.dispose = () => {
    group.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
    for (const material of materials) material.dispose();
  };
  return group;
}
