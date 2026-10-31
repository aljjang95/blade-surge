import { describe, expect, test } from 'bun:test';
import { cashOffer, payCash, PAY_VIA, webCatalogProduct } from '../src/ui/cash-offer.js';
import { createHeroPurchase } from '../src/platform/hero-purchase.js';
import { paymentNoticeHtml, MINOR_NOTICE } from '../src/ui/legal-links.js';

// 상점 현금 상품 채널 분기(E): 웹은 포트원(app.heroPurchase), Play 앱은 기존 Play billing. 웹 결제가 꺼져 있으면 '준비 중'이고 서버를 부르지 않는다.
function webPurchase(webBilling: boolean) {
  const calls: any[] = [], payCalls: any[] = [];
  const api = {
    async me() { calls.push(['GET', '/me']); return { flags: { webBilling } }; },
    async request(method: string, path: string, body: any) {
      calls.push([method, path, body]);
      if (path === '/iap/web/intent') return { paymentId: 'bsw_' + 'c'.repeat(32), productId: body.productId, storeId: 's', channelKey: 'k', orderName: 'x', totalAmount: 4900, currency: 'KRW', payMethod: 'CARD', customData: '{}' };
      if (path === '/iap/web/complete') return { state: 'granted' };
      throw new Error('path');
    },
  };
  const hp = createHeroPurchase({ api, eco: { applyIapState: () => [{ k: 'removeAds', n: 1 }] }, channel: 'web', billing: null, authority: () => 'server',
    loadSdk: async () => ({ requestPayment: async (req: any) => { payCalls.push(req); return { paymentId: req.paymentId }; } }),
    askCustomer: async () => ({ fullName: '홍길동', phoneNumber: '01012345678', email: 'a@b.co' }), storage: null, now: () => 1000,
    location: { origin: 'https://blade.example', search: '', pathname: '/' }, history: { replaceState() {} } });
  return { hp, calls, payCalls };
}

describe('웹 상점 현금 상품', () => {
  test('웹 판매 대상은 enabled·웹 채널·비구독만(월정액 Play 구독·보석 팩·꺼진 상품 제외)', () => {
    expect(webCatalogProduct('starter')?.id).toBe('starter_pack_v1');
    expect(webCatalogProduct('remove_ads')?.id).toBe('remove_ads_v1');
    expect(webCatalogProduct('pass')?.id).toBe('season_pass_s1');
    expect(webCatalogProduct('monthly')).toBeNull();
    expect(webCatalogProduct('gem1')).toBeNull();
    expect(webCatalogProduct('growth')).toBeNull();
    expect(webCatalogProduct('nope')).toBeNull();
  });

  test('웹 결제 꺼짐: 준비 중으로 보이고, 구매를 눌러도 서버 intent·결제창을 부르지 않는다', async () => {
    const { hp, calls, payCalls } = webPurchase(false);
    await hp.init();
    const offer = cashOffer('remove_ads', { channel: 'web', heroPurchase: hp });
    expect(offer).toEqual({ mode: 'pending', productId: 'remove_ads_v1', type: 'non_consumable' });
    expect(await payCash(offer, { heroPurchase: hp })).toEqual({ ok: false, reason: 'unavailable' });
    expect(calls.filter(([, p]) => p !== '/me')).toEqual([]);
    expect(payCalls).toEqual([]);
  });

  test('heroPurchase가 없으면(계정 서버 꺼짐) 웹 현금 상품은 숨기고 서버 호출 없음', async () => {
    const offer = cashOffer('starter', { channel: 'web', heroPurchase: null });
    expect(offer).toBeNull();
    expect(await payCash(offer, {})).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('웹 결제 켜짐: 카탈로그 금액으로 보이고 포트원 경로(intent → 결제창 → complete)로 산다', async () => {
    const { hp, calls, payCalls } = webPurchase(true);
    await hp.init();
    const offer = cashOffer('remove_ads', { channel: 'web', heroPurchase: hp });
    expect(offer).toEqual({ mode: 'web', productId: 'remove_ads_v1', formattedPrice: '₩4,900', type: 'non_consumable' });
    const r = await payCash(offer, { heroPurchase: hp });
    expect(r.ok).toBe(true);
    expect(calls.map(([, p]) => p)).toEqual(['/me', '/iap/web/intent', '/iap/web/complete']);
    expect(payCalls[0].paymentId).toBe('bsw_' + 'c'.repeat(32));
  });

  test('Play 앱은 기존 Play billing 그대로(웹 포트원을 부르지 않음)', async () => {
    const bought: string[] = [];
    const billing = { available: () => true, productForShopSku: (s: string) => (s === 'remove_ads' ? { id: 'remove_ads_v1', type: 'non_consumable', sellable: true, formattedPrice: '₩4,900' } : null), buy: async (id: string) => { bought.push(id); return { ok: true, got: [] }; } };
    const offer = cashOffer('remove_ads', { channel: 'googleplay', billing, heroPurchase: { available: () => true, buy: () => { throw new Error('web'); } } });
    expect(offer?.mode).toBe('play');
    expect((await payCash(offer, { billing })).ok).toBe(true);
    expect(bought).toEqual(['remove_ads_v1']);
    expect(cashOffer('remove_ads', { channel: 'googleplay', billing: { ...billing, available: () => false } })).toBeNull();
  });

  test('결제수단 문구: 웹은 Google Play라고 쓰지 않는다. 결제 확인 고지에 미성년자 법정대리인 동의 문구가 있다', () => {
    expect(PAY_VIA.web).not.toContain('Google');
    expect(PAY_VIA.play).toContain('Google Play');
    expect(paymentNoticeHtml({ id: 'remove_ads' })).toContain(MINOR_NOTICE);
  });
});
