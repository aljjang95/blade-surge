// 소환 구조 회귀(docs/BM_DESIGN.md 12장): 배너 분리·픽업 확정·천장·초보자 20회·유료/무료 보석·마일리지·서버 명령.
// 모든 난수는 시드 고정이거나 주입한 수열이다. 시계는 첫 교대 시각 직후(영웅 픽업 barbarian, 장비 픽업 dragon)로 고정한다.
import { describe, expect, test } from 'bun:test';
import { Economy, gachaRates, gachaContents, heroPickup, gearPickup } from '../src/game/economy.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { normalizeSave } from '../src/game/save.js';
import { createSeededRng } from '../src/shared/rng.js';
import { GACHA_BANNERS, GACHA_MILEAGE, BANNER_EPOCH } from '../src/data/gacha-banners.js';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { GACHA } from '../src/data/shop.js';
import { OPS, validateOp } from '../src/shared/v1-ops.js';
import { assertBands, simulate, summarize, PERSONAS } from '../tools/gacha-sim.mjs';

const NOW = BANNER_EPOCH + 3_600_000;
const PICKUP = 'barbarian', GEAR_SET = 'dragon';
/** 수열 난수: 값을 차례로 돌려주고 끝나면 마지막 값을 반복한다. */
const seq = (...v: number[]) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };
/** 메모리 저장소 Economy(시작 영웅 mage, 보석 넉넉, 소환권 0). */
function mk(opts: Record<string, unknown> = {}, { starter = 'mage' as string | null } = {}) {
  const eco: any = new Economy({ storage: createMemoryStorage(), now: () => NOW, ...opts });
  if (starter) expect(eco.chooseStarter(starter).ok).toBe(true);
  eco.s.gems = 1_000_000; eco.s.tickets = 0; eco.s.ssrTickets = 0;
  return eco;
}
/** 서버 규칙 엔진(저장소 없음, 저장은 항상 성공). */
function core(opts: Record<string, unknown> = {}) {
  const eco: any = new EconomyCore({ now: () => NOW, ...opts });
  eco.chooseStarter('mage'); eco.s.gems = 1_000_000; eco.s.tickets = 0; eco.s.ssrTickets = 0;
  return eco;
}

test('시계 고정: 영웅 픽업은 barbarian, 장비 픽업은 dragon 세트다', () => {
  expect(heroPickup(NOW)).toBe(PICKUP); expect(gearPickup(NOW)).toBe(GEAR_SET);
  expect(gachaRates('hero', NOW).featured).toBe(PICKUP); expect(gachaRates('gear', NOW).featured).toBe(GEAR_SET);
});

