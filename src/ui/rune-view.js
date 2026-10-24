/**
 * 룬 화면(소켓 탭·룬 고르기·룬 가방/합성·각인판)의 뷰 모델. DOM 없이 순수 계산만 한다.
 * 규칙은 rune-core 의 순수 함수를 그대로 써서 화면 미리보기와 실제 적용 결과가 같게 한다(A37).
 */
import { ITEM_BY_ID, SLOTS, SLOT_NAME } from '../data/items.js';
import {
  RUNES, RUNE_BY_ID, RUNE_FAMILIES, RUNE_GRADES, RUNE_GRADE_LABEL, RUNE_DUPLICATE_CAP, RUNE_MERGE_COST,
  RUNE_REMOVE_COST, RUNE_SOURCES, RUNE_SYNERGIES, RUNE_SYNERGY_MIN,
} from '../data/runes.js';
import { socketStates, runeActivation, familyCounts, runeSynergies, normalizeRuneBag, maxSocketCount, socketCount, runeEffects, removeCost } from '../game/rune-core.js';
import { gearRunes } from '../game/rune-economy.js';
import { applyBuildStats } from '../game/masterworks-combat.js';

/** @typedef {{ id: string, grade: number }} RuneRef */
/** @typedef {{ uid: number, id: string, enh: number, sockets?: unknown }} Inst */

const FAMILY_BY_ID = Object.fromEntries(RUNE_FAMILIES.map((f) => [f.id, f]));
const num = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
const pct = (/** @type {number} */ v) => String(num(v * 100)).replace(/\.0+$/, '');
const won = (/** @type {number} */ n) => Math.floor(n || 0).toLocaleString('ko-KR');

/** 효과 키 → 화면 문구. 값은 이미 등급을 곱한 값이다. */
/** @type {Record<string, (v: number) => string>} */
const FX_TEXT = {
  atk: (v) => '공격력 +' + pct(v) + '%',
  hp: (v) => '최대 체력 +' + pct(v) + '%',
  def: (v) => '방어력 +' + pct(v) + '%',
  speed: (v) => '이동 속도 +' + pct(v) + '%',
  crit: (v) => '치명타 확률 +' + pct(v) + '%',
  finisher: (v) => '콤보 마무리 피해 +' + pct(v) + '%',
  breakPower: (v) => '균형 파괴력 +' + pct(v) + '%',
  rewardMul: (v) => '완료 명성 +' + pct(v) + '%',
  healOnKill: (v) => '처치 시 최대 체력 ' + pct(v) + '% 회복',
  perfectHeal: (v) => '정확한 회피 시 최대 체력 ' + pct(v) + '% 회복',
  cooldown: (v) => '재사용 대기시간 -' + pct(v) + '%',
  chain: (v) => '콤보 마무리 연쇄 ' + num(v) + '명',
};
/** 등급 사다리용 짧은 값. */
/** @type {Record<string, (v: number) => string>} */
const FX_SHORT = { healOnKill: (v) => pct(v) + '%', perfectHeal: (v) => pct(v) + '%', cooldown: (v) => '-' + pct(v) + '%', chain: (v) => num(v) + '명' };

export const runeName = (/** @type {string} */ id) => RUNE_BY_ID[id]?.name || id;
export const runeLabel = (/** @type {RuneRef|null|undefined} */ rune) => (rune ? runeName(rune.id) + ' ' + RUNE_GRADE_LABEL[rune.grade] : '');
export const familyOf = (/** @type {string} */ id) => FAMILY_BY_ID[RUNE_BY_ID[id]?.family] || RUNE_FAMILIES[0];

/** 룬 한 개의 등급 효과 문구(예: '공격력 +8%'). */
export function runeEffectText(/** @type {string} */ id, /** @type {number} */ grade) {
  const rune = RUNE_BY_ID[id]; if (!rune) return '';
  if (grade === 1 && !Object.keys(rune.effects).every((k) => FX_TEXT[k])) return rune.description;
  return Object.entries(rune.effects).map(([k, v]) => (FX_TEXT[k] ? FX_TEXT[k](v * grade) : rune.description)).join(' · ');
}
/** 등급 사다리 'I +4% · II +8% · III +12%'. */
export function runeLadder(/** @type {string} */ id) {
  const rune = RUNE_BY_ID[id]; if (!rune) return [];
  const [key, value] = Object.entries(rune.effects)[0] || ['', 0];
  return RUNE_GRADES.map((grade) => ({ grade, label: RUNE_GRADE_LABEL[grade], value: FX_SHORT[key] ? FX_SHORT[key](value * grade) : '+' + pct(value * grade) + '%' }));
}
export const ladderText = (/** @type {string} */ id) => runeLadder(id).map((s) => s.label + ' ' + s.value).join(' · ');
/** 빼기 비용 안내 'I 1,000 / II 3,000 / III 8,000 골드'. */
export const removeCostText = () => RUNE_GRADES.map((g) => RUNE_GRADE_LABEL[g] + ' ' + won(RUNE_REMOVE_COST[g])).join(' / ') + ' 골드';

