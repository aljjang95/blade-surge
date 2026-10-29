// MMO P1: /api/v1/* 라우터. worker/index.ts에는 마운트 한 줄만 둔다.
// 기능 플래그 V1_ENABLED가 'true'가 아니면 전체가 503이다(기본 비활성, 운영 개방은 코디네이터).
import { rateLimit, ipKey } from './limit';
import { schemaReady, V1Error, type D1Database } from './db';
import { IMPORT_LIMIT, json, readJson } from './http';
import { createSession, deleteAccount, link, logoutAll, recover, requireSession, unlink, type AuthDeps, type AuthEnv, type Ctx } from './auth';
import { callbackRedirect, oauthCallback, oauthStart, providerAvailability, verifyRedirectIdToken, type OidcEnv } from './oidc';
import { getMe, runCommand } from './cmd';
import { settleRun, startRun } from './runs';
import { importLegacy, settleLegacyCompensation, shadowSnapshot } from './import';
import { createGoogleVerifier } from '../../packages/tll-social/src/server/google';
import { catalog, intent, state as iapState, verify as iapVerify, type IapDeps, type IapEnv } from './iap';
import { handleRtdn } from './rtdn';
import { webBillingOn, webComplete, webIntent, webPayMethods, type PortoneDeps, type PortoneEnv } from './portone';
import { ingestFunnel } from './funnel';

export const V1_PREFIX = '/api/v1';
export interface V1Env extends AuthEnv, IapEnv, PortoneEnv, OidcEnv {
  APP_ORIGIN: string;
  V1_ENABLED?: string;
  SOCIAL_DEV_ORIGINS?: string;
}
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
const allowedOrigin = (origin: string, env: V1Env) => origin === env.APP_ORIGIN || (env.SOCIAL_DEV_ORIGINS === 'true' && LOCAL.test(origin));

let googleVerifier: ReturnType<typeof createGoogleVerifier> | null = null;
export const defaultDeps: AuthDeps & IapDeps & PortoneDeps = {
  now: () => Date.now(),
  // Pub/Sub push OIDC 토큰은 만료 전까지 재사용될 수 있어 발급 후 1시간까지 받는다(구글 로그인 토큰은 기존 10분).
  verifyIdToken: (provider, token, clientIds) => provider === 'kakao' || provider === 'chatgpt' ? verifyRedirectIdToken(provider, token, clientIds)
    : (googleVerifier ??= createGoogleVerifier()).verify(token, clientIds, provider === 'pubsub' ? 3600000 : 600000),
};

/** webBilling은 서버 권위 계정에게만 켠다(그림자·로컬 계정은 roster를 서버가 강제하지 못해 현금 판매를 열지 않는다). */
export function v1Flags(env: V1Env, accountId?: string | null, authority?: string | null): Record<string, boolean> {
  return { v1: env.V1_ENABLED === 'true', serverAuthority: (Number(env.V1_SERVER_AUTHORITY_PERCENT) || 0) > 0, iap: env.IAP_ENABLED === 'true', webBilling: authority === 'server' && webBillingOn(env, accountId),
    // 웹 결제창의 간편결제 선택지(카드는 항상). 웹 결제가 켜진 계정에만 의미가 있다.
    ...(() => { const on = authority === 'server' && webBillingOn(env, accountId), m = webPayMethods(env);
      return { webKakaoPay: on && m.includes('KAKAOPAY'), webNaverPay: on && m.includes('NAVERPAY'), webTossPay: on && m.includes('TOSSPAY') }; })() };
}

