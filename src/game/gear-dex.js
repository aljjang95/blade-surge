// 영웅별 장비 도감 (docs/GEAR_VAULT_INHERIT.md 4.3·5.1). 순수 규칙: 클라이언트·서버가 같이 쓴다.
// gearDex = { v:1, drop:{[heroId]:[itemId…]}, kin:{…}, claimed:{[heroId]:[milestoneId…]} }. 비어 있으면 필드 자체를 두지 않는다.
// drop = 그 영웅이 직접 얻은 장비 종류(pushItem·서버 정산 드랍), kin = 계승 의식으로 받은 장비 종류. 일반 꺼내기·장착은 등재하지 않는다.
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID } from '../data/items.js';

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const knownHero = (id) => typeof id === 'string' && Object.hasOwn(HEROES, id);

/**
 * 마일스톤 표(docs/GEAR_VAULT_INHERIT.md 4.3). 영웅마다 한 번씩만 받는다. 보상은 게임 내 재료·계승 문장·칭호뿐이고 능력치는 없다(전투력 곡선 불변).
 * 칭호는 별도 저장 없이 수령 기록(claimed)에서 계산해 도감 화면에 보인다. 아바타 조각은 유료 아바타 상품과 섞이지 않게 넣지 않았다(BM 결정 전).
 * 계승 문장 총량(영웅 1명 기준 일회성): 드랍 도감 4개 + 계승 도감 5개 = 9개. 주간 수급(일일·주간 의뢰)과 별개의 누적 보상이라 sim:90d 전투력 밴드에 들어가지 않는다.
 * kind: drop(드랍 도감 비율 %) · kin(계승 도감 종수).
 */
export const GEAR_DEX_MILESTONES = Object.freeze([
  { id: 'drop25', kind: 'drop', need: 25, title: '수집가', rewards: Object.freeze({ stones2: 5, lineageSigil: 1 }) },
  { id: 'drop50', kind: 'drop', need: 50, title: '', rewards: Object.freeze({ stones2: 10, fragments: 30 }) },
  { id: 'drop75', kind: 'drop', need: 75, title: '', rewards: Object.freeze({ stones3: 3, fragments: 40, lineageSigil: 1 }) },
  { id: 'drop100', kind: 'drop', need: 100, title: '장비 도감 완성', rewards: Object.freeze({ stones3: 8, bless: 2, lineageSigil: 2 }) },
  { id: 'kin5', kind: 'kin', need: 5, title: '', rewards: Object.freeze({ stones2: 5, lineageSigil: 1 }) },
  { id: 'kin15', kind: 'kin', need: 15, title: '계승자', rewards: Object.freeze({ stones3: 2, lineageSigil: 2 }) },
  { id: 'kin30', kind: 'kin', need: 30, title: '대계승자', rewards: Object.freeze({ stones3: 5, fragments: 50, lineageSigil: 2 }) },
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

/**
 * 저장에 정규화한 도감을 붙인다. 빈 결과도 "이관 완료" 표지(빈 도감)로 남긴다: 필드를 지우면 다음 로드가 이전 저장으로 보고
 * 현재 소유 장비로 다시 소급해 일반 이동만으로 도감이 찬다. 이전 저장 판정은 gearDex 필드 유무(표지)다.
 */
export function setGearDex(s, dex) { s.gearDex = dex || { v: 1, drop: {}, kin: {}, claimed: {} }; }

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
