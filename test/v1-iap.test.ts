import { describe, expect, test } from 'bun:test';
import { v1Harness, T0 } from './helpers/v1-harness';
import { V1Error } from '../worker/v1/db';
import type { PlayApi, ProductPurchase, SubscriptionPurchase, VoidedPurchase } from '../worker/v1/play';
import { reconcileVoided } from '../worker/v1/iap';
import { funnelReport } from '../worker/v1/funnel';
import { sanitizeLegacySave } from '../src/shared/legacy-sanitize.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { IAP_PRODUCTS, SEASONS } from '../src/shared/iap-catalog.js';

const DAY = 86400000;

/** Play Developer API 가짜. 토큰별 상태를 테스트가 정하고, ack/consume 호출을 기록한다. */
function fakePlay() {
  const products = new Map<string, ProductPurchase>(), subs = new Map<string, SubscriptionPurchase>();
  const calls = { ack: [] as string[], consume: [] as string[], subAck: [] as string[], get: 0 };
  const state = { voided: [] as VoidedPurchase[], failAck: false };
  const notFound = () => { throw new V1Error(422, 'purchase-not-found'); };
  const api: PlayApi = {
    async productPurchase(token) { calls.get++; const p = products.get(token); return p ? { ...p } : notFound(); },
    async subscriptionPurchase(token) { calls.get++; const s = subs.get(token); return s ? { ...s } : notFound(); },
    async acknowledgeProduct(_id, token) { if (state.failAck) throw new V1Error(503, 'play-unavailable'); calls.ack.push(token); const p = products.get(token); if (p) p.acknowledged = true; },
    async consumeProduct(_id, token) { if (state.failAck) throw new V1Error(503, 'play-unavailable'); calls.consume.push(token); const p = products.get(token); if (p) { p.consumed = true; p.acknowledged = true; } },
    async acknowledgeSubscription(_id, token) { calls.subAck.push(token); const s = subs.get(token); if (s) s.acknowledged = true; },
    async voided() { return state.voided; },
  };
  const product = (token: string, productId: string, obf: string | null, extra: Partial<ProductPurchase> = {}) => products.set(token, {
    productId, quantity: 1, refundableQuantity: 1, purchaseState: 'PURCHASED', consumed: false, acknowledged: false, obfuscatedAccountId: obf, orderId: 'GPA.' + token.slice(-6), test: false, ...extra });
  const sub = (token: string, obf: string | null, extra: Partial<SubscriptionPurchase> = {}) => subs.set(token, {
    productId: 'monthly_card_v1', basePlanId: 'monthly', state: 'SUBSCRIPTION_STATE_ACTIVE', expiryTime: T0 + 30 * DAY, acknowledged: false,
    obfuscatedAccountId: obf, latestOrderId: 'GPA.1111-0000', linkedPurchaseToken: null, test: false, ...extra });
  return { api, products, subs, calls, state, product, sub };
}

async function setup(env: Record<string, string> = {}) {
  const h = await v1Harness({ env: { IAP_ENABLED: 'true', ...env } as any });
  const play = fakePlay();
  (h.deps as any).playApi = play.api;
  const a = await h.session();
  const intent = async (token: string, productId: string) => h.send('POST', '/iap/intent', { productId }, token);
  const verify = (token: string, productId: string, purchaseToken: string) => h.send('POST', '/iap/verify', { productId, purchaseToken }, token);
  const me = async (token: string) => (await h.send('GET', '/me', undefined, token)).body;
  return { h, play, a, intent, verify, me };
}
const TOK = (n: string) => 'tok-' + n.padEnd(24, 'x');
const ctxOf = (h: Awaited<ReturnType<typeof v1Harness>>) => ({ env: h.env, db: h.db, deps: h.deps, now: h.now(), request: new Request('https://x/') }) as any;