/** 가문 4칸 보기. */
export function familyView(/** @type {Record<string, number>} */ counts) {
  return RUNE_FAMILIES.map((f) => ({ id: f.id, name: f.name, color: f.color, glyph: f.glyph, count: counts?.[f.id] || 0 }));
}
/** 공명 6종 보기(켜짐 여부·각 가문 진행). */
export function synergyView(/** @type {Record<string, number>} */ counts) {
  const on = new Set(runeSynergies(counts).map((s) => s.id));
  return RUNE_SYNERGIES.map((s) => ({
    id: s.id, name: s.name, families: s.families, active: on.has(s.id), effect: s.description.split(': ').pop() || s.description,
    progress: s.families.reduce((sum, f) => sum + Math.min(RUNE_SYNERGY_MIN, counts?.[f] || 0), 0),
  }));
}

/** 영웅 4부위 장착 인스턴스(SLOTS 순서). override 로 한 부위를 바꿔 끼운 상태를 만든다. */
export function heroGear(/** @type {any} */ eco, /** @type {string} */ heroId, /** @type {Inst|null} */ override = null, /** @type {boolean} */ removeOverride = false) {
  const h = eco.hero(heroId), inv = eco.s.inventory;
  const slot = override ? ITEM_BY_ID[override.id]?.slot : null;
  return SLOTS.map((sl) => {
    if (sl === slot) return removeOverride ? null : override;
    return inv.find((/** @type {Inst} */ x) => x.uid === h?.equip?.[sl]) || null;
  });
}
const rulesItems = (/** @type {(Inst|null)[]} */ insts) => insts.map((i) => (i ? gearRunes(i) : null));
/** 영웅 장착 기준 가문 수(잠긴 칸·중복 상한 반영). */
export const gearCounts = (/** @type {(Inst|null)[]} */ insts) => familyCounts(/** @type {any} */ (rulesItems(insts)));

/** 장비 소켓판 보기. 이 장비를 영웅이 그 부위에 낀 상태로 중복 상한·공명을 계산한다. */
export function socketBoard(/** @type {any} */ eco, /** @type {string} */ heroId, /** @type {number} */ uid) {
  const inst = eco.s.inventory.find((/** @type {Inst} */ x) => x.uid === uid); if (!inst) return null;
  const item = ITEM_BY_ID[inst.id], g = gearRunes(inst);
  const gear = heroGear(eco, heroId, inst), slotIndex = SLOTS.indexOf(item.slot);
  const act = runeActivation(/** @type {any} */ (rulesItems(gear))).filter((e) => e.item === slotIndex);
  const sockets = socketStates(g).map((s) => {
    const a = act.find((e) => e.index === s.index);
    const state = s.locked ? 'locked' : s.rune ? 'filled' : 'empty';
    return { index: s.index, rune: s.rune, label: runeLabel(s.rune), locked: s.locked, state,
      lockText: s.locked ? (s.rune ? '+15에서 다시 켜짐' : '+15 강화 시 개방') : '',
      duplicate: a?.reason === 'duplicate', active: !!a?.active, removeCost: s.rune ? removeCost(s.rune) : 0 };
  });
  const counts = gearCounts(gear);
  return { uid, itemId: inst.id, name: item.name, slot: item.slot, rarity: item.rarity, enh: inst.enh, total: maxSocketCount(item.rarity), open: socketCount(item.rarity, inst.enh),
    equipped: eco.hero(heroId)?.equip?.[item.slot] === uid, sockets, counts, families: familyView(counts), synergies: synergyView(counts) };
}
/** 장비에 룬 소켓이 있나(소켓 탭 노출 조건). */
export const hasSockets = (/** @type {{ id: string }} */ inst) => maxSocketCount(ITEM_BY_ID[inst?.id]?.rarity) > 0;

