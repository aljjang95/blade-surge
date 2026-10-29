// 리다이렉트(인가 코드) 로그인: 카카오 로그인 OIDC, Sign in with ChatGPT(OpenAI OIDC). docs/ACCOUNT_POLICY.md.
// 흐름: 앱 → POST /auth/oauth/start(1회용 state·nonce·PKCE를 D1에 저장) → 제공자 로그인 → GET /auth/oauth/callback/<provider>
//   → 서버가 코드를 id_token으로 바꿔 서명·iss·aud·nonce를 검증 → link(세션 계정) 또는 recover(이 기기 키 이동) → 앱으로 302.
// 앱에는 결과 코드만 돌려준다(토큰·코드·제공자 식별자는 URL에 싣지 않는다). recover 뒤 앱은 같은 기기 키로 /auth/session을 다시 받는다.
// 클라이언트 ID가 비어 있는 제공자는 꺼진다(ChatGPT는 OpenAI 상업 파트너 승인 전까지 비어 있다).
import { fail, onlyKeys } from './http';
import { type AuthDeps, type AuthEnv, type Authed, type Ctx, type Provider, accountById, deviceKeyHash, linkSubject, providerSubject, recoverSubject } from './auth';
import { b64url, randomHex, sha256Hex, CHANNELS, type Channel, type SecretSource } from './token';
import { V1Error } from './db';
import { createGoogleVerifier } from '../../packages/tll-social/src/server/google';

export interface OidcEnv extends AuthEnv {
  APP_ORIGIN: string;
  /** 카카오 REST API 키(= OIDC client_id, id_token aud). 비면 카카오 로그인 꺼짐. */
  KAKAO_REST_KEY?: string;
  /** 카카오 Client Secret(선택, 콘솔에서 켰을 때만). Worker secret 또는 Secrets Store. */
  KAKAO_CLIENT_SECRET?: SecretSource;
  /** OpenAI가 발급한 client ID(oaiapp_…). 비면 ChatGPT 로그인 꺼짐. */
  CHATGPT_CLIENT_ID?: string;
  /** 기밀 클라이언트일 때만(client_secret_basic). */
  CHATGPT_CLIENT_SECRET?: SecretSource;
}

export const REDIRECT_PROVIDERS = ['kakao', 'chatgpt'] as const;
export type RedirectProvider = typeof REDIRECT_PROVIDERS[number];

interface ProviderConfig {
  authorize: string;
  token: string;
  issuer: string;
  jwks: string;
  scope: string;
  pkce: boolean;
  /** client_secret 전달 방식: 카카오는 본문(client_secret), OpenAI는 HTTP Basic만 허용. */
  secretIn: 'body' | 'basic';
  clientId(env: OidcEnv): string;
  secret(env: OidcEnv): SecretSource;
}

// 엔드포인트는 각 제공자 공식 문서 값(2026-10-29 확인, docs/ACCOUNT_POLICY.md에 URL).
// 카카오는 서버 기밀 교환(state·nonce, 선택 client_secret)으로 받고 PKCE는 쓰지 않는다. OpenAI는 PKCE(S256) 필수.
export const OIDC: Record<RedirectProvider, ProviderConfig> = {
  kakao: {
    authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token',
    issuer: 'https://kauth.kakao.com', jwks: 'https://kauth.kakao.com/.well-known/jwks.json', scope: 'openid', pkce: false, secretIn: 'body',
    clientId: env => (env.KAKAO_REST_KEY ?? '').trim(), secret: env => env.KAKAO_CLIENT_SECRET,
  },
  chatgpt: {
    authorize: 'https://auth.openai.com/api/accounts/authorize', token: 'https://auth.openai.com/api/accounts/oauth/token',
    issuer: 'https://auth.openai.com', jwks: 'https://auth.openai.com/.well-known/jwks.json', scope: 'openid profile email', pkce: true, secretIn: 'basic',
    clientId: env => (env.CHATGPT_CLIENT_ID ?? '').trim(), secret: env => env.CHATGPT_CLIENT_SECRET,
  },
};

