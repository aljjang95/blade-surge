import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DUNGEONS } from '../src/data/expansion.js';
import { ENEMIES } from '../src/data/stages.js';
import { RIFT_ART } from '../src/data/encounter-art.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';

const pack = DUNGEONS.filter(d => ['bellfall_crypt', 'cinder_tide_lock', 'nightglass_observatory'].includes(d.id));

test('new scenario expeditions expose authored routes, bosses, and verified art', () => {
  expect(pack).toHaveLength(3);
  const hashes = new Set<string>();
  for (const dungeon of pack) {
    const route = dungeon as any;
    const stage = buildExpeditionStage('dungeon', dungeon.id, {});
    const world = buildExpeditionWorld(stage);
    expect(world.rooms.length).toBeGreaterThanOrEqual(7);
    expect(world.rooms.some(room => room.type === 'treasure')).toBe(true);
    expect(world.rooms.some(room => room.type === 'elite')).toBe(true);
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z)!;
    for (const room of world.rooms) {
      const cell = Math.floor(room.z - (world as any).minZ) * (world as any).cols + Math.floor(room.x - (world as any).minX);
      if (room !== world.bossRoom) expect(flow[cell]).toBeGreaterThanOrEqual(0);
    }
    world.unseal();
    const open = world.buildFlow(world.bossRoom.x, world.bossRoom.z)!;
    for (const room of world.rooms) {
      const cell = Math.floor(room.z - (world as any).minZ) * (world as any).cols + Math.floor(room.x - (world as any).minX);
      expect(open[cell]).toBeGreaterThanOrEqual(0);
    }
    expect(stage.encounter.enemyId).toBe(route.bossEnemy);
    expect(stage.expeditionEnemy.boss).toBe(true);
    expect(stage.expeditionEnemy.signatureBoss).toBe(true);
    expect(expeditionRoster(stage, world.rooms.find(room => room.type === 'normal')!)).toHaveLength(7);
    for (const id of [...route.roster.trash, ...route.roster.ranged, ...route.roster.elite, route.bossEnemy]) {
      expect((ENEMIES as Record<string, unknown>)[id]).toBeTruthy();
    }
  }
  const portrait = readFileSync(`public${RIFT_ART.glass_hour_sovereign}`);
  hashes.add(createHash('sha256').update(portrait).digest('hex'));
  expect(portrait.byteLength).toBeGreaterThan(10000);
  expect(hashes.size).toBe(1);
});
