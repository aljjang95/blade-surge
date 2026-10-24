// 경제·진행 상태 (localStorage 저장). 결제는 전부 목업.
import { HEROES, HERO_ORDER, levelExp, starShards, heroStats } from '../data/heroes.js';
import { ITEM_POOL, ITEM_BY_ID, SLOTS, SETS, itemStats, enhanceCost, enhanceStones, enhanceChance, destroyChance, ENH_MAX, RARITY_WEIGHT_STAGE, RARITY_WEIGHT_ELITE, RARITY_WEIGHT_GACHA , STONE_KEY, enhanceStoneTier, craftable, CRAFT_COST, GACHA_ITEM_RARITY, RARITY_INFO, enhanceDown} from '../data/items.js';
import { SKUS, GACHA, BATTLE_PASS, ENERGY, DAILY_REWARDS, PASS_TRACK } from '../data/shop.js';
import { stageDef, STAGES_PER_CHAPTER, CHAPTERS } from '../data/stages.js';
import { normalizeSave } from './save.js';
import { reconcileSelectedHero } from './save-base.js';
import { dropUnownedJob } from './expedition-economy.js';
import { HERO_POLICY, HERO_POLICY_CURRENT, HERO_STARTER_DEFAULT, HERO_FREE_UNLOCK, rosterOwns, stageLabelFromUnlocked } from '../data/hero-roster.js';
import { normalizeExpedition } from './expedition-economy.js';
import { normalizeSkillLoadout } from './progression.js';
import { resolveDifficulty } from './difficulty.js';
import { heroTrainingQuote } from './hero-training.js';
import { normalizeJourney, periodAt, recordJourneyAction as recordJourneyActionCore, refreshPeriods } from './journey-core.js';
import { freshTownState } from '../data/towns.js';
import { campaignTown, latestTownChapter, regionUnlockedBy, resolveCampaignTown, CAMPAIGN_TOWN_COUNT } from '../data/campaign-towns.js';
import { AVATAR_BY_ID } from '../data/avatars.js';
import { skuGate } from '../data/shop-gates.js';
import { THEMED_SETS } from '../data/items.js';
import { createSeededRng } from '../shared/rng.js';
import { IAP_BY_ID, IAP_REWARD_KEYS, IAP_REWARD_FIELD } from '../shared/iap-catalog.js';
import { heroBaseGrade, heroGrade, nextGrade, gradeUpCost } from '../data/hero-grades.js';
import { baselineSkillLevels, canLearnSkill, spBonus, spBudget, spSpent, spAvailable, skillLearned, FREE_RESET_BELOW_LEVEL } from '../data/skill-tree.js';
import { levelExperienceMultiplier, stageRecommendedLevel } from '../data/loot-tables.js';
import * as Runes from './rune-economy.js';
import { applyBuildStats } from './masterworks-combat.js';
import { normalizeEndgame, recordDifficultyClear, activeEvents, applyEventRewards, recordTowerClear, claimTowerChest, towerSummary, towerUnlocked, towerStage } from './endgame-core.js';

const KEY = 'bladesurge_save_v1';
const IAP_APPLIED_MAX = 300;
// 서버가 준 opId만 받는다(길이·문자 제한). 이 밖의 값은 무시한다.
const validOpId = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 200;
/** 서버 보상 객체에서 지급 가능한 키·양의 정수만 남긴다. */
function iapRewards(raw) {
  const out = {};
  if (raw && typeof raw === 'object') for (const k of IAP_REWARD_KEYS) { const n = raw[k]; if (Number.isSafeInteger(n) && n > 0 && n <= 100000000) out[k] = n; }
  return out;
}
// 분해: 판매 골드의 절반과 강화석(에픽은 상급)을 돌려준다. 유니크 이상은 일괄 분해 대상에서 보호한다.
export function salvageRewards(inst) {
  const rarity = ITEM_BY_ID[inst?.id]?.rarity;
  if (!['N', 'S', 'E'].includes(rarity)) return {};
  const enhanced = Math.max(0, Math.min(ENH_MAX, Math.floor(Number(inst.enh) || 0)));
  return { gold: Math.floor(RARITY_INFO[rarity].sell / 2),
    [rarity === 'E' ? 'stones2' : 'stones']: ({ N: 1, S: 3, E: 2 })[rarity] + Math.floor(enhanced / 4) };
}
/** 새 영웅 상태: 시작 등급(def.rarity), 기본 스킬·궁극기 1레벨, 각성 스킬은 SP로 배우기 전 0레벨. */
export function freshHeroState(id) {
  const def = HEROES[id];
  return { level: 1, exp: 0, star: 1, shards: 0, grade: heroBaseGrade(def), skills: baselineSkillLevels(def), spBonus: 0, skillLoadout: [4, 5], equip: { weapon: null, armor: null, ring: null, boots: null } };
}
// 규칙 시계·난수: 주입값이 없거나 프로토타입 메서드를 일반 객체로 빌려 쓸 때도 호출 시점의 Date.now/Math.random으로 돌아간다.
const nowOf = (eco) => (typeof eco?.now === 'function' ? eco.now() : Date.now());
// 엔드게임(무한의 성 상한·주간 보급·시즌 이벤트) 시계. 계정 서버에 연결되면 net/account.js 가 서버 시각을 꽂아
// 기기 시계를 앞당겨도 상한·보급이 먼저 열리지 않는다. 오프라인 로컬은 기기 시계(되돌림은 endgame-core 가 막는다).
const endgameNow = (eco) => (typeof eco?.trustedClock === 'function' ? eco.trustedClock() : nowOf(eco));
const rngOf = (eco) => (typeof eco?.rng === 'function' ? eco.rng : Math.random);
const pickWeighted = (w, rng = Math.random) => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = rng() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };

// 가챠 전용 결정적 RNG (mulberry32)는 src/shared/rng.js로 옮겼다. 기존 import 경로를 위해 다시 내보낸다.
export { createSeededRng };
/** pity = 마지막 SSR 이후 이번 소환의 순번(1부터). softPity회 연속 미당첨 뒤, 즉 softPity+1번째 소환부터 SSR 가중치가 오른다. */
export function gachaSsrWeight(pity) { return GACHA.rates.SSR + (pity > GACHA.softPity ? (pity - GACHA.softPity) * GACHA.softPityStep : 0); }
export function gachaChances(pity) {
  if (pity >= GACHA.pity) return { R: 0, SR: 0, SSR: 1 };
  const ssr = gachaSsrWeight(pity), tot = GACHA.rates.R + GACHA.rates.SR + ssr;
  return { R: GACHA.rates.R / tot, SR: GACHA.rates.SR / tot, SSR: ssr / tot };
}
export function rollGachaRarity(pity, rng = Math.random) {
  return pity >= GACHA.pity ? 'SSR' : pickWeighted({ R: GACHA.rates.R, SR: GACHA.rates.SR, SSR: gachaSsrWeight(pity) }, rng);
}
const heroesOf = (r) => HERO_ORDER.filter((h) => HEROES[h].rarity === r);
/** 픽업을 제외한 SSR 영웅 풀. 'other' 분배는 이 풀에서만 뽑아 픽업 확률이 정확히 ssrSplit.featured가 된다. */
const otherSsrHeroes = () => heroesOf('SSR').filter((h) => h !== GACHA.featured);
/** 실제 소환 코드와 같은 식으로 계산한 공개 확률표 (단일 소환 기준, 10연 SR 보장 보정 제외). */
export function gachaRates() {
  const ssrByPull = Array.from({ length: GACHA.pity }, (_, i) => gachaChances(i + 1).SSR);
  let survive = 1, expected = 0;
  ssrByPull.forEach((p, i) => { expected += (i + 1) * survive * p; survive *= 1 - p; });
  // 다른 SSR 영웅이 없으면 그 몫은 픽업으로 간다 (rollResult와 같은 규칙).
  const others = otherSsrHeroes(), { featured, pool, gear } = GACHA.ssrSplit;
  return {
    base: gachaChances(1), softPityFrom: GACHA.softPity, hardPity: GACHA.pity, ssrByPull,
    expectedPullsPerSsr: expected, consolidatedSsr: 1 / expected,
    ssrSplit: { featuredHero: others.length ? featured : featured + pool, otherSsrHero: others.length ? pool : 0, ssrGear: gear, materials: GACHA.materials.SSR.reduce((sum, m) => sum + m.w, 0), otherHeroes: others },
    srSplit: { ...GACHA.srSplit }, tenPullSrPlus: 1, dupShards: GACHA.dupShards,
    rSplit: { ...GACHA.rSplit }, materials: structuredClone(GACHA.materials),
  };
}

/**
 * 소환 구성품 전체와 1회 소환 기준 개별 확률(기본 확률, 61번째 상승·10연 보장 보정 제외).
 * rollResult/addItem과 같은 규칙: 장비는 슬롯 4개 중 하나를 고른 뒤 그 슬롯의 같은 등급 장비 중 하나를 고른다.
 * @returns {Array<{ kind: 'hero'|'gear'|'material', grade: 'SSR'|'SR'|'R', id: string, p: number, slot?: string, rarity?: string, n?: number }>}
 */
