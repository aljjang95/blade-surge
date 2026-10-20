import * as THREE from 'three';
import { mulberry32, ROOM_TYPE } from './world.js';
import { GARDEN_MAP_TACTICS } from '../data/map-tactics.js';
import { Pack, pickRoomPack, planRoomPacks, packSlot } from './pack-pursuit.js';
import { PACK_FOLLOWER } from './expedition-combat.js';
import { createGlowMaterial, createMatteMaterial } from '../engine/glass-garden-kit.js';

/**
 * 유리 정원 방 가장자리 장식. Blender 키트(glass-garden-kit-v1)를 방마다 한 번 병합해
 * 재질당 draw call 하나(방당 최대 2)로 그린다. 장식은 충돌·스폰·길찾기를 읽거나 바꾸지 않으며,
 * 아래 여유 규칙을 지키는 위치에만 놓는다. 위치는 층 시드에서만 나오고 층 난수·아레나 난수를 쓰지 않는다.
 */
export const GLASS_GARDEN_DECOR = Object.freeze({
  routeId: 'glass_garden',
  // 가장자리 띠: 보이는 벽(마스크 경계)에서 이 거리 안에 발자국 전체가 들어와야 한다. 스폰 여백(2.5)보다 작다.
  wallGap: .3, bandDepth: 2.45,
  doorMargin: 1.1,          // 입구(바깥 셀이 열린 벽 구간)에서 발자국 양옆으로 비우는 거리
  gateMargin: 2.5,          // 보스 봉인 사각형 주변
  pillarRadius: .8, torchRadius: 1.1, bannerRadius: 1.4, landmarkHalfWidth: 5.9, landmarkDepth: 5.4,
  propGap: .35,             // 장식끼리 최소 간격
  packClearance: .9,        // 무리 대형 자리(적 몸 반경 .6 + 여유)와 장식 발자국 사이 최소 거리
  // 유리 정원 방 명단 길이(기본·심층)와 졸개 비율은 expedition-combat.js의 expeditionRoster·expeditionFollowers를 따른다. test가 실제 명단과 대조한다.
  packRoster: Object.freeze({ normal: [6, 7], elite: [5, 5], treasure: [3, 4] }),
  packFollowerShare: Object.freeze({ normal: .85, elite: .7, treasure: .6 }),
  cameraSideMaxHeight: 1.55, // 카메라 쪽(남쪽) 띠에는 낮은 소품만
  maxTrianglesPerRoom: 7200,
});

// 키트 manifest의 실제 경계에서 잡은 발자국(미터). round: 반지름, rect: 벽 방향 반길이 × 벽에 수직 반깊이.
export const GLASS_GARDEN_PROPS = Object.freeze({
  'crystal-cluster-s': Object.freeze({ shape: 'round', radius: .56, height: .97, tris: 230, lod1: 92, spin: true, scale: [.9, 1.15] }),
  'crystal-cluster-l': Object.freeze({ shape: 'round', radius: 1.0, height: 2.0, tris: 334, lod1: 116, spin: true, scale: [.88, 1] }),
  'trellis-arch': Object.freeze({ shape: 'rect', half: 1.8, depth: .56, height: 3.84, tris: 777, lod1: 316 }),
  'planter-crystal': Object.freeze({ shape: 'round', radius: .72, height: 1.5, tris: 328, lod1: 120, spin: true, scale: [.92, 1.08] }),
  'moss-edging': Object.freeze({ shape: 'rect', half: 1.0, depth: .5, height: .76, tris: 288, lod1: 116 }),
  'hanging-lantern': Object.freeze({ shape: 'round', radius: .6, height: 2.42, tris: 287, lod1: 99, center: [.15, 0] }),
});

// 막힌 자리는 선호 위치에서 벽을 따라 가까운 순으로 옮겨 가며 찾는다(무리 대형·입구·기둥을 피해 비어 있는 구간을 쓴다).
const SHIFTS = Object.freeze(Array.from({ length: 41 }, (_, i) => (i % 2 ? 1 : -1) * Math.ceil(i / 2) * .7).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a));

