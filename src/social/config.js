// 블레이드 서지 커뮤니티 설정(tll-social GameConfig). 서버(Worker)와 클라이언트가 함께 import한다.
// 던전 데이터 모듈은 three를 끌어오지 않는다(2026-10-19 번들 확인: 약 92KB).
import { ALL_DUNGEONS } from '../data/expansion.js';

/** @type {import('../../packages/tll-social/src/shared/protocol').GameConfig} */
export const SOCIAL_CONFIG = Object.freeze({
  gameId: 'blade-surge',
  worldChannels: 3,
  worldCapacity: 150,
  contents: ALL_DUNGEONS.map(dungeon => ({ id: dungeon.id, name: dungeon.name, minClearSec: 40 })),
  titleTiers: [
    { id: 'first', maxRank: 1, label: '최초 정복자' },
    { id: 'pioneer', maxRank: 10, label: '선구자' },
    { id: 'vanguard', maxRank: 100, label: '개척자' },
  ],
  founders: { maxNo: 1000, titleId: 'founder', label: '창립 모험가' },
  completion: { titleId: 'conqueror', label: '전 지역 정복자' },
  dmFriendsOnly: true,
  chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 50 },
  // 공용 기본 목록(packages/tll-social filter.ts) 위에 얹는 게임 금칙어. 오탐이 잦은 두 글자 일상어(보지·자지 등)는 넣지 않는다.
  // 등급분류 '부적절한 언어' 대응 — 채팅·이름·게시판에 같이 적용(docs/release/RATING_DECISION.md).
  bannedWords: ['ㅅㅂ', 'ㅆㅂ', '씨빨', '씨바', '시바새', '쌍놈', '썅', '개새', '개색', '개세끼', 'ㅂㅅ', '븅신', '빙신', '지랄', 'ㅈㄹ', '존나', '졸라', 'ㅈㄴ', '니애미', '느금마', '느금', '엠창', '애미', '애비', '미친놈', '미친년', '또라이', '꺼져', '닥쳐', '좆까', '섹스', 'motherfucker', 'dick', 'cunt', 'nigger', 'faggot'],
  fame: { requireLinked: false },
});
export default SOCIAL_CONFIG;