describe('(a) 픽업 실패 뒤 다음 SSR은 반드시 픽업', () => {
  test('영웅 배너: 시드 고정 대량 소환에서 픽업이 아닌 SSR 바로 다음 SSR은 항상 픽업이다', () => {
    const eco = mk({ gachaSeed: 20261024 });
    const ssr: any[] = [];
    for (let i = 0; i < 1500; i++) for (const r of eco.pull(10, 'hero')) if (r.rar === 'SSR') ssr.push(r);
    expect(ssr.length).toBeGreaterThan(200);
    expect(ssr.every((r) => r.type === 'hero')).toBe(true); // SSR은 전부 영웅
    let misses = 0;
    for (let i = 0; i < ssr.length; i++) {
      const isPickup = ssr[i].id === PICKUP && ssr[i].featured === true;
      if (!isPickup) { misses++; if (i + 1 < ssr.length) expect([i, ssr[i + 1].id, ssr[i + 1].featured]).toEqual([i, PICKUP, true]); }
      else expect(ssr[i].featured).toBe(true);
    }
    expect(misses).toBeGreaterThan(50); // 50% 몫이 실제로 빗나가는 표본이 충분하다
  });
  test('수열 난수로 정확히: 1번째 SSR 빗나감 → guarantee 켜짐 → 2번째 SSR 픽업 → guarantee 꺼짐', () => {
    // 픽업 판정 rng()<0.5 에 0.9를 줘 빗나가게 하고, 영웅 고르기는 0(첫 후보). 등급은 rollResult에 직접 준다.
    const eco = mk({ gachaRng: seq(0.9, 0) });
    const first = eco.rollResult('SSR');
    expect(first.id).not.toBe(PICKUP); expect(first.featured).toBeUndefined(); expect(eco.gachaState().guarantee).toBe(true);
    const second = eco.rollResult('SSR');
    expect(second).toMatchObject({ id: PICKUP, featured: true }); expect(eco.gachaState().guarantee).toBe(false);
    // 확정이 아닐 때 rng 0.9는 다시 빗나간다(확정이 꺼졌음을 확인).
    eco.gachaRng = seq(0.9, 0); expect(eco.rollResult('SSR').featured).toBeUndefined(); expect(eco.gachaState().guarantee).toBe(true);
  });
  test('장비 배너도 같다: 픽업 세트 빗나감 → 다음 SSR 장비는 픽업 세트 확정(gearGuarantee)', () => {
    const eco = mk({ gachaRng: seq(0.9, 0) });
    const banner = GACHA_BANNERS.gear;
    const miss = eco.rollResult('SSR', { banner, featured: GEAR_SET });
    expect(miss.type).toBe('item'); expect(miss.featured).toBeUndefined(); expect(eco.gachaState().gearGuarantee).toBe(true);
    expect(eco.gachaState().guarantee).toBe(false); // 영웅 배너 확정과 따로 센다
    const hit = eco.rollResult('SSR', { banner, featured: GEAR_SET });
    expect(hit).toMatchObject({ type: 'item', featured: true }); expect(eco.gachaState().gearGuarantee).toBe(false);
  });
  test('SSR 확정 소환권(pullSSR)은 픽업 확정·천장을 건드리지 않고 SSR 영웅 균등이다', () => {
    const eco = mk({ gachaRng: seq(0.9, 0) });
    eco.s.ssrTickets = 3; eco.gachaState().guarantee = true; eco.gachaState().pity = 17;
    for (let i = 0; i < 3; i++) { const r = eco.pullSSR(); expect(r).toHaveLength(1); expect(r[0].rar).toBe('SSR'); expect(r[0].featured).toBeUndefined(); }
    expect(eco.gachaState()).toMatchObject({ guarantee: true, pity: 17 }); expect(eco.s.ssrTickets).toBe(0);
    // 균등: 시드 고정 대량에서 SSR 영웅 둘이 모두 나오고 편차가 작다.
    const e2 = mk({ gachaSeed: 7 }), n = 4000, cnt: Record<string, number> = {};
    for (let i = 0; i < n; i++) { const id = e2.rollResult('SSR', { banner: GACHA_BANNERS.beginner, featured: null }).id; cnt[id] = (cnt[id] || 0) + 1; }
    const ssrIds = HERO_ORDER.filter((id) => HEROES[id].rarity === 'SSR');
    for (const id of ssrIds) expect(Math.abs((cnt[id] || 0) / n - 1 / ssrIds.length)).toBeLessThan(0.03);
  });
});

describe('(b) 천장: 영웅 80번째, 장비 60번째 SSR 확정', () => {
  for (const [id, pity, type] of [['hero', 80, 'hero'], ['gear', 60, 'item']] as const) {
    test(`${id} 배너: rng 0(계속 R)이어도 ${pity}번째 단발은 SSR이고 그 직후 천장이 0으로 돌아간다`, () => {
      const eco = mk({ gachaRng: () => 0 });
      expect(GACHA_BANNERS[id].pity).toBe(pity);
      const key = id === 'hero' ? 'pity' : 'gearPity';
      const rars: string[] = [];
      for (let i = 1; i <= pity; i++) {
        const r = eco.pull(1, id)[0]; rars.push(r.rar);
        expect(eco.gachaState()[key]).toBe(i === pity ? 0 : i);
        if (i === pity) expect(r.type).toBe(type);
      }
      expect(rars.slice(0, pity - 1).every((x) => x === 'R')).toBe(true); expect(rars[pity - 1]).toBe('SSR');
      // 다른 배너의 천장 카운터는 오르지 않았다.
      expect(eco.gachaState()[id === 'hero' ? 'gearPity' : 'pity']).toBe(0);
      expect(eco.s.totalPulls).toBe(pity);
    });
  }
  test('소프트 천장: 영웅 60번째까지는 기본 SSR 가중치, 61번째부터 매 회 오르고 80번째는 100%', () => {
    const r = gachaRates('hero'), by = r.ssrByPull as number[];
    expect(r.softPityFrom).toBe(60); expect(r.hardPity).toBe(80); expect(by).toHaveLength(80);
    for (let k = 1; k < 60; k++) expect(by[k]).toBeCloseTo(by[0], 12);
    for (let k = 60; k < 79; k++) expect(by[k]).toBeGreaterThan(by[k - 1]);
    expect(by[79]).toBe(1);
    const g = gachaRates('gear'); expect(g.hardPity).toBe(60); expect(g.softPityFrom).toBe(45); expect((g.ssrByPull as number[])[59]).toBe(1);
  });
});

