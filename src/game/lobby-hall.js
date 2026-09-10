import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaceDetail, projectSurfaceUV, SURFACE_TEXTURES } from '../engine/surface-textures.js';

/** The oath hall: fixed architecture, batched by material, owned by one lobby. */
export function buildOathHall() {
  const group = new THREE.Group(); group.name = 'TLL_OathHall';
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x789288, roughness: .7, metalness: .04 }),
    new THREE.MeshStandardMaterial({ color: 0xf3ecdd, roughness: .85, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0xdfb879, roughness: .8, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x4d9179, roughness: .94, metalness: 0, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0xffefd5, emissive: 0xe6c99a, emissiveIntensity: .1, roughness: .8 }),
  ];
  applySurfaceDetail(materials[0], 'stone'); applySurfaceDetail(materials[1], 'stone');
  applySurfaceDetail(materials[2], 'metal'); applySurfaceDetail(materials[3], 'cloth');
  const batches = materials.map(() => []);
  const transform = new THREE.Object3D();
  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    transform.position.set(x, y, z); transform.rotation.set(rx, ry, rz); transform.updateMatrix();
    geo.applyMatrix4(transform.matrix); projectSurfaceUV(geo, .7); batches[material].push(geo);
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
  // Side piers frame the distant sanctuary, instead of a solid blank back wall.
  box(7, 9, .5, 0, -12.5, 4, -11); box(7, 9, .5, 0, 12.5, 4, -11);
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
  // Layered stonework gives the hall depth while keeping the hero dais clear.
  for (const z of [-3.5, -6.8, -9.7]) for (const side of [-1, 1]) {
    const x = side * 5.2;
    for (const [radius, y, h] of [[.64, .08, .26], [.48, .36, .2], [.32, 2.7, 4.5], [.48, 5, .22], [.68, 5.2, .2]]) {
      add(new THREE.CylinderGeometry(radius, radius * 1.05, h, 12), 1, x, y, z);
    }
    for (const y of [.55, 4.75, 5.32]) ring(.49, .055, 2, x, y, z);
    for (const dx of [-.14, 0, .14]) box(.025, 3.7, .04, 2, x + dx, 2.7, z + .33);
    box(2.4, .18, .65, 1, x, 5.55, z);
    box(2.55, .06, .73, 2, x, 5.65, z);
  }
  // An astronomical rose, filigree, and a stepped ceremonial approach.
  for (const r of [.7, 1.15, 1.55]) ring(r, .045, 2, 0, 4.3, -10.25, 0);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    box(.06, .55, .08, 2, Math.cos(a) * 1.3, 4.3 + Math.sin(a) * 1.3, -10.2, 0);
    const x = Math.cos(a) * 1.45, z = Math.sin(a) * 1.45;
    box(.035, .012, .23, 2, x, .025, z, -a + Math.PI / 2);
  }
  for (let i = 0; i < 3; i++) box(4.3 + i * .3, .12, .45, 1, 0, -.19 - i * .06, 2 + i * .35);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const z = -1.5 - i * .8;
      add(new THREE.CylinderGeometry(.1, .16, .9, 8), 1, side * 7, .35, z);
    }
    box(.34, .13, 7.1, 2, side * 7, .86, -4.7);
  }
  for (let i = 0; i < batches.length; i++) {
    const geometry = mergeGeometries(batches[i]);
    for (const part of batches[i]) part.dispose();
    const mesh = new THREE.Mesh(geometry, materials[i]);
    mesh.name = `TLL_Hall_${i}`; mesh.receiveShadow = true; mesh.castShadow = i < 4;
    group.add(mesh);
  }
  if (SURFACE_TEXTURES['oath-sanctum']) {
    const backdropMaterial = new THREE.MeshBasicMaterial({ map: SURFACE_TEXTURES['oath-sanctum'], color: 0xb5c4bd, fog: false });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(24, 13.5), backdropMaterial);
    backdrop.name = 'GUI_SanctuaryVista'; backdrop.position.set(0, 5.5, -12);
    group.add(backdrop); materials.push(backdropMaterial);
  }
  group.userData.dispose = () => {
    group.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
    for (const material of materials) material.dispose();
  };
  return group;
}
