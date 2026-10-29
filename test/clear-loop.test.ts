import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { EconomyCore, createMemoryStorage } from '../src/game/economy-core.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { stageDef } from '../src/data/stages.js';
import { itemStats } from '../src/data/item-tier.js';
import { createSeededRng } from '../src/shared/rng.js';
import { validateOp } from '../src/shared/v1-ops.js';
import { PARITY_KEYS, mergeServerOwned } from '../src/shared/state-hash.js';
import { rollClearCards, repairCost, repairFullCost, durMul, DUR_WEAR, CARD_COUNT, normalizeClearCard, ITEM_LEVEL_CAP } from '../src/game/clear-loop.js';
import { normalizeSave } from '../src/game/save.js';

const T0 = 1_700_000_000_000;
const fresh = () => {
  const eco: any = new Economy({ storage: createMemoryStorage(), now: () => T0, rng: createSeededRng(11) }); expect(eco.chooseStarter('knight').ok).toBe(true);
  if (!eco.hero('knight').equip.weapon) { const w = eco.addItem('S', 'weapon'); eco.equip('knight', w.uid); }
  return eco;
};
const weaponOf = (eco: any) => eco.s.inventory.find((x: any) => x.uid === eco.hero('knight').equip.weapon);

describe('클리어 카드 보상', () => {
  test('같은 입력은 같은 카드, 3장 모두 종류가 다르고 첫 클리어 가운데 카드는 희귀 이상', () => {
    const ctx = { seed: '1-1|story|0|knight|5', gold: 400, ch: 1, first: true, il: 0 };
    const a = rollClearCards(ctx), b = rollClearCards(ctx);
    expect(a).toEqual(b);
    expect(a).toHaveLength(CARD_COUNT);
    expect(new Set(a.map((c) => c.kind)).size).toBe(CARD_COUNT);
    expect(a[1].tier).not.toBe('common');
    for (let i = 0; i < 200; i++) {
      const cards = rollClearCards({ ...ctx, seed: `s${i}`, first: false });
      for (const c of cards as any[]) if (c.kind === 'gear') expect((ITEM_BY_ID as any)[c.id]).toBeTruthy();
      expect(cards.some((c) => c.kind === 'repair')).toBe(false);   // 무기가 닳지 않았으면 수리 카드 없음
    }
  });
  test('승리 정산이 난수 없이 카드 3장을 저장하고, 고르면 보상·두 번 고르기 거절', () => {
    const eco = fresh();
    const r = eco.completeStage(stageDef(1, 1), 3);
    expect(r.clearCard.cards).toHaveLength(3);
    expect(eco.s.clearCard.picked).toBeNull();
    const gold0 = eco.s.gold, inv0 = eco.s.inventory.length;
    const pick = eco.pickClearCard(1);
    expect(pick.ok).toBe(true);
    expect(eco.s.clearCard.picked).toBe(1);
    const card = pick.card;
    if (card.kind === 'gold') expect(eco.s.gold).toBe(gold0 + card.gold);
    if (card.kind === 'gear') expect(eco.s.inventory.length).toBe(inv0 + 1);
    expect(eco.pickClearCard(0)).toMatchObject({ ok: false, reason: 'none' });
    expect(eco.pickClearCard(5 as any)).toMatchObject({ ok: false });
  });
  test('고르지 않은 카드는 다음 승리 때 첫 장으로 정산된다(보상 유실 없음)', () => {
    const eco = fresh();
    eco.completeStage(stageDef(1, 1), 3);
    const first = eco.s.clearCard.cards[0];
    const r2 = eco.completeStage(stageDef(1, 2), 3);
    expect(r2.autoCard.card).toEqual(first);
    expect(eco.s.clearCard.picked).toBeNull();
  });
  test('소탕은 카드를 만들지 않는다', () => {
    const eco = fresh();
    eco.completeStage(stageDef(1, 1), 3); eco.pickClearCard(0);
    const id = eco.s.clearCard.id; eco.s.sweep = 1;
    eco.sweep(stageDef(1, 1));
    expect(eco.s.clearCard.id).toBe(id);
  });
  test('서버 정산 경로(EconomyCore)와 같은 카드·같은 상태 해시', () => {
    const base = fresh(); const snap = JSON.parse(JSON.stringify(base.snapshot?.() ?? base.s));
    const run = (seed: number) => { const core: any = EconomyCore.fromState(snap, { now: () => T0, rng: createSeededRng(seed), gachaRng: createSeededRng(seed + 1) }); core.completeStage(stageDef(1, 3), 3); return core; };
    const a = run(3), b = run(3);
    expect(a.s.clearCard).toEqual(b.s.clearCard);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.pickClearCard(2).ok).toBe(true);
    // 서버 문서 왕복(정규화) 뒤에도 카드가 남는다
    const again: any = EconomyCore.fromState(JSON.parse(JSON.stringify(a.snapshot())), { now: () => T0, rng: createSeededRng(1), gachaRng: createSeededRng(2) });
    expect(again.s.clearCard).toEqual(a.s.clearCard);
  });
  test('/cmd 명령표·서버 소유 키에 들어 있다', () => {
    expect(validateOp('pickClearCard', [0])).toBeTruthy();
    expect(validateOp('pickClearCard', [3])).toBeNull();
    expect(validateOp('repairItem', [1])).toBeTruthy();
    expect(PARITY_KEYS).toContain('clearCard');
    // 서버 문서에 카드가 없으면 로컬 카드도 지운다(이미 고른 카드가 되살아나지 않게)
    expect(mergeServerOwned({ clearCard: { id: 'x' } }, { gold: 1 }).clearCard).toBeUndefined();
  });
  test('정규화: 형태가 틀린 카드는 버린다', () => {
    expect(normalizeClearCard({ id: 'a', cards: [{ kind: 'gold', tier: 'rare', gold: 1 }] })).toBeNull();
    expect(normalizeClearCard({ id: 'a', heroId: 'knight', picked: 7, cards: [1, 2, 3].map(() => ({ kind: 'gold', tier: 'rare', gold: 1 })) })?.picked).toBeNull();
  });
});

