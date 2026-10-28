import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHAPTER_DRESS, chapterDressFor } from '../data/chapter-dress.js';

// 장별 몬스터 의상 — 몸 색조·기본 발광과 뼈에 붙는 저폴리 소품(관·묘비 방패·종·촛불 관·꽃).
// 소품 하나는 정점색 병합 지오메트리 1~2개(불투명 + 발광)다. 지오메트리·재질은 소품 종류와 몸 키별로 공유하고,
// Actor.dispose 가 공유 재질을 지우지 않도록 userData.sharedDress 를 단다.
// 좌표: 소품은 '모델 공간 휴식 자세' 축(+Y 위, +Z 앞)으로 짓고, 붙는 뼈의 휴식 행렬 역으로 소켓을 맞춘다.
// 길이 단위는 몸 키(heightM)에 대한 비율이다(같은 소품이 슬라임·거인에게 같은 비율로 붙는다).

const _inv = new THREE.Matrix4(), _boneM = new THREE.Matrix4(), _want = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

const C = {
  wood: 0x4a3626, woodDark: 0x2f2219, cloth: 0x4f7d72, clothDark: 0x2c3b38, stone: 0x8f9894, stoneDark: 0x6c7471,
  bronze: 0x8b6a3c, bronzeDark: 0x5c4426, ivory: 0xe9e1c8, lily: 0xf4f7ef, leaf: 0x5f8f6a, iron: 0x4b5254,
  glowTeal: 0x8ff5dc, glowFlame: 0xfff1c2, glowName: 0x6fe0c4,
  paper: 0xf1f4f6, ice: 0xbfe6f7, iceDark: 0x7fb4d4, ink: 0x22344a, bookRed: 0x7a3a3a, bookBlue: 0x35507a, bookGreen: 0x3f6a52, glowFrost: 0x9fe4ff, glowWhite: 0xeefaff,
  seaWood: 0x4a3a2a, barnacle: 0xc9c3b0, coral: 0xd9785e, kelp: 0x2f5a46, rust: 0x6a4a36, brass: 0x9a7a3c, glowAbyss: 0x58e0d2, glowLure: 0xd8fff4,
  leather: 0x5b3a22, leatherDark: 0x3b2516, soot: 0x2b2826, steel: 0x6d7175, clay: 0x8a5a3c, glowEmber: 0xff8a3c, glowHot: 0xffc46a,
};

/** 정점색을 칠하고 위치·회전을 굽는다. */
export function piece(geometry, color, at = [0, 0, 0], rot = [0, 0, 0], scale = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
  const col = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  _e.set(THREE.MathUtils.degToRad(rot[0]), THREE.MathUtils.degToRad(rot[1]), THREE.MathUtils.degToRad(rot[2]));
  _want.compose(_p.set(at[0], at[1], at[2]), _q.setFromEuler(_e), scale ? new THREE.Vector3(...scale) : _s);
  g.applyMatrix4(_want);
  return g;
}

/** 관 실루엣(좁은 위·넓은 어깨·좁은 발) 외곽선을 두께만큼 돌출한다. */
function coffinShape(w, l) {
  const s = new THREE.Shape();
  s.moveTo(-w * .32, -l * .5); s.lineTo(w * .32, -l * .5); s.lineTo(w * .5, l * .22); s.lineTo(w * .36, l * .5);
  s.lineTo(-w * .36, l * .5); s.lineTo(-w * .5, l * .22); s.closePath();
  return s;
}
export function tombShape(w, l) {
  const s = new THREE.Shape();
  s.moveTo(-w * .5, -l * .5); s.lineTo(w * .5, -l * .5); s.lineTo(w * .5, l * .5 - w * .5);
  s.absarc(0, l * .5 - w * .5, w * .5, 0, Math.PI, false); s.closePath();
  return s;
}
export const extrude = (shape, depth) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, -depth / 2); return g; };
/** 종 단면을 돌려 만든다(입이 아래). 높이 1 기준. */
export function bellGeometry(r, segments = 10) {
  const pts = [[0, 1], [r * .35, .98], [r * .5, .82], [r * .58, .5], [r * .78, .18], [r, 0], [r * .9, -.03]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, segments); return g;
}

