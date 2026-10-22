import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save-base.js';
import { stageDef } from '../src/data/stages.js';
import { campaignTown } from '../src/data/campaign-towns.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
  values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
});
afterEach(() => {
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
});

const KEY = 'bladesurge_save_v1';
const clear = (eco: any, ch: number, st: number, stars = 3) => eco.completeStage(stageDef(ch, st), stars);
const clearRegion = (eco: any, ch: number, upTo = 10) => { let last: any; for (let st = 1; st <= upTo; st++) last = clear(eco, ch, st); return last; };
const reload = () => new Economy() as any;

describe('지역 진행과 마을 해금', () => {
  test('새 저장은 1지역 마을만 열려 있다', () => {
    const eco: any = new Economy();
    expect(eco.campaignTownState()).toEqual({ latest: 1, current: 1, celebrated: 1 });
    expect(eco.campaignTownList().map((t: any) => t.unlocked)).toEqual([true, false, false, false, false, false]);
    expect(eco.campaignTownList()[1].unlockHint).toBe('1-10 클리어 시 해금');
    expect(eco.isUnlocked(2, 1)).toBe(false);
  });

  test('X-9 까지는 다음 지역이 닫혀 있고 X-10 을 처음 클리어하면 다음 지역과 그 마을이 한 번에 열린다', () => {
    const eco: any = new Economy();
    for (let st = 1; st <= 9; st++) expect(clear(eco, 1, st).regionUnlock).toBeNull();
    expect(eco.isUnlocked(2, 1)).toBe(false);
    expect(eco.campaignTownState().latest).toBe(1);
    const receipt = clear(eco, 1, 10);
    expect(receipt.first).toBe(true);
    expect(receipt.regionUnlock).toEqual({ chapter: 2, townId: 'emberforge', name: campaignTown(2).name, accent: campaignTown(2).accent });
    expect(eco.isUnlocked(2, 1)).toBe(true);
    expect(eco.campaignTownState()).toEqual({ latest: 2, current: 2, celebrated: 1 });
    // 축하는 한 번만 기록된다.
    expect(eco.markTownCelebrated(2)).toBe(true);
    expect(eco.markTownCelebrated(2)).toBe(false);
    expect(eco.campaignTownState().celebrated).toBe(2);
  });

  test('X-10 다시 클리어·소탕은 다시 해금하거나 첫 클리어 보상을 중복 지급하지 않는다', () => {
    const eco: any = new Economy();
    clearRegion(eco, 1, 9);
    const first = clear(eco, 1, 10);
    const gems = eco.s.gems, tickets = eco.s.tickets;
    expect(first.got.some((g: any) => g.k === 'gems' && g.n === stageDef(1, 10).rewards.firstGems)).toBe(true);
    eco.setCampaignTown(1);
    const again = clear(eco, 1, 10);
    expect(again.first).toBe(false);
    expect(again.regionUnlock).toBeNull();
    expect(again.got.some((g: any) => g.k === 'gems')).toBe(false);
    expect(eco.s.gems).toBe(gems);
    expect(eco.s.tickets).toBeGreaterThanOrEqual(tickets); // 보스 티켓 확률 보상만 가능
    // 다시 깬다고 마을 선택이 바뀌지 않는다.
    expect(eco.campaignTownState().current).toBe(1);
    expect(eco.sweep(stageDef(1, 10))?.regionUnlock ?? null).toBeNull();
    expect(eco.campaignTownState().current).toBe(1);
  });

  test('중간 보스 X-5 는 마을을 바꾸지 않는다', () => {
    const eco: any = new Economy();
    expect(clearRegion(eco, 1, 5).regionUnlock).toBeNull();
    expect(eco.campaignTownState()).toEqual({ latest: 1, current: 1, celebrated: 1 });
  });

  test('지역을 차례로 모두 깨면 마을 2~6 이 순서대로 열리고 마지막 지역은 더 열지 않는다', () => {
    const eco: any = new Economy();
    const unlocked: number[] = [];
    for (let ch = 1; ch <= 6; ch++) { const r = clearRegion(eco, ch); if (r.regionUnlock) unlocked.push(r.regionUnlock.chapter); }
    expect(unlocked).toEqual([2, 3, 4, 5, 6]);
    expect(eco.campaignTownState().latest).toBe(6);
    expect(eco.nextStage().code).toBe('6-10');
    expect(Object.keys(eco.s.progress.stars)).toHaveLength(60);
  });

  test('이전 마을을 다시 고를 수 있고 선택은 저장·재시작 뒤에도 유지된다. 새 지역이 열리면 최신 마을로 돌아간다', () => {
    const eco: any = new Economy();
    clearRegion(eco, 1); clearRegion(eco, 2);
    expect(eco.campaignTownState().current).toBe(3);
    expect(eco.setCampaignTown(4)).toBe(false); // 아직 닫힘
    expect(eco.setCampaignTown(0)).toBe(false); expect(eco.setCampaignTown(1.5)).toBe(false);
    expect(eco.setCampaignTown(1)).toBe(true);
    expect(reload().campaignTownState()).toEqual({ latest: 3, current: 1, celebrated: 1 });
    const again = reload();
    expect(again.setCampaignTown(2)).toBe(true);
    expect(reload().campaignTownState().current).toBe(2);
    // 새 지역(4)이 열리면 선택이 최신 마을로 바뀐다.
    const next = reload(); expect(clearRegion(next, 3).regionUnlock?.chapter).toBe(4);
    expect(next.campaignTownState().current).toBe(4);
    expect(reload().campaignTownState().current).toBe(4);
  });
});

