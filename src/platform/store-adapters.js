import { Capacitor, registerPlugin } from '@capacitor/core';
import { STORE_CHANNEL, STORE_PRODUCTS, TOSS_AD_GROUP } from './store-channel.js';

function eventFlow(subscribe, control) {
  return new Promise((resolve, reject) => {
    let cleanup = null, ended = false;
    const finish = (error, value) => {
      if (ended) return; ended = true; clearTimeout(timer); control?.signal?.removeEventListener('abort', abort);
      cleanup?.(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(Error('store-interrupted'));
    const timer = setTimeout(() => finish(Error('store-timeout')), 120000);
    if (control?.signal?.aborted || control && !control.isActive()) { abort(); return; }
    control?.signal?.addEventListener('abort', abort, { once: true });
    try { cleanup = subscribe(finish); if (ended) cleanup?.(); }
    catch { finish(Error('store-unavailable')); }
  });
}
function ensure(control) { if (control && (!control.isActive() || control.signal.aborted)) throw Error('store-interrupted'); }

// SDK의 구버전 bridge가 지급 false 후 success를 보내도 서버 확인과 같은 주문만 인정한다.
export function createTossAdapter(sdk) {
  const channel = 'apps-in-toss';
  return { channel,
    authenticate: () => sdk.User.createAnonymousKeyAuthCode(),
    products: async () => (await sdk.IAP.getProductItemList()).products.filter(p => p.sku === STORE_PRODUCTS[channel]),
    purchase: (verify, _account, control) => eventFlow(done => {
      let confirmedOrder = null;
      return sdk.IAP.createOneTimePurchaseOrder({ options: { sku: STORE_PRODUCTS[channel],
        processProductGrant: async ({ orderId }) => {
          try { ensure(control); const result = await verify({ orderId }); ensure(control);
            if (result.adFree !== true) return false; confirmedOrder = orderId; return true; }
          catch { return false; }
        } },
        onEvent: event => { if (event.type !== 'success') return;
          if (!confirmedOrder || confirmedOrder !== event.data?.orderId) done(Error('purchase-incomplete'));
          else { try { ensure(control); done(null, { verified: true }); } catch { done(Error('store-interrupted')); } } },
        onError: () => done(Error('purchase-incomplete')) });
    }, control),
    restore: async (verify, control) => {
      for (const order of (await sdk.IAP.getPendingOrders()).orders) {
        if (order.sku !== STORE_PRODUCTS[channel]) continue;
        ensure(control);
        if ((await verify({ orderId: order.orderId })).adFree !== true) throw Error('restore-incomplete');
        ensure(control);
        if (await sdk.IAP.completeProductGrant({ params: { orderId: order.orderId } }) !== true) throw Error('restore-incomplete');
      }
      const result = await sdk.IAP.getCompletedOrRefundedOrders();
      for (const order of result.orders) if (order.sku === STORE_PRODUCTS[channel]) { ensure(control); await verify({ orderId: order.orderId }); }
      // 고정 SDK의 공개 함수는 cursor 인자를 받지 않는다. 누락된 복원을 완료로 표시하지 않는다.
      if (result.hasNext) throw Error('restore-incomplete');
    },
    showAd: control => eventFlow(done => {
      if (!sdk.loadFullScreenAd.isSupported() || !sdk.showFullScreenAd.isSupported()) { done(Error('ad-unavailable')); return () => {}; }
      let showCleanup = null, showing = false;
      const loadCleanup = sdk.loadFullScreenAd({ options: { adGroupId: TOSS_AD_GROUP }, onError: () => done(Error('ad-unavailable')),
        onEvent: event => {
          if (event.type !== 'loaded' || showing) return;
          try { ensure(control); showing = true; } catch { done(Error('store-interrupted')); return; }
          showCleanup = sdk.showFullScreenAd({ options: { adGroupId: TOSS_AD_GROUP },
            onEvent: event => { if (event.type === 'dismissed') done(null, { shown: true }); else if (event.type === 'failedToShow') done(Error('ad-unavailable')); },
            onError: () => done(Error('ad-unavailable')) });
        } });
      return () => { loadCleanup(); showCleanup?.(); };
    }, control),
    orient: () => sdk.Screen.setOrientation({ type: 'landscape' }),
    dispose: () => sdk.Screen.setOrientation({ type: 'portrait' }),
  };
}

export function createNativeAdapter(plugin, channel, capabilities) {
  const consent = async privacyOptions => {
    const result = await plugin.requestAdConsent(privacyOptions ? { privacyOptions: true } : {});
    if (result.channel !== channel || result.status === 'error') throw Error('ad-unavailable');
    capabilities.privacyOptionsRequired = result.privacyOptionsRequired === true;
    return result;
  };
  const receiptState = async () => {
    const result = await plugin.restorePurchases();
    if (result.channel !== channel || result.status !== 'restored' || !Array.isArray(result.purchases) || result.purchases.length > 20) throw Error('restore-incomplete');
    const matching = result.purchases.filter(p => p.productIds?.includes(STORE_PRODUCTS[channel]));
    if (matching.some(p => !['purchased', 'pending', 'refunded', 'cancelled'].includes(p.status))) throw Error('restore-incomplete');
    return { receipts: matching.filter(p => p.status === 'purchased').map(p => ({ purchaseToken: p.purchaseToken })),
      pending: matching.some(p => p.status === 'pending') };
  };
  return { channel, capabilities,
    receipts: async () => { const state = await receiptState(); if (state.pending) throw Error('purchase-pending'); return state.receipts; },
    authenticate: async () => {
      const result = await plugin.authenticate();
      if (result.channel !== channel || result.status !== 'credential_received' || result.provider !== 'google' || typeof result.idToken !== 'string' || !result.idToken.length) throw Error('identity-unavailable');
      return { idToken: result.idToken };
    },
    products: async () => { const result = await plugin.listProducts({ productIds: [STORE_PRODUCTS[channel]] });
      if (result.channel !== channel || result.status !== 'products' || !Array.isArray(result.products) || result.partial) throw Error('store-unavailable');
      return result.products; },
    purchase: async (verify, account, control) => {
      ensure(control);
      const result = await plugin.purchase({ productId: STORE_PRODUCTS[channel], obfuscatedAccountId: account });
      ensure(control);
      if (result.channel !== channel || result.status !== 'purchased' || typeof result.purchaseToken !== 'string') throw Error('purchase-incomplete');
      return verify({ purchaseToken: result.purchaseToken });
    },
    restore: async (verify, control) => {
      ensure(control); const state = await receiptState(); ensure(control); await verify({ receipts: state.receipts });
      if (state.pending) throw Error('purchase-pending');
    },
    privacyOptions: async control => { ensure(control); await consent(true); ensure(control); },
    showAd: async control => {
      const decision = await consent(false); ensure(control);
      if (!decision.canRequestAds) throw Error('ad-unavailable');
      const loaded = await plugin.loadInterstitial(); ensure(control);
      if (loaded.channel !== channel || loaded.status !== 'loaded') throw Error('ad-unavailable');
      const shown = await plugin.showInterstitial();
      if (shown.channel !== channel || shown.status !== 'dismissed' || shown.shown !== true) throw Error('ad-unavailable');
    }, dispose: async () => {},
  };
}

export async function createStoreAdapter(channel) {
  if (channel !== STORE_CHANNEL) throw Error('store-runtime-mismatch');
  if (__BLADE_CHANNEL__ === 'apps-in-toss') {
    // appName은 SDK globals 필드가 아니다. 빌드 정체성과 공식 런타임 origin에 결박한다.
    if (!['https://blade-surge.apps.tossmini.com', 'https://blade-surge.private-apps.tossmini.com'].includes(location.origin)) throw Error('store-runtime-mismatch');
    const sdk = await import('@apps-in-toss/web-framework');
    if (!sdk.getAppsInTossGlobals().deploymentId) throw Error('store-runtime-mismatch');
    return createTossAdapter(sdk);
  }
  if (!['googleplay', 'onestore'].includes(channel) || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('BladeStore')) throw Error('store-unavailable');
  const plugin = registerPlugin('BladeStore'), capabilities = await plugin.getCapabilities();
  if (capabilities.channel !== channel) throw Error('store-runtime-mismatch');
  return createNativeAdapter(plugin, channel, capabilities);
}
