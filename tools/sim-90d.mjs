#!/usr/bin/env bun
// 90일 진행 시뮬레이터(docs/CONTENT_90D.md 6절). 실제 데이터·규칙 모듈을 읽어 라이트/미드/하드코어 3 페르소나의 90일을 돌린다.
//   사용: bun tools/sim-90d.mjs [--days=90] [--seeds=16] [--json] [--assert]
// 결정적: 같은 시드 목록은 같은 결과를 낸다(Math.random·Date.now 미사용). 장비 드랍·강화 성공만 시드 난수, 나머지는 기댓값.
//
// 모델 요약
//  - 하루 minutes 분을 sessions 번에 나눠 쓴다. 세션 사이에 에너지가 최대치까지 찬다(ENERGY 그대로).
//  - 전투력 = heroStats(레벨·별·등급 + 4부위 장비 itemStats) 실제 식. 콘텐츠 요구 전투력 = POWER_NEED.k × scale^exp × 난이도 압박.
//    페르소나 손기술(skill)이 요구치를 곱한다(하드코어 0.88 = 같은 전투력으로 더 높은 곳).
//  - 우선순위: 새 캠페인 관문/난이도 → 무한의 성 다음 층 → 남은 에너지로 가장 높은 클리어 가능 관문 반복.
//  - 골드는 강화(enhanceCost·enhanceStones·enhanceChance·하락·파괴)에 쓴다. 강화석 3단계는 실제 등급 규칙.
//  - 등급(초월)은 economy-estimate 의 무과금 초월일(ECONOMY_PACE)을 하루 분량 비율로 옮긴다(소환·결제는 BM 레인).
//  - marathon(하루 8시간, docs/SPEC_720H.md 3.4): 위 우선순위 뒤에 고통 단계(에너지 0)를 돈다. 최고 단계 도전(가장 쉬운 지역 최종 보스 X-10)
//    → 남는 시간 고통 단계 반복(하루 fullRuns 판 뒤 골드·재료 35%, EXP 100%). Lv.80 이후 EXP 는 전설 수련으로, 점수는 전투력 최대 노드부터 배분한다.
//    '할 일 없음 분'(idleMin)은 아무것도 못 한 시간이다. 장 수는 CHAPTERS.length(장 개방 시각은 아래 chapterOpenDay: src/data/chapter-open.js 우선, 없으면 SPEC 3.3 주차)를 읽어 자동 반영한다.
import { perRun, TOTAL_STAGES } from './economy-estimate.mjs';
import { stageDef, CHAPTERS, STAGES_PER_CHAPTER } from '../src/data/stages.js';
import { chapterOpensAt, SEASON_START_MS } from '../src/data/chapter-open.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, tormentId, tormentTierOf } from '../src/game/difficulty.js';
import { TOWER, POWER_NEED, SEASON, TORMENT } from '../src/data/content-90d.js';
import { normalizeLegend, grantLegendExp, allocate as allocateLegendNode, legendStats, LEGEND_NODES, LEGEND } from '../src/game/legend-rank.js';
import { towerScale, towerFirstClearRewards, towerCap, activeEvents, applyEventRewards, seasonAt } from '../src/game/endgame-core.js';
import { HEROES, heroStats, levelExp, starShards } from '../src/data/heroes.js';
import { normalizeBounty, availableBounties, completeBounty, buyBountyItem } from '../src/game/bounty-board.js';
import { BOUNTY_SHOP } from '../src/data/bounties.js';
import { heroTrainingQuote } from '../src/game/hero-training.js';
import { ITEMS_OF, SLOTS, RARITIES, enhanceCost, enhanceStones, enhanceChance, enhanceDown, destroyChance, enhanceStoneTier, STONE_KEY } from '../src/data/items.js';
import { itemStats } from '../src/data/item-tier.js';
import { lootTable, levelExperienceMultiplier, recommendedLevel, difficultyDepth } from '../src/data/loot-tables.js';
import { ENERGY } from '../src/data/shop.js';
import { ECONOMY_PACE } from '../src/data/economy-pace.js';
import { DAILY_CONTRACTS, WEEKLY_CONTRACTS } from '../src/data/journey.js';
import { createSeededRng, hashSeed } from '../src/shared/rng.js';
import { RUNE_SOURCES, RUNE_MERGE_COST, RUNE_DUPLICATE_CAP } from '../src/data/runes.js';
import { socketCount, runeEffects } from '../src/game/rune-core.js';
import { rollRuneDrops, giftBag, craftRuneExact } from '../src/game/rune-economy.js';
import { applyBuildStats } from '../src/game/masterworks-combat.js';
import { idleQuote } from '../src/game/idle-rewards.js';
import { repairFullCost, DUR_WEAR, CLEAR_CARD_SIM } from '../src/game/clear-loop.js';

const DAY_MS = 86400000;
export const PERSONAS = Object.freeze({
  light: { id: 'light', name: '라이트', minutes: 15, sessions: 1, skill: 1.1, enhCap: 15, towerShare: .3, hero: 'knight' },
  mid: { id: 'mid', name: '미드(일반)', minutes: 30, sessions: 2, skill: 1, enhCap: 20, towerShare: .3, hero: 'knight' },
  hardcore: { id: 'hardcore', name: '하드코어', minutes: 100, sessions: 3, skill: 0.88, enhCap: 20, towerShare: .3, hero: 'knight' },
  // 하루 8시간(120분×4세션). 세션 사이 4시간이라 에너지는 세션마다 80(= 4h/180s)만 찬다. 고통 단계(에너지 0)로 남는 시간을 쓴다.
  marathon: { id: 'marathon', name: '마라톤(8시간)', minutes: 480, sessions: 4, skill: 0.85, enhCap: 20, towerShare: .3, hero: 'knight', torment: true, energyGapH: 4, regionFirst: true },
});
/**
 * 소액 과금 페르소나(report-only, 대표님 2026-10-29). 밴드·assertBands·PERSONAS 순회에 들어가지 않는다(기존 네 페르소나의 시드·밴드 불변).
 * 활동량은 미드(일반)와 같고 한 달(30일)마다 보석 기본 팩(gems_300_v1: 3,900원 = 300보석, 보너스·묶음 할인 제외)을 예산 안에서 살 수 있는 만큼 산다.
 * 이 시뮬레이터는 보석을 소환에 쓰는 모델이 아니라서(PERSONAS 주석 '소환·결제 제외') 진행 곡선(SSSR일·정체)은 미드와 같고, 여기서는 유료 보석 흐름과
 * 영웅 직접 영입(HERO_DIRECT_PURCHASE, 유료 보석 전용)을 켰을 때 살 수 있는 시점만 계산한다.
 */
export const SPENDER_PERSONAS = Object.freeze({
  low10: { id: 'low10', name: '소액 과금(월 1만원)', base: 'mid', monthlyKRW: 10000 },
  low20: { id: 'low20', name: '소액 과금(월 2만원)', base: 'mid', monthlyKRW: 20000 },
  low30: { id: 'low30', name: '소액 과금(월 3만원)', base: 'mid', monthlyKRW: 30000 },
});
const GEM_PACK = Object.freeze({ krw: 3900, gems: 300 });
/** 유료 보석 흐름: 1·31·61일 차에 기본 팩을 예산 안에서 최대한 산다. 영입 가격(2,308)은 hero-direct-purchase.js 와 같은 값. */
export function spenderReport(base, days = 90) {
  const out = {};
  for (const P of Object.values(SPENDER_PERSONAS)) {
    const packs = Math.floor(P.monthlyKRW / GEM_PACK.krw), gemsPerMonth = packs * GEM_PACK.gems, krwPerMonth = packs * GEM_PACK.krw;
    const buyDays = [1, 31, 61].filter((d) => d <= days);
    const cumGems = (d) => buyDays.filter((b) => b <= d).length * gemsPerMonth;
    const price = HERO_DIRECT_PURCHASE_GEMS;
    // 영입 가능 시점: 누적 유료 보석 ≥ price × n 이 되는 첫 구매일(n번째 영웅). 다른 곳에 쓰지 않고 모은다고 가정.
    const heroDay = (n) => buyDays.find((b) => cumGems(b) >= price * n) ?? null;
    out[P.id] = { name: P.name, monthlyKRW: P.monthlyKRW, packsPerMonth: packs, gemsPerMonth, krwPerMonth, paidGemsByDay: { D30: cumGems(30), D60: cumGems(60), D90: cumGems(days) },
      heroPrice: price, firstHeroDay: heroDay(1), secondHeroDay: heroDay(2), heroesByD90: Math.floor(cumGems(days) / price), pullsPerMonth: Math.floor(gemsPerMonth / 300),
      progression: { baseOn: P.base, sssrDay: base.milestones.sssr, longestStall: base.stalls.longest, note: '소환·영입 지출을 진행 모델에 넣지 않아 미드(F2P)와 같은 곡선' } };
  }
  return out;
}
const MIN_STAGE = 3, MIN_HARD = 4;
const LEGEND_COUNTED_DAYS_PER_WEEK = 3;
const S2_MAJOR_MIN = CHAPTERS.length >= 12 ? 80 : 70;
// 진행 모델 규약: POWER_NEED 판정은 기본 전투력(레벨·별·등급·장비)만 쓴다. 보너스층(숙련·세트·스킬·옛 출격 중 각인)은 빼고
// D8 을 맞췄으므로 룬(옛 각인의 대체)도 같은 보너스층으로 진행 판정에서 뺀다. 대신 룬 전투력 몫(runePowerPct)을 상·하한 밴드로 가드한다.
// (버린 안 2026-10-24: 룬을 진행 판정에 넣고 배율을 줄임 — 배율 0, 공명만 +4.9%여도 미드 D90 탑 161층·지옥 6-10 66일로 밴드 초과.)
// 룬 정밀 제작 우선순위: 전투력에 직접 들어가는 효과(공격력·최대 체력)부터. III 를 먼저 완성한다(같은 룬 2개 상한).
export const RUNE_PRIORITY = Object.freeze(['ember_edge', 'stone_root', 'tide_breath', 'storm_edge']);
const HARD = DIFFICULTY_ORDER.filter((d) => d !== 'story');

