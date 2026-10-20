import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SocialCore } from '../src/server/core';
import { createGoogleVerifier } from '../src/server/google';
import { randomHex, sha256Hex } from '../src/server/hub';
import type { GameConfig } from '../src/shared/protocol';

const CONFIG: GameConfig = {
  gameId: 'test-game', worldChannels: 1, worldCapacity: 50, contents: [{ id: 'cave', name: '동굴', minClearSec: 40 }],
  titleTiers: [{ id: 'first', maxRank: 1, label: '최초 정복자' }], founders: { maxNo: 10, titleId: 'founder', label: '창립 모험가' },
  completion: { titleId: 'conqueror', label: '전 지역 정복자' }, dmFriendsOnly: true,
  chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 50 }, bannedWords: [],
};
const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const newKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function setup() {
  const real = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']) as CryptoKeyPair;
  const fake = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', real.publicKey);
  let t = 1_800_000_000_000, fetches = 0;
  const verifier = createGoogleVerifier({
    now: () => t,
    fetch: async () => { fetches++; return Response.json({ keys: [{ kty: 'RSA', n: jwk.n, e: jwk.e, kid: 'k1', alg: 'RS256', use: 'sig' }] }, { headers: { 'cache-control': 'public, max-age=3600' } }); },
  });
  const db = new Database(':memory:');
  const core = new SocialCore({
    sql: { exec: (q: string, ...b: any[]) => { const rows = db.query(q).all(...b); return { toArray: () => rows }; } },
    config: CONFIG, now: () => t, randomHex, sha256Hex, transaction: fn => db.transaction(fn)(),
    verifyIdToken: (_p, token, ids) => verifier.verify(token, ids),
  });
  const sign = async (claims: Record<string, unknown> = {}, key = real.privateKey, kid = 'k1') => {
    const head = enc({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: 'web-client', sub: '1000001', iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 3600, ...claims });
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head));
    return head + '.' + Buffer.from(sig).toString('base64url');
  };
  const call = (method: string, path: string, o: { key?: string; body?: unknown; ip?: string; clientIds?: string[] } = {}) =>
    core.handle({ method, path, query: new URLSearchParams(), body: o.body, key: o.key ?? null, ipHash: o.ip ?? 'ip-' + Math.random(), adminIds: [], clientIds: o.clientIds ?? ['web-client', 'android-client'] });
  const player = async (name: string) => { const key = newKey(); const r = await call('POST', '/profile', { key, body: { name } }); return { key, id: (r.body as any).id as string }; };
  return { call, player, sign, fake, advance: (ms: number) => { t += ms; }, fetches: () => fetches };
}