describe('BM D10a 서버 영수증 검증 → 지급', () => {
  test('결제가 꺼져 있으면 카탈로그는 billing=false, 의도·검증은 503', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const cat = await h.send('GET', '/iap/catalog', undefined, a.token);
    expect(cat.body.billing).toBe(false);
    expect(cat.body.reason).toBe('billing-disabled');
    expect((await h.send('POST', '/iap/intent', { productId: 'starter_pack_v1' }, a.token)).status).toBe(503);
    expect((await h.send('POST', '/iap/verify', { productId: 'starter_pack_v1', purchaseToken: TOK('a') }, a.token)).status).toBe(503);
  });

  test('자격 증명 바인딩이 없으면 credential-route-unavailable로 닫힌다', async () => {
    const h = await v1Harness({ env: { IAP_ENABLED: 'true' } as any });
    const a = await h.session();
    expect((await h.send('GET', '/iap/catalog', undefined, a.token)).body.reason).toBe('credential-route-unavailable');
  });

  test('카탈로그는 판매 상품만 내보내고 비활성 보석 팩은 의도도 거부한다', async () => {
    const { h, a, intent } = await setup();
    const cat = await h.send('GET', '/iap/catalog', undefined, a.token);
    expect(cat.body.billing).toBe(true);
    expect(cat.body.products.map((p: any) => p.id).sort()).toEqual(['monthly_card_v1', 'remove_ads_v1', 'season_pass_s1', 'starter_pack_v1']);
    expect((await intent(a.token, 'gems_300_v1')).body.error).toBe('unknown-product');
    expect((await intent(a.token, 'nope')).body.error).toBe('unknown-product');
  });

  test('스타터 팩: 서버 검증 뒤에만 지급, 재전송은 멱등, consume은 지급 뒤 1회', async () => {
    const { h, play, a, intent, verify, me } = await setup();
    const before = (await me(a.token)).doc.gems;
    // 의도 없이(obfuscatedAccountId 미발급) 산 구매는 계정을 알 수 없어 거부한다.
    play.product(TOK('s1'), 'starter_pack_v1', 'unknown-obf-id-123456');
    expect((await verify(a.token, 'starter_pack_v1', TOK('s1'))).body.error).toBe('purchase-account-unknown');
    const it = (await intent(a.token, 'starter_pack_v1')).body;
    expect(it.playType).toBe('inapp');
    expect(it.obfuscatedAccountId).toMatch(/^[0-9a-f]{48}$/);
    play.product(TOK('s2'), 'starter_pack_v1', it.obfuscatedAccountId);
    const r = await verify(a.token, 'starter_pack_v1', TOK('s2'));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('granted');
    expect(r.body.acked).toBe(true);
    expect(r.body.grants).toHaveLength(1);
    expect(r.body.grants[0].rewards).toEqual({ ssrTicket: 1, gems: 1000, gold: 50000 });
    expect(play.calls.consume).toEqual([TOK('s2')]);
    const after = await me(a.token);
    expect(after.doc.gems).toBe(before + 1000);
    expect(after.doc.ssrTickets).toBe(1);
    const again = await verify(a.token, 'starter_pack_v1', TOK('s2'));
    expect(again.body.state).toBe('already');
    expect((await me(a.token)).doc.gems).toBe(before + 1000);
    expect(play.calls.consume).toHaveLength(1);
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind = 'iap:starter_pack_v1'").get()).toEqual({ n: 1 });
    // 계정당 1회: 같은 계정의 다음 의도는 거부된다.
    expect((await intent(a.token, 'starter_pack_v1')).body.error).toBe('not-eligible');
    const cat = await h.send('GET', '/iap/catalog', undefined, a.token);
    expect(cat.body.products.find((p: any) => p.id === 'starter_pack_v1').eligible).toBe(false);
  });

  test('남의 영수증·다른 상품·변조 토큰은 지급 0', async () => {
    const { h, play, a, intent, verify, me } = await setup();
    const b = await h.session();
    const itA = (await intent(a.token, 'starter_pack_v1')).body;
    await intent(b.token, 'starter_pack_v1');
    play.product(TOK('own'), 'starter_pack_v1', itA.obfuscatedAccountId);
    const gemsB = (await me(b.token)).doc.gems;
    // B가 A의 토큰을 보낸다 → obfuscatedAccountId 불일치
    expect((await verify(b.token, 'starter_pack_v1', TOK('own'))).body.error).toBe('purchase-account-mismatch');
    // A가 정상 검증한 뒤 B가 같은 토큰 → 이미 A 소유
    await verify(a.token, 'starter_pack_v1', TOK('own'));
    expect((await verify(b.token, 'starter_pack_v1', TOK('own'))).body.error).toBe('purchase-owned-by-another-account');
    expect((await me(b.token)).doc.gems).toBe(gemsB);
    // 다른 상품 id로 검증 요청 → 불일치
    play.product(TOK('ads'), 'remove_ads_v1', itA.obfuscatedAccountId);
    expect((await verify(a.token, 'season_pass_s1', TOK('ads'))).status).toBe(422);
    // 형식이 틀린 토큰·알 수 없는 필드
    expect((await verify(a.token, 'remove_ads_v1', 'bad token!')).body.error).toBe('purchase-token');
    expect((await h.send('POST', '/iap/verify', { productId: 'remove_ads_v1', purchaseToken: TOK('ads'), rewards: { gems: 1e9 } }, a.token)).body.error).toBe('unknown-field');
    // Play가 모르는 토큰
    expect((await verify(a.token, 'remove_ads_v1', TOK('ghost'))).body.error).toBe('purchase-not-found');
  });

  test('보류(PENDING) 결제는 지급하지 않고, 승인 뒤 검증하면 지급한다', async () => {
    const { play, a, intent, verify, me } = await setup();
    const it = (await intent(a.token, 'starter_pack_v1')).body;
    play.product(TOK('p'), 'starter_pack_v1', it.obfuscatedAccountId, { purchaseState: 'PENDING' });
    const gems = (await me(a.token)).doc.gems;
    expect((await verify(a.token, 'starter_pack_v1', TOK('p'))).body.state).toBe('pending');
    expect((await me(a.token)).doc.gems).toBe(gems);
    play.products.get(TOK('p'))!.purchaseState = 'PURCHASED';
    expect((await verify(a.token, 'starter_pack_v1', TOK('p'))).body.state).toBe('granted');
    expect((await me(a.token)).doc.gems).toBe(gems + 1000);
  });

  test('광고 제거·시즌 패스: acknowledge만, 권한 요약에 반영, 재구매 의도 거부', async () => {
    const { h, play, a, intent, verify } = await setup();
    const it = (await intent(a.token, 'remove_ads_v1')).body;
    play.product(TOK('ra'), 'remove_ads_v1', it.obfuscatedAccountId);
    const r = await verify(a.token, 'remove_ads_v1', TOK('ra'));
    expect(r.body.entitlements.adsRemoved).toBe(true);
    expect(play.calls.ack).toEqual([TOK('ra')]);
    expect(play.calls.consume).toEqual([]);
    expect((await intent(a.token, 'remove_ads_v1')).body.error).toBe('not-eligible');
    await intent(a.token, 'season_pass_s1');
    play.product(TOK('sp'), 'season_pass_s1', it.obfuscatedAccountId);
    const pass = await verify(a.token, 'season_pass_s1', TOK('sp'));
    expect(pass.body.entitlements.passPremium).toBe(true);
    // 시즌이 끝나면 패스 권한도 끝난다.
    h.setNow(SEASONS.s1.endsAt + 1);
    const later = await h.session(a.deviceKey);
    expect((await h.send('GET', '/iap/state', undefined, later.token)).body.entitlements.passPremium).toBe(false);
  });

  test('Play acknowledge 실패: DB 지급은 유지, acked=false, 다음 검증이 다시 ack', async () => {
    const { play, a, intent, verify, me } = await setup();
    const it = (await intent(a.token, 'remove_ads_v1')).body;
    play.product(TOK('af'), 'remove_ads_v1', it.obfuscatedAccountId);
    play.state.failAck = true;
    const first = await verify(a.token, 'remove_ads_v1', TOK('af'));
    expect(first.body.state).toBe('granted');
    expect(first.body.acked).toBe(false);
    play.state.failAck = false;
    const second = await verify(a.token, 'remove_ads_v1', TOK('af'));
    expect(second.body.state).toBe('already');
    expect(second.body.acked).toBe(true);
    expect(play.calls.ack).toEqual([TOK('af')]);
    expect((await me(a.token)).rev).toBe(2);
  });

  test('라이선스 테스트 구매는 IAP_ALLOW_TEST일 때만, 결제율 집계에서는 제외', async () => {
    const off = await setup();
    const it = (await off.intent(off.a.token, 'starter_pack_v1')).body;
    off.play.product(TOK('t'), 'starter_pack_v1', it.obfuscatedAccountId, { test: true });
    expect((await off.verify(off.a.token, 'starter_pack_v1', TOK('t'))).body.error).toBe('test-purchase-not-allowed');
    const on = await setup({ IAP_ALLOW_TEST: 'true' });
    const it2 = (await on.intent(on.a.token, 'starter_pack_v1')).body;
    on.play.product(TOK('t'), 'starter_pack_v1', it2.obfuscatedAccountId, { test: true });
    expect((await on.verify(on.a.token, 'starter_pack_v1', TOK('t'))).body.state).toBe('granted');
    const report = await funnelReport(on.h.db, 0, Math.floor(T0 / DAY) + 1);
    expect(report.payers).toBe(0);
    expect(on.h.db.sqlite.query("SELECT COUNT(*) AS n FROM funnel_milestones WHERE step = 'first_purchase'").get()).toEqual({ n: 0 });
  });

  test('동시에 같은 토큰을 두 번 검증해도 지급은 1회', async () => {
    const { play, a, intent, verify, me } = await setup();
    const it = (await intent(a.token, 'starter_pack_v1')).body;
    play.product(TOK('race'), 'starter_pack_v1', it.obfuscatedAccountId);
    const gems = (await me(a.token)).doc.gems;
    const results = await Promise.all([verify(a.token, 'starter_pack_v1', TOK('race')), verify(a.token, 'starter_pack_v1', TOK('race'))]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.state).sort()).toEqual(['already', 'granted']);
    expect((await me(a.token)).doc.gems).toBe(gems + 1000);
  });
});

