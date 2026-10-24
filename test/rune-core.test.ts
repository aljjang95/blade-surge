import { describe, expect, test } from 'bun:test';
import { BOONS, SYNERGIES } from '../src/data/masterworks.js';
import { RUNES, RUNE_FAMILIES, RUNE_MERGE_COST, RUNE_REMOVE_COST, RUNE_SOURCES } from '../src/data/runes.js';
import { boonEffects } from '../src/game/masterworks-core.js';
import {
  socketCount, maxSocketCount, normalizeSockets, socketStates, normalizeRuneBag, bagCount, removeCost,
  insertRune, removeRune, replaceRune, mergeRunes, recoverOnDestroy, recoverOnSell,
  runeActivation, familyCounts, runeSynergies, runeEffects,
} from '../src/game/rune-core.js';

const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw Error(`Expected ok: ${JSON.stringify(r)}`); return r as Extract<T, { ok: true }>; };
const rune = (id: string, grade = 1) => ({ id, grade });

describe('룬 데이터', () => {
  test('룬 12종은 각인 12종의 id·가문·효과를 그대로 쓴다', () => {
    expect(RUNES.map((r) => r.id)).toEqual(BOONS.map((b) => b.id));
    for (const r of RUNES) expect(r.effects).toBe(BOONS.find((b) => b.id === r.id)!.effects);
    expect(RUNE_FAMILIES.map((f) => f.id)).toEqual(['ember', 'tide', 'storm', 'stone']);
    expect(RUNE_MERGE_COST).toEqual({ 2: { count: 3, gold: 1000, runeDust: 0 }, 3: { count: 3, gold: 5000, runeDust: 20 } });
    expect(RUNE_REMOVE_COST).toEqual({ 1: 1000, 2: 3000, 3: 8000 });
    expect(RUNE_SOURCES.eliteDrop.chance).toBe(0.03);
  });
});

describe('소켓', () => {
  test('등급별 소켓 수 표 전부(+15 전/후)', () => {
    const table: Record<string, [number, number]> = { N: [0, 0], S: [1, 1], E: [1, 2], U: [2, 3], L: [2, 3] };
    for (const [grade, [base, bonus]] of Object.entries(table)) {
      expect(socketCount(grade, 0)).toBe(base);
      expect(socketCount(grade, 14)).toBe(base);
      expect(socketCount(grade, 15)).toBe(bonus);
      expect(socketCount(grade, 20)).toBe(bonus);
      expect(maxSocketCount(grade)).toBe(bonus);
    }
    expect(socketCount('X', 20)).toBe(0);
    expect(socketCount('L', -5)).toBe(2);
  });
  test('정규화는 잘못된 값을 비우고 길이를 최대 소켓 수로 맞춘다', () => {
    expect(normalizeSockets('U', [rune('ember_edge', 2), { id: '__proto__', grade: 1 }, rune('tide_breath', 4), rune('storm_eye')])).toEqual([rune('ember_edge', 2), null, null]);
    expect(normalizeSockets('N', [rune('ember_edge')])).toEqual([]);
    expect(normalizeSockets('S', 'bad')).toEqual([null]);
  });
  test('+15 아래면 3번째 칸은 잠기지만 룬은 보존되고, 다시 +15면 살아난다', () => {
    const sockets = [rune('ember_edge'), rune('tide_breath'), rune('storm_step', 3)];
    const low = socketStates({ grade: 'L', enh: 12, sockets });
    expect(low.map((s) => s.locked)).toEqual([false, false, true]);
    expect(low[2].rune).toEqual(rune('storm_step', 3));
    expect(runeEffects([{ grade: 'L', enh: 12, sockets }]).speed).toBeUndefined();
    expect(runeEffects([{ grade: 'L', enh: 15, sockets }]).speed).toBeCloseTo(0.12);
    expect(runeActivation([{ grade: 'L', enh: 12, sockets }])[2]).toMatchObject({ active: false, reason: 'locked' });
  });
});

