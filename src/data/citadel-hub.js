import { ALL_DUNGEONS, DUNGEONS } from './expansion.js';
import { TOWNS } from './towns.js';

// One spatial contract is shared by the visible plaza and player collision.
export const CITADEL_HUB_BOUNDS = Object.freeze({ minX: -12, maxX: 12, minZ: -12, maxZ: 12 });
export const CITADEL_HUB_SPAWN = Object.freeze({ x: 0, y: 0, z: 3.6 });
export const CITADEL_HUB_ASSET_ROOT = '/models/citadel-hub-v1/';
export const CITADEL_HUB_PROPS = Object.freeze([
  ...[-1, 1].flatMap(side => [
    { id: `bench:${side}`, kind: 'bench', x: side * 6, z: -1.3, yaw: 0, asset: `${CITADEL_HUB_ASSET_ROOT}bench.glb` },
    { id: `planter:${side}`, kind: 'planter', x: side * 6, z: -4.8, yaw: 0, asset: `${CITADEL_HUB_ASSET_ROOT}planter.glb` },
  ]),
  ...[-1, 1].flatMap(xSide => [-1, 1].map(zSide => ({ id: `lamp:${xSide}:${zSide}`, kind: 'lamp',
    x: xSide * 11.7, z: zSide * 11.7, yaw: 0, asset: `${CITADEL_HUB_ASSET_ROOT}lamp.glb` }))),
  { id: 'merchant:stall', kind: 'stall', x: -6.4, z: 7.35, yaw: Math.PI, asset: `${CITADEL_HUB_ASSET_ROOT}stall.glb` },
].map(Object.freeze));

/** @type {Array<[number, number, number, string]>} */
const gatePlaces = [
  [-9, -10.7, 0, 'glass'], [-3, -10.7, 0, 'vault'], [3, -10.7, 0, 'star'], [9, -10.7, 0, 'bell'],
  [-10.7, -7.2, Math.PI / 2, 'valve'], [-10.7, -2.4, Math.PI / 2, 'orbit'],
  [-10.7, 2.4, Math.PI / 2, 'hydra'], [-10.7, 7.2, Math.PI / 2, 'anvil'],
  [10.7, -7.2, -Math.PI / 2, 'spire'], [10.7, -2.4, -Math.PI / 2, 'leaf'],
  [10.7, 2.4, -Math.PI / 2, 'crescent'], [10.7, 7.2, -Math.PI / 2, 'comet'],
];
const dungeonGates = DUNGEONS.slice(0, 12).map((d, i) => {
  const [x, z, yaw, emblem] = gatePlaces[i];
  return Object.freeze({
    id: `dungeon:${d.id}`, kind: 'dungeon', route: d.id, label: d.name,
    subtitle: d.subtitle, description: d.description, theme: d.theme, accent: d.accent,
    minLevel: d.minLevel, energy: d.energy, art: d.art, x, z, yaw, emblem,
    interactionRadius: 1.75, blockerRadius: 0, asset: `${CITADEL_HUB_ASSET_ROOT}gate-${d.id}.glb`,
  });
});

