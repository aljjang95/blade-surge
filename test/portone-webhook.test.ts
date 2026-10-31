import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import type { PortoneApi, PortonePayment } from '../worker/v1/portone';
import { methodMismatch, paidMethod } from '../worker/v1/portone';
import { verifyWebhookSignature, webhookPaymentId, WEBHOOK_TOLERANCE_MS } from '../worker/v1/portone-webhook';

// 포트원 웹훅(F)·실결제 수단 대조(G). 실제 포트원은 호출하지 않는다(단건 조회 가짜).
const STORE = 'store-test-0001', CHANNEL = 'channel-key-real-0001';
const KEY: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(32));
const SECRET = 'whsec_' + Buffer.from(KEY).toString('base64');

async function sign(body: string, id: string, tsSec: number, key: Uint8Array<ArrayBuffer> = KEY): Promise<string> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${tsSec}.${body}`));
  return 'v1,' + Buffer.from(mac).toString('base64');
}

function fakePortone() {
  const payments = new Map<string, PortonePayment>();
  const calls: string[] = [];
  const api: PortoneApi = { async getPayment(id) { calls.push(id); const p = payments.get(id); return p ? structuredClone(p) : null; } };
  const pay = (intent: any, overrides: Partial<PortonePayment> = {}) => payments.set(intent.paymentId, {
    status: 'PAID', storeId: STORE, currency: 'KRW', amount: { total: intent.totalAmount, paid: intent.totalAmount, cancelled: 0 },
    channel: { key: intent.channelKey }, customData: intent.customData,
    method: intent.payMethod === 'EASY_PAY' ? { type: 'PaymentMethodEasyPay', provider: intent.easyPay?.easyPayProvider } : { type: 'PaymentMethodCard' }, ...overrides });
  return { api, payments, calls, pay };
}

async function setup(env: Record<string, string> = {}) {
  const h = await v1Harness({ env: { WEB_BILLING_ENABLED: 'true', PORTONE_STORE_ID: STORE, PORTONE_CHANNEL_KEY: CHANNEL, V1_SERVER_AUTHORITY_PERCENT: '100',
    PORTONE_WEBHOOK_SECRET: SECRET, WEB_PAY_METHODS: 'CARD,KAKAOPAY', ...env } as any });
  const pn = fakePortone();
  (h.deps as any).portoneApi = pn.api;
  const a = await h.session();
  let seq = 0;
  /** 포트원 서버처럼 서명한 웹훅(Origin 없음). 같은 id로 다시 보내면 재전송이다. */
  const hook = async (data: unknown, opts: { id?: string; ts?: number; signature?: string } = {}) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const id = opts.id ?? 'msg_' + (++seq), ts = opts.ts ?? Math.floor(h.now() / 1000);
    const signature = opts.signature ?? await sign(body, id, ts);
    return h.send('POST', '/iap/web/webhook', body, undefined, { origin: '', 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': signature });
  };
  const paid = (paymentId: string) => ({ type: 'Transaction.Paid', timestamp: new Date(h.now()).toISOString(), data: { paymentId, storeId: STORE, transactionId: 'tx-1' } });
  const cancelled = (paymentId: string) => ({ type: 'Transaction.Cancelled', timestamp: new Date(h.now()).toISOString(), data: { paymentId, storeId: STORE, transactionId: 'tx-1', cancellationId: 'c-1' } });
  const intent = async (productId = 'remove_ads_v1', method?: string) => (await h.send('POST', '/iap/web/intent', method ? { productId, method } : { productId }, a.token)).body;
  const count = (sql: string, ...b: any[]) => (h.db.sqlite.query(sql).get(...b) as any).n as number;
  const ents = () => count("SELECT COUNT(*) AS n FROM iap_entitlements WHERE account_id = ? AND revoked_at IS NULL", a.accountId);
  return { h, pn, a, hook, paid, cancelled, intent, count, ents };
}

describe('포트원 웹훅 서명(Standard Webhooks)', () => {
  test('정상 서명은 통과하고, 다른 키·변조 본문·허용오차 밖 시각·형식 오류는 거부한다', async () => {
    const now = 1_800_000_000_000, ts = now / 1000, body = '{"a":1}';
    const headers = (sig: string, t = ts, id = 'msg_1') => new Headers({ 'webhook-id': id, 'webhook-timestamp': String(t), 'webhook-signature': sig });
    expect(await verifyWebhookSignature(SECRET, headers(await sign(body, 'msg_1', ts)), body, now)).toBe('ok');
    // 키 교체 중 여러 서명 — 하나라도 맞으면 통과
    expect(await verifyWebhookSignature(SECRET, headers('v1,' + 'A'.repeat(43) + '= ' + await sign(body, 'msg_1', ts)), body, now)).toBe('ok');
    expect(await verifyWebhookSignature(SECRET, headers(await sign(body, 'msg_1', ts, new Uint8Array(32))), body, now)).toBe('bad-signature');
    expect(await verifyWebhookSignature(SECRET, headers(await sign(body, 'msg_1', ts)), '{"a":2}', now)).toBe('bad-signature');
    expect(await verifyWebhookSignature(SECRET, headers(await sign(body, 'msg_2', ts)), body, now)).toBe('bad-signature');
    const old = ts - WEBHOOK_TOLERANCE_MS / 1000 - 1;
    expect(await verifyWebhookSignature(SECRET, headers(await sign(body, 'msg_1', old), old), body, now)).toBe('stale');
    expect(await verifyWebhookSignature(SECRET, headers('v2,' + (await sign(body, 'msg_1', ts)).slice(3)), body, now)).toBe('bad-signature');
    expect(await verifyWebhookSignature(SECRET, new Headers(), body, now)).toBe('bad-signature');
    expect(await verifyWebhookSignature('whsec_!!!', headers(await sign(body, 'msg_1', ts)), body, now)).toBe('bad-secret');
  });

  test('본문에서 결제 알림의 paymentId만 꺼낸다(새·옛 형식), 결제 아닌 알림은 무시', () => {
    expect(webhookPaymentId({ type: 'Transaction.Paid', data: { paymentId: 'bsw_' + 'a'.repeat(32) } })).toBe('bsw_' + 'a'.repeat(32));
    expect(webhookPaymentId({ tx_id: 't', payment_id: 'bsw_' + 'b'.repeat(32), status: 'Paid' })).toBe('bsw_' + 'b'.repeat(32));
    expect(webhookPaymentId({ type: 'BillingKey.Issued', data: { paymentId: 'bsw_' + 'a'.repeat(32) } })).toBeNull();
    expect(webhookPaymentId({ type: 'Transaction.Paid', data: { paymentId: '../x' } })).toBeNull();
  });
});

describe('POST /iap/web/webhook', () => {
  test('시크릿이 없으면 503으로 닫히고 아무것도 조회·지급하지 않는다', async () => {
    const t = await setup({ PORTONE_WEBHOOK_SECRET: '' });
    const it = await t.intent(); t.pn.pay(it);
    const r = await t.hook(t.paid(it.paymentId));
    expect(r.status).toBe(503);
    expect(r.body.outcome).toBe('webhook-not-configured');
    expect(t.pn.calls).toEqual([]);
    expect(t.ents()).toBe(0);
  });

  test('정상: 서명된 Transaction.Paid → 포트원 재조회 → 지급, 재전송·동시 도착은 한 번만 지급', async () => {
    const t = await setup();
    const it = await t.intent(); t.pn.pay(it);
    const r = await t.hook(t.paid(it.paymentId), { id: 'msg_paid' });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('granted');
    expect(t.ents()).toBe(1);
    // 같은 알림 재전송 + 동시 두 건
    const again = await Promise.all([t.hook(t.paid(it.paymentId), { id: 'msg_paid' }), t.hook(t.paid(it.paymentId), { id: 'msg_paid' })]);
    for (const x of again) { expect(x.status).toBe(200); expect(x.body.outcome).toBe('already'); }
    expect(t.count("SELECT COUNT(*) AS n FROM iap_grants WHERE account_id = ?", t.a.accountId)).toBe(1);
    expect(t.ents()).toBe(1);
    expect(t.count("SELECT COUNT(*) AS n FROM iap_web_payments WHERE state = 'granted'")).toBe(1);
  });

  test('본문은 믿지 않는다: 알림이 Paid여도 포트원 조회가 PAID가 아니면 지급하지 않는다', async () => {
    const t = await setup();
    const it = await t.intent(); t.pn.pay(it, { status: 'READY' });
    const r = await t.hook(t.paid(it.paymentId));
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('pending');
    expect(t.ents()).toBe(0);
  });

  test('서명 불일치·오래된 시각은 401이고 조회·지급하지 않는다', async () => {
    const t = await setup();
    const it = await t.intent(); t.pn.pay(it);
    const forged = await t.hook(t.paid(it.paymentId), { signature: await sign('{}', 'msg_x', Math.floor(t.h.now() / 1000)) });
    expect(forged.status).toBe(401);
    const stale = Math.floor((t.h.now() - WEBHOOK_TOLERANCE_MS) / 1000) - 5;
    const old = await t.hook(t.paid(it.paymentId), { ts: stale });
    expect(old.status).toBe(401);
    expect(old.body.outcome).toBe('stale');
    expect(t.pn.calls).toEqual([]);
    expect(t.ents()).toBe(0);
  });

  test('취소 알림 → 재조회가 CANCELLED면 권한 회수(역분개), 판매 스위치가 꺼져 있어도 회수한다', async () => {
    const t = await setup();
    const it = await t.intent(); t.pn.pay(it);
    expect((await t.hook(t.paid(it.paymentId))).body.outcome).toBe('granted');
    expect(t.ents()).toBe(1);
    (t.h.env as any).WEB_BILLING_ENABLED = 'false';
    t.pn.pay(it, { status: 'CANCELLED', amount: { total: it.totalAmount, paid: it.totalAmount, cancelled: it.totalAmount } });
    const r = await t.hook(t.cancelled(it.paymentId));
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('cancelled');
    expect(t.ents()).toBe(0);
    expect(t.count("SELECT COUNT(*) AS n FROM iap_web_payments WHERE state = 'cancelled'")).toBe(1);
    // 취소 재전송도 무해
    expect((await t.hook(t.cancelled(it.paymentId))).body.outcome).toBe('cancelled');
    expect(t.ents()).toBe(0);
  });

  test('이 서버가 발급하지 않은 paymentId·결제 아닌 알림은 200으로 무시(재전송 중단), 조회하지 않는다', async () => {
    const t = await setup();
    expect((await t.hook(t.paid('bsw_' + 'f'.repeat(32)))).body.outcome).toBe('unknown-payment');
    expect((await t.hook({ type: 'BillingKey.Ready', data: {} })).body.outcome).toBe('ignored');
    expect((await t.hook('not json')).body.outcome).toBe('malformed');
    expect(t.pn.calls).toEqual([]);
  });

  test('포트원 조회가 아직 없으면 503으로 재전송을 받는다', async () => {
    const t = await setup();
    const it = await t.intent();
    const r = await t.hook(t.paid(it.paymentId));
    expect(r.status).toBe(503);
    expect(t.ents()).toBe(0);
  });
});

describe('실결제 수단 method.type 대조(G)', () => {
  test('수단 판정: 카드·허용 간편결제만 인정, 모르는 수단·정보 없음은 불일치', () => {
    expect(paidMethod({ status: 'PAID', method: { type: 'PaymentMethodCard' } })).toBe('CARD');
    expect(paidMethod({ status: 'PAID', method: { type: 'PaymentMethodEasyPay', provider: 'KAKAOPAY' } })).toBe('KAKAOPAY');
    expect(paidMethod({ status: 'PAID', method: { type: 'PaymentMethodEasyPay', provider: 'PAYCO' } })).toBeNull();
    expect(paidMethod({ status: 'PAID', method: { type: 'PaymentMethodVirtualAccount' } })).toBeNull();
    expect(methodMismatch({ status: 'PAID' }, null)).toBe(true);
    expect(methodMismatch({ status: 'PAID', method: { type: 'PaymentMethodCard' } }, null)).toBe(false);
    expect(methodMismatch({ status: 'PAID', method: { type: 'PaymentMethodCard' } }, 'KAKAOPAY')).toBe(true);
  });

  test('카드로 의도했는데 다른 수단(가상계좌)으로 결제되면 지급은 하고(금액은 대조됨) 감사 플래그를 한 번만 남긴다', async () => {
    const t = await setup();
    const it = await t.intent();
    expect(t.count("SELECT COUNT(*) AS n FROM iap_web_pay_methods WHERE payment_id = ? AND pay_method = 'CARD'", it.paymentId)).toBe(1);
    t.pn.pay(it, { method: { type: 'PaymentMethodVirtualAccount' } });
    const r = await t.h.send('POST', '/iap/web/complete', { paymentId: it.paymentId }, t.a.token);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('granted');
    expect(t.ents()).toBe(1);
    expect((await t.hook(t.paid(it.paymentId))).body.outcome).toBe('already');
    expect(t.count("SELECT COUNT(*) AS n FROM audit_flags WHERE kind = 'web-method-unknown'")).toBe(1);
  });

  test('카카오페이로 의도했는데 카드로 결제되면 web-method-mismatch 플래그, 같은 수단이면 플래그 없음(웹훅 경로)', async () => {
    const t = await setup();
    const kakao = await t.intent('remove_ads_v1', 'KAKAOPAY');
    expect(kakao.payMethod).toBe('EASY_PAY');
    t.pn.pay(kakao, { method: { type: 'PaymentMethodCard' } });
    expect((await t.hook(t.paid(kakao.paymentId))).body.outcome).toBe('granted');
    expect(t.count("SELECT COUNT(*) AS n FROM audit_flags WHERE kind = 'web-method-mismatch'")).toBe(1);
    const u = await setup();
    const ok = await u.intent('starter_pack_v1', 'KAKAOPAY');
    u.pn.pay(ok);
    expect((await u.hook(u.paid(ok.paymentId))).body.outcome).toBe('granted');
    expect(u.count("SELECT COUNT(*) AS n FROM audit_flags WHERE kind LIKE 'web-method%'")).toBe(0);
  });

  test('간편결제 provider가 빠진 PAID도 지급한다(오탐으로 결제만 되고 지급이 막히지 않게), 플래그만 남김', async () => {
    const t = await setup();
    const it = await t.intent('remove_ads_v1', 'KAKAOPAY'); t.pn.pay(it, { method: { type: 'PaymentMethodEasyPay' } });
    const r = await t.h.send('POST', '/iap/web/complete', { paymentId: it.paymentId }, t.a.token);
    expect(r.body.state).toBe('granted');
    expect(t.count("SELECT COUNT(*) AS n FROM audit_flags WHERE kind = 'web-method-unknown'")).toBe(1);
  });

  test('FAILED 알림으로 failed가 된 행이 뒤에 PAID로 확인되면 지급하고 granted로 바꿔 이후 취소 대사 대상에 남긴다', async () => {
    const t = await setup();
    const it = await t.intent();
    t.pn.pay(it, { status: 'FAILED' });
    expect((await t.hook(t.paid(it.paymentId))).body.outcome).toBe('failed');
    t.pn.pay(it);
    expect((await t.hook(t.paid(it.paymentId))).body.outcome).toBe('granted');
    expect(t.count("SELECT COUNT(*) AS n FROM iap_web_payments WHERE state = 'granted'")).toBe(1);
  });
});
