import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 자체 생성 12칸 원화의 큰 구조를 직접 모델링한다. 기존 입장·충돌 데이터는 읽기만 한다.
export const CITADEL_GATE_REFERENCE = 'citadel-gates-20261008';
export const CITADEL_GATE_DESIGNS = Object.freeze({
  glass_garden: 'crystal-greenhouse', ember_vault: 'armored-vault', star_archive: 'layered-star-library',
  bellfall_crypt: 'hanging-bell-mausoleum', cinder_tide_lock: 'valve-sluice',
  nightglass_observatory: 'armillary-observatory', eclipse_hydra_vault: 'three-headed-rib-maw',
  ashforge_catacomb: 'anvil-furnace', astral_leviathan_spire: 'leviathan-bone-spire',
  verdigris_sanctum: 'copper-leaf-sanctuary', sable_mirage_basin: 'sandstone-crescent',
  comet_bastion: 'meteor-battlement', campaign: 'oath-banner', arena: 'crossed-blade-arena',
});

const P = 1.27;
const COLORS = Object.freeze({
  ivory: 0xe1dfca, stone: 0x72898b, dark: 0x293842, iron: 0x45535e, bronze: 0xb98a48,
  gold: 0xd4b875, copper: 0xbb7650, glass: 0x65bda7, ice: 0x91cbe4, sapphire: 0x37628a,
  cyan: 0x91e6d7, ember: 0xffb25a, moss: 0x657568, obsidian: 0x2c3c46,
  jade: 0x468e75, sand: 0xc7ac80, violet: 0x74628d, bone: 0xcbd9cf,
});

/**
 * 정적인 14개 입구는 네 공유 재질만 쓰며 입구마다 역할별 버퍼를 병합한다.
 * @param {{ environmentTexture?: THREE.Texture | null, quality?: string }} [options]
 */
