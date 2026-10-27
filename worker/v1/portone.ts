// 수익화 1단계 레인 B: 웹 결제(포트원 V2) — /api/v1/iap/web/{intent,complete}, 취소 회수 대사(크론).
// 원칙(docs/BM_DESIGN.md '영웅 해금'): ① 지급 근거는 포트원 단건 조회(GET /payments/{id}) 결과뿐 — 클라이언트가 결제창에 넘긴 금액·결과는 믿지 않는다
// (결제 금액은 브라우저가 정하므로 PAID여도 amount.total·통화·storeId·채널이 서버가 낸 의도와 같아야 지급한다)
// ② paymentId는 서버가 계정·상품·금액에 묶어 발급하고 남의 paymentId는 거부 ③ 지급은 기존 Play와 같은 grantOnce(원장 op_id = 'iap:<sha256(portone:paymentId)>')라
// 같은 paymentId를 몇 번, 동시에 보내도 한 번만 ④ 취소(CANCELLED·PARTIAL_CANCELLED)가 보이면 권한 철회·역분개 ⑤ 취소·환불 API는 호출하지 않는다(조회만).
import { V1Error, type D1Database } from './db';
import { fail, isId, onlyKeys } from './http';
import type { Authed, Ctx } from './auth';
import { randomHex } from './token';
import { recordServerMilestone } from './funnel';
import {
  WEB_SCHEMA_VERSION, activeEntitlementKeys, allKeysActive, grantOnce, grantsMonthly, ownedProducts, payoutHeld, reverseToken, stateFor, webTokenHash,
} from './iap';
import { IAP_BY_ID, IAP_PRODUCTS, entitlementEnds, entitlementKeys, sellableProduct, soldOn, type IapProduct } from '../../src/shared/iap-catalog.js';

const API_BASE = 'https://api.portone.io';
const TIMEOUT_MS = 6000;
const DAY = 86400000;
const PAYMENT_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** 취소 회수 대사 창: 카드 취소는 포트원 문서상 보통 1년까지 가능하므로 400일을 본다. */
const RECONCILE_WINDOW_MS = 400 * DAY;
/** 지급 후 이 기간 안의 건은 자주(6시간), 그 뒤는 드물게(7일) 다시 조회한다(checked_at 기준). */
const RECENT_GRANT_MS = 30 * DAY;
const RECENT_RECHECK_MS = 6 * 3600000;
const OLD_RECHECK_MS = 7 * DAY;
/** 크론 한 번에 포트원을 조회하는 최대 건수(호출 수 상한). */
export const WEB_RECONCILE_MAX = 25;
const INTENT_RECHECK_MS = 10 * 60000;
const INTENT_WINDOW_MS = 2 * DAY;
const OPEN_INTENT_CAP = 10;
/** 결제창이 열려 있다고 보는 시간. 이 안의 같은 1회성 상품 의도는 새 의도를 막는다. */
const OPEN_WINDOW_MS = 10 * 60000;
/** 월정액 권한을 주는 웹 상품 id(이용 중 중복 결제 판정용). */
const IAP_PRODUCTS_MONTHLY_IDS = IAP_PRODUCTS.filter((p) => grantsMonthly(p)).map((p) => p.id);

export interface PortoneEnv {
  /** 'true'일 때만 /iap/web/*가 열린다(기본 꺼짐). */
  WEB_BILLING_ENABLED?: string;
  PORTONE_STORE_ID?: string;
  /** 실결제 채널 키(비밀 아님). 비어 있으면 intent를 거부한다. */
  PORTONE_CHANNEL_KEY?: string;
  /** 테스트 채널 키. IAP_ALLOW_TEST가 'true'일 때만 쓴다. */
  PORTONE_TEST_CHANNEL_KEY?: string;
  IAP_ALLOW_TEST?: string;
  /** 테스트 채널을 쓸 수 있는 account_id 허용 목록(쉼표 구분, 기본 비어 있음). IAP_ALLOW_TEST=true여도 여기에 든 계정만 테스트 결제를 받는다. */
  IAP_TEST_ACCOUNTS?: string;
  /** 포트원 API 시크릿(Secrets Store 바인딩). 값은 어디에도 출력하지 않는다. */
  PORTONE_API_SECRET?: string | { get(): Promise<string> };
}

