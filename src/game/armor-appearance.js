import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaceDetail, projectSurfaceUV } from '../engine/surface-textures.js';

// 좌표는 원본 GLB의 바인드 포즈이며 현재 애니메이션 포즈에서 생성하지 않는다.
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

// 아이템 재질 정체성은 직업과 등급보다 우선한다. 체형 보정은 리그에서 한다.
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

// 일반 16종과 소환 갑옷의 실루엣 정본. 일반 판금 8종과 심연 갑옷의 조합도 다르다.
const ITEM_SILHOUETTES = {
  a_leather: ['round', 'none', 'none', 'plain', 'sphere'],
  a_cloth: ['none', 'hood', 'short', 'sash', 'diamond'],
  a_padded: ['fur', 'fur', 'none', 'sash', 'none'],
  a_scrap: ['none', 'none', 'tattered', 'plates', 'none'],
  a_chain: ['round', 'ring', 'short', 'chain', 'crest'],
  a_scale: ['layered', 'high', 'none', 'plates', 'diamond'],
  a_ranger: ['fur', 'hood', 'tattered', 'plain', 'crest'],
  a_bronze: ['round', 'ring', 'none', 'plain', 'sphere'],
  a_knight: ['layered', 'high', 'short', 'plates', 'crest'],
  a_mithril: ['wing', 'ring', 'long', 'chain', 'star'],
  a_wyvern: ['spiked', 'high', 'tattered', 'plates', 'skull'],
  a_paladin: ['wing', 'ring', 'long', 'sash', 'star'],
  a_void: ['spiked', 'hood', 'tattered', 'chain', 'skull'],
  a_titan: ['layered', 'fur', 'none', 'plates', 'diamond'],
  a_sun: ['spiked', 'high', 'short', 'sash', 'star'],
  a_king: ['fur', 'high', 'long', 'chain', 'crest'],
  sg_moonward_aegis: ['wing', 'ring', 'short', 'plates', 'diamond'],
  sg_abyss_husk: ['spiked', 'high', 'long', 'chain', 'skull'],
  a_town_oath: ['round', 'high', 'short', 'plates', 'crest'],
  a_town_ember: ['layered', 'fur', 'tattered', 'sash', 'sphere'],
  a_town_star: ['wing', 'high', 'long', 'plain', 'star'],
};

function legacyStyle(item, heroId) {
  const named = ITEM_STYLES[item.id];
  if (named) return { body: named[0], trim: named[1], accent: named[2], cut: named[3] };
  const themed = THEMES[item.set];
  if (themed) return { body: themed[0], trim: themed[1], accent: themed[2], cut: themed[3] };
  const cloth = /cloth|padded/.test(item.id), leather = /leather|ranger|wyvern/.test(item.id);
  const colors = { N: [0x725244, 0xc4a16b], S: [0x547578, 0xc8b68b], E: [0x587caa, 0xe3cf98], U: [0x544679, 0xc9aeed], L: [0x946627, 0xffe2a1] };
  const [body, trim] = colors[item.rarity] || colors.N;
  return { body: cloth ? 0x676091 : leather ? 0x74523e : body, trim, accent: trim, cut: cloth || heroId === 'mage' ? 'robe' : leather || heroId === 'rogue' ? 'leather' : 'plate' };
}

export function armorStyle(item, heroId) {
  const base = legacyStyle(item, heroId);
  // 표에 없는 테마·병기고·원정 갑옷은 고유 테마 디테일이 윤곽을 맡으므로 기존 외형(어깨·칼라 없음)을 그대로 둔다.
  const [pauldron, collar, cape, belt, emblem] = ITEM_SILHOUETTES[item.id] || ['none', 'none', 'none', 'plain', base.cut === 'crystal' ? 'diamond' : 'sphere'];
  const look = item.look?.armor;
  return { ...base, pauldron, collar, cape, belt, emblem, ...look,
    body: look?.palette?.body ?? base.body, trim: look?.palette?.trim ?? base.trim, accent: look?.palette?.accent ?? base.accent };
}

export function removeArmorAppearance(model) {
  const meshes = [];
  model.traverse((o) => { if (o.userData.equippedArmor) meshes.push(o); });
  const materials = new Set();
  for (const mesh of meshes) { mesh.removeFromParent(); materials.add(mesh.material); }
  // 영웅 폐기도 재질 이벤트를 사용하므로 인스턴스 소유 지오메트리만 한 번 해제한다.
  for (const material of materials) if (!material.userData.armorDisposed) material.dispose();
  delete model.userData.armorAppearance;
}

