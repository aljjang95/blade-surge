// 클리어 결과 화면(카드 선택 · 즉석 정비소 · 수리)의 표시 계산. 화면을 그리지 않는 순수 함수라 시험이 쉽다.
// 정산 상태를 바꾸지 않는다(읽기 전용): 보상은 항상 eco 메서드(pickClearCard · sellItem · salvage · enhance · repairItem)만 준다.
import { CARD_TIERS, DUR_MAX, durOf, durStep } from '../game/clear-loop.js';
import { ITEM_BY_ID, RARITY_INFO, SLOT_NAME, ENH_MAX } from '../data/items.js';
import { REWARD_LABEL, salvageRewards } from '../game/economy.js';
import { HEROES } from '../data/heroes.js';
import { compareLoot, compareText } from './loot-compare.js';

export const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const SALVAGE_RARITY = ['N', 'S', 'E'];
const SELL_BULK_RARITY = ['N', 'S'];

/** 카드 뒷면 → 앞면 뒤집기 간격(초). 0.25초 간격. */
export const FLIP_STEP = 0.25;

// ---------- 카드 ----------
// 수리 카드 전용 그림 파일이 없어 iconSrc 를 비우고 CSS 망치 그림(.cl-hammer)을 쓴다.
const SCROLL_NAME = { bless: '축복 주문서', protect: '보호 주문서' };

/** 카드 한 장의 표시 값. 장비는 itemId 만 알려 주고 그림은 호출자가 itemIconHtml 로 만든다. */
export function cardView(card, { heroId = '' } = {}) {
  const t = CARD_TIERS[card.tier] || CARD_TIERS.common;
  const base = { kind: card.kind, tier: card.tier, tierName: t.name, iconSrc: '', gearId: '', ownerTag: '', sub: '' };
  if (card.kind === 'gold') return { ...base, name: '금화 꾸러미', value: `+${fmt(card.gold)} 골드`, iconSrc: REWARD_LABEL.gold[1] };
  if (card.kind === 'stones') {
    const [label, src] = REWARD_LABEL[card.key] || ['강화석', REWARD_LABEL.stones[1]];
    return { ...base, name: `${label} 꾸러미`, value: `+${fmt(card.n)}개`, iconSrc: src };
  }
  if (card.kind === 'fragments') return { ...base, name: '세트 조각 상자', value: `+${fmt(card.n)}조각`, iconSrc: REWARD_LABEL.fragments[1] };
  if (card.kind === 'scroll') return { ...base, name: SCROLL_NAME[card.key] || '주문서', value: `+${card.n || 1}장`, iconSrc: (REWARD_LABEL[card.key] || ['', ''])[1] };
  if (card.kind === 'repair') return { ...base, name: '정비 쿠폰', value: `무기 완전 수리${card.gold ? ` · +${fmt(card.gold)} 골드` : ''}`, iconSrc: '' };
  // gear
  const def = ITEM_BY_ID[card.id];
  const view = { ...base, name: def?.name || '장비', value: `${SLOT_NAME[def?.slot || card.slot] || ''} · ${RARITY_INFO[def?.rarity || card.rarity]?.name || ''}`, gearId: card.id };
  if (heroId) view.ownerTag = ownerTag(heroId, '');
  return view;
}

/** 장비 주인이 출전 영웅과 다르면 '◆ <영웅> 장비', 같거나 모르면 빈 문자열. */
export function ownerTag(ownerId, battleHeroId) {
  if (!ownerId || ownerId === battleHeroId) return '';
  return `◆ ${HEROES[ownerId]?.name || ownerId} 장비`;
}

/**
 * 카드가 장비일 때 착용 비교 한 줄(저장 상태를 바꾸지 않는 미리보기). 아직 가방에 없는 장비라 임시 인스턴스로 전투력만 계산한다.
 * @returns {string} 예 '▲ 전투력 +120' / '▼ 전투력 -30' / '' (계산 불가)
 */
