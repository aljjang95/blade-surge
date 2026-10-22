import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Economy, createSeededRng as legacySeededRng } from '../src/game/economy.js';
import { EconomyCore, canonicalJson, stableHash } from '../src/game/economy-core.js';
import { createSeededRng, cryptoRng, hashSeed, seededStream } from '../src/shared/rng.js';
import { ENERGY } from '../src/data/shop.js';
import { ITEM_POOL } from '../src/data/items.js';
import { stageDef } from '../src/data/stages.js';

const KEY = 'bladesurge_save_v1';
const T0 = 1_700_000_000_000;
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const restoreStorage = () => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); };
// 접근만 해도 실패하는 저장소: EconomyCore가 전역 localStorage를 전혀 읽지 않는지 확인한다.
const trapStorage = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('localStorage 접근'); } });
afterEach(restoreStorage);

/** 강화 확률 구간(+10)의 장비와 넉넉한 재화를 가진 상태. */
function richState(now: number) {
  const s: any = EconomyCore.fromState(null, { now: () => now }).snapshot();
  Object.assign(s, { gold: 1e9, gems: 1e6, stones: 9999, stones2: 9999, stones3: 9999, protect: 0, bless: 0, energy: 0, energyT: now });
  s.inventory = [1, 2, 3, 4, 5, 6].map((uid) => ({ uid, id: ITEM_POOL.weapon[0].id, enh: 10 }));
  s.invSeq = 7;
  return s;
}

