import { describe, expect, test } from 'bun:test';
import { EconomyCore } from '../src/game/economy-core.js';
import { Economy, REWARD_LABEL } from '../src/game/economy.js';
import { ITEM_POOL, ITEM_BY_ID } from '../src/data/items.js';
import { normalizeSave } from '../src/game/save.js';
import { giftBag, normalizeRunes, rollRuneDrops, contractBonus, passCharms } from '../src/game/rune-economy.js';
import { BLESSING_GEM_PRICES } from '../src/data/blessing.js';
import { stageDef } from '../src/data/stages.js';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const itemOf = (rarity: string, slot = 'weapon') => (ITEM_POOL as any)[slot].find((x: any) => x.rarity === rarity).id as string;

/** 유니크 무기(+15, 소켓 3칸)·레전드리 갑옷·스페셜 반지를 가진 넉넉한 상태. */
function core(extra: Record<string, unknown> = {}) {
  const s: any = EconomyCore.fromState(null, { now: () => T0 }).snapshot();
  Object.assign(s, { gold: 1e7, gems: 1000, ...extra });
  s.inventory = [
    { uid: 1, id: itemOf('U'), enh: 15 },
    { uid: 2, id: itemOf('L', 'armor'), enh: 0 },
    { uid: 3, id: itemOf('S', 'ring'), enh: 0 },
    { uid: 4, id: itemOf('E', 'boots'), enh: 0 },
  ];
  s.invSeq = 5;
  s.heroes.knight.equip = { weapon: 1, armor: 2, ring: null, boots: null };
  const eco: any = EconomyCore.fromState(s, { now: () => T0, rng: () => 0.5 });
  return eco;
}
const bag = (eco: any, id: string) => eco.s.runes.bag[id] || [0, 0, 0];

describe('룬 저장·마이그레이션', () => {
  test('룬 도입 전 세이브는 네 가문 I 룬을 1개씩 한 번만 받는다', () => {
    const eco = core();
    expect(eco.s.runes.giftClaimed).toBe(true);
    expect(eco.s.runes.bag).toEqual(giftBag());
    expect(Object.keys(giftBag())).toEqual(['ember_edge', 'tide_guard', 'storm_step', 'stone_root']);
    // 다시 정규화(재로드)해도 선물이 늘지 않는다.
    const again: any = EconomyCore.fromState(eco.snapshot(), { now: () => T0 });
    expect(again.s.runes.bag).toEqual(giftBag());
    expect(normalizeRunes(normalizeRunes({}))).toEqual(normalizeRunes({}));
  });
  test('새 계정도 선물을 가진 채 시작하고 giftClaimed=false 세이브는 기존 가방에 더한다', () => {
    const fresh: any = EconomyCore.fromState(null, { now: () => T0 });
    expect(fresh.s.runes).toBeUndefined();
    expect(fresh.runeState().bag).toEqual(giftBag());
    expect(fresh.blessingState().charms).toBe(0);
    const old = normalizeRunes({ bag: { ember_edge: [2, 0, 0] }, dust: 7, giftClaimed: false });
    expect(old.bag.ember_edge).toEqual([3, 0, 0]);
    expect(old.dust).toBe(7);
  });
  test('소켓·가방·가루·전운이 저장 왕복을 견딘다(save-base 가 지운 sockets 복원)', () => {
    const eco = core();
    expect(eco.runeInsert(1, 0, { id: 'ember_edge', grade: 1 }).ok).toBe(true);
    eco.s.runes.dust = 33; eco.s.blessing.charms = 4;
    const back: any = EconomyCore.fromState(eco.snapshot(), { now: () => T0 });
    expect(back.s.inventory[0].sockets).toEqual([{ id: 'ember_edge', grade: 1 }, null, null]);
    expect(back.s.inventory[1].sockets).toBeUndefined();
    expect(back.s.runes.dust).toBe(33);
    expect(back.s.blessing.charms).toBe(4);
    expect(bag(back, 'ember_edge')).toEqual([0, 0, 0]);
    // 잘못된 소켓 값은 빈 칸으로, 박힌 룬이 없으면 필드를 두지 않는다.
    const raw: any = eco.snapshot(); raw.inventory[1].sockets = [{ id: 'nope', grade: 1 }, 'x'];
    const cleaned: any = normalizeSave(raw, new Economy({ storage: { getItem: () => null, setItem() {}, removeItem() {} } }).fresh());
    expect(cleaned.inventory[1].sockets).toBeUndefined();
  });
});

