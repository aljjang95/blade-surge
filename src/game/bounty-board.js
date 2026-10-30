// 현상금 의뢰판 규칙(순수 함수, 게임·시뮬레이터 공용). docs/BOUNTY_BOARD.md.
// 상태는 eco.s.bounty 에 둔다(기기 전용, 서버 권위 0% 기간 — docs/SERVER_AUTHORITY_GATES.md 8절의 여정 의뢰와 같은 취급).
import { BOUNTY_KINDS, BOUNTY_KIND_ORDER, BOUNTY_TIERS, BOUNTY_TIER_ORDER, BOUNTY_TRIALS, HUNTER_RANK, HUNTER_TITLES, rankReward, BOUNTY_SHOP } from '../data/bounties.js';
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../data/stages.js';
import { hashSeed } from '../shared/rng.js';

/** 의뢰판이 열리는 관문: 1장 지역 보스(1-10) 클리어 = 1장 마을 개방과 같은 순간. */
export const BOUNTY_UNLOCK_KEY = '1-10';
const KEY_RE = /^([1-9]\d?)-([1-9]\d?)$/;
const int = (v, max = 1e9) => Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : 0;

export function normalizeBounty(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const done = {};
  if (src.done && typeof src.done === 'object') for (const [k, mask] of Object.entries(src.done)) {
    const [tier, key] = k.split(':');
    if (BOUNTY_TIERS[tier] && KEY_RE.test(key || '') && Number.isSafeInteger(mask) && mask > 0 && mask < 8) done[k] = mask;
  }
  const rank = Math.max(1, Math.min(HUNTER_RANK.max, int(src.rank, HUNTER_RANK.max) || 1));
  const bought = {};
  if (src.shop?.bought && typeof src.shop.bought === 'object') for (const [id, n] of Object.entries(src.shop.bought)) if (BOUNTY_SHOP.some((x) => x.id === id)) bought[id] = int(n, 1e6);
  const xp = rank >= HUNTER_RANK.max ? 0 : Math.min(int(src.xp), HUNTER_RANK.need(rank) - 1);
  return { v: 1, done, xp, rank, marks: int(src.marks), completed: int(src.completed),
    titles: Array.isArray(src.titles) ? src.titles.filter((t) => HUNTER_TITLES.some((x) => x.id === t)) : [],
    owned: Array.isArray(src.owned) ? [...new Set(src.owned.filter((t) => BOUNTY_SHOP.some((x) => x.grant.cosmetic === t)))] : [],
    shop: { week: Number.isSafeInteger(src.shop?.week) ? src.shop.week : -1, bought } };
}

export const bountyId = (tier, ch, st, kind) => `${tier}:${ch}-${st}:${kind}`;
export function parseBountyId(id) {
  const [tier, key, kind] = String(id).split(':'), m = KEY_RE.exec(key || '');
  if (!BOUNTY_TIERS[tier] || !BOUNTY_KINDS[kind] || !m) return null;
  const ch = Number(m[1]), st = Number(m[2]);
  if (!CHAPTERS.some((c) => c.id === ch) || st > STAGES_PER_CHAPTER) return null;
  if (kind === 'wanted' && st !== STAGES_PER_CHAPTER) return null;
  return { tier, ch, st, kind, key };
}

/** 저장(eco.s 모양: progress.stars['ch-st'], endgame.peak['ch-st'] = 난이도 rank)에서 그 단계로 클리어했는가. */
export function tierCleared(save, tier, key) {
  if (tier === 'story') return (save?.progress?.stars?.[key] || 0) >= 1;
  return (save?.endgame?.peak?.[key] ?? -1) >= BOUNTY_TIERS[tier].rank;
}
export const boardOpen = (save) => tierCleared(save, 'story', BOUNTY_UNLOCK_KEY);

/** 조건 의뢰의 조건(관문·단계마다 결정적). n 은 문구에 들어가는 값. */
export function trialFor(tier, ch, st) {
  const t = BOUNTY_TRIALS[hashSeed('bounty-trial', tier, ch, st) % BOUNTY_TRIALS.length];
  return { ...t, n: t.base, label: t.text.replace('{n}', String(t.base)) };
}

/** 의뢰 정의(보상 포함). 열림 여부와 무관하게 id 만으로 만든다. */
export function bountyDef(id) {
  const p = parseBountyId(id); if (!p) return null;
  const kind = BOUNTY_KINDS[p.kind], tier = BOUNTY_TIERS[p.tier], stage = stageDef(p.ch, p.st);
  const rewards = { gold: Math.floor(stage.rewards.gold * kind.goldShare * tier.goldMul), marks: kind.marks, xp: Math.round(kind.xp * tier.xpMul) };
  return { id, ...p, name: `${tier.name} ${p.key} ${kind.name}`, kindName: kind.name, tierName: tier.name, description: kind.description,
    trial: p.kind === 'trial' ? trialFor(p.tier, p.ch, p.st) : null, minutes: kind.minutes + tier.extraMin, rewards };
}

