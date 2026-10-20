import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SocialCore, type Effect } from '../src/server/core';
import { randomHex, sha256Hex } from '../src/server/hub';
import type { GameConfig, Session } from '../src/shared/protocol';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const CONFIG: GameConfig = {
  gameId: 'security-test', worldChannels: 1, worldCapacity: 10,
  contents: [{ id: 'cave', name: '동굴', minClearSec: 40 }],
  titleTiers: [{ id: 'first', maxRank: 1, label: '최초' }, { id: 'pioneer', maxRank: 10, label: '선구자' }],
  founders: { maxNo: 0, titleId: 'founder', label: '창립' },
  completion: { titleId: 'conqueror', label: '정복자' }, dmFriendsOnly: false,
  chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 2 }, bannedWords: [],
};
const newKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const code = 'ABCDEF0123456789ABCD';
const summary = (elapsedMs = 50000) => ({ elapsedMs, kills: 20, roomsCleared: 3, bossDefeated: true, hpLost: 10 });
const errorOf = (fx: Effect[]) => fx.find(e => e.message?.t === 'error')?.message?.code;
const msgOf = (fx: Effect[]) => (fx.find(e => e.message?.t === 'msg')?.message as any)?.m;

function harness(over: Partial<GameConfig> = {}) {
  const db = new Database(':memory:');
  let now = 1_800_000_000_000;
  const sessions: Session[] = [];
  const deps = {
    sql: { exec: (q: string, ...b: any[]) => { const rows = db.query(q).all(...b); return { toArray: () => rows }; } },
    config: { ...CONFIG, ...over }, now: () => now, randomHex, sha256Hex,
    transaction: <T>(fn: () => T) => db.transaction(fn)() as T, live: () => sessions,
    // 토큰의 서명 검증은 server-auth에서 검사하며 여기서는 검증 후 subject 경계를 고정한다.
    verifyIdToken: async (_provider: string, token: string) => ({ sub: token }),
  };
  let core = new SocialCore(deps);
  const call = (method: string, path: string, key?: string, body?: unknown, extra: { ip?: string; query?: string; admin?: string[] } = {}) =>
    core.handle({ method, path, key: key ?? null, body, ipHash: extra.ip ?? 'request-ip', query: new URLSearchParams(extra.query), adminIds: extra.admin ?? [], clientIds: ['test-client'] });
  const player = async (name: string, ip = 'ip-' + name) => {
    const key = newKey();
    const res = await call('POST', '/profile', key, { name }, { ip });
    expect(res.status).toBe(201);
    return { key, keyHash: await core.keyHash(key), id: (res.body as any).id as string };
  };
  const connect = (p: { id: string; keyHash: string }) => {
    const s = core.openSession(p.id, randomHex(8), p.keyHash);
    sessions.push(s);
    const fx = core.message(s, JSON.stringify({ t: 'hello' }));
    return { s, fx };
  };
  const send = (s: Session, m: unknown) => core.message(s, JSON.stringify(m));
  const say = (s: Session, text = '확인', channel = s.world) => send(s, { t: 'say', channel, text, nonce: randomHex(8) });
  const start = (key: string) => call('POST', '/runs/start', key, { contentId: 'cave', mode: 'solo' });
  const clear = async (key: string, withSummary = true) => {
    const r = await start(key);
    expect(r.status).toBe(201);
    now += 50000;
    return call('POST', '/runs/clear', key, { runId: (r.body as any).runId, ...(withSummary ? { summary: summary() } : {}) });
  };
  const link = (key: string, sub = 'google-sub') => call('POST', '/auth/link', key, { provider: 'google', idToken: sub });
  const report = (key: string, target: string, ref?: string) => call('POST', '/report', key, { kind: 'chat', target, ...(ref === undefined ? {} : { ref }) });
  const friends = async (a: { key: string; id: string }, b: { key: string; id: string }) => {
    await call('POST', '/friends/request', a.key, { playerId: b.id });
    await call('POST', '/friends/respond', b.key, { playerId: a.id, accept: true });
  };
  return { db, call, player, connect, send, say, start, clear, link, report, friends, sessions,
    advance: (ms: number) => { now += ms; }, now: () => now, wake: () => { core = new SocialCore(deps); }, get core() { return core; } };
}

