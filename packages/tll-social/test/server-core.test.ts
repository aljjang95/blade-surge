import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SocialCore, type Effect } from '../src/server/core';
import { randomHex, sha256Hex } from '../src/server/hub';
import { PARTY_HEROES, type GameConfig, type Session } from '../src/shared/protocol';

const BASE: GameConfig = {
  gameId: 'test-game', worldChannels: 2, worldCapacity: 2,
  contents: [{ id: 'cave', name: '동굴', minClearSec: 40 }, { id: 'tower', name: '탑', minClearSec: 40 }],
  titleTiers: [{ id: 'first', maxRank: 1, label: '최초 정복자' }, { id: 'pioneer', maxRank: 2, label: '선구자' }, { id: 'vanguard', maxRank: 3, label: '개척자' }],
  founders: { maxNo: 2, titleId: 'founder', label: '창립 모험가' },
  completion: { titleId: 'conqueror', label: '전 지역 정복자' },
  dmFriendsOnly: true,
  chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 50 },
  bannedWords: ['바보'],
};
const newKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

function setup(over: Partial<GameConfig> = {}) {
  const db = new Database(':memory:');
  let t = 1_800_000_000_000;
  const sessions: Session[] = [];
  const core = new SocialCore({
    sql: { exec: (q: string, ...b: any[]) => { const rows = db.query(q).all(...b); return { toArray: () => rows }; } },
    config: { ...BASE, ...over }, now: () => t, randomHex, sha256Hex,
    transaction: fn => db.transaction(fn)(), live: () => sessions,
  });
  const call = (method: string, path: string, o: { key?: string; body?: unknown; query?: string; ip?: string; admin?: string[] } = {}) =>
    core.handle({ method, path, query: new URLSearchParams(o.query ?? ''), body: o.body, key: o.key ?? null, ipHash: o.ip ?? 'ip-' + Math.random(), adminIds: o.admin ?? [], clientIds: [] });
  const player = async (name: string, ip?: string, hero?: string) => {
    const key = newKey();
    const r = await call('POST', '/profile', { key, body: { name, ...(hero === undefined ? {} : { hero }) }, ip });
    return { key, keyHash: await core.keyHash(key), id: (r.body as any).id as string, res: r };
  };
  const connect = (p: { id: string; keyHash: string }) => {
    const s = core.openSession(p.id, randomHex(8), p.keyHash);
    sessions.push(s);
    return { s, fx: core.message(s, JSON.stringify({ t: 'hello', presence: { state: 'lobby' } })) };
  };
  const say = (s: Session, text: string, channel = s.world, nonce = 'n' + randomHex(6)) => core.message(s, JSON.stringify({ t: 'say', channel, text, nonce }));
  return { db, core, call, player, connect, say, sessions, advance: (ms: number) => { t += ms; }, now: () => t };
}
const errorOf = (fx: Effect[]) => (fx.find(e => e.message?.t === 'error')?.message as any)?.code;
const msgOf = (fx: Effect[]) => (fx.find(e => e.message?.t === 'msg')?.message as any)?.m;

