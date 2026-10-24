import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { RECIPES } from '../src/data/expansion.js';
import { DAILY_CONTRACTS } from '../src/data/journey.js';
import { regionDungeonIds } from '../src/data/region-dungeons.js';
import { FRONTIER_FALLBACK_ROUTE, frontierForRoute, frontierFromSnapshot, frontierSnapshot, weeklyFrontier } from '../src/data/seasonal-content.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { JourneyService } from '../src/game/journey-service.js';
import { ROTATION_FALLBACK_DUNGEON, contractRows, normalizeJourney, recordJourneyWin, rotationDungeon } from '../src/game/journey-core.js';
import { visibleDungeonIds } from '../src/game/region-dungeon-gate.js';
import { normalizeSave } from '../src/game/save-base.js';

// 오늘의 원정지·균열·주간 프론티어·재료 안내가 아직 열리지 않은 지역 던전을 가리키지 않는다(docs/region-dungeon-unlock.md).
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  setSystemTime();
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

const REGION1 = regionDungeonIds(1);
const DAY = 86400000, START = Date.parse('2026-09-06T20:00:00.000Z');
const stars = (ch: number) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`${ch}-${i + 1}`, 3]));
const freshSave = () => normalizeSave(new Economy().fresh(), new Economy().fresh());
const doneSave = () => normalizeSave({ ...new Economy().fresh(), progress: { unlocked: 61, stars: Object.assign({}, ...[1, 2, 3, 4, 5, 6].map(stars)), difficulty: 'story' } }, new Economy().fresh());
const days = (count: number) => Array.from({ length: count }, (_, i) => START + i * DAY);
function make(save?: any) {
  const eco = new Economy(); if (save) eco.s = save;
  const app: any = { eco, battle: { active: false }, expeditionUI: { result: null } };
  app.expedition = new ExpeditionEconomy(eco); app.journey = new JourneyService(app);
  return app;
}

describe('오늘의 원정지(일일 임무 rotation)', () => {
  test('신규 저장: 여러 날짜 모두 열린 지역 1 던전만 가리키고 재료 보상도 그 던전의 것이다', () => {
    const save = freshSave(), open = visibleDungeonIds(save), seen = new Set<string>();
    for (const now of days(60)) {
      const rows = contractRows(normalizeJourney(null), now, { openIds: open });
      const row: any = rows.daily.find((r: any) => r.id === 'rotation')!;
      expect(rows.rotationDungeonId).toBe(row.dungeonId);
      expect(open.has(rows.rotationDungeonId)).toBe(true);
      expect(REGION1).toContain(rows.rotationDungeonId);
      expect(Object.keys(row.rewards.materials)).not.toHaveLength(0);
      seen.add(rows.rotationDungeonId);
    }
    expect(seen.size).toBeGreaterThan(1); // 날짜에 따라 돌아간다(항상 같은 던전이 아니다)
  });

  test('같은 날·같은 저장이면 결과가 같고 지정 던전이 열린 날은 예전 결과를 그대로 쓴다', () => {
    const open = visibleDungeonIds(freshSave());
    for (const now of days(30)) {
      const day = normalizeJourney(null); const a = contractRows(day, now, { openIds: open }).rotationDungeonId, b = contractRows(day, now, { openIds: open }).rotationDungeonId;
      expect(a).toBe(b);
      const legacy = contractRows(normalizeJourney(null), now).rotationDungeonId; // 전체에서 고르는 예전 규칙
      if (open.has(legacy)) expect(a).toBe(legacy);
    }
  });

  test('진행이 끝난 저장: 예전처럼 전체에서 day%3 로 고른다', () => {
    const open = visibleDungeonIds(doneSave());
    for (const now of days(30)) {
      expect(contractRows(normalizeJourney(null), now, { openIds: open }).rotationDungeonId).toBe(contractRows(normalizeJourney(null), now).rotationDungeonId);
    }
    expect(new Set(days(9).map((now) => contractRows(normalizeJourney(null), now, { openIds: open }).rotationDungeonId)).size).toBe(3);
  });

  test('열린 던전이 하나도 없으면 지역 1 기본 던전', () => {
    for (let day = 0; day < 6; day++) expect(rotationDungeon(day, new Set()).id).toBe(ROTATION_FALLBACK_DUNGEON);
    expect(ROTATION_FALLBACK_DUNGEON).toBe(REGION1[0]);
  });

  test('서비스: 표시한 던전으로만 균열이 열리고 같은 던전의 승리로 임무를 수령한다(신규 저장)', () => {
    for (const now of days(12)) {
      setSystemTime(now);
      const app = make(); app.expedition.s.level = 10;
      const snap = app.journey.snapshot(), id = snap.contracts.rotationDungeonId;
      expect(app.expedition.dungeonVisibility(id).visible).toBe(true);
      // 잠긴 던전을 직접 고르면 균열도 막히고, 표시한 던전은 균열 출격이 된다.
      expect(app.expedition.begin('dungeon', 'star_archive', { rift: true }).ok).toBe(false);
      const started = app.expedition.begin('dungeon', id, { rift: true });
      expect(started.ok).toBe(true);
      const period = app.journey.s;
      const row = snap.contracts.daily.find((r: any) => r.id === 'rotation');
      expect(row.dungeonId).toBe(id);
      expect(recordJourneyWin(period, { receiptId: `win:${now}`, dungeonId: id, day: period.day, week: period.week }).ok).toBe(true);
      app.expedition.s.pending = null;
      expect(app.journey.claim('daily', 'rotation')).toMatchObject({ ok: true });
    }
  });

  test('서비스: 진행이 끝난 저장은 예전 회전 던전으로 균열을 연다', () => {
    for (const now of days(6)) {
      setSystemTime(now);
      const app = make(doneSave()); app.expedition.s.level = 80;
      const id = app.journey.snapshot().contracts.rotationDungeonId;
      expect(id).toBe(contractRows(normalizeJourney(null), now).rotationDungeonId);
      expect(app.expedition.begin('dungeon', id, { rift: true }).ok).toBe(true);
    }
  });
});

