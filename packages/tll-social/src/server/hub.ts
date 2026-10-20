import type { GameConfig, Session } from '../shared/protocol';
import { SocialError } from '../shared/validation';
import { neutralizeMentions } from '../shared/filter';
import { SocialCore, type Effect, type Target, type Webhook } from './core';
import { createGoogleVerifier, type VerifierOptions } from './google';
import type { Sql } from './schema';

export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
export interface HubState {
  storage: { sql: Sql; transactionSync?<T>(fn: () => T): T };
  acceptWebSocket(ws: HubSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HubSocket[];
  waitUntil?(promise: Promise<unknown>): void;
}
export interface SocialHubEnv {
  SOCIAL_ADMIN_IDS?: string;
  GOOGLE_CLIENT_IDS?: string;
  DISCORD_WEBHOOK_BOARD?: string;
  DISCORD_WEBHOOK_FAME?: string;
}
export interface HubOptions {
  now?: () => number;
  randomHex?: (bytes: number) => string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  google?: VerifierOptions;
  /** 런타임 WebSocketPair 대체(테스트용). */
  createPair?: () => [HubSocket, HubSocket];
  /** 101 응답 생성 대체(테스트 런타임은 101 Response를 만들 수 없다). */
  upgradeResponse?: (client: HubSocket) => Response;
}

const MAX_SOCKETS = 3;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const list = (value: string | undefined) => (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
export const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const WEBHOOK = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

/** 게임 설정을 고정한 SocialHub Durable Object 클래스를 만든다. Worker에서 'export const SocialHub = createSocialHub(config)'. */
export function createSocialHub(config: GameConfig, options: HubOptions = {}) {
  const verifier = createGoogleVerifier({ now: options.now, ...options.google });
  const now = options.now ?? (() => Date.now());
  const hex = options.randomHex ?? randomHex;
  return class SocialHub {
    readonly core: SocialCore;
    constructor(readonly ctx: HubState, readonly env: SocialHubEnv) {
      const storage = ctx.storage;
      this.core = new SocialCore({
        sql: storage.sql, config, now, randomHex: hex, sha256Hex,
        transaction: storage.transactionSync ? fn => storage.transactionSync!(fn) : undefined,
        live: () => this.sockets().map(item => item.session),
        verifyIdToken: (_provider, token, clientIds) => verifier.verify(token, clientIds),
      });
    }

    private sockets(): { ws: HubSocket; session: Session }[] {
      const out: { ws: HubSocket; session: Session }[] = [];
      for (const ws of this.ctx.getWebSockets()) {
        const session = ws.deserializeAttachment() as Session | null;
        if (session && !session.closed) out.push({ ws, session });
      }
      return out;
    }

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/ws') return this.upgrade(url.searchParams.get('ticket'));
      let body: unknown;
      const raw = request.method === 'GET' ? '' : await request.text();
      if (raw) { try { body = JSON.parse(raw); } catch { return json({ error: 'json' }, 400); } }
      const result = await this.core.handle({
        method: request.method, path: url.pathname, query: url.searchParams, body,
        key: request.headers.get('x-social-key'), ipHash: request.headers.get('x-social-ip') || 'unknown',
        adminIds: list(this.env.SOCIAL_ADMIN_IDS), clientIds: list(this.env.GOOGLE_CLIENT_IDS),
      });
      this.deliver(result.effects);
      this.hooks(result.webhooks);
      return json(result.body, result.status);
    }

    private upgrade(ticket: string | null): Response {
      let playerId: string;
      try { playerId = this.core.consumeTicket(ticket); }
      catch (error) {
        if (error instanceof SocialError) return json({ error: error.code }, error.status);
        throw error;
      }
      const [client, server] = options.createPair ? options.createPair() : (() => {
        const pair = new (globalThis as any).WebSocketPair();
        return [pair[0], pair[1]] as [HubSocket, HubSocket];
      })();
      const session = this.core.openSession(playerId, hex(8));
      this.ctx.acceptWebSocket(server, [playerId]);
      server.serializeAttachment(session);
      // 한 플레이어 소켓은 최대 3개. 넘으면 가장 오래된 것부터 닫는다.
      const mine = this.ctx.getWebSockets(playerId)
        .map(ws => ({ ws, s: ws.deserializeAttachment() as Session | null }))
        .filter((item): item is { ws: HubSocket; s: Session } => !!item.s && !item.s.closed)
        .sort((a, b) => a.s.connectedAt - b.s.connectedAt);
      for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SOCKETS))) this.shut(old.ws, old.s, 4000, 'replaced');
      return options.upgradeResponse ? options.upgradeResponse(client)
        : new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: unknown });
    }

    private shut(ws: HubSocket, session: Session, code: number, reason: string): void {
      session.closed = true;
      try { ws.serializeAttachment(session); } catch { /* 이미 닫힘 */ }
      try { ws.close(code, reason); } catch { /* 이미 닫힘 */ }
      this.deliver(this.core.close(session));
    }

    async webSocketMessage(ws: HubSocket, message: string | ArrayBuffer): Promise<void> {
      const session = ws.deserializeAttachment() as Session | null;
      if (!session || session.closed) { try { ws.close(4001, 'session'); } catch { /* 무시 */ } return; }
      const effects = this.core.message(session, typeof message === 'string' ? message : '\u0000binary');
      ws.serializeAttachment(session);
      this.deliver(effects);
    }
    async webSocketClose(ws: HubSocket, code: number, reason: string): Promise<void> {
      const session = ws.deserializeAttachment() as Session | null;
      if (session && !session.closed) {
        session.closed = true;
        try { ws.serializeAttachment(session); } catch { /* 무시 */ }
        this.deliver(this.core.close(session));
      }
      try { ws.close(code >= 3000 && code < 5000 ? code : 1000, reason); } catch { /* 이미 닫힘 */ }
    }
    async webSocketError(ws: HubSocket): Promise<void> { await this.webSocketClose(ws, 1011, 'error'); }

    private match(to: Target, s: Session): boolean {
      if ('sid' in to) return s.sid === to.sid;
      if (!s.hello) return false;
      if ('player' in to) return s.playerId === to.player;
      if ('channel' in to) return s.world === to.channel || s.party === to.channel;
      if ('worlds' in to) return !!s.world;
      return true;
    }
    private deliver(effects: Effect[]): void {
      if (!effects.length) return;
      const sockets = this.sockets();
      for (const effect of effects) {
        const exclude = new Set(effect.exclude ?? []);
        const data = effect.message ? JSON.stringify(effect.message) : null;
        for (const item of sockets) {
          if (item.session.closed || exclude.has(item.session.playerId)) continue;
          // 강제 종료(밴)는 hello 전 소켓도 닫는다.
          const hit = this.match(effect.to, item.session) || (!!effect.close && 'player' in effect.to && item.session.playerId === effect.to.player);
          if (!hit) continue;
          if (data) { try { item.ws.send(data); } catch { /* 닫히는 중 */ } }
          if (effect.close) {
            item.session.closed = true;
            try { item.ws.serializeAttachment(item.session); } catch { /* 무시 */ }
            try { item.ws.close(effect.close.code, effect.close.reason); } catch { /* 무시 */ }
          }
        }
      }
    }

    private hooks(webhooks: Webhook[]): void {
      for (const hook of webhooks) {
        const target = hook.kind === 'board' ? this.env.DISCORD_WEBHOOK_BOARD : this.env.DISCORD_WEBHOOK_FAME;
        if (!target || !WEBHOOK.test(target)) continue;
        const body = JSON.stringify({
          allowed_mentions: { parse: [] },
          embeds: [{ title: neutralizeMentions(hook.title).slice(0, 250), description: neutralizeMentions(hook.description).slice(0, 2000), color: hook.kind === 'fame' ? 0xf5c451 : 0x6aa8ff }],
        });
        const send = (options.fetch ?? fetch)(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
          .then(() => undefined, () => undefined);
        if (this.ctx.waitUntil) this.ctx.waitUntil(send); else void send;
      }
    }
  };
}
export type SocialHubClass = ReturnType<typeof createSocialHub>;