// 소품: bones 후보(앞이 우선) 또는 root(모델 원점=발밑 기준, 뼈 없는 슬라임·원령), at(몸 키 비율, 모델 축), rot(도), scale(배), build(h) → { solid: [], glow: [] }
const PROPS = {
  coffin: { bones: ['Spine2', 'Spine1', 'Spine', 'head'], at: [0, .02, -.12], rot: [-8, 0, 0], scale: 1.25, build: (h) => ({
    solid: [
      piece(extrude(coffinShape(.2 * h, .44 * h), .07 * h), C.wood),
      piece(new THREE.BoxGeometry(.21 * h, .025 * h, .075 * h), C.woodDark, [0, .1 * h, 0]),
      piece(new THREE.BoxGeometry(.21 * h, .025 * h, .075 * h), C.woodDark, [0, -.12 * h, 0]),
      // 어깨에 걸친 상복 끈 두 가닥.
      piece(new THREE.BoxGeometry(.025 * h, .2 * h, .08 * h), C.cloth, [.07 * h, .12 * h, .05 * h], [-25, 0, 0]),
      piece(new THREE.BoxGeometry(.025 * h, .2 * h, .08 * h), C.cloth, [-.07 * h, .12 * h, .05 * h], [-25, 0, 0]),
    ],
    glow: [piece(new THREE.BoxGeometry(.012 * h, .16 * h, .004 * h), C.glowName, [0, .02 * h, -.037 * h]), piece(new THREE.BoxGeometry(.09 * h, .012 * h, .004 * h), C.glowName, [0, .06 * h, -.037 * h])],
  }) },
  mourningHood: { bones: ['Head', 'head'], at: [0, .2, -.01], rot: [-6, 0, 0], scale: 2.2, build: (h) => ({
    solid: [
      piece(new THREE.ConeGeometry(.085 * h, .17 * h, 8, 1, true), C.cloth, [0, .02 * h, 0]),
      // 등 뒤로 늘어진 두건 자락.
      piece(new THREE.BoxGeometry(.13 * h, .2 * h, .012 * h), C.cloth, [0, -.1 * h, -.06 * h], [12, 0, 0]),
    ],
    glow: [],
  }) },
  darkHood: { bones: ['Head', 'head'], at: [0, .04, -.01], rot: [-8, 0, 0], build: (h) => ({
    solid: [
      piece(new THREE.ConeGeometry(.08 * h, .15 * h, 8, 1, true), C.clothDark, [0, .02 * h, 0]),
      piece(new THREE.BoxGeometry(.11 * h, .17 * h, .012 * h), C.clothDark, [0, -.09 * h, -.055 * h], [14, 0, 0]),
      // 팔에 감은 상장(喪章) 대신 목에 두른 청록 띠.
      piece(new THREE.TorusGeometry(.065 * h, .012 * h, 4, 10), C.cloth, [0, -.08 * h, 0], [90, 0, 0]),
    ],
    glow: [],
  }) },
  mourningVeil: { bones: ['Head', 'head'], at: [0, .19, -.02], rot: [-6, 0, 0], scale: 2.2, build: (h) => ({
    solid: [
      piece(new THREE.ConeGeometry(.09 * h, .14 * h, 10, 1, true), C.clothDark, [0, .03 * h, 0]),
      piece(new THREE.BoxGeometry(.18 * h, .32 * h, .012 * h), C.clothDark, [0, -.15 * h, -.07 * h], [10, 0, 0]),
      piece(new THREE.BoxGeometry(.02 * h, .1 * h, .01 * h), C.lily, [.05 * h, .08 * h, .03 * h], [0, 0, -30]),
    ],
    glow: [],
  }) },
  tombShield: { bones: ['Spine2', 'Spine1', 'Spine'], at: [.1, -.1, .17], rot: [-6, -14, 0], scale: 1.5, build: (h) => ({
    solid: [
      piece(extrude(tombShape(.2 * h, .32 * h), .045 * h), C.stone),
      piece(new THREE.BoxGeometry(.23 * h, .04 * h, .06 * h), C.stoneDark, [0, -.16 * h, 0]),
      piece(new THREE.SphereGeometry(.035 * h, 6, 4), C.leaf, [.06 * h, -.13 * h, .03 * h], [0, 0, 0], [1, .6, .7]),
    ],
    // 지워진 이름 자리: 희미하게 빛나는 긁힌 줄 세 개.
    glow: [-.01, .04, .09].map((y, i) => piece(new THREE.BoxGeometry((.11 - i * .02) * h, .01 * h, .004 * h), C.glowName, [0, y * h, .024 * h])),
  }) },
  candleCrown: { bones: ['Head', 'head'], at: [0, .25, 0], rot: [0, 0, 0], scale: 1.9, build: (h) => {
    const solid = [piece(new THREE.TorusGeometry(.07 * h, .012 * h, 4, 12), C.bronze, [0, 0, 0], [90, 0, 0])], glow = [];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2, x = Math.sin(a) * .07 * h, z = Math.cos(a) * .07 * h, tall = (.05 + (i % 2) * .025) * h;
      solid.push(piece(new THREE.CylinderGeometry(.011 * h, .012 * h, tall, 5), C.ivory, [x, tall / 2, z]));
      glow.push(piece(new THREE.ConeGeometry(.012 * h, .035 * h, 5), C.glowFlame, [x, tall + .016 * h, z]));
    }
    return { solid, glow };
  } },
  brokenBell: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .04, -.17], rot: [-15, 0, 12], scale: 1.7, build: (h) => ({
    solid: [
      piece(bellGeometry(.13 * h), C.bronze, [0, -.1 * h, 0], [0, 0, 0], [1, .24 * h, 1]),
      piece(new THREE.TorusGeometry(.03 * h, .008 * h, 4, 8), C.bronzeDark, [0, .15 * h, 0]),
      piece(new THREE.BoxGeometry(.18 * h, .02 * h, .02 * h), C.woodDark, [0, .07 * h, .06 * h], [0, 0, 20]),
    ],
    // 종 몸통의 금(빛나는 균열).
    glow: [piece(new THREE.BoxGeometry(.008 * h, .12 * h, .006 * h), C.glowName, [.04 * h, -.02 * h, .085 * h], [0, 0, 18])],
  }) },
  brokenBellLarge: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .05, -.2], rot: [-12, 0, -10], scale: 1.8, build: (h) => ({
    solid: [
      piece(bellGeometry(.17 * h, 12), C.bronze, [0, -.13 * h, 0], [0, 0, 0], [1, .32 * h, 1]),
      piece(new THREE.TorusGeometry(.04 * h, .01 * h, 4, 8), C.bronzeDark, [0, .2 * h, 0]),
      piece(new THREE.CylinderGeometry(.012 * h, .012 * h, .3 * h, 5), C.iron, [.08 * h, .03 * h, .05 * h], [0, 0, 70]),
    ],
    glow: [piece(new THREE.BoxGeometry(.01 * h, .17 * h, .006 * h), C.glowName, [.05 * h, -.03 * h, .11 * h], [0, 0, 16]), piece(new THREE.BoxGeometry(.01 * h, .08 * h, .006 * h), C.glowName, [.03 * h, .04 * h, .1 * h], [0, 0, -30])],
  }) },
  bellCrown: { bones: ['Head', 'head'], at: [0, .26, 0], rot: [0, 0, 0], scale: 2.1, build: (h) => {
    const solid = [piece(new THREE.CylinderGeometry(.085 * h, .075 * h, .04 * h, 10, 1, true), C.bronze)], glow = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, x = Math.sin(a) * .085 * h, z = Math.cos(a) * .085 * h;
      solid.push(piece(new THREE.ConeGeometry(.018 * h, .06 * h, 4), C.bronzeDark, [x, .045 * h, z]));
      solid.push(piece(bellGeometry(.025 * h, 6), C.bronze, [x, -.05 * h, z], [0, 0, 0], [1, .035 * h, 1]));
    }
    glow.push(piece(new THREE.TorusGeometry(.086 * h, .006 * h, 3, 18), C.glowTeal, [0, .02 * h, 0], [90, 0, 0]));
    return { solid, glow };
  } },
  funeralBanner: { bones: ['Spine2', 'Spine1', 'Spine'], at: [.09, .1, -.16], rot: [-6, 0, -6], scale: 1.6, build: (h) => ({
    solid: [
      piece(new THREE.CylinderGeometry(.008 * h, .008 * h, .62 * h, 5), C.woodDark, [0, .12 * h, 0]),
      piece(new THREE.BoxGeometry(.16 * h, .26 * h, .006 * h), C.clothDark, [-.085 * h, .27 * h, 0]),
      piece(new THREE.BoxGeometry(.16 * h, .03 * h, .008 * h), C.cloth, [-.085 * h, .41 * h, 0]),
    ],
    glow: [piece(new THREE.TorusGeometry(.03 * h, .005 * h, 3, 10), C.glowName, [-.085 * h, .28 * h, .005 * h])],
  }) },
  spiritBell: { root: true, at: [0, .32, .16], rot: [0, 0, 0], scale: 2.2, build: (h) => ({
    solid: [
      piece(bellGeometry(.06 * h, 8), C.bronze, [0, -.02 * h, 0], [0, 0, 0], [1, .09 * h, 1]),
      piece(new THREE.CylinderGeometry(.004 * h, .004 * h, .12 * h, 3), C.bronzeDark, [0, .12 * h, 0]),
    ],
    glow: [piece(new THREE.SphereGeometry(.018 * h, 6, 4), C.glowTeal, [0, -.035 * h, 0])],
  }) },
  spiritHalo: { root: true, at: [0, .98, -.04], rot: [90, 0, 0], scale: 1.5, build: (h) => ({
    solid: [],
    glow: [piece(new THREE.TorusGeometry(.16 * h, .008 * h, 3, 24), C.glowTeal)],
  }) },
  graveLilies: { root: true, at: [0, .86, 0], rot: [0, 0, 0], scale: 2.6, build: (h) => {
    const solid = [], glow = [];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + .4, x = Math.sin(a) * .06 * h, z = Math.cos(a) * .06 * h, tilt = 18 + i * 6;
      solid.push(piece(new THREE.CylinderGeometry(.005 * h, .006 * h, .1 * h, 3), C.leaf, [x, .03 * h, z], [Math.cos(a) * tilt, 0, -Math.sin(a) * tilt]));
      solid.push(piece(new THREE.ConeGeometry(.03 * h, .05 * h, 6, 1, false), C.lily, [x * 1.4, .095 * h, z * 1.4], [180 + Math.cos(a) * tilt, 0, -Math.sin(a) * tilt]));
      glow.push(piece(new THREE.SphereGeometry(.007 * h, 4, 3), C.glowFlame, [x * 1.4, .085 * h, z * 1.4]));
    }
    return { solid, glow };
  } },
  // ---- 2장 용광로: 멈추지 못한 장인 ----
  smithApron: { bones: ['Spine1', 'Spine', 'Spine2'], at: [0, -.06, .13], rot: [6, 0, 0], scale: 1.3, build: (h) => ({
    solid: [
      piece(new THREE.BoxGeometry(.24 * h, .3 * h, .018 * h), C.leather),
      piece(new THREE.BoxGeometry(.1 * h, .06 * h, .022 * h), C.leatherDark, [.05 * h, -.06 * h, .004 * h]),
      piece(new THREE.BoxGeometry(.25 * h, .02 * h, .02 * h), C.leatherDark, [0, .15 * h, 0]),
    ],
    // 쇳물이 튄 그을음 자국.
    glow: [piece(new THREE.SphereGeometry(.008 * h, 4, 3), C.glowEmber, [-.06 * h, -.08 * h, .012 * h]), piece(new THREE.SphereGeometry(.006 * h, 4, 3), C.glowEmber, [.03 * h, .05 * h, .012 * h])],
  }) },
  forgeHammerBack: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .03, -.15], rot: [0, 0, 35], scale: 1.15, build: (h) => ({
    solid: [piece(new THREE.CylinderGeometry(.012 * h, .014 * h, .42 * h, 6), C.woodDark), piece(new THREE.BoxGeometry(.15 * h, .08 * h, .08 * h), C.steel, [0, .22 * h, 0])],
    glow: [piece(new THREE.BoxGeometry(.012 * h, .07 * h, .07 * h), C.glowEmber, [.08 * h, .22 * h, 0])],
  }) },
  bellowsBack: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, 0, -.14], rot: [-10, 0, 0], scale: 1.4, build: (h) => ({
    solid: [
      piece(new THREE.CylinderGeometry(.11 * h, .03 * h, .2 * h, 4), C.leather, [0, 0, 0], [0, 45, 0], [1, 1, .35]),
      piece(new THREE.BoxGeometry(.16 * h, .012 * h, .05 * h), C.woodDark, [0, .1 * h, 0]),
      piece(new THREE.ConeGeometry(.02 * h, .08 * h, 5), C.steel, [0, -.14 * h, 0], [180, 0, 0]),
    ],
    glow: [piece(new THREE.SphereGeometry(.014 * h, 5, 3), C.glowEmber, [0, -.19 * h, 0])],
  }) },
  unfinishedBlades: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .05, -.15], rot: [-6, 0, 0], scale: 1.4, build: (h) => {
    const solid = [piece(new THREE.BoxGeometry(.2 * h, .03 * h, .04 * h), C.leatherDark, [0, -.08 * h, 0])], glow = [];
    for (const [i, a] of [-18, 0, 18].entries()) {
      const len = (.34 + i * .03) * h, r = THREE.MathUtils.degToRad(a), x = Math.sin(r) * len / 2, y = Math.cos(r) * len / 2 - .08 * h;
      solid.push(piece(new THREE.BoxGeometry(.035 * h, len, .008 * h), C.steel, [x, y, 0], [0, 0, -a]));
      glow.push(piece(new THREE.BoxGeometry(.01 * h, len * .5, .01 * h), i === 1 ? C.glowHot : C.glowEmber, [x * 1.5 + .015 * h, y + len * .2, 0], [0, 0, -a]));
    }
    return { solid, glow };
  } },
  unfinishedGreatsword: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .05, -.15], rot: [0, 0, -30], scale: 1.6, build: (h) => ({
    solid: [piece(new THREE.BoxGeometry(.07 * h, .5 * h, .012 * h), C.steel, [0, .1 * h, 0]), piece(new THREE.BoxGeometry(.18 * h, .025 * h, .03 * h), C.soot, [0, -.16 * h, 0]), piece(new THREE.CylinderGeometry(.014 * h, .014 * h, .12 * h, 5), C.leatherDark, [0, -.23 * h, 0])],
    glow: [piece(new THREE.BoxGeometry(.016 * h, .26 * h, .014 * h), C.glowEmber, [.03 * h, .22 * h, 0]), piece(new THREE.BoxGeometry(.02 * h, .05 * h, .014 * h), C.glowHot, [.025 * h, .33 * h, 0])],
  }) },
  anvilShield: { bones: ['Spine2', 'Spine1', 'Spine'], at: [.06, -.06, .17], rot: [0, -10, 0], scale: 1.4, build: (h) => ({
    solid: [
      piece(new THREE.BoxGeometry(.22 * h, .07 * h, .1 * h), C.soot, [0, .08 * h, 0]),
      piece(new THREE.ConeGeometry(.04 * h, .14 * h, 6), C.soot, [.17 * h, .08 * h, 0], [0, 0, -90]),
      piece(new THREE.BoxGeometry(.13 * h, .14 * h, .08 * h), C.soot, [0, -.03 * h, 0]),
      piece(new THREE.BoxGeometry(.2 * h, .04 * h, .1 * h), C.steel, [0, -.11 * h, 0]),
    ],
    glow: [piece(new THREE.BoxGeometry(.14 * h, .008 * h, .06 * h), C.glowEmber, [0, .118 * h, 0])],
  }) },
  emberWick: { bones: ['Head', 'head'], at: [0, .26, 0], rot: [0, 0, 12], scale: 1.6, build: (h) => ({
    solid: [piece(new THREE.CylinderGeometry(.006 * h, .008 * h, .1 * h, 4), C.soot, [0, .05 * h, 0])],
    glow: [piece(new THREE.SphereGeometry(.022 * h, 6, 4), C.glowHot, [0, .11 * h, 0]), piece(new THREE.ConeGeometry(.016 * h, .05 * h, 5), C.glowEmber, [0, .145 * h, 0])],
  }) },
  emberCap: { bones: ['Head', 'head'], at: [0, .24, 0], rot: [0, 0, 0], scale: 1.6, build: (h) => ({
    solid: [piece(new THREE.DodecahedronGeometry(.045 * h, 0), C.soot, [0, 0, 0]), piece(new THREE.DodecahedronGeometry(.032 * h, 0), C.soot, [.05 * h, -.01 * h, .02 * h]), piece(new THREE.DodecahedronGeometry(.028 * h, 0), C.soot, [-.045 * h, -.015 * h, -.015 * h])],
    glow: [piece(new THREE.SphereGeometry(.018 * h, 5, 3), C.glowEmber, [.012 * h, .03 * h, .02 * h]), piece(new THREE.SphereGeometry(.012 * h, 5, 3), C.glowHot, [-.03 * h, .012 * h, .02 * h])],
  }) },
  emberLantern: { bones: ['Head', 'head'], at: [0, .28, 0], rot: [0, 0, 0], scale: 1.8, build: (h) => ({
    solid: [piece(bellGeometry(.05 * h, 8), C.clay, [0, .055 * h, 0], [180, 0, 0], [1, .06 * h, 1]), piece(new THREE.TorusGeometry(.03 * h, .005 * h, 3, 8), C.soot, [0, .06 * h, 0], [90, 0, 0])],
    glow: [piece(new THREE.ConeGeometry(.02 * h, .06 * h, 5), C.glowHot, [0, .09 * h, 0]), piece(new THREE.SphereGeometry(.016 * h, 5, 3), C.glowEmber, [0, .068 * h, 0])],
  }) },
  emberChains: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .02, .05], rot: [0, 0, 35], scale: 1.4, build: (h) => {
    const solid = [], glow = [];
    for (let i = 0; i < 7; i++) {
      const y = (i - 3) * .045 * h;
      (i === 3 ? glow : solid).push(piece(new THREE.TorusGeometry(.02 * h, .006 * h, 3, 8), i === 3 ? C.glowEmber : C.steel, [0, y, .12 * h], [0, i % 2 ? 90 : 0, 0]));
    }
    solid.push(piece(new THREE.TorusGeometry(.1 * h, .012 * h, 4, 12), C.soot, [0, .17 * h, 0], [90, 0, -35]));
    return { solid, glow };
  } },
  crucibleCrown: { bones: ['Head', 'head'], at: [0, .26, 0], rot: [0, 0, 0], scale: 2.1, build: (h) => {
    const solid = [piece(new THREE.CylinderGeometry(.075 * h, .06 * h, .06 * h, 10, 1, true), C.soot)], glow = [piece(new THREE.CylinderGeometry(.07 * h, .07 * h, .006 * h, 10), C.glowEmber, [0, .022 * h, 0])];
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; solid.push(piece(new THREE.ConeGeometry(.014 * h, .06 * h, 4), C.soot, [Math.sin(a) * .075 * h, .055 * h, Math.cos(a) * .075 * h])); }
    glow.push(piece(new THREE.SphereGeometry(.012 * h, 5, 3), C.glowHot, [.03 * h, .03 * h, .03 * h]));
    return { solid, glow };
  } },
  // ---- 3장 거꾸로 흐르는 서리 도서관: 얼어붙은 증언 ----
  frozenPages: { root: true, at: [0, .55, 0], rot: [0, 0, 0], scale: 1.4, build: (h) => {
    const solid = [], glow = [];
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2, x = Math.sin(a) * .22 * h, z = Math.cos(a) * .22 * h, y = (i - 1) * .06 * h;
      solid.push(piece(new THREE.BoxGeometry(.09 * h, .12 * h, .003 * h), C.paper, [x, y, z], [10 * i, a * 57.3, 12 - i * 9]));
      glow.push(piece(new THREE.BoxGeometry(.06 * h, .006 * h, .004 * h), C.glowFrost, [x, y + .02 * h, z], [10 * i, a * 57.3, 12 - i * 9]));
    }
    return { solid, glow };
  } },
  openTome: { bones: ['Head', 'head'], at: [0, .3, .06], rot: [-35, 0, 0], scale: 1.8, build: (h) => ({
    solid: [
      piece(new THREE.BoxGeometry(.075 * h, .006 * h, .1 * h), C.paper, [-.04 * h, 0, 0], [0, 0, 12]),
      piece(new THREE.BoxGeometry(.075 * h, .006 * h, .1 * h), C.paper, [.04 * h, 0, 0], [0, 0, -12]),
      piece(new THREE.BoxGeometry(.17 * h, .005 * h, .11 * h), C.bookBlue, [0, -.008 * h, 0]),
    ],
    glow: [-.04, .04].flatMap((x) => [-.025, 0, .025].map((z) => piece(new THREE.BoxGeometry(.045 * h, .003 * h, .005 * h), C.glowFrost, [x * h, .006 * h, z * h], [0, 0, x < 0 ? 12 : -12]))),
  }) },
  shelfShield: { bones: ['Spine2', 'Spine1', 'Spine'], at: [.08, -.08, .17], rot: [-6, -12, 0], scale: 1.45, build: (h) => {
    const solid = [piece(new THREE.BoxGeometry(.24 * h, .3 * h, .025 * h), C.iceDark), piece(new THREE.BoxGeometry(.24 * h, .02 * h, .07 * h), C.ink, [0, 0, .02 * h])];
    const colors = [C.bookRed, C.bookBlue, C.bookGreen, C.ink, C.bookBlue];
    for (const [row, y] of [.07, -.08].entries()) colors.forEach((c, i) => solid.push(piece(new THREE.BoxGeometry(.035 * h, (.11 - (i % 2) * .02) * h, .05 * h), row ? colors[4 - i] : c, [(i - 2) * .042 * h, y * h, .028 * h])));
    return { solid, glow: [piece(new THREE.BoxGeometry(.25 * h, .008 * h, .03 * h), C.glowFrost, [0, .152 * h, .015 * h])] };
  } },
  bookStackBack: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .02, -.16], rot: [-8, 0, 6], scale: 1.4, build: (h) => {
    const colors = [C.bookRed, C.bookBlue, C.bookGreen, C.ink, C.bookBlue], solid = [];
    colors.forEach((c, i) => solid.push(piece(new THREE.BoxGeometry((.17 - i * .012) * h, .045 * h, .12 * h), c, [((i % 2) - .5) * .015 * h, (i - 2) * .047 * h, 0], [0, i * 7, 0])));
    solid.push(piece(new THREE.BoxGeometry(.02 * h, .26 * h, .13 * h), C.leatherDark, [0, 0, 0]));
    return { solid, glow: [piece(new THREE.BoxGeometry(.15 * h, .006 * h, .125 * h), C.glowFrost, [0, .12 * h, 0])] };
  } },
  censorSeal: { bones: ['Spine2', 'Spine1', 'Spine', 'head'], at: [0, .04, -.17], rot: [-12, 0, 0], scale: 1.5, build: (h) => ({
    solid: [piece(new THREE.CylinderGeometry(.09 * h, .1 * h, .05 * h, 10), C.iceDark, [0, -.06 * h, 0]), piece(new THREE.CylinderGeometry(.02 * h, .025 * h, .14 * h, 6), C.ink, [0, .04 * h, 0]), piece(new THREE.SphereGeometry(.035 * h, 6, 4), C.ink, [0, .12 * h, 0])],
    glow: [piece(new THREE.TorusGeometry(.065 * h, .006 * h, 3, 12), C.glowFrost, [0, -.087 * h, 0], [90, 0, 0]), piece(new THREE.BoxGeometry(.07 * h, .004 * h, .012 * h), C.glowFrost, [0, -.087 * h, 0])],
  }) },
  keyRing: { bones: ['Hips', 'Spine'], at: [.13, -.04, .06], rot: [0, 0, 0], scale: 1.5, build: (h) => {
    const solid = [piece(new THREE.TorusGeometry(.04 * h, .006 * h, 4, 10), C.iron)];
    for (let i = 0; i < 4; i++) {
      const a = -.6 + i * .4;
      solid.push(piece(new THREE.BoxGeometry(.012 * h, .09 * h, .006 * h), C.bronze, [Math.sin(a) * .04 * h, -.07 * h, 0], [0, 0, a * 57.3]));
      solid.push(piece(new THREE.TorusGeometry(.012 * h, .004 * h, 3, 6), C.bronze, [Math.sin(a) * .03 * h, -.035 * h, 0]));
    }
    return { solid, glow: [piece(new THREE.SphereGeometry(.008 * h, 4, 3), C.glowFrost, [0, -.04 * h, .004 * h])] };
  } },
  iceShards: { bones: ['Head', 'head'], at: [0, .24, 0], rot: [0, 0, 0], scale: 1.6, build: (h) => ({
    solid: [piece(new THREE.CylinderGeometry(.05 * h, .06 * h, .02 * h, 6), C.iceDark)],
    glow: [[0, .07, 0, 0], [.035, .05, .01, 22], [-.035, .045, -.01, -24], [.01, .04, -.035, -14]].map(([x, y, z, t]) => piece(new THREE.ConeGeometry(.018 * h, y * 2 * h, 4), C.glowFrost, [x * h, y * h, z * h], [t, 0, -t])),
  }) },
  iceShardsTop: { root: true, at: [0, .86, 0], rot: [0, 0, 0], scale: 2.2, build: (h) => ({
    solid: [],
    glow: [[0, .07, 0, 0], [.035, .05, .01, 22], [-.035, .045, -.01, -24], [.01, .04, -.035, -14]].map(([x, y, z, t]) => piece(new THREE.ConeGeometry(.018 * h, y * 2 * h, 4), C.glowFrost, [x * h, y * h, z * h], [t, 0, -t])),
  }) },
  iceQuillCrown: { bones: ['Head', 'head'], at: [0, .24, -.04], rot: [-10, 0, 0], scale: 1.8, build: (h) => {
    const solid = [], glow = [];
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 22;
      solid.push(piece(new THREE.ConeGeometry(.014 * h, .12 * h, 4), C.paper, [Math.sin(a / 57.3) * .06 * h, .05 * h, 0], [0, 0, -a], [1, 1, .3]));
      glow.push(piece(new THREE.SphereGeometry(.007 * h, 4, 3), C.glowFrost, [Math.sin(a / 57.3) * .115 * h, .105 * h, 0]));
    }
    return { solid, glow };
  } },
  iceCrown: { bones: ['Head', 'head'], at: [0, .27, 0], rot: [0, 0, 0], scale: 2.1, build: (h) => {
    const solid = [piece(new THREE.CylinderGeometry(.08 * h, .07 * h, .03 * h, 10, 1, true), C.iceDark)], glow = [];
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, tall = (.05 + (i % 2) * .04) * h; glow.push(piece(new THREE.ConeGeometry(.015 * h, tall, 4), i % 2 ? C.glowWhite : C.glowFrost, [Math.sin(a) * .078 * h, .015 * h + tall / 2, Math.cos(a) * .078 * h])); }
    return { solid, glow };
  } },
  // ---- 4장 별이 잠긴 심해: 조난 신호의 형체 ----
  anchorChain: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, -.02, -.15], rot: [0, 0, 20], scale: 1.4, build: (h) => {
    const solid = [
      piece(new THREE.BoxGeometry(.025 * h, .26 * h, .025 * h), C.rust, [0, .02 * h, 0]),
      piece(new THREE.TorusGeometry(.09 * h, .016 * h, 4, 10, Math.PI), C.rust, [0, -.1 * h, 0], [0, 0, 180]),
      piece(new THREE.ConeGeometry(.025 * h, .05 * h, 4), C.rust, [.09 * h, -.09 * h, 0], [0, 0, 30]),
      piece(new THREE.ConeGeometry(.025 * h, .05 * h, 4), C.rust, [-.09 * h, -.09 * h, 0], [0, 0, -30]),
      piece(new THREE.TorusGeometry(.03 * h, .008 * h, 3, 8), C.rust, [0, .16 * h, 0]),
    ];
    for (let i = 0; i < 4; i++) solid.push(piece(new THREE.TorusGeometry(.018 * h, .005 * h, 3, 6), C.iron, [.03 * h + i * .03 * h, .18 * h + i * .025 * h, .03 * h], [0, i % 2 ? 90 : 0, 40]));
    return { solid, glow: [piece(new THREE.SphereGeometry(.012 * h, 4, 3), C.glowAbyss, [.05 * h, -.12 * h, .02 * h])] };
  } },
  barnacles: { bones: ['Head', 'head'], at: [.03, .2, -.02], rot: [0, 0, 0], scale: 1.6, build: (h) => ({
    solid: [[0, 0, 0, .03], [.04, -.015, .02, .022], [-.035, -.01, .025, .02], [.01, -.02, -.04, .024]].flatMap(([x, y, z, r]) => [
      piece(new THREE.CylinderGeometry(r * .6 * h, r * h, r * 1.2 * h, 6, 1, true), C.barnacle, [x * h, y * h, z * h]),
    ]).concat([piece(new THREE.ConeGeometry(.015 * h, .07 * h, 4), C.coral, [-.05 * h, .02 * h, 0], [0, 0, 25])]),
    glow: [piece(new THREE.SphereGeometry(.01 * h, 4, 3), C.glowAbyss, [0, .012 * h, 0])],
  }) },
  barnaclesTop: { root: true, at: [0, .84, 0], rot: [0, 0, 0], scale: 2.6, build: (h) => ({
    solid: [[0, 0, 0, .03], [.04, -.015, .02, .022], [-.035, -.01, .025, .02], [.01, -.02, -.04, .024]].map(([x, y, z, r]) => piece(new THREE.CylinderGeometry(r * .6 * h, r * h, r * 1.2 * h, 6, 1, true), C.barnacle, [x * h, y * h, z * h])),
    glow: [piece(new THREE.SphereGeometry(.01 * h, 4, 3), C.glowAbyss, [0, .012 * h, 0])],
  }) },
  lureLamp: { bones: ['head', 'Head'], at: [0, .25, .06], rot: [0, 0, 0], scale: 1.8, build: (h) => ({
    solid: [piece(new THREE.CylinderGeometry(.005 * h, .008 * h, .14 * h, 4), C.kelp, [0, .06 * h, .02 * h], [25, 0, 0]), piece(new THREE.CylinderGeometry(.005 * h, .005 * h, .06 * h, 4), C.kelp, [0, .135 * h, .07 * h], [70, 0, 0])],
    // 가짜 등대 빛: 조난선을 부르는 미끼 등.
    glow: [piece(new THREE.SphereGeometry(.03 * h, 8, 5), C.glowLure, [0, .13 * h, .11 * h]), piece(new THREE.TorusGeometry(.04 * h, .004 * h, 3, 12), C.glowAbyss, [0, .13 * h, .11 * h])],
  }) },
  plankShield: { bones: ['Spine2', 'Spine1', 'Spine'], at: [.08, -.08, .17], rot: [-6, -12, 4], scale: 1.45, build: (h) => {
    const solid = [];
    for (let i = 0; i < 4; i++) solid.push(piece(new THREE.BoxGeometry(.06 * h, (.28 - (i % 2) * .04) * h, .02 * h), i % 2 ? C.seaWood : C.woodDark, [(i - 1.5) * .062 * h, (i % 2) * -.02 * h, 0], [0, 0, (i - 1.5) * 3]));
    solid.push(piece(new THREE.BoxGeometry(.26 * h, .025 * h, .03 * h), C.rust, [0, .07 * h, .012 * h]), piece(new THREE.BoxGeometry(.26 * h, .025 * h, .03 * h), C.rust, [0, -.07 * h, .012 * h]));
    for (const [x, y] of [[.07, .1], [-.08, -.03], [.02, -.11]]) solid.push(piece(new THREE.CylinderGeometry(.01 * h, .016 * h, .015 * h, 6), C.barnacle, [x * h, y * h, .016 * h], [90, 0, 0]));
    return { solid, glow: [piece(new THREE.SphereGeometry(.009 * h, 4, 3), C.glowAbyss, [-.05 * h, .1 * h, .016 * h])] };
  } },
  coralGrowth: { bones: ['Spine2', 'Spine1', 'Spine', 'head'], at: [.1, .1, -.04], rot: [0, 0, -15], scale: 1.6, build: (h) => {
    const solid = [], glow = [];
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 22, len = (.08 + (i % 2) * .04) * h, r = THREE.MathUtils.degToRad(a);
      solid.push(piece(new THREE.CylinderGeometry(.006 * h, .012 * h, len, 4), C.coral, [Math.sin(r) * len / 2, Math.cos(r) * len / 2, (i % 3) * .01 * h], [0, 0, -a]));
      glow.push(piece(new THREE.SphereGeometry(.008 * h, 4, 3), C.glowAbyss, [Math.sin(r) * len, Math.cos(r) * len, (i % 3) * .01 * h]));
    }
    return { solid, glow };
  } },
  glowPouches: { bones: ['Spine2', 'Spine1', 'Spine', 'head'], at: [0, 0, -.12], rot: [0, 0, 0], scale: 1.5, build: (h) => ({
    solid: [piece(new THREE.BoxGeometry(.18 * h, .02 * h, .02 * h), C.kelp, [0, .06 * h, 0])],
    glow: [[-.06, 0], [0, -.02], [.06, .005]].map(([x, y]) => piece(new THREE.SphereGeometry(.032 * h, 7, 5), C.glowAbyss, [x * h, y * h, -.01 * h], [0, 0, 0], [1, 1.25, 1])),
  }) },
  lighthouseLens: { bones: ['Head', 'head'], at: [0, .27, 0], rot: [0, 0, 0], scale: 1.9, build: (h) => ({
    solid: [piece(new THREE.CylinderGeometry(.05 * h, .06 * h, .02 * h, 8), C.brass), piece(new THREE.CylinderGeometry(.05 * h, .045 * h, .015 * h, 8), C.brass, [0, .085 * h, 0]), piece(new THREE.ConeGeometry(.05 * h, .04 * h, 8), C.rust, [0, .11 * h, 0])].concat([0, 1, 2, 3].map((i) => piece(new THREE.CylinderGeometry(.004 * h, .004 * h, .07 * h, 3), C.brass, [Math.sin(i * 1.57) * .045 * h, .045 * h, Math.cos(i * 1.57) * .045 * h]))),
    // 꺼진 등대의 마지막 렌즈 — 희미한 청록.
    glow: [piece(new THREE.SphereGeometry(.032 * h, 8, 5), C.glowAbyss, [0, .045 * h, 0])],
  }) },
  tideCrown: { bones: ['Head', 'head'], at: [0, .26, 0], rot: [0, 0, 0], scale: 2.1, build: (h) => {
    const solid = [piece(new THREE.CylinderGeometry(.08 * h, .07 * h, .03 * h, 10, 1, true), C.brass)], glow = [];
    for (const [x, t] of [[-.05, .08], [0, .12], [.05, .08]]) { solid.push(piece(new THREE.ConeGeometry(.012 * h, t * h, 4), C.brass, [x * h, .015 * h + t * h / 2, .06 * h])); glow.push(piece(new THREE.SphereGeometry(.01 * h, 4, 3), C.glowAbyss, [x * h, .02 * h, .075 * h])); }
    solid.push(piece(new THREE.TorusGeometry(.05 * h, .006 * h, 3, 8), C.iron, [0, -.02 * h, -.07 * h], [0, 90, 0]));
    return { solid, glow };
  } },
};
export const DRESS_PROP_KEYS = Object.freeze(Object.keys(PROPS));

