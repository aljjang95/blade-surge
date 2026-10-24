// 2주 교대 픽업 일정 회귀: 픽업 영웅·확률표·천장·픽업 확정·마일리지 교환 대상이 바뀌는 시점을 경계 1ms 단위로 고정한다.
// 서버 규칙 엔진(EconomyCore)과 클라이언트(Economy)가 같은 상수(HERO_PICKUP_ROTATION·BANNER_EPOCH)로 같은 답을 내는지도 본다.
import { describe, expect, test } from 'bun:test';
import { Economy, gachaRates, gachaContents, heroPickup } from '../src/game/economy.js';
import { EconomyCore, createMemoryStorage } from '../src/game/economy-core.js';
import { BANNER_EPOCH, BANNER_PERIOD_MS, HERO_PICKUP_ROTATION, PICKUP_THEMES, rotationIndex, rotationWindow } from '../src/data/gacha-banners.js';
import { HEROES } from '../src/data/heroes.js';

const DAY = 86_400_000;
/** KST 시각(년, 월 1부터, 일, 시) → ms. */
const kst = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h - 9);
/** 경계와 그 직전·직후 1ms. */
const around = (t: number) => [t - 1, t, t + 1];

describe('교대 일정(KST)', () => {
  test('기준 시각은 2026-10-26 00:00 KST, 한 칸은 14일', () => {
    expect(BANNER_EPOCH).toBe(kst(2026, 10, 26)); expect(BANNER_PERIOD_MS).toBe(14 * DAY);
  });
  test('교대표: 늑대인간 족장 → 검성 → 광전사, 전부 SSR 영웅', () => {
    expect([...HERO_PICKUP_ROTATION]).toEqual(['werewolf', 'knight', 'barbarian']);
    for (const id of HERO_PICKUP_ROTATION) expect(HEROES[id as keyof typeof HEROES]?.rarity).toBe('SSR');
  });
  test('경계 1ms 단위: ~10-26 광전사 → 10-26 늑대인간(할로윈) → 11-09 검성 → 11-23 광전사 → 12-07 늑대인간', () => {
    const plan: Array<[number, string, string]> = [
      [kst(2026, 10, 26), 'barbarian', 'werewolf'],
      [kst(2026, 11, 9), 'werewolf', 'knight'],
      [kst(2026, 11, 23), 'knight', 'barbarian'],
      [kst(2026, 12, 7), 'barbarian', 'werewolf'],
    ];
    for (const [at, before, after] of plan) {
      const [b, a, a1] = around(at);
      expect(heroPickup(b)).toBe(before); expect(heroPickup(a)).toBe(after); expect(heroPickup(a1)).toBe(after);
    }
    // 첫 배포 칸(회차 -1)은 기준 시각 전 어느 때든 광전사다.
    expect(heroPickup(kst(2026, 10, 24, 22))).toBe('barbarian'); expect(rotationIndex(kst(2026, 10, 24))).toBe(-1);
  });
  test('남은 시간 창: 기준 시각 전은 기준 시각에 끝나고, 회차마다 14일', () => {
    expect(rotationWindow(kst(2026, 10, 24))).toEqual({ index: -1, start: BANNER_EPOCH - BANNER_PERIOD_MS, end: BANNER_EPOCH });
    expect(rotationWindow(kst(2026, 10, 31))).toEqual({ index: 0, start: BANNER_EPOCH, end: kst(2026, 11, 9) });
    expect(rotationWindow(kst(2026, 11, 9))).toMatchObject({ index: 1, end: kst(2026, 11, 23) });
  });
  test('할로윈 주제는 늑대인간 픽업에만', () => {
    expect(PICKUP_THEMES.werewolf?.label).toBe('기간 한정 · 할로윈 픽업');
    expect(Object.keys(PICKUP_THEMES)).toEqual(['werewolf']);
  });
});

describe('경계에서 바뀌는 것: 확률표·구성품·천장·확정·마일리지', () => {
  const T0 = BANNER_EPOCH;
  test('확률 공개 표의 픽업과 구성품의 픽업 표시가 경계에서 함께 바뀐다(확률 수치는 그대로)', () => {
    const before = gachaRates('hero', T0 - 1), after = gachaRates('hero', T0);
    expect(before.featured).toBe('barbarian'); expect(after.featured).toBe('werewolf');
    expect(after.base).toEqual(before.base); expect((after as any).consolidatedSsr).toBeCloseTo((before as any).consolidatedSsr, 12);
    const featured = (t: number) => gachaContents('hero', t).filter((x: any) => x.featured).map((x: any) => x.id);
    expect(featured(T0 - 1)).toEqual(['barbarian']); expect(featured(T0)).toEqual(['werewolf']);
    // 새 SSR은 픽업 칸이 아닐 때도 영웅 배너 SSR 구성품에 있다(픽업 밖 SSR 50% 몫).
    expect(gachaContents('hero', T0 + BANNER_PERIOD_MS).some((x: any) => x.id === 'werewolf' && !x.featured)).toBe(true);
    expect(gachaContents('beginner', T0).some((x: any) => x.id === 'werewolf')).toBe(true);
  });
  for (const [name, mkEco] of [
    ['클라이언트 Economy', (now: () => number) => { const e: any = new Economy({ storage: createMemoryStorage(), now }); e.chooseStarter('mage'); return e; }],
    ['서버 EconomyCore', (now: () => number) => { const e: any = new EconomyCore({ now }); e.chooseStarter('mage'); return e; }],
  ] as const) {
    test(`${name}: 천장·픽업 확정·마일리지는 교대를 넘어 이어지고, 확정·교환은 그 순간의 픽업을 준다`, () => {
      let t = T0 - 1; const eco: any = mkEco(() => t);
      eco.s.gems = 1_000_000; eco.s.tickets = 0; eco.s.ssrTickets = 0;
      const g = eco.gachaState(); g.pity = 41; g.guarantee = true; g.mileage = 200;
      expect(eco.mileageQuote()).toMatchObject({ ok: true, id: 'barbarian', have: 200 });
      t = T0; // 교대 순간
      expect(eco.gachaState()).toMatchObject({ pity: 41, guarantee: true, mileage: 200 });
      expect(eco.mileageQuote()).toMatchObject({ ok: true, id: 'werewolf', have: 200 });
      eco.gachaRng = () => 0.99; // SSR 칸 안에서 '픽업 아님'을 고르는 값이어도 확정이 켜져 있으면 픽업
      const hit = eco.rollResult('SSR');
      expect(hit).toMatchObject({ id: 'werewolf', featured: true }); expect(eco.gachaState().guarantee).toBe(false);
      const ex = eco.exchangeMileage();
      expect(ex[0]).toMatchObject({ id: 'werewolf', mileage: true, dup: true, shards: 40 });
      expect(eco.gachaState()).toMatchObject({ mileage: 0 });
    });
  }
  test('서버와 클라이언트가 경계 직전·직후 같은 픽업을 본다', () => {
    for (const at of [T0, T0 + BANNER_PERIOD_MS, T0 + 2 * BANNER_PERIOD_MS, T0 + 3 * BANNER_PERIOD_MS]) for (const t of around(at)) {
      const c: any = new Economy({ storage: createMemoryStorage(), now: () => t }), s: any = new EconomyCore({ now: () => t });
      c.chooseStarter('mage'); s.chooseStarter('mage'); c.gachaState().mileage = s.gachaState().mileage = 200;
      expect(s.mileageQuote().id).toBe(c.mileageQuote().id);
    }
  });
});