// ---------- 요구 전투력 ----------
const pressure = (d) => Math.sqrt(d.enemyHp * d.enemyAtk) * Math.sqrt(d.enemyDensity);
export const stageNeed = (idx, diffId = 'story') => {
  const ch = Math.ceil(idx / STAGES_PER_CHAPTER), st = ((idx - 1) % STAGES_PER_CHAPTER) + 1;
  return POWER_NEED.k * Math.pow(stageDef(ch, st).scale, POWER_NEED.exp) * pressure(DIFFICULTIES[diffId]);
};
export const towerNeed = (floor) => POWER_NEED.k * Math.pow(towerScale(floor), POWER_NEED.exp) * POWER_NEED.tower;

// ---------- 한 판 기댓값(난이도 반영) ----------
const runCache = new Map();
function runValue(idx, diffId) {
  const key = idx + diffId; if (runCache.has(key)) return runCache.get(key);
  // 고통 단계는 깊이 칸(loot-tables difficultyDepth)으로 드랍 표·필드 골드를 읽고, 에너지 0·권장 레벨 80·처치 EXP ×(1 + expStep×n).
  const base = perRun(idx, { fullClear: true }), d = DIFFICULTIES[diffId], tier = tormentTierOf(diffId), ch = base.ch;
  const dRank = tier ? difficultyDepth(diffId) : DIFFICULTY_ORDER.indexOf(diffId);
  const stage = stageDef(ch, base.st), out = { idx, ch, st: base.st, energy: tier ? 0 : base.energy, boss: base.boss, firstGems: base.firstGems,
    stageGold: Math.floor(base.stageGold * d.rewardMul), fieldGold: base.fieldGold * (1 + dRank * .2), combatExp: base.combatExp * (d.combatExpMul || 1),
    stageExp: Math.floor(stage.rewards.exp * 1.5 * d.expMul), stones: stage.rewards.stones, stones2: 0, stones3: 0,
    heroShards: base.heroShards, transcendStones: base.transcendStones, kills: base.kills, recLevel: tier ? TORMENT.recLevel : recommendedLevel(ch, base.st) };
  for (const rank of ['normal', 'elite', 'boss']) {
    const t = lootTable(ch, rank, diffId), n = base.kills[rank];
    out.stones += n * t.stones * t.stoneChance; out.stones2 += n * t.stones2; out.stones3 += n * t.stones3;
  }
  runCache.set(key, out); return out;
}

// ---------- 장비 ----------
const ITEM_OF = Object.fromEntries(RARITIES.map((r) => [r, Object.fromEntries(SLOTS.map((s) => [s, ITEMS_OF(r, s)[0]?.id]))]));
const slotScore = (it) => { if (!it) return 0; const st = itemStats({ id: ITEM_OF[it.r][it.slot], enh: it.enh, tp: it.tp, il: it.il }); return st.atk * 6 + st.hp * .5 + st.def * 4 + st.crit * 1000; };
function equipBonus(gear) {
  const b = { atk: 0, hp: 0, def: 0, crit: 0 };
  for (const slot of SLOTS) { const it = gear[slot]; if (!it) continue; const st = itemStats({ id: ITEM_OF[it.r][slot], enh: it.enh, tp: it.tp, il: it.il }); for (const k in b) b[k] += st[k]; }
  return b;
}
function pickWeighted(weights, rng) {
  let r = rng() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { r -= w; if (r < 0) return k; }
  return 'L';
}