describe('프로필과 인증', () => {
  test('가입 순번·태그·창립 모험가 칭호', async () => {
    const h = setup();
    const a = await h.player('모험가'), b = await h.player('모험가'), c = await h.player('세번째');
    expect(a.res.status).toBe(201);
    const pa = a.res.body as any, pb = b.res.body as any, pc = c.res.body as any;
    expect([pa.no, pb.no, pc.no]).toEqual([1, 2, 3]);
    expect(pa.tag).toMatch(/^\d{4}$/);
    expect(pb.tag).not.toBe(pa.tag);
    expect(pa.title).toEqual({ id: 'founder', label: '창립 모험가' });
    expect(pa.linked).toBe(false);
    expect(pc.title).toBeNull();
    expect(pc.titles).toEqual([]);
  });
  test('금칙어 목록이 나중에 늘어도 기존 이름 그대로 재저장은 막히지 않고, 새 이름으로 바꿀 때만 검사한다', async () => {
    const words: string[] = [];
    const h = setup({ bannedWords: words });
    const key = newKey();
    expect((await h.call('POST', '/profile', { key, body: { name: '늦은금칙' } })).status).toBe(201);
    words.push('금칙');
    expect(await h.call('POST', '/profile', { key, body: { name: '늦은금칙' } })).toMatchObject({ status: 200, body: { name: '늦은금칙' } });
    h.advance(25 * 3600_000);
    expect((await h.call('POST', '/profile', { key, body: { name: '새금칙' } })).status).toBe(400);
    expect((await h.call('POST', '/profile', { key: newKey(), body: { name: '다른금칙' } })).status).toBe(400);
  });

  test('이름 변경은 24시간에 한 번, 같은 키로 다시 POST하면 새 프로필이 생기지 않는다', async () => {
    const h = setup();
    const a = await h.player('처음이름');
    const r1 = await h.call('POST', '/profile', { key: a.key, body: { name: '바꾼이름' } });
    expect((r1.body as any).id).toBe(a.id);
    expect((r1.body as any).no).toBe(1);
    const r2 = await h.call('POST', '/profile', { key: a.key, body: { name: '또바꿈' } });
    expect(r2.status).toBe(429);
    h.advance(24 * 3600000 + 1);
    expect((await h.call('POST', '/profile', { key: a.key, body: { name: '또바꿈' } })).status).toBe(200);
  });
  test('이름 검증과 금칙어', async () => {
    const h = setup();
    expect((await h.call('POST', '/profile', { key: newKey(), body: { name: 'a' } })).status).toBe(400);
    expect((await h.call('POST', '/profile', { key: newKey(), body: { name: '이름 공백' } })).status).toBe(400);
    expect((await h.call('POST', '/profile', { key: newKey(), body: { name: '나는바보' } })).status).toBe(400);
    expect((await h.call('POST', '/profile', { key: newKey(), body: { name: '정상이름', extra: 1 } })).status).toBe(400);
  });
  test('인증 실패 코드', async () => {
    const h = setup();
    expect(await h.call('GET', '/me')).toMatchObject({ status: 401, body: { error: 'bad-key' } });
    expect(await h.call('GET', '/me', { key: 'short' })).toMatchObject({ status: 401, body: { error: 'bad-key' } });
    expect(await h.call('GET', '/me', { key: newKey() })).toMatchObject({ status: 401, body: { error: 'no-profile' } });
    const a = await h.player('관리자'), b = await h.player('나쁜이');
    await h.call('POST', '/admin/ban', { key: b.key, body: { playerId: a.id, banned: true } }).then(r => expect(r.status).toBe(403));
    expect((await h.call('POST', '/admin/ban', { key: a.key, admin: [a.id], body: { playerId: b.id, banned: true } })).status).toBe(200);
    expect(await h.call('GET', '/me', { key: b.key })).toMatchObject({ status: 403, body: { error: 'banned' } });
  });
  test('IP당 시간당 프로필 5개', async () => {
    const h = setup();
    for (let i = 0; i < 5; i++) expect((await h.player('사람' + i, 'same')).res.status).toBe(201);
    expect((await h.player('사람6', 'same')).res.status).toBe(429);
    h.advance(3600001);
    expect((await h.player('사람7', 'same')).res.status).toBe(201);
  });
});

