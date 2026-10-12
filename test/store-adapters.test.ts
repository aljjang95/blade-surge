import { expect, test } from 'bun:test';
import { createTossAdapter, createNativeAdapter } from '../src/platform/store-adapters.js';
import { STORE_PRODUCTS } from '../src/platform/store-channel.js';

test('구버전 Toss success는 실패한 서버 검증이나 다른 주문을 성공으로 바꾸지 않는다', async () => {
  for (const confirmed of [false, true]) {
    let options: any, cleaned = 0;
    const adapter = createTossAdapter({ IAP: { createOneTimePurchaseOrder(value: any) { options = value; return () => cleaned++; } } } as any);
    const pending = adapter.purchase(async () => ({ adFree: confirmed }), undefined, undefined);
    expect(await options.options.processProductGrant({ orderId: 'owned-order' })).toBe(confirmed);
    options.onEvent({ type: 'success', data: { orderId: confirmed ? 'foreign-order' : 'owned-order' } });
    await expect(pending).rejects.toThrow('purchase-incomplete'); expect(cleaned).toBe(1);
  }
});

test('Toss 복원은 지급 확인·플랫폼 acknowledgement·전체 페이지를 모두 요구한다', async () => {
  const sku = STORE_PRODUCTS['apps-in-toss'];
  for (const [paid, acknowledged, hasNext] of [[false, true, false], [true, false, false], [true, true, true]]) {
    const adapter = createTossAdapter({ IAP: {
      getPendingOrders: async () => ({ orders: [{ sku, orderId: 'receipt' }] }),
      completeProductGrant: async () => acknowledged,
      getCompletedOrRefundedOrders: async () => ({ orders: [], hasNext }),
    } } as any);
    await expect(adapter.restore(async () => ({ adFree: paid }), undefined)).rejects.toThrow('restore-incomplete');
  }
});

test('네이티브의 resolve된 광고 오류는 표시 성공이 아니며 로드 실패 시 show 호출은 없다', async () => {
  let shown = 0;
  const plugin: any = {
    requestAdConsent: async () => ({ channel: 'googleplay', status: 'consent', canRequestAds: true }),
    loadInterstitial: async () => ({ channel: 'googleplay', status: 'error' }),
    showInterstitial: async () => { shown++; return { channel: 'googleplay', status: 'error' }; },
  };
  const adapter = createNativeAdapter(plugin, 'googleplay', {} as any);
  await expect(adapter.showAd(undefined)).rejects.toThrow(); expect(shown).toBe(0);
  plugin.loadInterstitial = async () => ({ channel: 'googleplay', status: 'loaded' });
  await expect(adapter.showAd(undefined)).rejects.toThrow(); expect(shown).toBe(1);
  plugin.showInterstitial = async () => ({ channel: 'googleplay', status: 'dismissed', shown: false });
  await expect(adapter.showAd(undefined)).rejects.toThrow();
});

test('광고 로드 중 로비 소유권 상실 시 실제 SDK show를 시작하지 않는다', async () => {
  let active = true, complete: any, shown = 0;
  const plugin: any = {
    requestAdConsent: async () => ({ channel: 'googleplay', status: 'consent', canRequestAds: true }),
    loadInterstitial: () => new Promise(resolve => { complete = resolve; }),
    showInterstitial: async () => { shown++; },
  };
  const adapter = createNativeAdapter(plugin, 'googleplay', {} as any), lifetime = new AbortController();
  const pending = adapter.showAd({ isActive: () => active, signal: lifetime.signal } as any);
  await new Promise(resolve => setTimeout(resolve, 0)); active = false;
  complete({ channel: 'googleplay', status: 'loaded' });
  await expect(pending).rejects.toThrow('store-interrupted'); expect(shown).toBe(0);
});

test('네이티브 복원은 서버에 신선한 receipt 배열을 전달하고 불완전한 SDK 응답을 거부한다', async () => {
  const plugin: any = { restorePurchases: async () => ({ channel: 'googleplay', status: 'restored',
    purchases: [{ status: 'purchased', productIds: ['remove_ads_v1'], purchaseToken: 'fresh' },
      { status: 'pending', productIds: ['remove_ads_v1'], purchaseToken: 'pending' }] }) };
  const adapter = createNativeAdapter(plugin, 'googleplay', {} as any);
  let body: any;
  await expect(adapter.restore(async (value: any) => { body = value; }, undefined)).rejects.toThrow('purchase-pending');
  expect(body).toEqual({ receipts: [{ purchaseToken: 'fresh' }] });
  plugin.restorePurchases = async () => ({ channel: 'onestore', status: 'restored', purchases: [] });
  await expect(adapter.receipts()).rejects.toThrow('restore-incomplete');
});

test('native credential_received는 서명 토큰 획득이고 backend 인증으로 꾸미지 않는다', async () => {
  const plugin: any = { authenticate: async () => ({ channel: 'googleplay', status: 'credential_received', provider: 'google', idToken: 'server-must-verify' }) };
  const adapter = createNativeAdapter(plugin, 'googleplay', {} as any);
  expect(await adapter.authenticate()).toEqual({ idToken: 'server-must-verify' });
  plugin.authenticate = async () => ({ channel: 'googleplay', status: 'error', provider: 'google', idToken: 'invalid' });
  await expect(adapter.authenticate()).rejects.toThrow('identity-unavailable');
});
