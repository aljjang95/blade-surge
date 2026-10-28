import { ALL_DUNGEONS as DUNGEONS, MATERIALS, CONSUMABLES } from '../data/expansion.js';
import { FIELD_DUNGEONS } from '../data/open-fields.js';
import { ENEMIES } from '../data/stages.js';
import { ITEM_BY_ID, ENH_MAX, STONE_KEY, STONE_NAME, enhanceCost, enhanceStones, enhanceStoneTier, enhanceChance, enhanceDown, destroyChance, rarityRank } from '../data/items.js';
import { citadelHotspot } from '../data/citadel-hub.js';
import { uiArt, resourceArt } from './illustrated.js';
import './town-content.css';

/*
 * 마을 콘텐츠(던전 6곳 · 필드 · 의뢰 · 대장장이 · 이야기) 표면.
 * TownService가 아직 모르는 기능은 비어 있는 상태로 보여 주고, 서비스가 계약 메서드를 제공하면 곧바로 쓴다.
 * 계약 이름과 응답 모양은 docs/content/CONTENT-UI.md 에 있다. 서비스 이름이 바뀌면 METHODS 표만 고친다.
 */

export const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const fmt = value => Math.floor(Number(value) || 0).toLocaleString('ko-KR');
const attempt = (fn, fallback) => { try { return fn() ?? fallback; } catch (error) { console.warn('town content call failed', error); return fallback; } };
const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const str = value => typeof value === 'string' ? value : '';
const count = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** 가격 값(숫자 또는 {gold, materials})을 같은 모양으로 맞춘다. */
export const normalizePrice = price => typeof price === 'number' ? { gold: price, materials: {} }
  : { gold: Number(price?.gold) || 0, materials: price?.materials || {} };

/** 서비스가 주는 사유 코드를 한국어 안내로 바꾸는 표(콘텐츠 몫). 이미 문장이면 그대로 쓴다. */
export const CONTENT_REASONS = Object.freeze({
  'unknown-quest': '알 수 없는 의뢰입니다.', 'unknown-request': '알 수 없는 의뢰입니다.', 'unknown-recipe': '알 수 없는 제작법입니다.',
  'unknown-item': '장비를 찾을 수 없습니다.', 'unknown-step': '알 수 없는 이야기 단계입니다.', 'already-accepted': '이미 수락한 의뢰입니다.',
  'already-done': '오늘은 이미 완료한 의뢰입니다.', 'not-accepted': '먼저 의뢰를 수락하세요.', 'not-ready': '아직 조건을 달성하지 못했습니다.',
  'quest-limit': '한 번에 받을 수 있는 의뢰 수를 넘었습니다.', cooldown: '아직 다시 받을 수 없습니다.', 'step-locked': '앞선 이야기를 먼저 마치세요.',
  'story-complete': '이 마을의 이야기를 모두 마쳤습니다.', 'max-enhance': '이미 최대로 강화했습니다.', 'already-crafted': '이미 제작한 장비입니다.',
  inventory: '가방에 자리가 없습니다.', 'field-locked': '아직 필드가 열리지 않았습니다.',
  completed: '이미 완료한 의뢰입니다.', accepted: '이미 수락한 의뢰입니다.', incomplete: '아직 조건을 달성하지 못했습니다.', complete: '이 마을의 이야기를 모두 마쳤습니다.',
  item: '장비를 찾을 수 없습니다.', max: '이미 최대로 강화했습니다.', stones: '강화석이 부족합니다.', protect: '보호 부적이 부족합니다.', bless: '축복 가루가 부족합니다.',
  enhance: '강화할 수 없습니다.', 'invalid-progress': '진행 수치를 확인할 수 없습니다.',
});

// ------------------------------------------------------------ 서비스 경계
const METHODS = Object.freeze({
  field: ['fieldContent', 'field', 'fieldStatus'],
  quests: ['requests', 'quests', 'bounties'],
  acceptQuest: ['acceptRequest', 'acceptQuest'],
  claimQuest: ['completeRequest', 'claimRequest', 'completeQuest', 'claimQuest'],
  forge: ['blacksmith', 'forge'],
  craft: ['craft', 'craftRecipe'],
  enhance: ['enhance', 'enhanceItem'],
  story: ['story', 'storyQuests', 'storyProgress'],
  advanceStory: ['advanceStory', 'claimStory', 'completeStory'],
});
/** 서비스가 가진 첫 번째 계약 메서드를 묶어 돌려준다. 없으면 null. */
export function serviceMethod(service, key) {
  for (const name of METHODS[key] || []) if (typeof service?.[name] === 'function') return service[name].bind(service);
  return null;
}

// ------------------------------------------------------------ 정규화
const TARGET_LABEL = Object.freeze({ dungeon: '던전 클리어', field: '필드 탐험', kills: '몬스터 처치', gather: '채집', gathered: '채집', elite: '정예 처치', treasure: '숨은 보물 발견', event: '필드 이벤트 해결', visited: '필드 탐험' });
const targetText = raw => {
  const target = raw?.target; if (!target || typeof target !== 'object') return '';
  const label = TARGET_LABEL[target.type]; return label ? label + ' ' + fmt(target.amount) + '회' : '';
};
const progressOf = raw => {
  if (!raw) return null;
  const source = raw.progress;
  let current = null, target = null;
  if (source && typeof source === 'object') { current = count(source.current ?? source.value, 0); target = count(source.target ?? source.required ?? source.amount, 0); }
  else if (source !== undefined && source !== null) { current = count(source, 0); target = count(raw.target?.amount ?? raw.target ?? raw.goal ?? raw.required, 0); }
  else if (raw.current !== undefined) { current = count(raw.current, 0); target = count(raw.target?.amount ?? raw.target ?? raw.goal ?? raw.required, 0); }
  if (!target || target < 1) return null;
  return { current: Math.max(0, Math.min(current ?? 0, target)), target };
};

// 'completed'는 보상까지 받은 상태(done)다. 받을 수 있는 상태는 ready/claimable 또는 수락 후 진행도가 목표에 닿은 경우.
const QUEST_STATUS = Object.freeze({ available: 'available', open: 'available', active: 'active', accepted: 'active', ready: 'ready', claimable: 'ready',
  done: 'done', completed: 'done', claimed: 'done', locked: 'locked', cooldown: 'locked' });