export function gachaContents() {
  const rates = gachaRates(), base = rates.base, out = [];
  const gear = (grade, p) => {
    const rarity = GACHA_ITEM_RARITY[grade];
    for (const slot of SLOTS) {
      const pool = ITEM_POOL[slot].filter((x) => x.rarity === rarity);
      for (const it of pool) out.push({ kind: 'gear', grade, id: it.id, slot, rarity, p: p / SLOTS.length / pool.length });
    }
  };
  const heroes = (grade, ids, p) => { for (const id of ids) out.push({ kind: 'hero', grade, id, p: p / ids.length }); };
  const mats = (grade) => { for (const m of rates.materials[grade] || []) out.push({ kind: 'material', grade, id: m.k, n: m.n, p: base[grade] * m.w }); };
  heroes('SSR', [GACHA.featured], base.SSR * rates.ssrSplit.featuredHero);
  if (rates.ssrSplit.otherSsrHero) heroes('SSR', rates.ssrSplit.otherHeroes, base.SSR * rates.ssrSplit.otherSsrHero);
  gear('SSR', base.SSR * rates.ssrSplit.ssrGear); mats('SSR');
  heroes('SR', heroesOf('SR'), base.SR * rates.srSplit.hero);
  gear('SR', base.SR * rates.srSplit.gear); mats('SR');
  gear('R', base.R * rates.rSplit.gear); mats('R');
  return out;
}

export class Economy {
  /**
   * @param {{ gachaRng?: () => number, gachaSeed?: number, rng?: () => number, now?: () => number, storage?: { getItem(key: string): string|null, setItem(key: string, value: string): void, removeItem(key: string): void } }} [options]
   * gachaRng/gachaSeed: 가챠 RNG 주입(테스트·재현용). rng: 강화·드랍 등 나머지 규칙 난수. now: 규칙 시계(ms).
   * storage: 저장소. 생략하면 호출 시점의 globalThis.localStorage를 쓴다(테스트가 중간에 바꿔 끼워도 따라간다).
   */
  constructor(options = {}) {
    // load()가 생성자 안에서 불리므로 시계·난수·저장소를 먼저 고정한다.
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.rng = typeof options.rng === 'function' ? options.rng : () => Math.random();
    this._storage = options.storage || null;
    this.gachaRng = typeof options.gachaRng === 'function' ? options.gachaRng : Number.isInteger(options.gachaSeed) ? createSeededRng(options.gachaSeed) : Math.random;
    this.storageStatus = 'ready'; this.hasStoredSave = false; this.lastGachaError = null; this.s = this.load(); this._lastGoodSave = JSON.stringify(this.s); this.listeners = []; this.bonusReceipts = new WeakSet(); this.tickEnergy();
  }
  /** 주입 저장소, 없으면 호출 시점의 localStorage. 접근 자체가 throw할 수 있어 try 안에서만 읽는다. */
  get storage() { return this._storage || globalThis.localStorage; }
  onChange(fn) { this.listeners.push(fn); }
  emit() { const saved = this.save(); for (const f of this.listeners) f(this.s); return saved; }
  recordJourneyAction(stat, amount = 1) {
    const s = this.s; s.journey = normalizeJourney(s.journey);
    const at = nowOf(this), period = periodAt(at); refreshPeriods(s.journey, at);
    s.actionSequence = (Number.isSafeInteger(s.actionSequence) ? s.actionSequence : 0) + 1;
    return recordJourneyActionCore(s.journey, { receiptId: `action:${s.actionSequence}`, stat, amount, day: period.day, week: period.week });
  }
  fresh() {
    return {
      expedition: normalizeExpedition(), journey: normalizeJourney(), endgame: normalizeEndgame(), actionSequence: 0,
      schemaVersion: 1, created: nowOf(this), name: '보스', gold: 12000, gems: 1500, energy: ENERGY.max, energyT: nowOf(this), tickets: 5, ssrTickets: 0, sweep: 3, stones: 12, stones2: 0, stones3: 0, fragments: 0, protect: 1, bless: 1,
      transcendStones: 0, skillResets: 1,
      heroes: Object.fromEntries(Object.keys(HEROES).map(id => [id, freshHeroState(id)])),
      selected: HERO_STARTER_DEFAULT, roster: { policy: HERO_POLICY_CURRENT, owned: [HERO_STARTER_DEFAULT], starter: HERO_STARTER_DEFAULT, starterChosen: false, paid: [] },
      inventory: [], invSeq: 1, avatars: { owned: [], equipped: {}, showGear: {} },
      progress: { unlocked: 1, stars: {}, difficulty: 'story' }, // stars['1-1'] = 3
      campaignTown: { current: 0, celebrated: 0 }, // 0 = 아직 고르지 않음(가장 최근 해금 마을을 따른다)
      regionGate: { v: 1, kept: [] }, // 지역 던전 노출의 소급 보존 목록(새 저장은 비어 있음, region-dungeon-gate.js)
      towns: freshTownState(),
      pity: 0, gacha: { pity: 0 }, totalPulls: 0, firstPurchaseUsed: {}, purchases: [], spentKRW: 0, vip: 0, vipUntil: 0, monthlyUntil: 0, monthlyClaimed: 0,
      iapApplied: [], adsRemoved: false, // 서버 검증 결제로 적용한 grant/reversal opId(최근 300개)와 광고 제거 권한
      pass: { xp: 0, premium: false, claimedFree: [], claimedPrem: [] },
      daily: { day: 0, last: 0 }, mail: [{ id: 1, title: '환영합니다, 보스님!', body: '사전등록 보상이 도착했습니다.', rewards: { gems: 500, tickets: 3 }, read: false }],
      quests: { kills: 0, stages: 0, pulls: 0, claimed: [] }, guide: { seen: false }, tutorial: { completed: false }, settings: { sfx: true, music: true, haptics: true, voice: true, quality: 'auto', camera: 'auto', screenShake: null, autoTarget: true, cameraInvertX: false, cameraInvertY: false, cameraAuto: true }, limitedStart: nowOf(this),
    };
  }
  load() {
    for (const key of [KEY, KEY + '_backup']) {
      try {
        const raw = this.storage.getItem(key); if (!raw) continue;
        this.hasStoredSave = true;
        try {
          const s = this.migrate(JSON.parse(raw));
          if (key !== KEY) this.storageStatus = 'recovered';
          return s;
        } catch {
          this.storageStatus = 'recovery-needed';
          // 읽지 못한 원본을 보존한 뒤 마지막 정상 저장을 시도한다.
          if (!this.storage.getItem(KEY + '_recovery')) this.storage.setItem(KEY + '_recovery', raw);
        }
      } catch { this.storageStatus = 'unavailable'; }
    }
    return this.fresh();
  }
  /** 구 세이브 보정 — 각성 슬롯이 늘어나면 스킬 레벨 배열도 늘려 준다 */
  migrate(s) {
    const out = normalizeSave(s, this.fresh());
    // 결제 적용 기록: 문자열 opId만, 중복 제거, 최근 300개.
    out.iapApplied = [...new Set((Array.isArray(out.iapApplied) ? out.iapApplied : []).filter(validOpId))].slice(-IAP_APPLIED_MAX);
    out.adsRemoved = out.adsRemoved === true;
    return out;
  }
  save() {
    try {
      const raw = JSON.stringify(this.s);
      // 현재 진행 저장이 우선이다. 백업 공간 부족이 정상 저장을 막지 않는다.
      this.storage.setItem(KEY, raw);
      try { if (this._lastGoodSave) this.storage.setItem(KEY + '_backup', this._lastGoodSave); } catch {}
      this._lastGoodSave = raw; this.storageStatus = 'ready'; this.hasStoredSave = true; return true;
    } catch { this.storageStatus = 'unavailable'; return false; }
  }
  reset() {
    let cleared = true;
    try { for (const key of [KEY, KEY + '_backup', KEY + '_recovery']) this.storage.removeItem(key); }
    catch { cleared = false; }
    this.s = this.fresh(); this._lastGoodSave = JSON.stringify(this.s); this.bonusReceipts = new WeakSet(); this.emit();
    return cleared && this.storageStatus === 'ready';
  }
  rollbackEnergy(snapshot) {
    Object.assign(this.s, { energy: snapshot.energy, energyT: snapshot.energyT });
    const raw = JSON.stringify(this.s);
    this._lastGoodSave = raw;
    try {
      this.storage.setItem(KEY, raw);
      this.storage.setItem(KEY + '_backup', raw);
      this.storageStatus = 'ready'; return true;
    } catch {
      // 취소된 차감 상태가 복구 경로에서 되살아나지 않도록 낡은 백업을 제거한다.
      try { this.storage.removeItem(KEY + '_backup'); } catch {}
      this.storageStatus = 'unavailable'; return false;
    }
  }

