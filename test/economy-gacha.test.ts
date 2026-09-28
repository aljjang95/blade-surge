import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Economy, createSeededRng, gachaChances, gachaRates, rollGachaRarity } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { SAVE_SCHEMA_VERSION } from '../src/game/save-base.js';
import { GACHA } from '../src/data/shop.js';
import { stageDef } from '../src/data/stages.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

describe('gacha rarity contract', () => {
  test('100k seeded pulls: SSR never exceeds hard pity 80 and matches the published rates', () => {
    const rng = createSeededRng(20260928);
    let pity = 0, ssr = 0, maxGap = 0, basePulls = 0, baseSsr = 0, soft70 = 0, soft70Ssr = 0;
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      pity++;
      const rar = rollGachaRarity(pity, rng);
      if (pity <= GACHA.softPity) { basePulls++; if (rar === 'SSR') baseSsr++; }
      if (pity === 70) { soft70++; if (rar === 'SSR') soft70Ssr++; }
      if (rar === 'SSR') { ssr++; maxGap = Math.max(maxGap, pity); pity = 0; }
    }
    const rates = gachaRates();
    expect(maxGap).toBeLessThanOrEqual(GACHA.pity);
    expect(Math.abs(ssr / N - rates.consolidatedSsr)).toBeLessThan(0.003);
    expect(Math.abs(baseSsr / basePulls - rates.base.SSR)).toBeLessThan(0.003);
    expect(Math.abs(soft70Ssr / soft70 - gachaChances(70).SSR)).toBeLessThan(0.08);
  });

  test('published table is derived from the same curve the pull uses', () => {
    const rates = gachaRates();
    expect(rates.base.SSR).toBeCloseTo(2 / 100, 10);
    // ssrByPull[i]는 (i+1)번째 소환. 60번째는 기본 확률, 61번째부터 상승한다.
    expect(rates.ssrByPull[GACHA.softPity - 1]).toBeCloseTo(rates.base.SSR, 10);
    expect(gachaChances(GACHA.softPity).SSR).toBeCloseTo(rates.base.SSR, 10);
    expect(rates.ssrByPull[GACHA.softPity]).toBeCloseTo(gachaChances(GACHA.softPity + 1).SSR, 10);
    expect(gachaChances(GACHA.softPity + 1).SSR).toBeCloseTo((2 + GACHA.softPityStep) / (100 + GACHA.softPityStep), 10);
    for (let i = GACHA.softPity + 1; i < GACHA.pity; i++) expect(rates.ssrByPull[i]).toBeGreaterThan(rates.ssrByPull[i - 1]);
    expect(rates.ssrByPull[GACHA.pity - 1]).toBe(1);
    expect(rates.ssrSplit.featuredHero + rates.ssrSplit.otherSsrHero + rates.ssrSplit.ssrGear).toBeCloseTo(1, 10);
    expect(rates.ssrSplit.otherHeroes).not.toContain(GACHA.featured);
  });
});