describe('선택 영웅', () => {
  test('다섯 영웅을 프로필 생성 때 저장하고 생략하면 null이다', async () => {
    const h = setup();
    for (const hero of PARTY_HEROES) {
      const p = await h.player('영웅선택', undefined, hero);
      expect(p.res).toMatchObject({ status: 201, body: { hero } });
      expect(h.db.query('SELECT hero FROM players WHERE id = ?').get(p.id)).toEqual({ hero });
      expect(h.core.minis([p.id]).get(p.id)?.hero).toBe(hero);
    }
    const guest = await h.player('기본초상');
    expect(guest.res.body).toMatchObject({ hero: null });
    expect(h.core.minis([guest.id]).get(guest.id)?.hero).toBeNull();
  });

  test('생성·변경에서 허용하지 않는 영웅은 400 hero이고 기존 값은 보존한다', async () => {
    const h = setup(), p = await h.player('유효영웅', undefined, 'mage');
    for (const hero of ['paladin', 'Mage', '', ' mage ', '__proto__', null, 1, {}, []]) {
      expect(await h.call('POST', '/profile', { key: newKey(), body: { name: '거부영웅', hero } })).toMatchObject({ status: 400, body: { error: 'hero' } });
      expect(await h.call('POST', '/me/hero', { key: p.key, body: { hero } })).toMatchObject({ status: 400, body: { error: 'hero' } });
    }
    expect(await h.call('POST', '/me/hero', { key: p.key, body: {} })).toMatchObject({ status: 400, body: { error: 'hero' } });
    expect(await h.call('POST', '/me/hero', { key: p.key, body: { hero: 'rogue', extra: true } })).toMatchObject({ status: 400, body: { error: 'schema' } });
    expect(h.core.minis([p.id]).get(p.id)?.hero).toBe('mage');
  });

  test('이름 변경·같은 이름 재요청은 hero를 덮어쓰지 않는다', async () => {
    const h = setup(), p = await h.player('처음영웅', undefined, 'ranger');
    expect(await h.call('POST', '/profile', { key: p.key, body: { name: '이름변경', hero: 'knight' } })).toMatchObject({ status: 200, body: { id: p.id, name: '이름변경', hero: 'ranger' } });
    expect(await h.call('POST', '/profile', { key: p.key, body: { name: '이름변경', hero: 'barbarian' } })).toMatchObject({ status: 200, body: { hero: 'ranger' } });
    h.advance(24 * 3600000 + 1);
    expect(await h.call('POST', '/profile', { key: p.key, body: { name: '영웅유지' } })).toMatchObject({ status: 200, body: { hero: 'ranger' } });
  });

  test('/me/hero는 키 인증으로 본인 영웅만 변경하고 Profile을 반환한다', async () => {
    const h = setup(), p = await h.player('영웅변경', undefined, 'knight'), other = await h.player('다른사람', undefined, 'mage');
    expect(await h.call('POST', '/me/hero', { body: { hero: 'rogue' } })).toMatchObject({ status: 401, body: { error: 'bad-key' } });
    expect(await h.call('POST', '/me/hero', { key: newKey(), body: { hero: 'rogue' } })).toMatchObject({ status: 401, body: { error: 'no-profile' } });
    expect(await h.call('POST', '/me/hero', { key: p.key, body: { hero: 'rogue' } })).toMatchObject({ status: 200, body: { id: p.id, hero: 'rogue', createdAt: h.now(), links: [], titles: expect.any(Array) } });
    expect((await h.call('GET', '/me', { key: p.key })).body).toMatchObject({ profile: { hero: 'rogue' } });
    expect(h.core.minis([other.id]).get(other.id)?.hero).toBe('mage');
    await h.call('POST', '/admin/ban', { key: other.key, admin: [other.id], body: { playerId: p.id, banned: true } });
    expect(await h.call('POST', '/me/hero', { key: p.key, body: { hero: 'knight' } })).toMatchObject({ status: 403, body: { error: 'banned' } });
  });

  test('/me/hero는 플레이어당 분당 20회로 제한한다', async () => {
    const h = setup(), p = await h.player('선택제한'), other = await h.player('독립제한');
    for (let i = 0; i < 20; i++) expect((await h.call('POST', '/me/hero', { key: p.key, body: { hero: 'mage' } })).status).toBe(200);
    expect(await h.call('POST', '/me/hero', { key: p.key, body: { hero: 'knight' } })).toMatchObject({ status: 429, body: { error: 'rate', retryAfterMs: 60000 } });
    expect(h.core.minis([p.id]).get(p.id)?.hero).toBe('mage');
    expect((await h.call('POST', '/me/hero', { key: other.key, body: { hero: 'rogue' } })).status).toBe(200);
    h.advance(60001);
    expect((await h.call('POST', '/me/hero', { key: p.key, body: { hero: 'ranger' } })).status).toBe(200);
  });

  test('채팅·친구·명예의 전당·게시판·모집의 PublicMini에 hero가 포함된다', async () => {
    const h = setup(), p = await h.player('초상전달', undefined, 'barbarian'), viewer = await h.player('상대화면');
    const mini = { id: p.id, hero: 'barbarian' };
    const connected = h.connect(p);
    expect(connected.fx.find(e => e.message?.t === 'welcome')?.message?.me).toMatchObject(mini);
    expect(msgOf(h.say(connected.s, '영웅초상'))?.from).toMatchObject(mini);
    await h.call('POST', '/friends/request', { key: p.key, body: { playerId: viewer.id } });
    expect((await h.call('GET', '/me', { key: viewer.key })).body).toMatchObject({ requests: { incoming: [{ player: mini }] } });
    await h.call('POST', '/friends/respond', { key: viewer.key, body: { playerId: p.id, accept: true } });
    expect((await h.call('GET', '/me', { key: viewer.key })).body).toMatchObject({ friends: [mini] });
    const post = await h.call('POST', '/board', { key: p.key, body: { category: 'question', title: '초상확인', body: '선택한 영웅' } });
    expect(post.body).toMatchObject({ author: mini });
    expect((await h.call('GET', '/board')).body).toMatchObject({ items: [{ author: mini }] });
    const postId = (post.body as any).id;
    await h.call('POST', '/board/' + postId + '/comment', { key: p.key, body: { body: '댓글초상' } });
    expect((await h.call('GET', '/board/' + postId)).body).toMatchObject({ comments: [{ author: mini }] });
    await h.call('POST', '/listings', { key: p.key, body: { partyCode: 'A'.repeat(20), contentId: 'cave', note: '같이가요', slots: 4, members: 1 } });
    expect((await h.call('GET', '/listings', { key: viewer.key })).body).toMatchObject({ items: [{ host: mini }] });
    const start = await h.call('POST', '/runs/start', { key: p.key, body: { contentId: 'cave', mode: 'solo' } });
    h.advance(50000);
    await h.call('POST', '/runs/clear', { key: p.key, body: { runId: (start.body as any).runId } });
    expect((await h.call('GET', '/fame/cave')).body).toMatchObject({ first: [{ player: mini }], fastest: [{ player: mini }] });
    await h.call('POST', '/me/hero', { key: p.key, body: { hero: 'ranger' } });
    expect(msgOf(h.say(connected.s, '바뀐초상'))?.from).toMatchObject({ id: p.id, hero: 'ranger' });
    expect((await h.call('GET', '/fame/cave')).body).toMatchObject({ first: [{ player: { id: p.id, hero: 'ranger' } }] });
  });
});

