// 계승 PR #377 GPT 교차 리뷰 P2 6건의 재현 테스트(docs/GEAR_VAULT_INHERIT.md).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { sanitizeLegacySave } from '../src/shared/legacy-sanitize.js';
import { mergeServerOwned } from '../src/shared/state-hash.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { grandfather } from './helpers/legacy-roster';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const T = Date.UTC(2026, 9, 28, 3);
const DAY = 86400000;
const newEco = () => { const e: any = grandfather(new Economy({ now: () => T, storage: memory(), rng: () => .5 })); e.s.gold = 10_000_000; return e; };
const dexOf = (drop: Record<string, string[]>, extra: any = {}) => ({ v: 1, drop, kin: {}, claimed: {}, ...extra });

describe('P2-2·5 shadowSnapshot: 서버 문장·도감 보존', () => {
  test('스냅샷은 서버 문장 잔액을 남기고(가져온 값 무시), 외부 가져오기는 여전히 0', () => {
    const eco = newEco(); const raw: any = JSON.parse(JSON.stringify(eco.s)); raw.lineageSigil = 999;
    const snap = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true, serverLineageSigil: 7 } as any) as any;
    expect(snap.ok).toBe(true); expect(snap.state.lineageSigil).toBe(7);
    const none = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true } as any) as any;
    expect('lineageSigil' in none.state).toBe(false);
    const imp = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, serverLineageSigil: 7 } as any) as any;
    expect('lineageSigil' in imp.state).toBe(false);
  });

  test('스냅샷은 서버 kin·claimed 를 유지하고 소유만으로 드랍 도감을 소급하지 않는다(가져오기는 소급)', () => {
    const eco = newEco(); eco.addItem('N', 'weapon', undefined, 0, 'knight'); eco.addItem('E', 'armor', undefined, 0, 'knight');
    const raw: any = JSON.parse(JSON.stringify(eco.s)); delete raw.gearDex;   // 클라이언트 도감 기록 없음 = 소유만 있는 상태
    const server = dexOf({}, { kin: { mage: [Object.keys(ITEM_BY_ID)[0]] }, claimed: { knight: ['drop25'] } });
    const snap = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true, serverGearDex: server } as any) as any;
    expect(snap.state.gearDex.drop).toEqual({}); expect(snap.state.gearDex.kin).toEqual(server.kin); expect(snap.state.gearDex.claimed).toEqual(server.claimed);
    const imp = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, serverGearDex: server } as any) as any;
    expect((imp.state.gearDex.drop.knight || []).length).toBeGreaterThan(0);
  });

  test('스냅샷은 클라이언트가 기록한 드랍 항목 중 지금 그 영웅이 가진 장비만 더한다(실제 드랍은 도감에 오른다)', () => {
    const eco = newEco(); const it = eco.addItem('N', 'weapon', undefined, 0, 'knight');
    const raw: any = JSON.parse(JSON.stringify(eco.s));
    const other = Object.keys(ITEM_BY_ID).find((id) => id !== it.id)!;
    raw.gearDex = dexOf({ knight: [it.id, other], mage: [it.id] }, { kin: { mage: [other] }, claimed: { knight: ['drop100'] } });
    const snap = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true, serverGearDex: dexOf({}) } as any) as any;
    expect(snap.state.gearDex.drop).toEqual({ knight: [it.id] }); expect(snap.state.gearDex.kin).toEqual({}); expect(snap.state.gearDex.claimed).toEqual({});
  });
});

describe('P2-3 mergeServerOwned: 선택적 서버 소유 필드의 생략은 삭제', () => {
  test('서버 문서에 lineageSigil·gearDex 가 없으면 로컬 값을 지운다(다른 필드는 그대로)', () => {
    const local: any = { gold: 5, lineageSigil: 9, gearDex: dexOf({ knight: [Object.keys(ITEM_BY_ID)[0]] }), name: 'x' };
    const out: any = mergeServerOwned(local, { gold: 7 });
    expect(out.gold).toBe(7); expect(out.name).toBe('x');
    expect('lineageSigil' in out).toBe(false); expect('gearDex' in out).toBe(false);
    const keep: any = mergeServerOwned(local, { gold: 7, lineageSigil: 2, gearDex: dexOf({}) });
    expect(keep.lineageSigil).toBe(2); expect(keep.gearDex).toEqual(dexOf({}));
  });
  test('서버가 null 문서를 보내도(문서 없음) 일반 필드는 로컬 유지', () => {
    expect((mergeServerOwned({ gold: 1, lineageSigil: 3 }, null) as any).gold).toBe(1);
  });
});

