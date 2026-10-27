// 엔드게임 상태(무한의 성·난이도 최고 기록·시즌 이벤트)의 순수 규칙. 시계는 호출자가 넘긴다(nowMs).
// 저장 트랜잭션은 호출자(Economy)가 맡고, 여기서는 상태를 검사·갱신하고 지급할 보상만 돌려준다.
import { SEASON, TOWER, TORMENT, EVENT_WEEKS, EVENT_EFFECT_KINDS } from '../data/content-90d.js';
import { stageDef, CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';
import { DIFFICULTY_ORDER } from './difficulty.js';
import { recommendedLevel } from '../data/loot-tables.js';

const DAY_MS = 86400000, WEEK_MS = 7 * DAY_MS, KST_RESET = 4 * 3600000, VERSION = 1, MAX_FLOOR = 100000;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, min, max, fallback = min) => Number.isSafeInteger(v) ? Math.max(min, Math.min(max, v)) : fallback;
const receiptId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_.\/-]{0,127}$/.test(id);
const fail = (error) => ({ ok: false, error });
const STAGE_KEY = /^(\d+)-(\d+)$/;

/** 저장 안의 엔드게임 상태. 잘못된 값은 버리고 기존 저장은 빈 상태로 시작한다. */
export function normalizeEndgame(raw) {
  const r = object(raw) ? raw : {}, t = object(r.tower) ? r.tower : {};
  /** @type {Record<string, number>} */
  const peak = {};
  for (const [key, rank] of Object.entries(object(r.peak) ? r.peak : {})) {
    const m = STAGE_KEY.exec(key);
    if (!m || +m[1] < 1 || +m[1] > CHAPTERS.length || +m[2] < 1 || +m[2] > STAGES_PER_CHAPTER) continue;
    const value = integer(rank, -1, DIFFICULTY_ORDER.length - 1, -1);
    if (value >= 0) peak[key] = value;
  }
  const best = integer(t.best, 0, MAX_FLOOR, 0);
  const tm = object(r.torment) ? r.torment : {}, today = object(tm.today) ? tm.today : {};
  return {
    version: VERSION, peak,
    // 고통 단계(SPEC_720H 3.2): best = 최고 클리어 단계, today = 오늘(05:00 KST 경계) 완료한 판 수. 일차는 앞으로만 간다.
    torment: { best: integer(tm.best, 0, TORMENT.maxTier, 0), today: { day: integer(today.day, 0, MAX_FLOOR, 0), runs: integer(today.runs, 0, MAX_FLOOR, 0) } },
    // week·chestWeek 는 towerWeekId(0 = 기록 없음). 음수 표식은 저장 정규화를 두 번 거치면 바뀌어 쓰지 않는다.
    tower: { best, week: integer(t.week, 0, MAX_FLOOR, 0), weekCleared: integer(t.weekCleared, 0, MAX_FLOOR, 0),
      chestWeek: integer(t.chestWeek, 0, MAX_FLOOR, 0) },
    receipts: [...new Set((Array.isArray(r.receipts) ? r.receipts : []).filter(receiptId))].slice(-128),
  };
}

/**
 * 엔드게임 도입 전 저장의 이월. 별점이 있는 관문은 스토리 클리어, 숙련(masterworks) 최근 전투 기록(최대 20판)의
 * 캠페인 승리는 그 난이도 클리어로 남긴다. 옛 저장은 난이도별 클리어를 따로 기록하지 않았으므로 기록 밖의 악몽 클리어는
 * 복원할 수 없다(그 관문은 다시 악몽으로 깨야 지옥이 열린다).
 */
export function migrateEndgame(save) {
  const state = normalizeEndgame(null), stars = object(save?.progress?.stars) ? save.progress.stars : {};
  for (const [key, n] of Object.entries(stars)) { const m = STAGE_KEY.exec(key); if (m && n > 0) recordDifficultyClear(state, +m[1], +m[2], 'story'); }
  for (const h of Array.isArray(save?.masterworks?.history) ? save.masterworks.history : []) {
    const route = h?.details?.route, m = STAGE_KEY.exec(route?.id || '');
    if (h?.outcome === 'victory' && route?.kind === 'campaign' && m) recordDifficultyClear(state, +m[1], +m[2], route.difficultyId || 'story');
  }
  return state;
}

