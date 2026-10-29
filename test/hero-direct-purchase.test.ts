// 영웅 보석 직접 영입: 기본 꺼짐, 가격·소유 제외 규칙, 캠페인 합류와의 비충돌, 저장 실패 롤백, 서버 /cmd 패리티, 화면 노출.
import { afterEach, describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { EconomyCore, createMemoryStorage } from '../src/game/economy-core.js';
import { createSeededRng } from '../src/shared/rng.js';
import { parityHash } from '../src/shared/state-hash.js';
import { OPS, validateOp } from '../src/shared/v1-ops.js';
import { HEROES } from '../src/data/heroes.js';
import { HERO_CAMPAIGN_JOIN } from '../src/data/hero-roster.js';
import { HERO_DIRECT_PURCHASE, HERO_DIRECT_PURCHASE_GEMS, HERO_DIRECT_PURCHASE_KRW } from '../src/data/hero-direct-purchase.js';
import { IAP_BY_ID } from '../src/shared/iap-catalog.js';
import { v1Harness } from './helpers/v1-harness';

const NOW = Date.UTC(2026, 9, 27, 3);
const on = () => { HERO_DIRECT_PURCHASE.enabled = true; };
afterEach(() => { HERO_DIRECT_PURCHASE.enabled = false; });

function chosen(starter = 'knight', { unlocked = 5, gems = 99999 } = {}) {
  const eco = new Economy({ storage: createMemoryStorage(), now: () => NOW });
  expect(eco.chooseStarter(starter).ok).toBe(true);
  eco.s.progress.unlocked = unlocked; eco.s.gems = gems;
  return eco;
}

describe('기본값과 가격표', () => {
  test('기본은 꺼짐이고 꺼져 있으면 어떤 입력에도 disabled 만 돌려주며 상태가 변하지 않는다', () => {
    expect(HERO_DIRECT_PURCHASE.enabled).toBe(false);
    const eco = chosen();
    const before = JSON.stringify(eco.s);
    for (const id of ['mage', 'werewolf', 'knight', 'nobody', 42 as any]) expect(eco.buyHero(id)).toEqual({ ok: false, reason: 'disabled' });
    expect(eco.heroBuyQuote('mage').reason).toBe('disabled');
    expect(JSON.stringify(eco.s)).toBe(before);
  });
  test('가격은 30,000원어치 보석(보석 팩 기본 단가, 보너스 제외)이고 모든 영웅이 같다', () => {
    const base = IAP_BY_ID['gems_300_v1'] as any;   // 읽기만: 가장 작은 팩이 보너스·묶음 할인 없는 기본 단가
    expect(base.grant.rewards.gems).toBe(300); expect(base.priceKRW).toBe(3900);
    expect(HERO_DIRECT_PURCHASE_GEMS).toBe(Math.ceil(HERO_DIRECT_PURCHASE_KRW / (base.priceKRW / base.grant.rewards.gems)));
    expect(HERO_DIRECT_PURCHASE_KRW).toBe(30000); expect(HERO_DIRECT_PURCHASE_GEMS).toBe(2308);
    expect(HERO_DIRECT_PURCHASE.prices).toEqual({ SR: 2308, SSR: 2308 });
    for (const def of Object.values(HEROES) as any[]) expect(HERO_DIRECT_PURCHASE.prices[def.rarity as 'SR' | 'SSR']).toBeGreaterThan(0);
  });
});

describe('Economy.buyHero (켠 상태)', () => {
  test('미소유 영웅을 보석으로 영입: 등급별 가격 차감, 소유 추가, 합류와 같은 시작 레벨·장비', () => {
    on();
    const eco = chosen('knight', { unlocked: 5 }); eco.s.heroes.knight.level = 20;
    const r = eco.buyHero('werewolf');   // SSR 소환 전용: 합류 관문이 없어 진행과 무관
    expect(r).toEqual({ ok: true, id: 'werewolf', gems: 2308 });
    expect(eco.s.gems).toBe(99999 - 2308);
    expect(eco.ownHero('werewolf')).toBe(true);
    expect(eco.s.heroes.werewolf.level).toBe(17);                       // 출전 영웅 Lv20 − 3 (합류 규칙과 같음)
    expect(Object.values(eco.s.heroes.werewolf.equip).every(Boolean)).toBe(true);
  });
  test('가격 2,308 (합류 관문 전)과 보석 부족', () => {
    on();
    const eco = chosen('knight', { unlocked: 5, gems: 2307 });
    expect(eco.buyHero('mage')).toEqual({ ok: false, reason: 'gems' });
    eco.s.gems = 2308;
    expect(eco.buyHero('mage')).toEqual({ ok: true, id: 'mage', gems: 2308 });
    expect(eco.s.gems).toBe(0);
  });
  test('제외: 소유 영웅(시작·이미 합류)·진행이 합류 관문을 지난 영웅·시작 영웅 선택 전·모르는 id', () => {
    on();
    const eco = chosen('knight', { unlocked: 5 });
    expect(eco.buyHero('knight')).toEqual({ ok: false, reason: 'owned' });
    expect(eco.buyHero('nobody')).toEqual({ ok: false, reason: 'unknown' });
    eco.s.progress.unlocked = HERO_CAMPAIGN_JOIN.mage;
    expect(eco.buyHero('mage')).toEqual({ ok: false, reason: 'campaign-pending' });
    expect(eco.grantCampaignHeroes(HERO_CAMPAIGN_JOIN.mage - 1)).toEqual(['mage']);
    expect(eco.buyHero('mage')).toEqual({ ok: false, reason: 'owned' });
    const fresh = new Economy({ storage: createMemoryStorage(), now: () => NOW }); fresh.s.gems = 99999;
    expect(fresh.buyHero('mage')).toEqual({ ok: false, reason: 'starter-pending' });
  });
  test('데뷔 전 영웅(검은 고양이)은 살 수 없다', () => {
    on();
    const eco = new Economy({ storage: createMemoryStorage(), now: () => Date.UTC(2026, 9, 27, 3) });
    eco.chooseStarter('knight'); eco.s.gems = 99999;
    expect(eco.buyHero('blackcat')).toEqual({ ok: false, reason: 'unreleased' });
    const later = new Economy({ storage: createMemoryStorage(), now: () => Date.UTC(2026, 10, 10) });
    later.chooseStarter('knight'); later.s.gems = 99999;
    expect(later.buyHero('blackcat').ok).toBe(true);
  });
  test('유료 보석 몫은 무료부터 쓰고 paidGems 가 잔액을 넘지 않는다', () => {
    on();
    const eco = chosen('knight', { unlocked: 5, gems: 3000 }); eco.s.paidGems = 2800;
    expect(eco.buyHero('mage').ok).toBe(true);
    expect(eco.s.gems).toBe(692); expect(eco.s.paidGems).toBe(692);   // 무료 200 먼저, 유료 2,108 소비
  });
  test('저장이 실패하면 보석·소유·레벨·장비가 모두 되돌아간다', () => {
    on();
    const storage = createMemoryStorage();
    const eco = new Economy({ storage, now: () => NOW }); eco.chooseStarter('knight'); eco.s.gems = 20000; eco.s.progress.unlocked = 5;
    const before = JSON.stringify(eco.s);
    storage.setItem = () => { throw new Error('quota'); };
    expect(eco.buyHero('mage')).toEqual({ ok: false, reason: 'storage' });
    expect(JSON.stringify(eco.s)).toBe(before);
  });
  test('난수를 쓰지 않는다: Math.random 을 막아도 같은 결과, 같은 입력은 같은 상태 해시', () => {
    on();
    const orig = Math.random; Math.random = () => { throw new Error('random'); };
    try {
      const a = chosen('knight', { unlocked: 5 }), b = chosen('knight', { unlocked: 5 });
      a.buyHero('mage'); b.buyHero('mage');
      expect(parityHash(a.s)).toBe(parityHash(b.s));
    } finally { Math.random = orig; }
  });
});

describe('영입 뒤 캠페인 합류 지점', () => {
  test('이미 산 영웅은 합류 관문을 넘어도 중복 지급·레벨/경험치/장비 덮어쓰기가 없다', () => {
    on();
    const eco = chosen('knight', { unlocked: 5 }); eco.s.heroes.knight.level = 20;
    expect(eco.buyHero('mage').ok).toBe(true);
    const h = eco.s.heroes.mage;
    h.level = 31; h.exp = 777;                                   // 영입 뒤 이용자가 키운 상태
    const equipBefore = JSON.stringify(h.equip), invBefore = eco.s.inventory.length, ownedBefore = [...eco.s.roster.owned];
    eco.s.heroes.knight.level = 60;                              // 출전 영웅이 더 높아도
    expect(eco.grantCampaignHeroes(HERO_CAMPAIGN_JOIN.mage - 1)).toEqual([]);   // 합류 목록에 없음(이미 소유)
    expect(eco.s.heroes.mage.level).toBe(31); expect(eco.s.heroes.mage.exp).toBe(777);
    expect(JSON.stringify(eco.s.heroes.mage.equip)).toBe(equipBefore);
    expect(eco.s.inventory.length).toBe(invBefore);
    expect(eco.s.roster.owned).toEqual(ownedBefore);
    expect(eco.s.roster.owned.filter((x: string) => x === 'mage').length).toBe(1);
  });
  test('영입 전에 보존돼 있던 더 높은 레벨은 낮추지 않는다', () => {
    on();
    const eco = chosen('knight', { unlocked: 5 }); eco.s.heroes.mage.level = 50;
    eco.buyHero('mage');
    expect(eco.s.heroes.mage.level).toBe(50);
  });
});

describe('서버 /cmd 패리티', () => {
  test('buyHero 는 허용 명령표에 있고 형식 검사를 한다', () => {
    expect(Object.keys(OPS)).toContain('buyHero');
    expect(validateOp('buyHero', ['mage'])).toBeTruthy();
    expect(validateOp('buyHero', [])).toBeNull();
    expect(validateOp('buyHero', [1])).toBeNull();
    expect(validateOp('buyHero', ['mage', 'x'])).toBeNull();
  });
  async function seeded(h: Awaited<ReturnType<typeof v1Harness>>, accountId: string) {
    const eco = EconomyCore.fromState(null, { now: () => h.now(), rng: createSeededRng(3) }) as any;
    eco.chooseStarter('knight'); eco.s.progress.unlocked = 5; eco.s.gems = 20000; eco.s.paidGems = 4000; eco.s.heroes.knight.level = 20;
    const state = eco.snapshot(), text = JSON.stringify(state);
    h.db.sqlite.query('UPDATE account_docs SET doc = ?, bytes = ? WHERE account_id = ?').run(text, Math.min(text.length, 262144), accountId);
    return state;
  }
  test('꺼짐: 서버도 422 rejected(disabled)이고 문서가 그대로다', async () => {
    const h = await v1Harness(); const a = await h.session();
    await seeded(h, a.accountId);
    const r = await h.cmd(a.token, 'buyHero', ['mage']);
    expect(r.status).toBe(422); expect(r.body.reason).toBe('disabled');
    const me = await h.send('GET', '/me', undefined, a.token);
    expect(me.body.rev).toBe(1); expect(me.body.doc.gems).toBe(20000);
  });
  test('켬: 서버 결과·문서가 클라이언트와 같고 stateHash 가 일치한다, 재시도는 소유로 거부', async () => {
    on();
    const h = await v1Harness(); const a = await h.session();
    const start = await seeded(h, a.accountId);
    const client = EconomyCore.fromState(start, { now: () => h.now() }) as any;
    expect(client.buyHero('mage').ok).toBe(true); client.save();
    const r = await h.cmd(a.token, 'buyHero', ['mage'], { clientHash: parityHash(client.s) });
    expect(r.status).toBe(200);
    expect(r.body.match).toBe(true); expect(r.body.stateHash).toBe(parityHash(client.s));
    expect(r.body.doc.gems).toBe(17692); expect(r.body.doc.paidGems).toBe(client.s.paidGems);
    expect(r.body.doc.roster.owned).toContain('mage');
    expect(r.body.doc.heroes.mage.level).toBe(client.s.heroes.mage.level);
    const again = await h.cmd(a.token, 'buyHero', ['mage']);
    expect(again.status).toBe(422); expect(again.body.reason).toBe('owned');
  });
});

describe('화면', () => {
  test('영웅 카드의 영입 버튼 마크업은 켠 상태에서만 만들어진다', async () => {
    const { heroBuyButtonHtml } = await import('../src/ui/hero-buy.js');
    const eco = chosen('knight', { unlocked: 5 });
    expect(heroBuyButtonHtml(eco, 'mage')).toBe('');            // 꺼짐: 아무것도 그리지 않는다
    on();
    expect(heroBuyButtonHtml(eco, 'mage')).toContain('보석으로 바로 영입');
    expect(heroBuyButtonHtml(eco, 'knight')).toBe('');          // 소유 영웅 제외
    eco.s.progress.unlocked = HERO_CAMPAIGN_JOIN.mage;
    expect(heroBuyButtonHtml(eco, 'mage')).toBe('');            // 곧 무료 합류
  });
});
