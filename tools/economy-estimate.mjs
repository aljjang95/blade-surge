#!/usr/bin/env bun
// 무과금(현금 0원) 초월 경로 경제 추정기. 수치를 하드코딩하지 않고 실제 데이터·규칙 모듈에서 읽어 계산한다.
//   사용: bun tools/economy-estimate.mjs [--hero=mage] [--minutes=30,60] [--stageMin=3] [--strategies=ch1,top]
//         [--frontierShare=0.5] [--energy=bank|session] [--fullClear=true] [--maxDays=400] [--pretty]
// 출력은 JSON 한 덩어리이며 summary 배열이 시나리오별 요약이다. 계산 함수는 export 되어 test/economy-estimate.test.ts 가 검사한다.
//
// 모델(= 기댓값 시뮬레이션, 난수 없음):
//  - 하루에 minutesPerDay 분을 스테이지 1회 stageMin 분씩 반복한다. 에너지는 스테이지 energy 로 소모한다.
//  - 필드 드랍은 battle-base.js 의 방 정원(rosterSize/roomRoster)을 같은 식으로 옮겨, 실제 Floor 방 구성으로 처치 수를 센다.
//  - 드랍 확률·골드 공식은 loot-tables.js / drops.js onKill 과 같다. 영웅 조각은 출전 영웅(hero)에게만 쌓인다.
//  - 무과금 보석원: 신규 저장 시작 재화, 환영 우편, 일일 출석 7일 주기, 1회성 임무, 배틀패스 무료 트랙, 스테이지 첫 클리어.
//  - 초월 비용 부족분은 보석으로 메운다(초월석 상점, 골드 상점, 소환 기대 조각). 그 합이 보유 보석 이하가 되는 첫 날이 초월일이다.
import { GRADE_UP_COST, heroBaseGrade, nextGrade, gradeUpCost } from '../src/data/hero-grades.js';
import { GACHA, DAILY_REWARDS, PASS_TRACK, SKUS, ENERGY, BATTLE_PASS } from '../src/data/shop.js';
import { lootTable } from '../src/data/loot-tables.js';
import { stageDef, ENEMIES, CHAPTERS, STAGES_PER_CHAPTER } from '../src/data/stages.js';
import { HEROES, HERO_ORDER, levelGold } from '../src/data/heroes.js';
import { Economy, gachaChances } from '../src/game/economy.js';
import { Floor, ROOM_TYPE } from '../src/game/world.js';
import { monsterXp } from '../src/game/rpg-core.js';

export const TOTAL_STAGES = CHAPTERS.length * STAGES_PER_CHAPTER;
const DAY_SEC = 86400;

// ---------------------------------------------------------------------------------------------
// 실제 규칙에서 읽는 상수
// ---------------------------------------------------------------------------------------------
/** 신규 저장 시작 상태와 환영 우편은 Economy.fresh() 에서 그대로 읽는다(인스턴스·localStorage 불필요). */
export function startingState() {
  const s = Economy.prototype.fresh.call({});
  return { gold: s.gold, gems: s.gems, tickets: s.tickets, ssrTickets: s.ssrTickets, tStones: s.transcendStones || 0, skillResets: s.skillResets || 0,
    sweep: s.sweep, mail: s.mail.map(m => ({ id: m.id, rewards: { ...m.rewards } })) };
}
/** 1회성 임무 목록(조건 max 와 보상). Economy.quests() 를 빈 진행도로 호출해 읽는다. */
export function questTable() {
  return Economy.prototype.quests.call({ s: { quests: { kills: 0, stages: 0, pulls: 0, claimed: [] } } }).map(q => ({ id: q.id, name: q.name, max: q.max, rewards: { ...q.r },
    metric: q.id[0] === 'k' ? 'kills' : q.id[0] === 's' ? 'stages' : 'pulls' }));
}
export const energyPerDay = () => Math.floor(DAY_SEC / ENERGY.regenSec);
const srHeroes = () => HERO_ORDER.filter(h => HEROES[h].rarity === 'SR');
const ssrHeroes = () => HERO_ORDER.filter(h => HEROES[h].rarity === 'SSR');

