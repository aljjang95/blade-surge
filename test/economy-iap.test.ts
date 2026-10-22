import { expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const make = () => new Economy({ storage: memory(), now: () => 1_000_000 });
const starter = { opId: 'g1', productId: 'starter_pack_v1', rewards: { ssrTicket: 1, gems: 1000, gold: 50000 } };

test('기본은 결제 없음이고 새 세이브 필드가 있다', () => {
  const eco = make();
  expect(eco.paymentAvailable()).toBe(false);
  expect(eco.s.iapApplied).toEqual([]); expect(eco.s.adsRemoved).toBe(false);
  expect(eco.purchase('starter')).toEqual({ ok: false, reason: 'payment-unavailable' });
  expect(eco.buyPass()).toEqual({ ok: false, reason: 'payment-unavailable' });
});

test('같은 grant를 두 번 적용해도 보상은 1회만 들어간다', () => {
  const eco = make(), gems = eco.s.gems, gold = eco.s.gold, ssr = eco.s.ssrTickets;
  const first = eco.applyIapState({ grants: [starter] });
  expect(first?.some((g: any) => g.k === 'gems' && g.n === 1000)).toBe(true);
  expect(eco.s.gems).toBe(gems + 1000); expect(eco.s.gold).toBe(gold + 50000); expect(eco.s.ssrTickets).toBe(ssr + 1);
  expect(eco.applyIapState({ grants: [starter] })).toEqual([]);
  expect(eco.s.gems).toBe(gems + 1000);
  expect(eco.s.iapApplied).toEqual(['g1']);
  expect(eco.s.purchases).toContain('starter');
});

test('VIP 보정 없이 지급하고 알 수 없는 보상 키·음수·소수는 무시한다', () => {
  const eco = make(); eco.s.vipUntil = 9e15; const gold = eco.s.gold;
  eco.applyIapState({ grants: [{ opId: 'g2', rewards: { gold: 1000, vipDays: 30, gems: -5, tickets: 1.5, evil: 9 } }] });
  expect(eco.s.gold).toBe(gold + 1000); expect(eco.s.vipUntil).toBe(9e15);
});

test('reversal은 해당 보상만큼 빼되 0 아래로 내리지 않고 한 번만 적용한다', () => {
  const eco = make(); eco.s.gems = 300;
  eco.applyIapState({ reversals: [{ opId: 'r1', grantId: 'g1', rewards: { gems: 1000, gold: 10 } }] });
  expect(eco.s.gems).toBe(0);
  eco.s.gems = 500;
  eco.applyIapState({ reversals: [{ opId: 'r1', grantId: 'g1', rewards: { gems: 1000 } }] });
  expect(eco.s.gems).toBe(500);
});

test('entitlements가 월정액·패스 프리미엄·광고 제거를 덮어쓰고 해제도 반영한다', () => {
  const eco = make();
  eco.applyIapState({ entitlements: { adsRemoved: true, monthlyUntil: 5_000_000, passPremium: true } });
  expect(eco.s.adsRemoved).toBe(true); expect(eco.s.monthlyUntil).toBe(5_000_000); expect(eco.s.pass.premium).toBe(true);
  eco.applyIapState({ entitlements: { adsRemoved: false, monthlyUntil: 0, passPremium: false } });
  expect(eco.s.adsRemoved).toBe(false); expect(eco.s.monthlyUntil).toBe(0); expect(eco.s.pass.premium).toBe(false);
});

test('저장 실패면 상태를 롤백하고 null을 돌려준다(다음 sync에서 다시 적용)', () => {
  const eco = make(); const gems = eco.s.gems;
  eco.save = () => false;
  expect(eco.applyIapState({ grants: [starter], entitlements: { adsRemoved: true } })).toBeNull();
  expect(eco.s.gems).toBe(gems); expect(eco.s.iapApplied).toEqual([]); expect(eco.s.adsRemoved).toBe(false);
});

test('적용 기록은 최근 300개만 남기고 손상 세이브는 안전하게 보정된다', () => {
  const eco = make();
  eco.applyIapState({ grants: Array.from({ length: 305 }, (_, i) => ({ opId: 'op' + i, rewards: { gold: 1 } })) });
  expect(eco.s.iapApplied.length).toBe(300); expect(eco.s.iapApplied.at(-1)).toBe('op304');
  const raw = JSON.parse(JSON.stringify(eco.s)); raw.iapApplied = [1, null, 'ok', 'ok', { a: 1 }]; raw.adsRemoved = 'yes';
  const migrated = eco.migrate(raw);
  expect(migrated.iapApplied).toEqual(['ok']); expect(migrated.adsRemoved).toBe(false);
  delete raw.iapApplied; delete raw.adsRemoved;
  const legacy = eco.migrate(raw);
  expect(legacy.iapApplied).toEqual([]); expect(legacy.adsRemoved).toBe(false);
});

test('결제가 연결되면 purchase()·buyPass()는 직접 지급하지 않고 use-billing을 돌려준다', () => {
  const eco = make(); eco.setBilling({ available: () => true });
  expect(eco.paymentAvailable()).toBe(true);
  const before = JSON.stringify(eco.s);
  expect(eco.purchase('starter')).toEqual({ ok: false, reason: 'use-billing' });
  expect(eco.buyPass()).toEqual({ ok: false, reason: 'use-billing' });
  expect(JSON.stringify(eco.s)).toBe(before);
  // 서비스가 사용 불가로 바뀌면 다시 기본(결제 없음)으로 돌아간다.
  eco.setBilling({ available: () => false });
  expect(eco.paymentAvailable()).toBe(false);
});
