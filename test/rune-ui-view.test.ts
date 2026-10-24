import { describe, expect, test } from 'bun:test';
import { EconomyCore } from '../src/game/economy-core.js';
import { ITEM_POOL } from '../src/data/items.js';
import { familyCounts, runeSynergies } from '../src/game/rune-core.js';
import { gearRunes } from '../src/game/rune-economy.js';
import {
  socketBoard, pickerView, bagView, mergeView, mergeTarget, overviewView, autoFillPlan, runeAwarePreview,
  runeEffectText, ladderText, removeCostText, defaultSocket, hasSockets, heroGear, craftInfo,
} from '../src/ui/rune-view.js';
import { runeHex, emptyHex } from '../src/ui/rune-art.js';

const T0 = 1_700_000_000_000;
const itemOf = (rarity: string, slot = 'weapon') => (ITEM_POOL as any)[slot].find((x: any) => x.rarity === rarity).id as string;

/** 레전드리 갑옷 +12(소켓 2 + 잠긴 3번째), 유니크 무기 +15(3칸), 스페셜 반지, 노멀 신발. */
function core(bag: Record<string, number[]> = {}, extra: Record<string, unknown> = {}) {
  const s: any = EconomyCore.fromState(null, { now: () => T0 }).snapshot();
  Object.assign(s, { gold: 100000, gems: 0, ...extra });
  s.inventory = [
    { uid: 1, id: itemOf('U'), enh: 15 },
    { uid: 2, id: itemOf('L', 'armor'), enh: 12 },
    { uid: 3, id: itemOf('S', 'ring'), enh: 0 },
    { uid: 4, id: itemOf('N', 'boots'), enh: 0 },
    { uid: 5, id: itemOf('L', 'armor'), enh: 0 },
  ];
  s.invSeq = 6;
  s.heroes.knight.equip = { weapon: 1, armor: 2, ring: 3, boots: 4 };
  s.runes = { bag, dust: 50, giftClaimed: true, dropSeq: 0 };
  return EconomyCore.fromState(s, { now: () => T0, rng: () => 0.5 }) as any;
}
const equippedCounts = (eco: any) => familyCounts(heroGear(eco, 'knight').map((i: any) => (i ? gearRunes(i) : null)) as any);

describe('룬 소켓 탭 보기(A33)', () => {
  test('레전드리 +12: 열린 2칸 + 잠긴 3번째 칸(+15 강화 시 개방), 소켓이 있는 장비만 탭', () => {
    const eco = core({ ember_edge: [2, 0, 0] });
    const b: any = socketBoard(eco, 'knight', 2);
    expect(b.total).toBe(3); expect(b.open).toBe(2);
    expect(b.sockets.map((s: any) => s.state)).toEqual(['empty', 'empty', 'locked']);
    expect(b.sockets[2].lockText).toBe('+15 강화 시 개방');
    expect(defaultSocket(b)).toBe(0);
    expect(hasSockets({ id: itemOf('N', 'boots') })).toBe(false);
    expect(hasSockets({ id: itemOf('L', 'armor') })).toBe(true);
  });
  test('+15 아래로 내려가 잠긴 칸의 룬은 "+15에서 다시 켜짐"으로 남는다', () => {
    const eco = core({ ember_edge: [1, 0, 0] });
    expect(eco.runeInsert(1, 2, { id: 'ember_edge', grade: 1 }).ok).toBe(true);
    eco.s.inventory[0].enh = 14;
    const b: any = socketBoard(eco, 'knight', 1);
    expect(b.sockets[2]).toMatchObject({ state: 'locked', lockText: '+15에서 다시 켜짐', active: false, label: '잿불 칼날 I' });
  });
  test('룬을 박으면 비교 전투력이 즉시 오른다(heroPower 와 같은 식)', () => {
    const eco = core({ ember_edge: [0, 1, 0] });
    const before: any = runeAwarePreview(eco, 'knight', 2);
    expect(eco.runeInsert(2, 0, { id: 'ember_edge', grade: 2 }).ok).toBe(true);
    const after: any = runeAwarePreview(eco, 'knight', 2);
    expect(after.before.power).toBeGreaterThan(before.before.power);
    expect(after.before.atk).toBeGreaterThan(before.before.atk);
    expect(after.before.power).toBe(eco.heroPower('knight'));
  });
});