const questStatus = raw => {
  const named = QUEST_STATUS[String(raw.status ?? raw.state ?? '').toLowerCase()];
  if (named) return named;
  if (raw.claimed || raw.completed) return 'done';
  if (raw.locked || raw.unlocked === false) return 'locked';
  if (raw.ready) return 'ready';
  if (raw.accepted || raw.active) return 'active';
  return 'available';
};
const QUEST_KIND = Object.freeze({ daily: 'daily', repeat: 'repeat', repeatable: 'repeat', story: 'story' });
export const QUEST_KIND_LABEL = Object.freeze({ daily: '일일', repeat: '반복', story: '이야기', once: '일반' });

/** 의뢰 게시판 응답 → 화면용 목록. 지원하지 않으면 null. */
export function normalizeQuests(raw) {
  if (raw === null || raw === undefined) return null;
  return list(raw.quests ?? raw.requests ?? raw).map(entry => {
    const id = str(entry?.id); if (!id) return null;
    const rawProgress = progressOf(entry); let status = questStatus(entry);
    if (status === 'active' && rawProgress && rawProgress.current >= rawProgress.target) status = 'ready';
    const progress = rawProgress && (status === 'ready' || status === 'done') ? { current: rawProgress.target, target: rawProgress.target } : rawProgress;
    return { id, title: str(entry.title || entry.name) || id, description: str(entry.description), goal: targetText(entry), kind: QUEST_KIND[String(entry.kind ?? entry.type).toLowerCase()] || 'once',
      status, progress, rewards: entry.rewards || null, reason: str(entry.reason || entry.error), resetText: str(entry.resetText || entry.resetsIn) };
  }).filter(Boolean);
}

/** 대장장이 응답 → { unlocked, recipes, upgrades }. 지원하지 않으면 null. */
export function normalizeForge(raw) {
  if (raw === null || raw === undefined) return null;
  const source = Array.isArray(raw) ? { recipes: raw } : raw;
  raw = source;
  const recipes = list(raw.recipes).map(entry => {
    const id = str(entry?.id); if (!id) return null;
    const item = entry.itemId ? ITEM_BY_ID[entry.itemId] : null;
    const price = entry.price ?? { gold: entry.gold, materials: entry.materials };
    return { id, name: str(entry.name) || item?.name || id, description: str(entry.description), price: normalizePrice(price), consumables: entry.consumables || null,
      crafted: !!(entry.crafted || entry.owned) && !(entry.consumables && Object.keys(entry.consumables).length), repeatable: !!(entry.consumables && Object.keys(entry.consumables).length), locked: entry.locked === true || entry.unlocked === false, reason: str(entry.reason || entry.error) };
  }).filter(Boolean);
  const upgrades = list(raw.upgrades ?? raw.enhancements).map(entry => {
    const id = String(entry?.uid ?? entry?.id ?? ''); if (!id) return null;
    const item = entry.itemId ? ITEM_BY_ID[entry.itemId] : null;
    return { id, name: str(entry.name) || item?.name || id, level: count(entry.level ?? entry.enh, 0), max: count(entry.max ?? entry.maxLevel, 0),
      price: normalizePrice(entry.price ?? { gold: entry.gold, materials: entry.materials }), stone: null, equipped: !!entry.equipped,
      rate: Number.isFinite(Number(entry.rate ?? entry.successRate)) ? Number(entry.rate ?? entry.successRate) : null,
      destroy: count(entry.destroy), down: count(entry.down), locked: !!entry.locked, reason: str(entry.reason || entry.error) };
  }).filter(Boolean);
  const flags = list(raw.recipes).map(entry => entry?.unlocked).filter(flag => typeof flag === 'boolean');
  const unlocked = typeof raw.unlocked === 'boolean' ? raw.unlocked : flags.length ? flags.some(Boolean) : true;
  return { unlocked, explicitUnlock: typeof raw.unlocked === 'boolean' || flags.length > 0, recipes, upgrades };
}

const STORY_STATUS = Object.freeze({ locked: 'locked', active: 'active', current: 'active', available: 'active', ready: 'ready', claimable: 'ready', done: 'done', complete: 'done', completed: 'done', claimed: 'done' });
/** 마을 이야기 응답 → 단계 목록(최대 3). 지원하지 않으면 null. */
export function normalizeStory(raw) {
  if (raw === null || raw === undefined) return null;
  const steps = list(raw.steps ?? raw.chapters ?? raw).map((entry, index) => {
    const id = str(entry?.id); if (!id) return null;
    const named = STORY_STATUS[String(entry.status ?? entry.state ?? '').toLowerCase()];
    const progress = progressOf(entry);
    let status = named || (entry.done || entry.claimed || entry.complete ? 'done' : entry.ready ? 'ready' : entry.locked ? 'locked' : entry.active ? 'active' : entry.active === false ? 'locked' : 'active');
    if (status === 'active' && progress && progress.current >= progress.target) status = 'ready';
    // 진행도를 알려 주지 않는 서비스라도 현재 장은 시도할 수 있다. 조건 판정은 서비스가 한다.
    const attemptable = status === 'active' && !progress;
    return { id, goal: targetText(entry), index: count(entry.stage, 0) || index + 1, title: str(entry.title || entry.name) || id, text: str(entry.text || entry.story || entry.description), status, attemptable,
      progress: progress && (status === 'ready' || status === 'done') ? { current: progress.target, target: progress.target } : progress, rewards: entry.rewards || null, reason: str(entry.reason || entry.error) };
  }).filter(Boolean).slice(0, 3);
  steps.forEach((step, index) => { step.index = index + 1; });
  return { steps };
}

/** 필드 콘텐츠 종류와 별칭. */
export const FIELD_KINDS = Object.freeze([
  { id: 'gather', label: '채집', mark: '잎' }, { id: 'elite', label: '정예', mark: '정' }, { id: 'treasure', label: '숨은 보물', mark: '보' }, { id: 'event', label: '필드 이벤트', mark: '사' },
]);
const FIELD_KIND_ALIAS = Object.freeze({ gather: 'gather', gathering: 'gather', gathered: 'gather', elite: 'elite', elites: 'elite', treasure: 'treasure', hiddenTreasures: 'treasure', hidden: 'treasure',
  event: 'event', events: 'event' });
