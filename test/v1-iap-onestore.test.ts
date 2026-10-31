import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { V1Error } from '../worker/v1/db';
import type { OneApi, OnePurchase, OneVoided } from '../worker/v1/onestore';
import { createOneApi } from '../worker/v1/onestore';
import { reconcileOneVoided } from '../worker/v1/iap';

/** 원스토어 서버 API 가짜. 토큰별 상태를 테스트가 정하고 acknowledge/consume 호출을 기록한다. */
function fakeOne() {
  const purchases = new Map<string, OnePurchase & { productId: string }>();
  const calls = { ack: [] as string[], consume: [] as string[], markets: [] as string[] };
  const state = { voided: [] as OneVoided[], failAck: false };
  const notFound = () => { throw new V1Error(422, 'purchase-not-found'); };
  const api: OneApi = {
    async purchase(productId, token, market) {
      calls.markets.push(market);
      const p = purchases.get(token);
      // 상세 응답은 상품을 돌려주지 않는다: 다른 상품 경로로 조회하면 원스토어가 404를 준다.
      return p && p.productId === productId ? { ...p } : notFound();
    },
    async acknowledge(_id, token) { if (state.failAck) throw new V1Error(503, 'one-unavailable'); calls.ack.push(token); const p = purchases.get(token); if (p) p.acknowledgeState = 1; },
    async consume(_id, token) { if (state.failAck) throw new V1Error(503, 'one-unavailable'); calls.consume.push(token); const p = purchases.get(token); if (p) { p.consumptionState = 1; p.acknowledgeState = 1; } },
    async voided() { return state.voided; },
  };
  const buy = (token: string, productId: string, payload: string | null, extra: Partial<OnePurchase> = {}) => purchases.set(token, {
    productId, purchaseState: 0, consumptionState: 0, acknowledgeState: 0, developerPayload: payload, quantity: 1, purchaseId: 'ONE' + token.slice(-6), ...extra });
  return { api, purchases, calls, state, buy };
}

async function setup(env: Record<string, string> = {}) {
  const h = await v1Harness({ env: { IAP_ENABLED: 'true', ...env } as any });
  const one = fakeOne();
  (h.deps as any).oneApi = one.api;
  const a = await h.session();
  const intent = (token: string, productId: string, channel: string = 'onestore') => h.send('POST', '/iap/intent', { productId, channel }, token);
  const verify = (token: string, productId: string, purchaseToken: string, extra: Record<string, unknown> = {}) =>
    h.send('POST', '/iap/verify', { productId, purchaseToken, channel: 'onestore', marketCode: 'MKT_ONE', ...extra }, token);
  const me = async (token: string) => (await h.send('GET', '/me', undefined, token)).body;
  return { h, one, a, intent, verify, me };
}
const TOK = (n: string) => 'one' + n.padEnd(20, 'x');

