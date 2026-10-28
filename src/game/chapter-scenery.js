import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bellGeometry, extrude, piece, tombShape } from './chapter-dress.js';
import { mulberry32 } from './world.js';

// 장별 던전 환경 — 경로(던전) 조명·하늘은 그대로 두고, 장 색으로 대기를 물들이고 방 가장자리에 그 지역 소품을 깐다.
// 소품은 충돌 없는 장식이다. 방 벽 안쪽 띠(가장자리에서 0.8~1.8m)에만 놓고 회랑 문(gates) 근처는 비운다.
// 종류별 InstancedMesh 하나(정점색 병합 지오메트리)라 층 전체가 드로우콜 몇 개다.

/** 장 대기 보정: 경로 대기값(T)을 장 색 쪽으로 weight 만큼 섞는다. 1장은 청록·묘비 회색(WORLD_BIBLE 2장 표). */
export const CHAPTER_GRADES = Object.freeze({
  // 2장 용광로: 그을린 갈색·쇳물 주황. 한 장 안의 tribunal(분홍)·archive(파랑) 경로를 kiln 쪽으로.
  2: { weight: .7, fog: 0x261716, bg: 0x160d0d, hemi: [0xc99a7d, 0x311717], torch: 0xff7034, tint: 0xd8a28b, look: 'kiln', fogHorizon: 0xd35632 },
  // 3장 서리 도서관: 백지 흰색·서리 하늘색. archive 기준.
  3: { weight: .7, fog: 0x18263c, bg: 0x0e1727, hemi: [0xb8d8f2, 0x233752], torch: 0x86d7ff, tint: 0xb7cbed, look: 'archive', fogHorizon: 0x6f98ca },
  // 4장 별이 잠긴 심해: 남색·청록. beacon 기준.
  4: { weight: .7, fog: 0x0d3037, bg: 0x08212b, hemi: [0x80d2d2, 0x123643], torch: 0x4be6d2, tint: 0x9adbd1, look: 'beacon', fogHorizon: 0x55c4c2 },
  // 5장 새벽을 먹는 왕관: 새벽 보라·금. tribunal 기준에 금빛 횃불.
  5: { weight: .6, fog: 0x2a2139, bg: 0x171323, hemi: [0xd8c0e0, 0x342743], torch: 0xffd27a, tint: 0xd8c4d6, look: 'tribunal', fogHorizon: 0xc77da9 },
  // 6장 귀환로: 1장과 같은 귀환 청록(memorial)으로, 경로 색은 조금 더 남긴다. 7장은 모든 경로가 이미 belltower 대기라 보정 없음.
  6: { weight: .5, fog: 0x15302c, bg: 0x0c1d1b, hemi: [0xb3d6cf, 0x18322c], torch: 0x9ff0d8, tint: 0xbfd2ca, look: 'memorial', fogHorizon: 0x8ab9a9 },
  1: { weight: .7, fog: 0x15302c, bg: 0x0c1d1b, hemi: [0xb3d6cf, 0x18322c], torch: 0x86e1c5, tint: 0xb9cbc4, look: 'memorial', fogHorizon: 0x8ab9a9 },
});

/**
 * 화면 색 보정(렌더러 grade)과 안개 지평선도 장 기준으로 맞춘 전투 시각 프로필. 하늘·카메라·랜드마크는 경로 것을 유지한다.
 * @param {*} visual dungeonVisualFor 결과 @param {*} stage
 */
export function chapterVisual(visual, stage) {
  const grade = !stage || stage.expedition || stage.field ? null : CHAPTER_GRADES[stage.chapter?.id];
  if (!visual || !grade?.look) return visual;
  return Object.freeze({ ...visual, grade: grade.look, fogHorizon: grade.fogHorizon });
}

const _a = new THREE.Color(), _b = new THREE.Color();
const mixHex = (from, to, k) => _a.setHex(from).lerp(_b.setHex(to), k).getHex();

