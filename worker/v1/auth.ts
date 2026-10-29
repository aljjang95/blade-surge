// MMO P1-B: 게스트 세션·연동·복구·해제 (docs/MMO_DESIGN.md 3.2).
// 인증 수단은 서버가 확인하는 비밀(기기 키 deviceKey, 서명 세션 토큰, 제공자 ID 토큰)뿐이다. 기기 ID는 쓰지 않는다.
import { type D1Database, V1Error, isConstraint } from './db';
import { ipKey, rateLimit } from './limit';
import { fail, onlyKeys } from './http';
import { CHANNELS, TOKEN_TTL_MS, type Channel, type SessionClaims, resolveSecret, sha256Hex, signToken, verifyToken, randomHex } from './token';
import { createAccountDoc } from './state';
import { restoreIdle } from './archive';

export const DEVICE_KEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export const PROVIDERS = ['google', 'play_games', 'toss', 'kakao', 'chatgpt'] as const;
export type Provider = typeof PROVIDERS[number];
const KEYS_PER_ACCOUNT = 5;
const ARCHIVE_MS = 90 * 24 * 3600 * 1000;
export const GAME_ID = 'blade-surge';

interface Stub { fetch(request: Request): Promise<Response> }
export interface AuthEnv {
  COMMERCE_DB?: D1Database;
  SESSION_HMAC?: string | { get(): Promise<string> };
  SOCIAL?: { idFromName(name: string): unknown; get(id: unknown): Stub };
  GOOGLE_CLIENT_IDS?: string;
  V1_SERVER_AUTHORITY_PERCENT?: string;
}
export interface AuthDeps {
  now(): number;
  verifyIdToken?(provider: string, token: string, clientIds: string[]): Promise<{ sub: string; nonce?: string }>;
  /** 제공자 토큰 교환(인가 코드 → id_token). 테스트는 가짜를 넣는다. */
  fetch?(url: string, init: RequestInit): Promise<Response>;
}
export interface Ctx { env: AuthEnv; db: D1Database; deps: AuthDeps; now: number; request: Request }
export interface AccountRow { account_id: string; status: string; token_ver: number; authority: string; shard: number; level: number; stage_idx: number; last_seen: number; age_band: string | null }
export interface Authed { claims: SessionClaims; account: AccountRow }

const ACCOUNT_COLUMNS = 'a.account_id, a.status, a.token_ver, a.authority, a.shard, a.level, a.stage_idx, a.last_seen, a.age_band';

export async function deviceKeyHash(deviceKey: unknown): Promise<string> {
  if (typeof deviceKey !== 'string' || !DEVICE_KEY.test(deviceKey)) fail(401, 'bad-key');
  // 소셜 허브와 같은 식이라 같은 기기 키가 같은 playerId로 이어진다.
  return sha256Hex(GAME_ID + ':' + deviceKey);
}
/** account_id 해시 기반 0~99 구간(점진 개방·샤딩용). */
export function shardOf(accountId: string): number { return parseInt(accountId.slice(-6), 16) % 100; }

async function secret(env: AuthEnv): Promise<string> {
  const value = await resolveSecret(env.SESSION_HMAC);
  if (!value) fail(503, 'session-unavailable');
  return value;
}

export async function accountByKey(db: D1Database, keyHash: string): Promise<AccountRow | null> {
  return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM account_keys k JOIN accounts a ON a.account_id = k.account_id WHERE k.key_hash = ?`).bind(keyHash).first<AccountRow>();
}
export async function accountById(db: D1Database, accountId: string): Promise<AccountRow | null> {
  return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a WHERE a.account_id = ?`).bind(accountId).first<AccountRow>();
}

/** 소셜 허브 내부 API로 기존 playerId를 입양하거나 새 id를 예약한다. 허브가 없으면(로컬 테스트) 새 id. */
async function resolvePlayer(env: AuthEnv, keyHash: string): Promise<{ playerId: string; banned: boolean }> {
  if (!env.SOCIAL) return { playerId: 'p_' + randomHex(12), banned: false };
  const hub = env.SOCIAL.get(env.SOCIAL.idFromName('hub:' + GAME_ID));
  const response = await hub.fetch(new Request('https://social.internal/internal/account', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-social-internal': '1' }, body: JSON.stringify({ keyHash }),
  }));
  if (!response.ok) fail(503, 'social-unavailable');
  const body = await response.json() as { playerId?: unknown; banned?: unknown };
  if (typeof body.playerId !== 'string' || !/^p_[0-9a-f]{24}$/.test(body.playerId)) fail(503, 'social-unavailable');
  return { playerId: body.playerId, banned: body.banned === true };
}