describe('원스토어 IAP 서버 검증 → 지급', () => {
  test('원스토어 자격이 없으면 원스토어 의도만 닫히고 Play 채널과 섞이지 않는다', async () => {
    const h = await v1Harness({ env: { IAP_ENABLED: 'true' } as any });
    const a = await h.session();
    const r = await h.send('POST', '/iap/intent', { productId: 'starter_pack_v1', channel: 'onestore' }, a.token);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('credential-route-unavailable');
    expect((await h.send('POST', '/iap/intent', { productId: 'starter_pack_v1', channel: 'toss' }, a.token)).body.error).toBe('invalid-channel');
  });

  test('IAP_ENABLED=false면 원스토어도 503', async () => {
    const { a, intent } = await setup({ IAP_ENABLED: 'false' });
    expect((await intent(a.token, 'starter_pack_v1')).status).toBe(503);
  });

  test('정기 결제·Play 전용 보석 팩은 원스토어에서 팔지 않는다', async () => {
    const { a, intent } = await setup();
    expect((await intent(a.token, 'monthly_card_v1')).body.error).toBe('unknown-product');
    expect((await intent(a.token, 'gems_300_v1')).body.error).toBe('unknown-product');
  });

  test('스타터 팩: developerPayload 결박 뒤에만 지급, 재전송 멱등, consume 1회', async () => {
    const { one, a, intent, verify, me } = await setup();
    const before = (await me(a.token)).doc.gems;
    const it = (await intent(a.token, 'starter_pack_v1')).body;
    expect(it.playType).toBe('inapp');
    // 결제 때 다른 payload(남의 계정·변조)를 실은 구매는 계정을 알 수 없어 거부한다.
    one.buy(TOK('x'), 'starter_pack_v1', 'forged-payload-0000');
    expect((await verify(a.token, 'starter_pack_v1', TOK('x'))).body.error).toBe('purchase-account-unknown');
    one.buy(TOK('s'), 'starter_pack_v1', it.obfuscatedAccountId);
    const r = await verify(a.token, 'starter_pack_v1', TOK('s'));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('granted');
    expect(r.body.acked).toBe(true);
    expect(one.calls.consume).toEqual([TOK('s')]);
    expect(one.calls.markets.at(-1)).toBe('MKT_ONE');
    const again = await verify(a.token, 'starter_pack_v1', TOK('s'));
    expect(again.body.state).toBe('already');
    expect(one.calls.consume).toHaveLength(1);
    const grants = r.body.grants.filter((g: any) => g.productId === 'starter_pack_v1');
    expect(grants).toHaveLength(1);
    expect((await me(a.token)).doc.gems).toBeGreaterThanOrEqual(before);
  });

  test('광고 제거: acknowledge만 하고 권한에 반영, 재구매 의도 거부', async () => {
    const { one, a, intent, verify } = await setup();
    const it = (await intent(a.token, 'remove_ads_v1')).body;
    one.buy(TOK('r'), 'remove_ads_v1', it.obfuscatedAccountId);
    const r = await verify(a.token, 'remove_ads_v1', TOK('r'));
    expect(r.body.state).toBe('granted');
    expect(one.calls.ack).toEqual([TOK('r')]);
    expect(one.calls.consume).toHaveLength(0);
    expect(r.body.entitlements.adsRemoved).toBe(true);
    expect((await intent(a.token, 'remove_ads_v1')).status).toBe(409);
  });

  test('같은 토큰을 다른 상품으로 검증하면 지급 0, 다른 계정이면 409', async () => {
    const { h, one, a, intent, verify } = await setup();
    const it = (await intent(a.token, 'season_pass_s1')).body;
    one.buy(TOK('p'), 'season_pass_s1', it.obfuscatedAccountId);
    expect((await verify(a.token, 'remove_ads_v1', TOK('p'))).status).toBe(422);
    expect((await verify(a.token, 'season_pass_s1', TOK('p'))).body.state).toBe('granted');
    const b = await h.session();
    expect((await verify(b.token, 'season_pass_s1', TOK('p'))).status).toBe(409);
  });

  test('취소된 구매(purchaseState=1)는 지급하지 않고, 지급 뒤 취소되면 역분개한다', async () => {
    const { one, a, intent, verify } = await setup();
    const it = (await intent(a.token, 'remove_ads_v1')).body;
    one.buy(TOK('c'), 'remove_ads_v1', it.obfuscatedAccountId);
    expect((await verify(a.token, 'remove_ads_v1', TOK('c'))).body.entitlements.adsRemoved).toBe(true);
    one.purchases.get(TOK('c'))!.purchaseState = 1;
    const r = await verify(a.token, 'remove_ads_v1', TOK('c'));
    expect(r.body.state).toBe('refunded');
    expect(r.body.entitlements.adsRemoved).toBe(false);
  });

  test('구매취소내역 대사: 아는 토큰만 역분개하고 커서를 남긴다', async () => {
    const { h, one, a, intent, verify } = await setup();
    const it = (await intent(a.token, 'remove_ads_v1')).body;
    one.buy(TOK('v'), 'remove_ads_v1', it.obfuscatedAccountId);
    await verify(a.token, 'remove_ads_v1', TOK('v'));
    one.state.voided = [{ purchaseToken: TOK('v'), purchaseId: null, marketCode: 'MKT_ONE' }, { purchaseToken: TOK('unknown'), purchaseId: null, marketCode: 'MKT_ONE' }];
    const ctx = { env: h.env, db: h.db, deps: h.deps, now: h.now(), request: new Request('https://x/') } as any;
    const r = await reconcileOneVoided(ctx);
    expect(r).toMatchObject({ seen: 4, reversed: 1, failed: 0 }); // 두 시장(MKT_ONE·MKT_GLB)을 모두 본다
    const st = await h.send('GET', '/iap/state', undefined, a.token);
    expect(st.body.entitlements.adsRemoved).toBe(false);
  });

  test('ack 실패: 지급 유지·acked=false, 다음 검증이 다시 확정', async () => {
    const { one, a, intent, verify } = await setup();
    const it = (await intent(a.token, 'remove_ads_v1')).body;
    one.buy(TOK('f'), 'remove_ads_v1', it.obfuscatedAccountId);
    one.state.failAck = true;
    const r = await verify(a.token, 'remove_ads_v1', TOK('f'));
    expect(r.body.state).toBe('granted');
    expect(r.body.acked).toBe(false);
    one.state.failAck = false;
    const again = await verify(a.token, 'remove_ads_v1', TOK('f'));
    expect(again.body.state).toBe('already');
    expect(again.body.acked).toBe(true);
  });

  test('허용되지 않은 marketCode는 거부, 카탈로그는 채널별 결제 가능 여부를 낸다', async () => {
    const { h, a, verify } = await setup();
    const one = await h.send('GET', '/iap/catalog?channel=onestore', undefined, a.token);
    expect(one.body.billing).toBe(true);
    expect(one.body.products.find((p: any) => p.id === 'remove_ads_v1').channels).toContain('onestore');
    // Play 자격이 없으면 Play 카탈로그는 닫힌다(채널을 섞지 않는다).
    expect((await h.send('GET', '/iap/catalog', undefined, a.token)).body.reason).toBe('credential-route-unavailable');
    expect((await verify(a.token, 'remove_ads_v1', TOK('m'), { marketCode: 'MKT_XXX' })).body.error).toBe('market-code');
  });

  test('Play 검증 본문에 marketCode를 섞으면 거부한다(채널 혼동 방지)', async () => {
    const { h, a } = await setup();
    (h.deps as any).playApi = {};
    const r = await h.send('POST', '/iap/verify', { productId: 'remove_ads_v1', purchaseToken: TOK('q'), marketCode: 'MKT_ONE' }, a.token);
    expect(r.status).toBe(400);
  });
});