/** 포트원 결제 단건(필요한 필드만). status: READY | PENDING | VIRTUAL_ACCOUNT_ISSUED | PAY_PENDING | PAID | FAILED | PARTIAL_CANCELLED | CANCELLED */
export interface PortonePayment {
  status: string;
  storeId?: string | null;
  currency?: string | null;
  amount?: { total?: number; paid?: number; cancelled?: number } | null;
  channel?: { key?: string | null } | null;
  customData?: string | null;
}
export interface PortoneApi { getPayment(paymentId: string): Promise<PortonePayment | null> }
export interface PortoneDeps { portoneApi?: PortoneApi; portoneFetch?: (request: Request) => Promise<Response> }
type WebCtx = Ctx & { deps: Ctx['deps'] & PortoneDeps };
const penv = (c: Ctx) => c.env as unknown as PortoneEnv;

/** 테스트 모드가 켜져 있고 이 계정이 허용 목록에 있는가. 일반 게스트는 테스트 채널·테스트 지급을 받을 수 없다. */
export function testAllowed(env: PortoneEnv, accountId: string | null | undefined): boolean {
  if (env.IAP_ALLOW_TEST !== 'true' || !accountId) return false;
  return (env.IAP_TEST_ACCOUNTS ?? '').split(',').map((v) => v.trim()).filter(Boolean).includes(accountId);
}
/**
 * 이 계정에 줄 결제 채널. 실채널이 있으면 일반 계정은 실채널이고, 허용 테스터만 wantTest일 때 테스트 채널을 고른다.
 * 실채널이 없으면 허용 테스터만 테스트 채널을 받고 나머지는 null(intent 거부).
 */
export function webChannel(env: PortoneEnv, accountId?: string | null, wantTest = false): { key: string; test: boolean } | null {
  const tester = !!env.PORTONE_TEST_CHANNEL_KEY && testAllowed(env, accountId);
  if (env.PORTONE_CHANNEL_KEY && !(tester && wantTest)) return { key: env.PORTONE_CHANNEL_KEY, test: false };
  if (tester) return { key: env.PORTONE_TEST_CHANNEL_KEY as string, test: true };
  return null;
}
/** 클라이언트에 알리는 웹 결제 켜짐 표시(설정만 본다. 스키마·시크릿은 호출 시 503으로 닫힌다). 테스트 채널만 있는 환경은 허용 테스터 계정에게만 true. */
export function webBillingOn(env: PortoneEnv, accountId?: string | null): boolean {
  return env.WEB_BILLING_ENABLED === 'true' && !!env.PORTONE_STORE_ID && !!webChannel(env, accountId);
}

async function webSchemaReady(db: D1Database): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT version FROM v1_schema WHERE singleton = 1').first<{ version: number }>();
    return !!row && row.version >= WEB_SCHEMA_VERSION;
  } catch { return false; }
}
async function hasSecret(c: Ctx): Promise<boolean> {
  if ((c as WebCtx).deps.portoneApi) return true;
  const source = penv(c).PORTONE_API_SECRET;
  return typeof source === 'string' ? source.length > 0 : !!source && typeof source.get === 'function';
}
/** 웹 결제가 닫힌 이유(null = 열림). 설정·스키마·시크릿 순으로 fail-closed. */
export async function webReason(c: Ctx): Promise<string | null> {
  if (penv(c).WEB_BILLING_ENABLED !== 'true') return 'web-billing-disabled';
  if (!await webSchemaReady(c.db)) return 'web-schema-missing';
  if (!await hasSecret(c)) return 'credential-route-unavailable';
  return null;
}
/** 취소 회수 대사가 가능한가: 판매 스위치와 무관하게 스키마·시크릿만 있으면 돈다(판매를 멈춰도 환불은 반영). */
export async function webReconcileReason(c: Ctx): Promise<string | null> {
  if (!await webSchemaReady(c.db)) return 'web-schema-missing';
  if (!await hasSecret(c)) return 'credential-route-unavailable';
  return null;
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 포트원 단건 조회(읽기 전용). 시크릿·응답 원문·오류 원문은 로그·응답에 싣지 않는다. */
function portoneApi(c: Ctx): PortoneApi {
  const deps = (c as WebCtx).deps;
  if (deps.portoneApi) return deps.portoneApi;
  return {
    async getPayment(paymentId) {
      const source = penv(c).PORTONE_API_SECRET;
      const secret = typeof source === 'string' ? source : source && typeof source.get === 'function' ? await source.get().catch(() => '') : '';
      if (!secret) throw new V1Error(503, 'credential-route-unavailable');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        const request = new Request(`${API_BASE}/payments/${encodeURIComponent(paymentId)}`, { method: 'GET', headers: { Authorization: `PortOne ${secret}` }, signal: controller.signal });
        res = await (deps.portoneFetch ?? fetch)(request);
      } catch { throw new V1Error(502, 'portone-unavailable'); }
      finally { clearTimeout(timer); }
      if (res.status === 404) return null;
      if (!res.ok) throw new V1Error(502, 'portone-unavailable');
      let body: Record<string, unknown>;
      try { body = asObj(await res.json()); } catch { throw new V1Error(502, 'portone-unavailable'); }
      const amount = asObj(body.amount);
      return {
        status: text(body.status) ?? 'UNKNOWN', storeId: text(body.storeId), currency: text(body.currency),
        amount: { total: num(amount.total), paid: num(amount.paid), cancelled: num(amount.cancelled) },
        channel: { key: text(asObj(body.channel).key) }, customData: text(body.customData),
      };
    },
  };
}