/**
 * 경로 대기값에 장 보정을 섞은 새 값. 해당 장 보정이 없으면 그대로 돌려준다.
 * @template {{ fog: number, bg: number, hemi: number[], torch: number, tint: number }} T
 * @param {T} atmosphere @param {number | null | undefined} chapterId
 * @returns {T}
 */
export function gradeAtmosphere(atmosphere, chapterId) {
  const grade = chapterId ? CHAPTER_GRADES[chapterId] : null;
  if (!grade) return atmosphere;
  const k = grade.weight;
  return {
    ...atmosphere,
    fog: mixHex(atmosphere.fog, grade.fog, k), bg: mixHex(atmosphere.bg, grade.bg, k),
    hemi: [mixHex(atmosphere.hemi[0], grade.hemi[0], k), mixHex(atmosphere.hemi[1], grade.hemi[1], k)],
    torch: mixHex(atmosphere.torch, grade.torch, k), tint: mixHex(atmosphere.tint, grade.tint, k),
  };
}

const C = { stone: 0x7f8985, stoneDark: 0x5d6663, moss: 0x4e7a63, lily: 0xf2f6ee, stem: 0x55836a, bronze: 0x7d6136, iron: 0x474d4f };

/** 1장 소품 지오메트리(높이 m 단위). */
const GARDEN_KIT = {
  // 이름 없는 묘비: 둥근 머리 석판 + 받침 + 이끼.
  tomb: () => [
    piece(extrude(tombShape(.62, 1.05), .16), C.stone, [0, .58, 0]),
    piece(new THREE.BoxGeometry(.8, .14, .3), C.stoneDark, [0, .07, 0]),
    piece(new THREE.SphereGeometry(.16, 6, 4), C.moss, [.2, .14, .1], [0, 0, 0], [1.4, .5, 1]),
  ],
  // 시들지 않는 흰 꽃 무더기.
  lilies: () => {
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2, r = .18 + (i % 2) * .12, x = Math.sin(a) * r, z = Math.cos(a) * r, h = .32 + (i % 3) * .08;
      parts.push(piece(new THREE.CylinderGeometry(.015, .018, h, 3), C.stem, [x, h / 2, z]));
      parts.push(piece(new THREE.ConeGeometry(.07, .12, 6), C.lily, [x, h + .02, z], [180, 0, 0]));
    }
    parts.push(piece(new THREE.SphereGeometry(.22, 6, 3), C.moss, [0, .02, 0], [0, 0, 0], [1.3, .3, 1.3]));
    return parts;
  },
  // 쓰러진 종추와 금 간 작은 종.
  bell: () => [
    piece(bellGeometry(.42, 10), C.bronze, [0, .3, 0], [0, 0, 78], [1, .7, 1]),
    piece(new THREE.CylinderGeometry(.05, .07, .9, 5), C.iron, [.55, .07, .25], [90, 30, 0]),
  ],
};
const F = { slag: 0x2a2421, slagDark: 0x1c1816, iron: 0x3d3f42, ironLight: 0x6a6c70, wood: 0x5a3b26, woodDark: 0x3a2618, clay: 0x8a5a3c, glow: 0xff8a3c, glowHot: 0xffc46a };
/** 2장 소품: 식은 쇳물 웅덩이, 빈 그릇이 놓인 식탁, 미완성 칼 걸이, 모루. 발광은 쇳물 주황 하나. */
const FORGE_KIT = {
  slag: () => ({
    solid: [piece(new THREE.CylinderGeometry(.9, 1.05, .08, 9), F.slag, [0, .04, 0], [0, 0, 0], [1, 1, .75]), piece(new THREE.DodecahedronGeometry(.2, 0), F.slagDark, [.55, .1, .2])],
    glow: [piece(new THREE.BoxGeometry(1.1, .02, .05), F.glow, [0, .085, 0], [0, 28, 0]), piece(new THREE.BoxGeometry(.6, .02, .04), F.glow, [.15, .085, .15], [0, -40, 0]), piece(new THREE.BoxGeometry(.45, .02, .04), F.glowHot, [-.25, .085, -.1], [0, 75, 0])],
  }),
  table: () => {
    const solid = [piece(new THREE.BoxGeometry(1.5, .1, .7), F.wood, [0, .72, 0])];
    for (const [x, z] of [[-.65, -.28], [.65, -.28], [-.65, .28], [.65, .28]]) solid.push(piece(new THREE.BoxGeometry(.08, .7, .08), F.woodDark, [x, .35, z]));
    // 빈 그릇 세 개(드라칸이 잃은 가족의 온기).
    for (const x of [-.45, 0, .45]) solid.push(piece(new THREE.CylinderGeometry(.13, .08, .09, 8, 1, true), F.clay, [x, .82, 0]));
    return solid;
  },
  rack: () => {
    const solid = [piece(new THREE.BoxGeometry(1.3, .08, .12), F.woodDark, [0, 1.15, 0]), piece(new THREE.BoxGeometry(.1, 1.2, .1), F.woodDark, [-.6, .6, 0]), piece(new THREE.BoxGeometry(.1, 1.2, .1), F.woodDark, [.6, .6, 0])], glow = [];
    for (const [i, x] of [-.35, 0, .35].entries()) {
      const len = .8 + i * .08;
      solid.push(piece(new THREE.BoxGeometry(.1, len, .02), F.ironLight, [x, 1.1 - len / 2, .02]));
      glow.push(piece(new THREE.BoxGeometry(.025, len * .55, .022), i === 1 ? F.glowHot : F.glow, [x + .045, 1.1 - len * .75, .02]));
    }
    return { solid, glow };
  },
  anvil: () => ({
    solid: [
      piece(new THREE.BoxGeometry(.55, .18, .3), F.iron, [0, .62, 0]), piece(new THREE.ConeGeometry(.12, .4, 6), F.iron, [.45, .62, 0], [0, 0, -90]),
      piece(new THREE.BoxGeometry(.28, .32, .22), F.iron, [0, .38, 0]), piece(new THREE.CylinderGeometry(.32, .38, .22, 8), F.woodDark, [0, .11, 0]),
      piece(new THREE.CylinderGeometry(.025, .025, .55, 5), F.woodDark, [-.1, .75, .1], [0, 0, 70]), piece(new THREE.BoxGeometry(.12, .1, .1), F.ironLight, [-.32, .82, .1]),
    ],
    glow: [piece(new THREE.BoxGeometry(.3, .02, .14), F.glow, [.05, .715, 0])],
  }),
};
const I = { ice: 0xa9d6ee, iceDark: 0x6d9ec0, paper: 0xf1f4f6, ink: 0x22344a, wood: 0x4a3a30, bookRed: 0x7a3a3a, bookBlue: 0x35507a, bookGreen: 0x3f6a52, glow: 0x9fe4ff };
/** 3장 소품: 책을 품은 얼음 기둥, 흩날린 백지, 서리 낀 서가. */
const FROST_KIT = {
  pillar: () => ({
    solid: [piece(new THREE.CylinderGeometry(.42, .5, 1.9, 6), I.ice, [0, .95, 0]), piece(new THREE.CylinderGeometry(.55, .6, .14, 6), I.iceDark, [0, .07, 0]), piece(new THREE.BoxGeometry(.32, .42, .1), I.bookBlue, [0, 1.05, .3], [0, 0, 18])],
    glow: [piece(new THREE.BoxGeometry(.28, .02, .02), I.glow, [0, 1.1, .36], [0, 0, 18]), piece(new THREE.ConeGeometry(.14, .5, 5), I.glow, [0, 2.1, 0])],
  }),
  pages: () => {
    const parts = [];
    for (let i = 0; i < 6; i++) { const a = i * 1.7, r = .2 + (i % 3) * .2; parts.push(piece(new THREE.BoxGeometry(.24, .006, .32), I.paper, [Math.sin(a) * r, .01 + i * .004, Math.cos(a) * r], [0, a * 40, (i % 2) * 6])); }
    return parts;
  },
  shelf: () => {
    const solid = [piece(new THREE.BoxGeometry(1.4, 1.6, .35), I.wood, [0, .8, -.05]), piece(new THREE.BoxGeometry(1.32, .04, .3), I.iceDark, [0, .55, .02]), piece(new THREE.BoxGeometry(1.32, .04, .3), I.iceDark, [0, 1.1, .02])];
    const colors = [I.bookRed, I.bookBlue, I.bookGreen, I.ink];
    for (const y of [.75, 1.3]) for (let i = 0; i < 8; i++) solid.push(piece(new THREE.BoxGeometry(.13, .34 - (i % 3) * .05, .24), colors[(i + (y > 1 ? 2 : 0)) % 4], [-.56 + i * .16, y - (i % 3) * .025, .03]));
    return { solid, glow: [piece(new THREE.BoxGeometry(1.42, .05, .38), I.glow, [0, 1.62, -.05])] };
  },
};
const D = { wood: 0x3e3226, woodDark: 0x2a221a, rust: 0x5e4232, iron: 0x3c4446, brass: 0x8a6e36, barnacle: 0xb9b4a2, kelp: 0x2a5444, glow: 0x58e0d2 };
/** 4장 소품: 가라앉은 배 늑골, 닻과 사슬, 꺼진 등대 렌즈. */
const DEEP_KIT = {
  ribs: () => {
    const solid = [piece(new THREE.BoxGeometry(2.2, .14, .2), D.woodDark, [0, .07, 0])];
    for (let i = 0; i < 4; i++) solid.push(piece(new THREE.TorusGeometry(.75 - i * .06, .06, 4, 8, Math.PI * .8), D.wood, [-.8 + i * .53, .05, 0], [0, 90, 100]));
    for (const x of [-.6, .3]) solid.push(piece(new THREE.CylinderGeometry(.05, .08, .06, 6), D.barnacle, [x, .16, .08]));
    return { solid, glow: [piece(new THREE.SphereGeometry(.06, 5, 3), D.glow, [.7, .12, .1])] };
  },
  anchor: () => {
    const solid = [piece(new THREE.BoxGeometry(.12, 1.1, .12), D.rust, [0, .05, 0], [0, 0, 80]), piece(new THREE.TorusGeometry(.38, .07, 4, 10, Math.PI), D.rust, [.5, .05, 0], [90, 0, 90]), piece(new THREE.TorusGeometry(.1, .03, 3, 8), D.rust, [-.6, .05, 0], [90, 0, 0])];
    for (let i = 0; i < 6; i++) solid.push(piece(new THREE.TorusGeometry(.07, .022, 3, 6), D.iron, [-.75 - i * .1, .03, Math.sin(i) * .12], [90, 0, i % 2 ? 90 : 0]));
    return solid;
  },
  lens: () => ({
    solid: [piece(new THREE.CylinderGeometry(.4, .46, .12, 8), D.brass, [0, .06, 0]), piece(new THREE.CylinderGeometry(.34, .34, .7, 8, 1, true), D.iron, [0, .45, 0]), piece(new THREE.ConeGeometry(.4, .3, 8), D.rust, [0, .95, 0]), piece(new THREE.CylinderGeometry(.06, .08, .9, 5), D.kelp, [.45, .45, .1], [0, 0, -12])],
    glow: [piece(new THREE.SphereGeometry(.2, 8, 5), D.glow, [0, .45, 0])],
  }),
};
const K = { stone: 0x6e6378, stoneDark: 0x4a4256, violet: 0x4a2f6a, gold: 0xd8b25a, goldDark: 0x9a7a34, steel: 0x8a8e94, bronze: 0x7d6136, glow: 0xffd27a };
/** 5장 소품: 빈 왕좌, 성벽에 꽂힌 검들, 끊긴 아침 종. */
const CROWN_KIT = {
  throne: () => ({
    solid: [piece(new THREE.BoxGeometry(.9, .2, .8), K.stoneDark, [0, .1, 0]), piece(new THREE.BoxGeometry(.8, .5, .7), K.stone, [0, .45, 0]), piece(new THREE.BoxGeometry(.8, 1.4, .14), K.stone, [0, 1.1, -.3]), piece(new THREE.BoxGeometry(.7, .9, .04), K.violet, [0, .95, -.22]), piece(new THREE.BoxGeometry(.86, .06, .2), K.gold, [0, 1.8, -.3]), piece(new THREE.ConeGeometry(.08, .25, 4), K.gold, [0, 1.95, -.3])],
    glow: [piece(new THREE.SphereGeometry(.06, 5, 3), K.glow, [0, 1.62, -.21])],
  }),
  swords: () => {
    const solid = [piece(new THREE.CylinderGeometry(.5, .6, .08, 8), K.stoneDark, [0, .04, 0])];
    for (let i = 0; i < 4; i++) { const a = i * 1.6, x = Math.sin(a) * .3, z = Math.cos(a) * .3, tilt = 8 + i * 5; solid.push(piece(new THREE.BoxGeometry(.07, .9, .02), K.steel, [x, .45, z], [tilt, a * 57, 0])); solid.push(piece(new THREE.BoxGeometry(.24, .04, .05), K.gold, [x, .92, z], [tilt, a * 57, 0])); }
    return solid;
  },
  bell: () => ({
    solid: [piece(bellGeometry(.5, 10), K.bronze, [0, .35, 0], [0, 0, 70], [1, .8, 1]), piece(new THREE.BoxGeometry(1.2, .12, .12), K.goldDark, [-.2, .06, .4], [0, 30, 0])],
    glow: [piece(new THREE.BoxGeometry(.04, .4, .02), K.glow, [.1, .45, .32], [0, 0, 20])],
  }),
};
const H = { wood: 0x5a4632, woodDark: 0x3a2c20, paper: 0xece6d4, rope: 0x8a7a5a, iron: 0x3e4446, brass: 0xa89060, glow: 0x9ff0d8, glowBrass: 0xffe0a0 };
/** 6장 소품: 이름표가 걸린 줄, 이어진 등대(불 켠 등 기둥). 1장 흰 꽃도 섞는다(귀환). */
const HOMECOMING_KIT = {
  tags: () => {
    const solid = [piece(new THREE.CylinderGeometry(.05, .06, 1.5, 5), H.woodDark, [-.7, .75, 0]), piece(new THREE.CylinderGeometry(.05, .06, 1.5, 5), H.woodDark, [.7, .75, 0]), piece(new THREE.CylinderGeometry(.012, .012, 1.4, 3), H.rope, [0, 1.35, 0], [0, 0, 90])];
    for (let i = 0; i < 5; i++) solid.push(piece(new THREE.BoxGeometry(.16, .22, .01), H.paper, [-.5 + i * .25, 1.17 - (i % 2) * .04, 0], [0, 0, (i - 2) * 5]));
    return { solid, glow: [0, 2, 4].map((i) => piece(new THREE.BoxGeometry(.08, .012, .012), H.glow, [-.5 + i * .25, 1.17 - (i % 2) * .04, .008])) };
  },
  lantern: () => ({
    solid: [piece(new THREE.CylinderGeometry(.06, .08, 1.8, 6), H.iron, [0, .9, 0]), piece(new THREE.BoxGeometry(.32, .04, .32), H.brass, [0, 1.8, 0]), piece(new THREE.ConeGeometry(.24, .2, 4), H.iron, [0, 2.15, 0], [0, 45, 0])],
    glow: [piece(new THREE.BoxGeometry(.24, .26, .24), H.glow, [0, 1.95, 0])],
  }),
  lilies: GARDEN_KIT.lilies,
};
const R = { bronze: 0x8a7046, bronzeDark: 0x5c4a2c, oak: 0x5a4430, paper: 0xece2c4, rope: 0x8a7a5a, glow: 0xffe0a0 };
/** 7장 소품: 금 간 종, 타종 명부 독서대, 바닥에 감긴 종 줄. */
const BELLTOWER_KIT = {
  bell: () => ({
    solid: [piece(bellGeometry(.6, 12), R.bronze, [0, 0, 0], [0, 0, 0], [1, .95, 1]), piece(new THREE.TorusGeometry(.14, .04, 4, 10), R.bronzeDark, [0, 1, 0])],
    glow: [piece(new THREE.BoxGeometry(.04, .6, .02), R.glow, [.18, .35, .45], [0, 20, 12]), piece(new THREE.BoxGeometry(.03, .25, .02), R.glow, [.1, .55, .48], [0, 20, -30])],
  }),
  ledger: () => ({
    solid: [piece(new THREE.CylinderGeometry(.06, .09, 1, 5), R.oak, [0, .5, 0]), piece(new THREE.BoxGeometry(.5, .04, .36), R.oak, [0, 1.02, 0], [-20, 0, 0]), piece(new THREE.BoxGeometry(.44, .03, .3), R.paper, [0, 1.05, .01], [-20, 0, 0])],
    glow: [piece(new THREE.BoxGeometry(.3, .006, .01), R.glow, [0, 1.075, .03], [-20, 0, 0])],
  }),
  rope: () => [0, 1, 2, 3].map((i) => piece(new THREE.TorusGeometry(.35 - i * .07, .04, 4, 12), R.rope, [0, .04 + i * .05, 0], [90, 0, i * 20])).concat([piece(new THREE.CylinderGeometry(.04, .04, .8, 4), R.rope, [.3, .4, .1], [0, 0, -30])]),
};
const KITS = Object.freeze({
  6: { kit: HOMECOMING_KIT, mix: [['tags', .35], ['lantern', .3], ['lilies', .35]], perRoom: 7 },
  7: { kit: BELLTOWER_KIT, mix: [['bell', .35], ['ledger', .3], ['rope', .35]], perRoom: 7 },
  5: { kit: CROWN_KIT, mix: [['throne', .3], ['swords', .45], ['bell', .25]], perRoom: 7 },
  4: { kit: DEEP_KIT, mix: [['ribs', .35], ['anchor', .35], ['lens', .3]], perRoom: 7 },
  3: { kit: FROST_KIT, mix: [['pillar', .35], ['shelf', .3], ['pages', .35]], perRoom: 8 },
  1: { kit: GARDEN_KIT, mix: [['tomb', .5], ['lilies', .35], ['bell', .15]], perRoom: 9 },
  2: { kit: FORGE_KIT, mix: [['slag', .3], ['rack', .25], ['anvil', .25], ['table', .2]], perRoom: 8 },
});