describe('원스토어 API 클라이언트', () => {
  const cred = JSON.stringify({ client_id: 'oauth-1', api_client_id: 'app-1', package_name: 'com.theluxurylord.bladesurge', environment: 'production-v7', client_secret: 's3cret' });
  const env = { ONE_PUBLISHER: cred, BLADESURGE_ONE_API_CLIENT_ID: 'app-1', BLADESURGE_ONE_OAUTH_CLIENT_ID: 'oauth-1' };

  test('상용 호스트·market 헤더·Bearer로 조회하고 비밀은 URL에 싣지 않는다', async () => {
    const seen: Request[] = [];
    const fetcher = async (r: Request) => {
      seen.push(r);
      if (r.url.endsWith('/v7/oauth/token')) return Response.json({ access_token: 'at-1', expires_in: 3600, token_type: 'bearer' });
      return Response.json({ purchaseState: 0, consumptionState: 0, acknowledgeState: 0, developerPayload: 'p', quantity: 1, purchaseId: 'x1' });
    };
    const api = createOneApi(env, fetcher, () => 1_000);
    const p = await api.purchase('remove_ads_v1', 'tok123', 'MKT_ONE');
    expect(p.purchaseState).toBe(0);
    const get = seen.find((r) => r.url.includes('/purchases/'))!;
    expect(get.url).toBe('https://iap-apis.onestore.net/v7/apps/app-1/purchases/inapp/products/remove_ads_v1/tok123');
    expect(get.headers.get('x-market-code')).toBe('MKT_ONE');
    expect(get.headers.get('authorization')).toBe('Bearer at-1');
    expect(seen.every((r) => !r.url.includes('s3cret'))).toBe(true);
    await expect(api.purchase('remove_ads_v1', 'tok123', 'MKT_BAD')).rejects.toThrow();
  });

  test('자격 JSON이 다른 앱·패키지면 닫힌다', async () => {
    const bad = { ...env, ONE_PUBLISHER: cred.replace('com.theluxurylord.bladesurge', 'com.other') };
    const api = createOneApi(bad, async () => Response.json({}), () => 2_000_000_000);
    await expect(api.purchase('remove_ads_v1', 'tok123', 'MKT_ONE')).rejects.toThrow('one-credential-invalid');
  });

  test('구매취소내역은 공백 섞인 목록 키와 continuationKey 페이지를 읽는다', async () => {
    let page = 0;
    const fetcher = async (r: Request) => {
      if (r.url.endsWith('/v7/oauth/token')) return Response.json({ access_token: 'at-2', expires_in: 3600 });
      page++;
      return page === 1 ? Response.json({ 'voidedPurchaseList ': [{ purchaseToken: 'a1', purchaseId: 'p1' }], continuationKey: 'k2' })
        : Response.json({ voidedPurchaseList: [{ purchaseToken: 'a2', purchaseId: 'p2', marketCode: 'MKT_ONE' }] });
    };
    const out = await createOneApi(env, fetcher, () => 3_000_000_000).voided(0, 'MKT_ONE');
    expect(out.map((v) => v.purchaseToken)).toEqual(['a1', 'a2']);
  });
});

describe('원스토어 구매취소내역 페이지 상한', () => {
  test('continuationKey가 계속 남으면 실패로 돌려 대사 커서를 멈춘다', async () => {
    const cred = JSON.stringify({ client_id: 'oauth-1', api_client_id: 'app-1', package_name: 'com.theluxurylord.bladesurge', environment: 'production-v7', client_secret: 's3cret' });
    const env = { ONE_PUBLISHER: cred, BLADESURGE_ONE_API_CLIENT_ID: 'app-1', BLADESURGE_ONE_OAUTH_CLIENT_ID: 'oauth-1' };
    const fetcher = async (r: Request) => r.url.endsWith('/v7/oauth/token') ? Response.json({ access_token: 'at-3', expires_in: 3600 })
      : Response.json({ voidedPurchaseList: [], continuationKey: 'more' });
    await expect(createOneApi(env, fetcher, () => 4_000_000_000).voided(0, 'MKT_ONE')).rejects.toThrow('one-voided-truncated');
  });
});
