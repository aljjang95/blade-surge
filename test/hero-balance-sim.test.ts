import { expect, test } from 'bun:test';
import { loadCombatFlowRuntime } from '../tools/combat-flow-sim.mjs';
import { runHeroBalance } from '../tools/hero-balance-sim.mjs';

const runtime = await loadCombatFlowRuntime();
// 전체 영웅은 CLI(bun tools/hero-balance-sim.mjs --assert)로 재고, 테스트는 werewolf·barbarian 두 영웅만 빠르게 잰다.
const options = { heroes: ['werewolf', 'barbarian'], seeds: 8 };

test('늑대인간 족장은 광전사 대비 순환 추정이 허용 범위이고 고유 두 스킬이 실제 피해를 낸다', () => {
  const report: any = runHeroBalance(runtime, options);
  const w = report.results.werewolf, b = report.results.barbarian;
  for (const id of ['blood_howl', 'moonlit_hunt']) {
    const row = w.skills.find((s: any) => s.id === id);
    expect(row.cast).toBe(true);
    expect(row.A).toBeGreaterThan(0);
    expect(row.B).toBeGreaterThan(0);
  }
  for (const sit of ['A', 'B']) {
    const ratio = w.cycle[sit].total / b.cycle[sit].total;
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(ratio).toBeLessThanOrEqual(1.12);
  }
  expect(w.buffs.blood_howl.A).toBeGreaterThan(1);
  expect(report.verdict.reasons).toEqual([]);
  expect(report.verdict.pass).toBe(true);
});

test('같은 설정으로 두 번 재면 결과가 완전히 같다(결정성)', () => {
  const first = JSON.stringify(runHeroBalance(runtime, options));
  const second = JSON.stringify(runHeroBalance(runtime, options));
  expect(second).toBe(first);
});
