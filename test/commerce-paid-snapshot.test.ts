import { expect, test } from 'bun:test';
import { assessPortOnePaidSnapshot } from '../worker/commerce-paid-snapshot';

const order = {
  order_id: 'order-fixture', player_id: 'player-fixture', sales_channel: 'WEB',
  state: 'PREPARED', catalog_version: '2026-09-23.preview-v1', sku: 'starter',
  payment_id: 'payment-fixture', amount_krw: 1200, currency: 'KRW',
  store_id: 'blade-test-store', merchant_id: 'blade-test-merchant', channel_key: 'blade-test-channel',
};
const approved = {
  storeId: 'blade-test-store', merchantId: 'blade-test-merchant', channelKey: 'blade-test-channel',
  channelType: 'TEST', pgProvider: 'INICIS_V2', pgMerchantId: 'blade-test-pg-merchant',
};
const payment = {
  status: 'PAID', version: 'V2', id: 'payment-fixture',
  merchantId: 'blade-test-merchant', storeId: 'blade-test-store', currency: 'KRW',
  channel: { type: 'TEST', key: 'blade-test-channel', pgProvider: 'INICIS_V2', pgMerchantId: 'blade-test-pg-merchant' },
  amount: { total: 1200, paid: 1200, discount: 0, cancelled: 0 },
};

function assess(o: unknown = order, p: unknown = payment, a: unknown = approved) {
  return assessPortOnePaidSnapshot(o, p, a).frozenFieldsMatch;
}

test('only matching frozen order, provider record and approved channel can pass the snapshot screen', () => {
  expect(assess()).toBe(true);
  expect(order.state).toBe('PREPARED');
  expect(payment.status).toBe('PAID');
});

test('order identity, state and legacy merchant gaps fail closed', () => {
  const cases = [
    null,
    { ...order, state: 'PAID' },
    { ...order, sales_channel: 'ANDROID' },
    { ...order, payment_id: 'different-payment' },
    { ...order, store_id: 'different-store' },
    { ...order, merchant_id: null },
    { ...order, merchant_id: '' },
    { ...order, channel_key: '' },
    { ...order, amount_krw: 0 },
    { ...order, amount_krw: 1200.5 },
    { ...order, currency: 'USD' },
  ];
  for (const candidate of cases) expect(assess(candidate)).toBe(false);
});

test('provider payment status, identity, selected channel and version mismatches fail closed', () => {
  const cases = [
    null,
    { ...payment, status: 'READY' },
    { ...payment, status: 'PARTIAL_CANCELLED' },
    { ...payment, id: 'different-payment' },
    { ...payment, merchantId: 'different-merchant' },
    { ...payment, storeId: 'different-store' },
    { ...payment, version: 'V1' },
    { ...payment, currency: 'USD' },
    { ...payment, channel: { ...payment.channel, key: undefined } },
    { ...payment, channel: { ...payment.channel, type: 'LIVE' } },
    { ...payment, channel: { ...payment.channel, pgProvider: 'KCP' } },
    { ...payment, channel: { ...payment.channel, pgMerchantId: 'different-pg-merchant' } },
  ];
  for (const candidate of cases) expect(assess(order, candidate)).toBe(false);
});

test('unapproved channel data cannot be substituted for an account binding', () => {
  const cases = [
    null,
    { ...approved, merchantId: '' },
    { ...approved, storeId: 'different-store' },
    { ...approved, channelKey: 'different-channel' },
    { ...approved, channelType: 'LIVE' },
    { ...approved, pgProvider: 'KCP' },
    { ...approved, pgMerchantId: '' },
  ];
  for (const candidate of cases) expect(assess(order, payment, candidate)).toBe(false);
});

test('a discount, partial cancellation or unsafe amount is not a full-price paid match', () => {
  const cases = [
    { ...payment, amount: null },
    { ...payment, amount: { ...payment.amount, total: 1199 } },
    { ...payment, amount: { ...payment.amount, paid: 1199 } },
    { ...payment, amount: { ...payment.amount, discount: 1 } },
    { ...payment, amount: { ...payment.amount, cancelled: 1 } },
    { ...payment, amount: { ...payment.amount, total: Number.NaN } },
    { ...payment, amount: { ...payment.amount, total: Number.MAX_SAFE_INTEGER + 1 } },
  ];
  for (const candidate of cases) expect(assess(order, candidate)).toBe(false);
});
