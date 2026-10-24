import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { v1Harness } from './helpers/v1-harness';
import { V1Error } from '../worker/v1/db';
import type { PortoneApi, PortonePayment } from '../worker/v1/portone';
import { reconcileWebPayments, WEB_RECONCILE_MAX } from '../worker/v1/portone';

const DAY = 86400000;
const STORE = 'store-test-0001', CHANNEL = 'channel-key-real-0001';

/** 포트원 단건 조회 가짜. 테스트가 결제별 응답을 정하고 호출 수를 센다. 실제 포트원은 호출하지 않는다. */
function fakePortone() {
  const payments = new Map<string, PortonePayment>();
  const calls: string[] = [];
  const state = { fail: false };
  const api: PortoneApi = {
    async getPayment(paymentId) {
      calls.push(paymentId);
      if (state.fail) throw new V1Error(502, 'portone-unavailable');
      const p = payments.get(paymentId);
      return p ? structuredClone(p) : null;
    },
  };
  /** intent 응답대로 결제가 PAID가 된 것처럼 등록한다(overrides로 변조). */
  const pay = (intent: any, overrides: Partial<PortonePayment> = {}) => payments.set(intent.paymentId, {
    status: 'PAID', storeId: STORE, currency: 'KRW', amount: { total: intent.totalAmount, paid: intent.totalAmount, cancelled: 0 },
    channel: { key: intent.channelKey }, customData: intent.customData, ...overrides });
  return { api, payments, calls, state, pay };
}

async function setup(env: Record<string, string> = {}) {
  const h = await v1Harness({ env: { WEB_BILLING_ENABLED: 'true', PORTONE_STORE_ID: STORE, PORTONE_CHANNEL_KEY: CHANNEL, ...env } as any });
  const pn = fakePortone();
  (h.deps as any).portoneApi = pn.api;
  const a = await h.session();
  const intent = (token: string, productId: string) => h.send('POST', '/iap/web/intent', { productId }, token);
  const complete = (token: string, paymentId: string) => h.send('POST', '/iap/web/complete', { paymentId }, token);
  const me = async (token: string) => (await h.send('GET', '/me', undefined, token)).body;
  const ctx = () => ({ env: h.env, db: h.db, deps: h.deps, now: h.now(), request: new Request('https://x/') }) as any;
  const count = (sql: string) => (h.db.sqlite.query(sql).get() as any).n as number;
  return { h, pn, a, intent, complete, me, ctx, count };
}

describe('웹 결제 스위치·채널 설정', () => {
  test('WEB_BILLING_ENABLED가 꺼져 있으면 intent·complete 모두 503이고 flags.webBilling=false', async () => {
    const h = await v1Harness({ env: { PORTONE_STORE_ID: STORE, PORTONE_CHANNEL_KEY: CHANNEL } as any });
    (h.deps as any).portoneApi = fakePortone().api;
    const a = await h.session();
    expect((await h.send('GET', '/me', undefined, a.token)).body.flags.webBilling).toBe(false);
    const r = await h.send('POST', '/iap/web/intent', { productId: 'hero_knight_v1' }, a.token);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('web-billing-disabled');
    expect((await h.send('POST', '/iap/web/complete', { paymentId: 'bsw_' + 'a'.repeat(32) }, a.token)).status).toBe(503);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM iap_web_payments').get()).toEqual({ n: 0 });
  });

  test('실채널 키가 비어 있으면 intent를 거부하고, 테스트 채널은 IAP_ALLOW_TEST일 때만 쓴다(지급은 매출 0)', async () => {
    const t = await setup({ PORTONE_CHANNEL_KEY: '', PORTONE_TEST_CHANNEL_KEY: 'channel-key-test-0001' });
    expect((await t.me(t.a.token)).flags.webBilling).toBe(false);
    expect((await t.intent(t.a.token, 'hero_knight_v1')).body.error).toBe('web-not-configured');
    const u = await setup({ PORTONE_CHANNEL_KEY: '', PORTONE_TEST_CHANNEL_KEY: 'channel-key-test-0001', IAP_ALLOW_TEST: 'true' });
    expect((await u.me(u.a.token)).flags.webBilling).toBe(true);
    const it = (await u.intent(u.a.token, 'hero_knight_v1')).body;
    expect(it.channelKey).toBe('channel-key-test-0001');
    expect(it.test).toBe(true);
    u.pn.pay(it);
    expect((await u.complete(u.a.token, it.paymentId)).body.state).toBe('granted');
    expect(u.h.db.sqlite.query('SELECT price_krw FROM iap_grants').get()).toEqual({ price_krw: 0 });
  });

  test('시크릿 바인딩도 가짜 API도 없으면 credential-route-unavailable로 닫힌다', async () => {
    const h = await v1Harness({ env: { WEB_BILLING_ENABLED: 'true', PORTONE_STORE_ID: STORE, PORTONE_CHANNEL_KEY: CHANNEL } as any });
    const a = await h.session();
    expect((await h.send('POST', '/iap/web/intent', { productId: 'hero_knight_v1' }, a.token)).body.error).toBe('credential-route-unavailable');
  });
});