// ---------- 한 페르소나 × 한 시드 ----------
export function simulate(personaId, seed, { days = 90, tormentAll = false } = {}) {
  // tormentAll: 민감도 확인용(--torment-all). 기준선 밴드는 고통 단계를 쓰지 않는 라이트·미드·하드코어로 검사한다.
  const P = tormentAll ? { ...PERSONAS[personaId], torment: true } : PERSONAS[personaId], rng = createSeededRng(hashSeed('sim-90d', personaId, seed)), def = HEROES[P.hero];
  const st = { level: 1, exp: 0, star: 1, shards: 0, grade: def.rarity, gold: 12000, stones: 12, stones2: 0, stones3: 0, gems: 1500, transcendStones: 0,
    energy: ENERGY.max, gear: Object.fromEntries(SLOTS.map((s) => [s, null])), storyUnlocked: 1, peak: {}, stars: {}, towerBest: 0, towerWeekCleared: 0, towerChestWeek: -1,
    tormentBest: 0, tormentRunsToday: 0, peakCount: 0 };
  // 현상금 의뢰판(docs/BOUNTY_BOARD.md): 같은 규칙 함수로 돌린다. 저장은 게임 eco.s 모양 어댑터(별·최고 난이도)로 만들고, 별·난이도가 바뀔 때(peakCount)만 다시 만든다.
  const bounty = normalizeBounty(null), bountyLog = [], bountyMinTotal = { v: 0 };
  let bSave = { progress: { stars: {} }, endgame: { peak: {} } }, bSaveKey = -1;
  const bountySave = () => {
    if (bSaveKey === st.peakCount) return bSave;
    const stars = {}, peak = {};
    for (const [idx, n] of Object.entries(st.stars)) stars[`${Math.floor((idx - 1) / STAGES_PER_CHAPTER) + 1}-${(idx - 1) % STAGES_PER_CHAPTER + 1}`] = n;
    for (const [idx, r] of Object.entries(st.peak)) peak[`${Math.floor((idx - 1) / STAGES_PER_CHAPTER) + 1}-${(idx - 1) % STAGES_PER_CHAPTER + 1}`] = r;
    bSaveKey = st.peakCount; return (bSave = { progress: { stars }, endgame: { peak } });
  };
  const totals = { goldEarned: 0, goldSpent: 0, trainingGold: 0, enhanceTries: 0, destroyed: 0 };
  const sssrDay = Math.round(ECONOMY_PACE.freeDays.SSSR * Math.pow(30 / P.minutes, .6));
  const daysLog = [], milestones = [];
  // ---------- 룬(R2): 드랍·가루·합성(III 우선)·소켓 장착. 장비 교체 때 룬은 무료 회수(판매 회수와 같음) ----------
  const runeRng = createSeededRng(hashSeed('sim-90d-rune', personaId, seed));
  const runes = { bag: Object.fromEntries(Object.entries(giftBag()).map(([id, c]) => [id, [...c]])), dust: 0, fx: {}, dirty: true, dropped: 0, crafted: 0 };
  const have = (id, g) => runes.bag[id]?.[g - 1] || 0;
  const addRune = (id, g, n = 1) => { (runes.bag[id] ||= [0, 0, 0])[g - 1] += n; runes.dirty = true; };
  const mergeAll = () => {
    for (const id of Object.keys(runes.bag)) for (const g of [2, 3]) {
      const c = RUNE_MERGE_COST[g];
      while (have(id, g - 1) >= c.count && st.gold >= c.gold && runes.dust >= c.runeDust) { runes.bag[id][g - 2] -= c.count; st.gold -= c.gold; totals.goldSpent += c.gold; runes.dust -= c.runeDust; addRune(id, g); }
    }
  };
  /** 정밀 제작 대상: III 2개(중복 상한)를 아직 못 채운 우선 룬 중 첫 번째. */
  const craftTarget = () => RUNE_PRIORITY.find((id) => have(id, 3) < RUNE_DUPLICATE_CAP) || RUNE_PRIORITY[0];
  const craftRunes = () => {
    const reserve = RUNE_MERGE_COST[3].runeDust;
    while (runes.dust >= RUNE_SOURCES.craftExact.runeDust + reserve) {
      // 게임 공방과 같은 규칙 함수(rune-economy.craftRuneExact)로 정밀 제작한다.
      const res = craftRuneExact({ bag: runes.bag, runeDust: runes.dust }, craftTarget()); if (!res.ok) break;
      runes.bag = res.bag; runes.dust = res.runeDust; runes.dirty = true; runes.crafted++; mergeAll();
    }
  };
  const runeCounts = () => { const out = [0, 0, 0]; for (const c of Object.values(runes.bag)) c.forEach((n, i) => { out[i] += n; }); return out; };
  /** 소켓 배치: 열린 칸 수만큼 높은 등급·우선 룬부터, 같은 룬은 2개까지. 효과는 rune-core.runeEffects 그대로. */
  const runeFx = () => {
    if (!runes.dirty) return runes.fx;
    const open = SLOTS.map((slot) => st.gear[slot] ? socketCount(st.gear[slot].r, st.gear[slot].enh) : 0);
    const pool = [];
    for (const g of [3, 2, 1]) for (const id of [...RUNE_PRIORITY, ...Object.keys(runes.bag).filter((x) => !RUNE_PRIORITY.includes(x)).sort()]) {
      const n = Math.min(have(id, g), RUNE_DUPLICATE_CAP - pool.filter((r) => r.id === id).length);
      for (let i = 0; i < n; i++) pool.push({ id, grade: g });
    }
    const items = SLOTS.map((slot, i) => st.gear[slot] ? { grade: st.gear[slot].r, enh: st.gear[slot].enh, sockets: pool.splice(0, open[i]) } : null).filter(Boolean);
    runes.fx = runeEffects(items); runes.dirty = false; return runes.fx;
  };
  // ---------- 전설 수련: Lv.80 이후 EXP, 점수는 전투력이 가장 오르는 노드부터(상한을 시험하는 보수적 배분) ----------
  const legend = normalizeLegend(null);
  let legendFx = legendStats(legend);
  const legendRefresh = () => { legendFx = legendStats(legend); };
  const withLegend = (b, fx) => ({ ...b, atkPct: fx.atkPct, hpPct: fx.hpPct, def: b.def + fx.def, crit: b.crit + fx.crit, critDmg: fx.critDmg, ultGain: fx.ultGain });
  const heroNow = () => ({ level: st.level, star: st.star, grade: st.grade });
  const basePower = () => heroStats(def, heroNow(), withLegend(equipBonus(st.gear), legendFx));
  const powerWithout = () => heroStats(def, heroNow(), equipBonus(st.gear)).power;
  const allocLegend = () => {
    while (legend.points > 0) {
      let pick = null, gain = -1; const p0 = basePower().power;
      for (const node of LEGEND_NODES) {
        if ((legend.nodes[node.id] || 0) >= LEGEND.maxNodeLevel) continue;
        legend.nodes[node.id] = (legend.nodes[node.id] || 0) + 1; legendRefresh(); const g = basePower().power - p0;
        legend.nodes[node.id]--; if (!legend.nodes[node.id]) delete legend.nodes[node.id];
        if (g > gain) { gain = g; pick = node; }
      }
      legendRefresh();
      if (!pick || !allocateLegendNode(legend, pick.id).ok) break;
      legendRefresh();
    }
  };
  const runePower = () => { const b = basePower(), fx = runeFx(); return Object.keys(fx).length ? applyBuildStats(b, fx).power : b.power; };
  const power = () => basePower().power; // 진행 판정: 보너스층(숙련·세트·옛 각인·룬)은 뺀다. 전설 수련·고통 단계 몫은 S5 밴드로 가드한다.
  let legendFiveUnits = 0, dayLegendFive = 0;
  const gainExp = (n) => {
    st.exp += n; while (st.level < 80 && st.exp >= levelExp(st.level)) { st.exp -= levelExp(st.level); st.level++; }
    if (st.level >= 80 && st.exp > 0) { // Lv.80 이후 EXP → 전설 수련(게임: Economy.addHeroExp)
      const before = legend.rank; grantLegendExp(legend, st.exp); st.exp = 0;
      if (legend.rank > before) { legendRefresh(); allocLegend(); const units = Math.floor(legend.rank / 5); if (units > legendFiveUnits) { dayLegendFive += units - legendFiveUnits; legendFiveUnits = units; } }
    }
  };
  const earn = (k, n) => { if (!n) return; st[k] += n; if (k === 'gold') totals.goldEarned += n; };
  const mark = (day, kind, label) => milestones.push({ day, kind, label });

  // 마라톤은 새 장비를 +15 기준 잠재력으로 비교한다(강화는 다시 올리면 되므로). 4% 넘게 좋을 때만 바꿔 강화를 날리는 잦은 교체를 막는다.
  // 다른 페르소나는 기존 규칙(+0 신품 대 현재 강화 수치) 그대로다 — 고통 단계 장비(tp)가 없어 기준선이 달라지지 않는다.
  const POTENTIAL_ENH = 15, SWAP_MARGIN = 1.04;
  const better = (cand, old) => P.torment
    ? slotScore({ ...cand, enh: POTENTIAL_ENH }) > slotScore({ ...(old || cand), enh: POTENTIAL_ENH }) * (old ? SWAP_MARGIN : 0)
    : slotScore(cand) > slotScore(old);
  // il: 본편 필드 드랍의 스테이지 장비 레벨(loot-tables.js dropItemLevel 과 같은 규칙: 권장 레벨, 고통 단계는 tp 가 대신한다).
  const dropGear = (ch, rank, diffId, count, recLevel = 0) => {
    const t = lootTable(ch, rank, diffId), tp = tormentTierOf(diffId), il = !tp && recLevel > 1 ? recLevel : 0;
    for (let i = 0; i < count; i++) {
      if (rng() >= t.gearChance) continue;
      for (let k = 0; k < t.gearRolls; k++) {
        const r = pickWeighted(t.gearWeights, rng), slot = SLOTS[Math.floor(rng() * SLOTS.length)];
        const cand = { r, slot, enh: 0, tp, il };
        const old = st.gear[slot];
        if (better(cand, old && { ...old, slot })) { st.gear[slot] = tp ? { r, enh: 0, tp } : il ? { r, enh: 0, il } : { r, enh: 0 }; runes.dirty = true; if (old) { runes.dust += RUNE_SOURCES.dismantleDust[old.r] || 0; } }
        else runes.dust += RUNE_SOURCES.dismantleDust[r] || 0; // 쓰지 않는 유니크·레전드리는 분해(룬 가루)
      }
    }
  };
  // decay: 고통 단계 하루 풀 보상 판 이후의 골드·재료 몫(EXP 는 100%). 약탈 갈래(전설 수련)는 골드·강화석을 더한다(Economy.completeStage 와 같은 식).
  const playStage = (idx, diffId, events, day, { decay = 1 } = {}) => {
    const v = runValue(idx, diffId), first = diffId === 'story' && !st.stars[idx];
    const comp = applyEventRewards({ gold: v.stageGold, exp: v.stageExp, stones: v.stones }, events, 'campaign');
    const mulG = decay * (1 + legendFx.goldPct), mulS = decay * (1 + legendFx.stonePct);
    earn('gold', Math.floor((comp.gold + v.fieldGold) * mulG)); earn('stones', Math.floor(comp.stones * mulS)); earn('stones2', Math.floor(v.stones2 * mulS)); earn('stones3', Math.floor(v.stones3 * mulS));
    if (first) earn('gems', v.firstGems);
    // 클리어 루프(docs/CLEAR_LOOP.md): 카드 3장 중 1장(기댓값을 골드·강화석 몫으로) + 착용 무기 마모를 그 판에 수리한다고 본다(골드 소모처).
    earn('gold', Math.floor(comp.gold * CLEAR_CARD_SIM.goldShare * mulG)); earn('stones', CLEAR_CARD_SIM.stones);
    const w = st.gear.weapon;
    if (w) { const fix = Math.ceil(repairFullCost(w, w.r) * DUR_WEAR.win / 100); if (st.gold >= fix) { st.gold -= fix; totals.goldSpent += fix; totals.repairGold = (totals.repairGold || 0) + fix; } }
    gainExp(v.combatExp + Math.floor(comp.exp * levelExperienceMultiplier(st.level, v.recLevel)));
    st.shards += v.heroShards * decay; st.transcendStones += v.transcendStones * decay;
    // 처치 수는 기댓값을 반올림해 장비 드랍을 굴린다(보스 1·정예·일반).
    dropGear(v.ch, 'boss', diffId, Math.round(v.kills.boss), v.recLevel); dropGear(v.ch, 'elite', diffId, Math.round(v.kills.elite), v.recLevel); dropGear(v.ch, 'normal', diffId, Math.round(v.kills.normal), v.recLevel);
    // 룬 드랍·완료 상자 룬 가루: 게임 정산과 같은 rollRuneDrops(정예·보스 처치 수, 지옥 = 심층 보스 판정).
    const rr = rollRuneDrops({ elite: Math.round(v.kills.elite), boss: Math.round(v.kills.boss) }, { hell: diffId === 'hell' || tormentTierOf(diffId) > 0, first }, Math.floor(runeRng() * 4294967296));
    for (const d of rr.drops) { addRune(d.id, d.grade); runes.dropped++; }
    runes.dust += rr.dust; craftRunes(); mergeAll();
    return v;
  };
  const enhanceAll = () => {
    // 가장 낮은 강화 부위부터 한 단계씩. 골드·강화석이 부족하거나 모든 부위가 상한이면 멈춘다.
    for (let guard = 0; guard < 400; guard++) {
      const slots = SLOTS.filter((s) => st.gear[s] && st.gear[s].enh < P.enhCap).sort((a, b) => st.gear[a].enh - st.gear[b].enh);
      if (!slots.length) return;
      const it = st.gear[slots[0]], lv = it.enh, cost = enhanceCost(lv), need = enhanceStones(lv), key = STONE_KEY[enhanceStoneTier(lv)];
      if (st.gold < cost || st[key] < need) return;
      st.gold -= cost; st[key] -= need; totals.goldSpent += cost; totals.enhanceTries++; st.dailyUpgrades++;
      runes.dirty = true;
      if (rng() < enhanceChance(lv)) it.enh++;
      else if (rng() < destroyChance(lv)) { it.enh = 0; totals.destroyed++; }
      else it.enh = Math.max(0, lv - enhanceDown(lv));
    }
  };
  // 골드 훈련(hero-training): 사냥으로 절반 이상 채운 레벨만 골드로 마무리한다. 강화 다음 순위의 골드 소모처.
  const train = () => {
    for (let guard = 0; guard < 80; guard++) {
      const q = heroTrainingQuote({ level: st.level, exp: Math.floor(st.exp) }, st.gold);
      if (!q.ok) return;
      st.gold -= q.cost; totals.goldSpent += q.cost; totals.trainingGold += q.cost; st.level++; st.exp = 0;
    }
  };

  for (let day = 1; day <= days; day++) {
    const nowMs = SEASON.startMs + (day - 1) * DAY_MS + 12 * 3600000, season = seasonAt(nowMs), events = activeEvents(nowMs);
    const weekIndex = season.absoluteWeek;
    if (weekIndex !== st.towerWeek) { st.towerWeek = weekIndex; st.towerWeekCleared = 0; st.legendDaysCounted = 0; st.weekly = { hard: 0, tower: 0, boss: 0, upgrades: 0 }; }
    if (day === sssrDay && st.grade !== 'SSSR') { st.grade = 'SSSR'; mark(day, 'grade', '주력 영웅 SSSR(무과금 초월)'); }
    st.dailyUpgrades = 0; let dayHard = 0, dayTower = 0, dayBoss = 0, newContent = 0, usedMin = 0, dayBountyMin = 0, dayBountyDone = 0, starvedMin = 0, dayTormentRuns = 0, dayTormentNew = 0;
    st.tormentRunsToday = 0; dayLegendFive = 0;
    const openIdxCap = chapterOpenIdx(day);
    const goldBefore = totals.goldEarned;
    let towerMin = 0;
    const towerTry = (time, overflow = false) => {
      if (st.storyUnlocked < TOWER.unlockStageIdx || time < TOWER.minutesPerFloor) return false;
      if (!overflow && towerMin + TOWER.minutesPerFloor > P.minutes * P.towerShare) return false;
      const f = st.towerBest + 1;
      if (f > towerCap(nowMs, st.towerBest) || power() < towerNeed(f) * P.skill) return false;
      towerMin += TOWER.minutesPerFloor; st.towerBest = f; st.towerWeekCleared++; dayTower++; newContent++;
      const r = applyEventRewards(towerFirstClearRewards(f), events, 'tower');
      for (const k of ['gold', 'stones', 'stones2', 'stones3', 'gems', 'transcendStones']) earn(k, r[k] || 0);
      gainExp(Math.floor(110 * towerScale(f) * .5));
      if (f % 10 === 0) mark(day, 'tower', `무한의 성 ${f}층`);
      return true;
    };
    for (let session = 0; session < P.sessions; session++) {
      // 세션 사이 회복(밤·낮 간격 ≥ 5시간 = 100 에너지). 마라톤은 세션 간격(energyGapH)만큼만 찬다.
      st.energy = P.energyGapH && session > 0 ? Math.min(ENERGY.max, st.energy + Math.floor(P.energyGapH * 3600 / ENERGY.regenSec)) : ENERGY.max;
      const sessionMin = P.minutes / P.sessions; let time = sessionMin;
      while (time > 0) {
        const pw = power(), ok = (need) => pw >= need * P.skill;
        let acted = false;
        // 1) 새 캠페인 관문(스토리)
        if (st.storyUnlocked <= Math.min(TOTAL_STAGES, openIdxCap) && time >= MIN_STAGE) {
          const idx = st.storyUnlocked, v = runValue(idx, 'story');
          if (ok(stageNeed(idx)) && st.energy >= v.energy) {
            st.energy -= v.energy; time -= MIN_STAGE; playStage(idx, 'story', events, day);
            st.stars[idx] = pw >= stageNeed(idx) * P.skill * 1.08 ? 3 : 2; st.peak[idx] = 0; st.peakCount++; st.storyUnlocked++; newContent++; if (v.boss) dayBoss++;
            if (v.st === STAGES_PER_CHAPTER) mark(day, 'story', `스토리 ${v.ch}-10`);
            acted = true;
          }
        }
        // 1a) 무한의 성은 에너지가 들지 않아 매 세션 먼저 오른다(하루 시간의 towerShare 까지). 일일 임무 '성의 다음 층'.
        if (!acted && towerTry(time)) { time -= TOWER.minutesPerFloor; acted = true; }
        // 1b) 새 난이도 관문: 숙련(스토리 클리어) → 악몽(별 3) → 지옥(지역 악몽 전부). 지역 순서대로.
        if (!acted && time >= MIN_HARD) {
          const next = nextHard(st, !!P.regionFirst);
          if (next) {
            const v = runValue(next.idx, next.diff);
            if (ok(stageNeed(next.idx, next.diff)) && st.energy >= v.energy) {
              st.energy -= v.energy; time -= MIN_HARD; playStage(next.idx, next.diff, events, day);
              st.peakCount++; st.peak[next.idx] = DIFFICULTY_ORDER.indexOf(next.diff); if (next.diff === 'adept' || next.diff === 'nightmare') st.stars[next.idx] = 3;
              dayHard++; newContent++; if (v.boss) dayBoss++;
              if (v.st === STAGES_PER_CHAPTER) mark(day, next.diff, `${DIFFICULTIES[next.diff].name} ${v.ch}-10`);
              acted = true;
            }
          }
        }
        // 2) 무한의 성(시간 몫을 다 쓴 뒤에도 할 일이 없으면 더 오른다)
        if (!acted && towerTry(time, true)) { time -= TOWER.minutesPerFloor; acted = true; }
        // 3) 반복: 에너지로 클리어 가능한 가장 보상 큰 관문
        if (!acted && time >= MIN_STAGE) {
          const farm = bestFarm(st, pw, P.skill);
          if (farm && st.energy >= runValue(farm.idx, farm.diff).energy) {
            const v = runValue(farm.idx, farm.diff);
            st.energy -= v.energy; time -= farm.diff === 'story' ? MIN_STAGE : MIN_HARD; playStage(farm.idx, farm.diff, events, day);
            if (farm.diff !== 'story') dayHard++; if (v.boss) dayBoss++;
            acted = true;
          }
        }
        // 3b) 현상금 의뢰(에너지 0): 열린 의뢰 중 가장 앞 하나를 def.minutes 분에 끝낸다. 판정은 항상 통과하는 숙련 플레이로 본다(조건 재시도 시간은 분에 포함).
        let bountyLeft = false;
        if (!acted) {
          const save = bountySave(), def = availableBounties(bounty, save, { limit: 1 })[0];
          if (def) {
            if (time < 3) bountyLeft = true; // 의뢰 한 건 미만 자투리는 '할 일 없음'이 아니다(고통 단계 자투리와 같은 취급)
            else if (time >= def.minutes) {
              time -= def.minutes; dayBountyMin += def.minutes; bountyMinTotal.v += def.minutes;
              const r = completeBounty(bounty, save, def.id, { win: true, fullClear: true, time: 0, revives: 0, maxCombo: 999, stars: 3 });
              if (r.ok) {
                dayBountyDone++; earn('gold', r.rewards.gold); earn('stones', r.rewards.stones);
                for (const u of r.ups) bountyLog.push({ day, minuteOfDay: Math.round(usedMin + sessionMin - time), rank: u.rank });
                acted = true;
              }
            }
          }
        }
        // 4) 고통 단계(마라톤): 최고 단계 도전 → 남는 시간 반복. 에너지 0, 하루 fullRuns 판 뒤 골드·재료 감쇠.
        if (!acted && P.torment && time >= TORMENT.minutesPerRun) {
          const run = tormentChoice(st, pw, P.skill, st.tormentRunsToday < TORMENT.fullRuns);
          if (run) {
            const full = st.tormentRunsToday < TORMENT.fullRuns, id = tormentId(run.tier), v = runValue(run.idx, id);
            time -= TORMENT.minutesPerRun; st.tormentRunsToday++; dayTormentRuns++; dayHard++;
            playStage(run.idx, id, events, day, { decay: full ? 1 : TORMENT.decayMul });
            if (v.boss) dayBoss++;
            if (run.push && v.st === STAGES_PER_CHAPTER && run.tier > st.tormentBest) { st.tormentBest = run.tier; dayTormentNew++; newContent++; mark(day, 'torment', `고통 T${run.tier}`); }
            acted = true;
          }
        }
        // 세션 끝의 한 판 미만 자투리는 '할 일 없음'이 아니다(마라톤만 — 다른 페르소나의 기준선은 그대로).
        if (!acted) { if (!(P.torment && time < TORMENT.minutesPerRun) && !bountyLeft) starvedMin += time; break; }
        train(); enhanceAll();
      }
      usedMin += P.minutes / P.sessions;
    }
    // 전설 수련 5단위 돌파는 '전설만으로 채운 날'을 주 3일까지만 '주요 진행'으로 센다(전설만으로 매일을 채우지 못하게, docs/SPEC_720H.md S2). 다른 주요 진행이 있는 날은 상한을 쓰지 않는다.
    usedMin -= starvedMin; let legendCounted = 0;
    if (dayLegendFive > 0 && newContent === 0 && st.legendDaysCounted < LEGEND_COUNTED_DAYS_PER_WEEK) { st.legendDaysCounted++; newContent++; legendCounted = 1; }
    // 일일·주간 임무: 시뮬레이터가 모형화한 통계(탑·하드·보스·강화)만 센다. 재료 던전·소환 임무는 제외(보수적).
    const daily = { towerFloors: dayTower, hardClears: dayHard, bossAttempts: dayBoss, upgrades: st.dailyUpgrades };
    st.weekly.hard += dayHard; st.weekly.tower += dayTower; st.weekly.boss += dayBoss; st.weekly.upgrades += st.dailyUpgrades;
    for (const c of DAILY_CONTRACTS) if (c.stat in daily && daily[c.stat] >= c.target) { earn('gold', c.rewards.gold || 0); earn('stones', c.rewards.stones || 0); }
    // 방치 보급(docs/RPG_ESSENTIALS.md E2): 세션마다 직전 공백(상한 12시간)만큼. 마라톤은 세션 사이 energyGapH.
    { const gapH = Math.min(12, P.energyGapH ?? Math.max(0, (24 - P.minutes / 60) / P.sessions));
      const idle = idleQuote({ since: 0, comebackAt: 0 }, { unlocked: st.storyUnlocked }, Math.round(gapH * 3600000)).rewards;
      for (let i = 0; i < P.sessions; i++) { earn('gold', idle.gold || 0); earn('stones', idle.stones || 0); totals.idleGold = (totals.idleGold || 0) + (idle.gold || 0); } }
    if (season.day === 6) { // 주의 마지막 날 주간 임무·탑 보급 정산
      const weekly = { towerFloors: st.weekly.tower, hardClears: st.weekly.hard, bossAttempts: st.weekly.boss, upgrades: st.weekly.upgrades };
      for (const c of WEEKLY_CONTRACTS) if (c.stat in weekly && weekly[c.stat] >= c.target) { earn('gold', c.rewards.gold || 0); earn('stones', c.rewards.stones || 0); }
      runes.dust += RUNE_SOURCES.weeklyDust; // 주간 의뢰 첫 수령 룬 가루
      const tier = [...TOWER.weeklyChest].reverse().find((row) => st.towerBest >= row.floor);
      if (tier && st.towerWeekCleared > 0) for (const k of ['gold', 'stones', 'stones2', 'stones3', 'gems']) earn(k, tier[k] || 0);
    }
    // 현상금 상인: 하루 끝에 증표로 강화석 꾸러미를 되는 만큼 산다(장식은 제외).
    for (const item of BOUNTY_SHOP) if (item.grant.stones || item.grant.stones2) for (let i = 0; i < 10; i++) { const r = buyBountyItem(bounty, item.id, weekIndex); if (!r.ok) break; earn('stones', r.grant.stones || 0); earn('stones2', r.grant.stones2 || 0); }
    train(); enhanceAll(); craftRunes(); mergeAll();
    while (st.star < 5 && st.shards >= starShards(st.star)) { st.shards -= starShards(st.star); st.star++; mark(day, 'star', `별 ${st.star}`); }
    daysLog.push({ day, level: st.level, power: power(), story: st.storyUnlocked - 1, hard: hardCounts(st), tower: st.towerBest,
      gold: st.gold, goldEarned: totals.goldEarned - goldBefore, stones: st.stones, stones2: st.stones2, stones3: st.stones3,
      enh: SLOTS.map((s) => st.gear[s] ? `${st.gear[s].r}+${st.gear[s].enh}` : '-').join(' '), newContent, usedMin: Math.round(usedMin), starvedMin: Math.round(starvedMin), bountyMin: dayBountyMin, bountyDone: dayBountyDone, hunterRank: bounty.rank, bountyMarks: bounty.marks,
      legendCounted, torment: st.tormentBest, tormentRuns: dayTormentRuns, tormentNew: dayTormentNew, legendRank: legend.rank, legendPoints: legend.points, legendFive: dayLegendFive,
      legendPowerPct: +(((basePower().power / powerWithout()) - 1) * 100).toFixed(1),
      events: events.map((e) => e.id), runes: runeCounts(), runeDust: runes.dust, runeDropped: runes.dropped, runeCrafted: runes.crafted,
      runePowerPct: +(((runePower() / basePower().power) - 1) * 100).toFixed(1) });
  }
  return { persona: personaId, seed, days: daysLog, milestones, totals, sssrDay, bountyLog, bountyMinTotal: bountyMinTotal.v };
}

