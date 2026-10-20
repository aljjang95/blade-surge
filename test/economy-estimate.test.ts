import { describe, expect, test } from 'bun:test';
import { GRADE_UP_COST } from '../src/data/hero-grades.js';
import { lootTable } from '../src/data/loot-tables.js';
import { cashOnlyGates, estimate, gemsForGold, gemsForStones, perRun, shardsPerPull, simulate, startingState } from '../tools/economy-estimate.mjs';

// 무과금(현금 0원) 초월 경로 기준: 기본 시나리오(하루 30분)에서 SR→SSR 초월이 이 일수 안에 끝나야 한다.
const MAX_SSR_DAYS = 21;

describe('무과금 초월 경제 추정', () => {
  test('현금 전용 관문이 없다: 조각·초월석·골드 모두 현금 없이 얻는 경로가 있다', () => {
    const gate = cashOnlyGates('mage');
    expect(gate.gates).toEqual([]);
    expect(gate.hasCashOnlyGate).toBe(false);
    expect(estimate({ minutesList: [30], strategies: ['ch1'] }).cashOnlyGate).toBe(false);
  });

  test('보고서가 실제 데이터 모듈의 초월 비용을 그대로 쓴다', () => {
    const report = estimate({ minutesList: [30], strategies: ['ch1'] });
    expect(report.hero.upCost).toEqual(GRADE_UP_COST);
    const steps = report.scenarios[0].steps;
    expect(steps.map((s: { to: string }) => s.to)).toEqual(['SSR', 'SSSR']);
    expect(startingState().gems).toBeGreaterThan(0);
  });

  for (const strategy of ['ch1', 'top']) {
    test('기본 시나리오(30분/일, ' + strategy + '): SSR·SSSR 초월 일수가 유한하고 SSR은 ' + MAX_SSR_DAYS + '일 이내', () => {
      const r = simulate({ minutesPerDay: 30, strategy });
      expect(r.finished).toBe(true);
      expect(Number.isFinite(r.daysTo.SSR)).toBe(true);
      expect(Number.isFinite(r.daysTo.SSSR)).toBe(true);
      expect(r.daysTo.SSR).toBeLessThanOrEqual(MAX_SSR_DAYS);
      expect(r.daysTo.SSSR).toBeGreaterThan(r.daysTo.SSR);
    });
  }

  test('하루 60분이 30분보다 늦지 않다', () => {
    for (const strategy of ['ch1', 'top']) {
      const slow = simulate({ minutesPerDay: 30, strategy }), fast = simulate({ minutesPerDay: 60, strategy });
      expect(fast.daysTo.SSR).toBeLessThanOrEqual(slow.daysTo.SSR);
      expect(fast.daysTo.SSSR).toBeLessThanOrEqual(slow.daysTo.SSSR);
    }
  });

  test('스테이지 1회 기댓값이 드랍 표와 맞는다(1-1 보스·정예·일반 처치 수 × 확률)', () => {
    const run = perRun(1), table = (rank: string) => lootTable(1, rank);
    const expected = run.kills.boss * table('boss').heroShards.chance + run.kills.elite * table('elite').heroShards.chance + run.kills.normal * table('normal').heroShards.chance;
    expect(run.kills.boss).toBe(1);
    expect(run.heroShards).toBeCloseTo(expected, 9);
    expect(perRun(60).heroShards).toBeGreaterThan(run.heroShards);
  });

  test('소환으로 얻는 SR 영웅 1명의 조각 기대값은 SR 확률 × 영웅 몫 × 중복 조각이다', () => {
    const sp = shardsPerPull('mage');
    expect(sp.perSingle).toBeCloseTo(sp.share.SR * sp.heroShare * 10, 9);
    expect(sp.perTen).toBeGreaterThan(sp.perSingle * 10);
  });

  test('보석 환산은 상점 상품 가격과 일치한다', () => {
    expect(gemsForStones(10).gems).toBe(900);
    expect(gemsForStones(11).gems).toBe(1800);
    expect(gemsForGold(500000).gems).toBe(1800);
    expect(gemsForGold(0).gems).toBe(0);
  });
});