describe('(c) 초보자 배너', () => {
  test('20번째까지 SSR이 없으면 20번째가 SSR 영웅 확정이고 21번째(세 번째 10연)는 거부된다', () => {
    const eco = mk({ gachaRng: () => 0 });
    const gems0 = eco.s.gems;
    const a = eco.pull(10, 'beginner'), b = eco.pull(10, 'beginner');
    expect(a.map((r: any) => r.rar)).toEqual([...Array(9).fill('R'), 'SR']);
    expect(b.slice(0, 9).every((r: any) => r.rar !== 'SSR')).toBe(true);
    expect(b[9]).toMatchObject({ type: 'hero', rar: 'SSR' });
    expect(eco.gachaState()).toMatchObject({ beginner: 20, beginnerSsr: true }); expect(eco.beginnerLeft()).toBe(0);
    expect(eco.s.gems).toBe(gems0 - 2 * GACHA_BANNERS.beginner.ten);
    const state = JSON.stringify(eco.s);
    expect(eco.pull(10, 'beginner')).toBeNull(); expect(eco.lastGachaError).toBe('beginner-used');
    expect(JSON.stringify(eco.s)).toBe(state);
  });
  test('1회 소환은 거부되고(invalid-count) 아무것도 쓰지 않는다', () => {
    const eco = mk({ gachaRng: () => 0 }); const state = JSON.stringify(eco.s);
    expect(eco.pull(1, 'beginner')).toBeNull(); expect(eco.lastGachaError).toBe('invalid-count');
    expect(eco.pullQuote(1, 'beginner')).toMatchObject({ ok: false, reason: 'invalid-count' });
    expect(JSON.stringify(eco.s)).toBe(state); expect(eco.beginnerLeft()).toBe(20);
  });
  test('중간에 SSR이 나왔으면 20번째는 확정이 아니다(beginnerSsr 기억)', () => {
    const eco = mk({ gachaRng: seq(0.999999, 0) }); // 첫 칸은 SSR, 그 뒤 계속 R
    const a = eco.pull(10, 'beginner'); expect(a[0].rar).toBe('SSR'); expect(eco.gachaState().beginnerSsr).toBe(true);
    const b = eco.pull(10, 'beginner'); expect(b.every((r: any) => r.rar !== 'SSR')).toBe(true);
    expect(eco.gachaState().beginner).toBe(20);
  });
  test('초보자 10연의 SR 영웅은 미보유 영웅을 먼저 준다', () => {
    const eco = mk({ gachaRng: () => 0 }); // 시작 영웅 mage 보유, SR 후보는 mage·rogue·ranger
    const res = eco.pull(10, 'beginner');
    expect(res[9]).toMatchObject({ type: 'hero', rar: 'SR', id: 'rogue', unlocked: true });
    const more = eco.rollResult('SR', { banner: GACHA_BANNERS.beginner, featured: null }); expect(more.id).toBe('ranger');
  });
  test('초보자 견적: 보석 1,350 이상이면 보석을 먼저 쓰고, 보석이 모자랄 때만 소환권 10장을 쓴다', () => {
    const eco = mk({ gachaRng: () => 0 });
    eco.s.gems = 1350; eco.s.tickets = 10;
    expect(eco.pullQuote(10, 'beginner')).toMatchObject({ ok: true, currency: 'gems', cost: 1350, tickets: 0 });
    eco.s.gems = 1349;
    expect(eco.pullQuote(10, 'beginner')).toMatchObject({ ok: true, currency: 'tickets', tickets: 10, cost: 0 });
    eco.s.tickets = 9; expect(eco.pullQuote(10, 'beginner')).toMatchObject({ ok: false, reason: 'insufficient-funds' });
    // 실제 소환: 보석 우선이면 소환권은 그대로, 소환권 경로면 보석은 그대로.
    eco.s.gems = 5000; eco.s.tickets = 10; expect(eco.pull(10, 'beginner')).toHaveLength(10);
    expect(eco.s.gems).toBe(5000 - 1350); expect(eco.s.tickets).toBe(10);
    eco.s.gems = 100; expect(eco.pull(10, 'beginner')).toHaveLength(10);
    expect(eco.s.gems).toBe(100); expect(eco.s.tickets).toBe(0);
  });
  test('다른 배너는 소환권 먼저, 없으면 보석(정가 300·2,700)', () => {
    const eco = mk({ gachaRng: () => 0 });
    eco.s.gems = 10_000; eco.s.tickets = 1;
    expect(eco.pullQuote(1, 'hero')).toMatchObject({ currency: 'tickets', tickets: 1 });
    eco.s.tickets = 0; expect(eco.pullQuote(1, 'hero')).toMatchObject({ currency: 'gems', cost: 300 });
    expect(eco.pullQuote(10, 'gear')).toMatchObject({ currency: 'gems', cost: 2700 });
    expect(eco.pullQuote(10, 'x')).toMatchObject({ ok: false, reason: 'invalid-banner' });
    expect(eco.pullQuote(5, 'hero')).toMatchObject({ ok: false, reason: 'invalid-count' });
  });
});