export function cardGearCompare(eco, heroId, card) {
  try {
    const def = ITEM_BY_ID[card.id], hero = eco.hero(heroId);
    if (card.kind !== 'gear' || !def || !hero) return '';
    const inst = { uid: -999, id: card.id, enh: 0, owner: heroId, ...(card.il ? { il: card.il } : {}) };
    const before = eco.heroBuildStats(heroId).power;
    const after = eco.heroBuildStats(heroId, { ...hero.equip, [def.slot]: inst.uid }, [...eco.s.inventory, inst]).power;
    const d = Math.round(after - before);
    if (d > 0) return `▲ 전투력 +${fmt(d)}`;
    if (d < 0) return `▼ 전투력 -${fmt(-d)}`;
    return '= 전투력 같음';
  } catch { return ''; }
}

/** 고른 카드로 받은 것을 한 줄로(토스트). */
export function pickToast(card) {
  const v = cardView(card);
  return `${v.tierName} 카드 · ${v.name} ${v.value}`;
}

// ---------- 요약 칩 ----------
/** 카드 아래 한 줄 요약: '골드 +x · 강화석 +y · 장비 n개 · EXP +z'. 0인 항목은 뺀다. */
export function summaryChips(reward) {
  if (!reward) return [];
  const sum = {};
  for (const g of reward.got || []) if (g && g.k !== 'item') sum[g.k] = (sum[g.k] || 0) + (Number(g.n) || 0);
  const chips = [];
  if (sum.gold) chips.push(`골드 +${fmt(sum.gold)}`);
  const stones = (sum.stones || 0) + (sum.stones2 || 0) + (sum.stones3 || 0);
  if (stones) chips.push(`강화석 +${fmt(stones)}`);
  if (sum.fragments) chips.push(`세트 조각 +${fmt(sum.fragments)}`);
  if (sum.gems) chips.push(`보석 +${fmt(sum.gems)}`);
  const loot = (reward.loot || []).length;
  if (loot) chips.push(`장비 ${fmt(loot)}개`);
  if (reward.totalExp || reward.exp) chips.push(`EXP +${fmt(reward.totalExp || reward.exp)}`);
  return chips;
}

/** 지난 판 미선택 카드 자동 수령 문구(없으면 ''). */
export function autoCardText(autoCard) {
  if (!autoCard?.card) return '';
  const v = cardView(autoCard.card);
  return `지난 판 미선택 카드 자동 수령: ${v.name} ${v.value}`;
}

// ---------- 수리 ----------
/**
 * 착용 무기 내구도 줄. inst 가 없으면 null(무기 없음).
 * wearDelta = 이번 판 마모량(없으면 0).
 */
export function durabilityView(inst, def, { gold = 0, quote = /** @type {any} */ (null), wearDelta = 0 } = {}) {
  if (!inst || !def) return null;
  const dur = durOf(inst), step = durStep(dur), cost = quote?.cost ?? 0;
  const full = cost <= 0;
  return {
    uid: inst.uid, name: def.name, dur, max: DUR_MAX, pct: Math.max(0, Math.min(100, dur)), label: step.label, tone: dur >= 50 ? 'good' : dur >= 25 ? 'warn' : 'bad',
    text: `무기 내구도 ${dur}/${DUR_MAX} · ${step.label}`,
    wearText: wearDelta > 0 ? `이번 판 −${wearDelta}` : '',
    cost, full,
    buttonText: full ? '수리 불필요' : `수리 −${fmt(cost)}골드`,
    disabled: full || gold < cost,
    lack: !full && gold < cost ? cost - gold : 0,
  };
}

/** 이번 판 마모량: 영수증 wear({before, dur}) 의 차이. */
export const wearDeltaOf = (wear) => (wear && Number.isFinite(wear.before) && Number.isFinite(wear.dur) ? Math.max(0, wear.before - wear.dur) : 0);

