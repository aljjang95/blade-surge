import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Economy, createSeededRng, gachaContents, gachaRates } from '../src/game/economy.js';
import { GACHA } from '../src/data/shop.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { weaponLook, weaponLookText, WEAPON_ELEMENT } from '../src/data/weapon-looks.js';
import { LOOKS } from '../src/game/look.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

describe('gacha contents', () => {
  test('every grade splits into heroes, gear and materials that sum to its base rate', () => {
    const rates = gachaRates(), list = gachaContents();
    expect(list.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1, 10);
    for (const grade of ['SSR', 'SR', 'R'] as const) expect(list.filter((x) => x.grade === grade).reduce((a, x) => a + x.p, 0)).toBeCloseTo(rates.base[grade], 10);
    expect(GACHA.srSplit.hero + GACHA.srSplit.gear + GACHA.materials.SR.reduce((a, m) => a + m.w, 0)).toBeCloseTo(1, 10);
    expect(GACHA.rSplit.gear + GACHA.materials.R.reduce((a, m) => a + m.w, 0)).toBeCloseTo(1, 10);
    // 모든 장비 항목은 실제 장비 데이터와 등급이 맞다
    const items = ITEM_BY_ID as Record<string, { rarity: string }>;
    for (const x of list.filter((x) => x.kind === 'gear')) expect(items[x.id].rarity).toBe(x.rarity!);
    expect(list.filter((x) => x.kind === 'material').map((x) => x.id).sort()).toEqual(['bless', 'protect', 'stones', 'stones2']);
  });

  test('seeded pulls match the published per-kind shares and materials land in the save', () => {
    const eco = new Economy({ gachaSeed: 20260928 });
    const before = { stones: eco.s.stones, stones2: eco.s.stones2 || 0, bless: eco.s.bless, protect: eco.s.protect };
    const N = 40_000; const counts: Record<string, number> = {}; const got = { stones: 0, stones2: 0, bless: 0, protect: 0 } as Record<string, number>;
    for (let i = 0; i < N; i++) {
      const r: any = eco.rollResult('R');
      const key = r.type === 'material' ? 'mat:' + r.k : r.type; counts[key] = (counts[key] || 0) + 1;
      if (r.type === 'material') got[r.k] += r.n;
    }
    expect(Math.abs(counts.item / N - GACHA.rSplit.gear)).toBeLessThan(0.01);
    expect(Math.abs(counts['mat:stones'] / N - GACHA.materials.R[0].w)).toBeLessThan(0.01);
    expect(Math.abs(counts['mat:bless'] / N - GACHA.materials.R[1].w)).toBeLessThan(0.01);
    expect(eco.s.stones - before.stones).toBe(got.stones);
    expect(eco.s.bless - before.bless).toBe(got.bless);
    const sr: Record<string, number> = {};
    for (let i = 0; i < N; i++) { const r: any = eco.rollResult('SR'); const k = r.type === 'material' ? 'mat:' + r.k : r.type; sr[k] = (sr[k] || 0) + 1; }
    expect(Math.abs(sr.hero / N - GACHA.srSplit.hero)).toBeLessThan(0.01);
    expect(Math.abs(sr.item / N - GACHA.srSplit.gear)).toBeLessThan(0.01);
    expect(Math.abs(sr['mat:stones2'] / N - GACHA.materials.SR[0].w)).toBeLessThan(0.01);
    expect(Math.abs(sr['mat:protect'] / N - GACHA.materials.SR[1].w)).toBeLessThan(0.01);
  });

  test('a failed save rolls back materials granted by a pull', () => {
    const eco = new Economy({ gachaRng: () => 0.99 }); eco.s.gems = 10_000; eco.s.tickets = 0;
    const before = structuredClone(eco.s);
    eco.save = () => false;
    expect(eco.pull(10)).toBeNull();
    expect(eco.s).toEqual(before);
  });

  test('ten-pull SR guarantee still holds when materials are in the pool', () => {
    const eco = new Economy({ gachaSeed: 11 }); eco.s.gems = 1_000_000_000; eco.s.tickets = 0;
    for (let i = 0; i < 300; i++) expect(eco.pull(10)!.some((x: any) => x.rar !== 'R')).toBe(true);
  });
});

describe('weapon looks', () => {
  test('every gacha weapon has a defined element colour and a hero-specific form', () => {
    for (const x of gachaContents().filter((x) => x.kind === 'gear' && x.slot === 'weapon')) {
      expect((WEAPON_ELEMENT as Record<string, unknown>)[x.id]).toBeDefined();
      for (const hero of Object.keys(LOOKS)) expect(weaponLook(hero, { id: x.id, enh: 0 }, LOOKS)!.form).not.toBe('기본 무기');
    }
  });

  test('knight form changes from one-handed sword to two-handed greatsword at SSR, rogue gets dual daggers', () => {
    expect(weaponLook('knight', { id: 'w_steel', enh: 0 }, LOOKS)!.form).toBe('한손검');
    expect(weaponLook('knight', { id: 'w_flame', enh: 0 }, LOOKS)!.form).toBe('한손검');
    expect(weaponLook('knight', { id: 'w_dragon', enh: 0 }, LOOKS)!.form).toBe('양손 대검');
    expect(weaponLook('mage', { id: 'w_steel', enh: 0 }, LOOKS)!.form).toBe('대마법 지팡이');
    expect(weaponLook('rogue', { id: 'w_steel', enh: 0 }, LOOKS)!.form).toBe('쌍단검');
  });

  test('enhancement raises glow monotonically and adds auras at +10, +15 and +20', () => {
    const g = [0, 5, 10, 15, 20].map((enh) => weaponLook('knight', { id: 'w_flame', enh }, LOOKS)!);
    for (let i = 1; i < g.length; i++) expect(g[i].glow).toBeGreaterThan(g[i - 1].glow);
    expect(g[0].aura).toBeNull(); expect(g[1].aura).toBeNull();
    expect(g[2].aura).toBe('#ff6a2a'); expect(g[3].aura).toBe('#ffd060'); expect(g[4].aura).toBe('#ff8af0');
    expect(g[4].glow).toBeLessThan(1.5 + 0.2);
    expect(weaponLookText(g[3])).toBe('한손검 · 불꽃 발광 · +15 금빛 오라');
    expect(weaponLook('knight', { id: 'a_chain', enh: 0 }, LOOKS)).toBeNull();
  });

  test('armory weapons with their own mesh keep the shield and are described by name for knight/barbarian', () => {
    const armory = Object.values(ITEM_BY_ID as Record<string, any>).filter((it) => it.modelNode && it.slot === 'weapon');
    expect(armory.length).toBeGreaterThan(0);
    for (const it of armory) for (const hero of ['knight', 'barbarian']) {
      const look = weaponLook(hero, { id: it.id, enh: 0 }, LOOKS)!;
      expect(look.twoHanded).toBe(false);
      expect(look.form).toBe(it.name + ' 전용 모델');
    }
    expect(weaponLook('mage', { id: armory[0].id, enh: 0 }, LOOKS)!.form).toBe('대마법 지팡이');
  });
});
