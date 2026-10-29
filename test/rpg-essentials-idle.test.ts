// RPG 필수 E2: 방치 보급 + 복귀 보상(docs/RPG_ESSENTIALS.md).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { IDLE, idleQuote, claimIdle, normalizeIdle } from '../src/game/idle-rewards.js';
import { stageDef } from '../src/data/stages.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const H = 3600000, DAY = 86400000, T = Date.UTC(2026, 9, 29, 3);

describe('방치 보급 규칙', () => {
  test('시간 비례, 12시간 상한, 관문 0이면 없음', () => {
    const st = { since: T, comebackAt: 0 };
    expect(idleQuote(st, { unlocked: 1 }, T + 5 * H).ready).toBe(false);
    const q2: any = idleQuote(st, { unlocked: 31 }, T + 2 * H);
    expect(q2.minutes).toBe(120);
    expect(q2.rewards.gold).toBe(Math.floor(stageDef(3, 10).rewards.gold * IDLE.goldRunShare * 2));
    expect(q2.rewards.stones).toBe(1);
    const q30 = idleQuote(st, { unlocked: 31 }, T + 30 * H);
    expect(q30.minutes).toBe(IDLE.capHours * 60); expect(q30.capped).toBe(true);
    expect(q30.comeback).toBe(false);
  });
  test('수령하면 기준이 지금으로, 시계가 뒤로 가면 보상 없이 당긴다', () => {
    const st = { since: T, comebackAt: 0 };
    const r = claimIdle(st, { unlocked: 11 }, T + 3 * H);
    expect(r.ok).toBe(true); expect(st.since).toBe(T + 3 * H);
    expect(claimIdle(st, { unlocked: 11 }, T + 3 * H).ok).toBe(false);
    const back = claimIdle(st, { unlocked: 11 }, T);
    expect(back).toEqual({ ok: false, error: 'clock' }); expect(st.since).toBe(T);
  });
  test('7일 이상 비우면 복귀 보상, 30일 쿨다운, 신규(3관문 미만)는 제외', () => {
    const st = { since: T, comebackAt: 0 };
    expect(idleQuote(st, { unlocked: 2 }, T + 8 * DAY).comeback).toBe(false);
    const r: any = claimIdle(st, { unlocked: 20 }, T + 8 * DAY);
    expect(r.comeback).toBe(true); expect(r.rewards.gems).toBe(IDLE.comeback.rewards.gems);
    const again = claimIdle(st, { unlocked: 20 }, T + 16 * DAY);
    expect(again.comeback).toBe(false);
    expect(claimIdle(st, { unlocked: 20 }, T + 8 * DAY + 40 * DAY).comeback).toBe(true);
  });
  test('정규화: 잘못된 값은 기본값, 도입 전 저장은 fresh 시각부터', () => {
    expect(normalizeIdle({ since: -1, comebackAt: 'x' }, { since: 5, comebackAt: 0 })).toEqual({ since: 5, comebackAt: 0 });
    let clock = T;
    const eco: any = new Economy({ now: () => clock, storage: memory(), rng: () => .5 });
    const raw = JSON.parse(JSON.stringify(eco.s)); delete raw.idle;
    clock = T + 10 * DAY;
    const s = normalizeSave(raw, eco.fresh());
    expect(s.idle.since).toBe(T + 10 * DAY);
  });
});

describe('Economy 연결', () => {
  test('claimIdle 가 골드를 더하고 저장한다', () => {
    let clock = T;
    const eco: any = new Economy({ now: () => clock, storage: memory(), rng: () => .5 });
    eco.s.progress.unlocked = 11; const gold = eco.s.gold;
    expect(eco.claimIdle()).toBeNull();
    clock += 6 * H;
    expect(eco.idleQuote().notable).toBe(true);
    const r = eco.claimIdle();
    expect(r.minutes).toBe(360); expect(eco.s.gold).toBeGreaterThan(gold);
    expect(eco.idleQuote().ready).toBe(false);
  });
});
