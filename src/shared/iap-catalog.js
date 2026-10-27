// BM D10: Google Play 인앱 상품 정본 카탈로그. 서버(/api/v1/iap)·클라이언트 상점·Play 등록 스크립트가 같은 표를 쓴다.
// 가격은 "후보"다(docs/BM_DESIGN.md 3장). 실제 판매가는 Play 콘솔 등록값이 정본이며, 등록·가격 공개는 대표님 확인 뒤에만 한다.
// 서버는 클라이언트가 보낸 가격·보상·기간을 받지 않는다. 이 표의 grant만 지급 근거다.

import { HERO_ORDER, HEROES } from '../data/heroes.js';
import { HERO_LEGACY_IDS, heroEntitlementKey, heroIdFromEntitlement } from '../data/hero-roster.js';

export const IAP_CATALOG_VERSION = 3;
export const IAP_PACKAGE = 'com.theluxurylord.bladesurge';

/** 시즌 1(12주). 시즌 패스 권한은 이 시각까지만 유효하다(서버 시계). */
export const SEASONS = Object.freeze({
  s1: Object.freeze({ id: 's1', startsAt: Date.UTC(2026, 10, 1, 15), endsAt: Date.UTC(2027, 0, 24, 15) }),
});
export const CURRENT_SEASON = 's1';

/**
 * type: consumable(지급 뒤 consume) · non_consumable(acknowledge만, 영구/기간 권한) · subscription(자동 갱신, 기간마다 지급)
 * grant.rewards: 구매 1건당 1회 지급 / grant.perPeriod: 구독 결제 주기(주문)마다 1회 / grant.entitlement: 권한 키 하나
 * grant.entitlements: 권한 키 여러 개(영웅 전원 해금 등, `[{ key }]`). entitlement와 함께 있어도 둘 다 지급한다. entitlementKeys(product)로 읽는다.
 * channels: 이 상품을 파는 결제 채널(['web','play']). 없으면 Play만(기존 상품). 웹·Play 동일가.
 *   웹(KG이니시스) 채널은 구매 즉시 지급형(B형)만 판다: 영구 권한·계정당 1회 패키지·기간 이용권. 저장형 보석 팩·확률형 상품은 웹에 올리지 않는다(docs/PAYMENT_COMPLIANCE.md 4.1).
 * periodDays(구독이 아닌 상품): 권한이 구매 시각부터 이 일수 뒤 끝나는 기간 이용권(자동 갱신 없음).
 * enabled=false 상품은 서버가 의도(intent)·검증 모두 거부한다(판매 전 게이트가 남은 상품).
 * @typedef {{ id: string, type: 'consumable'|'non_consumable'|'subscription', enabled: boolean, priceKRW: number,
 *   title: string, description: string, shopSku: string|null, once?: boolean, basePlanId?: string, periodDays?: number,
 *   season?: string, gate?: string, channels?: readonly string[],
 *   grant: { rewards?: Record<string, number>, perPeriod?: Record<string, number>, daily?: Record<string, number>,
 *     entitlement?: { key: string }, entitlements?: readonly { key: string }[] } }} IapProduct
 */