let material = null, glowMaterial = null;
function sceneryMaterials() {
  if (!material) {
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: .06 });
    glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    material.userData.sharedDress = glowMaterial.userData.sharedDress = true;
  }
  return [material, glowMaterial];
}
const kitCache = new Map();
/** 소품 지오메트리(불투명·발광). 키트 함수는 배열(불투명만) 또는 { solid, glow } 를 돌려준다. */
function kitGeometry(ch, key) {
  const id = `${ch}|${key}`;
  if (!kitCache.has(id)) {
    const built = KITS[ch].kit[key]();
    const { solid, glow = [] } = Array.isArray(built) ? { solid: built } : built;
    const merge = (parts) => { if (!parts.length) return null; const g = mergeGeometries(parts, false); for (const part of parts) part.dispose(); g.computeBoundingSphere(); return g; };
    kitCache.set(id, { solid: merge(solid), glow: merge(glow) });
  }
  return kitCache.get(id);
}

const nearGate = (gates, x, z) => gates.some((g) => Math.abs(x - g.x) < g.w / 2 + 2.2 && Math.abs(z - g.z) < g.h / 2 + 2.2);

/**
 * 방 가장자리 소품 배치(결정적). 문 근처를 피한다.
 * @param {{ rooms: any[], gates?: any[], seed?: number, floor?: number }} floor @param {number} ch
 * @returns {Record<string, { x: number, z: number, yaw: number, s: number, room: number }[]>}
 */
