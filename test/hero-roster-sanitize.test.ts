import { describe, expect, test } from 'bun:test';
import { sanitizeLegacySave, trustedRoster } from '../src/shared/legacy-sanitize.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { IAP_BY_ID, IAP_PRODUCTS, entitlementKeys, summarizeEntitlements, soldOn } from '../src/shared/iap-catalog.js';
import { heroEntitlementKey, heroIdFromEntitlement, HERO_LEGACY_IDS } from '../src/data/hero-roster.js';

const NOW = Date.UTC(2026, 10, 3);
const BEFORE = Date.UTC(2020, 0, 1), AFTER = NOW - 86400000;
const base = () => EconomyCore.fromState(null, { now: () => NOW, rng: () => 0.5 }).snapshot() as any;
const save = (patch: Record<string, unknown>, drop: string[] = []) => { const s = { ...base(), ...patch }; for (const k of drop) delete s[k]; return s; };
const run = (raw: any, opts: Record<string, unknown> = {}) => {
  const r = sanitizeLegacySave(raw, { now: NOW, createdAt: NOW - 86400000, ...opts }) as any;
  expect(r.ok).toBe(true);
  return r;
};

describe('영웅 소유 서버 권위 정화', () => {
  test('클라이언트가 보낸 roster.paid·owned는 버리고 서버 권한(entitled.heroes)으로 덮어쓴다', () => {
    const forged = save({ created: AFTER, selected: 'mage', roster: { policy: 2, owned: [...HERO_ORDER], starter: 'mage', starterChosen: true, paid: [...HERO_ORDER] } });
    const none = run(forged);
    expect(none.state.roster.paid).toEqual([]);
    expect(none.state.roster.owned).toEqual(['mage']);
    expect(none.state.roster.policy).toBe(2);
    const some = run(forged, { entitled: { heroes: ['knight', 'rogue', 'nope'] } });
    expect(some.state.roster.paid).toEqual(['knight', 'rogue']);
    expect(some.state.roster.owned).toEqual(['mage']);
    // 영웅 상태(레벨·장비)는 지우지 않는다: 다섯 영웅 모두 그대로.
    expect(Object.keys(some.state.heroes).sort()).toEqual([...HERO_ORDER].sort());
  });

  test('클라이언트 데이터만으로는 정책 1을 받지 못한다: roster 없음 + 옛 created도 정책 2 + 시작 영웅 1명', () => {
    for (const created of [BEFORE, AFTER, NOW + 1, 0, 'x' as any, null as any]) {
      const r = run(save({ created, selected: 'ranger' }, ['roster']));
      expect(r.state.roster.policy).toBe(2);
      expect(r.state.roster.owned).toEqual(['ranger']);
      expect(r.state.roster.starter).toBe('ranger');
      expect(r.state.roster.starterChosen).toBe(true);
      expect(r.state.roster.paid).toEqual([]);
      expect(r.report.roster).toEqual({ policy: 2, grandfathered: false });
    }
    // 선택 영웅이 유효하지 않으면 knight
    expect(run(save({ created: BEFORE, selected: 'ghost' }, ['roster'])).state.roster.owned).toEqual(['knight']);
    // 정책 1을 주장하는 roster도 같다
    const claim = run(save({ created: BEFORE, roster: { policy: 1, owned: [...HERO_ORDER], starter: null, starterChosen: true, paid: [...HERO_ORDER] } }));
    expect(claim.state.roster.policy).toBe(2);
    expect(claim.state.roster.owned.length).toBe(1);
    expect(claim.state.roster.paid).toEqual([]);
    // 영웅 상태(레벨·장비)는 보존된다
    expect(Object.keys(claim.state.heroes).sort()).toEqual([...HERO_ORDER].sort());
  });

  test('paid는 항상 서버 권한이다 (정책 1 서버 문서여도)', () => {
    const r = run(save({ created: BEFORE }, ['roster']), { serverRoster: { policy: 1, owned: [...HERO_ORDER], starter: null, starterChosen: true, paid: ['mage'] }, entitled: { heroes: ['rogue'] } });
    expect(r.state.roster.policy).toBe(1);
    expect(r.state.roster.paid).toEqual(['rogue']);
  });

  test('서버 문서의 roster는 신뢰값: 정책 1 유지, 선택한 시작 영웅·owned 유지(고르기 전 기본값 owned는 무시)', () => {
    const forgedNew = save({ created: AFTER, selected: 'mage' }, ['roster']);
    expect(run(forgedNew, { serverRoster: { policy: 1, owned: [...HERO_ORDER], starter: null, starterChosen: true, paid: [] } }).state.roster.policy).toBe(1);
    const chosen = run(forgedNew, { serverRoster: { policy: 2, owned: ['rogue', 'knight'], starter: 'rogue', starterChosen: true, paid: [] } });
    expect(chosen.state.roster.starter).toBe('rogue');
    expect([...chosen.state.roster.owned].sort()).toEqual(['knight', 'rogue']);
    const fresh = run(forgedNew, { serverRoster: { policy: 2, owned: ['knight'], starter: 'knight', starterChosen: false, paid: [] } });
    expect(fresh.state.roster.owned).toEqual(['mage']);
  });

  test('trustedRoster 단위: 알 수 없는 영웅 id는 버린다', () => {
    const r = trustedRoster(save({ created: AFTER, selected: 'ghost' }, ['roster']), { entitledHeroes: ['ghost', 'mage', 'mage'] });
    expect(r.roster.starter).toBe('knight');
    expect(r.roster.paid).toEqual(['mage']);
  });
});

