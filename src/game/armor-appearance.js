import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaceDetail } from '../engine/surface-textures.js';

// Original, fitted costume surfaces for the shipped medium-rig hero silhouettes.
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
  sg_moonward_aegis: [0x233c5c, 0x8fd8e8, 0x72dfff, 'crystal'],
  sg_abyss_husk: [0x2b1644, 0xb26bff, 0xd5a6ff, 'plate'],
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

// The themed sets need more than a palette/cut change. These original meshes
// follow the existing shoulder/chest
// bones; they do not replace the authored body or add another model download.
function addThemeDetails(theme, add, accent, trim) {
  const put = (name, bone, geometry, material = accent) => add(`theme_${theme}_${name}`, bone, geometry, material, [0, 0, 0]);
  const polygon = (points, z = .06) => {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: .035, bevelEnabled: false, curveSegments: 3 });
    geometry.translate(0, 0, z);
    return geometry;
  };
  if (theme === 'storm') {
    for (const side of [-1, 1]) {
      const x = n => side * n;
      put(side < 0 ? 'right_fin' : 'left_fin', 'chest', polygon([
        [x(.30), 1.15], [x(.51), 1.41], [x(.50), 1.27], [x(.81), 1.51],
        [x(.70), 1.31], [x(.96), 1.34], [x(.72), 1.08], [x(.38), 1.09],
      ], .035));
    }
    put('bolt', 'chest', polygon([[-.045, 1.19], [.065, 1.11], [.01, 1.10], [.075, .94], [-.08, 1.055], [-.02, 1.065]], .43), trim);
  } else if (theme === 'blood') {
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * .34, 1.20, .04), new THREE.Vector3(side * .60, 1.35, .045),
        new THREE.Vector3(side * .76, 1.56, .06),
      ]);
      put(side < 0 ? 'right_horn' : 'left_horn', 'chest', new THREE.TubeGeometry(curve, 8, .055, 5, false));
    }
    put('fang', 'chest', polygon([[-.13, 1.12], [0, 1.05], [.13, 1.12], [.07, .98], [0, .93], [-.07, .98]], .43), trim);
  } else if (theme === 'gravity') {
    for (const side of [-1, 1]) {
      const ring = new THREE.TorusGeometry(.215, .035, 6, 24);
      ring.rotateY(side * .28); ring.translate(side * .68, 1.25, .03);
      put(side < 0 ? 'right_orbit' : 'left_orbit', 'chest', ring);
    }
    const core = new THREE.IcosahedronGeometry(.095, 0); core.scale(1, 1.15, .5); core.translate(0, 1.07, .45);
    put('core', 'chest', core, trim);
  } else if (theme === 'phoenix') {
    for (const side of [-1, 1]) {
      const x = n => side * n;
      put(side < 0 ? 'right_feathers' : 'left_feathers', 'chest', polygon([
        [x(.34), 1.10], [x(.42), 1.50], [x(.51), 1.27], [x(.67), 1.58],
        [x(.67), 1.29], [x(.94), 1.42], [x(.81), 1.12], [x(.49), 1.08],
      ], .025));
    }
    put('flame', 'chest', polygon([[-.095, 1.02], [-.01, 1.19], [.015, 1.08], [.07, 1.13], [.10, 1.025], [.01, .95]], .43), trim);
  } else if (theme === 'frost') {
    for (const side of [-1, 1]) {
      const tall = new THREE.OctahedronGeometry(.19); tall.scale(.53, 1.45, .5); tall.translate(side * .50, 1.35, .02);
      const outer = new THREE.OctahedronGeometry(.14); outer.scale(.55, 1.2, .5); outer.translate(side * .72, 1.30, .03);
      const cluster = mergeGeometries([tall, outer]); tall.dispose(); outer.dispose();
      put(side < 0 ? 'right_crystals' : 'left_crystals', 'chest', cluster);
    }
    put('snowflake', 'chest', polygon([[-.12, 1.09], [-.04, 1.12], [0, 1.21], [.04, 1.12], [.12, 1.09], [.04, 1.06], [0, .96], [-.04, 1.06]], .43), trim);
  } else if (theme === 'plague') {
    const profile = [[0, 0], [.045, 0], [.045, .16], [.15, .16], [.19, .20], [.14, .25], [.07, .275], [0, .28]];
    for (const side of [-1, 1]) {
      const cap = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 12);
      cap.translate(side * .63, 1.17, .02);
      put(side < 0 ? 'right_sporecap' : 'left_sporecap', 'chest', cap);
    }
    const seed = new THREE.DodecahedronGeometry(.11); seed.scale(1, 1, .55); seed.translate(0, 1.07, .45);
    put('seed', 'chest', seed, trim);
  } else if (theme === 'rune') {
    for (const side of [-1, 1]) {
      const x = n => side * n;
      put(side < 0 ? 'right_tablet' : 'left_tablet', 'chest', polygon([
        [x(.46), 1.12], [x(.51), 1.45], [x(.68), 1.52], [x(.84), 1.36], [x(.80), 1.09],
      ], .05));
    }
    put('sigil', 'chest', polygon([[-.13, 1.13], [0, 1.21], [.13, 1.13], [.065, 1.01], [0, .96], [-.065, 1.01]], .43), trim);
  } else if (theme === 'tether') {
    for (const side of [-1, 1]) {
      const chain = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * .34, 1.34, .03), new THREE.Vector3(side * .75, 1.34, .04),
        new THREE.Vector3(side * .82, 1.11, .055), new THREE.Vector3(side * .53, .96, .07),
      ]);
      const links = [];
      for (let i = 0; i < 6; i++) {
        const link = new THREE.TorusGeometry(.073, .019, 5, 10);
        link.rotateY(i % 2 ? .72 : -.72);
        const p = chain.getPoint((i + .5) / 6); link.translate(p.x, p.y, p.z);
        links.push(link);
      }
      const linked = mergeGeometries(links); for (const link of links) link.dispose();
      put(side < 0 ? 'right_chain' : 'left_chain', 'chest', linked);
    }
    const lock = new THREE.TorusGeometry(.11, .036, 6, 12); lock.translate(0, 1.07, .44);
    put('lock', 'chest', lock, trim);
  }
}

export function applyArmorAppearance(model, hero, item) {
  removeArmorAppearance(model);
  if (!item || !['casual-v2', 'expedition-v3'].includes(model.userData.tllIdentity)) return;
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
  applySurfaceDetail(body, metal ? 'metal' : 'cloth');
  applySurfaceDetail(trim, 'metal');
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
  addThemeDetails(item.set, add, accent, trim);
  model.userData.armorAppearance = { itemId: item.id, cut: style.cut, identity: model.userData.tllIdentity };
}
