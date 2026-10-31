// 영웅 소유 정책(수익화 1단계). 클라이언트 저장·서버 정화·결제 카탈로그가 같은 상수를 쓴다.
// 정책 1(LEGACY): 이 정책 전에 만든 저장. 다섯 영웅을 모두 소유한 채 그대로 둔다(기존 이용자 보호).
// 정책 2(STARTER): 새 저장. 시작 영웅 1명만 무료, 나머지는 게임 내 해금 또는 영웅 해금 상품으로 연다.

export const HERO_POLICY = Object.freeze({ LEGACY: 1, STARTER: 2 });
export const HERO_POLICY_CURRENT = HERO_POLICY.STARTER;
/**
 * 정책 1 이 무료로 소유하는 원래 다섯 영웅이자 영웅 직접 판매 상품(hero_<id>_v1)·시작 영웅 후보의 범위.
 * 이 뒤에 들어온 소환 전용 SSR(늑대인간 족장 등)은 정책 1 이용자도 소환으로 얻는다(공짜 지급 없음, 판매 상품 없음).
 */
export const HERO_LEGACY_IDS = Object.freeze(['knight', 'barbarian', 'mage', 'rogue', 'ranger']);

/**
 * 정책 2(시작 영웅 1명)가 운영에 들어간 시각의 보수적 하한(PR #253 squash 머지 2026-10-24 16:26:22 KST).
 * 서버가 기록한 소셜 프로필 생성 시각이 이보다 앞서면 그 계정은 정책 1 시절 이용자라는 서버 증거다(BM_DESIGN 11.6-1).
 * 머지~배포 사이에 프로필을 만든 이용자는 정책 1 클라이언트였을 수 있지만 증거로 치지 않고 보상으로 처리한다(보수적).
 */
export const HERO_STARTER_POLICY_SINCE = Date.UTC(2026, 9, 24, 7, 26, 22);
/**
 * 서버 증거 없이 정책 1을 주장한 저장(로컬 roster 없음 또는 정책 1)이 서버 정본이 될 때 한 번 주는 보상.
 * 영웅 4명 대신 영웅 배너 10회분 소환권. 증거가 없으니 영웅을 주지는 않는다(17,900원 전원 해금 우회 차단).
 */
export const HERO_LEGACY_COMPENSATION = Object.freeze({ tickets: 10 });

/** 서버 권한 키 'hero:<id>' ↔ 영웅 id. */
export const HERO_ENTITLEMENT_PREFIX = 'hero:';
export const heroEntitlementKey = (id) => HERO_ENTITLEMENT_PREFIX + id;
export function heroIdFromEntitlement(key) {
  return typeof key === 'string' && key.startsWith(HERO_ENTITLEMENT_PREFIX) ? key.slice(HERO_ENTITLEMENT_PREFIX.length) : null;
}

/**
 * 무과금 영웅 해금 사다리. 시작 영웅 뒤로 열리는 순서(0부터)마다 캠페인 진행(progress.unlocked, 다음 열릴 관문 번호)과 보석 비용을 정한다.
 * 근거(bun run sim:90d 페르소나 중앙값 + shop 무료 수입):
 *  - 시작 보석 1,500 + 환영 우편 500 = 2,000. 캠페인 첫 클리어 보석(스토리 60관문 합 약 6,700), 출석 주 300(일 약 43), 패스·임무 약 1,000, 탑·이벤트 약 20/일.
 *  - 누적 보석(시작 포함): 일반 D30 약 11.0k · D45 약 12.1k, 라이트 D30 약 10.1k · D45 약 11.7k, 하드코어 D30 약 11.5k.
 *  - 비용 합계 11,000 = 일반 약 30일 · 라이트 약 40~45일(소환·다른 소비가 없을 때). 둘째 영웅은 3-5 클리어(일반 3일·라이트 5일·하드코어 1일) 뒤 1,500으로 연다.
 */
export const HERO_FREE_UNLOCK = Object.freeze([
  Object.freeze({ need: 26, gems: 1500 }),
  Object.freeze({ need: 36, gems: 2500 }),
  Object.freeze({ need: 46, gems: 3000 }),
  Object.freeze({ need: 56, gems: 4000 }),
]);
export const HERO_FREE_UNLOCK_TOTAL_GEMS = HERO_FREE_UNLOCK.reduce((sum, step) => sum + step.gems, 0);

/**
 * 영웅 획득 경로 스위치(BM 12장, 2026-10-24 대표님 "뽑기 구조"). true 면 시작 영웅 뒤 영웅은 소환으로만 얻고 보석 해금 사다리는 닫힌다.
 * 사다리 수치(HERO_FREE_UNLOCK)는 되돌릴 때를 위해 남긴다. 결정 근거와 버린 안은 docs/BM_DESIGN.md 12.2.
 */
export const HERO_UNLOCK_VIA_GACHA = true;

/**
 * 성장형 합류(2026-10-27 대표님 결정 "전체 오픈 아님, 성장형", 지휘 세션 전달): 원래 다섯 영웅은 캠페인 지역 마지막 관문을 처음 넘길 때
 * 이야기 속에서 동료로 합류한다. SR(리아·카인·실바)이 먼저(2·3·4장 끝), SSR(아르카·드라칸)은 5·6장 끝. 시작 영웅은 건너뛴다.
 * 순서는 docs/WORLD_BIBLE.md 합류 장(리아 3장·카인 4장)과 맞추고, SR→SSR 성장 곡선을 우선했다(실바 6장 → 5장 진입, 드라칸 2장 → 7장 진입).
 * 소환·영웅 상품 경로는 그대로다(소환 전용 SSR 늑대인간·검은 고양이는 소환으로만). 서버 정산(src/shared/settlement.js)이 같은
 * Economy.completeStage 를 돌리므로 서버 문서의 roster.owned 도 같은 값이 된다.
 * 값 = 이 진행(progress.unlocked, 다음 열릴 관문 번호) 이상이면 합류. 21 = 2-10 클리어 후.
 */
export const HERO_CAMPAIGN_JOIN = Object.freeze({ mage: 21, rogue: 31, ranger: 41, knight: 51, barbarian: 61 });

/** 시작 영웅 선택 화면이 열리기 전 임시 시작 영웅. */
export const HERO_STARTER_DEFAULT = 'knight';

/** 진행 조건 문구용: 다음 열릴 관문 번호(1부터) → '2장 5관문'. */
export function stageLabelFromUnlocked(unlocked, perChapter = 10) {
  const cleared = Math.max(1, unlocked - 1);
  return Math.ceil(cleared / perChapter) + '-' + (((cleared - 1) % perChapter) + 1);
}

/** roster 상태 하나로 소유 여부를 판단한다. roster 가 없는 상태(옛 저장 원본·테스트 픽스처)는 정책 1 로 본다. */
export function rosterOwns(roster, id) {
  if (!roster || typeof roster !== 'object') return HERO_LEGACY_IDS.includes(id);
  if (roster.policy === HERO_POLICY.LEGACY && HERO_LEGACY_IDS.includes(id)) return true;
  return (Array.isArray(roster.owned) && roster.owned.includes(id)) || (Array.isArray(roster.paid) && roster.paid.includes(id));
}