describe('저장 이관: 기존 진행은 그대로, 마을만 따라온다', () => {
  const fresh = () => new Economy().fresh();
  const stars = (chapters: number) => Object.fromEntries(Array.from({ length: chapters * 10 }, (_, i) => [`${Math.floor(i / 10) + 1}-${(i % 10) + 1}`, 3]));

  test('마을 기록이 없는 기존 저장은 이미 해금한 가장 먼 마을을 보여 주고 축하를 다시 하지 않는다', () => {
    for (const [cleared, expected] of [[0, 1], [1, 2], [2, 3], [5, 6]] as const) {
      const legacy = { progress: { unlocked: cleared * 10 + 1, stars: stars(cleared), difficulty: 'story' }, gold: 777 };
      const saved = normalizeSave(legacy, fresh());
      expect(saved.campaignTown).toEqual({ current: expected, celebrated: expected });
      expect(saved.progress.unlocked).toBe(Math.min(60, cleared * 10 + 1));
      expect(saved.progress.stars).toEqual(stars(cleared));
      expect(saved.gold).toBe(777);
    }
  });

  test('별 기록만 있는 아주 오래된 저장도 별에서 해금을 복원하고 그 지역 마을을 연다', () => {
    const saved = normalizeSave({ progress: { stars: { '1-1': 3, '2-10': 2 } } }, fresh());
    expect(saved.progress.unlocked).toBe(21);
    expect(saved.campaignTown).toEqual({ current: 3, celebrated: 3 });
    expect(saved.progress.stars).toEqual({ '1-1': 3, '2-10': 2 });
  });

  test('30층 시절 저장(unlocked 31)과 잘못된 마을 값은 안전하게 보정된다', () => {
    expect(normalizeSave({ progress: { unlocked: 31 } }, fresh()).campaignTown).toEqual({ current: 4, celebrated: 4 });
    expect(normalizeSave({ progress: { unlocked: 11 }, campaignTown: { current: 6, celebrated: 6 } }, fresh()).campaignTown).toEqual({ current: 2, celebrated: 2 });
    expect(normalizeSave({ progress: { unlocked: 31 }, campaignTown: 'x' }, fresh()).campaignTown).toEqual({ current: 4, celebrated: 4 });
    expect(normalizeSave({ progress: { unlocked: 31 }, campaignTown: { current: 2, celebrated: 3 } }, fresh()).campaignTown).toEqual({ current: 2, celebrated: 3 });
  });

  test('보상 재화·별·해금 번호는 이관 전후가 같고 두 번 이관해도 결과가 같다', () => {
    const legacy = { progress: { unlocked: 26, stars: stars(2) }, gold: 4321, gems: 987, tickets: 4, sweep: 2 };
    const once = normalizeSave(legacy, fresh()), twice = normalizeSave(once, fresh());
    expect(twice).toEqual(once);
    expect([once.gold, once.gems, once.tickets, once.sweep]).toEqual([4321, 987, 4, 2]);
    expect(once.progress.unlocked).toBe(26);
  });

  test('실제 로드 경로: localStorage 의 기존 저장으로 시작하면 진행·마을이 복원되고 첫 로비에서 축하가 대기하지 않는다', () => {
    values.set(KEY, JSON.stringify({ progress: { unlocked: 21, stars: stars(2) }, gold: 555 }));
    const eco: any = new Economy();
    expect(eco.s.gold).toBe(555);
    expect(eco.campaignTownState()).toEqual({ latest: 3, current: 3, celebrated: 3 });
    expect(eco.nextStage().code).toBe('3-1');
    expect(Object.keys(eco.s.progress.stars)).toHaveLength(20);
  });
});