// 앞면(+Z)이 방 안쪽을 보게 하는 Y축 회전. 북=-Z 벽, 남=+Z 벽(카메라 쪽).
const WALLS = Object.freeze({
  N: Object.freeze({ yaw: 0 }), S: Object.freeze({ yaw: Math.PI }),
  W: Object.freeze({ yaw: Math.PI / 2 }), E: Object.freeze({ yaw: -Math.PI / 2 }),
});

/** 기존 Arena가 방마다 두는 기둥·횃불 위치(arena.js의 hw/hh = 방 절반 - 1.6)와 같은 값. */
export function roomFixtures(room) {
  const hw = room.w / 2 - 1.6, hh = room.h / 2 - 1.6;
  const pillars = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ x: room.x + sx * hw, z: room.z + sz * hh }));
  const torches = [[-hw, 0], [hw, 0]].map(([ox, oz]) => ({ x: room.x + ox, z: room.z + oz }));
  const banners = room.type === ROOM_TYPE.BOSS ? [{ x: room.x - 5, z: room.z - room.h / 2 + .6 }, { x: room.x + 5, z: room.z - room.h / 2 + .6 }] : [];
  // mountLandmarks: 보스·정예·보물방 북쪽 중앙에 넓은 랜드마크.
  const landmark = !room.objectiveProp && [ROOM_TYPE.BOSS, ROOM_TYPE.ELITE, ROOM_TYPE.TREASURE].includes(room.type);
  return { pillars, torches, banners, landmark };
}

/** MapTactics가 정하는 조작판·당김 종착점(src/game/map-tactics.js와 같은 식). 장치방에서만 있다. */
export function tacticPoints(room) {
  if (room.id !== GARDEN_MAP_TACTICS.roomId) return [];
  return GARDEN_MAP_TACTICS.options.flatMap(option => {
    const x = room.x + option.side * Math.min(4.5, room.w * .25);
    return [{ x, z: room.z - 2.5 }, { x, z: room.z - .5 }];
  });
}

/** fillRect와 같은 셀 반올림으로 얻은 실제 보행 직사각형(보이는 벽 위치). */
export function walkableRect(floor, room) {
  const x0 = floor.minX + Math.floor(room.x - room.w / 2 - floor.minX), x1 = floor.minX + Math.ceil(room.x + room.w / 2 - floor.minX);
  const z0 = floor.minZ + Math.floor(room.z - room.h / 2 - floor.minZ), z1 = floor.minZ + Math.ceil(room.z + room.h / 2 - floor.minZ);
  return { x0, x1, z0, z1 };
}

const open = (floor, x, z) => {
  const mask = floor.architectureMask || floor.mask;
  const ix = Math.floor(x - floor.minX), iz = Math.floor(z - floor.minZ);
  return ix >= 0 && iz >= 0 && ix < floor.cols && iz < floor.rows && mask[iz * floor.cols + ix] === 1;
};

/** 소품의 바닥 발자국 표본점(월드 좌표). 모서리·변 중점·중심을 쓴다. */
export function footprintPoints(placement) {
  const spec = GLASS_GARDEN_PROPS[placement.asset], s = placement.scale || 1, points = [];
  const c = Math.cos(placement.yaw), n = Math.sin(placement.yaw);
  const at = (lx, lz) => points.push([placement.x + lx * c + lz * n, placement.z - lx * n + lz * c]);
  const [ox, oz] = spec.center || [0, 0];
  if (spec.shape === 'rect') {
    const hx = spec.half * s, hz = spec.depth * s;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) at(a * hx, b * hz);
  } else {
    const r = spec.radius * s;
    at(ox * s, oz * s);
    for (let i = 0; i < 8; i++) at(ox * s + Math.cos(i * Math.PI / 4) * r, oz * s + Math.sin(i * Math.PI / 4) * r);
  }
  return points;
}