export const CITADEL_HUB_HOTSPOTS = Object.freeze([
  ...dungeonGates,
  Object.freeze({ id: 'gate:campaign', kind: 'campaign', route: 'campaign', label: '귀환 원정문', subtitle: 'CAMPAIGN',
    description: '캠페인에서 다음 이야기를 이어가세요.', accent: '#dec796', x: 0, z: 10.7, yaw: Math.PI,
    interactionRadius: 1.9, blockerRadius: 0, emblem: 'oath' }),
  Object.freeze({ id: 'gate:arena', kind: 'arena', route: 'arena', label: '결투장', subtitle: 'SOLO ARENA',
    description: 'AI 상대와 겨루는 무료 연습 결투장', accent: '#dca880', x: 7, z: 10.7, yaw: Math.PI,
    interactionRadius: 1.9, blockerRadius: 0, emblem: 'blades' }),
  Object.freeze({ id: 'npc:potion-merchant', kind: 'merchant', route: 'potions', label: '물약상 세라', subtitle: '물약 상점',
    description: '전투에서 번 골드로 물약을 준비하세요.', accent: '#9fdac2', x: -6.4, z: 5.4, yaw: 1.85,
    interactionRadius: 2, blockerRadius: .42, asset: `${CITADEL_HUB_ASSET_ROOT}merchant.glb`, model: 'Mage' }),
  Object.freeze({ id: 'npc:trainer', kind: 'trainer', route: 'build', label: '훈련사 이안', subtitle: '전투 준비',
    description: '장비와 전투 방식을 정비하세요.', accent: '#a6cbe0', x: -3.8, z: 8, yaw: 2.3,
    interactionRadius: 2, blockerRadius: .42, asset: `${CITADEL_HUB_ASSET_ROOT}alchemist.glb`, model: 'Rogue' }),
  Object.freeze({ id: 'npc:arena-steward', kind: 'steward', route: 'arena', label: '결투 안내관 로엔', subtitle: '결투장 안내',
    description: '연습 상대와 결투 조건을 확인하세요.', accent: '#dec796', x: 6.4, z: 5.4, yaw: -1.85,
    interactionRadius: 2, blockerRadius: .42, asset: `${CITADEL_HUB_ASSET_ROOT}arena-steward.glb`, model: 'Knight' }),
]);

const blockers = [];
for (const spot of CITADEL_HUB_HOTSPOTS) {
  if (spot.blockerRadius) blockers.push({ type: 'circle', x: spot.x, z: spot.z, radius: spot.blockerRadius });
  if (!['dungeon', 'campaign', 'arena'].includes(spot.kind)) continue;
  for (const side of [-1, 1]) blockers.push({ type: 'circle',
    x: spot.x + side * 1.27 * Math.cos(spot.yaw),
    z: spot.z - side * 1.27 * Math.sin(spot.yaw), radius: .29 });
}
// The vendor's table sits behind the merchant; central routes remain clear.
blockers.push({ type: 'rect', minX: -7.65, maxX: -5.15, minZ: 6.8, maxZ: 7.9 });
for (const prop of CITADEL_HUB_PROPS) {
  if (prop.kind === 'bench' || prop.kind === 'planter') blockers.push({ type: 'rect',
    minX: prop.x - 1, maxX: prop.x + 1, minZ: prop.z - .35, maxZ: prop.z + .35 });
  if (prop.kind === 'lamp') blockers.push({ type: 'circle', x: prop.x, z: prop.z, radius: .19 });
}
export const CITADEL_HUB_BLOCKERS = Object.freeze(blockers.map(Object.freeze));
export const CITADEL_HUB = Object.freeze({ bounds: CITADEL_HUB_BOUNDS, spawn: CITADEL_HUB_SPAWN,
  hotspots: CITADEL_HUB_HOTSPOTS, blockers: CITADEL_HUB_BLOCKERS });

export function citadelHotspot(id) { return CITADEL_HUB_HOTSPOTS.find(spot => spot.id === id) || null; }

// ===================== 마을 3곳 (계약 docs/towns/CONTRACT.md §2) =====================
// 기존 CITADEL_HUB* 상수는 서약의 성채(1번 마을)의 원형 그대로 두고, 마을별 장면은 아래 함수로 만든다.
export const CITADEL_TOWN_IDS = Object.freeze(['oathhold', 'emberport', 'starcrest']);

