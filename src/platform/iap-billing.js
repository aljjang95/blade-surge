import { Capacitor, registerPlugin } from '@capacitor/core';

// 네이티브는 구매 토큰만 돌려준다. acknowledge·consume·지급은 서버가 한다. 토큰은 반환값으로만 전달하고 기록하지 않는다.
// 빌드 채널(__BLADE_CHANNEL__) → 서버 결제 채널. 원스토어는 inapp(일회성)만 판다.
const STORE_CHANNELS = { googleplay: { store: 'googleplay', billing: 'play', types: ['inapp', 'subs'] }, onestore: { store: 'onestore', billing: 'onestore', types: ['inapp'] } };
const MAX_PRODUCTS = 20, MAX_OWNED = 40, MAX_TOKEN = 4096;
const validToken = v => typeof v === 'string' && v.length >= 1 && v.length <= MAX_TOKEN;
const validMarket = v => typeof v === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(v);
const validId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/.test(v);

function checkProductList(products, TYPES) {
  if (!Array.isArray(products) || products.length < 1 || products.length > MAX_PRODUCTS
    || products.some(p => !p || !validId(p.productId) || !TYPES.includes(p.type))) throw Error('store-unavailable');
}

/** @param {any} plugin @param {'googleplay' | 'onestore'} [store] */
export function createPlayCatalogAdapter(plugin, store = 'googleplay') {
  const { store: CHANNEL, billing, types: TYPES } = STORE_CHANNELS[store];
  const onestore = store === 'onestore';
  return {
    channel: CHANNEL,
    billingChannel: billing,
    list: async products => {
      checkProductList(products, TYPES);
      const input = products.map(p => ({ productId: p.productId, type: p.type }));
      const r = await plugin.listCatalog({ products: input });
      if (!r || r.channel !== CHANNEL || !['products', 'partial'].includes(r.status) || !Array.isArray(r.products)
        || r.products.length > MAX_PRODUCTS || !Array.isArray(r.unavailableProductIds)) throw Error('store-unavailable');
      for (const p of r.products) {
        if (!validId(p?.productId) || !TYPES.includes(p.type) || typeof p.formattedPrice !== 'string'
          || typeof p.priceAmountMicros !== 'string' || typeof p.currencyCode !== 'string') throw Error('store-unavailable');
      }
      return { status: r.status, products: r.products, unavailableProductIds: r.unavailableProductIds };
    },
    purchase: async ({ productId, type, basePlanId = /** @type {string | undefined} */ (undefined), obfuscatedAccountId }) => {
      if (!validId(productId) || !TYPES.includes(type) || typeof obfuscatedAccountId !== 'string' || !obfuscatedAccountId) throw Error('purchase-incomplete');
      const call = { productId, type, obfuscatedAccountId };
      if (type === 'subs' && basePlanId) call.basePlanId = basePlanId;
      const r = await plugin.purchaseCatalog(call);
      if (!r || r.channel !== CHANNEL) throw Error('purchase-incomplete');
      if (r.status === 'cancelled') throw Error('purchase-cancelled');
      if (!['purchased', 'pending'].includes(r.status) || r.productId !== productId || r.type !== type || !validToken(r.purchaseToken)) throw Error('purchase-incomplete');
      // pending도 서버가 지급 없이 기록하도록 토큰과 함께 돌려준다.
      if (r.status === 'pending') return { pending: true, purchaseToken: r.purchaseToken, productId };
      /** @type {any} */
      const out = { purchaseToken: r.purchaseToken, productId, type, orderId: typeof r.orderId === 'string' ? r.orderId : undefined, acknowledged: r.acknowledged === true };
      if (!onestore) return out;
      if (!validMarket(r.marketCode)) throw Error('purchase-incomplete');
      return { ...out, marketCode: r.marketCode };
    },
    owned: async () => {
      const r = await plugin.queryOwned({});
      if (!r || r.channel !== CHANNEL || r.status !== 'owned' || !Array.isArray(r.purchases) || r.purchases.length > MAX_OWNED) throw Error('store-unavailable');
      return r.purchases.map(p => {
        if (!p || !validId(p.productId) || !TYPES.includes(p.type) || !['purchased', 'pending'].includes(p.status) || !validToken(p.purchaseToken)) throw Error('store-unavailable');
        const item = { productId: p.productId, type: p.type, purchaseToken: p.purchaseToken, status: p.status, acknowledged: p.acknowledged === true };
        if (!onestore) return item;
        if (!validMarket(p.marketCode)) throw Error('store-unavailable');
        return { ...item, marketCode: p.marketCode };
      });
    },
  };
}

export async function loadPlayCatalogAdapter() {
  const store = typeof __BLADE_CHANNEL__ === 'string' && Object.hasOwn(STORE_CHANNELS, __BLADE_CHANNEL__) ? __BLADE_CHANNEL__ : null;
  if (!store) return null;
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('BladeStore')) return null;
    const plugin = registerPlugin('BladeStore'), capabilities = await plugin.getCapabilities();
    if (capabilities?.channel !== store || capabilities.catalogBilling !== true) return null;
    return createPlayCatalogAdapter(plugin, /** @type {'googleplay' | 'onestore'} */ (store));
  } catch { return null; }
}
export const loadStoreCatalogAdapter = loadPlayCatalogAdapter;