  // ---------- 화폐 ----------
  get isVip() { return this.s.vipUntil > nowOf(this); }
  get energyMax() { return ENERGY.max + (this.isVip ? 50 : 0); }
  tickEnergy() {
    const s = this.s; const max = this.energyMax; if (s.energy >= max) { s.energyT = nowOf(this); return; }
    const gained = Math.floor((nowOf(this) - s.energyT) / (ENERGY.regenSec * 1000));
    if (gained > 0) { s.energy = Math.min(max, s.energy + gained); s.energyT += gained * ENERGY.regenSec * 1000; if (s.energy >= max) s.energyT = nowOf(this); }
  }
  energyTimer() { const s = this.s; if (s.energy >= this.energyMax) return ''; const left = ENERGY.regenSec * 1000 - (nowOf(this) - s.energyT) % (ENERGY.regenSec * 1000); const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000); return `${m}:${sec.toString().padStart(2, '0')}`; }
  spendEnergy(n) { this.tickEnergy(); if (this.s.energy < n) return false; if (this.s.energy >= this.energyMax) this.s.energyT = nowOf(this); this.s.energy -= n; this.emit(); return true; }
  addRewards(r, opts = {}) {
    const s = this.s; const got = [];
    if (r.gold) { const g = Math.floor(r.gold * (this.isVip && opts.applyVip !== false ? 1.3 : 1)); s.gold += g; got.push({ k: 'gold', n: g }); }
    if (r.gems) { s.gems += r.gems; got.push({ k: 'gems', n: r.gems }); }
    if (r.energy) { s.energy = Math.min(this.energyMax + 200, s.energy + r.energy); got.push({ k: 'energy', n: r.energy }); }
    if (r.tickets) { s.tickets += r.tickets; got.push({ k: 'tickets', n: r.tickets }); }
    if (r.ssrTicket) { s.ssrTickets += r.ssrTicket; got.push({ k: 'ssrTicket', n: r.ssrTicket }); }
    if (r.sweep) { s.sweep += r.sweep; got.push({ k: 'sweep', n: r.sweep }); }
    if (r.stones) { s.stones += r.stones; got.push({ k: 'stones', n: r.stones }); }
    if (r.stones2) { s.stones2 = (s.stones2 || 0) + r.stones2; got.push({ k: 'stones2', n: r.stones2 }); }
    if (r.stones3) { s.stones3 = (s.stones3 || 0) + r.stones3; got.push({ k: 'stones3', n: r.stones3 }); }
    if (r.fragments) { s.fragments = (s.fragments || 0) + r.fragments; got.push({ k: 'fragments', n: r.fragments }); }
    if (r.protect) { s.protect += r.protect; got.push({ k: 'protect', n: r.protect }); }
    if (r.bless) { s.bless += r.bless; got.push({ k: 'bless', n: r.bless }); }
    if (r.transcendStones) { s.transcendStones = (s.transcendStones || 0) + r.transcendStones; got.push({ k: 'transcendStones', n: r.transcendStones }); }
    if (r.runeDust) { const runes = Runes.runesOf(this); runes.dust += r.runeDust; got.push({ k: 'runeDust', n: r.runeDust }); }
    if (r.blessingCharm) { const n = Runes.grantCharms(this, r.blessingCharm); if (n) got.push({ k: 'blessingCharm', n }); }
    if (r.skillResets) { s.skillResets = (s.skillResets || 0) + r.skillResets; got.push({ k: 'skillResets', n: r.skillResets }); }
    if (r.monthly) { s.monthlyUntil = Math.max(nowOf(this), s.monthlyUntil) + r.monthly * 86400000; got.push({ k: 'monthly', n: r.monthly }); }
    if (r.vipDays) { s.vipUntil = Math.max(nowOf(this), s.vipUntil) + r.vipDays * 86400000; s.vip = Math.max(s.vip, 1); got.push({ k: 'vip', n: r.vipDays }); }
    if (r.ssrGear) { for (let i = 0; i < r.ssrGear; i++) { const it = this.addItem('SSR'); got.push({ k: 'item', item: it }); } }
    if (!opts.silent) this.emit();
    return got;
  }
  // ---------- 영웅 ----------
  hero(id = this.s.selected) { return this.s.heroes[id]; }
  /** 소유 여부: roster(시작·무료 해금·서버 권한)만이 근거다. 영웅 상태(레벨·장비)는 미소유여도 보존한다. */
  ownHero(id) { return typeof id === 'string' && !!this.s.heroes[id] && rosterOwns(this.s.roster, id); }
  /** 소유 영웅 id 목록(HERO_ORDER 순). */
  ownedHeroIds() { return HERO_ORDER.filter((id) => this.ownHero(id)); }
  /** 저장 후 알림까지 한 번에. 저장이 실패하면 호출자가 롤백한다. */
  _commit(before) {
    if (!this.save()) { this.s = before; return false; }
    for (const f of this.listeners) f(this.s);
    return true;
  }
  /** 첫 실행 시작 영웅 선택(정책 2, 한 번만). 고른 영웅이 유일한 소유 영웅이 되고 출전 영웅이 된다. */
  chooseStarter(id) {
    const r = this.s.roster;
    if (!r || r.policy !== HERO_POLICY.STARTER) return { ok: false, reason: 'policy' };
    if (r.starterChosen) return { ok: false, reason: 'chosen' };
    if (typeof id !== 'string' || !Object.hasOwn(HEROES, id) || !this.s.heroes[id]) return { ok: false, reason: 'unknown' };
    const before = structuredClone(this.s);
    r.owned = [id]; r.starter = id; r.starterChosen = true; this.s.selected = id;
    reconcileSelectedHero(this.s); dropUnownedJob(this.s);
    if (!this._commit(before)) return { ok: false, reason: 'storage' };
    return { ok: true, id };
  }
  /**
   * 무료 해금 견적(UI·서버 공통). reason: owned | starter-pending | policy | unknown | max | progress | gems | null(해금 가능).
   * step 은 지금까지 무료로 연 영웅 수(시작 영웅 제외)이며, 조건·비용은 HERO_FREE_UNLOCK[step] 이다. 결제로 연 영웅은 step 을 올리지 않는다.
   */
  heroUnlockQuote(id) {
    const s = this.s, r = s.roster, have = s.gems;
    const base = { id, owned: false, step: 0, need: 0, needLabel: '', gems: 0, have, progress: s.progress?.unlocked || 1, canFree: false, reason: null };
    if (typeof id !== 'string' || !Object.hasOwn(HEROES, id)) return { ...base, reason: 'unknown' };
    if (this.ownHero(id)) return { ...base, owned: true, reason: 'owned' };
    if (!r || r.policy !== HERO_POLICY.STARTER) return { ...base, reason: 'policy' };
    if (!r.starterChosen) return { ...base, reason: 'starter-pending' };
    const step = Math.max(0, r.owned.length - 1), tier = HERO_FREE_UNLOCK[step];
    if (!tier) return { ...base, step, reason: 'max' };
    const out = { ...base, step, need: tier.need, needLabel: stageLabelFromUnlocked(tier.need, STAGES_PER_CHAPTER), gems: tier.gems };
    if (out.progress < tier.need) return { ...out, reason: 'progress' };
    if (have < tier.gems) return { ...out, reason: 'gems' };
    return { ...out, canFree: true };
  }
  /** 캠페인 진행 + 보석으로 영웅 하나를 연다. 저장이 실패하면 보석·소유를 되돌린다. */
  unlockHeroFree(id) {
    const q = this.heroUnlockQuote(id);
    if (!q.canFree) return { ok: false, reason: q.reason };
    const before = structuredClone(this.s);
    this.s.gems -= q.gems; this.s.roster.owned = [...this.s.roster.owned, id];
    if (!this._commit(before)) return { ok: false, reason: 'storage' };
    return { ok: true, id, gems: q.gems };
  }
  /** 환불·회수·정화 뒤 출전 영웅과 직업이 소유 영웅 안에 있게 맞춘다. */
  reconcileOwnership() { reconcileSelectedHero(this.s); dropUnownedJob(this.s); }
  heroEquipBonus(id, equipment = this.hero(id).equip, inventory = this.s.inventory) {
    const b = { atk: 0, hp: 0, def: 0, crit: 0, atkPct: 0, hpPct: 0, critDmg: 0, ultGain: 0, sets: {}, procs: [], summons: [] };
    for (const sl of SLOTS) { const iid = equipment[sl]; const inst = inventory.find((x) => x.uid === iid); if (inst) { const def = ITEM_BY_ID[inst.id]; const st = itemStats(inst); b.atk += st.atk; b.hp += st.hp; b.def += st.def; b.crit += st.crit; const set = def.set; b.sets[set] = (b.sets[set] || 0) + 1; for (const proc of def.procs || []) if (!b.procs.includes(proc)) b.procs.push(proc); if (def.summon && !b.summons.some((summon) => summon.id === def.summon.id)) b.summons.push({ ...def.summon, itemId: def.id }); } }
    b.active = [];
    for (const sid in b.sets) {
      const n = b.sets[sid]; const S = SETS[sid]; if (!S) continue;
      const apply = (o, tier) => { b.atkPct += o.atk || 0; b.hpPct += o.hp || 0; b.crit += o.crit || 0; b.critDmg += o.critDmg || 0; b.ultGain += o.ultGain || 0; for (const pr of o.procs || []) if (!b.procs.includes(pr)) b.procs.push(pr); b.active.push({ set: S, tier, n }); };
      if (n >= 4) apply(S.four, 4); else if (n >= 2) apply(S.two, 2);
    }
    return b;
  }
  /** 세이브를 건드리지 않고 실제 장착/해제 계산으로 비교한다. */
  previewItem(heroId, uid) {
    const h = this.hero(heroId), inst = this.s.inventory.find((x) => x.uid === uid);
    if (!h || !inst || !ITEM_BY_ID[inst.id]) return null;
    const slot = ITEM_BY_ID[inst.id].slot, remove = h.equip[slot] === uid;
    const beforeBonus = this.heroEquipBonus(heroId);
    const afterBonus = this.heroEquipBonus(heroId, { ...h.equip, [slot]: remove ? null : uid });
    const owner = Object.keys(this.s.heroes).find((id) => this.s.heroes[id].equip[slot] === uid);
    return { slot, remove, owner, current: this.s.inventory.find((x) => x.uid === h.equip[slot]) || null,
      before: this.heroBuildStats(heroId), after: this.heroBuildStats(heroId, { ...h.equip, [slot]: remove ? null : uid }), beforeBonus, afterBonus };
  }
  /** 출전 영웅에게 켜진 세트 효과 수 (하네스 setProgress 박자) */
  setCount() { return this.heroEquipBonus(this.s.selected).active.length; }
  /** 세트 조각으로 테마 세트 장비 제작 */
  craftSetItem(setId, slot) {
    // 조각 제작은 테마 세트(유니크)만. 등급 세트(레전드리 dragon 등)는 조각 30개로 만들 수 없다(v1 명령 직접 호출 포함).
    const def = THEMED_SETS.includes(setId) ? craftable(setId, slot) : null; if (!def) return { ok: false, reason: 'none' };
    if ((this.s.fragments || 0) < CRAFT_COST) return { ok: false, reason: 'fragments' };
    this.s.fragments -= CRAFT_COST;
    const inst = { uid: this.s.invSeq++, id: def.id, enh: 0 }; this.s.inventory.push(inst); this.emit(); return { ok: true, inst };
  }
  /** 슬롯별 장착 인스턴스 (외형용) */
  heroEquipInsts(id) { const h = this.hero(id); const o = {}; for (const sl of SLOTS) o[sl] = this.s.inventory.find((x) => x.uid === h.equip[sl]) || null; return o; }
  heroPower(id) { return this.heroBuildStats(id).power; }
  /** 표시용 능력치: 장비 능력치 + 장착 룬 효과(가문 공명 포함). equipment·inventory 를 주면 그 가설 장착으로. */
  heroBuildStats(id, equipment = this.hero(id).equip, inventory = this.s.inventory) {
    const st = heroStats(HEROES[id], this.hero(id), this.heroEquipBonus(id, equipment, inventory)), fx = this.heroRuneEffects(id, { equipment, inventory });
    return Object.keys(fx).length ? applyBuildStats(st, fx) : st;
  }
  // ---------- 룬·전운 (규칙은 rune-core·blessing-core, 저장·롤백은 rune-economy) ----------
  /** 룬 상태(가방·가루). 새 계정은 처음 읽을 때 첫 개방 선물과 함께 만든다. 전운 상태도 같은 방식. */
  runeState() { return Runes.runesOf(this); }
  blessingState() { return Runes.blessingOf(this); }
  heroRuneEffects(heroId = this.s.selected, options = {}) { return Runes.heroRuneEffects(this, heroId, options); }
  runeInsert(uid, index, rune) { return Runes.runeInsert(this, uid, index, rune); }
  runeRemove(uid, index) { return Runes.runeRemove(this, uid, index); }
  runeReplace(uid, index, rune) { return Runes.runeReplace(this, uid, index, rune); }
  runeMerge(id, toGrade) { return Runes.runeMerge(this, id, toGrade); }
  runeCraftExact(id) { return Runes.runeCraftExact(this, id); }
  runeCraftFamily(family) { return Runes.runeCraftFamily(this, family); }
  salvageItem(uid) { return Runes.salvageItem(this, uid); }
  recordRuneKill(stage, rank, heroId = this.s.selected) { return Runes.recordRuneKill(this, stage, rank, heroId); }
  settleRuneDrops(ledger, kind = {}) { return Runes.settleRuneDrops(this, ledger, kind); }
  blessingQuote(now = nowOf(this)) { return Runes.blessingQuote(this, now); }
  blessingRoll(now = nowOf(this), seed) { return Runes.blessingRoll(this, now, seed); }
  blessingPick(index) { return Runes.blessingPick(this, index); }
  blessingConsume() { return Runes.blessingConsume(this); }
  addHeroExp(id, exp, { silent = false } = {}) { const h = this.hero(id); h.exp += exp; let ups = 0; while (h.exp >= levelExp(h.level) && h.level < 80) { h.exp -= levelExp(h.level); h.level++; ups++; } if (!silent) this.emit(); return ups; }
  /** 미소유 영웅은 성장·장비·외형 명령을 모두 거절한다(미리 키워 두는 우회 차단). 로컬과 서버 /cmd가 같은 Economy 메서드를 부르므로 한 곳에서 막는다. */
  trainingQuote(id) { if (!this.ownHero(id)) return { ok: false, reason: 'locked' }; return heroTrainingQuote(this.s.heroes[id], this.s.gold); }
  levelUpHero(id) {
    const quote = this.trainingQuote(id); this.lastTrainingError = quote.reason;
    if (!quote.ok) return false;
    const h = this.s.heroes[id], before = { level: h.level, exp: h.exp, gold: this.s.gold };
    this.s.gold -= quote.cost; h.level++; h.exp = 0;
    if (!this.save()) {
      h.level = before.level; h.exp = before.exp; this.s.gold = before.gold;
      this.lastTrainingError = 'storage'; return false;
    }
    for (const listener of this.listeners) listener(this.s);
    return true;
  }
  promoteHero(id) { if (!this.ownHero(id)) return false; const h = this.hero(id); const need = starShards(h.star); if (h.shards < need || h.star >= 5) return false; h.shards -= need; h.star++; this.emit(); return true; }
  skillPoints(id) {
    const def = HEROES[id], h = this.hero(id);
    if (!def || !h) return { earned: 0, bonus: 0, spent: 0, available: 0 };
    return { earned: spBudget(h), bonus: spBonus(h), spent: spSpent(def, h.skills), available: spAvailable(def, h) };
  }
  learnSkill(id, i) {
    if (!this.ownHero(id)) return { ok: false, reason: 'locked' };
    const h = this.hero(id), def = HEROES[id];
    if (!h || !def || !Number.isInteger(i) || i < 0) return { ok: false, reason: 'skill' };
    const quote = canLearnSkill(def, h, i);
    if (!quote.ok) return quote;
    const before = h.skills[i]; h.skills[i] = quote.toLevel;
    if (!this.save()) { h.skills[i] = before; return { ok: false, reason: 'storage' }; }
    for (const f of this.listeners) f(this.s);
    return { ok: true, level: quote.toLevel };
  }
  upgradeSkill(id, i) { return this.learnSkill(id, i); }
  skillResetQuote(id) {
    const h = this.hero(id);
    return { free: !!h && h.level < FREE_RESET_BELOW_LEVEL, scrolls: this.s.skillResets || 0,
      gemPrice: this.sku('skill_reset1').price, refund: this.skillPoints(id).spent };
  }
  resetSkills(id, { useGems = false } = {}) {
    if (!this.ownHero(id)) return { ok: false, reason: 'locked' };
    const h = this.hero(id), def = HEROES[id], quote = this.skillResetQuote(id);
    if (!h || !def) return { ok: false, reason: 'scroll' };
    const used = quote.free ? 'free' : quote.scrolls > 0 ? 'scroll' : 'gems';
    // 되돌릴 SP가 없으면 초기화서·보석을 쓰지 않는다(리뷰 P3: 빈 초기화로 재화가 사라지던 경로).
    if (!quote.refund) return { ok: false, reason: 'nothing' };
    if (used === 'gems' && !useGems) return { ok: false, reason: 'scroll' };
    if (used === 'gems' && this.s.gems < quote.gemPrice) return { ok: false, reason: 'gems' };
    const before = { skills: h.skills, loadout: h.skillLoadout, gems: this.s.gems, scrolls: this.s.skillResets };
    h.skills = baselineSkillLevels(def);
    // 슬롯 위치는 유지한다. 빈 슬롯(-1)을 남겨 초기화가 다른 스킬을 자동 습득시키지 않는다.
    h.skillLoadout = normalizeSkillLoadout(def, h.skillLoadout).map(i =>
      def.skills[i] && skillLearned(h.skills[i]) && h.level >= (def.skills[i].unlock || 1) ? i : -1);
    if (used === 'scroll') this.s.skillResets--;
    if (used === 'gems') this.s.gems -= quote.gemPrice;
    if (!this.save()) {
      h.skills = before.skills; h.skillLoadout = before.loadout; this.s.gems = before.gems; this.s.skillResets = before.scrolls;
      return { ok: false, reason: 'storage' };
    }
    for (const f of this.listeners) f(this.s);
    return { ok: true, refunded: quote.refund, free: quote.free, used };
  }
  transcendQuote(id) {
    const def = HEROES[id], h = this.hero(id);
    if (!def || !h) return { grade: null, next: null, cost: null, have: { shards: 0, transcendStones: 0, gold: this.s.gold }, ok: false, before: null, after: null };
    const grade = heroGrade(def, h), next = nextGrade(grade), cost = gradeUpCost(grade);
    const have = { shards: h.shards, transcendStones: this.s.transcendStones || 0, gold: this.s.gold }, bonus = this.heroEquipBonus(id);
    return { grade, next, cost: cost ? { ...cost } : null, have,
      ok: !!cost && Object.keys(cost).every(k => have[k] >= cost[k]), before: heroStats(def, h, bonus),
      after: next ? heroStats(def, { ...h, grade: next }, bonus) : null };
  }
  transcend(id) {
    if (!this.ownHero(id)) return { ok: false, reason: 'locked' };
    const quote = this.transcendQuote(id);
    if (!quote.next || !quote.cost) return { ok: false, reason: 'max' };
    for (const [key, reason] of [['shards', 'shards'], ['transcendStones', 'stones'], ['gold', 'gold']]) {
      if (quote.have[key] < quote.cost[key]) return { ok: false, reason };
    }
    const h = this.hero(id), before = { grade: h.grade, shards: h.shards, stones: this.s.transcendStones, gold: this.s.gold };
    h.shards -= quote.cost.shards; this.s.transcendStones -= quote.cost.transcendStones; this.s.gold -= quote.cost.gold; h.grade = quote.next;
    if (!this.save()) {
      h.grade = before.grade; h.shards = before.shards; this.s.transcendStones = before.stones; this.s.gold = before.gold;
      return { ok: false, reason: 'storage' };
    }
    for (const f of this.listeners) f(this.s);
    return { ok: true, grade: quote.next };
  }
  // 레벨 해금과 SP 습득을 모두 마친 각성 스킬만 Q/E에 넣는다(리뷰 P1: 초기화 뒤 미습득 스킬이 다시 장착되던 경로).
  setSkillLoadout(id, slot, skillIndex) { if (!this.ownHero(id)) return false; const h = this.hero(id), def = HEROES[id]; if (!h || !def || ![0,1].includes(slot) || !Number.isInteger(skillIndex) || skillIndex < 4 || skillIndex >= def.skills.length) return false; const sk = def.skills[skillIndex]; if (sk.unlock && h.level < sk.unlock) return false; if (!skillLearned(h.skills[skillIndex])) return false; const next = normalizeSkillLoadout(def, h.skillLoadout, h.skills, h.level); if (next[slot] === skillIndex) { if (next.every((v, k) => v === h.skillLoadout?.[k])) return false; h.skillLoadout = next; this.emit(); return true; } const other = 1 - slot; if (next[other] === skillIndex) [next[slot], next[other]] = [skillIndex, next[slot]]; else next[slot] = skillIndex; h.skillLoadout = next; this.emit(); return true; }
  /** 가챠 영웅 지급: 소유 영웅은 조각 +40(중복), 미소유 영웅은 소유를 열지 않고 같은 조각만 쌓는다(locked). */
  grantHero(id) {
    const h = this.s.heroes[id]; if (!h) return { dup: false, locked: true, shards: 0 };
    h.shards += GACHA.dupShards;
    return this.ownHero(id) ? { dup: true, locked: false, shards: GACHA.dupShards } : { dup: false, locked: true, shards: GACHA.dupShards };
  }
  // ---------- 장비 ----------
  /** @param {string} rarity @param {string|null} slot */
  addItem(rarity, slot = null, rng = rngOf(this)) {
    slot = slot || SLOTS[Math.floor(rng() * SLOTS.length)];
    if (GACHA_ITEM_RARITY[rarity]) rarity = GACHA_ITEM_RARITY[rarity];   // 가챠 등급(R/SR/SSR) → 장비 등급
    const pool = ITEM_POOL[slot].filter((x) => x.rarity === rarity);
    const def = pool.length ? pool[Math.floor(rng() * pool.length)] : ITEM_POOL[slot][0];
    const inst = { uid: this.s.invSeq++, id: def.id, enh: 0 }; this.s.inventory.push(inst); return inst;
  }
  equip(heroId, uid) { if (!this.ownHero(heroId)) return false; const inst = this.s.inventory.find((x) => x.uid === uid); if (!inst) return; const slot = ITEM_BY_ID[inst.id].slot; for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; if (e[slot] === uid) e[slot] = null; } this.hero(heroId).equip[slot] = uid; this.emit(); }
  unequip(heroId, slot) { if (!this.ownHero(heroId)) return false; this.hero(heroId).equip[slot] = null; this.emit(); }
  /** 강화: +8까지 100%, 이후 확률/파괴. protect=보호주문서(파괴 방지), bless=축복(성공률 +20%) */
  enhance(uid, { protect = false, bless = false } = {}) {
    const inst = this.s.inventory.find((x) => x.uid === uid); if (!inst || inst.enh >= ENH_MAX) return { ok: false, reason: 'max' };
    const lv = inst.enh; const cost = enhanceCost(lv), stones = enhanceStones(lv);
    if (this.s.gold < cost) return { ok: false, reason: 'gold' };
    const sk = STONE_KEY[enhanceStoneTier(lv)];
    if ((this.s[sk] || 0) < stones) return { ok: false, reason: 'stones', tier: enhanceStoneTier(lv) };
    if (protect && this.s.protect <= 0) return { ok: false, reason: 'protect' };
    if (bless && this.s.bless <= 0) return { ok: false, reason: 'bless' };
    this.s.gold -= cost; this.s[sk] -= stones; if (protect) this.s.protect--; if (bless) this.s.bless--;
    let chance = enhanceChance(lv) + (bless ? 0.2 : 0); const success = rngOf(this)() < chance;
    let destroyed = false, down = 0;
    if (success) inst.enh++;
    else {
      if (!protect && rngOf(this)() < destroyChance(lv)) { destroyed = true; Runes.recoverItemRunes(this, inst, 'destroy'); this.s.inventory.splice(this.s.inventory.indexOf(inst), 1); for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; } }
      else if (enhanceDown(lv)) { down = enhanceDown(lv); inst.enh -= down; }
    }
    this.s.quests.enh = (this.s.quests.enh || 0) + 1;
    this.recordJourneyAction('upgrades');
    this.emit(); return { ok: true, success, destroyed, down, enh: destroyed ? lv : inst.enh, chance };
  }
  sellItem(uid) { const i = this.s.inventory.findIndex((x) => x.uid === uid); if (i < 0) return; const inst = this.s.inventory[i]; const r = ITEM_BY_ID[inst.id].rarity; const gold = RARITY_INFO[r]?.sell || 200; for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; } Runes.recoverItemRunes(this, inst, 'sell'); this.s.inventory.splice(i, 1); this.s.gold += gold; this.emit(); return gold; }
  isUpgrade(heroId, inst) {
    const h = this.hero(heroId), item = ITEM_BY_ID[inst?.id];
    if (!h || !item || h.equip[item.slot] === inst.uid) return false;
    const before = this.heroBuildStats(heroId);
    // 정산 직전 인벤토리에 없는 드롭도 비교하되 저장 상태는 바꾸지 않는다.
    const inventory = [...this.s.inventory.filter(x => x.uid !== inst.uid), inst];
    return this.heroBuildStats(heroId, { ...h.equip, [item.slot]: inst.uid }, inventory).power > before.power;
  }
  salvage(uids) {
    if (!Array.isArray(uids) || !uids.length) return { ok: false, reason: 'items' };
    const ids = new Set(uids), items = this.s.inventory.filter(x => ids.has(x.uid));
    if (items.length !== ids.size || items.some(x => !ITEM_BY_ID[x.id] || !['N', 'S', 'E'].includes(ITEM_BY_ID[x.id].rarity))) return { ok: false, reason: 'items' };
    if (Object.values(this.s.heroes).some(h => Object.values(h.equip).some(uid => ids.has(uid)))) return { ok: false, reason: 'equipped' };
    const inventory = this.s.inventory, before = { gold: this.s.gold, stones: this.s.stones, stones2: this.s.stones2, runes: this.s.runes && structuredClone(this.s.runes) };
    const sockets = items.map((x) => x.sockets); for (const item of items) Runes.recoverItemRunes(this, item, 'sell');
    const rewards = {};
    for (const item of items) for (const [key, n] of Object.entries(salvageRewards(item))) rewards[key] = (rewards[key] || 0) + n;
    this.s.inventory = inventory.filter(x => !ids.has(x.uid));
    const got = this.addRewards(rewards, { silent: true, applyVip: false });
    if (!this.save()) { this.s.inventory = inventory; items.forEach((x, i) => { if (sockets[i]) x.sockets = sockets[i]; }); Object.assign(this.s, before); if (!before.runes) delete this.s.runes; return { ok: false, reason: 'storage' }; }
    for (const f of this.listeners) f(this.s);
    return { ok: true, count: items.length, got };
  }
  /** 필드 드랍 아이템 (즉시 인벤토리) */
  fieldDrop(rarity) { const it = this.addItem(rarity); this.save(); return it; }
  /** 전투 수집 장부는 저장하지 않는다. 정산 경로만 영웅·계정에 지급한다. */
  beginFieldRewards(stage, heroId = this.s.selected) {
    if (!stage || stage.party || stage.expedition?.kind === 'arena' || !this.hero(heroId)) return null;
    if (this._fieldRewards?.stage === stage) return this._fieldRewards;
    return this._fieldRewards = { stage, heroId, heroLevel: this.hero(heroId).level,
      ticketId: stage.expedition ? this.s.expedition.pending?.id : null,
      exp: 0, heroShards: 0, transcendStones: 0, materials: {}, settled: false };
  }
  discardFieldRewards(ledger) { if (this._fieldRewards === ledger) this._fieldRewards = null; }
  /** RPG 처치 호출부에서 기존 즉시 grantCombatXp 대신 사용한다. */
  queueCombatXp(stage, heroId, amount) {
    const ledger = this.beginFieldRewards(stage, heroId), h = this.hero(heroId);
    const beforeLevel = h?.level || 1;
    const gained = !ledger || ledger.settled || beforeLevel >= 80 || !Number.isSafeInteger(amount) || amount <= 0 ? 0
      : Math.floor(Math.min(amount, 1000000) * levelExperienceMultiplier(ledger.heroLevel, stageRecommendedLevel(stage, ledger.heroLevel)));
    if (ledger) ledger.exp = Math.min(100000000, ledger.exp + gained);
    return { gained, levels: 0, beforeLevel, level: beforeLevel, exp: h?.exp || 0 };
  }
  fieldRewardsFor(stage, ticket) {
    const ledger = this._fieldRewards;
    return ledger && !ledger.settled && (ticket ? ledger.ticketId === ticket.id : ledger.stage === stage) ? ledger : null;
  }
  applyFieldExtras(field, heroId) {
    const count = (n, cap) => Number.isSafeInteger(n) && n > 0 ? Math.min(n, cap) : 0;
    const got = this.addRewards({ transcendStones: count(field?.transcendStones, 100) }, { silent: true, applyVip: false });
    const shards = count(field?.heroShards, 100);
    if (shards && this.hero(heroId)) { this.hero(heroId).shards += shards; got.push({ k: 'heroShards', heroId, n: shards }); }
    for (const key of Object.keys(this.s.expedition.materials)) {
      const n = count(field?.materials?.[key], 1000);
      if (n) { this.s.expedition.materials[key] += n; got.push({ k: key, n }); }
    }
    return got;
  }
  // ---------- 스테이지 ----------
  stageKey(ch, st) { return `${ch}-${st}`; }
  stageIndex(ch, st) { return (ch - 1) * STAGES_PER_CHAPTER + st; }
  difficultyFor(ch, st, requested = this.s.progress.difficulty || 'story') { return resolveDifficulty(this.s, ch, st, requested); }
  setDifficulty(id, ch = 1, st = 1) {
    const next = resolveDifficulty(this.s, ch, st, id);
    this.s.progress.difficulty = next.id;
    this.emit();
    return next;
  }
  /** 캠페인 마을 상태. { latest: 해금한 가장 먼 지역, current: 로비가 보여 주는 마을, celebrated: 축하를 보여 준 가장 먼 지역 } */
  campaignTownState() { return resolveCampaignTown(this.s.progress, this.s.campaignTown); }
  campaignTownList() {
    const state = this.campaignTownState();
    return Array.from({ length: CAMPAIGN_TOWN_COUNT }, (_, index) => {
      const town = campaignTown(index + 1);
      return { ...town, unlocked: town.chapter <= state.latest, current: town.chapter === state.current, unlockHint: town.chapter === 1 ? '' : `${town.chapter - 1}-10 클리어 시 해금` };
    });
  }
  /** 해금한 마을 중 하나를 로비 마을로 고른다. 해금하지 않았거나 같은 마을이면 저장하지 않는다. */
  setCampaignTown(chapter) {
    const state = this.campaignTownState();
    if (!Number.isSafeInteger(chapter) || chapter < 1 || chapter > state.latest) return false;
    if (chapter === state.current && this.s.campaignTown?.current === chapter) return true;
    const before = this.s.campaignTown;
    this.s.campaignTown = { current: chapter, celebrated: state.celebrated };
    if (!this.emit()) { this.s.campaignTown = before; return false; }
    return true;
  }
  /** 해금 축하를 보여 준 뒤 한 번만 기록한다. */
  markTownCelebrated(chapter) {
    const state = this.campaignTownState();
    if (!Number.isSafeInteger(chapter) || chapter <= state.celebrated || chapter > state.latest) return false;
    this.s.campaignTown = { current: state.current, celebrated: chapter };
    return this.emit();
  }
  unlockRegionTown(stage, before = this.campaignTownState()) {
    const next = regionUnlockedBy(stage), latest = latestTownChapter(this.s.progress);
    if (!next || latest <= before.latest) return null;
    this.s.campaignTown = { current: latest, celebrated: before.celebrated };
    const town = campaignTown(latest);
    return { chapter: latest, townId: town.id, name: town.name, accent: town.accent };
  }
  isUnlocked(ch, st) { return Number.isInteger(ch) && Number.isInteger(st) && ch >= 1 && ch <= CHAPTERS.length && st >= 1 && st <= STAGES_PER_CHAPTER && this.stageIndex(ch, st) <= this.s.progress.unlocked; }
  nextStage() { const idx = Math.min(this.s.progress.unlocked, CHAPTERS.length * STAGES_PER_CHAPTER); const ch = Math.ceil(idx / STAGES_PER_CHAPTER), st = ((idx - 1) % STAGES_PER_CHAPTER) + 1; return stageDef(ch, st); }
  completeStage(stage, stars, { double = false, fieldGold = 0, fieldStones = 0, fieldStones2 = 0, fieldStones3 = 0, fieldFragments = 0, fieldLoot = [], fieldExp = 0, fieldHeroShards = 0, fieldTranscendStones = 0, fieldMaterials = {}, fullClear = false } = {}) {
    const ledger = this.fieldRewardsFor(stage), heroId = ledger?.heroId || this.s.selected;
    const s = this.s; const key = this.stageKey(stage.ch, stage.st); const first = !s.progress.stars[key];
    const townBefore = this.campaignTownState();
    s.progress.stars[key] = Math.max(s.progress.stars[key] || 0, stars);
    if (stage.idx >= s.progress.unlocked) s.progress.unlocked = Math.min(CHAPTERS.length * STAGES_PER_CHAPTER, stage.idx + 1);
    // 지역 마지막 관문(X-10)을 처음 클리어해 다음 지역이 열리면 로비 마을도 그 지역 마을로 바뀐다(저장됨). 축하는 한 번만 보여 준다.
    const regionUnlock = this.unlockRegionTown(stage, townBefore);
    // 난이도 최고 기록(지옥 해금)과 숙련 이상 승리 임무. 시즌 이벤트는 완료 보상(골드·EXP·강화석)에만 붙는다(서버 정산도 같은 시계).
    s.endgame = normalizeEndgame(s.endgame);
    const difficultyId = stage.difficultyId || 'story';
    recordDifficultyClear(s.endgame, stage.ch, stage.st, difficultyId);
    if (difficultyId !== 'story') this.recordJourneyAction('hardClears');
    const m = double ? 2 : 1; const r = applyEventRewards(stage.rewards, activeEvents(endgameNow(this)), 'campaign'); const loot = [];
    const fullClearBonus = fullClear ? { exp: Math.floor(r.exp * 0.5), gold: Math.floor(r.gold * 0.4), fragments: 10, eliteGear: 1 } : null;
    // 필드 드랍(전투 중 획득한 골드/강화석)은 여기서 정산. 장비는 이미 인벤토리에 들어감.
    const milestone = first && stage.st % 5 === 0 ? { tickets: stage.st % 10 === 0 ? 2 : 1 } : {};
    const got = this.addRewards({ gold: r.gold * m + fieldGold * m + (fullClearBonus?.gold || 0), gems: first ? r.firstGems : 0, stones: (r.stones || 0) * m + fieldStones, stones2: fieldStones2 * m, stones3: fieldStones3 * m, fragments: fieldFragments * m + (stage.boss ? 5 : 0) + (fullClearBonus?.fragments || 0), ...milestone }, { silent: true });
    for (const l of fieldLoot) loot.push(l);
    if (fullClearBonus) loot.push(this.addItem(pickWeighted(RARITY_WEIGHT_ELITE, rngOf(this))));
    if (double && rngOf(this)() < r.dropChance) { loot.push(this.addItem(pickWeighted(RARITY_WEIGHT_STAGE, rngOf(this)))); }
    if (stage.boss && rngOf(this)() < 0.3) { s.tickets += 1; got.push({ k: 'tickets', n: 1 }); }
    // 초월석·영웅 조각·지역 재료는 전투 중 서비스가 쌓은 장부만 믿는다. 장부가 없으면 호출 인자로 새 재화를 주지 않는다(리뷰 P2).
    if (ledger) got.push(...this.applyFieldExtras(ledger, heroId), ...this.settleRuneDrops(ledger, { hell: difficultyId === 'hell', first }));
    const prevLv = this.hero(heroId).level;
    const combatExp = ledger?.exp ?? (Number.isSafeInteger(fieldExp) && fieldExp > 0 ? Math.min(fieldExp, 100000000) : 0);
    const stageExp = Math.floor((r.exp * m + (fullClearBonus?.exp || 0)) * levelExperienceMultiplier(prevLv, stageRecommendedLevel(stage, prevLv)));
    const ups = this.addHeroExp(heroId, stageExp + combatExp, { silent: true });
    const nowLv = this.hero(heroId).level;
    if (ledger) ledger.settled = true;
    // 이번 판에 넘긴 각성 구간
    const awakened = (HEROES[heroId].skills || []).filter((k) => k.unlock && prevLv < k.unlock && nowLv >= k.unlock);
    const passUps = this.addPassXp(r.bp);
    s.quests.stages++; const saved = this.emit();
    const receipt = { got, loot, ups, passUps, first, exp: stageExp, combatExp, totalExp: stageExp + combatExp, heroId, awakened, fullClearBonus, regionUnlock,
      ok: saved, saveError: !saved };
    this.bonusReceipts.add(receipt);
    return receipt;
  }
  /** 결과에 표시된 골드·재료의 실지급량만 한 번 더 준다. 첫 클리어 보석/경험치는 제외. */
  doubleStageRewards(receipt) {
    if (!receipt || !this.bonusReceipts.has(receipt)) return null;
    this.bonusReceipts.delete(receipt);
    const rewards = {};
    for (const reward of receipt.got) if (['gold', 'stones', 'stones2', 'stones3', 'fragments'].includes(reward.k)) rewards[reward.k] = (rewards[reward.k] || 0) + reward.n;
    return this.addRewards(rewards, { applyVip: false });
  }
  // ---------- 무한의 성 ----------
  towerSummary() { this.s.endgame = normalizeEndgame(this.s.endgame); return towerSummary(this.s.endgame, this.s.progress, endgameNow(this)); }
  /** 다음 층 전투 정의. 해금 전이거나 시즌 상한에 닿았으면 null. */
  nextTowerStage() { const t = this.towerSummary(); return t.unlocked && !t.capped ? towerStage(t.next) : null; }
  /**
   * 무한의 성 층 돌파 정산. 첫 돌파 보상 + 필드 드랍 + 처치 EXP. 에너지·별·캠페인 진행도는 바꾸지 않는다.
   * receiptId 로 한 번만 정산한다(재시도·중복 결과 화면 방지).
   */
  completeTowerFloor(stage, { receiptId = '', fieldGold = 0, fieldStones = 0, fieldStones2 = 0, fieldStones3 = 0, fieldFragments = 0, fieldLoot = [] } = {}) {
    const s = this.s; s.endgame = normalizeEndgame(s.endgame);
    if (!stage?.tower || !towerUnlocked(s.progress)) return { ok: false, error: 'locked' };
    const record = recordTowerClear(s.endgame, { floor: stage.tower.floor, receiptId, nowMs: endgameNow(this) });
    if (!record.ok) return record;
    const ledger = this.fieldRewardsFor(stage), heroId = ledger?.heroId || s.selected;
    const count = (v) => Number.isSafeInteger(v) && v > 0 ? Math.min(v, 100000000) : 0;
    const r = record.rewards;
    const got = this.addRewards({ gold: (r.gold || 0) + count(fieldGold), gems: r.gems || 0, stones: (r.stones || 0) + count(fieldStones),
      stones2: (r.stones2 || 0) + count(fieldStones2), stones3: (r.stones3 || 0) + count(fieldStones3), fragments: count(fieldFragments) + (stage.boss ? 5 : 0),
      transcendStones: r.transcendStones || 0 }, { silent: true });
    if (ledger) got.push(...this.applyFieldExtras(ledger, heroId));
    const prevLv = this.hero(heroId).level, combatExp = ledger?.exp ?? 0;
    const stageExp = Math.floor(stage.rewards.exp * levelExperienceMultiplier(prevLv, stageRecommendedLevel(stage, prevLv)));
    const ups = this.addHeroExp(heroId, stageExp + combatExp, { silent: true });
    if (ledger) ledger.settled = true;
    this.recordJourneyAction('towerFloors');
    const passUps = this.addPassXp(stage.rewards.bp);
    const saved = this.emit();
    return { ok: true, floor: record.floor, events: record.events, got, loot: [...fieldLoot], ups, passUps, exp: stageExp, combatExp, totalExp: stageExp + combatExp, heroId,
      first: true, saveError: !saved };
  }
  claimTowerChest() {
    const s = this.s; s.endgame = normalizeEndgame(s.endgame);
    const claim = claimTowerChest(s.endgame, endgameNow(this));
    if (!claim.ok) return claim;
    const got = this.addRewards(claim.rewards, { silent: true });
    return { ok: true, got, saveError: !this.emit() };
  }
  sweep(stage) { const s = this.s; if (s.sweep <= 0 || (s.progress.stars[this.stageKey(stage.ch, stage.st)] || 0) < 3) return null; if (!this.spendEnergy(stage.energy)) return null; s.sweep--; return this.completeStage(stage, 3); }
  // ---------- 가챠 ----------
  pull(n) {
    this.lastGachaError = null;
    if (n !== 1 && n !== 10) { this.lastGachaError = 'invalid-count'; return null; }
    const before = structuredClone(this.s); const s = this.s; const cost = n === 10 ? GACHA.ten : GACHA.single;
    if (n === 1 && s.tickets > 0) s.tickets--; else if (n === 10 && s.tickets >= 10) s.tickets -= 10; else { if (s.gems < cost) { this.lastGachaError = 'insufficient-funds'; return null; } s.gems -= cost; }
    const results = []; let srGuaranteed = false; const rng = this.gachaRng;
    for (let i = 0; i < n; i++) {
      s.gacha.pity++; s.totalPulls++; s.quests.pulls++;
      let rar = rollGachaRarity(s.gacha.pity, rng);
      if (n === 10 && i === 9 && !srGuaranteed && rar === 'R') rar = 'SR';
      if (rar !== 'R') srGuaranteed = true;
      if (rar === 'SSR') s.gacha.pity = 0;
      s.pity = s.gacha.pity; // 기존 UI가 읽는 레거시 미러
      results.push(this.rollResult(rar));
    }
    this.recordJourneyAction('pulls', n);
    if (!this.save()) { this.s = before; this.lastGachaError = 'storage'; return null; }
    for (const listener of this.listeners) listener(this.s);
    return results;
  }
  pullSSR() {
    this.lastGachaError = null;
    const before = structuredClone(this.s), s = this.s; if (s.ssrTickets <= 0) { this.lastGachaError = 'no-ssr-ticket'; return null; }
    s.ssrTickets--; const r = this.rollResult('SSR', true); this.recordJourneyAction('pulls');
    if (!this.save()) { this.s = before; this.lastGachaError = 'storage'; return null; }
    for (const listener of this.listeners) listener(this.s);
    return [r];
  }
  rollResult(rar, heroOnly = false) {
    // 분배 비율은 GACHA.ssrSplit / srSplit (gachaRates()와 같은 값). 중복 영웅은 grantHero에서 조각으로 바뀐다.
    const rng = this.gachaRng;
    const hero = (id) => { const g = this.grantHero(id); return { type: 'hero', rar, id, dup: g.dup, ...(g.locked ? { locked: true } : {}), shards: g.shards, name: HEROES[id].name, img: HEROES[id].portrait }; };
    if (rar === 'SSR') {
      const r = rng(), { featured, pool, gear } = GACHA.ssrSplit;
      if (heroOnly || r < featured) return hero(GACHA.featured);
      if (r < featured + pool) { const hs = otherSsrHeroes(); return hero(hs.length ? hs[Math.floor(rng() * hs.length)] : GACHA.featured); }
      if (r < featured + pool + gear) return { type: 'item', rar, item: this.addItem('SSR', null, rng) };
      return this.rollMaterial('SSR', r, featured + pool + gear);
    }
    if (rar === 'SR') {
      const r = rng(), { hero: heroShare, gear } = GACHA.srSplit;
      if (r < heroShare) { const hs = heroesOf('SR'); return hero(hs[Math.floor(rng() * hs.length)]); }
      if (r < heroShare + gear) return { type: 'item', rar, item: this.addItem('SR', null, rng) };
      return this.rollMaterial('SR', r, heroShare + gear);
    }
    const r = rng();
    if (r < GACHA.rSplit.gear) return { type: 'item', rar: 'R', item: this.addItem('R', null, rng) };
    return this.rollMaterial('R', r, GACHA.rSplit.gear);
  }
  /** 강화 재료 결과. r은 이미 뽑은 [from, 1) 구간의 값이며 재료 목록의 누적 비율로 고른다. */
  rollMaterial(rar, r, from) {
    const list = GACHA.materials[rar] || [];
    let acc = from, pick = list[list.length - 1];
    for (const m of list) { acc += m.w; if (r < acc) { pick = m; break; } }
    this.addRewards({ [pick.k]: pick.n }, { silent: true, applyVip: false });
    return { type: 'material', rar, k: pick.k, n: pick.n };
  }
  // ---------- 상점 ----------
  sku(id) { return SKUS.find((x) => x.id === id); }
  limitedLeft(sku) { if (!sku.limited) return 0; const end = this.s.limitedStart + sku.hours * 3600000; return Math.max(0, end - nowOf(this)); }
  /** 현금 결제는 실제 스토어 SDK와 영수증 검증이 연결되기 전까지 상태를 바꾸거나 보상을 주지 않는다 (PRD §3.3). */
  paymentAvailable() { return this.billing?.available?.() === true; }
  /** 결제 서비스 주입(src/platform/billing-service.js). 주입 전·비활성이면 기존 그림자 모드 그대로다. */
  setBilling(service) { this.billing = service || null; }
  /**
   * 서버가 검증한 결제 상태를 세이브에 반영한다. 서버 응답만이 지급·권한의 근거이며 같은 opId는 한 번만 적용한다.
   * @param {{ grants?: Array<{ opId: string, productId?: string, rewards?: Record<string, number> }>, reversals?: Array<{ opId: string, grantId?: string, rewards?: Record<string, number> }>, entitlements?: { adsRemoved?: boolean, monthlyUntil?: number, passPremium?: boolean, heroes?: string[] } }} state
   * @returns {Array<{ k: string, n: number }> | null} 이번에 새로 지급한 보상(저장 실패면 null, 이때 상태는 롤백)
   */
  applyIapState(state) {
    const s = this.s, before = structuredClone(s), applied = new Set(s.iapApplied || []), got = [];
    let changed = false;
    s.iapApplied = [...(s.iapApplied || [])];
    for (const g of Array.isArray(state?.grants) ? state.grants : []) {
      if (!validOpId(g?.opId) || applied.has(g.opId)) continue;
      applied.add(g.opId); s.iapApplied.push(g.opId); changed = true;
      const rewards = iapRewards(g.rewards);
      if (Object.keys(rewards).length) got.push(...this.addRewards(rewards, { silent: true, applyVip: false }));
      const product = typeof g.productId === 'string' && Object.hasOwn(IAP_BY_ID, g.productId) ? IAP_BY_ID[g.productId] : null;
      if (product?.once && product.shopSku && !s.purchases.includes(product.shopSku)) s.purchases.push(product.shopSku);
    }
    for (const r of Array.isArray(state?.reversals) ? state.reversals : []) {
      if (!validOpId(r?.opId) || applied.has(r.opId)) continue;
      applied.add(r.opId); s.iapApplied.push(r.opId); changed = true;
      for (const [k, n] of Object.entries(iapRewards(r.rewards))) { const f = IAP_REWARD_FIELD[k]; if (f) s[f] = Math.max(0, (s[f] || 0) - n); }
    }
    const e = state?.entitlements;
    if (e && typeof e === 'object') {
      const monthly = Number.isFinite(e.monthlyUntil) ? Math.max(0, Math.floor(e.monthlyUntil)) : s.monthlyUntil;
      if (monthly !== s.monthlyUntil) { s.monthlyUntil = monthly; changed = true; }
      if (typeof e.passPremium === 'boolean' && e.passPremium !== s.pass.premium) { s.pass.premium = e.passPremium; changed = true; }
      if (typeof e.adsRemoved === 'boolean' && e.adsRemoved !== s.adsRemoved) { s.adsRemoved = e.adsRemoved; changed = true; }
      // 영웅 권한: 서버가 준 활성 목록이 정본이다. paid 를 통째로 바꾸고, 회수된 영웅은 잠금만 건다(레벨·장비는 보존).
      if (Array.isArray(e.heroes) && s.roster) {
        const paid = HERO_ORDER.filter((id) => e.heroes.includes(id));
        if (paid.length !== s.roster.paid.length || paid.some((id, i) => id !== HERO_ORDER.filter((x) => s.roster.paid.includes(x))[i])) { s.roster.paid = paid; changed = true; }
        reconcileSelectedHero(s); dropUnownedJob(s);
      }
    }
    if (!changed) return got;
    s.iapApplied = s.iapApplied.slice(-IAP_APPLIED_MAX);
    if (!this.save()) { this.s = before; return null; }
    for (const f of this.listeners) f(this.s);
    return got;
  }
  purchase(id) {
    const sku = this.sku(id); const s = this.s; if (!sku) return null;
    if (sku.kind === 'gem') {
      // 진행도 게이트(shop-gates.js): 1레벨이 후반 재료·대량 골드를 시작 보석으로 바로 사지 못한다.
      const gate = skuGate(sku, s); if (!gate.ok) return { ok: false, reason: 'level', need: gate.need, have: gate.have };
      if (s.gems < sku.price) return { ok: false, reason: 'gems' };
      const before = structuredClone(s); s.gems -= sku.price;
      const got = this.addRewards(sku.rewards, { silent: true });
      if (!this.save()) { this.s = before; return { ok: false, reason: 'storage' }; }
      for (const f of this.listeners) f(this.s);
      return { ok: true, got };
    }
    if (!this.paymentAvailable()) return { ok: false, reason: 'payment-unavailable' };
    // 결제가 연결돼도 현금 상품은 서버 검증(billing.buy → applyIapState)으로만 지급한다. 여기서 직접 주지 않는다.
    if (this.billing) return { ok: false, reason: 'use-billing' };
    if (sku.once && s.purchases.includes(id)) return { ok: false, reason: 'once' };
    // cash (목업): 첫 결제 2배 보너스
    s.purchases.push(id); s.spentKRW += sku.price;
    const vipBefore = s.vip; s.vip = s.spentKRW >= 300000 ? 5 : s.spentKRW >= 100000 ? 4 : s.spentKRW >= 50000 ? 3 : s.spentKRW >= 20000 ? 2 : s.spentKRW > 0 ? 1 : 0;
    let got;
    if (sku.gems) { const first = !s.firstPurchaseUsed[id]; s.firstPurchaseUsed[id] = true; got = this.addRewards({ gems: sku.gems + (first ? sku.bonus : Math.floor(sku.gems * 0.1)) }); got.first = first; }
    else got = this.addRewards(sku.rewards);
    this.emit(); return { ok: true, got, vipUp: s.vip > vipBefore ? s.vip : 0 };
  }
  /** @param {string} id */
  buyAvatar(id) {
    const avatar = AVATAR_BY_ID[id], s = this.s;
    if (!avatar) return { ok: false, reason: 'avatar' };
    if (s.avatars.owned.includes(id)) return { ok: false, reason: 'owned' };
    if (s.gems < avatar.price) return { ok: false, reason: 'gems' };
    // 보석 차감과 소유 추가는 저장이 성공해야 확정한다(소환과 같은 롤백 규칙).
    s.gems -= avatar.price; s.avatars.owned.push(id);
    if (!this.save()) { s.gems += avatar.price; s.avatars.owned.pop(); return { ok: false, reason: 'storage' }; }
    for (const f of this.listeners) f(this.s);
    return { ok: true };
  }
  /** @param {string} heroId @param {string|null} [id] */
  equipAvatar(heroId, id = null) {
    if (!Object.hasOwn(HEROES, heroId)) return { ok: false, reason: 'hero' };
    if (!this.ownHero(heroId)) return { ok: false, reason: 'locked' };
    if (id === null) { delete this.s.avatars.equipped[heroId]; this.emit(); return { ok: true }; }
    const avatar = AVATAR_BY_ID[id];
    if (!avatar || avatar.heroId !== heroId || !this.s.avatars.owned.includes(id)) return { ok: false, reason: 'avatar' };
    // 새로 입을 때는 아바타가 보이게 장비 외형 표시를 끈다(켠 채 해제·재착용해 '착용 중'인데 안 보이는 혼동 방지).
    this.s.avatars.equipped[heroId] = id; if (this.s.avatars.showGear) delete this.s.avatars.showGear[heroId]; this.emit(); return { ok: true };
  }
  equippedAvatar(heroId = this.s.selected) { const id = this.s.avatars?.equipped?.[heroId]; return AVATAR_BY_ID[id]?.heroId === heroId ? id : null; }
  /** 장비 외형 표시를 켠 영웅은 아바타를 입은 채로 장비 외형을 보여 준다. 화면·전투·파티 표시는 이 값을 쓴다. */
  displayAvatar(heroId = this.s.selected) { return this.s.avatars?.showGear?.[heroId] ? null : this.equippedAvatar(heroId); }
  /** @param {string} heroId @param {boolean} on */
  setShowGear(heroId, on) {
    if (!Object.hasOwn(HEROES, heroId)) return { ok: false, reason: 'hero' };
    if (!this.ownHero(heroId)) return { ok: false, reason: 'locked' };
    const map = this.s.avatars.showGear || (this.s.avatars.showGear = {});
    if (on) map[heroId] = true; else delete map[heroId];
    this.emit(); return { ok: true };
  }
  claimMonthly() { const s = this.s; if (s.monthlyUntil < nowOf(this)) return false; const day = Math.floor(nowOf(this) / 86400000); if (s.monthlyClaimed === day) return false; s.monthlyClaimed = day; this.addRewards({ gems: 100, blessingCharm: Runes.BLESSING_MONTHLY_CHARMS }); return true; }
  // ---------- 배틀패스 ----------
  get passLevel() { return Math.min(BATTLE_PASS.maxLevel, Math.floor(this.s.pass.xp / BATTLE_PASS.xpPerLevel) + 1); }
  addPassXp(xp) { const before = this.passLevel; this.s.pass.xp += xp; return this.passLevel - before; }
  /** 프리미엄 패스도 현금 상품이다. 검증된 영수증 없이 premium을 켜지 않는다. */
  buyPass() {
    if (this.s.pass.premium) return { ok: false, reason: 'owned' };
    if (!this.paymentAvailable()) return { ok: false, reason: 'payment-unavailable' };
    if (this.billing) return { ok: false, reason: 'use-billing' };
    this.s.pass.premium = true; this.s.spentKRW += BATTLE_PASS.price; this.s.purchases.push('pass'); this.emit(); return { ok: true };
  }
  claimPass(lv, prem) { const p = this.s.pass; const arr = prem ? p.claimedPrem : p.claimedFree; if (!Number.isInteger(lv) || !PASS_TRACK[lv - 1] || arr.includes(lv) || lv > this.passLevel || (prem && !p.premium)) return null; arr.push(lv); const r = PASS_TRACK[lv - 1][prem ? 'prem' : 'free']; return this.addRewards(prem ? r : { ...r, blessingCharm: Runes.passCharms(lv) }); }
  passClaimable() { const p = this.s.pass; let n = 0; for (let lv = 1; lv <= this.passLevel; lv++) { if (!p.claimedFree.includes(lv)) n++; if (p.premium && !p.claimedPrem.includes(lv)) n++; } return n; }
  // ---------- 출석 ----------
  dailyAvailable() { const d = Math.floor(nowOf(this) / 86400000); return this.s.daily.last !== d; }
  claimDaily() { if (!this.dailyAvailable()) return null; const s = this.s; const d = Math.floor(nowOf(this) / 86400000); s.daily.last = d; const idx = s.daily.day % DAILY_REWARDS.length; s.daily.day++; return { idx, got: this.addRewards(DAILY_REWARDS[idx]) }; }
  // ---------- 우편 ----------
  claimMail(id) { const m = this.s.mail.find((x) => x.id === id); if (!m || m.read) return null; m.read = true; return this.addRewards(m.rewards); }
  unreadMail() { return this.s.mail.filter((m) => !m.read).length; }
  // ---------- 임무 ----------
  quests() {
    const q = this.s.quests; return [
      { id: 'k30', name: '적 30마리 처치', cur: q.kills, max: 30, r: { gems: 100 } }, { id: 'k100', name: '적 100마리 처치', cur: q.kills, max: 100, r: { gems: 300, tickets: 1 } },
      { id: 's3', name: '스테이지 3회 클리어', cur: q.stages, max: 3, r: { gold: 20000 } }, { id: 's10', name: '스테이지 10회 클리어', cur: q.stages, max: 10, r: { gems: 200, sweep: 3 } },
      { id: 'p10', name: '소환 10회', cur: q.pulls, max: 10, r: { tickets: 3 } },
    ].map((x) => ({ ...x, done: x.cur >= x.max, claimed: q.claimed.includes(x.id) }));
  }
  claimQuest(id) { const q = this.quests().find((x) => x.id === id); if (!q || !q.done || q.claimed) return null; this.s.quests.claimed.push(id); return this.addRewards(q.r); }
  questClaimable() { return this.quests().filter((q) => q.done && !q.claimed).length; }
}

