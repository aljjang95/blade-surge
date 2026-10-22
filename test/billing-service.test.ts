import { expect, test } from 'bun:test';
import { createBillingService } from '../src/platform/billing-service.js';
import { Economy } from '../src/game/economy.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const PRODUCTS = [
  { id: 'remove_ads_v1', type: 'non_consumable', playType: 'inapp', basePlanId: null, priceKRW: 4900, shopSku: 'remove_ads', once: false, eligible: true },
  { id: 'starter_pack_v1', type: 'consumable', playType: 'inapp', basePlanId: null, priceKRW: 1200, shopSku: 'starter', once: true, eligible: true },
  { id: 'monthly_card_v1', type: 'subscription', playType: 'subs', basePlanId: 'monthly', priceKRW: 5900, shopSku: 'monthly', once: false, eligible: true },
];
const play = (id: string, price = '₩9,999') => ({ productId: id, type: id.startsWith('monthly') ? 'subs' : 'inapp', formattedPrice: price, priceAmountMicros: '1', currencyCode: 'KRW' });
const granted = (productId: string, extra: any = {}) => ({ state: 'granted', productId, granted: ['g1'], acked: true, test: false,
  grants: [{ opId: 'g1', productId, rewards: { ssrTicket: 1, gems: 1000, gold: 50000 }, at: 1 }], reversals: [],
  entitlements: { adsRemoved: false, monthlyUntil: 0, passPremium: false, season: 's1' }, serverTime: 1, ...extra });

function setup(opts: any = {}) {
  const calls: any[] = [];
  const account: any = {
    me: async () => ({ flags: { iap: opts.iap !== false } }),
    iapCatalog: async () => ({ version: 1, billing: opts.billing !== false, products: opts.products || PRODUCTS, serverTime: 1 }),
    iapIntent: async (id: string) => { calls.push(['intent', id]); if (opts.intentError) throw opts.intentError; return { productId: id, type: 'consumable', playType: id.startsWith('monthly') ? 'subs' : 'inapp', basePlanId: id.startsWith('monthly') ? 'monthly' : null, obfuscatedAccountId: 'obf1' }; },
    iapVerify: async (id: string, token: string) => { calls.push(['verify', id, token]); if (opts.verifyError) throw opts.verifyError; return opts.verify ? opts.verify(id, token) : granted(id); },
    iapState: async () => { calls.push(['state']); return opts.state || { grants: [], reversals: [], entitlements: { adsRemoved: false, monthlyUntil: 0, passPremium: false } }; },
  };
  const adapter: any = {
    list: async (req: any[]) => { calls.push(['list', req.length]); return { status: 'products', products: (opts.playIds || PRODUCTS.map((p) => p.id)).map((id: string) => play(id)), unavailableProductIds: [] }; },
    purchase: async (c: any) => { calls.push(['purchase', c.productId, c.type, c.basePlanId, c.obfuscatedAccountId]); if (opts.purchase) return opts.purchase(c); return { purchaseToken: 'TOKEN-SECRET-1', productId: c.productId, type: c.type }; },
    owned: async () => { if (opts.ownedError) throw new Error('x'); return opts.owned || []; },
  };
  const economy: any = new Economy({ storage: memory(), now: () => 1_000_000 });
  const billing = createBillingService({ account, loadAdapter: async () => (opts.noAdapter ? null : adapter), economy, onVerified: opts.onVerified, minSyncGapMs: 0, storage: opts.storage || memory(), now: opts.now });
  economy.setBilling(billing);
  return { billing, economy, calls, account };
}

test('init은 v1 플래그·어댑터·카탈로그·Play 가격이 모두 있을 때만 ready', async () => {
  const a = setup(); expect(a.billing.available()).toBe(false); expect(await a.billing.init()).toBe(true); expect(a.billing.available()).toBe(true);
  expect(a.economy.paymentAvailable()).toBe(true);
  for (const o of [{ iap: false }, { billing: false }, { noAdapter: true }, { playIds: [] }]) {
    const b = setup(o); expect(await b.billing.init()).toBe(false); expect(b.billing.available()).toBe(false); expect(b.economy.paymentAvailable()).toBe(false);
  }
  const c = setup(); c.account.me = async () => { throw Object.assign(new Error('x'), { status: 503 }); };
  expect(await c.billing.init()).toBe(false);
});

test('가격은 Play 값만 쓰고 Play 가격이 없는 상품은 판매 불가', async () => {
  const { billing } = setup({ playIds: ['starter_pack_v1', 'monthly_card_v1'] });
  await billing.init();
  expect(billing.product('starter_pack_v1')).toMatchObject({ formattedPrice: '₩9,999', sellable: true });
  const ads = billing.productForShopSku('remove_ads');
  expect(ads?.formattedPrice).toBeNull(); expect(ads?.sellable).toBe(false);
  expect(JSON.stringify(ads)).not.toContain('₩4,900');
  expect(await billing.buy('remove_ads_v1')).toEqual({ ok: false, reason: 'unavailable' });
  expect(billing.productForShopSku('nope')).toBeNull();
});

