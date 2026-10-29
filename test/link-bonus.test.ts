import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { EconomyCore } from '../src/game/economy-core.js';
import { createSeededRng } from '../src/shared/rng.js';
import { parityHash, PARITY_KEYS, SERVER_OWNED_KEYS } from '../src/shared/state-hash.js';
import { validateOp } from '../src/shared/v1-ops.js';
import { sanitizeLegacySave } from '../src/shared/legacy-sanitize.js';
import { LINK_BONUS_GEMS } from '../src/data/link-bonus.js';
import { googleLogin, googleLinkWith, consumeLoginReturn, claimLinkBonus } from '../src/net/account-login.js';

const newEco = (now = 1_800_000_000_000) => EconomyCore.fromState(null, { now: () => now, rng: createSeededRng(3) }) as any;

describe('로그인 연동 보상 — Economy', () => {
  test('300 무료 보석을 한 번만, 유료 보석은 그대로', () => {
    const eco = newEco();
    expect(LINK_BONUS_GEMS).toBe(300);
    expect(eco.s.linkBonus).toBe(0);
    const gems = eco.s.gems, paid = eco.s.paidGems;
    expect(eco.claimLinkBonus()).toEqual({ ok: true, gems: 300 });
    expect(eco.s.gems).toBe(gems + 300); expect(eco.s.paidGems).toBe(paid); expect(eco.s.linkBonus).toBe(1);
    expect(eco.claimLinkBonus()).toEqual({ ok: false, reason: 'claimed' });
    expect(eco.s.gems).toBe(gems + 300);
  });
  test('저장 정규화는 0|1 만 인정하고 패리티·서버 소유 키에 들어 있다', () => {
    expect(newEco().s.linkBonus).toBe(0);
    expect(EconomyCore.fromState({ ...newEco().snapshot(), linkBonus: 5 }, { now: () => 1 }).s.linkBonus).toBe(0);
    expect(EconomyCore.fromState({ ...newEco().snapshot(), linkBonus: 1 }, { now: () => 1 }).s.linkBonus).toBe(1);
    expect(PARITY_KEYS).toContain('linkBonus'); expect(SERVER_OWNED_KEYS).toContain('linkBonus');
    expect(validateOp('claimLinkBonus', [])).not.toBeNull(); expect(validateOp('claimLinkBonus', [1])).toBeNull();
  });
});

