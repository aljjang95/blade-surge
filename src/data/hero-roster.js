// 영웅 소유 정책(수익화 1단계). 클라이언트 저장·서버 정화·결제 카탈로그가 같은 상수를 쓴다.
// 정책 1(LEGACY): 이 정책 전에 만든 저장. 다섯 영웅을 모두 소유한 채 그대로 둔다(기존 이용자 보호).
// 정책 2(STARTER): 새 저장. 시작 영웅 1명만 무료, 나머지는 게임 내 해금 또는 영웅 해금 상품으로 연다.

export const HERO_POLICY = Object.freeze({ LEGACY: 1, STARTER: 2 });
export const HERO_POLICY_CURRENT = HERO_POLICY.STARTER;

/** 서버 권한 키 'hero:<id>' ↔ 영웅 id. */
export const HERO_ENTITLEMENT_PREFIX = 'hero:';
export const heroEntitlementKey = (id) => HERO_ENTITLEMENT_PREFIX + id;
export function heroIdFromEntitlement(key) {
  return typeof key === 'string' && key.startsWith(HERO_ENTITLEMENT_PREFIX) ? key.slice(HERO_ENTITLEMENT_PREFIX.length) : null;
}
