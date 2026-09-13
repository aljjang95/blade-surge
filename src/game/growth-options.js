import { HEROES, skillUpGold } from '../data/heroes.js';
import { ITEM_BY_ID, SLOTS, enhanceCost, enhanceStones, enhanceChance, enhanceStoneTier, STONE_KEY } from '../data/items.js';
import { MASTERY_NODES } from '../data/masterworks.js';

/** Read-only next steps, each affordable on its own. Never a bulk purchase quote. */
export function growthOptions(save) {
  const heroId = save?.selected, hero = save?.heroes?.[heroId], def = HEROES[heroId];
  if (!hero || !def) return [];
  const options = [];
  for (const slot of SLOTS) {
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