describe('(d) 10회 마지막 칸은 SR 이상', () => {
  for (const id of ['hero', 'gear', 'beginner'] as const) {
    test(`${id}: 전부 R로 나오는 난수여도 10번째 칸이 SR로 오르고, 시드 고정 200번의 10연에 모두 SR 이상이 있다`, () => {
      const forced = mk({ gachaRng: () => 0 });
      const r = forced.pull(10, id);
      expect(r.slice(0, 9).every((x: any) => x.rar === 'R')).toBe(true); expect(r[9].rar).toBe('SR');
      const eco = core({ gachaSeed: 91 }); eco.s.gems = 1_000_000_000;
      const tens = id === 'beginner' ? 2 : 200;
      for (let i = 0; i < tens; i++) expect(eco.pull(10, id).some((x: any) => x.rar !== 'R')).toBe(true);
    });
  }
});

describe('(e) 첫 획득은 해금, 중복은 조각 40', () => {
  test('미보유 영웅 SSR 첫 획득 = 해금(roster.owned 추가, 조각 0), 이어서 같은 영웅 = 조각 +40', () => {
    const eco = mk({ gachaRng: () => 0 });
    expect(eco.ownHero(PICKUP)).toBe(false);
    const first = eco.rollResult('SSR');
    expect(first).toMatchObject({ type: 'hero', id: PICKUP, dup: false, unlocked: true, shards: 0, featured: true });
    expect(eco.s.roster.owned).toEqual(['mage', PICKUP]); expect(eco.s.heroes[PICKUP].shards).toBe(0);
    const again = eco.rollResult('SSR');
    expect(again).toMatchObject({ id: PICKUP, dup: true, shards: 40 }); expect('unlocked' in again).toBe(false);
    expect(eco.s.heroes[PICKUP].shards).toBe(40); expect(GACHA.dupShards).toBe(40);
    expect(eco.s.roster.owned).toEqual(['mage', PICKUP]);
  });
  test('시작 영웅을 고르기 전에는 해금하지 않고 조각 40만 쌓인다(선택 화면을 건너뛰지 않는다)', () => {
    const eco = mk({ gachaRng: () => 0 }, { starter: null });
    const res = eco.rollResult('SSR');
    expect(res).toMatchObject({ id: PICKUP, dup: false, locked: true, shards: 40 }); expect('unlocked' in res).toBe(false);
    expect(eco.ownHero(PICKUP)).toBe(false); expect(eco.s.heroes[PICKUP].shards).toBe(40);
  });
});

describe('(f) 저장 실패 시 재화·천장·결과 전부 롤백', () => {
  const failing = (eco: any) => { eco.save = () => { eco.storageStatus = 'unavailable'; return false; }; };
  for (const [id, n] of [['hero', 10], ['hero', 1], ['gear', 10], ['beginner', 10]] as const) {
    test(`${id} ${n}회: 상태 문서가 소환 전과 완전히 같고 알림도 없다`, () => {
      const eco = mk({ gachaRng: () => 0.999999 }); // 매번 SSR이라 해금·확정·천장 변화가 최대한 일어난다
      eco.s.tickets = 3; eco.gachaState().pity = 5; eco.gachaState().guarantee = true; eco.gachaState().mileage = 9;
      const before = structuredClone(eco.s); let notified = 0; eco.onChange(() => notified++);
      failing(eco);
      expect(eco.pull(n, id)).toBeNull(); expect(eco.lastGachaError).toBe('storage');
      expect(eco.s).toEqual(before); expect(notified).toBe(0);
      expect(eco.s.roster.owned).toEqual(['mage']); expect(eco.gachaState()).toMatchObject({ pity: 5, guarantee: true, mileage: 9 });
    });
  }
  test('SSR 확정권·마일리지 교환도 같은 규칙이다', () => {
    const eco = mk({ gachaRng: () => 0 });
    eco.s.ssrTickets = 1; eco.gachaState().mileage = GACHA_MILEAGE.cost;
    const before = structuredClone(eco.s); failing(eco);
    expect(eco.pullSSR()).toBeNull(); expect(eco.lastGachaError).toBe('storage'); expect(eco.s).toEqual(before);
    expect(eco.exchangeMileage()).toBeNull(); expect(eco.lastGachaError).toBe('storage'); expect(eco.s).toEqual(before);
    expect(eco.ownHero(PICKUP)).toBe(false);
  });
  test('저장이 다시 되면 같은 소환이 정상 확정된다(롤백이 상태를 깨뜨리지 않았다)', () => {
    const eco = mk({ gachaRng: () => 0 }); const real = eco.save;
    eco.save = () => false; expect(eco.pull(10, 'hero')).toBeNull();
    eco.save = real; const ok = eco.pull(10, 'hero');
    expect(ok).toHaveLength(10); expect(eco.s.totalPulls).toBe(10); expect(eco.gachaState().pity).toBe(10);
  });
});

