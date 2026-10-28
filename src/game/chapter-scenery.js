import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bellGeometry, extrude, piece, tombShape } from './chapter-dress.js';
import { mulberry32 } from './world.js';

// 장별 던전 환경 — 경로(던전) 조명·하늘은 그대로 두고, 장 색으로 대기를 물들이고 방 가장자리에 그 지역 소품을 깐다.
// 소품은 충돌 없는 장식이다. 방 벽 안쪽 띠(가장자리에서 0.8~1.8m)에만 놓고 회랑 문(gates) 근처는 비운다.
// 종류별 InstancedMesh 하나(정점색 병합 지오메트리)라 층 전체가 드로우콜 몇 개다.

/** 장 대기 보정: 경로 대기값(T)을 장 색 쪽으로 weight 만큼 섞는다. 1장은 청록·묘비 회색(WORLD_BIBLE 2장 표). */
export const CHAPTER_GRADES = Object.freeze({
  1: { weight: .55, fog: 0x15302c, bg: 0x0c1d1b, hemi: [0xb3d6cf, 0x18322c], torch: 0x86e1c5, tint: 0xb9cbc4 },
});

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
const KITS = Object.freeze({ 1: { kit: GARDEN_KIT, mix: [['tomb', .5], ['lilies', .35], ['bell', .15]], perRoom: 9 } });

let material = null;
function sceneryMaterial() {
  if (!material) { material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: .06 }); material.userData.sharedDress = true; }
  return material;
}
const kitCache = new Map();
function kitGeometry(ch, key) {
  const id = `${ch}|${key}`;
  if (!kitCache.has(id)) {
    const parts = KITS[ch].kit[key]();
    const g = mergeGeometries(parts, false); for (const p of parts) p.dispose(); g.computeBoundingSphere();
    kitCache.set(id, g);
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
    const mesh = new THREE.InstancedMesh(kitGeometry(ch, key), sceneryMaterial(), list.length);
    list.forEach((it, i) => mesh.setMatrixAt(i, m.compose(p.set(it.x, 0, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s))));
    mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = false; mesh.receiveShadow = true; mesh.computeBoundingSphere();
    mesh.name = `chapter-scenery-${key}`;
    group.add(mesh);
  }
  group.userData.dispose = () => { group.removeFromParent(); for (const c of group.children) c.dispose?.(); };
  return group;
}
