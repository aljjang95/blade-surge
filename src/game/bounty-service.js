// 현상금 의뢰판 서비스: Economy 에 붙는 얇은 층. 규칙은 bounty-board.js(순수 함수)가 정본이다.
// 판은 에너지 0·필드 전리품 없음·캠페인 별/최고 기록/전투 경험치 변화 없음. 의뢰 보상만 지급한다.
import { stageDef } from '../data/stages.js';
import { applyDifficulty } from './difficulty.js';
import { availableBounties, bountyDef, bountySummary, boardOpen, buyBountyItem, completeBounty, normalizeBounty, tierCleared } from './bounty-board.js';
import { BOUNTY_SHOP, HUNTER_RANK } from '../data/bounties.js';
import { seasonAt } from './endgame-core.js';

const WEEK = (eco) => seasonAt(typeof eco.now === 'function' ? eco.now() : Date.now()).absoluteWeek;

export function bountyState(eco) {
  const b = eco.s.bounty;
  if (!b || b.v !== 1 || !b.done || typeof b.done !== 'object') eco.s.bounty = normalizeBounty(b);
  return eco.s.bounty;
}

export const bountyBoardOpen = (eco) => boardOpen(eco.s);
export const bountySummaryOf = (eco) => bountySummary(bountyState(eco), eco.s);
export const bountyList = (eco, limit = 8) => availableBounties(bountyState(eco), eco.s, { limit });

/** 의뢰 출발용 스테이지(에너지 0). 열림·미완료를 저장에서 다시 확인해 만든다. */
export function startBounty(eco, id) {
  const def = bountyDef(id); if (!def) return { ok: false, reason: 'unknown' };
  if (!boardOpen(eco.s) || !tierCleared(eco.s, def.tier, def.key)) return { ok: false, reason: 'locked' };
  const state = bountyState(eco);
  if (!availableBounties(state, eco.s).some((x) => x.id === id)) return { ok: false, reason: 'done' };
  const base = stageDef(def.ch, def.st), diff = eco.difficultyFor(def.ch, def.st, def.tier);
  if (diff.id !== def.tier) return { ok: false, reason: 'locked' };
  // 펼침은 열거되지 않는 combatRosterFor(지역 전투 명단)를 버리므로 난이도 적용본에 직접 붙인다.
  const stage = Object.assign(applyDifficulty(base, diff), { energy: 0, bounty: { id, kind: def.kind, tier: def.tier } });
  return { ok: true, def, stage };
}

/** 결과 한 번당 한 번만 정산한다(결과 객체 + 의뢰 완료 비트마스크가 이중 잠금). */
export function settleBounty(eco, result, stage) {
  const id = stage?.bounty?.id;
  if (!id) return { ok: false, reason: 'not-bounty' };
  if (!result || typeof result !== 'object') return { ok: false, reason: 'lost' };
  if (!eco.bountyReceipts) eco.bountyReceipts = new WeakSet();
  if (eco.bountyReceipts.has(result)) return { ok: false, reason: 'done' };
  const state = bountyState(eco), before = structuredClone(state);
  const r = completeBounty(state, eco.s, id, result);
  if (!r.ok) { eco.s.bounty = before; return r; }
  const got = eco.addRewards({ gold: r.rewards.gold, stones: r.rewards.stones }, { silent: true, applyVip: false });
  eco.bountyReceipts.add(result);
  const saved = eco.emit();
  return { ok: true, def: r.def, rewards: r.rewards, ups: r.ups, got, saveError: !saved,
    rank: state.rank, xp: state.xp, need: state.rank >= HUNTER_RANK.max ? 0 : HUNTER_RANK.need(state.rank), marks: state.marks };
}

export function bountyShop(eco) {
  const state = bountyState(eco), week = WEEK(eco);
  const bought = state.shop.week === week ? state.shop.bought : {};
  return BOUNTY_SHOP.map((item) => {
    const n = bought[item.id] || 0;
    const locked = item.minRank && state.rank < item.minRank ? `사냥꾼 ${item.minRank}등급` : '';
    const soldOut = item.weekly ? n >= item.weekly : item.once ? (n >= 1 || state.owned.includes(item.grant.cosmetic)) : false;
    return { ...item, bought: n, locked, soldOut, canBuy: !locked && !soldOut && state.marks >= item.cost };
  });
}

export function buyBounty(eco, itemId) {
  const state = bountyState(eco), before = structuredClone(state);
  const r = buyBountyItem(state, itemId, WEEK(eco));
  if (!r.ok) { eco.s.bounty = before; return r; }
  const got = r.grant.cosmetic ? [] : eco.addRewards({ ...r.grant }, { silent: true, applyVip: false });
  return { ok: true, item: r.item, got, saveError: !eco.emit() };
}
