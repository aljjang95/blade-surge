// 게임물 등급 표시 정본(게임산업법 제33조 제1항 · docs/release/RATING_DECISION.md).
// 등급을 받기 전에는 등급 마크·연령을 표시하지 않는다(받지 않은 등급 표시는 허위 표시). 결과가 나오면 아래 한 곳만 채운다.
// 웹(blade.tllhouse.com) 등급은 원스토어 IARC 대한민국 결과를 쓴다(대표님 결정 2026-10-31, 카롬 마스터 선례).
// 게임위(GRAC) 직접 심사 번호가 아니므로 '등급분류번호'로 부르지 않고 'IARC 인증 ID'로만 표기한다.
// 웹 포트원 결제는 이 값이 채워져 ratingReady 가 true 일 때만 서버가 연다(worker/v1/portone.ts webRatingReady).
import { STORE_CHANNEL } from '../platform/store-channel.js';

/** @typedef {'preparing'|'reviewing'|'rated'} RatingStatus */
/** @typedef {'GRAC'|'IARC'|'ONESTORE'} RatingAuthority */
/**
 * @typedef {{ status: RatingStatus, age: null|'전체'|'12'|'15'|'청소년이용불가', number: null|string, date: null|string, descriptors: readonly string[],
 *   authority?: RatingAuthority, source?: 'onestore-iarc', certId?: null|string }} GameRating
 */

/**
 * 원스토어 IARC 대한민국 결과(원스토어 앱 등록·IARC 설문 뒤 발급). 이 객체의 값 세 줄만 채우면 웹 등급이 켜진다.
 * @type {{ age: null|'전체'|'12'|'15'|'청소년이용불가', certId: null|string, date: null|string, descriptors: readonly string[] }}
 */
export const WEB_ONESTORE_IARC = Object.freeze({
  age: null, // 예: '12'
  certId: null, // IARC 인증 ID(UUID)
  date: null, // 발급일 YYYY-MM-DD
  descriptors: Object.freeze([]), // 결과에 적힌 내용정보만(예: '폭력성')
});

/** 원스토어 IARC 결과를 표시용 등급으로 바꾼다. 연령·인증 ID 중 하나라도 비면 'preparing'. @param {typeof WEB_ONESTORE_IARC} r @returns {GameRating} */
export function webRatingFromOnestoreIarc(r) {
  const certId = typeof r.certId === 'string' && r.certId.trim() ? r.certId.trim() : null;
  const done = !!r.age && !!certId;
  return Object.freeze({
    authority: 'IARC', source: 'onestore-iarc', status: done ? 'rated' : 'preparing',
    age: done ? r.age : null, number: certId, certId, date: done ? (r.date ?? null) : null,
    descriptors: Object.freeze(done ? [...(r.descriptors ?? [])] : []),
  });
}

/** 웹 등급(원스토어 IARC). @type {GameRating} */
export const GAME_RATING = webRatingFromOnestoreIarc(WEB_ONESTORE_IARC);

/**
 * 채널별 등급. number 자리: Play·웹은 IARC 인증 ID, 원스토어 앱은 원스토어 등급분류번호.
 * 값이 들어오기 전에는 status 'preparing'으로 두어 '준비 중'만 보인다.
 * @type {Readonly<Record<string, GameRating>>}
 */
export const GAME_RATINGS = Object.freeze({
  web: GAME_RATING,
  googleplay: Object.freeze({ authority: 'IARC', status: 'preparing', age: null, number: null, date: null, descriptors: Object.freeze([]) }),
  onestore: Object.freeze({ authority: 'ONESTORE', status: 'preparing', age: null, number: null, date: null, descriptors: Object.freeze([]) }),
});

/** 이 빌드 채널의 등급(모르는 채널은 웹 기준). @param {string} [channel] @returns {GameRating} */
export function ratingFor(channel = STORE_CHANNEL) {
  return Object.hasOwn(GAME_RATINGS, channel) ? GAME_RATINGS[channel] : GAME_RATING;
}

/** 등급이 결정돼 번호까지 있는가(결제 게이트·표시 공용). @param {GameRating} [rating] */
export function ratingReady(rating = GAME_RATING) {
  return rating?.status === 'rated' && !!rating.age && Object.hasOwn(AGE_TEXT, rating.age) && typeof rating.number === 'string' && rating.number.trim().length > 0;
}

const AGE_TEXT = Object.freeze({ '전체': '전체이용가', '12': '12세이용가', '15': '15세이용가', '청소년이용불가': '청소년이용불가' });
const NUMBER_LABEL = Object.freeze({ GRAC: '등급분류번호', ONESTORE: '등급분류번호', IARC: 'IARC 인증 ID' });

/** 화면 한 줄 문구. 결정 전에는 진행 상태만 밝힌다. @param {GameRating} [rating] */
export function ratingLabel(rating = ratingFor()) {
  if (rating.status === 'rated' && rating.age && AGE_TEXT[rating.age]) {
    const parts = [AGE_TEXT[rating.age]];
    if (rating.descriptors?.length) parts.push(rating.descriptors.join('·'));
    if (rating.number) parts.push(`${rating.source === 'onestore-iarc' ? '원스토어 ' : ''}${NUMBER_LABEL[rating.authority ?? 'GRAC'] ?? '등급분류번호'} ${rating.number}`);
    return parts.join(' · ');
  }
  return rating.status === 'reviewing' ? '게임물 등급분류 심의 중' : '게임물 등급분류 신청 준비 중';
}
