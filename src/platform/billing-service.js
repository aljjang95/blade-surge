// BM: 클라이언트 결제 서비스. 서버(/api/v1/iap)가 검증·지급의 유일한 근거이며 이 서비스는 로컬에 직접 보상·권한을 주지 않는다.
// - 가격 표시는 Play가 돌려준 값(formattedPrice)만 쓴다. 카탈로그 priceKRW는 폴백으로 보이지 않는다.
// - 구매 토큰은 어댑터 → 서버 verify로만 흐른다. 저장·로그·퍼널에 남기지 않는다.
import { loadPlayCatalogAdapter } from './iap-billing.js';
import { soldOn, IAP_BY_ID, VERIFY_ONLY_GATES } from '../shared/iap-catalog.js';
import { funnelSkuFor } from '../game/funnel-events.js';
import { askCustomerInfo } from '../ui/customer-info.js';
import { createHeroPurchase } from './hero-purchase.js';

const validProduct = (p) => p && typeof p.id === 'string' && soldOn(p, 'play') && ['inapp', 'subs'].includes(p.playType);

// 서버 /iap/* 한도(계정당 10분 30회)를 아끼려고 sync가 verify하는 대상을 줄인다.
// 미승인(acknowledged=false) 토큰은 항상, 승인된 구독은 상품별 6시간에 한 번만 확인한다(승인된 일회성 상품은 서버가 이미 처리).
export const SUB_VERIFY_GAP_MS = 6 * 3600000;
export const SUB_CHECK_KEY = 'bladesurge_iap_sub_check_v1';
function defaultStorage() {
  try { const s = globalThis.localStorage; return s && typeof s.getItem === 'function' ? s : null; } catch { return null; }
}

/**
 * @param {{ account: any, loadAdapter?: () => Promise<any>, economy: any, onVerified?: (info: { productId: string, shopSku: string | null }) => void, minSyncGapMs?: number, now?: () => number, storage?: any }} options
 */
