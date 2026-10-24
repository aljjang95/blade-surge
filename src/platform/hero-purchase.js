// 영웅 해금 구매 트리거(수익화 1단계). UI는 app.heroPurchase = { available(), buy(productId) }만 안다.
// - 웹 채널: 서버 intent(paymentId·금액 발급) → 포트원 V2 브라우저 SDK 결제창 → 서버 complete(포트원 조회 검증) → eco.applyIapState(서버 응답).
//   성공 표시(ok:true)는 서버가 granted/already를 돌려줬고 로컬 반영이 저장된 뒤에만 낸다. 결제창 결과·SDK 응답은 지급 근거가 아니다.
// - Play 채널(안드로이드): 같은 productId를 기존 billing-service(Play 결제 → 서버 verify)로 넘긴다.
// - 모바일 리다이렉트 결제: 결제 전에 보류 paymentId를 localStorage에 남기고, 복귀한 페이지에서 resume()이 complete를 다시 보낸다.
import { STORE_CHANNEL } from './store-channel.js';
import { IAP_BY_ID } from '../shared/iap-catalog.js';

export const PORTONE_SDK_URL = 'https://cdn.portone.io/v2/browser-sdk.js';
export const PENDING_KEY = 'bladesurge_web_pay_pending_v1';
const PENDING_MAX_AGE_MS = 48 * 3600000;
const PRODUCT_ID = /^hero_[a-z0-9]+_v1$/;
const PAYMENT_ID = /^[A-Za-z0-9_-]{16,64}$/;

function defaultStorage() {
  try { const s = globalThis.localStorage; return s && typeof s.getItem === 'function' ? s : null; } catch { return null; }
}

/** 포트원 SDK를 CDN에서 한 번만 불러온다(npm 의존·lock 변경 없음). 실패는 null. */
export function loadPortOneSdk(doc = globalThis.document) {
  if (globalThis.PortOne?.requestPayment) return Promise.resolve(globalThis.PortOne);
  if (!doc?.createElement) return Promise.resolve(null);
  return new Promise((resolve) => {
    const script = doc.createElement('script');
    script.src = PORTONE_SDK_URL; script.async = true;
    script.onload = () => resolve(globalThis.PortOne?.requestPayment ? globalThis.PortOne : null);
    script.onerror = () => resolve(null);
    doc.head.appendChild(script);
  });
}

/**
 * @param {{ api: any, eco: any, billing?: any, channel?: string, loadSdk?: () => Promise<any>, storage?: any, now?: () => number,
 *   authority?: () => string | null, location?: { origin?: string, search?: string, pathname?: string }, history?: any }} options
 */
