// 영웅 보석 직접 영입(대표님 피드백 2026-10-29): 아직 합류하지 않은 영웅을 보석으로 바로 영입한다.
// 판매 시작·가격 공개는 대표님 결정이라 기본은 꺼 둔다(enabled:false). 켜기 전에는 Economy.buyHero 가 'disabled' 만 돌려주고 화면에도 나오지 않는다.
// 가격(대표님 결정 2026-10-29): 영웅 1명 = 30,000원어치 보석, 모든 영웅 단일 가격. 환산은 보석 팩의 기본 단가(보너스 제외)
// 보석 300 = 3,900원(gems_300_v1) → 13원/보석 → 30,000 / 13 = 2,307.7 을 올림해 2,308. 근거와 소환 기대 비용 비교는 docs/HERO_DIRECT_PURCHASE.md.
// 클라이언트·서버(Economy/EconomyCore)가 이 객체 하나를 읽는다. enabled 는 시험이 잠깐 켜고 되돌릴 수 있게 변경 가능하게 두고, 키 추가·가격 변경은 봉인한다.
export const HERO_DIRECT_PURCHASE_KRW = 30000;
export const HERO_DIRECT_PURCHASE_GEMS = 2308;
export const HERO_DIRECT_PURCHASE = Object.seal({
  enabled: false,
  prices: Object.freeze({ SR: HERO_DIRECT_PURCHASE_GEMS, SSR: HERO_DIRECT_PURCHASE_GEMS }),
});