describe('룬 가방', () => {
  test('정규화는 알 수 없는 id·음수·소수를 버리고 0만 남은 id 는 뺀다', () => {
    expect(normalizeRuneBag({ ember_edge: [2, -1, 1.5], tide_breath: [0, 0, 0], fake: [9], __proto__: [1] })).toEqual({ ember_edge: [2, 0, 0] });
    expect(normalizeRuneBag(null)).toEqual({});
    expect(bagCount({ ember_edge: [2, 1, 0] }, 'ember_edge', 2)).toBe(1);
    expect(bagCount({ ember_edge: [2] }, 'ember_edge', 4)).toBe(0);
  });
});

describe('박기·빼기·덮어 박기', () => {
  const item = { grade: 'L', enh: 12, sockets: [rune('ember_edge', 2), null, rune('storm_step')] };
  test('빈 칸에 박기는 무료, 가방에서 1개 빠지고 입력은 그대로다', () => {
    const state = Object.freeze({ item, bag: { tide_breath: [1, 0, 0] }, gold: 50 });
    const r = ok(insertRune(state, 1, rune('tide_breath')));
    expect(r.sockets).toEqual([rune('ember_edge', 2), rune('tide_breath'), rune('storm_step')]);
    expect(r.bag).toEqual({}); expect(r.gold).toBe(50); expect(r.cost).toBe(0);
    expect(item.sockets[1]).toBeNull();
  });
  test('박기 실패: 잠긴 칸·찬 칸·없는 룬·범위 밖', () => {
    const state = { item, bag: { tide_breath: [1, 0, 0] }, gold: 0 };
    expect(insertRune(state, 2, rune('tide_breath'))).toEqual({ ok: false, error: 'locked' });
    expect(insertRune(state, 0, rune('tide_breath'))).toEqual({ ok: false, error: 'occupied' });
    expect(insertRune(state, 1, rune('stone_root'))).toEqual({ ok: false, error: 'bag' });
    expect(insertRune(state, 3, rune('tide_breath'))).toEqual({ ok: false, error: 'index' });
    expect(insertRune(state, 1, rune('nope'))).toEqual({ ok: false, error: 'unknown' });
  });
  test('빼기는 등급별 골드, 룬은 가방으로, 잠긴 칸도 뺄 수 있다', () => {
    const r = ok(removeRune({ item, bag: {}, gold: 5000 }, 0));
    expect(r.cost).toBe(3000); expect(r.gold).toBe(2000); expect(r.bag).toEqual({ ember_edge: [0, 1, 0] }); expect(r.sockets[0]).toBeNull();
    expect(ok(removeRune({ item, bag: {}, gold: 1000 }, 2)).gold).toBe(0);
    expect(removeRune({ item, bag: {}, gold: 2999 }, 0)).toEqual({ ok: false, error: 'gold' });
    expect(removeRune({ item, bag: {}, gold: 9999 }, 1)).toEqual({ ok: false, error: 'empty' });
    expect(removeCost(rune('x', 3))).toBe(0); expect(removeCost(rune('ember_edge', 3))).toBe(8000);
  });
  test('덮어 박기는 빼기 비용과 같고 기존 룬은 가방으로 돌아온다', () => {
    const r = ok(replaceRune({ item, bag: { stone_root: [0, 0, 1] }, gold: 3000 }, 0, rune('stone_root', 3)));
    expect(r.cost).toBe(3000); expect(r.gold).toBe(0);
    expect(r.sockets[0]).toEqual(rune('stone_root', 3)); expect(r.bag).toEqual({ ember_edge: [0, 1, 0] });
    expect(replaceRune({ item, bag: { stone_root: [1, 0, 0] }, gold: 9999 }, 2, rune('stone_root'))).toEqual({ ok: false, error: 'locked' });
    expect(replaceRune({ item, bag: { stone_root: [1, 0, 0] }, gold: 9999 }, 1, rune('stone_root'))).toEqual({ ok: false, error: 'empty' });
    expect(replaceRune({ item, bag: {}, gold: 9999 }, 0, rune('stone_root'))).toEqual({ ok: false, error: 'bag' });
    expect(replaceRune({ item, bag: { stone_root: [1, 0, 0] }, gold: 10 }, 0, rune('stone_root'))).toEqual({ ok: false, error: 'gold' });
  });
});

