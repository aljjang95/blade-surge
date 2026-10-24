// 유료 보석(paidGems) 회귀: 서버 지급·역분개·패리티·저장 실패 롤백·판매 내린 영웅 상품·초보자 SR 조건부 확률.
import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { V1Error } from '../worker/v1/db';
import type { PlayApi, ProductPurchase } from '../worker/v1/play';
import { reconcileVoided } from '../worker/v1/iap';
import { Economy, gachaRates, gachaContents } from '../src/game/economy.js';
import { createMemoryStorage, EconomyCore } from '../src/game/economy-core.js';
import { mergeServerOwned, parityHash, PARITY_KEYS } from '../src/shared/state-hash.js';
import { IAP_PRODUCTS } from '../src/shared/iap-catalog.js';
import { BANNER_EPOCH } from '../src/data/gacha-banners.js';

const DAY = 86400000;
const TOK = (n: string) => 'tok-' + n.padEnd(24, 'x');

function fakePlay() {
  const products = new Map<string, ProductPurchase>();
  const api: PlayApi = {
    async productPurchase(token) { const p = products.get(token); if (!p) throw new V1Error(422, 'purchase-not-found'); return { ...p }; },
    async subscriptionPurchase() { throw new V1Error(422, 'purchase-not-found'); },
    async acknowledgeProduct(_i, token) { const p = products.get(token); if (p) p.acknowledged = true; },
    async consumeProduct(_i, token) { const p = products.get(token); if (p) { p.consumed = true; p.acknowledged = true; } },
    async acknowledgeSubscription() {},
    async voided() { return state.voided; },
  };
  const state = { voided: [] as any[] };
  const product = (token: string, productId: string, obf: string | null) => products.set(token, {
    productId, quantity: 1, refundableQuantity: 1, purchaseState: 'PURCHASED', consumed: false, acknowledged: false, obfuscatedAccountId: obf, orderId: 'GPA.' + token.slice(-6), test: false });
  return { api, state, product };
}
async function setup() {
  const h = await v1Harness({ env: { IAP_ENABLED: 'true' } as any });
  const play = fakePlay();
  (h.deps as any).playApi = play.api;
  const a = await h.session();
  const intent = (productId: string) => h.send('POST', '/iap/intent', { productId }, a.token);
  const verify = (productId: string, purchaseToken: string) => h.send('POST', '/iap/verify', { productId, purchaseToken }, a.token);
  const me = async () => (await h.send('GET', '/me', undefined, a.token)).body;
  const dbPaid = () => (h.db.sqlite.query('SELECT gems_paid AS p FROM accounts WHERE account_id = ?').get(a.accountId) as { p: number }).p;
  const setDoc = (patch: Record<string, unknown>) => {
    const row = h.db.sqlite.query('SELECT doc FROM account_docs WHERE account_id = ?').get(a.accountId) as { doc: string };
    h.db.sqlite.query('UPDATE account_docs SET doc = ? WHERE account_id = ?').run(JSON.stringify({ ...JSON.parse(row.doc), ...patch }), a.accountId);
  };
  const ctx = () => ({ env: h.env, db: h.db, deps: h.deps, now: h.now(), request: new Request('https://x/') }) as any;
  return { h, play, a, intent, verify, me, dbPaid, setDoc, ctx };
}
async function buyStarter(s: Awaited<ReturnType<typeof setup>>, n: string) {
  const it = (await s.intent('starter_pack_v1')).body;
  s.play.product(TOK(n), 'starter_pack_v1', it.obfuscatedAccountId);
  return s.verify('starter_pack_v1', TOK(n));
}

