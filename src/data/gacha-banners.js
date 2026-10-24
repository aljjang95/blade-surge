// 소환 배너 정본(docs/BM_DESIGN.md 12장). 클라이언트 소환·서버 규칙 엔진(EconomyCore)·확률 공개 화면·시뮬레이터가 이 표만 읽는다.
// 배너는 셋이다: 영웅 소환(2주 교대 픽업 SSR) / 장비 소환(픽업 SSR 세트) / 초보자(계정당 20회, 반값, SSR 영웅 확정).
// 영웅은 소환으로만 얻는다(시작 영웅 1명은 무료 선택). 첫 획득은 해금, 중복은 조각 dupShards개(초월 SR→SSR→SSSR 재료).
//
// 가중치 규칙(배너 공통): rates는 1회 기본 가중치. pity-softPity 사이에서는 softPity회 연속 미당첨 뒤(softPity+1번째)부터
// SSR 가중치가 매 회 softPityStep씩 오르고 pity번째는 SSR 확정. 10회 소환은 마지막 칸 SR 이상 보장.
// 등급 안 분배: hero(영웅 몫) · gear(장비 몫) · materials(재료, w는 그 등급 안의 비율). 등급마다 합이 1이다.

/** 2주 교대의 기준 시각(2026-10-26 월 00:00 KST). 이 시각 전은 첫 픽업을 보여 준다. */
export const BANNER_EPOCH = Date.UTC(2026, 9, 25, 15);
export const BANNER_PERIOD_MS = 14 * 86400000;

/**
 * 영웅 픽업 교대표(SSR 영웅 id). 없는 영웅·SSR이 아닌 영웅은 건너뛴다(신규 SSR이 들어오면 여기 한 줄 추가).
 * 3개월 로드맵(문서 12.5)의 신규 SSR은 영웅 정의가 머지된 뒤에만 이 표에 넣는다.
 */
export const HERO_PICKUP_ROTATION = Object.freeze(['barbarian', 'knight']);
/** 장비 픽업 세트 교대표(SSR=L 등급 세트 id). */
export const GEAR_PICKUP_ROTATION = Object.freeze(['dragon']);

/**
 * 소환 마일리지(니케 골드 마일리지·에픽세븐 신비 교환과 같은 구조). 영웅 배너 1회당 1점, cost점이면 지금 픽업 SSR 영웅 1명(또는 중복 조각)과 교환.
 * 교환은 천장·픽업 확정을 바꾸지 않는다. 픽업이 바뀌어도 점수는 이어진다(소멸 없음 — 이용자 신뢰).
 */
export const GACHA_MILEAGE = Object.freeze({ banner: 'hero', perPull: 1, cost: 200 });

export const BANNER_IDS = Object.freeze(['hero', 'gear', 'beginner']);