test('서버 verify 응답이 granted일 때만 지급하고 구매 성공 이벤트를 알린다', async () => {
  const events: any[] = [];
  const products = PRODUCTS.map((p) => ({ ...p })); // 서버 카탈로그: 지급 뒤 once 상품은 eligible=false가 된다
  const { billing, economy, calls } = setup({ products, onVerified: (e: any) => events.push(e),
    verify: (id: string) => { products.find((p) => p.id === id)!.eligible = false; return granted(id); } });
  await billing.init();
  const gems = economy.s.gems;
  const r = await billing.buy('starter_pack_v1');
  expect(r.ok).toBe(true); expect(r.state).toBe('granted');
  expect(economy.s.gems).toBe(gems + 1000);
  expect(calls.map((c: any) => c[0])).toEqual(['list', 'intent', 'purchase', 'verify']);
  expect(calls.find((c: any) => c[0] === 'purchase')).toEqual(['purchase', 'starter_pack_v1', 'inapp', undefined, 'obf1']);
  expect(events).toEqual([{ productId: 'starter_pack_v1', shopSku: 'starter' }]);
  expect(JSON.stringify(economy.s)).not.toContain('TOKEN-SECRET');
  // 스타터는 once라 더 이상 판매 가능하지 않다.
  expect(billing.product('starter_pack_v1')?.sellable).toBe(false);
});

test('구독은 basePlanId를 어댑터에 전달한다', async () => {
  const { billing, calls } = setup({ verify: (id: string) => granted(id, { entitlements: { adsRemoved: false, monthlyUntil: 9_000_000, passPremium: false } }) });
  await billing.init();
  const r = await billing.buy('monthly_card_v1');
  expect(r.ok).toBe(true);
  expect(calls.find((c: any) => c[0] === 'purchase')).toEqual(['purchase', 'monthly_card_v1', 'subs', 'monthly', 'obf1']);
});

test('서버 verify가 실패하면 로컬에 아무 것도 주지 않는다', async () => {
  const { billing, economy } = setup({ verifyError: Object.assign(new Error('boom'), { status: 500 }) });
  await billing.init();
  const before = JSON.stringify(economy.s);
  expect(await billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'verify-failed' });
  expect(JSON.stringify(economy.s)).toBe(before);
});

test('pending은 서버에 기록만 하고 지급 없이 pending을 돌려준다', async () => {
  const { billing, economy, calls } = setup({ purchase: (c: any) => ({ pending: true, purchaseToken: 'TOK', productId: c.productId }) });
  await billing.init();
  const before = JSON.stringify(economy.s);
  expect(await billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'pending' });
  expect(calls.some((c: any) => c[0] === 'verify')).toBe(true);
  expect(JSON.stringify(economy.s)).toBe(before);
  // 서버가 pending 상태를 돌려줘도 지급하지 않는다.
  const b = setup({ verify: (id: string) => ({ ...granted(id), state: 'pending', grants: [] }) });
  await b.billing.init(); const bb = JSON.stringify(b.economy.s);
  expect(await b.billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'pending' });
  expect(JSON.stringify(b.economy.s)).toBe(bb);
});

test('취소는 cancelled, 의도 거부는 사유를 그대로, 구매 실패는 purchase-failed', async () => {
  const c = setup({ purchase: () => { throw new Error('purchase-cancelled'); } }); await c.billing.init();
  expect(await c.billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'cancelled' });
  expect(c.calls.some((x: any) => x[0] === 'verify')).toBe(false);
  const e = setup({ intentError: Object.assign(new Error('x'), { status: 409, body: { error: 'already-subscribed' } }) }); await e.billing.init();
  expect(await e.billing.buy('monthly_card_v1')).toEqual({ ok: false, reason: 'already-subscribed' });
  const d = setup({ intentError: Object.assign(new Error('x'), { status: 503, body: {} }) }); await d.billing.init();
  expect(await d.billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'billing-disabled' });
  const f = setup({ purchase: () => { throw new Error('purchase-incomplete'); } }); await f.billing.init();
  expect(await f.billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'purchase-failed' });
});

test('진행 중에는 중복 buy를 거부한다', async () => {
  let release: (v: any) => void = () => {};
  const { billing, economy } = setup({ purchase: (c: any) => new Promise((res) => { release = () => res({ purchaseToken: 'T', productId: c.productId, type: 'inapp' }); }) });
  await billing.init();
  const first = billing.buy('starter_pack_v1');
  await new Promise((r) => setTimeout(r, 0));
  expect(await billing.buy('remove_ads_v1')).toEqual({ ok: false, reason: 'busy' });
  expect(await billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'busy' });
  release(null);
  expect((await first).ok).toBe(true);
  expect(economy.s.iapApplied).toEqual(['g1']);
});