describe('합성', () => {
  test('I×3 + 골드 1,000 → II 1개, 항상 성공하고 재료가 정확히 준다', () => {
    const r = ok(mergeRunes({ bag: { ember_edge: [4, 0, 0] }, gold: 1500, runeDust: 7 }, 'ember_edge', 2));
    expect(r.bag).toEqual({ ember_edge: [1, 1, 0] }); expect(r.gold).toBe(500); expect(r.runeDust).toBe(7);
    expect(r.created).toEqual(rune('ember_edge', 2));
  });
  test('II×3 + 골드 5,000 + 가루 20 → III', () => {
    const r = ok(mergeRunes({ bag: { tide_guard: [0, 3, 0] }, gold: 5000, runeDust: 20 }, 'tide_guard', 3));
    expect(r.bag).toEqual({ tide_guard: [0, 0, 1] }); expect(r.gold).toBe(0); expect(r.runeDust).toBe(0);
  });
  test('합성 실패: 재료·골드·가루 부족, 잘못된 등급·룬', () => {
    expect(mergeRunes({ bag: { ember_edge: [2, 0, 0] }, gold: 9999 }, 'ember_edge', 2)).toEqual({ ok: false, error: 'materials' });
    expect(mergeRunes({ bag: { ember_edge: [3, 0, 0] }, gold: 999 }, 'ember_edge', 2)).toEqual({ ok: false, error: 'gold' });
    expect(mergeRunes({ bag: { ember_edge: [0, 3, 0] }, gold: 5000, runeDust: 19 }, 'ember_edge', 3)).toEqual({ ok: false, error: 'dust' });
    expect(mergeRunes({ bag: { ember_edge: [3, 3, 3] }, gold: 1e5 }, 'ember_edge', 4)).toEqual({ ok: false, error: 'grade' });
    expect(mergeRunes({ bag: { ember_edge: [3, 3, 3] }, gold: 1e5 }, 'ember_edge', 1)).toEqual({ ok: false, error: 'grade' });
    expect(mergeRunes({ bag: {}, gold: 1e5 }, 'nope', 2)).toEqual({ ok: false, error: 'unknown' });
  });
});

describe('회수', () => {
  test('파괴·판매 시 박힌 룬 전부(잠긴 칸 포함)가 무료로 가방에 돌아온다', () => {
    const item = { grade: 'U', enh: 3, sockets: [rune('ember_edge', 2), rune('ember_edge', 2), rune('stone_root', 3)] };
    for (const fn of [recoverOnDestroy, recoverOnSell]) {
      const r = fn({ item, bag: { ember_edge: [1, 0, 0] } });
      expect(r.bag).toEqual({ ember_edge: [1, 2, 0], stone_root: [0, 0, 1] });
      expect(r.sockets).toEqual([null, null, null]);
      expect(r.recovered).toHaveLength(3);
    }
    expect(recoverOnSell({ item: { grade: 'N', sockets: [] }, bag: {} }).recovered).toEqual([]);
  });
});

