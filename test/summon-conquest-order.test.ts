import { expect, test } from 'bun:test';
import { Group, Scene, Vector3 } from 'three';
import { SetProcs } from '../src/game/setprocs.js';
import { ConquestRun } from '../src/game/expedition-conquests.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';
import { SUMMON_GEAR } from '../src/data/summon-gear.js';

function fixture(id: string, gear = SUMMON_GEAR[0]) {
  const stage = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep', conquestId: id });
  const world = buildExpeditionWorld(stage);
  const conquest = new ConquestRun(stage, world, { conquestId: id });
  const room: any = world.rooms.find((r) => r.type === 'elite');
  const roster = expeditionRoster(stage, room); conquest.prepareRoom(room, roster);
  const enemies: any[] = roster.map((type: string, i: number) => {
    const e: any = { alive: true, spawning: false, homeRoom: room, pos: new Vector3(i === 0 ? 5 : 2, 0, 0), def: { scale: 1 }, hp: 1 };
    conquest.spawn(e, type, room); return e;
  });
  const hits: any[] = [];
  const noop = () => {};
  const game: any = { elapsed: 0, conquest, enemies, scene: new Scene(),
    player: { alive: true, auto: true, pos: new Vector3(), atk: 100, hp: 100, maxHp: 100 },
    ui: { toast: noop }, fx: { orb: () => new Group(), texFlash: noop, boltTex: noop, burst: noop, light: noop, damage: noop, dmgLayer: { children: [] } },
    damageEnemy(e: any, n: number, opts: any) { hits.push({ e, n, opts }); e.hp -= n; if (e.hp <= 0) { e.alive = false; conquest.death(e); } },
  };
  const procs = new SetProcs(game); procs.configureSummons([gear.summon]);
  const step = () => { procs.summons[0].cooldown = 0; procs.updateSummons(1 / 60); };
  return { conquest, enemies, hits, game, procs, step, room };
}

for (const gear of SUMMON_GEAR) {
  test(`${gear.id}: first-mark target is hit before nearer guards, then ordinary targeting resumes`, () => {
    const f = fixture('vault_signal', gear); f.step();
    expect(f.hits).toHaveLength(1); expect(f.hits[0].e).toBe(f.enemies[0]);
    expect(f.conquest.progress).toBe(1); expect(f.conquest.failed).toBe(false);
    expect(f.hits[0].n).toBe(100 * gear.summon.ratio);
    expect(f.hits[0].opts).toMatchObject({ quiet: true, noProc: true });
    f.step(); expect(f.hits[1].e).not.toBe(f.enemies[0]); f.procs.clear();
  });
  test(`${gear.id}: nearer carrier is preserved until all initial guards die`, () => {
    const f = fixture('vault_manifest', gear);
    f.enemies[0].pos.x = 2; for (const e of f.enemies.slice(1)) e.pos.x = 5;
    for (let i = 1; i < f.enemies.length; i++) {
      f.step(); expect(f.enemies[0].alive).toBe(true);
      expect(f.hits.at(-1)?.e).not.toBe(f.enemies[0]);
    }
    f.step(); expect(f.hits.at(-1)?.e).toBe(f.enemies[0]);
    expect(f.conquest.progress).toBe(1); expect(f.conquest.failed).toBe(false); f.procs.clear();
  });
}

test('out-of-range first target never redirects a summon into a nearer guard', () => {
  const f = fixture('vault_signal'); f.enemies[0].pos.x = 100; f.step();
  expect(f.hits).toHaveLength(0); expect(f.enemies.every((e) => e.alive)).toBe(true);
  f.enemies[0].pos.x = 5; f.step(); expect(f.hits[0].e).toBe(f.enemies[0]); f.procs.clear();
});

test('pending first target is awaited; manual attacks retain their normal failure consequence', () => {
  const f = fixture('vault_signal'); f.enemies[0].spawning = true; f.step();
  expect(f.hits).toHaveLength(0);
  f.enemies[0].spawning = false;
  f.game.damageEnemy(f.enemies[1], 100, {}); f.game.damageEnemy(f.enemies[0], 100, {});
  expect(f.conquest.failed).toBe(true); f.step(); expect(f.hits).toHaveLength(3); f.procs.clear();
});

test('automatic familiars respect the objective even when player AUTO is off', () => {
  const f = fixture('vault_signal'); f.game.player.auto = false; f.step();
  expect(f.hits[0].e).toBe(f.enemies[0]); f.procs.clear();
});

test('ordinary battles retain nearest-target damage and summon cleanup', () => {
  const f = fixture('vault_signal'); f.game.conquest = null; f.step();
  expect(f.hits[0].e).toBe(f.enemies[1]);
  f.procs.clear(); expect(f.procs.familiars).toHaveLength(0);
  expect(f.game.scene.children).toHaveLength(0);
});