describe('로그인 연동 보상 — 서버 /cmd', () => {
  test('연동 전 403 not-linked, 연동 뒤 200과 해시 일치, 두 번째는 422 claimed, 해제 후 재연동도 재지급 없음', async () => {
    const h = await v1Harness();
    h.google.set('tok-a', 'sub-a');
    const a = await h.session();
    const client = EconomyCore.fromState((await h.send('GET', '/me', undefined, a.token)).body.doc, { now: () => h.now(), rng: () => .5 }) as any;
    const before = client.s.gems;
    const denied = await h.cmd(a.token, 'claimLinkBonus', []);
    expect(denied.status).toBe(403); expect(denied.body.error).toBe('not-linked');
    expect((await h.send('GET', '/me', undefined, a.token)).body.doc.linkBonus ?? 0).toBe(0);

    expect((await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-a' }, a.token)).status).toBe(200);
    expect(client.claimLinkBonus().ok).toBe(true);
    const ok = await h.cmd(a.token, 'claimLinkBonus', [], { clientHash: parityHash(client.s) });
    expect(ok.status).toBe(200); expect(ok.body.match).toBe(true); expect(ok.body.result).toEqual({ ok: true, gems: 300 });
    expect(ok.body.doc.gems).toBe(before + 300); expect(ok.body.doc.linkBonus).toBe(1);
    const again = await h.cmd(a.token, 'claimLinkBonus', []);
    expect(again.status).toBe(422); expect(again.body.reason).toBe('claimed');

    expect((await h.send('POST', '/auth/unlink', { provider: 'google', idToken: 'tok-a' }, a.token)).body.linked).toEqual([]);
    expect((await h.send('POST', '/auth/link', { provider: 'google', idToken: 'tok-a' }, a.token)).status).toBe(200);
    expect((await h.cmd(a.token, 'claimLinkBonus', [])).status).toBe(422);
    expect((await h.send('GET', '/me', undefined, a.token)).body.doc.gems).toBe(before + 300);
  });
});

describe('로그인 연동 보상 — 가져오기 정화', () => {
  test('클라이언트가 보낸 linkBonus=1 은 버리고 서버 값만 유지한다(스냅샷으로 1→0 되돌리기도 차단)', () => {
    const raw: any = JSON.parse(JSON.stringify(newEco().s)); raw.linkBonus = 1;
    const T = 1_800_000_000_000, createdAt = T - 400 * 86400000;
    const a = sanitizeLegacySave(raw, { now: T, createdAt }) as any;
    expect(a.ok).toBe(true); expect(a.state.linkBonus).toBe(0);
    const b = sanitizeLegacySave(raw, { now: T, createdAt, serverLinkBonus: 1 }) as any;
    expect(b.state.linkBonus).toBe(1);
    raw.linkBonus = 0;
    expect((sanitizeLegacySave(raw, { now: T, createdAt, serverLinkBonus: 1, snapshot: true }) as any).state.linkBonus).toBe(1);
  });
});

describe('로그인 연동 보상 — 클라이언트 호출 지점', () => {
  const fakeApp = (over: any = {}) => {
    const calls = { claim: 0, link: 0, recover: 0 };
    const queue = { lastCid: 'c1', settled: async () => ({ ok: true }) };
    const app: any = {
      eco: { claimLinkBonus: () => { calls.claim++; return { ok: true, gems: 300 }; } },
      account: { queue, ensure: async () => true, refreshFromServer: async () => {},
        client: { recover: async () => { calls.recover++; }, link: async () => { calls.link++; }, oauthFinish: async () => {} }, ...over },
    };
    return { app, calls };
  };
  test('연동 성공(구글 link·OAuth link)에서만 청구하고 서버가 받아들인 경우에만 보석을 돌려준다', async () => {
    const { app, calls } = fakeApp();
    const g = await googleLinkWith(app, 'tok');
    expect([g.ok, g.action, g.bonus, calls.claim]).toEqual([true, 'linked', 300, 1]);
    const toasts: string[] = [];
    const o = await consumeLoginReturn(app, { provider: 'kakao', result: 'ok', mode: 'link', ticket: 't'.repeat(43) }, { toast: (m: string) => toasts.push(m) });
    expect(o.action).toBe('linked'); expect(calls.claim).toBe(2);
    expect(toasts.some((m) => m.includes('로그인 연동 보상: 보석 300'))).toBe(true);
    const rej = fakeApp({ queue: { lastCid: 'c', settled: async () => ({ ok: false, status: 422 }) } });
    expect(await claimLinkBonus(rej.app)).toBe(0);
    expect(await claimLinkBonus({ eco: rej.app.eco, account: {} })).toBe(0);   // 큐 없음 → 청구 안 함
  });
  test('복구(구글 recover·OAuth recover·연동 충돌 후 recover)는 청구하지 않는다', async () => {
    const { app, calls } = fakeApp();
    const r1 = await googleLogin(app, { signIn: async () => 'tok' });
    expect([r1.action, calls.claim]).toEqual(['recovered', 0]);
    const r2 = await consumeLoginReturn(app, { provider: 'kakao', result: 'ok', mode: 'recover', ticket: 't'.repeat(43) }, { toast() {} });
    expect([r2.action, calls.claim]).toEqual(['recovered', 0]);
    const clash = fakeApp(); clash.app.account.client.link = async () => { throw Object.assign(new Error('x'), { status: 409 }); };
    const r3 = await googleLinkWith(clash.app, 'tok', { confirm: async () => true });
    expect([r3.action, clash.calls.claim]).toEqual(['recovered', 0]);
  });
});
