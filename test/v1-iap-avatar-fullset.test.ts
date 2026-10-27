import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { V1Error } from '../worker/v1/db';
import type { PlayApi, ProductPurchase } from '../worker/v1/play';
import { grantOnce } from '../worker/v1/iap';
import { IAP_BY_ID, avatarFullsetKey, avatarFullsetProductId } from '../src/shared/iap-catalog.js';

// 아바타 풀셋 상품(avatar_fullset_<heroId>_v1) 서버 검증 지급 연결 시험.
// 상품은 운영에서 enabled:false(실결제 비활성)이므로 시험 안에서만 켜고 끝나면 원복한다. 결제 SDK·영수증은 가짜 Play API다.
const HERO = 'knight', AVATAR = 'avatar_knight_sakura', PID = avatarFullsetProductId(HERO);
const TOK = (n: string) => 'tok-' + n.padEnd(24, 'x');

function fakePlay() {
  const products = new Map<string, ProductPurchase>();
  const acked: string[] = [];
  const api: PlayApi = {
    async productPurchase(token) { const p = products.get(token); if (!p) throw new V1Error(422, 'purchase-not-found'); return { ...p }; },
    async subscriptionPurchase() { throw new V1Error(422, 'purchase-not-found'); },
    async acknowledgeProduct(_id, token) { acked.push(token); const p = products.get(token); if (p) p.acknowledged = true; },
    async consumeProduct() {},
    async acknowledgeSubscription() {},
    async voided() { return []; },
  };
  const add = (token: string, obf: string | null, extra: Partial<ProductPurchase> = {}) => products.set(token, {
    productId: PID, quantity: 1, refundableQuantity: 1, purchaseState: 'PURCHASED', consumed: false, acknowledged: false,
    obfuscatedAccountId: obf, orderId: 'GPA.' + token.slice(-6), test: false, ...extra });
  return { api, add, acked };
}

async function setup({ premium = true } = {}) {
  const h = await v1Harness({ env: { IAP_ENABLED: 'true' } as any });
  const play = fakePlay();
  (h.deps as any).playApi = play.api;
  if (premium) (h.deps as any).avatarPremium = { [HERO]: AVATAR };
  const a = await h.session();
  const intent = () => h.send('POST', '/iap/intent', { productId: PID }, a.token);
  const verify = (t: string) => h.send('POST', '/iap/verify', { productId: PID, purchaseToken: t }, a.token);
  const doc = async () => (await h.send('GET', '/me', undefined, a.token)).body.doc;
  const count = (sql: string) => (h.db.sqlite.query(sql).get() as { n: number }).n;
  return { h, play, a, intent, verify, doc, count };
}

let wasEnabled: boolean;
beforeEach(() => { wasEnabled = IAP_BY_ID[PID].enabled; (IAP_BY_ID[PID] as any).enabled = true; });
afterEach(() => { (IAP_BY_ID[PID] as any).enabled = wasEnabled; });

