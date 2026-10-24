/**
 * 룬 강화 데이터 — 설계 문서 docs/RUNE_AND_BLESSING_DESIGN.md 2장.
 * 룬 12종은 각인(BOONS)의 id·이름·가문·효과를 그대로 쓴다(새 효과 0개).
 * 수치는 초안이며 R2 레인의 sim:90d 곡선으로 다시 맞춘다.
 */
import { BOONS, SYNERGIES } from './masterworks.js';

/** 가문 색·문양 — 화면·아이콘 전체에서 고정한다. */
export const RUNE_FAMILIES = [
  { id: 'ember', name: '잿불', color: '#ff7a2e', accent: '#d63a1f', glyph: 'flame', glyphName: '불꽃' },
  { id: 'tide', name: '물결', color: '#2f8fe0', accent: '#1d5fa8', glyph: 'wave', glyphName: '물결' },
  { id: 'storm', name: '폭풍', color: '#8a5cff', accent: '#3fd6c8', glyph: 'bolt', glyphName: '번개' },
  { id: 'stone', name: '바위', color: '#d39a3c', accent: '#8a5a2b', glyph: 'mountain', glyphName: '산' },
];
export const RUNE_FAMILY_IDS = RUNE_FAMILIES.map((f) => f.id);

/** 등급 I/II/III — 효과는 각인 랭크와 같다(rank = grade). */
export const RUNE_GRADES = [1, 2, 3];
/** @type {Record<number, string>} */
export const RUNE_GRADE_LABEL = { 1: 'I', 2: 'II', 3: 'III' };
export const RUNE_MAX_GRADE = 3;

/** 룬 12종 = 각인 12종. effects 는 BOONS 의 객체를 그대로 참조한다. */
export const RUNES = BOONS.map((b) => ({ id: b.id, name: b.name, family: b.family, description: b.description, effects: b.effects }));
/** @type {Record<string, typeof RUNES[number]>} */
export const RUNE_BY_ID = Object.fromEntries(RUNES.map((r) => [r.id, r]));

/** 가문 공명 — 기존 SYNERGIES 6종을 쓰되 조건을 "두 가문 각 2개 이상"으로 올린다. */
export const RUNE_SYNERGY_MIN = 2;
export const RUNE_SYNERGIES = SYNERGIES;

/** 장비 등급별 기본 소켓 수와 +15 강화 시 추가 소켓. */
/** @type {Record<string, number>} */
export const RUNE_SOCKETS = { N: 0, S: 1, E: 1, U: 2, L: 2 };
/** @type {Record<string, number>} */
export const RUNE_SOCKET_BONUS = { N: 0, S: 0, E: 1, U: 1, L: 1 };
export const RUNE_SOCKET_BONUS_ENH = 15;

/** 같은 룬 id 는 장착 전체에서 이 개수까지만 효과가 쌓인다. */
export const RUNE_DUPLICATE_CAP = 2;

/** 합성(100% 결정적): 같은 룬 아래 등급 count 개 + 골드 + 룬 가루 → 다음 등급 1개. 키는 결과 등급. */
/** @type {Record<number, { count: number, gold: number, runeDust: number }>} */
export const RUNE_MERGE_COST = {
  2: { count: 3, gold: 1000, runeDust: 0 },
  3: { count: 3, gold: 5000, runeDust: 20 },
};

/** 빼기·덮어 박기 골드 비용(박혀 있던 룬 등급 기준). 빈 칸 박기와 판매·분해·파괴 회수는 무료. */
/** @type {Record<number, number>} */
export const RUNE_REMOVE_COST = { 1: 1000, 2: 3000, 3: 8000 };

/**
 * 획득처(2.6장). chance 는 0~1, 나머지는 개수. 2026-10-24 R2 가 sim:90d 곡선으로 조정했다
 * (미드 7일 II 2개 · 30일 III 1개 · 90일 III 5개, 시드 16 p50). 초안(정예 3%·보스 25%/심층 50%·상자 5/12/20·분해 U 10/L 30)은
 * 90일 III 150개 이상으로 넘쳤다: 처치·장비 드랍 양이 많아 확률·분해 가루를 크게 낮추고 첫 클리어 가루(first)로 초반을 받쳤다.
 * expeditionDust 는 출격(캠페인·원정) 승리 정산 상자: base 일반 · deep 심층 원정 · hell 지옥 난이도 · first 첫 클리어 추가.
 */
export const RUNE_SOURCES = {
  eliteDrop: { grade: 1, chance: 0.005 },
  bossDrop: { grade: 1, chance: 0.02, deepChance: 0.04, deepGrade2Chance: 0.1 },
  expeditionDust: { base: 2, deep: 3, hell: 3, first: 3 },
  dismantleDust: { U: 0, L: 1 },
  craftFamily: { runeDust: 40, grade: 1 },
  craftExact: { runeDust: 80, grade: 1 },
  weeklyDust: 30,
  firstGift: { grade: 1, perFamily: 1 },
};
