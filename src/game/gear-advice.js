// 장비 조언: 더 좋은 장비 찾기·한 번에 장착·가방 정리. 화면을 그리지 않는 순수 규칙이라 UI와 플레이 도구가 같은 함수를 쓴다.
// 장비는 영웅 소유라 모든 함수가 그 영웅의 가방(heroBag)만 다룬다. 비교 기준은 영웅 전투력(heroBuildStats: 세트·룬 반영)이고, 후보는 장비 점수(gearScore)로 먼저 걸러 비용을 줄인다.
// 분해는 economy.salvage(uids)와 salvageRewards 를 그대로 쓴다(N/S/E 만, 장착 중 불가, 보상 계산은 그쪽 규칙).
import { ITEM_BY_ID, SLOTS } from '../data/items.js';
import { itemStats } from '../data/item-tier.js';
import { salvageRewards } from './economy.js';

/** 장비 하나의 비교 점수(heroStats.power 의 장비 몫과 같은 가중치). */
export const gearScore = (inst) => { const s = itemStats(inst); return (s.atk || 0) * 6 + (s.hp || 0) * 0.5 + (s.def || 0) * 4 + (s.crit || 0) * 1000; };

const slotOf = (inst) => ITEM_BY_ID[inst?.id]?.slot || null;
// 장비는 영웅 소유다(docs/GEAR_OWNERSHIP_VAULT.md): 후보·정리 대상은 그 영웅의 가방(heroBag)뿐이고 금고·다른 영웅 장비는 건드리지 않는다.
const bagOf = (eco, heroId) => (eco.heroBag ? eco.heroBag(heroId) : eco.s.inventory.filter((x) => (x.owner ?? eco.s.selected) === heroId));
/** 어느 영웅이든 장착 중인 장비 uid → 영웅 id */
function wornMap(eco) {
  const worn = new Map();
  for (const [hid, h] of Object.entries(eco.s.heroes || {})) for (const uid of Object.values(h?.equip || {})) if (uid !== null && uid !== undefined) worn.set(uid, hid);
  return worn;
}
const byUid = (eco) => new Map((eco.s.inventory || []).map((x) => [x.uid, x]));

/** 같은 장비·강화·장비 레벨·룬 구성의 중복은 하나만 남긴다(후보 상한을 변화 없는 중복이 다 차지하지 않게). */
const dupKey = (x) => x.id + '|' + (x.enh || 0) + '|' + (x.il || 0) + '|' + (x.tp || '') + '|' + JSON.stringify(x.sockets || null);
/** 단독 점수(gearScore)가 모르는 가치 — 착용 세트 동료·박힌 룬 — 가 있으면 점수와 무관하게 실제 빌드 비교로 보낸다. */
const hasRunes = (x) => Array.isArray(x.sockets) && x.sockets.some(Boolean);
const worthComparing = (x, minScore, sets) => gearScore(x) > minScore || sets.has(ITEM_BY_ID[x.id]?.set) || hasRunes(x);
function slotCandidates(list, keep) {
  const seen = new Set(), out = [];
  for (const x of list) { const k = dupKey(x); if (seen.has(k)) continue; seen.add(k); if (keep(x)) out.push(x); }
  return out;
}

/** 같은 상태로 다시 그릴 때(필터·정렬 변경, 골드 획득 같은 무관한 갱신) 장비 비교를 다시 돌리지 않는다.
 *  상태 지문 = 가방 전체(uid·강화·소유자·장비 레벨·룬)와 모든 영웅의 장착·레벨·별·초월 + 전설 수련. 가방 1,600개 기준 계산 0.1ms 미만. */
const memo = new WeakMap();
function stateKey(eco) {
  let h = 2166136261;
  const mix = (v) => { const t = String(v); for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); };
  for (const x of eco.s.inventory || []) { mix(x.uid); mix(x.id); mix(x.enh); mix(x.owner ?? ''); mix(x.il ?? ''); mix(x.tp ?? ''); mix(x.sockets ? JSON.stringify(x.sockets) : ''); }
  for (const [id, hero] of Object.entries(eco.s.heroes || {})) { mix(id); mix(JSON.stringify(hero?.equip || {})); mix(hero?.level); mix(hero?.star); mix(hero?.grade ?? hero?.awaken ?? ''); }
  mix(JSON.stringify(eco.s.legend || null)); mix(JSON.stringify(eco.s.roster?.owned || null));
  return h >>> 0;
}
function cached(eco, name, args, compute) {
  const key = name + '|' + args + '|' + stateKey(eco);
  let box = memo.get(eco);
  if (!box || box.s !== eco.s) { box = { s: eco.s, map: new Map() }; memo.set(eco, box); }
  if (box.map.has(key)) return box.map.get(key);
  if (box.map.size > 32) box.map.clear();
  const value = compute(); box.map.set(key, value); return value;
}