/** 영웅 해금 상품 가격 후보(원). 공개 전 대표님 확인(docs/BM_DESIGN.md '영웅 해금'). 웹·Play 동일가. */
export const HERO_PRICE_KRW = 5900;
export const HERO_ALL_PRICE_KRW = 17900;
/** hero_<id>_v1 상품 id ↔ 영웅 id. */
export const heroProductId = (heroId) => `hero_${heroId}_v1`;
export const HERO_ALL_PRODUCT_ID = 'hero_all_v1';
const CHANNELS_ALL = Object.freeze(['web', 'play']);
const CHANNELS_WEB = Object.freeze(['web']);
const DAY_MS = 86400000;
/** 영웅 아바타 풀셋(외형 + 작은 풀셋 효과) 상품. 아바타 시스템 레인이 외형·효과를 만들고, 이 표는 상품 id·권한 키·지급만 정한다. */
export const AVATAR_FULLSET_PRICE_KRW = 14900;
export const avatarFullsetProductId = (heroId) => `avatar_fullset_${heroId}_v1`;
export const avatarFullsetKey = (heroId) => `avatar:${heroId}:fullset`;
/** 권한 키 → 아바타 풀셋 영웅 id(아니면 null). */
export function heroIdFromAvatarKey(key) {
  const m = typeof key === 'string' ? /^avatar:([a-z0-9]+):fullset$/.exec(key) : null;
  return m && HERO_ORDER.includes(m[1]) ? m[1] : null;
}
// 판매 시작은 아바타 시스템(외형·풀셋 효과) 출시 뒤 대표님 확인으로 연다(gate 'avatar-system').
const AVATAR_PRODUCTS = HERO_ORDER.map((id) => ({
  id: avatarFullsetProductId(id), type: 'non_consumable', enabled: false, gate: 'avatar-system', priceKRW: AVATAR_FULLSET_PRICE_KRW,
  shopSku: `avatar_fullset_${id}`, channels: CHANNELS_ALL,
  title: `아바타 풀셋 · ${HEROES[id].name}`, description: `${HEROES[id].name} 전용 아바타 풀셋(외형 + 풀셋 효과)을 계정에 영구 지급합니다. 전투 수치에는 영향이 없습니다.`,
  grant: { entitlement: { key: avatarFullsetKey(id) } },
}));
// 영웅은 소환으로 얻는다(BM 12장). 영웅 직접 판매 상품은 판매 목록에서 내리고(enabled=false), 서버 권한 경로·이미 산 권한 복원은 그대로 둔다.
// 상품은 원래 다섯 영웅만(HERO_LEGACY_IDS). 소환 전용 SSR 은 상품이 없다 — 상품 id·영수증 복원 범위가 영웅 추가로 바뀌지 않는다.
const HERO_PRODUCTS = HERO_LEGACY_IDS.map((id) => ({
  id: heroProductId(id), type: 'non_consumable', enabled: false, gate: 'gacha-only', priceKRW: HERO_PRICE_KRW, shopSku: `hero_${id}`, channels: CHANNELS_ALL,
  title: `영웅 해금 · ${HEROES[id].name}`, description: `${HEROES[id].name}을(를) 계정에 영구 해금합니다(기기를 바꿔도 복원).`,
  grant: { entitlement: { key: heroEntitlementKey(id) } },
}));

