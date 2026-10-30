// 게임물 등급 표시 정본(게임산업법 제33조 제1항 · docs/release/RATING_DECISION.md).
// 등급분류를 받기 전에는 등급 마크·연령을 표시하지 않는다(받지 않은 등급 표시는 허위 표시). 결정서가 나오면 status를 'rated'로 바꾸고
// age·number·date를 결정서 그대로 적는다. 부팅 화면(index.html #boot-rating)과 설정 화면이 이 값을 쓴다.

/** @typedef {'preparing'|'reviewing'|'rated'} RatingStatus */
/** @typedef {{ status: RatingStatus, age: null|'전체'|'12'|'15'|'청소년이용불가', number: null|string, date: null|string, descriptors: readonly string[] }} GameRating */

/** @type {GameRating} */
export const GAME_RATING = Object.freeze({
  // preparing=신청 전 · reviewing=게임위 심의 중 · rated=등급 결정
  status: 'preparing',
  // 결정서의 이용 등급
  age: null,
  /** 등급분류번호(결정서) */
  number: null,
  /** 등급분류일(YYYY-MM-DD) */
  date: null,
  /** 내용정보(결정서 기재 항목만). 신청 예정: 폭력성 */
  descriptors: Object.freeze([]),
});

const AGE_TEXT = Object.freeze({ '전체': '전체이용가', '12': '12세이용가', '15': '15세이용가', '청소년이용불가': '청소년이용불가' });

/** 화면 한 줄 문구. 결정 전에는 진행 상태만 밝힌다. @param {GameRating} [rating] */
export function ratingLabel(rating = GAME_RATING) {
  if (rating.status === 'rated' && rating.age && AGE_TEXT[rating.age]) {
    const parts = [AGE_TEXT[rating.age]];
    if (rating.descriptors?.length) parts.push(rating.descriptors.join('·'));
    if (rating.number) parts.push(`등급분류번호 ${rating.number}`);
    return parts.join(' · ');
  }
  return rating.status === 'reviewing' ? '게임물 등급분류 심의 중' : '게임물 등급분류 신청 준비 중';
}