describe('웹 결제 intent', () => {
  test('서버가 paymentId·금액(카탈로그 정본)·storeId·channelKey를 낸다. 클라이언트 금액 필드는 거부', async () => {
    const { h, a, intent, count } = await setup();
    const r = await intent(a.token, 'hero_mage_v1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ productId: 'hero_mage_v1', storeId: STORE, channelKey: CHANNEL, totalAmount: 5900, currency: 'KRW' });
    expect(r.body.paymentId).toMatch(/^bsw_[0-9a-f]{32}$/);
    expect(JSON.parse(r.body.customData)).toEqual({ productId: 'hero_mage_v1' });
    expect((await intent(a.token, 'hero_all_v1')).body.totalAmount).toBe(17900);
    expect((await h.send('POST', '/iap/web/intent', { productId: 'hero_mage_v1', amount: 1 }, a.token)).body.error).toBe('unknown-field');
    expect(count('SELECT COUNT(*) AS n FROM iap_web_payments')).toBe(2);
  });

  test('없는 상품·Play 전용 상품·구독은 거부', async () => {
    const { a, intent } = await setup();
    for (const id of ['nope', 'starter_pack_v1', 'monthly_card_v1', 'remove_ads_v1', 'gems_300_v1']) expect((await intent(a.token, id)).body.error).toBe('unknown-product');
  });

  test('열린 의도는 계정당 시간당 10건까지', async () => {
    const { a, intent } = await setup();
    for (let i = 0; i < 10; i++) expect((await intent(a.token, 'hero_rogue_v1')).status).toBe(200);
    expect((await intent(a.token, 'hero_rogue_v1')).body.error).toBe('too-many-intents');
  });
});

describe('웹 결제 complete — 포트원 조회 검증 후 멱등 지급', () => {
  test('PAID 정상: 영웅 권한·roster.paid 지급, 같은 paymentId 재전송은 already(한 번만 지급)', async () => {
    const { h, pn, a, intent, complete, me, count } = await setup();
    const it = (await intent(a.token, 'hero_knight_v1')).body;
    pn.pay(it);
    const r = await complete(a.token, it.paymentId);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('granted');
    expect(r.body.entitlements.heroes).toEqual(['knight']);
    expect(r.body.grants[0].productId).toBe('hero_knight_v1');
    expect(r.body.grants[0].opId).toMatch(/^iap:[0-9a-f]{64}$/);
    expect((await me(a.token)).doc.roster.paid).toEqual(['knight']);
    const again = await complete(a.token, it.paymentId);
    expect(again.body.state).toBe('already');
    expect(count("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind = 'iap:hero_knight_v1'")).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM iap_grants')).toBe(1);
    expect(h.db.sqlite.query('SELECT price_krw FROM iap_grants').get()).toEqual({ price_krw: 5900 });
    expect(h.db.sqlite.query("SELECT state FROM iap_web_payments").get()).toEqual({ state: 'granted' });
    // 첫 결제 퍼널은 서버 검증 지급에서만 기록된다.
    expect(count("SELECT COUNT(*) AS n FROM funnel_milestones WHERE step = 'first_purchase'")).toBe(1);
  });

  test('같은 paymentId 동시 complete 3건도 한 번만 지급', async () => {
    const { pn, a, intent, complete, count } = await setup();
    const it = (await intent(a.token, 'hero_ranger_v1')).body;
    pn.pay(it);
    const rs = await Promise.all([complete(a.token, it.paymentId), complete(a.token, it.paymentId), complete(a.token, it.paymentId)]);
    for (const r of rs) expect(['granted', 'already']).toContain(r.body.state);
    expect(rs.filter((r) => r.body.state === 'granted').length).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM iap_grants')).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM iap_entitlements WHERE revoked_at IS NULL")).toBe(1);
  });

  test('금액·통화·storeId·채널·customData 불일치는 지급 0, 의도는 failed + 감사 플래그', async () => {
    const { h, pn, a, intent, complete, me, count } = await setup();
    const cases: [string, Partial<PortonePayment>][] = [
      ['amount-mismatch', { amount: { total: 100, paid: 100, cancelled: 0 } }],
      ['currency-mismatch', { currency: 'USD' }],
      ['store-mismatch', { storeId: 'store-other' }],
      ['channel-mismatch', { channel: { key: 'channel-key-other' } }],
      ['custom-data-mismatch', { customData: JSON.stringify({ productId: 'hero_all_v1' }) }],
    ];
    for (const [code, override] of cases) {
      const it = (await intent(a.token, 'hero_rogue_v1')).body;
      pn.pay(it, override);
      const r = await complete(a.token, it.paymentId);
      expect(r.status).toBe(422);
      expect(r.body.error).toBe(code);
    }
    expect(count('SELECT COUNT(*) AS n FROM iap_grants')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM iap_entitlements')).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM iap_web_payments WHERE state = 'failed'")).toBe(cases.length);
    expect(count("SELECT COUNT(*) AS n FROM audit_flags WHERE kind = 'web-payment-mismatch'")).toBe(cases.length);
    expect((await me(a.token)).doc.roster.paid).toEqual([]);
    void h;
  });

  test('READY·PENDING는 pending, FAILED는 failed — 둘 다 지급 없음', async () => {
    const { pn, a, intent, complete, count } = await setup();
    const it = (await intent(a.token, 'hero_mage_v1')).body;
    pn.pay(it, { status: 'READY' });
    expect((await complete(a.token, it.paymentId)).body.state).toBe('pending');
    pn.pay(it, { status: 'VIRTUAL_ACCOUNT_ISSUED' });
    expect((await complete(a.token, it.paymentId)).body.state).toBe('pending');
    pn.pay(it, { status: 'FAILED' });
    expect((await complete(a.token, it.paymentId)).body.state).toBe('failed');
    expect(count('SELECT COUNT(*) AS n FROM iap_grants')).toBe(0);
  });

  test('남의 paymentId·없는 paymentId·형식 오류·포트원이 모르는 결제는 지급 0', async () => {
    const { pn, a, intent, complete, h, count } = await setup();
    const b = await h.session();
    const it = (await intent(a.token, 'hero_knight_v1')).body;
    pn.pay(it);
    expect((await complete(b.token, it.paymentId)).body.error).toBe('payment-unknown');
    expect((await complete(b.token, 'bsw_' + '0'.repeat(32))).body.error).toBe('payment-unknown');
    expect((await complete(b.token, 'bad id!')).body.error).toBe('payment-id');
    expect((await h.send('POST', '/iap/web/complete', { paymentId: it.paymentId, productId: 'hero_all_v1' }, a.token)).body.error).toBe('unknown-field');
    pn.payments.delete(it.paymentId);
    expect((await complete(a.token, it.paymentId)).body.error).toBe('payment-not-found');
    pn.state.fail = true;
    expect((await complete(a.token, it.paymentId)).status).toBe(502);
    expect(count('SELECT COUNT(*) AS n FROM iap_grants')).toBe(0);
  });

  test('hero_all_v1: 다섯 권한을 한 번에 지급하고 이후 어떤 영웅 상품도 not-eligible, 개별 보유 뒤 전원 구매는 가능', async () => {
    const t = await setup();
    const k = (await t.intent(t.a.token, 'hero_knight_v1')).body;
    t.pn.pay(k);
    await t.complete(t.a.token, k.paymentId);
    // 이미 보유한 영웅의 같은 상품은 거부, 전원 해금은 아직 열려 있다.
    expect((await t.intent(t.a.token, 'hero_knight_v1')).body.error).toBe('not-eligible');
    const all = (await t.intent(t.a.token, 'hero_all_v1')).body;
    t.pn.pay(all);
    const r = await t.complete(t.a.token, all.paymentId);
    expect(r.body.state).toBe('granted');
    expect([...r.body.entitlements.heroes].sort()).toEqual(['barbarian', 'knight', 'mage', 'ranger', 'rogue']);
    expect(((await t.me(t.a.token)).doc.roster.paid as string[]).slice().sort()).toEqual(['barbarian', 'knight', 'mage', 'ranger', 'rogue']);
    expect((await t.intent(t.a.token, 'hero_all_v1')).body.error).toBe('not-eligible');
    expect((await t.intent(t.a.token, 'hero_mage_v1')).body.error).toBe('not-eligible');
    const cat = await t.h.send('GET', '/iap/catalog', undefined, t.a.token);
    void cat;
  });
});

describe('웹 결제 취소 회수', () => {
  test('complete 때 CANCELLED가 보이면 권한 철회 + 역분개 + roster.paid 회수, 이후 재지급 불가', async () => {
    const { h, pn, a, intent, complete, me, count } = await setup();
    const it = (await intent(a.token, 'hero_all_v1')).body;
    pn.pay(it);
    await complete(a.token, it.paymentId);
    expect((await me(a.token)).doc.roster.paid.length).toBe(5);
    pn.pay(it, { status: 'CANCELLED', amount: { total: 17900, paid: 0, cancelled: 17900 } });
    const r = await complete(a.token, it.paymentId);
    expect(r.body.state).toBe('cancelled');
    expect(r.body.entitlements.heroes).toEqual([]);
    expect(r.body.reversals).toHaveLength(1);
    expect((await me(a.token)).doc.roster.paid).toEqual([]);
    expect(count('SELECT COUNT(*) AS n FROM iap_entitlements WHERE revoked_at IS NULL')).toBe(0);
    expect(h.db.sqlite.query('SELECT state FROM iap_web_payments').get()).toEqual({ state: 'cancelled' });
    // PAID로 되돌아온 것처럼 속여도(조회 응답 변조) 취소된 결제는 다시 지급하지 않는다.
    pn.pay(it);
    expect((await complete(a.token, it.paymentId)).body.state).toBe('cancelled');
    expect(count('SELECT COUNT(*) AS n FROM iap_entitlements WHERE revoked_at IS NULL')).toBe(0);
  });

  test('PARTIAL_CANCELLED도 회수한다. 개별 영웅 + 전원 중 전원만 취소되면 개별 권한은 남는다', async () => {
    const t = await setup();
    const k = (await t.intent(t.a.token, 'hero_knight_v1')).body;
    t.pn.pay(k);
    await t.complete(t.a.token, k.paymentId);
    const all = (await t.intent(t.a.token, 'hero_all_v1')).body;
    t.pn.pay(all);
    await t.complete(t.a.token, all.paymentId);
    t.pn.pay(all, { status: 'PARTIAL_CANCELLED', amount: { total: 17900, paid: 5000, cancelled: 12900 } });
    const r = await t.complete(t.a.token, all.paymentId);
    expect(r.body.state).toBe('cancelled');
    expect(r.body.entitlements.heroes).toEqual(['knight']);
    expect((await t.me(t.a.token)).doc.roster.paid).toEqual(['knight']);
  });

  test('시간당 크론: 최근 30일 지급분의 취소를 회수하고, 오래된 지급분·호출 상한을 지킨다', async () => {
    const { h, pn, a, intent, complete, me, ctx, count } = await setup();
    const it = (await intent(a.token, 'hero_barbarian_v1')).body;
    pn.pay(it);
    await complete(a.token, it.paymentId);
    h.advance(50 * 60000);
    pn.pay(it, { status: 'CANCELLED', amount: { total: 5900, paid: 0, cancelled: 5900 } });
    const r = await reconcileWebPayments(ctx());
    expect(r).toMatchObject({ checked: 1, reversed: 1, failed: 0 });
    expect((await me(a.token)).doc.roster.paid).toEqual([]);
    expect(count('SELECT COUNT(*) AS n FROM iap_entitlements WHERE revoked_at IS NULL')).toBe(0);
    // 취소 처리된 건은 더 조회하지 않는다.
    pn.calls.length = 0;
    await reconcileWebPayments(ctx());
    expect(pn.calls).toHaveLength(0);
    // 30일이 지난 지급분은 대사 대상이 아니다.
    const b = await h.session();
    const old = (await intent(b.token, 'hero_mage_v1')).body;
    pn.pay(old);
    await complete(b.token, old.paymentId);
    h.advance(31 * DAY);
    pn.calls.length = 0;
    await reconcileWebPayments(ctx());
    expect(pn.calls).toHaveLength(0);
  });

  test('크론 호출 수 상한과 항목별 실패 격리', async () => {
    const { h, pn, a, ctx } = await setup();
    // 지급된 웹 결제 N+5건(원장 행만 직접 만든다: 상한은 조회 수에만 걸린다).
    for (let i = 0; i < WEB_RECONCILE_MAX + 5; i++) {
      const id = 'bsw_' + i.toString(16).padStart(32, '0');
      h.db.sqlite.query(`INSERT INTO iap_web_payments(payment_id, account_id, product_id, amount_krw, store_id, channel_key, test, state, created_at, updated_at, granted_at)
        VALUES (?, ?, 'hero_rogue_v1', 5900, ?, ?, 0, 'granted', ?, ?, ?)`).run(id, a.accountId, STORE, CHANNEL, h.now(), h.now(), h.now());
      pn.payments.set(id, { status: 'READY' });
    }
    h.advance(3600000);
    const r = await reconcileWebPayments(ctx());
    expect(r.checked).toBe(WEB_RECONCILE_MAX);
    expect(pn.calls).toHaveLength(WEB_RECONCILE_MAX);
    // 다음 시간에는 아직 안 본 건부터 돈다(가장 오래 안 본 순서).
    h.advance(3600000);
    pn.calls.length = 0;
    await reconcileWebPayments(ctx());
    expect(new Set(pn.calls).size).toBe(WEB_RECONCILE_MAX);
    expect(pn.calls.some((id) => id === 'bsw_' + (WEB_RECONCILE_MAX + 4).toString(16).padStart(32, '0'))).toBe(true);
    pn.state.fail = true;
    const warn = console.warn; console.warn = () => {};
    try { const f = await reconcileWebPayments(ctx()); expect(f.failed).toBe(f.checked); } finally { console.warn = warn; }
  });

  test('크론: complete가 오지 않은 결제(탭 종료·리다이렉트 실패)도 PAID면 지급, 오래된 의도는 조회하지 않음', async () => {
    const { h, pn, a, intent, me, ctx, count } = await setup();
    const it = (await intent(a.token, 'hero_ranger_v1')).body;
    pn.pay(it);
    // 2분이 지나기 전에는 건드리지 않는다(사용자가 방금 결제창을 연 중).
    expect((await reconcileWebPayments(ctx())).checked).toBe(0);
    h.advance(3 * 60000);
    const r = await reconcileWebPayments(ctx());
    expect(r).toMatchObject({ checked: 1, granted: 1 });
    expect((await me(a.token)).doc.roster.paid).toEqual(['ranger']);
    // 결제되지 않은 의도는 48시간까지만 본다.
    const idle = (await intent(a.token, 'hero_mage_v1')).body;
    void idle;
    h.advance(3 * DAY);
    pn.calls.length = 0;
    await reconcileWebPayments(ctx());
    expect(pn.calls.filter((id) => id === idle.paymentId)).toHaveLength(0);
    expect(count("SELECT COUNT(*) AS n FROM iap_grants")).toBe(1);
  });

  test('판매 스위치를 꺼도 취소 회수 크론은 돈다', async () => {
    const { h, pn, a, intent, complete, ctx } = await setup();
    const it = (await intent(a.token, 'hero_knight_v1')).body;
    pn.pay(it);
    await complete(a.token, it.paymentId);
    (h.env as any).WEB_BILLING_ENABLED = 'false';
    h.advance(3600000);
    pn.pay(it, { status: 'CANCELLED', amount: { total: 5900, paid: 0, cancelled: 5900 } });
    expect((await reconcileWebPayments(ctx())).reversed).toBe(1);
  });
});

describe('임포트: 영웅 소유는 서버 권한이 정본', () => {
  const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/saves/mid.json', import.meta.url), 'utf8'));
  test('기준 시각 이전 옛 저장은 정책 1(5명), 이후면 정책 2 + 시작 영웅 1명이고 forged paid는 버린다', async () => {
    const old = await setup();
    const r1 = await old.h.send('POST', '/import', { installId: crypto.randomUUID(), save: fixture() }, old.a.token);
    expect(r1.body.doc.roster.policy).toBe(1);
    expect(r1.body.doc.roster.owned.length).toBe(5);
    expect(r1.body.doc.roster.paid).toEqual([]);
    // 같은 저장이어도 운영이 기준 시각을 앞당기면(= 이 저장은 정책 이후 생성) 정책 2
    const next = await setup({ HERO_GRANDFATHER_BEFORE_MS: '1700000000000' });
    const forged = { ...fixture(), selected: 'mage', roster: { policy: 2, owned: ['mage', 'knight'], starter: 'mage', starterChosen: true, paid: ['knight', 'rogue', 'ranger'] } };
    const r2 = await next.h.send('POST', '/import', { installId: crypto.randomUUID(), save: forged }, next.a.token);
    expect(r2.body.status).toBe('shadow');
    expect(r2.body.doc.roster.policy).toBe(2);
    expect(r2.body.doc.roster.paid).toEqual([]);
    expect(r2.body.doc.roster.starter).toBe('mage');
    expect(r2.body.doc.roster.owned).toEqual(['mage']);
    // 구매하면 서버 권한이 paid가 되고, 그림자 스냅샷(재정화)을 거쳐도 유지된다.
    const k = (await next.intent(next.a.token, 'hero_knight_v1')).body;
    next.pn.pay(k);
    await next.complete(next.a.token, k.paymentId);
    const snap = await next.h.send('POST', '/shadow/snapshot', { cid: 'snap-0001-abcd', save: forged }, next.a.token);
    expect(snap.status).toBe(200);
    expect((await next.me(next.a.token)).doc.roster).toMatchObject({ policy: 2, paid: ['knight'], starter: 'mage', owned: ['mage'] });
  });
});

describe('Play 흐름 하위호환', () => {
  test('hero 상품도 Play intent는 같은 형식이고 Play 전용 상품은 웹에서 안 보인다', async () => {
    const h = await v1Harness({ env: { IAP_ENABLED: 'true' } as any });
    (h.deps as any).playApi = {};
    const a = await h.session();
    const cat = await h.send('GET', '/iap/catalog', undefined, a.token);
    const byId = Object.fromEntries(cat.body.products.map((p: any) => [p.id, p]));
    expect(byId.hero_knight_v1.channels).toEqual(['web', 'play']);
    expect(byId.hero_knight_v1.priceKRW).toBe(5900);
    expect(byId.hero_all_v1.priceKRW).toBe(17900);
    expect(byId.starter_pack_v1.channels).toEqual(['play']);
    const it = await h.send('POST', '/iap/intent', { productId: 'hero_knight_v1' }, a.token);
    expect(it.body.playType).toBe('inapp');
    expect(it.body.obfuscatedAccountId).toMatch(/^[0-9a-f]{48}$/);
  });
});