describe('룬 고르기(A37)', () => {
  test('공명 미리보기는 실제로 박은 뒤 가문 수·공명과 같다', () => {
    const eco = core({ ember_edge: [1, 0, 0], ember_hunt: [1, 0, 0], storm_step: [1, 0, 0], storm_edge: [0, 1, 0] });
    eco.runeInsert(1, 0, { id: 'ember_edge', grade: 1 });
    eco.runeInsert(1, 1, { id: 'ember_hunt', grade: 1 });
    eco.runeInsert(1, 2, { id: 'storm_step', grade: 1 });
    const v: any = pickerView(eco, 'knight', 2, 0, { selected: 'storm_edge:2' });
    expect(v.mode).toBe('insert'); expect(v.action).toBe('박기 (무료)');
    expect(v.preview.changes).toEqual([{ id: 'storm', name: '폭풍', from: 1, to: 2 }]);
    expect(v.preview.gained).toEqual(['질주하는 불씨']);
    expect(eco.runeInsert(2, 0, { id: 'storm_edge', grade: 2 }).ok).toBe(true);
    const real = equippedCounts(eco);
    expect(real).toEqual(v.preview.counts);
    expect(runeSynergies(real).map((s: any) => s.name)).toEqual(['질주하는 불씨']);
  });
  test('같은 룬 3번째는 회색 "중복 상한 2"(효과 0)으로 표시된다', () => {
    const eco = core({ ember_edge: [3, 0, 0] });
    eco.runeInsert(1, 0, { id: 'ember_edge', grade: 1 });
    eco.runeInsert(1, 1, { id: 'ember_edge', grade: 1 });
    const v: any = pickerView(eco, 'knight', 2, 0);
    const e = v.entries.find((x: any) => x.id === 'ember_edge');
    expect(e.capped).toBe(true);
    eco.runeInsert(2, 0, { id: 'ember_edge', grade: 1 });
    expect((socketBoard(eco, 'knight', 1) as any).sockets.concat((socketBoard(eco, 'knight', 2) as any).sockets).filter((s: any) => s.duplicate).length).toBe(1);
  });
  test('가문 필터·교체 모드·빼기 비용 안내', () => {
    const eco = core({ ember_edge: [1, 1, 0], tide_breath: [1, 0, 0] });
    eco.runeInsert(2, 0, { id: 'ember_edge', grade: 2 });
    const v: any = pickerView(eco, 'knight', 2, 0, { filter: 'tide' });
    expect(v.entries.map((e: any) => e.key)).toEqual(['tide_breath:1']);
    expect(v.mode).toBe('replace'); expect(v.cost).toBe(3000); expect(v.action).toBe('교체 (골드 3,000)');
    expect(v.costNote).toBe('빼기 비용 · I 1,000 / II 3,000 / III 8,000 골드');
    expect(removeCostText()).toBe('I 1,000 / II 3,000 / III 8,000 골드');
  });
  test('효과 문구와 등급 사다리', () => {
    // 등급 배율 I 0.5 · II 1 · III 1.5(RUNE_GRADE_MUL), 개수형(연쇄)은 올림
    expect(runeEffectText('storm_edge', 2)).toBe('공격력 +4%');
    expect(ladderText('storm_edge')).toBe('I +2% · II +4% · III +6%');
    expect(runeEffectText('ember_feast', 3)).toBe('처치 시 최대 체력 0.75% 회복');
    expect(ladderText('storm_eye')).toBe('I 1명 · II 1명 · III 2명');
  });
});

