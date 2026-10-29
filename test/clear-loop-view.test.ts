import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { stageDef } from '../src/data/stages.js';
import { createSeededRng } from '../src/shared/rng.js';
import { cardView, cardGearCompare, summaryChips, autoCardText, durabilityView, wearDeltaOf, shopRows, bulkSellPlan, enhanceSheetView, ownerTag, pickToast } from '../src/ui/clear-loop-view.js';

const T0 = 1_700_000_000_000;
const fresh = () => {
  const eco: any = new Economy({ storage: createMemoryStorage(), now: () => T0, rng: createSeededRng(11) });
  expect(eco.chooseStarter('knight').ok).toBe(true);
  if (!eco.hero('knight').equip.weapon) { const w = eco.addItem('S', 'weapon'); eco.equip('knight', w.uid); }
  return eco;
};

describe('클리어 결과 뷰 모델: 카드', () => {
  test('종류별 이름·수치·아이콘', () => {
    expect(cardView({ kind: 'gold', tier: 'rare', gold: 1200 })).toMatchObject({ name: '금화 꾸러미', value: '+1,200 골드', tierName: '희귀' });
    expect(cardView({ kind: 'stones', tier: 'common', key: 'stones', n: 2 })).toMatchObject({ name: '강화석 꾸러미', value: '+2개' });
    expect(cardView({ kind: 'stones', tier: 'epic', key: 'stones2', n: 3 }).name).toBe('상급 강화석 꾸러미');
    expect(cardView({ kind: 'fragments', tier: 'legend', n: 35 })).toMatchObject({ name: '세트 조각 상자', value: '+35조각', tierName: '전설' });
    expect(cardView({ kind: 'scroll', tier: 'epic', key: 'bless', n: 1 }).name).toBe('축복 주문서');
    const repair = cardView({ kind: 'repair', tier: 'rare', gold: 300 });
    expect(repair.name).toBe('정비 쿠폰');
    expect(repair.iconSrc).toBe('');   // CSS 망치 그림
    expect(repair.value).toContain('완전 수리');
    const gear = cardView({ kind: 'gear', tier: 'epic', id: 'N_sword', slot: 'weapon', rarity: 'N' });
    expect(gear.gearId).toBe('N_sword');
  });
  test('다른 영웅 장비 꼬리표와 토스트 문구', () => {
    expect(ownerTag('knight', 'knight')).toBe('');
    expect(ownerTag('', 'knight')).toBe('');
    expect(ownerTag('mage', 'knight')).toMatch(/^◆ .+ 장비$/);
    expect(pickToast({ kind: 'gold', tier: 'legend', gold: 5000 })).toBe('전설 카드 · 금화 꾸러미 +5,000 골드');
  });
  test('장비 카드 착용 비교는 정산 상태를 바꾸지 않는다', () => {
    const eco = fresh();
    eco.completeStage(stageDef(1, 1), 3);
    const before = JSON.stringify(eco.s.inventory) + eco.s.invSeq;
    const gear = { kind: 'gear', tier: 'rare', id: eco.s.inventory[0].id, slot: 'weapon', rarity: 'S' };
    const text = cardGearCompare(eco, 'knight', gear);
    expect(text).toMatch(/전투력/);
    expect(JSON.stringify(eco.s.inventory) + eco.s.invSeq).toBe(before);
    expect(cardGearCompare(eco, 'knight', { kind: 'gold', tier: 'common', gold: 10 })).toBe('');
  });
});

describe('클리어 결과 뷰 모델: 요약 칩 · 내구도', () => {
  test('골드 · 강화석 · 장비 · EXP 한 줄 칩, 0인 항목은 뺀다', () => {
    const chips = summaryChips({ got: [{ k: 'gold', n: 1200 }, { k: 'stones', n: 3 }, { k: 'stones2', n: 2 }, { k: 'gems', n: 0 }], loot: [{ uid: 1 }, { uid: 2 }], totalExp: 340 });
    expect(chips).toEqual(['골드 +1,200', '강화석 +5', '장비 2개', 'EXP +340']);
    expect(summaryChips(null)).toEqual([]);
    expect(summaryChips({ got: [], loot: [], exp: 0 })).toEqual([]);
  });
  test('자동 수령 문구', () => {
    expect(autoCardText(null)).toBe('');
    expect(autoCardText({ card: { kind: 'gold', tier: 'common', gold: 200 } })).toBe('지난 판 미선택 카드 자동 수령: 금화 꾸러미 +200 골드');
  });
  test('내구도 줄: 단계 · 수리 버튼 · 골드 부족', () => {
    const def = { name: '검' };
    const worn = { uid: 5, dur: 72 };
    const v = durabilityView(worn, def, { gold: 1000, quote: { cost: 320 }, wearDelta: 3 })!;
    expect(v.text).toBe('무기 내구도 72/100 · 양호');
    expect(v.wearText).toBe('이번 판 −3');
    expect(v.buttonText).toBe('수리 −320골드');
    expect(v.disabled).toBe(false);
    expect(v.tone).toBe('good');
    const poor = durabilityView({ uid: 5, dur: 10 }, def, { gold: 100, quote: { cost: 320 } })!;
    expect(poor).toMatchObject({ disabled: true, lack: 220, tone: 'bad', label: '많이 닳음' });
    const full = durabilityView({ uid: 5 }, def, { gold: 100, quote: { cost: 0 } })!;
    expect(full).toMatchObject({ full: true, disabled: true, buttonText: '수리 불필요', dur: 100 });
    expect(durabilityView(null, def)).toBeNull();
    expect(wearDeltaOf({ before: 100, dur: 97 })).toBe(3);
    expect(wearDeltaOf(null)).toBe(0);
  });
});