// ---------- 시즌 ----------
/** nowMs 가 속한 시즌 주차. 시즌 시작 전(preseason)은 0주차 상한만 쓰고 이벤트는 켜지 않는다. 13주마다 다음 시즌으로 넘어간다. */
export function seasonAt(nowMs) {
  const at = Number.isFinite(nowMs) ? nowMs : 0, preseason = at < SEASON.startMs, since = Math.max(0, at - SEASON.startMs);
  const absoluteWeek = Math.floor(since / WEEK_MS), season = Math.floor(absoluteWeek / SEASON.weeks) + 1;
  const week = absoluteWeek % SEASON.weeks;
  const day = Math.floor(since / DAY_MS) % 7; // 0 = 월요일 05:00 부터
  return { season, week, absoluteWeek, day, weekend: day >= 5, preseason,
    weekStartMs: SEASON.startMs + absoluteWeek * WEEK_MS, nextWeekMs: SEASON.startMs + (absoluteWeek + 1) * WEEK_MS };
}

/** 지금 켜진 이벤트. 효과는 EVENT_EFFECT_KINDS 에 있는 것만 남긴다. */
export function activeEvents(nowMs) {
  const at = seasonAt(nowMs), def = EVENT_WEEKS[at.week];
  if (at.preseason || !def || (def.days === 'weekend' && !at.weekend)) return [];
  return [{ id: def.id, name: def.name, tagline: def.tagline, week: at.week, effects: def.effects.filter((e) => EVENT_EFFECT_KINDS.includes(e.kind)) }];
}
/** 이번 주와 다음 주 이벤트(로비 달력). 주말 이벤트도 주 단위로 보여 주고 active 로 켜짐 여부를 표시한다. */
export function eventCalendar(nowMs, span = 3) {
  const at = seasonAt(nowMs), active = new Set(activeEvents(nowMs).map((e) => e.id));
  return Array.from({ length: span }, (_, i) => {
    const absoluteWeek = at.absoluteWeek + i, def = EVENT_WEEKS[absoluteWeek % SEASON.weeks];
    return { ...def, startsAt: SEASON.startMs + absoluteWeek * WEEK_MS, current: i === 0 && !at.preseason, active: i === 0 && active.has(def.id) };
  });
}
const effectValue = (events, kind, neutral) => events.flatMap((e) => e.effects).filter((e) => e.kind === kind)
  .reduce((acc, e) => kind === 'stoneBonus' ? acc + e.value : acc * e.value, neutral);

/**
 * 이벤트 보상 적용. source: 'campaign'(캠페인 완료 보상) | 'tower'(무한의 성 첫 돌파). 입력을 바꾸지 않는다.
 * 필드 드랍·첫 클리어 보석·결제 지급에는 적용하지 않는다(호출자가 완료 보상 부분만 넘긴다).
 */
export function applyEventRewards(rewards, events, source) {
  const out = { ...(rewards || {}) };
  if (!Array.isArray(events) || !events.length) return out;
  if (source === 'campaign') {
    if (Number.isFinite(out.gold)) out.gold = Math.floor(out.gold * effectValue(events, 'campaignGold', 1));
    if (Number.isFinite(out.exp)) out.exp = Math.floor(out.exp * effectValue(events, 'campaignExp', 1));
    const stones = effectValue(events, 'stoneBonus', 0);
    if (stones > 0) out.stones = (out.stones || 0) + stones;
  } else if (source === 'tower') {
    const mul = effectValue(events, 'towerFirstClear', 1);
    for (const key of ['gold', 'stones', 'stones2', 'stones3', 'gems', 'transcendStones']) if (Number.isFinite(out[key])) out[key] = Math.floor(out[key] * mul);
  }
  return out;
}

// ---------- 고통 단계 ----------
/** 시즌 시작(05:00 KST) 기준 일차 + 1(0 = 기록 없음, 시즌 전은 1). 하루 판 수 감쇠가 이 경계를 쓴다. */
export const tormentDayId = (nowMs) => Math.min(MAX_FLOOR, Math.max(0, Math.floor(((Number.isFinite(nowMs) ? nowMs : 0) - SEASON.startMs) / DAY_MS)) + 1);
/** 오늘 판 수에 맞춘 상태(읽기 전용). 풀 보상 판이 몇 번 남았는지 보여 준다. */
export function tormentStatus(state, nowMs) {
  const tm = normalizeEndgame(state).torment, runs = tm.today.day >= tormentDayId(nowMs) ? tm.today.runs : 0;
  return { best: tm.best, nextTier: Math.min(TORMENT.maxTier, tm.best + 1), runsToday: runs, fullRuns: TORMENT.fullRuns, fullLeft: Math.max(0, TORMENT.fullRuns - runs) };
}
/**
 * 고통 단계 한 판 완료를 센다. 오늘 첫 fullRuns 판은 full=true(보상 100%), 그 뒤는 false(골드·재료 decayMul, EXP 100%).
 * 일차는 앞으로만 간다: 기기 시계를 되돌려도 오늘 판 수가 0 으로 돌아가지 않는다.
 * 지역 최종 보스(X-10)를 클리어하면 최고 단계가 오른다(요청한 단계가 해금 단계 이하일 때만 — 호출자가 해금을 이미 검사한다).
 */
