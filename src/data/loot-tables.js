import { DIFFICULTY_ORDER } from '../game/difficulty.js';

// 기존 재료 3종만 사용한다. 후반 지역은 두 종류를 함께 주어 정련 선택지가 넓어진다.
const MATERIALS = [
  ['glass_leaf'], ['ember_core'], ['star_dust'],
  ['glass_leaf', 'ember_core'], ['ember_core', 'star_dust'], ['star_dust', 'glass_leaf'],
];
const BASE_WEIGHTS = {
  normal: { N: 70, S: 24, E: 5.5, U: .4, L: .1 },
  elite: { N: 25, S: 50, E: 20, U: 4, L: 1 },
  boss: { N: 0, S: 35, E: 45, U: 15, L: 5 },
};
function buildTables(difficulty = 'story') {
  const d = Math.max(0, DIFFICULTY_ORDER.indexOf(difficulty));
  return Object.freeze(Array.from({ length: 6 }, (_, i) => {
  const ch = i + 1;
  return Object.freeze(Object.fromEntries(['normal', 'elite', 'boss'].map(rank => {
    const boss = rank === 'boss', elite = rank === 'elite', weights = { ...BASE_WEIGHTS[rank] };
    // 하위 등급에서만 질량을 옮긴다. 모든 상위 등급의 누적 확률이 장마다 증가한다.
    const shift = i * (boss ? 5 : elite ? 7 : 12) + d * 8;
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
export function lootTable(chapter = 1, rank = 'normal', difficulty = 'story') {
  const ch = Math.max(1, Math.min(6, Math.floor(Number(chapter) || 1)));
  const tables = TABLES_BY_DIFFICULTY[difficulty] || LOOT_TABLES;
  return tables[ch - 1][rank] || tables[ch - 1].normal;
}
export function representativeDrops(chapter) {
  const table = lootTable(chapter, 'boss');
  return { material: table.material.id, stoneTier: table.stones3 ? 3 : table.stones2 ? 2 : 1,
    gearWeights: table.gearWeights, heroShards: true, transcendStones: true };
}
// 권장 레벨과 10 이상 차이나도 50~150% 범위다. 낮은 장 무한 파밍과 추격 성장 모두 제한한다.
export function levelExperienceMultiplier(heroLevel, recommendedLevel) {
  const delta = (Number(recommendedLevel) || 1) - (Number(heroLevel) || 1);
  return 1 + Math.max(-.5, Math.min(.5, delta * .05));
}
// RPG 즉시 처치 XP + 정화 포함 클리어 XP로 검증한다(tools/progression-estimate.mjs).
// 다음 장 시작은 앞 장 도달 레벨보다 1~2 높게 두며 기존 저장 레벨은 바꾸지 않는다.
const CHAPTER_START_LEVEL = [1, 20, 30, 35, 40, 43, 46];
export function recommendedLevel(chapter, stage = 1) {
  const ch = Math.max(1, Math.min(6, Math.floor(Number(chapter) || 1))), st = Math.max(1, Math.min(10, Math.floor(Number(stage) || 1)));
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
