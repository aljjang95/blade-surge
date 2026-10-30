// 원스토어 IAP(v21 SDK) 서버 API v7 최소 클라이언트: 구매 상세조회·acknowledge·consume·구매취소내역.
// 자격 증명은 Secrets Store/Worker secret ONE_PUBLISHER(JSON: client_id·client_secret·api_client_id·package_name·environment)뿐이다.
// 키·토큰·제공자 오류 원문은 응답·로그에 싣지 않는다. 상용 호스트만 쓴다(검증 호스트 sbpp는 쓰지 않는다).
// https://onestore-dev.gitbook.io/dev/tools/billing/v21/serverapi
import { V1Error } from './db';
import { IAP_PACKAGE } from '../../src/shared/iap-catalog.js';

const BASE = 'https://iap-apis.onestore.net';
const TIMEOUT_MS = 6000;
export const ONE_MARKETS: readonly string[] = ['MKT_ONE', 'MKT_GLB'];

export interface OnePurchase {
  /** 0 구매완료 · 1 취소완료 */
  purchaseState: number; consumptionState: number; acknowledgeState: number;
  developerPayload: string | null; quantity: number; purchaseId: string | null;
}
export interface OneVoided { purchaseToken: string; purchaseId: string | null; marketCode: string }
export interface OneApi {
  purchase(productId: string, token: string, market: string): Promise<OnePurchase>;
  acknowledge(productId: string, token: string, market: string, payload: string): Promise<void>;
  consume(productId: string, token: string, market: string, payload: string): Promise<void>;
  voided(startTimeMs: number, market: string): Promise<OneVoided[]>;
}
export interface OneEnv {
  ONE_PUBLISHER?: string | { get(): Promise<string> };
  BLADESURGE_ONE_API_CLIENT_ID?: string;
  BLADESURGE_ONE_OAUTH_CLIENT_ID?: string;
}
type Fetch = (request: Request) => Promise<Response>;
type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 512 ? v : null);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x20\x7f]/.test(v);

/** 원스토어 서버 API를 쓸 설정이 갖춰졌는가(값은 읽지 않고 바인딩·공개 식별자 형식만 본다). */
export function oneConfigured(env: OneEnv): boolean {
  return !!env.ONE_PUBLISHER && ID.test(env.BLADESURGE_ONE_API_CLIENT_ID ?? '') && ID.test(env.BLADESURGE_ONE_OAUTH_CLIENT_ID ?? '');
}

async function credentials(env: OneEnv): Promise<{ clientId: string; secret: string }> {
  if (!oneConfigured(env)) throw new V1Error(503, 'one-credential-unavailable');
  const source = env.ONE_PUBLISHER;
  const raw = typeof source === 'string' ? source : source && typeof source.get === 'function' ? await source.get().catch(() => '') : '';
  let c: Obj;
  try { c = obj(JSON.parse(raw)); } catch { throw new V1Error(503, 'one-credential-invalid'); }
  if (c.client_id !== env.BLADESURGE_ONE_OAUTH_CLIENT_ID || c.api_client_id !== env.BLADESURGE_ONE_API_CLIENT_ID
    || c.package_name !== IAP_PACKAGE || c.environment !== 'production-v7' || !SAFE(c.client_secret)) throw new V1Error(503, 'one-credential-invalid');
  return { clientId: c.client_id as string, secret: c.client_secret as string };
}

async function withTimeout(fetcher: Fetch, request: Request): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetcher(new Request(request, { signal: controller.signal, redirect: 'error' })); }
  catch { throw new V1Error(503, 'one-unavailable'); }
  finally { clearTimeout(timer); }
}

let cachedToken: { value: string; until: number; clientId: string } | null = null;

