// 정본 계약: https://developers-apps-in-toss.toss.im/api/user-key
// https://developers-apps-in-toss.toss.im/api/iap
// https://developers-apps-in-toss.toss.im/guide/operation/toss (SDK 3.1.1+ Origin)
// https://developers.google.com/identity/sign-in/web/backend-auth
// https://developers.google.com/identity/protocols/oauth2/service-account
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/acknowledge
// https://onestore-dev.gitbook.io/dev/tools/billing/v21/serverapi (OAuth/getPurchaseDetails/acknowledgePurchase)

export type StoreChannel = 'web' | 'apps-in-toss' | 'googleplay' | 'onestore';
type BillingChannel = Exclude<StoreChannel, 'web'>;
type Obj = Record<string, unknown>;
export interface StoreD1Result<T = unknown> { success: boolean; results?: T[]; meta?: { changes?: number }; }
export interface StoreD1Statement {
  bind(...values: (string | number | null)[]): StoreD1Statement;
  first<T = Obj>(): Promise<T | null>;
  all<T = Obj>(): Promise<StoreD1Result<T>>;
  run(): Promise<StoreD1Result>;
}
export interface StoreD1Database {
  prepare(sql: string): StoreD1Statement;
  batch<T = unknown>(statements: StoreD1Statement[]): Promise<StoreD1Result<T>[]>;
}
interface SecretBinding { get(): Promise<string>; }
interface FetchBinding { fetch(request: Request): Promise<Response>; }
export interface StoreEnv {
  COMMERCE_DB?: StoreD1Database;
  COMMERCE_DATABASE_ID?: string;
  STORE_BILLING_ENABLED?: string;
  // 실제 Blade 전용 binding/cert CN을 코디네이터가 확인한 뒤만 설정한다.
  TOSS_MTLS?: FetchBinding;
  TOSS_MTLS_APP_NAME?: string;
  TOSS_REMOVE_ADS_ACTIVE?: string;
  TOSS_AD_GROUP_ID?: string;
  TOSS_AD_GROUP_ENABLED?: string;
  GOOGLE_PUBLISHER?: SecretBinding;
  BLADESURGE_GOOGLE_CLIENT_ID?: string;
  BLADESURGE_GOOGLE_PACKAGE_NAME?: string;
  BLADESURGE_GOOGLE_IDENTITY_READY?: string;
  // 각 채널의 검증된 Android/web OAuth presenter ID JSON 배열. 누락/잘못된 배열은 비활성이다.
  BLADESURGE_GOOGLEPLAY_GOOGLE_PRESENTERS?: string;
  BLADESURGE_ONESTORE_GOOGLE_PRESENTERS?: string;
  BLADESURGE_ONE_GOOGLE_IDENTITY_ENABLED?: string;
  GOOGLE_REMOVE_ADS_ACTIVE?: string;
  ONE_REMOVE_ADS_ACTIVE?: string;
  ONE_SERVER_API_ENABLED?: string;
  ONE_PUBLISHER?: SecretBinding;
  BLADESURGE_ONE_PACKAGE_NAME?: string;
  BLADESURGE_ONE_API_CLIENT_ID?: string;
  BLADESURGE_ONE_OAUTH_CLIENT_ID?: string;
  // 제공자에서 Blade 소유/등록을 확인한 뒤 코디네이터가 채널별 승인 ID와 활성 플래그를 설정한다.
  // 빌드에 사용한 실제 ID도 일치해야 한다. 누락/샘플/다른 제품 ID는 승인으로 간주하지 않는다.
  BLADESURGE_ADMOB_PACKAGE_NAME?: string;
  BLADESURGE_GOOGLEPLAY_ADS_ENABLED?: string;
  BLADESURGE_GOOGLEPLAY_ADMOB_APP_ID?: string;
  BLADESURGE_GOOGLEPLAY_ADMOB_INTERSTITIAL_ID?: string;
  BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_APP_ID?: string;
  BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_INTERSTITIAL_ID?: string;
  BLADESURGE_ONESTORE_ADS_ENABLED?: string;
  BLADESURGE_ONESTORE_ADMOB_APP_ID?: string;
  BLADESURGE_ONESTORE_ADMOB_INTERSTITIAL_ID?: string;
  BLADESURGE_ONESTORE_ADMOB_APPROVED_APP_ID?: string;
  BLADESURGE_ONESTORE_ADMOB_APPROVED_INTERSTITIAL_ID?: string;
}

