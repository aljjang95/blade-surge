import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ALL_DUNGEONS } from '../src/data/expansion.js';
import { CITADEL_TOWN_IDS, townHub, defaultTownDungeonIds, townOfDungeon, setActiveTownId, activeTownHub, findHotspot } from '../src/data/citadel-hub.js';
import { buildCitadelHubScene, libraryRoleOf } from '../src/game/citadel-hub-scene.js';
import { buildLobbyWorld } from '../src/game/lobby-world.js';
import { buildTownDecor, townDecorFor, townDecorPlacements } from '../src/game/region-architecture.js';
import { ProvisionalTownService } from '../src/ui/town-service-adapter.js';
import { normalizePrice } from '../src/ui/town-ui.js';
import { Floor } from '../src/game/world.js';
import { buildExpeditionWorld, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';

test('three towns split the eighteen dungeons into six each with only their own gates', () => {
  const all = CITADEL_TOWN_IDS.flatMap(id => defaultTownDungeonIds(id));
  expect(all.sort()).toEqual(ALL_DUNGEONS.map(d => d.id).sort());
  for (const id of CITADEL_TOWN_IDS) {
    const hub = townHub(id);
    expect(hub.hotspots.filter((s: any) => s.kind === 'dungeon').map((s: any) => s.route)).toEqual(defaultTownDungeonIds(id));
    expect(hub.hotspots.filter((s: any) => s.kind === 'waystone')).toHaveLength(1);
    for (const kind of ['merchant', 'trainer', 'campaign', 'arena']) expect(hub.hotspots.some((s: any) => s.kind === kind)).toBe(true);
  }
  expect(townOfDungeon('glass_garden')).toBe('oathhold');
  expect(townOfDungeon('comet_bastion')).toBe('starcrest');
});

test('every town leaves the central walking route clear and gates stay inside the plaza', () => {
  for (const id of CITADEL_TOWN_IDS) {
    const hub = townHub(id);
    for (const z of [-9, -6, -3, 0, 3, 6, 9]) for (const blocker of hub.blockers as any[]) {
      if (blocker.type === 'circle') expect(Math.hypot(blocker.x - 0, blocker.z - z) > blocker.radius + .34 || Math.abs(z) > 11).toBe(true);
      else expect(0 < blocker.minX - .34 || 0 > blocker.maxX + .34 || z < blocker.minZ - .34 || z > blocker.maxZ + .34).toBe(true);
    }
    for (const spot of hub.hotspots as any[]) { expect(Math.abs(spot.x)).toBeLessThanOrEqual(12); expect(Math.abs(spot.z)).toBeLessThanOrEqual(12); }
  }
});

test('active town switches the walking data and lookups without leaking between towns', () => {
  try {
    setActiveTownId('emberport');
    expect(activeTownHub().townId).toBe('emberport');
    expect(findHotspot('dungeon:cinder_tide_lock')?.route).toBe('cinder_tide_lock');
    setActiveTownId('oathhold');
    expect(findHotspot('npc:potion-merchant')?.label).toBe('물약상 세라');
    setActiveTownId('emberport');
    expect(findHotspot('npc:potion-merchant')?.label).not.toBe('물약상 세라');
  } finally { setActiveTownId('oathhold'); }
});

test('each town scene builds without authored assets, stays under a modest mesh budget and disposes once', () => {
  for (const id of CITADEL_TOWN_IDS) for (const quality of ['high', 'low']) {
    const hall = buildCitadelHubScene({ assets: new Map(), townId: id, quality });
    const world = buildLobbyWorld({ quality, townId: id });
    let meshes = 0; for (const root of [hall, world]) root.traverse((node: any) => { if (node.isMesh || node.isPoints) meshes++; });
    expect(meshes).toBeGreaterThan(8);
    expect(meshes).toBeLessThan(140);
    expect(hall.userData.townId).toBe(id === 'oathhold' ? 'oathhold' : id);
    const gates = [...hall.userData.hotspotNodes.keys()].filter((key: string) => key.startsWith('dungeon:'));
    expect(gates).toHaveLength(6);
    hall.userData.dispose(); hall.userData.dispose(); world.userData.dispose(); world.userData.dispose();
  }
});

test('library props tagged for a town replace the procedural stand-ins and keep instancing', () => {
  const geometry = new THREE.BoxGeometry(1, 2, 1), scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  scene.userData.libraryAsset = { id: 'ember_house', kind: 'prop', tags: ['town:emberport', 'building'] };
  expect(libraryRoleOf(scene.userData.libraryAsset)).toBe('building');
  const hall = buildCitadelHubScene({ assets: new Map(), townId: 'emberport', libraryProps: [{ asset: scene.userData.libraryAsset, scene }] });
  let instanced = 0; hall.traverse((node: any) => { if (node.isInstancedMesh && node.name === 'Citadel_Library_ember_house') { instanced++; expect(node.count).toBeGreaterThan(1); } });
  expect(instanced).toBe(1);
  hall.userData.dispose();
});

test('dungeon and field decoration appears only for routes that belong to the two themed towns', () => {
  const emberport = new Floor(1, 'forge', 123, EXPEDITION_LAYOUTS.cinder_tide_lock);
  expect(townDecorFor({ ...emberport, seed: [...'cinder_tide_lock'].reduce((n, c) => n * 31 + c.charCodeAt(0), 17) >>> 0 })).toBe('emberport');
  const deepWorld: any = buildExpeditionWorld({ idx: 1, theme: 'forge', chapter: { theme: 'forge' }, expedition: { kind: 'dungeon', id: 'cinder_tide_lock', depth: 'deep' } } as any);
  expect(deepWorld.expeditionRouteId).toBe('cinder_tide_lock');
  expect(townDecorFor(deepWorld)).toBe('emberport');
  expect(townDecorFor({ layout: { field: 'mountain' } })).toBe('starcrest');
  expect(townDecorFor({ layout: { field: 'meadow' } })).toBe(null);
  expect(townDecorFor({ seed: 1, layout: {} })).toBe(null);
  for (const town of ['emberport', 'starcrest']) {
    const floor = new Floor(1, 'forge', 4242, EXPEDITION_LAYOUTS.cinder_tide_lock);
    const placements = townDecorPlacements(floor, town);
    expect(placements.length).toBeGreaterThan(4);
    expect(townDecorPlacements(floor, town)).toEqual(placements); // 같은 시드는 같은 배치(결정성)
    const decor = buildTownDecor(floor, town);
    expect(decor.children.length).toBeGreaterThan(0);
    decor.userData.dispose(); decor.userData.dispose();
  }
});

test('provisional service follows the contract: first town open, later towns need four clears', () => {
  const wins: Record<string, number> = {};
  const app: any = { expedition: { snapshot: () => ({ stats: wins }) } };
  const service: any = new ProvisionalTownService(app);
  let towns = service.towns();
  expect(towns.map((t: any) => t.unlocked)).toEqual([true, false, false]);
  expect(towns[1].progress).toEqual({ cleared: 0, required: 4 });
  expect(service.travel('emberport').ok).toBe(false);
  for (const id of defaultTownDungeonIds('oathhold').slice(0, 4)) wins[id] = 1;
  towns = service.towns();
  expect(towns[1].unlocked).toBe(true); expect(towns[1].progress.cleared).toBe(4);
  expect(service.travel('emberport')).toEqual({ ok: true });
  expect(service.currentTownId()).toBe('emberport');
  expect(service.travel('nowhere').ok).toBe(false);
});

test('price normalization accepts numbers and gold-plus-material objects', () => {
  expect(normalizePrice(300)).toEqual({ gold: 300, materials: {} });
  expect(normalizePrice({ gold: 5, materials: { ember_core: 2 } })).toEqual({ gold: 5, materials: { ember_core: 2 } });
  expect(normalizePrice(undefined)).toEqual({ gold: 0, materials: {} });
});
