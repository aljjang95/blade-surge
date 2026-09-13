import { PARTY_CODE, PARTY_LIMITS } from '../src/party/protocol.js';
import { PartyError, PartyState, type Effect } from './party-state';

interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAll(): Promise<void>;
  transaction<T>(fn: (storage: Storage) => Promise<T>): Promise<T>;
}
interface Socket extends WebSocket { accept(): void }
declare const WebSocketPair: { new(): { 0: Socket; 1: Socket } };
export interface PartyEnv {
  APP_ORIGIN: string;
  PARTIES: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
}
const json = (data: unknown, status = 200) => Response.json(data, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** No public room directory; 80 random code bits plus a per-IP Durable Object gate.
 * All internal paths below are reachable only by the Worker binding, never routing URLs. */
export async function handlePartyRequest(request: Request, env: PartyEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== env.APP_ORIGIN || request.headers.get('origin') !== env.APP_ORIGIN
    || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin' }, 403);
  const create = url.pathname === '/api/party' && request.method === 'POST';
  const code = url.pathname.match(/^\/api\/party\/([A-F0-9]{20})$/)?.[1];
  if (!create && (!code || request.method !== 'GET')) return json({ error: 'not-found' }, 404);
  if (!create && request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket-required' }, 426);
  if (url.search.length > 1024) return json({ error: 'query-size' }, 400);
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const key = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const limiter = env.PARTIES.get(env.PARTIES.idFromName(`gate:${key}`));
  const allowed = await limiter.fetch(new Request(`https://party.internal/gate?kind=${create ? 'create' : 'join'}`, { method: 'POST' }));
  if (!allowed.ok) return json({ error: 'rate' }, 429);
  if (create) {
    const code = [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const hostTicket = crypto.randomUUID();
    const expiresAt = Date.now() + PARTY_LIMITS.ttlMs;
    const room = env.PARTIES.get(env.PARTIES.idFromName(`room:${code}`));
    const result = await room.fetch(new Request('https://party.internal/init', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, hostTicket, expiresAt }) }));
    return result.ok ? json({ code, hostTicket, expiresAt }, 201) : json({ error: 'create-failed' }, 503);
  }
  const room = env.PARTIES.get(env.PARTIES.idFromName(`room:${code}`));
  const joinUrl = new URL('https://party.internal/join');
  for (const key of ['name', 'hero', 'ticket']) {
    const value = url.searchParams.get(key);
    if (value !== null) joinUrl.searchParams.set(key, value);
  }
  return room.fetch(new Request(joinUrl, { method: 'GET', headers: { Upgrade: 'websocket' } }));
}

/** Standard accepted WebSockets keep live room state in memory. Deployment/runtime
 * replacement fails closed: persisted metadata never reopens an interrupted run. */
export class PartyRoom {
  private room?: PartyState;
  private sockets = new Map<string, Socket>();
  constructor(private readonly ctx: { storage: Storage }) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), now = Date.now();
    if (url.pathname === '/gate' && request.method === 'POST') {
      const kind = url.searchParams.get('kind') === 'create' ? 'create' : 'join';
      const allowed = await this.ctx.storage.transaction(async storage => {
        const minute = Math.floor(now / 60000);
        const state = await storage.get<{ minute: number; create: number; join: number }>('gate');
        const next = state?.minute === minute ? state : { minute, create: 0, join: 0 };
        if (++next[kind] > (kind === 'create' ? 5 : 30)) return false;
        await storage.put('gate', next);
        return true;
      });
      await this.ctx.storage.setAlarm(now + 120000);
      return json({ allowed }, allowed ? 200 : 429);
    }
    if (url.pathname === '/init' && request.method === 'POST') {
      const data = await request.json() as { code: string; hostTicket: string; expiresAt: number };
      if (!PARTY_CODE.test(data.code) || !/^[a-f0-9-]{36}$/.test(data.hostTicket)
        || !Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + PARTY_LIMITS.ttlMs) return json({ error: 'init' }, 400);
      const fresh = await this.ctx.storage.transaction(async storage => {
        if (await storage.get('created')) return false;
        await storage.put('created', { code: data.code, expiresAt: data.expiresAt });
        return true;
      });
      if (!fresh) return json({ error: 'exists' }, 409);
      this.room = new PartyState(data.code, data.hostTicket, data.expiresAt);
      await this.ctx.storage.setAlarm(data.expiresAt);
      return json({ ok: true });
    }
    if (url.pathname !== '/join' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'not-found' }, 404);
    if (!this.room) return json({ error: 'room-unavailable' }, 410);
    if (now >= this.room.expiresAt) { this.end('expired'); return json({ error: 'expired' }, 410); }
    try {
      const result = this.room.join(url.searchParams.get('name') ?? '', url.searchParams.get('hero') ?? '', url.searchParams.get('ticket'), now);
      const pair = new WebSocketPair(), server = pair[1];
      server.accept(); this.sockets.set(result.id, server);
      server.addEventListener('message', event => {
        try {
          if (Date.now() >= this.room!.expiresAt) { this.end('expired'); return; }
          if (typeof event.data !== 'string') throw new PartyError('binary', 400);
          this.dispatch(this.room!.receive(result.id, event.data, Date.now()));
        } catch (error) {
          const code = error instanceof PartyError ? error.code : 'invalid';
          try { server.send(JSON.stringify({ type: 'error', error: code })); } catch { /* closed */ }
          // A malformed stream is disconnected; if it is host/running the run aborts.
          if (['size', 'rate', 'binary', 'expired'].includes(code)) this.drop(result.id, code);
        }
      });
      server.addEventListener('close', () => this.drop(result.id, 'disconnected'));
      server.addEventListener('error', () => this.drop(result.id, 'connection-error'));
      this.dispatch(result.effects);
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    } catch (error) {
      return json({ error: error instanceof PartyError ? error.code : 'unavailable' }, error instanceof PartyError ? error.status : 503);
    }
  }
  private dispatch(effects: Effect[]) {
    const failed: string[] = [];
    for (const effect of effects) {
      const text = JSON.stringify(effect.message);
      for (const [id, socket] of this.sockets) {
        if ((effect.to && effect.to !== id) || effect.except === id) continue;
        try { socket.send(text); } catch { failed.push(id); }
      }
    }
    for (const id of new Set(failed)) this.drop(id, 'send-failed');
    if (this.room?.status === 'closed' || this.room?.status === 'finished') this.closeAll();
  }
  private drop(id: string, reason: string) {
    const socket = this.sockets.get(id);
    if (!socket) return;
    this.sockets.delete(id);
    try { socket.close(1000, reason); } catch { /* already closed */ }
    if (this.room) this.dispatch(this.room.disconnect(id));
  }
  private closeAll() {
    const sockets = [...this.sockets.values()]; this.sockets.clear();
    for (const socket of sockets) { try { socket.close(1000, 'party-ended'); } catch { /* already closed */ } }
  }
  private end(reason: string) { if (this.room) this.dispatch(this.room.abort(reason)); this.closeAll(); }
  async alarm() {
    this.end('expired');
    await this.ctx.storage.deleteAll();
  }
}