describe('BM D10b 월정액(구독)', () => {
  test('결제 주기마다 1회 지급, 매일 수령은 서버 권한으로, 만료 뒤 수령 불가', async () => {
    const { h, play, a, intent, verify, me } = await setup();
    const it = (await intent(a.token, 'monthly_card_v1')).body;
    expect(it.playType).toBe('subs');
    expect(it.basePlanId).toBe('monthly');
    play.sub(TOK('m'), it.obfuscatedAccountId);
    const gems = (await me(a.token)).doc.gems;
    const r = await verify(a.token, 'monthly_card_v1', TOK('m'));
    expect(r.body.state).toBe('granted');
    expect(r.body.entitlements.monthlyUntil).toBe(T0 + 30 * DAY);
    expect(play.calls.subAck).toEqual([TOK('m')]);
    expect((await me(a.token)).doc.gems).toBe(gems + 1200);
    // 구독 중 재구독 의도는 거부
    expect((await intent(a.token, 'monthly_card_v1')).body.error).toBe('already-subscribed');
    // 매일 보석 100: 서버 문서에는 monthlyUntil이 없지만 권한 표를 얹어 수령된다.
    expect((await h.cmd(a.token, 'claimMonthly', [])).status).toBe(200);
    expect((await h.cmd(a.token, 'claimMonthly', [])).status).toBe(422);
    expect((await me(a.token)).doc.gems).toBe(gems + 1300);
    // 같은 주기 재조회는 지급 없음, 갱신(새 성공 주문)은 1회 더
    expect((await verify(a.token, 'monthly_card_v1', TOK('m'))).body.state).toBe('already');
    h.advance(30 * DAY);
    const s2 = await h.session(a.deviceKey);
    Object.assign(play.subs.get(TOK('m'))!, { latestOrderId: 'GPA.1111-0000..0', expiryTime: T0 + 60 * DAY });
    expect((await verify(s2.token, 'monthly_card_v1', TOK('m'))).body.state).toBe('granted');
    expect((await me(s2.token)).doc.gems).toBe(gems + 1300 + 1200);
    // 만료(EXPIRED) → 권한 끝, 매일 수령 불가
    h.advance(31 * DAY);
    const s3 = await h.session(a.deviceKey);
    Object.assign(play.subs.get(TOK('m'))!, { state: 'SUBSCRIPTION_STATE_EXPIRED' });
    expect((await verify(s3.token, 'monthly_card_v1', TOK('m'))).body.state).toBe('expired');
    expect((await h.cmd(s3.token, 'claimMonthly', [])).status).toBe(422);
  });

  test('해지 예약(CANCELED)은 만료 시각까지 권한 유지, 새 지급 없음', async () => {
    const { play, a, intent, verify } = await setup();
    const it = (await intent(a.token, 'monthly_card_v1')).body;
    play.sub(TOK('c'), it.obfuscatedAccountId);
    await verify(a.token, 'monthly_card_v1', TOK('c'));
    play.subs.get(TOK('c'))!.state = 'SUBSCRIPTION_STATE_CANCELED';
    const r = await verify(a.token, 'monthly_card_v1', TOK('c'));
    expect(r.body.state).toBe('already');
    expect(r.body.entitlements.monthlyUntil).toBe(T0 + 30 * DAY);
  });
});