/** 마을 장면의 색·조명·하늘. oathhold 값은 기존 성채 광장과 같다. */
export const TOWN_THEMES = Object.freeze({
  oathhold: Object.freeze({
    id: 'oathhold', name: '서약의 성채', subtitle: 'OATHHOLD', mood: '맑은 청록빛 성채 광장', accent: '#dec796',
    gateLayout: 'north', waystone: 0x83e0c9,
    palette: Object.freeze({ stone: 0x455d65, slate: 0x3b535e, ivory: 0xd9d5c5, gold: 0xb69b68, shadow: 0x263e48, wood: 0x715e48, teal: 0x518b81 }),
    atmosphere: Object.freeze({ bg: 0x172c36, fog: 0x172c36, density: .017, hemi: [0x9dc6d7, 0x263f32], hemiI: .8,
      sun: 0xffdca9, sunI: 2.6, sunPos: [-8, 20, 14], rim: 0x83c9e0, rimI: 1.8 }),
  }),
  emberport: Object.freeze({
    id: 'emberport', name: '잿불 항구 마을', subtitle: 'EMBERPORT', mood: '노을 진 목재 부두와 등불', accent: '#ffad6e',
    gateLayout: 'east', waystone: 0xffa24a,
    palette: Object.freeze({ stone: 0x7b5a3d, slate: 0x694a33, ivory: 0xead0a6, gold: 0xe08f3c, shadow: 0x3a2923, wood: 0x57392a, teal: 0xc65a3b }),
    atmosphere: Object.freeze({ bg: 0x3a2330, fog: 0x6a4136, density: .016, hemi: [0xffc9a0, 0x3a2b33], hemiI: .95,
      sun: 0xff9c58, sunI: 3.1, sunPos: [-16, 11, 10], rim: 0xff7f4d, rimI: 1.5 }),
  }),
  starcrest: Object.freeze({
    id: 'starcrest', name: '별마루 설원 마을', subtitle: 'STARCREST', mood: '별빛 오로라가 내리는 설원', accent: '#9fd6ff',
    gateLayout: 'west', waystone: 0x8fe3ff,
    palette: Object.freeze({ stone: 0x86a3c4, slate: 0x6d8cb2, ivory: 0xd8e6f7, gold: 0x9fd6ff, shadow: 0x34496b, wood: 0x6a5850, teal: 0x62cfe6 }),
    atmosphere: Object.freeze({ bg: 0x0a1230, fog: 0x233a73, density: .014, hemi: [0x8aa6f0, 0x1a2646], hemiI: .8,
      sun: 0xaec6ff, sunI: 1.6, sunPos: [10, 22, 8], rim: 0x7fe8ff, rimI: 2.1 }),
  }),
});

/** 던전을 요구 레벨 순(동률은 목록 순서)으로 6개씩 나눈 계약 §1의 기본 배정. TownService가 주면 그 값이 우선한다. */
export function defaultTownDungeonIds(townId) {
  return TOWNS.find(town => town.id === townId)?.dungeonIds.slice() || [];
}
export function townOfDungeon(dungeonId) {
  return CITADEL_TOWN_IDS.find(id => defaultTownDungeonIds(id).includes(dungeonId)) || null;
}

const GATE_SLOTS = Object.freeze({
  north: [[-10, -10.7, 0], [-6, -10.7, 0], [-2, -10.7, 0], [2, -10.7, 0], [6, -10.7, 0], [10, -10.7, 0]],
  east: [[10.7, -10, -Math.PI / 2], [10.7, -6, -Math.PI / 2], [10.7, -2, -Math.PI / 2], [10.7, 2, -Math.PI / 2], [10.7, 6, -Math.PI / 2], [10.7, 10, -Math.PI / 2]],
  west: [[-10.7, -10, Math.PI / 2], [-10.7, -6, Math.PI / 2], [-10.7, -2, Math.PI / 2], [-10.7, 2, Math.PI / 2], [-10.7, 6, Math.PI / 2], [-10.7, 10, Math.PI / 2]],
});
const EMBLEMS = ['glass', 'vault', 'star', 'bell', 'valve', 'orbit', 'hydra', 'anvil', 'spire', 'leaf', 'crescent', 'comet', 'root', 'hollowbell', 'slag', 'drydock', 'aurora', 'crownfall'];
const townGate = (dungeon, x, z, yaw) => {
  const index = ALL_DUNGEONS.indexOf(dungeon);
  return Object.freeze({
    id: 'dungeon:' + dungeon.id, kind: 'dungeon', route: dungeon.id, label: dungeon.name,
    subtitle: dungeon.subtitle, description: dungeon.description, theme: dungeon.theme, accent: dungeon.accent,
    minLevel: dungeon.minLevel, energy: dungeon.energy, art: dungeon.art, x, z, yaw, emblem: EMBLEMS[index],
    interactionRadius: 1.75, blockerRadius: 0, asset: CITADEL_HUB_ASSET_ROOT + 'gate-' + dungeon.id + '.glb',
  });
};

