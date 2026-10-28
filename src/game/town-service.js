import { ITEM_BY_ID, RARITY_INFO } from '../data/items.js';
import { CONSUMABLES } from '../data/expansion.js';
import { RECIPES } from '../data/expansion.js';
import { TOWNS, TOWN_SHOP, TOWN_SHOP_BY_ID, TOWN_TRAINER, TOWN_TRAINER_BY_ID, TOWN_REQUESTS, TOWN_REQUEST_BY_ID, TOWN_BLACKSMITH, TOWN_STORY, normalizeTownState } from '../data/towns.js';
import { fieldForTown } from '../data/open-fields.js';
import { levelGate } from '../data/shop-gates.js';
import { rotateTownRequests } from './town-progress.js';

/** 상인 오퍼의 레벨 잠금 표시 필드(UI용). 잠기지 않았으면 requires만 그대로 넘긴다. */
function offerGateFields(item, save) {
  if (!item.requires?.level) return {};
  const gate = levelGate(item.requires.level, save);
  return { requires: { level: gate.need }, ...(gate.ok ? {} : { levelLocked: true, lockText: gate.text }) };
}

const MATERIAL_NAMES = { glass_leaf: '유리 잎', ember_core: '잿불 핵', star_dust: '별가루' };
const findTown = id => TOWNS.find(town => town.id === id);
const ownHeroLevel = eco => Math.max(...Object.values(eco.s.heroes || {}).map(hero => hero.level || 1), 1);

function clearCount(eco, town) {
  return town.dungeonIds.filter(id => (eco.s.expedition?.stats?.[id] || 0) > 0).length;
}

