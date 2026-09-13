import { expect, test } from 'bun:test';
import { normalizeRpg, recordMonster, monsterLevel, monsterStats, monsterXp } from '../src/game/rpg-core.js';
import { CAMPAIGN_FLOOR_CAP, normalizeEncounter, stageExpeditionEncounter, encounterLevelLabel, encounterLocationLabel } from '../src/game/rpg-encounters.js';
import { CHAPTERS, STAGES_PER_CHAPTER, ENEMIES, stageDef } from '../src/data/stages.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { buildExpeditionStage } from '../src/game/expedition-combat.js';
import { buildCatalogue } from '../src/game/rpg-catalogue.js';
import { normalizeSave } from '../src/game/save.js';
import { Economy } from '../src/game/economy.js';

const known = Object.keys(ENEMIES), species = known[0];
const fresh = () => Economy.prototype.fresh();

test('all late campaign ranks survive actual save normalization without the obsolete floor50 truncation', () => {
  expect(CAMPAIGN_FLOOR_CAP).toBe(CHAPTERS.length * STAGES_PER_CHAPTER);
  for (const floor of [50, 51, CAMPAIGN_FLOOR_CAP]) for (const [rank, offset] of [[{}, 0], [{ elite: true }, 2], [{ boss: true }, 4]] as const) {
    const save: any = fresh(); save.rpg = normalizeRpg(null, known);
    recordMonster(save.rpg, species, monsterLevel(floor, rank), floor);
    recordMonster(save.rpg, species, monsterLevel(floor, rank), floor, true);
    const result: any = normalizeSave(JSON.parse(JSON.stringify(save)), fresh());
    expect(result.rpg.bestiary[species]).toMatchObject({ highestLevel: floor + offset, lastFloor: floor, kills: 1, seen: 1, lastEncounter: { kind: 'campaign', floor } });
  }
});

test('campaign catalogue levels follow each real first appearance including chapter6', () => {
  const entries: any[] = buildCatalogue();
  expect(entries.filter(e => e.locations[0]?.floor > 50).length).toBeGreaterThan(0);
  for (const e of entries.filter(e => e.locations[0]?.floor > 50)) {
    const floor = e.locations[0].floor;
    expect(e.level).toBe(floor + (e.def.boss ? 4 : e.def.elite ? 2 : 0));
    expect(e.reference).toBe(e.locations[0].code + ' 기준');
  }
});

test('legacy counters and records migrate without invented encounter history', () => {
  const legacy = { version: 1, combatXp: 12345, bestiary: { [species]: { seen: 40, kills: 7, highestLevel: 54, lastFloor: 50 } } };
  const out = normalizeRpg(legacy, known);
  expect(out.bestiary[species]).toEqual(legacy.bestiary[species]);
  expect(out.combatXp).toBe(12345); expect(out.version).toBe(1);
  expect(out.bestiary[species].lastEncounter).toBeUndefined();
});

test('all deep locations retain species counts and legacy numeric high water through full save reload', () => {
  for (const deep of EXPEDITION_DEPTHS) {
    const stage = buildExpeditionStage('dungeon', deep.id, null, { depth: 'deep' });
    const s: any = fresh(); s.rpg = normalizeRpg(null, known);
    recordMonster(s.rpg, species, 60, 60);
    const location = stageExpeditionEncounter(stage);
    recordMonster(s.rpg, species, 79, stage.idx, false, location);
    recordMonster(s.rpg, species, 79, stage.idx, true, location);
    s.rpg.combatXp = 987;
    const out: any = normalizeSave(JSON.parse(JSON.stringify(s)), fresh());
    expect(out.rpg.bestiary[species]).toEqual({ seen: 2, kills: 1, highestLevel: 60, lastFloor: 60, lastEncounter: { kind: 'dungeon', id: deep.id, depth: 'deep' } });
    expect(out.rpg.combatXp).toBe(987);
    expect(encounterLevelLabel(stage, 79)).toBe('심층');
    expect(encounterLocationLabel(out.rpg.bestiary[species].lastEncounter)).toBe('심층 · ' + deep.name);
  }
});

test('new expedition-only discoveries have an actual place and no invented numeric level claim', () => {
  const r = normalizeRpg(null, known), stage = buildExpeditionStage('dungeon', 'glass_garden', null, { depth: 'deep' });
  const record: any = recordMonster(r, species, null, stage.idx, false, stageExpeditionEncounter(stage));
  expect(record.seen).toBe(1); expect(record.highestLevel).toBe(1); expect(record.lastFloor).toBe(1);
  expect(record.lastEncounter).toEqual({ kind: 'dungeon', id: 'glass_garden', depth: 'deep' });
  expect(encounterLevelLabel(stage, null)).toBe('심층');
  expect(encounterLocationLabel(record.lastEncounter)).not.toContain('1-1');
});