export async function handleV1Request(request: Request, env: V1Env, deps: AuthDeps & IapDeps & PortoneDeps = defaultDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(V1_PREFIX.length) || '/';
  try {
    if (env.V1_ENABLED !== 'true') return json({ error: 'unavailable' }, 503);
    if (path.length > 120 || url.search.length > 256) return json({ error: 'too-long' }, 414);
    // RTDN은 브라우저가 아니라 Google Pub/Sub이 부른다(Origin 없음). OIDC 토큰으로 따로 인증한다.
    if (path === '/iap/rtdn') {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      const rtdnDb = env.COMMERCE_DB as D1Database | undefined;
      if (!rtdnDb || !await schemaReady(rtdnDb)) return json({ error: 'unavailable' }, 503);
      const rc: Ctx = { env, db: rtdnDb, deps, now: deps.now(), request };
      await rateLimit(rc, 'rtdn', 'global');
      const r = await handleRtdn(rc);
      return json({ outcome: r.outcome }, r.status);
    }
    // 리다이렉트 로그인 콜백은 제공자 페이지에서 오는 최상위 이동이다(cross-site, Origin 없음). state(1회용)로 인증한다.
    const callback = path.match(/^\/auth\/oauth\/callback\/([a-z]{1,16})$/);
    if (callback) {
      if (request.method !== 'GET') return json({ error: 'method' }, 405);
      const cbDb = env.COMMERCE_DB as D1Database | undefined;
      if (!cbDb || !await schemaReady(cbDb)) return callbackRedirect(env, { provider: callback[1], result: 'unavailable', mode: '' });
      const cc: Ctx = { env, db: cbDb, deps, now: deps.now(), request };
      try { await rateLimit(cc, 'oauthCallback', await ipKey(request)); }
      catch { return callbackRedirect(env, { provider: callback[1], result: 'rate', mode: '' }); }
      return callbackRedirect(env, await oauthCallback(cc, callback[1], url.searchParams));
    }
    const origin = request.headers.get('origin');
    // 상태를 바꾸는 요청은 허용 origin이 반드시 있어야 한다(네이티브 앱은 index.ts가 정식 origin으로 바꾼다).
    // 브라우저는 같은 출처 GET에 Origin을 붙이지 않는다. GET은 Bearer 토큰(쿠키 아님)만 받으므로 Origin 없이 허용한다.
    if (!allowedOrigin(url.origin, env) || (origin === null ? request.method !== 'GET' : !allowedOrigin(origin, env))
      || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin' }, 403);
    const db = env.COMMERCE_DB as D1Database | undefined;
    if (!db || !await schemaReady(db)) return json({ error: 'unavailable' }, 503);
    const c: Ctx = { env, db, deps, now: deps.now(), request };
    const method = request.method;
    // 비인증 경로는 요청 IP(해시)로 먼저 제한한다. 본문을 읽거나 DB·제공자를 부르기 전에 거른다.
    if (method === 'POST' && path === '/auth/session') {
      await rateLimit(c, 'session', await ipKey(request));
      const session = await createSession(c, await readJson(request));
      // 컷오버된 계정의 기존 이용자 보상(1회). 실패해도 세션은 내준다(다음 세션에서 다시 시도, 원장 op_id로 중복 없음).
      if (session.authority === 'server') { try { await settleLegacyCompensation(c, session.accountId); } catch { /* 다음 세션에서 재시도 */ } }
      return json(session);
    }
    if (method === 'GET' && path === '/auth/providers') { await rateLimit(c, 'providers', await ipKey(request)); return json(providerAvailability(env)); }
    if (method === 'POST' && path === '/auth/oauth/start') {
      await rateLimit(c, 'oauthStart', await ipKey(request));
      // link는 세션이 필요하고 recover는 기기 키만 받는다(세션 헤더가 있으면 link로 쓰려는 것).
      const auth = request.headers.has('authorization') ? await requireSession(c) : null;
      return json(await oauthStart(c, auth, await readJson(request)));
    }
    if (method === 'POST' && path === '/auth/recover') { await rateLimit(c, 'recover', await ipKey(request)); return json(await recover(c, await readJson(request))); }
    if (method === 'GET' && path === '/me') { const auth = await requireSession(c); return json(await getMe(c, auth, v1Flags(env, auth.account.account_id, auth.account.authority))); }
    if (method === 'GET' && (path === '/iap/catalog' || path === '/iap/state')) {
      const auth = await requireSession(c);
      await rateLimit(c, 'iapRead', auth.account.account_id);
      return json(path === '/iap/catalog' ? await catalog(c, auth) : await iapState(c, auth));
    }
    if (method === 'POST') {
      const auth = await requireSession(c);
      if (path === '/auth/link') return json(await link(c, auth, await readJson(request)));
      if (path === '/auth/unlink') return json(await unlink(c, auth, await readJson(request)));
      if (path === '/auth/logout-all') return json(await logoutAll(c, auth));
      if (path === '/auth/delete') { await rateLimit(c, 'accountDelete', await ipKey(request)); return json(await deleteAccount(c, auth, await readJson(request))); }
      if (path === '/cmd') { await rateLimit(c, 'cmd', auth.account.account_id); return json(await runCommand(c, auth, await readJson(request))); }
      if (path === '/import') { await rateLimit(c, 'import', await ipKey(request)); return json(await importLegacy(c, auth, await readJson(request, IMPORT_LIMIT))); }
      if (path === '/shadow/snapshot') return json(await shadowSnapshot(c, auth, await readJson(request, IMPORT_LIMIT)));
      if (path === '/iap/intent') { await rateLimit(c, 'iap', auth.account.account_id); return json(await intent(c, auth, await readJson(request))); }
      if (path === '/iap/web/intent') { await rateLimit(c, 'iap', auth.account.account_id); return json(await webIntent(c, auth, await readJson(request))); }
      if (path === '/iap/web/complete') { await rateLimit(c, 'iap', auth.account.account_id); return json(await webComplete(c, auth, await readJson(request))); }
      if (path === '/iap/verify') { await rateLimit(c, 'iap', auth.account.account_id); return json(await iapVerify(c, auth, await readJson(request))); }
      if (path === '/funnel') { await rateLimit(c, 'funnel', auth.account.account_id); return json(await ingestFunnel(c, auth, await readJson(request))); }
      if (path === '/runs/start') { await rateLimit(c, 'runStart', auth.account.account_id); return json(await startRun(c, auth, await readJson(request))); }
      const settle = path.match(/^\/runs\/([A-Za-z0-9_-]{8,64})\/settle$/);
      if (settle) return json(await settleRun(c, auth, settle[1], await readJson(request)));
    }
    return json({ error: 'not-found' }, 404);
  } catch (error) {
    if (error instanceof V1Error) {
      const retry: Record<string, string> = error.status === 429 && typeof error.extra.retryAfter === 'number' ? { 'Retry-After': String(error.extra.retryAfter) } : {};
      return json({ error: error.code, ...error.extra }, error.status, retry);
    }
    // 내부 오류 원문(SQL·식별자)은 응답에 싣지 않는다.
    console.warn('v1 error', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'internal' }, 500);
  }
}