describe('EconomyCore 저장 분리', () => {
  test('localStorage 없이 fromState·규칙 연산·save가 동작한다', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect((globalThis as any).localStorage).toBeUndefined();
    const fresh = EconomyCore.fromState(null, { now: () => T0, rng: () => 0.5 });
    expect(fresh.s.gold).toBe(12000);
    expect(fresh.s.created).toBe(T0);
    trapStorage();
    const core = EconomyCore.fromState(richState(T0), { now: () => T0, rng: () => 0.5 });
    expect(core.hasStoredSave).toBe(true);
    expect(core.save()).toBe(true);
    expect(core.claimDaily()).not.toBeNull();
    core.addHeroExp('knight', Math.ceil((core.trainingQuote('knight').need ?? 0) * 0.6), { silent: true });
    expect(core.levelUpHero('knight')).toBe(true);
    expect(core.enhance(1).ok).toBe(true);
    expect(core.storageStatus).toBe('ready');
    expect(core.reset()).toBe(true);
    expect(core.rollbackEnergy({ energy: 3, energyT: T0 })).toBe(true);
  });

  test('fromState는 로드 경로와 같은 normalizeSave 마이그레이션을 거치고 입력을 바꾸지 않는다', () => {
    const raw: any = richState(T0);
    raw.progress = { unlocked: 30, stars: { '3-10': 3 } };
    delete raw.journey; delete raw.arsenal;
    const copy = structuredClone(raw);
    const core = EconomyCore.fromState(raw, { now: () => T0 });
    expect(raw).toEqual(copy);
    expect(core.nextStage().code).toBe('4-1');
    expect(core.s.journey).toBeTruthy();
    expect(core.s.arsenal).toBeTruthy();
  });

  test('주입 시계가 에너지 회복을 정확히 결정한다', () => {
    let clock = T0;
    const core = EconomyCore.fromState(richState(T0), { now: () => clock });
    expect(core.s.energy).toBe(0);
    const step = ENERGY.regenSec * 1000;
    clock = T0 + step * 7; core.tickEnergy();
    expect(core.s.energy).toBe(7);
    expect(core.s.energyT).toBe(T0 + step * 7);
    clock = T0 + step * 7 + step - 1; core.tickEnergy();
    expect(core.s.energy).toBe(7);
    clock = T0 - step * 50; core.tickEnergy();
    expect(core.s.energy).toBe(7);
    expect(core.s.energyT).toBe(T0 + step * 7);
    clock = T0 + step * 10;
    expect(core.spendEnergy(11)).toBe(false);
    expect(core.s.energy).toBe(10);
    expect(core.spendEnergy(10)).toBe(true);
    expect(core.s.energy).toBe(0);
  });

  test('주입 시계가 출석·월정액·VIP 경계를 결정한다', () => {
    let clock = T0;
    const core = EconomyCore.fromState(richState(T0), { now: () => clock });
    expect(core.claimDaily()).not.toBeNull();
    expect(core.claimDaily()).toBeNull();
    clock += 86400000;
    expect(core.claimDaily()?.idx).toBe(1);
    core.addRewards({ monthly: 30, vipDays: 1 });
    expect(core.s.monthlyUntil).toBe(clock + 30 * 86400000);
    expect(core.isVip).toBe(true);
    expect(core.claimMonthly()).toBe(true);
    expect(core.claimMonthly()).toBe(false);
    clock += 2 * 86400000;
    expect(core.isVip).toBe(false);
    expect(core.claimMonthly()).toBe(true);
  });

  test('같은 seed의 주입 난수는 강화·스테이지 정산 결과와 상태 해시를 재현한다', () => {
    const run = (seed: number) => {
      const core = EconomyCore.fromState(richState(T0), { now: () => T0, rng: createSeededRng(seed), gachaRng: createSeededRng(seed + 1) });
      const results = [1, 2, 3, 4, 5, 6].map((uid) => core.enhance(uid));
      const stage = stageDef(1, 10);
      for (let i = 0; i < 5; i++) core.completeStage(stage, 3, { double: true, fullClear: true });
      return { results, hash: core.stateHash(), state: core.snapshot() };
    };
    const a = run(20261022), b = run(20261022), c = run(7);
    expect(a.results).toEqual(b.results);
    expect(a.hash).toBe(b.hash);
    expect(a.state).toEqual(b.state);
    expect(c.hash).not.toBe(a.hash);
  });

  test('주입 난수가 있으면 규칙 연산이 Math.random을 쓰지 않는다', () => {
    const random = Math.random;
    Math.random = () => { throw new Error('Math.random 사용'); };
    try {
      const core = EconomyCore.fromState(richState(T0), { now: () => T0, rng: createSeededRng(1), gachaRng: createSeededRng(2) });
      for (const uid of [1, 2, 3]) core.enhance(uid);
      core.completeStage(stageDef(1, 10), 3, { double: true, fullClear: true });
      expect(core.pull(10)).toHaveLength(10);
    } finally { Math.random = random; }
  });

  test('stateHash는 키 순서와 무관하고 값이 바뀌면 달라진다', () => {
    const state = richState(T0);
    const reordered = Object.fromEntries(Object.entries(state).reverse());
    const a = EconomyCore.fromState(state, { now: () => T0 }), b = EconomyCore.fromState(reordered, { now: () => T0 });
    expect(a.stateHash()).toBe(b.stateHash());
    // 정규화를 거치지 않은 같은 값도 키 순서와 무관하게 같은 해시다.
    expect(stableHash(canonicalJson(reordered))).toBe(stableHash(canonicalJson(state)));
    expect(a.stateHash()).toMatch(/^[0-9a-f]{16}$/);
    b.s.gold++;
    expect(b.stateHash()).not.toBe(a.stateHash());
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 2 }] })).toBe('{"a":[{"c":2}],"b":1}');
    expect(stableHash('{"a":1}')).toBe(stableHash('{"a":1}'));
    expect(stableHash('{"a":1}')).not.toBe(stableHash('{"a":2}'));
  });

  test('snapshot은 깊은 복제다', () => {
    const core = EconomyCore.fromState(richState(T0), { now: () => T0 });
    const snap: any = core.snapshot();
    expect(snap).toEqual(JSON.parse(JSON.stringify(core.s)));
    snap.inventory[0].enh = 99; snap.heroes.knight.level = 70; snap.gold = 0;
    expect(core.s.inventory[0].enh).toBe(10);
    expect(core.s.heroes.knight.level).toBe(1);
    expect(core.s.gold).toBe(1e9);
    const hash = core.stateHash();
    expect(EconomyCore.fromState(core.snapshot(), { now: () => T0 }).stateHash()).toBe(hash);
  });
});