describe('룬 박기·빼기·합성 economy 경로', () => {
  test('빈 칸 박기는 무료, 빼기는 골드, 잠긴 칸·없는 룬은 거절하고 상태 불변', () => {
    const eco = core(), gold = eco.s.gold;
    expect(eco.runeInsert(1, 2, { id: 'tide_guard', grade: 1 }).ok).toBe(true); // +15 유니크 3번째 칸
    expect(eco.s.gold).toBe(gold);
    const before = JSON.stringify(eco.s);
    expect(eco.runeInsert(2, 2, { id: 'storm_step', grade: 1 })).toEqual({ ok: false, reason: 'locked' }); // +0 레전드리 3번째 칸
    expect(eco.runeInsert(1, 0, { id: 'ember_hunt', grade: 1 })).toEqual({ ok: false, reason: 'bag' });
    expect(eco.runeInsert(99, 0, { id: 'ember_edge', grade: 1 })).toEqual({ ok: false, reason: 'item' });
    expect(JSON.stringify(eco.s)).toBe(before);
    const out = eco.runeRemove(1, 2);
    expect(out.ok).toBe(true);
    expect(out.cost).toBe(1000);
    expect(eco.s.gold).toBe(gold - 1000);
    expect(bag(eco, 'tide_guard')).toEqual([1, 0, 0]);
    expect(eco.s.inventory[0].sockets).toBeUndefined();
  });
  test('덮어 박기는 기존 룬을 가방으로 돌리고 빼기 비용을 받는다', () => {
    const eco = core();
    eco.runeInsert(1, 0, { id: 'ember_edge', grade: 1 });
    const out = eco.runeReplace(1, 0, { id: 'stone_root', grade: 1 });
    expect(out.ok).toBe(true);
    expect(out.removed).toEqual({ id: 'ember_edge', grade: 1 });
    expect(eco.s.inventory[0].sockets[0]).toEqual({ id: 'stone_root', grade: 1 });
    expect(bag(eco, 'ember_edge')).toEqual([1, 0, 0]);
  });
  test('합성 II·III: 재료·골드·가루를 정확히 쓰고 부족하면 불변', () => {
    const eco = core();
    eco.s.runes.bag = { ember_edge: [9, 0, 0] }; eco.s.runes.dust = 20;
    const gold = eco.s.gold;
    for (let i = 0; i < 3; i++) expect(eco.runeMerge('ember_edge', 2).ok).toBe(true);
    expect(bag(eco, 'ember_edge')).toEqual([0, 3, 0]);
    const iii = eco.runeMerge('ember_edge', 3);
    expect(iii.ok).toBe(true);
    expect(iii.created).toEqual({ id: 'ember_edge', grade: 3 });
    expect(eco.s.gold).toBe(gold - 3000 - 5000);
    expect(eco.s.runes.dust).toBe(0);
    const before = JSON.stringify(eco.s);
    expect(eco.runeMerge('ember_edge', 2)).toEqual({ ok: false, reason: 'materials' });
    expect(JSON.stringify(eco.s)).toBe(before);
  });
  test('저장 실패면 소켓·가방·골드를 되돌린다', () => {
    const eco = core(); eco.save = () => false;
    const before = JSON.stringify(eco.s);
    expect(eco.runeInsert(1, 0, { id: 'ember_edge', grade: 1 })).toEqual({ ok: false, reason: 'storage' });
    expect(JSON.stringify(eco.s)).toBe(before);
  });
});

