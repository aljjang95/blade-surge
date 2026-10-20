import { DEVICE_KEY, SOCIAL_LIMITS, SOCIAL_PREFIX, WS_TICKET, type GameConfig } from '../shared/protocol';
import { sha256Hex } from './hub';

interface Stub { fetch(request: Request): Promise<Response> }
export interface SocialEnv {
  APP_ORIGIN: string;
  SOCIAL?: { idFromName(name: string): unknown; get(id: unknown): Stub };
  SOCIAL_DEV_ORIGINS?: string;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export function allowedOrigin(origin: string, env: SocialEnv): boolean {
  return origin === env.APP_ORIGIN || (env.SOCIAL_DEV_ORIGINS === 'true' && LOCAL.test(origin));
}

/** 본문을 최대 limit 바이트까지만 읽는다(5초 시한). */
export async function readBounded(request: Request, limit = SOCIAL_LIMITS.bodyBytes): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error('body-limit');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body-timeout')), 5000); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('body-limit');
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { if (timer) clearTimeout(timer); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** /api/social/* 진입점: origin 검사, 본문 제한, 키 형식 확인 뒤 게임별 SocialHub로 넘긴다. */
export async function handleSocialRequest(request: Request, env: SocialEnv, config: GameConfig): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== SOCIAL_PREFIX && !url.pathname.startsWith(SOCIAL_PREFIX + '/')) return json({ error: 'not-found' }, 404);
  if (!env.SOCIAL) return json({ error: 'unavailable' }, 503);
  const path = url.pathname.slice(SOCIAL_PREFIX.length) || '/';
  if (path.length > 200 || url.search.length > 1024) return json({ error: 'too-long' }, 414);
  const upgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
  const origin = request.headers.get('origin');
  // 공개 GET은 origin 헤더가 없어도 되지만, 그 외 요청과 WebSocket은 허용 origin이 반드시 있어야 한다.
  const needsOrigin = request.method !== 'GET' || upgrade || path === '/ws';
  if (!allowedOrigin(url.origin, env) || request.headers.get('sec-fetch-site') === 'cross-site'
    || (origin === null ? needsOrigin : !allowedOrigin(origin, env))) return json({ error: 'origin' }, 403);
  const hub = env.SOCIAL.get(env.SOCIAL.idFromName('hub:' + config.gameId));

  if (path === '/ws') {
    if (request.method !== 'GET') return json({ error: 'method' }, 405);
    if (!upgrade) return json({ error: 'websocket-required' }, 426);
    const ticket = url.searchParams.get('ticket') ?? '';
    if (!WS_TICKET.test(ticket)) return json({ error: 'ticket' }, 401);
    return hub.fetch(new Request('https://social.internal/ws?ticket=' + ticket, { method: 'GET', headers: { Upgrade: 'websocket' } }));
  }
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return json({ error: 'method' }, 405);

  const headers = new Headers();
  const auth = request.headers.get('authorization');
  if (auth !== null) {
    const key = auth.match(/^Bearer ([A-Za-z0-9_-]{1,64})$/)?.[1];
    if (!key || !DEVICE_KEY.test(key)) return json({ error: 'bad-key' }, 401);
    headers.set('x-social-key', key);
  }
  headers.set('x-social-ip', await sha256Hex(request.headers.get('cf-connecting-ip') ?? 'local'));

  let body: string | undefined;
  if (request.method !== 'GET') {
    let raw: string;
    try { raw = await readBounded(request); }
    catch (error) { return json({ error: error instanceof Error && error.message === 'body-limit' ? 'body-limit' : 'body' }, error instanceof Error && error.message === 'body-limit' ? 413 : 400); }
    if (raw) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'content-type' }, 415);
      try { JSON.parse(raw); } catch { return json({ error: 'json' }, 400); }
      body = raw;
      headers.set('content-type', 'application/json');
    }
  }
  return hub.fetch(new Request('https://social.internal' + path + url.search, { method: request.method, headers, body }));
}