describe('무기 내구도·수리', () => {
  test('캠페인 승리마다 착용 무기만 닳고(보스 더), 공격력만 소폭 감소하며 깨지지 않는다', () => {
    const eco = fresh(); const w = weaponOf(eco);
    expect(w.dur).toBeUndefined();
    const atk0 = itemStats(w).atk;
    eco.completeStage(stageDef(1, 1), 3);
    expect(weaponOf(eco).dur).toBe(100 - DUR_WEAR.win);
    expect(itemStats(weaponOf(eco)).atk).toBe(atk0);   // 50 이상은 감소 없음
    weaponOf(eco).dur = 30; expect(itemStats(weaponOf(eco)).atk).toBe(Math.floor(atk0 * 0.96));
    weaponOf(eco).dur = 0; expect(durMul(weaponOf(eco))).toBe(0.88);
    eco.pickClearCard(eco.s.clearCard.cards.findIndex((c: any) => c.kind !== 'repair'));
    eco.completeStage(stageDef(1, 5), 3);   // 0에서 더 내려가지 않고 무기는 남는다
    expect(weaponOf(eco).dur).toBe(0);
    const armor = eco.s.inventory.find((x: any) => x.uid === eco.hero('knight').equip.armor);
    if (armor) expect(armor.dur).toBeUndefined();
  });
  test('수리: 닳은 만큼 골드, 강화가 높을수록 비싸고, 골드 부족·만충은 거절', () => {
    const eco = fresh(); const w = weaponOf(eco); const rar = (ITEM_BY_ID as any)[w.id].rarity;
    expect(eco.repairItem(w.uid)).toMatchObject({ ok: false, reason: 'full' });
    w.dur = 50;
    const q = eco.repairQuote(w.uid);
    expect(q.cost).toBe(repairCost(w, rar));
    expect(q.cost).toBeGreaterThanOrEqual(Math.floor(repairFullCost(w, rar) / 2));
    expect(repairFullCost({ enh: 15 }, 'E')).toBeGreaterThan(repairFullCost({ enh: 10 }, 'E') * 2);
    eco.s.gold = q.cost - 1; expect(eco.repairItem(w.uid)).toMatchObject({ ok: false, reason: 'gold' });
    eco.s.gold = q.cost + 5;
    expect(eco.repairItem(w.uid)).toMatchObject({ ok: true, cost: q.cost });
    expect(eco.s.gold).toBe(5); expect(weaponOf(eco).dur).toBeUndefined();
  });
  test('저장 정규화가 무기 내구도만 보존하고 이전 저장은 그대로', () => {
    const eco = fresh(); weaponOf(eco).dur = 42;
    const raw = JSON.parse(JSON.stringify(eco.s));
    raw.inventory.push({ uid: 9999, id: eco.addItem('N', 'armor').id, enh: 0, dur: 10 });
    const s = normalizeSave(raw, eco.fresh());
    expect(s.inventory.find((x: any) => x.uid === weaponOf(eco).uid).dur).toBe(42);
    expect(s.inventory.find((x: any) => x.uid === 9999).dur).toBeUndefined();
  });
});