describe('Economy gacha', () => {
  test('all-R RNG still yields SSR on exactly the 80th single pull and resets pity', () => {
    const eco = new Economy({ gachaRng: () => 0 });
    eco.s.gems = 1_000_000; eco.s.tickets = 0;
    const rars = Array.from({ length: GACHA.pity }, () => eco.pull(1)![0].rar);
    expect(rars.slice(0, GACHA.pity - 1).every((r) => r === 'R')).toBe(true);
    expect(rars[GACHA.pity - 1]).toBe('SSR');
    expect(eco.s.gacha.pity).toBe(0); expect(eco.s.pity).toBe(0);
  });

  test('every 10-pull contains at least one SR+ and all-R RNG upgrades the 10th slot', () => {
    const forced = new Economy({ gachaRng: () => 0 });
    forced.s.gems = 1_000_000; forced.s.tickets = 0;
    const r = forced.pull(10)!;
    expect(r.slice(0, 9).every((x) => x.rar === 'R')).toBe(true); expect(r[9].rar).toBe('SR');
    const eco = new Economy({ gachaSeed: 7 });
    eco.s.gems = 1_000_000_000; eco.s.tickets = 0;
    for (let i = 0; i < 200; i++) expect(eco.pull(10)!.some((x) => x.rar !== 'R')).toBe(true);
  });

  test('same seed reproduces the same pulls and leaves battle Math.random untouched', () => {
    const run = () => { const e = new Economy({ gachaSeed: 42 }); e.s.gems = 1_000_000; e.s.tickets = 0; return JSON.stringify(e.pull(10)!.map((x: any) => [x.rar, x.id ?? x.item?.id])); };
    const original = Math.random; let calls = 0;
    Math.random = () => { calls++; return original(); };
    try { expect(run()).toBe(run()); } finally { Math.random = original; }
    expect(calls).toBe(0);
  });

  test('failed gacha save rolls back cost, pity, inventory, duplicate shards and receipt counters', () => {
    const eco = new Economy({ gachaRng: () => 0 }); eco.s.gems = 10_000; eco.s.tickets = 1;
    const before = structuredClone(eco.s); let notifications = 0; eco.onChange(() => notifications++);
    const save = eco.save; eco.save = () => { eco.storageStatus = 'unavailable'; return false; };
    expect(eco.pull(1)).toBeNull(); expect(eco.lastGachaError).toBe('storage'); expect(eco.s).toEqual(before); expect(notifications).toBe(0);
    eco.s.ssrTickets = 1; const ssrBefore = structuredClone(eco.s);
    expect(eco.pullSSR()).toBeNull(); expect(eco.lastGachaError).toBe('storage'); expect(eco.s).toEqual(ssrBefore); expect(notifications).toBe(0);
    eco.save = save;
  });

  test('gacha failures distinguish missing currency from persistence failure', () => {
    const eco = new Economy({ gachaRng: () => 0 }); eco.s.gems = 0; eco.s.tickets = 0;
    expect(eco.pull(1)).toBeNull(); expect(eco.lastGachaError).toBe('insufficient-funds');
    expect(eco.pullSSR()).toBeNull(); expect(eco.lastGachaError).toBe('no-ssr-ticket');
  });

  test('featured SSR share matches the published split and duplicates convert to shards', () => {
    const eco = new Economy({ gachaSeed: 99 });
    let featured = 0; const N = 20_000;
    for (let i = 0; i < N; i++) { const r = eco.rollResult('SSR'); if ('id' in r && r.id === GACHA.featured) featured++; else if ('id' in r) expect(r.id).not.toBe(GACHA.featured); }
    expect(Math.abs(featured / N - gachaRates().ssrSplit.featuredHero)).toBeLessThan(0.015);
    const dup = new Economy({ gachaRng: () => 0 });
    const before = dup.s.heroes[GACHA.featured].shards;
    const res = dup.rollResult('SSR');
    expect(res).toMatchObject({ type: 'hero', id: GACHA.featured, dup: true, shards: GACHA.dupShards });
    expect(dup.s.heroes[GACHA.featured].shards).toBe(before + GACHA.dupShards);
  });
});

describe('save schema migration', () => {
  test('detects a pre-existing valid or recovery save independently from funnel history', () => {
    const fresh = new Economy();
    expect(fresh.hasStoredSave).toBe(false);
    (globalThis.localStorage as any).values.set('bladesurge_save_v1_backup', JSON.stringify(fresh.s));
    expect(new Economy().hasStoredSave).toBe(true);
  });

  test('legacy save gains schemaVersion and gacha.pity additively; repeat is idempotent', () => {
    const eco = new Economy();
    const legacy: any = structuredClone(eco.s); delete legacy.schemaVersion; delete legacy.gacha; legacy.pity = 37;
    const once = normalizeSave(legacy, eco.fresh());
    expect(once.schemaVersion).toBe(SAVE_SCHEMA_VERSION); expect(once.gacha.pity).toBe(37); expect(once.pity).toBe(37);
    expect(once.gems).toBe(legacy.gems);
    const twice = normalizeSave(structuredClone(once), eco.fresh());
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    legacy.pity = 500; expect(normalizeSave(legacy, eco.fresh()).gacha.pity).toBe(GACHA.pity - 1);
  });
});

describe('campaign replay rewards', () => {
  test('five-stage milestone ticket is paid once, not on replay or sweep', () => {
    const eco = new Economy(), stage = stageDef(1, 5), before = eco.s.tickets, random = Math.random;
    Math.random = () => 0.99;
    try {
      eco.completeStage(stage, 3);
      expect(eco.s.tickets).toBe(before + 1);
      eco.completeStage(stage, 3);
      expect(eco.s.tickets).toBe(before + 1);
      expect(eco.sweep(stage)).not.toBeNull();
      expect(eco.s.tickets).toBe(before + 1);
    } finally { Math.random = random; }
  });
});

describe('cash commerce stays closed without a verified receipt', () => {
  test('cash SKU purchase and premium pass mutate nothing', () => {
    const eco = new Economy();
    const before = JSON.stringify(eco.s);
    for (const id of ['starter', 'monthly', 'gem1', 'vip_pass', 'enh_pack']) expect(eco.purchase(id)).toEqual({ ok: false, reason: 'payment-unavailable' });
    expect(eco.buyPass()).toEqual({ ok: false, reason: 'payment-unavailable' });
    expect(JSON.stringify(eco.s)).toBe(before);
    eco.s.pass.xp = 10_000; expect(eco.claimPass(1, true)).toBeNull();
    const gems = eco.s.gems; expect(eco.purchase('gold1')!.ok).toBe(true); expect(eco.s.gems).toBe(gems - 100);
  });
});