/** 제공자 client secret(길이 제한 없음, 서명 키용 resolveSecret과 다르다). 비면 null. */
async function providerSecret(source: SecretSource): Promise<string | null> {
  const value = typeof source === 'string' ? source : source && typeof source.get === 'function' ? await source.get() : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const isRedirect = (p: unknown): p is RedirectProvider => (REDIRECT_PROVIDERS as readonly unknown[]).includes(p);
export const redirectUri = (env: OidcEnv, provider: RedirectProvider) => `${env.APP_ORIGIN}/api/v1/auth/oauth/callback/${provider}`;

/** 로그인 화면이 보여 줄 제공자. 키가 없는 제공자는 false(버튼 숨김). */
export function providerAvailability(env: OidcEnv) {
  return {
    google: (env.GOOGLE_CLIENT_IDS ?? '').split(',').some(s => s.trim()),
    kakao: !!OIDC.kakao.clientId(env),
    chatgpt: !!OIDC.chatgpt.clientId(env),
  };
}

const verifiers = new Map<RedirectProvider, ReturnType<typeof createGoogleVerifier>>();
/** 운영 id_token 검증기: 제공자별 JWKS·발급자. 코드 교환 직후 검증하므로 iat 허용은 기본 10분. */
export function verifyRedirectIdToken(provider: RedirectProvider, token: string, clientIds: string[]) {
  let v = verifiers.get(provider);
  if (!v) verifiers.set(provider, v = createGoogleVerifier({ jwksUrl: OIDC[provider].jwks, issuers: [OIDC[provider].issuer] }));
  return v.verify(token, clientIds);
}

export async function oauthStart(c: Ctx, auth: Authed | null, body: Record<string, unknown>) {
  onlyKeys(body, ['provider', 'mode', 'deviceKey', 'channel'], ['provider', 'mode']);
  const env = c.env as OidcEnv;
  if (!isRedirect(body.provider)) fail(400, 'provider');
  const provider = body.provider, cfg = OIDC[provider], clientId = cfg.clientId(env);
  if (!clientId) fail(501, 'provider-unavailable');
  const channel = (body.channel ?? 'web') as Channel;
  if (!(CHANNELS as readonly unknown[]).includes(channel)) fail(400, 'channel');
  let accountId: string | null = null, keyHash: string | null = null;
  if (body.mode === 'link') {
    if (!auth) fail(401, 'token');
    if (body.deviceKey !== undefined) fail(400, 'unknown-field', { field: 'deviceKey' });
    accountId = auth.account.account_id;
  } else if (body.mode === 'recover') {
    keyHash = await deviceKeyHash(body.deviceKey);
  } else fail(400, 'mode');
  const state = b64url(crypto.getRandomValues(new Uint8Array(32))), nonce = randomHex(16);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await c.db.batch([
    c.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(c.now),
    c.db.prepare('INSERT INTO oauth_states(state_hash, provider, mode, account_id, key_hash, channel, nonce, verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(state), provider, body.mode as string, accountId, keyHash, channel, nonce, verifier, c.now, c.now + STATE_TTL_MS),
  ]);
  const url = new URL(cfg.authorize);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri(env, provider));
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  if (cfg.pkce) {
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return { url: url.toString() };
}

interface StateRow { provider: string; mode: 'link' | 'recover'; account_id: string | null; key_hash: string | null; channel: string; nonce: string; verifier: string; expires_at: number }

/** 인가 코드를 id_token으로 바꾼다. 실패는 제공자 장애(503)와 거부(401)로 나눈다. */
async function exchange(c: Ctx, provider: RedirectProvider, code: string, verifier: string): Promise<string> {
  const env = c.env as OidcEnv, cfg = OIDC[provider], clientId = cfg.clientId(env);
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri(env, provider), code });
  if (cfg.pkce) form.set('code_verifier', verifier);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8', accept: 'application/json' };
  const secret = await providerSecret(cfg.secret(env));
  if (secret) {
    if (cfg.secretIn === 'basic') headers.authorization = 'Basic ' + btoa(encodeURIComponent(clientId) + ':' + encodeURIComponent(secret));
    else form.set('client_secret', secret);
  }
  const doFetch = (c.deps as AuthDeps).fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
  let response: Response;
  try { response = await doFetch(cfg.token, { method: 'POST', headers, body: form.toString() }); }
  catch { fail(503, 'link-unavailable'); }
  if (response!.status >= 500) fail(503, 'link-unavailable');
  let data: { id_token?: unknown } | null = null;
  try { data = await response!.json() as { id_token?: unknown }; } catch { data = null; }
  if (!response!.ok || typeof data?.id_token !== 'string' || data.id_token.length > 8192) fail(401, 'bad-token');
  return data!.id_token as string;
}

