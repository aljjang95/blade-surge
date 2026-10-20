import { describe, expect, test } from 'bun:test';
import { summarizeSamples, THRESHOLDS } from '../tools/combat-pose-qa.mjs';

// 표본: [frame, t, 손-무기, 보조장비, 머리 여유, 몸통 관통, 팔 관통, 팔 구간, spec 머리 여유] (cm)
const ok = [0, 0, 3.8, 0, 12, 0, 0, -1, 6];

describe('전투 자세 QA 판정', () => {
  test('기준값은 brief A2 그대로다(손 8, 머리 겹침 0, 몸통·팔 4cm)', () => {
    expect({ ...THRESHOLDS }).toEqual({ handCm: 8, headOverlapCm: 0, torsoCm: 4, armCm: 4 });
  });
  test('모든 표본이 기준 안이면 통과하고 최대값을 요약한다', () => {
    const s = summarizeSamples([ok, [1, .1, 7.9, 0, 0.1, 4, 4, -1, 0]]);
    expect(s.ok).toBe(true);
    expect(s.max.hw).toBe(7.9);
    expect(s.max.headClear).toBe(0.1);
    expect(s.score).toBeLessThanOrEqual(1);
  });
  test('각 지표의 초과를 따로 잡고 최악 표본 위치를 남긴다', () => {
    const s = summarizeSamples([ok, [1, .2, 8.1, 0, 12, 0, 0, -1, 6], [2, .4, 3, 0, -2.5, 4.1, 4.2, 2, -3]]);
    expect(s.fail).toEqual({ hw: true, ho: false, head: true, torso: true, arm: true });
    expect(s.ok).toBe(false);
    const worst = s.worst as Record<string, { i: number; frame: number; value: number }>;
    expect(worst.hw).toMatchObject({ i: 1, frame: 1 });
    expect(worst.headClear).toMatchObject({ i: 2, value: -2.5 });
    expect(worst.arm.i).toBe(2);
    expect(s.score).toBeGreaterThan(1);
  });
  test('표본이 없으면 위반으로 세지 않는다', () => {
    const s = summarizeSamples([]);
    expect(s.samples).toBe(0);
    expect(s.ok).toBe(true);
  });
});