interface WebRow {
  payment_id: string; account_id: string; product_id: string; amount_krw: number; store_id: string; channel_key: string;
  test: number; state: 'intent' | 'granted' | 'cancelled' | 'failed'; token_hash: string | null; created_at: number;
}
const ROW_COLUMNS = 'payment_id, account_id, product_id, amount_krw, store_id, channel_key, test, state, token_hash, created_at';

// ── 의도: 서버가 paymentId·금액을 정한다 ─────────────────────────
export async function webIntent(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['productId', 'test'], ['productId']);
  if (body.test !== undefined && typeof body.test !== 'boolean') fail(400, 'test');
  const reason = await webReason(c);
  if (reason) fail(503, reason);
  const env = penv(c);
  const channel = webChannel(env, auth.account.account_id, body.test === true);
  if (!env.PORTONE_STORE_ID || !channel) fail(503, 'web-not-configured');
  if (auth.account.status !== 'active' && auth.account.status !== 'muted') fail(403, 'account-inactive');
  // 서버가 roster를 강제하는 계정(authority=server)에만 현금 판매를 연다. 그림자·로컬은 저장 편집으로 소유를 늘릴 수 있다.
  if (auth.account.authority !== 'server') fail(403, 'server-authority-required');
  const product = isId(body.productId, 64) ? sellableProduct(body.productId) : null;
  // 웹은 즉시 지급형(B형)만: 영구 권한(non_consumable), 계정당 1회 패키지(once), 기간 이용권(periodDays). 자동 갱신 구독·반복 충전형은 거부.
  if (!product || !soldOn(product, 'web') || product.type === 'subscription' || product.type === 'consumable' && !product.once && !((product.periodDays ?? 0) > 0)) fail(400, 'unknown-product');
  const accountId = auth.account.account_id;
  if (await payoutHeld(c.db, accountId, c.now)) fail(403, 'payout-hold');
  // 계정당 1회·영구 상품을 이미 받았으면 결제 전에 거부한다(결제 뒤 지급 거절로 돈만 나가지 않게).
  if ((product.once || product.type === 'non_consumable') && (await ownedProducts(c.db, accountId)).has(product.id)) fail(409, 'not-eligible');
  // 영구 권한 상품은 이미 가진 권한이면 거부한다(영웅 개별 + 전원 해금의 중복 결제 방지).
  const activeKeys = await activeEntitlementKeys(c.db, accountId, c.now);
  if (allKeysActive(product, activeKeys)) fail(409, 'not-eligible');
  // 월정액 이용 중(Play 구독 또는 웹 30일권)에는 웹 30일권을 또 팔지 않는다.
  if (grantsMonthly(product) && activeKeys.has('monthly')) fail(409, 'already-subscribed');
  // 한 번만 받을 수 있는 상품(계정당 1회·영구·월정액)은 결제창이 열려 있을 시간(10분) 안의 같은 계열 의도가 있으면 새 의도를 막는다.
  // 두 창을 동시에 결제해 하나는 지급 거절(돈만 나감)·하나는 이중 지급이 되는 것을 줄인다. 그보다 오래된 의도는 취소된 창으로 보고 막지 않는다(뒤늦게 PAID면 settle이 감사 플래그를 남긴다).
  if (product.once || product.type === 'non_consumable' || grantsMonthly(product)) {
    const same = grantsMonthly(product) ? IAP_PRODUCTS_MONTHLY_IDS : [product.id];
    const recent = await c.db.prepare(`SELECT COUNT(*) AS n FROM iap_web_payments WHERE account_id = ? AND state = 'intent' AND created_at > ? AND product_id IN (${same.map(() => '?').join(',')})`)
      .bind(accountId, c.now - OPEN_WINDOW_MS, ...same).first<{ n: number }>();
    if ((recent?.n ?? 0) > 0) fail(409, 'payment-in-progress');
  }
  const open = await c.db.prepare("SELECT COUNT(*) AS n FROM iap_web_payments WHERE account_id = ? AND state = 'intent' AND created_at > ?").bind(accountId, c.now - 3600000).first<{ n: number }>();
  if ((open?.n ?? 0) >= OPEN_INTENT_CAP) fail(429, 'too-many-intents');
  const paymentId = 'bsw_' + randomHex(16);
  await c.db.prepare(`INSERT INTO iap_web_payments(payment_id, account_id, product_id, amount_krw, store_id, channel_key, test, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'intent', ?, ?)`).bind(paymentId, accountId, product.id, product.priceKRW, env.PORTONE_STORE_ID, channel.key, channel.test ? 1 : 0, c.now, c.now).run();
  await recordServerMilestone(c.db, accountId, 'purchase_start', c.now);
  return {
    paymentId, productId: product.id, storeId: env.PORTONE_STORE_ID, channelKey: channel.key, orderName: product.title,
    totalAmount: product.priceKRW, currency: 'KRW', payMethod: 'CARD', customData: JSON.stringify({ productId: product.id }), test: channel.test, serverTime: c.now,
  };
}