describe('P1-1 런 남용 완화와 관리자 감사', () => {
  test('런 시작은 열린 런 정리·절전과 관계없이 시간당 30개', async () => {
    const h = harness(), a = await h.player('출격');
    for (let i = 0; i < 30; i++) expect((await h.start(a.key)).status).toBe(201);
    h.wake();
    expect(await h.start(a.key)).toMatchObject({ status: 429, body: { error: 'rate' } });
    expect((h.db.query('SELECT COUNT(*) AS n FROM runs').get() as any).n).toBe(5);
    h.advance(HOUR + 1);
    expect((await h.start(a.key)).status).toBe(201);
  });
  test('summary 저장·관리자만 최근 및 1~10위 감사 조회, 공개 응답에는 비노출', async () => {
    const h = harness(), a = await h.player('감사기록');
    expect((await h.clear(a.key)).status).toBe(200);
    const row = h.db.query('SELECT summary FROM clears').get() as any;
    expect(JSON.parse(row.summary)).toEqual(summary());
    expect((await h.call('GET', '/admin/clears', a.key, undefined, { query: 'contentId=cave' })).status).toBe(403);
    expect((await h.call('GET', '/admin/clears', undefined, undefined, { query: 'contentId=cave' })).status).toBe(401);
    const audit = await h.call('GET', '/admin/clears', a.key, undefined, { query: 'contentId=cave', admin: [a.id] });
    expect(audit.status).toBe(200);
    expect((audit.body as any).recent[0]).toMatchObject({ player: { id: a.id }, rank: 1, summary: summary() });
    expect((audit.body as any).top[0]).toMatchObject({ rank: 1, summary: summary() });
    expect(JSON.stringify((await h.call('GET', '/fame')).body)).not.toContain('hpLost');
  });
  test.each([40000, 60000])('서버 경과 50초의 ±20%% 경계 %i ms 허용', async elapsedMs => {
    const h = harness(), a = await h.player('경계');
    const r = await h.start(a.key); h.advance(50000);
    expect((await h.call('POST', '/runs/clear', a.key, { runId: (r.body as any).runId, summary: summary(elapsedMs) })).status).toBe(200);
  });
  test.each([
    { bossDefeated: false }, { bossDefeated: 'true' }, { bossDefeated: undefined },
    { elapsedMs: 39999 }, { elapsedMs: 60001 }, { elapsedMs: -1 }, { elapsedMs: Infinity },
    { kills: -1 }, { kills: 1e9 }, { kills: 1.5 }, { roomsCleared: -1 }, { roomsCleared: 1e9 },
    { hpLost: -1 }, { hpLost: 1e12 }, { extra: true },
  ])('잘못된 summary 거부 후 같은 런으로 정상 재시도: %j', async patch => {
    const h = harness(), a = await h.player('검증');
    const r = await h.start(a.key); h.advance(50000);
    const body = { runId: (r.body as any).runId, summary: { ...summary(), ...patch } };
    expect((await h.call('POST', '/runs/clear', a.key, body)).status).toBe(400);
    expect((h.db.query('SELECT COUNT(*) AS n FROM clears').get() as any).n).toBe(0);
    expect((await h.call('POST', '/runs/clear', a.key, { ...body, summary: summary() })).status).toBe(200);
  });
  test('summary 생략 호환과 게임이 지정한 최소 시간 유지', async () => {
    const h = harness({ contents: [{ id: 'cave', name: '동굴', minClearSec: 60 }] });
    const a = await h.player('게임설정');
    const r = await h.start(a.key); h.advance(50000);
    expect((await h.call('POST', '/runs/clear', a.key, { runId: (r.body as any).runId })).status).toBe(422);
    h.advance(10000);
    expect((await h.call('POST', '/runs/clear', a.key, { runId: (r.body as any).runId })).status).toBe(200);
  });
});

