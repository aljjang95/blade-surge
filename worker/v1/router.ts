// MMO P1: /api/v1/* 라우터. worker/index.ts에는 마운트 한 줄만 둔다.
// 기능 플래그 V1_ENABLED가 'true'가 아니면 전체가 503이다(기본 비활성, 운영 개방은 코디네이터).
import { schemaReady, V1Error, type D1Database } from './db';
import { IMPORT_LIMIT, json, readJson } from './http';
import { createSession, link, logoutAll, recover, requireSession, unlink, type AuthDeps, type AuthEnv, type Ctx } from './auth';
import { getMe, runCommand } from './cmd';
import { settleRun, startRun } from './runs';
import { importLegacy } from './import';
import { createGoogleVerifier } from '../../packages/tll-social/src/server/google';

export const V1_PREFIX = '/api/v1';
export interface V1Env extends AuthEnv {
  APP_ORIGIN: string;
  V1_ENABLED?: string;
  SOCIAL_DEV_ORIGINS?: string;
}
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
const allowedOrigin = (origin: string, env: V1Env) => origin === env.APP_ORIGIN || (env.SOCIAL_DEV_ORIGINS === 'true' && LOCAL.test(origin));

let googleVerifier: ReturnType<typeof createGoogleVerifier> | null = null;
export const defaultDeps: AuthDeps = {
  now: () => Date.now(),
  verifyIdToken: (_provider, token, clientIds) => (googleVerifier ??= createGoogleVerifier()).verify(token, clientIds),
};

export function v1Flags(env: V1Env): Record<string, boolean> {
  return { v1: env.V1_ENABLED === 'true', serverAuthority: (Number(env.V1_SERVER_AUTHORITY_PERCENT) || 0) > 0 };
}

export async function handleV1Request(request: Request, env: V1Env, deps: AuthDeps = defaultDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(V1_PREFIX.length) || '/';
  try {
    if (env.V1_ENABLED !== 'true') return json({ error: 'unavailable' }, 503);
    if (path.length > 120 || url.search.length > 256) return json({ error: 'too-long' }, 414);
    const origin = request.headers.get('origin');
    // 모든 v1 요청은 상태를 다루므로 허용 origin이 반드시 있어야 한다(네이티브 앱은 index.ts가 정식 origin으로 바꾼다).
    if (!allowedOrigin(url.origin, env) || origin === null || !allowedOrigin(origin, env)
      || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin' }, 403);
    const db = env.COMMERCE_DB as D1Database | undefined;
    if (!db || !await schemaReady(db)) return json({ error: 'unavailable' }, 503);
    const c: Ctx = { env, db, deps, now: deps.now(), request };
    const method = request.method;
    if (method === 'POST' && path === '/auth/session') return json(await createSession(c, await readJson(request)));
    if (method === 'POST' && path === '/auth/recover') return json(await recover(c, await readJson(request)));
    if (method === 'GET' && path === '/me') return json(await getMe(c, await requireSession(c), v1Flags(env)));
    if (method === 'POST') {
      const auth = await requireSession(c);
      if (path === '/auth/link') return json(await link(c, auth, await readJson(request)));
      if (path === '/auth/unlink') return json(await unlink(c, auth, await readJson(request)));
      if (path === '/auth/logout-all') return json(await logoutAll(c, auth));
      if (path === '/cmd') return json(await runCommand(c, auth, await readJson(request)));
      if (path === '/import') return json(await importLegacy(c, auth, await readJson(request, IMPORT_LIMIT)));
      if (path === '/runs/start') return json(await startRun(c, auth, await readJson(request)));
      const settle = path.match(/^\/runs\/([A-Za-z0-9_-]{8,64})\/settle$/);
      if (settle) return json(await settleRun(c, auth, settle[1], await readJson(request)));
    }
    return json({ error: 'not-found' }, 404);
  } catch (error) {
    if (error instanceof V1Error) return json({ error: error.code, ...error.extra }, error.status);
    // 내부 오류 원문(SQL·식별자)은 응답에 싣지 않는다.
    console.warn('v1 error', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'internal' }, 500);
  }
}