describe('BM 환불·취소 역분개', () => {
  test('voidedpurchases 대사: 쓴 재화는 0까지만 차감하고 부채로 남기며 권한 철회, 2회면 지급 보류', async () => {
    const { h, play, a, intent, verify, me } = await setup();
    const it = (await intent(a.token, 'starter_pack_v1')).body;
    play.product(TOK('r1'), 'starter_pack_v1', it.obfuscatedAccountId);
    await verify(a.token, 'starter_pack_v1', TOK('r1'));
    // 보석을 거의 다 썼다고 가정(문서 직접 조작)
    const row = h.db.sqlite.query("SELECT doc FROM account_docs WHERE account_id = ?").get(a.accountId) as { doc: string };
    const doc = JSON.parse(row.doc); doc.gems = 300;
    h.db.sqlite.query('UPDATE account_docs SET doc = ? WHERE account_id = ?').run(JSON.stringify(doc), a.accountId);
    play.state.voided = [{ purchaseToken: TOK('r1'), orderId: 'GPA.r1', voidedTimeMillis: h.now(), kind: 'product' }];
    expect(await reconcileVoided(ctxOf(h), h.now() - DAY)).toEqual({ seen: 1, reversed: 1 });
    const after = await me(a.token);
    expect(after.doc.gems).toBe(0);
    const grant = h.db.sqlite.query('SELECT reversed_at, debt FROM iap_grants').get() as { reversed_at: number; debt: string };
    expect(grant.reversed_at).toBe(h.now());
    expect(JSON.parse(grant.debt)).toEqual({ gems: 700 });
    // 재대사는 무해
    expect(await reconcileVoided(ctxOf(h), h.now() - DAY)).toEqual({ seen: 1, reversed: 0 });
    // 역분개 기록이 상태 API로 내려간다(클라이언트가 같은 차감을 1회 반영)
    expect((await h.send('GET', '/iap/state', undefined, a.token)).body.reversals).toHaveLength(1);
    // 두 번째 환불(광고 제거) → 권한 철회 + 90일 2회 → 지급 보류, 새 결제 시작 차단
    await intent(a.token, 'remove_ads_v1');
    play.product(TOK('r2'), 'remove_ads_v1', it.obfuscatedAccountId);
    expect((await verify(a.token, 'remove_ads_v1', TOK('r2'))).body.entitlements.adsRemoved).toBe(true);
    play.products.get(TOK('r2'))!.purchaseState = 'CANCELLED';
    const cancelled = await verify(a.token, 'remove_ads_v1', TOK('r2'));
    expect(cancelled.body.state).toBe('refunded');
    expect(cancelled.body.entitlements.adsRemoved).toBe(false);
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM sanctions WHERE kind = 'payout_hold' AND reason = 'iap-refunds'").get()).toEqual({ n: 1 });
    expect((await intent(a.token, 'season_pass_s1')).body.error).toBe('payout-hold');
    // 환불된 토큰을 다시 PURCHASED로 보여도 재지급하지 않는다.
    play.products.get(TOK('r2'))!.purchaseState = 'PURCHASED';
    expect((await verify(a.token, 'remove_ads_v1', TOK('r2'))).body.state).toBe('refunded');
  });
});