describe('친구와 차단', () => {
  test('요청·수락·상호요청·삭제·차단', async () => {
    const h = setup();
    const a = await h.player('에이'), b = await h.player('비비'), c = await h.player('씨씨');
    const pb = (await h.call('GET', '/me', { key: b.key })).body as any;
    const code = pb.profile.name + '#' + pb.profile.tag;
    expect((await h.call('POST', '/friends/request', { key: a.key, body: { code } })).body).toMatchObject({ status: 'pending' });
    expect(((await h.call('GET', '/me', { key: b.key })).body as any).requests.incoming[0].player.id).toBe(a.id);
    expect((await h.call('POST', '/friends/respond', { key: b.key, body: { playerId: a.id, accept: true } })).body).toMatchObject({ status: 'friends' });
    expect(((await h.call('GET', '/me', { key: a.key })).body as any).friends.map((f: any) => f.id)).toEqual([b.id]);
    // 상호 요청은 바로 친구
    await h.call('POST', '/friends/request', { key: a.key, body: { playerId: c.id } });
    expect((await h.call('POST', '/friends/request', { key: c.key, body: { playerId: a.id } })).body).toMatchObject({ status: 'friends' });
    expect((await h.call('POST', '/friends/request', { key: a.key, body: { playerId: a.id } })).status).toBe(400);
    expect((await h.call('POST', '/friends/request', { key: a.key, body: { playerId: c.id } })).status).toBe(409);
    await h.call('POST', '/friends/remove', { key: a.key, body: { playerId: c.id } });
    expect(((await h.call('GET', '/me', { key: c.key })).body as any).friends).toEqual([]);
    // 차단하면 친구가 정리되고 요청도 막힌다
    expect((await h.call('POST', '/blocks', { key: b.key, body: { playerId: a.id, blocked: true } })).status).toBe(200);
    expect(((await h.call('GET', '/me', { key: a.key })).body as any).friends).toEqual([]);
    expect((await h.call('POST', '/friends/request', { key: a.key, body: { playerId: b.id } })).body).toEqual({ error: 'blocked' });
    expect((await h.call('POST', '/friends/respond', { key: b.key, body: { playerId: c.id, accept: true } })).status).toBe(404);
  });
  test('수락 이벤트에는 수락한 사람의 접속·상태가 실린다', async () => {
    const h = setup();
    const a = await h.player('에이'), b = await h.player('비비'), c = await h.player('씨씨');
    h.connect(a);
    h.connect(b);
    await h.call('POST', '/friends/request', { key: a.key, body: { playerId: b.id } });
    const accepted = await h.call('POST', '/friends/respond', { key: b.key, body: { playerId: a.id, accept: true } });
    const toA = accepted.effects.find(e => (e.to as any).player === a.id)?.message as any;
    expect(toA).toMatchObject({ t: 'friend', event: 'accepted', online: true, presence: { state: 'lobby' } });
    expect(toA.player.id).toBe(b.id);
    // 상호 요청으로 바로 친구가 되는 경로도 같다. 수락하는 쪽(씨씨)이 접속 중이 아니면 오프라인으로 실린다.
    h.connect(a);
    await h.call('POST', '/friends/request', { key: a.key, body: { playerId: c.id } });
    h.connect(c);
    const mutual = await h.call('POST', '/friends/request', { key: c.key, body: { playerId: a.id } });
    expect(mutual.effects.find(e => (e.to as any).player === a.id)?.message).toMatchObject({ event: 'accepted', online: true });
    const d = await h.player('디디');
    h.connect(a);
    await h.call('POST', '/friends/request', { key: a.key, body: { playerId: d.id } });
    const offline = await h.call('POST', '/friends/respond', { key: d.key, body: { playerId: a.id, accept: true } });
    expect(offline.effects.find(e => (e.to as any).player === a.id)?.message).toMatchObject({ event: 'accepted', online: false, presence: null });
  });
});

