import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original, fitted costume surfaces for the shipped casual-v2 silhouettes.
// Coordinates are in the authored GLB bind pose, never the current animation pose.
const THEMES = {
  glasswarden: [0x327d92, 0xd0faff, 0x5cdddd, 'crystal'],
  emberknight: [0x783b2c, 0xffc46b, 0xf07231, 'plate'],
  starreader: [0x403a80, 0xe4d6ff, 0x85d9ef, 'robe'],
  storm: [0x294b86, 0xc7deff, 0x8dbfff, 'plate'],
  blood: [0x762e43, 0xd7a882, 0xdd586d, 'plate'],
  gravity: [0x39304f, 0xbc9ae4, 0x9571d9, 'plate'],
  phoenix: [0x913d29, 0xffd28e, 0xf5903f, 'plate'],
  frost: [0x388ca0, 0xd6f6ff, 0x8bebff, 'crystal'],
  plague: [0x435c36, 0xd6d396, 0xa4c869, 'leather'],
  rune: [0x404b80, 0xe5c987, 0xb8adff, 'robe'],
  tether: [0x315e5a, 0xe1c784, 0x7edfc0, 'plate'],
};

// Explicit item identity wins over rarity. A green scale coat remains a scale
// coat on every class; class-specific fitting is handled by the rig below.
const ITEM_STYLES = {
  a_leather: [0x714932, 0xbb925b, 0x9d7150, 'leather'],
  a_cloth: [0x716379, 0xc0aa99, 0x9a839f, 'robe'],
  a_padded: [0x746b4f, 0xb6a27e, 0x9a8b6c, 'padded'],
  a_scrap: [0x625b53, 0xad7751, 0x8b8173, 'plate'],
  a_chain: [0x4c5960, 0xb7b3a0, 0x87969b, 'chain'],
  a_scale: [0x294e3c, 0xb09048, 0x527458, 'scale'],
  a_ranger: [0x43543a, 0x977543, 0x75805b, 'leather'],
  a_bronze: [0x916331, 0xd6b370, 0xb58a4c, 'plate'],
  a_knight: [0x637e98, 0xc9d9df, 0x3d5a85, 'plate'],
  a_mithril: [0x729baf, 0xdaeff1, 0xb3d3dd, 'chain'],
  a_wyvern: [0x51436a, 0xaa996b, 0x83719b, 'scale'],
  a_paladin: [0xd0c8a8, 0xd2ad51, 0x477b91, 'plate'],
  a_void: [0x302b46, 0x9573b7, 0x7955ad, 'plate'],
  a_titan: [0x555e66, 0xb0a17a, 0x8e9ca4, 'plate'],
  a_sun: [0xa57228, 0xffdc8b, 0xe8ae47, 'plate'],
  a_king: [0x713b57, 0xebc873, 0xb66479, 'plate'],
};

export function armorStyle(item, heroId) {
  const named = ITEM_STYLES[item.id];
  if (named) return { body: named[0], trim: named[1], accent: named[2], cut: named[3] };
  const themed = THEMES[item.set];
  if (themed) return { body: themed[0], trim: themed[1], accent: themed[2], cut: themed[3] };
  const cloth = /cloth|padded/.test(item.id), leather = /leather|ranger|wyvern/.test(item.id);
  const colors = { N: [0x725244, 0xc4a16b], S: [0x547578, 0xc8b68b], E: [0x587caa, 0xe3cf98], U: [0x544679, 0xc9aeed], L: [0x946627, 0xffe2a1] };
  const [body, trim] = colors[item.rarity] || colors.N;
  return { body: cloth ? 0x676091 : leather ? 0x74523e : body, trim, accent: trim, cut: cloth || heroId === 'mage' ? 'robe' : leather || heroId === 'rogue' ? 'leather' : 'plate' };
}

export function removeArmorAppearance(model) {
  const meshes = [];
  model.traverse((o) => { if (o.userData.equippedArmor) meshes.push(o); });
  const materials = new Set();
  for (const mesh of meshes) { mesh.removeFromParent(); materials.add(mesh.material); }
  // Material disposal is also used by disposeCharacter, so both paths free only
  // these instance-owned geometries without touching the shared identity skin.
  for (const material of materials) material.dispose();
  delete model.userData.armorAppearance;
}

