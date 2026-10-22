import { expect, test } from 'bun:test';
import { createPlayCatalogAdapter, loadPlayCatalogAdapter } from '../src/platform/iap-billing.js';

const buy = { productId: 'starter_pack_v1', type: 'inapp', obfuscatedAccountId: 'acct_1' };
const ok = (extra = {}) => ({ channel: 'googleplay', status: 'purchased', productId: 'starter_pack_v1', type: 'inapp', purchaseToken: 'tok', acknowledged: false, ...extra });

test('목록은 정상 응답을 통과시키고 채널 불일치·잘못된 상태·상한 초과를 거부한다', async () => {
  const product = { productId: 'monthly_card_v1', type: 'subs', formattedPrice: '₩4,900', priceAmountMicros: '4900000000', currencyCode: 'KRW', basePlanId: 'monthly' };
  const good = { channel: 'googleplay', status: 'products', products: [product], unavailableProductIds: [] };
  const adapter = (r: any) => createPlayCatalogAdapter({ listCatalog: async () => r } as any);
  const req = [{ productId: 'monthly_card_v1', type: 'subs' }];
  expect((await adapter(good).list(req)).products).toHaveLength(1);
  expect((await adapter({ ...good, status: 'partial', unavailableProductIds: ['x'] }).list(req)).status).toBe('partial');
  for (const bad of [{ ...good, channel: 'onestore' }, { ...good, status: 'error' }, { ...good, products: [{ ...product, priceAmountMicros: 1 }] }, { ...good, products: Array(21).fill(product) }])
    await expect(adapter(bad).list(req)).rejects.toThrow('store-unavailable');
  await expect(adapter(good).list(Array(21).fill(req[0]))).rejects.toThrow('store-unavailable');
  await expect(adapter(good).list([])).rejects.toThrow('store-unavailable');
});

test('구매는 purchased 토큰을 돌려주고 채널 불일치·잘못된 토큰·다른 상품을 거부한다', async () => {
  const run = (r: any) => createPlayCatalogAdapter({ purchaseCatalog: async () => r } as any).purchase(buy);
  expect((await run(ok({ orderId: 'GPA.1' }))).purchaseToken).toBe('tok');
  for (const bad of [ok({ channel: 'onestore' }), ok({ purchaseToken: '' }), ok({ purchaseToken: 'x'.repeat(4097) }), ok({ purchaseToken: 5 }), ok({ productId: 'remove_ads_v1' }), ok({ status: 'error' })])
    await expect(run(bad)).rejects.toThrow('purchase-incomplete');
});

test('pending은 던지지 않고 토큰과 함께 반환하며 cancelled는 purchase-cancelled', async () => {
  const run = (r: any) => createPlayCatalogAdapter({ purchaseCatalog: async () => r } as any).purchase(buy);
  expect(await run(ok({ status: 'pending' }))).toEqual({ pending: true, purchaseToken: 'tok', productId: 'starter_pack_v1' });
  await expect(run({ channel: 'googleplay', status: 'cancelled' })).rejects.toThrow('purchase-cancelled');
  await expect(run(ok({ status: 'pending', purchaseToken: '' }))).rejects.toThrow('purchase-incomplete');
});

test('구매 요청은 구독에만 basePlanId를 전달한다', async () => {
  let seen: any;
  const adapter = createPlayCatalogAdapter({ purchaseCatalog: async (c: any) => { seen = c; return ok({ productId: c.productId, type: c.type }); } } as any);
  await adapter.purchase({ ...buy, basePlanId: 'monthly' }); expect(seen.basePlanId).toBeUndefined();
  await adapter.purchase({ productId: 'monthly_card_v1', type: 'subs', basePlanId: 'monthly', obfuscatedAccountId: 'acct_1' }); expect(seen.basePlanId).toBe('monthly');
});

test('보유 조회는 40개 상한과 토큰 형식을 강제한다', async () => {
  const p = { productIds: ['starter_pack_v1'], productId: 'starter_pack_v1', type: 'inapp', purchaseToken: 't', status: 'purchased', acknowledged: true };
  const adapter = (purchases: any) => createPlayCatalogAdapter({ queryOwned: async () => ({ channel: 'googleplay', status: 'owned', purchases }) } as any);
  expect(await adapter([p]).owned()).toEqual([{ productId: 'starter_pack_v1', type: 'inapp', purchaseToken: 't', status: 'purchased', acknowledged: true }]);
  await expect(adapter(Array(41).fill(p)).owned()).rejects.toThrow('store-unavailable');
  await expect(adapter([{ ...p, purchaseToken: '' }]).owned()).rejects.toThrow('store-unavailable');
  await expect(adapter([{ ...p, status: 'refunded' }]).owned()).rejects.toThrow('store-unavailable');
});

test('네이티브·googleplay 빌드가 아니면 로더는 null', async () => {
  expect(await loadPlayCatalogAdapter()).toBeNull();
});