describe('유료 보석 서버 회계', () => {
  test('(1) 서버 지급: doc.paidGems가 지급 보석만큼 늘고 DB gems_paid 투영도 같다', async () => {
    const s = await setup();
    const before = await s.me();
    expect(before.doc.paidGems || 0).toBe(0);
    expect((await buyStarter(s, 'p1')).body.state).toBe('granted');
    const after = await s.me();
    expect(after.doc.gems).toBe(before.doc.gems + 1000);
    expect(after.doc.paidGems).toBe(1000);
    expect(s.dbPaid()).toBe(1000);
  });

  test('(2) 역분개: 유료 몫이 먼저 줄고 총액 이하를 유지한다', async () => {
    const s = await setup();
    await buyStarter(s, 'p2');
    const gems = (await s.me()).doc.gems;
    s.setDoc({ gems: gems - 700 }); // 일부 소비(유료 몫은 문서에 1000으로 남은 상태)
    s.play.state.voided = [{ purchaseToken: TOK('p2'), orderId: 'GPA.p2xxxx', voidedTimeMillis: s.h.now(), kind: 'product' }];
    expect(await reconcileVoided(s.ctx(), s.h.now() - DAY)).toMatchObject({ seen: 1, reversed: 1, failed: 0 });
    const doc = (await s.me()).doc;
    expect(doc.gems).toBe(gems - 700 - 1000);
    expect(doc.paidGems).toBe(0);
    expect(doc.paidGems).toBeLessThanOrEqual(doc.gems);
    expect(s.dbPaid()).toBe(0);
  });

  test('(2b) 역분개 뒤 남은 보석이 유료 몫보다 적으면 총액으로 맞춘다', async () => {
    const s = await setup();
    await buyStarter(s, 'p2b');
    s.setDoc({ gems: 300, paidGems: 1000 });
    s.play.state.voided = [{ purchaseToken: TOK('p2b'), orderId: 'GPA.p2bxxx', voidedTimeMillis: s.h.now(), kind: 'product' }];
    await reconcileVoided(s.ctx(), s.h.now() - DAY);
    const doc = (await s.me()).doc;
    expect(doc.gems).toBe(0); expect(doc.paidGems).toBe(0);
  });

  test("(5) gate 'gacha-only' 영웅 상품: intent는 unknown-product, verify는 상품을 알아보고 검증 경로에 들어간다", async () => {
    const s = await setup();
    const hero = IAP_PRODUCTS.find((p: any) => p.gate === 'gacha-only') as any;
    expect(hero).toBeTruthy();
    expect((await s.intent(hero.id)).body.error).toBe('unknown-product');
    const r = await s.verify(hero.id, TOK('hero'));
    expect(r.body.error).not.toBe('unknown-product');
    expect(r.body.error).toBe('purchase-not-found'); // Play 조회까지 갔다 = 검증 경로 진입
  });
});

describe('유료 보석 클라이언트·패리티', () => {
  test('(3) mergeServerOwned가 paidGems를 복사하고 PARITY_KEYS에 포함된다', () => {
    expect(PARITY_KEYS).toContain('paidGems');
    const local = { gems: 500, paidGems: 0, name: 'x' }, server = { gems: 500, paidGems: 400 };
    expect(mergeServerOwned(local, server)).toMatchObject({ gems: 500, paidGems: 400, name: 'x' });
    expect(parityHash({ gems: 500, paidGems: 0 })).not.toBe(parityHash({ gems: 500, paidGems: 400 }));
  });

  test('(4) 전액 유료 4,000 보석에서 2,980 아바타 구매 중 저장 실패 → gems·paidGems 모두 원복', () => {
    const eco: any = new Economy({ storage: createMemoryStorage(), now: () => BANNER_EPOCH + 3_600_000 });
    eco.s.gems = 4000; eco.s.paidGems = 4000;
    eco.save = Economy.prototype.save; // 실제 save의 클램프·롤백 경로를 쓰되 저장소만 실패시킨다
    eco._storage = null;
    Object.defineProperty(eco, 'storage', { get: () => ({ getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem() {} }) });
    const r = eco.buyAvatar('avatar_knight_sakura');
    expect(r).toEqual({ ok: false, reason: 'storage' });
    expect(eco.s.gems).toBe(4000); expect(eco.s.paidGems).toBe(4000);
    expect(eco.s.avatars.owned).not.toContain('avatar_knight_sakura');
  });
});

describe('초보자 배너 SR 영웅 조건부 확률', () => {
  test('(6) mage 보유 시 mage SR 0, rogue·ranger 각 base.SR*srSplit.hero/2, 합 srSplit.hero', () => {
    const now = BANNER_EPOCH + 3_600_000, rates = gachaRates('beginner', now);
    const list = gachaContents('beginner', now, { ownsHero: (id: string) => id === 'mage' });
    const sr = list.filter((x: any) => x.kind === 'hero' && x.grade === 'SR');
    const of = (id: string) => sr.find((x: any) => x.id === id)?.p ?? 0;
    const total = rates.base.SR * (rates as any).srSplit.hero;
    expect(of('mage')).toBe(0);
    expect(of('rogue')).toBeCloseTo(total / 2, 12);
    expect(of('ranger')).toBeCloseTo(total / 2, 12);
    expect(sr.reduce((a: number, x: any) => a + x.p, 0)).toBeCloseTo(total, 12);
  });
});

