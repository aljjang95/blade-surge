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
import { perRun, TOTAL_STAGES } from './economy-estimate.mjs';
import { stageDef, CHAPTERS, STAGES_PER_CHAPTER } from '../src/data/stages.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../src/game/difficulty.js';
import { TOWER, POWER_NEED, SEASON } from '../src/data/content-90d.js';
import { towerScale, towerFirstClearRewards, towerCap, activeEvents, applyEventRewards, seasonAt } from '../src/game/endgame-core.js';
import { HEROES, heroStats, levelExp, starShards } from '../src/data/heroes.js';
import { heroTrainingQuote } from '../src/game/hero-training.js';
import { ITEMS_OF, itemStats, SLOTS, RARITIES, enhanceCost, enhanceStones, enhanceChance, enhanceDown, destroyChance, enhanceStoneTier, STONE_KEY } from '../src/data/items.js';
import { lootTable, levelExperienceMultiplier, recommendedLevel } from '../src/data/loot-tables.js';
import { ENERGY } from '../src/data/shop.js';
import { ECONOMY_PACE } from '../src/data/economy-pace.js';
import { DAILY_CONTRACTS, WEEKLY_CONTRACTS } from '../src/data/journey.js';
import { createSeededRng, hashSeed } from '../src/shared/rng.js';
import { RUNE_SOURCES, RUNE_MERGE_COST, RUNE_DUPLICATE_CAP } from '../src/data/runes.js';
import { socketCount, runeEffects } from '../src/game/rune-core.js';
import { rollRuneDrops, giftBag } from '../src/game/rune-economy.js';
import { applyBuildStats } from '../src/game/masterworks-combat.js';

const DAY_MS = 86400000;
export const PERSONAS = Object.freeze({
  light: { id: 'light', name: '라이트', minutes: 15, sessions: 1, skill: 1.1, enhCap: 15, towerShare: .3, hero: 'knight' },
  mid: { id: 'mid', name: '미드(일반)', minutes: 30, sessions: 2, skill: 1, enhCap: 20, towerShare: .3, hero: 'knight' },
  hardcore: { id: 'hardcore', name: '하드코어', minutes: 100, sessions: 3, skill: 0.88, enhCap: 20, towerShare: .3, hero: 'knight' },
});
const MIN_STAGE = 3, MIN_HARD = 4;
// 룬 정밀 제작 우선순위: 전투력에 직접 들어가는 효과(공격력·최대 체력)부터. III 를 먼저 완성한다(같은 룬 2개 상한).
// 출격 중 각인(2026-10-24 제거)과 룬: 시뮬레이터는 숙련·세트·스킬처럼 출격 중 각인도 진행 판정 전투력에서 뺐다(POWER_NEED 는 그 기준으로 맞춤).
// 룬은 각인의 대체이므로 같은 방식으로 진행 판정에서 빼고, 룬 전투력 몫(runePowerPct)을 따로 재서 공백을 메우는지 밴드로 단언한다.
// 옛 흐름의 출격 평균 각인 몫(추정, 실측 아님): 출격당 최대 6회 선택, 공격력 4~5%·최대 체력 6~7% → 출격 평균 약 +15%.
// (실험 2026-10-24: 룬 전투력을 진행 판정에 넣으면 +19%만으로도 미드 D90 무한의 성이 상한 210층에 닿아 D8 밴드를 깬다.)
export const REMOVED_BOON_POWER = 0.15;
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
  const base = perRun(idx, { fullClear: true }), d = DIFFICULTIES[diffId], dRank = DIFFICULTY_ORDER.indexOf(diffId), ch = base.ch;
  const stage = stageDef(ch, base.st), out = { idx, ch, st: base.st, energy: base.energy, boss: base.boss, firstGems: base.firstGems,
    stageGold: Math.floor(base.stageGold * d.rewardMul), fieldGold: base.fieldGold * (1 + dRank * .2), combatExp: base.combatExp,
    stageExp: Math.floor(stage.rewards.exp * 1.5 * d.expMul), stones: stage.rewards.stones, stones2: 0, stones3: 0,
    heroShards: base.heroShards, transcendStones: base.transcendStones, kills: base.kills, recLevel: recommendedLevel(ch, base.st) };
  for (const rank of ['normal', 'elite', 'boss']) {
    const t = lootTable(ch, rank, diffId), n = base.kills[rank];
    out.stones += n * t.stones * t.stoneChance; out.stones2 += n * t.stones2; out.stones3 += n * t.stones3;
  }
  runCache.set(key, out); return out;
}