const FIELD_STATE = Object.freeze({ ready: 'ready', available: 'ready', done: 'done', cleared: 'done', claimed: 'done', locked: 'locked' });

/** 필드 콘텐츠 응답(+마을의 fieldId) → 화면용 모델. 필드 자체가 없으면 null. */
export function normalizeField(raw, town) {
  const fieldId = str(raw?.fieldId || raw?.id || town?.fieldId);
  if (!fieldId) return null;
  const base = FIELD_DUNGEONS.find(field => field.id === fieldId) || null;
  const progress = raw?.progress && typeof raw.progress === 'object' ? raw.progress : {};
  const content = raw?.content || town?.field || null;
  const enemyName = id => ENEMIES[id]?.name || '';
  const named = ids => list(ids).map(enemyName).filter(Boolean);
  // TownService.field(): content 에 채집 노드 · 정예 · 숨은 보물 · 이벤트 메타데이터가 있다. 이름이 없는 항목은 개수만 보여 준다.
  const derived = content ? [
    content.gathering && { kind: 'gather', name: (MATERIALS.find(item => item.id === content.gathering.material)?.name || '재료') + ' 채집', description: '채집 지점 ' + count(content.gathering.nodes) + '곳' + (content.gathering.respawnSeconds ? ' · ' + content.gathering.respawnSeconds + '초 뒤 다시 자랍니다' : ''), total: count(progress.gathered) },
    list(content.elites).length && { kind: 'elite', name: '정예 사냥', description: (named(content.elites).join(' · ') || '정예 ' + list(content.elites).length + '종') + ' 출몰', total: count(progress.elite) },
    list(content.hiddenTreasures).length && { kind: 'treasure', name: '숨은 보물', description: '숨은 보물 ' + list(content.hiddenTreasures).length + '곳', total: count(progress.treasure) },
    list(content.events).length && { kind: 'event', name: '필드 이벤트', description: '이벤트 ' + list(content.events).length + '종', total: count(progress.event) },
  ].filter(Boolean).map(entry => ({ id: entry.kind, state: 'ready', progress: null, ...entry })) : [];
  const entries = (derived.length ? derived : list(raw?.entries ?? raw?.contents).map(entry => {
    const kind = FIELD_KIND_ALIAS[String(entry?.kind ?? entry?.type)] || null; if (!kind) return null;
    const state = FIELD_STATE[String(entry.state ?? entry.status ?? 'ready').toLowerCase()] || 'ready';
    return { id: str(entry.id) || kind, kind, name: str(entry.name) || FIELD_KINDS.find(item => item.id === kind).label, description: str(entry.description), state, progress: progressOf(entry), total: count(entry.total) };
  }).filter(Boolean));
  return { id: fieldId, name: str(raw?.name) || base?.name || fieldId, description: str(raw?.description) || base?.description || '', objective: base?.objective || '',
    art: str(raw?.art) || base?.art || '', accent: str(raw?.accent) || base?.accent || '#dec796', rewards: base?.rewards || null,
    unlocked: raw && typeof raw.unlocked === 'boolean' ? raw.unlocked : raw && typeof raw.ok === 'boolean' ? raw.ok : null, reason: str(raw?.reason || raw?.error), entries, supported: raw !== null && raw !== undefined };
}

/** 가방의 강화 가능한 장비 → 대장장이 강화 후보(착용 중 · 높은 등급 · 높은 강화 순, 최대 8개). 비용과 위험은 economy 규칙을 그대로 읽는다. */
export function upgradeCandidates(state, limit = 8) {
  const equipped = new Set();
  for (const hero of Object.values(state?.heroes || {})) for (const uid of Object.values(hero?.equip || {})) if (uid !== null && uid !== undefined) equipped.add(uid);
  return list(state?.inventory).filter(inst => ITEM_BY_ID[inst?.id] && count(inst.enh) < ENH_MAX).map(inst => {
    const item = ITEM_BY_ID[inst.id], level = count(inst.enh), tier = enhanceStoneTier(level), key = STONE_KEY[tier];
    return { id: String(inst.uid), name: item.name, level, max: ENH_MAX, price: { gold: enhanceCost(level), materials: {} }, rate: enhanceChance(level), destroy: destroyChance(level), down: enhanceDown(level),
      stone: enhanceStones(level) ? { key, name: STONE_NAME[tier], amount: enhanceStones(level), have: count(state[key]) } : null, equipped: equipped.has(inst.uid), locked: false, reason: '', rank: rarityRank(item.rarity) };
  }).sort((a, b) => Number(b.equipped) - Number(a.equipped) || b.rank - a.rank || b.level - a.level).slice(0, limit);
}

// ------------------------------------------------------------ 던전 출격 자리
/** 출격 준비 창(CitadelHubUI)이 아는 정식 게이트 자리. 허브가 모르는 던전은 null이며 이때는 게시판의 직접 출격 확인을 쓴다. */
export function dungeonDestinationSpot(id) {
  return DUNGEONS.some(dungeon => dungeon.id === id) ? citadelHotspot('dungeon:' + id) : null;
}

// ------------------------------------------------------------ 보상 · 가격 칩
const chip = (art, label, short) => '<span class="town-price' + (short ? ' is-short' : '') + '"><img src="' + safe(art) + '" alt="">' + safe(label) + '</span>';
export function rewardChips(rewards, { wallet } = {}) {
  if (!rewards) return '';
  const chips = [];
  if (rewards.gold) chips.push(chip(uiArt('gold'), fmt(rewards.gold) + ' 골드'));
  if (rewards.xp) chips.push(chip(resourceArt('xp'), '경험치 ' + fmt(rewards.xp)));
  for (const [id, amount] of Object.entries(rewards.materials || {})) chips.push(chip(resourceArt(id), (MATERIALS.find(item => item.id === id)?.name || id) + ' ' + fmt(amount), wallet && (wallet.materials?.[id] || 0) < amount));
  for (const [id, amount] of Object.entries(rewards.consumables || {})) chips.push(chip(resourceArt(id), (CONSUMABLES.find(item => item.id === id)?.name || id) + ' ' + fmt(amount)));
  for (const id of list(rewards.items)) chips.push(chip(uiArt('treasure-chest'), ITEM_BY_ID[id]?.name || id));
  return chips.join('');
}
export function rewardText(rewards) {
  const names = [];
  if (rewards?.gold) names.push('골드 ' + fmt(rewards.gold));
  if (rewards?.xp) names.push('경험치 ' + fmt(rewards.xp));
  for (const [id, amount] of Object.entries(rewards?.materials || {})) names.push((MATERIALS.find(item => item.id === id)?.name || id) + ' ' + fmt(amount));
  for (const [id, amount] of Object.entries(rewards?.consumables || {})) names.push((CONSUMABLES.find(item => item.id === id)?.name || id) + ' ' + fmt(amount));
  return names.join(' · ');
}
const meter = (progress, label) => progress ? '<div class="town-c-meter" role="progressbar" aria-label="' + safe(label) + '" aria-valuemin="0" aria-valuemax="' + progress.target + '" aria-valuenow="' + progress.current + '"><i style="width:' +
  Math.round(progress.current / progress.target * 100) + '%"></i><span>' + progress.current + '/' + progress.target + '</span></div>' : '';