describe('P2-6 소급 결과가 비어도 이관 완료 표지를 남긴다', () => {
  test('이전 저장(도감 없음)에서 소급이 비어도 gearDex 표지가 생기고, 그 뒤 장비를 얻어도 다시 소급하지 않는다', () => {
    const eco = newEco();
    const raw: any = JSON.parse(JSON.stringify(eco.s)); delete raw.gearDex; raw.inventory = [];
    for (const h of Object.values(raw.heroes) as any[]) for (const k of Object.keys(h.equip)) h.equip[k] = null;
    const once: any = normalizeSave(JSON.parse(JSON.stringify(raw)), eco.fresh());
    expect(once.gearDex).toEqual({ v: 1, drop: {}, kin: {}, claimed: {} });
    // 다음 로드 전에 금고 밖 장비가 생겨도(드랍 도감은 add 때 기록되지 않은 상태로 가정) 소급하지 않는다.
    once.inventory = [{ uid: 1, id: Object.keys(ITEM_BY_ID)[0], enh: 0, owner: 'knight' }]; once.invSeq = 2;
    const twice: any = normalizeSave(JSON.parse(JSON.stringify(once)), eco.fresh());
    expect(twice.gearDex.drop).toEqual({});
    expect(JSON.stringify(normalizeSave(JSON.parse(JSON.stringify(twice)), eco.fresh()))).toBe(JSON.stringify(twice));
  });
  test('스냅샷이 서버의 빈 도감을 돌려줘도 서버 로드(normalizeSave)가 다시 소급하지 않는다', () => {
    const eco = newEco(); eco.addItem('N', 'weapon', undefined, 0, 'knight');
    const raw: any = JSON.parse(JSON.stringify(eco.s)); delete raw.gearDex;
    const snap = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true } as any) as any;
    const loaded: any = normalizeSave(JSON.parse(JSON.stringify(snap.state)), eco.fresh());
    expect(loaded.gearDex.drop).toEqual({});
  });
});

