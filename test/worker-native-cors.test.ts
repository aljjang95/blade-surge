import { describe, expect, test } from 'bun:test';
import { handleRequest } from '../worker/index';
import { NATIVE_ORIGINS } from '../worker/native-cors';

const app = 'https://blade.tllhouse.com';
const native = 'https://localhost';

/** 허용 출처를 정식 출처로 바꿔 통과시킨 요청이 DO까지 도달했는지 보는 가짜 바인딩. */
function fixture() {
  const seen: string[] = [];
  const stub = (tag: string) => ({ idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => {
    seen.push(`${tag}:${new URL(r.url).pathname}`);
    return Response.json(tag === 'party' && new URL(r.url).pathname === '/init' ? { ok: true } : { allowed: true, ok: true });
  } }) });
  const env = { APP_ORIGIN: app, DIALOGUE_ENABLED: 'false', ASSETS: { fetch: async () => new Response('game') },
    PARTIES: stub('party'), SOCIAL: stub('social') } as any;
  return { env, seen };
}
const call = (path: string, init: RequestInit = {}, env = fixture().env) => handleRequest(new Request(app + path, init), env);

describe('앱 WebView CORS 허용 목록', () => {
  test('허용 목록은 Capacitor 기본 출처 둘뿐이다', () => {
    expect([...NATIVE_ORIGINS]).toEqual(['https://localhost', 'capacitor://localhost']);
  });

  test('허용 출처의 preflight는 204와 정확한 허용 헤더를 준다', async () => {
    for (const path of ['/api/party', '/api/party/' + 'A'.repeat(20), '/api/social/ws-ticket', '/api/companion']) {
      for (const origin of NATIVE_ORIGINS) {
        const res = await call(path, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe(origin);
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
        expect(res.headers.get('access-control-allow-headers')).toBe('Accept, Authorization, Content-Type');
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
        expect(res.headers.get('vary')).toContain('Origin');
      }
    }
  });

  test('허용 밖 출처·메서드·헤더의 preflight는 CORS 헤더 없이 거부한다', async () => {
    const bad = async (headers: Record<string, string>) => call('/api/social/me', { method: 'OPTIONS', headers });
    const evil = await bad({ origin: 'https://evil.example', 'access-control-request-method': 'POST' });
    expect(evil.status).not.toBe(204); expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const put = await bad({ origin: native, 'access-control-request-method': 'PUT' });
    expect(put.status).toBe(403); expect(put.headers.get('access-control-allow-origin')).toBeNull();
    const header = await bad({ origin: native, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-admin' });
    expect(header.status).toBe(403); expect(header.headers.get('access-control-allow-origin')).toBeNull();
    const http = await bad({ origin: 'http://localhost', 'access-control-request-method': 'GET' });
    expect(http.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('앱 출처 파티 생성은 통과하고 응답에 CORS 헤더가 붙는다', async () => {
    const f = fixture();
    const res = await call('/api/party', { method: 'POST', headers: { origin: native, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: '{}' }, f.env);
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe(native);
    expect(res.headers.get('access-control-expose-headers')).toBe('Retry-After');
    expect(f.seen).toContain('party:/init');
  });

  test('앱 출처 커뮤니티 GET·POST가 출처 검사를 통과해 허브까지 간다', async () => {
    const f = fixture();
    const get = await call('/api/social/world', { method: 'GET', headers: { origin: native, 'sec-fetch-site': 'cross-site' } }, f.env);
    expect(get.status).toBe(200); expect(get.headers.get('access-control-allow-origin')).toBe(native);
    const post = await call('/api/social/ws-ticket', { method: 'POST', headers: { origin: 'capacitor://localhost', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json', authorization: 'Bearer ' + 'a'.repeat(32) }, body: '{}' }, f.env);
    expect(post.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(post.status).not.toBe(403);
    expect(f.seen.filter(s => s.startsWith('social:')).length).toBeGreaterThan(0);
  });

  test('허용 밖 출처는 기존대로 403이며 CORS 헤더가 없다', async () => {
    for (const path of ['/api/party', '/api/social/ws-ticket', '/api/companion']) {
      const res = await call(path, { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(403); expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  test('허용 목록 출처라도 다른 경로(자산·결제)에는 이 CORS를 붙이지 않는다', async () => {
    const asset = await call('/index.html', { headers: { origin: native } });
    expect(asset.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('웹 같은 출처 요청은 CORS 헤더 없이 기존 동작 그대로다', async () => {
    const f = fixture();
    const res = await call('/api/party', { method: 'POST', headers: { origin: app, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: '{}' }, f.env);
    expect(res.status).toBe(201); expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