export const STORE_DATABASE_ID = '88d8e114-6c6d-408a-acca-52ede4e94d28';
export const STORE_PRODUCT_ID = 'remove_ads_v1';
export const TOSS_REMOVE_ADS_SKU = 'ait.0000085379.795abd69.3e2153580e.1772243239';
export const TOSS_AD_GROUP_ID = 'ait.v2.live.b311470e6321418c';
export const GOOGLE_PACKAGE_NAME = 'com.theluxurylord.bladesurge';
export const STORE_SESSION_MS = 15 * 60_000;
export const STORE_NEW_INTENTS_PER_HOUR = 60;
export const STORE_UNCLAIMED_INTENTS_LIMIT = 20;
export const STORE_METADATA_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const STORE_METADATA_CLEANUP_LIMIT = 500;
export interface StoreMetadataCleanupResult {
  cutoff: number;
  deleted: { sessions: number; authCodes: number; budgets: number; intents: number };
}
const INTENT_MS = 30 * 60_000;
const PROVIDER_MS = 5_000;
const MAX_BYTES = 100_000;
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_OAUTH = 'https://oauth2.googleapis.com/token';
const ONE_BASE = 'https://iap-apis.onestore.net';
const TOSS_BASE = 'https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss';
const ORIGINS: Record<StoreChannel, readonly string[]> = {
  web: ['https://blade.tllhouse.com'],
  'apps-in-toss': ['https://blade-surge.apps.tossmini.com', 'https://blade-surge.private-apps.tossmini.com'],
  googleplay: ['https://localhost'], onestore: ['https://localhost'],
};
interface Session { subject: string; channel: BillingChannel; expires_at: number; }
interface Intent { intent_id: string; subject: string; channel: BillingChannel; sku: string; purchase_hash: string | null; expires_at: number; }
interface Ledger { subject: string; channel: BillingChannel; purchase_hash: string; toss_order_id: string | null; state: 'paid' | 'unpaid' | 'refunded'; }
interface Verified { hash: string; reference: string | null; state: Ledger['state']; }
class StoreError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function fail(status: number, code: string): never { throw new StoreError(status, code); }
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid-schema');
  return value as Obj;
}
function exact(value: Obj, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) fail(400, 'unknown-field');
}
function string(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x20\x7f]/.test(value)) fail(400, 'invalid-field');
  return value;
}
export function normalizeStoreChannel(value: unknown): StoreChannel {
  if (value !== 'web' && value !== 'apps-in-toss' && value !== 'googleplay' && value !== 'onestore') fail(400, 'invalid-channel');
  return value;
}
async function budget(env: StoreEnv, key: string, limit: number): Promise<void> {
  const row = await db(env).prepare(`INSERT INTO store_budgets(budget_hash, window_start, calls) VALUES (?, ?, 1)
    ON CONFLICT(budget_hash, window_start) DO UPDATE SET calls = calls + 1 WHERE calls < ? RETURNING calls`)
    .bind(await storeHash(key), Math.floor(Date.now() / 3_600_000), limit).first();
  if (!row) fail(429, 'store-budget-exceeded');
}
export async function storeHash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function base64url(bytes: Uint8Array): string {
  let text = ''; for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail(401, 'identity-invalid');
  try { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
  catch { return fail(401, 'identity-invalid'); }
}
function randomToken(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
async function deadline<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new StoreError(503, 'provider-unavailable')); }, PROVIDER_MS);
    })]);
  } catch (e) {
    if (e instanceof StoreError) throw e;
    // 제공자의 본문/URL/키/오류를 응답이나 로그에 복사하지 않는다.
    return fail(503, 'provider-unavailable');
  } finally { if (timer) clearTimeout(timer); }
}
async function readJson(message: Request | Response, limit: number, signal?: AbortSignal): Promise<unknown> {
  const reader = message.body?.getReader();
  if (!reader) fail(400, 'invalid-json');
  let total = 0;
  const chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > limit) fail(413, 'body-limit');
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) { void reader.cancel().catch(() => {}); if (e instanceof StoreError) throw e; return fail(400, 'invalid-json'); }
  finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}
async function providerJson(url: string, init: RequestInit = {}, binding?: FetchBinding): Promise<Obj> {
  return deadline(async signal => {
    const request = new Request(url, { ...init, signal, redirect: 'error' });
    const response = binding ? await binding.fetch(request) : await fetch(request);
    if (!response.ok) fail(503, 'provider-unavailable');
    try { return object(await readJson(response, 200_000, signal)); }
    catch { return fail(503, 'provider-invalid-response'); }
  });
}
async function run(statement: StoreD1Statement): Promise<StoreD1Result> {
  const result = await statement.run(); if (!result.success) fail(503, 'store-unavailable'); return result;
}
function db(env: StoreEnv): StoreD1Database { return env.COMMERCE_DB ?? fail(503, 'store-binding-missing'); }
function sku(ch: BillingChannel): string { return ch === 'apps-in-toss' ? TOSS_REMOVE_ADS_SKU : STORE_PRODUCT_ID; }
function googleIdentityReady(env: StoreEnv): boolean {
  return env.BLADESURGE_GOOGLE_IDENTITY_READY === 'true'
    && typeof env.BLADESURGE_GOOGLE_CLIENT_ID === 'string'
    && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.BLADESURGE_GOOGLE_CLIENT_ID);
}
function googlePresenterIds(env: StoreEnv, ch: 'googleplay' | 'onestore'): string[] | null {
  const raw = ch === 'googleplay' ? env.BLADESURGE_GOOGLEPLAY_GOOGLE_PRESENTERS : env.BLADESURGE_ONESTORE_GOOGLE_PRESENTERS;
  if (!raw || raw.length > 4096) return null;
  try {
    const ids: unknown = JSON.parse(raw);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8
      || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id))
      || new Set(ids).size !== ids.length) return null;
    return ids as string[];
  } catch { return null; }
}
async function storeBindingReason(env: StoreEnv): Promise<string | null> {
  if (!env.COMMERCE_DB || env.COMMERCE_DATABASE_ID !== STORE_DATABASE_ID) return 'store-binding-missing';
  try {
    const binding = await env.COMMERCE_DB.prepare('SELECT database_id, schema_version FROM store_binding WHERE singleton = 1').first<{ database_id: string; schema_version: number }>();
    if (binding?.database_id !== STORE_DATABASE_ID || binding.schema_version !== 1) return 'store-schema-missing';
  } catch { return 'store-schema-missing'; }
  return null;
}