// ── 완료: 포트원 조회 → 검증 → 멱등 지급 ──────────────────────────
type Settled = { state: 'granted' | 'already' | 'pending' | 'cancelled' | 'failed'; productId: string; paymentId: string; granted: string[] };

async function audit(c: Ctx, accountId: string, kind: string, detail: unknown) {
  await c.db.prepare('INSERT INTO audit_flags(account_id, run_id, kind, severity, detail, at) VALUES (?, NULL, ?, 2, ?, ?)')
    .bind(accountId, kind, JSON.stringify(detail).slice(0, 1000), c.now).run().catch(() => {});
}

/** 결제 조회 결과를 원장에 반영한다(complete·크론 공용). 검증 실패는 지급 없이 V1Error. */
export async function settleWebPayment(c: Ctx, row: WebRow, payment: PortonePayment | null): Promise<Settled> {
  const product: IapProduct | undefined = Object.hasOwn(IAP_BY_ID, row.product_id) ? IAP_BY_ID[row.product_id] : undefined;
  if (!product) fail(500, 'catalog-invalid');
  const base = { productId: product.id, paymentId: row.payment_id };
  const hash = row.token_hash ?? await webTokenHash(row.payment_id);
  if (!payment) return { ...base, state: 'pending', granted: [] };
  const status = payment.status;
  if (status === 'CANCELLED' || status === 'PARTIAL_CANCELLED') {
    // 환불 차단 기록을 먼저 남긴다: 취소 전에 PAID를 본 다른 요청의 grantOnce는 같은 배치의 원자 가드(iap_refund_guard)에 막힌다(Play 경로와 같은 방식).
    // 그 뒤 지급된 적이 있으면 권한 철회 + 지급 역분개(이미 취소 처리된 건은 reverseToken이 지급 0건이라 무해하다).
    await c.db.prepare("INSERT INTO iap_purchases(token_hash, account_id, product_id, kind, state, test, created_at, updated_at) VALUES (?, ?, ?, ?, 'refunded', ?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET state = 'refunded', updated_at = excluded.updated_at WHERE iap_purchases.account_id = excluded.account_id")
      .bind(hash, row.account_id, product.id, product.type, row.test, c.now, c.now).run();
    await reverseToken(c, row.account_id, hash, 'portone-cancelled');
    await c.db.prepare("UPDATE iap_web_payments SET state = 'cancelled', updated_at = ?, checked_at = ?, cancelled_at = COALESCE(cancelled_at, ?), token_hash = ? WHERE payment_id = ?")
      .bind(c.now, c.now, c.now, hash, row.payment_id).run();
    return { ...base, state: 'cancelled', granted: [] };
  }
  if (row.state === 'cancelled') return { ...base, state: 'cancelled', granted: [] };
  if (status === 'FAILED') {
    await c.db.prepare("UPDATE iap_web_payments SET state = 'failed', updated_at = ?, checked_at = ? WHERE payment_id = ? AND state = 'intent'").bind(c.now, c.now, row.payment_id).run();
    return { ...base, state: 'failed', granted: [] };
  }
  if (status !== 'PAID') {
    await c.db.prepare("UPDATE iap_web_payments SET checked_at = ? WHERE payment_id = ?").bind(c.now, row.payment_id).run();
    return { ...base, state: 'pending', granted: [] };
  }
  // 테스트 결제(test=1)는 지금 테스트 모드가 켜져 있고 그 계정이 허용 목록에 있을 때만 지급한다(모드를 끄거나 목록에서 빼면 거부, 이미 지급된 권한은 그대로).
  if (row.test === 1 && !testAllowed(penv(c), row.account_id)) fail(422, 'test-purchase-not-allowed');
  // PAID: 서버가 낸 의도와 한 글자도 다르면 지급하지 않는다. 돈은 나갔으므로 감사 플래그를 남겨 사람이 취소하게 한다.
  const bad = mismatchCode(payment, row, product);
  if (bad) {
    await audit(c, row.account_id, 'web-payment-mismatch', { code: bad, paymentId: row.payment_id, productId: product.id });
    await c.db.prepare("UPDATE iap_web_payments SET state = 'failed', updated_at = ?, checked_at = ? WHERE payment_id = ? AND state = 'intent'").bind(c.now, c.now, row.payment_id).run();
    fail(422, bad);
  }
  const test = row.test === 1;
  const before = await activeEntitlementKeys(c.db, row.account_id, c.now);
  // 이미 가진 권한을 또 결제했는가: 영구 권한 전부 보유, 또는 월정액 이용 중 월정액 계열 결제.
  const duplicate = allKeysActive(product, before) || (grantsMonthly(product) && before.has('monthly'));
  const grantId = 'iap:' + hash;
  const result = await grantOnce(c, row.account_id, product, hash, grantId, product.grant.rewards ?? {}, {
    purchase: { state: 'granted', test, priceKRW: row.amount_krw },
    // 기간 이용권(30일권)은 지급(settle) 시각부터 센다. 리다이렉트·대사로 늦게 확정돼도 이용자가 덜 받지 않는다.
    entitlements: entitlementKeys(product).map((key) => ({ key, expiresAt: entitlementEnds(product, c.now) })),
  });
  if (result === 'declined') {
    // 계정당 1회 상품을 이미 받은 뒤의 결제(동시 의도 두 건 결제 등): 돈은 나갔고 지급은 하지 않으므로 사람이 취소하도록 표시하고 행을 닫는다.
    await audit(c, row.account_id, 'web-once-declined', { paymentId: row.payment_id, productId: product.id });
    await c.db.prepare("UPDATE iap_web_payments SET state = 'failed', token_hash = ?, updated_at = ?, checked_at = ? WHERE payment_id = ? AND state = 'intent'")
      .bind(hash, c.now, c.now, row.payment_id).run();
    return { ...base, state: 'cancelled', granted: [] };
  }
  if (result === 'refunded') return { ...base, state: 'cancelled', granted: [] };
  await c.db.prepare("UPDATE iap_web_payments SET state = 'granted', token_hash = ?, granted_at = COALESCE(granted_at, ?), updated_at = ?, checked_at = ? WHERE payment_id = ? AND state IN ('intent','granted')")
    .bind(hash, c.now, c.now, c.now, row.payment_id).run();
  // 이미 가진 권한을 또 결제한 경우(동시 의도 두 건 결제): 지급·환불 회수는 정상 동작하지만 중복 결제이므로 사람이 취소하도록 표시한다.
  if (result === 'granted' && duplicate) await audit(c, row.account_id, 'web-duplicate-payment', { paymentId: row.payment_id, productId: product.id });
  return { ...base, state: result === 'granted' ? 'granted' : 'already', granted: result === 'granted' ? [grantId] : [] };
}
/** PAID 결제가 서버 의도와 다른 점(없으면 null). 금액은 브라우저가 정하므로 이 검사가 지급의 핵심이다. */
function mismatchCode(payment: PortonePayment, row: WebRow, product: IapProduct): string | null {
  const cancelled = payment.amount?.cancelled;
  // 기준은 발급 당시 저장한 금액이다(그 뒤 카탈로그 가격이 바뀌어도 이미 발급된 의도의 정상 결제는 지급한다).
  if (payment.amount?.total !== row.amount_krw || (typeof cancelled === 'number' && cancelled > 0)) return 'amount-mismatch';
  if (payment.currency !== 'KRW') return 'currency-mismatch';
  if (payment.storeId !== row.store_id) return 'store-mismatch';
  if (payment.channel?.key && payment.channel.key !== row.channel_key) return 'channel-mismatch';
  if (typeof payment.customData === 'string' && payment.customData.length) {
    let custom: Record<string, unknown> = {};
    try { custom = asObj(JSON.parse(payment.customData)); } catch { custom = {}; }
    if (custom.productId !== product.id) return 'custom-data-mismatch';
  }
  return null;
}

