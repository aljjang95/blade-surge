import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { IAP_PRODUCTS, soldOn } from '../src/shared/iap-catalog.js';
import { createBillingService } from '../src/platform/billing-service.js';
import { Economy } from '../src/game/economy.js';

const JAVA = 'android/app/src/googleplay/java/com/theluxurylord/bladesurge/StoreBridgePlugin.java';
const javaTypes = () => {
  const src = readFileSync(JAVA, 'utf8');
  return new Map([...src.matchAll(/CATALOG_TYPES\.put\(\s*"([a-z0-9_]+)"\s*,\s*"(inapp|subs)"\s*\)/g)].map((m) => [m[1], m[2]]));
};
const playType = (p: any) => (p.type === 'subscription' ? 'subs' : 'inapp');

test('StoreBridgePlugin CATALOG_TYPES는 서버 카탈로그의 활성·Play 판매 상품 id·타입과 정확히 같다', () => {
  const expected = new Map(IAP_PRODUCTS.filter((p: any) => p.enabled && soldOn(p, 'play')).map((p: any) => [p.id, playType(p)]));
  const actual = javaTypes();
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [id, type] of expected) expect(actual.get(id)).toBe(type as string);
  for (const id of ['hero_knight_v1', 'hero_barbarian_v1', 'hero_mage_v1', 'hero_rogue_v1', 'hero_ranger_v1', 'hero_all_v1']) expect(actual.get(id)).toBe('inapp');
});

test('billing-service는 Play 판매 상품만 adapter.list()에 넘긴다', async () => {
  const mk = (id: string, channels?: string[]) => ({ id, type: 'non_consumable', playType: 'inapp', basePlanId: null, priceKRW: 1, shopSku: id, once: false, eligible: true, ...(channels ? { channels } : {}) });
  const products = [mk('remove_ads_v1', ['play']), mk('web_only_v1', ['web']), mk('hero_mage_v1', ['web', 'play'])];
  let listed: string[] = [];
  const m = new Map<string, string>();
  const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
  const account: any = { me: async () => ({ flags: { iap: true } }), iapCatalog: async () => ({ billing: true, products, serverTime: 1 }) };
  const adapter: any = { list: async (req: any[]) => { listed = req.map((r) => r.productId); return { status: 'products', products: req.map((r) => ({ productId: r.productId, formattedPrice: '₩1', priceAmountMicros: '1', currencyCode: 'KRW' })), unavailableProductIds: [] }; } };
  const economy: any = new Economy({ storage, now: () => 1_000_000 });
  const billing = createBillingService({ account, loadAdapter: async () => adapter, economy, minSyncGapMs: 0, storage });
  expect(await billing.init()).toBe(true);
  expect(listed).toEqual(['remove_ads_v1', 'hero_mage_v1']);
});