describe('BM RTDN(Pub/Sub push)', () => {
  const RTDN_ENV = { RTDN_AUDIENCE: 'https://blade.example/api/v1/iap/rtdn', RTDN_PUSH_SUBJECT: '1234567890' };
  const push = (h: any, data: unknown, messageId: string, jwt = 'pubsub-jwt-valid-0000000000') =>
    h.send('POST', '/iap/rtdn', { message: { data: btoa(JSON.stringify(data)), messageId }, subscription: 'projects/x/subscriptions/y' }, undefined, { authorization: 'Bearer ' + jwt, origin: '' });

  test('OIDC 토큰이 없거나 다른 서비스 계정이면 401, 설정이 없으면 503', async () => {
    const noCfg = await setup();
    expect((await push(noCfg.h, { packageName: 'com.theluxurylord.bladesurge', testNotification: {} }, 'm0')).status).toBe(503);
    const { h } = await setup(RTDN_ENV);
    h.google.set('pubsub-jwt-other-000000000000', '999');
    expect((await push(h, {}, 'm1', 'pubsub-jwt-other-000000000000')).status).toBe(401);
    expect((await push(h, {}, 'm1', 'pubsub-jwt-unknown-00000000000')).status).toBe(401);
  });

  test('앱이 꺼진 뒤의 구매도 RTDN이 계정을 찾아 지급하고, 같은 메시지는 한 번만 처리한다', async () => {
    const { h, play, a, intent, me } = await setup(RTDN_ENV);
    h.google.set('pubsub-jwt-valid-0000000000', '1234567890');
    const it = (await intent(a.token, 'starter_pack_v1')).body;
    play.product(TOK('rt'), 'starter_pack_v1', it.obfuscatedAccountId);
    const gems = (await me(a.token)).doc.gems;
    const note = { version: '1.0', packageName: 'com.theluxurylord.bladesurge', eventTimeMillis: String(h.now()),
      oneTimeProductNotification: { version: '1.0', notificationType: 1, purchaseToken: TOK('rt'), sku: 'starter_pack_v1' } };
    const r = await push(h, note, 'msg-1');
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('granted');
    expect((await me(a.token)).doc.gems).toBe(gems + 1000);
    expect((await push(h, note, 'msg-1')).body.outcome).toBe('duplicate');
    // 다른 패키지·알 수 없는 상품은 무시(200)
    expect((await push(h, { ...note, packageName: 'com.other' }, 'msg-2')).body.outcome).toBe('wrong-package');
    expect((await push(h, { ...note, oneTimeProductNotification: { purchaseToken: TOK('rt'), sku: 'gem_hack' } }, 'msg-3')).body.outcome).toBe('unknown-product');
    // 환불 알림 → 역분개
    const voided = await push(h, { packageName: 'com.theluxurylord.bladesurge', voidedPurchaseNotification: { purchaseToken: TOK('rt'), orderId: 'GPA.x', productType: 2 } }, 'msg-4');
    expect(voided.body.outcome).toBe('reversed:1');
    expect((await me(a.token)).doc.gems).toBe(gems);
  });

  test('계정을 알 수 없는 구매 알림은 지급 없이 기록만 한다', async () => {
    const { h, play } = await setup(RTDN_ENV);
    h.google.set('pubsub-jwt-valid-0000000000', '1234567890');
    play.product(TOK('orphan'), 'starter_pack_v1', 'not-issued-obf-000000');
    const r = await push(h, { packageName: 'com.theluxurylord.bladesurge', oneTimeProductNotification: { purchaseToken: TOK('orphan'), sku: 'starter_pack_v1' } }, 'msg-o');
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('rejected:purchase-account-unknown');
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM iap_grants').get()).toEqual({ n: 0 });
  });
});