export async function webComplete(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['paymentId']);
  const reason = await webReason(c);
  if (reason) fail(503, reason);
  if (typeof body.paymentId !== 'string' || !PAYMENT_ID.test(body.paymentId)) fail(400, 'payment-id');
  const accountId = auth.account.account_id;
  const row = await c.db.prepare(`SELECT ${ROW_COLUMNS} FROM iap_web_payments WHERE payment_id = ?`).bind(body.paymentId).first<WebRow>();
  // 남의 paymentId·서버가 발급하지 않은 paymentId는 같은 응답으로 숨긴다.
  if (!row || row.account_id !== accountId) fail(404, 'payment-unknown');
  const payment = await portoneApi(c).getPayment(row.payment_id);
  if (!payment) fail(404, 'payment-not-found');
  const settled = await settleWebPayment(c, row, payment);
  return { ...settled, ...(await stateFor(c, accountId)) };
}

/**
 * 시간당 대사: ① 지급된 최근 400일 웹 결제를 다시 조회해 취소된 건을 회수(지급 30일 이내는 6시간, 그 이후는 7일 간격, checked_at 기준) ② 결제창에서 결제됐지만 complete가 오지 않은(탭 종료·모바일 리다이렉트 실패)
 * 최근 48시간의 의도를 조회해 PAID면 지급. 한 번에 포트원을 WEB_RECONCILE_MAX건까지만 조회하고, 가장 오래 안 본 건부터 돈다. 항목별로 실패를 격리한다.
 */
