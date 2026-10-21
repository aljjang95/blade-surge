import { expect, test } from 'bun:test';
import { bestRarity, revealPlan, revealTone, tenPullStatus } from '../src/ui/reveal-plan.js';
import { GACHA } from '../src/data/shop.js';

test('최고 등급이 연출 색과 빔 수를 정한다', () => {
  expect(bestRarity([{ rar: 'R' }, { rar: 'SR' }])).toBe('SR');
  expect(bestRarity([{ rar: 'R' }, { rar: 'SSR' }, { rar: 'SR' }])).toBe('SSR');
  expect(bestRarity([])).toBe('R');
  expect(revealTone('SSR').beams).toBeGreaterThan(revealTone('SR').beams);
  expect(revealTone('SR').beams).toBeGreaterThan(revealTone('R').beams);
  expect(revealTone('??').color).toBe(revealTone('R').color);
});

test('뒤집기는 낮은 등급부터 짧은 간격으로, 높은 등급은 뜸을 두고 마지막에 온다', () => {
  const results = [{ rar: 'SSR' }, ...Array.from({ length: 8 }, () => ({ rar: 'R' })), { rar: 'SR' }];
  const plan = revealPlan(results);
  expect(plan.cards).toHaveLength(10);
  const atR = plan.cards.filter((c: any) => c.rar === 'R').map((c: any) => c.at);
  expect(Math.max(...atR)).toBeLessThan(plan.cards[9].at);
  expect(plan.cards[9].at).toBeLessThan(plan.cards[0].at);
  // R 카드끼리는 150ms 간격 안팎의 짧은 스태거, 전체는 5초 안에 끝난다(기존 4.1초+SSR 예고)
  const sorted = [...atR].sort((a, b) => a - b);
  expect(sorted[1] - sorted[0]).toBeLessThanOrEqual(200);
  expect(plan.doneAt).toBeLessThan(5000);
  // 등급 예고는 SR·SSR만, 뒤집기보다 앞선다
  expect(plan.cards[1].hintAt).toBeNull();
  expect(plan.cards[0].hintAt).toBeLessThan(plan.cards[0].at);
  expect(plan.cards[9].hintAt).toBeLessThan(plan.cards[9].at);
});

test('결과 배열과 객체를 바꾸지 않는다', () => {
  const results = Object.freeze([Object.freeze({ rar: 'SR' }), Object.freeze({ rar: 'R' })]);
  expect(() => revealPlan(results)).not.toThrow();
  expect(revealPlan([]).doneAt).toBe(0);
});

test('다시 10회 버튼은 부족한 재화량을 알려 준다', () => {
  expect(tenPullStatus({ gems: 2700, tickets: 0 }, GACHA)).toMatchObject({ ok: true, need: 0 });
  expect(tenPullStatus({ gems: 0, tickets: 10 }, GACHA)).toMatchObject({ ok: true, useTicket: true });
  expect(tenPullStatus({ gems: 100, tickets: 9 }, GACHA)).toMatchObject({ ok: false, need: GACHA.ten - 100 });
  expect(tenPullStatus(undefined as any, GACHA)).toMatchObject({ ok: false, need: GACHA.ten });
});
