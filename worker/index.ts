import { DIALOGUE_MODEL, REPLY_SCHEMA, dialogueMessages, parseDialogueReply, parseDialogueRequest } from '../src/companion/dialogue-contract';
import { handlePartyRequest, PartyRoom } from './party';
import { asSameOrigin, nativeOrigin, preflight, withCors } from './native-cors';
import { handleStoreRequest, cleanupStoreMetadata, type StoreEnv } from './store';
import { createSocialHub, handleSocialRequest } from '../packages/tll-social/src/server/index';
import { SOCIAL_CONFIG } from '../src/social/config.js';
import { handleV1Request, V1_PREFIX, defaultDeps, type V1Env } from './v1/router';
import { reconcileVoided } from './v1/iap';
import { reconcileWebPayments } from './v1/portone';
import { schemaReady, type D1Database } from './v1/db';
export { PartyRoom };
// 커뮤니티(채팅·친구·명예의 전당·게시판) Durable Object. 게임 설정을 고정한 클래스다.
export const SocialHub = createSocialHub(SOCIAL_CONFIG);

interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  transaction<T>(callback: (txn: Store) => Promise<T>): Promise<T>;
}
interface Env extends StoreEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AI: { run(model: string, input: unknown): Promise<unknown> };
  DIALOGUE_BUDGET: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  APP_ORIGIN: string;
  PARTIES?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  SOCIAL?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  SOCIAL_DEV_ORIGINS?: string;
  DIALOGUE_ENABLED: string;
  DIALOGUE_APPROVAL_UNTIL?: string;
  DIALOGUE_APPROVAL_ID?: string;
  DIALOGUE_APPROVAL_ISSUED_AT?: string;
}
const LIMITS = { bytes: 8192, activation: 100, daily: 60, hourly: 12, perIp: 10, gapMs: 15000, timeoutMs: 20000 };
export function validApprovalWindow(issuedAt: number, until: number, now = Date.now()): boolean {
  return Number.isFinite(issuedAt) && Number.isFinite(until) && issuedAt <= now && now < until
    && until > issuedAt && until - issuedAt <= 48 * 3600000;
}
function json(value: unknown, status = 200, retry?: number): Response {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(retry ? { 'Retry-After': String(retry) } : {}),
  } });
}
export async function boundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > LIMITS.bytes)) throw new Error('body-limit');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body-empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body-timeout')), 5000); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.bytes) throw new Error('body-limit');
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { if (timer) clearTimeout(timer); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

interface BudgetState {
  day: string;
  total: number;
  hour: number;
  hourly: number;
  clients: Record<string, { total: number; last: number; ids: string[] }>;
}
// 고정 이름의 Durable Object 한 개가 지역·인스턴스 전체의 호출 예산을 직렬화한다.
// 승인된 호출만 기록하며 실패·취소도 총량에 포함한다.
export class DialogueBudget {
  constructor(private readonly ctx: { storage: Store }) {}
  async fetch(request: Request): Promise<Response> {
    const { key, id, approvalId, issuedAt, until } = await request.json() as { key: string; id: string; approvalId: string; issuedAt: number; until: number };
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-zA-Z0-9-]{16,64}$/.test(id) || !/^[a-zA-Z0-9-]{8,64}$/.test(approvalId)) return json({ error: 'invalid' }, 400);
    if (!validApprovalWindow(issuedAt, until)) return json({ error: 'unavailable' }, 503);
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), hour = Math.floor(now / 3600000);
    return this.ctx.storage.transaction(async (storage) => {
      const activationKey = `activation:${approvalId}`;
      let activation = await storage.get<{ id: string; total: number; ids: string[]; issuedAt: number; until: number }>(activationKey);
      if (!activation) activation = { id: approvalId, total: 0, ids: [], issuedAt, until };
      if (activation.id !== approvalId || activation.issuedAt !== issuedAt || activation.until !== until || !Array.isArray(activation.ids)) return json({ error: 'unavailable' }, 503);
      if (activation.ids.includes(id)) return json({ error: 'duplicate' }, 409);
      if (activation.total >= LIMITS.activation) return json({ error: 'limit' }, 429, 3600);
      let state = await storage.get<BudgetState>('budget');
      if (!state || state.day !== day) state = { day, total: 0, hour, hourly: 0, clients: {} };
      if (state.hour !== hour) { state.hour = hour; state.hourly = 0; }
      const client = state.clients[key] ?? { total: 0, last: 0, ids: [] };
      if (client.ids.includes(id)) return json({ error: 'duplicate' }, 409);
      if (state.total >= LIMITS.daily || state.hourly >= LIMITS.hourly || client.total >= LIMITS.perIp) return json({ error: 'limit' }, 429, 3600);
      if (now - client.last < LIMITS.gapMs) return json({ error: 'limit' }, 429, Math.ceil((LIMITS.gapMs - now + client.last) / 1000));
      client.total++; client.last = now; client.ids.push(id);
      state.total++; state.hourly++; state.clients[key] = client;
      activation.total++; activation.ids.push(id);
      await storage.put(activationKey, activation);
      await storage.put('budget', state);
      return json({ allowed: true });
    });
  }
}