/** @type {readonly IapProduct[]} */
export const IAP_PRODUCTS = Object.freeze([
  { id: 'remove_ads_v1', type: 'non_consumable', enabled: true, priceKRW: 4900, shopSku: 'remove_ads', channels: CHANNELS_ALL,
    title: '광고 제거', description: '전면 광고를 영구히 끕니다(계정 단위, 기기를 바꿔도 복원).',
    grant: { entitlement: { key: 'ads_removed' } } },
  { id: 'starter_pack_v1', type: 'consumable', enabled: true, once: true, priceKRW: 1200, shopSku: 'starter', channels: CHANNELS_ALL,
    title: '첫 구매 스타터 팩', description: 'SSR 확정 소환권 1 · 보석 1,000 · 골드 50,000 (계정당 1회)',
    grant: { rewards: { ssrTicket: 1, gems: 1000, gold: 50000 } } },
  { id: 'monthly_card_v1', type: 'subscription', enabled: true, priceKRW: 5900, shopSku: 'monthly', basePlanId: 'monthly', periodDays: 30,
    title: '월정액 카드', description: '결제할 때마다 보석 1,200 + 기간 중 매일 보석 100 (자동 갱신, 언제든 해지)',
    grant: { perPeriod: { gems: 1200 }, daily: { gems: 100 }, entitlement: { key: 'monthly' } } },
  { id: 'season_pass_s1', type: 'non_consumable', enabled: true, priceKRW: 9900, shopSku: 'pass', season: 's1', channels: CHANNELS_ALL,
    title: '시즌 1 프리미엄 패스', description: '시즌 1 동안 프리미엄 보상 줄을 엽니다(이미 달성한 단계도 받을 수 있음).',
    grant: { entitlement: { key: 'pass:s1' } } },
  // 웹 월정액: 웹(KG이니시스)에서는 자동 결제(빌링키)를 쓰지 않고 30일 이용권으로 판다(PG '장기서비스제공' 심사 위험·해지 다크패턴 회피).
  // 지급은 Play 월정액과 같다: 구매 즉시 보석 1,200 + 30일 동안 매일 보석 100(권한 'monthly'). 이용 중에는 다시 살 수 없다.
  { id: 'monthly_pass_v1', type: 'consumable', enabled: false, gate: 'web-billing', priceKRW: 5900, shopSku: null, periodDays: 30, channels: CHANNELS_WEB,
    title: '월정액 카드 (30일)', description: '구매 즉시 보석 1,200 + 30일 동안 매일 보석 100 (자동 갱신 없음)',
    grant: { rewards: { gems: 1200 }, daily: { gems: 100 }, entitlement: { key: 'monthly' } } },
  // 성장 패키지: 즉시 지급형(확률형 구성품 없음), 계정당 1회.
  { id: 'growth_pack_v1', type: 'consumable', enabled: false, gate: 'owner-price', once: true, priceKRW: 12000, shopSku: 'growth', channels: CHANNELS_ALL,
    title: '성장 패키지', description: '보석 2,400 · 골드 200,000 · 초월석 5 · 강화석 100 (계정당 1회)',
    grant: { rewards: { gems: 2400, gold: 200000, transcendStones: 5, stones: 100 } } },
  ...AVATAR_PRODUCTS,
  ...HERO_PRODUCTS,
  { id: HERO_ALL_PRODUCT_ID, type: 'non_consumable', enabled: false, gate: 'gacha-only', priceKRW: HERO_ALL_PRICE_KRW, shopSku: 'hero_all', channels: CHANNELS_ALL,
    title: '영웅 전원 해금', description: '다섯 영웅을 모두 계정에 영구 해금합니다(개별 구매 대비 약 24% 할인).',
    grant: { entitlements: HERO_LEGACY_IDS.map((id) => ({ key: heroEntitlementKey(id) })) } },
  // 보석 팩: 유료/무료 분리(paidGems, 무료부터 소비, 환불 역분개)는 BM 12.4로 준비됐다. 판매 시작·가격 공개는 대표님 확인 뒤(gate 유지).
  // Play 단독(channels 없음): 저장형 재화 충전은 웹(KG이니시스)에서 팔지 않는다(PAYMENT_COMPLIANCE 4.1-2).
  { id: 'gems_300_v1', type: 'consumable', enabled: false, gate: 'paid-gem-split', priceKRW: 3900, shopSku: 'gem1',
    title: '보석 300', description: '보석 300', grant: { rewards: { gems: 300 } } },
  { id: 'gems_980_v1', type: 'consumable', enabled: false, gate: 'paid-gem-split', priceKRW: 12000, shopSku: 'gem2',
    title: '보석 980', description: '보석 980', grant: { rewards: { gems: 980 } } },
  { id: 'gems_1980_v1', type: 'consumable', enabled: false, gate: 'paid-gem-split', priceKRW: 25000, shopSku: 'gem3',
    title: '보석 1,980', description: '보석 1,980', grant: { rewards: { gems: 1980 } } },
]);

export const IAP_BY_ID = Object.freeze(Object.fromEntries(IAP_PRODUCTS.map((p) => [p.id, p])));
export const IAP_BY_SHOP_SKU = Object.freeze(Object.fromEntries(IAP_PRODUCTS.filter((p) => p.shopSku).map((p) => [p.shopSku, p])));