describe('P2-1 의뢰 수령의 계승 문장은 서버 명령(claimJourneySigil)으로', () => {
  const dayMs = DAY;
  test('Economy.claimJourneySigil: 의뢰 표의 문장 수만큼, 기간(일·주)당 한 번, 모르는 의뢰·문장 없는 의뢰 거부', () => {
    let now = T; const eco: any = grandfather(new Economy({ now: () => now, storage: memory(), rng: () => .5 }));
    expect(eco.claimJourneySigil('daily', 'daily_relay')).toMatchObject({ ok: true, sigil: 1 }); expect(eco.s.lineageSigil).toBe(1);
    expect(eco.claimJourneySigil('daily', 'daily_relay')).toMatchObject({ ok: false, reason: 'claimed' }); expect(eco.s.lineageSigil).toBe(1);
    expect(eco.claimJourneySigil('weekly', 'weekly_relay')).toMatchObject({ ok: true, sigil: 3 }); expect(eco.s.lineageSigil).toBe(4);
    expect(eco.claimJourneySigil('daily', 'first_dungeon')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(eco.claimJourneySigil('daily', 'nope')).toMatchObject({ ok: false });
    expect(eco.claimJourneySigil('monthly', 'daily_relay')).toMatchObject({ ok: false });
    now += dayMs;   // 다음 일일 기간: 일일은 다시, 같은 주의 주간은 여전히 거부
    expect(eco.claimJourneySigil('daily', 'daily_relay').ok).toBe(true); expect(eco.s.lineageSigil).toBe(5);
    expect(eco.claimJourneySigil('weekly', 'weekly_relay')).toMatchObject({ ok: false, reason: 'claimed' });   // 같은 주
  });

  test('서버 허용 명령표에 있고 인자 형식을 검사하며, 같은 기간 두 번째는 거부된다', async () => {
    const { OPS, validateOp } = await import('../src/shared/v1-ops.js');
    expect(Object.keys(OPS)).toContain('claimJourneySigil');
    expect(validateOp('claimJourneySigil', ['daily', 'daily_relay'])).toBeTruthy();
    expect(validateOp('claimJourneySigil', ['daily'])).toBeNull(); expect(validateOp('claimJourneySigil', [1, 'x'])).toBeNull();
    const eco: any = grandfather(new Economy({ now: () => T, storage: memory(), rng: () => .5 }));
    const def = (OPS as any).claimJourneySigil;
    expect(def.ok(def.run(eco, 'daily', 'daily_relay'))).toBe(true); expect(def.ok(def.run(eco, 'daily', 'daily_relay'))).toBe(false);
  });

  test('서버 소유 필드·패리티: sigilClaims 는 서버 문서에서 생략되면 지워지고 정규화·정화를 지난다', async () => {
    const { PARITY_KEYS } = await import('../src/shared/state-hash.js');
    expect(PARITY_KEYS).toContain('sigilClaims');
    expect((mergeServerOwned({ sigilClaims: ['daily:daily_relay:5'] }, { gold: 1 }) as any).sigilClaims).toBeUndefined();
    const eco = newEco(); eco.claimJourneySigil('daily', 'daily_relay');
    const raw: any = JSON.parse(JSON.stringify(eco.s));
    expect(normalizeSave(JSON.parse(JSON.stringify(raw)), eco.fresh()).sigilClaims).toEqual(raw.sigilClaims);
    raw.sigilClaims = ['x', 5, 'daily:daily_relay:1', ...Array(40).fill('daily:daily_relay:2')];
    expect(normalizeSave(raw, eco.fresh()).sigilClaims.every((x: any) => typeof x === 'string')).toBe(true);
    const imp = sanitizeLegacySave(JSON.parse(JSON.stringify(eco.s)), { now: T, createdAt: T - 400 * DAY } as any) as any;
    expect(imp.state.sigilClaims).toBeUndefined();
    const snap = sanitizeLegacySave(JSON.parse(JSON.stringify(eco.s)), { now: T, createdAt: T - 400 * DAY, snapshot: true, serverSigilClaims: ['daily:daily_relay:9'] } as any) as any;
    expect(snap.state.sigilClaims).toEqual(['daily:daily_relay:9']);
  });

  test('JourneyService.claim: 문장은 로컬에서 직접 더하지 않고 eco.claimJourneySigil 한 번으로 지급(명령 큐가 감싼 메서드), 골드 등 나머지는 그대로', async () => {
    const { ExpeditionEconomy } = await import('../src/game/expedition-economy.js');
    const { JourneyService } = await import('../src/game/journey-service.js');
    const store = new Map<string, string>(), prevLs = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => store.delete(k) } });
    const eco: any = new Economy(); const app: any = { eco, battle: { active: false }, expeditionUI: { result: null } };
    app.expedition = new ExpeditionEconomy(eco); app.journey = new JourneyService(app);
    const calls: any[] = []; const orig = eco.claimJourneySigil.bind(eco);
    eco.claimJourneySigil = (...a: any[]) => { calls.push(a); return orig(...a); };
    app.journey.s.daily.actions = { ...(app.journey.s.daily.actions || {}), vaultRelay: 1 };
    const r = app.journey.claim('daily', 'daily_relay');
    expect(r.ok).toBe(true); expect(calls).toEqual([['daily', 'daily_relay']]); expect(eco.s.lineageSigil).toBe(1);
    expect(app.journey.claim('daily', 'daily_relay').ok).toBe(false); expect(eco.s.lineageSigil).toBe(1);
    // 서버가 거부하면(이미 수령) 로컬 수령 기록도 되돌려 의뢰가 수령 완료로 남지 않는다.
    store.clear(); const eco2: any = new Economy(); const app2: any = { eco: eco2, battle: { active: false }, expeditionUI: { result: null } };
    app2.expedition = new ExpeditionEconomy(eco2); app2.journey = new JourneyService(app2);
    app2.journey.s.daily.actions = { vaultRelay: 1 }; eco2.claimJourneySigil = () => ({ ok: false, reason: 'claimed' });
    const bad = app2.journey.claim('daily', 'daily_relay');
    expect(bad.ok).toBe(false); expect(app2.journey.s.daily.claimed).not.toContain('daily_relay'); expect(eco2.s.lineageSigil).toBeUndefined();
    if (prevLs) Object.defineProperty(globalThis, 'localStorage', prevLs); else Reflect.deleteProperty(globalThis, 'localStorage');
  });
});