// ---------------------------------------------------------------------------------------------
// 소환 기대 조각 (특정 영웅 1명의 중복 조각)
// ---------------------------------------------------------------------------------------------
/** 소프트·하드 천장을 반영한 SSR 사이클 기준(renewal-reward) 1회 소환당 등급 확률. */
export function perPullRarityShare() {
  let survive = 1, len = 0, sr = 0, ssr = 0;
  for (let k = 1; k <= GACHA.pity; k++) {
    const c = gachaChances(k);
    len += survive; sr += survive * c.SR; ssr += survive * c.SSR; survive *= 1 - c.SSR;
  }
  return { SR: sr / len, SSR: ssr / len, R: 1 - (sr + ssr) / len, pullsPerSsr: len };
}
/** 특정 영웅의 1회 소환당 기대 조각. 10연은 10번째 R→SR 보정(전부 R일 확률 × 영웅 몫)을 더한다. */
export function shardsPerPull(heroId) {
  const rarity = HEROES[heroId].rarity, share = perPullRarityShare(), dup = GACHA.dupShards;
  let heroShare = 0;
  if (rarity === 'SR') heroShare = GACHA.srSplit.hero / srHeroes().length;
  else if (rarity === 'SSR') {
    const others = ssrHeroes().filter(h => h !== GACHA.featured);
    heroShare = heroId === GACHA.featured ? GACHA.ssrSplit.featured + (others.length ? 0 : GACHA.ssrSplit.pool) : (others.length ? GACHA.ssrSplit.pool / others.length : 0);
  }
  const single = share[rarity] * heroShare * dup;
  const allR = Math.pow(gachaChances(1).R, 10);
  const ten = 10 * single + (rarity === 'SR' ? allR * heroShare * dup : 0);
  return { heroId, rarity, heroShare, perSingle: single, perTen: ten, perTenPerPull: ten / 10, srHeroCount: srHeroes().length, pullsPerShard: single ? 1 / single : Infinity, share };
}

// ---------------------------------------------------------------------------------------------
// 스테이지 1회당 기댓값 (실제 Floor + 방 정원 규칙 + onKill 롤)
// ---------------------------------------------------------------------------------------------
/** drops.js onKill 골드: max(1, floor(g * scale * mult * (0.8 + U*0.5))) 의 기댓값. 코인 개수(count)는 호출부가 곱한다. */
export function expectedGoldRoll(g, scale, mult) {
  const N = 512; let sum = 0;
  for (let i = 0; i < N; i++) sum += Math.max(1, Math.floor(g * scale * mult * (0.8 + ((i + 0.5) / N) * 0.5)));
  return sum / N;
}
const rankOf = def => def.boss ? 'boss' : def.elite ? 'elite' : 'normal';
const GOLD_COINS = { boss: 8, elite: 3, normal: 1 };   // drops.js onKill 의 골드 코인 개수
const NORMAL_ROOM_ELITE_CHANCE = 0.35;                  // battle-base.js roomRoster

/** battle-base.js rosterSize/roomRoster 의 결정적 부분을 같은 식으로 옮긴 방 명단. 무작위(일반방 정예 35%)는 가중치(w)로 둔다. */
export function roomEntries(stage, room) {
  const R = stage.rosterFor(room.type), idx = stage.idx, entries = [];
  const bossId = stage.dungeonBossId && ENEMIES[stage.dungeonBossId] ? stage.dungeonBossId : stage.encounter.enemyId;
  if (room.type === ROOM_TYPE.START) return entries;
  if (room.type === ROOM_TYPE.BOSS) {
    for (const t of [bossId, R.trash[0], R.trash[1], R.trash[0], R.trash[2], R.ranged[0], R.trash[1]]) entries.push({ type: t, w: 1 });
    return entries;
  }
  const area = room.w * room.h;
  const base = room.type === ROOM_TYPE.ELITE ? 6 + Math.round(area / 50) : room.type === ROOM_TYPE.TREASURE ? 4 + Math.round(area / 70) : 8 + Math.round(area / 40);
  const n = Math.min(24, Math.ceil(base + Math.floor(idx * 0.45)));
  let meleeTurn = 0, rangedTurn = 0;
  for (let i = 0; i < n; i++) {
    const ranged = i % 6 === 5, pool = ranged ? R.ranged : R.trash, turn = ranged ? rangedTurn++ : meleeTurn++;
    entries.push({ type: pool[(turn + room.id + idx) % pool.length], w: 1 });
  }
  if (room.type === ROOM_TYPE.ELITE) {
    entries.push({ type: R.elite[room.id % R.elite.length], w: 1 });
    if (idx > 8) entries.push({ type: R.elite[(room.id + 1) % R.elite.length], w: 1 });
  } else if (room.type === ROOM_TYPE.NORMAL) entries.push({ type: R.elite[room.id % R.elite.length], w: NORMAL_ROOM_ELITE_CHANCE });
  return entries;
}

