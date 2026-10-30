// 상점 현금 상품의 채널별 판매 상태와 구매 위임(docs/BM_HANDOFF.md 남은 일 ⑤ 상점 웹 채널 구매 연결).
// - Play 앱: 기존 billing(Play 결제 → 서버 verify)만. 가격은 Play가 돌려준 문구.
// - 웹: 카탈로그에서 웹으로 파는(enabled·channels에 'web') 상품만 app.heroPurchase(포트원 → 서버 complete)로 판다.
//   서버가 웹 결제를 켜지 않았으면(플래그·채널키·서버 권위) 'pending'(준비 중)으로만 보이고 서버 intent를 부르지 않는다.
import { STORE_CHANNEL } from '../platform/store-channel.js';
import { IAP_BY_SHOP_SKU, soldOn } from '../shared/iap-catalog.js';

/** 결제 확인 창의 결제수단 문구. 웹에서 "Google Play 결제"라고 쓰지 않는다. */
export const PAY_VIA = Object.freeze({ play: 'Google Play 결제', web: '카드·간편결제(KG이니시스)' });

/** 웹에서 이 상점 SKU로 파는 카탈로그 상품(없으면 null). 판매 여부(enabled)·웹 채널을 본다. 자격은 서버 intent가 최종 판정한다. */
export function webCatalogProduct(skuId) {
  const p = typeof skuId === 'string' && Object.hasOwn(IAP_BY_SHOP_SKU, skuId) ? IAP_BY_SHOP_SKU[skuId] : null;
  return p && p.enabled && soldOn(p, 'web') && p.type !== 'subscription' ? p : null;
}

/**
 * 상점 SKU의 현금 판매 상태.
 * @param {string} skuId @param {{ channel?: string, billing?: any, heroPurchase?: any }} [opts]
 * @returns {{ mode: 'play', productId: string, formattedPrice: string, type: string } | { mode: 'web', productId: string, formattedPrice: string, type: string } | { mode: 'pending', productId: string, type: string } | null}
 */
export function cashOffer(skuId, { channel = STORE_CHANNEL, billing = null, heroPurchase = null } = {}) {
  // Play 결제가 연결돼 있으면(Play 앱) 항상 Play 경로. 웹 포트원으로 새지 않는다.
  if (billing?.available?.() === true) {
    const p = billing.productForShopSku?.(skuId);
    return p && p.sellable === true && typeof p.formattedPrice === 'string' ? { mode: 'play', productId: p.id, formattedPrice: p.formattedPrice, type: p.type } : null;
  }
  // 웹 채널이고 계정 서버가 구매 트리거를 꽂았을 때만 웹 상품을 보인다(계정 서버가 없으면 지금처럼 숨긴다).
  if (channel !== 'web' || !heroPurchase) return null;
  const p = webCatalogProduct(skuId);
  if (!p) return null;
  let on = false, price = null;
  try { on = heroPurchase?.available?.() === true; price = on ? heroPurchase.price?.(p.id) ?? null : null; } catch { on = false; }
  return on && typeof price === 'string' && price ? { mode: 'web', productId: p.id, formattedPrice: price, type: p.type } : { mode: 'pending', productId: p.id, type: p.type };
}

/**
 * 판매 상태에 맞는 결제 경로로 넘긴다. 'pending'·없음은 아무 서버도 부르지 않고 unavailable.
 * @param {any} offer @param {{ billing?: any, heroPurchase?: any }} [opts] @returns {Promise<any>}
 */
export async function payCash(offer, { billing = null, heroPurchase = null } = {}) {
  if (offer?.mode === 'play' && billing) return billing.buy(offer.productId);
  if (offer?.mode === 'web' && heroPurchase) return heroPurchase.buy(offer.productId);
  return { ok: false, reason: 'unavailable' };
}