describe('P1-2 기기 키 수명과 소켓', () => {
  test('삭제된 기기 키가 발급한 미사용 티켓으로 업그레이드할 수 없다', async () => {
    const h = harness(), a = await h.player('폐기티켓');
    const r = await h.call('POST', '/ws-ticket', a.key);
    h.db.query('DELETE FROM player_keys WHERE key_hash = ?').run(a.keyHash);
    expect(() => h.core.consumeTicket((r.body as any).ticket)).toThrow();
  });
  test('recover에서 밀려난 키의 티켓과 hello 전후 소켓을 회수하고 남은 키는 유지', async () => {
    const h = harness(), a = await h.player('키복구');
    await h.link(a.key);
    const { s } = h.connect(a);
    const pending = h.core.openSession(a.id, 'before-hello', a.keyHash); h.sessions.push(pending);
    await h.call('POST', '/ws-ticket', a.key);
    let result: any;
    let newest = '';
    for (let i = 0; i < 5; i++) {
      h.advance(1000); newest = newKey();
      result = await h.call('POST', '/auth/recover', undefined, { provider: 'google', idToken: 'google-sub', deviceKey: newest });
      expect(result.status).toBe(200);
    }
    expect(result.effects).toContainEqual({ to: { keyHash: a.keyHash }, close: { code: 4001, reason: 'key-revoked' } });
    expect((h.db.query('SELECT COUNT(*) AS n FROM ws_tickets').get() as any).n).toBe(0);
    h.wake();
    for (const session of [s, pending]) {
      const fx = h.send(session, { t: 'ping' });
      expect(errorOf(fx)).toBe('key-revoked');
      expect(fx.some(e => e.close?.code === 4001)).toBe(true);
    }
    expect((await h.call('GET', '/me', newest)).status).toBe(200);
  });
  test('unlink은 기기 키·소켓·이미 발급한 티켓을 회수하지 않는다', async () => {
    const h = harness(), a = await h.player('연동해제');
    await h.link(a.key); const { s } = h.connect(a);
    const r = await h.call('POST', '/ws-ticket', a.key);
    expect((await h.call('POST', '/auth/unlink', a.key, { provider: 'google' })).effects).toEqual([]);
    expect(h.send(s, { t: 'ping' })[0].message).toEqual({ t: 'pong' });
    expect(() => h.core.consumeTicket((r.body as any).ticket)).not.toThrow();
  });
});

describe('P1-3 모집 방송', () => {
  const listing = { partyCode: code, contentId: 'cave', note: '함께', slots: 4, members: 1 };
  test('생성·삭제 반복 및 절전에도 10분에 방송 한 번', async () => {
    const h = harness(), a = await h.player('모집');
    expect((await h.call('POST', '/listings', a.key, listing)).effects).toHaveLength(1);
    await h.call('DELETE', '/listings', a.key); h.wake();
    const again = await h.call('POST', '/listings', a.key, listing);
    expect(again.status).toBe(201); expect(again.effects).toEqual([]);
    await h.call('DELETE', '/listings', a.key); h.advance(600001);
    expect((await h.call('POST', '/listings', a.key, listing)).effects).toHaveLength(1);
  });
  test('음소거·밴이면 신규 모집과 갱신 모두 거부', async () => {
    const h = harness(), a = await h.player('제한모집');
    h.db.query('UPDATE players SET muted_until = ? WHERE id = ?').run(h.now() + HOUR, a.id);
    expect(await h.call('POST', '/listings', a.key, listing)).toMatchObject({ status: 403, body: { error: 'muted' } });
    h.db.query('UPDATE players SET muted_until = 0, banned = 1 WHERE id = ?').run(a.id);
    expect(await h.call('POST', '/listings', a.key, listing)).toMatchObject({ status: 403, body: { error: 'banned' } });
  });
});

