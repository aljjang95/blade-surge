import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { EN_LISTINGS, buildDefinition, buildRequests, registerOnlyProducts, run, JSON_PATH } from '../tools/play-iap-register.mjs';
import { IAP_PRODUCTS } from '../src/shared/iap-catalog.js';

const sellable = IAP_PRODUCTS.filter((p: any) => p.enabled);

function spyFetch(status = 200) {
  const calls: any[] = [];
  const f = async (url: string, init: any) => {
    calls.push({ url, init });
    return { status, json: async () => ({}) };
  };
  return { f, calls };
}

test('enabled 상품만 요청에 들어가고 보석 팩은 제외된다', () => {
  const reqs = buildRequests();
  const text = JSON.stringify(reqs);
  for (const p of sellable) expect(text).toContain(p.id);
  expect(text).not.toContain('gems_300_v1');
  expect(text).not.toContain('gems_980_v1');
  expect(text).not.toContain('gems_1980_v1');
});

test('일회성은 PATCH + 활성화, 구독은 POST + basePlan 활성화이고 KRW 가격이 카탈로그와 같다', () => {
  const reqs: any[] = buildRequests();
  for (const p of sellable) {
    if (p.type === 'subscription') {
      const create = reqs.find((r: any) => r.method === 'POST' && r.path === '/subscriptions' && r.query.productId === p.id);
      expect(create).toBeTruthy();
      const bp = create.body.basePlans[0];
      expect(bp.basePlanId).toBe(p.basePlanId);
      expect(bp.autoRenewingBasePlanType.billingPeriodDuration).toBe('P1M');
      expect(bp.regionalConfigs[0].price).toEqual({ currencyCode: 'KRW', units: String(p.priceKRW) });
      expect(reqs.some((r: any) => r.path === `/subscriptions/${p.id}/basePlans/${p.basePlanId}:activate`)).toBe(true);
    } else {
      const patch = reqs.find((r: any) => r.method === 'PATCH' && r.path === `/onetimeproducts/${p.id}`);
      expect(patch).toBeTruthy();
      expect(patch.query.allowMissing).toBe('true');
      expect(patch.body.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price).toEqual({ currencyCode: 'KRW', units: String(p.priceKRW) });
      expect(patch.body.listings.map((l: any) => l.languageCode)).toEqual(['ko-KR', 'en-US']);
      expect(reqs.some((r: any) => r.path === `/oneTimeProducts/${p.id}/purchaseOptions:batchUpdateStates`)).toBe(true);
    }
  }
});

test('dry-run은 fetch를 한 번도 부르지 않는다', async () => {
  const { f, calls } = spyFetch();
  const out = await run({ fetch: f, base: 'https://x.test' });
  expect(calls.length).toBe(0);
  expect(out.requests.length).toBeGreaterThan(0);
});

test('probe는 GET 두 개만 부른다', async () => {
  const { f, calls } = spyFetch(204);
  await run({ fetch: f, mode: 'probe', base: 'https://x.test' });
  expect(calls.map((c) => [c.init.method, c.url])).toEqual([
    ['GET', 'https://x.test/oneTimeProducts'],
    ['GET', 'https://x.test/subscriptions'],
  ]);
});

test('apply는 승인 플래그 없이는 거부되고 fetch를 부르지 않는다', async () => {
  const { f, calls } = spyFetch();
  await expect(run({ fetch: f, mode: 'apply', base: 'https://x.test' })).rejects.toThrow();
  expect(calls.length).toBe(0);
});

test('apply는 승인되면 호출하고 첫 실패에서 멈춘다', async () => {
  const { f, calls } = spyFetch(403);
  const out = await run({ fetch: f, mode: 'apply', approved: true, base: 'https://x.test' });
  expect(calls.length).toBe(1);
  expect(out.failed?.status).toBe(403);
});

test('iap-products.json은 카탈로그와 일치한다', () => {
  const json = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  expect(json).toEqual(buildDefinition());
  expect(json.products.map((p: any) => p.id)).toEqual(sellable.map((p: any) => p.id));
  for (const jp of json.products) {
    const p = sellable.find((x: any) => x.id === jp.id)!;
    expect(jp.priceKRW).toBe(p.priceKRW);
    expect(jp.type).toBe(p.type);
    expect(jp.currencyCode).toBe('KRW');
    expect(jp.basePlanId).toBe(p.basePlanId);
  }
});

test('영웅 직접 판매(hero_*)는 dry-run 요청·정의·listing 어디에도 없다(소환 전용, docs/GACHA_HANDOFF.md)', async () => {
  const lines: string[] = [];
  const out = await run({ base: 'https://x.test', log: (m: string) => lines.push(m) });
  expect(JSON.stringify(out.requests)).not.toMatch(/hero_/);
  expect(lines.join('\n')).not.toMatch(/hero_/);
  expect(JSON.stringify(buildDefinition())).not.toMatch(/hero_/);
  expect(Object.keys(EN_LISTINGS).some((k) => k.startsWith('hero_'))).toBe(false);
  expect(out.requests.length).toBe(8);
});

test('register-only는 활성화 요청이 없고 보석 팩·성장 패키지를 비활성 등록하며 영웅·아바타·웹 전용은 뺀다', () => {
  const reqs: any[] = buildRequests(IAP_PRODUCTS, { registerOnly: true });
  const text = JSON.stringify(reqs);
  expect(text).not.toContain(':activate');
  expect(text).not.toContain('batchUpdateStates');
  for (const id of ['remove_ads_v1', 'starter_pack_v1', 'monthly_card_v1', 'season_pass_s1', 'growth_pack_v1', 'gems_300_v1', 'gems_980_v1', 'gems_1980_v1']) expect(text).toContain(id);
  expect(text).not.toContain('hero_');
  expect(text).not.toContain('avatar_fullset');
  expect(text).not.toContain('monthly_pass_v1');
  expect(reqs.length).toBe(registerOnlyProducts().length);
  const gem = reqs.find((r: any) => r.body.productId === 'gems_1980_v1');
  expect(gem.body.purchaseOptions[0].regionalPricingAndAvailabilityConfigs[0].price.units).toBe('22000');
});