// ------------------------------------------------------------ 탭 정의
export const CONTENT_TABS = Object.freeze([
  { id: 'dungeons', label: '던전 게이트', eyebrow: 'DUNGEON GATES', title: name => name + ' 던전 게이트' },
  { id: 'field', label: '필드', eyebrow: 'OPEN FIELD', title: name => name + ' 필드' },
  { id: 'quests', label: '의뢰 게시판', eyebrow: 'BOUNTY BOARD', title: name => name + ' 의뢰 게시판' },
  { id: 'forge', label: '대장장이', eyebrow: 'BLACKSMITH', title: name => name + ' 대장장이' },
  { id: 'story', label: '마을 이야기', eyebrow: 'TOWN STORY', title: name => name + ' 이야기' },
]);
export const CONTENT_VIEW_IDS = Object.freeze(CONTENT_TABS.map(tab => tab.id));
const CONTENT_ACTIONS = new Set(['enter-dungeon', 'enter-field', 'quest-accept', 'quest-claim', 'forge-craft', 'forge-enhance', 'story-advance']);

const SEEN_KEY = 'blade-surge.town-content.seen.v1';
const readSeen = () => {
  try {
    const raw = globalThis.localStorage?.getItem(SEEN_KEY); if (raw === null || raw === undefined) return null;
    const keys = JSON.parse(raw); return new Set(Array.isArray(keys) ? keys.filter(key => typeof key === 'string') : []);
  } catch { return null; }
};
const writeSeen = seen => { try { globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* 저장 공간이 없으면 이번 세션에서만 기억한다 */ } };

/**
 * TownUI 안의 콘텐츠 패널. 화면 문자열과 동작을 맡고, 대화상자·초점·장면 동기화는 TownUI가 맡는다.
 * 모든 쓰기는 TownService 호출이며 성공하면 economy 구독자에게 변경을 알린다.
 */
export class TownContent {
  constructor(ui) {
    this.ui = ui; this.fresh = new Set(); this.seen = readSeen(); this.checking = false; this.armed = null;
  }
  get service() { return this.ui.service; }
  get app() { return this.ui.app; }
  has(key) { return !!serviceMethod(this.service, key); }
  call(key, ...args) {
    const method = serviceMethod(this.service, key);
    return method ? attempt(() => method(...args), null) : null;
  }

  // ---------------------------------------------------------- 모델
  town(townId = this.ui.activeId) { return this.ui.towns().find(town => town.id === townId) || null; }
  quests(townId) { return normalizeQuests(this.call('quests', townId)); }
  forge(townId) {
    const forge = normalizeForge(this.call('forge', townId));
    if (forge && forge.unlocked && !forge.upgrades.length && this.has('enhance')) forge.upgrades = upgradeCandidates(this.app.eco?.s);
    return forge;
  }
  story(townId) { return normalizeStory(this.call('story', townId)); }
  field(townId) { return normalizeField(this.call('field', townId), this.town(townId)); }
  dungeonAccess(id) { return attempt(() => this.app.expedition?.dungeonAccess?.(id, { depth: 'standard' }), null); }

  // ---------------------------------------------------------- 해금 추적
  /** 현재 보이는 해금 상태의 열쇠 → 알림 문구. 서비스가 알려 주는 사실만 쓴다. */
  unlockMap() {
    const map = new Map();
    for (const town of this.ui.towns()) {
      if (town.unlocked) map.set('town:' + town.id, { town: town.id, tab: 'map', title: town.name + ' 해금', text: '이동석으로 갈 수 있게 되었습니다.' });
      const field = this.field(town.id);
      if (field && field.unlocked === true) map.set('field:' + town.id, { town: town.id, tab: 'field', title: field.name + ' 개방', text: '필드에서 채집과 정예 사냥을 시작하세요.' });
      const forge = this.forge(town.id);
      if (forge && forge.unlocked === true) map.set('forge:' + town.id, { town: town.id, tab: 'forge', title: town.name + ' 대장장이 개방', text: '장비 제작과 강화를 맡길 수 있습니다.' });
      for (const step of this.story(town.id)?.steps || []) {
        if (step.status === 'active' || step.status === 'ready' || step.status === 'done') map.set('story:' + town.id + ':' + step.id + ':open', { town: town.id, tab: 'story', title: '새 이야기 · ' + step.title, text: town.name + '의 이야기가 이어집니다.' });
        if (step.status === 'done') map.set('story:' + town.id + ':' + step.id + ':done', { town: town.id, tab: 'story', title: '이야기 완료 · ' + step.title, text: step.rewards ? '보상: ' + rewardText(step.rewards) : '다음 장이 열릴 수 있습니다.' });
      }
    }
    return map;
  }
  /** 이전에 본 목록과 비교해 새로 열린 것만 돌려준다. 처음 보는 저장은 조용히 기준만 잡는다. */
  checkUnlocks() {
    if (this.checking) return [];
    this.checking = true;
    try {
      const map = this.unlockMap();
      if (!this.seen) { this.seen = new Set(map.keys()); writeSeen(this.seen); return []; }
      const events = [];
      for (const [key, info] of map) if (!this.seen.has(key)) { this.seen.add(key); events.push({ key, ...info }); }
      if (!events.length) return events;
      writeSeen(this.seen);
      for (const event of events) if (event.tab !== 'map') this.fresh.add(event.tab);
      // 마을이 열리며 함께 열린 필드 · 이야기 같은 항목은 그 마을 알림 한 장에 묶는다.
      const lead = new Map(events.filter(event => event.key.startsWith('town:')).map(event => [event.town, { ...event, extra: [] }]));
      const merged = [];
      for (const event of events) {
        const head = lead.get(event.town);
        if (event.key.startsWith('town:')) merged.push(head);
        else if (head) { const label = CONTENT_TABS.find(tab => tab.id === event.tab)?.label; if (label && !head.extra.includes(label)) head.extra.push(label); }
        else merged.push(event);
      }
      for (const head of lead.values()) if (head.extra.length) head.text += ' 함께 열린 곳: ' + head.extra.join(' · ');
      return merged;
    } finally { this.checking = false; }
  }

