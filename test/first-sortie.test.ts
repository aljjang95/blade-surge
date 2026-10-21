import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { dungeonLanding } from '../src/ui/dungeon-landing.js';
import { isFirstSortie, firstSortieModel } from '../src/ui/first-sortie.js';
import { Meta } from '../src/ui/meta.js';
import { stageDef } from '../src/data/stages.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
});
afterEach(() => {
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
});

const run = (id: string, outcome = 'victory') => ({ outcome, details: { route: { kind: 'dungeon', id, depth: 'standard', conquestId: null, riftId: null } } });

test('신규 계정만 첫 출격으로 판정하고 별·해금·던전 정복·최근 원정이 있으면 기존 계정으로 본다', () => {
  const fresh = new Economy();
  expect(isFirstSortie(fresh.s)).toBe(true);
  expect(isFirstSortie({ progress: { unlocked: 1, stars: { '1-1': 3 } } })).toBe(false);
  expect(isFirstSortie({ progress: { unlocked: 2, stars: {} } })).toBe(false);
  expect(isFirstSortie(fresh.s, { dungeonsCleared: 1 })).toBe(false);
  expect(isFirstSortie(fresh.s, { history: [run('glass_garden', 'defeat')] })).toBe(false);
  // 캠페인 기록만 있는 이력은 던전 기록이 아니므로 신규로 남는다.
  expect(isFirstSortie(fresh.s, { history: [{ outcome: 'defeat', details: { route: { kind: 'campaign', id: '1-1' } } }] })).toBe(true);
  expect(isFirstSortie(null as any)).toBe(false);
});

test('첫 출격 모델은 던전 카드·진행은 그대로 두고 추천만 캠페인 1-1 로 바꾼다', () => {
  const eco = new Economy(), expedition = new ExpeditionEconomy(eco);
  const base: any = dungeonLanding({ expedition, history: [], energy: eco.s.energy });
  const model: any = firstSortieModel(base, { energy: eco.s.energy });
  const stage = stageDef(1, 1);
  expect(base.dungeon.id).toBe('glass_garden');
  expect(model.campaign).toEqual({ ch: 1, st: 1 });
  expect(model.reason).toBe('campaign'); expect(model.label).toContain('첫 출격');
  expect(model.cost).toBe(stage.energy); expect(model.enoughEnergy).toBe(true); expect(model.unlocked).toBe(true);
  expect(model.name).toBe(stage.title); expect(model.depthLabel).toContain('1-1');
  expect(model.cards).toBe(base.cards); expect(model.total).toBe(base.total); expect(model.cleared).toBe(0);
  expect(model.recommendedId).toBe(base.recommendedId); expect(model.selectedId).toBeNull();
  expect(model.rewards.map((r: any) => r.id)).toEqual(['gold', 'gems']);
  expect(Object.isFrozen(model.campaign)).toBe(true);
  // 읽기 전용: 저장은 그대로다.
  expect(eco.s.progress).toEqual(new Economy().s.progress);
});

// 출석 팝업 지연: 신규 계정은 첫 전투 결과 전까지 모달을 띄우지 않고, 결과를 본 뒤 한 번만 띄운다. 기존 계정은 그대로 즉시 띄운다.
function autoPopupHarness(save: (eco: any) => void = () => {}) {
  const eco = new Economy(); save(eco);
  const shown: string[] = [];
  const meta: any = Object.create(Meta.prototype);
  Object.assign(meta, { eco, app: { mode: 'lobby', companionAgent: null, expedition: new ExpeditionEconomy(eco) }, showDaily: () => shown.push('daily') });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: () => null, getElementById: () => ({ classList: { contains: () => false } }) } });
  const restore = () => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); };
  return { eco, meta, shown, restore };
}

test('신규 계정은 부팅 직후 출석 팝업이 뜨지 않고 보상은 그대로 남는다', () => {
  const h = autoPopupHarness();
  try {
    expect(h.eco.dailyAvailable()).toBe(true);
    h.meta.autoPopups();
    expect(h.shown).toEqual([]); expect(h.meta.dailyDeferred).toBe(true);
    expect(h.eco.dailyAvailable()).toBe(true);   // 보상은 잃지 않는다
    expect(h.eco.claimDaily()).not.toBeNull();   // 이후에도 받을 수 있다
  } finally { h.restore(); }
});

test('첫 전투 결과를 본 뒤에는 미뤄 둔 출석 팝업이 뜬다', () => {
  const h = autoPopupHarness();
  try {
    h.meta.autoPopups(); expect(h.shown).toEqual([]);
    h.meta.combatResultSeen = true; h.meta.autoPopups();
    expect(h.shown).toEqual(['daily']); expect(h.meta.dailyDeferred).toBe(false);
  } finally { h.restore(); }
});

test('기존 계정(별 기록 또는 던전 정복 있음)은 지금처럼 부팅 직후 출석 팝업이 뜬다', () => {
  for (const save of [(eco: any) => { eco.s.progress.stars['1-1'] = 3; eco.s.progress.unlocked = 2; }]) {
    const h = autoPopupHarness(save);
    try { h.meta.autoPopups(); expect(h.shown).toEqual(['daily']); expect(h.meta.dailyDeferred).toBeFalsy(); } finally { h.restore(); }
  }
  const dungeon = autoPopupHarness();
  try {
    dungeon.meta.app.expedition.s.stats.dungeonWins = 1;
    dungeon.meta.autoPopups(); expect(dungeon.shown).toEqual(['daily']);
  } finally { dungeon.restore(); }
});
