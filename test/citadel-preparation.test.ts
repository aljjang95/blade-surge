import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { citadelPreparation } from '../src/game/citadel-preparation.js';
import { DUNGEONS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { frontierForRoute, weeklyFrontier } from '../src/data/seasonal-content.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';
import { buildExpeditionStage } from '../src/game/expedition-combat.js';
import { routeObjectiveForStage } from '../src/data/route-objectives.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  setSystemTime();
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
function fixture() {
  const eco = new Economy(), expedition = new ExpeditionEconomy(eco);
  eco.s.masterworks = normalizeMasterworks(null);
  return { eco, expedition, mode: 'lobby', stageStarting: false, battle: { active: false }, expeditionUI: { result: null } } as any;
}
const unlock = (app: any, def: (typeof EXPEDITION_DEPTHS)[number]) => {
  app.expedition.s.level = def.minLevel;
  app.expedition.s.stats[def.id] = 1;
  app.eco.s.progress.stars[def.unlockCode] = 1;
};
function goal(app: any, override: object = {}, metric = 'time', victory = true) {
  const context = { route: { kind: 'dungeon', id: 'glass_garden', depth: 'standard', conquestId: null, riftId: null },
    heroId: 'knight', heroLevel: 1, control: 'manual', ...override };
  app.eco.s.masterworks = normalizeMasterworks({ personalGoal: { context, metric }, history: [
    { runId: 1, floor: 1, outcome: victory ? 'victory' : 'defeat', boonIds: [], details: { ...context, timeSec: 60, perfects: 2, breaks: 3 } },
  ] });
}
const preparation = (app: any, id = 'glass_garden', depth = 'standard') => citadelPreparation(app, id, depth) as any;

function actionCue(app: ReturnType<typeof fixture>, id: string, depth = 'standard') {
  const preview = citadelPreparation(app, id, depth);
  if (!preview.ok || !('actionCue' in preview)) throw new Error('유효한 원정 준비가 필요합니다.');
  return preview.actionCue;
}

test('정원 첫 행동 안내는 실제 선택 전술을 필수 공명 목표와 구분하고 심층 선택 때 전술을 제거한다', () => {
  const app = fixture(), basic = actionCue(app, 'glass_garden')!, deep = actionCue(app, 'glass_garden', 'deep')!;
  expect(basic.objective).toBe(buildExpeditionStage('dungeon', 'glass_garden', null).objective);
  expect(basic.action).toBe('선택 · 집결 / 방출 · 장치 곁 F 또는 전술 버튼 · 이 방에서 1회(수동)');
  expect(basic.objective).toContain('2초');
  expect(deep.objective).toBe(buildExpeditionStage('dungeon', 'glass_garden', null, { depth: 'deep' }).objective);
  expect(deep.action).toBe('보물방 2곳 · 적 처치 후 제단 중심에서 공명');
  expect(deep.action).not.toMatch(/집결|방출|전술 버튼|F/);
});

test('금고 증원과 관측소 기록 안내는 선택한 실제 원정의 수·순서·유지 시간을 따른다', () => {
  const app = fixture();
  for (const depth of ['standard', 'deep']) {
    const ember = buildExpeditionStage('dungeon', 'ember_vault', null, { depth });
    const waves = ember.expedition.mechanics.reinforcements;
    expect(actionCue(app, 'ember_vault', depth)!.objective).toBe(ember.objective);
    expect(actionCue(app, 'ember_vault', depth)!.action).toBe(`정예방 ${depth === 'deep' ? 2 : 1}곳 · 증원 각 ${waves}회까지 처치`);
    const night = buildExpeditionStage('dungeon', 'nightglass_observatory', null, { depth });
    const records = routeObjectiveForStage(night);
    if (!records || !('kind' in records) || records.kind !== 'records') throw new Error('기록 복원 계약이 필요합니다.');
    expect(records.gates.map(gate => gate.pageId)).toEqual(depth === 'deep' ? [3, 2, 1] : [1, 2, 3]);
    expect(actionCue(app, 'nightglass_observatory', depth)!.objective).toBe(night.objective);
    expect(actionCue(app, 'nightglass_observatory', depth)!.action).toBe(`기록 ${depth === 'deep' ? '3 → 2 → 1' : '1 → 2 → 3'} 순서 · 기록대에서 공격·회피 없이 ${records.holdSeconds}초 유지`);
  }
});

test('세 기준문 이외에는 새 행동을 만들지 않으며 반복 준비는 저장·재고·정산을 바꾸지 않는다', () => {
  const app = fixture(), stateBefore = structuredClone(app.eco.s), expeditionBefore = structuredClone(app.expedition.s);
  const catalogBefore = JSON.stringify([DUNGEONS, EXPEDITION_DEPTHS]), storageBefore = [...values];
  for (const def of DUNGEONS) for (const depth of ['standard', 'deep']) {
    const cue = actionCue(app, def.id, depth);
    expect(!!cue).toBe(['glass_garden', 'ember_vault', 'nightglass_observatory'].includes(def.id));
  }
  expect(app.eco.s).toEqual(stateBefore); expect(app.expedition.s).toEqual(expeditionBefore);
  expect(JSON.stringify([DUNGEONS, EXPEDITION_DEPTHS])).toBe(catalogBefore); expect([...values]).toEqual(storageBefore);
});

test('every gate projects canonical basic and deep routes; each deep lock uses actual expedition eligibility', () => {
  for (const def of EXPEDITION_DEPTHS) {
    const app = fixture(), basic = DUNGEONS.find(d => d.id === def.id)!;
    app.expedition.s.level = 50;
    expect(preparation(app, def.id).definition).toEqual(basic);
    let projected = preparation(app, def.id, 'deep');
    expect(projected.definition).toEqual(def); expect(projected.access.cost).toBe(def.energy);
    expect(projected.access.error).toBe(`캠페인 ${def.unlockCode} 클리어 필요`);
    expect(projected.depthOptions.map((d: any) => d.depth)).toEqual(['standard', 'deep']);
    app.eco.s.progress.stars[def.unlockCode] = 1;
    expect(preparation(app, def.id, 'deep').access.error).toBe('기본 원정을 먼저 클리어해 주세요.');
    app.expedition.s.stats[def.id] = 1; app.expedition.s.level = def.minLevel - 1;
    expect(preparation(app, def.id, 'deep').access.error).toBe(`탐험 레벨 ${def.minLevel} 필요`);
    unlock(app, def); projected = preparation(app, def.id, 'deep');
    expect(projected.access.ok).toBe(true); expect(projected.access.cost).toBe(def.energy);
    app.eco.s.energy = def.energy - 1;
    expect(preparation(app, def.id, 'deep').access).toMatchObject({ ok: false, cost: def.energy,
      error: `에너지가 부족합니다. 보유 ${def.energy - 1} / 필요 ${def.energy}` });
  }
});

test('fixed rewards and first deep clear preview do not grant, combine or consume any reward', () => {
  const app = fixture(), def = EXPEDITION_DEPTHS[0]; unlock(app, def);
  const before = structuredClone(app.eco.s);
  expect(preparation(app).rewards).toEqual({ base: DUNGEONS[0].rewards, firstClear: null });
  expect(preparation(app, def.id, 'deep').rewards).toEqual({ base: def.rewards, firstClear: { eligible: true, rewards: def.firstRewards } });
  expect(app.eco.s).toEqual(before);
  app.expedition.s.depthWins[def.id] = 1;
  expect(preparation(app, def.id, 'deep').rewards.firstClear).toEqual({ eligible: false, rewards: def.firstRewards });
});

test('frontier disclosure belongs only to the actual active basic route and does not rewrite its fixed reward hint', () => {
  setSystemTime(new Date('2026-10-04T12:00:00Z'));
  const app = fixture(), frontier = weeklyFrontier(), route = DUNGEONS.find(d => d.id === frontier.routeId)!;
  const active = preparation(app, frontier.routeId);
  expect(active.frontier).toEqual(frontierForRoute(frontier.routeId));
  expect(active.frontier.name).toBe(frontier.name); expect(active.frontier.modifier).toBe(frontier.modifier);
  expect(active.rewards.base).toEqual(route.rewards);
  expect(preparation(app, frontier.routeId, 'deep').frontier).toBeNull();
  expect(preparation(app, DUNGEONS.find(d => d.id !== frontier.routeId)!.id).frontier).toBeNull();
});

test('personal objective distinguishes matching conditions, missing victory baseline and unrepresentable next target', () => {
  const app = fixture();
  expect(preparation(app).personalGoal.status).toBe('none');
  goal(app);
  expect(preparation(app).personalGoal).toMatchObject({ selected: true, status: 'matching', matches: true,
    metric: 'time', baseline: 60, target: 59, comparisonCount: 1, mismatches: [] });
  goal(app, {}, 'perfects', false);
  expect(preparation(app).personalGoal).toMatchObject({ selected: true, status: 'no-baseline', matches: true,
    metric: 'perfects', target: null, baseline: null, comparisonCount: 0 });
  goal(app, {}, 'breaks'); app.eco.s.masterworks.history[0].details.breaks = 1000000;
  expect(preparation(app).personalGoal).toMatchObject({ status: 'no-target', target: null, comparisonCount: 1 });
});

test('goal comparison includes depth, conquest and rift as well as selected hero, departure level and control', () => {
  const app = fixture(); goal(app);
  expect(preparation(app, 'glass_garden', 'deep').personalGoal).toMatchObject({ status: 'mismatch', mismatches: ['route'] });
  app.eco.s.selected = 'rogue'; app.eco.s.heroes.rogue.level = 2; app.eco.s.journey.autoBattle = true;
  expect(preparation(app).personalGoal).toMatchObject({ status: 'mismatch', mismatches: ['hero', 'level', 'control'] });
  app.eco.s.selected = 'knight'; app.eco.s.journey.autoBattle = false;
  goal(app, { route: { kind: 'dungeon', id: 'glass_garden', depth: 'standard', conquestId: null, riftId: 'iron' } });
  expect(preparation(app).personalGoal.mismatches).toEqual(['route']);
  // Existing normalized deep conquest identity is compared; ordinary gate never silently launches it.
  goal(app, { route: { kind: 'dungeon', id: 'glass_garden', depth: 'deep', conquestId: 'garden_dawn', riftId: null } });
  expect(app.eco.s.masterworks.personalGoal.context.route.conquestId).toBe('garden_dawn');
  expect(preparation(app, 'glass_garden', 'deep').personalGoal.mismatches).toEqual(['route']);
});

test('potion stock is shared inventory with actual battle keys, and repeated previews change neither save nor catalog', () => {
  const app = fixture(); goal(app);
  app.expedition.s.consumables = { hp_tonic: 7, overdrive: 2, aegis: 0 };
  const before = structuredClone(app.eco.s), stored = new Map(values), catalog = JSON.stringify(DUNGEONS);
  const view = preparation(app);
  expect(view.potions.map((p: any) => [p.id, p.key, p.count])).toEqual([['hp_tonic', 'U', 7], ['overdrive', 'I', 2], ['aegis', 'O', 0]]);
  for (let i = 0; i < 3; i++) { preparation(app); preparation(app, 'glass_garden', 'deep'); }
  view.definition.name = 'changed preview'; view.definition.stage.name = 'changed preview stage'; view.rewards.base.gold = 999;
  expect(app.eco.s).toEqual(before); expect(values).toEqual(stored); expect(JSON.stringify(DUNGEONS)).toBe(catalog);
});

test('invalid catalog selections and existing pending/start/result blocks cannot create a departure preview that authorizes entry', () => {
  const app = fixture(), before = structuredClone(app.eco.s);
  expect(preparation(app, 'unknown')).toMatchObject({ ok: false, error: '알 수 없는 던전입니다.' });
  expect(preparation(app, 'glass_garden', 'unknown')).toMatchObject({ ok: false, error: '알 수 없는 원정 단계입니다.' });
  expect(app.eco.s).toEqual(before);
  app.expedition.s.pending = { id: 8 };
  expect(preparation(app).access).toMatchObject({ ok: false, error: '진행 중인 전투를 먼저 마쳐 주세요.' });
  app.expedition.s.pending = null; app.stageStarting = true;
  expect(preparation(app).access.ok).toBe(false);
  app.stageStarting = false; app.expeditionUI.result = { saveError: 'full' };
  expect(preparation(app).access).toMatchObject({ ok: false, error: '전리품 정산을 먼저 저장해 주세요.' });
});
