// RPG 필수 E1: 알림 배지 집계와 출석 05:00 KST 경계(docs/RPG_ESSENTIALS.md).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { journeyClaimable, towerChestReady, gearDexClaimable } from '../src/game/reward-badges.js';
import { GEAR_DEX_MILESTONES } from '../src/game/gear-dex.js';
import { ITEM_BY_ID } from '../src/data/items.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const H = 3600000;

describe('배지 집계', () => {
  test('여정 단계·일일·주간 의뢰의 ready 만 센다', () => {
    const snap = { steps: [{ ready: true }, { ready: false }], contracts: { daily: [{ ready: true }, { ready: true }], weekly: [{ ready: false }] } };
    expect(journeyClaimable(snap)).toBe(3);
    expect(journeyClaimable(null)).toBe(0);
    expect(journeyClaimable({ steps: [], contracts: {} })).toBe(0);
  });
  test('탑 상자는 개방 + ready 일 때만', () => {
    expect(towerChestReady({ unlocked: true, chest: { ready: true } })).toBe(true);
    expect(towerChestReady({ unlocked: false, chest: { ready: true } })).toBe(false);
    expect(towerChestReady({ unlocked: true, chest: { ready: false } })).toBe(false);
    expect(towerChestReady(undefined)).toBe(false);
  });
  test('도감 마일스톤: 달성했고 안 받은 것만, 받으면 0', () => {
    const eco: any = new Economy({ now: () => Date.UTC(2026, 9, 29, 3), storage: memory(), rng: () => .5 });
    const hero = eco.s.selected;
    const kin = GEAR_DEX_MILESTONES.find((m) => m.id === 'kin5')!;
    expect(gearDexClaimable(eco.s, [hero])).toBe(0);
    eco.s.gearDex = { v: 1, drop: {}, kin: { [hero]: Object.keys(ITEM_BY_ID).slice(0, kin.need) }, claimed: {} };
    const n = gearDexClaimable(eco.s, [hero]);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(eco.gearDexClaim(hero, 'kin5').ok).toBe(true);
    expect(gearDexClaimable(eco.s, [hero])).toBe(n - 1);
  });
});

describe('출석 하루 경계 = 05:00 KST (20:00 UTC 전날)', () => {
  test('04:59 KST 와 05:00 KST 사이에서만 새로 열린다', () => {
    let clock = Date.UTC(2026, 9, 28, 19, 0); // 10-29 04:00 KST
    const eco: any = new Economy({ now: () => clock, storage: memory(), rng: () => .5 });
    expect(eco.claimDaily()).not.toBeNull();
    clock = Date.UTC(2026, 9, 28, 19, 59); // 04:59 KST
    expect(eco.dailyAvailable()).toBe(false);
    clock = Date.UTC(2026, 9, 28, 20, 0); // 05:00 KST
    expect(eco.dailyAvailable()).toBe(true);
    expect(eco.claimDaily()?.idx).toBe(1);
    clock += 20 * H; // 다음 날 01:00 KST — 아직 같은 날
    expect(eco.dailyAvailable()).toBe(false);
  });
});