/** 빈 칸 기본 선택: 열린 빈 칸 → 열린 칸 → 0. */
export function defaultSocket(/** @type {ReturnType<typeof socketBoard>} */ board) {
  if (!board) return 0;
  return (board.sockets.find((s) => s.state === 'empty') || board.sockets.find((s) => !s.locked) || board.sockets[0] || { index: 0 }).index;
}

/** 소켓 하나를 바꿔 끼운 영웅 장비. */
function withSocket(/** @type {(Inst|null)[]} */ gear, /** @type {number} */ slotIndex, /** @type {number} */ index, /** @type {RuneRef|null} */ rune) {
  return gear.map((inst, i) => {
    if (i !== slotIndex || !inst) return inst;
    const sockets = gearRunes(inst).sockets.slice(); sockets[index] = rune;
    return { ...inst, sockets };
  });
}

/**
 * 룬 고르기 보기. filter 는 'all' 또는 가문 id, selected 는 'id:grade'.
 * 미리보기(가문 수·새 공명)는 rune-core 로 박은 뒤 상태를 그대로 계산한다.
 */
export function pickerView(/** @type {any} */ eco, /** @type {string} */ heroId, /** @type {number} */ uid, /** @type {number} */ index, { filter = 'all', selected = '' } = {}) {
  const board = socketBoard(eco, heroId, uid); if (!board) return null;
  const inst = eco.s.inventory.find((/** @type {Inst} */ x) => x.uid === uid);
  const socket = board.sockets[index] || null, current = socket?.rune || null;
  const mode = current ? 'replace' : 'insert';
  const gear = heroGear(eco, heroId, inst), slotIndex = SLOTS.indexOf(board.slot);
  const bag = normalizeRuneBag(eco.runeState().bag);
  const afterOf = (/** @type {RuneRef|null} */ rune) => withSocket(gear, slotIndex, index, rune);
  const all = [];
  for (const r of RUNES) for (const grade of [3, 2, 1]) {
    const count = bag[r.id]?.[grade - 1] || 0;
    if (!count || (current && current.id === r.id && current.grade === grade)) continue;
    const act = runeActivation(/** @type {any} */ (rulesItems(afterOf({ id: r.id, grade }))));
    const capped = act.some((e) => e.rune.id === r.id && e.reason === 'duplicate');
    all.push({ key: r.id + ':' + grade, id: r.id, grade, count, family: r.family, color: familyOf(r.id).color, name: r.name, label: runeLabel({ id: r.id, grade }), capped });
  }
  const entries = filter === 'all' ? all : all.filter((e) => e.family === filter);
  const pick = entries.find((e) => e.key === selected) || entries.find((e) => !e.capped) || entries[0] || null;
  const before = board.counts;
  let preview = null;
  if (pick) {
    const after = gearCounts(afterOf({ id: pick.id, grade: pick.grade }));
    const beforeOn = new Set(runeSynergies(before).map((s) => s.id)), afterOn = runeSynergies(after);
    preview = {
      counts: after,
      families: familyView(after),
      changes: RUNE_FAMILIES.filter((f) => after[f.id] !== before[f.id]).map((f) => ({ id: f.id, name: f.name, from: before[f.id], to: after[f.id] })),
      gained: afterOn.filter((s) => !beforeOn.has(s.id)).map((s) => s.name),
      lost: runeSynergies(before).filter((s) => !afterOn.some((a) => a.id === s.id)).map((s) => s.name),
      synergies: synergyView(after),
    };
  }
  const cost = current ? removeCost(current) : 0;
  return {
    board, index, socket, mode, current, filter, entries, total: all.length, selected: pick,
    detail: pick ? { label: pick.label, effect: runeEffectText(pick.id, pick.grade), ladder: runeLadder(pick.id), grade: pick.grade, capped: pick.capped } : null,
    preview, cost, gold: eco.s.gold, affordable: eco.s.gold >= cost,
    action: current ? '교체 (골드 ' + won(cost) + ')' : '박기 (무료)',
    removeText: current ? '빼기 · 골드 ' + won(cost) : '',
    costNote: '빼기 비용 · ' + removeCostText(),
    filters: [{ id: 'all', name: '전체' }, ...RUNE_FAMILIES.map((f) => ({ id: f.id, name: f.name }))],
  };
}