function hardCounts(st) {
  const out = { adept: 0, nightmare: 0, hell: 0 };
  for (const rank of Object.values(st.peak)) for (const d of HARD) if (rank >= DIFFICULTY_ORDER.indexOf(d)) out[d]++;
  return out;
}
/**
 * 다음 새 난이도 관문: 낮은 난이도부터, 같은 난이도에서는 낮은 관문부터. 지옥은 지역 악몽 10관문 완료 필요.
 * regionFirst(마라톤): 고통 단계 T1(= 한 지역 지옥 10관문)을 가장 빨리 여는 것이 8시간 플레이어의 현실적인 행동이라, T1 이 열리기 전에는
 * 지역 하나씩 숙련→악몽→지옥을 끝낸다. 장이 늘어도(7장+) 모든 지역의 숙련·악몽을 다 거친 뒤에야 첫 지옥이 열려 S3 가 밀리지 않는다
 * (docs/SPEC_720H.md 7절). 다른 페르소나는 기존 순서 그대로다(기준선 보존).
 */
function nextHard(st, regionFirst = false) {
  if (regionFirst && !tormentOpen(st)) {
    for (let ch = 1; ch <= CHAPTERS.length; ch++) {
      const found = nextHardIn(st, (ch - 1) * STAGES_PER_CHAPTER + 1, Math.min(st.storyUnlocked - 1, ch * STAGES_PER_CHAPTER));
      if (found) return found;
    }
  }
  return nextHardIn(st, 1, st.storyUnlocked - 1);
}
function nextHardIn(st, from, to) {
  for (const diff of HARD) {
    const rank = DIFFICULTY_ORDER.indexOf(diff);
    for (let idx = from; idx <= to; idx++) {
      if ((st.peak[idx] ?? -1) >= rank) continue;
      if ((st.peak[idx] ?? -1) < rank - 1) break; // 이전 난이도를 먼저
      if (diff === 'nightmare' && (st.stars[idx] || 0) < 3) break;
      if (diff === 'hell') {
        const ch = Math.ceil(idx / STAGES_PER_CHAPTER);
        let all = true; for (let s = 1; s <= STAGES_PER_CHAPTER; s++) if ((st.peak[(ch - 1) * STAGES_PER_CHAPTER + s] ?? -1) < 2) all = false;
        if (!all) break;
      }
      return { idx, diff };
    }
  }
  return null;
}
function bestFarm(st, pw, skill) {
  let best = null, bestValue = -1;
  for (let idx = 1; idx < st.storyUnlocked; idx++) for (const diff of DIFFICULTY_ORDER) {
    const rank = DIFFICULTY_ORDER.indexOf(diff);
    if ((st.peak[idx] ?? -1) < rank || pw < stageNeed(idx, diff) * skill) continue;
    const v = runValue(idx, diff), value = (v.stageGold + v.fieldGold + (v.stones + v.stones2 * 6 + v.stones3 * 30) * 400 + v.combatExp + v.stageExp) / v.energy;
    if (value > bestValue) { bestValue = value; best = { idx, diff }; }
  }
  return best;
}

