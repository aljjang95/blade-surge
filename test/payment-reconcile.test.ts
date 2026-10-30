import { expect, test } from 'bun:test';
import { buildSelectSql, compare, kstRange, normalizePortone, parseD1Json, portoneListUrl } from '../tools/payment-reconcile.mjs';

const row = (id: string, state: string, amount: number, extra: any = {}) => ({ payment_id: id, state, amount_krw: amount, test: 0, ...extra });
const pay = (id: string, status: string, total: number, cancelled = 0) => ({ id, status, amount: { total, cancelled } });

test('일치하는 지급·취소는 차이가 없다', () => {
  const r = compare([row('a', 'granted', 4900), row('b', 'cancelled', 1200)], normalizePortone([pay('a', 'PAID', 4900), pay('b', 'CANCELLED', 1200, 1200)]));
  expect(r.diffs).toEqual([]);
  expect(r.matched).toBe(2);
  expect(r.totals.serverGranted).toBe(4900);
  expect(r.totals.serverCancelled).toBe(1200);
  expect(r.totals.portonePaid).toBe(4900);
});

test('누락: 서버만/포트원만', () => {
  const r = compare([row('a', 'granted', 4900)], normalizePortone([pay('z', 'PAID', 9900)]));
  expect(r.diffs.map((d: any) => d.kind).sort()).toEqual(['missing_on_portone', 'missing_on_server']);
});

test('금액 불일치', () => {
  const r = compare([row('a', 'granted', 9900)], normalizePortone([pay('a', 'PAID', 4900)]));
  expect(r.diffs[0].kind).toBe('amount_mismatch');
});

test('포트원 취소가 서버에 반영 안 됨 / 서버 취소인데 포트원은 PAID', () => {
  const r = compare([row('a', 'granted', 1200), row('b', 'cancelled', 1200)], normalizePortone([pay('a', 'CANCELLED', 1200, 1200), pay('b', 'PAID', 1200)]));
  expect(r.diffs.map((d: any) => d.kind).sort()).toEqual(['cancel_not_reflected', 'cancelled_but_paid']);
});

test('지급 전 intent 인데 포트원 PAID 면 지급 누락, 테스트 건은 기본 제외', () => {
  const r = compare([row('a', 'intent', 1200), row('t', 'granted', 1200, { test: 1 })], normalizePortone([pay('a', 'PAID', 1200)]));
  expect(r.diffs.map((d: any) => d.kind)).toEqual(['missing_on_server']);
  expect(r.serverCount).toBe(1);
});

test('KST 범위·SQL·D1 JSON·URL', () => {
  const r = kstRange('2026-10-29', undefined, 0);
  expect(r.untilMs - r.fromMs).toBe(86400000);
  expect(new Date(r.fromMs).toISOString()).toBe('2026-10-28T15:00:00.000Z');
  expect(kstRange(undefined, undefined, Date.UTC(2026, 9, 30, 3)).from).toBe('2026-10-29');
  expect(buildSelectSql(1, 2)).toMatch(/^SELECT .* FROM iap_web_payments WHERE created_at >= 1 AND created_at < 2/);
  expect(buildSelectSql(1, 2)).not.toMatch(/INSERT|UPDATE|DELETE/i);
  expect(parseD1Json('[{"results":[{"payment_id":"x"}],"success":true}]')).toEqual([{ payment_id: 'x' }]);
  expect(portoneListUrl('https://c.example/', 0, 1000, 0).startsWith('https://c.example/p/portone/payments?requestBody=')).toBe(true);
});
