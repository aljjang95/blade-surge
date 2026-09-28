import { HEROES, skillUpGold, levelExp } from '../data/heroes.js';
import { ITEM_BY_ID, SLOTS, itemStats, enhanceCost, enhanceStones, enhanceChance, enhanceStoneTier, STONE_KEY } from '../data/items.js';
import { MASTERY_NODES } from '../data/masterworks.js';

/** Read-only next steps, each affordable on its own. Never a bulk purchase quote. */
export function growthOptions(save) {
  const heroId = save?.selected, hero = save?.heroes?.[heroId], def = HEROES[heroId];
  if (!hero || !def) return [];
  const options = [];
  const worn = new Set(Object.values(save.heroes).flatMap(h => Object.values(h?.equip || {})));
  const gearScore = item => { const s = itemStats(item); return (s.atk || 0) * 6 + (s.hp || 0) * .5 + (s.def || 0) * 4 + (s.crit || 0) * 1000; };
  for (const slot of SLOTS) {
    if (hero.equip?.[slot]) continue;
    const item = (save.inventory || []).filter(i => i && !worn.has(i.uid) && ITEM_BY_ID[i.id]?.slot === slot
      && Number.isInteger(i.enh) && i.enh >= 0 && i.enh <= 20).sort((a, b) => gearScore(b) - gearScore(a))[0];
    if (!item) continue;
    options.push({ kind: 'equipment', mode: 'equip', heroId, uid: item.uid, slot,
      name: ITEM_BY_ID[item.id].name, from: item.enh, to: item.enh, gold: 0, stones: 0 });
    break;
  }
  for (const slot of SLOTS) {
    if (options.some(o => o.kind === 'equipment')) break;
    const item = save.inventory?.find(x => x.uid === hero.equip?.[slot]);
    if (!item || ITEM_BY_ID[item.id]?.slot !== slot || !Number.isInteger(item.enh) || item.enh < 0 || item.enh >= 8) continue;
    const gold = enhanceCost(item.enh), stones = enhanceStones(item.enh), stoneKey = STONE_KEY[enhanceStoneTier(item.enh)];
    if (enhanceChance(item.enh) !== 1 || !(save.gold >= gold) || !((save[stoneKey] || 0) >= stones)) continue;
    options.push({ kind: 'equipment', heroId, uid: item.uid, name: ITEM_BY_ID[item.id].name, from: item.enh, to: item.enh + 1, gold, stones });
    break;
  }
  const skills = def.skills.map((skill, index) => ({ skill, index, rank: hero.skills?.[index] }))
    .filter(({ skill, rank }) => Number.isInteger(rank) && rank >= 1 && rank < 10 && hero.level >= (skill.unlock || 1) && save.gold >= skillUpGold(rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  if (skills.length) {
    const { skill, index, rank } = skills[0];
    options.push({ kind: 'skill', heroId, index, name: skill.name, from: rank, to: rank + 1, gold: skillUpGold(rank) });
  }
  const mastery = save.masterworks, unlocked = mastery?.unlocked || [];
  const node = MASTERY_NODES.find(n => !unlocked.includes(n.id) && mastery?.renown >= n.cost
    && (n.tier === 1 || unlocked.includes(n.path + '_' + (n.tier - 1))));
  if (node) options.push({ kind: 'mastery', heroId, id: node.id, name: node.name, description: node.description, renown: node.cost });
  return options;
}

/** A single hunt's observed growth. Missing observations never become invented gains. */
export function growthSummary({ heroId, before, after, combatXp, clearXp }) {
  const def = HEROES[heroId];
  if (!def || !Number.isInteger(after?.level) || after.level < 1 || after.level > 80
    || !Number.isSafeInteger(after.exp) || after.exp < 0) return null;
  const start = before?.heroId === heroId && Number.isInteger(before.level)
    && before.level >= 1 && before.level <= after.level ? before.level : null;
  const xp = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const locked = def.skills.filter(skill => skill.unlock > after.level).sort((a, b) => a.unlock - b.unlock);
  const next = locked[0];
  let remaining = 0;
  if (next) {
    for (let level = after.level; level < next.unlock; level++) remaining += levelExp(level);
    remaining = Math.max(0, remaining - after.exp);
  }
  return {
    heroId, name: def.name, level: after.level, beforeLevel: start,
    levels: start === null ? null : after.level - start, exp: after.exp,
    need: after.level < 80 ? levelExp(after.level) : null,
    combatXp: xp(combatXp), clearXp: xp(clearXp),
    unlocked: start === null ? [] : def.skills.filter(skill => skill.unlock > start && skill.unlock <= after.level),
    next: next ? { name: next.name, level: next.unlock, description: next.desc, remaining } : null,
  };
}
