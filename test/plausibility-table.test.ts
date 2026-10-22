import { describe, expect, test } from 'bun:test';
import { stageDef } from '../src/data/stages.js';
import { applyDifficulty, DIFFICULTIES } from '../src/game/difficulty.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { heroCombatProfile, parseStageCode, plausibility, plausibilityFor, validateFacts, KILL_RANKS, PLAUSIBILITY_TABLE } from '../src/shared/settlement.js';

// MMO P1-E: T1 개연성 표(tools/mmo-calibrate.mjs가 채움)의 형태와 기본값 관대함을 지킨다.
const T = PLAUSIBILITY_TABLE as any;
const posInt = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;

describe('MMO P1-E 개연성 표', () => {
  test('전역 값과 기본값은 양의 수다', () => {
    expect(typeof T.version).toBe('string');
    for (const k of ['dpsPerAtk', 'maxRevives']) expect(posInt(T[k])).toBe(true);
    for (const k of ['damageSlack', 'wallClockSlack']) expect(T[k]).toBeGreaterThan(0);
    expect(posInt(T.defaults.minClearMs)).toBe(true);
    for (const k of KILL_RANKS) expect(posInt(T.defaults.kills[k])).toBe(true);
    expect(posInt(T.defaults.summonedKills)).toBe(true);
    expect(posInt(T.defaults.maxRooms)).toBe(true);
  });

  test('모든 행: 키 형식, 양의 정수, 처치 상한 ≥ 1, 기본값이 행보다 관대하다', () => {
    const rows = Object.entries(T.stages as Record<string, any>);
    expect(rows.length).toBeGreaterThan(0);
    for (const [key, row] of rows) {
      const [code, difficulty] = key.split(':');
      expect(parseStageCode(code)).not.toBeNull();
      expect(Object.hasOwn(DIFFICULTIES, difficulty)).toBe(true);
      expect(posInt(row.minClearMs) && row.minClearMs >= 10000).toBe(true);
      for (const k of KILL_RANKS) {
        expect(posInt(row.kills[k])).toBe(true);
        expect(T.defaults.kills[k]).toBeGreaterThanOrEqual(row.kills[k]);
      }
      expect(posInt(row.summonedKills)).toBe(true);
      expect(posInt(row.maxRooms)).toBe(true);
      expect(T.defaults.summonedKills).toBeGreaterThanOrEqual(row.summonedKills);
      expect(T.defaults.maxRooms).toBeGreaterThanOrEqual(row.maxRooms);
      // 최소 클리어 시간은 낮을수록 관대하다.
      expect(T.defaults.minClearMs).toBeLessThanOrEqual(row.minClearMs);
    }
  });

  test('전형적인 정상 1-1 AUTO 클리어(권장 1레벨)는 ok', () => {
    const stage = applyDifficulty(stageDef(1, 1), DIFFICULTIES.story);
    const eco = EconomyCore.fromState(null, { now: () => 0, rng: () => 0.5 });
    const profile = heroCombatProfile(eco, eco.s.selected)!;
    const limits = plausibilityFor(stage);
    // tools/mmo-calibrate.mjs 관측치 근처: 약 165초, 잡몹 186·엘리트 5·보스 1, 방 11, 공격력 대비 초당 피해 약 6배.
    const elapsedMs = Math.max(165000, limits.minClearMs + 1000);
    const facts = { win: true, elapsedMs, kills: { normal: 186, elite: 5, boss: 1 }, summonedKills: { normal: 4, elite: 0, boss: 0 },
      roomsCleared: 11, damageDealt: Math.round(profile.atk * 6.5 * elapsedMs / 1000), stars: 3, fullClear: true };
    expect(validateFacts(facts)).toBeNull();
    expect(plausibility(stage, facts, { heroAtk: profile.atk, maxHp: profile.maxHp, wallMs: elapsedMs })).toEqual({ verdict: 'ok', issues: [] });
    // 같은 사실에서 처치 수만 상한을 넘기면 거절된다(표가 너무 느슨하지 않은지).
    const bloated = { ...facts, kills: { ...facts.kills, normal: limits.kills.normal + 1 } };
    expect(plausibility(stage, bloated, { heroAtk: profile.atk, maxHp: profile.maxHp, wallMs: elapsedMs }).verdict).toBe('rejected');
  });
});
