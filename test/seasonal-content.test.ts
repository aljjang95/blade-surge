import { expect, test } from 'bun:test';
import { DUNGEONS } from '../src/data/expansion.js';
import { SEASONAL_SEASONS, seasonForDate, weeklyFrontier } from '../src/data/seasonal-content.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';
import { ENEMIES } from '../src/data/stages.js';

test('twelve monthly frontiers resolve deterministic routes and readable modifiers', () => {
  expect(SEASONAL_SEASONS).toHaveLength(12);
  expect(new Set(SEASONAL_SEASONS.map(s => s.id)).size).toBe(12);
  for (let month = 0; month < 12; month++) {
    const d = new Date(Date.UTC(2026, month, 15, 12));
    const season = seasonForDate(d);
    const frontier = weeklyFrontier(d);
    expect(season.months).toContain(month);
    expect(season.routes).toContain(frontier.routeId);
    expect(frontier.modifier.length).toBeGreaterThan(4);
    expect(DUNGEONS.some(dungeon => dungeon.id === frontier.routeId)).toBe(true);
    expect(weeklyFrontier(d)).toEqual(frontier);
  }
});

test('season routes have authored nine-room maps, roster variety and signature bosses', () => {
  const ids = ['eclipse_hydra_vault', 'ashforge_catacomb', 'astral_leviathan_spire', 'verdigris_sanctum', 'sable_mirage_basin', 'comet_bastion'];
  for (const id of ids) {
    const route = DUNGEONS.find(d => d.id === id)! as any;
    const stage = buildExpeditionStage('dungeon', id, {});
    const world = buildExpeditionWorld(stage);
    expect(world.rooms.length).toBeGreaterThanOrEqual(8);
    expect(world.rooms.filter(room => room.type === 'treasure').length).toBeGreaterThanOrEqual(1);
    expect(world.rooms.filter(room => room.type === 'elite').length).toBeGreaterThanOrEqual(2);
    expect(stage.encounter.enemyId).toBe(route.bossEnemy);
    expect(stage.expeditionEnemy.signatureBoss).toBe(true);
    expect((ENEMIES as Record<string, unknown>)[route.bossEnemy]).toBeTruthy();
    const roster = expeditionRoster(stage, world.rooms.find(room => room.type === 'normal')!);
    expect(new Set(roster).size).toBeGreaterThanOrEqual(4);
  }
});
