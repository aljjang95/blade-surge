// 경제·진행 상태 (localStorage 저장). 결제는 전부 목업.
import { isAccountResetting } from './reset-lock.js';
import { HEROES, HERO_ORDER, levelExp, starShards, heroStats } from '../data/heroes.js';
import { ITEM_POOL, ITEM_BY_ID, SLOTS, SETS, enhanceCost, enhanceStones, enhanceChance, destroyChance, ENH_MAX, RARITY_WEIGHT_STAGE, RARITY_WEIGHT_ELITE, RARITY_WEIGHT_GACHA , STONE_KEY, enhanceStoneTier, craftable, CRAFT_COST, GACHA_ITEM_RARITY, RARITY_INFO, enhanceDown} from '../data/items.js';
import { itemStats, validItemLevel } from '../data/item-tier.js';
import { LINK_BONUS_GEMS } from '../data/link-bonus.js';
import { SKUS, GACHA, BATTLE_PASS, ENERGY, DAILY_REWARDS, PASS_TRACK } from '../data/shop.js';
import { GACHA_BANNERS, GACHA_MILEAGE, HERO_PICKUP_ROTATION, GEAR_PICKUP_ROTATION, bannerChances, bannerSsrWeight, bannerPullsPerSsr, bannerMaterials, pickupAt, heroReleased } from '../data/gacha-banners.js';
import { stageDef, STAGES_PER_CHAPTER, CHAPTERS } from '../data/stages.js';
import { normalizeSave } from './save.js';
import { reconcileSelectedHero } from './save-base.js';
import { dropUnownedJob } from './expedition-economy.js';
import { HERO_CAMPAIGN_JOIN, HERO_POLICY, HERO_POLICY_CURRENT, HERO_STARTER_DEFAULT, HERO_FREE_UNLOCK, HERO_UNLOCK_VIA_GACHA, rosterOwns, stageLabelFromUnlocked } from '../data/hero-roster.js';
import { HERO_DIRECT_PURCHASE } from '../data/hero-direct-purchase.js';
import { normalizeExpedition } from './expedition-economy.js';
import { normalizeSkillLoadout } from './progression.js';
import { resolveDifficulty, tormentTierOf } from './difficulty.js';
import { heroTrainingQuote } from './hero-training.js';
import { normalizeJourney, periodAt, recordJourneyAction as recordJourneyActionCore, refreshPeriods } from './journey-core.js';
import { DAILY_CONTRACTS, WEEKLY_CONTRACTS } from '../data/journey.js';
import { freshTownState } from '../data/towns.js';
import { campaignTown, latestTownChapter, regionUnlockedBy, resolveCampaignTown, CAMPAIGN_TOWN_COUNT } from '../data/campaign-towns.js';
import { AVATAR_BY_ID, AVATAR_PARTS, AVATAR_PREMIUM_BY_HERO, avatarFullsetEffect } from '../data/avatars.js';
import { skuGate } from '../data/shop-gates.js';
import { THEMED_SETS } from '../data/items.js';
import { enhanceSureCost } from '../data/enhance.js';
import { transferQuote } from '../data/enhance-transfer.js';
import { createSeededRng } from '../shared/rng.js';
import { IAP_BY_ID, IAP_REWARD_KEYS, IAP_REWARD_FIELD } from '../shared/iap-catalog.js';
import { heroBaseGrade, heroGrade, nextGrade, gradeUpCost } from '../data/hero-grades.js';
import { baselineSkillLevels, canLearnSkill, spBonus, spBudget, spSpent, spAvailable, skillLearned, FREE_RESET_BELOW_LEVEL } from '../data/skill-tree.js';
import { levelExperienceMultiplier, recommendedLevel, stageRecommendedLevel, dropItemLevel, progressItemLevel } from '../data/loot-tables.js';
import * as Runes from './rune-economy.js';
import { applyBuildStats } from './masterworks-combat.js';
import { normalizeEndgame, recordDifficultyClear, activeEvents, applyEventRewards, recordTowerClear, claimTowerChest, towerSummary, towerUnlocked, towerStage } from './endgame-core.js';
import { recordTormentRun, tormentStatus } from './torment-core.js';
import { HERO_LEVEL_CAP } from './rpg-core.js';
import { TORMENT } from '../data/content-90d.js';
import { recordGearDex, milestoneOf, milestoneReached, milestoneClaimed } from './gear-dex.js';
import { VAULT, VAULT_OWNER, heroItems, vaultItems, vaultSlots, vaultDay, withdrawQuote, ritualQuote, expandGold, normalizeVault, relayToday, VAULT_INHERIT } from './gear-vault.js';
import { normalizeLegend, grantLegendExp, legendStats, allocate as allocateLegendNode, respec as respecLegendNodes, respecCost as legendRespecCost } from './legend-rank.js';

const KEY = 'bladesurge_save_v1';
export const SAVE_STORAGE_KEY = KEY;
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
/**
 * 유료/무료 보석 분리(docs/BM_DESIGN.md 12.4). gems 는 총 잔액, paidGems 는 그중 결제로 받은 몫이다.
 * 소비는 무료 보석부터: 어떤 경로로 gems 가 줄든 paidGems 를 총 잔액 이하로 맞추면 무료 몫이 먼저 줄어든 것과 같다.
 * 저장(save)마다 clampPaidGems 를 거치므로 개별 소비 코드는 그대로 s.gems 를 줄여도 된다.
 */
export function clampPaidGems(s) {
  const gems = Math.max(0, Math.floor(Number(s.gems) || 0));
  s.paidGems = Math.max(0, Math.min(Math.floor(Number(s.paidGems) || 0), gems));
}
function spendGems(s, n) { s.gems -= n; clampPaidGems(s); }
const nowOf = (eco) => (typeof eco?.now === 'function' ? eco.now() : Date.now());
// 엔드게임(무한의 성 상한·주간 보급·시즌 이벤트) 시계. 계정 서버에 연결되면 net/account.js 가 서버 시각을 꽂아
// 기기 시계를 앞당겨도 상한·보급이 먼저 열리지 않는다. 오프라인 로컬은 기기 시계(되돌림은 endgame-core 가 막는다).
const endgameNow = (eco) => (typeof eco?.trustedClock === 'function' ? eco.trustedClock() : nowOf(eco));
const rngOf = (eco) => (typeof eco?.rng === 'function' ? eco.rng : Math.random);
const pickWeighted = (w, rng = Math.random) => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = rng() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };

// 가챠 전용 결정적 RNG (mulberry32)는 src/shared/rng.js로 옮겼다. 기존 import 경로를 위해 다시 내보낸다.
export { createSeededRng };
/** pity = 마지막 SSR 이후 이번 소환의 순번(1부터). banner를 생략하면 영웅 소환 배너. */
export function gachaSsrWeight(pity, banner = GACHA_BANNERS.hero) { return bannerSsrWeight(banner, pity); }
export function gachaChances(pity, banner = GACHA_BANNERS.hero) { return bannerChances(banner, pity); }
export function rollGachaRarity(pity, rng = Math.random, banner = GACHA_BANNERS.hero) {
  return pity >= banner.pity ? 'SSR' : pickWeighted({ R: banner.rates.R, SR: banner.rates.SR, SSR: bannerSsrWeight(banner, pity) }, rng);
}
// 소환 풀은 데뷔 시각(HERO_DEBUT) 전 영웅을 뺀다. now 는 호출하는 쪽 규칙 시계(서버·클라이언트 같은 함수).
const heroesOf = (r, now) => HERO_ORDER.filter((h) => HEROES[h].rarity === r && heroReleased(h, now));
const validSsrHero = (id, now) => Object.hasOwn(HEROES, id) && HEROES[id].rarity === 'SSR' && heroReleased(id, now);
const validPickupSet = (id) => SLOTS.some((slot) => ITEM_POOL[slot].some((x) => x.rarity === 'L' && x.set === id));
/** 지금 영웅 픽업(교대표에서 유효한 SSR 영웅). 없으면 GACHA.featured. */
export function heroPickup(now = Date.now()) { return pickupAt(HERO_PICKUP_ROTATION, now, (id) => validSsrHero(id, now)) || GACHA.featured; }
/** 지금 장비 픽업 세트(L 등급 세트). 없으면 null. */
export function gearPickup(now = Date.now()) { return pickupAt(GEAR_PICKUP_ROTATION, now, validPickupSet); }
/** 배너의 지금 픽업 id(영웅 id 또는 세트 id). 초보자는 픽업 없음. */
export function bannerPickup(bannerId, now = Date.now()) { return bannerId === 'hero' ? heroPickup(now) : bannerId === 'gear' ? gearPickup(now) : null; }
const otherSsrHeroes = (featured, now) => heroesOf('SSR', now).filter((h) => h !== featured);
const ssrGearPool = () => SLOTS.flatMap((slot) => ITEM_POOL[slot].filter((x) => x.rarity === 'L'));
/**
 * 실제 소환 코드와 같은 식으로 계산한 공개 확률표(단일 소환 기준, 10연 SR 보장 보정 제외).
 * 픽업 몫(ssrSplit.featured)은 50:50 기본 확률이며, 픽업이 아니었던 다음 SSR은 픽업 확정이다(guarantee).
 * @param {string} [bannerId] hero | gear | beginner
 * @param {number} [now] 픽업 교대 시각(ms)
 */
export function gachaRates(bannerId = 'hero', now = Date.now()) {
  const banner = GACHA_BANNERS[bannerId] || GACHA_BANNERS.hero;
  const ssrByPull = Array.from({ length: banner.pity }, (_, i) => bannerChances(banner, i + 1).SSR);
  const expected = bannerPullsPerSsr(banner), featured = bannerPickup(banner.id, now);
  const others = banner.ssr.hero ? otherSsrHeroes(featured, now) : [];
  // 다른 SSR 영웅이 없으면 그 몫은 픽업으로 간다(rollResult와 같은 규칙). 초보자는 SSR 영웅 균등.
  const featuredHero = banner.ssr.hero ? (banner.ssr.featured ? (others.length ? banner.ssr.featured : 1) : 0) : 0;
  const materials = structuredClone(bannerMaterials(banner));
  return {
    bannerId: banner.id, name: banner.name, featured, base: bannerChances(banner, 1), softPityFrom: banner.softPity, hardPity: banner.pity, ssrByPull,
    expectedPullsPerSsr: expected, consolidatedSsr: 1 / expected, limit: banner.limit || 0,
    ssrSplit: { featuredHero, otherSsrHero: banner.ssr.hero ? 1 - featuredHero : 0, otherHeroes: banner.ssr.featured ? others : heroesOf('SSR', now),
      ssrGear: banner.ssr.gear || 0, featuredGear: banner.ssr.gear ? banner.ssr.featured : 0, materials: 0 },
    srSplit: { hero: banner.sr.hero || 0, gear: banner.sr.gear || 0 }, rSplit: { hero: 0, gear: banner.r.gear || 0 },
    tenPullSrPlus: 1, dupShards: GACHA.dupShards, materials,
  };
}