/** 앱(Capacitor WebView) 출처의 파티·커뮤니티·동행 호출에만 허용 목록 CORS를 적용하고 나머지는 그대로 라우팅한다. */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const origin = nativeOrigin(request, pathname);
  if (!origin) return route(request, env);
  if (request.method === 'OPTIONS') return preflight(request, origin);
  return withCors(await route(asSameOrigin(request, env.APP_ORIGIN), env), origin);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith(V1_PREFIX + '/')) return handleV1Request(request, env as unknown as V1Env);
  if (url.pathname.startsWith('/api/store/')) return handleStoreRequest(request, env);
  if (url.pathname === '/api/party' || url.pathname.startsWith('/api/party/')) {
    if (!env.PARTIES) return json({ error:'unavailable' },503);
    const origin = url.origin === 'https://blade.tllhouse.com' ? url.origin : env.APP_ORIGIN;
    return handlePartyRequest(request, { ...env, PARTIES:env.PARTIES, APP_ORIGIN:origin });
  }
  if (url.pathname === '/api/social' || url.pathname.startsWith('/api/social/')) return handleSocialRequest(request, env, SOCIAL_CONFIG);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (url.pathname !== '/api/companion') return json({ error: 'not-found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (url.origin !== env.APP_ORIGIN || request.headers.get('origin') !== env.APP_ORIGIN
    || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'content-type' }, 415);
  const approvedUntil = Date.parse(env.DIALOGUE_APPROVAL_UNTIL ?? '');
  const issuedAt = Date.parse(env.DIALOGUE_APPROVAL_ISSUED_AT ?? '');
  if (env.DIALOGUE_ENABLED !== 'true' || !validApprovalWindow(issuedAt, approvedUntil)
    || !/^[a-zA-Z0-9-]{8,64}$/.test(env.DIALOGUE_APPROVAL_ID ?? '')) return json({ error: 'unavailable' }, 503);
  let input;
  try { input = parseDialogueRequest(await boundedJson(request)); } catch { return json({ error: 'invalid-input' }, 400); }
  if (!input) return json({ error: 'invalid-input' }, 400);
  // Cloudflare가 엣지에서 설정한 주소를 사용한다. 요청자가 만든 client ID는 신뢰하지 않는다.
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F.:]+$/.test(ip)) return json({ error: 'unavailable' }, 503);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${new Date().toISOString().slice(0, 10)}:${ip}`));
  const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const budget = env.DIALOGUE_BUDGET.get(env.DIALOGUE_BUDGET.idFromName('companion-budget-v1'));
    const admission = await budget.fetch(new Request('https://budget/reserve', { method: 'POST', body: JSON.stringify({ key, id: input.requestId, approvalId: env.DIALOGUE_APPROVAL_ID, issuedAt, until: approvedUntil }) }));
    if (!admission.ok) {
      if (admission.status !== 409 && admission.status !== 429) return json({ error: 'unavailable' }, 503);
      return json({ error: admission.status === 409 ? 'duplicate' : 'limit' }, admission.status, Number(admission.headers.get('retry-after')) || 60);
    }
    const generated = await Promise.race([
      env.AI.run(DIALOGUE_MODEL, { messages: dialogueMessages(input), max_tokens: 256, temperature: 0.6, response_format: { type: 'json_schema', json_schema: REPLY_SCHEMA } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), LIMITS.timeoutMs); }),
    ]);
    const response = generated && typeof generated === 'object' && 'response' in generated ? generated.response : null;
    const reply = parseDialogueReply(typeof response === 'string' ? JSON.parse(response) : response);
    if (!reply) return json({ error: 'invalid-response' }, 502);
    return json({ requestId: input.requestId, ...reply });
  } catch { return json({ error: 'unavailable' }, 503); }
  finally { if (timer) clearTimeout(timer); }
}

/** 시간당 환불 대사: Play voidedpurchases를 읽어 아는 구매만 역분개한다. RTDN을 놓쳐도 최종 안전망이다. */
export async function reconcileIap(env: Env, now = Date.now()): Promise<void> {
  const v1 = env as unknown as V1Env;
  const db = v1.COMMERCE_DB as D1Database | undefined;
  // 판매(IAP_ENABLED)를 멈춰도 환불 대사는 계속한다. 커서는 D1 iap_meta(마지막 성공 시각, 최대 30일 창).
  if (v1.V1_ENABLED !== 'true' || !db || !await schemaReady(db)) return;
  const r = await reconcileVoided({ env: v1, db, deps: defaultDeps, now, request: new Request('https://cron.internal/iap/reconcile') });
  if (r.failed) console.warn('iap reconcile partial', r.failed);
}

/** 시간당 웹 결제(포트원) 취소 회수·미완료 결제 지급 대사. WEB_BILLING_ENABLED를 꺼도 돈다(환불 반영). 호출 수는 WEB_RECONCILE_MAX로 제한. */
export async function reconcileWeb(env: Env, now = Date.now()): Promise<void> {
  const v1 = env as unknown as V1Env;
  const db = v1.COMMERCE_DB as D1Database | undefined;
  if (v1.V1_ENABLED !== 'true' || !db || !await schemaReady(db)) return;
  const r = await reconcileWebPayments({ env: v1, db, deps: defaultDeps, now, request: new Request('https://cron.internal/iap/web-reconcile') });
  if (r.failed) console.warn('web payment reconcile partial', r.failed);
}

export default { fetch: handleRequest, async scheduled(_event: unknown, env: Env) {
  // 소유한 commerce DB의 오래된 임시 기록만 정리하고 구매·환불 원장은 보존한다.
  await cleanupStoreMetadata(env);
  try { await reconcileIap(env); } catch (error) { console.warn('iap reconcile failed', error instanceof Error ? error.name : 'unknown'); }
  try { await reconcileWeb(env); } catch (error) { console.warn('web payment reconcile failed', error instanceof Error ? error.name : 'unknown'); }
} };