export function createCitadelGateDesignLibrary({ environmentTexture = null, quality = 'high' } = {}) {
  const materials = new Map(), geometries = new Set(), groups = new Set();
  let disposed = false;
  const segments = quality === 'low' ? 8 : 12;
  function material(role) {
    if (!materials.has(role)) {
      const next = role === 'glow'
        ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
        : new THREE.MeshStandardMaterial({ vertexColors: true,
          roughness: role === 'metal' ? .46 : role === 'crystal' ? .27 : .88,
          metalness: role === 'metal' ? .65 : role === 'crystal' ? .12 : .025 });
      if (environmentTexture && next.isMeshStandardMaterial) { next.envMap = environmentTexture; next.envMapIntensity = .32; }
      next.name = `Citadel_Gate_Shared_${role}`; materials.set(role, next);
    }
    return materials.get(role);
  }

  function build(spot) {
    if (disposed) throw new Error('폐기한 입구 라이브러리는 다시 사용할 수 없습니다.');
    const design = CITADEL_GATE_DESIGNS[spot.route];
    if (!design) throw new Error(`입구 디자인이 없는 경로: ${spot.route}`);
    const root = new THREE.Group(); root.name = `Citadel_Gate_${design}`;
    const bins = new Map(), transform = new THREE.Object3D(), tint = new THREE.Color();
    function add(source, role, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
      // Box/Circle과 비색인 Icosahedron을 혼합해도 같은 속성 계약으로 병합한다.
      const geometry = source.index ? source.toNonIndexed() : source;
      if (geometry !== source) source.dispose();
      geometry.deleteAttribute('uv');
      const count = geometry.getAttribute('position').count, colors = new Float32Array(count * 3);
      tint.setHex(color);
      for (let i = 0; i < count; i++) { colors[i * 3] = tint.r; colors[i * 3 + 1] = tint.g; colors[i * 3 + 2] = tint.b; }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      transform.position.set(x, y, z); transform.rotation.set(rx, ry, rz); transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      if (!bins.has(role)) bins.set(role, []); bins.get(role).push(geometry);
    }
    function block(w, h, d, role, color, x, y, z = 0, rz = 0) {
      const bevel = Math.min(.035, w * .09, h * .09, d * .09);
      const shape = new THREE.Shape(), a = w / 2 - bevel, b = h / 2 - bevel;
      shape.moveTo(-a, -b); shape.lineTo(a, -b); shape.lineTo(a, b); shape.lineTo(-a, b); shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * bevel, steps: 1,
        bevelEnabled: true, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel });
      geometry.translate(0, 0, -(d - 2 * bevel) / 2);
      add(geometry, role, color, x, y, z, 0, 0, rz);
    }
    function beam(a, b, width, depth, role, color, z = 0) {
      block(Math.hypot(b[0] - a[0], b[1] - a[1]), width, depth, role, color,
        (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
    function cylinder(r, h, role, color, x, y, z = 0, top = r) {
      add(new THREE.CylinderGeometry(top, r, h, segments), role, color, x, y, z);
    }
    function ring(r, tube, role, color, x, y, z = 0, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2) {
      add(new THREE.TorusGeometry(r, tube, 4, segments * 2, arc), role, color, x, y, z, rx, ry, rz);
    }
    function crystal(x, y, z, height, radius, color = COLORS.ice, rz = 0) {
      const shape = new THREE.LatheGeometry([new THREE.Vector2(0, -height / 2),
        new THREE.Vector2(radius * .7, -height * .2), new THREE.Vector2(radius, height * .13),
        new THREE.Vector2(0, height / 2)], 5);
      add(shape, 'crystal', color, x, y, z, 0, .3, rz);
    }
    function leaf(x, y, z, width, height, angle, color) {
      const shape = new THREE.Shape(); shape.moveTo(0, -height / 2);
      shape.lineTo(width / 2, height * .06); shape.lineTo(width * .24, height * .34);
      shape.lineTo(0, height / 2); shape.lineTo(-width * .24, height * .34);
      shape.lineTo(-width / 2, height * .06); shape.closePath();
      add(new THREE.ExtrudeGeometry(shape, { depth: .065, bevelEnabled: true,
        bevelThickness: .02, bevelSize: .025, bevelSegments: 1, steps: 1 }), 'metal', color, x, y, z, 0, 0, angle);
      const dx = -Math.sin(angle), dy = Math.cos(angle);
      beam([x - dx * height * .43, y - dy * height * .43],
        [x + dx * height * .39, y + dy * height * .39], .025, .035, 'metal', COLORS.gold, z + .085);
    }
    function arch(color, role = 'stone', y = 2.38, radius = P, thickness = .14) {
      ring(radius, thickness, role, color, 0, y, 0, 0, 0, 0, Math.PI);
    }
    function pointed(color, role = 'stone', top = 3.35, thickness = .16) {
      beam([-P, 2.45], [0, top], thickness, .3, role, color);
      beam([0, top], [P, 2.45], thickness, .3, role, color);
    }
    function posts(color, role = 'stone', round = false) {
      for (const side of [-1, 1]) {
        const x = side * P;
        if (round) cylinder(.225, 2.42, role, color, x, 1.21);
        else block(.43, 2.42, .32, role, color, x, 1.21);
        block(.46, .12, .31, role, color, x, .06);
        block(.45, .11, .32, 'metal', COLORS.bronze, x, .23);
        for (const y of [.58, 1.63, 2.34]) block(.45, .095, .32, 'metal', COLORS.bronze, x, y);
      }
    }
    function vent(x, color = COLORS.ember) {
      block(.23, .6, .04, 'glow', color, x, 1.1, .18);
      for (const offset of [-.08, 0, .08]) block(.027, .64, .035, 'metal', COLORS.iron, x + offset, 1.1, .208);
    }
    function wheel(x, y, radius, color = COLORS.bronze, z = .22) {
      ring(radius, .04, 'metal', color, x, y, z);
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        beam([x, y], [x + Math.cos(angle) * radius * .91, y + Math.sin(angle) * radius * .91],
          .045, .07, 'metal', color, z);
      }
      add(new THREE.SphereGeometry(.07, 6, 4), 'metal', COLORS.gold, x, y, z + .03);
    }

    switch (spot.route) {
      case 'glass_garden': {
        posts(COLORS.glass, 'crystal'); pointed(COLORS.bronze, 'metal', 3.7, .095);
        // 온실 지붕은 빈 아치 위에 얹힌 불투명 유리 면과 실제 격자다.
        const roof = new THREE.Shape(); roof.moveTo(-1.2, 2.65); roof.lineTo(0, 3.62); roof.lineTo(1.2, 2.65); roof.closePath();
        add(new THREE.ExtrudeGeometry(roof, { depth: .08, bevelEnabled: false }), 'crystal', COLORS.glass, 0, 0, -.18);
        block(2.6, .12, .36, 'metal', COLORS.bronze, 0, 2.55);
        for (const side of [-1, 1]) {
          beam([0, 2.59], [side * .67, 3.05], .045, .08, 'metal', COLORS.gold, .12);
          beam([side * .45, 2.58], [side * .7, 3.03], .04, .06, 'metal', COLORS.gold, .13);
          crystal(side * P, 2.94, 0, .65, .16, COLORS.cyan);
          crystal(side * 1.58, 2.77, 0, .45, .1, COLORS.glass, -side * .4);
        }
        break;
      }
      case 'ember_vault': {
        posts(COLORS.iron, 'metal');
        beam([-1.35, 2.5], [-.7, 3.38], .26, .47, 'metal', COLORS.dark);
        beam([-.7, 3.38], [.7, 3.38], .26, .47, 'metal', COLORS.iron);
        beam([.7, 3.38], [1.35, 2.5], .26, .47, 'metal', COLORS.dark);
        block(2.7, .21, .42, 'metal', COLORS.iron, 0, 2.56); wheel(0, 3.05, .45);
        for (const side of [-1, 1]) {
          vent(side * P); block(.59, .4, .45, 'metal', COLORS.dark, side * P, 2.73);
          block(.25, .25, .025, 'glow', COLORS.ember, side * P, 2.74, .241);
          cylinder(.15, .29, 'metal', COLORS.bronze, side * P, 3.06);
        }
        break;
      }
      case 'star_archive': {
        posts(COLORS.ivory);
        for (const side of [-1, 1]) {
          for (const y of [.55, 1.66]) {
            block(.38, .14, .32, 'stone', COLORS.sapphire, side * P, y);
            for (const dy of [-.025, .025]) block(.36, .012, .015, 'metal', COLORS.gold, side * P, y + dy, .17);
          }
          for (let i = 0; i < 3; i++) block(.72 - i * .12, .15, .48, 'stone', i % 2 ? COLORS.sapphire : COLORS.ivory, side * P, 2.49 + i * .17);
          crystal(side * P, 3.27, 0, .64, .12);
          crystal(side * 1.55, 2.95, 0, .4, .08);
        }
        pointed(COLORS.ivory, 'stone', 3.67, .14); pointed(COLORS.sapphire, 'crystal', 3.5, .07);
        for (const angle of [0, Math.PI / 2]) {
          crystal(0, 3.08, .18, .73, .12, COLORS.ice, angle);
        }
        break;
      }
      case 'bellfall_crypt': {
        posts(COLORS.moss); pointed(COLORS.stone, 'stone', 3.61, .19);
        for (const side of [-1, 1]) {
          for (const y of [.55, 1.14, 1.73]) block(.42, .035, .025, 'stone', COLORS.dark, side * P, y, .17);
          block(.62, .32, .44, 'stone', COLORS.moss, side * P, 2.63);
          cylinder(.21, side < 0 ? .47 : .61, 'stone', COLORS.stone, side * P, side < 0 ? 3.02 : 3.1, 0, .13);
          add(new THREE.ConeGeometry(.23, .3, 5), 'stone', COLORS.moss, side * P, side < 0 ? 3.42 : 3.57);
        }
        beam([0, 3.58], [0, 3.16], .055, .06, 'metal', COLORS.bronze, .12);
        cylinder(.3, .43, 'metal', COLORS.bronze, 0, 3.04, .1, .14);
        ring(.29, .035, 'metal', COLORS.gold, 0, 2.85, .1, Math.PI / 2);
        add(new THREE.SphereGeometry(.075, 6, 4), 'metal', COLORS.gold, 0, 2.71, .1);
        break;
      }
      case 'cinder_tide_lock': {
        posts(COLORS.iron, 'metal', true);
        for (const side of [-1, 1]) {
          cylinder(.095, 2.09, 'metal', COLORS.copper, side * P, 1.22, .15);
          block(.07, 1.77, .025, 'glow', COLORS.cyan, side * P - side * .13, 1.29, .17);
          wheel(side * P, 1.43, .15, COLORS.copper, .15);
          block(.61, .27, .46, 'metal', COLORS.iron, side * P, 2.56);
          ring(.16, .09, 'metal', COLORS.copper, side * 1.16, 2.75, 0, 0, 0, side > 0 ? 0 : Math.PI / 2, Math.PI / 2);
        }
        beam([-1.18, 2.91], [1.18, 2.91], .24, .3, 'metal', COLORS.copper);
        block(2.27, .055, .07, 'glow', COLORS.cyan, 0, 2.92, .17);
        wheel(0, 3.05, .4, COLORS.copper, .22);
        block(1.1, .085, .22, 'metal', COLORS.iron, 0, 3.51);
        break;
      }
      case 'nightglass_observatory': {
        posts(COLORS.sapphire); arch(COLORS.bronze, 'metal', 2.38, P, .065);
        for (const side of [-1, 1]) {
          block(.53, .2, .43, 'metal', COLORS.gold, side * P, 2.55);
          crystal(side * P, 2.96, 0, .45, .095);
        }
        ring(.42, .033, 'metal', COLORS.gold, 0, 3.28, .11);
        ring(.42, .027, 'metal', COLORS.bronze, 0, 3.28, .11, .45, .8);
        ring(.42, .026, 'metal', COLORS.gold, 0, 3.28, .11, 1.12, -.65);
        add(new THREE.IcosahedronGeometry(.23, 1), 'crystal', COLORS.ice, 0, 3.28, .11);
        beam([.7, 2.77], [.7, 3.01], .09, .11, 'metal', COLORS.bronze);
        add(new THREE.CylinderGeometry(.125, .09, .61, segments), 'metal', COLORS.bronze, .84, 3.13, 0, 0, 0, -1.1);
        ring(.1, .027, 'crystal', COLORS.sapphire, 1.11, 3.27, .06, .2, .6);
        break;
      }
      case 'eclipse_hydra_vault': {
        posts(COLORS.obsidian, 'stone', true); arch(COLORS.obsidian, 'stone', 2.35, P, .12);
        for (const side of [-1, 1]) {
          for (let i = 0; i < 4; i++) {
            const x = side * (1.18 - i * .17), y = 2.52 + i * .23;
            beam([x, y], [x - side * .16, y - .04], .15, .22, 'stone', COLORS.bone, .08);
          }
          crystal(side * P, 2.95, -.03, .85, .2, COLORS.obsidian, side * .47);
        }
        for (const [x, y, angle] of [[-.92, 3.05, .45], [0, 3.32, 0], [.92, 3.05, -.45]]) {
          add(new THREE.IcosahedronGeometry(.32, 0).scale(1, .72, 1), 'stone', COLORS.obsidian, x, y, .06, 0, 0, angle);
          block(.38, .13, .22, 'stone', COLORS.dark, x, y - .14, .25, angle);
          for (const side of [-1, 1]) {
            add(new THREE.SphereGeometry(.05, 6, 4), 'glow', COLORS.cyan, x + side * .12, y + .03, .31);
            crystal(x + side * .18, y + .29, 0, .38, .065, COLORS.obsidian, -side * .25);
          }
          crystal(x, y - .15, .34, .24, .055, COLORS.cyan, Math.PI);
        }
        break;
      }
      case 'ashforge_catacomb': {
        posts(COLORS.iron, 'metal');
        block(2.87, .3, .43, 'metal', COLORS.dark, 0, 2.62);
        block(1.04, .32, .43, 'metal', COLORS.iron, 0, 2.9);
        block(2.48, .28, .48, 'metal', COLORS.iron, 0, 3.15);
        for (const side of [-1, 1]) {
          beam([side * 1.12, 3.18], [side * 1.68, 3.31], .19, .4, 'metal', COLORS.iron);
          vent(side * P); cylinder(.17, side < 0 ? .63 : .46, 'metal', COLORS.dark, side * P, side < 0 ? 2.99 : 2.91);
          cylinder(.2, .085, 'metal', COLORS.bronze, side * P, side < 0 ? 3.33 : 3.17);
        }
        beam([-.15, 2.86], [.23, 3.58], .09, .17, 'metal', COLORS.bronze, .29);
        block(.65, .28, .23, 'metal', COLORS.gold, .24, 3.5, .29, -.35);
        break;
      }
      case 'astral_leviathan_spire': {
        posts(COLORS.bone); pointed(COLORS.sapphire, 'crystal', 3.43, .11);
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            beam([side * 1.32, 2.46 + i * .14], [side * (.78 - i * .16), 3.03 + i * .25], .1, .19, 'stone', COLORS.bone, -.1);
          }
          beam([side * 1.27, 2.45], [side * 1.61, 3.61], .085, .21, 'stone', COLORS.ivory, -.05);
          crystal(side * P, 3.18, .05, .6, .08);
          crystal(side * 1.61, 3.6, -.05, .27, .06);
        }
        crystal(0, 3.4, .14, .72, .16, COLORS.ice);
        break;
      }
      case 'verdigris_sanctum': {
        posts(COLORS.jade, 'stone', true); arch(COLORS.copper, 'metal', 2.36, P, .075);
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const x = side * (1.17 - i * .32), y = 2.69 + i * .22;
            leaf(x, y, .03, .49, .66, -side * (.6 + i * .18), i % 2 ? COLORS.jade : COLORS.copper);
          }
          beam([side * P, .3], [side * (P - .11), 2.35], .055, .08, 'metal', COLORS.copper, .15);
          beam([side * P, .35], [side * (P + .1), 2.38], .045, .08, 'metal', COLORS.bronze, -.1);
        }
        leaf(0, 3.27, 0, .49, .72, 0, COLORS.jade); crystal(0, 3.27, .14, .42, .11, COLORS.cyan);
        break;
      }
      case 'sable_mirage_basin': {
        posts(COLORS.sand); pointed(COLORS.sand, 'stone', 3.19, .19);
        for (const side of [-1, 1]) {
          block(.61, .3, .44, 'stone', COLORS.sand, side * P, 2.63);
          add(new THREE.ConeGeometry(.17, .55, 4), 'metal', COLORS.bronze, side * P, 3.03);
          block(.18, 1.36, .025, 'crystal', COLORS.violet, side * P, 1.35, .176);
        }
        ring(.46, .08, 'metal', COLORS.gold, 0, 3.25, .14, 0, 0, .67, Math.PI * 1.57);
        add(new THREE.IcosahedronGeometry(.29, 1).scale(1, 1, .35), 'crystal', COLORS.violet, 0, 3.25, -.02);
        break;
      }
      case 'comet_bastion': {
        posts(COLORS.stone); block(2.78, .3, .44, 'stone', COLORS.stone, 0, 2.69);
        for (const side of [-1, 1]) {
          block(.7, .51, .55, 'stone', COLORS.stone, side * P, 2.89);
          for (const offset of [-.23, 0, .23]) block(.14, .2, .51, 'stone', COLORS.stone, side * P + offset, 3.25);
          crystal(side * P, 1.31, .12, .73, .09);
          block(.29, .66, .04, 'metal', COLORS.sapphire, side * P, 1.96, .177);
          crystal(side * P, 2.11, .21, .27, .045);
        }
        crystal(0, 3.21, .09, 1.02, .33, COLORS.ice, -.18);
        break;
      }
      case 'campaign': {
        posts(COLORS.ivory); pointed(COLORS.ivory, 'stone', 3.43, .17);
        for (const side of [-1, 1]) {
          block(.43, .68, .05, 'stone', COLORS.sapphire, side * 1.6, 2.88, .07);
          beam([side * P, 2.49], [side * 1.81, 3.32], .04, .08, 'metal', COLORS.gold, .03);
        }
        crystal(0, 3.19, .15, .56, .21, COLORS.gold);
        ring(.26, .025, 'metal', COLORS.gold, 0, 3.18, .2);
        break;
      }
      case 'arena': {
        posts(COLORS.iron, 'metal'); block(2.65, .18, .32, 'metal', COLORS.bronze, 0, 2.51);
        for (const side of [-1, 1]) {
          beam([side * .62, 2.68], [-side * .62, 3.57], .12, .1, 'metal', COLORS.ivory, .08);
          beam([side * .71, 2.71], [side * .43, 2.47], .06, .13, 'metal', COLORS.gold, .1);
          block(.65, .23, .45, 'metal', COLORS.bronze, side * P, 2.61);
          crystal(side * P, 3.03, 0, .55, .1, COLORS.gold);
        }
        ring(.37, .055, 'metal', COLORS.gold, 0, 3.12, -.09);
        break;
      }
    }

    try {
      for (const [role, pieces] of bins) {
        const merged = mergeGeometries(pieces, false);
        if (!merged) throw new Error(`입구 geometry 병합 실패: ${spot.route}/${role}`);
        geometries.add(merged); merged.computeBoundingBox(); merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, material(role)); mesh.name = `Citadel_Gate_${role}`;
        mesh.castShadow = false; mesh.receiveShadow = role !== 'glow'; root.add(mesh);
      }
    } finally { for (const pieces of bins.values()) for (const piece of pieces) piece.dispose(); }
    root.userData = { designId: design, route: spot.route, reference: CITADEL_GATE_REFERENCE,
      batchCount: root.children.length, originalGeometry: true };
    groups.add(root); return root;
  }

  return {
    build,
    dispose() {
      if (disposed) return; disposed = true;
      for (const group of groups) group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const next of materials.values()) next.dispose();
      groups.clear(); geometries.clear(); materials.clear();
    },
  };
}