// 기존 테마의 고유 윤곽을 보존하고 원본 몸체와 다운로드 자산을 교체하지 않는다.
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

const rounded = (w, h, d, r = .04) => new RoundedBoxGeometry(w, h, d, 2, r);

function polygon(points, depth = .025) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 3 });
}

function addSilhouette(style, add, body, trim, accent, broad) {
  const heavy = ['plate', 'crystal', 'scale', 'brigandine'].includes(style.cut);
  for (const side of [-1, 1]) {
    const bone = side < 0 ? 'upperarm.r' : 'upperarm.l';
    const label = side < 0 ? 'right' : 'left';
    const x = side * (.355 + broad / 3);
    const put = (part, geometry, material, position, scale = [1, 1, 1]) => add(`pauldron_${style.pauldron}_${label}_${part}`, bone, geometry, material, position, scale);
    if (style.pauldron === 'round') {
      put('shell', new THREE.SphereGeometry(1, heavy ? 10 : 12, 8), body, [x, 1.22, .005], [heavy ? .235 : .195, heavy ? .16 : .13, .205]);
      put('edge', rounded(heavy ? .31 : .25, .06, .39, .025), trim, [x + side * .04, 1.15, .005]);
    } else if (style.pauldron === 'spiked') {
      put('shell', rounded(.29, .13, .35), body, [x, 1.22, .005]);
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.ConeGeometry(.043, .14 + i * .018, 5);
        spike.rotateZ(-side * (.22 + i * .18));
        put(`spike_${i}`, spike, trim, [x + side * i * .06, 1.335, .055 - i * .06]);
      }
    } else if (style.pauldron === 'layered') {
      for (let i = 0; i < 3; i++) put(`layer_${i}`, rounded(.29 - i * .025, .095, .38 - i * .025, .025), i === 1 ? trim : body,
        [x + side * i * .063, 1.25 - i * .068, .005]);
    } else if (style.pauldron === 'wing') {
      const wing = polygon([[0, -.075], [side * .12, -.1], [side * .25, .08], [side * .12, .035], [side * .17, .17], [0, .08]]);
      put('fin', wing, trim, [x, 1.22, .04]);
      put('shell', rounded(.22, .1, .32), body, [x, 1.21, .005]);
    } else if (style.pauldron === 'fur') {
      for (let i = 0; i < 5; i++) put(`tuft_${i}`, new THREE.DodecahedronGeometry(.08), i % 2 ? trim : body,
        [x + side * (i - 2) * .035, 1.25 - Math.abs(i - 2) * .023, (i % 2 ? -.09 : .09)], [1, .8, 1]);
    }
    if (style.cut === 'crystal' && style.pauldron !== 'none') add(`crystal_inlay_${label}`, bone, new THREE.OctahedronGeometry(.09), accent, [x, 1.35, .03], [1, .75, 1]);
    if (heavy) add(`hip_tasset_${label}`, 'hips', rounded(.24, .28, .07, .035), body, [side * .18, .645, .309]);
  }
  // 후드는 얼굴을 덮는 모자가 아닌 목 뒤의 열린 카울로 해석한다.
  if (style.collar === 'high') {
    for (const side of [-1, 1]) add(`collar_high_${side}`, 'chest', rounded(.07, .145, .39, .02), trim, [side * .19, 1.315, -.015]);
    add('collar_high_back', 'chest', rounded(.4, .14, .07, .02), body, [0, 1.315, -.195]);
  } else if (style.collar === 'fur') {
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      add(`collar_fur_${i}`, 'chest', new THREE.DodecahedronGeometry(.07), trim, [Math.sin(angle) * .20, 1.285, Math.cos(angle) * .20], [1, .65, 1]);
    }
  } else if (style.collar === 'ring') {
    const ring = new THREE.TorusGeometry(.22, .025, 5, 16); ring.rotateX(Math.PI / 2);
    add('collar_ring', 'chest', ring, trim, [0, 1.285, .01], [1, 1, 1.1]);
  } else if (style.collar === 'hood') {
    const hood = new THREE.SphereGeometry(.235, 12, 8, 0, Math.PI);
    hood.rotateX(Math.PI / 2);
    add('collar_hood', 'chest', hood, body, [0, 1.285, -.08], [1, .48, 1]);
    add('collar_hood_edge', 'chest', rounded(.39, .035, .07, .015), trim, [0, 1.31, -.27]);
  }
  if (style.cape !== 'none') {
    const bottom = style.cape === 'short' ? .83 : .43;
    const outline = [[-.23, 1.255], [.23, 1.255], [.34, bottom]];
    if (style.cape === 'tattered') outline.push([.20, bottom + .09], [.12, bottom - .04], [0, bottom + .11], [-.11, bottom - .015], [-.22, bottom + .07]);
    outline.push([-.34, bottom]);
    add(`cape_${style.cape}`, 'chest', polygon(outline, .028), body, [0, 0, -.33]);
    for (const side of [-1, 1]) add(`cape_${style.cape}_clasp_${side}`, 'chest', new THREE.SphereGeometry(.035, 6, 4), accent, [side * .19, 1.255, -.345]);
  }
  if (style.belt === 'plain') {
    add('belt_plain', 'hips', rounded(.655 + broad, .095, .56, .035), body, [0, .765, .025]);
    add('belt_plain_buckle', 'hips', rounded(.145, .105, .045, .02), trim, [0, .765, .322]);
  } else if (style.belt === 'plates') {
    add('belt_plates_band', 'hips', rounded(.65 + broad, .085, .55), body, [0, .765, .025]);
    for (let i = 0; i < 5; i++) add(`belt_plates_${i}`, 'hips', rounded(.108, .115, .042, .015), trim, [(i - 2) * .122, .765, .318]);
  } else if (style.belt === 'sash') {
    add('belt_sash_wrap', 'hips', rounded(.66 + broad, .12, .56), accent, [0, .765, .025]);
    const tail = polygon([[-.055, .13], [.07, .13], [.095, -.20], [0, -.14], [-.07, -.24]]);
    add('belt_sash_tail', 'hips', tail, accent, [.15, .70, .327]);
    add('belt_sash_pin', 'hips', new THREE.OctahedronGeometry(.047), trim, [.15, .765, .355], [1, 1, .45]);
  } else if (style.belt === 'chain') {
    add('belt_chain_band', 'hips', rounded(.65 + broad, .065, .55), body, [0, .765, .025]);
    for (let i = 0; i < 9; i++) {
      const link = new THREE.TorusGeometry(.038, .009, 5, 10); link.rotateY(i % 2 ? .65 : -.65);
      add(`belt_chain_link_${i}`, 'hips', link, trim, [(i - 4) * .062, .76 - .025 * (1 - Math.abs(i - 4) / 4), .329]);
    }
  }
  let emblem;
  if (style.emblem === 'sphere') emblem = new THREE.SphereGeometry(.087, 8, 6);
  else if (style.emblem === 'diamond') emblem = new THREE.OctahedronGeometry(.10);
  else if (style.emblem === 'star') {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? .045 : .105;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    emblem = polygon(points);
  } else if (style.emblem === 'crest') emblem = polygon([[-.09, .08], [.09, .08], [.085, -.035], [0, -.11], [-.085, -.035]]);
  else if (style.emblem === 'skull') {
    emblem = polygon([[-.06, .08], [.06, .08], [.09, .035], [.065, -.045], [.035, -.055], [.035, -.09], [-.035, -.09], [-.035, -.055], [-.065, -.045], [-.09, .035]]);
    for (const side of [-1, 1]) add(`emblem_skull_eye_${side}`, 'chest', rounded(.026, .027, .013, .005), body, [side * .037, 1.097, .431]);
  }
  if (emblem) add(`emblem_${style.emblem}`, 'chest', emblem, accent, [0, 1.078, .399], [1, 1.1, style.emblem === 'sphere' || style.emblem === 'diamond' ? .3 : 1]);
}

