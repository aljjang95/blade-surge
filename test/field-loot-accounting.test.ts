import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { DropSystem } from '../src/game/drops.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { stageDef } from '../src/data/stages.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const systems: any[] = [];
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  for (const system of systems.splice(0)) {
    system.clear(); system._geoCoin.dispose(); system._matCoin.dispose();
    for (const material of Object.values(system._matCache) as THREE.Material[]) material.dispose();
  }
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function physicalDrops(stage: any) {
  const messages: string[] = [];
  const scene = new THREE.Scene();
  // Use real kill generation, meshes, flight, magnet collection and reset. Only
  // presentation/audio and unrelated equipment rolls are outside this fixture.
  const system: any = Object.create(DropSystem.prototype);
  const game = { stage, scene, player: { alive: true, pos: new THREE.Vector3() },
    renderer: { camera: new THREE.PerspectiveCamera() },
    ui: { flyReward(_pos: any, text: string) { messages.push(text); } },
    fx: { burst() {} }, rollDrop() { return null; },
  };
  Object.assign(system, { game, scene, items: [], magnetR: 4.2, pickR: 1.1, _matCache: {}, _lootMaterials: new Map() });
  system.clear(); system.setup(null); systems.push(system);
  return { system, messages, scene };
}

function defeatEliteAndBoss(system: any) {
  for (const rank of ['elite', 'boss']) system.onKill({
    pos: new THREE.Vector3(.5, 0, .5), def: { gold: 20 }, isElite: rank === 'elite', isBoss: rank === 'boss',
  }, system.game.stage);
  expect(system.items.filter((item: any) => item.kind === 'stone2').map((item: any) => item.payload)).toEqual([1, 2]);
  expect(system.items.filter((item: any) => item.kind === 'stone3').map((item: any) => item.payload)).toEqual([1]);
  for (let frame = 0; frame < 240; frame++) system.update(1 / 60);
}

for (const mode of ['campaign', 'standard', 'deep']) test(`${mode}: actual elite/boss pickups settle every stone tier and survive save reload`, () => {
  const eco = new Economy(), expedition = new ExpeditionEconomy(eco);
  const stage: any = mode === 'campaign' ? stageDef(1, 1) : { scale: 1, expedition: { kind: 'dungeon', id: 'glass_garden', depth: mode } };
  let ticket: any;
  if (mode !== 'campaign') {
    if (mode === 'deep') { expedition.s.stats.glass_garden = 1; eco.s.progress.stars['2-10'] = 1; expedition.s.level = 2; }
    const begin = expedition.begin('dungeon', 'glass_garden', { depth: mode });
    expect(begin.ok).toBe(true); ticket = begin.ticket;
  }
  const before = { stones: eco.s.stones, stones2: eco.s.stones2, stones3: eco.s.stones3 };
  const { system, messages, scene } = physicalDrops(stage);
  defeatEliteAndBoss(system);
  expect(scene.children).toHaveLength(0); expect(system.items).toHaveLength(0);
  expect(messages).toContain('상급 강화석 +1'); expect(messages).toContain('상급 강화석 +2'); expect(messages).toContain('전설 강화석 +1');
  expect([system.stones, system.stones2, system.stones3]).toEqual([7, 3, 1]);
  expect(Object.hasOwn(system, 'stone2')).toBe(false); expect(Object.hasOwn(system, 'stone3')).toBe(false);
  const fieldRewards = { fieldStones: system.stones, fieldStones2: system.stones2, fieldStones3: system.stones3 };
  if (mode === 'campaign') {
    const reward = eco.completeStage(stage, 3, fieldRewards);
    expect(reward.got).toContainEqual({ k: 'stones2', n: 3 }); expect(reward.got).toContainEqual({ k: 'stones3', n: 1 });
  } else {
    const receipt = expedition.settle(ticket, { win: true, fieldRewards });
    expect(receipt.ok).toBe(true); expect(receipt.rewards?.stones2).toBe(3); expect(receipt.rewards?.stones3).toBe(1);
    expect(expedition.settle(ticket, { win: true, fieldRewards }).ok).toBe(false);
  }
  const reloaded = new Economy();
  expect(reloaded.s.stones2 - before.stones2).toBe(3); expect(reloaded.s.stones3 - before.stones3).toBe(1);
  expect(reloaded.s.stones - before.stones).toBeGreaterThanOrEqual(7);
  system.clear();
  expect([system.stones, system.stones2, system.stones3]).toEqual([0, 0, 0]);
  defeatEliteAndBoss(system);
  expect([system.stones, system.stones2, system.stones3]).toEqual([7, 3, 1]);
});

for (const stage of [{ party: { id: 'party' } }, { expedition: { kind: 'arena' } }]) test(`${stage.party ? 'party' : 'arena'}: stale upper-stone pickups cannot create local reward`, () => {
  const { system, messages } = physicalDrops(stage);
  system.collect({ kind: 'stone2', payload: 2 }); system.collect({ kind: 'stone3', payload: 1 });
  expect(messages).toHaveLength(0); expect([system.stones2, system.stones3]).toEqual([0, 0]);
  system.onKill({ pos: new THREE.Vector3(), def: { gold: 20 }, isBoss: true }, stage);
  expect(system.items).toHaveLength(0);
});
