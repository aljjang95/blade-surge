import { DUNGEONS } from './expansion.js';

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
const dungeonGates = DUNGEONS.map((d, i) => {
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