describe('장비가 사라질 때 룬 회수', () => {
  test('강화 파괴는 박힌 룬(잠긴 칸 포함)을 무료로 돌려준다', () => {
    const eco = core();
    eco.runeInsert(1, 0, { id: 'ember_edge', grade: 1 }); eco.runeInsert(1, 2, { id: 'tide_guard', grade: 1 });
    eco.s.inventory[0].enh = 16; // 파괴 가능 구간(잠긴 칸 아님은 무관: 파괴는 전부 회수)
    eco.s.stones3 = 9999; eco.s.stones2 = 9999; eco.s.stones = 9999;
    const rolls = [0.999, 0]; eco.rng = () => rolls.shift() ?? 0; // 실패 → 파괴
    const out = eco.enhance(1);
    expect(out.destroyed).toBe(true);
    expect(eco.s.inventory.some((x: any) => x.uid === 1)).toBe(false);
    expect(bag(eco, 'ember_edge')).toEqual([1, 0, 0]);
    expect(bag(eco, 'tide_guard')).toEqual([1, 0, 0]);
    expect(eco.s.heroes.knight.equip.weapon).toBeNull();
  });
  test('판매는 룬을 회수하고 장착을 해제한다', () => {
    const eco = core();
    eco.runeInsert(2, 0, { id: 'stone_root', grade: 1 });
    expect(eco.sellItem(2)).toBeGreaterThan(0);
    expect(bag(eco, 'stone_root')).toEqual([1, 0, 0]);
    expect(eco.s.heroes.knight.equip.armor).toBeNull();
  });
  test('분해(U/L): 룬 가루 U 10·L 30, 룬 회수, 장착 해제. N/S/E 는 거절', () => {
    const eco = core();
    eco.runeInsert(1, 1, { id: 'storm_step', grade: 1 });
    const u = eco.salvageItem(1);
    expect(u).toEqual({ ok: true, uid: 1, runeDust: 10, recovered: [{ id: 'storm_step', grade: 1 }] });
    expect(eco.s.heroes.knight.equip.weapon).toBeNull();
    expect(eco.salvageItem(2).runeDust).toBe(30);
    expect(eco.s.runes.dust).toBe(40);
    expect(eco.salvageItem(3)).toEqual({ ok: false, reason: 'rarity' });
  });
  test('기존 일괄 분해(N/S/E)도 박힌 룬을 회수한다', () => {
    const eco = core();
    eco.runeInsert(3, 0, { id: 'ember_edge', grade: 1 });
    expect(eco.salvage([3]).ok).toBe(true);
    expect(bag(eco, 'ember_edge')).toEqual([1, 0, 0]);
  });
});

describe('전운 굴리기 economy 경로', () => {
  test('무료 → 부적 → 보석 순으로 차감하고 보석 부족이면 상태 불변', () => {
    const eco = core({ gems: 50 });
    eco.s.blessing.charms = 1;
    const free = eco.blessingRoll(T0, 'seed');
    expect(free.ok).toBe(true); expect(free.paid).toEqual({ kind: 'free', gems: 0 });
    const charm = eco.blessingRoll(T0, 'seed');
    expect(charm.paid.kind).toBe('charm'); expect(eco.s.blessing.charms).toBe(0);
    const gem = eco.blessingRoll(T0, 'seed');
    expect(gem.paid).toEqual({ kind: 'gem', gems: BLESSING_GEM_PRICES[0] });
    expect(eco.s.gems).toBe(50 - BLESSING_GEM_PRICES[0]);
    expect(eco.blessingQuote(T0).affordable).toBe(false);
    const before = JSON.stringify(eco.s);
    expect(eco.blessingRoll(T0, 'seed')).toEqual({ ok: false, reason: 'gems' }); // 다음 가격 60 > 잔액 20
    expect(JSON.stringify(eco.s)).toBe(before);
  });
  test('같은 세이브·시드면 같은 후보, 고르기·소모가 preRunBoons 를 낸다', () => {
    const a = core(), b = core();
    expect(a.blessingRoll(T0, 's1').candidates).toEqual(b.blessingRoll(T0, 's1').candidates);
    expect(a.blessingPick(5)).toEqual({ ok: false, reason: 'index' });
    const held = a.blessingPick(1).held;
    const used = a.blessingConsume();
    expect(used.ok).toBe(true);
    expect(used.preRunBoons).toEqual(Array.from({ length: held.grade }, () => held.id));
    expect(used.boonId).toBe(held.id);
    expect(a.s.blessing.held).toBeNull();
    expect(a.blessingConsume().preRunBoons).toEqual([]);
  });
  test('다음 날(05:00 KST)에는 무료가 다시 열린다', () => {
    const eco = core({ gems: 0 });
    expect(eco.blessingRoll(T0, 'x').paid.kind).toBe('free');
    expect(eco.blessingRoll(T0, 'x')).toEqual({ ok: false, reason: 'gems' });
    expect(eco.blessingRoll(T0 + DAY, 'x').paid.kind).toBe('free');
  });
  test('부적 지급: 일일·주간 의뢰 보너스, 패스 무료 5단계마다, 월정액 매일, 보상 라벨', () => {
    expect(contractBonus('daily')).toEqual({ blessingCharm: 1 });
    expect(contractBonus('weekly')).toEqual({ blessingCharm: 3, runeDust: 30 });
    expect([1, 4, 5, 10, 11].map(passCharms)).toEqual([0, 0, 1, 1, 0]);
    const eco = core();
    const got = eco.addRewards({ blessingCharm: 2, runeDust: 15 }, { silent: true });
    expect(got).toEqual([{ k: 'runeDust', n: 15 }, { k: 'blessingCharm', n: 2 }]);
    expect(eco.s.blessing.charms).toBe(2);
    expect(eco.s.runes.dust).toBe(15);
    eco.s.monthlyUntil = T0 + 30 * DAY;
    expect(eco.claimMonthly()).toBe(true);
    expect(eco.s.blessing.charms).toBe(3);
    expect(REWARD_LABEL.runeDust[0]).toBe('룬 가루');
    expect(REWARD_LABEL.blessingCharm[0]).toBe('전운 부적');
  });
});

