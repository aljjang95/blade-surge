import { describe, expect, test } from 'bun:test';
import { paceShort } from '../src/ui/pace-short.js';
import { paceLabel } from '../src/data/growth-flow.js';
import { ECONOMY_PACE } from '../src/data/economy-pace.js';
import { SKUS } from '../src/data/shop.js';

describe('상점·소환 단축 일수 짧은 문구', () => {
  test('SSR 확정권: 대상·전후 일수·단축 일수·기준이 모두 드러난다', () => {
    const s = ECONOMY_PACE.savings.ssrTicket, p = paceShort('ssrTicket')!;
    expect(p.text).toBe(s.target + ' ' + s.freeDays + '일→' + s.withDays + '일');
    expect(p.saved).toBe('−' + s.days + '일');
    expect(p.basis).toContain('무과금'); expect(p.basis).toContain(String(ECONOMY_PACE.minutesPerDay) + '분/일'); expect(p.basis).toContain('별 승급 제외');
    expect(p.full).toBe(paceLabel('ssrTicket')!);
  });
  test('paceLabel 이 null 인 상품·없는 키는 아무것도 표시하지 않는다', () => {
    expect(paceShort('stone1')).toBeNull(); expect(paceShort('nope')).toBeNull(); expect(paceShort('toString')).toBeNull();
    for (const sku of SKUS) expect(paceShort(sku.id) === null).toBe(paceLabel(sku.id) === null);
  });
  test('단축 일수가 있는 상품은 무료 일수보다 짧다', () => {
    const shown = SKUS.map((sku) => paceShort(sku.id)).filter(Boolean);
    // 보석 300·980 팩은 첫 결제 보너스가 없어진 뒤(docs/PRICING.md) 단축 일수가 0이라 표시하지 않는다.
    expect(shown.length).toBeGreaterThanOrEqual(4);
    for (const sku of SKUS) { const s = (ECONOMY_PACE.savings as any)[sku.id]; if (paceShort(sku.id)) expect(s.withDays).toBeLessThan(s.freeDays); }
  });
});