describe('BM D11 결제 퍼널', () => {
  test('클라이언트는 허용 단계만, 첫 결제는 서버 검증 지급만 기록하고 결제율을 계산한다', async () => {
    const { h, play, a, intent, verify } = await setup();
    const b = await h.session();
    expect((await h.send('POST', '/funnel', { events: ['first_run', 'tutorial_complete', 'shop_view'] }, a.token)).body.accepted).toBe(3);
    expect((await h.send('POST', '/funnel', { events: ['first_run'] }, b.token)).status).toBe(200);
    // 클라이언트가 결제 성공을 주장할 수 없다
    expect((await h.send('POST', '/funnel', { events: ['first_purchase'] }, b.token)).body.error).toBe('event');
    expect((await h.send('POST', '/funnel', { events: Array(21).fill('first_run') }, b.token)).body.error).toBe('events');
    const it = (await intent(a.token, 'starter_pack_v1')).body;
    play.product(TOK('f'), 'starter_pack_v1', it.obfuscatedAccountId);
    await verify(a.token, 'starter_pack_v1', TOK('f'));
    const day = Math.floor(h.now() / DAY);
    const report = await funnelReport(h.db, day, day);
    expect(report.cohort).toEqual({ install: 2, tutorial_complete: 1, shop_view: 1, paysheet_open: 0, purchase_start: 1, first_purchase: 1 });
    expect(report.activeAccounts).toBe(2);
    expect(report.payers).toBe(1);
    expect(report.paymentRate).toBe(0.5);
    expect(report.revenueKRW).toBe(1200);
    expect(report.meetsTarget).toBe(true);
    // 기록은 계정 id·단계·시각뿐이다.
    const cols = (h.db.sqlite.query("SELECT name FROM pragma_table_info('funnel_milestones')").all() as { name: string }[]).map((r) => r.name);
    expect(cols).toEqual(['account_id', 'step', 'first_at', 'cohort_day']);
  });
});