describe('영웅 상품 카탈로그', () => {
  test('hero_<id>_v1 5종 + hero_all_v1: 영웅 id가 HEROES와 일치, 웹·Play 동일가, 권한은 hero:<id>', () => {
    // 상품은 원래 다섯만(HERO_LEGACY_IDS). 소환 전용 SSR(늑대인간 족장)은 상품·권한이 없다.
    expect(HERO_LEGACY_IDS.length).toBe(5);
    expect(HERO_ORDER.length).toBe(6);
    expect(IAP_BY_ID.hero_werewolf_v1).toBeUndefined();
    for (const id of HERO_LEGACY_IDS) {
      const p = IAP_BY_ID[`hero_${id}_v1`];
      expect(Object.hasOwn(HEROES, id)).toBe(true);
      expect(p.type).toBe('non_consumable');
      expect(p.priceKRW).toBe(5900);
      expect(p.channels).toEqual(['web', 'play']);
      expect(entitlementKeys(p)).toEqual([heroEntitlementKey(id)]);
      expect(heroIdFromEntitlement(entitlementKeys(p)[0])).toBe(id);
      expect(soldOn(p, 'web') && soldOn(p, 'play')).toBe(true);
    }
    const all = IAP_BY_ID.hero_all_v1;
    expect(all.priceKRW).toBe(17900);
    expect(entitlementKeys(all).sort()).toEqual(HERO_LEGACY_IDS.map((id) => 'hero:' + id).sort());
    expect(all.priceKRW).toBeLessThan(5900 * 4); // 4명 개별 대비 할인
    // 기존 상품은 Play 전용 그대로, 보석 팩 구조는 건드리지 않았다
    expect(soldOn(IAP_BY_ID.starter_pack_v1, 'web')).toBe(false);
    expect(IAP_BY_ID.gems_300_v1.enabled).toBe(false);
    // 모든 상품의 권한 키와 보상 키가 유효(중복 id 없음)
    expect(new Set(IAP_PRODUCTS.map((p: any) => p.id)).size).toBe(IAP_PRODUCTS.length);
  });

  test('summarizeEntitlements.heroes: 활성 hero:* 권한의 영웅 id만(철회·만료·알 수 없는 id 제외, 중복 제거)', () => {
    const now = 1000;
    const e = summarizeEntitlements([
      { key: 'hero:knight', expiresAt: null }, { key: 'hero:knight', expiresAt: null }, { key: 'hero:mage', expiresAt: now + 1 },
      { key: 'hero:rogue', expiresAt: now - 1 }, { key: 'hero:ranger', expiresAt: null, revokedAt: 5 }, { key: 'hero:ghost', expiresAt: null }, { key: 'ads_removed', expiresAt: null },
    ], now);
    expect([...e.heroes].sort()).toEqual(['knight', 'mage']);
    expect(e.adsRemoved).toBe(true);
    expect(summarizeEntitlements([], now).heroes).toEqual([]);
  });
});