// ---------- 장 개방 ----------
// 개방표(`src/data/chapter-open.js` CHAPTER_OPEN)에 있는 장은 그 시각을 쓰고, 아직 표에 없는 장(8~12장)은 SPEC 3.3 주차를 쓴다
// (7~9장 W1, 10장 W5, 11장 W8, 12장 W11 → 0부터 센 주차 0/0/0/4/7/10). 1~6장과 표·SPEC에 없는 장은 처음부터 열려 있다.
const SPEC_OPEN_WEEKS = Object.freeze({ 7: 0, 8: 0, 9: 0, 10: 4, 11: 7, 12: 10 });
function chapterOpenDay(ch) {
  const at = chapterOpensAt(ch);
  if (at > 0 && Number.isFinite(at)) return Math.max(0, (at - SEASON_START_MS) / DAY_MS);
  return (SPEC_OPEN_WEEKS[ch] ?? 0) * 7;
}
function chapterOpenIdx(day) {
  let open = 0;
  for (let ch = 1; ch <= CHAPTERS.length; ch++) {
    if (day - 1 >= chapterOpenDay(ch)) open = ch; else break;
  }
  return open * STAGES_PER_CHAPTER;
}

// ---------- 고통 단계 선택 ----------
const HELL_RANK = DIFFICULTY_ORDER.indexOf('hell');
const NEED_BASE = [0]; for (let idx = 1; idx <= TOTAL_STAGES; idx++) NEED_BASE.push(POWER_NEED.k * Math.pow(stageDef(Math.ceil(idx / STAGES_PER_CHAPTER), ((idx - 1) % STAGES_PER_CHAPTER) + 1).scale, POWER_NEED.exp));
const TORMENT_PRESSURE = [0]; for (let t = 1; t <= TORMENT.maxTier; t++) TORMENT_PRESSURE.push(pressure(DIFFICULTIES[tormentId(t)]));
/** 고통 단계 T1 해금: 한 지역의 10관문을 모두 지옥으로 클리어. */
function tormentOpen(st) {
  for (let ch = 1; ch <= CHAPTERS.length; ch++) {
    let all = true;
    for (let s = 1; s <= STAGES_PER_CHAPTER; s++) if ((st.peak[(ch - 1) * STAGES_PER_CHAPTER + s] ?? -1) < HELL_RANK) { all = false; break; }
    if (all) return true;
  }
  return false;
}
let tormentCache = { key: '', value: null };
/**
 * 이번 판의 고통 단계 선택. 1) 다음 단계 도전: 지옥으로 클리어한 가장 쉬운 X-10 에서 best+1 (해금 규칙: 지역 최종 보스 클리어)
 * 2) 반복: 단계 1..best+1 마다 클리어 가능한 가장 높은 지옥 클리어 관문을 잡아 보상(풀 보상 판이면 골드·재료 100%, 아니면 35%)+EXP 가 가장 큰 쪽.
 */