/** 룬 가방 보기: 가문 4줄 × 룬 3종, 칸마다 등급별 보유 수. */
export function bagView(/** @type {unknown} */ rawBag) {
  const bag = normalizeRuneBag(rawBag);
  return RUNE_FAMILIES.map((f) => ({ id: f.id, name: f.name, color: f.color, glyph: f.glyph,
    runes: RUNES.filter((r) => r.family === f.id).map((r) => {
      const counts = bag[r.id] ? [...bag[r.id]] : [0, 0, 0];
      return { id: r.id, name: r.name, counts, total: counts.reduce((a, b) => a + b, 0), best: counts[2] ? 3 : counts[1] ? 2 : counts[0] ? 1 : 0 };
    }) }));
}

/** 합성 기본 목표 등급: I 3개 이상이면 II, 아니면 II 3개 이상이면 III, 둘 다 아니면 II. */
export function mergeTarget(/** @type {unknown} */ rawBag, /** @type {string} */ id) {
  const c = normalizeRuneBag(rawBag)[id] || [0, 0, 0];
  return c[0] >= RUNE_MERGE_COST[2].count ? 2 : c[1] >= RUNE_MERGE_COST[3].count ? 3 : 2;
}
/** 합성 패널 보기. 확률은 항상 100%(D19). */
export function mergeView(/** @type {{ bag: unknown, gold: number, dust: number }} */ state, /** @type {string} */ id, /** @type {number} */ toGrade = mergeTarget(state.bag, id)) {
  const rune = RUNE_BY_ID[id]; if (!rune || !RUNE_MERGE_COST[toGrade]) return null;
  const cost = RUNE_MERGE_COST[toGrade], have = normalizeRuneBag(state.bag)[id]?.[toGrade - 2] || 0;
  const reason = have < cost.count ? 'materials' : state.gold < cost.gold ? 'gold' : state.dust < cost.runeDust ? 'dust' : null;
  return { id, name: rune.name, family: rune.family, color: familyOf(id).color, toGrade, fromGrade: toGrade - 1,
    from: runeLabel({ id, grade: toGrade - 1 }), to: runeLabel({ id, grade: toGrade }), have, need: cost.count,
    slots: Array.from({ length: cost.count }, (_, i) => i < have), gold: cost.gold, dust: cost.runeDust, ok: !reason, reason,
    chance: 100, button: '합성 (확정 100%)',
    reasonText: reason === 'materials' ? runeLabel({ id, grade: toGrade - 1 }) + ' ' + cost.count + '개가 필요합니다 (보유 ' + have + ')' : reason === 'gold' ? '골드가 부족합니다' : reason === 'dust' ? '룬 가루가 부족합니다' : '' };
}
/** 룬 가루 제작 안내(제작 메서드가 경제에 붙기 전까지 비활성). */
export const craftInfo = () => [
  { id: 'family', text: '가문 지정 제작 · 가루 ' + RUNE_SOURCES.craftFamily.runeDust, dust: RUNE_SOURCES.craftFamily.runeDust },
  { id: 'exact', text: '정밀 제작 · 가루 ' + RUNE_SOURCES.craftExact.runeDust, dust: RUNE_SOURCES.craftExact.runeDust },
];
export const SOURCE_TEXT = '획득처: 정예·보스 처치 · 원정 상자 · 장비 분해 · 주간 의뢰';

/** 각인판(전체 보기): 4부위 소켓, 가문 공명 막대, 켜진·가까운 공명 칩. */
export function overviewView(/** @type {any} */ eco, /** @type {string} */ heroId) {
  const gear = heroGear(eco, heroId);
  const act = runeActivation(/** @type {any} */ (rulesItems(gear)));
  const rows = SLOTS.map((slot, i) => {
    const inst = gear[i];
    if (!inst) return { slot, slotName: SLOT_NAME[slot], inst: null, sockets: [] };
    const item = ITEM_BY_ID[inst.id];
    const sockets = socketStates(gearRunes(inst)).map((s) => {
      const a = act.find((e) => e.item === i && e.index === s.index);
      return { index: s.index, rune: s.rune, label: runeLabel(s.rune), locked: s.locked, state: s.locked ? 'locked' : s.rune ? 'filled' : 'empty', duplicate: a?.reason === 'duplicate' };
    });
    return { slot, slotName: SLOT_NAME[slot], inst, uid: inst.uid, name: item.name, rarity: item.rarity, enh: inst.enh, sockets };
  });
  const counts = gearCounts(gear), syn = synergyView(counts);
  const on = syn.filter((s) => s.active), near = syn.filter((s) => !s.active).sort((a, b) => b.progress - a.progress).slice(0, Math.max(0, 2 - on.length));
  const plan = autoFillPlan(eco, heroId);
  return { rows, counts, families: familyView(counts), synergies: syn, chips: [...on, ...near], plan, effects: totalEffects(eco, heroId) };
}