export function createHeroPurchase({ api, eco, billing = null, authority = () => null, channel = STORE_CHANNEL, loadSdk = loadPortOneSdk, storage = defaultStorage(), now = () => Date.now(),
  location = globalThis.location, history = globalThis.history }) {
  let webOn = false, busy = false, syncing = false, lastSyncAt = 0;
  // 상태 적용 순서: 요청을 시작할 때 단조 증가 번호를 받고, 더 최근에 시작한 요청의 결과가 이미 적용됐으면 오래된 응답은 버린다.
  // (지연된 권한 목록이 방금 산 영웅을 다시 잠그지 않게.) 서버 응답에 serverTime이 있으면 그것도 되돌아가지 않게 비교한다.
  let seq = 0, appliedSeq = 0, appliedServerTime = 0;
  const stale = (mine, state) => mine < appliedSeq || (Number.isFinite(state?.serverTime) && state.serverTime < appliedServerTime);
  const markApplied = (mine, state) => { appliedSeq = Math.max(appliedSeq, mine); if (Number.isFinite(state?.serverTime)) appliedServerTime = Math.max(appliedServerTime, state.serverTime); };
  const SYNC_GAP_MS = 15000; // 앱 복귀를 연달아 해도 서버 /iap/state 한도(계정당 분당 60회)를 아낀다.

  const readPending = () => {
    try {
      const v = JSON.parse(storage?.getItem(PENDING_KEY) || 'null');
      if (v && PAYMENT_ID.test(v.paymentId) && PRODUCT_ID.test(v.productId) && now() - Number(v.at) < PENDING_MAX_AGE_MS) return v;
    } catch { /* 저장소 불가·손상은 보류 없음 */ }
    return null;
  };
  const writePending = (v) => { try { storage?.setItem(PENDING_KEY, JSON.stringify(v)); } catch { /* 저장 불가면 복귀 재시도만 못 한다 */ } };
  const clearPending = () => { try { storage?.removeItem(PENDING_KEY); } catch { /* 무시 */ } };

  /** 서버 complete를 부르고 granted/already일 때만 로컬에 반영한다. */
  async function complete(paymentId) {
    const mine = ++seq;
    let r;
    try { r = await api.request('POST', '/iap/web/complete', { paymentId }); }
    catch (error) {
      const code = error?.body?.error;
      // 서버가 이 결제를 모른다/거부하면 보류를 버린다. 일시 오류(5xx·네트워크)는 보류를 남겨 다시 시도한다.
      if (error?.status && error.status < 500 && error.status !== 429) clearPending();
      return { ok: false, reason: code === 'payment-not-found' ? 'payment-not-found' : error?.status === 503 ? 'billing-disabled' : 'verify-failed' };
    }
    if (r?.state === 'granted' || r?.state === 'already') {
      // 구매 확정 응답은 버리지 않는다(구매 중에는 syncState가 새로 시작하지 못하므로 이보다 최근 요청이 없다).
      const got = typeof eco?.applyIapState === 'function' ? eco.applyIapState(r) : null;
      if (got === null) return { ok: false, reason: 'storage' }; // 지급은 서버에 됐다. 다음 iapState 반영 때 다시 적용된다.
      markApplied(mine, r);
      clearPending();
      return { ok: true, state: r.state, got };
    }
    if (r?.state === 'pending') return { ok: false, reason: 'pending' };
    clearPending();
    return { ok: false, reason: r?.state === 'cancelled' || r?.state === 'failed' ? r.state : 'verify-failed' };
  }

  const service = {
    /** 서버가 웹 결제 켜짐을 알렸는지 확인한다(웹 채널만). 실패는 조용히 false. */
    async init() {
      if (channel !== 'web') return service.available();
      try { const me = await api.me(); webOn = me?.flags?.webBilling === true; } catch { webOn = false; }
      return webOn;
    },
    /**
     * 시작·앱 복귀 때 서버의 활성 권한·지급·환불을 로컬에 반영한다. 웹 결제 판매 스위치·보류 결제와 무관하다:
     * 결제 성공 뒤 보류가 지워졌거나 판매가 꺼진 뒤에도, cron이 처리한 환불 회수와 만료 뒤 지급이 열려야 하기 때문이다.
     * 계정이 없거나(401) 서버가 꺼져 있으면(503)·네트워크 오류는 조용히 false.
     */
    async syncState() {
      if (busy || syncing || (lastSyncAt && now() - lastSyncAt < SYNC_GAP_MS)) return false;
      lastSyncAt = now(); syncing = true;
      const mine = ++seq;
      try {
        const state = typeof api?.iapState === 'function' ? await api.iapState() : await api.request('GET', '/iap/state');
        if (!state || typeof state !== 'object') return false;
        if (stale(mine, state)) return false;
        if (typeof eco?.applyIapState !== 'function' || eco.applyIapState(state) === null) return false;
        markApplied(mine, state);
        return true;
      } catch { return false; }
      finally { syncing = false; }
    },
    available() {
      // 서버 권위 계정에서만 연다(그림자·로컬은 저장 편집으로 소유를 늘릴 수 있어 현금 판매 대상이 아니다).
      if (authority() !== 'server') return false;
      if (channel === 'web') return webOn;
      if (channel === 'googleplay') return !!billing && typeof billing.available === 'function' && billing.available();
      return false;
    },
    /**
     * 화면에 보일 가격 문구. 웹은 서버 intent 금액과 같은 카탈로그 priceKRW, Play는 스토어가 돌려준 formattedPrice(판매 가능 확인 포함)만 쓴다.
     * 확인된 가격이 없으면 null — 호출한 쪽은 그 상품 버튼을 숨기거나 비활성으로 둔다(카탈로그 값을 Play 가격처럼 보이지 않는다).
     */
    price(productId) {
      if (!service.available()) return null;
      if (channel === 'web') { const krw = IAP_BY_ID[productId]?.priceKRW; return Number.isFinite(krw) ? '₩' + Number(krw).toLocaleString('en-US') : null; }
      const p = typeof billing?.product === 'function' ? billing.product(productId) : null;
      return p && p.sellable === true && typeof p.formattedPrice === 'string' && p.formattedPrice ? p.formattedPrice : null;
    },
    async buy(productId) {
      if (typeof productId !== 'string' || !PRODUCT_ID.test(productId)) return { ok: false, reason: 'unknown-product' };
      if (!service.available()) return { ok: false, reason: 'unavailable' };
      if (channel !== 'web') return billing.buy(productId);
      if (busy) return { ok: false, reason: 'busy' };
      busy = true;
      try {
        let intent;
        try { intent = await api.request('POST', '/iap/web/intent', { productId }); }
        catch (error) {
          const code = error?.body?.error;
          return { ok: false, reason: error?.status === 503 ? 'billing-disabled' : code === 'not-eligible' || code === 'payout-hold' || code === 'too-many-intents' ? code : 'intent-failed' };
        }
        if (!intent || !PAYMENT_ID.test(intent.paymentId) || intent.productId !== productId) return { ok: false, reason: 'intent-failed' };
        writePending({ paymentId: intent.paymentId, productId, at: now() });
        const sdk = await loadSdk();
        if (!sdk) return { ok: false, reason: 'sdk-unavailable' };
        const origin = location?.origin || '';
        let result;
        try {
          result = await sdk.requestPayment({
            storeId: intent.storeId, channelKey: intent.channelKey, paymentId: intent.paymentId, orderName: intent.orderName,
            totalAmount: intent.totalAmount, currency: intent.currency, payMethod: intent.payMethod, customData: intent.customData,
            // 모바일은 결제 앱·PG 페이지로 나갔다가 이 주소로 돌아온다(복귀 시 resume()이 complete를 다시 보낸다).
            redirectUrl: `${origin}/?bs_pay=${encodeURIComponent(intent.paymentId)}`,
          });
        } catch { return { ok: false, reason: 'payment-failed' }; }
        // 결제창 응답은 코드가 있으면 실패·취소다. 코드가 없어도 지급 근거가 아니므로 서버 조회(complete)로만 확정한다.
        if (result?.code) { clearPending(); return { ok: false, reason: /CANCEL/i.test(String(result.code)) ? 'cancelled' : 'payment-failed' }; }
        return await complete(intent.paymentId);
      } finally { busy = false; }
    },
    /** 앱 시작·복귀 때: 리다이렉트 결제 복귀 또는 결제창 뒤에 끊긴 보류 결제를 서버에 다시 확인한다. */
    async resume() {
      if (channel !== 'web' || !webOn || busy) return null;
      const params = new URLSearchParams(location?.search || '');
      const returned = params.get('paymentId') || params.get('bs_pay');
      if (params.get('code') && returned) { clearPending(); return { ok: false, reason: /CANCEL/i.test(params.get('code')) ? 'cancelled' : 'payment-failed' }; }
      const pending = readPending();
      const paymentId = returned && PAYMENT_ID.test(returned) ? returned : pending?.paymentId;
      if (!paymentId) return null;
      busy = true;
      try {
        const r = await complete(paymentId);
        // 주소의 결제 쿼리는 한 번만 쓰고 지운다(새로고침마다 재조회하지 않게).
        try { if (returned && history?.replaceState) history.replaceState(null, '', location.pathname || '/'); } catch { /* 무시 */ }
        return r;
      } finally { busy = false; }
    },
  };
  return service;
}
