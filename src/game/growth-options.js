import { HEROES, levelExp } from '../data/heroes.js';
import { canLearnSkill } from '../data/skill-tree.js';
import * as Items from '../data/items.js';
import { ITEM_BY_ID, SLOTS, ENH_MAX, ENH_SAFE_MAX, enhanceCost, enhanceStones, enhanceChance, enhanceStoneTier, STONE_KEY } from '../data/items.js';
import { itemStats } from '../data/item-tier.js';
import { enhanceSureCost } from '../data/enhance.js';
import { MASTERY_NODES } from '../data/masterworks.js';
import { planBestEquip, junkItems, salvagePreview } from './gear-advice.js';

// 강화 규칙은 다른 작업이 바꿀 수 있어 값을 박지 않고 items.js 의 함수를 호출 시점에 읽는다(없으면 0 = 위험 없음).
const rule = (name, level) => { const fn = Items[name]; const value = typeof fn === 'function' ? Number(fn(level)) : 0; return Number.isFinite(value) ? value : 0; };
export const PROTECT_STOCK_GOAL = 3;   // 위험 구간 강화 중 보호 주문서가 이 수보다 적으면 보석 구매를 안내
export const JUNK_MIN = 5;   // 가방 정리 안내를 띄우는 최소 개수

/** Read-only next steps, each affordable on its own. Never a bulk purchase quote.
 * @param {any} save @param {any} [eco] */