describe('아바타 풀셋: 서버 영수증 검증 → grantAvatarFullset 연결', () => {
  test('운영 기본값은 비활성이다(실결제 미개방): 의도·검증 모두 unknown-product, 지급 없음', async () => {
    (IAP_BY_ID[PID] as any).enabled = false;
    const { play, a, intent, verify, doc, h } = await setup();
    expect((await intent()).body.error).toBe('unknown-product');
    play.add(TOK('d1'), 'x'.repeat(48));
    expect((await verify(TOK('d1'))).body.error).toBe('unknown-product');
    expect((await doc()).avatars.owned).toEqual([]);
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM iap_grants').get()).toEqual({ n: 0 });
  });

  test('검증 성공: 풀셋 아바타가 소유되고 권한이 기록되며 확정(ack)은 지급 뒤에만 된다', async () => {
    const { play, intent, verify, doc, count } = await setup();
    const it = (await intent()).body;
    play.add(TOK('ok1'), it.obfuscatedAccountId);
    const r = await verify(TOK('ok1'));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('granted');
    expect(r.body.entitlements.avatarFullsets).toEqual([HERO]);
    expect((await doc()).avatars.owned).toEqual([AVATAR]);
    expect(play.acked).toEqual([TOK('ok1')]);
    expect(count(`SELECT COUNT(*) AS n FROM iap_entitlements WHERE ent_key = '${avatarFullsetKey(HERO)}' AND revoked_at IS NULL`)).toBe(1);
  });

  test('중복 주문: 같은 영수증 재검증·같은 grantId 재지급은 한 번만 지급된다', async () => {
    const { h, play, a, intent, verify, doc, count } = await setup();
    const it = (await intent()).body;
    play.add(TOK('dup1'), it.obfuscatedAccountId);
    expect((await verify(TOK('dup1'))).body.state).toBe('granted');
    expect((await verify(TOK('dup1'))).body.state).toBe('already');
    expect((await doc()).avatars.owned).toEqual([AVATAR]);
    expect(count(`SELECT COUNT(*) AS n FROM wallet_ledger WHERE kind = 'iap:${PID}'`)).toBe(1);
    // 같은 grantId 를 직접 한 번 더 넣어도(경합·재시도) 원장·권한·소유가 늘지 않는다.
    const row = h.db.sqlite.query('SELECT grant_id, token_hash FROM iap_grants').get() as { grant_id: string; token_hash: string };
    const c = { env: h.env, db: h.db, deps: h.deps, now: h.now(), request: new Request('https://x/') } as any;
    const again = await grantOnce(c, a.accountId, IAP_BY_ID[PID] as any, row.token_hash, row.grant_id, {}, {
      purchase: { state: 'granted', test: false }, entitlements: [{ key: avatarFullsetKey(HERO), expiresAt: null }] });
    expect(again).toBe('duplicate');
    expect((await doc()).avatars.owned).toEqual([AVATAR]);
    expect(count('SELECT COUNT(*) AS n FROM iap_grants')).toBe(1);
  });

  test('검증 실패·미검증: 대기·취소·없는 영수증·계정 미결박은 지급하지 않고 확정도 하지 않는다', async () => {
    const { play, intent, verify, doc, count } = await setup();
    const it = (await intent()).body;
    play.add(TOK('pend'), it.obfuscatedAccountId, { purchaseState: 'PENDING' });
    expect((await verify(TOK('pend'))).body.state).toBe('pending');
    play.add(TOK('canc'), it.obfuscatedAccountId, { purchaseState: 'CANCELLED' });
    expect((await verify(TOK('canc'))).body.state).toBe('refunded');
    expect((await verify(TOK('none'))).status).toBe(422);
    play.add(TOK('unk'), 'unknown-obf-id-123456');
    expect((await verify(TOK('unk'))).body.error).toBe('purchase-account-unknown');
    play.add(TOK('qty'), it.obfuscatedAccountId, { quantity: 2 });
    expect((await verify(TOK('qty'))).body.error).toBe('purchase-mismatch');
    expect((await doc()).avatars.owned).toEqual([]);
    expect(play.acked).toEqual([]);
    expect(count('SELECT COUNT(*) AS n FROM iap_grants')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM iap_entitlements')).toBe(0);
  });

  test('아바타 자산이 아직 준비되지 않았으면(운영 표 비어 있음) 결제 전에 막고, 검증 지급도 확정 없이 거절한다', async () => {
    const { h, play, a, intent, verify, doc, count } = await setup({ premium: false });
    expect((await intent()).body.error).toBe('not-eligible');
    // 의도를 우회해 만든 구매가 들어와도(obf 직접 발급) 지급·확정 없이 declined.
    const obf = (await (async () => { (h.deps as any).avatarPremium = { [HERO]: AVATAR }; const r = await intent(); delete (h.deps as any).avatarPremium; return r; })()).body.obfuscatedAccountId;
    play.add(TOK('np'), obf);
    const r = await verify(TOK('np'));
    expect(r.body.state).toBe('declined');
    expect(r.body.acked).toBe(false);
    expect((await doc()).avatars.owned).toEqual([]);
    expect(count('SELECT COUNT(*) AS n FROM iap_entitlements')).toBe(0);
    void a;
  });

  test('클라이언트 단독 지급 경로는 없다: /cmd 로 grantAvatarFullset 을 요청하면 거부된다', async () => {
    const { h, a, doc } = await setup();
    const r = await h.cmd(a.token, 'grantAvatarFullset', [HERO]);
    expect(r.status).toBe(400);
    expect((await doc()).avatars.owned).toEqual([]);
  });
});