/**
 * 영웅 한 명의 슬롯별 "더 좋은 장비" 후보. 다른 영웅이 끼고 있는 장비는 뺏지 않는다.
 * @returns {Map<number, number>} uid → 장착 시 전투력 증가(정수, 양수만)
 */
export function betterItems(eco, heroId, { perSlot = 12 } = {}) {
  return cached(eco, 'better', heroId + ':' + perSlot, () => betterItemsNow(eco, heroId, perSlot));
}
function betterItemsNow(eco, heroId, perSlot) {
  const out = new Map(), hero = eco.s.heroes?.[heroId];
  if (!hero || eco.heroLocked?.(heroId)) return out;
  const worn = wornMap(eco), inv = byUid(eco), basePower = eco.heroBuildStats(heroId).power;
  for (const slot of SLOTS) {
    const cur = inv.get(hero.equip?.[slot]), curScore = cur ? gearScore(cur) : -1;
    // 단독 점수가 낮아도 다른 부위와 세트를 완성하는 장비는 실제 빌드 비교까지 보낸다.
    const sets = new Set(SLOTS.filter((s) => s !== slot).map((s) => ITEM_BY_ID[inv.get(hero.equip?.[s])?.id]?.set).filter(Boolean));
    const cands = slotCandidates(bagOf(eco, heroId).filter((x) => slotOf(x) === slot && !worn.has(x.uid)), (x) => worthComparing(x, curScore, sets))
      .sort((a, b) => gearScore(b) - gearScore(a)).slice(0, perSlot);
    for (const inst of cands) {
      const delta = Math.round(eco.heroBuildStats(heroId, { ...hero.equip, [slot]: inst.uid }, eco.s.inventory).power - basePower);
      if (delta > 0) out.set(inst.uid, delta);
    }
  }
  return out;
}

/**
 * 영웅 한 명의 최선 장착 계획. 슬롯을 돌며 전투력이 가장 오르는 교체를 반복 적용(세트 효과가 슬롯끼리 얽히므로 고정점까지, 최대 8회).
 * 저장 상태는 바꾸지 않는다.
 * @returns {Array<{ slot: string, uid: number, from: number|null, delta: number }>}
 */
export function planBestEquip(eco, heroId) {
  return cached(eco, 'plan', heroId, () => planBestEquipNow(eco, heroId)).map((p) => ({ ...p }));
}
function planBestEquipNow(eco, heroId) {
  const hero = eco.s.heroes?.[heroId];
  if (!hero || eco.heroLocked?.(heroId)) return [];
  const worn = wornMap(eco), inv = byUid(eco), equip = { ...hero.equip }, plan = [];
  for (let guard = 0; guard < 8; guard++) {
    const base = eco.heroBuildStats(heroId, equip).power;
    let best = null;
    for (const slot of SLOTS) {
      const curScore = inv.get(equip[slot]) ? gearScore(inv.get(equip[slot])) : -1;
      // 세트 동료(다른 부위 착용 세트)는 점수와 무관하게 후보, 중복은 하나만 — betterItems 와 같은 후보 규칙.
      const sets = new Set(SLOTS.filter((s) => s !== slot).map((s) => ITEM_BY_ID[inv.get(equip[s])?.id]?.set).filter(Boolean));
      const cands = slotCandidates(bagOf(eco, heroId).filter((x) => slotOf(x) === slot && x.uid !== equip[slot] && !worn.has(x.uid) && !plan.some((p) => p.uid === x.uid)),
        (x) => worthComparing(x, curScore * 0.6, sets))
        .sort((a, b) => gearScore(b) - gearScore(a)).slice(0, 8);
      for (const inst of cands) {
        const delta = eco.heroBuildStats(heroId, { ...equip, [slot]: inst.uid }).power - base;
        if (delta > 0 && (!best || delta > best.delta)) best = { slot, uid: inst.uid, from: equip[slot] ?? null, delta };
      }
    }
    if (!best) break;
    equip[best.slot] = best.uid; plan.push({ ...best, delta: Math.round(best.delta) });
  }
  return plan;
}

/** 계획대로 장착한다. 반환: 적용한 교체 목록과 전투력 전후. */
export function applyBestEquip(eco, heroId) {
  const before = eco.heroBuildStats(heroId).power, plan = planBestEquip(eco, heroId), applied = [];
  for (const swap of plan) { if (eco.equip(heroId, swap.uid) === false) break; applied.push(swap); }
  return { swaps: applied, powerBefore: Math.round(before), powerAfter: Math.round(eco.heroBuildStats(heroId).power) };
}