describe('런 티켓과 명예의 전당', () => {
  const clear = async (h: ReturnType<typeof setup>, key: string, contentId: string, ms = 41000) => {
    const start = await h.call('POST', '/runs/start', { key, body: { contentId, mode: 'solo' } });
    h.advance(ms);
    return h.call('POST', '/runs/clear', { key, body: { runId: (start.body as any).runId } });
  };
  test('너무 빠른 클리어·중복·2시간 초과·모르는 콘텐츠 거부', async () => {
    const h = setup();
    const a = await h.player('달리기');
    expect((await h.call('POST', '/runs/start', { key: a.key, body: { contentId: 'nope', mode: 'solo' } })).status).toBe(400);
    const s = (await h.call('POST', '/runs/start', { key: a.key, body: { contentId: 'cave', mode: 'party' } })).body as any;
    h.advance(39000);
    expect(await h.call('POST', '/runs/clear', { key: a.key, body: { runId: s.runId } })).toMatchObject({ status: 422, body: { error: 'too-fast' } });
    h.advance(2000);
    expect((await h.call('POST', '/runs/clear', { key: a.key, body: { runId: s.runId } })).status).toBe(200);
    expect(await h.call('POST', '/runs/clear', { key: a.key, body: { runId: s.runId } })).toMatchObject({ status: 409 });
    expect((await clear(h, a.key, 'cave', 2 * 3600000 + 1)).status).toBe(410);
    const b = await h.player('남의런');
    expect((await h.call('POST', '/runs/clear', { key: b.key, body: { runId: s.runId } })).status).toBe(404);
  });
  test('최초 클리어 순번·칭호 구간·정복자·revoke', async () => {
    const h = setup();
    const ps = [await h.player('일등'), await h.player('이등'), await h.player('삼등'), await h.player('사등')];
    const r1 = await clear(h, ps[0].key, 'cave');
    expect(r1.body).toMatchObject({ contentId: 'cave', firstClear: true, rank: 1, newBest: true, newTitles: [{ id: 'first:cave', label: '최초 정복자 · 동굴' }] });
    expect(r1.effects.some(e => 'all' in e.to && (e.message as any).m.kind === 'fame')).toBe(true);
    expect(r1.webhooks[0]).toMatchObject({ kind: 'fame' });
    expect(((await clear(h, ps[1].key, 'cave')).body as any).newTitles[0].id).toBe('pioneer:cave');
    expect(((await clear(h, ps[2].key, 'cave')).body as any).newTitles[0].id).toBe('vanguard:cave');
    const r4 = await clear(h, ps[3].key, 'cave');
    expect(r4.body).toMatchObject({ rank: 4, newTitles: [] });
    expect(r4.effects).toEqual([]);
    // 두 번째 클리어: 순번 유지, 기록 갱신
    const again = (await clear(h, ps[0].key, 'cave', 50000)).body as any;
    expect(again).toMatchObject({ firstClear: false, rank: 1, bestMs: 41000, newBest: false, newTitles: [] });
    // 모든 콘텐츠 정복 → conqueror
    const tower = (await clear(h, ps[0].key, 'tower')).body as any;
    expect(tower.newTitles.map((t: any) => t.id)).toEqual(['first:tower', 'conqueror']);
    const fame = (await h.call('GET', '/fame')).body as any;
    expect(fame.contents[0].first.map((x: any) => x.rank)).toEqual([1, 2, 3, 4]);
    expect(fame.conquest[0]).toMatchObject({ player: { id: ps[0].id }, cleared: 2 });
    expect(fame).toMatchObject({ players: 4, foundersLeft: 0, total: 2 });
    // revoke: 그 사람 기록·칭호만 사라지고 다른 사람 순번은 그대로
    await h.call('POST', '/me/title', { key: ps[0].key, body: { titleId: 'first:cave' } });
    expect((await h.call('POST', '/admin/revoke-clear', { key: ps[1].key, body: { playerId: ps[0].id, contentId: 'cave' } })).status).toBe(403);
    expect((await h.call('POST', '/admin/revoke-clear', { key: ps[1].key, admin: [ps[1].id], body: { playerId: ps[0].id, contentId: 'cave' } })).status).toBe(200);
    const after = (await h.call('GET', '/fame/cave')).body as any;
    expect(after.first.map((x: any) => [x.player.id, x.rank])).toEqual([[ps[1].id, 2], [ps[2].id, 3], [ps[3].id, 4]]);
    const me = (await h.call('GET', '/me', { key: ps[0].key })).body as any;
    expect(me.titles.map((t: any) => t.id)).toEqual(['founder', 'first:tower']);
    expect(me.title).toBeNull();
    expect((await h.call('POST', '/me/title', { key: ps[0].key, body: { titleId: 'first:cave' } })).status).toBe(403);
  });
  test('fame.requireLinked면 미연동 기록은 순위·칭호가 없다', async () => {
    const h = setup({ fame: { requireLinked: true } });
    const a = await h.player('게스트');
    expect((await clear(h, a.key, 'cave')).body).toMatchObject({ rank: 0, newTitles: [] });
    expect(((await h.call('GET', '/fame/cave')).body as any).first).toEqual([]);
  });
});