describe('클리어 결과 뷰 모델: 정비소', () => {
  test('이번 판 장비 행: 등급순 · 판매가 · 분해 가능 · 강화 견적, 팔린 장비는 사라진다', () => {
    const eco = fresh();
    const a = eco.addItem('N', 'armor'), b = eco.addItem('E', 'ring'), c = eco.addItem('U', 'boots');
    const uids = [a.uid, b.uid, c.uid];
    const rows = shopRows(eco, uids, { heroId: 'knight' });
    expect(rows.map((r: any) => r.rarity)).toEqual(['U', 'E', 'N']);
    const byRarity = Object.fromEntries(rows.map((r: any) => [r.rarity, r]));
    expect(byRarity.N).toMatchObject({ canSalvage: true, sell: 200, canEnhance: true, sellConfirm: false });
    expect(byRarity.U).toMatchObject({ canSalvage: false, sellConfirm: true });   // 유니크 이상 분해 불가
    expect(byRarity.N.enhanceText).toMatch(/^강화 \+1 · /);
    eco.sellItem(a.uid);
    expect(shopRows(eco, uids, { heroId: 'knight' })).toHaveLength(2);
  });
  test('착용 중인 장비는 판매·분해 비활성', () => {
    const eco = fresh();
    const wid = eco.hero('knight').equip.weapon;
    const [row] = shopRows(eco, [wid], { heroId: 'knight' }) as any[];
    expect(row.equipped).toBe(true);
    expect(row.sellDisabled).toBe(true);
    expect(row.canSalvage).toBe(false);
  });
  test('다른 영웅 소유 장비는 꼬리표를 달고 착용 비교는 비운다', () => {
    const eco = fresh();
    const it = eco.addItem('S', 'armor');
    const owner = Object.keys(eco.s.heroes).find((id) => id !== 'knight') || 'mage';
    it.owner = owner;
    const [row] = shopRows(eco, [it.uid], { heroId: 'knight' }) as any[];
    if (owner !== 'knight' && eco.s.inventory.find((x: any) => x.uid === it.uid)) {
      expect(row.ownerTag).toMatch(/^◆ /);
      expect(row.compare).toBe('');
    }
  });
  test('노말·스페셜 일괄 판매 대상: 착용·강화·에픽 이상은 제외', () => {
    const rows: any[] = [
      { uid: 1, rarity: 'N', equipped: false, enh: 0, sell: 200 }, { uid: 2, rarity: 'S', equipped: false, enh: 0, sell: 900 },
      { uid: 3, rarity: 'S', equipped: true, enh: 0, sell: 900 }, { uid: 4, rarity: 'N', equipped: false, enh: 2, sell: 200 }, { uid: 5, rarity: 'E', equipped: false, enh: 0, sell: 4000 },
    ];
    expect(bulkSellPlan(rows)).toEqual({ uids: [1, 2], count: 2, gold: 1100 });
  });
  test('결과 화면에서 새로 장착한 장비는 다시 만든 행의 일괄 판매에서 빠진다(옛 행으로 팔지 않음)', () => {
    const eco = fresh();
    const it = eco.addItem('S', 'armor');
    const before = bulkSellPlan(shopRows(eco, [it.uid], { heroId: 'knight' }) as any[]);
    expect(before.uids).toContain(it.uid);
    eco.s.heroes.knight.equip.armor = it.uid;   // '더 좋은 장비 장착'과 같은 결과
    const after = bulkSellPlan(shopRows(eco, [it.uid], { heroId: 'knight' }) as any[]);
    expect(after.uids).not.toContain(it.uid);
  });
  test('강화 시트 견적', () => {
    const eco = fresh();
    const it = eco.addItem('N', 'ring');
    const v = enhanceSheetView(eco, it.uid)!;
    expect(v.lv).toBe(0);
    expect(v.chance).toBe(100);
    expect(enhanceSheetView(eco, 99999)).toBeNull();
  });
});
