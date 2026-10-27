import { expect, test } from 'bun:test';
import { enhanceStageTiming, enhanceOutcome, ENHANCE_MILESTONES } from '../src/ui/enhance-stage.js';

test('긴장 구간은 0.8~2.0초, 단계가 높을수록 길고 망치질은 점점 빨라진다', () => {
  const low = enhanceStageTiming(0), high = enhanceStageTiming(19);
  expect(low.tension).toBeCloseTo(0.8); expect(high.tension).toBeCloseTo(2.0);
  for (let lv = 1; lv <= 19; lv++) expect(enhanceStageTiming(lv).tension).toBeGreaterThanOrEqual(enhanceStageTiming(lv - 1).tension);
  const gaps = high.beats.slice(1).map((t, i) => t - high.beats[i]!);
  for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]! + 1e-9);
  expect(high.beats.at(-1)!).toBeLessThan(high.tension);
  expect(high.beats.length).toBeGreaterThan(low.beats.length);
});

test('연속 강화는 짧은 판, 움직임 줄이기는 박자 없이 0.3초', () => {
  expect(enhanceStageTiming(15, { quick: true }).tension).toBeLessThan(0.8);
  expect(enhanceStageTiming(15, { reduced: true })).toEqual({ tension: 0.3, beats: [] });
});

test('결과 종류와 구간 돌파(+10·13·15·20 성공만)', () => {
  expect(ENHANCE_MILESTONES).toEqual([10, 13, 15, 20]);
  expect(enhanceOutcome({ success: true, enh: 10 })).toEqual({ kind: 'success', milestone: true });
  expect(enhanceOutcome({ success: true, enh: 11 })).toEqual({ kind: 'success', milestone: false });
  expect(enhanceOutcome({ success: false, enh: 12, down: true })).toEqual({ kind: 'down', milestone: false });
  expect(enhanceOutcome({ success: false, enh: 9 })).toEqual({ kind: 'fail', milestone: false });
  expect(enhanceOutcome({ success: false, destroyed: true, enh: 15 })).toEqual({ kind: 'destroy', milestone: false });
});