/** 소유한 모든 영웅에게 차례로(출전 영웅 먼저) 최선 장착. 합류한 새 동료가 맨몸이 되지 않게 한다. */
export function applyBestEquipAll(eco) {
  const ids = eco.ownedHeroIds?.() || Object.keys(eco.s.heroes), first = eco.s.selected;
  const order = [first, ...ids.filter((id) => id !== first)].filter((id) => ids.includes(id));
  const results = [];
  for (const heroId of order) { const r = applyBestEquip(eco, heroId); if (r.swaps.length) results.push({ heroId, ...r }); }
  return results;
}

/**
 * 가방 정리 후보(분해해도 손해 없는 장비). 영웅 한 명의 가방(heroBag)만 본다. 조건 전부:
 *  · 등급이 rarities 안(기본 N·S·E; 분해 가능 등급은 N·S·E뿐) · 누구도 장착하지 않음
 *  · 그 영웅이 같은 부위에 끼고 있는 장비보다 점수가 높지 않음(끼고 있는 장비가 없으면 그 부위는 정리하지 않는다)
 *  · 에픽(E)은 더 엄격하다: 끼고 있는 장비보다 점수가 엄격히 낮고, 룬이 박혀 있지 않아야 한다(후반 가방에 쌓이는 E 정리용). 자동 분해는 N만 넘긴다.
 * 금고 장비·다른 영웅 소유 장비는 후보가 아니다.
 * @returns {Array<{ uid: number, id: string, rarity: string, slot: string, score: number }>}
 */
export function junkItems(eco, { rarities = ['N', 'S', 'E'], heroId = eco.s.selected } = {}) {
  return cached(eco, 'junk', heroId + ':' + rarities.join(','), () => junkItemsNow(eco, rarities, heroId)).slice();
}
function junkItemsNow(eco, rarities, heroId) {
  const allowed = new Set(rarities.filter((r) => ['N', 'S', 'E'].includes(r)));
  const hero = eco.s.heroes?.[heroId], worn = wornMap(eco), inv = byUid(eco), junk = [];
  if (!hero) return junk;
  const bag = bagOf(eco, heroId);
  for (const slot of SLOTS) {
    const cur = inv.get(hero.equip?.[slot]);
    if (!cur) continue;
    const floor = gearScore(cur);
    for (const inst of bag) {
      if (slotOf(inst) !== slot || worn.has(inst.uid)) continue;
      const rarity = ITEM_BY_ID[inst.id].rarity, score = gearScore(inst);
      // 단독 점수가 낮아도 세트를 완성해 실제 빌드가 오르는 장비는 정리(특히 자동 분해)에서 뺀다.
      if (!allowed.has(rarity) || score > floor || eco.isUpgrade?.(heroId, inst)) continue;
      if (rarity === 'E' && (score >= floor || inst.sockets?.some?.(Boolean))) continue;
      junk.push({ uid: inst.uid, id: inst.id, rarity, slot, score: Math.round(score) });
    }
  }
  return junk;
}

/** 후보를 분해했을 때 받는 합계(실제 지급은 economy.salvage 가 계산한다. 같은 salvageRewards 로 미리 합산). */
export function salvagePreview(eco, junk) {
  const inv = byUid(eco), total = { count: 0, gold: 0, stones: 0, stones2: 0, byRarity: { N: 0, S: 0, E: 0 } };
  for (const j of junk) {
    const inst = inv.get(j.uid); if (!inst) continue;
    const r = salvageRewards(inst);
    total.count++; total.gold += r.gold || 0; total.stones += r.stones || 0; total.stones2 += r.stones2 || 0; total.byRarity[j.rarity] = (total.byRarity[j.rarity] || 0) + 1;
  }
  return total;
}

/** 후보를 분해한다(v1 명령 한 번에 최대 200개라 나눠서). 실패하면 거기서 멈추고 지금까지 결과를 돌려준다. */
export function salvageItems(eco, uids) {
  const out = { ok: true, count: 0, reason: null };
  for (let i = 0; i < uids.length; i += 200) {
    const r = eco.salvage(uids.slice(i, i + 200));
    if (!r?.ok) { out.ok = false; out.reason = r?.reason || 'fail'; break; }
    out.count += r.count;
  }
  return out;
}

/** 설정 "N등급 자동 분해"가 켜져 있을 때 호출: 각 소유 영웅의 가방에서 그 영웅이 끼는 장비보다 약한 노말만 분해한다. 반환: 분해한 개수와 미리 계산한 보상. */
export function autoSalvageNormal(eco) {
  if (!eco.s.settings?.autoSalvageN) return null;
  const junk = [];
  for (const heroId of eco.ownedHeroIds?.() || Object.keys(eco.s.heroes)) junk.push(...junkItems(eco, { rarities: ['N'], heroId }));
  if (!junk.length) return null;
  const preview = salvagePreview(eco, junk), r = salvageItems(eco, junk.map((j) => j.uid));
  return r.count ? { count: r.count, gold: preview.gold, stones: preview.stones } : null;
}
