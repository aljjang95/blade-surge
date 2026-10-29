// RPG 필수 E4: 업적(docs/RPG_ESSENTIALS.md).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ACHIEVEMENTS, achievementRows, claimAchievement, normalizeAchievements, importedAchievements } from '../src/game/achievements.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

describe('업적', () => {
  test('단계는 오름차순이고 차례로만 받는다', () => {
    for (const a of ACHIEVEMENTS) for (let i = 1; i < a.tiers.length; i++) expect(a.tiers[i].target).toBeGreaterThan(a.tiers[i - 1].target);
    const st: any = { claimed: {} }, stats: any = { kills: 4000 };
    expect(claimAchievement(st, stats, 'slayer').ok).toBe(true);
    expect(claimAchievement(st, stats, 'slayer').ok).toBe(true);
    expect(claimAchievement(st, stats, 'slayer')).toEqual({ ok: false, error: 'incomplete' });
    expect(st.claimed.slayer).toBe(2);
    expect(claimAchievement(st, stats, 'nope')).toEqual({ ok: false, error: 'unknown' });
  });
  test('모든 단계를 받으면 done', () => {
    const st: any = { claimed: { wayfarer: 2 } };
    const row = achievementRows(st, { steps: 9 } as any).find((r) => r.id === 'wayfarer')!;
    expect(row.done).toBe(true); expect(row.ready).toBe(false);
  });
  test('정규화는 모르는 id·잘못된 값·초과 단계를 거른다', () => {
    expect(normalizeAchievements({ claimed: { slayer: 99, x: 1, conqueror: -1 } })).toEqual({ claimed: { slayer: 6 } });
    expect(normalizeAchievements(null)).toEqual({ claimed: {} });
  });
  test('가져오기는 이미 닿은 단계를 받은 것으로 친다', () => {
    const st = importedAchievements({ kills: 3500, cleared: 0 } as any);
    expect(st.claimed).toEqual({ slayer: 2 });
    expect(claimAchievement(st, { kills: 3500 } as any, 'slayer').ok).toBe(false);
  });
  test('Economy 연결', () => {
    const eco: any = new Economy({ now: () => Date.UTC(2026, 9, 29, 3), storage: memory(), rng: () => .5 });
    eco.s.quests.kills = 600; const gold = eco.s.gold;
    expect(eco.achievementClaimable()).toBeGreaterThanOrEqual(1);
    expect(eco.claimAchievement('slayer')).not.toBeNull();
    expect(eco.s.gold).toBe(gold + 10000);
    expect(eco.claimAchievement('slayer')).toBeNull();
  });
});
