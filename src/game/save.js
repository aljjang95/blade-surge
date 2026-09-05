import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID, SLOTS, ENH_MAX } from '../data/items.js';
import { CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';
import { BATTLE_PASS } from '../data/shop.js';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;

// 기본 구조를 기준으로 필드를 복구한다. 저장 데이터의 프로토타입/미지 필드는 복사하지 않는다.
function fill(template, source) {
  const input = record(source) ? source : {};
  return Object.fromEntries(Object.entries(template).map(([key, fallback]) => {
    const value = input[key];
    if (Array.isArray(fallback)) return [key, Array.isArray(value) ? value.slice() : fallback.slice()];
    if (record(fallback)) return [key, fill(fallback, value)];
    if (typeof fallback === 'number') return [key, integer(value, fallback)];
    if (typeof fallback === 'string') return [key, typeof value === 'string' ? value.slice(0, 200) : fallback];
    if (typeof fallback === 'boolean') return [key, typeof value === 'boolean' ? value : fallback];
    return [key, value ?? fallback];
  }));
}

export function normalizeSave(raw, fresh) {
  if (!record(raw)) throw new TypeError('Invalid save root');
  const s = fill(fresh, raw), sourceHeroes = record(raw.heroes) ? raw.heroes : {};
  s.heroes = {};
  for (const id of Object.keys(HEROES)) {
    if (id !== 'knight' && !record(sourceHeroes[id])) continue;
    const h = fill(fresh.heroes.knight, sourceHeroes[id]);
    h.level = integer(h.level, 1, 1, 80); h.star = integer(h.star, 1, 1, 5);
    h.skills = HEROES[id].skills.map((_, i) => integer(h.skills[i], 1, 1, 10));
    s.heroes[id] = h;
  }
  if (!Object.hasOwn(s.heroes, s.selected)) s.selected = 'knight';
  const seen = new Set();
  s.inventory = s.inventory.filter((item) => {
    if (!record(item) || !Object.hasOwn(ITEM_BY_ID, item.id) || !Number.isSafeInteger(item.uid) || item.uid < 1 || item.uid >= Number.MAX_SAFE_INTEGER || seen.has(item.uid)) return false;
    seen.add(item.uid); return true;
  }).map((item) => ({ uid: item.uid, id: item.id, enh: integer(item.enh, 0, 0, ENH_MAX) }));
  const byUid = new Map(s.inventory.map((item) => [item.uid, item]));
  const equipped = new Set();
  for (const h of Object.values(s.heroes)) for (const slot of SLOTS) {
    const item = byUid.get(h.equip[slot]);
    if (!item || ITEM_BY_ID[item.id].slot !== slot || equipped.has(item.uid)) h.equip[slot] = null;
    else equipped.add(item.uid);
  }
  s.invSeq = s.inventory.reduce((next, item) => Math.max(next, item.uid + 1), Math.max(1, s.invSeq));
  const floors = CHAPTERS.length * STAGES_PER_CHAPTER;
  s.progress.unlocked = integer(s.progress.unlocked, 1, 1, floors);
  s.progress.stars = {};
  for (const [key, stars] of Object.entries(record(raw.progress?.stars) ? raw.progress.stars : {})) {
    const parts = /^(\d+)-(\d+)$/.exec(key);
    if (!parts || +parts[1] < 1 || +parts[1] > CHAPTERS.length || +parts[2] < 1 || +parts[2] > STAGES_PER_CHAPTER) continue;
    s.progress.stars[key] = integer(stars, 0, 0, 3);
  }
  for (const key of ['claimedFree', 'claimedPrem']) s.pass[key] = [...new Set(s.pass[key].filter((v) => Number.isInteger(v) && v >= 1 && v <= BATTLE_PASS.maxLevel))];
  s.quests.claimed = s.quests.claimed.filter((id) => ['k30', 'k100', 's3', 's10', 'p10'].includes(id));
  s.purchases = s.purchases.filter((id) => typeof id === 'string');
  s.firstPurchaseUsed = Object.fromEntries(Object.entries(record(raw.firstPurchaseUsed) ? raw.firstPurchaseUsed : {}).filter(([key, value]) => key !== '__proto__' && value === true));
  // 우편 본문과 보상 정의는 제품 데이터가 소유하고 저장에는 수령 여부만 신뢰한다.
  s.mail = fresh.mail.map((mail) => ({ ...mail, read: s.mail.some((saved) => saved?.id === mail.id && saved.read === true) }));
  if (!['auto', 'low', 'mid', 'high'].includes(s.settings.quality)) s.settings.quality = 'auto';
  if (!['auto', 'top', 'action', 'wide'].includes(s.settings.camera)) s.settings.camera = 'auto';
  s.name = s.name.trim().slice(0, 20) || fresh.name;
  return s;
}
