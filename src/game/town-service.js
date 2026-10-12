import { ITEM_BY_ID, RARITY_INFO } from '../data/items.js';
import { CONSUMABLES } from '../data/expansion.js';
import { TOWNS, TOWN_SHOP, TOWN_SHOP_BY_ID, TOWN_TRAINER, TOWN_TRAINER_BY_ID, normalizeTownState } from '../data/towns.js';

const MATERIAL_NAMES = { glass_leaf: '유리 잎', ember_core: '잿불 핵', star_dust: '별가루' };
const findTown = id => TOWNS.find(town => town.id === id);
const ownHeroLevel = eco => Math.max(...Object.values(eco.s.heroes || {}).map(hero => hero.level || 1), 1);

function clearCount(eco, town) {
  return town.dungeonIds.filter(id => (eco.s.expedition?.stats?.[id] || 0) > 0).length;
}

function requirementText(town, cleared, level) {
  if (town.tier === 1) return '처음부터 이용할 수 있습니다.';
  return `이전 지역 던전 ${town.requiredClears || 3}곳 클리어 · 영웅 레벨 ${town.requiredLevel} 필요 (${cleared}/${town.requiredClears || 3}, Lv.${level}/${town.requiredLevel})`;
}

export class TownService {
  constructor(eco) {
    this.eco = eco;
    this.listeners = [];
    this.ensureState();
    this.refreshUnlocks();
  }

  ensureState() {
    if (this.eco.s.towns !== this.state) this.state = this.eco.s.towns = normalizeTownState(this.eco.s.towns);
    return this.state;
  }