export function applyArmorAppearance(model, hero, item) {
  removeArmorAppearance(model);
  if (!item || !['casual-v2', 'expedition-v3'].includes(model.userData.tllIdentity)) return;
  let skin;
  model.traverse((o) => { if (o.isSkinnedMesh && o.name.startsWith('TLL_') && !skin) skin = o; });
  if (!skin) return;
  const skeleton = skin.skeleton;
  const style = armorStyle(item, hero.id);
  const metal = ['plate', 'crystal', 'scale', 'chain', 'brigandine'].includes(style.cut);
  const body = new THREE.MeshStandardMaterial({ color: style.body, roughness: metal ? .46 : .88, metalness: metal ? .32 : 0 });
  const trim = new THREE.MeshStandardMaterial({ color: style.trim, roughness: .52, metalness: .25 });
  const accent = new THREE.MeshStandardMaterial({ color: style.accent, roughness: .38, metalness: .12 });
  for (const material of [body, trim, accent]) material.userData.armorSurface = true;
  applySurfaceDetail(body, metal ? 'metal' : 'cloth');
  applySurfaceDetail(trim, 'metal');
  const batches = new Map([body, trim, accent].map(material => [material, { geometries: [], parts: [], count: 0 }]));
  const add = (name, boneName, geometry, material, position, scale = [1, 1, 1]) => {
    const index = skeleton.bones.findIndex((b) => b.name.replaceAll('.', '') === boneName.replaceAll('.', ''));
    if (index < 0) { geometry.dispose(); return; }
    geometry.scale(...scale); geometry.translate(...position);
    // 서로 다른 본의 파츠도 재질별로 병합한다. 변형은 기존 스켈레톤이 담당한다.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const key of Object.keys(flat.attributes)) if (!['position', 'normal'].includes(key)) flat.deleteAttribute(key);
    if (!flat.attributes.normal) flat.computeVertexNormals();
    projectSurfaceUV(flat);
    const count = flat.attributes.position.count;
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { indices[i * 4] = index; weights[i * 4] = 1; }
    flat.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    flat.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const batch = batches.get(material);
    batch.parts.push({ name: `Armor_${name}`, bone: skeleton.bones[index].name, start: batch.count, count });
    batch.count += count; batch.geometries.push(flat);
  };
  const broad = hero.id === 'barbarian' ? .08 : 0;
  const soft = ['robe', 'leather', 'padded'].includes(style.cut);
  add(`cut_${style.cut}_cuirass`, 'chest', rounded(.63 + broad, soft ? .44 : .47, soft ? .59 : .62, soft ? .09 : .035), body, [0, 1.045, .04]);
  // 의상 개구부와 허리 솔기를 연결하는 연속 띠다.
  add('neck_binding', 'chest', rounded(.44, .055, .64, .02), trim, [0, 1.258, .04]);
  add('waist_binding', 'chest', rounded(.62 + broad, .075, .64, .025), trim, [0, .846, .04]);
  if (['scale', 'chain', 'padded', 'brigandine'].includes(style.cut)) {
    const tiles = [];
    const rows = style.cut === 'chain' ? 5 : 4;
    for (let row = 0; row < rows; row++) for (let column = 0; column < 5; column++) {
      let tile;
      if (style.cut === 'chain') tile = new THREE.TorusGeometry(.031, .007, 4, 8);
      else if (style.cut === 'padded') tile = rounded(.079, .072, .013, .012);
      else if (style.cut === 'brigandine') tile = rounded(.065, .05, .023, .005);
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
    if (style.cut === 'crystal') {
      for (const side of [-1, 1]) add(`cut_crystal_ridge_${side}`, 'chest', new THREE.OctahedronGeometry(.12), accent, [side * .20, 1.065, .354], [.65, 1.55, .4]);
    } else if (style.cut === 'leather') {
      const strap = rounded(.065, .43, .027, .01); strap.rotateZ(-.4);
      add('cut_leather_strap', 'chest', strap, accent, [0, 1.04, .355]);
    } else add(`cut_${style.cut}_seam`, 'chest', rounded(.028, .31, .018, .006), accent, [0, 1.045, .389]);
  }
  addSilhouette(style, add, body, trim, accent, broad);
  if (style.cut === 'robe') {
    add('robe_skirt', 'hips', new THREE.CylinderGeometry(.34, .48, .38, 12, 1, true), body, [0, .575, -.025], [1, 1, .87]);
    add('robe_hem', 'hips', new THREE.CylinderGeometry(.473, .49, .045, 12, 1, true), trim, [0, .398, -.025], [1, 1, .87]);
    add('robe_stole', 'hips', rounded(.17, .36, .035, .015), accent, [0, .575, .377]);
  }
  addThemeDetails(item.set, add, accent, trim);
  for (const [material, batch] of batches) {
    if (!batch.geometries.length) { material.dispose(); continue; }
    const geometry = mergeGeometries(batch.geometries);
    for (const part of batch.geometries) part.dispose();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `Armor_${material === body ? 'body' : material === trim ? 'trim' : 'accent'}`;
    mesh.userData.equippedArmor = item.id; mesh.userData.armorParts = batch.parts;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.position.copy(skin.position); mesh.quaternion.copy(skin.quaternion); mesh.scale.copy(skin.scale);
    mesh.bindMode = skin.bindMode; mesh.bind(skeleton, skin.bindMatrix);
    skin.parent.add(mesh);
    let disposed = false;
    material.addEventListener('dispose', () => {
      if (disposed) return;
      disposed = true; material.userData.armorDisposed = true;
      geometry.dispose(); mesh.removeFromParent();
    });
  }
  model.userData.armorAppearance = { itemId: item.id, ...style, identity: model.userData.tllIdentity };
}
