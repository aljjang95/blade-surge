// 지역·적 계급의 단일 드롭 계약. 기존 재료 3종을 재사용해 정련·저장 경로도 유지한다.
const MATERIALS = ['glass_leaf', 'ember_core', 'star_dust', 'glass_leaf', 'ember_core', 'star_dust'];
const BASE_WEIGHTS = {
  normal: { N: 70, S: 24, E: 5.5, U: .4, L: .1 },
  elite: { N: 25, S: 50, E: 20, U: 4, L: 1 },
  boss: { N: 0, S: 35, E: 45, U: 15, L: 5 },
};
export const LOOT_TABLES = Object.freeze(Array.from({ length: 6 }, (_, i) => {
  const ch = i + 1;
  return Object.freeze(Object.fromEntries(['normal', 'elite', 'boss'].map(rank => {
    const boss = rank === 'boss', elite = rank === 'elite', weights = { ...BASE_WEIGHTS[rank] };
    // 하위 등급에서만 질량을 옮긴다. 모든 상위 등급의 누적 확률이 장마다 증가한다.
    const from = boss ? 'S' : 'N', shift = Math.min(weights[from], i * (boss ? 5 : elite ? 4 : 7));
    weights[from] -= shift; weights.E += shift * .6; weights.U += shift * .3; weights.L += shift * .1;
    return [rank, Object.freeze({
      chapter: ch, rank, goldMultiplier: 1 + i * .35, expMultiplier: 1 + i * .15,
      stones: boss ? 5 + i : elite ? 2 + i : 1, stoneChance: boss || elite ? 1 : .18 + i * .02,
      stones2: boss ? 2 + i : elite ? 1 + Math.floor(i / 2) : 0,
      stones3: boss ? 1 + Math.floor(i / 2) : ch >= 4 && elite ? 1 : 0,
      fragments: boss ? 5 + i : elite ? 2 : 0, fragmentChance: boss ? 1 : .6,
      gearRolls: boss ? 3 : elite ? 2 : 1, gearChance: boss || elite ? 1 : .08 + i * .01,
      gearWeights: Object.freeze(weights),
      heroShards: { chance: boss ? .25 + i * .05 : elite ? .03 + i * .01 : .002 + i * .001, n: 1 },
      transcendStones: { chance: boss ? .10 + i * .04 : elite ? .005 + i * .002 : 0, n: 1 },
      material: { id: MATERIALS[i], chance: boss ? 1 : elite ? .25 : .02, n: boss ? 2 + i : 1 },
    })];
  })));
}));
export function lootTable(chapter = 1, rank = 'normal') {
  const ch = Math.max(1, Math.min(6, Math.floor(Number(chapter) || 1)));
  return LOOT_TABLES[ch - 1][rank] || LOOT_TABLES[ch - 1].normal;
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
// 장 시작 권장 레벨. levelExp(1.18배 지수)와 첫 클리어 보상·처치 경험치로 실제 도달하는 레벨에
// 1~2레벨 여유를 둔 값이다(curve 계산: 첫 클리어만으로 1장 끝 Lv13, 3장 끝 Lv29, 6장 끝 Lv40).
const CHAPTER_START_LEVEL = [1, 12, 22, 30, 35, 39, 42];
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
