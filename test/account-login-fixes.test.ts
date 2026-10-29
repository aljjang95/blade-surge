// PR #392 Codex 리뷰 반영(P1×3, P2×1): 계정 연결 순서·전환·재시도.
import { describe, expect, test } from 'bun:test';
import { v1Harness, ORIGIN } from './helpers/v1-harness';
import { handleV1Request } from '../worker/v1/router';
import { CommandQueue } from '../src/net/command-queue.js';
import { Economy } from '../src/game/economy.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { setupAccount } from '../src/net/account.js';

async function serverFetch(env = {}) {
  const h = await v1Harness({ env });
  const fetchImpl = async (url: string, init: RequestInit) => {
    const u = new URL(url, ORIGIN); const headers = new Headers(init.headers); headers.set('origin', ORIGIN);
    return handleV1Request(new Request(ORIGIN + u.pathname + u.search, { ...init, headers }), h.env, h.deps);
  };
  return { h, fetchImpl };
}
const until = async (fn: () => boolean, n = 300) => { for (let i = 0; i < n && !fn(); i++) await new Promise(r => setTimeout(r, 10)); };

describe('시작 영웅 선택 전에 만든 계정(첫 화면 연동)', () => {
  test('세션은 바로 생기고, 가져오기는 영웅 선택(첫 저장) 뒤에 → 고른 영웅이 서버에 남고 그림자 스냅샷이 거부되지 않는다', async () => {
    const { h, fetchImpl } = await serverFetch();
    const eco = new Economy({ storage: createMemoryStorage(), now: () => h.now() } as any);
    expect(eco.hasStoredSave).toBe(false);
    const app: any = { eco, battle: null };
    const state: any = await setupAccount(app, { fetchImpl: fetchImpl as any });
    expect(state.status).toBe('deferred');
    // 첫 화면에서 연동을 시작: 세션만 있으면 된다(영웅 선택 전이라 가져오기는 기다린다).
    expect(await state.ensure()).toBe(true);
    await until(() => state.status === 'awaiting-save');
    expect(state.status).toBe('awaiting-save');
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM legacy_saves').get()).toEqual({ n: 0 });
    // 영웅 선택 → 첫 저장 → 가져오기 → 연결 완료
    expect(eco.chooseStarter('ranger').ok).toBe(true);
    await until(() => state.status === 'ready', 600);
    expect(state.status).toBe('ready');
    const me = await state.client.me();
    expect(me.legacy?.status).toBe('shadow');
    expect(me.doc.selected).toBe('ranger');
    expect(me.doc.roster.starter).toBe('ranger');
    // 이후 진행(명령 밖 변화) → 그림자 스냅샷이 import-required 없이 반영된다.
    const results: any[] = [];
    state.queue.hooks.onResult = (_e: any, r: any) => results.push(r);
    eco.s.gold += 600; eco.save?.();
    state.queue.snapshot();
    await until(() => !state.queue.pending.length && !state.queue.busy);
    expect(results.at(-1)?.error).toBeUndefined();
    expect((await state.client.me()).doc.gold).toBe(eco.s.gold);
  });
});

describe('세션 실패 뒤 재시도', () => {
  test('첫 /auth/session이 일시 실패(네트워크·503)해도 다음 ensure()가 다시 요청한다', async () => {
    const { fetchImpl } = await serverFetch();
    let fail = 2, sessionCalls = 0;
    const flaky = async (url: string, init: RequestInit) => {
      if (url.includes('/auth/session')) { sessionCalls++; if (fail-- > 0) { if (fail === 1) throw new TypeError('network'); return new Response('{"error":"unavailable"}', { status: 503 }); } }
      return fetchImpl(url, init);
    };
    const eco = new Economy({ storage: createMemoryStorage() } as any);
    const state: any = await setupAccount({ eco, battle: null } as any, { fetchImpl: flaky as any });
    expect(await state.ensure()).toBe(false);
    await until(() => !state.connecting);
    expect(await state.ensure()).toBe(false);
    await until(() => !state.connecting);
    expect(await state.ensure()).toBe(true);
    expect(sessionCalls).toBe(3);
  });
});

describe('계정 전환 전 대기 명령 격리', () => {
  test('reset() 뒤에는 이전 계정의 대기 스냅샷을 보내지 않고, 전송 중이던 결과도 반영하지 않는다', async () => {
    const sent: string[] = [];
    let online = false, release: () => void = () => {};
    const client: any = {
      shadowSnapshot: async (cid: string) => { if (!online) throw new TypeError('network'); sent.push('snap:' + cid); return { match: true }; },
      cmd: async (c: any) => { sent.push('cmd:' + c.op); await new Promise<void>(r => { release = r; }); return { match: true }; },
    };
    const eco = new Economy({ storage: createMemoryStorage() } as any);
    eco.chooseStarter('knight');
    const q = new CommandQueue(eco, client, { authority: () => 'shadow', adopt: () => {} });
    q.snapshot();
    await until(() => !q.busy);
    expect(q.pending.length).toBe(1); // 네트워크 실패로 남은 이전 게스트 스냅샷
    q.reset();
    online = true;
    await q.flush();
    expect(sent).toEqual([]);
    // 전송 중 전환: 응답이 와도 다음 항목을 새 계정으로 보내지 않는다.
    q.pending.push({ cid: 'c1', op: 'selectHero', args: ['knight'], clientHash: 'x' }, { cid: 'c2', op: 'selectHero', args: ['knight'], clientHash: 'x' });
    const flushing = q.flush();
    await until(() => sent.length === 1);
    q.reset();
    release();
    await flushing;
    expect(sent).toEqual(['cmd:selectHero']);
    expect(q.pending.length).toBe(0);
  });

  test('전환 뒤 새 계정 명령은 이전 응답이 끝나면 이어서 보낸다(flush(old) → reset → push(new) → resolve(old))', async () => {
    const sent: string[] = [];
    let release: () => void = () => {};
    const client: any = { cmd: async (c: any) => { sent.push(c.cid); if (c.cid === 'old') await new Promise<void>(r => { release = r; }); return { match: true }; } };
    const eco = new Economy({ storage: createMemoryStorage() } as any);
    eco.chooseStarter('knight');
    const q = new CommandQueue(eco, client, { authority: () => 'shadow', adopt: () => {} });
    q.pending.push({ cid: 'old', op: 'selectHero', args: ['knight'], clientHash: 'x' });
    const flushing = q.flush();
    await until(() => sent.length === 1);
    q.reset();
    q.pending.push({ cid: 'new', op: 'selectHero', args: ['knight'], clientHash: 'x' });
    void q.flush(); // busy라 바로 돌아온다
    release();
    await flushing;
    await until(() => !q.pending.length && !q.busy);
    expect(sent).toEqual(['old', 'new']);
    expect(q.pending.length).toBe(0);
  });
});
