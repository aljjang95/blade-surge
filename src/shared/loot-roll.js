// MMO P1-E: 처치 드랍 굴림을 순수 함수로 분리한다(docs/MMO_DESIGN.md 3.4.2 "전투 중 드랍 연출 보존").
// 같은 rng를 주면 클라이언트 미리보기 드랍과 서버 지급 드랍이 정확히 같다.
// rng = seededStream(lootSeed, stream, killIndex) — stream은 'normal'|'elite'|'boss'(+':s' 소환체).
import { ITEM_POOL, SLOTS } from '../data/items.js';
import { pickLootRarity } from '../data/loot-tables.js';

/**
 * DropSystem.onKill과 같은 순서로 난수를 소비한다.
 * @param {any} table lootTable(ch, rank, difficulty)
 * @param {() => number} rng
 * @param {{ baseGold: number, scale: number, itemLevel?: number, summoned?: boolean, goldPerKill?: number, ledger?: boolean, rank?: string }} opts
 * @returns {Array<{ kind: string, n?: number, amount?: number, count?: number, id?: string, rarity?: string, slot?: string, pick?: number }>}
 */
export function rollKillLoot(table, rng, { baseGold, scale, summoned = false, goldPerKill = 0, ledger = true, rank = table.rank, itemLevel = 0 }) {
  const out = [];
  const boss = rank === 'boss', elite = rank === 'elite';
  const amount = Math.max(1, Math.floor(baseGold * scale * table.goldMultiplier * (0.8 + rng() * 0.5)));
  out.push({ kind: 'gold', amount, count: boss ? 8 : elite ? 3 : 1 });
  if (!summoned && goldPerKill > 0) out.push({ kind: 'gold', amount: goldPerKill, count: 1 });
  if (table.stoneChance === 1 || rng() < table.stoneChance) out.push({ kind: 'stone', n: table.stones });
  if (table.stones2) out.push({ kind: 'stone2', n: table.stones2 });
  if (table.stones3) out.push({ kind: 'stone3', n: table.stones3 });
  if (table.fragments && (table.fragmentChance === 1 || rng() < table.fragmentChance)) out.push({ kind: 'frag', n: table.fragments });
  // 소환된 적은 기본 골드·강화석만 남기고 새 성장 재료는 주지 않는다(기존 규칙).
  if (ledger && !summoned) {
    if (rng() < table.heroShards.chance) out.push({ kind: 'heroShard', n: table.heroShards.n });
    if (rng() < table.transcendStones.chance) out.push({ kind: 'transcendStone', n: table.transcendStones.n });
    for (const material of table.materials) {
      if (material.chance === 1 || rng() < material.chance) out.push({ kind: 'material', id: material.id, n: material.n });
    }
  }
  const rolls = table.gearChance === 1 || rng() < table.gearChance ? table.gearRolls : 0;
  for (let i = 0; i < rolls; i++) {
    const rarity = pickLootRarity(table.gearWeights, rng);
    // Economy.addItem(rarity, null, rng)과 같은 순서: 슬롯 → 같은 등급 풀에서 하나.
    const slot = SLOTS[Math.floor(rng() * SLOTS.length)];
    const pool = ITEM_POOL[slot].filter((x) => x.rarity === rarity);
    const def = pool.length ? pool[Math.floor(rng() * pool.length)] : ITEM_POOL[slot][0];
    out.push({ kind: 'item', rarity, slot, id: def.id, ...(itemLevel > 1 ? { il: itemLevel } : {}) });
  }
  return out;
}

/** 드랍 목록을 정산 합계로 접는다(골드는 모든 동전 합). */
export function sumLoot(drops, into = { gold: 0, stones: 0, stones2: 0, stones3: 0, fragments: 0, heroShards: 0, transcendStones: 0, materials: {}, items: [] }) {
  for (const d of drops) {
    if (d.kind === 'gold') into.gold += d.amount * d.count;
    else if (d.kind === 'stone') into.stones += d.n;
    else if (d.kind === 'stone2') into.stones2 += d.n;
    else if (d.kind === 'stone3') into.stones3 += d.n;
    else if (d.kind === 'frag') into.fragments += d.n;
    else if (d.kind === 'heroShard') into.heroShards += d.n;
    else if (d.kind === 'transcendStone') into.transcendStones += d.n;
    else if (d.kind === 'material') into.materials[d.id] = (into.materials[d.id] || 0) + d.n;
    else if (d.kind === 'item') into.items.push({ id: d.id, rarity: d.rarity, slot: d.slot, ...(d.il > 1 ? { il: d.il } : {}) });
  }
  return into;
}
