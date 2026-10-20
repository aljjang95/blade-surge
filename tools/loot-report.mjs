#!/usr/bin/env bun
// 골드 환산은 판매가 + 보석 상점의 교환 기회비용이다. 재료를 골드로 되팔 수 있다는 뜻은 아니다.
import { lootTable } from '../src/data/loot-tables.js';
import { RARITY_INFO } from '../src/data/items.js';
import { MATERIAL_REFINING } from '../src/data/expansion.js';
import { DIFFICULTY_ORDER } from '../src/game/difficulty.js';
import { SKUS, GACHA } from '../src/data/shop.js';
import { stageDef, ENEMIES } from '../src/data/stages.js';
import { Floor } from '../src/game/world.js';
import { roomEntries, expectedGoldRoll, shardsPerPull } from './economy-estimate.mjs';

const rarities = ['N', 'S', 'E', 'U', 'L'];
const GOLD_COINS = { normal: 1, elite: 3, boss: 8 };
const rankOf = def => def.boss ? 'boss' : def.elite ? 'elite' : 'normal';
export function lootReport() {
  const goldPerGem = Math.max(...SKUS.filter(s => s.kind === 'gem' && s.rewards?.gold).map(s => s.rewards.gold / s.price));
  const value = key => Math.min(...SKUS.filter(s => s.kind === 'gem' && s.rewards?.[key]).map(s => s.price / s.rewards[key])) * goldPerGem;
  const stoneValue = { stones: value('stones'), stones2: value('stones2'), stones3: value('stones3'), transcendStones: value('transcendStones') };
  const shardValue = GACHA.ten / (shardsPerPull('mage').perTen) * goldPerGem;
  const materialValue = Object.fromEntries(MATERIAL_REFINING.map(r => [r.id,
    Object.entries(stoneValue).reduce((n, [k, v]) => n + (r[k] || 0) * v, 0) - r.gold]));
  const rows = [];
  for (let ch = 1; ch <= 6; ch++) {
    const stage = stageDef(ch, 10), floor = new Floor(stage.idx, stage.chapter.theme, undefined, stage.dungeon?.layout);
    const entries = floor.rooms.flatMap(room => roomEntries(stage, room));
    for (const rank of ['normal', 'elite', 'boss']) for (const difficulty of DIFFICULTY_ORDER) {
      const t = lootTable(ch, rank, difficulty), totalWeight = Object.values(t.gearWeights).reduce((n, w) => n + w, 0);
      const gearDistribution = Object.fromEntries(rarities.map(r => [r, t.gearWeights[r] / totalWeight]));
      const gearCount = t.gearRolls * t.gearChance;
      const gearGold = gearCount * rarities.reduce((n, r) => n + gearDistribution[r] * RARITY_INFO[r].sell, 0);
      const stones = { stones: t.stones * t.stoneChance, stones2: t.stones2, stones3: t.stones3 };
      const heroShards = t.heroShards.chance * t.heroShards.n, transcendStones = t.transcendStones.chance * t.transcendStones.n;
      const materials = Object.fromEntries(t.materials.map(m => [m.id, m.n * m.chance]));
      const matching = entries.filter(e => rankOf(ENEMIES[e.type]) === rank), count = matching.reduce((n, e) => n + e.w, 0);
      const gold = matching.reduce((n, e) => n + e.w * GOLD_COINS[rank] * expectedGoldRoll(ENEMIES[e.type].gold || 1, stage.scale, t.goldMultiplier), 0) / count;
      const goldEquivalent = gold + gearGold + Object.entries(stones).reduce((n, [k, v]) => n + v * stoneValue[k], 0)
        + heroShards * shardValue + transcendStones * stoneValue.transcendStones
        + Object.entries(materials).reduce((n, [k, v]) => n + v * materialValue[k], 0);
      rows.push({ chapter: ch, rank, difficulty, gearDistribution, gearCount, stones,
        fragments: t.fragments * t.fragmentChance, heroShards, transcendStones, materials, gold, goldEquivalent });
    }
  }
  const seen = new Map(), duplicates = [], zeroValue = [];
  for (const row of rows) {
    const { chapter, rank, difficulty, ...rewards } = row, id = `${chapter}/${rank}/${difficulty}`, fingerprint = JSON.stringify(rewards);
    if (!(row.goldEquivalent > 0) || !Number.isFinite(row.goldEquivalent)) zeroValue.push(id);
    if (seen.has(fingerprint)) duplicates.push([seen.get(fingerprint), id]); else seen.set(fingerprint, id);
  }
  return { rows, zeroValue, duplicates, valuation: { goldPerGem, stoneValue, shardValue, materialValue,
    notes: ['한 적 처치당 기대값, 골드는 각 장 10스테이지 실제 명단의 계급별 평균', '장비는 등급별 실제 판매가',
      '강화석·초월석은 보석 상점 최저 단가, 지역 재료는 정련 결과 가치에서 정련 골드 차감',
      '영웅 조각은 마법사 중복 소환 기회비용, 세트 조각은 교환가가 없어 환산 합계에서 제외', '골드 환산은 비교용이며 실제 판매 가능액이 아님'] } };
}
if (import.meta.main) {
  const report = lootReport();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.table(report.rows.map(r => ({ 장: r.chapter, 계급: r.rank, 난이도: r.difficulty,
      등급분포: Object.entries(r.gearDistribution).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(' / '),
      장비수: r.gearCount.toFixed(2), 강화석: Object.values(r.stones).map(n => n.toFixed(2)).join('/'),
      세트조각: r.fragments.toFixed(2), 영웅조각: r.heroShards.toFixed(4), 초월석: r.transcendStones.toFixed(3),
      재료: JSON.stringify(r.materials), 골드: Math.round(r.gold), 골드환산: Math.round(r.goldEquivalent) })));
    console.log(JSON.stringify({ 가치0: report.zeroValue, 완전중복: report.duplicates }));
    console.log(report.valuation.notes.join('\n'));
  }
  if (report.zeroValue.length || report.duplicates.length) process.exitCode = 1;
}
