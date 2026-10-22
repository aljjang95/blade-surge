// BM D10a: Google Play Developer API 최소 클라이언트(영수증 조회·acknowledge·consume·환불 목록).
// 자격 증명은 Secrets Store 바인딩 PLAY_SA_JSON(서비스 계정 JSON)뿐이다. 키·토큰·제공자 오류 원문은 응답·로그에 싣지 않는다.
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/acknowledge (consume 동일 경로)
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list
import { V1Error } from './db';
import { b64url } from './token';
import { IAP_PACKAGE } from '../../src/shared/iap-catalog.js';

const OAUTH = 'https://oauth2.googleapis.com/token';
const BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${IAP_PACKAGE}/purchases`;
const TIMEOUT_MS = 6000;

export interface ProductPurchase {
  productId: string; quantity: number; refundableQuantity: number | null;
  purchaseState: 'PURCHASED' | 'PENDING' | 'CANCELLED' | 'UNKNOWN';
  consumed: boolean; acknowledged: boolean; obfuscatedAccountId: string | null; orderId: string | null; test: boolean;
}
export interface SubscriptionPurchase {
  productId: string; basePlanId: string | null; state: string; expiryTime: number | null; acknowledged: boolean;
  obfuscatedAccountId: string | null; latestOrderId: string | null; linkedPurchaseToken: string | null; test: boolean;
}
export interface VoidedPurchase { purchaseToken: string; orderId: string | null; voidedTimeMillis: number; kind: 'product' | 'subscription' | 'unknown' }
export interface PlayApi {
  productPurchase(token: string): Promise<ProductPurchase>;
  subscriptionPurchase(token: string): Promise<SubscriptionPurchase>;
  acknowledgeProduct(productId: string, token: string): Promise<void>;
  consumeProduct(productId: string, token: string): Promise<void>;
  acknowledgeSubscription(productId: string, token: string): Promise<void>;
  voided(startTimeMs: number): Promise<VoidedPurchase[]>;
}
export interface PlayEnv { PLAY_SA_JSON?: string | { get(): Promise<string> } }
type Fetch = (request: Request) => Promise<Response>;
type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 512 ? v : null);
const ms = (v: unknown): number | null => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };

/** 서비스 계정 JSON(원문 또는 base64)을 읽는다. 형식이 틀리면 credential 오류로 닫는다. */
async function serviceAccount(env: PlayEnv): Promise<{ email: string; key: string }> {
  const source = env.PLAY_SA_JSON;
  let raw = typeof source === 'string' ? source : source && typeof source.get === 'function' ? await source.get().catch(() => '') : '';
  if (!raw) throw new V1Error(503, 'play-credential-unavailable');
  raw = raw.trim();
  if (!raw.startsWith('{')) { try { raw = atob(raw); } catch { throw new V1Error(503, 'play-credential-invalid'); } }
  let sa: Obj;
  try { sa = obj(JSON.parse(raw)); } catch { throw new V1Error(503, 'play-credential-invalid'); }
  if (sa.type !== 'service_account' || typeof sa.client_email !== 'string' || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(sa.client_email)
    || typeof sa.private_key !== 'string' || (sa.token_uri !== undefined && sa.token_uri !== OAUTH)) throw new V1Error(503, 'play-credential-invalid');
  return { email: sa.client_email, key: sa.private_key };
}

let cachedToken: { value: string; until: number; email: string } | null = null;

async function withTimeout(fetcher: Fetch, request: Request): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetcher(new Request(request, { signal: controller.signal, redirect: 'error' })); }
  catch { throw new V1Error(503, 'play-unavailable'); }
  finally { clearTimeout(timer); }
}

async function accessToken(env: PlayEnv, fetcher: Fetch, now: () => number): Promise<string> {
  const sa = await serviceAccount(env);
  if (cachedToken && cachedToken.email === sa.email && cachedToken.until > now() + 60_000) return cachedToken.value;
  let assertion: string;
  try {
    const pem = sa.key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
    const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const iat = Math.floor(now() / 1000);
    const enc = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));
    const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: OAUTH, iat, exp: iat + 3600 })}`;
    assertion = `${unsigned}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))))}`;
  } catch { throw new V1Error(503, 'play-credential-invalid'); }
  const response = await withTimeout(fetcher, new Request(OAUTH, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() }));
  if (!response.ok) throw new V1Error(503, 'play-credential-rejected');
  const body = obj(await response.json().catch(() => null));
  if (typeof body.access_token !== 'string' || !body.access_token || typeof body.expires_in !== 'number') throw new V1Error(503, 'play-unavailable');
  cachedToken = { value: body.access_token, until: now() + body.expires_in * 1000, email: sa.email };
  return cachedToken.value;
}