describe('P1-4 신고 검증과 자동 음소거', () => {
  test('chat ref 필수·실제 작성자 검증, 허위 신고는 저장도 하지 않는다', async () => {
    const h = harness(), a = await h.player('대상'), b = await h.player('신고자'), c = await h.player('다른작성자');
    const foreign = msgOf(h.say(h.connect(c).s));
    for (const ref of [undefined, '', 'not-a-message', foreign.id]) expect((await h.report(b.key, a.id, ref)).status).toBe(400);
    expect((h.db.query('SELECT COUNT(*) AS n FROM reports').get() as any).n).toBe(0);
  });
  test('가입 하루 미만 3명의 실제 신고는 검토용으로만 남는다', async () => {
    const h = harness(), a = await h.player('새계정대상');
    const rs = [await h.player('신고하나'), await h.player('신고둘'), await h.player('신고셋')];
    const m = msgOf(h.say(h.connect(a).s));
    for (const r of rs) expect((await h.report(r.key, a.id, m.id)).body).toEqual({ ok: true, autoMuted: false });
    expect((h.db.query('SELECT COUNT(*) AS n FROM reports').get() as any).n).toBe(3);
  });
  test('가입 하루 이상이어도 생성 IP 해시가 같으면 자동 음소거하지 않는다', async () => {
    const h = harness(), a = await h.player('같은망대상');
    const rs = [await h.player('동일일', 'same'), await h.player('동일이', 'same'), await h.player('동일삼', 'same')];
    h.advance(DAY);
    const m = msgOf(h.say(h.connect(a).s));
    for (const r of rs) expect((await h.report(r.key, a.id, m.id)).body).toEqual({ ok: true, autoMuted: false });
  });
  test('세 명·서로 다른 생성 IP·가입 24시간 이상일 때만 10분 자동 음소거', async () => {
    const h = harness(), a = await h.player('확인대상');
    const rs = [await h.player('성숙일'), await h.player('성숙이'), await h.player('성숙삼')];
    h.advance(DAY);
    const { s } = h.connect(a), m = msgOf(h.say(s));
    expect((await h.report(rs[0].key, a.id, m.id)).body).toMatchObject({ autoMuted: false });
    expect((await h.report(rs[0].key, a.id, m.id)).body).toMatchObject({ autoMuted: false });
    expect((await h.report(rs[1].key, a.id, m.id)).body).toMatchObject({ autoMuted: false });
    expect((await h.report(rs[2].key, a.id, m.id)).body).toMatchObject({ autoMuted: true });
    h.advance(1300); expect(errorOf(h.say(s, '음소거 확인'))).toBe('muted');
    h.advance(600001); expect(msgOf(h.say(s, '해제 확인'))).toBeTruthy();
  });
  test('history에서 밀려난 광장·파티·귓속말도 최근 200개 검증 기록으로 신고 가능', async () => {
    const h = harness(), a = await h.player('기록대상'), b = await h.player('기록신고');
    const { s } = h.connect(a), old = msgOf(h.say(s, '첫말'));
    for (let i = 0; i < 3; i++) { h.advance(11000); h.say(s, '다른말' + i); }
    expect(h.db.query('SELECT id FROM chat_log WHERE id = ?').get(old.id)).toBeNull();
    expect((await h.report(b.key, a.id, old.id)).status).toBe(201);
    h.send(s, { t: 'join', channel: 'party:' + code }); h.advance(1300);
    const party = msgOf(h.say(s, '파티말', 'party:' + code));
    expect((await h.report(b.key, a.id, party.id)).status).toBe(201);
    h.advance(1300);
    const dm = msgOf(h.send(s, { t: 'whisper', to: b.id, text: '비밀말', nonce: randomHex(8) }));
    expect((await h.report(b.key, a.id, dm.id)).status).toBe(201);
    h.wake(); h.advance(DAY + 1);
    expect((await h.report(b.key, a.id, old.id)).status).toBe(400);
  });
  test('검증용 최근 메시지는 200개 상한과 24시간 TTL을 지킨다', async () => {
    const h = harness(), a = await h.player('최근기록'); const { s } = h.connect(a);
    const first = msgOf(h.say(s, '첫메시지'));
    for (let i = 0; i < 205; i++) { h.advance(11000); h.say(s, '내용' + i); }
    expect((h.db.query('SELECT COUNT(*) AS n FROM recent_messages').get() as any).n).toBe(200);
    expect(h.db.query('SELECT id FROM recent_messages WHERE id = ?').get(first.id)).toBeNull();
    h.advance(DAY + 1); h.say(s, '다음날');
    expect((h.db.query('SELECT COUNT(*) AS n FROM recent_messages').get() as any).n).toBe(1);
  });
});

describe('P2-5 귓속말·초대 제한', () => {
  test('귓속말과 광장 채팅이 간격·반복·묶음 제한을 공유한다', async () => {
    const h = harness(), a = await h.player('발신'), b = await h.player('수신'); const { s } = h.connect(a);
    const whisper = (text: string) => h.send(s, { t: 'whisper', to: b.id, text, nonce: randomHex(8) });
    expect(msgOf(whisper('반복'))).toBeTruthy();
    expect(errorOf(h.say(s, '간격우회'))).toBe('rate');
    h.advance(1300); expect(msgOf(whisper('반복!'))).toBeTruthy();
    h.advance(1300); expect(errorOf(whisper('반 복'))).toBe('repeat');
    for (let i = 0; i < 3; i++) { h.advance(1300); expect(msgOf(whisper('다름' + i))).toBeTruthy(); }
    h.advance(1300); expect(errorOf(whisper('묶음초과'))).toBe('rate');
    h.advance(10001); expect(msgOf(whisper('다시'))).toBeTruthy();
  });
  test('초대는 플레이어당 분당 10회이며 새 소켓·절전으로 초기화되지 않는다', async () => {
    const h = harness(), a = await h.player('초대'), b = await h.player('친구'); await h.friends(a, b);
    let { s } = h.connect(a);
    const invite = () => h.send(s, { t: 'invite', to: b.id, partyCode: code });
    for (let i = 0; i < 10; i++) { expect(msgOf(invite())).toBeTruthy(); h.advance(1001); }
    h.wake(); s = h.connect(a).s;
    expect(errorOf(invite())).toBe('rate');
    h.advance(60001); expect(msgOf(invite())).toBeTruthy();
  });
  test('음소거는 귓속말·초대 모두 거부한다', async () => {
    const h = harness(), a = await h.player('무음'), b = await h.player('친구'); await h.friends(a, b); const { s } = h.connect(a);
    h.db.query('UPDATE players SET muted_until = ? WHERE id = ?').run(h.now() + HOUR, a.id);
    expect(errorOf(h.send(s, { t: 'whisper', to: b.id, text: '우회', nonce: randomHex(8) }))).toBe('muted');
    expect(errorOf(h.send(s, { t: 'invite', to: b.id, partyCode: code }))).toBe('muted');
  });
});