export const GACHA_BANNERS = Object.freeze({
  hero: Object.freeze({
    id: 'hero', name: '영웅 소환', single: 300, ten: 2700, pity: 80, softPity: 60, softPityStep: 6,
    rates: Object.freeze({ R: 85, SR: 13, SSR: 2 }),
    // SSR은 전부 영웅: 픽업 50%, 그 밖의 SSR 50%. 픽업이 아니면 다음 SSR은 픽업 확정(guarantee).
    ssr: Object.freeze({ hero: 1, featured: 0.5 }),
    sr: Object.freeze({ hero: 0.75 }),
    r: Object.freeze({ hero: 0 }),
    materials: Object.freeze({
      SSR: Object.freeze([]),
      SR: Object.freeze([Object.freeze({ k: 'stones2', n: 5, w: 0.1 }), Object.freeze({ k: 'protect', n: 1, w: 0.1 }), Object.freeze({ k: 'transcendStones', n: 1, w: 0.05 })]),
      R: Object.freeze([Object.freeze({ k: 'stones', n: 10, w: 0.6 }), Object.freeze({ k: 'bless', n: 1, w: 0.25 }), Object.freeze({ k: 'gold', n: 5000, w: 0.15 })]),
    }),
  }),
  gear: Object.freeze({
    id: 'gear', name: '장비 소환', single: 300, ten: 2700, pity: 60, softPity: 45, softPityStep: 7,
    rates: Object.freeze({ R: 80, SR: 17, SSR: 3 }),
    // SSR은 전부 L 장비: 픽업 세트 50%, 그 밖의 L 장비 50%. 픽업이 아니면 다음 SSR은 픽업 세트 확정.
    ssr: Object.freeze({ gear: 1, featured: 0.5 }),
    sr: Object.freeze({ gear: 0.8 }),
    r: Object.freeze({ gear: 0.6 }),
    materials: Object.freeze({
      SSR: Object.freeze([]),
      SR: Object.freeze([Object.freeze({ k: 'stones2', n: 5, w: 0.1 }), Object.freeze({ k: 'protect', n: 1, w: 0.1 })]),
      R: Object.freeze([Object.freeze({ k: 'stones', n: 10, w: 0.3 }), Object.freeze({ k: 'bless', n: 1, w: 0.1 })]),
    }),
  }),
  // 초보자: 10회 단위만, 반값, 계정당 limit회. limit번째까지 SSR이 없으면 마지막 회차가 SSR 영웅 확정.
  // 영웅 배너와 같은 구성(픽업 없이 SSR 영웅 균등). 영웅 배너 천장과 따로 센다.
  beginner: Object.freeze({
    id: 'beginner', name: '초보자 소환', single: 0, ten: 1350, limit: 20, pity: 20, softPity: 20, softPityStep: 0,
    rates: Object.freeze({ R: 85, SR: 13, SSR: 2 }),
    ssr: Object.freeze({ hero: 1, featured: 0 }),
    sr: Object.freeze({ hero: 0.75 }),
    r: Object.freeze({ hero: 0 }),
    materials: null, // 영웅 배너 재료 표를 쓴다
  }),
});

/** 배너 재료 표(초보자는 영웅 배너 표). */
export const bannerMaterials = (banner) => banner.materials || GACHA_BANNERS.hero.materials;

/** 교대 회차(0부터). 기준 시각 전은 0. */
export function rotationIndex(now) {
  const t = Number(now);
  return Number.isFinite(t) && t > BANNER_EPOCH ? Math.floor((t - BANNER_EPOCH) / BANNER_PERIOD_MS) : 0;
}

/** 교대 회차의 시작·끝(ms). */
export function rotationWindow(now) {
  const i = rotationIndex(now), start = BANNER_EPOCH + i * BANNER_PERIOD_MS;
  return { index: i, start, end: start + BANNER_PERIOD_MS };
}

/**
 * 지금 픽업. valid(id)가 거짓인 항목은 건너뛴다. 남는 항목이 없으면 null.
 * @param {readonly string[]} rotation @param {number} now @param {(id: string) => boolean} valid
 */
export function pickupAt(rotation, now, valid) {
  const list = rotation.filter(valid);
  return list.length ? list[rotationIndex(now) % list.length] : null;
}

/** pity회째(1부터) SSR 가중치. */
export function bannerSsrWeight(banner, pull) {
  return banner.rates.SSR + (pull > banner.softPity ? (pull - banner.softPity) * banner.softPityStep : 0);
}
/** pity회째(1부터) 등급 확률. */
export function bannerChances(banner, pull) {
  if (pull >= banner.pity) return { R: 0, SR: 0, SSR: 1 };
  const ssr = bannerSsrWeight(banner, pull), tot = banner.rates.R + banner.rates.SR + ssr;
  return { R: banner.rates.R / tot, SR: banner.rates.SR / tot, SSR: ssr / tot };
}
/** 천장을 포함한 SSR 1회당 평균 소환 수(정확한 기댓값). */
export function bannerPullsPerSsr(banner) {
  let alive = 1, expected = 0;
  for (let k = 1; k <= banner.pity; k++) { const p = bannerChances(banner, k).SSR; expected += alive * p * k; alive *= 1 - p; }
  return expected;
}
