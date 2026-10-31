// RPG 필수 E3: 신규 7일 여정(docs/RPG_ESSENTIALS.md).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { NEWBIE_MISSIONS, NEWBIE_FINAL, newbieView, claimNewbie, normalizeNewbie } from '../src/game/newbie-event.js';
import { periodAt } from '../src/game/journey-core.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const DAY = 86400000, T = Date.UTC(2026, 9, 29, 3);

describe('7일 여정 규칙', () => {
  test('21개, 하루 3개, 날짜마다 열림', () => {
    expect(NEWBIE_MISSIONS.length).toBe(21);
    for (let d = 1; d <= 7; d++) expect(NEWBIE_MISSIONS.filter((x: any) => x.day === d).length).toBe(3);
    const st = { start: periodAt(T).day, claimed: [], final: false };
    const save: any = { progress: { unlocked: 40 }, quests: { kills: 5000, enh: 50 }, totalPulls: 20, daily: { day: 7 }, heroes: { a: { level: 40 } }, endgame: { tower: { best: 5 } }, journey: { claimedSteps: ['a', 'b'] } };
    const v1 = newbieView(st, save, T);
    expect(v1.dayNo).toBe(1); expect(v1.claimable).toBe(3);
    expect(claimNewbie(st, save, T, 'd2a')).toEqual({ ok: false, error: 'locked' });
    expect(claimNewbie(st, save, T, 'd1a').ok).toBe(true);
    expect(claimNewbie(st, save, T, 'd1a')).toEqual({ ok: false, error: 'claimed' });
    const v7 = newbieView(st, save, T + 6 * DAY);
    expect(v7.rows.every((x: any) => x.unlocked)).toBe(true);
    for (const x of NEWBIE_MISSIONS) claimNewbie(st, save, T + 6 * DAY, x.id);
    expect(newbieView(st, save, T + 6 * DAY).finalReady).toBe(true);
    expect(claimNewbie(st, save, T + 6 * DAY, 'final')).toEqual({ ok: true, rewards: { ...NEWBIE_FINAL } });
    expect(claimNewbie(st, save, T + 6 * DAY, 'final').ok).toBe(false);
  });
  test('미달이면 incomplete, 14일 뒤 닫힘', () => {
    const st = { start: periodAt(T).day, claimed: [], final: false };
    const save: any = { progress: { unlocked: 2 } };
    expect(claimNewbie(st, save, T, 'd1a')).toEqual({ ok: false, error: 'incomplete' });
    expect(newbieView(st, save, T + 14 * DAY).open).toBe(false);
    expect(claimNewbie(st, save, T + 14 * DAY, 'd1a')).toEqual({ ok: false, error: 'closed' });
  });
  test('정규화: 모르는 id 제거, 중복 제거', () => {
    expect(normalizeNewbie({ start: 3, claimed: ['d1a', 'd1a', 'zzz'], final: 'yes' }, { start: 9 })).toEqual({ start: 3, claimed: ['d1a'], final: false });
    expect(normalizeNewbie(undefined, { start: 9 }).start).toBe(9);
  });
});

test('Economy 연결: 수령하면 보상과 저장', () => {
  const eco: any = new Economy({ now: () => T, storage: memory(), rng: () => .5 });
  eco.s.progress.unlocked = 4; const gold = eco.s.gold;
  const got = eco.claimNewbie('d1a');
  expect(got).not.toBeNull(); expect(eco.s.gold).toBe(gold + 5000);
  expect(eco.claimNewbie('d1a')).toBeNull();
});
