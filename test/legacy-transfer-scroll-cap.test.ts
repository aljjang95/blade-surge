import { expect, test } from 'bun:test';
import { sanitizeLegacySave, CURRENCY_SINCE, DAILY_MAX, ONE_TIME } from '../src/shared/legacy-sanitize.js';
import { EconomyCore } from '../src/game/economy-core.js';

const DAY = 86400000;
const RELEASE = CURRENCY_SINCE.transferScroll;
const save = (now: number, transferScroll: number) => ({ ...(EconomyCore.fromState(null, { now: () => now, rng: () => 0.5 }).snapshot() as any), transferScroll });

// Codex 보안 리뷰: 오래된 계정이 출시 전 기간까지 일일 상한을 쌓아 '5 + 5 × 계정 나이' 장을 가져오던 문제.
test('전승 보호 주문서 가져오기 상한은 계정 나이가 아니라 출시 뒤 경과일로 쌓인다', () => {
  const created = RELEASE - 120 * DAY;
  const atRelease = sanitizeLegacySave(save(RELEASE, 605), { now: RELEASE, createdAt: created }) as any;
  expect(atRelease.ok).toBe(true);
  expect(atRelease.state.transferScroll).toBe(ONE_TIME.transferScroll);
  expect(atRelease.report.clamped.transferScroll).toEqual({ from: 605, to: ONE_TIME.transferScroll });
  const later = sanitizeLegacySave(save(RELEASE + 3 * DAY, 605), { now: RELEASE + 3 * DAY, createdAt: created }) as any;
  expect(later.state.transferScroll).toBe(ONE_TIME.transferScroll + DAILY_MAX.transferScroll * 3);
});

test('출시 뒤 정당하게 산 만큼은 깎지 않고, 다른 재화는 여전히 계정 나이로 쌓인다', () => {
  const created = RELEASE - 120 * DAY, now = RELEASE + DAY;
  const r = sanitizeLegacySave({ ...save(now, 4), protect: 500 }, { now, createdAt: created }) as any;
  expect(r.state.transferScroll).toBe(4);
  expect(r.state.protect).toBe(500);
  expect(r.report.clamped.transferScroll).toBeUndefined();
});