describe('(g) 유료/무료 보석', () => {
  const grant = (opId: string, gems: number) => ({ grants: [{ opId, productId: 'gems_300_v1', rewards: { gems } }] });
  test('결제 지급은 paidGems를 늘리고 무료 보석 합계(gems 증가분)는 그대로 합산된다', () => {
    const eco = mk(); eco.s.gems = 1000; eco.s.paidGems = 0;
    expect(eco.applyIapState(grant('op-gem-1', 500))).not.toBeNull();
    expect(eco.s.gems).toBe(1500); expect(eco.s.paidGems).toBe(500);
    expect(eco.applyIapState(grant('op-gem-1', 500))).not.toBeNull(); // 같은 opId는 한 번만
    expect(eco.s.gems).toBe(1500); expect(eco.s.paidGems).toBe(500);
  });
  test('소비는 무료부터: 무료가 남아 있는 동안 paidGems는 그대로이고, 무료가 바닥난 뒤에야 유료가 줄어든다', () => {
    const eco = mk({ gachaRng: () => 0 }); eco.s.gems = 1000; eco.s.paidGems = 0; eco.applyIapState(grant('op-gem-2', 500));
    // 총 1,500 = 무료 1,000 + 유료 500. 단발 300 × 3 = 900(무료만 소비).
    for (let i = 0; i < 3; i++) { expect(eco.pull(1, 'hero')).toHaveLength(1); expect(eco.s.paidGems).toBe(500); }
    expect(eco.s.gems).toBe(600); // 무료 100 + 유료 500
    expect(eco.pull(1, 'hero')).toHaveLength(1); // 무료 100을 다 쓰고 유료 200을 쓴다
    expect(eco.s.gems).toBe(300); expect(eco.s.paidGems).toBe(300);
    expect(eco.pull(1, 'hero')).toHaveLength(1); expect(eco.s.gems).toBe(0); expect(eco.s.paidGems).toBe(0);
  });
  test('10연·초보자 소환도 같은 소비 순서다', () => {
    const eco = mk({ gachaRng: () => 0 }); eco.s.gems = 3000; eco.s.paidGems = 0; eco.applyIapState(grant('op-gem-3', 1500));
    expect(eco.s.gems).toBe(4500);
    eco.pull(10, 'beginner'); expect(eco.s.gems).toBe(4500 - 1350); expect(eco.s.paidGems).toBe(1500); // 무료 3,000 중 1,350
    eco.pull(10, 'hero'); expect(eco.s.gems).toBe(4500 - 1350 - 2700); expect(eco.s.paidGems).toBe(Math.min(1500, eco.s.gems));
    expect(eco.s.paidGems).toBe(450); // 무료 1,650 → 0, 유료 1,500 중 1,050 소비
  });
  test('환불·철회 역분개는 유료 보석부터 차감하고 무료 보석은 지키며 같은 opId는 한 번만이다', () => {
    const eco = mk(); eco.s.gems = 1000; eco.s.paidGems = 0; eco.applyIapState(grant('op-gem-4', 500));
    const rev = (opId: string, gems: number) => ({ reversals: [{ opId, grantId: 'op-gem-4', rewards: { gems } }] });
    eco.applyIapState(rev('rev-1', 200)); expect(eco.s.gems).toBe(1300); expect(eco.s.paidGems).toBe(300);
    eco.applyIapState(rev('rev-1', 200)); expect(eco.s.gems).toBe(1300); expect(eco.s.paidGems).toBe(300);
    // 이미 소비해 유료가 모자란 환불: paidGems는 0으로 내려가고 총 gems는 요청만큼(바닥 0) 줄어든다.
    eco.applyIapState(rev('rev-2', 600)); expect(eco.s.paidGems).toBe(0); expect(eco.s.gems).toBe(700);
    expect(eco.s.paidGems).toBeLessThanOrEqual(eco.s.gems);
  });
  test('정화(clamp): 저장·불러오기에서 paidGems는 총액 이하·0 이상 정수로 맞춰진다', () => {
    const eco = mk(); eco.s.gems = 400; eco.s.paidGems = 99999; eco.save();
    expect(eco.s.paidGems).toBe(400);
    const base = JSON.parse(JSON.stringify(mk().s));
    const run = (gems: unknown, paid: unknown) => normalizeSave({ ...base, gems, paidGems: paid }, JSON.parse(JSON.stringify(base)));
    expect(run(300, 900).paidGems).toBe(300); expect(run(300, -5).paidGems).toBe(0); expect(run(300, 'x').paidGems).toBe(0);
    expect(run(300, 120.9).paidGems).toBe(120); expect(run(0, 50).paidGems).toBe(0);
    const once = run(300, 900); expect(normalizeSave(JSON.parse(JSON.stringify(once)), JSON.parse(JSON.stringify(base))).paidGems).toBe(once.paidGems);
  });
  test('save-base 정화: gacha.{guarantee,gearPity,gearGuarantee,beginner,beginnerSsr,mileage}가 범위·형으로 정리된다', () => {
    const base = JSON.parse(JSON.stringify(mk().s));
    const g = normalizeSave({ ...base, gacha: { pity: 9999, guarantee: 'yes', gearPity: -3, gearGuarantee: 1, beginner: 999, beginnerSsr: 'x', mileage: -1 } }, JSON.parse(JSON.stringify(base))).gacha;
    expect(g.pity).toBeLessThan(GACHA_BANNERS.hero.pity); expect(g.guarantee).toBe(false); expect(g.gearPity).toBe(0); expect(g.gearGuarantee).toBe(false);
    expect(g.beginner).toBe(GACHA_BANNERS.beginner.limit); expect(g.beginnerSsr).toBe(false); expect(g.mileage).toBe(0);
    const ok = normalizeSave({ ...base, gacha: { pity: 10, guarantee: true, gearPity: 7, gearGuarantee: true, beginner: 12, beginnerSsr: true, mileage: 33 } }, JSON.parse(JSON.stringify(base))).gacha;
    expect(ok).toMatchObject({ pity: 10, guarantee: true, gearPity: 7, gearGuarantee: true, beginner: 12, beginnerSsr: true, mileage: 33 });
  });
});

