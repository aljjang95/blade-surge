// /api/v1 테스트 하네스: bun:sqlite D1 + 조절 가능한 서버 시계 + 가짜 구글 검증기 + (선택) 실제 SocialHub.
import { Database } from 'bun:sqlite';
import { handleV1Request, type V1Env } from '../../worker/v1/router';
import { createSocialHub } from '../../packages/tll-social/src/server/hub';
import { SOCIAL_CONFIG } from '../../src/social/config.js';
import { migratedD1, type ShimD1 } from './d1-shim';

export const ORIGIN = 'https://blade.example';
export const newDeviceKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export const T0 = 1_800_000_000_000;

export function socialHub(now: () => number) {
  const sqlite = new Database(':memory:');
  const ctx = {
    storage: { sql: { exec: (q: string, ...b: any[]) => { const rows = sqlite.query(q).all(...b); return { toArray: () => rows }; } }, transactionSync: <T>(fn: () => T) => sqlite.transaction(fn)() as T },
    acceptWebSocket() {}, getWebSockets: () => [], waitUntil() {},
  };
  const Hub = createSocialHub(SOCIAL_CONFIG as any, { now, upgradeResponse: () => Response.json({}) });
  const hub = new Hub(ctx as any, {});
  const namespace = { idFromName: (n: string) => n, get: () => hub };
  const call = async (method: string, path: string, key?: string, body?: unknown) => {
    const headers: Record<string, string> = { 'x-social-ip': 'ip-test' };
    if (key) headers['x-social-key'] = key;
    const res = await hub.fetch(new Request('https://social.internal' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: await res.json() as any };
  };
  return { hub, namespace, call, sqlite };
}

export async function v1Harness(opts: { social?: boolean; env?: Partial<V1Env> } = {}) {
  let t = T0;
  const db: ShimD1 = await migratedD1(t);
  const social = opts.social ? socialHub(() => t) : null;
  const google = new Map<string, string>(); // idToken → sub
  const env: V1Env = { APP_ORIGIN: ORIGIN, V1_ENABLED: 'true', SESSION_HMAC: 'x'.repeat(48), COMMERCE_DB: db, GOOGLE_CLIENT_IDS: 'client-1',
    ...(social ? { SOCIAL: social.namespace as any } : {}), ...opts.env };
  const deps = {
    now: () => t,
    verifyIdToken: async (_p: string, token: string) => { const sub = google.get(token); if (!sub) throw Object.assign(new Error('bad'), { status: 401 }); return { sub }; },
  };
  const send = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { origin: ORIGIN, ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (token) h.authorization = 'Bearer ' + token;
    const res = await handleV1Request(new Request(ORIGIN + '/api/v1' + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env, deps);
    return { status: res.status, body: await res.json() as any };
  };
  const session = async (deviceKey = newDeviceKey()) => {
    const r = await send('POST', '/auth/session', { deviceKey });
    if (r.status !== 200) throw new Error('session ' + JSON.stringify(r.body));
    return { ...r.body, deviceKey } as { token: string; accountId: string; deviceKey: string; authority: string; created: boolean };
  };
  let cidSeq = 0;
  const cmd = (token: string, op: string, args: unknown[], extra: Record<string, unknown> = {}) =>
    send('POST', '/cmd', { cid: 'cid-' + (++cidSeq).toString().padStart(8, '0'), op, args, ...extra }, token);
  return { env, db, social, google, send, session, cmd, deps,
    advance: (ms: number) => { t += ms; }, now: () => t, setNow: (v: number) => { t = v; } };
}