describe('구글 연동(선택)', () => {
  test('GOOGLE_CLIENT_IDS가 비면 503 link-disabled', async () => {
    const h = await setup();
    const a = await h.player('게스트');
    expect(await h.call('POST', '/auth/link', { key: a.key, clientIds: [], body: { provider: 'google', idToken: await h.sign() } })).toMatchObject({ status: 503, body: { error: 'link-disabled' } });
    expect((await h.call('POST', '/auth/unlink', { key: a.key, clientIds: [], body: { provider: 'google' } })).status).toBe(503);
  });
  test('서명 검증: 성공·aud 불일치·만료·위조·모르는 kid, JWKS 캐시', async () => {
    const h = await setup();
    const a = await h.player('연동자');
    const ok = await h.call('POST', '/auth/link', { key: a.key, body: { provider: 'google', idToken: await h.sign() } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: a.id, linked: true, links: ['google'] });
    const b = await h.player('다른사람');
    const link = async (claims: Record<string, unknown>, key?: CryptoKey, kid?: string) => h.call('POST', '/auth/link', { key: b.key, body: { provider: 'google', idToken: await h.sign({ sub: '2000002', ...claims }, key, kid) } });
    expect((await link({ aud: 'someone-else' })).body).toEqual({ error: 'bad-token' });
    expect((await link({ exp: Math.floor(1_800_000_000_000 / 1000) - 1 })).body).toEqual({ error: 'token-expired' });
    expect((await link({ iat: Math.floor(1_800_000_000_000 / 1000) - 3600 })).body).toEqual({ error: 'token-expired' });
    expect((await link({ iss: 'https://evil.example' })).body).toEqual({ error: 'bad-token' });
    expect((await link({}, h.fake.privateKey)).body).toEqual({ error: 'bad-token' });
    expect(h.fetches()).toBe(1);
    expect((await link({}, undefined, 'k9')).body).toEqual({ error: 'bad-token' });
    expect(h.fetches()).toBe(1); // 60초 안에는 모르는 kid로 다시 받지 않는다
    expect((await link({ aud: 'android-client' })).status).toBe(200);
    expect((await h.call('POST', '/auth/link', { key: a.key, body: { provider: 'google', idToken: 'a.b' } })).status).toBe(401);
  });
  test('이미 다른 플레이어에 연결된 계정은 409', async () => {
    const h = await setup();
    const a = await h.player('먼저연결'), b = await h.player('나중연결');
    await h.call('POST', '/auth/link', { key: a.key, body: { provider: 'google', idToken: await h.sign() } });
    expect(await h.call('POST', '/auth/link', { key: b.key, body: { provider: 'google', idToken: await h.sign() } })).toMatchObject({ status: 409, body: { error: 'linked-elsewhere' } });
    expect(await h.call('POST', '/auth/link', { key: a.key, body: { provider: 'google', idToken: await h.sign({ sub: '3000003' }) } })).toMatchObject({ status: 409, body: { error: 'already-linked' } });
  });
  test('recover로 새 기기 키를 더하고, 5개를 넘으면 가장 오래 안 쓴 키를 지운다', async () => {
    const h = await setup();
    const a = await h.player('복구할사람');
    await h.call('POST', '/auth/link', { key: a.key, body: { provider: 'google', idToken: await h.sign() } });
    expect(await h.call('POST', '/auth/recover', { body: { provider: 'google', idToken: await h.sign({ sub: '9999' }), deviceKey: newKey() } })).toMatchObject({ status: 404, body: { error: 'no-link' } });
    const other = await h.player('남의기기');
    expect(await h.call('POST', '/auth/recover', { body: { provider: 'google', idToken: await h.sign(), deviceKey: other.key } })).toMatchObject({ status: 409, body: { error: 'key-in-use' } });
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      h.advance(120000);
      const key = newKey();
      const r = await h.call('POST', '/auth/recover', { body: { provider: 'google', idToken: await h.sign(), deviceKey: key } });
      expect(r).toMatchObject({ status: 200, body: { id: a.id, linked: true } });
      keys.push(key);
      if (i === 3) expect((await h.call('GET', '/me', { key: a.key })).status).toBe(200); // 키 5개까지는 처음 키도 유지
    }
    // 처음 키는 i=3 시점에 사용돼 last_seen이 갱신됐으므로, 6번째 키 추가 때 지워지는 건 가장 오래 안 쓴 keys[0]
    expect((await h.call('GET', '/me', { key: keys[0] })).body).toEqual({ error: 'no-profile' });
    expect((await h.call('GET', '/me', { key: a.key })).status).toBe(200);
    expect((await h.call('GET', '/me', { key: keys[4] })).status).toBe(200);
    expect((await h.call('POST', '/auth/unlink', { key: a.key, body: { provider: 'google' } })).body).toMatchObject({ linked: false, links: [] });
  });
  test('recover는 IP당 시간당 10회', async () => {
    const h = await setup();
    for (let i = 0; i < 10; i++) expect((await h.call('POST', '/auth/recover', { ip: 'same', body: { provider: 'google', idToken: await h.sign(), deviceKey: newKey() } })).status).toBe(404);
    expect((await h.call('POST', '/auth/recover', { ip: 'same', body: { provider: 'google', idToken: await h.sign(), deviceKey: newKey() } })).status).toBe(429);
  });
});

