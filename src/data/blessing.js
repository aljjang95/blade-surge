/**
 * 전운 굴리기(출격 전 1회용 각인) 수치 표. 설계: docs/RUNE_AND_BLESSING_DESIGN.md 3장.
 * 확률 공개 시트(blessing-odds)는 이 파일에서만 숫자를 만든다. 손으로 쓴 확률 문구를 두지 않는다.
 */

/** 후보 수(한 굴림에 서로 다른 각인 3개). */
export const BLESSING_CANDIDATES = 3;

/** 후보 1칸의 등급 확률. 합은 1. 등급 n은 preRunBoons에 같은 id n번(= 각인 n랭크). */
export const BLESSING_GRADE_RATES = Object.freeze([
  Object.freeze({ grade: 1, label: 'I', rate: 0.70 }),
  Object.freeze({ grade: 2, label: 'II', rate: 0.25 }),
  Object.freeze({ grade: 3, label: 'III', rate: 0.05 }),
]);

/** 천장: III 없이 이 횟수만큼 굴리면 다음 굴림의 후보 1개가 III 확정. 무료·부적·보석 굴림 모두 센다. */
export const BLESSING_PITY = 10;

/** 같은 출격 준비 중 보석 굴림 가격: 1번째 30 · 2번째 60 · 3번째부터 90(상한). */
export const BLESSING_GEM_PRICES = Object.freeze([30, 60, 90]);

/** 하루 무료 굴림 수(05:00 KST 리셋). */
export const BLESSING_DAILY_FREE = 1;

/** 하루 보석 굴림 상한(과소비 방지, 05:00 KST 리셋). */
export const BLESSING_DAILY_GEM_CAP = 30;

/** 한국 05:00 기준 일자 계산용 오프셋(KST 05:00 = UTC 20:00 → +4시간 밀면 UTC 자정). journey-core와 같은 값. */
export const BLESSING_DAY_OFFSET_MS = 4 * 3600000;

/** 전운 부적(무료 굴림권) 지급량. 실제 지급은 의뢰·패스·월정액 쪽(economy/journey)이 이 상수를 읽어 한다. */
export const BLESSING_CHARM_GRANTS = Object.freeze({
  dailyContract: 1, // 일일 의뢰 보상 1개
  weeklyContract: 3, // 주간 의뢰 보상 3개
  passEveryLevels: 5, // 시즌 패스 무료 줄 5단계마다
  passAmount: 1, // 그때 1개
  monthlyDaily: 1, // 월정액 매일 +1
});

/** 부적 보유 상한(저장값 정규화용). */
export const BLESSING_CHARM_MAX = 999;

/**
 * 천장 포함 실효 확률(정상 굴림 순서, 천장 켬). 해석적 값:
 * q = 0.95³(굴림에 III 없음), 한 주기 기대 굴림 수 E = (1 − q¹¹)/(1 − q),
 * 굴림당 III≥1 = 1/E ≈ 0.17479, III 후보 비율 = (0.15·(1 − q¹⁰)/(1 − q) + 1.1·q¹⁰) / (3E) ≈ 0.06188.
 * test/blessing-core.test.ts가 고정 시드 모의와 ±0.3%p 안에서 일치하는지 검증한다.
 */
export const BLESSING_EFFECTIVE = Object.freeze({
  iiiCandidateRate: 0.0619, // 후보 1칸이 III일 실효 비율 약 6.19%
  atLeastOneIIIPerRoll: 0.1748, // 굴림당 III 1개 이상 실효 비율 약 17.48%
});

/** 확률 시트 회색 주석. 현재 economy는 보석을 단일 잔액(`gems`)으로 저장한다(유료 분리 `gems_paid`는 보석 팩 판매 게이트 'paid-gem-split' 뒤). */
export const BLESSING_GEM_NOTE = '보석 사용 시 무료·유료 보석 구분 없이 차감됩니다.';
