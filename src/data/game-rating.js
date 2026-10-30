// 게임물 등급 표시 정본(게임산업법 제33조 제1항 · docs/release/RATING_DECISION.md).
// 등급분류를 받기 전에는 등급 마크·연령을 표시하지 않는다(받지 않은 등급 표시는 허위 표시). 결정서가 나오면 status를 'rated'로 바꾸고
// age·number·date를 결정서 그대로 적는다. 부팅 화면(index.html #boot-rating)과 설정 화면이 이 값을 쓴다.
// 채널별 등급(대표님 2026-10-30): 앱(Play·원스토어)은 자체등급분류사업자(Play=IARC, 원스토어=원스토어 자체등급분류)로 받고,
// 웹(blade.tllhouse.com)은 스토어 자체등급이 적용되지 않으므로 게임물관리위원회(GRAC) 등급분류번호가 필요하다.
// 웹 포트원 결제는 웹 등급이 'rated'이고 번호가 있을 때만 서버가 연다(worker/v1/portone.ts webRatingReady).
import { STORE_CHANNEL } from '../platform/store-channel.js';

/** @typedef {'preparing'|'reviewing'|'rated'} RatingStatus */
/** @typedef {'GRAC'|'IARC'|'ONESTORE'} RatingAuthority */
/**
 * @typedef {{ status: RatingStatus, age: null|'전체'|'12'|'15'|'청소년이용불가', number: null|string, date: null|string, descriptors: readonly string[],
 *   authority?: RatingAuthority }} GameRating
 */

/** 웹(GRAC) 등급. @type {GameRating} */
export const GAME_RATING = Object.freeze({
  authority: 'GRAC',
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

/**
 * 채널별 등급. number 자리: Play는 IARC 인증 ID(Play Console 등급 결과), 원스토어는 원스토어 등급분류번호.
 * 값이 들어오기 전에는 status 'preparing'으로 두어 '준비 중'만 보인다.
 * @type {Readonly<Record<string, GameRating>>}
 */
export const GAME_RATINGS = Object.freeze({
  web: GAME_RATING,
  googleplay: Object.freeze({ authority: 'IARC', status: 'preparing', age: null, number: null, date: null, descriptors: Object.freeze([]) }),
  onestore: Object.freeze({ authority: 'ONESTORE', status: 'preparing', age: null, number: null, date: null, descriptors: Object.freeze([]) }),
});

/** 이 빌드 채널의 등급(모르는 채널은 웹 GRAC 기준). @param {string} [channel] @returns {GameRating} */
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
    if (rating.number) parts.push(`${NUMBER_LABEL[rating.authority ?? 'GRAC'] ?? '등급분류번호'} ${rating.number}`);
    return parts.join(' · ');
  }
  return rating.status === 'reviewing' ? '게임물 등급분류 심의 중' : '게임물 등급분류 신청 준비 중';
}