let solidMaterial = null, glowMaterial = null;
function materials() {
  if (!solidMaterial) {
    solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: .08 });
    glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    solidMaterial.userData.sharedDress = glowMaterial.userData.sharedDress = true;
  }
  return [solidMaterial, glowMaterial];
}

const geometryCache = new Map();
/** 소품 지오메트리(불투명·발광)를 몸 키별로 한 번만 만든다. */
function propGeometry(key, h) {
  const id = `${key}|${h.toFixed(2)}`;
  let hit = geometryCache.get(id);
  if (!hit) {
    const built = PROPS[key].build(h);
    const merge = (list) => {
      if (!list.length) return null;
      const g = mergeGeometries(list, false);
      for (const part of list) part.dispose();
      g.computeBoundingSphere(); g.userData.sharedDress = true;
      return g;
    };
    hit = { solid: merge(built.solid), glow: merge(built.glow) };
    geometryCache.set(id, hit);
  }
  return hit;
}

/** 소품 몸 상대 삼각형 수(성능 예산 기록·테스트용). */
export function dressPropTriangles(key, h = 2) {
  const { solid, glow } = propGeometry(key, h);
  const tri = (g) => g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
  return tri(solid) + tri(glow);
}

function findBone(root, names) {
  for (const name of names) {
    const pattern = new RegExp(`^(?:mixamorig\\d*[:_]?)?${name}$`, 'i');
    let hit = null;
    root.traverse((o) => { if (!hit && o.isBone && pattern.test(o.name || '')) hit = o; });
    if (hit) return hit;
  }
  return null;
}