/** 지금 받을 수 있는(열렸고 아직 안 끝낸) 의뢰 목록. 순서: 낮은 단계 → 낮은 관문 → 종류 순. */
export function availableBounties(state, save, { limit = Infinity } = {}) {
  const out = []; if (!boardOpen(save)) return out;
  const s = normalizeBountyView(state);
  for (const tier of BOUNTY_TIER_ORDER) for (const c of CHAPTERS) for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
    const key = `${c.id}-${st}`; if (!tierCleared(save, tier, key)) continue;
    const mask = s.done[`${tier}:${key}`] || 0;
    for (const kind of BOUNTY_KIND_ORDER) {
      if (kind === 'wanted' && st !== STAGES_PER_CHAPTER) continue;
      if (mask & BOUNTY_KINDS[kind].bit) continue;
      out.push(bountyDef(bountyId(tier, c.id, st, kind)));
      if (out.length >= limit) return out;
    }
  }
  return out;
}
const normalizeBountyView = (state) => state && state.v === 1 && state.done ? state : normalizeBounty(state);

/** 조건 판정. 승리가 아니면 실패. 조건 의뢰는 결과의 fact 가 숫자여야 한다(없으면 실패 — 조작 여지 없음). */
export function judgeBounty(def, result) {
  if (!def) return { ok: false, reason: 'unknown' };
  if (!result || result.win !== true) return { ok: false, reason: 'lost' };
  // 수배 처치·지역 수배범: 모든 구역 정화(정예 방·보스 방 포함)가 목표다.
  if (!def.trial) return result.fullClear === true ? { ok: true } : { ok: false, reason: 'objective' };
  const v = result[def.trial.fact];
  if (!Number.isFinite(v) || v < 0) return { ok: false, reason: 'no-fact' };
  const pass = def.trial.op === 'lte' ? v <= def.trial.n : v >= def.trial.n;
  return pass ? { ok: true } : { ok: false, reason: 'trial', value: v };
}

/** 사냥꾼 경험치 지급 → 등급 상승 목록(등급 보상·칭호 포함). state 를 바꾼다. */
export function grantHunterXp(state, xp) {
  const ups = [];
  state.xp += int(xp);
  while (state.rank < HUNTER_RANK.max && state.xp >= HUNTER_RANK.need(state.rank)) {
    state.xp -= HUNTER_RANK.need(state.rank); state.rank++;
    const title = HUNTER_TITLES.find((t) => t.rank === state.rank);
    if (title && !state.titles.includes(title.id)) state.titles.push(title.id);
    ups.push({ rank: state.rank, reward: rankReward(state.rank), title: title || null });
  }
  if (state.rank >= HUNTER_RANK.max) state.xp = 0;
  return ups;
}

/**
 * 의뢰 완료. 열림·중복·판정을 모두 여기서 본다. 성공하면 state 를 바꾸고 지급할 보상 합을 돌려준다(지급은 호출자 — Economy).
 * @returns {{ ok: boolean, reason?: string, def?: any, rewards?: { gold: number, marks: number, xp: number, stones: number }, ups?: any[] }}
 */
export function completeBounty(state, save, id, result) {
  const def = bountyDef(id); if (!def) return { ok: false, reason: 'unknown' };
  if (!boardOpen(save) || !tierCleared(save, def.tier, def.key)) return { ok: false, reason: 'locked' };
  const k = `${def.tier}:${def.key}`, bit = BOUNTY_KINDS[def.kind].bit;
  if ((state.done[k] || 0) & bit) return { ok: false, reason: 'done' };
  const verdict = judgeBounty(def, result); if (!verdict.ok) return { ok: false, reason: verdict.reason, def };
  state.done[k] = (state.done[k] || 0) | bit; state.completed++; state.marks += def.rewards.marks;
  const ups = grantHunterXp(state, def.rewards.xp);
  const stones = ups.reduce((a, u) => a + u.reward.stones, 0);
  return { ok: true, def, rewards: { gold: def.rewards.gold, marks: def.rewards.marks, xp: def.rewards.xp, stones }, ups };
}

/** 현상금 상인. week 는 시즌 절대 주(endgame-core seasonAt(...).absoluteWeek). 성공하면 state 를 바꾸고 grant 를 돌려준다. */
export function buyBountyItem(state, itemId, week) {
  const item = BOUNTY_SHOP.find((x) => x.id === itemId); if (!item) return { ok: false, reason: 'unknown' };
  if (state.shop.week !== week) { state.shop.week = week; for (const x of BOUNTY_SHOP) if (x.weekly) delete state.shop.bought[x.id]; }
  if (item.minRank && state.rank < item.minRank) return { ok: false, reason: 'rank' };
  const n = state.shop.bought[item.id] || 0;
  if (item.weekly && n >= item.weekly) return { ok: false, reason: 'weekly' };
  if (item.once && (n >= 1 || state.owned.includes(item.grant.cosmetic))) return { ok: false, reason: 'owned' };
  if (state.marks < item.cost) return { ok: false, reason: 'marks' };
  state.marks -= item.cost; state.shop.bought[item.id] = n + 1;
  if (item.grant.cosmetic) state.owned.push(item.grant.cosmetic);
  return { ok: true, item, grant: item.grant };
}

/** 요약(화면·장부용): 열린 의뢰 수, 다음 등급까지 경험치. */
export function bountySummary(state, save) {
  const s = normalizeBountyView(state);
  return { open: boardOpen(save), available: availableBounties(s, save).length, rank: s.rank, xp: s.xp,
    need: s.rank >= HUNTER_RANK.max ? 0 : HUNTER_RANK.need(s.rank), marks: s.marks, completed: s.completed };
}
