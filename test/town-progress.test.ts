import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { TownService } from '../src/game/town-service.js';
import { TOWN_REQUESTS } from '../src/data/towns.js';
import { recordTownRun, rotateTownRequests, townRequestDay, townRunAmounts } from '../src/game/town-progress.js';

const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => { values = new Map(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } }); });
afterEach(() => { if (old) Object.defineProperty(globalThis, 'localStorage', old); else Reflect.deleteProperty(globalThis, 'localStorage'); });
const make = () => { const eco = new Economy(); return { eco, x: new ExpeditionEconomy(eco), towns: new TownService(eco) }; };

test('모든 마을 의뢰 목표는 원정 정산이 아는 종류다', () => {
  const known = new Set(['dungeon', 'field', 'elite', 'treasure', 'kills']);
  for (const request of TOWN_REQUESTS) expect(known.has(request.target.type)).toBe(true);
});

test('던전과 필드를 구분하고 잘못된 수는 0으로 본다', () => {
  expect(townRunAmounts({ target: 'glass_garden', kills: 40, treasureRooms: 1, elites: 2 })).toEqual({ dungeon: 1, elite: 2, treasure: 1, kills: 40 });
  expect(townRunAmounts({ target: 'windmeadow', kills: -3, treasureRooms: 1.5 })).toEqual({ field: 1, elite: 0, treasure: 0, kills: 0 });
  expect(townRunAmounts({})).toEqual({});
});

test('수락한 의뢰는 실제 원정 승리 정산으로 진행되고 보상을 받을 수 있다', () => {
  const { eco, x, towns } = make();
  expect(towns.acceptRequest('oathhold', 'oathhold_daily_clear').ok).toBe(true);
  expect(towns.claimRequest('oathhold', 'oathhold_daily_clear').reason).toBe('incomplete');
  const begun = x.begin('dungeon', 'glass_garden');
  expect(begun.ok).toBe(true);
  expect(x.settle(begun.ticket, { win: true, kills: 30 }).ok).toBe(true);
  // 같은 티켓을 다시 정산해도 두 번 세지 않는다.
  expect(x.settle(begun.ticket, { win: true, kills: 30 }).ok).toBe(false);
  expect(eco.s.towns.requests.progress.oathhold_daily_clear).toBe(1);
  const gold = eco.s.gold;
  expect(towns.claimRequest('oathhold', 'oathhold_daily_clear').ok).toBe(true);
  expect(eco.s.gold).toBe(gold + 450);
  // 저장을 다시 읽어도 완료가 남는다.
  const reload = make();
  expect(reload.towns.requests('oathhold').find(r => r.id === 'oathhold_daily_clear')?.completed).toBe(true);
});

test('패배는 진행을 올리지 않는다', () => {
  const { eco, x, towns } = make();
  towns.acceptRequest('oathhold', 'oathhold_daily_clear');
  const begun = x.begin('dungeon', 'glass_garden');
  expect(x.settle(begun.ticket, { win: false }).ok).toBe(true);
  expect(eco.s.towns.requests.progress.oathhold_daily_clear || 0).toBe(0);
});

test('반복 의뢰는 보상 뒤 다시 수락할 수 있고 일일 의뢰는 다음 날 다시 열린다', () => {
  const { eco, towns } = make();
  const state = eco.s.towns;
  towns.acceptRequest('oathhold', 'oathhold_repeat_gather');
  recordTownRun(state, { target: 'windmeadow' });
  expect(towns.claimRequest('oathhold', 'oathhold_repeat_gather').ok).toBe(true);
  expect(towns.requests('oathhold').find(r => r.id === 'oathhold_repeat_gather')).toMatchObject({ completed: false, accepted: false, progress: 0 });
  expect(towns.acceptRequest('oathhold', 'oathhold_repeat_gather').ok).toBe(true);

  const now = Date.UTC(2026, 9, 28, 0, 0); // 한국 09:00
  state.requests.day = townRequestDay(now);
  state.requests.completed = ['oathhold_daily_clear'];
  expect(rotateTownRequests(state, now + 60 * 60 * 1000)).toBe(false);
  // 다음 날 한국 05:00(UTC 20:00)이 지나면 비워진다.
  expect(rotateTownRequests(state, Date.UTC(2026, 9, 28, 20, 1))).toBe(true);
  expect(state.requests.completed).toEqual([]);
  expect(state.requests.active).toContain('oathhold_repeat_gather');
});

test('이야기는 지금 마을의 현재 장만 진행하고 장이 넘어가면 새로 센다', () => {
  const { eco, towns } = make();
  const state = eco.s.towns;
  recordTownRun(state, { target: 'glass_garden' });
  expect(towns.advanceStory('oathhold').ok).toBe(true);
  expect(state.story.oathhold.progress).toEqual({});
  recordTownRun(state, { target: 'glass_garden' });
  expect(towns.advanceStory('oathhold').reason).toBe('incomplete');
  recordTownRun(state, { target: 'windmeadow' });
  expect(towns.advanceStory('oathhold').ok).toBe(true);
  // 잠긴 마을 이야기는 오르지 않는다.
  expect(state.story.emberport.progress).toEqual({});
});

test('예전 저장에 완료로 남은 반복 의뢰는 다시 수락할 수 있다', () => {
  const { eco, towns } = make();
  eco.s.towns.requests.completed = ['oathhold_repeat_gather'];
  expect(towns.acceptRequest('oathhold', 'oathhold_repeat_gather').ok).toBe(true);
});