/**
 * 소품 하나를 뼈에 붙인다. 모델은 아직 애니메이션을 재생하기 전(휴식 자세)이어야 한다.
 * @returns {THREE.Group | null}
 */
export function attachDressProp(model, key, heightM) {
  const prop = PROPS[key];
  if (!prop) return null;
  const bone = prop.root ? model : findBone(model, prop.bones);
  if (!bone) return null;
  const h = heightM > 0 ? heightM : 2;
  model.updateWorldMatrix(true, true);
  // 뼈의 모델 공간 휴식 행렬. 모델 배율은 양변에서 지워지므로 등장 연출(배율 0.01)과 무관하다.
  if (prop.root) _boneM.identity();
  else { _inv.copy(model.matrixWorld).invert(); _boneM.multiplyMatrices(_inv, bone.matrixWorld); }
  _p.setFromMatrixPosition(_boneM).add(new THREE.Vector3(prop.at[0] * h, prop.at[1] * h, prop.at[2] * h));
  _e.set(THREE.MathUtils.degToRad(prop.rot[0]), THREE.MathUtils.degToRad(prop.rot[1]), THREE.MathUtils.degToRad(prop.rot[2]));
  _want.compose(_p, _q.setFromEuler(_e), new THREE.Vector3().setScalar(prop.scale || 1));
  const socket = new THREE.Group(); socket.name = `ChapterDress_${key}`;
  socket.matrix.copy(_boneM.invert().multiply(_want)); socket.matrixAutoUpdate = false;
  const [solidMat, glowMat] = materials(), geo = propGeometry(key, h);
  if (geo.solid) { const m = new THREE.Mesh(geo.solid, solidMat); m.castShadow = false; m.frustumCulled = false; socket.add(m); }
  if (geo.glow) { const m = new THREE.Mesh(geo.glow, glowMat); m.castShadow = false; m.frustumCulled = false; socket.add(m); }
  bone.add(socket);
  return socket;
}