function tormentChoice(st, pw, skill, full) {
  const key = `${Math.floor(pw / 25)}|${st.tormentBest}|${full}|${st.peakCount}`;
  if (tormentCache.key === key && tormentCache.owner === st) return tormentCache.value;
  const choose = () => {
    if (!tormentOpen(st)) return null;
    const cleared = []; for (let idx = 1; idx <= TOTAL_STAGES; idx++) if ((st.peak[idx] ?? -1) >= HELL_RANK) cleared.push(idx);
    const top = Math.min(TORMENT.maxTier, st.tormentBest + 1);
    if (st.tormentBest < TORMENT.maxTier) {
      const x10 = cleared.find((i) => i % STAGES_PER_CHAPTER === 0);
      if (x10 && pw >= NEED_BASE[x10] * TORMENT_PRESSURE[top] * skill) return { idx: x10, tier: top, push: true };
    }
    const f = full ? 1 : TORMENT.decayMul;
    let best = null, bestValue = -1;
    for (let tier = 1; tier <= top; tier++) {
      const limit = pw / (skill * TORMENT_PRESSURE[tier]);
      let lo = 0, hi = cleared.length - 1, at = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (NEED_BASE[cleared[mid]] <= limit) { at = mid; lo = mid + 1; } else hi = mid - 1; }
      if (at < 0) break; // 높은 단계일수록 요구치가 커서 더 낮은 관문도 못 깬다
      const idx = cleared[at], v = runValue(idx, tormentId(tier));
      const value = (v.stageGold + v.fieldGold + (v.stones + v.stones2 * 6 + v.stones3 * 30) * 400) * f + v.combatExp + v.stageExp;
      if (value > bestValue) { bestValue = value; best = { idx, tier, push: false }; }
    }
    return best;
  };
  const value = choose();
  tormentCache = { key, value, owner: st };
  return value;
}