// 예약 진입점/Cron 연결은 코디네이터 소유다. HTTP 삭제 API나 계정 삭제 기능이 아니다.
// 세션/intent는 만료 뒤 30일, 교환 코드는 사용 뒤 30일, 예산은 해당 시간 창 종료 뒤 30일을 보존한다.
// 구매 원장과 지급/환불 이력에 연결된 intent는 삭제하지 않는다. 상태가 불명인 영수증도 보존한다.
// https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
export async function cleanupStoreMetadata(env: StoreEnv): Promise<StoreMetadataCleanupResult> {
  const reason = await storeBindingReason(env);
  if (reason) fail(503, reason);
  const database = db(env), cutoff = Date.now() - STORE_METADATA_RETENTION_MS;
  // 시간 창의 끝이 정확히 cutoff인 경우도 아직 '30일 초과'가 아니므로 보존한다.
  const hourCutoff = Math.ceil(cutoff / 3_600_000) - 1;
  // 확인과 실행 사이에 metadata가 달라져도 삭제 대상 identity를 각 문장 안에서 다시 검사한다.
  const identity = 'EXISTS (SELECT 1 FROM store_binding WHERE singleton = 1 AND database_id = ? AND schema_version = 1)';
  const statements = [
    database.prepare(`DELETE FROM store_sessions WHERE token_hash IN (
      SELECT token_hash FROM store_sessions WHERE expires_at < ? AND ${identity}
      ORDER BY expires_at, token_hash LIMIT 500)`).bind(cutoff, STORE_DATABASE_ID),
    database.prepare(`DELETE FROM store_auth_codes WHERE code_hash IN (
      SELECT code_hash FROM store_auth_codes WHERE used_at < ? AND ${identity}
      ORDER BY used_at, code_hash LIMIT 500)`).bind(cutoff, STORE_DATABASE_ID),
    database.prepare(`DELETE FROM store_budgets WHERE (budget_hash, window_start) IN (
      SELECT budget_hash, window_start FROM store_budgets WHERE window_start < ? AND ${identity}
      ORDER BY window_start, budget_hash LIMIT 500)`).bind(hourCutoff, STORE_DATABASE_ID),
    database.prepare(`DELETE FROM store_intents WHERE intent_id IN (
      SELECT i.intent_id FROM store_intents i WHERE i.expires_at < ? AND ${identity}
        AND (i.purchase_hash IS NULL OR EXISTS (
          SELECT 1 FROM store_ledger l WHERE l.channel = i.channel AND l.purchase_hash = i.purchase_hash
            AND l.subject = i.subject AND l.product_id = i.product_id AND l.sku = i.sku
            AND l.state = 'unpaid' AND l.grant_count = 0))
      ORDER BY i.expires_at, i.intent_id LIMIT 500)`).bind(cutoff, STORE_DATABASE_ID),
  ];
  try {
    const results = await database.batch(statements);
    if (results.length !== 4 || results.some(result => !result.success || !Number.isSafeInteger(result.meta?.changes)
      || result.meta!.changes! < 0 || result.meta!.changes! > STORE_METADATA_CLEANUP_LIMIT)) fail(503, 'store-cleanup-unverified');
    return { cutoff, deleted: { sessions: results[0].meta!.changes!, authCodes: results[1].meta!.changes!,
      budgets: results[2].meta!.changes!, intents: results[3].meta!.changes! } };
  } catch (error) {
    if (error instanceof StoreError) throw error;
    // D1 오류가 query/식별자 값을 포함해도 예약 호출자에게 원문을 전달하지 않는다.
    return fail(503, 'store-cleanup-unavailable');
  }
}
async function billingReason(env: StoreEnv, ch: StoreChannel): Promise<string | null> {
  if (env.STORE_BILLING_ENABLED !== 'true') return 'billing-disabled';
  const bindingReason = await storeBindingReason(env);
  if (bindingReason) return bindingReason;
  if (ch === 'web') return 'web-billing-unsupported';
  if (ch === 'apps-in-toss') {
    if (!env.TOSS_MTLS || env.TOSS_MTLS_APP_NAME !== 'blade-surge') return 'toss-binding-missing';
    if (env.TOSS_REMOVE_ADS_ACTIVE !== 'true') return 'product-inactive';
    return null;
  }
  if (!googleIdentityReady(env)) return 'native-identity-not-ready';
  if (ch === 'onestore' && env.BLADESURGE_ONE_GOOGLE_IDENTITY_ENABLED !== 'true') return 'one-identity-not-configured';
  if (!googlePresenterIds(env, ch)) return 'native-presenters-not-configured';
  if (ch === 'onestore') return oneConfigurationReason(env);
  if (!env.GOOGLE_PUBLISHER) return 'google-binding-missing';
  if (env.BLADESURGE_GOOGLE_PACKAGE_NAME !== GOOGLE_PACKAGE_NAME) return 'google-package-not-configured';
  if (env.GOOGLE_REMOVE_ADS_ACTIVE !== 'true') return 'product-inactive';
  return null;
}
function oneConfigurationReason(env: StoreEnv): string | null {
  if (env.ONE_SERVER_API_ENABLED !== 'true') return 'one-api-disabled';
  if (!env.ONE_PUBLISHER) return 'one-binding-missing';
  if (env.BLADESURGE_ONE_PACKAGE_NAME !== GOOGLE_PACKAGE_NAME) return 'one-package-not-configured';
  const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
  if (!validId(env.BLADESURGE_ONE_API_CLIENT_ID) || !validId(env.BLADESURGE_ONE_OAUTH_CLIENT_ID)) return 'one-app-not-configured';
  if (env.ONE_REMOVE_ADS_ACTIVE !== 'true') return 'product-inactive';
  return null;
}
function nativeAdConfiguration(env: StoreEnv, ch: 'googleplay' | 'onestore'): { appId: string; interstitialId: string } | null {
  // https://developers.google.com/admob/android/quick-start
  // https://developers.google.com/admob/android/test-ads
  const enabled = ch === 'googleplay' ? env.BLADESURGE_GOOGLEPLAY_ADS_ENABLED : env.BLADESURGE_ONESTORE_ADS_ENABLED;
  const approvedApp = ch === 'googleplay' ? env.BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_APP_ID : env.BLADESURGE_ONESTORE_ADMOB_APPROVED_APP_ID;
  const approvedUnit = ch === 'googleplay' ? env.BLADESURGE_GOOGLEPLAY_ADMOB_APPROVED_INTERSTITIAL_ID : env.BLADESURGE_ONESTORE_ADMOB_APPROVED_INTERSTITIAL_ID;
  const app = ch === 'googleplay' ? env.BLADESURGE_GOOGLEPLAY_ADMOB_APP_ID : env.BLADESURGE_ONESTORE_ADMOB_APP_ID;
  const unit = ch === 'googleplay' ? env.BLADESURGE_GOOGLEPLAY_ADMOB_INTERSTITIAL_ID : env.BLADESURGE_ONESTORE_ADMOB_INTERSTITIAL_ID;
  if (enabled !== 'true' || env.BLADESURGE_ADMOB_PACKAGE_NAME !== GOOGLE_PACKAGE_NAME
    || typeof app !== 'string' || typeof unit !== 'string' || app !== approvedApp || unit !== approvedUnit) return null;
  const appMatch = /^ca-app-pub-(\d{16})~\d{10}$/.exec(app);
  const unitMatch = /^ca-app-pub-(\d{16})\/\d{10}$/.exec(unit);
  if (!appMatch || !unitMatch || appMatch[1] !== unitMatch[1]
    || appMatch[1] === '3940256099942544' || appMatch[1] === '0000000000000000') return null;
  return { appId: app, interstitialId: unit };
}
async function advertisingAllowed(env: StoreEnv, ch: StoreChannel, billingFailure: string | null): Promise<boolean> {
  // ads는 설정 capability다. 결제가 활성인 채널은 실제 광고 직전에 최신 entitlement 검증이 필요하며
  // 제공자 오류/세션 만료/영수증 누락을 광고 허용으로 대체하지 않는다. SDK/실폰 증거를 뜻하지 않는다.
  const configured = ch === 'apps-in-toss'
    ? env.TOSS_AD_GROUP_ID === TOSS_AD_GROUP_ID && env.TOSS_AD_GROUP_ENABLED === 'true'
    : ch === 'googleplay' || ch === 'onestore' ? !!nativeAdConfiguration(env, ch) : false;
  if (!configured) return false;
  // 광고 설정은 결제 활성 플래그와 독립이다. 다만 DB를 읽지 못하면 과거 광고 제거 지급을 배제할 수 없다.
  if (await storeBindingReason(env)) return false;
  if (!billingFailure) return true;
  const activeProduct = ch === 'apps-in-toss' ? env.TOSS_REMOVE_ADS_ACTIVE
    : ch === 'googleplay' ? env.GOOGLE_REMOVE_ADS_ACTIVE : env.ONE_REMOVE_ADS_ACTIVE;
  if (activeProduct === 'true') return false;
  try {
    const previousGrant = await db(env).prepare('SELECT purchase_hash FROM store_ledger WHERE channel = ? AND grant_count = 1 LIMIT 1').bind(ch).first();
    return !previousGrant;
  } catch { return false; }
}
function checkOrigin(request: Request, ch: StoreChannel): void {
  const origin = request.headers.get('origin');
  if (origin && !ORIGINS[ch].includes(origin)) fail(403, 'origin-denied');
  const declared = request.headers.get('x-store-channel');
  if (declared && declared !== ch) fail(403, 'channel-mismatch');
  if (request.headers.has('cookie')) fail(400, 'cookie-auth-unsupported');
}
function response(value: unknown, status: number, origin?: string | null): Response {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  } });
}
async function authenticate(request: Request, env: StoreEnv, ch: BillingChannel): Promise<Session> {
  const auth = request.headers.get('authorization');
  if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) fail(401, 'session-invalid');
  const session = await db(env).prepare('SELECT subject, channel, expires_at FROM store_sessions WHERE token_hash = ?')
    .bind(await storeHash(auth.slice(7))).first<Session>();
  if (!session || session.expires_at <= Date.now()) fail(401, 'session-expired');
  if (session.channel !== ch) fail(403, 'channel-mismatch');
  return session;
}