describe('게시판·신고', () => {
  test('글·공감 토글·관리자 상태·시간당 제한·숨김', async () => {
    const h = setup();
    const a = await h.player('작성자'), admin = await h.player('운영자'), v = await h.player('공감러');
    const post = await h.call('POST', '/board', { key: a.key, body: { category: 'bug', title: '보스가 안 나와요', body: '동굴 2구역', diag: { build: 'abc', fps: 58 } } });
    expect(post.status).toBe(201);
    expect(post.webhooks[0]).toMatchObject({ kind: 'board' });
    const id = (post.body as any).id;
    expect((await h.call('POST', '/board', { key: a.key, body: { category: 'notice', title: '공지', body: '내용' } })).status).toBe(403);
    expect((await h.call('POST', '/board', { key: admin.key, admin: [admin.id], body: { category: 'notice', title: '공지', body: '내용' } })).status).toBe(201);
    expect((await h.call('POST', '/board', { key: a.key, body: { category: 'idea', title: '아이디어', body: 'x', diag: { nested: { a: 1 } } } })).status).toBe(400);
    await h.call('POST', '/board', { key: a.key, body: { category: 'idea', title: '둘째', body: 'x' } });
    await h.call('POST', '/board', { key: a.key, body: { category: 'idea', title: '셋째', body: 'x' } });
    expect((await h.call('POST', '/board', { key: a.key, body: { category: 'idea', title: '넷째', body: 'x' } })).status).toBe(429);
    expect((await h.call('POST', '/board/' + id + '/vote', { key: v.key })).body).toEqual({ voted: true, votes: 1 });
    expect((await h.call('POST', '/board/' + id + '/vote', { key: v.key })).body).toEqual({ voted: false, votes: 0 });
    await h.call('POST', '/board/' + id + '/vote', { key: v.key });
    const top = (await h.call('GET', '/board', { query: 'sort=top', key: v.key })).body as any;
    expect(top.items[0]).toMatchObject({ id, votes: 1, voted: true });
    expect(top.items[0].diag).toBeUndefined();
    expect((await h.call('POST', '/board/' + id + '/moderate', { key: a.key, body: { status: 'planned' } })).status).toBe(403);
    expect((await h.call('POST', '/board/' + id + '/moderate', { key: admin.key, admin: [admin.id], body: { status: 'planned', devReply: '다음 패치' } })).body).toMatchObject({ status: 'planned', devReply: '다음 패치' });
    const c = await h.call('POST', '/board/' + id + '/comment', { key: admin.key, admin: [admin.id], body: { body: '확인했습니다' } });
    expect(c.body).toMatchObject({ dev: true });
    const detail = (await h.call('GET', '/board/' + id, { key: a.key })).body as any;
    expect(detail.post).toMatchObject({ comments: 1, diag: { build: 'abc', fps: 58 } });
    expect(detail.comments[0]).toMatchObject({ dev: true, body: '확인했습니다' });
    await h.call('POST', '/board/' + id + '/moderate', { key: admin.key, admin: [admin.id], body: { hidden: true } });
    expect(((await h.call('GET', '/board')).body as any).items.some((p: any) => p.id === id)).toBe(false);
    expect((await h.call('GET', '/board/' + id)).status).toBe(404);
    // 커서 페이지네이션
    const page1 = (await h.call('GET', '/board', { query: 'category=idea' })).body as any;
    expect(page1.items.map((p: any) => p.title)).toEqual(['셋째', '둘째']);
    expect(page1.nextCursor).toBeNull();
  });
  test('반영 완료 글에 패치노트 글 ID 를 연결하고 상태가 바뀌면 숨긴다(하위 호환)', async () => {
    const h = setup();
    const a = await h.player('작성자'), admin = await h.player('운영자');
    const id = ((await h.call('POST', '/board', { key: a.key, body: { category: 'bug', title: '구르기 버그', body: '꺼져요' } })).body as any).id;
    const mod = (body: unknown) => h.call('POST', '/board/' + id + '/moderate', { key: admin.key, admin: [admin.id], body });
    const view = async () => ((await h.call('GET', '/board/' + id)).body as any).post;
    // 필드가 없던 기존 글: 연결 없음(null)
    expect(await view()).toMatchObject({ status: 'open', patchNoteSlug: null });
    // 반영 완료가 아닐 때 연결은 거부
    expect((await mod({ patchNoteSlug: '2026-10-27-patch-1-0-3' })).status).toBe(400);
    expect((await mod({ status: 'planned', patchNoteSlug: '2026-10-27-patch-1-0-3' })).status).toBe(400);
    // 형식이 틀린 글 ID 는 거부
    for (const slug of ['', 'Has Upper', '../x', 'a/b', 'x'.repeat(81), 7, ['a']]) expect((await mod({ status: 'done', patchNoteSlug: slug })).status).toBe(400);
    // 반영 완료 + 글 ID
    const done = await mod({ status: 'done', patchNoteSlug: '2026-10-27-patch-1-0-3', devReply: '1.0.3 에서 고쳤어요' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'done', patchNoteSlug: '2026-10-27-patch-1-0-3', devReply: '1.0.3 에서 고쳤어요' });
    expect(await view()).toMatchObject({ status: 'done', patchNoteSlug: '2026-10-27-patch-1-0-3' });
    const listed = ((await h.call('GET', '/board')).body as any).items.find((p: any) => p.id === id);
    expect(listed.patchNoteSlug).toBe('2026-10-27-patch-1-0-3');
    // 다른 필드만 바꾸면 연결을 유지한다
    expect((await mod({ devReply: '감사해요' })).body).toMatchObject({ patchNoteSlug: '2026-10-27-patch-1-0-3' });
    // 연결 해제
    expect((await mod({ patchNoteSlug: null })).body).toMatchObject({ status: 'done', patchNoteSlug: null });
    // 다시 연결한 뒤 상태를 되돌리면 연결도 사라진다
    await mod({ patchNoteSlug: '2026-10-27-patch-1-0-3' });
    expect((await mod({ status: 'reviewing' })).body).toMatchObject({ status: 'reviewing', patchNoteSlug: null });
    // 일반 이용자는 바꿀 수 없다
    expect((await h.call('POST', '/board/' + id + '/moderate', { key: a.key, body: { status: 'done', patchNoteSlug: 'x' } })).status).toBe(403);
    // 알 수 없는 필드는 여전히 거부한다
    expect((await mod({ status: 'done', patchNote: 'x' })).status).toBe(400);
  });
  test('가입 24시간 이상·서로 다른 IP의 3명이 실제 채팅을 신고하면 10분 음소거', async () => {
    const h = setup({ worldCapacity: 10 });
    const bad = await h.player('시끄러움');
    const rs = [await h.player('신고일'), await h.player('신고이'), await h.player('신고삼')];
    h.advance(24 * 3600000);
    const { s } = h.connect(bad), ref = msgOf(h.say(s, '신고할 메시지')).id;
    const r1 = await h.call('POST', '/report', { key: rs[0].key, body: { kind: 'chat', target: bad.id, ref, reason: '도배' } });
    await h.call('POST', '/report', { key: rs[0].key, body: { kind: 'chat', target: bad.id, ref, reason: '또' } });
    expect(r1.body).toEqual({ ok: true, autoMuted: false });
    expect(((await h.call('POST', '/report', { key: rs[1].key, body: { kind: 'chat', target: bad.id, ref } })).body as any).autoMuted).toBe(false);
    expect(((await h.call('POST', '/report', { key: rs[2].key, body: { kind: 'chat', target: bad.id, ref } })).body as any).autoMuted).toBe(true);
    expect(errorOf(h.say(s, '안녕'))).toBe('muted');
    h.advance(10 * 60000 + 1);
    expect(msgOf(h.say(s, '안녕'))?.text).toBe('안녕');
    expect((await h.call('POST', '/report', { key: rs[0].key, body: { kind: 'chat', target: rs[0].id } })).status).toBe(400);
  });
});