describe('룬 드랍 정산과 전투 효과', () => {
  test('rollRuneDrops 는 같은 시드에 같은 결과, 확률은 정예 3%·보스 25%·심층 50%(II 10%)', () => {
    expect(rollRuneDrops({ elite: 30, boss: 3 }, { deep: true }, 42)).toEqual(rollRuneDrops({ elite: 30, boss: 3 }, { deep: true }, 42));
    let elite = 0, boss = 0, deep = 0, deep2 = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      elite += rollRuneDrops({ elite: 1 }, {}, i).drops.length;
      boss += rollRuneDrops({ boss: 1 }, {}, i).drops.length;
      const d = rollRuneDrops({ boss: 1 }, { hell: true }, i).drops;
      deep += d.length; deep2 += d.filter((x) => x.grade === 2).length;
    }
    expect(elite / N).toBeCloseTo(0.03, 2);
    expect(boss / N).toBeCloseTo(0.25, 1);
    expect(deep / N).toBeCloseTo(0.5, 1);
    expect(deep2 / deep).toBeCloseTo(0.1, 1);
    expect([rollRuneDrops({}, {}, 1).dust, rollRuneDrops({}, { deep: true }, 1).dust, rollRuneDrops({}, { hell: true }, 1).dust]).toEqual([5, 12, 20]);
  });
  test('캠페인 승리 정산은 장부 처치 수로 결정적으로 룬·가루를 준다', () => {
    const settle = () => {
      const eco = core(), stage = stageDef(1, 3);
      for (let i = 0; i < 40; i++) eco.recordRuneKill(stage, 'elite', 'knight');
      for (let i = 0; i < 4; i++) eco.recordRuneKill(stage, 'boss', 'knight');
      const receipt = eco.completeStage(stage, 3);
      return { got: receipt.got.filter((g: any) => g.k === 'rune' || g.k === 'runeDust'), runes: eco.s.runes };
    };
    const a = settle(), b = settle();
    expect(a).toEqual(b);
    expect(a.got.find((g: any) => g.k === 'runeDust')).toEqual({ k: 'runeDust', n: 5 });
    expect(a.runes.dropSeq).toBe(1);
    // 장부 없는 정산(소탕 등)은 룬을 주지 않는다.
    const eco = core(); eco.completeStage(stageDef(1, 3), 3);
    expect(eco.s.runes.dust).toBe(0);
  });
  test('장착 룬 효과: 잠긴 칸 제외·전투력 표시에 반영, 장착 해제하면 사라진다', () => {
    const eco = core();
    const base = eco.heroPower('knight');
    expect(eco.heroRuneEffects('knight')).toEqual({});
    eco.runeInsert(1, 0, { id: 'ember_edge', grade: 1 });
    expect(eco.heroRuneEffects('knight')).toEqual({ atk: 0.05 });
    expect(eco.heroPower('knight')).toBeGreaterThan(base);
    eco.runeInsert(2, 0, { id: 'stone_root', grade: 1 });
    expect(eco.heroRuneEffects('knight')).toEqual({ atk: 0.05, hp: 0.07 });
    // 전운 각인 1개는 가문 공명 수에만 +1(잿불 2 + 바위 2 → 공명)
    const withBless = eco.heroRuneEffects('knight', { blessingBoonId: 'ember_hunt' });
    expect(Object.keys(withBless).length).toBeGreaterThanOrEqual(2);
    eco.unequip('knight', 'weapon');
    expect(eco.heroRuneEffects('knight')).toEqual({ hp: 0.07 });
    expect(ITEM_BY_ID[eco.s.inventory[0].id].rarity).toBe('U');
  });
});