// ---------- 즉석 정비소 ----------
const sellGoldOf = (rarity) => RARITY_INFO[rarity]?.sell || 200;

/**
 * 정비소 행: 이번 판 얻은 장비 uid 목록 중 아직 가방에 남아 있는 것만, 높은 등급 순으로.
 * @param {*} eco Economy
 * @param {number[]} uids
 * @param {{ heroId: string }} ctx 출전 영웅
 */
export function shopRows(eco, uids, { heroId }) {
  const worn = new Set();
  for (const h of Object.values(eco.s.heroes || {})) for (const u of Object.values(h?.equip || {})) if (u !== null && u !== undefined) worn.add(u);
  const rows = [];
  const seen = new Set();
  for (const uid of uids) {
    if (seen.has(uid)) continue; seen.add(uid);
    const inst = eco.s.inventory.find((x) => x.uid === uid), def = inst && ITEM_BY_ID[inst.id];
    if (!def) continue;
    const owner = inst.owner ?? eco.s.selected, equipped = worn.has(uid);
    const quote = inst.enh >= ENH_MAX ? null : eco.enhanceQuote(uid);
    const sell = sellGoldOf(def.rarity), salv = salvageRewards(inst);
    const canSalvage = SALVAGE_RARITY.includes(def.rarity) && !equipped;
    const tag = ownerTag(owner, heroId);
    const cmp = tag ? null : compareLoot(eco, heroId, uid);
    const stoneKey = quote?.stoneKey || 'stones';
    const lackGold = quote ? eco.s.gold < quote.gold : false, lackStones = quote ? (eco.s[stoneKey] || 0) < quote.stones : false;
    rows.push({
      uid, id: inst.id, rarity: def.rarity, rarityName: RARITY_INFO[def.rarity]?.name || '', slotName: SLOT_NAME[def.slot] || '', enh: inst.enh || 0,
      owner, ownerTag: tag, compare: tag ? '' : compareText(cmp).short, verdict: cmp?.verdict || '', equipped,
      sell, sellDisabled: equipped, sellConfirm: !SELL_BULK_RARITY.includes(def.rarity) || (inst.enh || 0) > 0,
      canSalvage, salvageText: canSalvage ? `분해 +${fmt(salv.gold)}골드·강화석 ${fmt((salv.stones || 0) + (salv.stones2 || 0))}` : equipped ? '착용 중' : '분해 불가',
      enhanceText: quote ? `강화 +${(inst.enh || 0) + 1} · ${fmt(quote.gold)}` : '최대 강화',
      canEnhance: !!quote, enhanceLack: lackGold || lackStones,
    });
  }
  const rank = (r) => ['L', 'U', 'E', 'S', 'N'].indexOf(r);
  return rows.sort((a, b) => rank(a.rarity) - rank(b.rarity) || b.enh - a.enh || a.uid - b.uid);
}

/** '노말·스페셜 모두 판매' 대상(착용 중이 아닌 N/S 이번 판 장비)과 합계. */
export function bulkSellPlan(rows) {
  const targets = rows.filter((r) => SELL_BULK_RARITY.includes(r.rarity) && !r.equipped && r.enh === 0);
  return { uids: targets.map((r) => r.uid), count: targets.length, gold: targets.reduce((n, r) => n + r.sell, 0) };
}

/** 강화 시트의 선택지 요약(확정 강화 가능 구간이면 sureGold 가 숫자). */
export function enhanceSheetView(eco, uid) {
  const inst = eco.s.inventory.find((x) => x.uid === uid), q = inst && eco.enhanceQuote(uid);
  if (!inst || !q) return null;
  return { lv: q.lv, gold: q.gold, stones: q.stones, stoneKey: q.stoneKey, have: eco.s[q.stoneKey] || 0, chance: Math.round(q.chance * 100), sureGold: q.sureGold };
}