describe('카드 보상 주입 방지(보안 리뷰 P2)', () => {
  const three = (c: any) => ({ id: 'x', heroId: 'knight', picked: null, cards: [c, { kind: 'gold', tier: 'common', gold: 100 }, { kind: 'fragments', tier: 'rare', n: 10 }] });
  test('종류별 허용 필드·범위 밖 카드는 버린다', () => {
    expect(normalizeClearCard(three({ kind: 'scroll', tier: 'epic', key: 'gems', n: 100000000 }))).toBeNull();
    expect(normalizeClearCard(three({ kind: 'scroll', tier: 'epic', key: 'bless', n: 5 }))).toBeNull();
    expect(normalizeClearCard(three({ kind: 'gold', tier: 'rare', gold: 1e12 }))).toBeNull();
    expect(normalizeClearCard(three({ kind: 'stones', tier: 'rare', key: 'stones3', n: 2 }))).toBeNull();
    expect(normalizeClearCard(three({ kind: 'gear', tier: 'legend', id: 'nope', slot: 'weapon' }))).toBeNull();
    const ok: any = normalizeClearCard(three({ kind: 'scroll', tier: 'epic', key: 'bless', n: 1, gems: 999 }));
    expect(ok.cards[0]).toEqual({ kind: 'scroll', tier: 'epic', key: 'bless', n: 1 });
  });
  test('정산이 만든 카드는 모두 통과한다', () => {
    for (let i = 0; i < 300; i++) {
      const cards = rollClearCards({ seed: `n${i}`, gold: 400 + i * 50, ch: 1 + (i % 7), first: i % 3 === 0, il: i % 40, weaponWorn: i % 2 === 0 });
      expect(normalizeClearCard({ id: 'a', heroId: 'knight', cards, picked: null })?.cards).toEqual(cards);
    }
  });
  test('외부 저장 가져오기는 카드를 버리고, 장비 레벨 상한이 item-tier 와 같다', async () => {
    const { sanitizeLegacySave } = await import('../src/shared/legacy-sanitize.js');
    const { ITEM_LEVEL_MAX } = await import('../src/data/item-tier.js');
    expect(ITEM_LEVEL_CAP).toBe(ITEM_LEVEL_MAX);
    const eco = fresh(); eco.completeStage(stageDef(1, 1), 3);
    const raw = JSON.parse(JSON.stringify(eco.s));
    raw.clearCard = three({ kind: 'gold', tier: 'rare', gold: 500 });
    const out: any = sanitizeLegacySave(raw, { now: T0, createdAt: T0 - 1000 });
    expect(out.ok).toBe(true); expect(out.state.clearCard).toBeUndefined();
  });
});

test('고통 단계 감쇠가 카드 골드·재료에도 적용된다(교차 리뷰 P2)', async () => {
  const { decayCard } = await import('../src/game/clear-loop.js');
  expect(decayCard({ kind: 'gold', tier: 'rare', gold: 1000 }, 0.35)).toEqual({ kind: 'gold', tier: 'rare', gold: 350 });
  expect(decayCard({ kind: 'stones', tier: 'common', key: 'stones', n: 2 }, 0.35)).toEqual({ kind: 'stones', tier: 'common', key: 'stones', n: 1 });
  expect(decayCard({ kind: 'scroll', tier: 'epic', key: 'bless', n: 1 }, 0.35).n).toBe(1);
  expect(decayCard({ kind: 'gold', tier: 'rare', gold: 1000 }, 1).gold).toBe(1000);
  const a = fresh(), b = fresh(), stage: any = stageDef(1, 3);
  a.dealClearCards(stage, 'knight', false, 'k', 0.35); b.dealClearCards(stage, 'knight', false, 'k', 1);
  expect(a.s.clearCard.cards).toEqual(b.s.clearCard.cards.map((c: any) => decayCard(c, 0.35)));
});