export function applyArmorAppearance(model, hero, item) {
  removeArmorAppearance(model);
  if (!item || model.userData.tllIdentity !== 'casual-v2') return;
  let skin;
  model.traverse((o) => { if (o.isSkinnedMesh && o.name.startsWith('TLL_') && !skin) skin = o; });
  if (!skin) return;
  const skeleton = skin.skeleton;
  const style = armorStyle(item, hero.id);
  const metal = ['plate', 'crystal', 'scale', 'chain'].includes(style.cut);
  const body = new THREE.MeshStandardMaterial({ color: style.body, roughness: metal ? .46 : .88, metalness: metal ? .32 : 0 });
  const trim = new THREE.MeshStandardMaterial({ color: style.trim, roughness: .52, metalness: .25 });
  const accent = new THREE.MeshStandardMaterial({ color: style.accent, roughness: .38, metalness: .12 });
  for (const material of [body, trim, accent]) material.userData.armorSurface = true;
  const add = (name, boneName, geometry, material, position, scale = [1, 1, 1]) => {
    const index = skeleton.bones.findIndex((b) => b.name.replaceAll('.', '') === boneName.replaceAll('.', ''));
    if (index < 0) { geometry.dispose(); return; }
    geometry.scale(...scale); geometry.translate(...position);
    geometry.applyMatrix4(skeleton.boneInverses[index]);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Armor_${name}`; mesh.userData.equippedArmor = item.id;
    mesh.castShadow = true; mesh.receiveShadow = true;
    skeleton.bones[index].add(mesh);
    let disposed = false;
    material.addEventListener('dispose', () => { if (!disposed) { geometry.dispose(); disposed = true; } });
  };
  const rounded = (w, h, d, r = .04) => new RoundedBoxGeometry(w, h, d, 2, r);
  const broad = hero.id === 'barbarian' ? .08 : 0;
  add('fitted_cuirass', 'chest', rounded(.63 + broad, .47, .62, .09), body, [0, 1.045, .04]);
  // Two continuous bands describe an actual garment opening and waist seam.
  add('neck_binding', 'chest', rounded(.44, .055, .64, .02), trim, [0, 1.258, .04]);
  add('waist_binding', 'chest', rounded(.62 + broad, .075, .64, .025), trim, [0, .846, .04]);
  if (['scale', 'chain', 'padded'].includes(style.cut)) {
    const tiles = [];
    const rows = style.cut === 'chain' ? 5 : 4;
    for (let row = 0; row < rows; row++) for (let column = 0; column < 5; column++) {
      let tile;
      if (style.cut === 'chain') tile = new THREE.TorusGeometry(.031, .007, 4, 8);
      else if (style.cut === 'padded') tile = rounded(.079, .072, .013, .012);
      else {
        const outline = new THREE.Shape();
        outline.moveTo(-.044, .035); outline.lineTo(.044, .035);
        outline.lineTo(.039, -.015); outline.quadraticCurveTo(0, -.058, -.039, -.015); outline.closePath();
        tile = new THREE.ExtrudeGeometry(outline, { depth: .012, bevelEnabled: false, curveSegments: 3 });
      }
      tile.translate((column - 2) * .083 + (row % 2 ? .016 : -.016), (row - (rows - 1) / 2) * .067, row * .001);
      tiles.push(tile);
    }
    const surface = mergeGeometries(tiles);
    for (const tile of tiles) tile.dispose();
    add(`${style.cut}_surface`, 'chest', surface, accent, [0, 1.062, .355]);
  } else {
    add('breast_inlay', 'chest', rounded(.25, .29, .035, .025), trim, [0, 1.064, .364]);
    const emblem = style.cut === 'crystal' ? new THREE.OctahedronGeometry(.10) : new THREE.SphereGeometry(.087, 8, 6);
    add('set_emblem', 'chest', emblem, accent, [0, 1.078, .399], [1, 1.1, .3]);
  }
  const heavy = ['plate', 'crystal', 'scale'].includes(style.cut);
  for (const side of [-1, 1]) {
    const bone = side < 0 ? 'upperarm.r' : 'upperarm.l';
    const label = side < 0 ? 'right' : 'left';
    add(`shoulder_${label}`, bone, new THREE.SphereGeometry(1, heavy ? 10 : 12, 8), body, [side * (.355 + broad / 3), 1.22, .005], [heavy ? .235 : .195, heavy ? .16 : .13, .205]);
    add(`shoulder_edge_${label}`, bone, rounded(heavy ? .31 : .25, .06, .39, .025), trim, [side * (.395 + broad / 3), 1.15, .005]);
    if (style.cut === 'crystal') add(`crystal_inlay_${label}`, bone, new THREE.OctahedronGeometry(.09), accent, [side * .40, 1.35, .03], [1, .75, 1]);
    if (heavy) add(`hip_tasset_${label}`, 'hips', rounded(.24, .28, .07, .035), body, [side * .18, .645, .309]);
  }
  add('belt', 'hips', rounded(.655, .095, .56, .035), body, [0, .765, .025]);
  add('belt_buckle', 'hips', rounded(.145, .105, .045, .02), trim, [0, .765, .322]);
  if (style.cut === 'robe') {
    add('robe_skirt', 'hips', new THREE.CylinderGeometry(.34, .48, .38, 12, 1, true), body, [0, .575, -.025], [1, 1, .87]);
    add('robe_hem', 'hips', new THREE.CylinderGeometry(.473, .49, .045, 12, 1, true), trim, [0, .398, -.025], [1, 1, .87]);
    add('robe_stole', 'hips', rounded(.17, .36, .035, .015), accent, [0, .575, .377]);
  }
  model.userData.armorAppearance = { itemId: item.id, cut: style.cut, identity: 'casual-v2' };
}