describe('효과 합산', () => {
  test('III 룬 = 각인 효과 ×3, rank = grade 로 boonEffects 와 같다', () => {
    for (const b of BOONS as unknown as Array<{ id: string, effects: Record<string, number> }>) {
      const e = runeEffects([{ grade: 'S', enh: 0, sockets: [rune(b.id, 3)] }]);
      // boonEffects 는 다른 각인의 0 값 키도 남기므로 0이 아닌 값만 비교한다.
      expect(e).toEqual(Object.fromEntries(Object.entries(boonEffects({ [b.id]: 3 })).filter(([, v]) => v !== 0)));
      for (const [k, v] of Object.entries(b.effects)) if (k !== 'chain') expect(e[k]).toBeCloseTo(v * 3);
    }
  });
  test('같은 룬은 장착 전체에서 2개까지만 쌓이고, 높은 등급이 먼저 살아남는다', () => {
    const items = [
      { grade: 'S', enh: 0, sockets: [rune('ember_edge', 1)] },
      { grade: 'U', enh: 0, sockets: [rune('ember_edge', 3), rune('ember_edge', 2)] },
    ];
    expect(runeEffects(items).atk).toBeCloseTo(0.05 * 5);
    const act = runeActivation(items);
    expect(act[0]).toMatchObject({ item: 0, index: 0, active: false, reason: 'duplicate' });
    expect(act.filter((e) => e.active)).toHaveLength(2);
  });
  test('sumEffects 상한이 그대로 적용된다(연쇄 2, 회복 상한)', () => {
    const items = [
      { grade: 'L', enh: 15, sockets: [rune('storm_eye', 3), rune('storm_eye', 3), rune('ember_feast', 3)] },
      { grade: 'L', enh: 15, sockets: [rune('tide_return', 3), rune('tide_return', 3), rune('ember_feast', 3)] },
    ];
    const e = runeEffects(items);
    expect(e.chain).toBe(2);
    expect(e.healOnKill).toBeCloseTo(0.05);
  });
});

describe('가문 공명', () => {
  test('두 가문 각 1개로는 켜지지 않고, 각 2개 이상이어야 켜진다', () => {
    const one = [{ grade: 'U', enh: 0, sockets: [rune('ember_edge'), rune('tide_breath')] }];
    expect(runeSynergies(familyCounts(one))).toEqual([]);
    expect(runeEffects(one).healOnKill).toBeUndefined();
    const two = [...one, { grade: 'U', enh: 0, sockets: [rune('ember_hunt'), rune('tide_guard')] }];
    expect(familyCounts(two)).toEqual({ ember: 2, tide: 2, storm: 0, stone: 0 });
    expect(runeSynergies(familyCounts(two)).map((s) => s.id)).toEqual(['steam']);
    expect(runeEffects(two).healOnKill).toBeCloseTo((SYNERGIES as unknown as Array<{ id: string, effects: Record<string, number> }>).find((s) => s.id === 'steam')!.effects.healOnKill);
  });
  test('잠긴 칸·중복 상한 룬은 가문 수에 들어가지 않는다', () => {
    const items = [{ grade: 'L', enh: 0, sockets: [rune('ember_edge'), rune('ember_edge'), rune('ember_hunt')] },
      { grade: 'S', enh: 0, sockets: [rune('ember_edge')] }];
    expect(familyCounts(items).ember).toBe(2);
  });
  test('전운 각인 1개는 가문 수에 +1로 들어가 하나 모자란 공명을 채운다', () => {
    const items = [{ grade: 'L', enh: 15, sockets: [rune('ember_edge'), rune('ember_hunt'), rune('storm_step')] }];
    expect(runeSynergies(familyCounts(items)).map((s) => s.id)).toEqual([]);
    const counts = familyCounts(items, { blessingBoonId: 'storm_edge' });
    expect(counts).toEqual({ ember: 2, tide: 0, storm: 2, stone: 0 });
    expect(runeSynergies(counts).map((s) => s.id)).toEqual(['wildfire']);
    expect(runeEffects(items, { blessingBoonId: 'storm_edge' }).atk).toBeCloseTo(0.05 + 0.07);
    expect(familyCounts(items, { blessingBoonId: 'fake' })).toEqual(familyCounts(items));
  });
});

test('100만 넘는 골드·룬 가루도 잘리지 않는다', () => {
  const item = { grade: 'U', enh: 0, sockets: [] };
  const ins = insertRune({ item, bag: { ember_edge: [1, 0, 0] }, gold: 2500000 }, 0, { id: 'ember_edge', grade: 1 });
  expect(ins.ok && ins.gold).toBe(2500000);
  const m = mergeRunes({ bag: { ember_edge: [0, 3, 0] }, gold: 2500000, runeDust: 1500000 }, 'ember_edge', 3);
  expect(m.ok && m.gold).toBe(2495000);
  expect(m.ok && m.runeDust).toBe(1499980);
});