/** 지급 가능한 보상 키(Economy.addRewards와 같은 이름). 이 밖의 키는 카탈로그 검사에서 실패한다. @type {readonly string[]} */
export const IAP_REWARD_KEYS = Object.freeze(['gems', 'gold', 'ssrTicket', 'tickets', 'stones', 'transcendStones']);
/** 보상 키 → 세이브 필드(정화 상한 가산용). @type {Readonly<Record<string, string>>} */
export const IAP_REWARD_FIELD = Object.freeze({ gems: 'gems', gold: 'gold', ssrTicket: 'ssrTickets', tickets: 'tickets', stones: 'stones', transcendStones: 'transcendStones' });

/** 상품이 주는 권한 키 전부(entitlement 하나 + entitlements 배열). 중복 제거. */
export function entitlementKeys(product) {
  const keys = [];
  if (product?.grant?.entitlement?.key) keys.push(product.grant.entitlement.key);
  for (const e of product?.grant?.entitlements || []) if (e?.key && !keys.includes(e.key)) keys.push(e.key);
  return keys;
}

/** 이 채널에서 파는 상품인가. channels가 없는 기존 상품은 Play만 판다. */
export function soldOn(product, channel) {
  return (product?.channels || ['play']).includes(channel);
}

/** 판매 가능한(enabled) 상품만. */
export function sellableProduct(id) {
  const p = typeof id === 'string' && Object.hasOwn(IAP_BY_ID, id) ? IAP_BY_ID[id] : null;
  return p && p.enabled ? p : null;
}
/** 판매를 내린 상품 중 기존 영수증의 검증·지급·acknowledge는 계속 받는 gate(신규 판매만 막는다). */
export const VERIFY_ONLY_GATES = Object.freeze(['gacha-only']);
/** 영수증 검증에 쓰는 상품: 판매 중이거나, 판매만 내리고 기존 구매 복구는 유지하는 상품(영웅 직접 판매 등). */
export function verifiableProduct(id) {
  const p = typeof id === 'string' && Object.hasOwn(IAP_BY_ID, id) ? IAP_BY_ID[id] : null;
  return p && (p.enabled || VERIFY_ONLY_GATES.includes(p.gate)) ? p : null;
}

/** 권한 키의 유효 종료 시각. null = 무기한. 시즌 패스는 시즌 종료, 구독은 Play expiryTime(서버가 넣는다). */
export function entitlementEnds(product, now) {
  if (product.season) return SEASONS[product.season]?.endsAt ?? now;
  if (product.type !== 'subscription' && product.periodDays > 0) return now + product.periodDays * DAY_MS;
  return null;
}

/** 서버 권한 목록 → 클라이언트/서버 문서 덮어쓰기용 요약. ents: [{ key, expiresAt|null }] */
export function summarizeEntitlements(ents, now) {
  const live = (e) => !e.revokedAt && (e.expiresAt === null || e.expiresAt === undefined || e.expiresAt > now);
  const active = ents.filter(live);
  const monthly = active.filter((e) => e.key === 'monthly').reduce((m, e) => Math.max(m, e.expiresAt || 0), 0);
  return {
    adsRemoved: active.some((e) => e.key === 'ads_removed'),
    monthlyUntil: monthly,
    passPremium: active.some((e) => e.key === 'pass:' + CURRENT_SEASON),
    // 활성 영웅 권한(hero:<id>)의 영웅 id. 서버 권한이 영웅 소유의 정본이다.
    heroes: [...new Set(active.map((e) => heroIdFromEntitlement(e.key)).filter((id) => id && HERO_ORDER.includes(id)))],
    // 활성 아바타 풀셋 권한(avatar:<id>:fullset)의 영웅 id. 아바타 시스템이 외형·풀셋 효과 해금에 쓴다.
    avatarFullsets: [...new Set(active.map((e) => heroIdFromAvatarKey(e.key)).filter(Boolean))],
    season: CURRENT_SEASON,
  };
}