// 상인·교관·이동석 자리는 세 마을이 같다(걷는 길을 그대로 유지). 이름·모델만 마을마다 다르다.
const TOWN_NPCS = Object.freeze({
  oathhold: { merchant: ['물약상 세라', 'Mage', '#9fdac2'], trainer: ['훈련사 이안', 'Rogue', '#a6cbe0'] },
  emberport: { merchant: ['선창 상인 도리', 'Barbarian', '#ffb27a'], trainer: ['부두 교관 하르', 'Ranger', '#ffc48f'] },
  starcrest: { merchant: ['설원 행상 미라', 'Ranger', '#bfe6ff'], trainer: ['별지기 교관 노아', 'Mage', '#a8c8ff'] },
});

const townNpcs = townId => {
  const [merchantName, merchantModel, merchantAccent] = TOWN_NPCS[townId].merchant;
  const [trainerName, trainerModel, trainerAccent] = TOWN_NPCS[townId].trainer;
  const legacy = townId === 'oathhold';
  return [
    Object.freeze({ id: 'npc:potion-merchant', kind: 'merchant', route: 'potions', label: merchantName, subtitle: '장비 · 소모품 상점',
      description: '이 마을에서만 파는 장비와 물약을 둘러보세요.', accent: merchantAccent, x: -6.4, z: 5.4, yaw: 1.85,
      interactionRadius: 2, blockerRadius: .42, model: merchantModel, ...(legacy ? { asset: CITADEL_HUB_ASSET_ROOT + 'merchant.glb' } : {}) }),
    Object.freeze({ id: 'npc:trainer', kind: 'trainer', route: 'build', label: trainerName, subtitle: '스킬 교관',
      description: '골드와 재료로 영웅의 새 기술을 배우세요.', accent: trainerAccent, x: -3.8, z: 8, yaw: 2.3,
      interactionRadius: 2, blockerRadius: .42, model: trainerModel, ...(legacy ? { asset: CITADEL_HUB_ASSET_ROOT + 'alchemist.glb' } : {}) }),
    Object.freeze({ id: 'npc:arena-steward', kind: 'steward', route: 'arena', label: '결투 안내관 로엔', subtitle: '결투장 안내',
      description: '연습 상대와 결투 조건을 확인하세요.', accent: '#dec796', x: 6.4, z: 5.4, yaw: -1.85,
      interactionRadius: 2, blockerRadius: .42, model: 'Knight', ...(legacy ? { asset: CITADEL_HUB_ASSET_ROOT + 'arena-steward.glb' } : {}) }),
  ];
};

const WAYSTONE = Object.freeze({ id: 'waystone:main', kind: 'waystone', route: 'town-map', label: '이동석', subtitle: '마을 이동',
  description: '이동석에 손을 얹어 다른 마을로 떠납니다.', accent: '#b9e6ff', x: 3.3, z: 8.5, yaw: 0,
  interactionRadius: 2, blockerRadius: .5 });

/** 마을별 소품 자리. 걷는 길(중앙 통로)은 비워 두고 기존 충돌 규칙을 그대로 쓴다. */
const townProps = townId => {
  const lamps = [-1, 1].flatMap(xSide => [-1, 1].map(zSide => ({ id: 'lamp:' + xSide + ':' + zSide, kind: 'lamp',
    x: xSide * 11.7, z: zSide * 11.7, yaw: 0, ...(townId === 'oathhold' ? { asset: CITADEL_HUB_ASSET_ROOT + 'lamp.glb' } : {}) })));
  const stall = { id: 'merchant:stall', kind: 'stall', x: -6.4, z: 7.35, yaw: Math.PI, ...(townId === 'oathhold' ? { asset: CITADEL_HUB_ASSET_ROOT + 'stall.glb' } : {}) };
  if (townId === 'oathhold') return CITADEL_HUB_PROPS;
  const pair = [-1, 1];
  const front = townId === 'emberport' ? 'barrels' : 'brazier', back = townId === 'emberport' ? 'crates' : 'crystal';
  return Object.freeze([
    ...pair.flatMap(side => [
      { id: front + ':' + side, kind: front, x: side * 6, z: -1.3, yaw: 0 },
      { id: back + ':' + side, kind: back, x: side * 6, z: -4.8, yaw: 0 },
    ]),
    ...lamps, stall,
  ].map(Object.freeze));
};