export function sceneryPlacements(floor, ch) {
  const spec = KITS[ch];
  if (!spec || !floor?.rooms?.length) return {};
  const random = mulberry32(((floor.seed || floor.floor || 1) * 2654435761) ^ (ch * 0x9e37));
  const out = Object.fromEntries(spec.mix.map(([k]) => [k, []]));
  for (const room of floor.rooms) {
    if (!(room.w > 6 && room.h > 6)) continue;
    for (let n = 0; n < spec.perRoom; n++) {
      // 네 변 중 하나를 고르고 변을 따라 위치, 안쪽으로 0.8~1.8m.
      const side = Math.floor(random() * 4), t = random() - .5, inset = .8 + random();
      const horizontal = side < 2;
      const x = horizontal ? room.x + t * (room.w - 3) : room.x + (side === 2 ? -1 : 1) * (room.w / 2 - inset);
      const z = horizontal ? room.z + (side === 0 ? -1 : 1) * (room.h / 2 - inset) : room.z + t * (room.h - 3);
      if (nearGate(floor.gates || [], x, z)) continue;
      let pick = random(), key = spec.mix[spec.mix.length - 1][0];
      for (const [k, w] of spec.mix) { if (pick < w) { key = k; break; } pick -= w; }
      // 벽을 등지게(방 중심을 바라보게) 세우고 조금씩 기울인다.
      const yaw = Math.atan2(room.x - x, room.z - z) + (random() - .5) * .5;
      out[key].push({ x, z, yaw, s: .8 + random() * .45, room: room.id });
    }
  }
  return out;
}