/** 실제 Play API. 테스트는 같은 인터페이스의 가짜를 deps.playApi로 넣는다. */
export function createPlayApi(env: PlayEnv, fetcher: Fetch = (r) => fetch(r), now: () => number = () => Date.now()): PlayApi {
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Obj> {
    const token = await accessToken(env, fetcher, now);
    const response = await withTimeout(fetcher, new Request(BASE + path, { method,
      headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) }));
    if (response.status === 400 || response.status === 404 || response.status === 410) throw new V1Error(422, 'purchase-not-found');
    if (response.status === 401 || response.status === 403) { cachedToken = null; throw new V1Error(503, 'play-credential-rejected'); }
    if (!response.ok) throw new V1Error(503, 'play-unavailable');
    if (response.status === 204) return {};
    const text = await response.text().catch(() => '');
    if (!text) return {};
    try { return obj(JSON.parse(text)); } catch { throw new V1Error(503, 'play-unavailable'); }
  }
  const tok = (token: string) => encodeURIComponent(token);
  return {
    async productPurchase(token) {
      const r = await call('GET', `/productsv2/tokens/${tok(token)}`);
      const items = Array.isArray(r.productLineItem) ? r.productLineItem : [];
      if (items.length !== 1) throw new V1Error(422, 'purchase-mismatch');
      const item = obj(items[0]), offer = obj(item.productOfferDetails), ctx = obj(r.purchaseStateContext);
      const state = ctx.purchaseState;
      return {
        productId: str(item.productId) ?? '', quantity: Number(offer.quantity ?? 1),
        refundableQuantity: typeof offer.refundableQuantity === 'number' ? offer.refundableQuantity : null,
        purchaseState: state === 'PURCHASED' || state === 'PENDING' || state === 'CANCELLED' ? state : 'UNKNOWN',
        consumed: offer.consumptionState === 'CONSUMPTION_STATE_CONSUMED',
        acknowledged: r.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        obfuscatedAccountId: str(r.obfuscatedExternalAccountId), orderId: str(r.orderId), test: r.testPurchaseContext !== undefined,
      };
    },
    async subscriptionPurchase(token) {
      const r = await call('GET', `/subscriptionsv2/tokens/${tok(token)}`);
      const items = Array.isArray(r.lineItems) ? r.lineItems : [];
      if (items.length !== 1) throw new V1Error(422, 'purchase-mismatch');
      const item = obj(items[0]), ids = obj(r.externalAccountIdentifiers);
      return {
        productId: str(item.productId) ?? '', basePlanId: str(obj(item.offerDetails).basePlanId), state: str(r.subscriptionState) ?? 'UNKNOWN',
        expiryTime: ms(item.expiryTime), acknowledged: r.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        obfuscatedAccountId: str(ids.obfuscatedExternalAccountId), latestOrderId: str(item.latestSuccessfulOrderId) ?? str(r.latestOrderId),
        linkedPurchaseToken: str(r.linkedPurchaseToken), test: r.testPurchase !== undefined,
      };
    },
    async acknowledgeProduct(productId, token) { await call('POST', `/products/${encodeURIComponent(productId)}/tokens/${tok(token)}:acknowledge`, {}); },
    async consumeProduct(productId, token) { await call('POST', `/products/${encodeURIComponent(productId)}/tokens/${tok(token)}:consume`); },
    async acknowledgeSubscription(productId, token) { await call('POST', `/subscriptions/${encodeURIComponent(productId)}/tokens/${tok(token)}:acknowledge`, {}); },
    async voided(startTimeMs) {
      const out: VoidedPurchase[] = [];
      let page: string | null = null;
      for (let i = 0; i < 5; i++) {
        const q = new URLSearchParams({ startTime: String(Math.floor(startTimeMs)), type: '1', maxResults: '1000', ...(page ? { token: page } : {}) });
        const r = await call('GET', `/voidedpurchases?${q}`);
        for (const v of Array.isArray(r.voidedPurchases) ? r.voidedPurchases : []) {
          const row = obj(v), token = str(row.purchaseToken);
          if (!token) continue;
          // kind 문자열: androidpublisher#productPurchase / #subscriptionPurchase
          const kind = typeof row.kind === 'string' && row.kind.includes('subscription') ? 'subscription' : typeof row.kind === 'string' && row.kind.includes('product') ? 'product' : 'unknown';
          out.push({ purchaseToken: token, orderId: str(row.orderId), voidedTimeMillis: Number(row.voidedTimeMillis) || 0, kind });
        }
        page = str(obj(r.tokenPagination).nextPageToken);
        if (!page) break;
      }
      return out;
    },
  };
}