/** 한 점에서 소품 발자국까지의 거리(안이면 0). */
export function footprintGap(placement, x, z) {
  const spec = GLASS_GARDEN_PROPS[placement.asset], s = placement.scale || 1, c = Math.cos(placement.yaw), n = Math.sin(placement.yaw);
  const dx = x - placement.x, dz = z - placement.z, lx = dx * c - dz * n, lz = dx * n + dz * c;
  if (spec.shape === 'rect') return Math.hypot(Math.max(0, Math.abs(lx) - spec.half * s), Math.max(0, Math.abs(lz) - spec.depth * s));
  const [ox, oz] = spec.center || [0, 0];
  return Math.max(0, Math.hypot(lx - ox * s, lz - oz * s) - spec.radius * s);
}

const reserveCache = new WeakMap();
/**
 * 운영 경로(planRoomPacks·packSlot)가 이 방에서 적을 세울 수 있는 모든 자리. 앵커는 진입 위치와 명단 수에 따라 고정 격자에서 고르므로
 * 입구 안쪽 지점·방 중심·2 m 격자를 진입 위치로, 영웅 위치는 3 m 격자로, 방 종류별 명단 길이 범위를 명단 수로 열거하고, 한 무리가 졸개까지 전부 받는 최악의 자리 수
 * (명단 + 졸개)만큼 나선 자리를 모은다. 진입 위치는 런타임에 정해지지만 이 집합은 층에서만 나오므로 결정적이다.
 * @returns {{x: number, z: number}[]}
 */
