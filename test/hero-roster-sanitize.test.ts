import { describe, expect, test } from 'bun:test';
import { sanitizeLegacySave, HERO_GRANDFATHER_DEFAULT_MS, trustedRoster } from '../src/shared/legacy-sanitize.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { IAP_BY_ID, IAP_PRODUCTS, entitlementKeys, summarizeEntitlements, soldOn } from '../src/shared/iap-catalog.js';
import { heroEntitlementKey, heroIdFromEntitlement } from '../src/data/hero-roster.js';

const NOW = Date.UTC(2026, 10, 3);
const BEFORE = HERO_GRANDFATHER_DEFAULT_MS - 86400000, AFTER = HERO_GRANDFATHER_DEFAULT_MS + 86400000;
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

  test('정책 1(5명 소유)은 roster가 없는 옛 저장 + created가 기준 시각 이전일 때만', () => {
    const old = run(save({ created: BEFORE }, ['roster']));
    expect(old.state.roster.policy).toBe(1);
    expect([...old.state.roster.owned].sort()).toEqual([...HERO_ORDER].sort());
    expect(old.report.roster).toEqual({ policy: 1, grandfathered: true });
    // 정책 전 클라이언트가 이미 roster(정책 1)를 붙여 저장한 경우도 같은 기준
    expect(run(save({ created: BEFORE, roster: { policy: 1, owned: [...HERO_ORDER], starter: null, starterChosen: true, paid: [] } })).state.roster.policy).toBe(1);
    // 기준 시각 이후 created, 정확히 기준 시각, 미래, 숫자 아님 → 모두 정책 2 + 시작 영웅 1명(selected)
    for (const created of [AFTER, HERO_GRANDFATHER_DEFAULT_MS, NOW + 1, 'x' as any, null as any]) {
      const r = run(save({ created, selected: 'ranger' }, ['roster']));
      expect(r.state.roster.policy).toBe(2);
      expect(r.state.roster.owned).toEqual(['ranger']);
      expect(r.state.roster.starter).toBe('ranger');
    }
    // 정책 2를 주장하는 저장은 created가 옛날이어도 정책 2로 존중한다
    expect(run(save({ created: BEFORE, roster: { policy: 2, owned: ['knight'], starter: 'knight', starterChosen: true, paid: [] } })).state.roster.policy).toBe(2);
  });

  test('기준 시각은 매개변수(wrangler var)로 바꾼다', () => {
    const raw = save({ created: AFTER }, ['roster']);
    expect(run(raw).state.roster.policy).toBe(2);
    expect(run(raw, { grandfatherBeforeMs: AFTER + 86400000 }).state.roster.policy).toBe(1);
    expect(run(save({ created: BEFORE }, ['roster']), { grandfatherBeforeMs: BEFORE - 1 }).state.roster.policy).toBe(2);
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
    const r = trustedRoster(save({ created: AFTER, selected: 'ghost' }, ['roster']), { now: NOW, entitledHeroes: ['ghost', 'mage', 'mage'] });
    expect(r.roster.starter).toBe('knight');
    expect(r.roster.paid).toEqual(['mage']);
  });
});

describe('영웅 상품 카탈로그', () => {
  test('hero_<id>_v1 5종 + hero_all_v1: 영웅 id가 HEROES와 일치, 웹·Play 동일가, 권한은 hero:<id>', () => {
    expect(HERO_ORDER.length).toBe(5);
    for (const id of HERO_ORDER) {
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
    expect(entitlementKeys(all).sort()).toEqual(HERO_ORDER.map((id) => 'hero:' + id).sort());
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