export function recordTormentRun(state, { tier, st, nowMs }) {
  const tm = state.torment, day = tormentDayId(nowMs);
  if (day > tm.today.day) { tm.today.day = day; tm.today.runs = 0; }
  const full = tm.today.runs < TORMENT.fullRuns, before = tm.best;
  tm.today.runs = Math.min(MAX_FLOOR, tm.today.runs + 1);
  if (st === STAGES_PER_CHAPTER && Number.isSafeInteger(tier) && tier >= 1 && tier <= TORMENT.maxTier && tier <= before + 1) tm.best = Math.max(before, tier);
  return { full, runs: tm.today.runs, best: tm.best, newBest: tm.best > before };
}

// ---------- 난이도 최고 기록 ----------
export const difficultyRank = (id) => DIFFICULTY_ORDER.indexOf(id);
/** 캠페인 승리를 난이도 최고 기록에 남긴다. 낮은 난이도 승리는 기록을 낮추지 않는다. */
export function recordDifficultyClear(state, ch, st, difficultyId) {
  const rank = difficultyRank(difficultyId);
  if (rank < 0 || !Number.isInteger(ch) || !Number.isInteger(st) || ch < 1 || ch > CHAPTERS.length || st < 1 || st > STAGES_PER_CHAPTER) return false;
  const key = `${ch}-${st}`;
  if ((state.peak[key] ?? -1) >= rank) return false;
  state.peak[key] = rank; return true;
}
/** 지역 ch 의 10관문을 모두 difficultyId 이상으로 클리어했는지. */
export function chapterClearedAt(state, ch, difficultyId) {
  const rank = difficultyRank(difficultyId), peak = object(state?.peak) ? state.peak : {};
  if (rank < 0) return false;
  for (let st = 1; st <= STAGES_PER_CHAPTER; st++) if ((peak[`${ch}-${st}`] ?? -1) < rank) return false;
  return true;
}

// ---------- 무한의 성 ----------
export const towerUnlocked = (progress) => (Number.isSafeInteger(progress?.unlocked) ? progress.unlocked : 1) >= TOWER.unlockStageIdx;
/** 시즌 주차에 따른 도전 가능 최고 층. 시즌이 바뀌어도 기록은 유지되고 상한만 다시 열린다(최고 기록 이상으로는 줄지 않는다). */
export function towerCap(nowMs, best = 0) {
  const at = seasonAt(nowMs);
  const seasonCap = Math.min(TOWER.capMax, TOWER.capBase + TOWER.capPerWeek * (at.week + (at.season - 1) * SEASON.weeks));
  return Math.max(seasonCap, integer(best, 0, MAX_FLOOR, 0));
}
/** 층이 빌려 쓰는 캠페인 관문(지역 순환, 5층 중간 보스·10층 최종 보스). */
export function towerFloorSource(floor) {
  const f = integer(floor, 1, MAX_FLOOR, 1), block = Math.floor((f - 1) / STAGES_PER_CHAPTER);
  return { ch: (block % CHAPTERS.length) + 1, st: ((f - 1) % STAGES_PER_CHAPTER) + 1, cycle: Math.floor(block / CHAPTERS.length) };
}
export const towerScale = (floor) => TOWER.baseScale * Math.pow(integer(floor, 1, MAX_FLOOR, 1), TOWER.exponent);

/** 첫 돌파 보상(이벤트 적용 전). 10층마다 보석, 25층마다 초월석. */
export function towerFirstClearRewards(floor) {
  const f = integer(floor, 1, MAX_FLOOR, 1), c = TOWER.firstClear;
  const out = { gold: Math.floor(c.gold * Math.pow(c.goldGrowth, f - 1)), stones: c.stones };
  if (f % c.stones2Every === 0) out.stones2 = 1 + Math.floor(f / 50);
  if (f % c.stones3Every === 0) out.stones3 = 1 + Math.floor(f / 100);
  if (f % c.gemsEvery === 0) out.gems = c.gems;
  if (f % c.transcendEvery === 0) out.transcendStones = 1;
  return out;
}

/**
 * 층 전투 정의. 원본 관문의 맵·적 구성·보스·이야기 자산을 쓰고 적 배율·보상·코드만 층 기준으로 바꾼다.
 * 에너지 대신 무한의 성 자체 규칙(도전은 다음 층 하나)을 쓰므로 energy 는 0 이다.
 */