export function packSlotPoints(floor, room) {
  if (!floor?.inner || room.type === ROOM_TYPE.START || room.type === ROOM_TYPE.BOSS) return [];
  let byRoom = reserveCache.get(floor);
  if (!byRoom) reserveCache.set(floor, byRoom = new Map());
  if (byRoom.has(room.id)) return byRoom.get(room.id);
  const rect = walkableRect(floor, room), entries = new Map([[`${room.x}|${room.z}`, { x: room.x, z: room.z }]]);
  // 진입 위치: 입구에서 방 안쪽 0.5·2 m 지점 + 방 전체 2 m 격자(대시·밀림으로 문 밖 어디서든 들어올 수 있다고 본다).
  for (const [dx, dz] of wallOpenings(floor, rect)) {
    const len = Math.hypot(room.x - dx, room.z - dz) || 1;
    for (const depth of [.5, 2]) {
      const x = dx + (room.x - dx) / len * depth, z = dz + (room.z - dz) / len * depth;
      entries.set(`${Math.round(x)}|${Math.round(z)}`, { x, z });
    }
  }
  const heroes = [{ x: room.x, z: room.z }];
  for (let x = rect.x0 + 1; x < rect.x1; x += 2) for (let z = rect.z0 + 1; z < rect.z1; z += 2) entries.set(`${Math.round(x)}|${Math.round(z)}g`, { x, z });
  for (let x = rect.x0 + .5; x < rect.x1; x += 3) for (let z = rect.z0 + .5; z < rect.z1; z += 3) heroes.push({ x, z });
  // 진입 위치 × 영웅 위치(진입 직후 몇 걸음 안, 진입 지점들 또는 방 중심) × 명단 수마다 운영의 방 무리 선택(pickRoomPack, Battle.roomPackFor와 같은 함수)과 대형 자리(packSlot)를
  // 그대로 돌려 적이 설 수 있는 모든 자리를 모은다. 졸개(명단 뒤)까지 같은 방식으로 이어서 세운다.
  const [lo, hi] = GLASS_GARDEN_DECOR.packRoster[room.type] || [0, 0], share = GLASS_GARDEN_DECOR.packFollowerShare[room.type] || 0;
  const points = [], seen = new Set(), out = { x: 0, z: 0 };
  for (let count = lo; count <= hi && count > 0; count++) {
    const total = count + Math.max(PACK_FOLLOWER.min, Math.min(PACK_FOLLOWER.max, Math.round(count * share)));
    // 진입 위치마다 앵커 조합이 같은 경우가 대부분이라 조합별로 한 번만 돌린다(표본을 줄이지 않고 중복만 합친다).
    const layouts = new Map();
    for (const entry of entries.values()) {
      const planned = planRoomPacks(floor, room, count, entry.x, entry.z) || [];
      layouts.set(planned.map(pack => `${pack.x}|${pack.z}`).join(';'), planned);
    }
    for (const planned of layouts.values()) {
      for (const hero of heroes) {
        const fake = { packs: planned.map(pack => new Pack(room, pack.x, pack.z)), packCursor: 0 };
        for (let i = 0; i < total; i++) {
          const pack = pickRoomPack(fake, hero);
          packSlot(floor, pack, out);
          const key = `${Math.round(out.x * 20)}|${Math.round(out.z * 20)}`;
          if (!seen.has(key)) { seen.add(key); points.push({ x: out.x, z: out.z }); }
        }
      }
    }
  }
  byRoom.set(room.id, points);
  return points;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const radiusOf = (placement) => { const spec = GLASS_GARDEN_PROPS[placement.asset], s = placement.scale || 1; return (spec.shape === 'rect' ? Math.hypot(spec.half, spec.depth) : spec.radius + Math.hypot(...(spec.center || [0, 0]))) * s; };

/** 후보 하나가 모든 여유 규칙을 지키는지. 이유가 있으면 문자열, 통과하면 null. */
export function placementViolation(floor, room, placement, placed = []) {
  const D = GLASS_GARDEN_DECOR, spec = GLASS_GARDEN_PROPS[placement.asset], rect = walkableRect(floor, room);
  const s = placement.scale || 1, fix = roomFixtures(room);
  // 1) 발자국 전체가 이 방의 보행 직사각형 안, 보이는 벽에서 wallGap 이상·bandDepth 이하
  const edge = { N: p => p[1] - rect.z0, S: p => rect.z1 - p[1], W: p => p[0] - rect.x0, E: p => rect.x1 - p[0] }[placement.wall];
  for (const p of footprintPoints(placement)) {
    if (!open(floor, p[0], p[1])) return 'blocked';
    const d = edge(p);
    if (d < D.wallGap - 1e-6) return 'in-wall';
    if (d > D.bandDepth + 1e-6) return 'lane';
    // 옆 벽까지 (모서리 근처에서 두 벽 모두 gap 확보)
    if (p[0] < rect.x0 + D.wallGap || p[0] > rect.x1 - D.wallGap || p[1] < rect.z0 + D.wallGap || p[1] > rect.z1 - D.wallGap) return 'in-wall';
  }
  // 2) 입구: 벽 바깥 셀이 열린 구간(복도·열린 봉인)에서 발자국 반경 + doorMargin 이상 떨어진다.
  const r = radiusOf(placement);
  for (const door of wallOpenings(floor, rect)) if (Math.hypot(door[0] - placement.x, door[1] - placement.z) < r + D.doorMargin) return 'door';
  // 3) 보스 봉인 사각형
  for (const gate of floor.gates || []) {
    if (Math.abs(placement.x - gate.x) < gate.w / 2 + D.gateMargin + radiusOf(placement) && Math.abs(placement.z - gate.z) < gate.h / 2 + D.gateMargin + radiusOf(placement)) return 'gate';
  }
  // 4) 기존 방 장식: 기둥·횃불·깃발·랜드마크 영역
  // 보스방 기둥은 arena.js에서 1.25배로 놓는다.
  const pillarRadius = D.pillarRadius * (room.type === ROOM_TYPE.BOSS ? 1.25 : 1);
  for (const p of fix.pillars) if (distance(placement, p) < r + pillarRadius) return 'pillar';
  for (const t of fix.torches) if (distance(placement, t) < r + D.torchRadius) return 'torch';
  for (const b of fix.banners) if (distance(placement, b) < r + D.bannerRadius) return 'banner';
  if (fix.landmark && placement.wall === 'N' && Math.abs(placement.x - room.x) < D.landmarkHalfWidth + (spec.shape === 'rect' ? spec.half : spec.radius) * s) return 'landmark';
  if (fix.landmark && placement.z < rect.z0 + D.landmarkDepth && Math.abs(placement.x - room.x) < D.landmarkHalfWidth) return 'landmark';
  // 5) 환경 제어 장치(조작판·당김 종착점)는 방 안쪽에 있어 보통 띠와 겹치지 않지만, 규칙으로도 비운다.
  for (const point of tacticPoints(room)) if (distance(placement, point) < r + 2.2) return 'tactic';
  // 6) 카메라 쪽 띠에는 낮은 소품만
  if (placement.wall === 'S' && spec.height * s > D.cameraSideMaxHeight) return 'camera-side';
  // 7) 무리 대형: 진입·명단에 따라 운영 경로가 적을 세울 수 있는 어떤 자리와도 clearance 이상 떨어진다(값 비싼 검사라 마지막 전에).
  for (const point of packSlotPoints(floor, room)) if (footprintGap(placement, point.x, point.z) < D.packClearance) return 'pack';
  // 8) 장식끼리 겹침
  for (const other of placed) if (distance(placement, other) < r + radiusOf(other) + D.propGap) return 'overlap';
  return null;
}

/** 벽 바깥 .5m 셀이 열려 있는 지점들(.5m 간격). 입구의 중심선이 아니라 열린 구간 전체를 표본한다. */
export function wallOpenings(floor, rect) {
  const doors = [];
  for (let x = rect.x0 + .25; x < rect.x1; x += .5) {
    if (open(floor, x, rect.z0 - .5)) doors.push([x, rect.z0]);
    if (open(floor, x, rect.z1 + .5)) doors.push([x, rect.z1]);
  }
  for (let z = rect.z0 + .25; z < rect.z1; z += .5) {
    if (open(floor, rect.x0 - .5, z)) doors.push([rect.x0, z]);
    if (open(floor, rect.x1 + .5, z)) doors.push([rect.x1, z]);
  }
  return doors;
}

// 슬롯 표: 벽, 벽 방향 위치 u(벽 중앙 기준, 월드 +X/+Z 방향), 소품. 앞쪽이 우선하고, 자리가 막히면 u를 조금씩 옮겨 본다.
// 영웅이 방 중앙에 있을 때 화면 좌우 끝에 걸리는 동·서 벽에 키 큰 소품(아치·등·큰 수정)을 몰고,
// 남쪽(카메라 쪽) 벽에는 낮은 소품만 둔다.
function slotTable(room, rect, rand) {
  const fix = roomFixtures(room), halfW = (rect.x1 - rect.x0) / 2, halfH = (rect.z1 - rect.z0) / 2;
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const slots = [];
  const flip = () => (rand() < .5 ? -1 : 1);
  // 모서리 수정 군집: 기둥 옆 동·서 벽을 따라, 북쪽은 큰 것 남쪽은 작은 것.
  for (const wall of ['W', 'E']) {
    slots.push({ wall, u: -(halfH - 4.2), asset: 'crystal-cluster-l', must: true });
    slots.push({ wall, u: halfH - 4.2, asset: 'crystal-cluster-s', must: true });
  }
  // 동·서 벽(화면 좌우): 깨진 격자 아치, 걸이 등, 화분, 이끼 테두리
  for (const wall of ['W', 'E']) {
    const dir = flip();
    slots.push({ wall, u: dir * 6.9, asset: 'trellis-arch' });
    slots.push({ wall, u: -dir * 3.5, asset: 'hanging-lantern', must: true });
    slots.push({ wall, u: dir * 3.4, asset: 'planter-crystal' });
    slots.push({ wall, u: -dir * 6.0, asset: 'moss-edging' });
    slots.push({ wall, u: dir * 9.2, asset: 'moss-edging' });
    slots.push({ wall, u: -dir * 8.6, asset: 'planter-crystal' });
  }
  // 북쪽 벽: 아치(랜드마크 방은 랜드마크 바깥쪽), 걸이 등, 이끼 테두리
  const archU = fix.landmark ? 7.4 : 5.2 + rand() * .6;
  for (const sx of [-1, 1]) slots.push({ wall: 'N', u: sx * archU, asset: 'trellis-arch' });
  for (const sx of [-1, 1]) slots.push({ wall: 'N', u: sx * (halfW - 3.9), asset: 'hanging-lantern', must: true });
  for (const sx of [-1, 1]) slots.push({ wall: 'N', u: sx * (archU - 3.6), asset: 'moss-edging' });
  // 남쪽 벽(카메라 쪽): 낮은 소품만
  for (const sx of [-1, 1]) slots.push({ wall: 'S', u: sx * (halfW - 4.6), asset: 'crystal-cluster-s' });
  slots.push({ wall: 'S', u: flip() * 3.4, asset: 'planter-crystal' });
  for (const sx of [-1, 1]) {
    slots.push({ wall: 'S', u: sx * 8.4, asset: 'moss-edging' });
    slots.push({ wall: 'S', u: sx * 6.0, asset: 'moss-edging' });
  }
  return { slots, cx, cz };
}

/**
 * 층의 장식 배치 목록(순수 함수). 같은 층 시드 → 같은 배치.
 * 각 항목: { asset, roomId, wall, x, z, yaw, scale, tone }
 */
export function planGlassGardenDecor(floor) {
  if (!floor || floor.expeditionRouteId !== GLASS_GARDEN_DECOR.routeId || !floor.architectureMask) return [];
  const result = [];
  for (const room of floor.rooms) {
    if (room.objectiveProp || room.shape === 'disk') continue;
    const rand = mulberry32(((floor.seed | 0) ^ Math.imul(room.id + 1, 0x9e3779b1) ^ 0x6c077) >>> 0);
    const rect = walkableRect(floor, room);
    const { slots, cx, cz } = slotTable(room, rect, rand);
    const placed = [];
    let tris = 0;
    for (const slot of slots) {
      const spec = GLASS_GARDEN_PROPS[slot.asset], wall = WALLS[slot.wall];
      const jitter = rand(), skip = rand(), tone = rand();
      if (!slot.must && skip < .12) continue;
      const [lo, hi] = spec.scale || [1, 1];
      const scale = lo + (hi - lo) * jitter;
      const depthHalf = spec.shape === 'rect' ? spec.depth * scale : spec.radius * scale;
      // 보이는 벽에서 wallGap + 소품 반깊이만큼 들여 놓는다(+ 작은 변이). 발자국 끝은 bandDepth 안에 든다.
      const inset = GLASS_GARDEN_DECOR.wallGap + depthHalf + .06 + jitter * .1;
      let x, z;
      if (slot.wall === 'N') { x = cx + slot.u; z = rect.z0 + inset; }
      else if (slot.wall === 'S') { x = cx + slot.u; z = rect.z1 - inset; }
      else if (slot.wall === 'W') { x = rect.x0 + inset; z = cz + slot.u; }
      else { x = rect.x1 - inset; z = cz + slot.u; }
      const yaw = wall.yaw + (spec.spin ? (jitter - .5) * 1.4 : 0);
      if (tris + spec.tris > GLASS_GARDEN_DECOR.maxTrianglesPerRoom) continue;
      let accepted = null;
      for (const shift of SHIFTS) {
        const along = slot.wall === 'N' || slot.wall === 'S' ? { x: x + shift, z } : { x, z: z + shift };
        const placement = { asset: slot.asset, roomId: room.id, wall: slot.wall, ...along, yaw, scale, tone };
        if (!placementViolation(floor, room, placement, placed)) { accepted = placement; break; }
      }
      if (!accepted) continue;
      tris += spec.tris; placed.push(accepted); result.push(accepted);
    }
  }
  return result;
}

/**
 * 계획한 장식을 방별로 병합한 메시로 만든다. 방마다 matte/glow 두 메시(최대)이고,
 * 원본 템플릿 지오메트리는 읽기만 한다. quality가 'high'가 아니면 LOD1을 쓴다.
 * @param {any} floor
 * @param {{templates?: Map<string, any> | null, quality?: string, occlusion?: {bind(material: THREE.Material): void} | null, plan?: any[] | null}} [options]
 * @returns {THREE.Group}
 */
export function buildGlassGardenDecor(floor, { templates, quality = 'high', occlusion = null, plan = null } = {}) {
  const group = new THREE.Group(); group.name = 'GlassGardenDecor';
  const placements = plan || planGlassGardenDecor(floor);
  const owned = [], materials = [];
  let disposed = false;
  const stats = { placements: placements.length, meshes: 0, triangles: 0, rooms: 0, lod: quality === 'high' ? 0 : 1 };
  group.userData = { version: 'glass-garden-decor-v1', stats, placements, dispose() {
    if (disposed) return; disposed = true;
    group.removeFromParent();
    for (const geometry of owned) geometry.dispose();
    for (const material of materials) material.dispose();
  } };
  if (!templates || !placements.length) return group;
  const matte = createMatteMaterial(), glow = createGlowMaterial();
  materials.push(matte, glow);
  if (occlusion) { occlusion.bind(matte); occlusion.bind(glow); }
  const byRoom = new Map();
  for (const placement of placements) {
    if (!byRoom.has(placement.roomId)) byRoom.set(placement.roomId, []);
    byRoom.get(placement.roomId).push(placement);
  }
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0), normal = new THREE.Matrix3(), tmp = new THREE.Vector3();
  for (const [roomId, list] of byRoom) {
    stats.rooms++;
    for (const role of ['matte', 'glow']) {
      let vertexTotal = 0, indexTotal = 0;
      const parts = [];
      for (const placement of list) {
        const entry = templates.get(placement.asset), lod = quality === 'high' || !entry?.lod1 ? entry?.lod0 : entry.lod1;
        for (const geometry of lod?.[role] || []) { parts.push({ geometry, placement }); vertexTotal += geometry.getAttribute('position').count; indexTotal += geometry.index ? geometry.index.count : geometry.getAttribute('position').count; }
      }
      if (!parts.length) continue;
      const positions = new Float32Array(vertexTotal * 3), normals = new Float32Array(vertexTotal * 3), colors = new Float32Array(vertexTotal * 3);
      const indices = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
      let vertexAt = 0, indexAt = 0;
      for (const { geometry, placement } of parts) {
        const source = geometry.getAttribute('position'), sourceNormal = geometry.getAttribute('normal'), sourceColor = geometry.getAttribute('color');
        rotation.setFromAxisAngle(axis, placement.yaw);
        matrix.compose(position.set(placement.x, 0, placement.z), rotation, scale.setScalar(placement.scale || 1));
        normal.getNormalMatrix(matrix);
        // 석재·이끼는 같은 소품이 반복돼 보이지 않게 소품마다 밝기를 조금 달리한다(발광면은 그대로).
        const tint = role === 'matte' ? .92 + (placement.tone || 0) * .16 : 1;
        for (let i = 0; i < source.count; i++) {
          tmp.fromBufferAttribute(source, i).applyMatrix4(matrix).toArray(positions, (vertexAt + i) * 3);
          tmp.fromBufferAttribute(sourceNormal, i).applyMatrix3(normal).normalize().toArray(normals, (vertexAt + i) * 3);
          colors[(vertexAt + i) * 3] = sourceColor.getX(i) * tint; colors[(vertexAt + i) * 3 + 1] = sourceColor.getY(i) * tint; colors[(vertexAt + i) * 3 + 2] = sourceColor.getZ(i) * tint;
        }
        if (geometry.index) for (let i = 0; i < geometry.index.count; i++) indices[indexAt++] = geometry.index.getX(i) + vertexAt;
        else for (let i = 0; i < source.count; i++) indices[indexAt++] = vertexAt + i;
        vertexAt += source.count;
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      merged.setIndex(new THREE.BufferAttribute(indices, 1));
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      owned.push(merged);
      const mesh = new THREE.Mesh(merged, role === 'matte' ? matte : glow);
      mesh.name = `GlassGardenDecor_room${roomId}_${role}`; mesh.castShadow = false; mesh.receiveShadow = role === 'matte';
      mesh.userData.roomId = roomId;
      group.add(mesh); stats.meshes++; stats.triangles += indexTotal / 3;
    }
  }
  return group;
}