// ---------- 집계 ----------
const pct = (values, p) => { const a = values.filter((v) => v !== null && Number.isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + .5))]; };
const firstDay = (run, kind, label) => run.milestones.find((m) => m.kind === kind && m.label === label)?.day ?? null;
/** 도달하지 못한 시드는 무한대(999)로 센다 — null 을 걸러내는 dist 와 달리 '일부만 일찍 도달'을 p10 에 반영한다. */
const distInf = (runs, fn) => { const a = runs.map((r) => fn(r) ?? 999).sort((x, y) => x - y); const at = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + .5))]; return { p10: at(.1), p50: at(.5), p90: at(.9) }; };
/** 마라톤 W2~W13(8일 차부터)에서 하루에 '할 일 없음' 분이 가장 컸던 값. */
const maxIdleFromW2 = (run) => Math.max(0, ...run.days.filter((d) => d.day >= 8).map((d) => d.starvedMin));
function longestStall(run, exLegend = false) {
  let best = { length: 0, from: 0, to: 0 }, cur = 0;
  for (const d of run.days) { if ((exLegend ? d.newContent - (d.legendCounted || 0) : d.newContent) > 0) cur = 0; else { cur++; if (cur > best.length) best = { length: cur, from: d.day - cur + 1, to: d.day }; } }
  return best;
}
export function summarize(runs, days) {
  const at = (run, day) => run.days[Math.min(run.days.length, day) - 1];
  const dist = (fn) => { const v = runs.map(fn); return { p10: pct(v, .1), p50: pct(v, .5), p90: pct(v, .9) }; };
  const checkpoints = [7, 14, 30, 60, 90].filter((d) => d <= days);
  const lastWeek = (run) => run.days.slice(-7);
  return {
    persona: runs[0].persona, seeds: runs.length,
    bounty: { totalMin: dist((r) => r.bountyMinTotal), done: dist((r) => r.days.reduce((a, d) => a + d.bountyDone, 0)), hunterRankEnd: dist((r) => r.days.at(-1).hunterRank), marksEnd: dist((r) => r.days.at(-1).bountyMarks) },
    milestones: {
      story_6_10: dist((r) => firstDay(r, 'story', '스토리 6-10')),
      adept_6_10: dist((r) => firstDay(r, 'adept', '숙련 6-10')),
      nightmare_6_10: dist((r) => firstDay(r, 'nightmare', '악몽 6-10')),
      hell_1_10: dist((r) => firstDay(r, 'hell', '지옥 1-10')),
      hell_6_10: dist((r) => firstDay(r, 'hell', '지옥 6-10')),
      tower_50: dist((r) => firstDay(r, 'tower', '무한의 성 50층')),
      tower_100: dist((r) => firstDay(r, 'tower', '무한의 성 100층')),
      sssr: runs[0].sssrDay,
      torment_1: dist((r) => firstDay(r, 'torment', '고통 T1')),
      torment_18: distInf(runs, (r) => firstDay(r, 'torment', '고통 T18')),
      torment_30: distInf(runs, (r) => firstDay(r, 'torment', '고통 T30')),
    },
    checkpoints: Object.fromEntries(checkpoints.map((d) => [`D${d}`, {
      level: dist((r) => at(r, d).level).p50, power: dist((r) => at(r, d).power),
      story: dist((r) => at(r, d).story).p50, adept: dist((r) => at(r, d).hard.adept).p50, nightmare: dist((r) => at(r, d).hard.nightmare).p50,
      hell: dist((r) => at(r, d).hard.hell), tower: dist((r) => at(r, d).tower), gold: dist((r) => at(r, d).gold).p50,
      enh: at(runs[0], d).enh,
      torment: dist((r) => at(r, d).torment), legendRank: dist((r) => at(r, d).legendRank), legendPowerPct: dist((r) => at(r, d).legendPowerPct),
      idleMin: dist((r) => at(r, d).starvedMin), level80Day: dist((r) => r.days.find((x) => x.level >= 80)?.day ?? null),
      runeII: dist((r) => at(r, d).runes[1]), runeIII: dist((r) => at(r, d).runes[2]), runePowerPct: dist((r) => at(r, d).runePowerPct),
      runeDust: dist((r) => at(r, d).runeDust).p50, runeDropped: dist((r) => at(r, d).runeDropped).p50, runeCrafted: dist((r) => at(r, d).runeCrafted).p50,
    }])),
    stalls: { longest: dist((r) => longestStall(r).length), example: longestStall(runs[0]) },
    newContentDays: dist((r) => r.days.filter((d) => d.newContent > 0).length),
    newContentDaysExLegend: dist((r) => r.days.filter((d) => d.newContent - d.legendCounted > 0).length),
    stallsExLegend: dist((r) => longestStall(r, true).length),
    idleMinW2toW13: dist((r) => maxIdleFromW2(r)),
    starvedMinutesPerDay: dist((r) => Math.round(r.days.slice(-30).reduce((a, d) => a + d.starvedMin, 0) / 30)),
    economy: {
      goldEarnedPerDayLastWeek: dist((r) => Math.round(lastWeek(r).reduce((a, d) => a + d.goldEarned, 0) / 7)).p50,
      goldBalanceDays: dist((r) => { const inc = lastWeek(r).reduce((a, d) => a + d.goldEarned, 0) / 7; return inc ? +(at(r, days).gold / inc).toFixed(1) : null; }),
      sinkShare: dist((r) => +(r.totals.goldSpent / Math.max(1, r.totals.goldEarned)).toFixed(2)),
      goldEarnedW1toW13: (() => { const r = runs[0]; const w = (k) => Math.round(r.days.slice(k * 7, k * 7 + 7).reduce((a, d) => a + d.goldEarned, 0) / 7); return [0, 4, 8, Math.min(12, Math.floor((days - 1) / 7))].map((k) => ({ week: k + 1, perDay: w(k) })); })(),
      enhanceTries: dist((r) => r.totals.enhanceTries).p50, trainingShare: dist((r) => +(r.totals.trainingGold / Math.max(1, r.totals.goldSpent)).toFixed(2)).p50, destroyed: dist((r) => r.totals.destroyed).p50,
    },
  };
}

/** DoD 밴드. 실패 목록을 돌려준다(빈 배열 = 통과). 기준을 약하게 바꾸면 docs/CONTENT_90D.md 에 함께 공개한다. */
export function assertBands(report) {
  const f = [], S = report.summary, mid = S.mid, light = S.light, hard = S.hardcore, days = report.assumptions.days;
  const band = (label, value, lo, hi) => { if (value === null || value === undefined || value < lo || value > hi) f.push(`${label}=${value} (기대 ${lo}~${hi})`); };
  band('미드 스토리 6-10 p50(일)', mid.milestones.story_6_10.p50, 5, 12);
  band('라이트 스토리 6-10 p50(일)', light.milestones.story_6_10.p50, 7, 24);
  band('미드 악몽 6-10 p50(일)', mid.milestones.nightmare_6_10.p50, 25, 70);
  // 룬 곡선(RUNE_AND_BLESSING_DESIGN 2.6): 일반(미드) 7일 II 2개, 30일 III 1개, 90일 III 4~6개.
  // 룬 전투력 몫(보너스층, 진행 판정 밖): 옛 출격 중 각인이 쌓던 몫을 대체하는 상·하한(지휘 결정 2026-10-24).
  const runePct = (s, d) => s.checkpoints[d]?.runePowerPct.p50;
  if (days >= 7) { band('미드 D7 룬 II 보유 p50', mid.checkpoints.D7.runeII.p50, 2, 6); band('미드 D7 룬 전투력 +% p50', runePct(mid, 'D7'), 5, 100); }
  if (days >= 30) { band('미드 D30 룬 III 보유 p50', mid.checkpoints.D30.runeIII.p50, 1, 2); band('미드 D30 룬 전투력 +% p50', runePct(mid, 'D30'), 10, 25); }
  if (days >= 90) {
    band('미드 D90 룬 III 보유 p50', mid.checkpoints.D90.runeIII.p50, 4, 6); band('미드 D90 룬 전투력 +% p50', runePct(mid, 'D90'), 20, 35);
    band('라이트 D90 룬 전투력 +% p50', runePct(light, 'D90'), 12, 100); band('하드코어 D90 룬 전투력 +% p50', runePct(hard, 'D90'), 0, 45);
  }
  if (days >= 90) {
    band('미드 D90 무한의 성 p50(층)', mid.checkpoints.D90.tower.p50, 60, 160);
    band('미드 지옥 6-10 p50(일, 미도달=999)', mid.milestones.hell_6_10.p50 ?? 999, 70, 999); // 지옥 완주는 70일 이후
    // 상한은 '전체 지옥 관문 수'다(장이 늘면 함께 늘어난다 — 의미 동일, 약화 아님).
    band('하드코어 D90 지옥 관문 p50', hard.checkpoints.D90.hell.p50, 15, TOTAL_STAGES);
    band('미드 최장 정체 p50(일)', mid.stalls.longest.p50, 0, 8); // 시드 3·4·8·16 모두 p50 7일 — 시드 수 차이 여유 1일
    band('미드 90일 중 새 진행이 있던 날 p50', mid.newContentDays.p50, 55, 90); // 시드 16에서 62일, 시드 3에서 59일
    band('미드 골드 잔액/일수입 p50(일)', mid.economy.goldBalanceDays.p50, 0, 10);
    band('하드코어 골드 잔액/일수입 p50(일)', hard.economy.goldBalanceDays.p50, 0, 14);
    // 라이트(+15에서 멈추는 신중한 강화)는 골드가 쌓인다. 상한 60일을 넘으면 새 골드 소모처가 필요하다는 신호(CONTENT_90D 5절).
    band('라이트 골드 잔액/일수입 p50(일)', light.economy.goldBalanceDays.p50, 0, 60);
  }
  // ---- 720시간 기준(docs/SPEC_720H.md 2절 S2·S3·S5) ----
  const mar = S.marathon;
  if (mar && days >= 90) {
    // S2: 주요 진행 = 새 캠페인/난이도 관문 · 새 고통 단계 · 새 탑 층 · 전설 5단위(전설만으로 채운 날은 주 3일까지만). 하한 80일은 7~12장(S6)이
    // 들어온 상태의 기준이다. 6장뿐인 지금은 그 지역 콘텐츠가 없어 도달할 수 없어 6장 하한을 따로 둔다(docs/SPEC_720H.md 7절, 장이 12개가 되면 자동으로 80).
    band(`S2 마라톤 주요 진행일 p50(${CHAPTERS.length}장 하한 ${S2_MAJOR_MIN})`, mar.newContentDays.p50, S2_MAJOR_MIN, 90);
    band('S2 마라톤 주요 진행 없는 최장 연속 p90(일)', mar.stalls.longest.p90, 0, 3);
    band('S3 마라톤 W2~W13 \'할 일 없음\' 분(일 최댓값) p90', mar.idleMinW2toW13.p90, 0, 0);
    // S5b(지휘 결정 2026-10-27): 고통 단계가 시간에 따라 계속 오르고, 장비 파워·전설 수련으로 전투력이 D30 이후에도 자란다.
    band('S5b 마라톤 D30 고통 단계 p50', mar.checkpoints.D30.torment.p50, 8, 14);
    band('S5b 마라톤 D60 고통 단계 p50', mar.checkpoints.D60.torment.p50, 15, 22);
    band('S5b 마라톤 D90 고통 단계 p50', mar.checkpoints.D90.torment.p50, 22, 32);
    band('S5b 마라톤 전투력 D60/D30 p50', +(mar.checkpoints.D60.power.p50 / mar.checkpoints.D30.power.p50).toFixed(3), 1.15, 99);
    band('S5b 마라톤 전투력 D90/D30 p50', +(mar.checkpoints.D90.power.p50 / mar.checkpoints.D30.power.p50).toFixed(3), 1.35, 99);
    band('S5 마라톤 T30 도달 p10(일, 미도달=999)', mar.milestones.torment_30.p10, 75, 999); // 단계 상한 우회 없음
    band('S5 마라톤 D90 전설 수련 전투력 +% p50', mar.checkpoints.D90.legendPowerPct.p50, 0, 30);
    band('S5 마라톤 골드 잔액/일수입 p50(일)', mar.economy.goldBalanceDays.p50, 0, 14);
  }
  if (days >= 90) band('S5 미드 D90 전설 수련 전투력 +% p50', mid.checkpoints.D90.legendPowerPct.p50, 0, 15);
  for (const id of Object.keys(PERSONAS)) { const s = S[id]; if (s.milestones.tower_100.p10 !== null && s.milestones.tower_100.p10 < 28) f.push(`${id} 무한의 성 100층 p10=${s.milestones.tower_100.p10}일(28일 미만: 시즌 상한 우회)`); }
  return f;
}