test('저장 실패면 storage를 돌려주고 보상을 남기지 않는다', async () => {
  const { billing, economy } = setup(); await billing.init();
  economy.save = () => false; const gems = economy.s.gems;
  expect(await billing.buy('starter_pack_v1')).toEqual({ ok: false, reason: 'storage' });
  expect(economy.s.gems).toBe(gems);
});

test('sync는 미승인 보유 토큰을 서버에 verify하고 서버 상태를 적용한다(카탈로그 밖 상품은 건너뜀)', async () => {
  const { billing, economy, calls } = setup({
    owned: [{ productId: 'starter_pack_v1', type: 'inapp', purchaseToken: 'OWNED-1', status: 'purchased', acknowledged: false },
      { productId: 'unknown_v9', type: 'inapp', purchaseToken: 'OWNED-2', status: 'purchased', acknowledged: false }],
    state: { grants: [{ opId: 'g9', productId: 'remove_ads_v1', rewards: {} }], reversals: [], entitlements: { adsRemoved: true, monthlyUntil: 0, passPremium: false } },
  });
  await billing.init();
  expect(await billing.sync()).toBe(true);
  expect(calls.filter((c: any) => c[0] === 'verify')).toEqual([['verify', 'starter_pack_v1', 'OWNED-1']]);
  expect(economy.s.adsRemoved).toBe(true);
});

test('sync 실패는 조용히 넘어가고 ready 전에는 아무 것도 하지 않는다', async () => {
  const idle = setup(); expect(await idle.billing.sync()).toBe(false); expect(idle.calls.length).toBe(0);
  const { billing, account } = setup({ ownedError: true }); await billing.init();
  account.iapState = async () => { throw new Error('offline'); };
  expect(await billing.sync()).toBe(false);
});

const verifies = (calls: any[]) => calls.filter((c) => c[0] === 'verify').map((c) => c[1]);
const own = (productId: string, type: string, acknowledged: boolean, status = 'purchased') => ({ productId, type, purchaseToken: 'T-' + productId, status, acknowledged });

test('sync verify 빈도: 미승인은 항상, 승인된 일회성(inapp)은 건너뛰고, iapState는 매번 1회', async () => {
  const { billing, calls } = setup({ owned: [own('starter_pack_v1', 'inapp', false), own('remove_ads_v1', 'inapp', true), own('monthly_card_v1', 'subs', false)] });
  await billing.init();
  await billing.sync(); await billing.sync();
  expect(verifies(calls)).toEqual(['starter_pack_v1', 'monthly_card_v1', 'starter_pack_v1', 'monthly_card_v1']);
  expect(calls.filter((c: any) => c[0] === 'state').length).toBe(2);
  // pending 보유(미승인)도 서버가 기록·보완하도록 verify한다.
  const p = setup({ owned: [own('starter_pack_v1', 'inapp', false, 'pending')] }); await p.billing.init(); await p.billing.sync();
  expect(verifies(p.calls)).toEqual(['starter_pack_v1']);
});

test('sync verify 빈도: 승인된 구독은 상품별 6시간에 한 번, 시각만 저장하고 토큰은 저장하지 않는다', async () => {
  let t = 1_000_000_000;
  const storage = memory();
  const { billing, calls } = setup({ owned: [own('monthly_card_v1', 'subs', true), own('starter_pack_v1', 'inapp', true)], storage, now: () => t });
  await billing.init();
  await billing.sync(); expect(verifies(calls)).toEqual(['monthly_card_v1']);
  t += 5 * 3600000; await billing.sync(); expect(verifies(calls)).toEqual(['monthly_card_v1']);
  t += 1 * 3600000 + 1; await billing.sync(); expect(verifies(calls)).toEqual(['monthly_card_v1', 'monthly_card_v1']);
  const saved = storage.getItem('bladesurge_iap_sub_check_v1')!;
  expect(JSON.parse(saved)).toEqual({ monthly_card_v1: t }); expect(saved).not.toContain('T-monthly');
  expect(calls.filter((c: any) => c[0] === 'state').length).toBe(3);
  // verify 실패 시에는 시각을 갱신하지 않아 다음 sync에서 다시 확인한다.
  const f = setup({ owned: [own('monthly_card_v1', 'subs', true)], storage: memory(), now: () => t, verifyError: new Error('x') });
  await f.billing.init(); await f.billing.sync(); await f.billing.sync();
  expect(verifies(f.calls).length).toBe(2);
});