describe('소환 마일리지', () => {
  test('영웅 배너 1회당 1점(장비·초보자·확정권은 0점)이고 200점이 모이기 전에는 교환이 거부된다', () => {
    expect(GACHA_MILEAGE).toMatchObject({ banner: 'hero', perPull: 1, cost: 200 });
    const eco = mk({ gachaRng: () => 0 });
    eco.pull(10, 'hero'); expect(eco.gachaState().mileage).toBe(10);
    eco.pull(1, 'hero'); expect(eco.gachaState().mileage).toBe(11);
    eco.pull(10, 'gear'); eco.pull(10, 'beginner'); eco.s.ssrTickets = 1; eco.pullSSR();
    expect(eco.gachaState().mileage).toBe(11);
    expect(eco.mileageQuote()).toMatchObject({ ok: false, reason: 'points', have: 11, cost: 200, id: PICKUP });
    const before = JSON.stringify(eco.s);
    expect(eco.exchangeMileage()).toBeNull(); expect(eco.lastGachaError).toBe('points'); expect(JSON.stringify(eco.s)).toBe(before);
  });
  test('200점에 지금 픽업 SSR을 준다: 첫 획득은 해금, 다음 교환은 조각 40이고 천장·픽업 확정은 그대로다', () => {
    const eco = mk({ gachaRng: () => 0 });
    eco.gachaState().mileage = 450; eco.gachaState().pity = 33; eco.gachaState().guarantee = true;
    const first = eco.exchangeMileage();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: 'hero', rar: 'SSR', id: PICKUP, featured: true, mileage: true, dup: false, unlocked: true, shards: 0 });
    expect(eco.ownHero(PICKUP)).toBe(true); expect(eco.gachaState()).toMatchObject({ mileage: 250, pity: 33, guarantee: true });
    const second = eco.exchangeMileage();
    expect(second[0]).toMatchObject({ id: PICKUP, dup: true, shards: 40, mileage: true }); expect(eco.s.heroes[PICKUP].shards).toBe(40);
    expect(eco.gachaState().mileage).toBe(50);
    expect(eco.exchangeMileage()).toBeNull(); expect(eco.lastGachaError).toBe('points');
  });
  test('픽업이 바뀌어도 점수는 이어지고(소멸 없음) 새 픽업으로 교환된다', () => {
    let t = NOW; const eco = mk({ gachaRng: () => 0, now: () => t });
    eco.gachaState().mileage = 200; t += 14 * 86400000;
    expect(heroPickup(t)).toBe('knight'); expect(eco.mileageQuote()).toMatchObject({ ok: true, id: 'knight', have: 200 });
    expect(eco.exchangeMileage()[0]).toMatchObject({ id: 'knight', dup: true, shards: 40 }); // 시작 영웅이 아니므로 knight는 이미 보유가 아니다
  });
});

