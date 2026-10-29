// 영웅 보석 직접 영입(대표님 피드백 2026-10-29): 아직 합류하지 않은 영웅을 보석으로 바로 영입한다.
// 판매 시작·가격 공개는 대표님 결정이라 기본은 꺼 둔다(enabled:false). 켜기 전에는 Economy.buyHero 가 'disabled' 만 돌려주고 화면에도 나오지 않는다.
// 가격 근거는 docs/HERO_DIRECT_PURCHASE.md: 영웅 소환 배너에서 그 영웅을 얻는 데 드는 기대 보석(천장 포함) — SSR 은 픽업 기간 기대값, SR 은 임의 SR 영웅 1명 기대값.
// 클라이언트·서버(Economy/EconomyCore)가 이 객체 하나를 읽는다. enabled 는 시험이 잠깐 켜고 되돌릴 수 있게 변경 가능하게 두고, 키 추가·가격 변경은 봉인한다.
export const HERO_DIRECT_PURCHASE = Object.seal({
  enabled: false,
  prices: Object.freeze({ SR: 6000, SSR: 15000 }),
});