test('latest place changes in either mode order without inflating the numeric high water', () => {
  const r = normalizeRpg(null, known), loc = { kind: 'dungeon', id: 'glass_garden', depth: 'deep' };
  recordMonster(r, species, null, 5, false, loc);
  recordMonster(r, species, 51, 51, true);
  expect(r.bestiary[species]).toMatchObject({ highestLevel: 51, lastFloor: 51, lastEncounter: { kind: 'campaign', floor: 51 } });
  recordMonster(r, species, 79, 5, false, loc);
  expect(r.bestiary[species]).toMatchObject({ highestLevel: 51, lastFloor: 51, lastEncounter: loc });
});

test('ordinary expedition, daily rift and AI duel display their actual modes', () => {
  const standard = buildExpeditionStage('dungeon', 'ember_vault', null);
  const rift = { ...standard, riftId: 'siege' };
  const arena = buildExpeditionStage('arena', 'duelist', null);
  expect(encounterLevelLabel(standard, 15)).toBe('원정');
  expect(encounterLevelLabel(rift, 15)).toBe('균열');
  expect(stageExpeditionEncounter(rift)).toEqual({ kind: 'dungeon', id: 'ember_vault', depth: 'standard', riftId: 'siege' });
  expect(encounterLocationLabel(stageExpeditionEncounter(rift))).toBe('잿불 금고 · 포위의 균열');
  expect(encounterLevelLabel(arena, 5)).toBe('AI 결투');
  expect(encounterLocationLabel(stageExpeditionEncounter(arena))).toBe('AI 결투 · 바람의 결투가');
  expect(encounterLevelLabel({ party: true }, 5)).toBe('파티');
});

test('invalid location payloads are dropped without destroying valid legacy statistics', () => {
  const bad = [[], { kind: 'campaign', floor: 61 }, { kind: 'campaign', floor: 1.5 }, { kind: 'dungeon', id: '__proto__', depth: 'deep' },
    { kind: 'dungeon', id: 'glass_garden', depth: 'impossible' }, { kind: 'arena', id: 'missing' },
    { kind: 'dungeon', id: 'glass_garden', depth: 'deep', riftId: 'siege' }, { kind: 'dungeon', id: 'glass_garden', depth: 'standard', riftId: 'missing' }];
  for (const value of bad) {
    expect(normalizeEncounter(value)).toBeNull();
    const normalized = normalizeRpg({ combatXp: 55, bestiary: { [species]: { seen: 9, kills: 4, highestLevel: 30, lastFloor: 28, lastEncounter: value } } }, known);
    expect(normalized.bestiary[species]).toEqual({ seen: 9, kills: 4, highestLevel: 30, lastFloor: 28 });
    expect(normalized.combatXp).toBe(55);
  }
  expect(normalizeEncounter(Object.create({ kind: 'arena', id: 'rookie' }))).toBeNull();
  expect(normalizeEncounter(Object.assign(Object.create({ floor: 60 }), { kind: 'campaign' }))).toBeNull();
  expect(normalizeEncounter(Object.assign(Object.create({ depth: 'deep' }), { kind: 'dungeon', id: 'glass_garden' }))).toBeNull();
  expect(normalizeEncounter(Object.assign(Object.create({ riftId: 'siege' }), { kind: 'dungeon', id: 'glass_garden', depth: 'standard' })))
    .toEqual({ kind: 'dungeon', id: 'glass_garden', depth: 'standard' });
  expect(normalizeEncounter({ kind: 'arena', id: 'rookie', name: '<script>bad</script>', scale: 999 })).toEqual({ kind: 'arena', id: 'rookie' });
});

test('invalid explicit expedition record is rejected before touching discoveries', () => {
  const r = normalizeRpg(null, known); const before = JSON.stringify(r);
  expect(recordMonster(r, species, 80, 60, true, { kind: 'dungeon', id: 'unknown', depth: 'deep' })).toBeNull();
  expect(JSON.stringify(r)).toBe(before);
});

test('display context never alters authored combat statistics or XP', () => {
  const stages: any[] = [stageDef(6, 10), ...EXPEDITION_DEPTHS.map(d => buildExpeditionStage('dungeon', d.id, null, { depth: 'deep' }))];
  for (const stage of stages) {
    const def = stage.expeditionEnemy || (ENEMIES as Record<string, any>)[stage.encounter.enemyId];
    const before = JSON.stringify(stage), stats = monsterStats(def, stage.scale), xp = monsterXp(def, stage.scale);
    const context = stageExpeditionEncounter(stage); encounterLocationLabel(context); encounterLevelLabel(stage, context ? null : monsterLevel(stage.idx, def));
    expect(monsterStats(def, stage.scale)).toEqual(stats); expect(monsterXp(def, stage.scale)).toBe(xp); expect(JSON.stringify(stage)).toBe(before);
  }
});