describe('(h) 구성품·확률표와 실제 소환', () => {
  for (const id of ['hero', 'gear', 'beginner'] as const) {
    test(`${id}: gachaContents의 확률 합은 1(오차 1e-9)이고 등급 몫이 기본 확률과 같다`, () => {
      const list = gachaContents(id, NOW), rates = gachaRates(id, NOW);
      expect(Math.abs(list.reduce((a: number, x: any) => a + x.p, 0) - 1)).toBeLessThan(1e-9);
      for (const grade of ['R', 'SR', 'SSR'] as const) {
        expect(Math.abs(list.filter((x: any) => x.grade === grade).reduce((a: number, x: any) => a + x.p, 0) - rates.base[grade])).toBeLessThan(1e-9);
      }
      // 영웅·초보자 배너 SSR은 전부 영웅, 장비 배너 SSR은 전부 장비다.
      const ssr = list.filter((x: any) => x.grade === 'SSR');
      expect(ssr.every((x: any) => x.kind === (id === 'gear' ? 'gear' : 'hero'))).toBe(true);
      if (id !== 'beginner') expect(ssr.filter((x: any) => x.featured).reduce((a: number, x: any) => a + x.p, 0)).toBeCloseTo(rates.base.SSR * 0.5, 10);
    });
  }
  // 천장까지 포함한 실제 등급 빈도: gachaRates().ssrByPull·base 비율에서 반복 구간(마지막 SSR 이후 순번)의 정상 빈도를 계산한다.
  const expectedShare = (id: 'hero' | 'gear') => {
    const r: any = gachaRates(id, NOW), by: number[] = r.ssrByPull, sr = r.base.SR / (r.base.R + r.base.SR);
    let alive = 1, len = 0, nSsr = 0, nSr = 0;
    for (const p of by) { len += alive; nSsr += alive * p; nSr += alive * (1 - p) * sr; alive *= 1 - p; }
    return { SSR: nSsr / len, SR: nSr / len, R: 1 - (nSsr + nSr) / len };
  };
  for (const id of ['hero', 'gear'] as const) {
    test(`${id}: 시드 고정 2만 회 단발의 등급 빈도가 공개 확률표(천장 반영)와 0.5%p 이내다`, () => {
      const eco = core({ gachaSeed: 20000 + (id === 'hero' ? 1 : 2) }); eco.s.gems = 1e12;
      const N = 20_000, cnt = { R: 0, SR: 0, SSR: 0 } as Record<string, number>;
      for (let i = 0; i < N; i++) { cnt[eco.pull(1, id)[0].rar]++; eco.s.inventory.length = 0; } // 인벤토리를 비워 복제 비용을 일정하게 둔다
      const want = expectedShare(id);
      for (const g of ['R', 'SR', 'SSR']) expect([g, Math.abs(cnt[g] / N - (want as any)[g]) < 0.005]).toEqual([g, true]);
      expect((want.SSR)).toBeCloseTo((gachaRates(id, NOW) as any).consolidatedSsr, 9);
      expect(cnt.SSR / N).toBeGreaterThan(gachaRates(id, NOW).base.SSR); // 천장은 기본 확률보다 SSR을 늘린다
    });
  }
});