describe('Economy 기본 동작 유지', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    } });
  });

  test('기본 저장소·시계·난수는 호출 시점의 전역을 따른다', () => {
    const realNow = Date.now, realRandom = Math.random;
    let clock = T0;
    Date.now = () => clock;
    try {
      const eco = new Economy();
      expect(eco.s.created).toBe(T0);
      expect(eco.save()).toBe(true);
      expect(JSON.parse(values.get(KEY)!).created).toBe(T0);
      eco.s.energy = 0; eco.s.energyT = T0;
      clock = T0 + ENERGY.regenSec * 1000 * 3; eco.tickEnergy();
      expect(eco.s.energy).toBe(3);
      Object.assign(eco.s, { gold: 1e9, stones: 9999, stones2: 9999, stones3: 9999 });
      eco.s.inventory = [{ uid: 1, id: ITEM_POOL.weapon[0].id, enh: 10 }];
      let calls = 0;
      Math.random = () => { calls++; return 0.999; };
      const result = eco.enhance(1);
      expect(calls).toBeGreaterThan(0);
      expect(result.success).toBe(false);
      // 생성 뒤 바꿔 끼운 저장소도 따른다(실패하면 기존처럼 unavailable).
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => {} } });
      expect(eco.save()).toBe(false);
      expect(eco.storageStatus).toBe('unavailable');
    } finally { Date.now = realNow; Math.random = realRandom; }
  });

  test('주입 저장소를 넘기면 전역 localStorage를 쓰지 않는다', () => {
    const own = new Map<string, string>();
    const eco = new Economy({ storage: { getItem: (k: string) => own.get(k) ?? null, setItem: (k: string, v: string) => { own.set(k, v); }, removeItem: (k: string) => { own.delete(k); } } });
    expect(eco.save()).toBe(true);
    expect(own.has(KEY)).toBe(true);
    expect(values.size).toBe(0);
  });

  test('createSeededRng는 economy.js 경로에서도 같은 함수다', () => {
    expect(legacySeededRng).toBe(createSeededRng);
  });
});

describe('shared/rng', () => {
  test('createSeededRng는 같은 seed에 같은 수열(mulberry32)을 낸다', () => {
    const a = createSeededRng(42), b = createSeededRng(42);
    const seq = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(seq);
    expect(seq[0]).toBeCloseTo(0.6011037519201636, 15);
    for (const x of seq) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });

  test('hashSeed는 결정적 uint32이며 조각 경계를 구분한다', () => {
    expect(hashSeed('acct', 1, 'enhance')).toBe(hashSeed('acct', 1, 'enhance'));
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('ab', 'c')).not.toBe(hashSeed('a', 'bc'));
    expect(hashSeed('a', 1)).not.toBe(hashSeed('a', '1', ''));
    const h = hashSeed('계정', 7);
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
  });

  test('seededStream은 같은 문맥에 같은 수열, 다른 문맥에 다른 수열을 낸다', () => {
    const take = (rng: () => number) => Array.from({ length: 4 }, () => rng());
    expect(take(seededStream('s', 'cmd-1'))).toEqual(take(seededStream('s', 'cmd-1')));
    expect(take(seededStream('s', 'cmd-1'))).toEqual(take(createSeededRng(hashSeed('s', 'cmd-1'))));
    expect(take(seededStream('s', 'cmd-2'))).not.toEqual(take(seededStream('s', 'cmd-1')));
  });

  test('cryptoRng는 getRandomValues의 uint32를 [0, 1)로 바꾼다', () => {
    let fills = 0;
    const source = { getRandomValues(array: Uint32Array) { fills++; array.fill(0); array[1] = 0xffffffff; array[2] = 0x80000000; return array; } };
    const rng = cryptoRng(source);
    expect(rng()).toBe(0); expect(rng()).toBe(0xffffffff / 4294967296); expect(rng()).toBe(0.5);
    expect(fills).toBe(1);
    const real = cryptoRng();
    for (let i = 0; i < 200; i++) { const x = real(); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(() => cryptoRng({} as any)).toThrow();
  });
});
