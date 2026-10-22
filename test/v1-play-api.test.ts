import { describe, expect, test } from 'bun:test';
import { createPlayApi } from '../worker/v1/play';
import { V1Error } from '../worker/v1/db';

/** 테스트 전용 서비스 계정(즉석 생성 RSA 키). 실제 자격 증명이 아니다. */
async function fakeServiceAccount(email = 'iap-test@blade-test.iam.gserviceaccount.com') {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----\n`;
  return { json: JSON.stringify({ type: 'service_account', client_email: email, private_key: pem, token_uri: 'https://oauth2.googleapis.com/token' }), publicKey: pair.publicKey };
}

function router(routes: Record<string, (req: Request) => Response | Promise<Response>>) {
  const seen: Request[] = [];
  const fetcher = async (req: Request) => {
    seen.push(req);
    const url = new URL(req.url);
    const key = Object.keys(routes).find((k) => (url.origin + url.pathname).endsWith(k) || url.href.includes(k));
    return key ? routes[key](req) : new Response('nope', { status: 404 });
  };
  return { fetcher, seen };
}
const oauth = () => Response.json({ access_token: 'ya29.test-access', token_type: 'Bearer', expires_in: 3600 });

describe('Play Developer API 클라이언트', () => {
  test('서비스 계정 JWT로 토큰을 받아 productsv2 응답을 정규화하고, 토큰을 재사용한다', async () => {
    const sa = await fakeServiceAccount();
    let assertion = '';
    const { fetcher, seen } = router({
      'oauth2.googleapis.com/token': async (req) => { assertion = new URLSearchParams(await req.text()).get('assertion') ?? ''; return oauth(); },
      '/productsv2/tokens/': () => Response.json({ productLineItem: [{ productId: 'starter_pack_v1', productOfferDetails: { quantity: 1, refundableQuantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' } }],
        purchaseStateContext: { purchaseState: 'PURCHASED' }, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING', obfuscatedExternalAccountId: 'obf-1', orderId: 'GPA.1' }),
    });
    const api = createPlayApi({ PLAY_SA_JSON: { get: async () => sa.json } }, fetcher, () => 1_800_000_000_000);
    const p = await api.productPurchase('token/with+chars');
    expect(p).toEqual({ productId: 'starter_pack_v1', quantity: 1, refundableQuantity: 1, purchaseState: 'PURCHASED', consumed: false, acknowledged: false, obfuscatedAccountId: 'obf-1', orderId: 'GPA.1', test: false });
    // 서명 검증: 우리가 만든 JWT가 공개키로 검증되고 androidpublisher 범위만 요청한다.
    const [h, c, sig] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims.scope).toBe('https://www.googleapis.com/auth/androidpublisher');
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', sa.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(h + '.' + c))).toBe(true);
    const purchaseCall = seen.find((r) => r.url.includes('/productsv2/'))!;
    expect(purchaseCall.url).toContain('/applications/com.theluxurylord.bladesurge/purchases/productsv2/tokens/token%2Fwith%2Bchars');
    expect(purchaseCall.headers.get('authorization')).toBe('Bearer ya29.test-access');
    await api.productPurchase('again');
    expect(seen.filter((r) => r.url.includes('oauth2')).length).toBe(1);
  });

  test('subscriptionsv2 응답 정규화(만료 시각·주문·basePlan·외부 계정 id)', async () => {
    const sa = await fakeServiceAccount('sub-test@blade-test.iam.gserviceaccount.com');
    const { fetcher } = router({ 'oauth2.googleapis.com/token': oauth,
      '/subscriptionsv2/tokens/': () => Response.json({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        externalAccountIdentifiers: { obfuscatedExternalAccountId: 'obf-2' }, latestOrderId: 'GPA.old',
        lineItems: [{ productId: 'monthly_card_v1', expiryTime: '2027-01-01T00:00:00Z', latestSuccessfulOrderId: 'GPA.2..1', offerDetails: { basePlanId: 'monthly' } }] }) });
    const s = await createPlayApi({ PLAY_SA_JSON: sa.json }, fetcher).subscriptionPurchase('t');
    expect(s).toEqual({ productId: 'monthly_card_v1', basePlanId: 'monthly', state: 'SUBSCRIPTION_STATE_ACTIVE', expiryTime: Date.parse('2027-01-01T00:00:00Z'), acknowledged: true,
      obfuscatedAccountId: 'obf-2', latestOrderId: 'GPA.2..1', linkedPurchaseToken: null, test: false });
  });

  test('오류 매핑: 없는 토큰 422, 권한 거부 503(원문 미노출), 자격 증명 없음·변조 503', async () => {
    const sa = await fakeServiceAccount('err-test@blade-test.iam.gserviceaccount.com');
    const code = async (fn: () => Promise<unknown>) => { try { await fn(); return 'ok'; } catch (e) { return e instanceof V1Error ? `${e.status}:${e.code}` : 'raw'; } };
    const notFound = router({ 'oauth2.googleapis.com/token': oauth, '/productsv2/': () => Response.json({ error: { message: 'secret detail' } }, { status: 400 }) });
    expect(await code(() => createPlayApi({ PLAY_SA_JSON: sa.json }, notFound.fetcher).productPurchase('x'))).toBe('422:purchase-not-found');
    const denied = router({ 'oauth2.googleapis.com/token': oauth, '/productsv2/': () => Response.json({ error: { message: 'The current user has insufficient permissions' } }, { status: 403 }) });
    expect(await code(() => createPlayApi({ PLAY_SA_JSON: sa.json }, denied.fetcher).productPurchase('x'))).toBe('503:play-credential-rejected');
    expect(await code(() => createPlayApi({}, notFound.fetcher).productPurchase('x'))).toBe('503:play-credential-unavailable');
    expect(await code(() => createPlayApi({ PLAY_SA_JSON: '{"type":"user"}' }, notFound.fetcher).productPurchase('x'))).toBe('503:play-credential-invalid');
    // base64로 감싼 서비스 계정 JSON도 받는다.
    const b64 = router({ 'oauth2.googleapis.com/token': oauth, '/voidedpurchases': () => Response.json({ voidedPurchases: [{ purchaseToken: 'v1', orderId: 'GPA.v', voidedTimeMillis: '5', kind: 'androidpublisher#productPurchase' }] }) });
    expect(await createPlayApi({ PLAY_SA_JSON: btoa(sa.json) }, b64.fetcher).voided(0)).toEqual([{ purchaseToken: 'v1', orderId: 'GPA.v', voidedTimeMillis: 5, kind: 'product' }]);
  });

  test('acknowledge·consume 경로', async () => {
    const sa = await fakeServiceAccount('ack-test@blade-test.iam.gserviceaccount.com');
    const { fetcher, seen } = router({ 'oauth2.googleapis.com/token': oauth, ':acknowledge': () => new Response(null, { status: 204 }), ':consume': () => new Response('', { status: 200 }) });
    const api = createPlayApi({ PLAY_SA_JSON: sa.json }, fetcher);
    await api.acknowledgeProduct('remove_ads_v1', 'a');
    await api.consumeProduct('starter_pack_v1', 'b');
    await api.acknowledgeSubscription('monthly_card_v1', 'c');
    const paths = seen.filter((r) => !r.url.includes('oauth2')).map((r) => `${r.method} ${new URL(r.url).pathname.split('/purchases')[1]}`);
    expect(paths).toEqual(['POST /products/remove_ads_v1/tokens/a:acknowledge', 'POST /products/starter_pack_v1/tokens/b:consume', 'POST /subscriptions/monthly_card_v1/tokens/c:acknowledge']);
  });
});