const remapCache = new Map();
/**
 * 손그림 텍스처의 색상(hue) 범위를 장 팔레트로 옮긴 복제 텍스처. 밝기는 보존해 무늬·음영을 살린다.
 * hue 범위 안 픽셀은 mix, 밖은 baseMix 만큼 섞는다. 텍스처·팔레트별로 한 번만 만들고 공유한다(브라우저 전용).
 * @param {THREE.Texture} map @param {{ dark: string, light: string, hues: [number, number], mix: number, baseMix?: number }} remap
 */
export function remapTexture(map, remap) {
  const image = map?.image;
  if (!image || typeof document === 'undefined' || !(image.width > 0)) return null;
  const key = `${map.uuid}|${remap.dark}|${remap.light}|${remap.hues}|${remap.mix}|${remap.baseMix || 0}`;
  if (remapCache.has(key)) return remapCache.get(key);
  let texture = null;
  try {
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale)), h = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h), px = data.data;
    // 텍스처 바이트는 sRGB 이므로 팔레트도 '#rrggbb' 그대로 0~255 로 섞는다.
    const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const d = rgb(remap.dark), l = rgb(remap.light);
    const [h0, h1] = remap.hues, mix = remap.mix, base = remap.baseMix || 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
      let hue = 0;
      if (c > 0) hue = max === r ? 60 * (((g - b) / c) % 6) : max === g ? 60 * ((b - r) / c + 2) : 60 * ((r - g) / c + 4);
      if (hue < 0) hue += 360;
      // 채도가 낮은 픽셀(뼈·회색)은 범위 밖으로 본다.
      // h0 > h1 이면 360 을 넘어 감싸는 범위(예: 붉은색 [330, 40]).
      const inRange = c > 24 && (h0 <= h1 ? hue >= h0 && hue <= h1 : hue >= h0 || hue <= h1);
      const k = inRange ? mix : base;
      if (!k) continue;
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      px[i] = r + ((d[0] + (l[0] - d[0]) * lum) - r) * k;
      px[i + 1] = g + ((d[1] + (l[1] - d[1]) * lum) - g) * k;
      px[i + 2] = b + ((d[2] + (l[2] - d[2]) * lum) - b) * k;
    }
    ctx.putImageData(data, 0, 0);
    texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = map.magFilter; texture.minFilter = map.minFilter; texture.generateMipmaps = map.generateMipmaps;
    texture.flipY = map.flipY; texture.colorSpace = map.colorSpace; texture.wrapS = map.wrapS; texture.wrapT = map.wrapT;
    texture.channel = map.channel; texture.offset.copy(map.offset); texture.repeat.copy(map.repeat); texture.rotation = map.rotation; texture.center.copy(map.center);
    texture.anisotropy = map.anisotropy; texture.userData.sharedDress = true;
  } catch { texture = null; }
  // 실패는 캐시하지 않는다(일시적 읽기 실패가 그 몸을 영구히 단색 틴트로 고정하지 않게).
  if (texture) remapCache.set(key, texture);
  return texture;
}