export async function reconcileWebPayments(c: Ctx): Promise<{ checked: number; granted: number; reversed: number; failed: number }> {
  const out = { checked: 0, granted: 0, reversed: 0, failed: 0 };
  if (await webReconcileReason(c)) return out;
  const rows = await c.db.prepare(`SELECT ${ROW_COLUMNS} FROM iap_web_payments
    WHERE (state = 'granted' AND granted_at > ? AND COALESCE(checked_at, 0) < CASE WHEN granted_at > ? THEN ? ELSE ? END) OR (state = 'intent' AND created_at > ? AND created_at < ? AND COALESCE(checked_at, 0) < ?)
    ORDER BY COALESCE(checked_at, 0) ASC LIMIT ?`)
    .bind(c.now - RECONCILE_WINDOW_MS, c.now - RECENT_GRANT_MS, c.now - RECENT_RECHECK_MS, c.now - OLD_RECHECK_MS, c.now - INTENT_WINDOW_MS, c.now - 120000, c.now - INTENT_RECHECK_MS, WEB_RECONCILE_MAX).all<WebRow>();
  const api = portoneApi(c);
  for (const row of rows.results ?? []) {
    out.checked++;
    try {
      const payment = await api.getPayment(row.payment_id);
      if (!payment) { await c.db.prepare('UPDATE iap_web_payments SET checked_at = ? WHERE payment_id = ?').bind(c.now, row.payment_id).run(); continue; }
      const r = await settleWebPayment(c, row, payment);
      if (r.state === 'granted') out.granted++;
      if (r.state === 'cancelled' && row.state !== 'cancelled') out.reversed++;
    } catch (error) {
      out.failed++;
      // 실패한 항목도 순서를 뒤로 보낸다(계속 실패하는 한 건이 매 시간 앞자리를 차지해 나머지를 굶기지 않게).
      await c.db.prepare('UPDATE iap_web_payments SET checked_at = ? WHERE payment_id = ?').bind(c.now, row.payment_id).run().catch(() => {});
      console.warn('web payment reconcile item failed', error instanceof V1Error ? error.code : error instanceof Error ? error.name : 'unknown');
    }
  }
  return out;
}