export type CallbackResult = 'ok' | 'no-link' | 'linked-elsewhere' | 'already-linked' | 'cancel' | 'expired' | 'error' | 'unavailable' | 'rate' | 'blocked';

/** 콜백 처리. 항상 앱으로 돌려보낼 결과 코드를 낸다(예외를 밖으로 던지지 않는다). */
export async function oauthCallback(c: Ctx, providerParam: string, params: URLSearchParams): Promise<{ result: CallbackResult; mode: string; provider: string }> {
  const provider = isRedirect(providerParam) ? providerParam : null;
  const out = (result: CallbackResult, mode = '') => ({ result, mode, provider: provider ?? 'unknown' });
  if (!provider) return out('error');
  const state = params.get('state') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return out('error');
  // 1회용: 읽는 순간 지운다(같은 state 재사용·동시 콜백 차단).
  const row = await c.db.prepare('DELETE FROM oauth_states WHERE state_hash = ? RETURNING provider, mode, account_id, key_hash, channel, nonce, verifier, expires_at')
    .bind(await sha256Hex(state)).first<StateRow>();
  if (!row || row.provider !== provider) return out('expired');
  if (row.expires_at < c.now) return out('expired', row.mode);
  // 사용자가 동의 화면에서 취소했거나 제공자가 오류를 돌려줬다.
  if (params.get('error')) return out(params.get('error') === 'access_denied' ? 'cancel' : 'error', row.mode);
  const code = params.get('code') ?? '';
  if (!code || code.length > 2048) return out('error', row.mode);
  try {
    const clientId = OIDC[provider].clientId(c.env as OidcEnv);
    if (!clientId) return out('unavailable', row.mode);
    const idToken = await exchange(c, provider, code, row.verifier);
    const verify = (c.deps as AuthDeps).verifyIdToken;
    if (!verify) return out('unavailable', row.mode);
    const claims = await verify(provider, idToken, [clientId]);
    if (claims.nonce !== row.nonce || typeof claims.sub !== 'string' || !claims.sub) return out('error', row.mode);
    const hash = await providerSubject(provider as Provider, claims.sub);
    if (row.mode === 'link') {
      const account = row.account_id ? await accountById(c.db, row.account_id) : null;
      if (!account || (account.status !== 'active' && account.status !== 'muted')) return out('blocked', row.mode);
      await linkSubject(c, account, provider, hash);
    } else {
      if (!row.key_hash) return out('error', row.mode);
      await recoverSubject(c, provider, hash, row.key_hash);
    }
    return out('ok', row.mode);
  } catch (error) {
    if (error instanceof V1Error) {
      if (error.code === 'no-link') return out('no-link', row.mode);
      if (error.code === 'linked-elsewhere' || error.code === 'already-linked') return out(error.code, row.mode);
      if (error.code === 'banned' || error.code === 'deleted' || error.code === 'key-in-use') return out('blocked', row.mode);
      if (error.status === 503) return out('unavailable', row.mode);
      return out('error', row.mode);
    }
    const status = (error as { status?: number })?.status;
    return out(status === 503 ? 'unavailable' : 'error', row.mode);
  }
}

/** 콜백 결과를 앱 주소로 돌려보내는 302. 쿼리에는 결과 코드만 싣는다. */
export function callbackRedirect(env: OidcEnv, r: { result: string; mode: string; provider: string }): Response {
  const url = new URL(env.APP_ORIGIN + '/');
  url.searchParams.set('login', r.provider);
  url.searchParams.set('result', r.result);
  if (r.mode) url.searchParams.set('mode', r.mode);
  return new Response(null, { status: 302, headers: { location: url.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
