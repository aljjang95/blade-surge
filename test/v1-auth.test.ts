import { describe, expect, test } from 'bun:test';
import { newDeviceKey, ORIGIN, T0, v1Harness } from './helpers/v1-harness';
import { signToken, verifyToken } from '../worker/v1/token';

describe('MMO P1-B 신원·세션', () => {
  test('플래그가 꺼져 있거나 스키마가 없으면 전체 503', async () => {
    const off = await v1Harness({ env: { V1_ENABLED: 'false' } });
    expect((await off.send('POST', '/auth/session', { deviceKey: newDeviceKey() })).status).toBe(503);
    const h = await v1Harness();
    h.db.sqlite.exec('DROP TABLE v1_schema');
    expect((await h.send('POST', '/auth/session', { deviceKey: newDeviceKey() })).status).toBe(503);
  });

  test('origin 없는·다른 origin 요청은 거부', async () => {
    const h = await v1Harness();
    expect((await h.send('POST', '/auth/session', { deviceKey: newDeviceKey() }, undefined, { origin: 'https://evil.example' })).status).toBe(403);
    const a = await h.session();
    const { handleV1Request } = await import('../worker/v1/router');
    const noOriginGet = await handleV1Request(new Request(ORIGIN + '/api/v1/me', { headers: { authorization: 'Bearer ' + a.token } }), h.env, h.deps);
    expect(noOriginGet.status).toBe(200);
    const noOriginPost = await handleV1Request(new Request(ORIGIN + '/api/v1/cmd', { method: 'POST', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'application/json' }, body: '{}' }), h.env, h.deps);
    expect(noOriginPost.status).toBe(403);
  });

  test('게스트 생성 → 토큰 → /me, 같은 키는 같은 계정', async () => {
    const h = await v1Harness();
    const a = await h.session();
    expect(a.accountId).toMatch(/^p_[0-9a-f]{24}$/);
    expect(a.authority).toBe('shadow');
    const me = await h.send('GET', '/me', undefined, a.token);
    expect(me.status).toBe(200);
    expect(me.body.doc.gold).toBe(12000);
    expect(me.body.rev).toBe(1);
    const again = await h.session(a.deviceKey);
    expect(again.accountId).toBe(a.accountId);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
  });

  test('잘못된 기기 키·알 수 없는 필드 거부', async () => {
    const h = await v1Harness();
    expect((await h.send('POST', '/auth/session', { deviceKey: 'short' })).status).toBe(401);
    expect((await h.send('POST', '/auth/session', { deviceKey: newDeviceKey(), deviceId: 'android-id' })).body.error).toBe('unknown-field');
  });

  test('토큰 변조·만료·token_ver 불일치 거부', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const [v, p, s] = a.token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), aid: 'p_' + 'f'.repeat(24) })).toString('base64url');
    expect((await h.send('GET', '/me', undefined, `${v}.${forgedPayload}.${s}`)).body.error).toBe('token');
    const other = await signToken('y'.repeat(48), { aid: a.accountId, ch: 'web', ver: 1, iat: T0, exp: T0 + 1000, att: 0 });
    expect((await h.send('GET', '/me', undefined, other)).body.error).toBe('token');
    h.advance(60 * 60 * 1000 + 1);
    expect((await h.send('GET', '/me', undefined, a.token)).body.error).toBe('token-expired');
    const b = await h.session(a.deviceKey);
    expect((await h.send('POST', '/auth/logout-all', undefined, b.token)).status).toBe(200);
    expect((await h.send('GET', '/me', undefined, b.token)).body.error).toBe('token-revoked');
    expect((await h.send('GET', '/me', undefined, (await h.session(a.deviceKey)).token)).status).toBe(200);
  });

  test('토큰 형식 검사는 서명 전에 길이·구조를 본다', async () => {
    expect((await verifyToken('k'.repeat(40), 'v1.a.b', T0)).ok).toBe(false);
    expect((await verifyToken('k'.repeat(40), 'x'.repeat(2000), T0)).ok).toBe(false);
  });

  test('차단 계정은 세션을 받지 못한다', async () => {
    const h = await v1Harness();
    const a = await h.session();
    h.db.sqlite.query("UPDATE accounts SET status = 'banned' WHERE account_id = ?").run(a.accountId);
    expect((await h.send('POST', '/auth/session', { deviceKey: a.deviceKey })).status).toBe(403);
    expect((await h.send('GET', '/me', undefined, a.token)).body.error).toBe('banned');
  });

  test('연동 → 다른 계정 충돌 409(병합 금지) → 복구로 전환, 게스트는 90일 보관', async () => {
    const h = await v1Harness();
    h.google.set('tok-alice', 'sub-alice');
    const a = await h.session(), b = await h.session();
    expect((await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-alice' }, a.token)).body.linked).toEqual(['google']);
    const clash = await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-alice' }, b.token);
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('linked-elsewhere');
    expect(clash.body.other.accountId).toBe(a.accountId);
    expect((await h.send('POST', '/auth/link', { provider: 'google', idToken: 'bad' }, b.token)).status).toBe(401);
    expect((await h.send('POST', '/auth/link', { provider: 'play_games', idToken: 'x' }, b.token)).status).toBe(501);
    const rec = await h.send('POST', '/auth/recover', { provider: 'google', idToken: 'tok-alice', deviceKey: b.deviceKey });
    expect(rec.status).toBe(200);
    expect(rec.body.accountId).toBe(a.accountId);
    expect(rec.body.switchedFrom).toBe(b.accountId);
    expect((await h.session(b.deviceKey)).accountId).toBe(a.accountId);
    expect(h.db.sqlite.query('SELECT account_id, reason FROM account_archive').all()).toEqual([{ account_id: b.accountId, reason: 'switched:' + a.accountId }]);
    // 연동된 계정의 키는 다른 연동 계정으로 빼앗기지 않는다.
    h.google.set('tok-carol', 'sub-carol');
    const c = await h.session();
    await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-carol' }, c.token);
    expect((await h.send('POST', '/auth/recover', { provider: 'google', idToken: 'tok-alice', deviceKey: c.deviceKey })).body.error).toBe('key-in-use');
    expect((await h.send('POST', '/auth/unlink', { provider: 'google' }, c.token)).body.linked).toEqual([]);
  });

  test('기존 소셜 deviceKey는 기존 playerId로 입양되고 친구·칭호가 유지된다', async () => {
    const h = await v1Harness({ social: true });
    const key = newDeviceKey(), friendKey = newDeviceKey();
    const profile = (await h.social!.call('POST', '/profile', key, { name: '기존모험가' })).body;
    const friend = (await h.social!.call('POST', '/profile', friendKey, { name: '친구' })).body;
    await h.social!.call('POST', '/friends/request', key, { playerId: friend.id });
    await h.social!.call('POST', '/friends/respond', friendKey, { playerId: profile.id, accept: true });
    const s = await h.session(key);
    expect(s.accountId).toBe(profile.id);
    const me = (await h.social!.call('GET', '/me', key)).body;
    expect(me.profile.id).toBe(profile.id);
    expect(me.friends.map((f: any) => f.id)).toEqual([friend.id]);
  });

  test('소셜 프로필이 없으면 id를 예약하고, 나중에 만든 소셜 프로필이 같은 id를 쓴다', async () => {
    const h = await v1Harness({ social: true });
    const key = newDeviceKey();
    const s = await h.session(key);
    expect(h.social!.sqlite.query('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 0 });
    const profile = (await h.social!.call('POST', '/profile', key, { name: '새모험가' })).body;
    expect(profile.id).toBe(s.accountId);
  });

  test('소셜 내부 경로는 공개 라우터로 닿지 않는다', async () => {
    const { handleSocialRequest } = await import('../packages/tll-social/src/server/router');
    const h = await v1Harness({ social: true });
    const res = await handleSocialRequest(new Request(ORIGIN + '/api/social/internal/account', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-social-internal': '1' }, body: '{"keyHash":"' + 'a'.repeat(64) + '"}' }),
      { APP_ORIGIN: ORIGIN, SOCIAL: h.social!.namespace as any }, { gameId: 'blade-surge' } as any);
    expect(res.status).toBe(404);
    const direct = await h.social!.hub.fetch(new Request('https://social.internal/internal/account', { method: 'POST', body: '{"keyHash":"' + 'a'.repeat(64) + '"}' }));
    expect(direct.status).toBe(404);
  });
});