const townBlockers = (hotspots, props) => {
  const blockers = [];
  for (const spot of hotspots) {
    if (spot.blockerRadius) blockers.push({ type: 'circle', x: spot.x, z: spot.z, radius: spot.blockerRadius });
    if (!['dungeon', 'campaign', 'arena'].includes(spot.kind)) continue;
    for (const side of [-1, 1]) blockers.push({ type: 'circle',
      x: spot.x + side * 1.27 * Math.cos(spot.yaw), z: spot.z - side * 1.27 * Math.sin(spot.yaw), radius: .29 });
  }
  blockers.push({ type: 'rect', minX: -7.65, maxX: -5.15, minZ: 6.8, maxZ: 7.9 });
  for (const prop of props) {
    if (['bench', 'planter', 'crates', 'barrels', 'crystal'].includes(prop.kind)) blockers.push({ type: 'rect',
      minX: prop.x - 1, maxX: prop.x + 1, minZ: prop.z - .35, maxZ: prop.z + .35 });
    if (prop.kind === 'lamp') blockers.push({ type: 'circle', x: prop.x, z: prop.z, radius: .19 });
    if (prop.kind === 'brazier') blockers.push({ type: 'circle', x: prop.x, z: prop.z, radius: .5 });
  }
  return blockers.map(Object.freeze);
};

const dungeonOverrides = new Map(), hubCache = new Map();
/** TownService가 정한 마을별 던전 배정을 장면에 알린다(없으면 계약 기본 규칙). */
export function setTownDungeonIds(townId, ids) {
  if (!CITADEL_TOWN_IDS.includes(townId) || !Array.isArray(ids)) return;
  const next = ids.filter(id => ALL_DUNGEONS.some(dungeon => dungeon.id === id)).slice(0, 6);
  if (next.join() !== (dungeonOverrides.get(townId) || []).join()) { dungeonOverrides.set(townId, next); hubCache.delete(townId); }
}

/** 마을 하나의 걷기 데이터: 던전 게이트 6개 + 캠페인·결투장 + 상인·교관·안내관 + 이동석. */
export function townHub(townId) {
  if (!TOWN_THEMES[townId]) townId = 'oathhold';
  if (hubCache.has(townId)) return hubCache.get(townId);
  const theme = TOWN_THEMES[townId], ids = dungeonOverrides.get(townId) || defaultTownDungeonIds(townId);
  const slots = GATE_SLOTS[theme.gateLayout];
  const gates = ids.map((id, index) => townGate(ALL_DUNGEONS.find(dungeon => dungeon.id === id), ...slots[index]));
  const campaign = CITADEL_HUB_HOTSPOTS.find(spot => spot.kind === 'campaign'), arena = CITADEL_HUB_HOTSPOTS.find(spot => spot.kind === 'arena');
  const hotspots = Object.freeze([...gates, campaign, arena, ...townNpcs(townId), WAYSTONE]);
  const props = townProps(townId), blockers = Object.freeze(townBlockers(hotspots, props));
  const hub = Object.freeze({ townId, theme, bounds: CITADEL_HUB_BOUNDS, spawn: CITADEL_HUB_SPAWN, hotspots, blockers, props,
    dungeonIds: Object.freeze(ids.slice()) });
  hubCache.set(townId, hub);
  return hub;
}

// 현재 마을. 장면(arena.buildLobby)과 걷기 판정(HubMovement)이 같은 값을 쓴다.
let activeTown = 'oathhold';
export const activeTownId = () => activeTown;
export function setActiveTownId(id) { if (TOWN_THEMES[id]) activeTown = id; return activeTown; }
/** 현재 마을의 걷기 데이터 → 없으면 원본 성채 데이터. */
export const activeTownHub = () => townHub(activeTown);

/** 현재 마을을 먼저, 그다음 원본 목록에서 찾는다(ui가 같은 id의 서로 다른 객체를 고르는 일을 막는다). */
export function findHotspot(id) {
  return townHub(activeTown).hotspots.find(spot => spot.id === id) || CITADEL_HUB_HOTSPOTS.find(spot => spot.id === id) || null;
}
