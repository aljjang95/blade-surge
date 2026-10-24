#!/usr/bin/env bun
// 소환 구조 90일 시뮬레이터(docs/BM_DESIGN.md 12.3). 실제 Economy.pull/pullSSR(배너 표·천장·픽업 확정·초보자 확정)을 그대로 돌린다.
//   사용: bun tools/gacha-sim.mjs [--days=90] [--seeds=200] [--json] [--assert]
// 결정적: 시드 목록이 같으면 결과가 같다. 수입은 economy-estimate.freeIncome()·PASS_TRACK·상품 표에서 읽은 기댓값(일 단위 적립).
//
// 페르소나
//  - f2p      : 무과금. 무료 수입만.
//  - monthly  : 월정액(30일마다 1,200 + 매일 100) + 시즌 패스 프리미엄 + 스타터 팩.
//  - small    : 소과금. monthly + 매월 보석 980 팩(첫 구매 2배는 1회).
// 소비 전략(전원): 초보자 20회 → 매주 SSR 확정권 즉시 사용 → 보석·소환권의 70%는 영웅 소환, 30%는 장비 소환(10회 단위).
import { EconomyCore } from '../src/game/economy-core.js';
import { createSeededRng, hashSeed } from '../src/shared/rng.js';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { PASS_TRACK, DAILY_REWARDS, SKUS } from '../src/data/shop.js';
import { GACHA_BANNERS, BANNER_EPOCH } from '../src/data/gacha-banners.js';
import { GRADE_UP_COST } from '../src/data/hero-grades.js';
import { freeIncome } from './economy-estimate.mjs';

const DAY = 86400000;
const arg = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? Number(hit.split('=')[1]) : fallback; };
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);

// 캠페인 첫 클리어(60관문) 완주 일수: hero-roster.js 근거 주석(sim:90d 중앙값)과 같은 가정.
export const PERSONAS = Object.freeze({
  f2p: { id: 'f2p', name: '무과금', campaignDays: 30, monthly: false, pass: false, starter: false, monthlyGemPack: 0 },
  monthly: { id: 'monthly', name: '월정액+패스', campaignDays: 30, monthly: true, pass: true, starter: true, monthlyGemPack: 0 },
  small: { id: 'small', name: '소과금(월 약 ₩28k)', campaignDays: 30, monthly: true, pass: true, starter: true, monthlyGemPack: 980 },
});

/** 하루치 수입(기댓값을 날짜에 나눠 적립). day는 1부터. */
export function incomeOn(persona, day) {
  const free = freeIncome(), out = { gems: 0, tickets: 0, ssrTicket: 0, transcendStones: 0 };
  if (day === 1) {
    const o = free.oneTime; out.gems += o.mail.gems + o.quests.gems; out.tickets += o.mail.tickets + o.quests.tickets;
  }
  if (day <= persona.campaignDays) { out.gems += free.oneTime.firstClearAll60.gems / persona.campaignDays; out.tickets += free.oneTime.firstClearAll60.tickets / persona.campaignDays; }
  const login = DAILY_REWARDS[(day - 1) % DAILY_REWARDS.length];
  out.gems += login.gems || 0; out.tickets += login.tickets || 0; out.ssrTicket += login.ssrTicket || 0;
  const season = 84, freeTrack = free.passFreeTrackTotal; out.gems += freeTrack.gems / season; out.tickets += freeTrack.tickets / season;
  out.gems += 20; // 무한의 성·이벤트(hero-roster.js 근거 주석과 같은 값)
  if (persona.pass) { const prem = {}; for (const t of PASS_TRACK) for (const [k, v] of Object.entries(t.prem)) prem[k] = (prem[k] || 0) + v; out.gems += prem.gems / season; out.tickets += prem.tickets / season; out.transcendStones += prem.transcendStones / season; if (day % 28 === 0) out.ssrTicket += 1; }
  if (persona.monthly) { out.gems += 100; if ((day - 1) % 30 === 0) out.gems += 1200; }
  if (persona.starter && day === 1) { const st = SKUS.find((s) => s.id === 'starter').rewards; out.gems += st.gems; out.ssrTicket += st.ssrTicket; }
  if (persona.monthlyGemPack && (day - 1) % 30 === 0) out.gems += persona.monthlyGemPack * (day === 1 ? 2 : 1);
  return out;
}

