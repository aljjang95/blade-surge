// 영웅별 장비 도감 (docs/GEAR_VAULT_INHERIT.md 4.3·5.1). 순수 규칙: 클라이언트·서버가 같이 쓴다.
// gearDex = { v:1, drop:{[heroId]:[itemId…]}, kin:{…}, claimed:{[heroId]:[milestoneId…]} }. 비어 있으면 필드 자체를 두지 않는다.
// drop = 그 영웅이 직접 얻은 장비 종류(pushItem·서버 정산 드랍), kin = 계승 의식으로 받은 장비 종류. 일반 꺼내기·장착은 등재하지 않는다.
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID } from '../data/items.js';

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const knownHero = (id) => typeof id === 'string' && Object.hasOwn(HEROES, id);

/**
 * 마일스톤 표(자리). 조건만 정하고 보상 수치는 덩어리 4에서 정한다. 보상은 게임 내 재료만(현금 상품 금지).
 * kind: drop(드랍 도감 비율 %) · kin(계승 도감 종수).
 */
export const GEAR_DEX_MILESTONES = Object.freeze([
  { id: 'drop25', kind: 'drop', need: 25, rewards: Object.freeze({}) },
  { id: 'drop50', kind: 'drop', need: 50, rewards: Object.freeze({}) },
  { id: 'drop75', kind: 'drop', need: 75, rewards: Object.freeze({}) },
  { id: 'drop100', kind: 'drop', need: 100, rewards: Object.freeze({}) },
  { id: 'kin5', kind: 'kin', need: 5, rewards: Object.freeze({}) },
  { id: 'kin15', kind: 'kin', need: 15, rewards: Object.freeze({}) },
  { id: 'kin30', kind: 'kin', need: 30, rewards: Object.freeze({}) },
]);
const MILESTONE_BY_ID = Object.fromEntries(GEAR_DEX_MILESTONES.map((m) => [m.id, m]));

const cleanMap = (raw, keepId) => {
  const out = {};
  if (!record(raw)) return out;
  for (const hid of Object.keys(HEROES)) {
    const list = [...new Set((Array.isArray(raw[hid]) ? raw[hid] : []).filter(keepId))];
    if (list.length) out[hid] = list;
  }
  return out;
};

/** 정규화. 알려진 영웅·카탈로그 아이템·표의 마일스톤만 남기고 중복을 없앤다. 비면 null(필드 생략). 멱등. */
export function normalizeGearDex(raw) {
  if (!record(raw)) return null;
  const drop = cleanMap(raw.drop, (x) => typeof x === 'string' && Object.hasOwn(ITEM_BY_ID, x));
  const kin = cleanMap(raw.kin, (x) => typeof x === 'string' && Object.hasOwn(ITEM_BY_ID, x));
  const claimed = cleanMap(raw.claimed, (x) => typeof x === 'string' && Object.hasOwn(MILESTONE_BY_ID, x));
  if (!Object.keys(drop).length && !Object.keys(kin).length && !Object.keys(claimed).length) return null;
  return { v: 1, drop, kin, claimed };
}

/** 저장에 정규화한 도감을 붙인다(없으면 필드 제거). */
export function setGearDex(s, dex) { if (dex) s.gearDex = dex; else delete s.gearDex; }

/** 첫 이관(원본에 gearDex 없음): 지금 영웅이 가진 장비(금고 제외) 종류를 그 영웅의 드랍 도감에 한 번 넣는다. */
export function seedGearDex(s) {
  const drop = {};
  for (const x of s.inventory || []) if (knownHero(x.owner) && Object.hasOwn(ITEM_BY_ID, x.id)) (drop[x.owner] ||= new Set()).add(x.id);
  return normalizeGearDex({ drop: Object.fromEntries(Object.entries(drop).map(([h, set]) => [h, [...set]])) });
}

/** 도감 등재. kind = 'drop' | 'kin'. 이미 있으면 그대로(멱등). 등재했으면 true. */
export function recordGearDex(s, kind, heroId, itemId) {
  if (!knownHero(heroId) || !Object.hasOwn(ITEM_BY_ID, itemId)) return false;
  const dex = record(s.gearDex) ? s.gearDex : (s.gearDex = { v: 1, drop: {}, kin: {}, claimed: {} });
  const list = (dex[kind][heroId] ||= []);
  if (list.includes(itemId)) return false;
  list.push(itemId); return true;
}

export const dexCount = (s, kind, heroId) => (s.gearDex?.[kind]?.[heroId] || []).length;
const dropTotal = () => Object.keys(ITEM_BY_ID).length;

/** 마일스톤 달성 여부(서버가 gearDex 로 재계산). */
export function milestoneReached(s, heroId, milestoneId) {
  const m = MILESTONE_BY_ID[milestoneId]; if (!m) return false;
  return m.kind === 'drop' ? dexCount(s, 'drop', heroId) * 100 >= m.need * dropTotal() : dexCount(s, 'kin', heroId) >= m.need;
}
export const milestoneOf = (id) => MILESTONE_BY_ID[id] || null;
export const milestoneClaimed = (s, heroId, id) => (s.gearDex?.claimed?.[heroId] || []).includes(id);
