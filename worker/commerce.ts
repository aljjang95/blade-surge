// Paid commerce is deliberately unavailable. This module only prepares a
// disabled, versioned catalog and a server-verified player subject.
export const COMMERCE_CATALOG_VERSION = '2026-09-23.preview-v1';
export const PREVIEW_CATALOG = [
  { sku: 'starter', amountKRW: 1200 },
  { sku: 'monthly', amountKRW: 5900 },
  { sku: 'growth', amountKRW: 12000 },
  { sku: 'boss_pack', amountKRW: 33000 },
  { sku: 'vip_pass', amountKRW: 19000 },
  { sku: 'gem1', amountKRW: 3900 },
  { sku: 'gem2', amountKRW: 12000 },
  { sku: 'gem3', amountKRW: 25000 },
  { sku: 'gem4', amountKRW: 39000 },
  { sku: 'gem5', amountKRW: 79000 },
  { sku: 'gem6', amountKRW: 129000 },
  { sku: 'enh_pack', amountKRW: 22000 },
  { sku: 'pass', amountKRW: 9900 },
] as const;

interface Statement {
  bind(...values: (string | number)[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
}
export interface CommerceDatabase { prepare(query: string): Statement }
export interface CommerceEnv {
  APP_ORIGIN: string;
  COMMERCE_DB?: CommerceDatabase;
  COMMERCE_IDENTITY_ENABLED?: string;
  COMMERCE_GOOGLE_CLIENT_ID?: string;
  COMMERCE_SUBJECT_HMAC_KEY?: string;
  COMMERCE_SUBJECT_KEY_VERSION?: string;
  COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY?: string;
  COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION?: string;
}
type CatalogRow = { sku: string; amount_krw: number; currency: string; sale_enabled: number };
type Identity = { issuer: string; subject: string };
const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string; kty?: string };
type KeySetCache = { keys: GoogleJwk[]; expiresAt: number };
const keySets = new WeakMap<typeof fetch, KeySetCache | Promise<KeySetCache>>();

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function bytesFromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 8192) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded), bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch { return null; }
}
function jsonPart(value: string): Record<string, unknown> | null {
  const bytes = bytesFromBase64Url(value);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
async function googlePublicKeys(fetchKeys: typeof fetch): Promise<GoogleJwk[]> {
  const now = Date.now();
  const cached = keySets.get(fetchKeys);
  if (cached instanceof Promise) return (await cached).keys;
  if (cached && cached.expiresAt > now) return cached.keys;
  const pending = (async (): Promise<KeySetCache> => {
    try {
      const response = await fetchKeys(GOOGLE_KEYS, { redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok || Number(response.headers.get('content-length')) > 65536) throw new Error('keys unavailable');
      const body = await response.text();
      if (body.length > 65536) throw new Error('keys too large');
      const set: unknown = JSON.parse(body);
      const keys = set && typeof set === 'object' && 'keys' in set ? (set as { keys: unknown }).keys : null;
      if (!Array.isArray(keys) || keys.length > 32) throw new Error('invalid keys');
      const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
      const seconds = maxAge ? Math.min(3600, Math.max(60, Number(maxAge[1]))) : 300;
      return { keys: keys as GoogleJwk[], expiresAt: now + seconds * 1000 };
    } catch { return { keys: [], expiresAt: now + 15000 }; }
  })();
  keySets.set(fetchKeys, pending);
  const result = await pending;
  keySets.set(fetchKeys, result);
  return result.keys;
}
export async function verifyGoogleIdToken(token: string, clientId: string, fetchKeys: typeof fetch = fetch, nowSeconds = Math.floor(Date.now() / 1000)): Promise<Identity | null> {
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const header = jsonPart(headerPart), claims = jsonPart(payloadPart), signature = bytesFromBase64Url(signaturePart);
  if (!header || !claims || !signature || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 128) return null;
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') return null;
  if (claims.aud !== clientId || (claims.azp !== undefined && claims.azp !== clientId)) return null;
  if (!Number.isInteger(claims.exp) || (claims.exp as number) <= nowSeconds) return null;
  if (claims.iat !== undefined && (!Number.isInteger(claims.iat) || (claims.iat as number) > nowSeconds + 60)) return null;
  if (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || (claims.nbf as number) > nowSeconds + 60)) return null;
  if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)) return null;
  try {
    const keys = await googlePublicKeys(fetchKeys);
    const jwk = keys.find((key) => key && typeof key === 'object' && key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signed)) return null;
    // Google publishes both issuer spellings for the same account. Bind one subject.
    return { issuer: 'https://accounts.google.com', subject: claims.sub };
  } catch { return null; }
}
async function subjectHash(identity: Identity, encodedKey: string): Promise<string | null> {
  const raw = bytesFromBase64Url(encodedKey);
  if (!raw || raw.byteLength !== 32) return null;
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${identity.issuer}\0${identity.subject}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function keyVersionMatches(db: CommerceDatabase, version: string, encodedKey: string, register: boolean): Promise<boolean> {
  const proof = await subjectHash({ issuer: 'blade-surge-commerce', subject: 'key-version-proof-v1' }, encodedKey);
  if (!proof) return false;
  if (register) {
    const inserted = await db.prepare('INSERT OR IGNORE INTO commerce_key_versions (key_version, key_proof) VALUES (?, ?)')
      .bind(version, proof).run();
    if (!inserted.success) return false;
  }
  const row = await db.prepare('SELECT key_proof FROM commerce_key_versions WHERE key_version = ?')
    .bind(version).first<{ key_proof: string }>();
  return row?.key_proof === proof;
}
async function getPlayerId(db: CommerceDatabase, identity: Identity, currentKey: string, currentVersion: string, previousKey?: string): Promise<string | null> {
  const hash = await subjectHash(identity, currentKey);
  if (!hash) return null;
  const existing = await db.prepare('SELECT player_id FROM commerce_subjects WHERE subject_hash = ?').bind(hash).first<{ player_id: string }>();
  if (existing) return /^[a-f0-9-]{36}$/.test(existing.player_id) ? existing.player_id : null;
  let previousPlayerId: string | null = null;
  if (previousKey) {
    const previousHash = await subjectHash(identity, previousKey);
    if (!previousHash || previousHash === hash) return null;
    const previous = await db.prepare('SELECT player_id FROM commerce_subjects WHERE subject_hash = ?').bind(previousHash).first<{ player_id: string }>();
    previousPlayerId = previous?.player_id ?? null;
    if (previousPlayerId && !/^[a-f0-9-]{36}$/.test(previousPlayerId)) return null;
  }
  const created = await db.prepare('INSERT OR IGNORE INTO commerce_subjects (subject_hash, player_id, key_version, created_at) VALUES (?, ?, ?, ?)')
    .bind(hash, previousPlayerId ?? crypto.randomUUID(), currentVersion, new Date().toISOString()).run();
  if (!created.success) return null;
  const row = await db.prepare('SELECT player_id FROM commerce_subjects WHERE subject_hash = ?').bind(hash).first<{ player_id: string }>();
  if (!row || !/^[a-f0-9-]{36}$/.test(row.player_id) || (previousPlayerId && row.player_id !== previousPlayerId)) return null;
  return row.player_id;
}
async function rotationSafe(db: CommerceDatabase, currentVersion: string, previousVersion?: string): Promise<boolean> {
  const pending = await db.prepare(`SELECT DISTINCT old.key_version FROM commerce_subjects AS old
    WHERE old.key_version <> ? AND NOT EXISTS (
      SELECT 1 FROM commerce_subjects AS current
      WHERE current.player_id = old.player_id AND current.key_version = ?
    ) AND NOT EXISTS (
      SELECT 1 FROM commerce_subjects AS previous
      WHERE previous.player_id = old.player_id AND previous.key_version = ? AND old.key_version <> ?
    ) LIMIT 2`).bind(currentVersion, currentVersion, previousVersion ?? '', previousVersion ?? '').all<{ key_version: string }>();
  return Array.isArray(pending.results) && pending.results.every((row) => row.key_version === previousVersion);
}
async function disabledCatalog(db: CommerceDatabase): Promise<CatalogRow[] | null> {
  const result = await db.prepare('SELECT sku, amount_krw, currency, sale_enabled FROM commerce_catalog WHERE catalog_version = ? ORDER BY sku')
    .bind(COMMERCE_CATALOG_VERSION).all<CatalogRow>();
  const rows = result.results;
  if (!Array.isArray(rows) || rows.length !== PREVIEW_CATALOG.length) return null;
  const expected = new Map<string, number>(PREVIEW_CATALOG.map((item) => [item.sku, item.amountKRW]));
  if (rows.some((row) => !expected.has(row.sku) || expected.get(row.sku) !== row.amount_krw || row.currency !== 'KRW' || row.sale_enabled !== 0)) return null;
  return rows;
}
export async function handleCommerceRequest(request: Request, env: CommerceEnv, fetchKeys: typeof fetch = fetch): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/commerce/orders') return json({ error: 'billing-unavailable' }, 503);
  if (path === '/api/commerce/catalog' && request.method === 'GET') {
    if (!env.COMMERCE_DB) return json({ error: 'unavailable' }, 503);
    try {
      const rows = await disabledCatalog(env.COMMERCE_DB);
      if (!rows) return json({ error: 'unavailable' }, 503);
      return json({ version: COMMERCE_CATALOG_VERSION, saleEnabled: false, items: rows.map((row) => ({ id: row.sku, amountKRW: row.amount_krw, currency: row.currency, saleEnabled: false })) });
    } catch { return json({ error: 'unavailable' }, 503); }
  }
  if (path === '/api/commerce/me' && request.method === 'GET') {
    if (env.COMMERCE_IDENTITY_ENABLED !== 'true' || !env.COMMERCE_DB || !env.COMMERCE_GOOGLE_CLIENT_ID || !env.COMMERCE_SUBJECT_HMAC_KEY || !env.COMMERCE_SUBJECT_KEY_VERSION) return json({ error: 'unavailable' }, 503);
    if (!/^[a-z0-9-]{1,24}$/.test(env.COMMERCE_SUBJECT_KEY_VERSION)) return json({ error: 'unavailable' }, 503);
    if (env.COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY || env.COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION) {
      if (!env.COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY || !env.COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION
        || !/^[a-z0-9-]{1,24}$/.test(env.COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION)
        || env.COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION === env.COMMERCE_SUBJECT_KEY_VERSION
        || env.COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY === env.COMMERCE_SUBJECT_HMAC_KEY) return json({ error: 'unavailable' }, 503);
    }
    if (new URL(request.url).origin !== env.APP_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin' }, 403);
    const authorization = request.headers.get('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/.exec(authorization);
    if (!match) return json({ error: 'unauthorized' }, 401);
    const identity = await verifyGoogleIdToken(match[1], env.COMMERCE_GOOGLE_CLIENT_ID, fetchKeys);
    if (!identity) return json({ error: 'unauthorized' }, 401);
    try {
      if (!await rotationSafe(env.COMMERCE_DB, env.COMMERCE_SUBJECT_KEY_VERSION, env.COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION)) return json({ error: 'unavailable' }, 503);
      if (env.COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION && env.COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY
        && !await keyVersionMatches(env.COMMERCE_DB, env.COMMERCE_PREVIOUS_SUBJECT_KEY_VERSION, env.COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY, false)) return json({ error: 'unavailable' }, 503);
      if (!await keyVersionMatches(env.COMMERCE_DB, env.COMMERCE_SUBJECT_KEY_VERSION, env.COMMERCE_SUBJECT_HMAC_KEY, true)) return json({ error: 'unavailable' }, 503);
      const playerId = await getPlayerId(env.COMMERCE_DB, identity, env.COMMERCE_SUBJECT_HMAC_KEY,
        env.COMMERCE_SUBJECT_KEY_VERSION, env.COMMERCE_PREVIOUS_SUBJECT_HMAC_KEY);
      return playerId ? json({ playerId, saleEnabled: false }) : json({ error: 'unavailable' }, 503);
    } catch { return json({ error: 'unavailable' }, 503); }
  }
  return json({ error: 'not-found' }, 404);
}