export function simulate(personaId, seed, { days = 90 } = {}) {
  const persona = PERSONAS[personaId];
  let t = BANNER_EPOCH + 3600000;
  const eco = new EconomyCore({ now: () => t, gachaRng: createSeededRng(hashSeed('gacha-sim', personaId, seed)), rng: createSeededRng(hashSeed('gacha-sim-rule', personaId, seed)) });
  eco.chooseStarter('mage');
  const wallet = { gems: 0, tickets: 0 }, log = { ssrHero: [], ssrGear: [], featuredHero: 0, featuredGear: 0, pulls: { beginner: 0, hero: 0, gear: 0 } };
  const firstOwnedAll = { day: null }, srAll = { day: null };
  const firstSsrHeroDay = { day: null };
  let carryGems = 0, carryTickets = 0;
  const record = (results, banner, day) => {
    log.pulls[banner] += results.length;
    for (const r of results) {
      if (r.rar !== 'SSR') continue;
      if (r.type === 'hero') { log.ssrHero.push({ day, id: r.id }); if (r.featured) log.featuredHero++; firstSsrHeroDay.day ??= day; }
      else if (r.type === 'item') { log.ssrGear.push({ day, id: r.item.id, set: ITEM_BY_ID[r.item.id].set }); if (r.featured) log.featuredGear++; }
    }
  };
  for (let day = 1; day <= days; day++) {
    t = BANNER_EPOCH + (day - 1) * DAY + 3600000;
    const inc = incomeOn(persona, day);
    carryGems += inc.gems; carryTickets += inc.tickets;
    const gemsIn = Math.floor(carryGems), ticketsIn = Math.floor(carryTickets); carryGems -= gemsIn; carryTickets -= ticketsIn;
    eco.s.gems += gemsIn; eco.s.tickets += ticketsIn; eco.s.ssrTickets += inc.ssrTicket; eco.s.transcendStones += inc.transcendStones;
    wallet.gems += gemsIn; wallet.tickets += ticketsIn;
    while (eco.s.ssrTickets > 0) { const r = eco.pullSSR(); if (!r) break; record(r, 'hero', day); }
    while (eco.beginnerLeft() >= 10) { const r = eco.pull(10, 'beginner'); if (!r) break; record(r, 'beginner', day); }
    // 영웅 70% · 장비 30%(누적 소환 수 기준으로 맞춘다).
    for (;;) {
      const heroShare = log.pulls.hero / Math.max(1, log.pulls.hero + log.pulls.gear);
      const banner = heroShare < 0.7 ? 'hero' : 'gear';
      const r = eco.pull(10, banner); if (!r) break; record(r, banner, day);
    }
    if (firstOwnedAll.day === null && HERO_ORDER.every((id) => eco.ownHero(id))) firstOwnedAll.day = day;
    if (srAll.day === null && HERO_ORDER.filter((id) => HEROES[id].rarity === 'SR').every((id) => eco.ownHero(id))) srAll.day = day;
  }
  // SSSR 가능 시점: 가장 많이 나온 SSR 영웅의 조각으로 SR→SSR 단계 없이 SSR→SSSR 조각 요구량(220)을 채웠는지(초월석·골드는 별도 병목).
  const shardsBest = Math.max(0, ...HERO_ORDER.filter((id) => HEROES[id].rarity === 'SSR').map((id) => eco.hero(id).shards));
  return {
    persona: personaId, seed, gems: wallet.gems, tickets: wallet.tickets,
    ssrHeroCopies: log.ssrHero.length, ssrHeroDistinct: new Set(log.ssrHero.map((x) => x.id)).size, featuredHero: log.featuredHero,
    firstSsrHeroDay: firstSsrHeroDay.day, allHeroesDay: firstOwnedAll.day, allSrDay: srAll.day,
    ssrGear: log.ssrGear.length, featuredGear: log.featuredGear,
    featuredSetPieces: new Set(log.ssrGear.filter((x) => x.set).map((x) => x.id)).size,
    bestSsrShards: shardsBest, sssrShardReady: shardsBest >= GRADE_UP_COST.SSSR.shards, pulls: log.pulls,
  };
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
export function summarize(runs) {
  const keys = ['gems', 'tickets', 'ssrHeroCopies', 'ssrHeroDistinct', 'featuredHero', 'firstSsrHeroDay', 'allHeroesDay', 'allSrDay', 'ssrGear', 'featuredGear', 'featuredSetPieces', 'bestSsrShards'];
  const out = { seeds: runs.length, sssrShardReadyShare: runs.filter((r) => r.sssrShardReady).length / runs.length, pulls: { hero: sum(runs.map((r) => r.pulls), 'hero') / runs.length, gear: sum(runs.map((r) => r.pulls), 'gear') / runs.length } };
  for (const k of keys) {
    const vals = runs.map((r) => r[k]).filter((v) => v !== null).sort((a, b) => a - b);
    out[k] = vals.length ? { p10: pct(vals, 0.1), p50: pct(vals, 0.5), p90: pct(vals, 0.9), mean: vals.reduce((a, b) => a + b, 0) / vals.length, missing: runs.length - vals.length } : null;
  }
  return out;
}

/** 설계 밴드(12.3). 깨지면 --assert가 실패한다. */
export function assertBands(S, days) {
  const f = [];
  if (days >= 90) {
    const f2p = S.f2p, mon = S.monthly, small = S.small;
    if (f2p.firstSsrHeroDay.p90 > 1) f.push(`무과금 첫 SSR 영웅 p90=${f2p.firstSsrHeroDay.p90}일(초보자 20회 확정으로 1일 안)`);
    if (!f2p.allSrDay || f2p.allSrDay.missing > f2p.seeds * 0.05 || f2p.allSrDay.p90 > 21) f.push(`무과금 SR 영웅 전원 p90=${f2p.allSrDay?.p90}일(21일 안)`);
    if (f2p.ssrHeroCopies.p50 < 3 || f2p.ssrHeroCopies.p50 > 8) f.push(`무과금 90일 SSR 영웅 사본 p50=${f2p.ssrHeroCopies.p50}(밴드 3~8)`);
    // 픽업 획득은 정수라 중앙값이 1·2 경계에서 시드마다 흔들린다. 평균으로 고정한다(무과금 실측 약 1.7).
    if (f2p.featuredHero.mean < 1.5) f.push(`무과금 픽업 획득 평균=${f2p.featuredHero.mean.toFixed(2)}(최소 1.5: 교대 6회 중 4분의 1)`);
    if (mon.featuredHero.mean < 2.7) f.push(`월정액+패스 픽업 획득 평균=${mon.featuredHero.mean.toFixed(2)}(최소 2.7: 교대 6회 중 절반)`);
    if (small.ssrHeroCopies.p50 < f2p.ssrHeroCopies.p50 * 1.5) f.push('과금 페르소나의 SSR 영웅 사본이 무과금의 1.5배 이상이어야 한다');
    if (f2p.ssrGear.p50 < 2) f.push(`무과금 SSR 장비 p50=${f2p.ssrGear.p50}(최소 2)`);
    if (S.f2p.sssrShardReadyShare > 0.1) f.push(`무과금 90일 SSSR 조각 충족 ${(S.f2p.sssrShardReadyShare * 100).toFixed(0)}%(10% 이하: SSSR은 장기 목표)`);
    if (S.monthly.sssrShardReadyShare > 0.6) f.push(`월정액+패스 90일 SSSR 조각 충족 ${(S.monthly.sssrShardReadyShare * 100).toFixed(0)}%(60% 이하)`);
  }
  return f;
}

if (import.meta.main) {
  const days = arg('days', 90), seeds = arg('seeds', 200);
  const S = {};
  for (const id of Object.keys(PERSONAS)) S[id] = summarize(Array.from({ length: seeds }, (_, i) => simulate(id, i, { days })));
  const failures = process.argv.includes('--assert') ? assertBands(S, days) : [];
  if (process.argv.includes('--json')) console.log(JSON.stringify({ days, seeds, banners: GACHA_BANNERS, personas: PERSONAS, summary: S, failures }, null, 2));
  else {
    for (const id of Object.keys(PERSONAS)) {
      const s = S[id], q = (k) => (s[k] ? `${s[k].p10}/${s[k].p50}/${s[k].p90}` : '-');
      console.log(`## ${PERSONAS[id].name} · ${days}일 · 시드 ${seeds} (p10/p50/p90)`);
      console.log(`  수입 보석 ${q('gems')} · 소환권 ${q('tickets')} · 소환 영웅 ${Math.round(s.pulls.hero)}회 / 장비 ${Math.round(s.pulls.gear)}회`);
      console.log(`  SSR 영웅 사본 ${q('ssrHeroCopies')} · 서로 다른 SSR ${q('ssrHeroDistinct')} · 픽업 ${q('featuredHero')} · 첫 SSR ${q('firstSsrHeroDay')}일 · SR 전원 ${q('allSrDay')}일 · 영웅 5명 ${q('allHeroesDay')}일`);
      console.log(`  SSR 장비 ${q('ssrGear')} · 픽업 세트 ${q('featuredGear')} · 세트 서로 다른 부위 ${q('featuredSetPieces')} · 최다 SSR 조각 ${q('bestSsrShards')} · SSSR 조각 충족 ${(s.sssrShardReadyShare * 100).toFixed(0)}%`);
    }
    if (failures.length) { console.log('\n밴드 실패:'); for (const f of failures) console.log('  - ' + f); }
  }
  if (failures.length) process.exit(1);
}