/**
 * 장 소품 그룹. 소유 자원은 인스턴스 메시뿐이고 지오메트리·재질은 공유한다.
 * @returns {THREE.Group | null}
 */
export function buildChapterScenery(floor, ch) {
  if (!KITS[ch]) return null;
  const placements = sceneryPlacements(floor, ch), group = new THREE.Group(); group.name = `chapter-scenery-${ch}`;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // 방 단위로 나눈 인스턴스 메시라 화면 밖 방은 프러스텀 컬링된다(층 전체 한 덩어리는 항상 그려진다 — arena.instanced 주석).
  const chunks = new Map();
  for (const [key, all] of Object.entries(placements)) for (const it of all) {
    const id = `${key}|${it.room}`;
    if (!chunks.has(id)) chunks.set(id, { key, list: [] });
    chunks.get(id).list.push(it);
  }
  for (const { key, list } of chunks.values()) {
    const geo = kitGeometry(ch, key), mats = sceneryMaterials();
    for (const [k, g] of [[0, geo.solid], [1, geo.glow]]) {
      if (!g) continue;
      const mesh = new THREE.InstancedMesh(g, mats[k], list.length);
      list.forEach((it, i) => mesh.setMatrixAt(i, m.compose(p.set(it.x, 0, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s))));
      mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = false; mesh.receiveShadow = !k; mesh.computeBoundingSphere();
      mesh.name = `chapter-scenery-${key}${k ? '-glow' : ''}`;
      group.add(mesh);
    }
  }
  group.userData.dispose = () => { group.removeFromParent(); for (const c of group.children) c.dispose?.(); };
  return group;
}