describe('주간 시즌 원정(프론티어)', () => {
  const weeks = Array.from({ length: 52 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i * 7, 12)));

  test('신규 저장: 한 해 모든 주가 열린 던전만 가리키고 출격 표식이 유효하다', () => {
    const open = visibleDungeonIds(freshSave());
    for (const date of weeks) {
      const f = weeklyFrontier(date, open), authored = weeklyFrontier(date);
      expect(open.has(f.routeId)).toBe(true);
      expect(f.effectId).toBe(authored.effectId); // 효과는 날짜로만 정해진다
      if (open.has(authored.routeId)) expect(f.routeId).toBe(authored.routeId);
      expect(frontierForRoute(f.routeId, date, open)?.routeId).toBe(f.routeId);
      expect(frontierFromSnapshot(frontierSnapshot(f))?.routeId).toBe(f.routeId);
      if (authored.routeId !== f.routeId) expect(frontierForRoute(authored.routeId, date, open)).toBeNull();
    }
  });

  test('같은 시즌에 열린 던전이 없으면 지역 1 기본 던전으로 대신한다', () => {
    const date = new Date(Date.UTC(2026, 3, 10, 12)), open = new Set(REGION1); // 밀물의 각성: 사막 환영 분지·재의 밀물 수문(모두 지역 2 이상)
    const f = weeklyFrontier(date, open);
    expect(f.routeId).toBe(FRONTIER_FALLBACK_ROUTE);
    expect(open.has(f.routeId)).toBe(true);
    expect(weeklyFrontier(date, new Set()).routeId).toBe(FRONTIER_FALLBACK_ROUTE);
  });

  test('진행이 끝난 저장은 예전과 같고, 시즌 밖 던전의 표식은 계속 거부한다', () => {
    const open = visibleDungeonIds(doneSave());
    for (const date of weeks) expect(weeklyFrontier(date, open)).toEqual(weeklyFrontier(date));
    const snapshot = frontierSnapshot(weeklyFrontier(weeks[3]))!;
    expect(frontierFromSnapshot({ ...snapshot, routeId: 'star_archive' })).toBeNull();
  });

  test('경제: 잠긴 지정 던전은 프론티어 효과를 못 받고 대신 가리킨 던전이 받는다(출격 표식 일치)', () => {
    const date = new Date(Date.UTC(2026, 3, 10, 12)); setSystemTime(date);
    const app = make(); app.expedition.s.level = 10;
    const f = weeklyFrontier(date, visibleDungeonIds(app.eco.s));
    expect(app.expedition.begin('dungeon', f.routeId, { depth: 'standard', expectedFrontier: frontierSnapshot(f) })).toMatchObject({ ok: true });
    const authored = weeklyFrontier(date).routeId;
    expect(app.expedition.dungeonAccess(authored).ok).toBe(false);
  });
});

describe('재료 안내(목표 장비)', () => {
  test('신규 저장: 안내하는 던전은 모두 열린 던전이고, 잠긴 재료는 던전 이름 없이 locked 로만 알린다', () => {
    const app = make(), open = visibleDungeonIds(app.eco.s);
    let locked = 0;
    for (const recipe of RECIPES.filter((r: any) => r.itemId)) {
      app.eco.s.journey.targetRecipeId = recipe.id;
      for (const material of app.journey.target().materials) {
        if (material.dungeonId) expect(open.has(material.dungeonId)).toBe(true);
        else if (material.locked) locked++;
        expect(Boolean(material.dungeonId) && material.locked).toBe(false);
      }
    }
    expect(locked).toBeGreaterThan(0);
  });

  test('진행이 끝난 저장: 재료마다 던전을 안내한다', () => {
    const app = make(doneSave());
    for (const recipe of RECIPES.filter((r: any) => r.itemId)) {
      app.eco.s.journey.targetRecipeId = recipe.id;
      for (const material of app.journey.target().materials) { expect(material.locked).toBe(false); expect(material.dungeonId).toBeTruthy(); }
    }
  });
});

test('일일 임무 정의는 그대로 오늘의 원정지 1개 + 재료 2개 보상', () => {
  const def = DAILY_CONTRACTS.find((d) => d.id === 'rotation')!;
  expect(def.rotationMaterials).toBe(2);
});
