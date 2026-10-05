import { expect, test } from 'bun:test';
import { stageDef } from '../src/data/stages.js';
import { DUNGEONS, ARENA_RIVALS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { EXPEDITION_CONQUESTS } from '../src/data/expedition-conquests.js';
import { buildExpeditionStage } from '../src/game/expedition-combat.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';
import { normalizeRunRoute, normalizeRunDetails, runRouteForStage, runHistoryContext, runDetailsForBattle, runRouteLabel, runDetailsLabel, retryEnergyForResult } from '../src/game/run-history.js';

test('legacy history retains outcome, floor and boon kinds without inventing an expedition or mastery values', () => {
  const legacy = { runId: 8, floor: 5, outcome: 'defeat', boonIds: ['ember_edge', 'ember_edge'] };
  const before = JSON.stringify(legacy), state = normalizeMasterworks({ history: [legacy] });
  expect(state.history).toEqual([{ ...legacy, boonIds: ['ember_edge'], details: null }]);
  expect(runDetailsLabel(state.history[0].details)).toContain('상세 기록 없음');
  expect(runDetailsLabel(state.history[0].details)).not.toContain('회피 0');
  expect(JSON.stringify(legacy)).toBe(before);
});

test('catalog routes distinguish basic, deep, conquest, rift and campaign without trusting saved display names', () => {
  const basic = DUNGEONS.slice(0, 2).map(d => runRouteForStage(buildExpeditionStage('dungeon', d.id, {})));
  expect(basic.map(r => r?.id)).toEqual(['glass_garden', 'ember_vault']);
  const sameFloor = [DUNGEONS[0], DUNGEONS.find(d => d.id === 'bellfall_crypt')!].map(d => buildExpeditionStage('dungeon', d.id, {}));
  expect(sameFloor[0].idx).toBe(sameFloor[1].idx);
  expect(runRouteLabel(runRouteForStage(sameFloor[0]))).not.toBe(runRouteLabel(runRouteForStage(sameFloor[1])));
  for (const def of EXPEDITION_DEPTHS) expect(runRouteForStage(buildExpeditionStage('dungeon', def.id, {}, { depth: 'deep' }))).toMatchObject({ kind: 'dungeon', id: def.id, depth: 'deep' });
  for (const def of EXPEDITION_CONQUESTS) {
    const route = runRouteForStage(buildExpeditionStage('dungeon', def.dungeonId, {}, { depth: 'deep', conquestId: def.id }));
    expect(route?.conquestId).toBe(def.id); expect(runRouteLabel(route)).toContain(def.name);
  }
  const route = normalizeRunRoute({ kind: 'dungeon', id: 'glass_garden', depth: 'standard', riftId: 'iron', name: '<script>' });
  expect(runRouteLabel(route)).toContain('철갑의 균열'); expect(runRouteLabel(route)).not.toContain('<script>');
  expect(runRouteForStage({ ...stageDef(6, 10), difficultyId: 'nightmare' })).toMatchObject({ kind: 'campaign', id: '6-10', difficultyId: 'nightmare' });
  expect(runRouteForStage({ ...stageDef(1, 1), party: {} })).toBeNull();
  expect(runRouteForStage(buildExpeditionStage('arena', 'rookie', {}))).toBeNull();
});

test('unknown and impossible route combinations are missing, never reclassified as a campaign', () => {
  for (const route of [null, [], {}, { kind: 'campaign', id: '01-1' }, { kind: 'campaign', id: '7-1' },
    { kind: 'dungeon', id: '__proto__', depth: 'standard' }, { kind: 'dungeon', id: 'glass_garden', depth: 'unknown' },
    { kind: 'dungeon', id: 'glass_garden', depth: 'standard', conquestId: 'garden_dawn' },
    { kind: 'dungeon', id: 'ember_vault', depth: 'deep', conquestId: 'garden_dawn' },
    { kind: 'dungeon', id: 'glass_garden', depth: 'deep', riftId: 'iron' }]) expect(normalizeRunRoute(route)).toBeNull();
  expect(normalizeRunRoute({ kind: 'campaign', id: '1-1', difficultyId: '__proto__' })?.difficultyId).toBeNull();
  for (const difficultyId of [JSON.parse('{"toString":null}'), ['story'], {}]) {
    const raw = { history: [{ runId: 1, floor: 1, outcome: 'victory', boonIds: [], details: { route: { kind: 'campaign', id: '1-1', difficultyId } } }] };
    expect(() => normalizeMasterworks(raw)).not.toThrow();
    expect(normalizeMasterworks(raw).history[0].details?.route?.difficultyId).toBeNull();
  }
});

test('details preserve observed zeroes and fractional time, reject malformed counters, and round-trip bounded history', () => {
  const details = { route: { kind: 'campaign', id: '1-1', difficultyId: 'story' }, heroId: 'knight', heroLevel: 1, control: 'mixed', perfects: 0, breaks: 4, timeSec: 152.375 };
  const history = Array.from({ length: 25 }, (_, i) => ({ runId: i + 1, floor: 1, outcome: 'victory', boonIds: [], details }));
  const normalized = normalizeMasterworks(JSON.parse(JSON.stringify({ history })));
  expect(normalized.history).toHaveLength(20); expect(normalized.history[0].runId).toBe(6);
  expect<unknown>(normalized.history.at(-1)?.details).toEqual(details);
  expect(normalizeMasterworks(normalized).history).toEqual(normalized.history);
  expect(runDetailsLabel(details)).toContain('정확 회피 0'); expect(runDetailsLabel(details)).toContain('152초');
  const invalid = normalizeRunDetails({ route: { kind: 'campaign', id: 'fake' }, heroId: '__proto__', heroLevel: 81, control: true, perfects: -1, breaks: 1.5, timeSec: Infinity });
  expect(invalid).toEqual({ route: null, heroId: null, heroLevel: null, control: 'unknown', perfects: null, breaks: null, timeSec: null });
  for (const value of [NaN, -1, '2', 1000001]) expect(normalizeRunDetails({ perfects: value, breaks: value })?.perfects).toBeNull();
  expect(runDetailsLabel(invalid)).toContain('정확 회피 미기록'); expect(runDetailsLabel(invalid)).toContain('조작 미기록');
});

test('departure context survives later hero selection, level growth and stage mutations', () => {
  const stage: any = { ...stageDef(1, 1), difficultyId: 'story' };
  const context = runHistoryContext(stage, 'mage', 3);
  stage.code = '2-10'; stage.difficultyId = 'nightmare';
  const details = runDetailsForBattle({ stage, heroId: 'knight', growthStart: { level: 80 }, elapsed: 99, result: { time: 12.5 },
    run: { historyContext: context, controlSeen: 3, perfects: 2, breaks: 5 } });
  expect(details).toMatchObject({ heroId: 'mage', heroLevel: 3, route: { id: '1-1', difficultyId: 'story' }, control: 'mixed', perfects: 2, breaks: 5, timeSec: 12.5 });
  expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context.route)).toBe(true);
});

test('retry hints match catalog prices, including free arena, and reading never mutates the result', () => {
  for (const [kind, defs, depth] of [['dungeon', DUNGEONS, 'standard'], ['dungeon', EXPEDITION_DEPTHS, 'deep'], ['arena', ARENA_RIVALS, 'standard']] as const) {
    for (const def of defs) {
      const result = { kind, id: def.id, depth }, before = JSON.stringify(result);
      expect(retryEnergyForResult(result)).toBe(def.energy); expect(JSON.stringify(result)).toBe(before);
    }
  }
  for (const result of [{ kind: 'dungeon', id: 'missing' }, { kind: 'dungeon', id: 'glass_garden', depth: 'fake' }, { kind: 'arena', id: 'missing' }]) expect(retryEnergyForResult(result)).toBeNull();
});