// aud 설정은 Blade의 유일한 값만 사용한다. 다른 앱 service account나 OAuth client를 추론하지 않는다.
async function googleSubject(idToken: string, env: StoreEnv, ch: 'googleplay' | 'onestore'): Promise<string> {
  if (!googleIdentityReady(env) || (ch === 'onestore' && env.BLADESURGE_ONE_GOOGLE_IDENTITY_ENABLED !== 'true')) fail(503, 'native-identity-not-ready');
  const presenters = googlePresenterIds(env, ch); if (!presenters) fail(503, 'native-presenters-not-configured');
  const parts = idToken.split('.'); if (parts.length !== 3) fail(401, 'identity-invalid');
  let header: Obj, claims: Obj;
  try {
    header = object(JSON.parse(new TextDecoder().decode(decodeBase64(parts[0]))));
    claims = object(JSON.parse(new TextDecoder().decode(decodeBase64(parts[1]))));
  } catch { return fail(401, 'identity-invalid'); }
  const now = Math.floor(Date.now() / 1000);
  const presenter = claims.azp === undefined ? claims.aud : claims.azp;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256
    || header.jku !== undefined || header.jwk !== undefined || header.crit !== undefined
    || claims.aud !== env.BLADESURGE_GOOGLE_CLIENT_ID
    || (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com')
    || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)
    || (claims.exp as number) <= now || (claims.iat as number) > now || (claims.iat as number) < now - 3600
    || (claims.exp as number) <= (claims.iat as number) || (claims.exp as number) - (claims.iat as number) > 3600
    // https://developers.google.com/identity/openid-connect/openid-connect#an-id-tokens-payload
    // hybrid Android는 azp와 web aud가 다를 수 있다. azp가 없으면 aud가 presenter이며 역시 명시 허용 목록에 있어야 한다.
    || typeof presenter !== 'string' || !presenters.includes(presenter)
    || typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)) fail(401, 'identity-invalid');
  const jwks = await providerJson(GOOGLE_JWKS);
  if (!Array.isArray(jwks.keys)) fail(503, 'identity-provider-invalid');
  const keys = jwks.keys.filter(k => k && typeof k === 'object' && (k as Obj).kid === header.kid);
  if (keys.length !== 1) fail(401, 'identity-invalid');
  const jwk = keys[0] as JsonWebKey;
  if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') fail(401, 'identity-invalid');
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) fail(401, 'identity-invalid');
  } catch { return fail(401, 'identity-invalid'); }
  return storeHash(`${ch}:${claims.sub}`);
}
async function issueSession(body: Obj, env: StoreEnv, ch: BillingChannel): Promise<Obj> {
  let subject: string;
  if (ch === 'apps-in-toss') {
    exact(body, ['channel', 'code']);
    const code = string(body.code);
    const used = await run(db(env).prepare('INSERT OR IGNORE INTO store_auth_codes(code_hash, used_at) VALUES (?, ?)').bind(await storeHash(`apps-in-toss:${code}`), Date.now()));
    if (used.meta?.changes !== 1) fail(409, 'auth-code-replayed');
    const result = await providerJson(`${TOSS_BASE}/users/anon-key/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    }, env.TOSS_MTLS);
    if (result.resultType !== 'SUCCESS') fail(401, 'identity-invalid');
    let anonKey: string;
    try { anonKey = string(object(result.success).anonKey); } catch { return fail(401, 'identity-invalid'); }
    subject = await storeHash(`apps-in-toss:${anonKey}`);
  } else {
    exact(body, ['channel', 'idToken']);
    subject = await googleSubject(string(body.idToken, 16_384), env, ch);
  }
  const token = randomToken(), now = Date.now(), expiresAt = now + STORE_SESSION_MS;
  await run(db(env).prepare('INSERT INTO store_sessions(token_hash, channel, subject, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await storeHash(token), ch, subject, now, expiresAt));
  return { token, expiresAt, subject };
}
async function prepareIntent(body: Obj, env: StoreEnv, session: Session): Promise<Obj> {
  exact(body, ['channel', 'productId', 'idempotencyKey']);
  if (body.productId !== STORE_PRODUCT_ID) fail(400, 'unknown-product');
  const key = string(body.idempotencyKey, 128), hash = await storeHash(key), now = Date.now();
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  // UNIQUE admission과 두 제한은 한 INSERT에서 판정한다. 재시도는 기존 intent를 반환하며 새 allocation을 소비하지 않는다.
  // LIMIT으로 오래된 대량 metadata가 있어도 admission용 count는 필요한 상한까지만 읽는다.
  await run(db(env).prepare(`INSERT OR IGNORE INTO store_intents
    (intent_id, subject, channel, product_id, sku, idempotency_hash, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM store_intents WHERE subject = ? AND channel = ? AND created_at >= ? LIMIT ${STORE_NEW_INTENTS_PER_HOUR})) < ${STORE_NEW_INTENTS_PER_HOUR}
      AND (SELECT COUNT(*) FROM (SELECT 1 FROM store_intents WHERE subject = ? AND channel = ? AND purchase_hash IS NULL AND expires_at > ? LIMIT ${STORE_UNCLAIMED_INTENTS_LIMIT})) < ${STORE_UNCLAIMED_INTENTS_LIMIT}`)
    .bind(crypto.randomUUID(), session.subject, session.channel, STORE_PRODUCT_ID, sku(session.channel), hash, now, now + INTENT_MS,
      session.subject, session.channel, hourStart, session.subject, session.channel, now));
  const intent = await db(env).prepare('SELECT intent_id, expires_at, sku FROM store_intents WHERE subject = ? AND channel = ? AND idempotency_hash = ?')
    .bind(session.subject, session.channel, hash).first<Intent>();
  if (!intent) fail(429, 'intent-admission-limit');
  if (intent.expires_at <= now) fail(409, 'intent-expired');
  return { intentId: intent.intent_id, productId: STORE_PRODUCT_ID, sku: intent.sku, type: 'NON_CONSUMABLE', expiresAt: intent.expires_at, obfuscatedAccountId: await storeHash(session.subject) };
}
function receipt(body: Obj, ch: BillingChannel): string {
  return string(ch === 'apps-in-toss' ? body.orderId : body.purchaseToken);
}
async function ownedLedger(env: StoreEnv, session: Session, hash: string): Promise<Ledger | null> {
  const row = await db(env).prepare('SELECT subject, channel, purchase_hash, toss_order_id, state FROM store_ledger WHERE channel = ? AND purchase_hash = ?')
    .bind(session.channel, hash).first<Ledger>();
  if (row && row.subject !== session.subject) fail(409, 'purchase-owned-by-another-subject');
  return row;
}
async function claimIntent(body: Obj, env: StoreEnv, session: Session, hash: string): Promise<void> {
  const id = string(body.intentId, 64);
  const result = await run(db(env).prepare(`UPDATE store_intents SET purchase_hash = ? WHERE intent_id = ? AND subject = ? AND channel = ?
    AND product_id = ? AND sku = ? AND expires_at > ? AND (purchase_hash IS NULL OR purchase_hash = ?)`)
    .bind(hash, id, session.subject, session.channel, STORE_PRODUCT_ID, sku(session.channel), Date.now(), hash));
  if (result.meta?.changes !== 1) fail(409, 'intent-invalid-or-used');
}
async function publisherToken(env: StoreEnv): Promise<string> {
  if (!env.GOOGLE_PUBLISHER) fail(503, 'google-binding-missing');
  return deadline(async () => {
    let service: Obj;
    try { service = object(JSON.parse(await env.GOOGLE_PUBLISHER!.get())); }
    catch { return fail(503, 'google-credentials-invalid'); }
    if (service.type !== 'service_account' || typeof service.client_email !== 'string'
      || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(service.client_email)
      || typeof service.private_key !== 'string' || (service.token_uri !== undefined && service.token_uri !== GOOGLE_OAUTH)) fail(503, 'google-credentials-invalid');
    try {
      const pem = service.private_key.replace(/^-----BEGIN PRIVATE KEY-----\s*/, '').replace(/\s*-----END PRIVATE KEY-----\s*$/, '').replace(/\s/g, '');
      const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
      const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: service.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: GOOGLE_OAUTH, iat: now, exp: now + 3600 })}`;
      const assertion = `${unsigned}.${base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))))}`;
      const result = await providerJson(GOOGLE_OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
      if (result.token_type !== 'Bearer' || typeof result.access_token !== 'string' || !result.access_token.length
        || typeof result.expires_in !== 'number' || result.expires_in <= 0) fail(503, 'provider-invalid-response');
      return result.access_token;
    } catch (e) { if (e instanceof StoreError) throw e; return fail(503, 'google-credentials-invalid'); }
  });
}
// Secrets Store JSON binding은 {client_id, client_secret, package_name, api_client_id, environment:'production-v7'}.
// package/API clientId는 승인된 Blade 앱 등록에서 확인한 metadata다. OAuth 계정이나 다른 제품 키로 추론하지 않는다.
// V7는 2025-03-20 이후 앱의 URL에 clientId/PID를 사용한다. 기존 국내 전용 legacy host로 자동 fallback하지 않는다.
async function onePublisherToken(env: StoreEnv): Promise<string> {
  const reason = oneConfigurationReason(env); if (reason) fail(503, reason);
  return deadline(async () => {
    let credentials: Obj;
    try { credentials = object(JSON.parse(await env.ONE_PUBLISHER!.get())); }
    catch { return fail(503, 'one-credentials-invalid'); }
    if (credentials.client_id !== env.BLADESURGE_ONE_OAUTH_CLIENT_ID
      || credentials.api_client_id !== env.BLADESURGE_ONE_API_CLIENT_ID
      || credentials.package_name !== GOOGLE_PACKAGE_NAME || credentials.environment !== 'production-v7'
      || typeof credentials.client_secret !== 'string' || !credentials.client_secret.length
      || credentials.client_secret.length > 4096 || /[\x00-\x20\x7f]/.test(credentials.client_secret)) fail(503, 'one-credentials-invalid');
    const result = await providerJson(`${ONE_BASE}/v7/oauth/token`, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-market-code': 'MKT_ONE' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.client_id as string, client_secret: credentials.client_secret }).toString(),
    });
    if (result.client_id !== env.BLADESURGE_ONE_OAUTH_CLIENT_ID || result.token_type !== 'bearer'
      || !Number.isSafeInteger(result.expires_in) || (result.expires_in as number) <= 0
      || typeof result.access_token !== 'string' || !result.access_token.length || result.access_token.length > 4096
      || /[\x00-\x20\x7f]/.test(result.access_token)) fail(503, 'provider-invalid-response');
    return result.access_token;
  });
}
function onePurchaseState(result: Obj, accountId: string): Ledger['state'] {
  // V7 상세 응답은 상품/토큰/패키지를 echo하지 않는다. 그 값은 고정 상용 host와 승인된 clientId/상품/token 경로로 결박한다.
  if (result.developerPayload !== accountId) fail(409, 'purchase-account-mismatch');
  if (result.quantity !== 1 || typeof result.purchaseId !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(result.purchaseId)
    || !Number.isSafeInteger(result.purchaseTime) || (result.purchaseTime as number) <= 0 || (result.purchaseTime as number) > Date.now()
    || (result.consumptionState !== 0 && result.consumptionState !== 1)
    || (result.acknowledgeState !== 0 && result.acknowledgeState !== 1)) fail(422, 'purchase-unverified');
  if (result.purchaseState === 1) return 'refunded';
  if (result.purchaseState !== 0 || result.consumptionState !== 0) fail(422, 'purchase-unverified');
  return 'paid';
}
async function verifyOnePurchase(env: StoreEnv, session: Session, value: string, hash: string): Promise<Verified> {
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(value) || /^SANDBOX/i.test(value)) fail(400, 'invalid-purchase-token');
  const accessToken = await onePublisherToken(env), accountId = await storeHash(session.subject);
  const clientId = encodeURIComponent(env.BLADESURGE_ONE_API_CLIENT_ID!);
  const path = `/v7/apps/${clientId}/purchases/inapp/products/${STORE_PRODUCT_ID}/${encodeURIComponent(value)}`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'x-market-code': 'MKT_ONE' };
  let result = await providerJson(`${ONE_BASE}${path}`, { headers });
  let state = onePurchaseState(result, accountId);
  if (state === 'paid' && result.acknowledgeState === 0) {
    // 먼저 developerPayload를 비교한다. ack 업데이트로 다른 사람의 구매를 자기 계정으로 바꾸지 않는다.
    const acknowledged = await providerJson(`${ONE_BASE}/v7/apps/${clientId}/purchases/all/products/${STORE_PRODUCT_ID}/${encodeURIComponent(value)}/acknowledge`, {
      method: 'POST', headers, body: JSON.stringify({ developerPayload: accountId }),
    });
    let success: Obj;
    try { success = object(acknowledged.result); } catch { return fail(503, 'provider-invalid-response'); }
    if (success.code !== 'Success') fail(503, 'provider-invalid-response');
    const purchaseId = result.purchaseId;
    result = await providerJson(`${ONE_BASE}${path}`, { headers });
    if (result.purchaseId !== purchaseId) fail(422, 'purchase-mismatch');
    state = onePurchaseState(result, accountId);
    if (state === 'paid' && result.acknowledgeState !== 1) fail(503, 'purchase-acknowledgement-unverified');
  }
  // 영구 상품은 acknowledge만 사용한다. consume/revoke/refund API는 호출하지 않는다.
  return { hash, reference: null, state };
}
async function verifyProvider(env: StoreEnv, session: Session, value: string): Promise<Verified> {
  const hash = await storeHash(value);
  await ownedLedger(env, session, hash);
  await budget(env, `lookup:${session.channel}:${session.subject}`, 60);
  if (session.channel === 'apps-in-toss') {
    const result = await providerJson(`${TOSS_BASE}/order/get-order-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: value }),
    }, env.TOSS_MTLS);
    if (result.resultType !== 'SUCCESS') fail(503, 'provider-unavailable');
    let purchase: Obj;
    try { purchase = object(result.success); } catch { return fail(503, 'provider-invalid-response'); }
    if (purchase.orderId !== value || purchase.sku !== TOSS_REMOVE_ADS_SKU) fail(422, 'purchase-mismatch');
    const states = ['PAYMENT_COMPLETED', 'PURCHASED', 'REFUNDED', 'FAILED', 'ORDER_IN_PROGRESS'];
    if (!states.includes(purchase.status as string) || typeof purchase.statusDeterminedAt !== 'string'
      || !Number.isFinite(Date.parse(purchase.statusDeterminedAt))) fail(422, 'purchase-unverified');
    // 현재 공식 IAP schema에는 사용자 키 필터가 없다. 주문의 최초 소유권은 아래 원장 CAS로 고정한다.
    // anon-code는 로그인만 증명하고 인증서 CN은 미니앱만 결박한다. 실제 결제자와 anonKey의 일치는
    // 이 응답으로 증명할 수 없다. 이 경로는 정확한 주문 ID를 가진 최초 인증 사용자에게 결박하는
    // bearer-receipt 모델이며, 이미 결박된 구매는 다른 subject가 재사용할 수 없다.
    return { hash, reference: value, state: purchase.status === 'REFUNDED' ? 'refunded'
      : purchase.status === 'PAYMENT_COMPLETED' || purchase.status === 'PURCHASED' ? 'paid' : 'unpaid' };
  }
  if (session.channel === 'onestore') return verifyOnePurchase(env, session, value, hash);
  if (env.BLADESURGE_GOOGLE_PACKAGE_NAME !== GOOGLE_PACKAGE_NAME) fail(503, 'google-package-not-configured');
  const accessToken = await publisherToken(env);
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases`;
  const authorization = { Authorization: `Bearer ${accessToken}` };
  const result = await providerJson(`${base}/productsv2/tokens/${encodeURIComponent(value)}`, { headers: authorization });
  const items = result.productLineItem;
  if (!Array.isArray(items) || items.length !== 1) fail(422, 'purchase-mismatch');
  let item: Obj, offer: Obj, state: unknown;
  try { item = object(items[0]); offer = object(item.productOfferDetails); state = object(result.purchaseStateContext).purchaseState; }
  catch { return fail(422, 'purchase-unverified'); }
  if (item.productId !== STORE_PRODUCT_ID || offer.quantity !== 1 || result.testPurchaseContext !== undefined
    || offer.rentOfferDetails !== undefined || offer.preorderOfferDetails !== undefined
    || offer.consumptionState !== 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED') fail(422, 'purchase-mismatch');
  // 소유자가 검증되지 않은 legacy 영수증을 최초 보유자에게 결박하지 않는다. 누락/불일치는 ack 전에 거부한다.
  if (result.obfuscatedExternalAccountId !== await storeHash(session.subject)) fail(409, 'purchase-account-mismatch');
  if (state === 'CANCELLED' || offer.refundableQuantity === 0) return { hash, reference: null, state: 'refunded' };
  if (state === 'PENDING') return { hash, reference: null, state: 'unpaid' };
  if (state !== 'PURCHASED' || offer.refundableQuantity !== 1) fail(422, 'purchase-unverified');
  if (result.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    await deadline(async signal => {
      const response = await fetch(new Request(`${base}/products/${STORE_PRODUCT_ID}/tokens/${encodeURIComponent(value)}:acknowledge`, {
        method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' }, body: '{}', signal, redirect: 'error',
      }));
      if (!response.ok) fail(503, 'provider-unavailable');
    });
  } else if (result.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') fail(422, 'purchase-unverified');
  // 영구 상품은 acknowledge만 사용하고 consume하지 않는다.
  return { hash, reference: null, state: 'paid' };
}
async function recordPurchase(env: StoreEnv, session: Session, purchase: Verified): Promise<void> {
  await run(db(env).prepare(`INSERT INTO store_ledger
    (channel, purchase_hash, subject, product_id, sku, toss_order_id, state, grant_count, granted_at, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel, purchase_hash) DO UPDATE SET
      state = CASE WHEN store_ledger.state = 'refunded' THEN 'refunded' ELSE excluded.state END,
      grant_count = CASE WHEN store_ledger.state != 'refunded' AND excluded.state = 'paid' THEN 1 ELSE store_ledger.grant_count END,
      granted_at = CASE WHEN store_ledger.state != 'refunded' AND excluded.state = 'paid' THEN COALESCE(store_ledger.granted_at, excluded.granted_at) ELSE store_ledger.granted_at END,
      checked_at = excluded.checked_at
    WHERE store_ledger.subject = excluded.subject AND store_ledger.sku = excluded.sku`)
    .bind(session.channel, purchase.hash, session.subject, STORE_PRODUCT_ID, sku(session.channel), purchase.reference, purchase.state,
      purchase.state === 'paid' ? 1 : 0, purchase.state === 'paid' ? Date.now() : null, Date.now()));
  // INSERT/CAS 경합 뒤에도 반드시 소유자를 다시 확인한다.
  if (!await ownedLedger(env, session, purchase.hash)) fail(503, 'store-unavailable');
}
async function adFree(env: StoreEnv, session: Session, checkedHashes: string[]): Promise<boolean> {
  if (!checkedHashes.length) return false;
  // 금융 기록의 총수는 제한하지 않는다. 이번에 제공자에게 조회한 영수증만 positive 권한의 근거가 된다.
  const row = await db(env).prepare(`SELECT purchase_hash FROM store_ledger WHERE subject = ? AND channel = ? AND state = 'paid'
    AND purchase_hash IN (${checkedHashes.map(() => '?').join(',')}) LIMIT 1`)
    .bind(session.subject, session.channel, ...checkedHashes).first();
  return !!row;
}
async function refresh(env: StoreEnv, session: Session, values: string[]): Promise<Obj> {
  let receipts = [...new Set(values)];
  if (receipts.length > 20) fail(400, 'invalid-receipts');
  if (!receipts.length) {
    const existing = await db(env).prepare(`SELECT subject, channel, purchase_hash, toss_order_id, state FROM store_ledger
      WHERE subject = ? AND channel = ? AND state = 'paid' ORDER BY checked_at, purchase_hash LIMIT 20`)
      .bind(session.subject, session.channel).all<Ledger>();
    if (!existing.success) fail(503, 'store-unavailable');
    // native 토큰은 저장하지 않는다. Toss GET도 한 번에 최대 20건만 재조회하고 cached positive를 반환하지 않는다.
    receipts = (existing.results ?? []).map(row => row.toss_order_id ?? fail(503, 'restore-receipts-required'));
  }
  // 실패를 먼저 반환하지 않고 가능한 환불은 기록한다. 하나라도 조회 실패면 positive 권한은 반환하지 않는다.
  let failure: unknown;
  for (const value of receipts) {
    try { await recordPurchase(env, session, await verifyProvider(env, session, value)); }
    catch (e) { failure ??= e; }
  }
  if (failure) throw failure;
  return { adFree: await adFree(env, session, await Promise.all(receipts.map(storeHash))) };
}

// entrypoint는 이 함수에 요청을 위임한다. 설정/DB 적용/배포는 코디네이터 소유다.
// POST는 channel을 포함한다. GET entitlements는 ?channel= 또는 X-Store-Channel을 사용한다.
// Google GET은 원문 토큰을 저장하지 않고 X-Store-Receipt로 재검증하거나 POST restore를 사용한다.
export async function handleStoreRequest(request: Request, env: StoreEnv): Promise<Response> {
  let corsOrigin: string | null = null;
  try {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/api/store/')) fail(404, 'not-found');
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin');
      if (!origin || !Object.values(ORIGINS).some(list => list.includes(origin))) fail(403, 'origin-denied');
      const method = request.headers.get('access-control-request-method');
      if (method !== 'GET' && method !== 'POST') fail(405, 'method-denied');
      const headers = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
      if (headers.some(h => !['authorization', 'content-type', 'x-store-channel', 'x-store-receipt'].includes(h))) fail(403, 'header-denied');
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Store-Channel, X-Store-Receipt',
        'Cache-Control': 'no-store', Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      } });
    }
    const isGet = path === '/api/store/capabilities' || path === '/api/store/entitlements';
    if (request.method !== (isGet ? 'GET' : 'POST')) fail(405, 'method-denied');
    if (!['/api/store/capabilities', '/api/store/entitlements', '/api/store/auth', '/api/store/orders', '/api/store/verify', '/api/store/restore'].includes(path)) fail(404, 'not-found');
    let body: Obj = {};
    if (!isGet) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') fail(415, 'json-required');
      body = await deadline(async signal => object(await readJson(request, MAX_BYTES, signal)));
    }
    if ([...url.searchParams.keys()].some(k => k !== 'channel') || url.searchParams.getAll('channel').length > 1) fail(400, 'invalid-query');
    const ch = normalizeStoreChannel(isGet ? url.searchParams.get('channel') ?? request.headers.get('x-store-channel') : body.channel);
    if (!isGet && url.searchParams.has('channel') && url.searchParams.get('channel') !== ch) fail(403, 'channel-mismatch');
    checkOrigin(request, ch); corsOrigin = request.headers.get('origin');
    const reason = await billingReason(env, ch);
    if (path === '/api/store/capabilities') {
      const ads = await advertisingAllowed(env, ch, reason);
      const adConfiguration = ads && (ch === 'googleplay' || ch === 'onestore') ? nativeAdConfiguration(env, ch) : null;
      // 공개 ID만 반환한다. native의 adAppId/adsUnitId와 일치할 때만 client가 SDK를 실행한다.
      return response({ billing: !reason, ads, ...(adConfiguration ? { adConfiguration } : {}), ...(reason ? { reason } : {}) }, 200, corsOrigin);
    }
    if (reason) fail(503, reason);
    if (ch === 'web') fail(503, 'web-billing-unsupported');
    if (path === '/api/store/auth') {
      // CF가 덮어쓰는 연결 IP만 예산 키로 해시한다. 쿠키/UA/클라이언트 subject는 인증 경로가 아니다.
      await budget(env, `auth:${ch}:${request.headers.get('cf-connecting-ip') ?? 'unattributed'}`, 24);
      return response(await issueSession(body, env, ch), 200, corsOrigin);
    }
    const session = await authenticate(request, env, ch);
    if (path === '/api/store/orders') return response(await prepareIntent(body, env, session), 200, corsOrigin);
    if (path === '/api/store/verify') {
      exact(body, ['channel', 'intentId', ch === 'apps-in-toss' ? 'orderId' : 'purchaseToken']);
      const value = receipt(body, ch);
      await ownedLedger(env, session, await storeHash(value));
      await claimIntent(body, env, session, await storeHash(value));
      return response(await refresh(env, session, [value]), 200, corsOrigin);
    }
    if (path === '/api/store/restore') {
      exact(body, ['channel', 'orderId', 'purchaseToken', 'receipts']);
      let values: string[];
      if (body.receipts !== undefined) {
        if (body.orderId !== undefined || body.purchaseToken !== undefined || !Array.isArray(body.receipts) || body.receipts.length > 20) fail(400, 'invalid-receipts');
        values = body.receipts.map(value => {
          const r = object(value); exact(r, [ch === 'apps-in-toss' ? 'orderId' : 'purchaseToken']); return receipt(r, ch);
        });
      } else { exact(body, ['channel', ch === 'apps-in-toss' ? 'orderId' : 'purchaseToken']); values = [receipt(body, ch)]; }
      return response(await refresh(env, session, values), 200, corsOrigin);
    }
    const freshReceipt = request.headers.get('x-store-receipt');
    return response(await refresh(env, session, freshReceipt ? [string(freshReceipt)] : []), 200, corsOrigin);
  } catch (e) {
    const err = e instanceof StoreError ? e : new StoreError(503, 'store-unavailable');
    return response({ error: err.code, adFree: false }, err.status, corsOrigin);
  }
}