describe('룬 가방·합성(A36)', () => {
  test('가문 4줄 × 3종, 등급별 보유 수', () => {
    const v = bagView({ ember_edge: [5, 1, 0] });
    expect(v.map((f) => f.runes.length)).toEqual([3, 3, 3, 3]);
    expect(v[0].runes[0]).toMatchObject({ name: '잿불 칼날', counts: [5, 1, 0], best: 2 });
  });
  test('I 3개 + 골드 1,000 → II 1개, 확정 100%, 재료가 정확히 준다', () => {
    const eco = core({ ember_edge: [5, 0, 0] });
    const m: any = mergeView({ bag: eco.runeState().bag, gold: eco.s.gold, dust: eco.runeState().dust }, 'ember_edge');
    expect(m).toMatchObject({ toGrade: 2, need: 3, have: 5, gold: 1000, ok: true, chance: 100, button: '합성 (확정 100%)', from: '잿불 칼날 I', to: '잿불 칼날 II' });
    const gold = eco.s.gold;
    for (let i = 0; i < 1; i++) expect(eco.runeMerge('ember_edge', 2).ok).toBe(true);
    expect(eco.runeState().bag.ember_edge).toEqual([2, 1, 0]);
    expect(eco.s.gold).toBe(gold - 1000);
    const short: any = mergeView({ bag: eco.runeState().bag, gold: eco.s.gold, dust: 0 }, 'ember_edge', 2);
    expect(short.ok).toBe(false); expect(short.reason).toBe('materials');
    expect(mergeTarget({ ember_edge: [0, 3, 0] }, 'ember_edge')).toBe(3);
  });
  test('제작 2종: 정밀(가루 80) · 가문 지정(가루 40) 버튼 정보와 실제 제작', () => {
    const eco = core({});
    eco.s.runes.dust = 120;
    const [fam, exact] = craftInfo('storm_edge', 120);
    expect(fam).toMatchObject({ target: 'storm', dust: 40, ok: true, text: '가문 지정 제작 · 가루 40' });
    expect(exact).toMatchObject({ target: 'storm_edge', dust: 80, ok: true, text: '정밀 제작 · 가루 80' });
    expect(eco.runeCraftExact('storm_edge').created).toEqual({ id: 'storm_edge', grade: 1 });
    const r = eco.runeCraftFamily('storm');
    expect(r.ok).toBe(true); expect(['storm_step', 'storm_eye', 'storm_edge']).toContain(r.created.id);
    expect(eco.runeState().dust).toBe(0);
    expect(craftInfo('storm_edge', 0).every((c: any) => !c.ok)).toBe(true);
  });
});

describe('룬 각인판(A38)', () => {
  test('4부위 소켓·가문 공명이 실제 장착과 같고, 자동 장착은 빈 칸만 채운다', () => {
    const eco = core({ ember_edge: [0, 0, 1], tide_breath: [2, 0, 0], storm_edge: [1, 0, 0] });
    eco.runeInsert(1, 0, { id: 'ember_edge', grade: 3 });
    const v: any = overviewView(eco, 'knight');
    expect(v.rows.map((r: any) => r.sockets.length)).toEqual([3, 3, 1, 0]);
    expect(v.rows[0].sockets[0].label).toBe('잿불 칼날 III');
    expect(v.counts).toEqual(equippedCounts(eco));
    const plan = autoFillPlan(eco, 'knight');
    // 열린 빈 칸: 무기 2칸, 갑옷 2칸, 반지 1칸 = 5, 가방 3개 → 3칸만
    expect(plan.length).toBe(3);
    expect(plan.every((p) => !(eco.s.inventory.find((x: any) => x.uid === p.uid).sockets || [])[p.index])).toBe(true);
    const filled = JSON.stringify(eco.s.inventory[0].sockets[0]);
    for (const p of plan) expect(eco.runeInsert(p.uid, p.index, p.rune).ok).toBe(true);
    expect(JSON.stringify(eco.s.inventory[0].sockets[0])).toBe(filled);
    expect(overviewView(eco, 'knight').counts).toEqual(equippedCounts(eco));
    expect(autoFillPlan(eco, 'knight')).toEqual([]);
  });
});

test('룬석 아이콘은 가문 색·등급 점, 잠긴 칸은 자물쇠', () => {
  const html = runeHex('storm', 3);
  expect(html).toContain('data-family="storm"');
  expect((html.match(/<i><\/i>/g) || []).length).toBe(3);
  expect(emptyHex('locked')).toContain('rune-hex-locked');
});
