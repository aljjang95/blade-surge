import { expect, test } from 'bun:test';
import { IAP_BY_ID } from '../src/shared/iap-catalog.js';
import { SKUS } from '../src/data/shop.js';

// docs/PRICING.md: 보석 팩은 묶음이 클수록 보석 1개당 가격이 내려간다. 지급은 grant의 보석만.
const PACKS = ['gems_300_v1', 'gems_980_v1', 'gems_1980_v1'];

test('보석 팩 단가는 묶음이 커질수록 낮아진다(최대 할인 20% 이하)', () => {
  const unit = PACKS.map((id) => IAP_BY_ID[id].priceKRW / (IAP_BY_ID[id].grant.rewards?.gems ?? NaN));
  for (let i = 1; i < unit.length; i++) expect(unit[i]).toBeLessThan(unit[i - 1]);
  expect(unit[unit.length - 1] / unit[0]).toBeGreaterThanOrEqual(0.8);
});

test('상점 보석 팩 표기는 서버 카탈로그 가격·수량과 같고 보너스를 약속하지 않는다', () => {
  for (const id of PACKS) {
    const p = IAP_BY_ID[id], sku: any = SKUS.find((s) => s.id === p.shopSku);
    expect(sku).toBeTruthy();
    expect(sku.price).toBe(p.priceKRW);
    expect(sku.gems).toBe(p.grant.rewards?.gems);
    expect(Object.hasOwn(sku, 'bonus')).toBe(false);
  }
});