  onChange(fn) {
    if (typeof fn === 'function') this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(listener => listener !== fn); };
  }

  emit() {
    this.eco.save();
    for (const listener of this.listeners) listener(this.towns());
  }

  refreshUnlocks() {
    const state = this.ensureState();
    const before = state.unlockedTownIds.length;
    for (let index = 1; index < TOWNS.length; index++) {
      const town = TOWNS[index], previous = TOWNS[index - 1];
      if (state.unlockedTownIds.includes(town.id)) continue;
      if (clearCount(this.eco, previous) >= 3 && ownHeroLevel(this.eco) >= town.requiredLevel) state.unlockedTownIds.push(town.id);
    }
    if (state.unlockedTownIds.length !== before) this.emit();
    return state;
  }

  towns() {
    this.refreshUnlocks();
    const state = this.ensureState(), level = ownHeroLevel(this.eco);
    return TOWNS.map(town => {
      const cleared = clearCount(this.eco, town);
      const required = town.requiredClears;
      return { id: town.id, name: town.name, subtitle: town.subtitle, tier: town.tier, theme: town.theme,
        dungeonIds: [...town.dungeonIds], unlocked: state.unlockedTownIds.includes(town.id), progress: { cleared, required },
        requirement: { text: requirementText(town, cleared, level) } };
    });
  }

  currentTownId() { return this.ensureState().currentTownId; }

  travel(id) {
    this.refreshUnlocks();
    const town = findTown(id), state = this.ensureState();
    if (!town) return { ok: false, reason: 'unknown-town' };
    if (!state.unlockedTownIds.includes(id)) return { ok: false, reason: 'locked' };
    if (state.currentTownId === id) return { ok: true };
    state.currentTownId = id; this.emit();
    return { ok: true };
  }

  shop(townId) {
    const town = findTown(townId), state = this.ensureState();
    if (!town) return [];
    const unlocked = state.unlockedTownIds.includes(townId);
    return TOWN_SHOP.filter(item => item.townId === townId).map(item => {
      const def = item.itemId ? ITEM_BY_ID[item.itemId] : CONSUMABLES.find(consumable => consumable.id === item.consumableId);
      const purchased = state.purchased.includes(item.id);
      return { id: item.id, ...(item.itemId ? { itemId: item.itemId } : { consumableId: item.consumableId }),
        name: def?.name || item.id, rarity: item.rarity || null,
        ...(def?.appearanceTier ? { appearanceTier: def.appearanceTier } : {}),
        price: { gold: item.price.gold, ...(item.price.materials ? { materials: { ...item.price.materials } } : {}) },
        stockLeft: purchased ? 0 : 1, owned: item.itemId ? this.eco.s.inventory.some(entry => entry.id === item.itemId) : !!this.eco.s.expedition?.consumables?.[item.consumableId],
        unlocked };
    });
  }

  buy(townId, offerId) {
    this.refreshUnlocks();
    const item = TOWN_SHOP_BY_ID[offerId], state = this.ensureState();
    if (!item || item.townId !== townId) return { ok: false, reason: 'unknown-offer' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    if (state.purchased.includes(offerId)) return { ok: false, reason: 'sold-out' };
    const expedition = this.eco.s.expedition, price = item.price;
    if ((this.eco.s.gold || 0) < price.gold) return { ok: false, reason: 'gold' };
    if (Object.entries(price.materials || {}).some(([id, amount]) => (expedition.materials?.[id] || 0) < amount)) return { ok: false, reason: 'materials' };
    const before = structuredClone(this.eco.s);
    this.eco.s.gold -= price.gold;
    for (const [id, amount] of Object.entries(price.materials || {})) expedition.materials[id] -= amount;
    let granted;
    if (item.itemId) {
      const def = ITEM_BY_ID[item.itemId];
      if (!def) { this.eco.s = before; return { ok: false, reason: 'invalid-item' }; }
      granted = { uid: this.eco.s.invSeq++, id: item.itemId, enh: 0 };
      this.eco.s.inventory.push(granted);
    } else {
      expedition.consumables[item.consumableId] = (expedition.consumables[item.consumableId] || 0) + 1;
      granted = { consumableId: item.consumableId, count: 1 };
    }
    state.purchased.push(offerId);
    if (!this.eco.save()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    for (const listener of this.listeners) listener(this.towns());
    return { ok: true, granted };
  }

  trainer(townId, heroId) {
    const town = findTown(townId), state = this.ensureState();
    if (!town || !state.unlockedTownIds.includes(townId)) return [];
    const learned = new Set(state.learned[heroId] || []);
    return TOWN_TRAINER.filter(item => item.townId === townId && item.heroId === heroId).map(item => ({ id: item.id, name: item.name,
      description: item.description, heroId: item.heroId, learned: learned.has(item.id), price: { gold: item.price.gold, materials: { ...item.price.materials } },
      requires: { level: item.price.level || item.requires.level, ...(item.skillId ? { skillId: item.skillId } : {}) } }));
  }

  learn(townId, offerId, heroId) {
    this.refreshUnlocks();
    const item = TOWN_TRAINER_BY_ID[offerId], state = this.ensureState(), hero = this.eco.hero(heroId);
    if (!item || item.townId !== townId || item.heroId !== heroId) return { ok: false, reason: 'unknown-offer' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    if (!hero) return { ok: false, reason: 'hero' };
    if ((state.learned[heroId] || []).includes(offerId)) return { ok: false, reason: 'learned' };
    if (hero.level < item.requires.level) return { ok: false, reason: 'level' };
    if (this.eco.s.gold < item.price.gold) return { ok: false, reason: 'gold' };
    if (Object.entries(item.price.materials || {}).some(([id, amount]) => (this.eco.s.expedition.materials?.[id] || 0) < amount)) return { ok: false, reason: 'materials' };
    const before = structuredClone(this.eco.s);
    this.eco.s.gold -= item.price.gold;
    for (const [id, amount] of Object.entries(item.price.materials || {})) this.eco.s.expedition.materials[id] -= amount;
    state.learned[heroId] ||= [];
    state.learned[heroId].push(offerId);
    if (!this.eco.save()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    for (const listener of this.listeners) listener(this.towns());
    return { ok: true, offerId, heroId };
  }
}
