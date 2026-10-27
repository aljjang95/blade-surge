import {
  AUTH_PROVIDERS, DEVICE_KEY, NONCE, POST_CATEGORIES, POST_STATUSES, SOCIAL_LIMITS, WS_TICKET,
  type GameConfig, type Msg, type PublicMini, type Session, type Title,
} from '../shared/protocol';
import {
  SocialError, bool, channel as parseChannel, diagnostics, integer, object, partyCode, playerId as parsePlayerId,
  playerHero, playerName, presence as parsePresence, runSummary, text,
} from '../shared/validation';
import { filterChat, maskBanned } from '../shared/filter';
import { titleForRank, titleLabel } from '../shared/titles';
import { migrate, type Sql } from './schema';

export type Target = { sid: string } | { player: string } | { keyHash: string } | { channel: string } | { worlds: true } | { all: true };
export interface Effect { to: Target; message?: Record<string, unknown>; close?: { code: number; reason: string }; exclude?: string[] }
export interface Webhook { kind: 'board' | 'fame'; title: string; description: string }
export interface CoreResult { status: number; body: unknown; effects: Effect[]; webhooks: Webhook[] }
export interface CoreRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  key: string | null;
  ipHash: string;
  adminIds: string[];
  clientIds: string[];
}
export interface CoreDeps {
  sql: Sql;
  config: GameConfig;
  now(): number;
  randomHex(bytes: number): string;
  sha256Hex(value: string): Promise<string>;
  transaction?<T>(fn: () => T): T;
  live?(): Session[];
  verifyIdToken?(provider: string, token: string, clientIds: string[]): Promise<{ sub: string }>;
}
interface Ctx { req: CoreRequest; keyHash: string | null; out: CoreResult; pre: { subjectHash?: string; deviceKeyHash?: string } }

const HOUR = 3600000;
const DAY = 24 * HOUR;
/** 소식 글 id(게임의 content/news 파일 이름). 게임 비종속 패키지라 형식만 검사한다. */
const PATCH_NOTE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const LIMITS = { friends: 100, incoming: 50, blocks: 200, openRuns: 5, inbox: 100, keys: 5, sockets: 3, perSecond: 10, presenceMs: 2000, nonceMs: 600000 };
const ADMIN_PATHS = new Set(['/admin/mute', '/admin/ban', '/admin/revoke-clear']);

const josa = (word: string, withFinal: string, withoutFinal: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? withFinal : withoutFinal;
};
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** 게임 비종속 커뮤니티 로직. 저장소·시계·난수·해시는 주입받고 DO는 얇은 어댑터만 맡는다. */
export class SocialCore {
  private second = new Map<string, { s: number; n: number }>();
  private burst = new Map<string, number[]>();
  constructor(private readonly d: CoreDeps) { this.tx(() => migrate(d.sql)); }

  private all(query: string, ...bindings: unknown[]): any[] { return this.d.sql.exec(query, ...bindings).toArray(); }
  private one(query: string, ...bindings: unknown[]): any { return this.all(query, ...bindings)[0]; }
  private run(query: string, ...bindings: unknown[]): void { this.d.sql.exec(query, ...bindings).toArray(); }
  private tx<T>(fn: () => T): T { return this.d.transaction ? this.d.transaction(fn) : fn(); }
  private get config(): GameConfig { return this.d.config; }
  private id(): string { return this.d.randomHex(8); }

  async keyHash(key: string): Promise<string> {
    if (typeof key !== 'string' || !DEVICE_KEY.test(key)) throw new SocialError('bad-key', 401);
    return this.d.sha256Hex(this.config.gameId + ':' + key);
  }