  // ---------------------------------------------------------- 동작
  handles(name) { return CONTENT_ACTIONS.has(name); }
  act(name, data) {
    if (name === 'enter-dungeon') return this.enterDungeon(data.dungeon);
    if (name === 'enter-field') return this.enterField(data.field);
    if (name === 'quest-accept') return this.write('acceptQuest', [this.ui.activeId, data.offer], name, '의뢰를 수락했습니다.', data.offer);
    if (name === 'quest-claim') return this.write('claimQuest', [this.ui.activeId, data.offer], name, '의뢰를 완료했습니다.', data.offer);
    if (name === 'forge-craft') return this.write('craft', [this.ui.activeId, data.offer], name, '장비를 제작했습니다.', data.offer);
    if (name === 'forge-enhance') return this.enhance(data.offer, name);
    if (name === 'story-advance') return this.write('advanceStory', [this.ui.activeId, data.offer], name, '이야기가 한 장 나아갔습니다.', data.offer);
    return undefined;
  }
  /** 서비스 쓰기 한 번. 성공하면 재화 HUD 구독자에게 알리고 결과를 안내한다. */
  write(key, args, kind, success, focusId, describe = null) {
    const ui = this.ui, method = serviceMethod(this.service, key);
    const result = method ? attempt(() => method(...args), { ok: false, reason: '처리하지 못했습니다.' }) : { ok: false, reason: '이 마을에서는 아직 이용할 수 없습니다.' };
    this.armed = null;
    if (result.ok) {
      ui.app.eco?.emit?.();
      const reward = rewardText(result.rewards || result.granted), note = describe?.(result);
      ui.say(note?.text || str(result.message) || success + (reward ? ' ' + reward : ''), note?.tone || 'success');
    } else ui.say(ui.reason(result, '처리하지 못했습니다.'), 'error');
    ui.sound(result.ok && result.success !== false);
    ui.render(focusId, kind);
    ui.announce(this.checkUnlocks());
    return result;
  }
  /** 실패하면 장비가 내려가거나 파괴될 수 있는 강화는 한 번 더 눌러야 실행한다. */
  enhance(offerId, kind) {
    const ui = this.ui, entry = this.forge(ui.activeId)?.upgrades.find(upgrade => upgrade.id === offerId);
    if (entry && (entry.destroy > 0 || entry.down > 0) && this.armed !== offerId) {
      this.armed = offerId;
      ui.say('+' + entry.level + ' 강화는 실패하면 ' + (entry.destroy > 0 ? '장비가 파괴되거나 ' : '') + '강화 단계가 내려갈 수 있습니다. 감수하려면 한 번 더 누르세요.', 'error');
      ui.sound(false); ui.render(offerId, kind); return { ok: false, armed: true };
    }
    const uid = /^\d+$/.test(offerId) ? Number(offerId) : offerId;
    return this.write('enhance', [ui.activeId, uid], kind, '장비를 강화했습니다.', offerId, result => {
      if (result.destroyed) return { text: '강화에 실패해 장비가 파괴되었습니다.', tone: 'error' };
      if (result.success === false) return { text: '강화에 실패했습니다.' + (result.down ? ' +' + result.enh + '로 내려갔습니다.' : ' 단계는 그대로입니다.'), tone: 'error' };
      return { text: '강화에 성공했습니다.' + (Number.isFinite(result.enh) ? ' +' + result.enh : ''), tone: 'success' };
    });
  }
  enterDungeon(id) {
    const ui = this.ui, spot = dungeonDestinationSpot(id), hub = ui.app.hubUI;
    if (!DUNGEONS.some(dungeon => dungeon.id === id)) { ui.say('알 수 없는 던전입니다.', 'error'); ui.sound(false); return ui.render(); }
    if (!spot || typeof hub?.openDestination !== 'function') return this.enterDirect(id);
    const trigger = ui.trigger, view = ui.view;
    ui.close();
    if (hub.openDestination(spot, trigger)) return true;
    ui.open(view, trigger); ui.say('지금은 출격 준비를 열 수 없습니다. 잠시 뒤 다시 시도해 주세요.', 'error'); ui.render();
    return false;
  }
  /**
   * 광장 게이트 목록에 없는 던전(출격 준비 창이 모르는 경로)의 출격. 비용을 보여 주고 한 번 더 눌러야 입장한다.
   * 단계 · 서약 선택이 없는 기본 원정이며, 에너지와 입장 조건은 startExpedition이 다시 검사한다.
   */
  async enterDirect(id) {
    const ui = this.ui, def = DUNGEONS.find(dungeon => dungeon.id === id), access = this.dungeonAccess(id);
    if (access && !access.ok) { this.armed = null; ui.say(access.error || '조건을 확인하세요.', 'error'); ui.sound(false); return ui.render(id, 'enter-dungeon'); }
    if (this.armed !== 'dungeon:' + id) {
      this.armed = 'dungeon:' + id;
      ui.say(def.name + ' · 기본 원정 · 에너지 ' + def.energy + '를 사용합니다. 출격하려면 한 번 더 누르세요.', 'success');
      ui.sound(true); return ui.render(id, 'enter-dungeon');
    }
    this.armed = null; ui.close();
    return ui.app.startExpedition('dungeon', id, { depth: 'standard' });
  }
  async enterField(fieldId) {
    const ui = this.ui, app = ui.app, field = this.field(ui.activeId);
    if (!field || field.id !== fieldId) { ui.say('이 마을의 필드를 확인할 수 없습니다.', 'error'); ui.sound(false); return ui.render(); }
    const access = this.dungeonAccess(fieldId);
    if (access && !access.ok) { ui.say(access.error || '지금은 필드에 나갈 수 없습니다.', 'error'); ui.sound(false); return ui.render(); }
    ui.close();
    return app.startExpedition('dungeon', fieldId, { depth: 'standard' });
  }

