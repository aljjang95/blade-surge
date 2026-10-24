import { BOONS } from '../data/masterworks.js';
import {
  BLESSING_CANDIDATES, BLESSING_GRADE_RATES, BLESSING_PITY, BLESSING_GEM_PRICES, BLESSING_DAILY_FREE,
  BLESSING_DAILY_GEM_CAP, BLESSING_DAY_OFFSET_MS, BLESSING_CHARM_MAX, BLESSING_EFFECTIVE, BLESSING_GEM_NOTE,
} from '../data/blessing.js';

/**
 * 전운 굴리기 순수 규칙. 저장·보석 차감·UI는 여기서 하지 않는다.
 * - 모든 변경 함수는 입력 상태를 바꾸지 않고 새 상태를 돌려준다(호출자가 성공 확정 뒤에 저장).
 * - 보석 실제 차감은 economy가 한다: rollCost로 값을 보여 주고, roll 결과의 paid.gems만큼
 *   economy에서 차감에 성공했을 때만 새 상태를 저장한다(차감 실패 시 새 상태를 버리면 굴림은 없던 일).
 * - 결과는 roll 호출 시점(릴 회전 시작 전)에 정해지고, 연출은 그 결과를 보여 주기만 한다.
 */

/** @typedef {{id: string, grade: number}} BlessingBoon 각인 id와 등급(1~3) */

const DAY_MS = 86400000, MAX = 1000000, VERSION = 1;
/** @type {string[]} */
const BOON_ID_LIST = BOONS.map(b => String(b.id));
const BOON_IDS = new Set(BOON_ID_LIST);
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, max = MAX, min = 0) => Number.isSafeInteger(v) ? Math.min(max, Math.max(min, v)) : min;
const grade = v => Number.isSafeInteger(v) && v >= 1 && v <= 3 ? v : 0;
const err = error => ({ ok: false, error });

function boonEntry(v) {
  if (!obj(v) || !BOON_IDS.has(v.id) || !grade(v.grade)) return null;
  return { id: v.id, grade: v.grade };
}

function normalizeOffer(v) {
  if (!obj(v) || !Array.isArray(v.candidates) || v.candidates.length !== BLESSING_CANDIDATES) return null;
  const candidates = v.candidates.map(boonEntry);
  if (candidates.some(c => !c) || new Set(candidates.map(c => c.id)).size !== candidates.length) return null;
  const picked = Number.isSafeInteger(v.picked) && v.picked >= 0 && v.picked < candidates.length ? v.picked : -1;
  return { candidates, guaranteed: v.guaranteed === true, picked };
}

/**
 * 저장 상태 모양(save.js가 그대로 직렬화):
 * {version, pity, freeDay, gemDay, gemRolls, runGemRolls, runRolls, charms, held, offer, rollSeq}
 * - pity: III 없이 연속 굴린 횟수(0~10). 10이면 다음 굴림이 천장.
 * - freeDay: 오늘 무료를 쓴 일자키(dayKey). -1 = 쓴 적 없음.
 * - gemDay·gemRolls: 보석 굴림을 센 일자키와 그날 보석 굴림 수(상한 30).
 * - runGemRolls: 현재 출격 준비 중 보석 굴림 수(가격 30/60/90 단계). runRolls: 현재 출격 준비 중 전체 굴림 수.
 * - charms: 전운 부적 수.
 * - held: 보관 중 각인 {id, grade} 또는 null(1개만, 다음 출격까지 유지).
 * - offer: 마지막 굴림 결과 {candidates:[{id,grade}×3], guaranteed, picked(-1|0..2)} 또는 null.
 * - rollSeq: 지금까지 굴린 총 횟수(RNG 섞기용, 같은 시드 재사용 시에도 굴림마다 결과가 달라진다).
 */
export function normalizeBlessing(raw) {
  const r = obj(raw) ? raw : {};
  return {
    version: VERSION,
    pity: int(r.pity, BLESSING_PITY),
    freeDay: Number.isSafeInteger(r.freeDay) && r.freeDay >= 0 ? r.freeDay : -1,
    gemDay: Number.isSafeInteger(r.gemDay) && r.gemDay >= 0 ? r.gemDay : -1,
    gemRolls: int(r.gemRolls, BLESSING_DAILY_GEM_CAP),
    runGemRolls: int(r.runGemRolls),
    runRolls: int(r.runRolls),
    charms: int(r.charms, BLESSING_CHARM_MAX),
    held: boonEntry(r.held),
    offer: normalizeOffer(r.offer),
    rollSeq: int(r.rollSeq, Number.MAX_SAFE_INTEGER),
  };
}

/** 한국 05:00 기준 일자키(epoch day). 같은 날 05:00 전후로 값이 1 바뀐다. 주변 시계를 읽지 않는다. */
export function dayKey(now) {
  const t = Number.isSafeInteger(now) ? Math.max(0, now) : 0;
  return Math.floor((t + BLESSING_DAY_OFFSET_MS) / DAY_MS);
}