  /** REST 요청 하나. 비동기 해시·토큰 검증을 먼저 끝내고 저장소 작업은 한 동기 트랜잭션으로 묶는다. */
  async handle(req: CoreRequest): Promise<CoreResult> {
    const out: CoreResult = { status: 200, body: null, effects: [], webhooks: [] };
    try {
      const keyHash = req.key === null ? null : await this.keyHash(req.key);
      const pre: Ctx['pre'] = {};
      if (req.method === 'POST' && (req.path === '/auth/link' || req.path === '/auth/recover')) {
        if (!req.clientIds.length || !this.d.verifyIdToken) throw new SocialError('link-disabled', 503);
        const body = object(req.body, req.path === '/auth/link' ? ['provider', 'idToken'] : ['provider', 'idToken', 'deviceKey']);
        if (!(AUTH_PROVIDERS as readonly string[]).includes(body.provider)) throw new SocialError('provider');
        if (typeof body.idToken !== 'string' || body.idToken.length > 4096) throw new SocialError('bad-token', 401);
        if (req.path === '/auth/recover') {
          // 시도 자체를 센다(검증 실패도 포함). 트랜잭션 밖에서 기록해 롤백되지 않게 한다.
          this.limit('recover:' + req.ipHash, 10, HOUR);
          pre.deviceKeyHash = await this.keyHash(body.deviceKey);
        } else if (!keyHash) throw new SocialError('bad-key', 401);
        const { sub } = await this.d.verifyIdToken(body.provider, body.idToken, req.clientIds);
        pre.subjectHash = await this.d.sha256Hex(sub);
      }
      out.body = this.tx(() => this.route({ req, keyHash, out, pre }));
    } catch (error) {
      if (!(error instanceof SocialError)) throw error;
      out.status = error.status;
      out.body = { error: error.code, ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}) };
      out.effects = []; out.webhooks = [];
    }
    return out;
  }

  private route(c: Ctx): unknown {
    const { method, path } = c.req;
    const m = (re: RegExp) => path.match(re);
    if (method === 'GET') {
      if (path === '/me') return this.getMe(this.me(c.keyHash), c);
      if (path === '/players/lookup') return this.lookup(c);
      let hit = m(/^\/players\/(p_[a-f0-9]{24})$/);
      if (hit) return this.publicProfile(hit[1], this.me(c.keyHash));
      if (path === '/listings') return this.listings(this.me(c.keyHash));
      if (path === '/fame') return this.fame();
      if (path === '/admin/clears') { this.admin(c); return this.adminClears(c); }
      hit = m(/^\/fame\/([A-Za-z0-9_-]{1,64})$/);
      if (hit) return this.fameContent(hit[1]);
      if (path === '/board') return this.board(c);
      hit = m(/^\/board\/(\d{1,12})$/);
      if (hit) return this.post(Number(hit[1]), c);
    }
    if (method === 'POST') {
      if (path === '/profile') return this.saveProfile(c);
      if (path === '/me/hero') return this.setHero(this.me(c.keyHash), c.req.body);
      if (path === '/me/title') return this.setTitle(this.me(c.keyHash), c.req.body);
      if (path === '/friends/request') return this.friendRequest(this.me(c.keyHash), c);
      if (path === '/friends/respond') return this.friendRespond(this.me(c.keyHash), c);
      if (path === '/friends/remove') return this.friendRemove(this.me(c.keyHash), c);
      if (path === '/blocks') return this.setBlock(this.me(c.keyHash), c);
      if (path === '/ws-ticket') return this.ticket(this.me(c.keyHash), c);
      if (path === '/listings') return this.saveListing(this.me(c.keyHash), c);
      if (path === '/runs/start') return this.runStart(this.me(c.keyHash), c);
      if (path === '/runs/clear') return this.runClear(this.me(c.keyHash), c);
      if (path === '/board') return this.createPost(this.me(c.keyHash), c);
      let hit = m(/^\/board\/(\d{1,12})\/vote$/);
      if (hit) return this.vote(this.me(c.keyHash), Number(hit[1]), c);
      hit = m(/^\/board\/(\d{1,12})\/comment$/);
      if (hit) return this.comment(this.me(c.keyHash), Number(hit[1]), c);
      hit = m(/^\/board\/(\d{1,12})\/moderate$/);
      if (hit) return this.moderate(this.admin(c), Number(hit[1]), c);
      if (path === '/report') return this.report(this.me(c.keyHash), c);
      if (ADMIN_PATHS.has(path)) return this.adminAction(this.admin(c), c);
      if (path === '/auth/link') return this.link(this.me(c.keyHash), c);
      if (path === '/auth/recover') return this.recover(c);
      if (path === '/auth/unlink') return this.unlink(this.me(c.keyHash), c);
    }
    if (method === 'DELETE' && path === '/listings') return this.deleteListing(this.me(c.keyHash), c);
    throw new SocialError('not-found', 404);
  }

  // ── 신원 ───────────────────────────────────────────────
  private player(id: string): any { return this.one('SELECT * FROM players WHERE id = ?', id); }
  private me(keyHash: string | null): any {
    if (!keyHash) throw new SocialError('bad-key', 401);
    const row = this.one('SELECT p.* FROM player_keys k JOIN players p ON p.id = k.player_id WHERE k.key_hash = ?', keyHash);
    if (!row) throw new SocialError('no-profile', 401);
    if (row.banned) throw new SocialError('banned', 403);
    const now = this.d.now();
    this.run('UPDATE player_keys SET last_seen = ? WHERE key_hash = ? AND last_seen < ?', now, keyHash, now - 60000);
    return row;
  }
  private optionalMe(keyHash: string | null): any {
    if (!keyHash) return null;
    try { return this.me(keyHash); } catch { return null; }
  }
  private isAdmin(p: any, req: CoreRequest): boolean { return !!p && req.adminIds.includes(p.id); }
  private admin(c: Ctx): any {
    const p = this.me(c.keyHash);
    if (!this.isAdmin(p, c.req)) throw new SocialError('admin-only', 403);
    return p;
  }
  /** 창 안의 기록 수가 max 이상이면 거부하고, 아니면 이번 시도를 기록한다. */
  private limit(key: string, max: number, windowMs: number): void {
    const now = this.d.now();
    this.run('DELETE FROM rate_events WHERE at < ?', now - Math.max(windowMs, HOUR));
    const rows = this.all('SELECT at FROM rate_events WHERE key = ? AND at >= ? ORDER BY at', key, now - windowMs);
    if (rows.length >= max) throw new SocialError('rate', 429, rows[0].at + windowMs - now);
    this.run('INSERT INTO rate_events(key, at) VALUES (?, ?)', key, now);
  }

  minis(ids: string[]): Map<string, PublicMini> {
    const map = new Map<string, PublicMini>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 90) {
      const chunk = unique.slice(i, i + 90);
      for (const r of this.all('SELECT p.id, p.name, p.tag, p.no, p.hero, p.title_id, EXISTS(SELECT 1 FROM account_links a WHERE a.player_id = p.id) AS linked FROM players p WHERE p.id IN (' + placeholders(chunk.length) + ')', ...chunk)) {
        map.set(r.id, { id: r.id, name: r.name, tag: r.tag, no: r.no, hero: r.hero ?? null, title: r.title_id ? titleLabel(this.config, r.title_id) : null, linked: !!r.linked });
      }
    }
    return map;
  }
  private mini(id: string): PublicMini {
    const mini = this.minis([id]).get(id);
    if (!mini) throw new SocialError('player-not-found', 404);
    return mini;
  }
  private titles(pid: string): (Title & { earnedAt: number })[] {
    return this.all('SELECT title_id, earned_at FROM titles WHERE player_id = ? ORDER BY earned_at, title_id', pid)
      .map(r => { const t = titleLabel(this.config, r.title_id); return t ? { ...t, earnedAt: r.earned_at } : null; })
      .filter((t): t is Title & { earnedAt: number } => !!t);
  }
  private grant(pid: string, titleId: string): boolean {
    if (this.one('SELECT 1 AS x FROM titles WHERE player_id = ? AND title_id = ?', pid, titleId)) return false;
    this.run('INSERT INTO titles(player_id, title_id, earned_at) VALUES (?, ?, ?)', pid, titleId, this.d.now());
    return true;
  }
  private profile(p: any) {
    return {
      ...this.mini(p.id), createdAt: p.created_at, renamedAt: p.renamed_at ?? null, titles: this.titles(p.id),
      links: this.all('SELECT provider FROM account_links WHERE player_id = ? ORDER BY provider', p.id).map(r => r.provider as string),
      mutedUntil: p.muted_until > this.d.now() ? p.muted_until : 0,
    };
  }
  private freeTag(name: string): string {
    const used = (tag: string) => !!this.one('SELECT 1 AS x FROM players WHERE name = ? AND tag = ?', name, tag);
    for (let i = 0; i < 24; i++) {
      const tag = String(parseInt(this.d.randomHex(4), 16) % 10000).padStart(4, '0');
      if (!used(tag)) return tag;
    }
    const taken = new Set(this.all('SELECT tag FROM players WHERE name = ?', name).map(r => r.tag));
    for (let n = 0; n < 10000; n++) { const tag = String(n).padStart(4, '0'); if (!taken.has(tag)) return tag; }
    throw new SocialError('name-full', 409);
  }
  private cleanName(value: unknown): string {
    const name = playerName(value);
    if (maskBanned(name, this.config.bannedWords) !== name) throw new SocialError('name');
    return name;
  }

  private saveProfile(c: Ctx) {
    if (!c.keyHash) throw new SocialError('bad-key', 401);
    const body = object(c.req.body, ['name', 'hero']);
    const name = this.cleanName(body.name);
    const hero = body.hero === undefined ? null : playerHero(body.hero);
    const now = this.d.now();
    const existing = this.one('SELECT p.* FROM player_keys k JOIN players p ON p.id = k.player_id WHERE k.key_hash = ?', c.keyHash);
    if (existing) {
      if (existing.banned) throw new SocialError('banned', 403);
      if (existing.name === name) return this.profile(existing);
      if (existing.renamed_at && now - existing.renamed_at < 24 * HOUR) throw new SocialError('rename-cooldown', 429, existing.renamed_at + 24 * HOUR - now);
      this.run('UPDATE players SET name = ?, tag = ?, renamed_at = ? WHERE id = ?', name, this.freeTag(name), now, existing.id);
      return this.profile(this.player(existing.id));
    }
    this.limit('profile:' + c.req.ipHash, 5, HOUR);
    const no = (this.one('SELECT COALESCE(MAX(no), 0) AS n FROM players').n as number) + 1;
    // MMO 계정이 이 기기 키로 먼저 예약한 id가 있으면 그 id로 프로필을 만든다.
    const id = this.reservedId(c.keyHash) ?? 'p_' + this.d.randomHex(12);
    this.run('INSERT INTO players(id, name, tag, no, hero, created_at, created_ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, this.freeTag(name), no, hero, now, c.req.ipHash);
    this.run('INSERT INTO player_keys(key_hash, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)', c.keyHash, id, now, now);
    if (no <= this.config.founders.maxNo) {
      this.grant(id, this.config.founders.titleId);
      this.run('UPDATE players SET title_id = ? WHERE id = ?', this.config.founders.titleId, id);
    }
    c.out.status = 201;
    return this.profile(this.player(id));
  }

  private getMe(p: any, c: Ctx) {
    const friendRows = this.all('SELECT b, created_at FROM friends WHERE a = ? ORDER BY created_at', p.id);
    const incoming = this.all('SELECT from_id AS id, created_at FROM friend_requests WHERE to_id = ? ORDER BY created_at', p.id);
    const outgoing = this.all('SELECT to_id AS id, created_at FROM friend_requests WHERE from_id = ? ORDER BY created_at', p.id);
    const blocks = this.all('SELECT target AS id FROM blocks WHERE owner = ?', p.id);
    const minis = this.minis([...friendRows.map(r => r.b), ...incoming.map(r => r.id), ...outgoing.map(r => r.id), ...blocks.map(r => r.id)]);
    return {
      profile: this.profile(p),
      friends: friendRows.filter(r => minis.has(r.b)).map(r => ({ ...minis.get(r.b)!, since: r.created_at, online: this.online(r.b), presence: this.presenceOf(r.b) })),
      requests: {
        incoming: incoming.filter(r => minis.has(r.id)).map(r => ({ player: minis.get(r.id)!, at: r.created_at })),
        outgoing: outgoing.filter(r => minis.has(r.id)).map(r => ({ player: minis.get(r.id)!, at: r.created_at })),
      },
      blocks: blocks.filter(r => minis.has(r.id)).map(r => minis.get(r.id)!),
      titles: this.titles(p.id),
      title: p.title_id ? titleLabel(this.config, p.title_id) : null,
      isAdmin: this.isAdmin(p, c.req),
    };
  }
  private setHero(p: any, body: unknown) {
    const hero = playerHero(object(body, ['hero']).hero);
    this.limit('hero:' + p.id, 20, 60000);
    this.run('UPDATE players SET hero = ? WHERE id = ?', hero, p.id);
    return this.profile(this.player(p.id));
  }
  private setTitle(p: any, body: unknown) {
    const titleId = object(body, ['titleId']).titleId;
    if (titleId !== null) {
      if (typeof titleId !== 'string' || !this.one('SELECT 1 AS x FROM titles WHERE player_id = ? AND title_id = ?', p.id, titleId)) throw new SocialError('title-not-owned', 403);
    }
    this.run('UPDATE players SET title_id = ? WHERE id = ?', titleId, p.id);
    return this.profile(this.player(p.id));
  }
  private parseCode(value: unknown): any {
    if (typeof value !== 'string' || value.length > 40) throw new SocialError('code');
    const hit = value.normalize('NFKC').trim().match(/^(.+)#(\d{4})$/);
    if (!hit) throw new SocialError('code');
    const row = this.one('SELECT * FROM players WHERE name = ? AND tag = ?', playerName(hit[1]), hit[2]);
    if (!row) throw new SocialError('player-not-found', 404);
    return row;
  }
  private lookup(c: Ctx) {
    const me = this.me(c.keyHash);
    return this.publicProfile(this.parseCode(c.req.query.get('code')).id, me);
  }
  private publicProfile(id: string, viewer: any) {
    const p = this.player(id);
    if (!p || p.banned) throw new SocialError('player-not-found', 404);
    const friend = this.areFriends(viewer.id, id);
    return {
      ...this.mini(id), titles: this.titles(id), createdAt: p.created_at,
      clears: this.one('SELECT COUNT(*) AS n FROM clears WHERE player_id = ? AND revoked = 0', id).n,
      friend, blocked: this.blocked(viewer.id, id), ...(friend ? { online: this.online(id) } : {}),
    };
  }

  // ── 친구·차단 ──────────────────────────────────────────
  private areFriends(a: string, b: string): boolean { return !!this.one('SELECT 1 AS x FROM friends WHERE a = ? AND b = ?', a, b); }
  private blocked(a: string, b: string): boolean {
    return !!this.one('SELECT 1 AS x FROM blocks WHERE (owner = ? AND target = ?) OR (owner = ? AND target = ?)', a, b, b, a);
  }
  blockSet(pid: string): string[] {
    return this.all('SELECT target AS id FROM blocks WHERE owner = ? UNION SELECT owner AS id FROM blocks WHERE target = ?', pid, pid).map(r => r.id);
  }
  private friendCount(pid: string): number { return this.one('SELECT COUNT(*) AS n FROM friends WHERE a = ?', pid).n; }
  private targetOf(body: Record<string, any>): any {
    if ((body.code === undefined) === (body.playerId === undefined)) throw new SocialError('schema');
    if (body.code !== undefined) return this.parseCode(body.code);
    const row = this.player(parsePlayerId(body.playerId));
    if (!row) throw new SocialError('player-not-found', 404);
    return row;
  }
  private befriend(a: string, b: string): void {
    if (this.friendCount(a) >= LIMITS.friends || this.friendCount(b) >= LIMITS.friends) throw new SocialError('friends-full', 409);
    const now = this.d.now();
    this.run('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', a, b, b, a);
    this.run('INSERT OR IGNORE INTO friends(a, b, created_at) VALUES (?, ?, ?), (?, ?, ?)', a, b, now, b, a, now);
  }
  private friendRequest(me: any, c: Ctx) {
    const target = this.targetOf(object(c.req.body, ['code', 'playerId']));
    if (target.id === me.id) throw new SocialError('self');
    if (target.banned) throw new SocialError('player-not-found', 404);
    if (this.blocked(me.id, target.id)) throw new SocialError('blocked', 403);
    if (this.areFriends(me.id, target.id)) throw new SocialError('already-friends', 409);
    const myMini = this.mini(me.id);
    if (this.one('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?', target.id, me.id)) {
      this.befriend(me.id, target.id);
      this.notify(c.out.effects, target.id, this.acceptedMessage(me.id, myMini), '친구 요청이 수락되었습니다.');
      return { status: 'friends', player: this.mini(target.id) };
    }
    if (this.one('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?', me.id, target.id)) return { status: 'pending', player: this.mini(target.id) };
    if (this.one('SELECT COUNT(*) AS n FROM friend_requests WHERE to_id = ?', target.id).n >= LIMITS.incoming) throw new SocialError('requests-full', 429);
    if (this.friendCount(me.id) >= LIMITS.friends) throw new SocialError('friends-full', 409);
    this.run('INSERT INTO friend_requests(from_id, to_id, created_at) VALUES (?, ?, ?)', me.id, target.id, this.d.now());
    this.notify(c.out.effects, target.id, { t: 'friend', event: 'request', player: myMini }, '새 친구 요청이 도착했습니다.');
    return { status: 'pending', player: this.mini(target.id) };
  }
  private friendRespond(me: any, c: Ctx) {
    const body = object(c.req.body, ['playerId', 'accept']);
    const from = parsePlayerId(body.playerId), accept = bool(body.accept);
    if (!this.one('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?', from, me.id)) throw new SocialError('no-request', 404);
    if (!accept) { this.run('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', from, me.id); return { status: 'declined' }; }
    this.befriend(me.id, from);
    this.notify(c.out.effects, from, this.acceptedMessage(me.id), '친구 요청이 수락되었습니다.');
    return { status: 'friends', player: this.mini(from) };
  }
  /** 수락 이벤트에 수락한 사람의 접속·상태를 함께 실어, 요청자 화면이 처음부터 올바른 온라인 표시를 갖게 한다. */
  private acceptedMessage(pid: string, mini: unknown = this.mini(pid)): Record<string, unknown> {
    const online = this.online(pid);
    return { t: 'friend', event: 'accepted', player: mini, online, presence: online ? this.presenceOf(pid) : null };
  }
  private friendRemove(me: any, c: Ctx) {
    const other = parsePlayerId(object(c.req.body, ['playerId']).playerId);
    this.run('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me.id, other, other, me.id);
    if (this.online(other)) c.out.effects.push({ to: { player: other }, message: { t: 'friend', event: 'removed', player: this.mini(me.id) } });
    return { ok: true };
  }
  private setBlock(me: any, c: Ctx) {
    const body = object(c.req.body, ['playerId', 'blocked']);
    const target = parsePlayerId(body.playerId), blocked = bool(body.blocked);
    if (target === me.id) throw new SocialError('self');
    if (!blocked) { this.run('DELETE FROM blocks WHERE owner = ? AND target = ?', me.id, target); return { ok: true }; }
    if (!this.player(target)) throw new SocialError('player-not-found', 404);
    if (!this.one('SELECT 1 AS x FROM blocks WHERE owner = ? AND target = ?', me.id, target)
      && this.one('SELECT COUNT(*) AS n FROM blocks WHERE owner = ?', me.id).n >= LIMITS.blocks) throw new SocialError('blocks-full', 409);
    this.run('INSERT OR IGNORE INTO blocks(owner, target) VALUES (?, ?)', me.id, target);
    this.purgeInboxFrom(me.id, target);
    this.purgeInboxFrom(target, me.id);
    const hadFriend = this.areFriends(me.id, target);
    this.run('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me.id, target, target, me.id);
    this.run('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', me.id, target, target, me.id);
    if (hadFriend && this.online(target)) c.out.effects.push({ to: { player: target }, message: { t: 'friend', event: 'removed', player: this.mini(me.id) } });
    return { ok: true };
  }

  // ── 접속 상태·알림 ─────────────────────────────────────
  private sessions(): Session[] { return (this.d.live?.() ?? []).filter(s => s.hello && !s.closed); }
  online(pid: string, exceptSid?: string): boolean { return this.sessions().some(s => s.playerId === pid && s.sid !== exceptSid); }
  private presenceOf(pid: string) {
    const list = this.sessions().filter(s => s.playerId === pid).sort((a, b) => b.presenceAt - a.presenceAt);
    return list[0]?.presence ?? null;
  }
  private inbox(to: string, msg: Msg): void {
    this.run('INSERT INTO dm_inbox(to_id, payload, created_at) VALUES (?, ?, ?)', to, JSON.stringify(msg), msg.at);
    this.run('DELETE FROM dm_inbox WHERE to_id = ? AND id NOT IN (SELECT id FROM dm_inbox WHERE to_id = ? ORDER BY id DESC LIMIT ?)', to, to, LIMITS.inbox);
  }
  private inboxSender(msg: Msg): string | undefined {
    return msg.from?.id ?? (msg.data as { player?: PublicMini } | undefined)?.player?.id;
  }
  private purgeInboxFrom(to: string, from: string): void {
    for (const row of this.all('SELECT id, payload FROM dm_inbox WHERE to_id = ?', to)) {
      if (this.inboxSender(JSON.parse(row.payload)) === from) this.run('DELETE FROM dm_inbox WHERE id = ?', row.id);
    }
  }
  /** 온라인이면 실시간으로, 오프라인이면 시스템 메시지를 보관함에 남긴다. */
  private notify(effects: Effect[], to: string, message: Record<string, unknown>, offlineText: string): void {
    if (this.online(to)) { effects.push({ to: { player: to }, message }); return; }
    this.inbox(to, { id: this.id(), channel: null, kind: 'system', to, text: offlineText, at: this.d.now(), data: message });
  }

  // ── 소켓 티켓 ──────────────────────────────────────────
  private ticket(me: any, c: Ctx) {
    object(c.req.body ?? {}, []);
    const now = this.d.now();
    this.run('DELETE FROM ws_tickets WHERE expires_at <= ?', now);
    this.limit('ticket:' + me.id, 20, 60000);
    const ticket = this.d.randomHex(16), expiresAt = now + SOCIAL_LIMITS.ticketMs;
    this.run('INSERT INTO ws_tickets(ticket, player_id, expires_at, key_hash) VALUES (?, ?, ?, ?)', ticket, me.id, expiresAt, c.keyHash);
    this.run('DELETE FROM ws_tickets WHERE player_id = ? AND ticket NOT IN (SELECT ticket FROM ws_tickets WHERE player_id = ? ORDER BY rowid DESC LIMIT 5)', me.id, me.id);
    return { ticket, expiresAt };
  }
  // ── MMO 계정 입양(Worker→DO 내부 전용, 외부 라우팅 불가) ──────────────
  private ensureReservations(): void {
    this.run('CREATE TABLE IF NOT EXISTS reserved_ids (key_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)');
  }
  /**
   * 기기 키 해시의 기존 playerId를 입양한다. 소셜 프로필이 없으면 프로필(이름·창립 번호)은 만들지 않고
   * 같은 키로 나중에 프로필을 만들 때 쓸 id만 예약한다. 그래서 친구·칭호·창립 번호가 계정 id와 같은 id에 붙는다.
   */
  internalAccount(keyHash: unknown): { playerId: string; adopted: boolean; banned: boolean } {
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(keyHash)) throw new SocialError('bad-key', 400);
    return this.tx(() => {
      const existing = this.one('SELECT p.id, p.banned FROM player_keys k JOIN players p ON p.id = k.player_id WHERE k.key_hash = ?', keyHash);
      if (existing) return { playerId: existing.id as string, adopted: true, banned: !!existing.banned };
      this.ensureReservations();
      const reserved = this.one('SELECT player_id FROM reserved_ids WHERE key_hash = ?', keyHash);
      if (reserved) return { playerId: reserved.player_id as string, adopted: false, banned: false };
      let id = 'p_' + this.d.randomHex(12);
      while (this.player(id) || this.one('SELECT 1 AS x FROM reserved_ids WHERE player_id = ?', id)) id = 'p_' + this.d.randomHex(12);
      this.run('INSERT INTO reserved_ids(key_hash, player_id, created_at) VALUES (?, ?, ?)', keyHash, id, this.d.now());
      return { playerId: id, adopted: false, banned: false };
    });
  }
  /**
   * 게임 서버의 기존 이용자 증거 조회(Worker→DO 내부 전용). 소셜 프로필이 서버에 처음 만들어진 시각을 돌려준다.
   * 이 시각은 서버가 기록한 값이라 클라이언트가 고칠 수 없다. 프로필이 없으면(예약 id만 있음) createdAt=null.
   */
  internalEvidence(playerId: unknown): { createdAt: number | null; banned: boolean } {
    if (typeof playerId !== 'string' || !/^p_[0-9a-f]{24}$/.test(playerId)) throw new SocialError('bad-player', 400);
    const p = this.player(playerId);
    return p ? { createdAt: Number(p.created_at), banned: !!p.banned } : { createdAt: null, banned: false };
  }
  private reservedId(keyHash: string): string | null {
    if (!this.one("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'reserved_ids'")) return null;
    const row = this.one('SELECT player_id FROM reserved_ids WHERE key_hash = ?', keyHash);
    return row && !this.player(row.player_id) ? row.player_id as string : null;
  }

  /** 1회용 티켓을 소비하고 발급 당시 신원과 기기 키를 돌려준다. */
  consumeTicket(ticket: unknown): { playerId: string; keyHash: string } {
    if (typeof ticket !== 'string' || !WS_TICKET.test(ticket)) throw new SocialError('ticket', 401);
    return this.tx(() => {
      const row = this.one('SELECT player_id, expires_at, key_hash FROM ws_tickets WHERE ticket = ?', ticket);
      this.run('DELETE FROM ws_tickets WHERE ticket = ? OR expires_at <= ?', ticket, this.d.now());
      if (!row || row.expires_at <= this.d.now() || !this.one('SELECT 1 FROM player_keys WHERE key_hash = ? AND player_id = ?', row.key_hash, row.player_id)) throw new SocialError('ticket', 401);
      const p = this.player(row.player_id);
      if (!p) throw new SocialError('ticket', 401);
      if (p.banned) throw new SocialError('banned', 403);
      return { playerId: p.id, keyHash: row.key_hash };
    });
  }

  // ── 파티 모집 ──────────────────────────────────────────
  private listingView(r: any, host: PublicMini) {
    return { id: r.id, host, partyCode: r.party_code, contentId: r.content_id, note: r.note, slots: r.slots, members: r.members, createdAt: r.created_at, expiresAt: r.expires_at };
  }
  private listings(me: any) {
    const now = this.d.now();
    this.run('DELETE FROM listings WHERE expires_at <= ?', now);
    const hidden = new Set(this.blockSet(me.id));
    const rows = this.all('SELECT * FROM listings ORDER BY created_at DESC LIMIT 200').filter(r => !hidden.has(r.host_id)).slice(0, 50);
    const minis = this.minis(rows.map(r => r.host_id));
    return { items: rows.filter(r => minis.has(r.host_id)).map(r => this.listingView(r, minis.get(r.host_id)!)) };
  }
  private saveListing(me: any, c: Ctx) {
    this.speaker({ playerId: me.id });
    const body = object(c.req.body, ['partyCode', 'contentId', 'note', 'slots', 'members']);
    const code = partyCode(body.partyCode);
    const contentId = body.contentId === null || body.contentId === undefined ? null : this.content(body.contentId).id;
    const note = filterChat(text(body.note ?? '', 0, 40, 'note'), this.config.bannedWords);
    const slots = integer(body.slots, 2, 4), members = integer(body.members, 1, 4);
    if (members > slots) throw new SocialError('members');
    const now = this.d.now(), expires = now + SOCIAL_LIMITS.listingMs;
    this.run('DELETE FROM listings WHERE expires_at <= ?', now);
    const existing = this.one('SELECT id, party_code FROM listings WHERE host_id = ?', me.id);
    if (existing) {
      this.run('UPDATE listings SET party_code = ?, content_id = ?, note = ?, slots = ?, members = ?, expires_at = ? WHERE id = ?', code, contentId, note, slots, members, expires, existing.id);
    } else {
      this.run('INSERT INTO listings(id, host_id, party_code, content_id, note, slots, members, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', this.id(), me.id, code, contentId, note, slots, members, now, expires);
    }
    const row = this.one('SELECT * FROM listings WHERE host_id = ?', me.id);
    const host = this.mini(me.id), view = this.listingView(row, host);
    if (!existing && !this.one('SELECT 1 FROM rate_events WHERE key = ? AND at >= ?', 'listing-broadcast:' + me.id, now - SOCIAL_LIMITS.listingMs)) {
      this.limit('listing-broadcast:' + me.id, 1, SOCIAL_LIMITS.listingMs);
      const contentName = contentId ? this.content(contentId).name : '자유 사냥';
      const m: Msg = { id: this.id(), channel: null, kind: 'listing', from: host, text: host.name + '님이 파티원을 모집합니다 · ' + contentName + ' (' + members + '/' + slots + ')', at: now, data: view };
      c.out.effects.push({ to: { worlds: true }, message: { t: 'msg', m }, exclude: this.blockSet(me.id) });
    }
    c.out.status = existing ? 200 : 201;
    return view;
  }
  private deleteListing(me: any, c: Ctx) {
    object(c.req.body ?? {}, []);
    this.run('DELETE FROM listings WHERE host_id = ?', me.id);
    return { ok: true };
  }

  // ── 런·최초 클리어·칭호 ────────────────────────────────
  private content(id: unknown) {
    const content = typeof id === 'string' ? this.config.contents.find(item => item.id === id) : undefined;
    if (!content) throw new SocialError('content');
    return content;
  }
  private runStart(me: any, c: Ctx) {
    const body = object(c.req.body, ['contentId', 'mode']);
    const content = this.content(body.contentId);
    if (body.mode !== 'solo' && body.mode !== 'party') throw new SocialError('mode');
    this.limit('run-start:' + me.id, 30, HOUR);
    const now = this.d.now();
    this.run('DELETE FROM runs WHERE started_at < ?', now - SOCIAL_LIMITS.runMs);
    const open = this.all('SELECT id FROM runs WHERE player_id = ? AND cleared_at IS NULL ORDER BY started_at, id', me.id);
    for (const r of open.slice(0, Math.max(0, open.length - LIMITS.openRuns + 1))) this.run('DELETE FROM runs WHERE id = ?', r.id);
    const runId = this.d.randomHex(16);
    this.run('INSERT INTO runs(id, player_id, content_id, mode, started_at) VALUES (?, ?, ?, ?, ?)', runId, me.id, content.id, body.mode, now);
    c.out.status = 201;
    return { runId, contentId: content.id, startedAt: now };
  }
  private runClear(me: any, c: Ctx) {
    const body = object(c.req.body, ['runId', 'summary']), runId = body.runId;
    if (typeof runId !== 'string' || !/^[a-f0-9]{32}$/.test(runId)) throw new SocialError('run');
    const run = this.one('SELECT * FROM runs WHERE id = ? AND player_id = ?', runId, me.id);
    if (!run) throw new SocialError('run-not-found', 404);
    if (run.cleared_at !== null) throw new SocialError('already-cleared', 409);
    const now = this.d.now(), elapsed = now - run.started_at, content = this.content(run.content_id);
    if (elapsed > SOCIAL_LIMITS.runMs) { this.run('DELETE FROM runs WHERE id = ?', runId); throw new SocialError('run-expired', 410); }
    if (elapsed < content.minClearSec * 1000) throw new SocialError('too-fast', 422);
    const summary = runSummary(body.summary, elapsed);
    this.run('UPDATE runs SET cleared_at = ? WHERE id = ?', now, runId);
    const prior = this.one('SELECT * FROM clears WHERE content_id = ? AND player_id = ?', content.id, me.id);
    const newTitles: Title[] = [];
    let rank = prior?.rank ?? 0, bestMs = elapsed, newBest = true;
    const subject = this.one('SELECT subject_hash FROM account_links WHERE player_id = ? AND provider = ?', me.id, 'google')?.subject_hash ?? null;
    // 취소된 순위도 계정의 선점 이력으로 남긴다. 연동 해제로 순위를 복제하지 못한다.
    const eligible = !this.config.fame?.requireLinked || (subject !== null && !this.one('SELECT 1 FROM clears WHERE content_id = ? AND subject_hash = ? AND rank > 0', content.id, subject));
    const newlyRanked = rank === 0 && !prior?.revoked && eligible;
    if (newlyRanked) rank = (this.one('SELECT COALESCE(MAX(rank), 0) AS r FROM clears WHERE content_id = ?', content.id).r as number) + 1;
    const subjectHash = newlyRanked ? subject : prior?.subject_hash ?? null;
    const summaryJson = summary ? JSON.stringify(summary) : null;
    const rankSummary = newlyRanked ? summaryJson : prior?.rank_summary ?? null;
    if (prior) {
      newBest = elapsed < prior.best_ms;
      bestMs = Math.min(prior.best_ms, elapsed);
      this.run('UPDATE clears SET best_ms = ?, count = count + 1, rank = ?, subject_hash = ?, summary = ?, rank_summary = ?, last_at = ?, first_at = ? WHERE content_id = ? AND player_id = ?', bestMs, rank, subjectHash, summaryJson, rankSummary, now, newlyRanked ? now : prior.first_at, content.id, me.id);
    } else {
      this.run('INSERT INTO clears(content_id, player_id, first_at, best_ms, count, rank, subject_hash, summary, rank_summary, last_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)', content.id, me.id, now, elapsed, rank, subjectHash, summaryJson, rankSummary, now);
    }
    if (newlyRanked) {
      const mini = this.mini(me.id);
      const title = rank > 0 ? titleForRank(this.config, content.id, rank) : null;
      if (title && this.grant(me.id, title.id)) {
        newTitles.push(title);
        const line = mini.name + '#' + mini.tag + '님이 ' + content.name + josa(content.name, '을', '를') + ' ' + rank + '번째로 정복했습니다 · ' + title.label;
        c.out.effects.push({ to: { all: true }, message: { t: 'msg', m: { id: this.id(), channel: null, kind: 'fame', from: mini, text: line, at: now, data: { contentId: content.id, rank, titleId: title.id } } satisfies Msg } });
        c.out.webhooks.push({ kind: 'fame', title: title.label, description: line });
      }
      const done = this.one('SELECT COUNT(DISTINCT content_id) AS n FROM clears WHERE player_id = ? AND revoked = 0 AND rank > 0', me.id).n;
      const ids = new Set(this.config.contents.map(item => item.id));
      if (rank > 0 && done >= ids.size && this.grant(me.id, this.config.completion.titleId)) {
        const conqueror = titleLabel(this.config, this.config.completion.titleId)!;
        newTitles.push(conqueror);
        const line = mini.name + '#' + mini.tag + '님이 모든 지역을 정복했습니다 · ' + conqueror.label;
        c.out.effects.push({ to: { all: true }, message: { t: 'msg', m: { id: this.id(), channel: null, kind: 'fame', from: mini, text: line, at: now, data: { titleId: conqueror.id } } satisfies Msg } });
        c.out.webhooks.push({ kind: 'fame', title: conqueror.label, description: line });
      }
    }
    return { contentId: content.id, elapsedMs: elapsed, firstClear: !prior, rank, bestMs, newBest, newTitles };
  }

  private adminClears(c: Ctx) {
    const content = this.content(c.req.query.get('contentId'));
    const rows = (order: string) => this.all('SELECT * FROM clears WHERE content_id = ? ' + order, content.id);
    const recent = rows('ORDER BY last_at DESC, player_id LIMIT 50');
    const top = rows('AND rank BETWEEN 1 AND 10 ORDER BY rank');
    const minis = this.minis([...recent, ...top].map(r => r.player_id));
    const view = (r: any) => ({ player: minis.get(r.player_id) ?? null, rank: r.rank, firstAt: r.first_at, lastAt: r.last_at, bestMs: r.best_ms, count: r.count, revoked: !!r.revoked, summary: r.summary ? JSON.parse(r.summary) : null });
    return { contentId: content.id, recent: recent.map(view), top: top.map(r => view({ ...r, summary: r.rank_summary })) };
  }

  private fameRows(contentId: string, order: 'rank' | 'best', limit: number) {
    const rows = this.all('SELECT c.player_id, c.rank, c.first_at, c.best_ms FROM clears c JOIN players p ON p.id = c.player_id AND p.banned = 0 WHERE c.content_id = ? AND c.revoked = 0 AND c.rank > 0 ORDER BY ' + (order === 'rank' ? 'c.rank' : 'c.best_ms, c.first_at') + ' LIMIT ?', contentId, limit);
    const minis = this.minis(rows.map(r => r.player_id));
    return rows.filter(r => minis.has(r.player_id)).map(r => ({ player: minis.get(r.player_id)!, rank: r.rank, at: r.first_at, bestMs: r.best_ms }));
  }
  private fame() {
    const conquest = this.all('SELECT c.player_id, COUNT(*) AS n, MAX(c.first_at) AS last FROM clears c JOIN players p ON p.id = c.player_id AND p.banned = 0 WHERE c.revoked = 0 AND c.rank > 0 GROUP BY c.player_id ORDER BY n DESC, last ASC LIMIT 50');
    const minis = this.minis(conquest.map(r => r.player_id));
    const players = this.one('SELECT COUNT(*) AS n FROM players').n as number;
    return {
      contents: this.config.contents.map(item => ({ id: item.id, name: item.name, first: this.fameRows(item.id, 'rank', 10), fastest: this.fameRows(item.id, 'best', 10) })),
      conquest: conquest.filter(r => minis.has(r.player_id)).map(r => ({ player: minis.get(r.player_id)!, cleared: r.n, lastAt: r.last })),
      players, foundersLeft: Math.max(0, this.config.founders.maxNo - players), total: this.config.contents.length,
    };
  }
  private fameContent(id: string) {
    const content = this.config.contents.find(item => item.id === id);
    if (!content) throw new SocialError('content-not-found', 404);
    return { id: content.id, name: content.name, first: this.fameRows(id, 'rank', 100), fastest: this.fameRows(id, 'best', 50) };
  }

  // ── 게시판 ─────────────────────────────────────────────
  private postView(r: any, author: PublicMini | undefined, voted: boolean, withDiag: boolean) {
    return {
      id: r.id, category: r.category, title: r.title, body: r.body, status: r.status, votes: r.votes, comments: r.comments,
      createdAt: r.created_at, updatedAt: r.updated_at, devReply: r.dev_reply ?? null, author: author ?? null, voted,
      // 패치노트 연결은 '반영 완료' 글에서만 보인다(상태가 바뀌면 자동으로 숨는다).
      patchNoteSlug: r.status === 'done' ? (r.patch_note_slug ?? null) : null,
      ...(withDiag ? { diag: r.diag ? JSON.parse(r.diag) : null, hidden: !!r.hidden } : {}),
    };
  }
  private board(c: Ctx) {
    const viewer = this.optionalMe(c.keyHash), q = c.req.query;
    const category = q.get('category') || null, sort = q.get('sort') || 'new', cursor = q.get('cursor') || '';
    if (category && !(POST_CATEGORIES as readonly string[]).includes(category)) throw new SocialError('category');
    if (sort !== 'new' && sort !== 'top') throw new SocialError('sort');
    const where = ['hidden = 0'], binds: unknown[] = [];
    if (category) { where.push('category = ?'); binds.push(category); }
    if (cursor) {
      const hit = sort === 'new' ? cursor.match(/^n(\d{1,12})$/) : cursor.match(/^t(\d{1,9})\.(\d{1,12})$/);
      if (!hit) throw new SocialError('cursor');
      if (sort === 'new') { where.push('id < ?'); binds.push(Number(hit[1])); }
      else { where.push('(votes < ? OR (votes = ? AND id < ?))'); binds.push(Number(hit[1]), Number(hit[1]), Number(hit[2])); }
    }
    const rows = this.all('SELECT * FROM posts WHERE ' + where.join(' AND ') + ' ORDER BY ' + (sort === 'new' ? 'id DESC' : 'votes DESC, id DESC') + ' LIMIT 21', ...binds);
    const page = rows.slice(0, 20), minis = this.minis(page.map(r => r.author_id));
    const voted = new Set(viewer && page.length ? this.all('SELECT post_id FROM votes WHERE player_id = ? AND post_id IN (' + placeholders(page.length) + ')', viewer.id, ...page.map(r => r.id)).map(r => r.post_id) : []);
    const last = page[page.length - 1];
    return {
      items: page.map(r => this.postView(r, minis.get(r.author_id), voted.has(r.id), false)),
      nextCursor: rows.length > 20 && last ? (sort === 'new' ? 'n' + last.id : 't' + last.votes + '.' + last.id) : null,
    };
  }
  private post(id: number, c: Ctx) {
    const viewer = this.optionalMe(c.keyHash), admin = this.isAdmin(viewer, c.req);
    const r = this.one('SELECT * FROM posts WHERE id = ?', id);
    if (!r || (r.hidden && !admin)) throw new SocialError('post-not-found', 404);
    const comments = this.all('SELECT * FROM comments WHERE post_id = ? ORDER BY id LIMIT 500', id);
    const minis = this.minis([r.author_id, ...comments.map(x => x.author_id)]);
    const voted = !!viewer && !!this.one('SELECT 1 AS x FROM votes WHERE post_id = ? AND player_id = ?', id, viewer.id);
    return {
      post: this.postView(r, minis.get(r.author_id), voted, admin || viewer?.id === r.author_id),
      comments: comments.map(x => ({ id: x.id, body: x.body, createdAt: x.created_at, dev: !!x.dev, author: minis.get(x.author_id) ?? null })),
    };
  }
  private livePost(id: number): any {
    const r = this.one('SELECT * FROM posts WHERE id = ? AND hidden = 0', id);
    if (!r) throw new SocialError('post-not-found', 404);
    return r;
  }
  private createPost(me: any, c: Ctx) {
    const body = object(c.req.body, ['category', 'title', 'body', 'diag']);
    if (!(POST_CATEGORIES as readonly string[]).includes(body.category)) throw new SocialError('category');
    const admin = this.isAdmin(me, c.req);
    if (body.category === 'notice' && !admin) throw new SocialError('admin-only', 403);
    const title = maskBanned(text(body.title, 2, 40, 'title'), this.config.bannedWords);
    const content = maskBanned(text(body.body, 1, 1000, 'body'), this.config.bannedWords);
    const diag = diagnostics(body.diag);
    if (!admin) this.limit('post:' + me.id, 3, HOUR);
    const now = this.d.now();
    const row = this.one('INSERT INTO posts(author_id, category, title, body, diag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', me.id, body.category, title, content, diag ? JSON.stringify(diag) : null, now, now);
    if (['bug', 'idea', 'request'].includes(body.category)) {
      const mini = this.mini(me.id);
      c.out.webhooks.push({ kind: 'board', title: '[' + body.category + '] ' + title, description: content.slice(0, 600) + '\n— ' + mini.name + '#' + mini.tag + ' · #' + row.id });
    }
    c.out.status = 201;
    return this.postView(this.one('SELECT * FROM posts WHERE id = ?', row.id), this.mini(me.id), false, true);
  }
  private vote(me: any, id: number, c: Ctx) {
    object(c.req.body ?? {}, []);
    this.livePost(id);
    const had = !!this.one('SELECT 1 AS x FROM votes WHERE post_id = ? AND player_id = ?', id, me.id);
    if (had) this.run('DELETE FROM votes WHERE post_id = ? AND player_id = ?', id, me.id);
    else this.run('INSERT INTO votes(post_id, player_id) VALUES (?, ?)', id, me.id);
    this.run('UPDATE posts SET votes = (SELECT COUNT(*) FROM votes WHERE post_id = ?) WHERE id = ?', id, id);
    return { voted: !had, votes: this.one('SELECT votes FROM posts WHERE id = ?', id).votes };
  }
  private comment(me: any, id: number, c: Ctx) {
    const body = maskBanned(text(object(c.req.body, ['body']).body, 1, 300, 'body'), this.config.bannedWords);
    this.livePost(id);
    const admin = this.isAdmin(me, c.req);
    if (!admin) this.limit('comment:' + me.id, 20, HOUR);
    const now = this.d.now();
    const row = this.one('INSERT INTO comments(post_id, author_id, body, created_at, dev) VALUES (?, ?, ?, ?, ?) RETURNING id', id, me.id, body, now, admin ? 1 : 0);
    this.run('UPDATE posts SET comments = comments + 1, updated_at = ? WHERE id = ?', now, id);
    c.out.status = 201;
    return { id: row.id, body, createdAt: now, dev: admin, author: this.mini(me.id) };
  }
  private moderate(_admin: any, id: number, c: Ctx) {
    const body = object(c.req.body, ['status', 'devReply', 'hidden', 'patchNoteSlug']);
    if (body.status === undefined && body.devReply === undefined && body.hidden === undefined && body.patchNoteSlug === undefined) throw new SocialError('schema');
    const r = this.one('SELECT * FROM posts WHERE id = ?', id);
    if (!r) throw new SocialError('post-not-found', 404);
    const status = body.status === undefined ? r.status : body.status;
    if (!(POST_STATUSES as readonly string[]).includes(status)) throw new SocialError('status');
    const reply = body.devReply === undefined ? r.dev_reply : (body.devReply === null ? null : text(body.devReply, 0, 1000, 'devReply') || null);
    const hidden = body.hidden === undefined ? r.hidden : (bool(body.hidden) ? 1 : 0);
    // 패치노트 연결: 소식 글 id(영문 소문자·숫자·-)만 받고 '반영 완료'일 때만 둔다. 상태가 done 이 아니게 되면 연결을 지운다.
    let patchNoteSlug: string | null = r.patch_note_slug ?? null;
    if (body.patchNoteSlug !== undefined) {
      if (body.patchNoteSlug === null) patchNoteSlug = null;
      else if (typeof body.patchNoteSlug !== 'string' || !PATCH_NOTE_SLUG.test(body.patchNoteSlug)) throw new SocialError('patch-note-slug');
      else patchNoteSlug = body.patchNoteSlug;
      if (patchNoteSlug !== null && status !== 'done') throw new SocialError('patch-note-status');
    }
    if (status !== 'done') patchNoteSlug = null;
    this.run('UPDATE posts SET status = ?, dev_reply = ?, hidden = ?, patch_note_slug = ?, updated_at = ? WHERE id = ?', status, reply, hidden, patchNoteSlug, this.d.now(), id);
    const updated = this.one('SELECT * FROM posts WHERE id = ?', id);
    return this.postView(updated, this.minis([updated.author_id]).get(updated.author_id), false, true);
  }

  // ── 신고·관리 ──────────────────────────────────────────
  private report(me: any, c: Ctx) {
    const body = object(c.req.body, ['kind', 'target', 'ref', 'reason']);
    if (!['chat', 'post', 'player'].includes(body.kind)) throw new SocialError('kind');
    let target: string;
    if (body.kind === 'post') {
      if (typeof body.target !== 'string' && typeof body.target !== 'number') throw new SocialError('target');
      const id = Number(body.target);
      if (!Number.isSafeInteger(id) || !this.one('SELECT 1 AS x FROM posts WHERE id = ?', id)) throw new SocialError('post-not-found', 404);
      target = String(id);
    } else {
      target = parsePlayerId(body.target);
      if (target === me.id) throw new SocialError('self');
      if (!this.player(target)) throw new SocialError('player-not-found', 404);
    }
    const ref = body.ref === undefined ? null : text(body.ref, 0, 64, 'ref');
    this.run('DELETE FROM recent_messages WHERE at < ?', this.d.now() - DAY);
    if (body.kind === 'chat' && (!ref || !this.reportedMessage(target, ref))) throw new SocialError('ref');
    const reason = text(body.reason ?? '', 0, 100, 'reason');
    this.limit('report:' + me.id, 10, HOUR);
    const now = this.d.now();
    this.run('INSERT INTO reports(reporter, target, kind, ref, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)', me.id, target, body.kind, ref, reason, now);
    let autoMuted = false;
    if (body.kind === 'chat') {
      const rows = this.all('SELECT r.reporter, r.ref, r.created_at AS reported_at, p.created_at, p.created_ip_hash FROM reports r JOIN players p ON p.id = r.reporter WHERE r.target = ? AND r.kind = ? AND r.created_at >= ? AND p.banned = 0', target, 'chat', now - HOUR);
      const eligible = rows.filter(r => r.created_at <= r.reported_at - DAY && r.created_ip_hash && r.created_ip_hash !== 'unknown' && r.ref && this.reportedMessage(target, r.ref));
      const reporters = new Set(eligible.map(r => r.reporter)), ips = new Set(eligible.map(r => r.created_ip_hash));
      const p = this.player(target);
      if (reporters.size >= 3 && ips.size >= 3 && p.muted_until <= now) {
        const until = now + 10 * 60000;
        this.run('UPDATE players SET muted_until = ? WHERE id = ?', until, target);
        c.out.effects.push({ to: { player: target }, message: { t: 'error', code: 'muted', retryAfterMs: until - now } });
        autoMuted = true;
      }
    }
    c.out.status = 201;
    return { ok: true, autoMuted };
  }
  /** 본문을 보관하지 않는 제한된 작성자 인덱스. 파티·귓속말도 신고할 수 있다. */
  private rememberMessage(msg: Msg): void {
    this.run('DELETE FROM recent_messages WHERE at < ?', this.d.now() - DAY);
    this.run('INSERT INTO recent_messages(id, author_id, at) VALUES (?, ?, ?)', msg.id, msg.from!.id, msg.at);
    this.run('DELETE FROM recent_messages WHERE id NOT IN (SELECT id FROM recent_messages ORDER BY at DESC, rowid DESC LIMIT 200)');
  }
  private reportedMessage(target: string, ref: string): boolean {
    const since = this.d.now() - DAY;
    const recent = this.one('SELECT author_id FROM recent_messages WHERE id = ? AND at >= ?', ref, since);
    if (recent) return recent.author_id === target;
    const log = this.one('SELECT payload FROM chat_log WHERE id = ?', ref);
    if (!log) return false;
    const msg = JSON.parse(log.payload) as Msg;
    return (msg.kind === 'chat' || msg.kind === 'whisper') && msg.from?.id === target;
  }
  private adminAction(_admin: any, c: Ctx) {
    const path = c.req.path;
    if (path === '/admin/mute') {
      const body = object(c.req.body, ['playerId', 'minutes']);
      const pid = parsePlayerId(body.playerId), minutes = integer(body.minutes, 0, 60 * 24 * 30);
      if (!this.player(pid)) throw new SocialError('player-not-found', 404);
      const until = minutes ? this.d.now() + minutes * 60000 : 0;
      this.run('UPDATE players SET muted_until = ? WHERE id = ?', until, pid);
      if (until) c.out.effects.push({ to: { player: pid }, message: { t: 'error', code: 'muted', retryAfterMs: minutes * 60000 } });
      return { ok: true, mutedUntil: until };
    }
    if (path === '/admin/ban') {
      const body = object(c.req.body, ['playerId', 'banned']);
      const pid = parsePlayerId(body.playerId), banned = bool(body.banned);
      if (!this.player(pid)) throw new SocialError('player-not-found', 404);
      this.run('UPDATE players SET banned = ? WHERE id = ?', banned ? 1 : 0, pid);
      if (banned) {
        this.run('DELETE FROM listings WHERE host_id = ?', pid);
        c.out.effects.push({ to: { player: pid }, message: { t: 'error', code: 'banned' }, close: { code: 4003, reason: 'banned' } });
      }
      return { ok: true, banned };
    }
    const body = object(c.req.body, ['playerId', 'contentId']);
    const pid = parsePlayerId(body.playerId), content = this.content(body.contentId);
    if (!this.one('SELECT 1 AS x FROM clears WHERE player_id = ? AND content_id = ?', pid, content.id)) throw new SocialError('clear-not-found', 404);
    this.run('UPDATE clears SET revoked = 1 WHERE player_id = ? AND content_id = ?', pid, content.id);
    const removed = [...this.config.titleTiers.map(t => t.id + ':' + content.id), this.config.completion.titleId];
    this.run('DELETE FROM titles WHERE player_id = ? AND title_id IN (' + placeholders(removed.length) + ')', pid, ...removed);
    this.run('UPDATE players SET title_id = NULL WHERE id = ? AND title_id IN (' + placeholders(removed.length) + ')', pid, ...removed);
    return { ok: true };
  }

  // ── 외부 계정 연동 ─────────────────────────────────────
  private link(me: any, c: Ctx) {
    const provider = (c.req.body as any).provider as string, subjectHash = c.pre.subjectHash!;
    const existing = this.one('SELECT player_id FROM account_links WHERE provider = ? AND subject_hash = ?', provider, subjectHash);
    if (existing && existing.player_id !== me.id) throw new SocialError('linked-elsewhere', 409);
    if (!existing) {
      if (this.one('SELECT 1 AS x FROM account_links WHERE provider = ? AND player_id = ?', provider, me.id)) throw new SocialError('already-linked', 409);
      const prior = this.one('SELECT player_id, unlinked_at FROM account_link_history WHERE provider = ? AND subject_hash = ?', provider, subjectHash);
      const remaining = prior ? prior.unlinked_at + 30 * DAY - this.d.now() : 0;
      if (prior && prior.player_id !== me.id && remaining > 0) throw new SocialError('link-cooldown', 429, remaining);
      this.run('INSERT INTO account_links(provider, subject_hash, player_id, created_at) VALUES (?, ?, ?, ?)', provider, subjectHash, me.id, this.d.now());
    }
    return this.profile(this.player(me.id));
  }
  private recover(c: Ctx) {
    const provider = (c.req.body as any).provider as string, keyHash = c.pre.deviceKeyHash!;
    const link = this.one('SELECT player_id FROM account_links WHERE provider = ? AND subject_hash = ?', provider, c.pre.subjectHash!);
    if (!link) throw new SocialError('no-link', 404);
    const p = this.player(link.player_id);
    if (!p) throw new SocialError('no-link', 404);
    if (p.banned) throw new SocialError('banned', 403);
    const owner = this.one('SELECT player_id FROM player_keys WHERE key_hash = ?', keyHash);
    if (owner && owner.player_id !== p.id) throw new SocialError('key-in-use', 409);
    const now = this.d.now();
    if (owner) this.run('UPDATE player_keys SET last_seen = ? WHERE key_hash = ?', now, keyHash);
    else this.run('INSERT INTO player_keys(key_hash, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)', keyHash, p.id, now, now);
    // 키가 5개를 넘으면 가장 오래 안 쓴 키부터 지운다(방금 추가한 키는 남긴다).
    const keys = this.all('SELECT key_hash FROM player_keys WHERE player_id = ? AND key_hash != ? ORDER BY last_seen, created_at', p.id, keyHash);
    for (const k of keys.slice(0, Math.max(0, keys.length + 1 - LIMITS.keys))) {
      this.run('DELETE FROM player_keys WHERE key_hash = ?', k.key_hash);
      this.run('DELETE FROM ws_tickets WHERE key_hash = ?', k.key_hash);
      c.out.effects.push({ to: { keyHash: k.key_hash }, close: { code: 4001, reason: 'key-revoked' } });
    }
    return this.profile(p);
  }
  private unlink(me: any, c: Ctx) {
    if (!c.req.clientIds.length) throw new SocialError('link-disabled', 503);
    const provider = object(c.req.body, ['provider']).provider;
    if (!(AUTH_PROVIDERS as readonly string[]).includes(provider)) throw new SocialError('provider');
    const link = this.one('SELECT subject_hash FROM account_links WHERE provider = ? AND player_id = ?', provider, me.id);
    if (link) this.run('INSERT INTO account_link_history(provider, subject_hash, player_id, unlinked_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider, subject_hash) DO UPDATE SET player_id = excluded.player_id, unlinked_at = excluded.unlinked_at', provider, link.subject_hash, me.id, this.d.now());
    this.run('DELETE FROM account_links WHERE provider = ? AND player_id = ?', provider, me.id);
    return this.profile(this.player(me.id));
  }

  // ── WebSocket ─────────────────────────────────────────
  openSession(playerId: string, sid: string, keyHash: string): Session {
    return { sid, playerId, key_hash: keyHash, connectedAt: this.d.now(), world: null, party: null, presence: { state: 'lobby' }, presenceAt: 0, hello: false };
  }
  channelCounts(exceptSid?: string): { id: string; count: number }[] {
    const sessions = this.sessions();
    return Array.from({ length: this.config.worldChannels }, (_, i) => {
      const id = 'world-' + (i + 1);
      return { id, count: sessions.filter(s => s.world === id && s.sid !== exceptSid).length };
    });
  }
  private history(channel: string, viewer: string): Msg[] {
    const hidden = new Set(this.blockSet(viewer));
    return this.all('SELECT payload FROM chat_log WHERE channel = ? ORDER BY at DESC, rowid DESC LIMIT ?', channel, this.config.chat.history)
      .map(r => JSON.parse(r.payload) as Msg).filter(m => !m.from || !hidden.has(m.from.id)).reverse();
  }
  private friendsOnline(pid: string, exceptSid?: string) {
    return this.all('SELECT b FROM friends WHERE a = ?', pid).map(r => r.b as string)
      .map(id => ({ id, online: this.online(id, exceptSid), presence: this.online(id, exceptSid) ? this.presenceOf(id) : null }));
  }
  private presenceEffects(session: Session, online: boolean): Effect[] {
    return this.all('SELECT b FROM friends WHERE a = ?', session.playerId).map(r => r.b as string).filter(id => this.online(id))
      .map(id => ({ to: { player: id }, message: { t: 'presence', id: session.playerId, online, presence: online ? session.presence : null } }));
  }

  /** 소켓 메시지 하나를 처리한다. session은 제자리에서 갱신되고 어댑터가 attachment로 다시 저장한다. */
  message(session: Session, raw: string): Effect[] {
    const reply = (message: Record<string, unknown>): Effect => ({ to: { sid: session.sid }, message });
    try {
      // 절전 복원된 attachment를 포함해 ping·hello보다 먼저 기기 키 수명을 검사한다.
      if (session.closed || !session.key_hash || !this.one('SELECT 1 FROM player_keys WHERE key_hash = ? AND player_id = ?', session.key_hash, session.playerId)) throw new SocialError('key-revoked', 401);
      const player = this.player(session.playerId);
      if (!player || player.banned) throw new SocialError('banned', 403);
      if (new TextEncoder().encode(raw).length > SOCIAL_LIMITS.socketBytes) throw new SocialError('length');
      const now = this.d.now(), sec = Math.floor(now / 1000), rate = this.second.get(session.sid);
      if (!rate || rate.s !== sec) this.second.set(session.sid, { s: sec, n: 1 });
      else if (++rate.n > LIMITS.perSecond) throw new SocialError('rate', 429, 1000 - (now % 1000));
      let m: any;
      try { m = JSON.parse(raw); } catch { throw new SocialError('schema'); }
      if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') throw new SocialError('schema');
      if (m.t === 'ping') { object(m, ['t']); return [reply({ t: 'pong' })]; }
      if (m.t === 'hello') return this.tx(() => this.hello(session, object(m, ['t', 'presence'])));
      if (!session.hello) throw new SocialError('hello-required');
      return this.tx(() => {
        if (m.t === 'presence') {
          const p = parsePresence(object(m, ['t', 'presence']).presence);
          if (now - session.presenceAt < LIMITS.presenceMs) throw new SocialError('rate', 429, LIMITS.presenceMs - (now - session.presenceAt));
          session.presence = p; session.presenceAt = now;
          return this.presenceEffects(session, true);
        }
        if (m.t === 'join') return this.join(session, parseChannel(object(m, ['t', 'channel']).channel, this.config.worldChannels));
        if (m.t === 'leave') {
          const ch = parseChannel(object(m, ['t', 'channel']).channel, this.config.worldChannels);
          if (session.world === ch) session.world = null;
          if (session.party === ch) session.party = null;
          return [reply({ t: 'channels', channels: this.channelCounts() })];
        }
        if (m.t === 'say') return this.say(session, object(m, ['t', 'channel', 'text', 'nonce']));
        if (m.t === 'whisper') return this.whisper(session, object(m, ['t', 'to', 'text', 'nonce']));
        if (m.t === 'invite') return this.invite(session, object(m, ['t', 'to', 'partyCode']));
        throw new SocialError('schema');
      });
    } catch (error) {
      if (!(error instanceof SocialError)) throw error;
      const effects: Effect[] = [reply({ t: 'error', code: error.code, ...(error.retryAfterMs ? { retryAfterMs: Math.ceil(error.retryAfterMs) } : {}) })];
      if (error.code === 'banned') effects.push({ to: { sid: session.sid }, close: { code: 4003, reason: 'banned' } });
      if (error.code === 'key-revoked') effects.push({ to: { sid: session.sid }, close: { code: 4001, reason: 'key-revoked' } });
      return effects;
    }
  }
  private hello(session: Session, m: Record<string, any>): Effect[] {
    const p = this.player(session.playerId);
    if (!p || p.banned) throw new SocialError('banned', 403);
    // hello의 presence는 2초 제한에 포함하지 않는다(접속 직후 첫 갱신을 막지 않도록).
    if (m.presence !== undefined) session.presence = parsePresence(m.presence);
    const wasOnline = this.online(session.playerId, session.sid);
    const first = !session.hello;
    if (!session.world) {
      const counts = this.channelCounts(session.sid);
      session.world = counts.find(ch => ch.count < this.config.worldCapacity)?.id ?? null;
    }
    session.hello = true;
    const inboxRows = this.all('SELECT id, payload FROM dm_inbox WHERE to_id = ? ORDER BY id', session.playerId);
    const hidden = new Set(this.blockSet(session.playerId));
    const inbox = inboxRows.map(r => JSON.parse(r.payload) as Msg).filter(m => {
      const sender = this.inboxSender(m);
      return !sender || !hidden.has(sender);
    });
    if (inboxRows.length) this.run('DELETE FROM dm_inbox WHERE to_id = ? AND id <= ?', session.playerId, inboxRows[inboxRows.length - 1].id);
    const effects: Effect[] = [{ to: { sid: session.sid }, message: {
      t: 'welcome', me: this.mini(session.playerId), world: session.world, channels: this.channelCounts(),
      history: session.world ? { [session.world]: this.history(session.world, session.playerId) } : {},
      inbox, friends: this.friendsOnline(session.playerId, session.sid),
    } }];
    if (!session.world) effects.push({ to: { sid: session.sid }, message: { t: 'error', code: 'full' } });
    if (first && !wasOnline) effects.push(...this.presenceEffects(session, true));
    return effects;
  }
  private join(session: Session, ch: string): Effect[] {
    const reply = (message: Record<string, unknown>): Effect => ({ to: { sid: session.sid }, message });
    if (ch.startsWith('world-')) {
      if (session.world !== ch) {
        const count = this.channelCounts(session.sid).find(x => x.id === ch)!.count;
        if (count >= this.config.worldCapacity) throw new SocialError('full', 409);
        session.world = ch;
      }
      return [reply({ t: 'history', channel: ch, items: this.history(ch, session.playerId) }), reply({ t: 'channels', channels: this.channelCounts() })];
    }
    session.party = ch;
    return [reply({ t: 'history', channel: ch, items: [] })];
  }
  private speaker(session: Pick<Session, 'playerId'>): any {
    const p = this.player(session.playerId), now = this.d.now();
    if (!p || p.banned) throw new SocialError('banned', 403);
    if (p.muted_until > now) throw new SocialError('muted', 403, p.muted_until - now);
    return p;
  }
  /** 같은 nonce 재전송이면 false. */
  private freshNonce(pid: string, nonce: unknown): boolean {
    if (typeof nonce !== 'string' || !NONCE.test(nonce)) throw new SocialError('nonce');
    const now = this.d.now();
    this.run('DELETE FROM nonces WHERE at < ?', now - LIMITS.nonceMs);
    if (this.one('SELECT 1 AS x FROM nonces WHERE player_id = ? AND nonce = ?', pid, nonce)) return false;
    this.run('INSERT INTO nonces(player_id, nonce, at) VALUES (?, ?, ?)', pid, nonce, now);
    return true;
  }
  /** 최소 간격(저장소)·연속 묶음(메모리)·같은 내용 3회 연속을 검사한다. 메모리 맵이 비어도 간격과 반복은 저장소가 지킨다. */
  private chatGate(pid: string, body: string): void {
    const now = this.d.now(), chat = this.config.chat;
    const state = this.one('SELECT last_at, text, repeats FROM chat_state WHERE player_id = ?', pid);
    if (state && now - state.last_at < chat.minGapMs) throw new SocialError('rate', 429, chat.minGapMs - (now - state.last_at));
    const stamps = (this.burst.get(pid) ?? []).filter(t => now - t < chat.burstWindowMs);
    if (stamps.length >= chat.burst) throw new SocialError('rate', 429, stamps[0] + chat.burstWindowMs - now);
    const norm = body.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    const repeats = state && state.text === norm ? state.repeats + 1 : 1;
    if (repeats >= 3) throw new SocialError('repeat');
    stamps.push(now); this.burst.set(pid, stamps);
    this.run('INSERT INTO chat_state(player_id, last_at, text, repeats) VALUES (?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET last_at = excluded.last_at, text = excluded.text, repeats = excluded.repeats', pid, now, norm, repeats);
  }
  private say(session: Session, m: Record<string, any>): Effect[] {
    const ch = parseChannel(m.channel, this.config.worldChannels);
    if (ch !== session.world && ch !== session.party) throw new SocialError('not-joined');
    this.speaker(session);
    if (typeof m.text !== 'string') throw new SocialError('length');
    if (!this.freshNonce(session.playerId, m.nonce)) return [];
    const raw = text(m.text, 1, this.config.chat.maxLen, 'length');
    this.chatGate(session.playerId, raw);
    const msg: Msg = { id: this.id(), channel: ch, kind: 'chat', from: this.mini(session.playerId), text: filterChat(raw, this.config.bannedWords), at: this.d.now() };
    this.rememberMessage(msg);
    if (ch.startsWith('world-')) {
      this.run('INSERT INTO chat_log(channel, id, at, payload) VALUES (?, ?, ?, ?)', ch, msg.id, msg.at, JSON.stringify(msg));
      this.run('DELETE FROM chat_log WHERE channel = ? AND id NOT IN (SELECT id FROM chat_log WHERE channel = ? ORDER BY at DESC, rowid DESC LIMIT ?)', ch, ch, this.config.chat.history);
    }
    return [{ to: { channel: ch }, message: { t: 'msg', m: msg }, exclude: this.blockSet(session.playerId) }];
  }
  private directTarget(session: Session, to: unknown, friendsOnly: boolean): string {
    const target = parsePlayerId(to);
    if (target === session.playerId) throw new SocialError('self');
    const p = this.player(target);
    if (!p || p.banned) throw new SocialError('player-not-found');
    if (this.blocked(session.playerId, target)) throw new SocialError('blocked');
    if (friendsOnly && !this.areFriends(session.playerId, target)) throw new SocialError('not-friend');
    return target;
  }
  private deliverDirect(session: Session, to: string, msg: Msg): Effect[] {
    const effects: Effect[] = [{ to: { player: session.playerId }, message: { t: 'msg', m: msg } }];
    if (this.online(to)) effects.push({ to: { player: to }, message: { t: 'msg', m: msg } });
    else this.inbox(to, msg);
    return effects;
  }
  private whisper(session: Session, m: Record<string, any>): Effect[] {
    this.speaker(session);
    const to = this.directTarget(session, m.to, this.config.dmFriendsOnly);
    if (!this.freshNonce(session.playerId, m.nonce)) return [];
    const raw = text(m.text, 1, this.config.chat.maxLen, 'length');
    this.chatGate(session.playerId, raw);
    const msg: Msg = { id: this.id(), channel: null, kind: 'whisper', from: this.mini(session.playerId), to, text: filterChat(raw, this.config.bannedWords), at: this.d.now() };
    this.rememberMessage(msg);
    return this.deliverDirect(session, to, msg);
  }
  private invite(session: Session, m: Record<string, any>): Effect[] {
    this.speaker(session);
    const to = this.directTarget(session, m.to, true), code = partyCode(m.partyCode), from = this.mini(session.playerId);
    this.limit('invite:' + session.playerId, 10, 60000);
    const msg: Msg = { id: this.id(), channel: null, kind: 'invite', from, to, text: from.name + '님이 파티에 초대했습니다.', at: this.d.now(), data: { partyCode: code } };
    return this.deliverDirect(session, to, msg);
  }
  /** 소켓이 닫혔다. 그 플레이어의 마지막 소켓이면 친구들에게 오프라인을 알린다. */
  close(session: Session): Effect[] {
    this.second.delete(session.sid);
    if (!session.hello || this.online(session.playerId, session.sid)) return [];
    return this.all('SELECT b FROM friends WHERE a = ?', session.playerId).map(r => r.b as string).filter(id => this.online(id, session.sid))
      .map(id => ({ to: { player: id }, message: { t: 'presence', id: session.playerId, online: false, presence: null } }));
  }
}