  // ---------------------------------------------------------- 화면
  /** 패널이 열려 있는 동안 남는 해금 안내. 지금 열린 곳으로 바로 가는 버튼과 닫기 버튼이 있다. */
  bannerHtml() {
    const notices = this.ui.notices || []; if (!notices.length) return '';
    return '<section class="town-c-banner" aria-label="새로 열린 곳">' + notices.map((notice, index) => '<div class="town-c-banner-row"><span class="town-c-seal" aria-hidden="true">★</span><div><strong>' + safe(notice.title) + '</strong><p>' + safe(notice.text) + '</p></div>' +
      (notice.tab && notice.tab !== 'map' ? '<button type="button" class="town-buy" data-town-act="view" data-view="' + safe(notice.tab) + '">보러 가기</button>' : '') +
      '<button type="button" class="town-c-dismiss" data-town-act="dismiss-notice" data-index="' + index + '" aria-label="안내 닫기">닫기</button></div>').join('') + '</section>';
  }
  html(tab) {
    // 두 번 눌러 확정하는 상태는 그것을 건 탭에서만 유지한다(대장장이 강화 · 던전 직접 출격).
    const armedDungeon = String(this.armed).startsWith('dungeon:');
    if (!(tab === 'forge' && !armedDungeon) && !(tab === 'dungeons' && armedDungeon)) this.armed = null;
    const body = tab === 'field' ? this.fieldHtml() : tab === 'quests' ? this.questsHtml() : tab === 'forge' ? this.forgeHtml() : tab === 'story' ? this.storyHtml() : this.dungeonsHtml();
    this.fresh.delete(tab);
    return this.tabsHtml(tab) + this.bannerHtml() + body;
  }
  /** 받을 수 있는 보상(완료한 의뢰 · 이어갈 이야기) 수. 걷기 HUD 칩의 배지에 쓴다. */
  claimable(townId = this.ui.activeId) {
    return (this.quests(townId) || []).filter(quest => quest.status === 'ready').length + (this.story(townId)?.steps || []).filter(step => step.status === 'ready').length;
  }
  tabsHtml(active) {
    const id = this.ui.activeId, ready = {
      quests: (this.quests(id) || []).filter(quest => quest.status === 'ready').length,
      story: (this.story(id)?.steps || []).filter(step => step.status === 'ready').length,
    };
    return '<div class="town-tabs town-c-tabs" role="group" aria-label="마을 콘텐츠">' + CONTENT_TABS.map(tab => '<button type="button" data-town-act="view" data-view="' + tab.id + '" aria-pressed="' + (tab.id === active) + '">' +
      safe(tab.label) + (ready[tab.id] ? '<b class="town-c-badge" aria-label="받을 수 있는 보상 ' + ready[tab.id] + '건">' + ready[tab.id] + '</b>' : '') +
      (this.fresh.has(tab.id) && tab.id !== active ? '<i class="town-c-new">NEW</i>' : '') + '</button>').join('') + '</div>';
  }
  empty(text) { return '<p class="town-empty">' + safe(text) + '</p>'; }

  dungeonsHtml() {
    const ui = this.ui, town = this.town(), ids = town ? ui.dungeonIds(town) : [];
    const cleared = ids.filter(id => ui.wins(id) > 0).length;
    const towns = ui.towns(), next = towns[towns.findIndex(entry => entry.id === ui.activeId) + 1];
    const percent = ids.length ? Math.round(cleared / ids.length * 100) : 0;
    const head = '<p class="town-intro">이 마을의 던전 ' + ids.length + '곳입니다. 한 곳을 고르면 기존 출격 준비 창에서 단계와 보상을 확인합니다.</p>' +
      '<div class="town-c-summary"><div class="town-c-meter" role="progressbar" aria-label="이 마을 던전 클리어" aria-valuemin="0" aria-valuemax="' + ids.length + '" aria-valuenow="' + cleared + '"><i style="width:' + percent + '%"></i><span>클리어 ' + cleared + '/' + ids.length + '</span></div>' +
      (next ? '<p>' + safe(next.name) + (next.unlocked ? ' · 이동석으로 갈 수 있습니다.' : ' · ' + safe(next.requirement?.text || '해금 조건을 확인하세요.')) + '</p>' : '<p>마지막 마을입니다.</p>') + '</div>';
    const rows = ids.map((id, index) => {
      const def = DUNGEONS.find(dungeon => dungeon.id === id); if (!def) return '';
      const wins = ui.wins(id), access = this.dungeonAccess(id), locked = access ? !access.ok : false;
      const roster = def.roster ? ['trash', 'ranged', 'elite'].map((key, i) => [['일반', '원거리', '정예'][i], new Set(def.roster[key] || []).size]).filter(([, n]) => n).map(([label, n]) => label + ' ' + n + '종').join(' · ') : '';
      const boss = def.bossName ? def.bossName + (def.bossPattern?.length ? ' · 패턴 ' + new Set(def.bossPattern).size + '종' : '') : '';
      const plaza = !!dungeonDestinationSpot(id);
      const facts = [def.mechanic && ['고유 기믹', def.mechanic.name + ' — ' + def.mechanic.trigger], roster && ['적 구성', roster], boss && ['보스', boss]].filter(Boolean);
      return '<li class="town-c-dungeon" data-dungeon="' + safe(id) + '" data-cleared="' + (wins > 0) + '" data-locked="' + locked + '" style="--route-accent:' + safe(def.accent || '#dec796') + '">' +
        '<img class="town-c-art" src="' + safe(def.art || '') + '" alt="" loading="lazy" decoding="async"><div class="town-c-copy"><small>' + safe(def.subtitle || '') + ' · 탐험 Lv.' + def.minLevel + ' · 에너지 ' + def.energy +
        ' · ' + (plaza ? '출격 준비 창' : '기본 원정 직접 출격') + '</small><h3>' + safe(def.name) + '</h3><p>' + safe(def.description || '') + '</p>' +
        (facts.length ? '<dl class="town-c-facts">' + facts.map(([label, value]) => '<div><dt>' + safe(label) + '</dt><dd>' + safe(value) + '</dd></div>').join('') + '</dl>' : '') +
        '<span class="town-c-state">' + (wins > 0 ? '✓ 클리어 ' + fmt(wins) + '회' : '미클리어') + (locked ? ' · ' + safe(access.error || '조건 확인 필요') : '') + '</span></div>' +
        '<button type="button" class="town-buy town-c-go" data-town-act="enter-dungeon" data-dungeon="' + safe(id) + '" data-offer="' + safe(id) + '">' + (locked ? '조건 확인' : !plaza ? (this.armed === 'dungeon:' + id ? '출격 확정' : '출격') : '출격 준비') + '</button></li>';
    }).join('');
    return head + (rows ? '<ol class="town-c-dungeons">' + rows + '</ol>' : this.empty('이 마을의 던전 정보를 읽을 수 없습니다.'));
  }

