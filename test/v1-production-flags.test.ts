import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { v1Harness } from './helpers/v1-harness';

// 운영 wrangler.jsonc vars 그대로: 계정(V1)은 열고, 앱 결제(Play·원스토어 IAP)만 열고 웹 결제는 닫는다(2026-10-31 앱 출시, docs/ACCOUNT_POLICY.md 6장).
const vars = (() => {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')).vars as Record<string, string>;
})();

test('운영 플래그: V1 열림·그림자 0%, 앱 결제만 켜짐·웹 결제 꺼짐, 카카오·ChatGPT 키 비어 있음', () => {
  expect(vars.V1_ENABLED).toBe('true');
  expect(vars.V1_SERVER_AUTHORITY_PERCENT).toBe('0');
  expect(vars.IAP_ENABLED).toBe('true');
  for (const k of ['WEB_BILLING_ENABLED', 'STORE_BILLING_ENABLED']) expect(vars[k]).toBe('false');
  expect(vars.KAKAO_REST_KEY).toBe('');
  expect(vars.CHATGPT_CLIENT_ID).toBe('');
});

test('운영 vars로 계정은 동작하고, 앱 결제는 자격 증명 없이는 닫히며 웹 결제는 닫힘 응답', async () => {
  const h = await v1Harness({ env: { ...vars, APP_ORIGIN: 'https://blade.example', SESSION_HMAC: 'x'.repeat(48) } as any });
  const a = await h.session();
  expect(a.authority).toBe('shadow');
  expect((await h.send('GET', '/auth/providers')).body).toEqual({ google: true, kakao: false, chatgpt: false });
  const me = await h.send('GET', '/me', undefined, a.token);
  expect(me.body.flags).toMatchObject({ v1: true, serverAuthority: false, iap: true, webBilling: false });
  // 시험 하네스에는 Play 서비스 계정·원스토어 시크릿 바인딩이 없다: 열린 플래그여도 fail-closed.
  expect((await h.send('POST', '/iap/intent', { productId: 'starter_pack_v1' }, a.token)).body.error).toBe('credential-route-unavailable');
  expect((await h.send('POST', '/iap/intent', { productId: 'starter_pack_v1', channel: 'onestore' }, a.token)).body.error).toBe('credential-route-unavailable');
  const web = await h.send('POST', '/iap/web/intent', { productId: 'gems_small' }, a.token);
  expect(web.status).toBeGreaterThanOrEqual(400);
  expect(String(web.body.error)).toMatch(/disabled|server-authority|unknown-product/);
  expect((await h.send('POST', '/auth/oauth/start', { provider: 'kakao', mode: 'link' }, a.token)).status).toBe(501);
});