/**
 * 전투 준비 중(로딩 화면) 그 장 의상의 텍스처 재배치를 미리 만든다. 첫 스폰 때 동기 픽셀 처리로 프레임이 끊기지 않게.
 * @param {*} stage @param {Record<string, any>} models app.models(모델 이름 → glTF) @param {Record<string, { model: string }>} enemies 적 정의
 */
export function prewarmChapterDress(stage, models, enemies) {
  if (!stage || stage.expedition) return 0;
  const table = CHAPTER_DRESS[stage.chapter?.id ?? stage.ch];
  if (!table) return 0;
  let made = 0;
  for (const [species, spec] of Object.entries(table.species)) {
    const gltf = spec.remap && models?.[enemies?.[species]?.model];
    gltf?.scene?.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.map && remapTexture(m.map, spec.remap)) made++; });
  }
  return made;
}

/**
 * 적에게 장 의상을 입힌다. 몸 재질(인스턴스 복제본)에 색조·기본 발광을 주고 소품을 붙인다.
 * @param {{ model: THREE.Object3D, mats: THREE.Material[], libraryAsset?: { id?: string, heightM?: number } | null, def?: any }} enemy
 * @param {*} stage @param {string} species
 * @returns {{ species: string, props: string[] } | null}
 */
export function dressEnemy(enemy, stage, species) {
  const spec = chapterDressFor(stage, species, enemy.libraryAsset?.id);
  if (!spec) return null;
  if (spec.remap) for (const m of enemy.mats) { const t = m.map && remapTexture(m.map, spec.remap); if (t) { m.map = t; m.needsUpdate = true; } }
  if (spec.color && spec.amount) { const c = new THREE.Color(spec.color); for (const m of enemy.mats) m.color?.lerp(c, spec.amount); }
  if (spec.emissive) { const c = new THREE.Color(spec.emissive); for (const m of enemy.mats) if (m.emissive) { m.userData.baseEmissive = c.clone(); m.emissive.copy(c); } }
  const props = [];
  for (const key of spec.props || []) if (attachDressProp(enemy.model, key, enemy.libraryAsset?.heightM)) props.push(key);
  return { species, props };
}