describe('2차 교차 리뷰 회귀', () => {
  test('(7) [P1] /import: 저장의 마일리지·픽업 확정·초보자 횟수·유료 보석은 서버 문서 값만 쓰고, 이어 exchangeMileage는 거부', async () => {
    const h = await v1Harness({ env: { IAP_ENABLED: 'true' } as any });
    const a = await h.session();
    const row = h.db.sqlite.query('SELECT doc FROM account_docs WHERE account_id = ?').get(a.accountId) as { doc: string };
    const serverDoc = JSON.parse(row.doc);
    serverDoc.gacha = { ...serverDoc.gacha, beginner: 20, mileage: 0, guarantee: false, gearGuarantee: false };
    serverDoc.paidGems = 0;
    h.db.sqlite.query('UPDATE account_docs SET doc = ? WHERE account_id = ?').run(JSON.stringify(serverDoc), a.accountId);
    const forged = JSON.parse(JSON.stringify(serverDoc));
    forged.gacha = { ...forged.gacha, mileage: 100000, guarantee: true, gearGuarantee: true, beginner: 0 };
    forged.paidGems = 99999; forged.gems = 99999;
    const r = await h.send('POST', '/import', { installId: crypto.randomUUID(), save: forged }, a.token);
    expect(r.status).toBe(200);
    expect(r.body.report.reason).toBeNull();
    const g = r.body.doc.gacha;
    expect(g.mileage).toBe(0); expect(g.guarantee).toBe(false); expect(g.gearGuarantee).toBe(false); expect(g.beginner).toBe(20);
    expect(r.body.doc.paidGems || 0).toBeLessThanOrEqual(0);
    expect(r.body.doc.paidGems || 0).toBeLessThanOrEqual(r.body.doc.gems);
    const ex = await h.cmd(a.token, 'exchangeMileage', []);
    expect(ex.status).not.toBe(200);
    expect(((await h.send('GET', '/me', undefined, a.token)).body.doc.gacha).mileage).toBe(0);
  });

  test('(8) 전액 유료 4,000 보석에서 2,980 아바타 구매: /cmd 서버 문서와 클라이언트 EconomyCore의 paidGems·parityHash 일치(=1,020)', async () => {
    const s = await setup();
    s.setDoc({ gems: 4000, paidGems: 4000 });
    const start = (await s.me()).doc;
    const client: any = EconomyCore.fromState(start, { now: () => s.h.now() });
    expect(client.s.paidGems).toBe(4000);
    const id = 'avatar_knight_sakura';
    expect(client.buyAvatar(id)).toEqual({ ok: true });
    client.save();
    expect(client.s.gems).toBe(1020); expect(client.s.paidGems).toBe(1020);
    const r = await s.h.cmd(s.a.token, 'buyAvatar', [id], { clientHash: parityHash(client.s) });
    expect(r.status).toBe(200);
    expect(r.body.doc.gems).toBe(1020); expect(r.body.doc.paidGems).toBe(1020);
    expect(r.body.doc.paidGems).toBe(client.s.paidGems);
    expect(r.body.stateHash).toBe(parityHash(client.s));
    expect(r.body.match).toBe(true);
    expect(s.dbPaid()).toBe(1020);
  });

  test('(9) 부채 상계: 무료 1,500·부채 1,000에서 스타터 팩(1,000) → 서버 paidGems=순 지급량 0, 클라이언트 applyIapState와 일치', async () => {
    const s = await setup();
    s.setDoc({ gems: 1500, paidGems: 0 });
    s.h.db.sqlite.query("INSERT INTO iap_debt(account_id, reward_key, amount, updated_at) VALUES (?, 'gems', 1000, 1)").run(s.a.accountId);
    const before = (await s.me()).doc;
    const client: any = EconomyCore.fromState(before, { now: () => s.h.now() });
    const r = await buyStarter(s, 'p9');
    expect(r.body.state).toBe('granted');
    const grant = r.body.grants.find((g: any) => g.productId === 'starter_pack_v1');
    expect(grant.rewards.gems ?? 0).toBe(0); // 순 지급량: 1,000 - 상환 1,000
    const doc = (await s.me()).doc;
    expect(doc.gems).toBe(1500);
    expect(doc.paidGems || 0).toBe(0);
    expect(r.body.debt).toEqual({});
    expect(client.applyIapState({ grants: r.body.grants, reversals: [], entitlements: r.body.entitlements })).not.toBeNull();
    expect(client.s.gems).toBe(doc.gems);
    expect(client.s.paidGems || 0).toBe(doc.paidGems || 0);
  });
});
