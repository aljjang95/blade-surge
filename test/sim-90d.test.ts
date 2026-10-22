import { expect, test } from 'bun:test';
import { simulate, run90d, assertBands, stageNeed, towerNeed, PERSONAS } from '../tools/sim-90d.mjs';

test('90일 시뮬레이터는 같은 시드에서 같은 결과를 낸다(결정적)', () => {
  const a = simulate('mid', 3, { days: 21 }), b = simulate('mid', 3, { days: 21 });
  expect(a).toEqual(b);
  expect(simulate('mid', 4, { days: 21 }).days.at(-1)).not.toEqual(undefined);
});

test('요구 전투력 모델은 관문·난이도·탑 층이 오를수록 커진다', () => {
  for (let i = 2; i <= 60; i++) expect(stageNeed(i)).toBeGreaterThan(stageNeed(i - 1));
  expect(stageNeed(30, 'hell')).toBeGreaterThan(stageNeed(30, 'nightmare'));
  expect(stageNeed(30, 'nightmare')).toBeGreaterThan(stageNeed(30, 'adept'));
  expect(towerNeed(100)).toBeGreaterThan(towerNeed(50));
  expect(Object.keys(PERSONAS)).toEqual(['light', 'mid', 'hardcore']);
});

test('3 페르소나 90일 진행이 DoD 밴드 안에 든다(시드 3)', () => {
  const report = run90d({ days: 90, seeds: 3 });
  expect(assertBands(report)).toEqual([]);
  const mid = report.summary.mid;
  // 미드: 스토리 1주 안, 90일에도 지옥·탑에 남은 진행이 있다
  expect(mid.milestones.story_6_10.p50).toBeLessThanOrEqual(10);
  expect(mid.checkpoints.D90.tower.p50).toBeLessThan(210);
}, 60000);