/**
 * 배너 구성품 전체와 1회 소환 기준 개별 확률(기본 확률, 천장 상승·10연 보장·픽업 확정 보정 제외).
 * rollResult/addItem과 같은 규칙: 장비는 슬롯 4개 중 하나를 고른 뒤 그 슬롯의 같은 등급 장비 중 하나를 고른다.
 * SSR 장비는 픽업 세트 몫과 나머지 L 장비 몫으로 나눈다.
 * @returns {Array<{ kind: 'hero'|'gear'|'material', grade: 'SSR'|'SR'|'R', id: string, p: number, slot?: string, rarity?: string, n?: number, featured?: boolean }>}
 */
/** @param {string} [bannerId] @param {number} [now] @param {{ ownsHero?: (id: string) => boolean }} [opts] ownsHero: 초보자 배너의 미보유 우선 규칙을 이 계정 기준 조건부 확률로 공개할 때 */
export function gachaContents(bannerId = 'hero', now = Date.now(), { ownsHero } = {}) {
  const rates = gachaRates(bannerId, now), base = rates.base, out = [];
  const gear = (grade, p) => {
    if (!(p > 0)) return;
    const rarity = GACHA_ITEM_RARITY[grade];
    for (const slot of SLOTS) {
      const pool = ITEM_POOL[slot].filter((x) => x.rarity === rarity);
      for (const it of pool) out.push({ kind: 'gear', grade, id: it.id, slot, rarity, p: p / SLOTS.length / pool.length });
    }
  };
  const heroes = (grade, ids, p, featured = false) => { if (!(p > 0) || !ids.length) return; for (const id of ids) out.push({ kind: 'hero', grade, id, p: p / ids.length, ...(featured ? { featured: true } : {}) }); };
  const mats = (grade) => { for (const m of rates.materials[grade] || []) out.push({ kind: 'material', grade, id: m.k, n: m.n, p: base[grade] * m.w }); };
  if (rates.ssrSplit.featuredHero) heroes('SSR', [rates.featured], base.SSR * rates.ssrSplit.featuredHero, true);
  heroes('SSR', rates.ssrSplit.otherHeroes, base.SSR * rates.ssrSplit.otherSsrHero);
  if (rates.ssrSplit.ssrGear) {
    const pool = ssrGearPool(), set = rates.featured, pick = set ? pool.filter((x) => x.set === set) : [], rest = set ? pool.filter((x) => x.set !== set) : pool;
    const share = pick.length ? rates.ssrSplit.featuredGear : 0;
    for (const it of pick) out.push({ kind: 'gear', grade: 'SSR', id: it.id, slot: it.slot, rarity: 'L', p: base.SSR * rates.ssrSplit.ssrGear * share / pick.length, featured: true });
    for (const it of rest) out.push({ kind: 'gear', grade: 'SSR', id: it.id, slot: it.slot, rarity: 'L', p: base.SSR * rates.ssrSplit.ssrGear * (1 - share) / rest.length });
  }
  mats('SSR');
  // 초보자 배너 SR 영웅은 미보유 영웅이 남아 있으면 그 영웅들 사이에서만 뽑는다(rollResult와 같은 규칙). 소유 정보가 있으면 그 기준으로 공개한다.
  const srAll = heroesOf('SR', now), srFresh = rates.bannerId === 'beginner' && typeof ownsHero === 'function' ? srAll.filter((id) => !ownsHero(id)) : [];
  heroes('SR', srFresh.length ? srFresh : srAll, base.SR * rates.srSplit.hero);
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
      expedition: normalizeExpedition(), journey: normalizeJourney(), endgame: normalizeEndgame(), legend: normalizeLegend(), actionSequence: 0,
      schemaVersion: 1, gearIl: 1, created: nowOf(this), name: '보스', gold: 12000, gems: 1500, paidGems: 0, energy: ENERGY.max, energyT: nowOf(this), tickets: 5, ssrTickets: 0, sweep: 3, stones: 12, stones2: 0, stones3: 0, fragments: 0, protect: 1, bless: 1, transferScroll: 0,
      transcendStones: 0, skillResets: 1,
      heroes: Object.fromEntries(Object.keys(HEROES).map(id => [id, freshHeroState(id)])),
      selected: HERO_STARTER_DEFAULT, roster: { policy: HERO_POLICY_CURRENT, owned: [HERO_STARTER_DEFAULT], starter: HERO_STARTER_DEFAULT, starterChosen: false, paid: [] },
      inventory: [], invSeq: 1, vault: { v: 1, expansions: 0, day: 0, used: 0 }, gearDex: { v: 1, drop: {}, kin: {}, claimed: {} }, avatars: { owned: [], equipped: {}, showGear: {}, parts: {} },
      progress: { unlocked: 1, stars: {}, difficulty: 'story' }, // stars['1-1'] = 3
      campaignTown: { current: 0, celebrated: 0 }, // 0 = 아직 고르지 않음(가장 최근 해금 마을을 따른다)
      regionGate: { v: 1, kept: [] }, // 지역 던전 노출의 소급 보존 목록(새 저장은 비어 있음, region-dungeon-gate.js)
      towns: freshTownState(),
      pity: 0, gacha: { pity: 0, guarantee: false, gearPity: 0, gearGuarantee: false, beginner: 0, beginnerSsr: false, mileage: 0 }, totalPulls: 0, firstPurchaseUsed: {}, purchases: [], spentKRW: 0, vip: 0, vipUntil: 0, monthlyUntil: 0, monthlyClaimed: 0, linkBonus: 0,
      iapApplied: [], adsRemoved: false, // 서버 검증 결제로 적용한 grant/reversal opId(최근 300개)와 광고 제거 권한
      pass: { xp: 0, premium: false, claimedFree: [], claimedPrem: [] },
      daily: { day: 0, last: 0 }, mail: [{ id: 1, title: '환영합니다, 보스님!', body: '사전등록 보상이 도착했습니다.', rewards: { gems: 500, tickets: 3 }, read: false },
        // 장비 귀속·금고 안내(docs/GEAR_OWNERSHIP_VAULT.md). 보상 없는 안내 우편이라 경제·정산에는 영향이 없다.
        { id: 2, title: '장비가 영웅마다 따로 보관됩니다', body: '이제 장비는 얻은 영웅의 것이며, 다른 영웅에게 주려면 영웅 화면 가방의 [금고]에 맡긴 뒤 꺼내세요. 맡기기는 무료, 꺼내기는 골드가 들고 하루 5회까지입니다. 이전부터 갖고 있던 장비는 처음 한 번 무료로 옮길 수 있고, 강화·룬은 그대로 유지됩니다.', rewards: {}, read: false },
        // 계승 의식·도감 안내(docs/GEAR_VAULT_INHERIT.md 4.6). 안내만 있고 보상은 없다. 문장은 의뢰·고통 단계·도감 보상으로만 얻고 상점에서 팔지 않는다.
        { id: 3, title: '레전드리는 계승 의식으로 물려줘요', body: '레전드리 장비는 얻은 영웅의 것입니다. 되돌리기와 같은 무기 계열 이동은 그대로 무료이고, 다른 계열에게 주려면 금고의 [계승 의식]을 치르세요. 골드와 계승 문장이 들고 하루 2회까지이며, 확률 없이 반드시 성공하고 강화·룬은 그대로 이어집니다. 계승 문장은 일일·주간 의뢰(계승 장비로 캠페인 승리), 고통 단계 5단계마다 새 기록, 도감 보상으로 얻습니다.', rewards: {}, read: false },
        { id: 4, title: '장비 도감 마일스톤', body: '금고의 [도감]에서 영웅별 드랍 도감(직접 얻은 장비)과 계승 도감(의식으로 받은 장비)을 확인하세요. 25·50·75·100%와 계승 5·15·30종마다 영웅당 한 번씩 강화석·세트 조각·계승 문장 보상을 받고, 칭호도 얻습니다. 능력치는 오르지 않습니다.', rewards: {}, read: false }],
      quests: { kills: 0, stages: 0, pulls: 0, claimed: [] }, guide: { seen: false }, tutorial: { completed: false }, settings: { sfx: true, music: true, haptics: true, voice: true, quality: 'auto', camera: 'auto', screenShake: null, autoTarget: true, autoSalvageN: false, cameraInvertX: false, cameraInvertY: false, cameraAuto: true, companionIntroSeen: false }, limitedStart: nowOf(this),
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
    if (isAccountResetting()) return false; // 계정 초기화 중에는 저장이 지운 키를 되살리지 않는다.
    // 유료 몫 클램프는 저장이 성공할 때만 확정한다(실패하면 되돌려 호출부의 부분 롤백이 어긋나지 않게).
    const paidBefore = this.s.paidGems;
    try {
      clampPaidGems(this.s);
      const raw = JSON.stringify(this.s);
      // 현재 진행 저장이 우선이다. 백업 공간 부족이 정상 저장을 막지 않는다.
      this.storage.setItem(KEY, raw);
      try { if (this._lastGoodSave) this.storage.setItem(KEY + '_backup', this._lastGoodSave); } catch {}
      this._lastGoodSave = raw; this.storageStatus = 'ready'; this.hasStoredSave = true; return true;
    } catch { this.s.paidGems = paidBefore; this.storageStatus = 'unavailable'; return false; }
  }
  reset() {
    let cleared = true;
    try { for (const key of [KEY, KEY + '_backup', KEY + '_recovery']) this.storage.removeItem(key); }
    catch { cleared = false; }
    this.s = this.fresh(); this._lastGoodSave = JSON.stringify(this.s); this.bonusReceipts = new WeakSet(); this.emit();
    return cleared && this.storageStatus === 'ready';
  }
  /**
   * 진행 초기화 뒤 다시 쓸 새 저장(JSON). 영수증·결제로 얻은 권한만 현재 상태에서 옮기고 진행·재화는 새 시작값이다.
   * 옮기는 것: 결제 원장(iapApplied·purchases·spentKRW), 광고 제거, VIP·월정액, 첫 구매 기록, 배틀패스 프리미엄 권한,
   * 결제 영웅(roster.paid), 결제로 받은 아바타(avatars.paid와 그 소유). 유료 보석 몫은 새 시작값(0)이다.
   */
  entitlementSeed() {
    const prev = this.s, next = this.fresh();
    for (const field of ['iapApplied', 'adsRemoved', 'purchases', 'spentKRW', 'vip', 'vipUntil', 'monthlyUntil', 'monthlyClaimed', 'firstPurchaseUsed']) {
      if (prev[field] !== undefined) next[field] = structuredClone(prev[field]);
    }
    if (Array.isArray(prev.roster?.paid)) next.roster.paid = [...prev.roster.paid];
    if (prev.pass?.premium === true) next.pass.premium = true;
    const paidAvatars = prev.avatars?.paid && typeof prev.avatars.paid === 'object' ? prev.avatars.paid : null;
    if (paidAvatars) {
      next.avatars.paid = structuredClone(paidAvatars);
      next.avatars.owned = [...new Set([...(next.avatars.owned || []), ...Object.keys(paidAvatars).filter((id) => (prev.avatars.owned || []).includes(id))])];
    }
    return JSON.stringify(next);
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
    if (r.transferScroll) { s.transferScroll = (s.transferScroll || 0) + r.transferScroll; got.push({ k: 'transferScroll', n: r.transferScroll }); }
    if (r.transcendStones) { s.transcendStones = (s.transcendStones || 0) + r.transcendStones; got.push({ k: 'transcendStones', n: r.transcendStones }); }
    if (r.runeDust) { const runes = Runes.runesOf(this); runes.dust += r.runeDust; got.push({ k: 'runeDust', n: r.runeDust }); }
    if (r.blessingCharm) { const n = Runes.grantCharms(this, r.blessingCharm); if (n) got.push({ k: 'blessingCharm', n }); }
    if (r.lineageSigil) { s.lineageSigil = (s.lineageSigil || 0) + r.lineageSigil; got.push({ k: 'lineageSigil', n: r.lineageSigil }); }
    if (r.skillResets) { s.skillResets = (s.skillResets || 0) + r.skillResets; got.push({ k: 'skillResets', n: r.skillResets }); }
    if (r.monthly) { s.monthlyUntil = Math.max(nowOf(this), s.monthlyUntil) + r.monthly * 86400000; got.push({ k: 'monthly', n: r.monthly }); }
    if (r.vipDays) { s.vipUntil = Math.max(nowOf(this), s.vipUntil) + r.vipDays * 86400000; s.vip = Math.max(s.vip, 1); got.push({ k: 'vip', n: r.vipDays }); }
    if (r.ssrGear) { for (let i = 0; i < r.ssrGear; i++) { const it = this.addItem('SSR', null, rngOf(this), 0, this.s.selected); got.push({ k: 'item', item: it }); } }
    if (!opts.silent) this.emit();
    return got;
  }
  // ---------- 영웅 ----------
  hero(id = this.s.selected) { return this.s.heroes[id]; }
  /** 소유 여부: roster(시작·무료 해금·서버 권한)만이 근거다. 영웅 상태(레벨·장비)는 미소유여도 보존한다. */
  ownHero(id) { return typeof id === 'string' && !!this.s.heroes[id] && rosterOwns(this.s.roster, id); }
  /** 영웅 상태는 있지만 소유하지 않은 영웅(잠금). 모르는 id는 false라 기존 오류 처리(skill·invalid 등)가 그대로 돈다. */
  heroLocked(id) { return typeof id === 'string' && !!this.s.heroes[id] && !this.ownHero(id); }
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
    // 소환 전용(gachaOnly) 영웅은 시작 영웅 후보가 아니다(starterChoices 와 같은 규칙, 데뷔 전 SSR 무료 획득 차단).
    if (typeof id !== 'string' || !Object.hasOwn(HEROES, id) || HEROES[id].gachaOnly || !this.s.heroes[id]) return { ok: false, reason: 'unknown' };
    const before = structuredClone(this.s);
    r.owned = [id]; r.starter = id; r.starterChosen = true; this.s.selected = id;
    reconcileSelectedHero(this.s); dropUnownedJob(this.s);
    if (!this._commit(before)) return { ok: false, reason: 'storage' };
    return { ok: true, id };
  }
  /**
   * 무료 해금 견적(UI·서버 공통). reason: owned | starter-pending | policy | unknown | gacha(소환으로만 획득) | max | progress | gems | null(해금 가능).
   * step 은 지금까지 무료로 연 영웅 수(시작 영웅 제외)이며, 조건·비용은 HERO_FREE_UNLOCK[step] 이다. 결제로 연 영웅은 step 을 올리지 않는다.
   */
  heroUnlockQuote(id) {
    const s = this.s, r = s.roster, have = s.gems;
    const base = { id, owned: false, step: 0, need: 0, needLabel: '', gems: 0, have, progress: s.progress?.unlocked || 1, canFree: false, reason: null };
    if (typeof id !== 'string' || !Object.hasOwn(HEROES, id)) return { ...base, reason: 'unknown' };
    if (this.ownHero(id)) return { ...base, owned: true, reason: 'owned' };
    // 소환 전용 영웅(원래 다섯 밖)은 정책과 관계없이 소환으로만 얻는다(상품·무료 해금 없음).
    if (HEROES[id].gachaOnly) return { ...base, reason: r && r.policy === HERO_POLICY.STARTER && !r.starterChosen ? 'starter-pending' : 'gacha' };
    if (!r || r.policy !== HERO_POLICY.STARTER) return { ...base, reason: 'policy' };
    if (!r.starterChosen) return { ...base, reason: 'starter-pending' };
    // 원래 다섯 영웅은 캠페인 지역 끝을 넘기면 합류한다(HERO_CAMPAIGN_JOIN). 그 전에는 소환·상품으로도 얻는다.
    const join = HERO_CAMPAIGN_JOIN[id];
    // 진행이 이미 합류 관문을 지났으면 '합류 대기'(다음 관문 클리어 때 합류) — 곧 무료로 올 영웅에 결제하지 않게 화면이 결제를 닫는다.
    if (join) return { ...base, need: join, needLabel: stageLabelFromUnlocked(join, STAGES_PER_CHAPTER), reason: base.progress >= join ? 'campaign-pending' : 'campaign' };
    // 영웅은 소환으로 얻는다(BM 12장). 보석 해금 사다리(HERO_FREE_UNLOCK)는 초보자 배너·진행 소환권으로 대체해 닫았다.
    if (HERO_UNLOCK_VIA_GACHA) return { ...base, reason: 'gacha' };
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
  /**
   * 보석 직접 영입 견적(UI·서버 공통). HERO_DIRECT_PURCHASE.enabled 가 꺼져 있으면 항상 reason 'disabled'.
   * reason: disabled | unknown | owned | policy | starter-pending | unreleased | no-price | campaign-pending | paid-gems | null(영입 가능).
   * 유료 보석 전용(대표님 결정 2026-10-29): 무료 보석은 영입에 쓰지 않으므로 have 는 유료 보석 잔액(paidGems, 총 잔액 이하)이다.
   * campaign-pending = 진행이 이미 합류 관문을 지나 다음 클리어에 무료로 합류할 영웅(보석을 쓰지 않게 막는다, heroUnlockQuote 와 같은 규칙).
   */
  heroBuyQuote(id) {
    const s = this.s, r = s.roster, have = Math.max(0, Math.min(Math.floor(Number(s.paidGems) || 0), Math.floor(Number(s.gems) || 0))), base = { id, ok: false, price: 0, have, reason: null };
    if (!HERO_DIRECT_PURCHASE.enabled) return { ...base, reason: 'disabled' };
    if (typeof id !== 'string' || !Object.hasOwn(HEROES, id) || !s.heroes[id]) return { ...base, reason: 'unknown' };
    if (this.ownHero(id)) return { ...base, reason: 'owned' };
    // grantHero 와 같은 조건: 정책 1 이거나 시작 영웅을 고른 정책 2 만 소유를 늘릴 수 있다.
    if (!r || !Array.isArray(r.owned)) return { ...base, reason: 'policy' };
    if (r.policy === HERO_POLICY.STARTER && !r.starterChosen) return { ...base, reason: 'starter-pending' };
    if (r.policy !== HERO_POLICY.LEGACY && r.policy !== HERO_POLICY.STARTER) return { ...base, reason: 'policy' };
    if (!heroReleased(id, nowOf(this))) return { ...base, reason: 'unreleased' };
    const price = HERO_DIRECT_PURCHASE.prices[HEROES[id].rarity];
    if (!Number.isSafeInteger(price) || price <= 0) return { ...base, reason: 'no-price' };
    const join = HERO_CAMPAIGN_JOIN[id];
    if (join && (s.progress?.unlocked || 1) >= join) return { ...base, price, reason: 'campaign-pending' };
    if (have < price) return { ...base, price, reason: 'paid-gems' };
    return { ...base, price, ok: true };
  }
  /**
   * 보석 직접 영입: 아직 소유하지 않은 영웅을 보석으로 바로 연다. 보석 차감·소유 추가·시작 레벨/장비는 저장이 성공해야 확정(실패하면 전부 되돌린다).
   * 시작 레벨·장비는 캠페인 합류와 같은 규칙(_startCompanion). 나중에 캠페인 합류 관문에 닿아도 이미 소유라 grantCampaignHeroes 가 건너뛰므로
   * 중복 지급·레벨/경험치 덮어쓰기가 없다. 소비는 유료 보석만(gems 와 paidGems 를 같이 줄여 무료 몫은 그대로).
   * 최초 1회 기본 해금만 준다: 중복 조각·각성·별 재료는 주지 않는다(그것들은 소환에서만 나온다).
   * @param {string} id @returns {{ ok: boolean, reason?: string, id?: string, gems?: number }}
   */
  buyHero(id) {
    const q = this.heroBuyQuote(id);
    if (!q.ok) return { ok: false, reason: q.reason };
    const before = structuredClone(this.s), r = this.s.roster;
    this.s.gems -= q.price; this.s.paidGems -= q.price;   // 유료 몫만 차감(save 의 clampPaidGems 와 일관)
    r.owned = [...r.owned, id];
    this._startCompanion(id, Math.max(1, this.s.progress?.unlocked || 1));
    if (!this._commit(before)) return { ok: false, reason: 'storage' };
    return { ok: true, id, gems: q.price };
  }
  /**
   * 성장형 합류: 방금 클리어한 관문(clearedIdx)이 합류 관문 이상이면 그 영웅을 소유에 더한다(정책 2·시작 영웅 고른 뒤만).
   * 저장된 progress 가 아니라 이번에 실제로 깬 관문으로 판정한다: 가져오기·그림자 스냅샷이 부풀린 progress 만으로 영웅을
   * 받지 못하게 한다(독립 리뷰 P1). 진행이 이미 지난 이용자는 그 관문 이상을 다시 깰 때 한꺼번에 합류한다. 저장은 호출자가 한다.
   * @param {number} clearedIdx 이번에 클리어한 관문 번호(stageDef idx, 1부터)
   */
  grantCampaignHeroes(clearedIdx) {
    const r = this.s.roster, progress = Number.isSafeInteger(clearedIdx) ? clearedIdx + 1 : 0, joined = [];
    if (!r || r.policy !== HERO_POLICY.STARTER || !r.starterChosen || !Array.isArray(r.owned)) return joined;
    for (const [id, need] of Object.entries(HERO_CAMPAIGN_JOIN)) {
      if (progress < need || !this.s.heroes[id] || rosterOwns(r, id)) continue;
      r.owned = [...r.owned, id]; joined.push(id);
      this._startCompanion(id, Math.max(1, progress));
    }
    return joined;
  }
  /**
   * 합류·직접 영입 동료의 시작 상태(레벨·장비). 합류와 영입이 같은 규칙을 쓰므로 한곳에 둔다.
   * 레벨은 낮추지 않는다(미소유 상태로 보존된 레벨이 더 높으면 그대로). 이미 낀 장비 부위는 건드리지 않는다. 난수 없음. 저장은 호출자가 한다.
   * @param {string} id @param {number} nextIdx 다음에 도전할 관문 번호(진행 progress.unlocked)
   */
  _startCompanion(id, nextIdx) {
    // 합류 동료는 Lv1이 아니라 출전 영웅 레벨 −3(최소 다음 관문 권장 레벨)으로 온다. Lv1 마법사가 3-1에서 바로 쓰러져 합류가 보상이 되지 못했다.
    // 따라잡기 경험치 가속 대신 즉시 레벨을 고른 이유: 합류 직후 첫 출전이 바로 쓸 만해야 하고, 경험치 배율은 서버 정산 경험치를 바꾼다.
    const h = this.s.heroes[id], lead = this.s.heroes[this.s.selected]?.level || 1;
    const joinLevel = Math.max(1, lead - 3, recommendedLevel(Math.floor((nextIdx - 1) / 10) + 1, (nextIdx - 1) % 10 + 1));
    if ((h.level || 1) < joinLevel) { h.level = joinLevel; h.exp = 0; }
    this.grantCompanionKit(id, nextIdx);
  }
  /**
   * 합류 동료 시작 장비: 부위마다 에픽(E)·강화 0·il = 다음 관문의 드랍 장비 레벨 한 점씩, 그 영웅 소유로 만들어 바로 착용시킨다.
   * 맨몸으로 합류한 마법사가 3-1에서 전투력 0.67배로 쓰러졌다(가방은 영웅 소유라 동료 가방이 비어 있다). 난수 없음 —
   * 부위별 ITEM_POOL 의 첫 E 장비를 고정 규칙으로 고른다(장비에 무기 종류가 없다). 캠페인 합류에서만 부르고 서버 정산도 같은 completeStage 를 지난다.
   * 이미 낀 부위는 건드리지 않는다. 저장은 호출자가 한다.
   */
  grantCompanionKit(heroId, nextIdx) {
    const h = this.s.heroes[heroId]; if (!h) return [];
    const n = Math.max(1, nextIdx), il = dropItemLevel({ ch: Math.floor((n - 1) / STAGES_PER_CHAPTER) + 1, st: (n - 1) % STAGES_PER_CHAPTER + 1 });
    const given = [];
    for (const slot of SLOTS) {
      if (h.equip[slot]) continue;
      const def = ITEM_POOL[slot].find((x) => x.rarity === 'E'); if (!def) continue;
      const inst = this.pushItem(def.id, { owner: heroId, il }); h.equip[slot] = inst.uid; given.push(inst.uid);
    }
    return given;
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
    // 아바타 풀셋 효과: 착용(장비 외형 표시와 무관)한 영웅만. 이동속도·줍기 범위 편의만이라 전투력 계산에는 들어가지 않는다.
    b.avatar = avatarFullsetEffect(this.equippedAvatar(id));
    // 전설 수련 판(계정 공통): 공격·체력·방어·치명 몫은 모든 영웅에게 더한다. 키스톤 플래그는 b.legend.flags 로 전투가 읽는다.
    const leg = this.s.legend;
    if (leg && leg.rank > 0) {
      const ls = legendStats(leg);
      b.atkPct += ls.atkPct; b.hpPct += ls.hpPct; b.def += ls.def; b.crit += ls.crit; b.critDmg += ls.critDmg; b.ultGain += ls.ultGain;
      b.legend = { rank: ls.rank, flags: ls.flags, radiusPct: ls.radiusPct, vacuumPct: ls.vacuumPct, cdr: ls.cdr, speedPct: ls.speedPct, bossDmgPct: ls.bossDmgPct,
        regenPct: ls.regenPct, dodgeRecoverPct: ls.dodgeRecoverPct, openShieldPct: ls.openShieldPct, pickupPct: ls.pickupPct, dropPct: ls.dropPct, rarityPct: ls.rarityPct };
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
    const inst = this.pushItem(def.id); this.emit(); return { ok: true, inst };
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
  blessingRestore(held) { return Runes.blessingRestore(this, held); }
  addHeroExp(id, exp, { silent = false } = {}) {
    const h = this.hero(id), wasCap = h.level >= HERO_LEVEL_CAP; h.exp += exp; let ups = 0;
    while (h.exp >= levelExp(h.level) && h.level < HERO_LEVEL_CAP) { h.exp -= levelExp(h.level); h.level++; ups++; }
    // Lv.80 이후 EXP 는 영웅 레벨이 아니라 계정 공통 전설 수련으로 흘러간다(docs/SPEC_720H.md 3.1). 옛 저장의 80 레벨 잔여 EXP 는 받지 않는다.
    if (h.level >= HERO_LEVEL_CAP) { const over = wasCap ? exp : h.exp; h.exp = 0; if (over > 0) this.grantLegend(over); }
    if (!silent) this.emit();
    return ups;
  }
  /** 전설 수련 EXP 지급. 정산 트랜잭션 안에서만 부른다. 결과는 takeLegendGrant 로 영수증에 한 번 옮긴다. */
  grantLegend(exp) {
    this.s.legend = normalizeLegend(this.s.legend);
    const grant = grantLegendExp(this.s.legend, exp), prev = this._legendGrant;
    this._legendGrant = prev ? { ...grant, gained: prev.gained + grant.gained, ranks: prev.ranks + grant.ranks, keystones: [...prev.keystones, ...grant.keystones] } : grant;
    return grant;
  }
  takeLegendGrant() { const grant = this._legendGrant || null; this._legendGrant = null; return grant && grant.gained > 0 ? grant : null; }
  // ---------- 전설 수련 (규칙은 legend-rank.js) ----------
  legendState() { return this.s.legend = normalizeLegend(this.s.legend); }
  legendEffects() { return legendStats(this.legendState()); }
  legendRespecCost() { return legendRespecCost(this.legendState()); }
  /** 점수를 노드에 넣는다. 저장에 실패하면 되돌린다. */
  legendAllocate(nodeId, n = 1) {
    const before = structuredClone(this.s); this.legendState();
    const res = allocateLegendNode(this.s.legend, nodeId, n);
    if (!res.ok) return res;
    if (!this._commit(before)) return { ok: false, error: 'storage' };
    return res;
  }
  /** 점수 재분배(골드 비용). 골드가 부족하면 아무것도 바꾸지 않는다. */
  legendRespec() {
    const before = structuredClone(this.s); this.legendState();
    const res = respecLegendNodes(this.s.legend, this.s.gold);
    if (!res.ok) return res;
    this.s.gold -= res.cost;
    if (!this._commit(before)) return { ok: false, error: 'storage', cost: res.cost };
    return res;
  }
  /** 고통 단계 상태(최고 단계·오늘 판 수·풀 보상 남은 판). */
  tormentStatus() { this.s.endgame = normalizeEndgame(this.s.endgame); return tormentStatus(this.s.endgame, endgameNow(this)); }
  /** 미소유 영웅은 성장·장비·외형 명령을 모두 거절한다(미리 키워 두는 우회 차단). 로컬과 서버 /cmd가 같은 Economy 메서드를 부르므로 한 곳에서 막는다. */
  trainingQuote(id) { if (this.heroLocked(id)) return { ...heroTrainingQuote(null, 0), reason: 'locked' }; return heroTrainingQuote(this.s.heroes[id], this.s.gold); }
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
  promoteHero(id) { if (this.heroLocked(id)) return false; const h = this.hero(id); const need = starShards(h.star); if (h.shards < need || h.star >= 5) return false; h.shards -= need; h.star++; this.emit(); return true; }
  skillPoints(id) {
    const def = HEROES[id], h = this.hero(id);
    if (!def || !h) return { earned: 0, bonus: 0, spent: 0, available: 0 };
    return { earned: spBudget(h), bonus: spBonus(h), spent: spSpent(def, h.skills), available: spAvailable(def, h) };
  }
  learnSkill(id, i) {
    if (this.heroLocked(id)) return { ok: false, reason: 'locked' };
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
    if (this.heroLocked(id)) return { ok: false, reason: 'locked' };
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
    if (this.heroLocked(id)) return { ok: false, reason: 'locked' };
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
  setSkillLoadout(id, slot, skillIndex) { if (this.heroLocked(id)) return false; const h = this.hero(id), def = HEROES[id]; if (!h || !def || ![0,1].includes(slot) || !Number.isInteger(skillIndex) || skillIndex < 4 || skillIndex >= def.skills.length) return false; const sk = def.skills[skillIndex]; if (sk.unlock && h.level < sk.unlock) return false; if (!skillLearned(h.skills[skillIndex])) return false; const next = normalizeSkillLoadout(def, h.skillLoadout, h.skills, h.level); if (next[slot] === skillIndex) { if (next.every((v, k) => v === h.skillLoadout?.[k])) return false; h.skillLoadout = next; this.emit(); return true; } const other = 1 - slot; if (next[other] === skillIndex) [next[slot], next[other]] = [skillIndex, next[slot]]; else next[slot] = skillIndex; h.skillLoadout = next; this.emit(); return true; }
  /**
   * 가챠 영웅 지급. 첫 획득(소유 전)은 해금이며 조각을 주지 않는다. 이미 소유한 영웅은 조각 +dupShards(중복).
   * roster 가 없는 정책 1 저장은 모두 소유 상태라 항상 중복이다.
   */
  grantHero(id) {
    const h = this.s.heroes[id]; if (!h) return { dup: false, locked: true, shards: 0 };
    if (this.ownHero(id)) { h.shards += GACHA.dupShards; return { dup: true, locked: false, shards: GACHA.dupShards }; }
    const r = this.s.roster;
    // 정책 1 도 소환 전용 영웅(원래 다섯 밖)은 첫 획득이 해금이다.
    if (r && (r.policy === HERO_POLICY.LEGACY || (r.policy === HERO_POLICY.STARTER && r.starterChosen)) && Array.isArray(r.owned)) { r.owned = [...r.owned, id]; return { dup: false, locked: false, shards: 0, unlocked: true }; }
    // 시작 영웅을 고르기 전에는 해금하지 않고 조각만 쌓는다(선택 화면을 건너뛰지 않게).
    h.shards += GACHA.dupShards; return { dup: false, locked: true, shards: GACHA.dupShards };
  }
  // ---------- 장비 ----------
  /** @param {string} rarity @param {string|null} slot @param {number|null} [il] */
  addItem(rarity, slot = null, rng = rngOf(this), tp = 0, owner = this.gearOwnerDefault(), il = null) {
    slot = slot || SLOTS[Math.floor(rng() * SLOTS.length)];
    if (GACHA_ITEM_RARITY[rarity]) rarity = GACHA_ITEM_RARITY[rarity];   // 가챠 등급(R/SR/SSR) → 장비 등급
    const pool = ITEM_POOL[slot].filter((x) => x.rarity === rarity);
    const def = pool.length ? pool[Math.floor(rng() * pool.length)] : ITEM_POOL[slot][0];
    // tp: 고통 단계 장비 파워(드랍된 단계). 0 이면 필드를 두지 않아 기존 장비와 같은 모양이다.
    // il: 스테이지 장비 레벨(필드 드랍이 나온 스테이지의 권장 레벨). 0 이면 필드를 두지 않는다. 고통 단계(tp) 장비에는 붙이지 않는다.
    // 생략(null)하면 지금 진행 단계의 장비 레벨(가챠·제작·보상) — pushItem 참고.
    return this.pushItem(def.id, { tp, owner, il });
  }
  // ---------- 장비 귀속 · 금고 (docs/GEAR_OWNERSHIP_VAULT.md) ----------
  /** 새 장비의 주인: 진행 중인 전투 장부의 영웅, 없으면 지금 고른 영웅. */
  gearOwnerDefault() { const led = this._fieldRewards; return led && !led.settled && this.s.heroes[led.heroId] ? led.heroId : this.s.selected; }
  /** 장비 인스턴스 하나를 인벤토리에 넣는다(모든 획득 경로의 단일 형태). */
  /** @param {string} id @param {{ tp?: number, owner?: string, il?: number|null }} [opts] */
  pushItem(id, { tp = 0, owner = this.gearOwnerDefault(), il = null } = {}) {
    // il = 스테이지 장비 레벨(item-tier.js). 필드 드랍은 그 스테이지 값을 명시하고(0 이면 필드 없음), 생략한 경로(가챠·제작·상점·보상)는
    // 지금까지 깬 가장 깊은 관문의 장비 레벨을 받는다. 생략 경로가 il 없이 나오면 같은 진행의 필드 드랍 하위 등급이 유니크·레전드리를 이겼다(2026-10-29 신고).
    const lv = tp > 0 ? 0 : validItemLevel(il === null || il === undefined ? progressItemLevel(this.s.progress) : il);
    const inst = { uid: this.s.invSeq++, id, enh: 0, ...(tp > 0 ? { tp } : {}), ...(lv ? { il: lv } : {}), owner: owner === VAULT_OWNER || this.s.heroes[owner] ? owner : this.s.selected };
    this.s.inventory.push(inst);
    if (inst.owner !== VAULT_OWNER) recordGearDex(this.s, 'drop', inst.owner, id);   // 직접 얻은 장비만 드랍 도감에(일반 꺼내기·장착은 등재하지 않는다)
    return inst;
  }
  /** 그 영웅 소유 장비(가방에 보이는 것). */
  heroBag(heroId = this.s.selected) { return heroItems(this.s, heroId); }
  /** 금고 요약: 칸·사용·확장 비용·오늘 남은 유료 꺼내기. */
  vaultState() {
    const v = this.s.vault = normalizeVault(this.s.vault), items = vaultItems(this.s), day = vaultDay(v, nowOf(this));
    return { items, used: items.length, slots: vaultSlots(v), expansions: v.expansions, maxExpansions: VAULT.maxExpansions,
      expandGold: v.expansions >= VAULT.maxExpansions ? null : expandGold(v), dailyLeft: Math.max(0, VAULT.dailyPaidWithdrawals - day.used), dailyMax: VAULT.dailyPaidWithdrawals };
  }
  vaultWithdrawQuote(uid, heroId = this.s.selected) { return withdrawQuote(this.s, uid, heroId, nowOf(this), { ownsHero: (id) => this.ownHero(id) }); }
  /** 영웅 → 금고. 무료, 장착 중이면 해제. 금고가 가득 차면 거부. */
  vaultDeposit(uid) {
    const inst = this.s.inventory.find((x) => x.uid === uid);
    if (!inst || !ITEM_BY_ID[inst.id] || inst.owner === VAULT_OWNER) return { ok: false, reason: 'item' };
    const v = this.vaultState(); if (v.used >= v.slots) return { ok: false, reason: 'full' };
    const from = this.s.heroes[inst.owner] ? inst.owner : this.s.selected;
    for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; }
    inst.owner = VAULT_OWNER; inst.from = from;
    this.emit(); return { ok: true, from };
  }
  /** 금고 → 영웅. 맡긴 영웅·같은 계열·공유 시절 장비는 무료, 그 밖에는 골드와 하루 유료 횟수. */
  vaultWithdraw(uid, heroId = this.s.selected) {
    const q = this.vaultWithdrawQuote(uid, heroId); if (!q.ok) return { ok: false, reason: q.reason, gold: q.gold };
    const inst = this.s.inventory.find((x) => x.uid === uid);
    this.s.gold -= q.gold;
    if (!q.free) this.s.vault = { ...normalizeVault(this.s.vault), day: q.daily.day, used: q.daily.used + 1 };
    inst.owner = heroId; delete inst.from; delete inst.legacy;
    this.emit(); return { ok: true, gold: q.gold, free: q.free, heroId };
  }
  vaultRitualQuote(uid, heroId) { return ritualQuote(this.s, uid, heroId, nowOf(this), { ownsHero: (id) => this.ownHero(id) }); }
  /** 계승 의식(docs/GEAR_VAULT_INHERIT.md 3.4): 금고 장비를 소유 영웅에게. 골드+계승 문장, 하루 2회(일반 꺼내기와 별도), 확정. */
  vaultRitual(uid, heroId) {
    const q = this.vaultRitualQuote(uid, heroId); if (!q.ok) return { ok: false, reason: q.reason, gold: q.gold, sigil: q.sigil };
    const inst = this.s.inventory.find((x) => x.uid === uid);
    const before = { gold: this.s.gold, sigil: this.s.lineageSigil, vault: this.s.vault, inst: { ...inst }, dex: this.s.gearDex === undefined ? undefined : structuredClone(this.s.gearDex) };
    try {
      const from = inst.from, hops = Math.min(VAULT_INHERIT.hopsMax, (inst.hops || 0) + 1);
      this.s.gold -= q.gold;
      const left = (this.s.lineageSigil || 0) - q.sigil;
      if (left > 0) this.s.lineageSigil = left; else delete this.s.lineageSigil;
      this.s.vault = { ...normalizeVault(this.s.vault), rday: q.daily.day, rused: q.daily.used + 1 };
      inst.owner = heroId; delete inst.from; delete inst.legacy;
      inst.hops = hops;
      recordGearDex(this.s, 'kin', heroId, inst.id);
      const lin = [...(inst.lin || []), ...(from ? [from] : [])].slice(-Math.min(hops, VAULT_INHERIT.linMax));  // hops>=1 이라 keep>=1
      if (lin.length) inst.lin = lin; else delete inst.lin;
    } catch (e) {
      this.s.gold = before.gold; this.s.vault = before.vault;
      if (before.sigil === undefined) delete this.s.lineageSigil; else this.s.lineageSigil = before.sigil;
      if (before.dex === undefined) delete this.s.gearDex; else this.s.gearDex = before.dex;
      for (const k of Object.keys(inst)) delete inst[k]; Object.assign(inst, before.inst);
      return { ok: false, reason: 'error', gold: q.gold, sigil: q.sigil };
    }
    this.emit(); return { ok: true, gold: q.gold, sigil: q.sigil, heroId, hops: inst.hops };
  }
  /**
   * vaultRelay(docs/GEAR_VAULT_INHERIT.md 4.5): heroId 가 계승 의식으로 받은 장비(hops>=1)를 끼고 이겼으면, 오늘 아직 안 센 장비 하나를 세고 `vaultRelay` 임무 카운터를 올린다.
   * 같은 uid 는 하루 1회(왕복 이동·재장착으로 오르지 않는다). 서버 정산(applySettlement → completeStage)에서만 불리고 클라이언트 보고 값은 쓰지 않는다.
   */
  recordVaultRelay(heroId) {
    const at = nowOf(this), today = relayToday(this.s.vault, at), equip = Object.values(this.hero(heroId)?.equip || {});
    const inst = equip.map((uid) => this.s.inventory.find((x) => x.uid === uid)).find((x) => x && x.owner === heroId && (x.hops || 0) >= 1 && !today.uids.includes(x.uid));
    if (!inst) return false;
    if (!this.recordJourneyAction('vaultRelay').ok) return false;
    this.s.vault = { ...normalizeVault(this.s.vault), rl: { day: today.day, uids: [...today.uids, inst.uid].slice(-VAULT_INHERIT.relayUidsMax) } };
    return true;
  }
  /**
   * 일일·주간 의뢰의 계승 문장 보상(서버 명령). 의뢰 달성은 로컬 여정 기록이 정본이라 서버가 검증할 수 없으므로,
   * 서버는 (종류, 의뢰, 서버 기준 기간)당 한 번만 의뢰 표의 문장 수만큼 지급해 상한을 지킨다(재수령·반복 지급 차단).
   * 클라이언트는 같은 메서드를 불러 서버와 잔액이 같게 한다. 골드·강화석 등 나머지 의뢰 보상은 기존 로컬 경로 그대로.
   */
  claimJourneySigil(kind, id) {
    const list = kind === 'daily' ? DAILY_CONTRACTS : kind === 'weekly' ? WEEKLY_CONTRACTS : null;
    const def = list?.find((c) => c.id === id);
    if (!def) return { ok: false, reason: 'unknown' };
    const sigil = Number(def.rewards?.lineageSigil) || 0;
    if (!(sigil > 0)) return { ok: false, reason: 'unknown' };
    const p = periodAt(endgameNow(this)), no = kind === 'daily' ? p.day : p.week, key = kind + ':' + id + ':' + no;
    const keep = (Array.isArray(this.s.sigilClaims) ? this.s.sigilClaims : []).filter((k) => typeof k === 'string' && k.endsWith(':' + (k.startsWith('daily:') ? p.day : p.week)) && (k.startsWith('daily:') || k.startsWith('weekly:')));
    if (keep.includes(key)) return { ok: false, reason: 'claimed' };
    keep.push(key); this.s.sigilClaims = keep.slice(-16);
    this.s.lineageSigil = (this.s.lineageSigil || 0) + sigil;
    this.emit(); return { ok: true, sigil };
  }
  /** 도감 마일스톤 수령(중복 수령 불가, 달성은 gearDex 로 재계산). 보상 수치는 gear-dex.js 표. */
  gearDexClaim(heroId, milestoneId) {
    const m = milestoneOf(milestoneId);
    if (!m) return { ok: false, reason: 'milestone' };
    if (!this.ownHero(heroId)) return { ok: false, reason: 'hero' };
    if (milestoneClaimed(this.s, heroId, milestoneId)) return { ok: false, reason: 'claimed' };
    if (!milestoneReached(this.s, heroId, milestoneId)) return { ok: false, reason: 'locked' };
    const dex = this.s.gearDex; (dex.claimed[heroId] ||= []).push(milestoneId);
    const got = this.addRewards({ ...m.rewards }, { silent: true, applyVip: false });
    this.emit(); return { ok: true, got };
  }
  /** 금고 칸 확장(골드). */
  vaultExpand() {
    const v = normalizeVault(this.s.vault); if (v.expansions >= VAULT.maxExpansions) return { ok: false, reason: 'max' };
    const gold = expandGold(v); if (this.s.gold < gold) return { ok: false, reason: 'gold', gold };
    this.s.gold -= gold; this.s.vault = { ...v, expansions: v.expansions + 1 };
    this.emit(); return { ok: true, gold, slots: vaultSlots(this.s.vault) };
  }
  equip(heroId, uid) { if (this.heroLocked(heroId)) return false; const inst = this.s.inventory.find((x) => x.uid === uid); if (!inst) return; if ((inst.owner ?? this.s.selected) !== heroId) return false; const slot = ITEM_BY_ID[inst.id].slot; for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; if (e[slot] === uid) e[slot] = null; } this.hero(heroId).equip[slot] = uid; this.emit(); }
  unequip(heroId, slot) { if (this.heroLocked(heroId)) return false; this.hero(heroId).equip[slot] = null; this.emit(); }
  /** 강화 견적(읽기 전용): 일반 비용·강화석과 확정 강화 웃돈(범위 밖이면 null). UI·성장 안내·서버가 같은 값을 쓴다. */
  enhanceQuote(uid) {
    const inst = this.s.inventory.find((x) => x.uid === uid); if (!inst || inst.enh >= ENH_MAX) return null;
    const lv = inst.enh, tier = enhanceStoneTier(lv);
    return { lv, gold: enhanceCost(lv), stones: enhanceStones(lv), tier, stoneKey: STONE_KEY[tier], chance: enhanceChance(lv), sureGold: enhanceSureCost(lv) };
  }
  /** 강화: +3까지 100%, +4부터 확률이 단계마다 떨어지고 +10부터 하락·+12부터 파괴(items.js ENHANCE_CHANCE). protect=보호주문서(파괴 방지), bless=축복(성공률 +20%),
   *  sure=확정 강화(골드 웃돈 enhanceSureCost, +3 → +11 구간만, 축복과 같이 쓰지 않음). 서버 /cmd enhance 가 같은 메서드를 부른다(성공이 확정이라 난수 결과와 무관). */
  enhance(uid, { protect = false, bless = false, sure = false } = {}) {
    const inst = this.s.inventory.find((x) => x.uid === uid); if (!inst || inst.enh >= ENH_MAX) return { ok: false, reason: 'max' };
    const lv = inst.enh; const cost = enhanceCost(lv), stones = enhanceStones(lv);
    const sureGold = sure ? enhanceSureCost(lv) : 0;   // 결과에 늘 싣는다(0 = 확정 강화 안 씀)
    if (sure && sureGold === null) return { ok: false, reason: 'sure' };
    if (sure && (bless || protect)) return { ok: false, reason: 'stack' };   // 확정이면 축복·보호 주문서가 쓸모없이 차감된다
    if (this.s.gold < cost + sureGold) return { ok: false, reason: 'gold' };
    const sk = STONE_KEY[enhanceStoneTier(lv)];
    if ((this.s[sk] || 0) < stones) return { ok: false, reason: 'stones', tier: enhanceStoneTier(lv) };
    if (protect && this.s.protect <= 0) return { ok: false, reason: 'protect' };
    if (bless && this.s.bless <= 0) return { ok: false, reason: 'bless' };
    this.s.gold -= cost + sureGold; this.s[sk] -= stones; if (protect) this.s.protect--; if (bless) this.s.bless--;
    // 확정 강화도 난수 하나를 똑같이 뽑는다(서버·클라이언트 난수 소비 순서를 일반 강화와 같게 유지).
    let chance = sure ? 1 : enhanceChance(lv) + (bless ? 0.2 : 0); const roll = rngOf(this)(); const success = sure || roll < chance;
    let destroyed = false, down = 0;
    if (success) inst.enh++;
    else {
      if (!protect && rngOf(this)() < destroyChance(lv)) { destroyed = true; Runes.recoverItemRunes(this, inst, 'destroy'); this.s.inventory.splice(this.s.inventory.indexOf(inst), 1); for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; } }
      else if (enhanceDown(lv)) { down = enhanceDown(lv); inst.enh -= down; }
    }
    this.s.quests.enh = (this.s.quests.enh || 0) + 1;
    this.recordJourneyAction('upgrades');
    this.emit(); return { ok: true, success, destroyed, down, enh: destroyed ? lv : inst.enh, chance, sureGold };
  }
  /** 강화 전승 견적(읽기 전용). 규칙·비용은 data/enhance-transfer.js. UI 미리보기와 서버가 같은 값을 쓴다. */
  enhanceTransferQuote(srcUid, dstUid, { scroll = false } = {}) { return transferQuote(this, srcUid, dstUid, { scroll }); }
  /** 강화 전승: 원본의 강화 단계를 같은 부위·같은 주인의 다른 장비로 옮긴다. 대상 = 원본 − 1(전승 보호 주문서면 손실 없음), 원본은 +0.
   *  골드·강화석·(선택)주문서만 차감한다. 원본이 착용 중이면 대상이 그 자리를 이어 낀다. 룬·내구도·il·tp 는 각 장비에 남는다. 난수 없음.
   *  서버 /cmd enhanceTransfer 가 같은 메서드를 부른다. */
  enhanceTransfer(srcUid, dstUid, { scroll = false } = {}) {
    const q = transferQuote(this, srcUid, dstUid, { scroll });
    if (!q.ok) return { ok: false, reason: q.reason, gold: q.gold, stones: q.stones, stoneKey: q.stoneKey };
    const src = this.s.inventory.find((x) => x.uid === srcUid), dst = this.s.inventory.find((x) => x.uid === dstUid);
    this.s.gold -= q.gold; this.s[q.stoneKey] -= q.stones; if (scroll) this.s.transferScroll--;
    const prevTarget = q.targetEnh;
    dst.enh = q.to; src.enh = 0;
    if (q.swapEquip) this.s.heroes[src.owner ?? this.s.selected].equip[ITEM_BY_ID[dst.id].slot] = dstUid;
    // 강화 시도 임무(quests.enh)는 세지 않는다: 전승은 강화 시도가 아니고, 서버 문서도 이 명령으로 임무 수치를 바꾸지 않게 둔다.
    this.emit();
    return { ok: true, from: q.from, to: q.to, loss: q.loss, prevTarget, gold: q.gold, stones: q.stones, stoneKey: q.stoneKey, scroll: q.scroll, equipped: q.swapEquip };
  }
  sellItem(uid) { const i = this.s.inventory.findIndex((x) => x.uid === uid); if (i < 0) return; const inst = this.s.inventory[i]; const r = ITEM_BY_ID[inst.id].rarity; const gold = RARITY_INFO[r]?.sell || 200; for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; } Runes.recoverItemRunes(this, inst, 'sell'); this.s.inventory.splice(i, 1); this.s.gold += gold; this.emit(); return gold; }
  isUpgrade(heroId, inst) {
    const h = this.hero(heroId), item = ITEM_BY_ID[inst?.id];
    if (!h || !item || h.equip[item.slot] === inst.uid) return false;
    if (inst.owner && inst.owner !== heroId) return false; // 다른 영웅·금고 장비는 이 영웅의 강화 후보가 아니다
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
  fieldDrop(rarity) {
    // 지금 도는 고통 단계 판의 장비는 그 단계의 파워 배율을 달고 나온다(docs/SPEC_720H.md 7절).
    const led = this._fieldRewards, tp = led && !led.settled ? tormentTierOf(led.stage?.difficultyId) : 0;
    const it = this.addItem(rarity, null, rngOf(this), tp, this.gearOwnerDefault(), dropItemLevel(led && !led.settled ? led.stage : null)); this.save(); return it;
  }
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
  /** 고통 단계 감쇠: 영웅 조각·초월석·지역 재료를 mul 배로(작은 수는 기댓값이 같도록 확률 올림). 원본 장부는 바꾸지 않는다. */
  decayedExtras(field, mul) {
    const rng = rngOf(this), part = (n) => { const q = (Number.isSafeInteger(n) && n > 0 ? n : 0) * mul, base = Math.floor(q); return base + (rng() < q - base ? 1 : 0); };
    return { ...field, heroShards: part(field.heroShards), transcendStones: part(field.transcendStones),
      materials: Object.fromEntries(Object.entries(field.materials || {}).map(([key, n]) => [key, part(n)])) };
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
    // 지역 끝을 넘기면 이야기 속 동료가 합류한다(성장형 영웅 해금).
    const heroJoin = this.grantCampaignHeroes(stage.idx);
    // 난이도 최고 기록(지옥 해금)과 숙련 이상 승리 임무. 시즌 이벤트는 완료 보상(골드·EXP·강화석)에만 붙는다(서버 정산도 같은 시계).
    s.endgame = normalizeEndgame(s.endgame);
    const difficultyId = stage.difficultyId || 'story';
    recordDifficultyClear(s.endgame, stage.ch, stage.st, difficultyId);
    if (difficultyId !== 'story') this.recordJourneyAction('hardClears');
    this.recordVaultRelay(heroId);   // 받은(계승 의식) 장비를 끼고 이긴 판: 같은 uid 하루 1회
    // 고통 단계(에너지 0): 하루 첫 fullRuns 판은 보상 100%, 그 뒤는 골드·재료 decayMul 이고 EXP 는 100%. 판 수는 이 트랜잭션 안에서 센다.
    // 전설 수련 약탈 갈래는 골드·강화석·조각 몫을 더한다(서버 정산도 이 함수를 지나 같은 값이다).
    const tormentTier = tormentTierOf(difficultyId);
    const tormentRun = tormentTier ? recordTormentRun(s.endgame, { tier: tormentTier, st: stage.st, nowMs: endgameNow(this) }) : null;
    const decay = tormentRun && !tormentRun.full ? TORMENT.decayMul : 1;
    const leg = s.legend && s.legend.rank > 0 ? legendStats(s.legend) : null;
    const mulGold = decay * (1 + (leg?.goldPct || 0)), mulStone = decay * (1 + (leg?.stonePct || 0)), mulFrag = decay * (1 + (leg?.fragmentPct || 0));
    const scaled = (n, mul) => mul === 1 ? n : Math.floor(n * mul);
    const m = double ? 2 : 1; const r = applyEventRewards(stage.rewards, activeEvents(endgameNow(this)), 'campaign'); const loot = [];
    r.gold = scaled(r.gold, mulGold); r.stones = scaled(r.stones || 0, mulStone);
    fieldGold = scaled(fieldGold, mulGold); fieldStones = scaled(fieldStones, mulStone); fieldStones2 = scaled(fieldStones2, mulStone); fieldStones3 = scaled(fieldStones3, mulStone); fieldFragments = scaled(fieldFragments, mulFrag);
    const fullClearBonus = fullClear ? { exp: Math.floor(r.exp * 0.5), gold: Math.floor(r.gold * 0.4), fragments: scaled(10, mulFrag), eliteGear: 1 } : null;
    // 필드 드랍(전투 중 획득한 골드/강화석)은 여기서 정산. 장비는 이미 인벤토리에 들어감.
    const milestone = first && stage.st % 5 === 0 ? { tickets: stage.st % 10 === 0 ? 2 : 1 } : {};
    const got = this.addRewards({ gold: r.gold * m + fieldGold * m + (fullClearBonus?.gold || 0), gems: first ? r.firstGems : 0, stones: (r.stones || 0) * m + fieldStones, stones2: fieldStones2 * m, stones3: fieldStones3 * m, fragments: fieldFragments * m + (stage.boss ? scaled(5, mulFrag) : 0) + (fullClearBonus?.fragments || 0), ...milestone }, { silent: true });
    for (const l of fieldLoot) loot.push(l);
    if (fullClearBonus) loot.push(this.addItem(pickWeighted(RARITY_WEIGHT_ELITE, rngOf(this)), null, rngOf(this), tormentTier, heroId, dropItemLevel(stage)));
    if (double && rngOf(this)() < r.dropChance) { loot.push(this.addItem(pickWeighted(RARITY_WEIGHT_STAGE, rngOf(this)), null, rngOf(this), tormentTier, heroId, dropItemLevel(stage))); }
    if (stage.boss && rngOf(this)() < 0.3) { s.tickets += 1; got.push({ k: 'tickets', n: 1 }); }
    // 초월석·영웅 조각·지역 재료는 전투 중 서비스가 쌓은 장부만 믿는다. 장부가 없으면 호출 인자로 새 재화를 주지 않는다(리뷰 P2).
    if (ledger) got.push(...this.applyFieldExtras(decay < 1 ? this.decayedExtras(ledger, decay) : ledger, heroId), ...this.settleRuneDrops(ledger, { hell: difficultyId === 'hell' || !!tormentTier, first }));
    // 고통 단계 새 최고 기록이 5의 배수면 계승 문장(콘텐츠 보상, 한 단계에 한 번만 — 최고 단계는 앞으로만 오른다).
    if (tormentRun?.newBest && tormentRun.best % VAULT_INHERIT.tormentEvery === 0) got.push(...this.addRewards({ lineageSigil: VAULT_INHERIT.tormentSigil }, { silent: true, applyVip: false }));
    const prevLv = this.hero(heroId).level;
    // 고통 단계는 처치 EXP 도 단계마다 늘어난다(지옥 × (expBase + expStep×n)). EXP 는 판 수 감쇠를 받지 않는다.
    const combatBase = ledger?.exp ?? (Number.isSafeInteger(fieldExp) && fieldExp > 0 ? Math.min(fieldExp, 100000000) : 0);
    const combatExp = Math.min(100000000, Math.floor(combatBase * (stage.campaignDifficulty?.combatExpMul || 1)));
    const stageExp = Math.floor((r.exp * m + (fullClearBonus?.exp || 0)) * levelExperienceMultiplier(prevLv, stageRecommendedLevel(stage, prevLv)));
    const ups = this.addHeroExp(heroId, stageExp + combatExp, { silent: true });
    const nowLv = this.hero(heroId).level;
    if (ledger) ledger.settled = true;
    // 이번 판에 넘긴 각성 구간
    const awakened = (HEROES[heroId].skills || []).filter((k) => k.unlock && prevLv < k.unlock && nowLv >= k.unlock);
    const passUps = this.addPassXp(r.bp);
    s.quests.stages++; const saved = this.emit();
    const receipt = { got, loot, ups, passUps, first, exp: stageExp, combatExp, totalExp: stageExp + combatExp, heroId, awakened, fullClearBonus, regionUnlock, heroJoin,
      torment: tormentRun ? { tier: tormentTier, full: tormentRun.full, runs: tormentRun.runs, best: tormentRun.best, newBest: tormentRun.newBest, fullLeft: Math.max(0, TORMENT.fullRuns - tormentRun.runs) } : null,
      legend: this.takeLegendGrant(), ok: saved, saveError: !saved };
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
  sweep(stage) { const s = this.s; if (tormentTierOf(stage?.difficultyId) || s.sweep <= 0 || (s.progress.stars[this.stageKey(stage.ch, stage.st)] || 0) < 3) return null; if (!this.spendEnergy(stage.energy)) return null; s.sweep--; return this.completeStage(stage, 3); }
  // ---------- 가챠 ----------
  /** 배너 상태(천장·픽업 확정·초보자 사용 횟수). 저장 정화(save-base)와 같은 모양. */
  gachaState() {
    const g = this.s.gacha || (this.s.gacha = { pity: 0 });
    g.pity ??= 0; g.guarantee ??= false; g.gearPity ??= 0; g.gearGuarantee ??= false; g.beginner ??= 0; g.beginnerSsr ??= false; g.mileage ??= 0;
    return g;
  }
  /** 배너의 남은 초보자 횟수(초보자 배너만 의미). */
  beginnerLeft() { return Math.max(0, GACHA_BANNERS.beginner.limit - (this.gachaState().beginner || 0)); }
  /** 소환 견적(UI·서버 공통): 재화·횟수 조건. reason: invalid-count | invalid-banner | beginner-used | insufficient-funds | null */
  /** @param {number} n @param {string} [bannerId] @returns {any} */
  pullQuote(n, bannerId = 'hero') {
    const banner = Object.hasOwn(GACHA_BANNERS, bannerId) ? GACHA_BANNERS[bannerId] : null;
    if (!banner) return { ok: false, reason: 'invalid-banner' };
    if (n !== 1 && n !== 10) return { ok: false, reason: 'invalid-count' };
    if (banner.id === 'beginner' && n !== 10) return { ok: false, reason: 'invalid-count' };
    if (banner.id === 'beginner' && this.beginnerLeft() < n) return { ok: false, reason: 'beginner-used' };
    const s = this.s, cost = n === 10 ? banner.ten : banner.single, tickets = n === 10 ? 10 : 1;
    // 초보자는 반값이라 보석이 있으면 보석을 먼저 쓴다(소환권 10장 = 정가 2,700 가치). 나머지 배너는 소환권 먼저.
    if (banner.id === 'beginner' && s.gems >= cost) return { ok: true, reason: null, banner, currency: 'gems', tickets: 0, cost };
    if (s.tickets >= tickets) return { ok: true, reason: null, banner, currency: 'tickets', tickets, cost: 0 };
    if (s.gems >= cost) return { ok: true, reason: null, banner, currency: 'gems', tickets: 0, cost };
    return { ok: false, reason: 'insufficient-funds', banner, need: cost - s.gems, cost };
  }
  /**
   * 소환. 결과·천장·재화는 저장이 성공해야 확정된다(실패하면 전부 되돌린다).
   * @param {number} n 1 또는 10 @param {string} [bannerId] hero | gear | beginner
   */
  pull(n, bannerId = 'hero') {
    this.lastGachaError = null;
    const q = this.pullQuote(n, bannerId);
    if (!q.ok) { this.lastGachaError = q.reason; return null; }
    const before = structuredClone(this.s), s = this.s, banner = q.banner, g = this.gachaState();
    if (q.currency === 'tickets') s.tickets -= q.tickets; else spendGems(s, q.cost);
    const now = nowOf(this), featured = bannerPickup(banner.id, now);
    const results = []; let srGuaranteed = false; const rng = this.gachaRng;
    for (let i = 0; i < n; i++) {
      s.totalPulls++; s.quests.pulls++;
      let rar;
      if (banner.id === 'beginner') {
        g.beginner++;
        // 계정당 limit번째까지 SSR이 없으면 마지막 회차는 SSR 확정(g.beginnerSsr로 이미 나왔는지 기억).
        rar = !g.beginnerSsr && g.beginner >= banner.limit ? 'SSR' : rollGachaRarity(1, rng, banner);
      } else {
        const key = banner.id === 'gear' ? 'gearPity' : 'pity';
        g[key]++; rar = rollGachaRarity(g[key], rng, banner);
        if (banner.id === GACHA_MILEAGE.banner) g.mileage += GACHA_MILEAGE.perPull;
      }
      // 초보자 10회의 마지막 칸은 아직 없는 SR 영웅이 있으면 그 영웅 확정(SSR이 나온 칸은 그대로). 2번이면 SR 로스터가 첫날 거의 찬다.
      const freshSr = banner.id === 'beginner' && n === 10 && i === 9 && rar !== 'SSR' && heroesOf('SR', now).some((id) => !this.ownHero(id));
      if (freshSr) rar = 'SR';
      if (n === 10 && i === 9 && !srGuaranteed && rar === 'R') rar = 'SR';
      if (rar !== 'R') srGuaranteed = true;
      if (rar === 'SSR') { if (banner.id === 'gear') g.gearPity = 0; else if (banner.id === 'hero') g.pity = 0; else g.beginnerSsr = true; }
      results.push(this.rollResult(rar, { banner, featured, freshSr, now }));
    }
    s.pity = g.pity; // 기존 UI가 읽는 레거시 미러
    this.recordJourneyAction('pulls', n);
    if (!this.save()) { this.s = before; this.lastGachaError = 'storage'; return null; }
    for (const listener of this.listeners) listener(this.s);
    return results;
  }
  /** 마일리지 교환 견적. reason: points | no-pickup | null */
  mileageQuote() {
    const g = this.gachaState(), id = heroPickup(nowOf(this)), have = g.mileage || 0;
    const base = { id, have, cost: GACHA_MILEAGE.cost, ok: false, reason: null };
    if (!validSsrHero(id, nowOf(this))) return { ...base, reason: 'no-pickup' };
    if (have < GACHA_MILEAGE.cost) return { ...base, reason: 'points' };
    return { ...base, ok: true };
  }
  /** 마일리지로 지금 픽업 SSR 영웅을 받는다(첫 획득은 해금, 중복은 조각). 저장 실패면 되돌린다. */
  exchangeMileage() {
    this.lastGachaError = null;
    const q = this.mileageQuote(); if (!q.ok) { this.lastGachaError = q.reason; return null; }
    const before = structuredClone(this.s), g = this.gachaState();
    g.mileage -= GACHA_MILEAGE.cost;
    const got = this.grantHero(q.id);
    const r = { type: 'hero', rar: 'SSR', id: q.id, dup: got.dup, ...(got.locked ? { locked: true } : {}), ...(got.unlocked ? { unlocked: true } : {}), shards: got.shards, name: HEROES[q.id].name, img: HEROES[q.id].portrait, featured: true, mileage: true };
    if (!this.save()) { this.s = before; this.lastGachaError = 'storage'; return null; }
    for (const listener of this.listeners) listener(this.s);
    return [r];
  }
  /** SSR 확정 소환권: 영웅 배너 SSR 영웅 중 균등(픽업 확정 아님, 천장·픽업 확정에 영향 없음). */
  pullSSR() {
    this.lastGachaError = null;
    const before = structuredClone(this.s), s = this.s; if (s.ssrTickets <= 0) { this.lastGachaError = 'no-ssr-ticket'; return null; }
    s.ssrTickets--; const r = this.rollResult('SSR', { banner: GACHA_BANNERS.beginner, featured: null, now: nowOf(this) }); this.recordJourneyAction('pulls');
    if (!this.save()) { this.s = before; this.lastGachaError = 'storage'; return null; }
    for (const listener of this.listeners) listener(this.s);
    return [r];
  }
  /**
   * 등급이 정해진 한 칸의 결과. 분배는 배너 표(gacha-banners.js)와 gachaRates()가 같은 값이다.
   * 픽업 배너의 SSR은 50:50이며, 픽업이 아니면 같은 배너의 다음 SSR은 픽업 확정이다.
   * @param {string} rar @param {{ banner?: any, featured?: string|null, freshSr?: boolean }} [opts] freshSr: 미보유 SR 영웅 확정(초보자 10회 마지막 칸)
   */
  rollResult(rar, { banner = GACHA_BANNERS.hero, now = nowOf(this), featured = bannerPickup(banner.id, now), freshSr = false } = {}) {
    const rng = this.gachaRng, g = this.gachaState(), pick = (list) => list[Math.floor(rng() * list.length)];
    const hero = (id, extra = {}) => { const got = this.grantHero(id); return { type: 'hero', rar, id, dup: got.dup, ...(got.locked ? { locked: true } : {}), ...(got.unlocked ? { unlocked: true } : {}), shards: got.shards, name: HEROES[id].name, img: HEROES[id].portrait, ...extra }; };
    const item = (def, extra = {}) => { const inst = this.pushItem(def.id, { owner: this.s.selected }); return { type: 'item', rar, item: inst, ...extra }; };
    const split = rar === 'SSR' ? banner.ssr : rar === 'SR' ? banner.sr : banner.r;
    if (rar === 'SSR' && split.hero) {
      const others = otherSsrHeroes(featured, now);
      if (!banner.ssr.featured || !featured) return hero(pick(heroesOf('SSR', now)));
      const key = 'guarantee', win = g[key] || !others.length || rng() < banner.ssr.featured;
      g[key] = !win;
      return win ? hero(featured, { featured: true }) : hero(pick(others));
    }
    if (rar === 'SSR' && split.gear) {
      const pool = ssrGearPool(), inSet = featured ? pool.filter((x) => x.set === featured) : [], rest = pool.filter((x) => !inSet.includes(x));
      if (!inSet.length) return item(pick(pool));
      const win = g.gearGuarantee || !rest.length || rng() < banner.ssr.featured;
      g.gearGuarantee = !win;
      return win ? item(pick(inSet), { featured: true }) : item(pick(rest));
    }
    if (freshSr) { const fresh = heroesOf('SR', now).filter((id) => !this.ownHero(id)); if (fresh.length) return hero(pick(fresh)); }
    const r = rng(), heroShare = split.hero || 0, gearShare = split.gear || 0;
    if (r < heroShare) {
      // 초보자 배너의 SR 영웅은 아직 없는 영웅을 먼저 준다(첫 주 안에 SR 로스터를 채우는 온보딩 규칙, 문서 12.2).
      const all = heroesOf(rar, now), fresh = banner.id === 'beginner' ? all.filter((id) => !this.ownHero(id)) : [];
      return hero(pick(fresh.length ? fresh : all));
    }
    if (r < heroShare + gearShare) return { type: 'item', rar, item: this.addItem(rar, null, rng) };
    return this.rollMaterial(rar, r, heroShare + gearShare, bannerMaterials(banner));
  }
  /** 강화 재료 결과. r은 이미 뽑은 [from, 1) 구간의 값이며 재료 목록의 누적 비율로 고른다. */
  rollMaterial(rar, r, from, table = GACHA.materials) {
    const list = table[rar] || [];
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
      // 결제 지급 보석은 유료 몫이다(환불·청약철회 역분개 대상). 무료 보너스는 카탈로그 grant 에 없다.
      if (rewards.gems > 0) s.paidGems = (s.paidGems || 0) + rewards.gems;
      const product = typeof g.productId === 'string' && Object.hasOwn(IAP_BY_ID, g.productId) ? IAP_BY_ID[g.productId] : null;
      if (product?.once && product.shopSku && !s.purchases.includes(product.shopSku)) s.purchases.push(product.shopSku);
    }
    for (const r of Array.isArray(state?.reversals) ? state.reversals : []) {
      if (!validOpId(r?.opId) || applied.has(r.opId)) continue;
      applied.add(r.opId); s.iapApplied.push(r.opId); changed = true;
      for (const [k, n] of Object.entries(iapRewards(r.rewards))) {
        const f = IAP_REWARD_FIELD[k]; if (!f) continue;
        if (k === 'gems') s.paidGems = Math.max(0, (s.paidGems || 0) - n);
        s[f] = Math.max(0, (s[f] || 0) - n);
      }
      clampPaidGems(s);
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
  /**
   * 유료 풀셋 상품(avatar_fullset_<heroId>_v1) 지급 계약. BM 레인의 결제 확인 뒤 이 함수만 부른다.
   * 반환 { ok, avatarId, already }. already 면 이미 소유(중복 지급 없음, 보상 처리는 BM 레인 몫).
   * paidBy(결제 지급 id)를 주면 새로 얻은 경우에만 avatars.paid[avatarId]=paidBy 로 출처를 남긴다(환불 때 결제로 얻은 것만 회수).
   * 이미 가진 아바타(이벤트·부위·보석 출처)에는 출처를 덮어쓰지 않는다.
   * @param {string} heroId @param {{ avatarId?: string, paidBy?: string }} [opts]
   */
  grantAvatarFullset(heroId, { avatarId = AVATAR_PREMIUM_BY_HERO[heroId], paidBy } = {}) {
    const avatar = AVATAR_BY_ID[avatarId];
    if (!avatar || avatar.heroId !== heroId) return { ok: false, reason: 'not-ready' };
    // 결제 전 선검증용: 영웅을 소유하지 않았으면 입을 수 없으므로 지급하지 않는다(BM 이 결제 전에 같은 값을 확인).
    if (this.heroLocked(heroId)) return { ok: false, reason: 'locked' };
    const s = this.s;
    if (s.avatars.owned.includes(avatarId)) return { ok: true, avatarId, already: true };
    const before = structuredClone(s.avatars);
    s.avatars.owned.push(avatarId);
    if (s.avatars.parts) delete s.avatars.parts[avatarId];
    if (typeof paidBy === 'string' && paidBy) (s.avatars.paid || (s.avatars.paid = {}))[avatarId] = paidBy;
    if (!this.save()) { s.avatars = before; return { ok: false, reason: 'storage' }; }
    this.emit(); return { ok: true, avatarId, already: false };
  }
  /**
   * 환불·역분개: 그 결제 지급(paidBy)으로 얻은 아바타만 소유·착용에서 뺀다. 이벤트·부위·보석 출처는 건드리지 않는다.
   * @param {string} paidBy @returns {string[]} 회수한 아바타 id
   */
  revokePaidAvatars(paidBy) {
    const a = this.s.avatars, paid = a.paid;
    if (!paid || typeof paidBy !== 'string') return [];
    const ids = Object.keys(paid).filter((id) => paid[id] === paidBy);
    if (!ids.length) return [];
    const before = structuredClone(a);
    for (const id of ids) {
      a.owned = a.owned.filter((x) => x !== id);
      for (const [heroId, eq] of Object.entries(a.equipped)) if (eq === id) delete a.equipped[heroId];
      delete paid[id];
    }
    if (!Object.keys(paid).length) delete a.paid;
    if (!this.save()) { this.s.avatars = before; return []; }
    this.emit(); return ids;
  }
  /**
   * 이벤트·업적이 주는 아바타 부위 하나. 네 부위가 모이면 풀셋으로 바뀌어 소유된다.
   * @param {string} avatarId @param {string} part
   */
  grantAvatarPart(avatarId, part) {
    if (!AVATAR_BY_ID[avatarId] || !AVATAR_PARTS.includes(part)) return { ok: false, reason: 'avatar' };
    const s = this.s;
    if (s.avatars.owned.includes(avatarId)) return { ok: true, avatarId, complete: true, already: true };
    const before = structuredClone(s.avatars);
    const parts = s.avatars.parts || (s.avatars.parts = {});
    const have = new Set(parts[avatarId] || []); have.add(part);
    const complete = AVATAR_PARTS.every((p) => have.has(p));
    if (complete) { delete parts[avatarId]; s.avatars.owned.push(avatarId); }
    else parts[avatarId] = AVATAR_PARTS.filter((p) => have.has(p));
    if (!this.save()) { s.avatars = before; return { ok: false, reason: 'storage' }; }
    this.emit(); return { ok: true, avatarId, complete };
  }
  /** 모은 부위(풀셋 소유면 네 부위 전부). */
  avatarParts(avatarId) {
    if (this.s.avatars.owned.includes(avatarId)) return [...AVATAR_PARTS];
    return [...(this.s.avatars.parts?.[avatarId] || [])];
  }
  /** @param {string} heroId @param {string|null} [id] */
  equipAvatar(heroId, id = null) {
    if (!Object.hasOwn(HEROES, heroId)) return { ok: false, reason: 'hero' };
    if (this.heroLocked(heroId)) return { ok: false, reason: 'locked' };
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
    if (this.heroLocked(heroId)) return { ok: false, reason: 'locked' };
    const map = this.s.avatars.showGear || (this.s.avatars.showGear = {});
    if (on) map[heroId] = true; else delete map[heroId];
    this.emit(); return { ok: true };
  }
  claimMonthly() { const s = this.s; if (s.monthlyUntil < nowOf(this)) return false; const day = Math.floor(nowOf(this) / 86400000); if (s.monthlyClaimed === day) return false; s.monthlyClaimed = day; this.addRewards({ gems: 100, blessingCharm: Runes.BLESSING_MONTHLY_CHARMS }); return true; }
  /** 로그인 연동 보상(계정당 1회, 무료 보석만). 서버 /cmd 는 연동된 제공자가 있을 때만 이 메서드를 부른다. 난수 없음. */
  claimLinkBonus() {
    const s = this.s;
    if (s.linkBonus === 1) return { ok: false, reason: 'claimed' };
    s.linkBonus = 1;
    this.addRewards({ gems: LINK_BONUS_GEMS }, { applyVip: false });
    return { ok: true, gems: LINK_BONUS_GEMS };
  }
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

export const REWARD_LABEL = { gold: ['골드', '/img/icon_gold.webp'], gems: ['보석', '/img/icon_gem.webp'], energy: ['에너지', '/img/icon_energy.webp'], tickets: ['소환권', '/img/icon_ticket.webp'], ssrTicket: ['SSR 확정권', '/img/icon_ticket_ssr.webp'], sweep: ['소탕권', '/img/icon_sweep.webp'], stones: ['강화석', '/img/icon_stone_1.webp'], stones2: ['상급 강화석', '/img/icon_stone_2.webp'], stones3: ['전설 강화석', '/img/icon_stone_3.webp'], fragments: ['세트 조각', '/img/icon_fragment.webp'], protect: ['보호 주문서', '/img/icon_protect.webp'], bless: ['축복 주문서', '/img/icon_bless.webp'], transferScroll: ['전승 보호 주문서', '/img/icon_protect.webp'], monthly: ['월정액(일)', '/img/icon_gem.webp'], vip: ['VIP(일)', '/img/icon_vip.webp'] };
// 성장·초월·지역 드롭 보상 라벨(정산·우편·상점 공통).
Object.assign(REWARD_LABEL, { rune: ['룬', '/img/icon_fragment.webp'], runeDust: ['룬 가루', '/img/icon_fragment.webp'], blessingCharm: ['전운 부적', '/img/icon_bless.webp'], transcendStones: ['초월석', '/img/icon_stone_3.webp'], lineageSigil: ['계승 문장', '/img/icon_fragment.webp'], skillResets: ['스킬 초기화서', '/img/icon_protect.webp'], heroShards: ['영웅 조각', '/img/icon_fragment.webp'], glass_leaf: ['유리 잎', '/img/icon_fragment.webp'], ember_core: ['잿불 핵', '/img/icon_fragment.webp'], star_dust: ['별가루', '/img/icon_fragment.webp'] });
