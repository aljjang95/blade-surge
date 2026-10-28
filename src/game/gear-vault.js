// 장비 영웅 귀속 · 금고 규칙 (순수, docs/GEAR_OWNERSHIP_VAULT.md). DOM·저장소 없이 클라이언트·서버가 같이 쓴다.
import { HEROES, kitOf } from '../data/heroes.js';
import { ITEM_BY_ID, SLOTS, ENH_MAX } from '../data/items.js';
import { periodAt } from './journey-core.js';

export const VAULT_OWNER = 'vault';
export const VAULT = Object.freeze({
  baseSlots: 20,
  slotsPerExpansion: 10,
  maxExpansions: 8,
  expandGoldBase: 50000,
  dailyPaidWithdrawals: 5,
  /** 꺼내기 골드 기본값(등급별). 실제 비용 = 기본값 × (1 + 강화/10), 10 단위 올림. */
  withdrawBase: Object.freeze({ N: 500, S: 2000, E: 8000, U: 25000, L: 80000 }),
});

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, fallback, min, max) => (Number.isSafeInteger(v) ? Math.max(min, Math.min(max, v)) : fallback);
const knownHero = (id) => typeof id === 'string' && Object.hasOwn(HEROES, id);

/** 금고 메타 정규화. 여러 번 적용해도 같다. */
export function normalizeVault(raw) {
  const v = record(raw) ? raw : {};
  return { v: 1, expansions: int(v.expansions, 0, 0, VAULT.maxExpansions), day: int(v.day, 0, 0, 1e9), used: int(v.used, 0, 0, 1000) };
}

/**
 * 귀속 이관(로드마다). 장착 = 소유, 귀속 이전 저장(raw.vault 없음)의 미장착 장비는 지금 고른 영웅 + legacy(첫 이동 무료).
 * 장비 수·uid·강화·tp·소켓은 건드리지 않고 owner/from/legacy 만 정한다. 멱등.
 * @param {any} s 정규화 중인 저장(heroes.equip 정리 뒤) @param {any} raw 원본 저장
 */
export function normalizeGearOwnership(s, raw) {
  const legacySave = !record(raw?.vault);
  // 중복 uid 는 normalizeSave 처럼 처음 것만 쓴다.
  const rawById = new Map();
  for (const x of Array.isArray(raw?.inventory) ? raw.inventory : []) if (record(x) && !rawById.has(x.uid)) rawById.set(x.uid, x);
  const wearer = new Map();
  for (const [heroId, h] of Object.entries(s.heroes)) for (const slot of SLOTS) if (h.equip[slot] != null) wearer.set(h.equip[slot], heroId);
  const fallback = knownHero(s.selected) ? s.selected : Object.keys(HEROES)[0];
  for (const item of s.inventory) {
    const src = rawById.get(item.uid) || {};
    const worn = wearer.get(item.uid);
    const saved = src.owner === VAULT_OWNER || knownHero(src.owner) ? src.owner : null;
    // 저장된 소유자가 있으면 그것이 정본이다. 다른 영웅(또는 금고 장비를) 착용 참조로 소유를 바꾸지 않고 착용만 푼다
    // (PR #353 교차 리뷰: 착용 참조를 직접 바꾸는 경로가 정규화에서 소유 확정으로 이어져 금고 이전 비용을 우회했다).
    if (saved && worn && worn !== saved) {
      for (const slot of SLOTS) if (s.heroes[worn].equip[slot] === item.uid) s.heroes[worn].equip[slot] = null;
    }
    let owner = saved || worn || null;
    let legacy = src.legacy === 1 && owner !== null;
    if (!owner) { owner = fallback; legacy = legacySave; }
    item.owner = owner;
    if (owner === VAULT_OWNER && knownHero(src.from)) item.from = src.from; else delete item.from;
    if (legacy) item.legacy = 1; else delete item.legacy;
  }
  s.vault = normalizeVault(raw?.vault);
  return s;
}

export const itemOwner = (inst) => inst?.owner ?? null;
export const vaultSlots = (vault) => VAULT.baseSlots + normalizeVault(vault).expansions * VAULT.slotsPerExpansion;
export const vaultItems = (s) => (s.inventory || []).filter((x) => x.owner === VAULT_OWNER && ITEM_BY_ID[x.id]);
/** 그 영웅 소유 장비(가방). owner 가 없는 장비는 이관 전 상태라 지금 고른 영웅 것으로 본다. */
export const heroItems = (s, heroId) => (s.inventory || []).filter((x) => ITEM_BY_ID[x.id] && (x.owner ?? s.selected) === heroId);

/** 하루 유료 꺼내기 사용량(날짜가 바뀌면 0). 날짜는 앞으로만 간다. */
export function vaultDay(vault, nowMs) {
  const v = normalizeVault(vault), day = periodAt(nowMs).day;
  return day > v.day ? { day, used: 0 } : { day: v.day, used: v.used };
}

/** 무료 꺼내기 사유. null 이면 유료. */
export function freeReason(inst, heroId) {
  if (inst.legacy === 1) return 'legacy';
  if (!knownHero(inst.from)) return null;
  if (inst.from === heroId) return 'return';
  if (kitOf(inst.from) === kitOf(heroId)) return 'kin';
  return null;
}

export function withdrawGold(inst) {
  const base = VAULT.withdrawBase[ITEM_BY_ID[inst.id]?.rarity] ?? VAULT.withdrawBase.N;
  const enh = Math.max(0, Math.min(ENH_MAX, Math.floor(Number(inst.enh) || 0)));
  return Math.ceil(base * (1 + enh / 10) / 10) * 10;
}

export function expandGold(vault) { return VAULT.expandGoldBase * 2 ** normalizeVault(vault).expansions; }

/**
 * 꺼내기 견적. ok=false 면 reason: item(금고에 없음)·hero(대상 아님)·daily(유료 횟수 소진)·gold.
 * @returns {{ ok: boolean, reason?: string, gold: number, free: string|null, daily: { day: number, used: number, left: number } }}
 */
export function withdrawQuote(s, uid, heroId, nowMs, { ownsHero = () => true } = {}) {
  const inst = (s.inventory || []).find((x) => x.uid === uid);
  const d = vaultDay(s.vault, nowMs), daily = { ...d, left: Math.max(0, VAULT.dailyPaidWithdrawals - d.used) };
  if (!inst || inst.owner !== VAULT_OWNER || !ITEM_BY_ID[inst.id]) return { ok: false, reason: 'item', gold: 0, free: null, daily };
  if (!knownHero(heroId) || !ownsHero(heroId)) return { ok: false, reason: 'hero', gold: 0, free: null, daily };
  const free = freeReason(inst, heroId), gold = free ? 0 : withdrawGold(inst);
  if (!free && daily.left <= 0) return { ok: false, reason: 'daily', gold, free, daily };
  if (gold > (s.gold || 0)) return { ok: false, reason: 'gold', gold, free, daily };
  return { ok: true, gold, free, daily };
}