/**
 * 기존 이용자 서버 증거: 이 계정 id(= 소셜 playerId)의 소셜 프로필이 서버에 처음 만들어진 시각. 프로필이 없으면 null.
 * 허브가 응답하지 않으면 503으로 닫는다(가져오기는 계정당 한 번이라 증거 조회 실패를 '증거 없음'으로 굳히면 안 된다).
 */
export async function socialCreatedAt(env: AuthEnv, accountId: string): Promise<number | null> {
  if (!env.SOCIAL || !/^p_[0-9a-f]{24}$/.test(accountId)) return null;
  const hub = env.SOCIAL.get(env.SOCIAL.idFromName('hub:' + GAME_ID));
  const response = await hub.fetch(new Request('https://social.internal/internal/evidence', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-social-internal': '1' }, body: JSON.stringify({ playerId: accountId }),
  }));
  if (!response.ok) fail(503, 'social-unavailable');
  const body = await response.json() as { createdAt?: unknown; banned?: unknown };
  if (body.banned === true) return null;
  return Number.isSafeInteger(body.createdAt) && (body.createdAt as number) > 0 ? body.createdAt as number : null;
}

function assertActive(account: AccountRow): void {
  if (account.status === 'banned') fail(403, 'banned');
  if (account.status === 'deleting' || account.status === 'deleted') fail(403, 'deleted');
}

export async function issueSession(env: AuthEnv, account: AccountRow, channel: Channel, now: number) {
  const claims: SessionClaims = { aid: account.account_id, ch: channel, ver: account.token_ver, iat: now, exp: now + TOKEN_TTL_MS, att: 0 };
  return { token: await signToken(await secret(env), claims), accountId: account.account_id, expiresAt: claims.exp, serverTime: now, authority: account.authority };
}