// ---------- 장비 ----------
const ITEM_OF = Object.fromEntries(RARITIES.map((r) => [r, Object.fromEntries(SLOTS.map((s) => [s, ITEMS_OF(r, s)[0]?.id]))]));
const slotScore = (it) => { if (!it) return 0; const st = itemStats({ id: ITEM_OF[it.r][it.slot], enh: it.enh }); return st.atk * 6 + st.hp * .5 + st.def * 4 + st.crit * 1000; };
function equipBonus(gear) {
  const b = { atk: 0, hp: 0, def: 0, crit: 0 };
  for (const slot of SLOTS) { const it = gear[slot]; if (!it) continue; const st = itemStats({ id: ITEM_OF[it.r][slot], enh: it.enh }); for (const k in b) b[k] += st[k]; }
  return b;
}
function pickWeighted(weights, rng) {
  let r = rng() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { r -= w; if (r < 0) return k; }
  return 'L';
}

// ---------- 한 페르소나 × 한 시드 ----------
export function simulate(personaId, seed, { days = 90 } = {}) {
  const P = PERSONAS[personaId], rng = createSeededRng(hashSeed('sim-90d', personaId, seed)), def = HEROES[P.hero];
  const st = { level: 1, exp: 0, star: 1, shards: 0, grade: def.rarity, gold: 12000, stones: 12, stones2: 0, stones3: 0, gems: 1500, transcendStones: 0,
    energy: ENERGY.max, gear: Object.fromEntries(SLOTS.map((s) => [s, null])), storyUnlocked: 1, peak: {}, stars: {}, towerBest: 0, towerWeekCleared: 0, towerChestWeek: -1 };
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
    while (runes.dust >= RUNE_SOURCES.craftExact.runeDust + reserve) { runes.dust -= RUNE_SOURCES.craftExact.runeDust; addRune(craftTarget(), 1); runes.crafted++; mergeAll(); }
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
  const basePower = () => heroStats(def, { level: st.level, star: st.star, grade: st.grade }, equipBonus(st.gear));
  const runePower = () => { const b = basePower(), fx = runeFx(); return Object.keys(fx).length ? applyBuildStats(b, fx).power : b.power; };
  const power = () => basePower().power;
  const gainExp = (n) => { st.exp += n; while (st.level < 80 && st.exp >= levelExp(st.level)) { st.exp -= levelExp(st.level); st.level++; } };
  const earn = (k, n) => { if (!n) return; st[k] += n; if (k === 'gold') totals.goldEarned += n; };
  const mark = (day, kind, label) => milestones.push({ day, kind, label });

  const dropGear = (ch, rank, diffId, count) => {
    const t = lootTable(ch, rank, diffId);
    for (let i = 0; i < count; i++) {
      if (rng() >= t.gearChance) continue;
      for (let k = 0; k < t.gearRolls; k++) {
        const r = pickWeighted(t.gearWeights, rng), slot = SLOTS[Math.floor(rng() * SLOTS.length)];
        const cand = { r, slot, enh: 0 };
        const old = st.gear[slot];
        if (slotScore(cand) > slotScore(old && { ...old, slot })) { st.gear[slot] = { r, enh: 0 }; runes.dirty = true; if (old) { runes.dust += RUNE_SOURCES.dismantleDust[old.r] || 0; } }
        else runes.dust += RUNE_SOURCES.dismantleDust[r] || 0; // 쓰지 않는 유니크·레전드리는 분해(룬 가루)
      }
    }
  };
  const playStage = (idx, diffId, events, day) => {
    const v = runValue(idx, diffId), first = diffId === 'story' && !st.stars[idx];
    const comp = applyEventRewards({ gold: v.stageGold, exp: v.stageExp, stones: v.stones }, events, 'campaign');
    earn('gold', Math.floor(comp.gold + v.fieldGold)); earn('stones', Math.floor(comp.stones)); earn('stones2', Math.floor(v.stones2)); earn('stones3', Math.floor(v.stones3));
    if (first) earn('gems', v.firstGems);
    gainExp(v.combatExp + Math.floor(comp.exp * levelExperienceMultiplier(st.level, v.recLevel)));
    st.shards += v.heroShards; st.transcendStones += v.transcendStones;
    // 처치 수는 기댓값을 반올림해 장비 드랍을 굴린다(보스 1·정예·일반).
    dropGear(v.ch, 'boss', diffId, Math.round(v.kills.boss)); dropGear(v.ch, 'elite', diffId, Math.round(v.kills.elite)); dropGear(v.ch, 'normal', diffId, Math.round(v.kills.normal));
    // 룬 드랍·완료 상자 룬 가루: 게임 정산과 같은 rollRuneDrops(정예·보스 처치 수, 지옥 = 심층 보스 판정).
    const rr = rollRuneDrops({ elite: Math.round(v.kills.elite), boss: Math.round(v.kills.boss) }, { hell: diffId === 'hell', first }, Math.floor(runeRng() * 4294967296));
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
    if (weekIndex !== st.towerWeek) { st.towerWeek = weekIndex; st.towerWeekCleared = 0; st.weekly = { hard: 0, tower: 0, boss: 0, upgrades: 0 }; }
    if (day === sssrDay && st.grade !== 'SSSR') { st.grade = 'SSSR'; mark(day, 'grade', '주력 영웅 SSSR(무과금 초월)'); }
    st.dailyUpgrades = 0; let dayHard = 0, dayTower = 0, dayBoss = 0, newContent = 0, usedMin = 0, starvedMin = 0;
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
      st.energy = ENERGY.max; // 세션 사이 회복(밤·낮 간격 ≥ 5시간 = 100 에너지)
      let time = P.minutes / P.sessions;
      while (time > 0) {
        const pw = power(), ok = (need) => pw >= need * P.skill;
        let acted = false;
        // 1) 새 캠페인 관문(스토리)
        if (st.storyUnlocked <= TOTAL_STAGES && time >= MIN_STAGE) {
          const idx = st.storyUnlocked, v = runValue(idx, 'story');
          if (ok(stageNeed(idx)) && st.energy >= v.energy) {
            st.energy -= v.energy; time -= MIN_STAGE; playStage(idx, 'story', events, day);
            st.stars[idx] = pw >= stageNeed(idx) * P.skill * 1.08 ? 3 : 2; st.peak[idx] = 0; st.storyUnlocked++; newContent++; if (v.boss) dayBoss++;
            if (v.st === STAGES_PER_CHAPTER) mark(day, 'story', `스토리 ${v.ch}-10`);
            acted = true;
          }
        }
        // 1a) 무한의 성은 에너지가 들지 않아 매 세션 먼저 오른다(하루 시간의 towerShare 까지). 일일 임무 '성의 다음 층'.
        if (!acted && towerTry(time)) { time -= TOWER.minutesPerFloor; acted = true; }
        // 1b) 새 난이도 관문: 숙련(스토리 클리어) → 악몽(별 3) → 지옥(지역 악몽 전부). 지역 순서대로.
        if (!acted && time >= MIN_HARD) {
          const next = nextHard(st);
          if (next) {
            const v = runValue(next.idx, next.diff);
            if (ok(stageNeed(next.idx, next.diff)) && st.energy >= v.energy) {
              st.energy -= v.energy; time -= MIN_HARD; playStage(next.idx, next.diff, events, day);
              st.peak[next.idx] = DIFFICULTY_ORDER.indexOf(next.diff); if (next.diff === 'adept' || next.diff === 'nightmare') st.stars[next.idx] = 3;
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
        if (!acted) { starvedMin += time; break; }
        train(); enhanceAll();
      }
      usedMin += P.minutes / P.sessions;
    }
    usedMin -= starvedMin;
    // 일일·주간 임무: 시뮬레이터가 모형화한 통계(탑·하드·보스·강화)만 센다. 재료 던전·소환 임무는 제외(보수적).
    const daily = { towerFloors: dayTower, hardClears: dayHard, bossAttempts: dayBoss, upgrades: st.dailyUpgrades };
    st.weekly.hard += dayHard; st.weekly.tower += dayTower; st.weekly.boss += dayBoss; st.weekly.upgrades += st.dailyUpgrades;
    for (const c of DAILY_CONTRACTS) if (c.stat in daily && daily[c.stat] >= c.target) { earn('gold', c.rewards.gold || 0); earn('stones', c.rewards.stones || 0); }
    if (season.day === 6) { // 주의 마지막 날 주간 임무·탑 보급 정산
      const weekly = { towerFloors: st.weekly.tower, hardClears: st.weekly.hard, bossAttempts: st.weekly.boss, upgrades: st.weekly.upgrades };
      for (const c of WEEKLY_CONTRACTS) if (c.stat in weekly && weekly[c.stat] >= c.target) { earn('gold', c.rewards.gold || 0); earn('stones', c.rewards.stones || 0); }
      runes.dust += RUNE_SOURCES.weeklyDust; // 주간 의뢰 첫 수령 룬 가루
      const tier = [...TOWER.weeklyChest].reverse().find((row) => st.towerBest >= row.floor);
      if (tier && st.towerWeekCleared > 0) for (const k of ['gold', 'stones', 'stones2', 'stones3', 'gems']) earn(k, tier[k] || 0);
    }
    train(); enhanceAll(); craftRunes(); mergeAll();
    while (st.star < 5 && st.shards >= starShards(st.star)) { st.shards -= starShards(st.star); st.star++; mark(day, 'star', `별 ${st.star}`); }
    daysLog.push({ day, level: st.level, power: power(), story: st.storyUnlocked - 1, hard: hardCounts(st), tower: st.towerBest,
      gold: st.gold, goldEarned: totals.goldEarned - goldBefore, stones: st.stones, stones2: st.stones2, stones3: st.stones3,
      enh: SLOTS.map((s) => st.gear[s] ? `${st.gear[s].r}+${st.gear[s].enh}` : '-').join(' '), newContent, usedMin: Math.round(usedMin), starvedMin: Math.round(starvedMin),
      events: events.map((e) => e.id), runes: runeCounts(), runeDust: runes.dust, runeDropped: runes.dropped, runeCrafted: runes.crafted,
      runePowerPct: +(((runePower() / basePower().power) - 1) * 100).toFixed(1) });
  }
  return { persona: personaId, seed, days: daysLog, milestones, totals, sssrDay };
}

function hardCounts(st) {
  const out = { adept: 0, nightmare: 0, hell: 0 };
  for (const rank of Object.values(st.peak)) for (const d of HARD) if (rank >= DIFFICULTY_ORDER.indexOf(d)) out[d]++;
  return out;
}
/** 다음 새 난이도 관문: 낮은 난이도부터, 같은 난이도에서는 낮은 관문부터. 지옥은 지역 악몽 10관문 완료 필요. */
function nextHard(st) {
  for (const diff of HARD) {
    const rank = DIFFICULTY_ORDER.indexOf(diff);
    for (let idx = 1; idx < st.storyUnlocked; idx++) {
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

// ---------- 집계 ----------
const pct = (values, p) => { const a = values.filter((v) => v !== null && Number.isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + .5))]; };
const firstDay = (run, kind, label) => run.milestones.find((m) => m.kind === kind && m.label === label)?.day ?? null;
function longestStall(run) {
  let best = { length: 0, from: 0, to: 0 }, cur = 0;
  for (const d of run.days) { if (d.newContent > 0) cur = 0; else { cur++; if (cur > best.length) best = { length: cur, from: d.day - cur + 1, to: d.day }; } }
  return best;
}
export function summarize(runs, days) {
  const at = (run, day) => run.days[Math.min(run.days.length, day) - 1];
  const dist = (fn) => { const v = runs.map(fn); return { p10: pct(v, .1), p50: pct(v, .5), p90: pct(v, .9) }; };
  const checkpoints = [7, 14, 30, 60, 90].filter((d) => d <= days);
  const lastWeek = (run) => run.days.slice(-7);
  return {
    persona: runs[0].persona, seeds: runs.length,
    milestones: {
      story_6_10: dist((r) => firstDay(r, 'story', '스토리 6-10')),
      adept_6_10: dist((r) => firstDay(r, 'adept', '숙련 6-10')),
      nightmare_6_10: dist((r) => firstDay(r, 'nightmare', '악몽 6-10')),
      hell_1_10: dist((r) => firstDay(r, 'hell', '지옥 1-10')),
      hell_6_10: dist((r) => firstDay(r, 'hell', '지옥 6-10')),
      tower_50: dist((r) => firstDay(r, 'tower', '무한의 성 50층')),
      tower_100: dist((r) => firstDay(r, 'tower', '무한의 성 100층')),
      sssr: runs[0].sssrDay,
    },
    checkpoints: Object.fromEntries(checkpoints.map((d) => [`D${d}`, {
      level: dist((r) => at(r, d).level).p50, power: dist((r) => at(r, d).power),
      story: dist((r) => at(r, d).story).p50, adept: dist((r) => at(r, d).hard.adept).p50, nightmare: dist((r) => at(r, d).hard.nightmare).p50,
      hell: dist((r) => at(r, d).hard.hell), tower: dist((r) => at(r, d).tower), gold: dist((r) => at(r, d).gold).p50,
      enh: at(runs[0], d).enh,
      runeII: dist((r) => at(r, d).runes[1]), runeIII: dist((r) => at(r, d).runes[2]), runePowerPct: dist((r) => at(r, d).runePowerPct),
      runeDust: dist((r) => at(r, d).runeDust).p50, runeDropped: dist((r) => at(r, d).runeDropped).p50, runeCrafted: dist((r) => at(r, d).runeCrafted).p50,
    }])),
    stalls: { longest: dist((r) => longestStall(r).length), example: longestStall(runs[0]) },
    newContentDays: dist((r) => r.days.filter((d) => d.newContent > 0).length),
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
  // 출격 중 각인 제거(2026-10-24)로 빠진 전투력을 룬이 메우는지: 미드 D30·D90 룬 전투력 몫 ≥ 옛 각인 평균 몫(REMOVED_BOON_POWER).
  if (days >= 7) band('미드 D7 룬 II 보유 p50', mid.checkpoints.D7.runeII.p50, 2, 6);
  if (days >= 30) { band('미드 D30 룬 III 보유 p50', mid.checkpoints.D30.runeIII.p50, 1, 2); band('미드 D30 룬 전투력 +% p50(옛 각인 몫 이상)', mid.checkpoints.D30.runePowerPct.p50, REMOVED_BOON_POWER * 100, 40); }
  if (days >= 90) { band('미드 D90 룬 III 보유 p50', mid.checkpoints.D90.runeIII.p50, 4, 6); band('미드 D90 룬 전투력 +% p50', mid.checkpoints.D90.runePowerPct.p50, REMOVED_BOON_POWER * 100, 60); }
  if (days >= 90) {
    band('미드 D90 무한의 성 p50(층)', mid.checkpoints.D90.tower.p50, 60, 160);
    band('미드 지옥 6-10 p50(일, 미도달=999)', mid.milestones.hell_6_10.p50 ?? 999, 70, 999); // 지옥 완주는 70일 이후
    band('하드코어 D90 지옥 관문 p50', hard.checkpoints.D90.hell.p50, 15, 60);
    band('미드 최장 정체 p50(일)', mid.stalls.longest.p50, 0, 8); // 시드 3·4·8·16 모두 p50 7일 — 시드 수 차이 여유 1일
    band('미드 90일 중 새 진행이 있던 날 p50', mid.newContentDays.p50, 55, 90); // 시드 16에서 62일, 시드 3에서 59일
    band('미드 골드 잔액/일수입 p50(일)', mid.economy.goldBalanceDays.p50, 0, 10);
    band('하드코어 골드 잔액/일수입 p50(일)', hard.economy.goldBalanceDays.p50, 0, 14);
    // 라이트(+15에서 멈추는 신중한 강화)는 골드가 쌓인다. 상한 60일을 넘으면 새 골드 소모처가 필요하다는 신호(CONTENT_90D 5절).
    band('라이트 골드 잔액/일수입 p50(일)', light.economy.goldBalanceDays.p50, 0, 60);
  }
  for (const id of Object.keys(PERSONAS)) { const s = S[id]; if (s.milestones.tower_100.p10 !== null && s.milestones.tower_100.p10 < 28) f.push(`${id} 무한의 성 100층 p10=${s.milestones.tower_100.p10}일(28일 미만: 시즌 상한 우회)`); }
  return f;
}

export function run90d({ days = 90, seeds = 16 } = {}) {
  const summary = {}, samples = {};
  for (const id of Object.keys(PERSONAS)) {
    const runs = Array.from({ length: seeds }, (_, seed) => simulate(id, seed, { days }));
    summary[id] = summarize(runs, days);
    samples[id] = runs[0].days.filter((d) => d.day % 7 === 0 || d.day === 1);
  }
  return { assumptions: { days, seeds, personas: PERSONAS, powerNeed: POWER_NEED, tower: { baseScale: TOWER.baseScale, exponent: TOWER.exponent, capBase: TOWER.capBase, capPerWeek: TOWER.capPerWeek },
    notes: ['캠페인 기댓값은 economy-estimate.perRun(실제 Floor 방 구성·loot-tables)', '장비 드랍·강화 성공은 시드 난수, 나머지는 기댓값',
      '재료 던전·소환·결제·광고 보상은 제외(보수적)', '등급 초월일은 ECONOMY_PACE 무과금 초월일을 플레이 분량으로 환산', '요구 전투력 모델은 content-90d POWER_NEED(현행 7일 캠페인 실측으로 보정)'] },
    summary, samples };
}

if (import.meta.main) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
  const report = run90d({ days: arg('days', 90), seeds: arg('seeds', 16) });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const [id, s] of Object.entries(report.summary)) {
      console.log(`\n## ${PERSONAS[id].name} (${PERSONAS[id].minutes}분×${PERSONAS[id].sessions}세션, 손기술 ${PERSONAS[id].skill}) · 시드 ${s.seeds}`);
      console.table(Object.fromEntries(Object.entries(s.milestones).filter(([k]) => k !== 'sssr')));
      console.table(Object.fromEntries(Object.entries(s.checkpoints).map(([k, c]) => [k, { level: c.level, powerP50: c.power.p50, story: c.story, adept: c.adept, nightmare: c.nightmare, hellP50: c.hell.p50, towerP10: c.tower.p10, towerP50: c.tower.p50, towerP90: c.tower.p90, gold: c.gold, gear: c.enh }])));
      console.log('SSSR(무과금) 일:', s.milestones.sssr, '· 최장 정체:', JSON.stringify(s.stalls), '· 새 진행일:', JSON.stringify(s.newContentDays), '· 남는 시간(분/일, 마지막 30일):', JSON.stringify(s.starvedMinutesPerDay));
      console.log('경제:', JSON.stringify(s.economy));
      console.log('룬:', JSON.stringify(Object.fromEntries(Object.entries(s.checkpoints).map(([k, c]) => [k, { II: c.runeII.p50, III: c.runeIII.p50, powerPct: c.runePowerPct.p50, dust: c.runeDust, dropped: c.runeDropped, crafted: c.runeCrafted }]))));
    }
  }
  if (process.argv.includes('--assert')) {
    const failures = assertBands(report);
    if (failures.length) { console.error('\n밴드 실패:\n- ' + failures.join('\n- ')); process.exit(1); }
    console.log('\n밴드 통과');
  }
}