describe('(i) 서버 명령 pull·pullSSR·exchangeMileage와 같은 상수', () => {
  test('validateOp: pull은 [1|10, hero|gear|beginner]만 통과한다', () => {
    expect(validateOp('pull', [10, 'gear'])).toBeTruthy();
    for (const ok of [[1, 'hero'], [10, 'hero'], [1, 'gear'], [10, 'beginner'], [1, 'beginner']]) expect(validateOp('pull', ok)).toBe(OPS.pull);
    for (const bad of [[5, 'hero'], [1, 'x'], [0, 'hero'], [11, 'gear'], ['10', 'hero'], [10], [10, 'hero', 'x'], [10, null], [1.5, 'hero']]) expect(validateOp('pull', bad as any)).toBeNull();
    expect(validateOp('pullSSR', [])).toBe(OPS.pullSSR); expect(validateOp('pullSSR', [1])).toBeNull();
    expect(validateOp('exchangeMileage', [])).toBe(OPS.exchangeMileage); expect(validateOp('exchangeMileage', ['hero'])).toBeNull();
    expect(OPS.pull.random).toBe(true); expect(OPS.pullSSR.random).toBe(true);
  });
  test('서버 EconomyCore가 같은 배너 상수를 쓴다(공개 확률표·실제 천장·가격)', () => {
    for (const id of ['hero', 'gear', 'beginner'] as const) {
      const r: any = gachaRates(id, NOW), b = GACHA_BANNERS[id];
      expect(r.hardPity).toBe(b.pity); expect(r.softPityFrom).toBe(b.softPity); expect(r.base.SSR).toBeCloseTo(b.rates.SSR / 100, 12);
    }
    expect(gachaRates().hardPity).toBe(GACHA_BANNERS.hero.pity); expect(gachaRates('gear').hardPity).toBe(GACHA_BANNERS.gear.pity);
    const srv = core({ gachaRng: () => 0 });
    // 서버 쪽 실행: OPS 경로로 영웅 80번째, 장비 60번째에 SSR이 정확히 나온다.
    let last: any;
    for (let i = 0; i < GACHA_BANNERS.hero.pity; i++) { last = OPS.pull.run(srv, 1, 'hero'); expect(OPS.pull.ok(last)).toBe(true); }
    expect(last[0].rar).toBe('SSR'); expect(srv.s.gacha.pity).toBe(0);
    for (let i = 0; i < GACHA_BANNERS.gear.pity; i++) last = OPS.pull.run(srv, 1, 'gear');
    expect(last[0]).toMatchObject({ rar: 'SSR', type: 'item' }); expect(srv.s.gacha.gearPity).toBe(0);
    // 가격: 서버가 거는 보석 = 배너 표
    const before = srv.s.gems; OPS.pull.run(srv, 10, 'gear'); expect(before - srv.s.gems).toBe(GACHA_BANNERS.gear.ten);
    // 잘못된 인자는 실행 전에 거절되지만, 실행기가 직접 불려도 상태를 바꾸지 않는다.
    const state = JSON.stringify(srv.s);
    expect(OPS.pull.ok(OPS.pull.run(srv, 5, 'hero'))).toBe(false); expect(OPS.pull.ok(OPS.pull.run(srv, 1, 'x'))).toBe(false);
    expect(JSON.stringify(srv.s)).toBe(state);
  });
  test('서버 상태에서 pullSSR·exchangeMileage 성공 판정은 값 유무다', () => {
    const srv = core({ gachaRng: () => 0 }); srv.s.ssrTickets = 1; srv.gachaState().mileage = GACHA_MILEAGE.cost;
    expect(OPS.pullSSR.ok(OPS.pullSSR.run(srv))).toBe(true); expect(OPS.pullSSR.ok(OPS.pullSSR.run(srv))).toBe(false);
    expect(OPS.exchangeMileage.ok(OPS.exchangeMileage.run(srv))).toBe(true); expect(OPS.exchangeMileage.ok(OPS.exchangeMileage.run(srv))).toBe(false);
  });
  test('서버 시드 난수: 같은 시드·같은 시계면 소환 결과가 같다(결정적 재현)', () => {
    const run = () => { const e = core({ gachaSeed: 5 }); return JSON.stringify([...e.pull(10, 'hero'), ...e.pull(10, 'gear')].map((x: any) => [x.rar, x.id ?? x.item?.id])); };
    expect(run()).toBe(run());
  });
});

describe('(j) 소환 시뮬레이터 설계 밴드', () => {
  test('시드 40 · 90일: assertBands 실패 0', () => {
    const S: Record<string, any> = {};
    for (const id of Object.keys(PERSONAS)) S[id] = summarize(Array.from({ length: 40 }, (_, i) => simulate(id, i, { days: 90 })));
    expect(assertBands(S, 90)).toEqual([]);
    expect(assertBands(S, 30)).toEqual([]); // 90일 미만은 밴드를 검사하지 않는다
  });
});