describe('P2-4 연결 계정의 의식은 서버 결과를 기다려 연출한다', () => {
  const fakeClient = (cmd: (c: any) => Promise<any>) => ({ cmd, me: async () => ({ doc: { gold: 1 }, rev: 1 }), shadowSnapshot: async () => ({}) });
  const setup = async (cmd: (c: any) => Promise<any>) => {
    const { CommandQueue } = await import('../src/net/command-queue.js');
    const eco = newEco(); eco.s.lineageSigil = 5; eco.s.roster.owned = [...new Set([...eco.s.roster.owned, 'knight', 'mage'])];
    const it = eco.addItem('L', 'weapon', undefined, 0, 'knight'); expect(eco.vaultDeposit(it.uid).ok).toBe(true);
    const adopted: any[] = [];
    const q = new CommandQueue(eco, fakeClient(cmd) as any, { authority: () => 'server', adopt: (d: any) => adopted.push(d) });
    return { q, eco, it, adopted };
  };

  test('CommandQueue.settled: 서버 성공은 ok, 거부(422)는 ok:false, 응답이 없으면 timeout', async () => {
    const ok = await setup(async () => ({ match: true }));
    const before = ok.q.lastCid; expect(ok.eco.vaultRitual(ok.it.uid, 'mage').ok).toBe(true);
    expect(ok.q.lastCid).not.toBe(before);
    expect(await ok.q.settled(ok.q.lastCid)).toMatchObject({ ok: true });
    const no = await setup(async () => { throw Object.assign(new Error('rejected'), { status: 422, body: { error: 'rejected' } }); });
    no.eco.vaultRitual(no.it.uid, 'mage');
    expect(await no.q.settled(no.q.lastCid)).toMatchObject({ ok: false, status: 422 });
    const slow = await setup(() => new Promise(() => {}));
    slow.eco.vaultRitual(slow.it.uid, 'mage');
    expect(await slow.q.settled(slow.q.lastCid, 20)).toMatchObject({ ok: false, timeout: true });
  });

  test('performRitual: 로컬 전용은 즉시 결과, 서버 권위는 서버 성공 뒤 ok·거부면 실패 사유(연출 없음)', async () => {
    const { performRitual, RITUAL_FAIL_TEXT } = await import('../src/ui/vault-panel.js');
    // 로컬 전용(계정 없음): 기다리지 않는다.
    const local = newEco(); local.s.lineageSigil = 5; local.s.roster.owned = [...new Set([...local.s.roster.owned, 'knight', 'mage'])];
    const li = local.addItem('L', 'weapon', undefined, 0, 'knight'); local.vaultDeposit(li.uid);
    expect(await performRitual({ eco: local, app: {} } as any, li.uid, 'mage')).toMatchObject({ ok: true });
    // 서버 권위 + 서버 성공
    const good = await setup(async () => ({ match: true }));
    const g = await performRitual({ eco: good.eco, app: { account: { authority: 'server', queue: good.q } } } as any, good.it.uid, 'mage');
    expect(g.ok).toBe(true);
    // 서버 권위 + 서버 거부: 연출 대신 거부 사유
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const bad = await setup(async () => { await gate; throw Object.assign(new Error('rejected'), { status: 422, body: { error: 'rejected' } }); });
    let settled = false;
    const p = performRitual({ eco: bad.eco, app: { account: { authority: 'server', queue: bad.q } } } as any, bad.it.uid, 'mage').then((r: any) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 15)); expect(settled).toBe(false);   // 서버 응답 전에는 끝나지 않는다(연출 없음)
    release(); const b: any = await p;
    expect(b).toMatchObject({ ok: false, reason: 'server' }); expect(RITUAL_FAIL_TEXT.server).toMatch(/[가-힣]/);
  });
});
