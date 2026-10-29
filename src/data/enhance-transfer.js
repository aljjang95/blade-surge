// 강화 전승 비용표(대표님 2026-10-29 "드랍이 쓸모없고 골드가 쌓인다").
// 실측(신규 계정 실입력 캠페인 5-7): 네 부위 모두 E 등급 +11, 골드 210만(그 구간 소비 0), 강화석 9,128 · 상급 2,178, 가방 469개(U 245 · L 74).
// 새 U/L 드랍이 늘 착용 중인 E+11 보다 약해서 드랍과 골드가 함께 무의미해졌다. 전승은 강화 단계를 같은 부위의 다른 장비로 옮긴다.
// 클라이언트(Economy.enhanceTransfer)와 서버 /cmd enhanceTransfer(EconomyCore 가 같은 메서드)가 이 표 하나를 쓴다. 난수는 쓰지 않는다.
import { ITEM_BY_ID, rarityRank, enhanceStoneTier, STONE_KEY } from './items.js';
import { validItemLevel, ITEM_LEVEL_MAX } from './item-tier.js';

/** 이 단계 이상인 장비만 원본이 될 수 있다(+4 이하는 다시 강화하는 편이 거의 공짜다). */
export const TRANSFER_MIN_ENH = 5;
/** 기본 손실: 대상은 원본 단계 − 1. 전승 보호 주문서(transferScroll)를 쓰면 0. */
export const TRANSFER_LOSS = 1;
/** 골드 = 기준 × 성장^(원본 단계 − 5) × 대상 등급 계수 × 대상 장비 레벨 계수, 100 단위 반올림. */
export const TRANSFER_GOLD_BASE = 19000, TRANSFER_GOLD_GROWTH = 1.5;
/** 대상 등급 계수: 더 높은 등급으로 옮길수록 비싸다(L 이 기준 U 보다 20% 더). */
export const TRANSFER_RARITY_MUL = Object.freeze({ N: 0.6, S: 0.75, E: 0.9, U: 1, L: 1.2 });
/** 대상 장비 레벨(il) 계수: 1 + (il − 1)/220 (il 80 = 1.36). 고통 단계(tp) 장비는 최고 계수. il 없는 장비는 1. */
export const transferIlMul = (inst) => {
  const il = inst?.tp > 0 ? ITEM_LEVEL_MAX : validItemLevel(inst?.il);
  return il > 1 ? 1 + (il - 1) / 220 : 1;
};
/** 강화석: 원본 단계의 마지막 강화(enh − 1)가 쓰던 등급. 하급 10 · 상급 5 × (enh − 4), 전설 2 × (enh − 12). */
export const transferStones = (enh) => {
  const tier = enhanceStoneTier(enh - 1);
  const n = tier === 1 ? 10 * (enh - 4) : tier === 2 ? 5 * (enh - 4) : 2 * (enh - 12);
  return { tier, key: STONE_KEY[tier], n };
};
export const transferGold = (enh, targetInst) => {
  const def = ITEM_BY_ID[targetInst?.id]; if (!def) return null;
  const raw = TRANSFER_GOLD_BASE * Math.pow(TRANSFER_GOLD_GROWTH, enh - TRANSFER_MIN_ENH) * (TRANSFER_RARITY_MUL[def.rarity] ?? 1) * transferIlMul(targetInst);
  return Math.round(raw / 100) * 100;
};

/**
 * 순수 규칙(저장 상태를 바꾸지 않는다). eco 는 { s, heroLocked(id) } 만 쓴다.
 * 규칙: 서로 다른 장비 · 같은 부위 · 같은 주인 영웅(금고 장비 불가) · 대상 등급 ≥ 원본 등급 · 결과 단계 > 대상 현재 단계 ·
 *       대상이 다른 영웅에게 장착돼 있지 않음. 원본은 +0 으로 돌아가고(파괴·분해하지 않음) 룬 소켓·내구도(dur)·il·tp 는 각 장비에 그대로 남는다.
 * @returns {{ ok: boolean, reason?: string, from?: number, to?: number, loss?: number, gold?: number, stones?: number, stoneKey?: string, stoneTier?: number, scroll?: boolean, targetEnh?: number, swapEquip?: boolean }}
 */
export function transferQuote(eco, srcUid, dstUid, { scroll = false } = {}) {
  const s = eco.s;
  if (srcUid === dstUid) return { ok: false, reason: 'same' };
  const src = s.inventory.find((x) => x.uid === srcUid), dst = s.inventory.find((x) => x.uid === dstUid);
  const sd = ITEM_BY_ID[src?.id], dd = ITEM_BY_ID[dst?.id];
  if (!sd || !dd) return { ok: false, reason: 'item' };
  if (sd.slot !== dd.slot) return { ok: false, reason: 'slot' };
  const owner = src.owner ?? s.selected;
  if (owner === 'vault' || (dst.owner ?? s.selected) !== owner || !s.heroes[owner]) return { ok: false, reason: 'owner' };
  if (eco.heroLocked(owner)) return { ok: false, reason: 'locked' };
  for (const hid in s.heroes) if (hid !== owner && s.heroes[hid].equip?.[dd.slot] === dstUid) return { ok: false, reason: 'worn' };
  if (rarityRank(dd.rarity) < rarityRank(sd.rarity)) return { ok: false, reason: 'rarity' };
  const from = Math.floor(Number(src.enh) || 0);
  if (from < TRANSFER_MIN_ENH) return { ok: false, reason: 'min', from };
  const loss = scroll ? 0 : TRANSFER_LOSS, to = from - loss, targetEnh = Math.floor(Number(dst.enh) || 0);
  const st = transferStones(from), gold = transferGold(from, dst);
  const base = { from, to, loss, gold, stones: st.n, stoneKey: st.key, stoneTier: st.tier, scroll: !!scroll, targetEnh, swapEquip: s.heroes[owner].equip?.[sd.slot] === srcUid };
  if (to <= targetEnh) return { ok: false, reason: 'gain', ...base };
  if (s.gold < gold) return { ok: false, reason: 'gold', ...base };
  if ((s[st.key] || 0) < st.n) return { ok: false, reason: 'stones', ...base };
  if (scroll && !((s.transferScroll || 0) > 0)) return { ok: false, reason: 'scroll', ...base };
  return { ok: true, ...base };
}