/** 오늘 남은 보석 굴림 수(일자가 바뀌면 상한 전체). */
export function gemRollsLeft(state, now) {
  const s = normalizeBlessing(state);
  const used = s.gemDay === dayKey(now) ? s.gemRolls : 0;
  return Math.max(0, BLESSING_DAILY_GEM_CAP - used);
}

/** 이번 굴림의 비용 종류(무료 → 부적 → 보석 순). 보석 잔액 확인은 호출자(economy) 몫. */
export function rollCost(state, now) {
  const s = normalizeBlessing(state), today = dayKey(now);
  if (s.freeDay !== today && BLESSING_DAILY_FREE > 0) return { kind: 'free', gems: 0, allowed: true };
  if (s.charms > 0) return { kind: 'charm', gems: 0, allowed: true };
  const gems = BLESSING_GEM_PRICES[Math.min(BLESSING_GEM_PRICES.length - 1, s.runGemRolls)];
  const allowed = gemRollsLeft(s, now) > 0;
  return allowed ? { kind: 'gem', gems, allowed } : { kind: 'gem', gems, allowed, reason: 'daily-cap' };
}

/** III 보장까지 남은 굴림 수(1이면 다음 굴림이 천장). */
export function pityLeft(state) {
  return BLESSING_PITY + 1 - normalizeBlessing(state).pity;
}

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** mulberry32: 32비트 상태로 [0,1) 실수를 만든다. 결정적이고 플랫폼에 무관하다. */
function rng(seedText) {
  let a = hashSeed(seedText);
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickGrade(u) {
  let acc = 0;
  for (const g of BLESSING_GRADE_RATES) { acc += g.rate; if (u < acc) return g.grade; }
  return BLESSING_GRADE_RATES[BLESSING_GRADE_RATES.length - 1].grade;
}

/**
 * 후보 3개만 만든다(상태 없음). 각인 id는 12종 중 서로 다른 3개를 균등 추출,
 * 각 칸 등급은 독립 70/25/5. guaranteeIII면 균등하게 고른 1칸을 III으로 고정(그 칸의 각인 종류도 균등 1/12).
 */
/** @returns {BlessingBoon[]} */
export function drawCandidates(seed, { guaranteeIII = false } = {}) {
  const next = rng(String(seed).slice(0, 200));
  const pool = BOON_ID_LIST.slice();
  for (let i = 0; i < BLESSING_CANDIDATES; i++) {
    const j = i + Math.floor(next() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const forced = guaranteeIII ? Math.floor(next() * BLESSING_CANDIDATES) : -1;
  return pool.slice(0, BLESSING_CANDIDATES).map((id, i) => {
    const u = next();
    return { id, grade: i === forced ? 3 : pickGrade(u) };
  });
}

/**
 * 한 번 굴린다. 결과: {ok:true, state, paid:{kind, gems}, candidates, guaranteed}
 * 또는 {ok:false, error:'daily-cap'}.
 * - seed는 호출자가 준다(예: `${saveId}:${runSeq}`). state.rollSeq를 섞으므로 (state, seed)가 같으면 결과도 같다.
 * - paid.kind가 'gem'이면 호출자가 economy에서 paid.gems를 차감한 뒤에만 state를 저장한다.
 * - opts.pity=false는 시험용(천장 끔): 천장 보장도, pity 증가도 하지 않는다.
 */
export function roll(state, now, seed, { pity = true } = {}) {
  const s = normalizeBlessing(state), cost = rollCost(s, now), today = dayKey(now);
  if (!cost.allowed) return err(cost.reason || 'not-allowed');
  const guaranteed = pity && s.pity >= BLESSING_PITY;
  const candidates = drawCandidates(`${String(seed).slice(0, 160)}#${s.rollSeq}`, { guaranteeIII: guaranteed });
  const hasIII = candidates.some(c => c.grade === 3);
  const next = { ...s, held: s.held && { ...s.held }, rollSeq: s.rollSeq + 1, runRolls: Math.min(MAX, s.runRolls + 1),
    offer: { candidates, guaranteed, picked: -1 } };
  if (pity) next.pity = hasIII ? 0 : Math.min(BLESSING_PITY, s.pity + 1);
  if (cost.kind === 'free') next.freeDay = today;
  else if (cost.kind === 'charm') next.charms = s.charms - 1;
  else {
    next.gemRolls = (s.gemDay === today ? s.gemRolls : 0) + 1;
    next.gemDay = today;
    next.runGemRolls = Math.min(MAX, s.runGemRolls + 1);
  }
  return { ok: true, state: next, paid: { kind: cost.kind, gems: cost.gems }, candidates: candidates.map(c => ({ ...c })), guaranteed };
}

/** 마지막 굴림 후보 중 index를 보관한다(같은 결과 안에서 다른 카드로 바꿔 고를 수 있다). */
export function pick(state, index) {
  const s = normalizeBlessing(state);
  if (!s.offer) return err('no-offer');
  if (!Number.isSafeInteger(index) || index < 0 || index >= s.offer.candidates.length) return err('index');
  const held = { ...s.offer.candidates[index] };
  return { ok: true, state: { ...s, held, offer: { ...s.offer, candidates: s.offer.candidates.map(c => ({ ...c })), picked: index } }, held: { ...held } };
}

/**
 * 출격 시작 성공 직후에만 호출한다(로딩 실패 등으로 출격이 시작되지 않았으면 부르지 않는다 → 보관 각인 유지).
 * 보관 각인을 preRunBoons(등급 n이면 같은 id n번, masterworks-core ranks() 형식)로 꺼내고,
 * 보관·마지막 결과·출격 준비 굴림 수를 비운다. 보관이 없으면 빈 배열.
 */
export function consumeOnRunStart(state) {
  const s = normalizeBlessing(state);
  const preRunBoons = s.held ? Array.from({ length: s.held.grade }, () => s.held.id) : [];
  return { state: { ...s, held: null, offer: null, runGemRolls: 0, runRolls: 0 }, preRunBoons };
}

/** 출격 준비 중 굴림 수(보석 가격 단계)만 초기화한다. 보관 각인·천장·일일 기록은 그대로. */
export function resetRunRerolls(state) {
  const s = normalizeBlessing(state);
  return { ...s, held: s.held && { ...s.held }, offer: s.offer && { ...s.offer, candidates: s.offer.candidates.map(c => ({ ...c })) }, runGemRolls: 0, runRolls: 0 };
}

/** 부적 지급(의뢰·패스·월정액 쪽이 BLESSING_CHARM_GRANTS 값으로 호출). 실제로 더해진 수를 함께 돌려준다. */
export function addCharms(state, amount) {
  const s = normalizeBlessing(state), add = Math.min(int(amount), BLESSING_CHARM_MAX - s.charms);
  return { state: { ...s, held: s.held && { ...s.held }, charms: s.charms + add }, added: add };
}

const pctText = (rate, digits = 2) => `${(Math.round(rate * 10 ** (digits + 2)) / 10 ** digits).toFixed(digits)}%`;

/** 확률 공개 시트용 표. 모든 숫자는 src/data/blessing.js와 BOONS에서 계산한다. */
export function oddsTable() {
  const kinds = BOONS.length;
  const noIII = (1 - BLESSING_GRADE_RATES.find(g => g.grade === 3).rate) ** BLESSING_CANDIDATES;
  const families = [...new Set(BOONS.map(b => b.family))];
  const perBoon = BOONS.map(b => ({ id: b.id, name: b.name, family: b.family,
    grades: BLESSING_GRADE_RATES.map(g => ({ grade: g.grade, label: g.label, rate: g.rate / kinds, text: pctText(g.rate / kinds) })) }));
  return {
    candidates: BLESSING_CANDIDATES,
    grades: BLESSING_GRADE_RATES.map(g => ({ grade: g.grade, label: g.label, rate: g.rate, text: pctText(g.rate, 0) })),
    families: families.map(f => ({ family: f, boonIds: BOONS.filter(b => b.family === f).map(b => b.id),
      rate: BOONS.filter(b => b.family === f).length / kinds,
      grades: BLESSING_GRADE_RATES.map(g => ({ grade: g.grade, label: g.label, rate: g.rate / kinds, text: pctText(g.rate / kinds) })) })),
    perBoon,
    baseAtLeastOneIII: { rate: 1 - noIII, text: pctText(1 - noIII, 1) },
    effective: {
      iiiCandidateRate: { rate: BLESSING_EFFECTIVE.iiiCandidateRate, text: pctText(BLESSING_EFFECTIVE.iiiCandidateRate) },
      atLeastOneIIIPerRoll: { rate: BLESSING_EFFECTIVE.atLeastOneIIIPerRoll, text: pctText(BLESSING_EFFECTIVE.atLeastOneIIIPerRoll, 1) },
    },
    pity: { threshold: BLESSING_PITY,
      text: `III 없이 ${BLESSING_PITY}번 굴리면 ${BLESSING_PITY + 1}번째 굴림의 후보 1개가 III 확정(각인 종류는 균등). 무료·부적·보석 굴림을 모두 세고, III이 나오면 0으로 돌아갑니다.` },
    prices: { dailyFree: BLESSING_DAILY_FREE, charm: 1, gems: [...BLESSING_GEM_PRICES], dailyGemCap: BLESSING_DAILY_GEM_CAP,
      text: `매일 무료 ${BLESSING_DAILY_FREE}회(05:00 리셋) → 전운 부적 1개 → 보석 ${BLESSING_GEM_PRICES.join('/')}(같은 출격 준비 중 1·2·3번째부터), 하루 보석 굴림 ${BLESSING_DAILY_GEM_CAP}회까지` },
    notes: [
      `한 굴림의 후보 ${BLESSING_CANDIDATES}개는 서로 다른 각인입니다.`,
      `III 1개 이상 기본 ${pctText(1 - noIII, 1)}(천장 제외) · 천장 포함 약 ${pctText(BLESSING_EFFECTIVE.atLeastOneIIIPerRoll, 1)}`,
      BLESSING_GEM_NOTE,
    ],
  };
}
