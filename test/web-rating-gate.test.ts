import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { webRatingFromOnestoreIarc } from '../src/data/game-rating.js';

// 웹(blade.tllhouse.com)은 스토어 자체등급이 적용되지 않는다: 원스토어 IARC 인증 ID(웹 등급)가 들어오기 전까지 웹 포트원 실채널 판매는 서버가 닫는다.
const STORE = 'store-test-0001';
async function setup(env: Record<string, string>) {
  const h = await v1Harness({ env: { WEB_BILLING_ENABLED: 'true', PORTONE_STORE_ID: STORE, V1_SERVER_AUTHORITY_PERCENT: '100', ...env } as any });
  (h.deps as any).portoneApi = { async getPayment() { return null; } };
  // 정본 등급 값(src/data/game-rating.js 웹 = preparing)으로 판정한다.
  (h.deps as any).webRating = undefined;
  const a = await h.session();
  return { h, a };
}

describe('웹 결제 등급 게이트', () => {
  test('웹 IARC 인증 ID가 없으면 실채널 intent는 503 rating-required, /me webBilling=false, 의도 행 없음', async () => {
    const { h, a } = await setup({ PORTONE_CHANNEL_KEY: 'channel-key-real-0001' });
    expect((await h.send('GET', '/me', undefined, a.token)).body.flags.webBilling).toBe(false);
    const r = await h.send('POST', '/iap/web/intent', { productId: 'remove_ads_v1' }, a.token);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('rating-required');
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM iap_web_payments').get()).toEqual({ n: 0 });
  });

  test('IARC 인증 ID가 들어오면 실채널 intent가 열린다', async () => {
    const { h, a } = await setup({ PORTONE_CHANNEL_KEY: 'channel-key-real-0001' });
    (h.deps as any).webRating = webRatingFromOnestoreIarc({ age: '12', certId: 'IARC-CERT-0001', date: '2026-11-20', descriptors: [] });
    expect((await h.send('GET', '/me', undefined, a.token)).body.flags.webBilling).toBe(true);
    expect((await h.send('POST', '/iap/web/intent', { productId: 'remove_ads_v1' }, a.token)).status).toBe(200);
  });

  test('허용 테스터의 테스트 채널 결제는 등급 전에도 된다(공개 판매 아님), 일반 계정은 닫힘', async () => {
    const { h, a } = await setup({ PORTONE_CHANNEL_KEY: '', PORTONE_TEST_CHANNEL_KEY: 'channel-key-test-0001', IAP_ALLOW_TEST: 'true' });
    (h.env as any).IAP_TEST_ACCOUNTS = a.accountId;
    const ok = await h.send('POST', '/iap/web/intent', { productId: 'remove_ads_v1', test: true }, a.token);
    expect(ok.status).toBe(200);
    expect(ok.body.test).toBe(true);
    const other = await h.session();
    expect((await h.send('POST', '/iap/web/intent', { productId: 'remove_ads_v1' }, other.token)).body.error).toBe('web-not-configured');
  });
});