describe('P2-6 오프라인 보관함 차단', () => {
  test('차단 시 상대의 대기 귓속말·초대·친구 알림을 삭제한다', async () => {
    const h = harness(), a = await h.player('차단발신'), b = await h.player('차단수신'); await h.friends(a, b);
    const { s } = h.connect(a);
    h.send(s, { t: 'whisper', to: b.id, text: '대기메시지', nonce: randomHex(8) });
    h.send(s, { t: 'invite', to: b.id, partyCode: code });
    expect((h.db.query('SELECT COUNT(*) AS n FROM dm_inbox WHERE to_id = ?').get(b.id) as any).n).toBe(3);
    await h.call('POST', '/blocks', b.key, { playerId: a.id, blocked: true });
    expect((h.db.query('SELECT COUNT(*) AS n FROM dm_inbox WHERE to_id = ?').get(b.id) as any).n).toBe(0);
    expect((h.connect(b).fx[0].message as any).inbox).toEqual([]);
  });
  test('전달 직전에도 기존 차단과 양방향 차단을 다시 검사하며 정상 발신자는 보존', async () => {
    const h = harness(), a = await h.player('옛발신'), b = await h.player('보관수신'), c = await h.player('정상발신');
    for (const p of [a, c]) {
      h.send(h.connect(p).s, { t: 'whisper', to: b.id, text: p.id, nonce: randomHex(8) });
    }
    // 마이그레이션 이전 보관함이나 다른 경로로 생긴 차단 상태를 재현한다.
    h.db.query('INSERT INTO blocks(owner, target) VALUES (?, ?)').run(a.id, b.id);
    const inbox = (h.connect(b).fx[0].message as any).inbox;
    expect(inbox.map((m: any) => m.from.id)).toEqual([c.id]);
    expect((h.db.query('SELECT COUNT(*) AS n FROM dm_inbox WHERE to_id = ?').get(b.id) as any).n).toBe(0);
  });
});

describe('P2-7 계정별 순위와 재연동 쿨다운', () => {
  test('해제 후 다른 프로필 연동은 30일 제한, 같은 프로필은 즉시 복구 가능', async () => {
    const h = harness(), a = await h.player('원계정'), b = await h.player('다른계정');
    await h.link(a.key); await h.call('POST', '/auth/unlink', a.key, { provider: 'google' }); h.wake();
    expect(await h.link(b.key)).toMatchObject({ status: 429, body: { error: 'link-cooldown' } });
    expect((await h.link(a.key)).status).toBe(200);
    await h.call('POST', '/auth/unlink', a.key, { provider: 'google' });
    h.advance(30 * DAY - 1); expect((await h.link(b.key)).status).toBe(429);
    h.advance(1); expect((await h.link(b.key)).status).toBe(200);
  });
  test('쿨다운 이후에도 같은 subject는 같은 콘텐츠 순위를 두 번 받지 못한다', async () => {
    const h = harness({ fame: { requireLinked: true } }), a = await h.player('첫순위'), b = await h.player('중복순위');
    await h.link(a.key); expect((await h.clear(a.key, false)).body).toMatchObject({ rank: 1 });
    await h.call('POST', '/auth/unlink', a.key, { provider: 'google' }); h.advance(30 * DAY);
    expect((await h.link(b.key)).status).toBe(200);
    expect((await h.clear(b.key, false)).body).toMatchObject({ rank: 0, newTitles: [] });
    expect((h.db.query('SELECT subject_hash FROM clears WHERE player_id = ?').get(a.id) as any).subject_hash).toBe(await sha256Hex('google-sub'));
    // 관리자가 취소한 순위도 같은 계정으로 다시 선점하지 못한다.
    await h.call('POST', '/admin/revoke-clear', b.key, { playerId: a.id, contentId: 'cave' }, { admin: [b.id] });
    expect((await h.clear(b.key, false)).body).toMatchObject({ rank: 0 });
  });
});

