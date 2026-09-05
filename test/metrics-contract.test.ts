import { expect, test } from 'bun:test';
import { assessMetrics, compareMetrics } from '../tools/metrics-contract.mjs';

const valid = { errors: 0, bootMs: 1000, floorClearSec: 200, killsPerFloor: 100, maxAliveSeen: 20, dropsPerFloor: 12, longestDryStreakSec: 20, hitTakenRatio: 0.2, avgFrameMs: 10, p95FrameMs: 30, rhythmBeats: 7, drawCalls: 300, _won: true };
test('지표가 좋아도 패배 또는 승리 증거가 없으면 FAIL', () => {
  expect(assessMetrics(valid)).toEqual([]);
  expect(assessMetrics({ ...valid, _won: false })).toContain('floor-not-won');
  const { _won, ...old } = valid;
  expect(assessMetrics(old)).toContain('floor-not-won');
});
test('누락/NaN 표본을 비교에서 건너뛰지 않는다', () => {
  expect(compareMetrics(valid, { ...valid, drawCalls: NaN })).toContain('drawCalls');
  expect(compareMetrics({}, valid).length).toBeGreaterThanOrEqual(12);
  expect(assessMetrics({ ...valid, errors: NaN })).toContain('errors');
});
test('서로 다른 시드 또는 시드 없는 이전 표본은 동일 조건으로 승인하지 않는다', () => {
  expect(compareMetrics({ ...valid, _seed: 42 }, { ...valid, _seed: 42 })).toEqual([]);
  expect(compareMetrics({ ...valid, _seed: 42 }, { ...valid, _seed: 43 })).toContain('seed-mismatch');
  expect(compareMetrics(valid, { ...valid, _seed: 42 })).toContain('seed-mismatch');
  expect(compareMetrics(valid, valid)).toContain('seed-mismatch');
});
test('비교 모드도 패배·시간초과·절대 밴드 이탈을 승인하지 않는다', () => {
  const base = { ...valid, _seed: 42 };
  expect(compareMetrics(base, { ...base, _won: false })).toContain('floor-not-won');
  expect(compareMetrics(base, { ...base, floorClearSec: 600 })).toContain('floorClearSec');
  expect(compareMetrics(base, { ...base, errors: 1 })).toContain('errors');
});