  fieldHtml() {
    const field = this.field(this.ui.activeId);
    if (!field) return this.empty('이 마을에는 아직 연결된 필드가 없습니다.');
    const wallet = this.ui.wallet(), access = this.dungeonAccess(field.id);
    const blocked = field.unlocked === false || (access ? !access.ok : false), why = field.unlocked === false ? this.ui.reason({ reason: field.reason }, '아직 필드가 열리지 않았습니다.') : access?.error || '';
    const cards = field.entries.length ? '<ul class="town-c-field-list" aria-label="필드 콘텐츠">' + field.entries.map(entry => {
      const kind = FIELD_KINDS.find(item => item.id === entry.kind);
      return '<li class="town-c-field-entry" data-kind="' + entry.kind + '" data-state="' + entry.state + '"><span class="town-c-mark" aria-hidden="true">' + safe(kind.mark) + '</span><div><small>' + safe(kind.label) + '</small><strong>' + safe(entry.name) + '</strong>' +
        (entry.description ? '<p>' + safe(entry.description) + '</p>' : '') + meter(entry.progress, entry.name) + (entry.total ? '<p class="town-c-total">누적 ' + fmt(entry.total) + '회</p>' : '') + '</div><em>' + (entry.state === 'done' ? '완료' : entry.state === 'locked' ? '잠김' : '가능') + '</em></li>';
    }).join('') + '</ul>' : this.empty(field.supported ? '이 필드에는 아직 표시할 채집·정예·숨은 보물·이벤트 정보가 없습니다.' : '채집 · 정예 · 숨은 보물 · 필드 이벤트 정보는 필드 데이터가 준비되면 이곳에 표시됩니다.');
    return '<article class="town-c-field" style="--route-accent:' + safe(field.accent) + '">' + (field.art ? '<img class="town-c-art" src="' + safe(field.art) + '" alt="" decoding="async">' : '') +
      '<div class="town-c-copy"><small>OPEN FIELD · 원정 Lv.1부터</small><h3>' + safe(field.name) + '</h3><p>' + safe(field.description) + '</p>' + (field.objective ? '<p class="town-c-objective">' + safe(field.objective) + '</p>' : '') +
      (field.rewards ? '<div class="town-prices">' + rewardChips(field.rewards, { wallet }) + '</div>' : '') + '</div>' +
      '<button type="button" class="town-buy town-c-go" data-town-act="enter-field" data-field="' + safe(field.id) + '" data-offer="' + safe(field.id) + '"' + (blocked ? ' disabled' : '') + '>필드 출격</button></article>' +
      (why ? '<p class="town-need town-c-note">' + safe(why) + '</p>' : '') + cards;
  }

  questsHtml() {
    const quests = this.quests(this.ui.activeId);
    if (!quests) return this.empty('이 마을의 의뢰 게시판은 아직 열리지 않았습니다.');
    if (!quests.length) return this.empty('지금 게시판에 붙은 의뢰가 없습니다. 내일 다시 확인하세요.');
    const wallet = this.ui.wallet(), order = ['ready', 'active', 'available', 'locked', 'done'];
    const titles = { ready: '보상을 받을 수 있어요', active: '진행 중', available: '수락할 수 있는 의뢰', locked: '아직 받을 수 없어요', done: '완료한 의뢰' };
    return '<p class="town-intro">의뢰를 수락한 뒤 던전과 필드에서 목표를 채우면 이곳에서 보상을 받습니다.</p>' + order.map(status => {
      const group = quests.filter(quest => quest.status === status); if (!group.length) return '';
      return '<h3 class="town-section">' + titles[status] + '</h3><div class="town-offers town-c-quests">' + group.map(quest => {
        const button = status === 'available' ? '<button type="button" class="town-buy" data-town-act="quest-accept" data-offer="' + safe(quest.id) + '">수락</button>'
          : status === 'ready' ? '<button type="button" class="town-buy" data-town-act="quest-claim" data-offer="' + safe(quest.id) + '">보상 받기</button>'
            : '<button type="button" class="town-buy" disabled>' + (status === 'done' ? '완료' : status === 'active' ? '진행 중' : '잠김') + '</button>';
        return '<article class="town-offer town-c-quest" data-status="' + status + '" data-kind="' + quest.kind + '"><span class="town-c-mark" aria-hidden="true">' + safe(QUEST_KIND_LABEL[quest.kind][0]) + '</span><div class="town-offer-copy"><small>' + QUEST_KIND_LABEL[quest.kind] + ' 의뢰' +
          (quest.resetText ? ' · ' + safe(quest.resetText) : '') + '</small><h3>' + safe(quest.title) + '</h3>' + (quest.description ? '<p>' + safe(quest.description) + '</p>' : '') + (quest.goal ? '<p class="town-c-goal">목표: ' + safe(quest.goal) + '</p>' : '') + meter(quest.progress, quest.title) +
          (status === 'locked' && quest.reason ? '<p class="town-need">' + safe(CONTENT_REASONS[quest.reason] || quest.reason) + '</p>' : '') + '<div class="town-prices">' + rewardChips(quest.rewards, { wallet }) + '</div></div>' + button + '</article>';
      }).join('') + '</div>';
    }).join('');
  }