describe('P2-8 연동 후 정식 순위 승격', () => {
  test('rank=0 기록을 유효 재클리어 트랜잭션에서 한 번만 승격하고 칭호·정복자 부여', async () => {
    const h = harness({ fame: { requireLinked: true } }), a = await h.player('늦은연동');
    expect((await h.clear(a.key, false)).body).toMatchObject({ rank: 0 });
    const start = await h.start(a.key);
    await h.link(a.key);
    expect((await h.call('POST', '/runs/clear', a.key, { runId: (start.body as any).runId })).status).toBe(422);
    expect((h.db.query('SELECT rank FROM clears').get() as any).rank).toBe(0);
    h.advance(50000);
    const result = await h.call('POST', '/runs/clear', a.key, { runId: (start.body as any).runId });
    expect(result.body).toMatchObject({ firstClear: false, rank: 1 });
    expect((result.body as any).newTitles.map((t: any) => t.id)).toEqual(['first:cave', 'conqueror']);
    expect((await h.clear(a.key, false)).body).toMatchObject({ rank: 1, newTitles: [] });
    expect((h.db.query('SELECT count FROM clears').get() as any).count).toBe(3);
  });
});

describe('P2-9 WS 티켓 자원 상한', () => {
  test('플레이어당 미사용 최대 5개, 같은 시각에 발급해도 오래된 순으로 폐기', async () => {
    const h = harness(), a = await h.player('티켓상한'); const tickets: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await h.call('POST', '/ws-ticket', a.key);
      expect(r.status).toBe(200); tickets.push((r.body as any).ticket);
    }
    expect((h.db.query('SELECT COUNT(*) AS n FROM ws_tickets').get() as any).n).toBe(5);
    expect(() => h.core.consumeTicket(tickets[0])).toThrow();
    expect(() => h.core.consumeTicket(tickets[1])).not.toThrow();
    expect(() => h.core.consumeTicket(tickets[1])).toThrow();
  });
  test('분당 20개 제한은 소비·절전으로 우회 불가, 발급 때 만료 티켓 정리', async () => {
    const h = harness(), a = await h.player('티켓속도');
    for (let i = 0; i < 20; i++) {
      const r = await h.call('POST', '/ws-ticket', a.key);
      expect(r.status).toBe(200); h.core.consumeTicket((r.body as any).ticket);
    }
    h.wake(); expect((await h.call('POST', '/ws-ticket', a.key)).status).toBe(429);
    h.advance(60001);
    const r = await h.call('POST', '/ws-ticket', a.key); expect(r.status).toBe(200);
    h.advance(60001); expect((await h.call('POST', '/ws-ticket', a.key)).status).toBe(200);
    expect(h.db.query('SELECT ticket FROM ws_tickets WHERE ticket = ?').get((r.body as any).ticket)).toBeNull();
  });
});

describe('P2-10 광장 정원', () => {
  test('hello는 꽉 찬 광장을 넘치게 하지 않고 world:null, 파티·DM은 유지', async () => {
    const h = harness({ worldCapacity: 1 }), a = await h.player('선착순'), b = await h.player('대기자');
    h.connect(a); const { s, fx } = h.connect(b);
    expect(fx[0].message).toMatchObject({ t: 'welcome', world: null, channels: [{ id: 'world-1', count: 1 }], history: {} });
    expect(errorOf(fx)).toBe('full'); expect(s.hello).toBe(true);
    expect(h.core.channelCounts()).toEqual([{ id: 'world-1', count: 1 }]);
    expect(errorOf(h.send(s, { t: 'join', channel: 'world-1' }))).toBe('full');
    expect(errorOf(h.send(s, { t: 'join', channel: 'party:' + code }))).toBeUndefined();
    expect(msgOf(h.say(s, '파티는 가능', 'party:' + code))).toBeTruthy();
    h.advance(1300);
    expect(msgOf(h.send(s, { t: 'whisper', to: a.id, text: '귓말도 가능', nonce: randomHex(8) }))).toBeTruthy();
    h.sessions[0].closed = true;
    expect(errorOf(h.send(s, { t: 'join', channel: 'world-1' }))).toBeUndefined();
    expect(s.world).toBe('world-1');
  });
});
