/** Pure RPG rules. The existing hero curve and stage difficulty remain authoritative. */
export const HERO_LEVEL_CAP = 80;
export const RPG_SAVE_VERSION = 1;
// 처치 보상은 즉시 성장하되, 첫 층에서 각성 구간까지 건너뛰지 않는다.
export const COMBAT_XP_RATE = 0.20;
const MAX_COUNTER = 1_000_000_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const boundedInt = (value, fallback = 0, min = 0, max = MAX_COUNTER) =>
  Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const add = (a, b) => Math.min(MAX_COUNTER, a + b);

export function normalizeRpg(raw, allowedIds) {
  const source = object(raw?.bestiary) ? raw.bestiary : {};
  const bestiary = Object.create(null);
  for (const id of allowedIds) {
    if (['__proto__', 'constructor', 'prototype'].includes(id) || !Object.hasOwn(source, id) || !object(source[id])) continue;
    const r = source[id], kills = boundedInt(r.kills), seen = Math.max(boundedInt(r.seen), kills > 0 ? 1 : 0);
    if (!seen) continue;
    bestiary[id] = { seen, kills, highestLevel: boundedInt(r.highestLevel, 1, 1, HERO_LEVEL_CAP), lastFloor: boundedInt(r.lastFloor, 1, 1, 50) };
  }
  return { version: RPG_SAVE_VERSION, bestiary, combatXp: boundedInt(raw?.combatXp) };
}

export function recordMonster(rpg, id, level, floor, defeated = false) {
  if (!object(rpg?.bestiary) || typeof id !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(id)) return null;
  const old = Object.hasOwn(rpg.bestiary, id) ? rpg.bestiary[id] : null;
  const entry = old || { seen: 0, kills: 0, highestLevel: 1, lastFloor: 1 };
  if (defeated) { entry.kills = add(entry.kills, 1); entry.seen = Math.max(1, entry.seen); }
  else entry.seen = add(entry.seen, 1);
  entry.highestLevel = Math.max(entry.highestLevel, boundedInt(level, 1, 1, HERO_LEVEL_CAP));
  entry.lastFloor = boundedInt(floor, 1, 1, 50);
  rpg.bestiary[id] = entry;
  return entry;
}

export function monsterLevel(floor, def) {
  // Rank is already priced into the authored HP/ATK. Do NOT multiply difficulty a second time.
  return Math.min(HERO_LEVEL_CAP, boundedInt(floor, 1, 1, 50) + (def?.boss ? 4 : def?.elite ? 2 : 0));
}

export function monsterStats(def, scale = 1) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { hp: Math.floor(def.hp * s), atk: def.atk * Math.pow(s, 0.7), armor: def.armor || 0, speed: def.spd, range: def.range };
}

export function monsterXp(def, scale = 1, summoned = false) {
  if (summoned || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(def?.exp) || def.exp <= 0) return 0;
  return Math.min(1_000_000, Math.max(1, Math.floor(def.exp * scale * COMBAT_XP_RATE)));
}

/** Mutates the existing hero record, never creates a parallel character/account level. */
export function grantCombatXp(hero, amount, levelExp) {
  if (!object(hero) || !Number.isSafeInteger(amount) || amount < 0 || typeof levelExp !== 'function') return { gained: 0, levels: 0 };
  const beforeLevel = boundedInt(hero.level, 1, 1, HERO_LEVEL_CAP);
  let level = beforeLevel, exp = add(boundedInt(hero.exp), Math.min(amount, MAX_COUNTER));
  const gained = level === HERO_LEVEL_CAP ? 0 : Math.min(amount, MAX_COUNTER);
  // Validate the curve before writing anything; at most 79 transitions.
  while (level < HERO_LEVEL_CAP) {
    const need = levelExp(level);
    if (!Number.isSafeInteger(need) || need <= 0) throw new RangeError('Invalid hero experience curve');
    if (exp < need) break;
    exp -= need; level++;
  }
  hero.level = level; hero.exp = level === HERO_LEVEL_CAP ? 0 : exp;
  return { gained, levels: level - beforeLevel, beforeLevel, level, exp: hero.exp };
}

export function masteryLabel(entry) {
  if (!entry?.seen) return '미발견';
  if (entry.kills >= 50) return '정복';
  if (entry.kills >= 10) return '연구 완료';
  return entry.kills > 0 ? '처치 확인' : '발견';
}

/** One enemy instance can settle death rewards only once; reset this ledger for each run. */
export class KillLedger {
  constructor() { this.receipts = new WeakSet(); }
  claim(enemy) {
    if (!object(enemy) || enemy.alive !== false || this.receipts.has(enemy)) return false;
    this.receipts.add(enemy); return true;
  }
}
