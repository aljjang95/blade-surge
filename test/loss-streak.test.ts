import { describe, expect, test } from 'bun:test';
import { nextLossStreak, orderGrowthOptions, lossStageKey } from '../src/game/loss-streak.js';

const gear = { kind: 'gear', mode: 'equipBest' };
const enh = { kind: 'equipment', from: 1, to: 2 };
const risk = { kind: 'equipment', mode: 'risk' };
const summon = { kind: 'summon' };
const skill = { kind: 'skill' };

describe('같은 스테이지 연패 카운터', () => {
  test('같은 스테이지 패배는 누적하고 승리·다른 스테이지는 초기화한다', () => {
    const a = lossStageKey({ code: '1-3', difficultyId: 'story' }), b = lossStageKey({ code: '1-4', difficultyId: 'story' });
    let s = nextLossStreak(null, a, false);
    expect(s.n).toBe(1);
    s = nextLossStreak(s, a, false);
    expect(s.n).toBe(2);
    expect(nextLossStreak(s, b, false).n).toBe(1);
    expect(nextLossStreak(s, a, true).n).toBe(0);
  });
});

describe('연패 뒤 성장 카드 순서', () => {
  test('연패 2회 이상이면 장비 장착이 1순위, 강화, 소환 순', () => {
    const out = orderGrowthOptions([skill, summon, risk, enh, gear], 2);
    expect(out).toEqual([gear, risk, enh, summon, skill]);
  });
  test('더 좋은 장비가 없으면 강화가 1순위, 그다음 소환', () => {
    expect(orderGrowthOptions([skill, summon, enh], 3)).toEqual([enh, summon, skill]);
  });
  test('연패 1회 이하면 원래 순서를 그대로 둔다', () => {
    const list = [skill, summon, gear];
    expect(orderGrowthOptions(list, 1)).toBe(list);
    expect(orderGrowthOptions(list, 0)).toBe(list);
  });
});