export function createBillingService({ account, loadAdapter = loadPlayCatalogAdapter, economy, onVerified, minSyncGapMs = 15000, now = () => Date.now(), storage = defaultStorage() }) {
  /** @type {any} */ let adapter = null;
  /** @type {any[]} */ let catalog = [];
  const prices = new Map();
  let ready = false, busy = false, syncing = false, initPromise = null, permanentOff = false, lastInitAt = 0, lastSyncAt = 0;

  /** 서버 응답을 세이브에 적용한다. 저장 실패는 null. */
  const apply = (state) => (typeof economy?.applyIapState === 'function' ? economy.applyIapState(state) : null);

  async function refreshCatalog() {
    try {
      const cat = await account.iapCatalog();
      if (cat?.billing === true && Array.isArray(cat.products)) catalog = cat.products.filter(validProduct).map((p) => ({ ...p }));
    } catch { /* 다음 기회에 */ }
  }

  async function doInit() {
    if (!account || permanentOff) return false;
    adapter = await loadAdapter();
    if (!adapter) { permanentOff = true; return false; }
    const me = await account.me();
    if (me?.flags?.iap !== true) return false;
    const cat = await account.iapCatalog();
    if (cat?.billing !== true || !Array.isArray(cat.products)) return false;
    const list = cat.products.filter(validProduct).map((p) => ({ ...p }));
    if (!list.length) return false;
    const r = await adapter.list(list.map((p) => ({ productId: p.id, type: p.playType })));
    prices.clear();
    for (const p of r?.products || []) if (typeof p?.formattedPrice === 'string' && p.formattedPrice.length) prices.set(p.productId, { formattedPrice: p.formattedPrice, priceAmountMicros: p.priceAmountMicros, currencyCode: p.currencyCode });
    catalog = list;
    ready = prices.size > 0;
    return ready;
  }

  // 구독 마지막 확인 시각(productId별). 구매 토큰은 저장하지 않는다.
  const readChecks = () => { try { const v = JSON.parse(storage?.getItem(SUB_CHECK_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const writeCheck = (productId, at) => { try { storage?.setItem(SUB_CHECK_KEY, JSON.stringify({ ...readChecks(), [productId]: at })); } catch { /* 저장 불가면 다음 sync에서 다시 확인 */ } };
  /** 이 보유 항목을 서버에 verify할지. */
  const shouldVerify = (o) => {
    // 판매를 내린 상품(gate gacha-only)의 미승인 기존 구매도 복구 검증한다(서버 /iap/verify는 verifiableProduct로 받는다).
    const legacy = Object.hasOwn(IAP_BY_ID, o.productId) && VERIFY_ONLY_GATES.includes(IAP_BY_ID[o.productId].gate);
    if (!catalog.some((p) => p.id === o.productId) && !legacy) return false;
    if (legacy && o.acknowledged === true) return false;
    if (o.acknowledged !== true) return true;
    if (o.type !== 'subs') return false;
    const last = Number(readChecks()[o.productId]);
    return !Number.isFinite(last) || now() - last >= SUB_VERIFY_GAP_MS || last > now();
  };

  const service = {
    /** v1 결제 플래그·어댑터·카탈로그·Play 가격이 모두 확인됐을 때만 true를 돌려준다. 실패는 조용히 false(60초 뒤 다시 시도). */
    async init() {
      if (ready) return true;
      if (initPromise) return initPromise;
      if (lastInitAt && now() - lastInitAt < 60000) return false;
      lastInitAt = now();
      initPromise = doInit().catch(() => false).finally(() => { initPromise = null; });
      return initPromise;
    },
    available() { return ready && prices.size > 0; },
    /** 카탈로그 + Play 가격. sellable = 서버가 판매 가능(eligible)이라 하고 Play 가격이 있을 때만 true. */
    product(id) {
      const p = catalog.find((x) => x.id === id);
      if (!p) return null;
      const price = prices.get(id);
      return { ...p, formattedPrice: price?.formattedPrice || null, sellable: ready && p.eligible === true && !!price };
    },
    productForShopSku(sku) {
      const p = catalog.find((x) => x.shopSku === sku);
      return p ? service.product(p.id) : null;
    },
    async buy(productId) {
      if (busy) return { ok: false, reason: 'busy' };
      const p = service.product(productId);
      if (!service.available() || !p || !p.sellable) return { ok: false, reason: 'unavailable' };
      busy = true;
      try {
        let intent;
        try { intent = await account.iapIntent(productId); }
        catch (error) {
          const code = error?.body?.error;
          return { ok: false, reason: error?.status === 503 ? 'billing-disabled' : code === 'not-eligible' || code === 'already-subscribed' ? code : 'intent-failed' };
        }
        let result;
        try { result = await adapter.purchase({ productId, type: intent.playType, basePlanId: intent.basePlanId || undefined, obfuscatedAccountId: intent.obfuscatedAccountId }); }
        catch (error) { return { ok: false, reason: error?.message === 'purchase-cancelled' ? 'cancelled' : 'purchase-failed' }; }
        if (result?.pending) {
          // 승인 대기: 서버에 기록만 남기고(지급 없음) 승인되면 sync()가 지급한다.
          try { await account.iapVerify(productId, result.purchaseToken); } catch { /* 다음 sync */ }
          return { ok: false, reason: 'pending' };
        }
        let verified;
        try { verified = await account.iapVerify(productId, result.purchaseToken); }
        catch { return { ok: false, reason: 'verify-failed' }; } // 토큰은 Play에 남아 있어 sync()가 다시 검증한다
        const state = verified?.state;
        if (state === 'pending') return { ok: false, reason: 'pending' };
        const got = apply(verified);
        if (got === null) return { ok: false, reason: 'storage' };
        if (state === 'granted' || state === 'already') {
          if (p.once || p.type === 'non_consumable') { const c = catalog.find((x) => x.id === productId); if (c) c.eligible = false; }
          if (state === 'granted') { try { onVerified?.({ productId, shopSku: p.shopSku ?? null }); } catch { /* 계측 실패는 무시 */ } }
          void refreshCatalog();
          return { ok: true, state, got };
        }
        return { ok: false, reason: state === 'refunded' || state === 'expired' ? state : 'verify-failed' };
      } finally { busy = false; }
    },
    /** 로비 진입·앱 복귀 때: Play에 남은 구매를 서버가 다시 검증(미ack 재시도·지급 보완)하게 하고 서버 상태를 반영한다. */
    async sync() {
      if (!ready || syncing || busy) return false;
      if (lastSyncAt && now() - lastSyncAt < minSyncGapMs) return false;
      lastSyncAt = now(); syncing = true;
      try {
        let owned = [];
        try { owned = await adapter.owned(); } catch { owned = []; }
        for (const o of owned) {
          if (!shouldVerify(o)) continue;
          try { await account.iapVerify(o.productId, o.purchaseToken); if (o.type === 'subs') writeCheck(o.productId, now()); } catch { /* 다음 기회 */ }
        }
        const state = await account.iapState();
        apply(state);
        await refreshCatalog();
        return true;
      } catch { return false; }
      finally { syncing = false; }
    },
  };
  return service;
}

/** 부트 연결: 계정 클라이언트가 있으면 서비스를 만들어 경제에 주입하고, 계정이 준비되면 초기화·동기화한다. v1이 닫혀 있으면 아무것도 바뀌지 않는다. */
export function setupBilling(app) {
  const client = app?.account?.client;
  if (!client || !app.eco) return null;
  const billing = createBillingService({
    account: client, economy: app.eco,
    onVerified: ({ productId, shopSku }) => { const sku = funnelSkuFor({ productId, shopSku }); if (sku) app.funnel?.track?.('purchase_verified', { sku }); },
  });
  app.eco.setBilling(billing); app.billing = billing;
  // 영웅 해금 구매 트리거(UI는 app.heroPurchase만 안다). 웹 채널은 포트원, Play 채널은 위 billing으로 위임한다.
  const heroPurchase = createHeroPurchase({ api: client, eco: app.eco, billing, authority: () => app.account?.authority ?? null,
    askCustomer: (methods) => askCustomerInfo(app.ui, methods) });
  app.heroPurchase = heroPurchase;
  const start = (tries = 0) => {
    const status = app.account?.status;
    if (status === 'ready') {
      void billing.init().then((ok) => ok && billing.sync()).then(() => app.meta?.refreshTop?.()).catch(() => {});
      void heroPurchase.init().then(() => heroPurchase.resume()).then((r) => r?.ok && app.meta?.refreshTop?.())
        .then(() => heroPurchase.syncState()).then((ok) => ok && app.meta?.refreshTop?.()).catch(() => {});
    } else if (status === 'connecting' && tries < 40) setTimeout(() => start(tries + 1), 1500);
  };
  start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void billing.sync();
    // 웹 그림자 모드는 Play 어댑터가 없어 billing.sync()가 비어 있다: 영웅 권한(환불 회수·늦은 지급)은 여기서 따로 맞춘다.
    if (app.account?.status === 'ready') void heroPurchase.syncState().then((ok) => ok && app.meta?.refreshTop?.()).catch(() => {});
  });
  return billing;
}