describe('실시간 채팅', () => {
  test('welcome·금칙어·URL·연속 중복·공백·nonce·간격', async () => {
    const h = setup();
    const a = await h.player('말하기'), b = await h.player('듣기');
    const { s: sa, fx } = h.connect(a);
    const welcome = fx[0].message as any;
    expect(welcome).toMatchObject({ t: 'welcome', world: 'world-1', me: { id: a.id } });
    h.connect(b);
    expect(msgOf(h.say(sa, '너 바 보 같아')).text).toBe('너 *** 같아');
    h.advance(1300);
    expect(msgOf(h.say(sa, '여기 봐 https://evil.example/x 그리고 shop.com'))?.text).toBe('여기 봐 [링크] 그리고 [링크]');
    h.advance(1300);
    expect(errorOf(h.say(sa, '   '))).toBe('length');
    expect(msgOf(h.say(sa, '반복'))).toBeTruthy(); h.advance(1300);
    expect(msgOf(h.say(sa, '반복!'))).toBeTruthy(); h.advance(1300);
    expect(errorOf(h.say(sa, '반 복'))).toBe('repeat'); h.advance(1300);
    const fx1 = h.say(sa, '하나', 'world-1', 'same-nonce'); h.advance(1300);
    expect(msgOf(fx1)).toBeTruthy();
    expect(h.say(sa, '둘', 'world-1', 'same-nonce')).toEqual([]);
    // 10초 안에 5개를 보냈으니 묶음 제한에 걸린다. 창이 지나면 다시 된다.
    expect(errorOf(h.say(sa, '셋'))).toBe('rate');
    h.advance(10000);
    expect(errorOf(h.say(sa, '셋'))).toBeUndefined();
    expect(errorOf(h.say(sa, '넷'))).toBe('rate'); // 최소 간격 1.2초
    expect(errorOf(h.say(sa, '남의 채널', 'world-2'))).toBe('not-joined');
    // 나중에 들어온 사람은 history를 받는다
    const late = await h.player('늦게옴');
    const w = h.connect(late).fx[0].message as any;
    expect(w.world).toBe('world-2'); // 정원 2명이라 다음 채널
    expect(w.history['world-2']).toEqual([]);
    const join = h.core.message(h.sessions[2], JSON.stringify({ t: 'join', channel: 'world-1' }));
    expect(errorOf(join)).toBe('full');
  });
  test('차단한 사람의 채팅은 받지 않는다', async () => {
    const h = setup();
    const a = await h.player('차단자'), b = await h.player('대상자');
    await h.call('POST', '/blocks', { key: a.key, body: { playerId: b.id, blocked: true } });
    h.connect(a);
    const { s: sb } = h.connect(b);
    const fx = h.say(sb, '안녕하세요');
    expect(fx[0]).toMatchObject({ to: { channel: 'world-1' }, exclude: [a.id] });
  });
  test('귓속말은 친구만, 오프라인은 보관함으로', async () => {
    const h = setup();
    const a = await h.player('귓말러'), b = await h.player('친구비'), c = await h.player('모르는');
    await h.call('POST', '/friends/request', { key: a.key, body: { playerId: b.id } });
    await h.call('POST', '/friends/respond', { key: b.key, body: { playerId: a.id, accept: true } });
    const { s: sa } = h.connect(a);
    const w = (to: string, text: string) => h.core.message(sa, JSON.stringify({ t: 'whisper', to, text, nonce: 'w' + randomHex(6) }));
    expect(errorOf(w(c.id, '안녕'))).toBe('not-friend');
    expect(w(b.id, '오프라인 안녕').map(e => e.to)).toEqual([{ player: a.id }]);
    expect(h.core.message(sa, JSON.stringify({ t: 'invite', to: b.id, partyCode: 'ABCDEF0123456789ABCD' })).length).toBe(1);
    const welcome = h.connect(b).fx[0].message as any;
    expect(welcome.inbox.map((m: any) => [m.kind, m.text])).toEqual([['system', '새 친구 요청이 도착했습니다.'], ['whisper', '오프라인 안녕'], ['invite', '귓말러님이 파티에 초대했습니다.']]);
    expect(welcome.inbox[2].data).toEqual({ partyCode: 'ABCDEF0123456789ABCD' });
    h.advance(1300);
    expect(w(b.id, '이제 온라인').map(e => e.to)).toEqual([{ player: a.id }, { player: b.id }]);
    const again = h.connect(b).fx[0].message as any;
    expect(again.inbox).toEqual([]);
  });
  test('접속·종료 presence가 친구에게 간다', async () => {
    const h = setup();
    const a = await h.player('접속자'), b = await h.player('지켜봄');
    await h.call('POST', '/friends/request', { key: a.key, body: { playerId: b.id } });
    await h.call('POST', '/friends/respond', { key: b.key, body: { playerId: a.id, accept: true } });
    h.connect(b);
    const { s, fx } = h.connect(a);
    expect(fx.find(e => e.message?.t === 'presence')).toMatchObject({ to: { player: b.id }, message: { id: a.id, online: true } });
    expect((h.core.message(s, JSON.stringify({ t: 'presence', presence: { state: 'battle', where: '동굴' } })))[0]).toMatchObject({ message: { presence: { state: 'battle', where: '동굴' } } });
    expect(errorOf(h.core.message(s, JSON.stringify({ t: 'presence', presence: { state: 'lobby' } })))).toBe('rate');
    s.closed = true;
    expect(h.core.close(s)).toEqual([{ to: { player: b.id }, message: { t: 'presence', id: a.id, online: false, presence: null } }]);
  });
});