import { HERO_DIRECT_PURCHASE_GEMS } from '../src/data/hero-direct-purchase.js';
export function run90d({ days = 90, seeds = 16, tormentAll = false, only = null } = {}) {
  const summary = {}, samples = {};
  for (const id of Object.keys(PERSONAS)) {
    if (only && !only.includes(id)) continue;
    const runs = Array.from({ length: seeds }, (_, seed) => simulate(id, seed, { days, tormentAll }));
    summary[id] = summarize(runs, days);
    samples[id] = runs[0].days.filter((d) => d.day % 7 === 0 || d.day === 1);
  }
  return { assumptions: { days, seeds, personas: PERSONAS, powerNeed: POWER_NEED, tower: { baseScale: TOWER.baseScale, exponent: TOWER.exponent, capBase: TOWER.capBase, capPerWeek: TOWER.capPerWeek },
    notes: ['캠페인 기댓값은 economy-estimate.perRun(실제 Floor 방 구성·loot-tables)', '장비 드랍·강화 성공은 시드 난수, 나머지는 기댓값',
      '재료 던전·소환·결제·광고 보상은 제외(보수적)', '등급 초월일은 ECONOMY_PACE 무과금 초월일을 플레이 분량으로 환산', '요구 전투력 모델은 content-90d POWER_NEED(현행 7일 캠페인 실측으로 보정)'] },
    summary, samples, spenders: summary.mid ? spenderReport(summary.mid, days) : null };
}

if (import.meta.main) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
  const tormentAll = process.argv.includes('--torment-all');
  const report = run90d({ days: arg('days', 90), seeds: arg('seeds', 16), tormentAll });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const [id, s] of Object.entries(report.summary)) {
      console.log(`\n## ${PERSONAS[id].name} (${PERSONAS[id].minutes}분×${PERSONAS[id].sessions}세션, 손기술 ${PERSONAS[id].skill}) · 시드 ${s.seeds}`);
      console.table(Object.fromEntries(Object.entries(s.milestones).filter(([k]) => k !== 'sssr')));
      console.table(Object.fromEntries(Object.entries(s.checkpoints).map(([k, c]) => [k, { level: c.level, powerP50: c.power.p50, story: c.story, adept: c.adept, nightmare: c.nightmare, hellP50: c.hell.p50, towerP10: c.tower.p10, towerP50: c.tower.p50, towerP90: c.tower.p90, gold: c.gold, gear: c.enh }])));
      if (PERSONAS[id].torment || tormentAll) {
        console.table(Object.fromEntries(Object.entries(s.checkpoints).map(([k, c]) => [k, { level: c.level, tormentP50: c.torment.p50, tormentP10: c.torment.p10, tormentP90: c.torment.p90, legendRankP50: c.legendRank.p50, legendPct: c.legendPowerPct.p50, idleMin: c.idleMin.p50, lv80Day: c.level80Day.p50 }])));
        console.log('고통 단계 도달일:', JSON.stringify({ T1: s.milestones.torment_1, T18: s.milestones.torment_18, T30: s.milestones.torment_30 }), '· 할 일 없음 분(W2~W13 일 최댓값):', JSON.stringify(s.idleMinW2toW13));
      }
      console.log('SSSR(무과금) 일:', s.milestones.sssr, '· 최장 정체:', JSON.stringify(s.stalls), '· 새 진행일:', JSON.stringify(s.newContentDays), '· 남는 시간(분/일, 마지막 30일):', JSON.stringify(s.starvedMinutesPerDay));
      console.log('경제:', JSON.stringify(s.economy));
      console.log('룬:', JSON.stringify(Object.fromEntries(Object.entries(s.checkpoints).map(([k, c]) => [k, { II: c.runeII.p50, III: c.runeIII.p50, powerPct: c.runePowerPct.p50, dust: c.runeDust, dropped: c.runeDropped, crafted: c.runeCrafted }]))));
    }
  }
  if (!process.argv.includes('--json') && report.spenders) {
    console.log('\n## 소액 과금 페르소나 (report-only, 밴드 없음 · 기본 팩 3,900원=300보석, 30일마다 구매 · 진행 곡선은 미드 기준)');
    console.table(Object.fromEntries(Object.entries(report.spenders).map(([id, r]) => [id, { 월예산: r.monthlyKRW, 팩수: r.packsPerMonth, 월보석: r.gemsPerMonth, D30: r.paidGemsByDay.D30, D60: r.paidGemsByDay.D60, D90: r.paidGemsByDay.D90, 영입가: r.heroPrice, 첫영입일: r.firstHeroDay ?? '없음', 둘째영입일: r.secondHeroDay ?? '없음', D90영입수: r.heroesByD90 }])));
    const sp = Object.values(report.spenders)[0].progression;
    console.log('소액 과금 진행:', JSON.stringify({ SSSR일: sp.sssrDay, 최장정체: sp.longestStall, 비고: sp.note }));
  }
  if (process.argv.includes('--assert')) {
    const failures = assertBands(report);
    if (failures.length) { console.error('\n밴드 실패:\n- ' + failures.join('\n- ')); process.exit(1); }
    console.log('\n밴드 통과');
  }
}
