import { DIFFICULTY_ORDER, tormentTierOf } from '../game/difficulty.js';
import { CHAPTER_COUNT, STAGES_PER_CHAPTER } from './campaign-shape.js';

// 기존 재료 3종만 사용한다. 후반 지역은 두 종류를 함께 주어 정련 선택지가 넓어진다.
const MATERIALS = [
  ['glass_leaf'], ['ember_core'], ['star_dust'],
  ['glass_leaf', 'ember_core'], ['ember_core', 'star_dust'], ['star_dust', 'glass_leaf'],
  ['ember_core', 'glass_leaf'],
];
const BASE_WEIGHTS = {
  normal: { N: 70, S: 24, E: 5.5, U: .4, L: .1 },
  elite: { N: 25, S: 50, E: 20, U: 4, L: 1 },
  boss: { N: 0, S: 35, E: 45, U: 15, L: 5 },
};
// 난이도 깊이 d: story 0 · adept 1 · nightmare 2 · hell 3, 고통 단계는 지옥 위에서 5단계마다 한 칸씩 더 깊어진다(T1~5 = 4 ... T46~50 = 13).
// 깊을수록 상급·전설 강화석·초월석·장비 등급 가중이 커진다(docs/SPEC_720H.md 3.2).
export const difficultyDepth = (difficulty) => {
  const tier = tormentTierOf(difficulty);
  return tier ? 4 + Math.floor((tier - 1) / 5) : Math.max(0, DIFFICULTY_ORDER.indexOf(difficulty));
};
function buildTables(difficulty = 'story') {
  const d = difficultyDepth(difficulty);
  return Object.freeze(Array.from({ length: CHAPTER_COUNT }, (_, i) => {
    const ch = i + 1;
    return Object.freeze(Object.fromEntries(['normal', 'elite', 'boss'].map(rank => {
      const boss = rank === 'boss', elite = rank === 'elite', weights = { ...BASE_WEIGHTS[rank] };
      // 하위 등급에서만 질량을 옮긴다. 모든 상위 등급의 누적 확률이 장마다 증가한다.
      const shift = i * (boss ? 5 : elite ? 9 : 12) + d * 8;
      // N을 먼저 소진하고 S에서 옮긴다. 후반 잡몹의 200골드짜리 N 편중도 줄인다.
      const nShift = Math.min(weights.N, shift), sShift = Math.min(weights.S, shift - nShift), moved = nShift + sShift;
      weights.N -= nShift; weights.S -= sShift;
      weights.E += moved * .6; weights.U += moved * .3; weights.L += moved * .1;
      const materialChance = boss ? 1 : elite ? .25 : .02;
      const materials = Object.freeze(MATERIALS[i].map(id => Object.freeze({ id, chance: materialChance,
        n: (boss ? 2 + i : 1 + Math.floor(i / 3)) + d })));
      return [rank, Object.freeze({
        chapter: ch, rank, difficulty, goldMultiplier: (1 + i * .35) * (1 + d * .2), expMultiplier: 1 + i * .15 + d * .15,
        stones: (boss ? 5 + i : elite ? 2 + i : 1) + d, stoneChance: boss || elite ? 1 : .18 + i * .02,
        stones2: boss ? 2 + i + d : elite ? 1 + Math.floor(i / 2) + d : 0,
        stones3: boss ? 1 + Math.floor(i / 2) + d : ch >= 4 && elite ? 1 + d : 0,
        fragments: boss ? 5 + i : elite ? 2 : 0, fragmentChance: boss ? 1 : .6,
        gearRolls: boss ? 3 : elite ? 2 : 1, gearChance: boss || elite ? 1 : .08 + i * .01,
        gearWeights: Object.freeze(weights),
        // 초월 조각은 장비·정련 재료와 별개인 장기 성장원이다. 고장 파밍의 격차는 작게 둔다.
        heroShards: Object.freeze({ chance: boss ? .04 + i * .002 : elite ? .0008 + i * .00004 : .00015 + i * .000005, n: 4 }),
        transcendStones: { chance: boss ? .10 + i * .04 : elite ? .005 + i * .002 : 0, n: 1 },
        material: materials[0], materials,
      })];
    })));
  }));
}
const TABLES_BY_DIFFICULTY = Object.freeze(Object.fromEntries(DIFFICULTY_ORDER.map(id => [id, buildTables(id)])));
export const LOOT_TABLES = TABLES_BY_DIFFICULTY.story;
// 고통 단계 표는 깊이 칸(5단계)마다 하나이고 처음 쓸 때 만든다. 드랍 보고서(DIFFICULTY_ORDER 행)에는 들어가지 않는다.
const TORMENT_TABLES = new Map();
function tablesFor(difficulty) {
  if (Object.hasOwn(TABLES_BY_DIFFICULTY, difficulty)) return TABLES_BY_DIFFICULTY[difficulty];
  const tier = tormentTierOf(difficulty);
  if (!tier) return LOOT_TABLES;
  const depth = difficultyDepth(difficulty);
  if (!TORMENT_TABLES.has(depth)) TORMENT_TABLES.set(depth, buildTables(difficulty));
  return TORMENT_TABLES.get(depth);
}
export function lootTable(chapter = 1, rank = 'normal', difficulty = 'story') {
  const ch = Math.max(1, Math.min(CHAPTER_COUNT, Math.floor(Number(chapter) || 1)));
  const tables = tablesFor(difficulty);
  return Object.hasOwn(tables[ch - 1], rank) ? tables[ch - 1][rank] : tables[ch - 1].normal;
}
export function representativeDrops(chapter) {
  const table = lootTable(chapter, 'boss');
  return { material: table.material.id, materials: table.materials.map(m => m.id), stoneTier: table.stones3 ? 3 : table.stones2 ? 2 : 1,
    gearWeights: table.gearWeights, heroShards: true, transcendStones: true };
}
// 권장 레벨과 10 이상 차이나도 50~150% 범위다. 낮은 장 무한 파밍과 추격 성장 모두 제한한다.
export function levelExperienceMultiplier(heroLevel, recommendedLevel) {
  const delta = (Number(recommendedLevel) || 1) - (Number(heroLevel) || 1);
  return 1 + Math.max(-.5, Math.min(.5, delta * .05));
}
// RPG 즉시 처치 XP + 정화 포함 클리어 XP로 검증한다(tools/progression-estimate.mjs).
// 다음 장 시작은 앞 장 도달 레벨보다 0~2 높게 두며 기존 저장 레벨은 바꾸지 않는다(7장은 46→50).
// 2026-10-29 입문 레벨 곡선(heroes.js EARLY_LEVEL_EXP, 첫 각성 약 1시간)에 맞춰 2장 시작 20→9, 3장 시작 30→22(1장 끝 Lv8, 2장 끝 Lv21).
const CHAPTER_START_LEVEL = [1, 9, 22, 35, 40, 43, 46, 50];
export function recommendedLevel(chapter, stage = 1) {
  const ch = Math.max(1, Math.min(CHAPTER_COUNT, Math.floor(Number(chapter) || 1))), st = Math.max(1, Math.min(STAGES_PER_CHAPTER, Math.floor(Number(stage) || 1)));
  const from = CHAPTER_START_LEVEL[ch - 1], to = CHAPTER_START_LEVEL[ch];
  return from + Math.floor((st - 1) * (to - from) / 10);
}
/** 스테이지 권장 레벨. 필드가 복사되지 않은 스테이지는 장·스테이지 번호로 계산하고, 둘 다 없으면 보정 없음(영웅 레벨). */
export function stageRecommendedLevel(stage, heroLevel = 1) {
  if (Number.isInteger(stage?.recommendedLevel)) return stage.recommendedLevel;
  if (!stage?.expedition && Number.isInteger(stage?.ch)) return recommendedLevel(stage.ch, stage.st);
  return heroLevel;
}
export function pickLootRarity(weights, rng = Math.random) {
  let r = rng() * Object.values(weights).reduce((sum, w) => sum + w, 0);
  for (const [rarity, weight] of Object.entries(weights)) { r -= weight; if (r < 0) return rarity; }
  return 'L';
}
/** 필드 드랍 장비에 붙는 스테이지 장비 레벨(il). 본편 스테이지의 권장 레벨, 원정·고통 단계(tp 가 따로 있음)·번호 없는 판은 0 = 붙이지 않음.
 *  난수를 쓰지 않는 스테이지 값이라 클라이언트 미리보기와 서버 정산이 같은 il 을 낸다. */
export function dropItemLevel(stage) {
  if (!stage || stage.expedition || stage.party || tormentTierOf(stage.difficultyId) > 0) return 0;
  if (!Number.isInteger(stage.ch) || !Number.isInteger(stage.st)) return 0;
  const il = recommendedLevel(stage.ch, stage.st);
  return il > 1 ? il : 0;
}
/** 진행 장비 레벨: 지금까지 깬 가장 깊은 본편 관문의 드랍 장비 레벨(progress.unlocked 는 다음에 열린 관문). 하나도 못 깼으면 0.
 *  스테이지가 없는 획득(가챠·제작·상점·보상)과 il 도입 전 장비의 이월이 같은 진행의 필드 드랍과 같은 단계에 서게 한다. */
export function progressItemLevel(progress) {
  const cleared = Math.min(CHAPTER_COUNT * STAGES_PER_CHAPTER, Math.floor(Number(progress?.unlocked) || 1) - 1);
  if (cleared < 1) return 0;
  return dropItemLevel({ ch: Math.floor((cleared - 1) / STAGES_PER_CHAPTER) + 1, st: (cleared - 1) % STAGES_PER_CHAPTER + 1 });
}