const stageCache = new Map();
/** 스테이지(idx 1..60) 1회를 깼을 때의 기댓값. fullClear=true 면 선택 방을 모두 정리해 전체 정화 보너스를 받는다고 본다. */
export function perRun(idx, { fullClear = true } = {}) {
  const key = idx + (fullClear ? 'f' : 'n');
  if (stageCache.has(key)) return stageCache.get(key);
  const ch = Math.ceil(idx / STAGES_PER_CHAPTER), st = ((idx - 1) % STAGES_PER_CHAPTER) + 1;
  const stage = stageDef(ch, st), floor = new Floor(stage.idx, stage.chapter.theme, undefined, stage.dungeon?.layout);
  const out = { idx, code: stage.code, ch, st, energy: stage.energy, boss: stage.boss, bp: stage.rewards.bp, firstGems: stage.rewards.firstGems,
    milestoneTickets: st % 5 === 0 ? (st % 10 === 0 ? 2 : 1) : 0, bossTicket: stage.boss ? 0.3 : 0,
    kills: { normal: 0, elite: 0, boss: 0 }, combatExp: 0, stageGold: stage.rewards.gold + (fullClear ? Math.floor(stage.rewards.gold * 0.4) : 0), fieldGold: 0, heroShards: 0, transcendStones: 0 };
  for (const room of floor.rooms) for (const { type, w } of roomEntries(stage, room)) {
    const def = ENEMIES[type]; if (!def) throw new Error('알 수 없는 적 ' + type);
    const rank = rankOf(def), table = lootTable(ch, rank);
    out.kills[rank] += w;
    out.combatExp += w * monsterXp(def, stage.scale, false);
    out.fieldGold += w * GOLD_COINS[rank] * expectedGoldRoll(def.gold || 1, stage.scale, table.goldMultiplier);
    out.heroShards += w * table.heroShards.chance * table.heroShards.n;
    out.transcendStones += w * table.transcendStones.chance * table.transcendStones.n;
  }
  out.gold = out.stageGold + out.fieldGold;
  stageCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// 보석으로 메우는 비용
// ---------------------------------------------------------------------------------------------
const goldSkus = () => SKUS.filter(s => s.kind === 'gem' && s.rewards?.gold).map(s => ({ id: s.id, gold: s.rewards.gold, gems: s.price })).sort((a, b) => b.gold - a.gold);
/** 골드 need 이상을 사는 최소 보석(골드 상품 세 종의 조합 전수). */
export function gemsForGold(need) {
  if (need <= 0) return { gems: 0, buys: {}, gold: 0 };
  const [big, mid, small] = goldSkus();
  let best = { gems: Infinity, buys: {}, gold: 0 };
  for (let a = 0; a <= Math.ceil(need / big.gold); a++) for (let b = 0; b <= Math.ceil(need / mid.gold) && b <= 8; b++) {
    const left = need - a * big.gold - b * mid.gold, c = left > 0 ? Math.ceil(left / small.gold) : 0, gems = a * big.gems + b * mid.gems + c * small.gems;
    if (gems < best.gems) best = { gems, buys: { [big.id]: a, [mid.id]: b, [small.id]: c }, gold: a * big.gold + b * mid.gold + c * small.gold };
  }
  return best;
}
const stoneSku = () => SKUS.find(s => s.kind === 'gem' && s.rewards?.transcendStones);
export function gemsForStones(need) {
  if (need <= 0) return { gems: 0, packs: 0, stones: 0 };
  const sku = stoneSku(), n = sku.rewards.transcendStones, packs = Math.ceil(need / n);
  return { gems: packs * sku.price, packs, stones: packs * n };
}
/** 조각 부족분을 소환으로 메우는 기대 비용. 소환권을 먼저 쓰고 나머지는 10연(GACHA.ten)·단발(GACHA.single) 중 싼 쪽. */
export function gemsForShards(need, tickets, heroId) {
  if (need <= 0) return { gems: 0, pulls: 0, ticketsUsed: 0, paidPulls: 0 };
  const sp = shardsPerPull(heroId), perPull = sp.perTenPerPull || sp.perSingle;
  if (!(perPull > 0)) return { gems: Infinity, pulls: Infinity, ticketsUsed: 0, paidPulls: Infinity };
  const pulls = Math.ceil(need / perPull), ticketsUsed = Math.min(Math.floor(tickets), pulls), paid = pulls - ticketsUsed;
  const tens = Math.floor(paid / 10), rem = paid % 10, gems = tens * GACHA.ten + Math.min(rem * GACHA.single, GACHA.ten);
  return { gems, pulls, ticketsUsed, paidPulls: paid };
}

// ---------------------------------------------------------------------------------------------
// 하루 단위 시뮬레이션
// ---------------------------------------------------------------------------------------------
export const DEFAULTS = Object.freeze({ hero: 'mage', minutesPerDay: 30, stageMin: 3, strategy: 'ch1', frontierShare: 0.5, energyMode: 'session', fullClear: true, maxDays: 400, ch1FarmIdx: 10, assumePullQuest: false, zero: [] });

const MATS = ['shards', 'transcendStones', 'gold'];
const WALLET_KEY = { shards: 'shards', transcendStones: 'tStones', gold: 'gold' };
function freshWallet() {
  const s = startingState();
  return { gold: s.gold, gems: s.gems, tickets: s.tickets, ssrTickets: s.ssrTickets, tStones: s.tStones, shards: 0, skillResets: s.skillResets };
}
const addReward = (w, r) => {
  for (const [k, n] of Object.entries(r || {})) {
    if (k === 'transcendStones') w.tStones += n; else if (k === 'ssrTicket') w.ssrTickets += n; else if (k in w) w[k] += n;
  }
};

/** 현재 지갑으로 목표 등급을 만들기 위한 보석 비용 계획. 비용이 보유 보석 이하이면 feasible. */
export function planPromotion(wallet, cost, heroId) {
  const short = { shards: Math.max(0, cost.shards - wallet.shards), transcendStones: Math.max(0, cost.transcendStones - wallet.tStones), gold: Math.max(0, cost.gold - wallet.gold) };
  const sh = gemsForShards(short.shards, wallet.tickets, heroId), st = gemsForStones(short.transcendStones), go = gemsForGold(short.gold);
  const gems = sh.gems + st.gems + go.gems;
  return { short, shards: sh, stones: st, gold: go, gems, feasible: gems <= wallet.gems };
}

/** 한 시나리오를 돌려 SR→SSR→SSSR 초월 일수와 병목을 낸다. */
export function simulate(options = {}) {
  const o = { ...DEFAULTS, ...options }, heroId = o.hero, def = HEROES[heroId];
  const quests = questTable(), perDayEnergy = energyPerDay(), start = startingState(), w = freshWallet();
  for (const m of start.mail) addReward(w, m.rewards);                   // 환영 우편은 첫날 수령
  const sku = o.dayOneSku ? SKUS.find(s => s.id === o.dayOneSku) : null;
  if (o.dayOneSku && !sku) throw new RangeError('알 수 없는 상품 ' + o.dayOneSku);
  const gift = o.dayOneRewards || (sku?.gems ? { gems: sku.gems + sku.bonus } : sku?.rewards) || {};
  addReward(w, gift);
  let grade = heroBaseGrade(def), bank = ENERGY.max, passXp = 0, passClaimed = 0, kills = 0, runsTotal = 0, cleared = 0, dailyIdx = 0;
  const claimedQuests = new Set(), frontierCap = o.strategy === 'ch1' ? o.ch1FarmIdx : TOTAL_STAGES;
  const sources = { startGems: start.gems, mailGems: start.mail.reduce((n, m) => n + (m.rewards.gems || 0), 0), questGems: 0, dailyGems: 0, passGems: 0, firstClearGems: 0 };
  const field = { gold: 0, shards: 0, transcendStones: 0, tickets: 0 };
  const promotions = [], timeline = [], runsPerDay = Math.floor(o.minutesPerDay / o.stageMin);
  let matReady = {}, sinceDay = 0;
  for (let day = 1; day <= o.maxDays && nextGrade(grade); day++) {
    const reward = DAILY_REWARDS[dailyIdx++ % DAILY_REWARDS.length]; addReward(w, reward); sources.dailyGems += reward.gems || 0;
    if (gift.monthly && day <= gift.monthly) w.gems += 100;
    // 확정권은 실제 rollResult('SSR', true)처럼 픽업 영웅만 준다. SR 영웅의 조각으로 바꾸지 않는다.
    if (heroId === GACHA.featured && w.ssrTickets) { w.shards += w.ssrTickets * GACHA.dupShards; w.ssrTickets = 0; }
    if (o.energyMode === 'session') bank = Math.min(ENERGY.max, bank + perDayEnergy); else bank = perDayEnergy;
    // 오늘의 런: 프런티어(처음 깨는 스테이지)와 파밍(가장 높게 깬 스테이지 반복)
    const frontierWanted = cleared < frontierCap ? (o.strategy === 'ch1' ? runsPerDay : Math.round(runsPerDay * o.frontierShare)) : 0;
    let frontierDone = 0, ranToday = 0, spentMinutes = 0;
    for (let r = 0; r < runsPerDay; r++) {
      const useFrontier = cleared < frontierCap && frontierDone < frontierWanted;
      const idx = useFrontier ? cleared + 1 : (o.strategy === 'ch1' ? Math.min(o.ch1FarmIdx, Math.max(1, cleared)) : Math.max(1, cleared));
      const p = perRun(idx, { fullClear: o.fullClear });
      const waitMinutes = bank < p.energy && o.energyMode === 'session' ? (p.energy - bank) * ENERGY.regenSec / 60 : 0;
      if (spentMinutes + waitMinutes + o.stageMin > o.minutesPerDay || (bank < p.energy && !waitMinutes)) break;
      if (waitMinutes) bank = p.energy;
      spentMinutes += waitMinutes + o.stageMin;
      bank -= p.energy;
      if (o.energyMode === 'session') bank = Math.min(ENERGY.max, bank + o.stageMin * 60 / ENERGY.regenSec);
      ranToday++; runsTotal++; passXp += p.bp;
      w.gold += gift.vipDays && day <= gift.vipDays ? Math.floor(p.gold * 1.3) : p.gold;
      w.shards += p.heroShards; w.tStones += p.transcendStones; w.tickets += p.bossTicket;
      field.gold += p.gold; field.shards += p.heroShards; field.transcendStones += p.transcendStones; field.tickets += p.bossTicket;
      kills += p.kills.normal + p.kills.elite + p.kills.boss;
      if (useFrontier) { frontierDone++; cleared = idx; w.gems += p.firstGems; sources.firstClearGems += p.firstGems; w.tickets += p.milestoneTickets; }
    }
    // 1회성 임무(조건을 채운 날 수령)
    const metric = { kills, stages: runsTotal, pulls: o.assumePullQuest ? Infinity : 0 };
    for (const q of quests) if (!claimedQuests.has(q.id) && metric[q.metric] >= q.max) { claimedQuests.add(q.id); addReward(w, q.rewards); sources.questGems += q.rewards.gems || 0; }
    // 배틀패스 무료 트랙
    const level = Math.min(BATTLE_PASS.maxLevel, Math.floor(passXp / BATTLE_PASS.xpPerLevel) + 1);
    while (passClaimed < level) { const r = PASS_TRACK[passClaimed].free; addReward(w, r); sources.passGems += r.gems || 0; passClaimed++; }
    // 이번 목표의 재료별 자력(보석 변환 없이) 달성일, 보석 포함 가능 여부
    // zero: 반사실 계산용. 지정한 재료의 요구량을 0으로 두면 그 재료가 병목이었는지 알 수 있다.
    const cost = { ...gradeUpCost(grade) }; for (const m of o.zero) cost[m] = 0;
    for (const m of MATS) if (matReady[m] === undefined && w[WALLET_KEY[m]] >= cost[m]) matReady[m] = day - sinceDay;
    let plan = planPromotion(w, cost, heroId);
    // 실제로 10회 이상 소환할 계획이 생긴 뒤에만 소환 임무를 수령한다.
    const pullQuest = quests.find(q => q.metric === 'pulls');
    if (pullQuest && !claimedQuests.has(pullQuest.id) && plan.shards.pulls >= pullQuest.max) {
      claimedQuests.add(pullQuest.id); addReward(w, pullQuest.rewards); plan = planPromotion(w, cost, heroId);
    }
    timeline.push({ day, runs: ranToday, cleared, gold: Math.round(w.gold), shards: +w.shards.toFixed(2), tStones: +w.tStones.toFixed(2), gems: w.gems, tickets: +w.tickets.toFixed(1), gemNeed: Number.isFinite(plan.gems) ? plan.gems : null });
    if (!plan.feasible) continue;
    const before = { ...w }, next = nextGrade(grade);
    w.gems -= plan.gems; w.tickets -= plan.shards.ticketsUsed;
    w.shards = w.shards + plan.short.shards - cost.shards;
    w.tStones = w.tStones + plan.stones.stones - cost.transcendStones;
    w.gold = w.gold + plan.gold.gold - cost.gold;
    promotions.push({ from: grade, to: next, day, daysForStep: day - sinceDay, cost: { ...cost }, selfSufficientDays: { ...matReady },
      gemSpend: { total: plan.gems, shards: plan.shards.gems, shardPulls: Math.round(plan.shards.pulls), ticketsUsed: plan.shards.ticketsUsed, transcendStones: plan.stones.gems, gold: plan.gold.gems, goldBuys: plan.gold.buys },
      walletBefore: { gold: Math.round(before.gold), shards: +before.shards.toFixed(1), tStones: +before.tStones.toFixed(1), gems: before.gems, tickets: +before.tickets.toFixed(1) } });
    grade = next; sinceDay = day; matReady = {};
  }
  return { options: o, heroId, startGrade: heroBaseGrade(def), promotions, finished: !nextGrade(grade), finalGrade: grade,
    daysTo: Object.fromEntries(promotions.map(p => [p.to, p.day])), sources,
    field: { gold: Math.round(field.gold), shards: +field.shards.toFixed(1), transcendStones: +field.transcendStones.toFixed(1), tickets: +field.tickets.toFixed(1) },
    runs: runsTotal, clearedStages: cleared, timelineTail: timeline.slice(-3),
    wallet: { gold: Math.round(w.gold), gems: w.gems, tickets: +w.tickets.toFixed(1), ssrTickets: w.ssrTickets, shards: +w.shards.toFixed(1), tStones: +w.tStones.toFixed(1) } };
}

// ---------------------------------------------------------------------------------------------
// 관문·보석 소비처·무료 수입 요약
// ---------------------------------------------------------------------------------------------
/** 초월 재료마다 현금 없이 얻는 경로가 있는지: 필드 드랍·소환·보석 상점·무료 패스. 하나라도 비면 현금 전용 관문이다. */
export function cashOnlyGates(heroId = DEFAULTS.hero) {
  const shop = key => SKUS.some(s => s.kind === 'gem' && s.rewards?.[key]);
  const chapters = [1, 2, 3, 4, 5, 6];
  const paths = {
    shards: { fieldDrop: chapters.some(ch => lootTable(ch, 'boss').heroShards.chance > 0), gachaDup: shardsPerPull(heroId).perSingle > 0, gemShop: shop('heroShards') },
    transcendStones: { fieldDrop: chapters.some(ch => lootTable(ch, 'boss').transcendStones.chance > 0), gachaMaterial: Object.values(GACHA.materials).some(l => l.some(m => m.k === 'transcendStones' && m.w > 0)), gemShop: shop('transcendStones') },
    gold: { stageReward: chapters.every(ch => stageDef(ch, 1).rewards.gold > 0), gemShop: shop('gold') },
  };
  const gates = Object.entries(paths).filter(([, p]) => !Object.values(p).some(Boolean)).map(([k]) => k);
  const cashPackages = SKUS.filter(s => s.kind === 'cash' && (s.rewards?.transcendStones || s.rewards?.heroChoiceShards)).map(s => ({ id: s.id, price: s.price, rewards: s.rewards }));
  return { gates, hasCashOnlyGate: gates.length > 0, paths, cashPackages };
}
export function gemSinks() {
  const g = id => SKUS.find(s => s.id === id), stone = stoneSku(), gl = goldSkus(), per = (gems, n) => +(gems / n).toFixed(3);
  return {
    summon: { single: GACHA.single, ten: GACHA.ten, perPullInTen: GACHA.ten / 10, hardPity: GACHA.pity },
    transcendStones: { id: stone.id, packGems: stone.price, stones: stone.rewards.transcendStones, gemsPerStone: per(stone.price, stone.rewards.transcendStones) },
    skillReset: { one: g('skill_reset1').price, five: g('skill_reset5').price, gemsPerResetInFive: per(g('skill_reset5').price, 5) },
    gold: gl.map(x => ({ id: x.id, gems: x.gems, gold: x.gold, goldPerGem: Math.round(x.gold / x.gems), gemsPer100k: Math.round(x.gems / x.gold * 100000) })),
    energy: SKUS.filter(s => s.kind === 'gem' && s.rewards?.energy).map(s => ({ id: s.id, gems: s.price, energy: s.rewards.energy, gemsPerEnergy: per(s.price, s.rewards.energy) })),
    enhance: SKUS.filter(s => s.kind === 'gem' && s.tab === 'enh' && !s.rewards?.transcendStones && !s.rewards?.skillResets).map(s => ({ id: s.id, gems: s.price, rewards: s.rewards })),
  };
}
const sumRewards = list => list.reduce((a, r) => { for (const [k, n] of Object.entries(r)) a[k] = (a[k] || 0) + n; return a; }, {});
export function freeIncome() {
  const start = startingState(), firstClear = { gems: 0, tickets: 0 };
  for (let i = 1; i <= TOTAL_STAGES; i++) { const p = perRun(i); firstClear.gems += p.firstGems; firstClear.tickets += p.milestoneTickets; }
  return { dailyCycleDays: DAILY_REWARDS.length, weeklyLogin: sumRewards(DAILY_REWARDS), passFreeTrackTotal: sumRewards(PASS_TRACK.map(t => t.free)),
    oneTime: { start: { gems: start.gems, tickets: start.tickets, gold: start.gold }, mail: sumRewards(start.mail.map(m => m.rewards)), quests: sumRewards(questTable().map(q => q.rewards)), firstClearAll60: firstClear } };
}
const levelGoldReference = () => Object.fromEntries([20, 30, 40].map(lv => [lv, Array.from({ length: lv - 1 }, (_, i) => levelGold(i + 1)).reduce((a, b) => a + b, 0)]));

// ---------------------------------------------------------------------------------------------
// 보고서
// ---------------------------------------------------------------------------------------------
const brief = r => ({ minutesPerDay: r.options.minutesPerDay, strategy: r.options.strategy, stageMin: r.options.stageMin, energyMode: r.options.energyMode,
  daysToSSR: r.daysTo.SSR ?? null, daysToSSSR: r.daysTo.SSSR ?? null, runs: r.runs, clearedStages: r.clearedStages,
    steps: r.promotions.map(p => ({ to: p.to, day: p.day, daysForStep: p.daysForStep, bottleneck: p.bottleneck, selfSufficientDays: p.selfSufficientDays, gemSpend: p.gemSpend, walletBefore: p.walletBefore })),
  sources: r.sources, field: r.field, wallet: r.wallet });

/**
 * 반사실 병목: 재료 부분집합의 요구량을 0으로 두고 다시 돌려, 단계별 걸린 일수가 가장 많이 줄어드는 가장 작은 집합을 병목으로 본다.
 * 한 재료만 풀어서는 줄지 않으면(두 재료가 동시에 막고 있으면) 그 둘이 함께 병목으로 나온다.
 */
export function withBottlenecks(options) {
  const base = simulate(options), subsets = [];
  for (let mask = 1; mask < 1 << MATS.length; mask++) subsets.push(MATS.filter((_, i) => mask & (1 << i)));
  subsets.sort((a, b) => a.length - b.length);
  const cf = new Map(subsets.map(s => [s.join('+'), simulate({ ...options, zero: s })]));
  base.promotions.forEach((p, i) => {
    const saved = s => p.daysForStep - (cf.get(s.join('+')).promotions[i]?.daysForStep ?? p.daysForStep);
    const best = Math.max(...subsets.map(saved));
    const set = best > 0 ? subsets.find(s => saved(s) >= best) : [];
    p.bottleneck = { materials: set, savedDaysIfFree: Object.fromEntries(subsets.map(s => [s.join('+'), saved(s)])) };
  });
  return base;
}

/** 상품을 첫날 수령했을 때의 반사실. 현금 결제는 실행하지 않으며 지급 가능한 보상만 넣는다. */
export function productSavings(options = {}) {
  const baseOptions = { ...options, minutesPerDay: options.minutesPerDay ?? 30, strategy: options.strategy ?? 'ch1' };
  const targets = {
    SSR: { hero: 'mage', grade: 'SSR', label: '마법사 SR→SSR' },
    SSSR: { hero: GACHA.featured, grade: 'SSSR', label: '픽업 SSR→SSSR' },
  };
  const baseline = Object.fromEntries(Object.entries(targets).map(([key, t]) => [key, simulate({ ...baseOptions, hero: t.hero }).daysTo[t.grade]]));
  const measure = (key, extra, targetKey) => {
    const t = targets[targetKey], after = simulate({ ...baseOptions, hero: t.hero, ...extra }).daysTo[t.grade];
    return { key, target: t.label, hero: t.hero, grade: t.grade, freeDays: baseline[targetKey], withDays: after,
      days: baseline[targetKey] - after };
  };
  const result = { ssrTicket: measure('ssrTicket', { dayOneRewards: { ssrTicket: 1 } }, 'SSSR') };
  for (const sku of SKUS) {
    const target = sku.id === 'transcend_pack' || sku.id === 'starter' ? 'SSSR' : 'SSR';
    result[sku.id] = measure(sku.id, { dayOneSku: sku.id }, target);
  }
  return result;
}

export function economyPace() {
  const free = simulate({ minutesPerDay: 30, strategy: 'ch1' });
  return { minutesPerDay: 30, freeDays: { SSR: free.daysTo.SSR, SSSR: free.daysTo.SSSR }, savings: productSavings() };
}

export async function emitPace() {
  const { writeFile } = await import('node:fs/promises');
  const pace = economyPace();
  await writeFile(new URL('../src/data/economy-pace.js', import.meta.url),
    '// 자동 생성: bun tools/economy-estimate.mjs --emit-pace\n'
    + '// 하루 30분·스토리·1장 반복·판당 3분·기댓값. 상품별 대상과 무료 기준은 savings 안에 함께 기록한다.\n'
    + 'export const ECONOMY_PACE = ' + JSON.stringify(pace, null, 2) + ';\n');
  return pace;
}

export function estimate(options = {}) {
  const { minutesList = [30, 60], strategies = ['ch1', 'top'], ...rest } = options, base = { ...DEFAULTS, ...rest };
  const scenarios = [];
  for (const m of minutesList) for (const strategy of strategies) scenarios.push(brief(withBottlenecks({ ...base, minutesPerDay: m, strategy })));
  const sensitivity = [];
  const tryOne = (label, extra) => { for (const strategy of strategies) { const r = simulate({ ...base, minutesPerDay: 30, strategy, ...extra }); sensitivity.push({ label, strategy, daysToSSR: r.daysTo.SSR ?? null, daysToSSSR: r.daysTo.SSSR ?? null }); } };
  tryOne('에너지: 하루 1회 접속(저장 한도 100)', { energyMode: 'session' });
  tryOne('스테이지 1회 5분', { stageMin: 5 });
  tryOne('전체 정화 보너스 없음', { fullClear: false });
  tryOne('프런티어 비율 25%', { frontierShare: 0.25 });
  const perStageSamples = [1, 10, 20, 30, 40, 50, 60].map(i => { const p = perRun(i, { fullClear: base.fullClear }); return { code: p.code, energy: p.energy, kills: Object.fromEntries(Object.entries(p.kills).map(([k, v]) => [k, +v.toFixed(1)])), gold: Math.round(p.gold), heroShards: +p.heroShards.toFixed(3), transcendStones: +p.transcendStones.toFixed(3), firstGems: p.firstGems }; });
  const cash = cashOnlyGates(base.hero);
  const summary = scenarios.map(s => ({ scenario: s.minutesPerDay + '분/일 · ' + s.strategy, daysToSSR: s.daysToSSR, daysToSSSR: s.daysToSSSR, bottleneckSSR: s.steps[0]?.bottleneck.materials ?? null, bottleneckSSSR: s.steps[1]?.bottleneck.materials ?? null }));
  return {
    summary,
    assumptions: { ...base, energyPerDay: energyPerDay(), energyStart: ENERGY.max,
      notes: ['기댓값 시뮬레이션: 난수 없음', 'ch1 = 1장 최종 스테이지(' + base.ch1FarmIdx + ')를 열 때까지 매 판 전진 후 그 스테이지를 반복', 'top = 프런티어 비율만큼 처음 깨는 스테이지로 전진하고 나머지는 가장 높게 깬 스테이지를 반복(전부 깬 뒤에는 6-10 반복)',
        '전투는 항상 승리·전체 정화로 가정(전투력·난이도 게이트는 모델에 없음)', '영웅 레벨업 골드(levelGold)와 별 승급은 골드·조각을 따로 쓰므로 모델에 넣지 않음', 'SSR 확정권은 실제 픽업 영웅에게만 중복 조각 지급, SR 영웅에게는 0',
        'session은 하루 한 세션·에너지 최대 100·회복 대기 시간 포함, bank는 여러 접속으로 하루 자연 회복량을 활용하는 민감도',
        '소환 조각은 천장 반영 기댓값으로 결과를 보장하지 않음, 소환의 부수 초월석·장비 판매·선택 영웅 조각은 제외',
        '상품 비교는 첫날 보상 수령 가정(결제 실행·가격 차감 없음), 보석 상품은 첫 구매 보너스 포함',
        '골드 코인은 모두 줍고, 소환된 적·무리 졸개의 드랍은 제외'] },
    hero: { id: base.hero, startGrade: heroBaseGrade(HEROES[base.hero]), upCost: GRADE_UP_COST },
    summon: shardsPerPull(base.hero),
    scenarios, sensitivity, perStageSamples, freeIncome: freeIncome(), gemSinks: gemSinks(), levelGoldReference: levelGoldReference(),
    productSavings: productSavings({ minutesPerDay: 30 }),
    cashOnlyGate: cash.hasCashOnlyGate, cashOnlyGateDetail: cash,
  };
}

function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (!m) continue;
    const [, k, v = 'true'] = m;
    if (k === 'minutes') o.minutesList = v.split(',').map(Number);
    else if (k === 'strategies') o.strategies = v.split(',');
    else if (['stageMin', 'frontierShare', 'maxDays', 'ch1FarmIdx'].includes(k)) o[k] = Number(v);
    else if (k === 'fullClear') o.fullClear = v !== 'false';
    else if (k === 'energy') o.energyMode = v;
    else if (k === 'hero') o.hero = v;
    else if (k === 'pretty') o.pretty = true;
    else if (k === 'emit-pace') o.emitPace = true;
  }
  return o;
}
if (import.meta.main) {
  const { pretty, emitPace: emit, ...args } = parseArgs(process.argv.slice(2));
  console.log(JSON.stringify(emit ? await emitPace() : estimate(args), null, pretty ? 2 : undefined));
}