/** 총 룬 효과 문구 목록(각인판 '총 룬 효과 보기'). */
export function totalEffects(/** @type {any} */ eco, /** @type {string} */ heroId) {
  const fx = eco.heroRuneEffects(heroId) || {};
  return Object.entries(fx).filter(([, v]) => v).map(([k, v]) => (FX_TEXT[k] ? FX_TEXT[k](/** @type {number} */ (v)) : k + ' ' + v));
}

/**
 * 자동 장착 계획: 장착 장비의 열린 빈 칸만 채운다(박힌 룬은 건드리지 않아 회수 비용 0).
 * 칸마다 가방에서 효과가 살아 있는(중복 상한 안) 룬 중 높은 등급 → 새 공명 → RUNES 순으로 고른다.
 * @returns {Array<{ uid: number, index: number, rune: RuneRef }>}
 */
export function autoFillPlan(/** @type {any} */ eco, /** @type {string} */ heroId) {
  let gear = heroGear(eco, heroId);
  const bag = normalizeRuneBag(eco.runeState().bag);
  /** @type {Array<{ uid: number, index: number, rune: RuneRef }>} */
  const plan = [];
  gear.forEach((inst, slotIndex) => {
    if (!inst) return;
    for (const s of socketStates(gearRunes(inst))) {
      if (s.locked || s.rune) continue;
      const baseSyn = runeSynergies(gearCounts(gear)).length;
      let best = null, bestScore = -1;
      for (const [order, r] of RUNES.entries()) for (const grade of [3, 2, 1]) {
        if (!(bag[r.id]?.[grade - 1] > 0)) continue;
        const next = withSocket(gear, slotIndex, s.index, { id: r.id, grade });
        if (runeActivation(/** @type {any} */ (rulesItems(next))).some((e) => e.rune.id === r.id && e.reason === 'duplicate')) continue;
        const score = grade * 1000 + (runeSynergies(gearCounts(next)).length - baseSyn) * 100 + (RUNES.length - order);
        if (score > bestScore) { bestScore = score; best = { id: r.id, grade }; }
      }
      if (!best) continue;
      bag[best.id] = bag[best.id].map((n, i) => (i === best.grade - 1 ? n - 1 : n));
      gear = withSocket(gear, slotIndex, s.index, best);
      plan.push({ uid: inst.uid, index: s.index, rune: best });
    }
  });
  return plan;
}

/** 룬 효과까지 반영한 장착 비교(전투력은 heroPower 와 같은 식). previewItem 결과에 before/after 를 덮어쓴다. */
export function runeAwarePreview(/** @type {any} */ eco, /** @type {string} */ heroId, /** @type {number} */ uid) {
  const p = eco.previewItem(heroId, uid); if (!p) return p;
  const inst = eco.s.inventory.find((/** @type {Inst} */ x) => x.uid === uid);
  const fx = (/** @type {(Inst|null)[]} */ gear) => { const items = gear.filter((i) => i?.sockets).map((i) => gearRunes(/** @type {Inst} */ (i))); return items.length ? runeEffects(items) : {}; };
  const apply = (/** @type {any} */ st, /** @type {Record<string, number>} */ e) => (Object.keys(e).length ? applyBuildStats(st, e) : st);
  const beforeFx = fx(heroGear(eco, heroId)), afterFx = fx(heroGear(eco, heroId, inst, p.remove));
  return { ...p, before: apply(p.before, beforeFx), after: apply(p.after, afterFx), runeFx: { before: beforeFx, after: afterFx } };
}

export { RUNE_FAMILIES, RUNE_GRADE_LABEL, RUNE_DUPLICATE_CAP, FAMILY_BY_ID };
