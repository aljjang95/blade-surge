import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Economy, createSeededRng, gachaContents, gachaRates } from '../src/game/economy.js';
import { GACHA_BANNERS } from '../src/data/gacha-banners.js';
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

const MATS = (b: any, grade: 'SR' | 'R') => (b.materials || GACHA_BANNERS.hero.materials)[grade] as Array<{ k: string; n: number; w: number }>;

describe('gacha contents', () => {
  test('every banner splits each grade into heroes, gear and materials that sum to its base rate', () => {
    for (const b of Object.values(GACHA_BANNERS) as any[]) {
      const rates = gachaRates(b.id), list = gachaContents(b.id);
      expect(list.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1, 10);
      for (const grade of ['SSR', 'SR', 'R'] as const) expect(list.filter((x) => x.grade === grade).reduce((a, x) => a + x.p, 0)).toBeCloseTo(rates.base[grade], 10);
      expect((b.sr.hero || 0) + (b.sr.gear || 0) + MATS(b, 'SR').reduce((a, m) => a + m.w, 0)).toBeCloseTo(1, 10);
      expect((b.r.hero || 0) + (b.r.gear || 0) + MATS(b, 'R').reduce((a, m) => a + m.w, 0)).toBeCloseTo(1, 10);
      // 모든 장비 항목은 실제 장비 데이터와 등급이 맞다
      const items = ITEM_BY_ID as Record<string, { rarity: string }>;
      for (const x of list.filter((x) => x.kind === 'gear')) expect(items[x.id].rarity).toBe(x.rarity!);
    }
    // 영웅·초보자 배너는 영웅 재료 표, 장비 배너는 장비 재료 표만 쓴다(SSR 등급 재료 없음).
    const ids = (id: string) => gachaContents(id).filter((x) => x.kind === 'material').map((x) => x.id).sort();
    expect(ids('hero')).toEqual(['bless', 'gold', 'protect', 'stones', 'stones2', 'transcendStones']);
    expect(ids('beginner')).toEqual(ids('hero'));
    expect(ids('gear')).toEqual(['bless', 'protect', 'stones', 'stones2']);
  });

  test('hero banner SSR is all heroes with the pickup at half; gear banner SSR is all L gear with the pickup set at half', () => {
    const hero = gachaContents('hero').filter((x) => x.grade === 'SSR'), r = gachaRates('hero');
    expect(hero.every((x) => x.kind === 'hero')).toBe(true);
    expect(hero.filter((x) => x.featured).reduce((a, x) => a + x.p, 0)).toBeCloseTo(r.base.SSR * GACHA_BANNERS.hero.ssr.featured, 10);
    const gear = gachaContents('gear').filter((x) => x.grade === 'SSR'), g = gachaRates('gear');
    expect(gear.every((x) => x.kind === 'gear' && x.rarity === 'L')).toBe(true);
    expect(gear.filter((x) => x.featured).reduce((a, x) => a + x.p, 0)).toBeCloseTo(g.base.SSR * GACHA_BANNERS.gear.ssr.featured, 10);
    const beginner = gachaContents('beginner').filter((x) => x.grade === 'SSR');
    expect(beginner.some((x) => x.featured)).toBe(false);
    expect(beginner.every((x) => x.kind === 'hero')).toBe(true);
  });

  test('seeded pulls match the published per-kind shares and materials land in the save', () => {
    const eco = new Economy({ gachaSeed: 20260928 });
    const N = 40_000;
    for (const bannerId of ['hero', 'gear'] as const) {
      const banner = GACHA_BANNERS[bannerId] as any;
      for (const grade of ['R', 'SR'] as const) {
        const before = { stones: eco.s.stones, stones2: eco.s.stones2 || 0, bless: eco.s.bless, protect: eco.s.protect } as Record<string, number>;
        const counts: Record<string, number> = {}; const got = { stones: 0, stones2: 0, bless: 0, protect: 0 } as Record<string, number>;
        for (let i = 0; i < N; i++) {
          const r: any = eco.rollResult(grade, { banner, featured: null });
          const key = r.type === 'material' ? 'mat:' + r.k : r.type; counts[key] = (counts[key] || 0) + 1;
          if (r.type === 'material' && r.k in got) got[r.k] += r.n;
        }
        const split = (grade === 'SR' ? banner.sr : banner.r) as { hero?: number; gear?: number };
        expect(Math.abs((counts.item || 0) / N - (split.gear || 0))).toBeLessThan(0.01);
        expect(Math.abs((counts.hero || 0) / N - (split.hero || 0))).toBeLessThan(0.01);
        for (const m of MATS(banner, grade)) expect(Math.abs((counts['mat:' + m.k] || 0) / N - m.w)).toBeLessThan(0.01);
        for (const k of Object.keys(got)) expect((eco.s as any)[k] - before[k]).toBe(got[k]);
      }
    }
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

  test('enhancement raises glow monotonically per light tier; the foot aura starts at +15 (gold) and +20 (myth)', () => {
    // 새 계약(2026-10-27): 강화 빛 단계 +6 은은 / +10 발광 / +13 잔광 / +15 금빛 오라 / +20 신화. 발밑 오라는 +15부터.
    const steps = [0, 6, 10, 13, 15, 20];
    const g = steps.map((enh) => weaponLook('knight', { id: 'w_flame', enh }, LOOKS)!);
    for (let i = 1; i < g.length; i++) expect(g[i].glow).toBeGreaterThan(g[i - 1].glow);
    // +5 이하는 강화 빛이 없어 등급 발광 그대로이고 단계 이름도 없다.
    expect(weaponLook('knight', { id: 'w_flame', enh: 5 }, LOOKS)!.glow).toBe(g[0].glow);
    expect(g.map((x) => x.glowTier.id)).toEqual(['none', 'soft', 'glow', 'blaze', 'aura', 'myth']);
    for (const i of [0, 1, 2, 3]) expect(g[i].aura).toBeNull();
    expect(g[4].aura).toBe('#ffd060'); expect(g[5].aura).toBe('#ff8af0');
    expect(g[5].glow).toBeLessThan(1.5 + 0.2);
    expect(weaponLookText(g[4])).toBe('한손검 · 불꽃 발광 · +15 금빛 오라');
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