// 진행 막대가 클리어 수를 보여 주므로 문구는 아직 남은 조건만 말한다. 레벨 조건은 막대에 없으니 현재 값을 함께 적는다.
function requirementText(town, cleared, level) {
  if (town.tier === 1) return '처음부터 이용할 수 있습니다.';
  const parts = [];
  if (cleared < town.requiredClears) parts.push(`이전 마을 던전 ${town.requiredClears - cleared}곳 더 클리어`);
  if (level < town.requiredLevel) parts.push(`영웅 레벨 ${town.requiredLevel} 필요 (현재 ${level})`);
  return parts.length ? parts.join(' · ') : '해금 조건을 모두 채웠습니다.';
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
    if (!this.eco.save()) return false;
    for (const listener of this.listeners) listener(this.towns());
    return true;
  }

  refreshUnlocks() {
    const state = this.ensureState();
    const before = state.unlockedTownIds.length;
    for (let index = 1; index < TOWNS.length; index++) {
      const town = TOWNS[index], previous = TOWNS[index - 1];
      if (state.unlockedTownIds.includes(town.id)) continue;
      if (clearCount(this.eco, previous) >= town.requiredClears && ownHeroLevel(this.eco) >= town.requiredLevel) state.unlockedTownIds.push(town.id);
    }
    if (state.unlockedTownIds.length !== before && !this.emit()) state.unlockedTownIds.splice(before);
    return state;
  }

  towns() {
    this.refreshUnlocks();
    const state = this.ensureState(), level = ownHeroLevel(this.eco);
    return TOWNS.map((town, index) => {
      // 해금 진행도는 이 마을 자신이 아니라 이전 마을 던전의 클리어 수로 판정한다(refreshUnlocks와 같은 기준).
      const previous = TOWNS[index - 1];
      const cleared = previous ? clearCount(this.eco, previous) : 0;
      const required = town.requiredClears;
      return { id: town.id, name: town.name, subtitle: town.subtitle, tier: town.tier, theme: town.theme,
        fieldId: town.fieldId, field: fieldForTown(town.id), dungeonIds: [...town.dungeonIds], unlocked: state.unlockedTownIds.includes(town.id),
        progress: { cleared, required, level: { current: level, required: town.requiredLevel } },
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
    const before = state.currentTownId;
    state.currentTownId = id;
    if (!this.emit()) { state.currentTownId = before; return { ok: false, reason: 'storage' }; }
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
        unlocked, ...offerGateFields(item, this.eco.s) };
    });
  }

  buy(townId, offerId) {
    this.refreshUnlocks();
    const item = TOWN_SHOP_BY_ID[offerId], state = this.ensureState();
    if (!item || item.townId !== townId) return { ok: false, reason: 'unknown-offer' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    if (state.purchased.includes(offerId)) return { ok: false, reason: 'sold-out' };
    // 등급별 최소 영웅 레벨(shop-gates.js). 마을이 열려도 레전드리는 Lv.20 전에는 살 수 없다.
    const gate = levelGate(item.requires?.level, this.eco.s);
    if (!gate.ok) return { ok: false, reason: 'level', need: gate.need, have: gate.have };
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

  field(townId = this.currentTownId()) {
    const town = findTown(townId), state = this.ensureState();
    if (!town) return { ok: false, reason: 'unknown-town' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    return { ok: true, townId, fieldId: town.fieldId, content: fieldForTown(townId), progress: { ...state.fields[townId] } };
  }

  recordFieldProgress(townId, type, amount = 1) {
    const field = this.field(townId);
    if (!field.ok) return field;
    const state = this.ensureState(), allowed = ['visited', 'gather', 'gathered', 'elite', 'treasure', 'event'];
    if (!allowed.includes(type) || !Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid-progress' };
    const before = structuredClone(this.eco.s);
    const fieldType = type === 'gather' ? 'gathered' : type;
    state.fields[townId][fieldType] += amount;
    this.recordRequestProgress(townId, type === 'visited' ? 'field' : type === 'gathered' ? 'gather' : type, amount, false);
    if (!this.emit()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    return { ok: true, progress: { ...state.fields[townId] } };
  }

  requests(townId = this.currentTownId()) {
    const state = this.ensureState(), town = findTown(townId);
    if (!town) return [];
    this.rotateDailyRequests();
    const active = new Set(state.requests.active), completed = new Set(state.requests.completed);
    return TOWN_REQUESTS.filter(request => request.townId === townId).map(request => ({ ...request,
      accepted: active.has(request.id), completed: completed.has(request.id), progress: state.requests.progress[request.id] || 0,
      unlocked: state.unlockedTownIds.includes(townId) }));
  }

  rotateDailyRequests() { return rotateTownRequests(this.ensureState()); }

  acceptRequest(townId, requestId) {
    const request = TOWN_REQUEST_BY_ID[requestId], state = this.ensureState();
    this.rotateDailyRequests();
    if (!request || request.townId !== townId) return { ok: false, reason: 'unknown-request' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    if (state.requests.completed.includes(requestId)) return { ok: false, reason: 'completed' };
    if (state.requests.active.includes(requestId)) return { ok: false, reason: 'accepted' };
    const before = structuredClone(this.eco.s);
    state.requests.active.push(requestId);
    if (!this.emit()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    return { ok: true, requestId };
  }

  recordRequestProgress(townId, type, amount = 1, emit = true) {
    const state = this.ensureState();
    if (!findTown(townId) || !Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid-progress' };
    const accepted = TOWN_REQUESTS.filter(request => request.townId === townId && state.requests.active.includes(request.id) && request.target.type === type);
    const before = emit && accepted.length ? structuredClone(this.eco.s) : null;
    for (const request of accepted) state.requests.progress[request.id] = Math.min(request.target.amount, (state.requests.progress[request.id] || 0) + amount);
    if (emit && accepted.length && !this.emit()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    return { ok: true, updated: accepted.map(request => request.id) };
  }

  claimRequest(townId, requestId) {
    const request = TOWN_REQUEST_BY_ID[requestId], state = this.ensureState();
    if (!request || request.townId !== townId) return { ok: false, reason: 'unknown-request' };
    if (state.requests.completed.includes(requestId)) return { ok: false, reason: 'completed' };
    if (!state.requests.active.includes(requestId)) return { ok: false, reason: 'not-accepted' };
    if ((state.requests.progress[requestId] || 0) < request.target.amount) return { ok: false, reason: 'incomplete' };
    const before = structuredClone(this.eco.s);
    state.requests.active = state.requests.active.filter(id => id !== requestId);
    // 반복 의뢰는 받으면 진행을 비우고 다시 수락할 수 있다. 일일 의뢰만 오늘 완료로 남는다.
    if (request.kind === 'repeatable') delete state.requests.progress[requestId]; else state.requests.completed.push(requestId);
    this.eco.addRewards(request.rewards, { silent: true });
    if (!this.eco.save()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    for (const listener of this.listeners) listener(this.towns());
    return { ok: true, requestId, rewards: request.rewards };
  }

  completeRequest(townId, requestId) { return this.claimRequest(townId, requestId); }

  blacksmith(townId = this.currentTownId()) {
    const town = findTown(townId), state = this.ensureState();
    if (!town) return [];
    return (TOWN_BLACKSMITH[townId] || []).map(id => {
      const recipe = RECIPES.find(entry => entry.id === id);
      return recipe ? { ...recipe, crafted: state.blacksmith.crafted.includes(id), unlocked: state.unlockedTownIds.includes(townId) } : null;
    }).filter(Boolean);
  }

  craft(townId, recipeId) {
    const recipe = RECIPES.find(entry => entry.id === recipeId), state = this.ensureState();
    if (!recipe || !(TOWN_BLACKSMITH[townId] || []).includes(recipeId)) return { ok: false, reason: 'unknown-recipe' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    if ((this.eco.s.gold || 0) < (recipe.gold || 0)) return { ok: false, reason: 'gold' };
    if (Object.entries(recipe.materials || {}).some(([id, amount]) => (this.eco.s.expedition.materials?.[id] || 0) < amount)) return { ok: false, reason: 'materials' };
    const before = structuredClone(this.eco.s);
    this.eco.s.gold -= recipe.gold || 0;
    for (const [id, amount] of Object.entries(recipe.materials || {})) this.eco.s.expedition.materials[id] -= amount;
    let granted;
    if (recipe.itemId) { granted = { uid: this.eco.s.invSeq++, id: recipe.itemId, enh: 0 }; this.eco.s.inventory.push(granted); }
    else { const consumableId = Object.keys(recipe.consumables || {})[0]; const count = recipe.consumables[consumableId]; this.eco.s.expedition.consumables[consumableId] = (this.eco.s.expedition.consumables[consumableId] || 0) + count; granted = { consumableId, count }; }
    state.blacksmith.crafted.push(recipeId);
    if (!this.eco.save()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    for (const listener of this.listeners) listener(this.towns());
    return { ok: true, recipeId, granted };
  }

  enhance(townId, uid, options = {}) {
    const town = findTown(townId), state = this.ensureState();
    if (!town) return { ok: false, reason: 'unknown-town' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    if (!this.eco.s.inventory.some(item => item.uid === uid)) return { ok: false, reason: 'item' };
    const before = structuredClone(this.eco.s);
    const result = this.eco.enhance(uid, options);
    if (!result?.ok) return result || { ok: false, reason: 'enhance' };
    state.blacksmith.enhancements[String(uid)] = (state.blacksmith.enhancements[String(uid)] || 0) + 1;
    if (!this.eco.save()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    for (const listener of this.listeners) listener(this.towns());
    return result;
  }

  story(townId = this.currentTownId()) {
    const town = findTown(townId), state = this.ensureState();
    if (!town) return [];
    return (TOWN_STORY[townId] || []).map((chapter, index) => ({ ...chapter, stage: index + 1, active: state.story[townId].stage === index, complete: state.story[townId].stage > index }));
  }

  progressStory(townId, type, amount = 1) {
    const state = this.ensureState(), town = findTown(townId), current = state.story[townId];
    if (!town) return { ok: false, reason: 'unknown-town' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid-progress' };
    const before = structuredClone(this.eco.s);
    current.progress[type] = (current.progress[type] || 0) + amount;
    if (!this.emit()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    return { ok: true, progress: { ...current.progress } };
  }

  advanceStory(townId) {
    const state = this.ensureState(), chapters = TOWN_STORY[townId], town = findTown(townId);
    if (!town || !chapters) return { ok: false, reason: 'unknown-town' };
    if (!state.unlockedTownIds.includes(townId)) return { ok: false, reason: 'locked' };
    const current = state.story[townId], chapter = chapters[current.stage];
    if (!chapter) return { ok: false, reason: 'complete' };
    if ((current.progress[chapter.target.type] || 0) < chapter.target.amount) return { ok: false, reason: 'incomplete' };
    const before = structuredClone(this.eco.s); current.stage++; current.progress = {};
    this.eco.addRewards(chapter.rewards, { silent: true });
    if (!this.eco.save()) { this.eco.s = before; return { ok: false, reason: 'storage' }; }
    for (const listener of this.listeners) listener(this.towns());
    return { ok: true, chapterId: chapter.id, stage: current.stage };
  }
}