describe('파티 모집', () => {
  test('생성 시 광장 알림, 10분 TTL, 차단 필터', async () => {
    const h = setup();
    const host = await h.player('호스트'), viewer = await h.player('구경꾼'), blocker = await h.player('차단러');
    await h.call('POST', '/blocks', { key: blocker.key, body: { playerId: host.id, blocked: true } });
    const body = { partyCode: 'ABCDEF0123456789ABCD', contentId: 'cave', note: '같이 가요', slots: 4, members: 1 };
    const r = await h.call('POST', '/listings', { key: host.key, body });
    expect(r.status).toBe(201);
    expect(r.effects[0]).toMatchObject({ to: { worlds: true }, exclude: [blocker.id] });
    expect((await h.call('POST', '/listings', { key: host.key, body: { ...body, members: 2 } })).effects).toEqual([]);
    expect((await h.call('POST', '/listings', { key: host.key, body: { ...body, partyCode: 'bad' } })).status).toBe(400);
    expect((await h.call('POST', '/listings', { key: host.key, body: { ...body, members: 5 } })).status).toBe(400);
    expect(((await h.call('GET', '/listings', { key: viewer.key })).body as any).items[0]).toMatchObject({ members: 2, host: { id: host.id } });
    expect(((await h.call('GET', '/listings', { key: blocker.key })).body as any).items).toEqual([]);
    h.advance(10 * 60000 + 1);
    expect(((await h.call('GET', '/listings', { key: viewer.key })).body as any).items).toEqual([]);
  });
});