describe('BM 그림자 스냅샷 정화와 유료 재화', () => {
  test('서버가 지급한 유료 보상만큼 상한이 넓어지고, 유효한 패스의 수령 기록은 보존된다', () => {
    const now = T0;
    const eco = EconomyCore.fromState(null, { now: () => now, rng: () => 0.5 });
    eco.s.ssrTickets = 20; eco.s.pass.premium = true; eco.s.pass.claimedPrem = [1, 2, 3];
    const raw = eco.snapshot();
    const plain = sanitizeLegacySave(raw, { now, createdAt: now }) as any;
    expect(plain.state.ssrTickets).toBe(12);
    expect(plain.state.pass.premium).toBe(false);
    expect(plain.state.pass.claimedPrem).toEqual([]);
    const paid = sanitizeLegacySave(raw, { now, createdAt: now, allowance: { ssrTickets: 8 }, entitled: { passPremium: true, monthlyUntil: 0 } }) as any;
    expect(paid.state.ssrTickets).toBe(20);
    expect(paid.state.pass.premium).toBe(true);
    expect(paid.state.pass.claimedPrem).toEqual([1, 2, 3]);
  });

  test('카탈로그 보상 키는 지급 허용 목록 안에 있다', () => {
    for (const p of IAP_PRODUCTS) for (const r of [p.grant.rewards, p.grant.perPeriod]) for (const k of Object.keys(r ?? {})) expect(['gems', 'gold', 'ssrTicket', 'tickets', 'stones', 'transcendStones']).toContain(k);
  });
});