  forgeHtml() {
    const forge = this.forge(this.ui.activeId);
    if (!forge) return this.empty('이 마을의 대장장이는 아직 일을 시작하지 않았습니다.');
    const ui = this.ui, wallet = ui.wallet();
    const head = '<p class="town-intro">마을 대장장이에게 골드로 제작 · 강화를 맡깁니다. 내 장비 착용 · 비교는 영웅 · 장비, 원정 재료 제작은 제작 공방에서 합니다.</p><div class="town-wallet"><span><img src="' + uiArt('gold') + '" alt="">보유 골드</span><strong>' + fmt(wallet.gold) + '</strong></div>';
    if (!forge.unlocked) return head + this.empty('대장장이의 공방이 아직 열리지 않았습니다.');
    const recipe = entry => {
      const ok = ui.affordable(entry.price, wallet) && !entry.locked && !entry.crafted;
      return '<article class="town-offer town-c-recipe" data-crafted="' + entry.crafted + '"><span class="town-c-mark" aria-hidden="true">제</span><div class="town-offer-copy"><small>' + (entry.repeatable ? '제조 · 여러 번 가능' : '제작 · 한 번') + '</small><h3>' + safe(entry.name) + '</h3>' +
        (entry.description ? '<p>' + safe(entry.description) + '</p>' : '') + (entry.reason ? '<p class="town-need">' + safe(CONTENT_REASONS[entry.reason] || entry.reason) + '</p>' : '') +
        '<div class="town-prices">' + ui.priceChips(entry.price, wallet) + (entry.consumables ? rewardChips({ consumables: entry.consumables }) : '') + '</div></div>' +
        '<button type="button" class="town-buy" data-town-act="forge-craft" data-offer="' + safe(entry.id) + '"' + (ok ? '' : ' disabled') + '>' + (entry.crafted ? '제작 완료' : ok ? (entry.repeatable ? '제조' : '제작') : '부족') + '</button></article>';
    };
    const upgrade = entry => {
      const maxed = entry.max > 0 && entry.level >= entry.max, stoneShort = entry.stone && entry.stone.have < entry.stone.amount;
      const ok = ui.affordable(entry.price, wallet) && !stoneShort && !entry.locked && !maxed, armed = this.armed === entry.id, risky = entry.destroy > 0 || entry.down > 0;
      const risk = risky ? '실패 시 ' + [entry.destroy > 0 ? '파괴 ' + Math.round(entry.destroy * 100) + '%' : '', entry.down ? '강화 -' + entry.down : ''].filter(Boolean).join(' · ') : '';
      return '<article class="town-offer town-c-upgrade" data-risky="' + risky + '" data-armed="' + armed + '"><span class="town-c-mark" aria-hidden="true">+' + entry.level + '</span><div class="town-offer-copy"><small>강화' + (entry.equipped ? ' · 착용 중' : '') + (entry.max ? ' · 최대 +' + entry.max : '') +
        (entry.rate !== null ? ' · 성공 ' + Math.round(entry.rate * (entry.rate <= 1 ? 100 : 1)) + '%' : '') + '</small><h3>' + safe(entry.name) + '</h3>' + (risk ? '<p class="town-need">' + safe(risk) + '</p>' : '') +
        (entry.reason ? '<p class="town-need">' + safe(CONTENT_REASONS[entry.reason] || entry.reason) + '</p>' : '') + '<div class="town-prices">' + ui.priceChips(entry.price, wallet) +
        (entry.stone ? chip(resourceArt(entry.stone.key), entry.stone.name + ' ' + fmt(entry.stone.amount) + ' (보유 ' + fmt(entry.stone.have) + ')', stoneShort) : '') + '</div></div>' +
        '<button type="button" class="town-buy" data-town-act="forge-enhance" data-offer="' + safe(entry.id) + '"' + (ok ? '' : ' disabled') + '>' + (maxed ? '최대' : !ok ? '부족' : armed ? '위험 감수' : '강화') + '</button></article>';
    };
    return head + '<h3 class="town-section">제작</h3>' + (forge.recipes.length ? '<div class="town-offers">' + forge.recipes.map(recipe).join('') + '</div>' : this.empty('제작할 수 있는 장비가 없습니다.')) +
      '<h3 class="town-section">강화</h3>' + (forge.upgrades.length ? '<div class="town-offers">' + forge.upgrades.map(upgrade).join('') + '</div>' : this.empty('강화할 장비가 없습니다. 장비를 얻으면 이곳에 나타납니다.'));
  }

  storyHtml() {
    const story = this.story(this.ui.activeId), town = this.town();
    if (!story) return this.empty('이 마을의 이야기는 아직 시작되지 않았습니다.');
    if (!story.steps.length) return this.empty('들려줄 이야기가 없습니다.');
    const wallet = this.ui.wallet(), done = story.steps.filter(step => step.status === 'done').length;
    return '<p class="town-intro">' + safe(town?.name || '') + '의 이야기는 세 장으로 이어집니다. 한 장씩 마치면 다음 장이 열립니다. (' + done + '/' + story.steps.length + ')</p><ol class="town-c-story">' + story.steps.map(step => {
      const button = step.status === 'ready' || step.attemptable ? '<button type="button" class="town-buy" data-town-act="story-advance" data-offer="' + safe(step.id) + '">이야기 잇기</button>'
        : '<button type="button" class="town-buy" disabled>' + (step.status === 'done' ? '완료' : step.status === 'locked' ? '잠김' : '진행 중') + '</button>';
      return '<li class="town-c-chapter" data-status="' + step.status + '"><span class="town-c-seal" aria-hidden="true">' + (step.status === 'done' ? '✓' : step.index) + '</span><div class="town-c-copy"><small>제' + step.index + '장</small><h3>' + safe(step.title) + '</h3>' +
        (step.text ? '<p>' + safe(step.text) + '</p>' : '') + (step.goal ? '<p class="town-c-goal">목표: ' + safe(step.goal) + '</p>' : '') + (step.status === 'locked' ? '<p class="town-need">' + safe(CONTENT_REASONS[step.reason] || step.reason || '앞선 이야기를 먼저 마치세요.') + '</p>' : meter(step.progress, step.title)) +
        '<div class="town-prices">' + rewardChips(step.rewards, { wallet }) + '</div></div>' + button + '</li>';
    }).join('') + '</ol>';
  }
}

