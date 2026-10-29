import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { v1Harness } from './helpers/v1-harness';

// 운영 wrangler.jsonc vars 그대로: 계정(V1)은 열고 결제는 닫혀 있어야 한다(docs/ACCOUNT_POLICY.md 6장).
const vars = (() => {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')).vars as Record<string, string>;
})();

test('운영 플래그: V1 열림·그림자 0%, 결제 플래그 전부 꺼짐, 카카오·ChatGPT 키 비어 있음', () => {
  expect(vars.V1_ENABLED).toBe('true');
  expect(vars.V1_SERVER_AUTHORITY_PERCENT).toBe('0');
  for (const k of ['IAP_ENABLED', 'IAP_ALLOW_TEST', 'WEB_BILLING_ENABLED', 'STORE_BILLING_ENABLED']) expect(vars[k]).toBe('false');
  expect(vars.KAKAO_REST_KEY).toBe('');
  expect(vars.CHATGPT_CLIENT_ID).toBe('');
});

test('운영 vars로 계정은 동작하고 결제 경로는 모두 닫힘 응답', async () => {
  const h = await v1Harness({ env: { ...vars, APP_ORIGIN: 'https://blade.example', SESSION_HMAC: 'x'.repeat(48) } as any });
  const a = await h.session();
  expect(a.authority).toBe('shadow');
  expect((await h.send('GET', '/auth/providers')).body).toEqual({ google: true, kakao: false, chatgpt: false });
  const me = await h.send('GET', '/me', undefined, a.token);
  expect(me.body.flags).toMatchObject({ v1: true, serverAuthority: false, iap: false, webBilling: false });
  expect((await h.send('POST', '/iap/intent', { productId: 'gems_small' }, a.token)).body.error).toBe('billing-disabled');
  expect((await h.send('POST', '/iap/verify', { productId: 'gems_small', purchaseToken: 't'.repeat(40) }, a.token)).body.error).toBe('billing-disabled');
  const web = await h.send('POST', '/iap/web/intent', { productId: 'gems_small' }, a.token);
  expect(web.status).toBeGreaterThanOrEqual(400);
  expect(String(web.body.error)).toMatch(/disabled|server-authority|unknown-product/);
  expect((await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'link' }, a.token)).status).toBe(501);
});