export const REWARD_LABEL = { gold: ['골드', '/img/icon_gold.webp'], gems: ['보석', '/img/icon_gem.webp'], energy: ['에너지', '/img/icon_energy.webp'], tickets: ['소환권', '/img/icon_ticket.webp'], ssrTicket: ['SSR 확정권', '/img/icon_ticket_ssr.webp'], sweep: ['소탕권', '/img/icon_sweep.webp'], stones: ['강화석', '/img/icon_stone_1.webp'], stones2: ['상급 강화석', '/img/icon_stone_2.webp'], stones3: ['전설 강화석', '/img/icon_stone_3.webp'], fragments: ['세트 조각', '/img/icon_fragment.webp'], protect: ['보호 주문서', '/img/icon_protect.webp'], bless: ['축복 주문서', '/img/icon_bless.webp'], monthly: ['월정액(일)', '/img/icon_gem.webp'], vip: ['VIP(일)', '/img/icon_vip.webp'] };
// 성장·초월·지역 드롭 보상 라벨(정산·우편·상점 공통).
Object.assign(REWARD_LABEL, { rune: ['룬', '/img/icon_fragment.webp'], runeDust: ['룬 가루', '/img/icon_fragment.webp'], blessingCharm: ['전운 부적', '/img/icon_bless.webp'], transcendStones: ['초월석', '/img/icon_stone_3.webp'], skillResets: ['스킬 초기화서', '/img/icon_protect.webp'], heroShards: ['영웅 조각', '/img/icon_fragment.webp'], glass_leaf: ['유리 잎', '/img/icon_fragment.webp'], ember_core: ['잿불 핵', '/img/icon_fragment.webp'], star_dust: ['별가루', '/img/icon_fragment.webp'] });