export function growthOptions(save, eco = undefined) {
  const heroId = save?.selected, hero = save?.heroes?.[heroId], def = HEROES[heroId];
  if (!hero || !def) return [];
  const options = [];
  const worn = new Set(Object.values(save.heroes).flatMap(h => Object.values(h?.equip || {})));
  const gearScore = item => { const s = itemStats(item); return (s.atk || 0) * 6 + (s.hp || 0) * .5 + (s.def || 0) * 4 + (s.crit || 0) * 1000; };
  for (const slot of SLOTS) {
    if (hero.equip?.[slot]) continue;
    const item = (save.inventory || []).filter(i => i && !worn.has(i.uid) && (i.owner ?? heroId) === heroId && ITEM_BY_ID[i.id]?.slot === slot
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
  // 확정 구간(+ENH_SAFE_MAX)을 지나도 확률 구간을 계속 안내한다. 성공률·파괴·하락은 items.js 규칙을 지금 읽어 그대로 보여 주고, 실제 강화는 화면에서 사람이 고른다.
  if (!options.some(o => o.kind === 'equipment')) {
    let pick = null;
    for (const slot of SLOTS) {
      const item = save.inventory?.find(x => x.uid === hero.equip?.[slot]);
      if (!item || ITEM_BY_ID[item.id]?.slot !== slot || !Number.isInteger(item.enh) || item.enh < ENH_SAFE_MAX || item.enh >= ENH_MAX) continue;
      const gold = enhanceCost(item.enh), stones = enhanceStones(item.enh), stoneKey = STONE_KEY[enhanceStoneTier(item.enh)];
      if (!(save.gold >= gold) || !((save[stoneKey] || 0) >= stones)) continue;
      if (!pick || item.enh < pick.item.enh) pick = { item, gold, stones };
    }
    if (pick) options.push({ kind: 'equipment', mode: 'risk', heroId, uid: pick.item.uid, name: ITEM_BY_ID[pick.item.id].name, from: pick.item.enh, to: pick.item.enh + 1,
      gold: pick.gold, stones: pick.stones, chance: enhanceChance(pick.item.enh), destroy: rule('destroyChance', pick.item.enh), down: rule('enhanceDown', pick.item.enh),
      protect: save.protect || 0,
      // 확정 강화(골드 웃돈) 견적: 지금 골드로 일반 비용 + 웃돈을 낼 수 있을 때만 싣는다. 실제 사용은 강화 화면에서 사람이 고른다.
      ...(() => { const extra = enhanceSureCost(pick.item.enh); return extra && save.gold >= pick.gold + extra ? { sureGold: extra } : {}; })() });
  }
  // 스킬은 스킬 포인트(SP)로 배우고 올린다. 지금 남은 SP로 가능한 것 중 가장 낮은 레벨(새 각성 습득 포함)을 안내한다.
  const skills = def.skills.map((skill, index) => ({ skill, index, rank: Math.floor(Number(hero.skills?.[index]) || 0), check: canLearnSkill(def, hero, index) }))
    .filter(({ check }) => check.ok)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  if (skills.length) {
    const { skill, index, rank, check } = skills[0];
    options.push({ kind: 'skill', heroId, index, name: skill.name, from: rank, to: rank + 1, sp: check.cost, gold: 0 });
  }
  const mastery = save.masterworks, unlocked = mastery?.unlocked || [];
  const node = MASTERY_NODES.find(n => !unlocked.includes(n.id) && mastery?.renown >= n.cost
    && (n.tier === 1 || unlocked.includes(n.path + '_' + (n.tier - 1))));
  if (node) options.push({ kind: 'mastery', heroId, id: node.id, name: node.name, description: node.description, renown: node.cost });
  if (eco) {
    const extra = gearAndSinkOptions(eco, save, heroId);
    // 일괄 장착 제안이 있으면 빈 부위 '첫 장비 비교' 제안은 같은 장착으로 이어지므로 뺀다.
    if (extra.some((o) => o.mode === 'equipBest')) { const i = options.findIndex((o) => o.kind === 'equipment' && o.mode === 'equip'); if (i >= 0) options.splice(i, 1); }
    options.push(...extra);
  }
  return options;
}

/** 장비 교체·가방 정리·남는 재화를 쓸 곳(소환·훈련·초월). 모두 읽기 전용 견적이며 누르기 전에는 아무것도 쓰지 않는다. */
function gearAndSinkOptions(eco, save, heroId) {
  const out = [];
  const plan = planBestEquip(eco, heroId);
  if (plan.length) out.push({ kind: 'gear', mode: 'equipBest', heroId, uid: plan[0].uid, count: plan.length, delta: plan.reduce((sum, swap) => sum + swap.delta, 0) });
  const junk = junkItems(eco);
  if (junk.length >= JUNK_MIN) { const sum = salvagePreview(eco, junk); out.push({ kind: 'gear', mode: 'cleanup', heroId, count: junk.length, gold: sum.gold, stones: sum.stones + sum.stones2 }); }
  const training = eco.trainingQuote?.(heroId);
  if (training?.ok) out.push({ kind: 'training', heroId, from: training.level, to: training.nextLevel, gold: training.cost });
  const transcend = eco.transcendQuote?.(heroId);
  if (transcend?.ok && transcend.next) out.push({ kind: 'transcend', heroId, from: transcend.grade, to: transcend.next });
  for (const banner of ['beginner', 'hero', 'gear']) {
    const quote = eco.pullQuote?.(10, banner) ?? { ok: false };
    if (quote.ok) {
      const g = save.gacha || {}, used = banner === 'gear' ? g.gearPity : banner === 'hero' ? g.pity : null;
      // 천장까지 남은 횟수(읽기 전용: 저장 상태를 만들지 않는다). 초보자 배너는 천장 개념이 없다.
      const pityLeft = used === null ? null : Math.max(0, quote.banner.pity - (Number.isFinite(used) ? Math.max(0, Math.floor(used)) : 0));
      const pulls = quote.currency === 'gems' && quote.cost > 0 ? Math.floor((save.gems || 0) / quote.cost) : 0;
      out.push({ kind: 'summon', heroId, banner, n: 10, currency: quote.currency, cost: quote.cost, tickets: quote.tickets, pityLeft, pulls });
      break;
    }
  }
  // 위험 구간 강화 중이고 보호 주문서가 부족하면, 보석으로 살 수 있다는 안내(기존 상점 상품 protect1 가격 그대로, 구매는 상점 화면에서 사람이 한다).
  if (eco.sku && (save.protect || 0) < PROTECT_STOCK_GOAL) {
    const sku = eco.sku('protect1');
    const risky = Object.values(save.heroes?.[heroId]?.equip || {}).some((uid) => { const it = save.inventory?.find((x) => x.uid === uid); return it && it.enh >= ENH_SAFE_MAX && it.enh < ENH_MAX; });
    if (risky && sku?.kind === 'gem' && Number.isFinite(sku.price) && (save.gems || 0) >= sku.price) out.push({ kind: 'protect', heroId, have: save.protect || 0, gems: sku.price });
  }
  return out;
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
