// 지역(장) 시간 개방표. 새 지역은 진행도(앞 장 X-10 클리어)와 별개로 개방 시각이 지나야 들어갈 수 있다(docs/SPEC_720H.md 3.3).
// 판정은 항상 호출하는 쪽이 넘기는 시각으로만 한다: 서버는 요청 시각(c.now), 클라이언트는 eco.trustedClock(계정 서버 시각) → eco.now → 기기 시계 순이다.
// 개방표에 없는 장은 처음부터 열려 있다.

const WEEK_MS = 7 * 24 * 3600 * 1000;
/**
 * 시즌 1 시작: 2026-10-26(월) 05:00 KST. content-90d.js 의 SEASON.startMs 와 같은 값이다.
 * 그 파일은 콘텐츠 레인 소유라 여기서 가져오지 않고 test/chapter-open.test.ts 가 두 값을 대조한다.
 */
export const SEASON_START_MS = Date.UTC(2026, 9, 25, 20, 0, 0);

/** 장 번호 → 개방 시각(ms). 7장은 시즌 W1(시즌 시작)부터, 10·11·12장은 W5·W8·W11 에 이어서 더한다. */
export const CHAPTER_OPEN = Object.freeze({
  7: SEASON_START_MS,
});

/** 그 장이 열리는 시각(ms). 개방표에 없는 장은 0(항상 열림). 정수가 아니거나 1보다 작은 번호는 Infinity(열리지 않음). */
export function chapterOpensAt(chapter) {
  if (!Number.isInteger(chapter) || chapter < 1) return Infinity;
  return CHAPTER_OPEN[chapter] ?? 0;
}

/** 시각을 알 수 없으면(NaN 등) 개방표가 있는 장은 닫힌 것으로 본다. */
export function isChapterOpen(chapter, nowMs) {
  const at = chapterOpensAt(chapter);
  if (at <= 0) return at === 0;
  return Number.isFinite(nowMs) && nowMs >= at;
}

/** 경제 객체(Economy / 서버 EconomyCore)의 규칙 시계: 신뢰 시계 → eco.now → 기기 시계. */
export function ecoClock(eco) {
  if (typeof eco?.trustedClock === 'function') return eco.trustedClock();
  return typeof eco?.now === 'function' ? eco.now() : Date.now();
}

/** 개방 시각을 KST 로 풀어 쓴 문구(예: '10월 26일 05:00'). 항상 열린 장은 빈 문자열. */
export function chapterOpenLabel(chapter) {
  const at = chapterOpensAt(chapter);
  if (!(at > 0) || !Number.isFinite(at)) return '';
  const kst = new Date(at + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}

/** 개방 주차 표(W1 기준) — 정본 표와 대조하는 테스트용. */
export const chapterOpenWeek = chapter => {
  const at = chapterOpensAt(chapter);
  return at > 0 && Number.isFinite(at) ? Math.floor((at - SEASON_START_MS) / WEEK_MS) + 1 : 0;
};