/** 계정 행·문서·키를 한 배치로 만든다(경합 시 INSERT OR IGNORE로 먼저 만든 쪽이 이긴다). */
async function ensureAccount(c: Ctx, accountId: string, keyHash: string, channel: Channel, banned: boolean): Promise<void> {
  const doc = createAccountDoc(c.now);
  await c.db.batch([
    c.db.prepare(`INSERT OR IGNORE INTO accounts(account_id, created_at, last_seen, status, channel_first, shard, level, stage_idx, gold, gems_free)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(accountId, c.now, c.now, banned ? 'banned' : 'active', channel, shardOf(accountId),
      doc.projection.level, doc.projection.stageIdx, doc.projection.gold, doc.projection.gemsFree),
    c.db.prepare(`INSERT OR IGNORE INTO account_docs(account_id, doc_name, rev, doc, bytes, updated_at) VALUES (?, 'core', 1, ?, ?, ?)`)
      .bind(accountId, doc.text, doc.bytes, c.now),
    c.db.prepare('INSERT OR IGNORE INTO account_keys(key_hash, account_id, created_at, last_seen) VALUES (?, ?, ?, ?)').bind(keyHash, accountId, c.now, c.now),
  ]);
}

export async function createSession(c: Ctx, body: Record<string, unknown>) {
  onlyKeys(body, ['deviceKey', 'channel'], ['deviceKey']);
  const channel = (body.channel ?? 'web') as Channel;
  if (!(CHANNELS as readonly unknown[]).includes(channel)) fail(400, 'channel');
  await secret(c.env);
  const keyHash = await deviceKeyHash(body.deviceKey);
  let account = await accountByKey(c.db, keyHash), created = false;
  if (!account) {
    // 새 계정 생성은 IP(해시)당 시간 한도를 따로 둔다(기기 키 대량 발급으로 계정을 찍어 내는 남용 차단).
    const ip = await ipKey(c.request);
    await rateLimit(c, 'sessionNew', ip);
    await rateLimit(c, 'sessionNewDay', ip);
    const player = await resolvePlayer(c.env, keyHash);
    await ensureAccount(c, player.playerId, keyHash, channel, player.banned);
    account = await accountByKey(c.db, keyHash);
    if (!account) fail(503, 'account-unavailable');
    created = account.account_id === player.playerId && account.last_seen === c.now;
  } else if (c.now - account.last_seen > 60000) {
    // last_seen을 먼저 갱신해 보관 크론이 이 계정을 더는 고르지 못하게 한 뒤, 이미 보관됐으면 진행 문서를 되돌린다(archive.ts).
    // 순서가 반대면 확인과 갱신 사이에 보관된 문서를 60초 동안 놓친다.
    await c.db.batch([
      c.db.prepare('UPDATE account_keys SET last_seen = ? WHERE key_hash = ?').bind(c.now, keyHash),
      c.db.prepare('UPDATE accounts SET last_seen = ? WHERE account_id = ?').bind(c.now, account.account_id),
    ]);
    await restoreIdle(c.db, account.account_id, c.now);
  }
  assertActive(account);
  account = await maybeCutover(c, account);
  return { ...await issueSession(c.env, account, channel, c.now), created };
}

/**
 * M2 계정 컷오버: V1_SERVER_AUTHORITY_PERCENT(0~100, 기본 0)보다 shard가 낮은 그림자 계정을 서버 권위로 바꾼다.
 * 되돌릴 때는 운영자가 accounts.authority='shadow'로 복귀시키고 legacy_saves를 복원한다.
 */
async function maybeCutover(c: Ctx, account: AccountRow): Promise<AccountRow> {
  const percent = Math.max(0, Math.min(100, Math.floor(Number(c.env.V1_SERVER_AUTHORITY_PERCENT) || 0)));
  if (account.authority !== 'shadow' || account.shard >= percent) return account;
  await c.db.prepare("UPDATE accounts SET authority = 'server' WHERE account_id = ? AND authority = 'shadow'").bind(account.account_id).run();
  return { ...account, authority: 'server' };
}

/** Authorization: Bearer v1.… 검사 + D1의 token_ver·상태 확인(로그아웃·차단 즉시 반영). */
export async function requireSession(c: Ctx): Promise<Authed> {
  const token = c.request.headers.get('authorization')?.match(/^Bearer (v1\.[A-Za-z0-9_.-]{1,1000})$/)?.[1];
  if (!token) fail(401, 'token');
  const check = await verifyToken(await secret(c.env), token, c.now);
  if (!check.ok) fail(401, check.reason === 'expired' ? 'token-expired' : 'token');
  const account = await accountById(c.db, check.claims.aid);
  if (!account || account.token_ver !== check.claims.ver) fail(401, 'token-revoked');
  assertActive(account);
  return { claims: check.claims, account };
}

export const providerSubject = (provider: string, sub: string): Promise<string> => sha256Hex(provider + ':' + sub);

async function subjectHash(c: Ctx, provider: unknown, idToken: unknown): Promise<string> {
  if (!(PROVIDERS as readonly unknown[]).includes(provider)) fail(400, 'provider');
  // 카카오·ChatGPT는 서버 리다이렉트(인가 코드) 흐름으로만 받는다(oidc.ts). 클라이언트가 건넨 id_token은 받지 않는다.
  // P1은 구글만 연결한다. Play Games·토스는 서버 교환 흐름을 붙이는 레인에서 연다.
  if (provider !== 'google') fail(501, 'provider-unavailable');
  const clientIds = (c.env.GOOGLE_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!clientIds.length || !c.deps.verifyIdToken) fail(503, 'link-disabled');
  if (typeof idToken !== 'string' || idToken.length > 4096) fail(401, 'bad-token');
  let sub: string;
  try { ({ sub } = await c.deps.verifyIdToken!(provider, idToken, clientIds)); }
  catch (error) {
    if (error instanceof V1Error) throw error;
    const status = (error as { status?: number })?.status;
    fail(status === 503 ? 503 : 401, status === 503 ? 'link-unavailable' : 'bad-token');
  }
  if (typeof sub! !== 'string' || !sub) fail(401, 'bad-token');
  return providerSubject(provider, sub!);
}

const summary = (a: AccountRow) => ({ accountId: a.account_id, level: a.level, stageIdx: a.stage_idx, lastSeen: a.last_seen });

export async function link(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['provider', 'idToken']);
  const hash = await subjectHash(c, body.provider, body.idToken);
  return linkSubject(c, auth.account, body.provider as string, hash);
}

/** 이미 확인한 제공자 주체(해시)를 이 계정에 잇는다. 다른 계정에 이어져 있으면 409 linked-elsewhere(병합 금지). */
export async function linkSubject(c: Ctx, account: AccountRow, provider: string, hash: string) {
  const owner = await c.db.prepare('SELECT account_id FROM account_links WHERE provider = ? AND subject_hash = ?').bind(provider, hash).first<{ account_id: string }>();
  if (owner && owner.account_id !== account.account_id) {
    // 병합 금지: 양쪽 요약만 보여 주고 "그 계정으로 전환"(recover)만 허용한다.
    const other = await accountById(c.db, owner.account_id);
    fail(409, 'linked-elsewhere', { mine: summary(account), other: other ? summary(other) : null });
  }
  if (!owner) {
    const mine = await c.db.prepare('SELECT 1 AS x FROM account_links WHERE provider = ? AND account_id = ?').bind(provider, account.account_id).first();
    if (mine) fail(409, 'already-linked');
    try {
      // 탈퇴와 경쟁해도 deleting 계정에 연동이 남지 않게 계정 상태를 같은 문장에서 확인한다.
      const added = await c.db.prepare("INSERT INTO account_links(provider, subject_hash, account_id, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM accounts WHERE account_id = ? AND status IN ('active','muted'))")
        .bind(provider, hash, account.account_id, c.now, account.account_id).run();
      if (!added.meta?.changes) fail(403, 'deleted');
    } catch (error) {
      // 동시 요청이 먼저 같은 제공자 계정(PRIMARY KEY) 또는 이 계정의 같은 제공자(UNIQUE)를 차지했다: 500이 아니라 409.
      if (!isConstraint(error)) throw error;
      const winner = await c.db.prepare('SELECT account_id FROM account_links WHERE provider = ? AND subject_hash = ?').bind(provider, hash).first<{ account_id: string }>();
      if (winner && winner.account_id !== account.account_id) {
        const other = await accountById(c.db, winner.account_id);
        fail(409, 'linked-elsewhere', { mine: summary(account), other: other ? summary(other) : null });
      }
      fail(409, 'already-linked');
    }
  }
  return { linked: await links(c.db, account.account_id) };
}

export async function links(db: D1Database, accountId: string): Promise<string[]> {
  const rows = await db.prepare('SELECT provider FROM account_links WHERE account_id = ? ORDER BY provider').bind(accountId).all<{ provider: string }>();
  return (rows.results ?? []).map(r => r.provider);
}

/** 연동된 계정으로 이 기기를 전환한다. 이 기기의 연동 없는 게스트 계정은 90일 보관하고 키만 옮긴다. */
export async function recover(c: Ctx, body: Record<string, unknown>) {
  onlyKeys(body, ['provider', 'idToken', 'deviceKey', 'channel'], ['provider', 'idToken', 'deviceKey']);
  const channel = (body.channel ?? 'web') as Channel;
  if (!(CHANNELS as readonly unknown[]).includes(channel)) fail(400, 'channel');
  const keyHash = await deviceKeyHash(body.deviceKey);
  const hash = await subjectHash(c, body.provider, body.idToken);
  const { target, switchedFrom } = await recoverSubject(c, body.provider as string, hash, keyHash);
  return { ...await issueSession(c.env, target, channel, c.now), switchedFrom };
}

/** 이미 확인한 제공자 주체(해시)의 계정으로 이 기기 키를 옮긴다. */
export async function recoverSubject(c: Ctx, provider: string, hash: string, keyHash: string): Promise<{ target: AccountRow; switchedFrom: string | null }> {
  const owner = await c.db.prepare('SELECT account_id FROM account_links WHERE provider = ? AND subject_hash = ?').bind(provider, hash).first<{ account_id: string }>();
  if (!owner) fail(404, 'no-link');
  const target = await accountById(c.db, owner.account_id);
  if (!target) fail(404, 'no-link');
  assertActive(target);
  const current = await accountByKey(c.db, keyHash);
  // 제재(차단)·삭제 중인 계정의 기기 키로는 다른 계정으로 갈아타 제재를 피할 수 없다.
  if (current) assertActive(current);
  const writes = [];
  if (!current) writes.push(c.db.prepare('INSERT INTO account_keys(key_hash, account_id, created_at, last_seen) VALUES (?, ?, ?, ?)').bind(keyHash, target.account_id, c.now, c.now));
  else if (current.account_id !== target.account_id) {
    if ((await links(c.db, current.account_id)).length) fail(409, 'key-in-use');
    const doc = await c.db.prepare("SELECT doc FROM account_docs WHERE account_id = ? AND doc_name = 'core'").bind(current.account_id).first<{ doc: string }>();
    writes.push(
      c.db.prepare('INSERT INTO account_archive(archive_id, account_id, reason, doc, archived_at, purge_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('switch:' + randomHex(12), current.account_id, 'switched:' + target.account_id, doc?.doc ?? '{}', c.now, c.now + ARCHIVE_MS),
      c.db.prepare('UPDATE account_keys SET account_id = ?, last_seen = ? WHERE key_hash = ?').bind(target.account_id, c.now, keyHash),
    );
  }
  if (writes.length) await c.db.batch(writes);
  // 키가 5개를 넘으면 가장 오래 안 쓴 키부터 지운다(방금 쓴 키는 남긴다).
  const keys = await c.db.prepare('SELECT key_hash FROM account_keys WHERE account_id = ? AND key_hash != ? ORDER BY last_seen, created_at').bind(target.account_id, keyHash).all<{ key_hash: string }>();
  const stale = (keys.results ?? []).slice(0, Math.max(0, (keys.results ?? []).length + 1 - KEYS_PER_ACCOUNT));
  if (stale.length) await c.db.batch(stale.map(k => c.db.prepare('DELETE FROM account_keys WHERE key_hash = ?').bind(k.key_hash)));
  return { target, switchedFrom: current && current.account_id !== target.account_id ? current.account_id : null };
}

/** 연동 해제는 세션 토큰만으로 하지 않고 제공자 ID 토큰을 다시 확인한다(탈취된 세션이 복구 수단을 지우지 못하게). */
export async function unlink(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['provider', 'idToken']);
  if (!(PROVIDERS as readonly unknown[]).includes(body.provider)) fail(400, 'provider');
  const hash = await subjectHash(c, body.provider, body.idToken);
  const owned = await c.db.prepare('SELECT 1 AS x FROM account_links WHERE provider = ? AND subject_hash = ? AND account_id = ?')
    .bind(body.provider as string, hash, auth.account.account_id).first();
  if (!owned) fail(403, 'reauth-mismatch');
  await c.db.prepare('DELETE FROM account_links WHERE provider = ? AND account_id = ?').bind(body.provider as string, auth.account.account_id).run();
  return { linked: await links(c.db, auth.account.account_id) };
}

/** 모든 기기의 세션을 끊는다(token_ver 증가). */
export async function logoutAll(c: Ctx, auth: Authed) {
  await c.db.prepare('UPDATE accounts SET token_ver = token_ver + 1 WHERE account_id = ?').bind(auth.account.account_id).run();
  return { ok: true };
}

const DELETE_ARCHIVE_MS = 30 * 24 * 3600 * 1000;
/**
 * 회원 탈퇴: 계정을 deleting으로 바꾸고 모든 세션·연동·기기 키를 끊는다. 진행 문서는 30일 보관(파기 시점 purge_at) 뒤 정리 대상.
 * 결제 원장(wallet_ledger·iap_*)은 법정 보존 기간 때문에 여기서 지우지 않는다(docs/ACCOUNT_POLICY.md).
 */
export async function deleteAccount(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['confirm']);
  if (body.confirm !== 'DELETE') fail(400, 'confirm');
  const id = auth.account.account_id;
  // 환불 부채가 남았거나 1시간 안에 시작한 웹 결제(결제창 진행 중)가 있으면 탈퇴를 미룬다(새 키로 부채를 털고 다시 시작하는 회피 차단).
  const pending = await c.db.prepare(`SELECT
      (SELECT COUNT(*) FROM iap_debt WHERE account_id = ? AND amount > 0) AS debt,
      (SELECT COUNT(*) FROM iap_web_payments WHERE account_id = ? AND state = 'intent' AND created_at > ?) AS web`)
    .bind(id, id, c.now - 3600_000).first<{ debt: number; web: number }>();
  if (pending && (pending.debt > 0 || pending.web > 0)) fail(409, 'billing-pending');
  // 소셜 허브(채팅·친구·명예의 전당)의 기기 키·연동·관계를 먼저 지운다. 허브가 응답하지 않으면 탈퇴를 진행하지 않는다(재시도 가능).
  if (c.env.SOCIAL) {
    const hub = c.env.SOCIAL.get(c.env.SOCIAL.idFromName('hub:' + GAME_ID));
    const res = await hub.fetch(new Request('https://social.internal/internal/delete', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-social-internal': '1' }, body: JSON.stringify({ playerId: id }),
    }));
    if (!res.ok) fail(503, 'social-unavailable');
  }
  const doc = await c.db.prepare("SELECT doc FROM account_docs WHERE account_id = ? AND doc_name = 'core'").bind(id).first<{ doc: string }>();
  await c.db.batch([
    c.db.prepare('INSERT INTO account_archive(archive_id, account_id, reason, doc, archived_at, purge_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('delete:' + randomHex(12), id, 'deleted-by-user', doc?.doc ?? '{}', c.now, c.now + DELETE_ARCHIVE_MS),
    c.db.prepare("UPDATE accounts SET status = 'deleting', token_ver = token_ver + 1 WHERE account_id = ?").bind(id),
    c.db.prepare('DELETE FROM account_links WHERE account_id = ?').bind(id),
    c.db.prepare('DELETE FROM account_keys WHERE account_id = ?').bind(id),
  ]);
  return { ok: true };
}