export function towerStage(floor) {
  const f = integer(floor, 1, MAX_FLOOR, 1), src = towerFloorSource(f), base = stageDef(src.ch, src.st);
  const scale = towerScale(f), recLevel = Math.min(80, recommendedLevel(src.ch, src.st) + Math.floor(f / 4));
  const stage = { ...base, code: `T${f}`, name: `무한의 성 ${f}층 · ${base.title}`, title: `${f}층 · ${base.title}`,
    scale, recPower: Math.floor(2600 * scale), energy: 0, finale: false, epilogueFinale: false,
    objective: `무한의 성 ${f}층: ${base.objective}`,
    rewards: { ...base.rewards, gold: 0, exp: Math.floor(110 * scale), bp: 40, firstGems: 0, dropChance: base.boss ? 1 : 0.6, stones: 0 },
    tower: { floor: f, sourceCode: base.code } };
  return Object.defineProperties(stage, {
    recommendedLevel: { value: recLevel }, representativeDrops: { value: base.representativeDrops },
    midboss: { value: base.midboss }, regionBoss: { value: base.regionBoss }, unlocksChapter: { value: null },
  });
}

/** 주차 식별자: 0 = 기록 없음, 1 = 시즌 시작 전, 2 이상 = 시즌 절대 주차 + 2. */
export const towerWeekId = (nowMs) => { const at = seasonAt(nowMs); return at.preseason ? 1 : at.absoluteWeek + 2; };
/**
 * 이번 주 기준으로 주간 기록을 맞춘다(새 주면 이번 주 돌파 수 0). 주차는 앞으로만 간다:
 * 기기 시계를 되돌려도 이미 지난 주로 돌아가지 않아 주간 보급을 다시 받을 수 없다. 돌려주는 값은 기록된 주차다.
 */
export function refreshTowerWeek(state, nowMs) {
  const week = towerWeekId(nowMs);
  if (week > state.tower.week) { state.tower.week = week; state.tower.weekCleared = 0; }
  return state.tower.week;
}

/**
 * 다음 층 돌파를 기록한다. floor 는 반드시 best+1 이고 상한 이하여야 한다. 같은 영수증은 한 번만 센다.
 * @returns {{ok:true, floor:number, rewards:object, events:object[]}|{ok:false,error:string}}
 */
export function recordTowerClear(state, { floor, receiptId: id, nowMs }) {
  if (!receiptId(id) || !Number.isSafeInteger(floor)) return fail('invalid');
  if (state.receipts.includes(id)) return fail('duplicate');
  if (floor !== state.tower.best + 1) return fail('order');
  if (floor > towerCap(nowMs, state.tower.best)) return fail('cap');
  refreshTowerWeek(state, nowMs);
  state.receipts.push(id); state.receipts = state.receipts.slice(-128);
  state.tower.best = floor; state.tower.weekCleared = Math.min(MAX_FLOOR, state.tower.weekCleared + 1);
  const events = activeEvents(nowMs);
  return { ok: true, floor, events, rewards: applyEventRewards(towerFirstClearRewards(floor), events, 'tower') };
}

/** 주간 보급 상자 상태. 이번 주에 한 층 이상 돌파해야 받을 수 있고, 최고 층 구간 보상을 준다. */
export function towerChest(state, nowMs) {
  const view = normalizeEndgame(state), week = refreshTowerWeek(view, nowMs);
  const tier = [...TOWER.weeklyChest].reverse().find((row) => view.tower.best >= row.floor) || null;
  const claimed = view.tower.chestWeek >= week;
  return { week, tier, claimed, ready: !!tier && !claimed && view.tower.weekCleared > 0, weekCleared: view.tower.weekCleared,
    nextResetAt: SEASON.startMs + Math.max(0, week - 1) * WEEK_MS }; // 기록된 주차의 다음 월요일 05:00 (시즌 전이면 시즌 시작)
}
export function claimTowerChest(state, nowMs) {
  const chest = towerChest(state, nowMs);
  if (chest.claimed) return fail('claimed');
  if (!chest.ready) return fail('incomplete');
  refreshTowerWeek(state, nowMs); state.tower.chestWeek = chest.week;
  const { floor, ...rewards } = chest.tier;
  return { ok: true, rewards: Object.fromEntries(Object.entries(rewards).filter(([, n]) => n > 0)) };
}

/** 로비 카드용 요약(읽기 전용). */
export function towerSummary(state, progress, nowMs) {
  const view = normalizeEndgame(state), next = view.tower.best + 1, cap = towerCap(nowMs, view.tower.best);
  const src = towerFloorSource(next);
  return { unlocked: towerUnlocked(progress), best: view.tower.best, next, cap, capped: next > cap,
    source: `${src.ch}-${src.st}`, boss: src.st === 10 ? 'final' : src.st === 5 ? 'mid' : null,
    recPower: Math.floor(2600 * towerScale(next)), chest: towerChest(view, nowMs) };
}
