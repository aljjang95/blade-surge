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
const KITS = Object.freeze({
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