async function accessToken(env: OneEnv, fetcher: Fetch, now: () => number): Promise<string> {
  const cred = await credentials(env);
  if (cachedToken && cachedToken.clientId === cred.clientId && cachedToken.until > now() + 60_000) return cachedToken.value;
  const response = await withTimeout(fetcher, new Request(`${BASE}/v7/oauth/token`, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cred.clientId, client_secret: cred.secret }).toString() }));
  if (!response.ok) throw new V1Error(503, 'one-credential-rejected');
  const body = obj(await response.json().catch(() => null));
  if (!SAFE(body.access_token) || typeof body.expires_in !== 'number' || body.expires_in <= 0) throw new V1Error(503, 'one-unavailable');
  cachedToken = { value: body.access_token, until: now() + body.expires_in * 1000, clientId: cred.clientId };
  return cachedToken.value;
}

/** 실제 원스토어 API. 테스트는 같은 인터페이스의 가짜를 deps.oneApi로 넣는다. */
export function createOneApi(env: OneEnv, fetcher: Fetch = (r) => fetch(r), now: () => number = () => Date.now()): OneApi {
  async function call(method: 'GET' | 'POST', path: string, market: string, body?: unknown): Promise<Obj> {
    if (!ONE_MARKETS.includes(market)) throw new V1Error(400, 'market-code');
    const token = await accessToken(env, fetcher, now);
    const response = await withTimeout(fetcher, new Request(`${BASE}/v7/apps/${encodeURIComponent(env.BLADESURGE_ONE_API_CLIENT_ID!)}${path}`, { method,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-market-code': market },
      body: body === undefined ? undefined : JSON.stringify(body) }));
    if (response.status === 400 || response.status === 404 || response.status === 410) throw new V1Error(422, 'purchase-not-found');
    if (response.status === 401 || response.status === 403) { cachedToken = null; throw new V1Error(503, 'one-credential-rejected'); }
    if (!response.ok) throw new V1Error(503, 'one-unavailable');
    const text = await response.text().catch(() => '');
    if (!text) return {};
    try { return obj(JSON.parse(text)); } catch { throw new V1Error(503, 'one-unavailable'); }
  }
  const p = (productId: string, token: string) => `${encodeURIComponent(productId)}/${encodeURIComponent(token)}`;
  const success = (r: Obj) => { if (obj(r.result).code !== 'Success') throw new V1Error(503, 'one-unavailable'); };
  const int = (v: unknown) => (Number.isSafeInteger(v) ? v as number : -1);
  return {
    async purchase(productId, token, market) {
      const r = await call('GET', `/purchases/inapp/products/${p(productId, token)}`, market);
      return { purchaseState: int(r.purchaseState), consumptionState: int(r.consumptionState), acknowledgeState: int(r.acknowledgeState),
        developerPayload: str(r.developerPayload), quantity: int(r.quantity), purchaseId: str(r.purchaseId) };
    },
    async acknowledge(productId, token, market, payload) {
      success(await call('POST', `/purchases/all/products/${p(productId, token)}/acknowledge`, market, { developerPayload: payload }));
    },
    async consume(productId, token, market, payload) {
      success(await call('POST', `/purchases/inapp/products/${p(productId, token)}/consume`, market, { developerPayload: payload }));
    },
    async voided(startTimeMs, market) {
      const out: OneVoided[] = [];
      let key: string | null = null;
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({ startTime: String(Math.floor(startTimeMs)), maxResults: '100', ...(key ? { continuationKey: key } : {}) });
        const r = await call('GET', `/voided-purchases?${q}`, market);
        // 문서 예시의 키 이름에 공백이 섞여 있어 공백을 걷어낸 키로 찾는다.
        const listKey = Object.keys(r).find((k) => k.trim() === 'voidedPurchaseList');
        for (const v of Array.isArray(listKey ? r[listKey] : null) ? r[listKey!] as unknown[] : []) {
          const row = obj(v), token = str(row.purchaseToken);
          if (token) out.push({ purchaseToken: token, purchaseId: str(row.purchaseId), marketCode: str(row.marketCode) ?? market });
        }
        key = str(r.continuationKey);
        if (!key) return out;
      }
      // 페이지 상한에 걸리면 남은 취소를 놓치지 않게 실패로 돌려 대사 커서를 멈춘다.
      throw new V1Error(503, 'one-voided-truncated');
    },
  };
}
