// BM D10a/b: /api/v1/iap/* — Google Play 결제 서버 검증 → v1 원장 멱등 지급 → acknowledge/consume, 환불·RTDN 역분개.
// 원칙(docs/BM_DESIGN.md 5장): ① 지급 근거는 Play Developer API 서버 조회 결과뿐(클라이언트 결과·RTDN 본문은 계기일 뿐)
// ② 구매의 obfuscatedAccountId가 요청 계정에 발급한 값과 같아야 한다(남의 영수증 재사용 차단) ③ 지급은 wallet_ledger op_id
// 'iap:<token_hash>[:<order_hash>]' 한 줄과 같은 D1 배치(casCommit)로 원자·멱등 ④ DB 지급 뒤 Play ack/consume(실패해도 토큰이
// 기기에 남아 다음 verify가 재시도) ⑤ 토큰 원문은 저장하지 않는다.
import { casCommit, REV_GUARD, V1Error, type D1Database, type GuardedWrite } from './db';
import { fail, isId, onlyKeys } from './http';
import type { Authed, Ctx } from './auth';
import { loadAccountDoc } from './cmd';
import { docOf, loadEconomy } from './state';
import { randomHex, sha256Hex } from './token';
import { createPlayApi, type PlayApi, type PlayEnv } from './play';
import { recordServerMilestone } from './funnel';
import {
  IAP_BY_ID, IAP_CATALOG_VERSION, IAP_PRODUCTS, IAP_REWARD_FIELD, IAP_REWARD_KEYS, entitlementEnds, sellableProduct, summarizeEntitlements,
  type IapProduct,
} from '../../src/shared/iap-catalog.js';

export const IAP_SCHEMA_VERSION = 3;
const TOKEN = /^[A-Za-z0-9._:-]{10,4096}$/;
const DAY = 86400000;
const ABUSE_WINDOW = 90 * DAY;
const HOLD_MS = 30 * DAY;

export interface IapEnv extends PlayEnv {
  IAP_ENABLED?: string;
  /** 라이선스 테스터 구매(testPurchaseContext) 허용. 내부 테스트 트랙에서만 'true'. */
  IAP_ALLOW_TEST?: string;
  RTDN_AUDIENCE?: string;
  RTDN_PUSH_SUBJECT?: string;
}
export interface IapDeps { playApi?: PlayApi }
type IapCtx = Ctx & { deps: Ctx['deps'] & IapDeps };

const iapEnv = (c: Ctx) => c.env as unknown as IapEnv;
export const tokenHash = (token: string) => sha256Hex('play:' + token);

export async function iapSchemaReady(db: D1Database): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT version FROM v1_schema WHERE singleton = 1').first<{ version: number }>();
    return !!row && row.version >= IAP_SCHEMA_VERSION;
  } catch { return false; }
}

/** 결제 기능이 닫힌 이유(null = 열림). 설정·스키마·자격 증명 바인딩 순으로 fail-closed. */
export async function billingReason(c: Ctx): Promise<string | null> {
  const env = iapEnv(c);
  if (env.IAP_ENABLED !== 'true') return 'billing-disabled';
  if (!await iapSchemaReady(c.db)) return 'iap-schema-missing';
  if (!env.PLAY_SA_JSON && !(c as IapCtx).deps.playApi) return 'credential-route-unavailable';
  return null;
}
function play(c: Ctx): PlayApi {
  const deps = (c as IapCtx).deps;
  return deps.playApi ?? createPlayApi(iapEnv(c), undefined, () => c.now);
}

// ── 권한 요약 ─────────────────────────────────────────────
interface EntRow { ent_key: string; expires_at: number | null; revoked_at: number | null }
export async function entitlementsOf(db: D1Database, accountId: string, now: number) {
  const rows = await db.prepare('SELECT ent_key, expires_at, revoked_at FROM iap_entitlements WHERE account_id = ?').bind(accountId).all<EntRow>();
  return summarizeEntitlements((rows.results ?? []).map((r) => ({ key: r.ent_key, expiresAt: r.expires_at, revokedAt: r.revoked_at })), now);
}

/** 서버 문서 위에 서버 권한을 덮어쓴다(그림자 스냅샷 정화가 결제 필드를 지우므로 명령 실행 직전에 다시 얹는다). */
export async function overlayEntitlements(db: D1Database, accountId: string, state: Record<string, any>, now: number): Promise<void> {
  if (!await iapSchemaReady(db)) return;
  const e = await entitlementsOf(db, accountId, now);
  state.monthlyUntil = Math.max(0, e.monthlyUntil);
  if (state.pass && typeof state.pass === 'object') state.pass.premium = e.passPremium;
}

/** 정화 상한 가산분: 이 계정에 서버가 지급(역분개 제외)한 유료 보상 합. 결제한 재화가 그림자 스냅샷에서 깎이지 않게 한다. */
export async function iapAllowance(db: D1Database, accountId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!await iapSchemaReady(db)) return out;
  const rows = await db.prepare('SELECT rewards FROM iap_grants WHERE account_id = ? AND reversed_at IS NULL').bind(accountId).all<{ rewards: string }>();
  for (const row of rows.results ?? []) {
    let r: Record<string, number> = {};
    try { r = JSON.parse(row.rewards); } catch { continue; }
    for (const key of IAP_REWARD_KEYS) if (Number.isSafeInteger(r[key]) && r[key] > 0) out[IAP_REWARD_FIELD[key]] = (out[IAP_REWARD_FIELD[key]] || 0) + r[key];
  }
  return out;
}

// ── 공개 API ─────────────────────────────────────────────
export async function catalog(c: Ctx, auth: Authed) {
  const reason = await billingReason(c);
  const owned = reason ? new Set<string>() : await ownedProducts(c.db, auth.account.account_id);
  return {
    version: IAP_CATALOG_VERSION, billing: !reason, ...(reason ? { reason } : {}),
    products: IAP_PRODUCTS.filter((p) => p.enabled).map((p) => ({
      id: p.id, type: p.type, playType: p.type === 'subscription' ? 'subs' : 'inapp', basePlanId: p.basePlanId ?? null,
      priceKRW: p.priceKRW, title: p.title, description: p.description, shopSku: p.shopSku, once: !!p.once,
      eligible: !reason && !(p.once && owned.has(p.id)) && !(p.type === 'non_consumable' && owned.has(p.id)),
    })),
    serverTime: c.now,
  };
}

async function ownedProducts(db: D1Database, accountId: string): Promise<Set<string>> {
  const rows = await db.prepare("SELECT DISTINCT product_id FROM iap_grants WHERE account_id = ? AND reversed_at IS NULL").bind(accountId).all<{ product_id: string }>();
  return new Set((rows.results ?? []).map((r) => r.product_id));
}

async function obfuscatedId(db: D1Database, accountId: string, now: number, create: boolean): Promise<string | null> {
  const row = await db.prepare('SELECT obf_id FROM iap_obf WHERE account_id = ?').bind(accountId).first<{ obf_id: string }>();
  if (row || !create) return row?.obf_id ?? null;
  // 계정 id와 연결 고리가 없는 난수. Play에는 이 값만 간다.
  await db.prepare('INSERT OR IGNORE INTO iap_obf(obf_id, account_id, created_at) VALUES (?, ?, ?)').bind(randomHex(24), accountId, now).run();
  return (await db.prepare('SELECT obf_id FROM iap_obf WHERE account_id = ?').bind(accountId).first<{ obf_id: string }>())?.obf_id ?? null;
}

/** 결제 시작 전: 상품·자격 확인 후 Play 결제에 실을 obfuscatedAccountId를 준다. 이 값 없이 산 구매는 지급하지 않는다. */
export async function intent(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['productId']);
  const reason = await billingReason(c);
  if (reason) fail(503, reason);
  if (auth.account.status !== 'active' && auth.account.status !== 'muted') fail(403, 'account-inactive');
  const product = isId(body.productId, 64) ? sellableProduct(body.productId) : null;
  if (!product) fail(400, 'unknown-product');
  const accountId = auth.account.account_id;
  if (await payoutHeld(c.db, accountId, c.now)) fail(403, 'payout-hold');
  const owned = await ownedProducts(c.db, accountId);
  if ((product.once || product.type === 'non_consumable') && owned.has(product.id)) fail(409, 'not-eligible');
  if (product.type === 'subscription') {
    const e = await entitlementsOf(c.db, accountId, c.now);
    if (e.monthlyUntil > c.now) fail(409, 'already-subscribed');
  }
  const obf = await obfuscatedId(c.db, accountId, c.now, true);
  if (!obf) fail(503, 'unavailable');
  await recordServerMilestone(c.db, accountId, 'purchase_start', c.now);
  return { productId: product.id, type: product.type, playType: product.type === 'subscription' ? 'subs' : 'inapp',
    basePlanId: product.basePlanId ?? null, obfuscatedAccountId: obf, serverTime: c.now };
}

export async function verify(c: Ctx, auth: Authed, body: Record<string, unknown>) {
  onlyKeys(body, ['productId', 'purchaseToken']);
  const reason = await billingReason(c);
  if (reason) fail(503, reason);
  const product = isId(body.productId, 64) ? sellableProduct(body.productId) : null;
  if (!product) fail(400, 'unknown-product');
  if (typeof body.purchaseToken !== 'string' || !TOKEN.test(body.purchaseToken)) fail(400, 'purchase-token');
  const result = await processPurchase(c, product, body.purchaseToken, { accountId: auth.account.account_id });
  return { ...result, ...(await stateFor(c, auth.account.account_id)) };
}

/** 계정의 최근 지급·역분개와 권한. 클라이언트는 아직 적용하지 않은 grant/reversal만 로컬에 반영한다. */
export async function state(c: Ctx, auth: Authed) {
  if (!await iapSchemaReady(c.db)) fail(503, 'iap-schema-missing');
  return stateFor(c, auth.account.account_id);
}
async function stateFor(c: Ctx, accountId: string) {
  const rows = await c.db.prepare('SELECT grant_id, product_id, rewards, granted_at, reversed_at, debt FROM iap_grants WHERE account_id = ? ORDER BY granted_at DESC LIMIT 50')
    .bind(accountId).all<{ grant_id: string; product_id: string; rewards: string; granted_at: number; reversed_at: number | null; debt: string | null }>();
  const grants = [], reversals = [];
  for (const r of rows.results ?? []) {
    const rewards = JSON.parse(r.rewards) as Record<string, number>;
    grants.push({ opId: r.grant_id, productId: r.product_id, rewards, at: r.granted_at });
    if (r.reversed_at) reversals.push({ opId: 'void:' + r.grant_id, grantId: r.grant_id, rewards, at: r.reversed_at });
  }
  return { grants, reversals, entitlements: await entitlementsOf(c.db, accountId, c.now), serverTime: c.now };
}

// ── 구매 처리(검증·RTDN·대사 공용) ─────────────────────────
interface PurchaseRow { account_id: string; product_id: string; state: string; acked: number; consumed: number; expires_at: number | null }
type Outcome = { state: 'granted' | 'pending' | 'refunded' | 'expired' | 'already'; productId: string; granted: string[]; acked: boolean; test: boolean };

async function accountByObf(db: D1Database, obf: string | null): Promise<string | null> {
  if (!obf) return null;
  return (await db.prepare('SELECT account_id FROM iap_obf WHERE obf_id = ?').bind(obf).first<{ account_id: string }>())?.account_id ?? null;
}

/**
 * Play에서 토큰의 실제 상태를 읽어 원장에 반영한다. who.accountId가 있으면 그 계정이 산 것이어야 하고(검증 요청),
 * 없으면 obfuscatedAccountId로 계정을 찾는다(RTDN). 계정을 찾지 못하면 아무것도 지급하지 않는다.
 */
export async function processPurchase(c: Ctx, product: IapProduct, token: string, who: { accountId?: string }): Promise<Outcome> {
  const hash = await tokenHash(token);
  const prior = await c.db.prepare('SELECT account_id, product_id, state, acked, consumed, expires_at FROM iap_purchases WHERE token_hash = ?').bind(hash).first<PurchaseRow>();
  if (prior && who.accountId && prior.account_id !== who.accountId) fail(409, 'purchase-owned-by-another-account');
  if (prior && prior.product_id !== product.id) fail(409, 'purchase-mismatch');
  const api = play(c), env = iapEnv(c);
  if (product.type === 'subscription') return processSubscription(c, api, env, product, token, hash, prior, who);
  const p = await api.productPurchase(token);
  if (p.productId !== product.id || p.quantity !== 1) fail(422, 'purchase-mismatch');
  const accountId = await bindAccount(c, p.obfuscatedAccountId, prior, who);
  if (p.test && env.IAP_ALLOW_TEST !== 'true') fail(422, 'test-purchase-not-allowed');
  if (p.purchaseState === 'CANCELLED' || p.refundableQuantity === 0) {
    await upsertPurchase(c, hash, accountId, product, 'refunded', { test: p.test });
    await reverseToken(c, accountId, hash, 'cancelled');
    return { state: 'refunded', productId: product.id, granted: [], acked: false, test: p.test };
  }
  if (p.purchaseState === 'PENDING') {
    await upsertPurchase(c, hash, accountId, product, 'pending', { test: p.test });
    return { state: 'pending', productId: product.id, granted: [], acked: false, test: p.test };
  }
  if (p.purchaseState !== 'PURCHASED') fail(422, 'purchase-unverified');
  if (prior?.state === 'refunded') return { state: 'refunded', productId: product.id, granted: [], acked: false, test: p.test };
  const grantId = 'iap:' + hash;
  const granted = await grantOnce(c, accountId, product, hash, grantId, product.grant.rewards ?? {}, {
    purchase: { state: 'granted', test: p.test },
    entitlement: product.grant.entitlement ? { key: product.grant.entitlement.key, expiresAt: entitlementEnds(product, c.now) } : null,
  });
  // DB 지급이 확정된 뒤에만 Play에 소유를 확정한다. 실패하면 acked=false로 응답하고 다음 verify/RTDN이 재시도한다.
  let acked = product.type === 'consumable' ? p.consumed : p.acknowledged;
  if (!acked) {
    try {
      if (product.type === 'consumable') await api.consumeProduct(product.id, token);
      else await api.acknowledgeProduct(product.id, token);
      acked = true;
    } catch (error) { if (!(error instanceof V1Error)) throw error; }
  }
  if (acked) await c.db.prepare(`UPDATE iap_purchases SET acked = 1, consumed = ?, updated_at = ? WHERE token_hash = ?`)
    .bind(product.type === 'consumable' ? 1 : 0, c.now, hash).run();
  return { state: granted ? 'granted' : 'already', productId: product.id, granted: granted ? [grantId] : [], acked, test: p.test };
}

async function processSubscription(c: Ctx, api: PlayApi, env: IapEnv, product: IapProduct, token: string, hash: string, prior: PurchaseRow | null, who: { accountId?: string }): Promise<Outcome> {
  const s = await api.subscriptionPurchase(token);
  if (s.productId !== product.id || (product.basePlanId && s.basePlanId && s.basePlanId !== product.basePlanId)) fail(422, 'purchase-mismatch');
  const accountId = await bindAccount(c, s.obfuscatedAccountId, prior, who);
  if (s.test && env.IAP_ALLOW_TEST !== 'true') fail(422, 'test-purchase-not-allowed');
  if (s.state === 'SUBSCRIPTION_STATE_PENDING') {
    await upsertPurchase(c, hash, accountId, product, 'pending', { test: s.test });
    return { state: 'pending', productId: product.id, granted: [], acked: false, test: s.test };
  }
  const live = s.state === 'SUBSCRIPTION_STATE_ACTIVE' || s.state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' || s.state === 'SUBSCRIPTION_STATE_CANCELED';
  const expiry = s.expiryTime ?? c.now;
  // 업그레이드·재구독으로 이어진 이전 토큰의 권한은 새 토큰이 대신한다.
  if (s.linkedPurchaseToken) {
    const linked = await tokenHash(s.linkedPurchaseToken);
    await c.db.prepare('UPDATE iap_entitlements SET expires_at = MIN(COALESCE(expires_at, ?), ?) WHERE account_id = ? AND token_hash = ? AND revoked_at IS NULL')
      .bind(c.now, c.now, accountId, linked).run();
  }
  if (!live || expiry <= c.now) {
    await upsertPurchase(c, hash, accountId, product, prior?.state === 'refunded' ? 'refunded' : 'expired', { test: s.test, expiresAt: expiry });
    await c.db.prepare('UPDATE iap_entitlements SET expires_at = ? WHERE account_id = ? AND token_hash = ? AND revoked_at IS NULL').bind(Math.min(expiry, c.now), accountId, hash).run();
    return { state: 'expired', productId: product.id, granted: [], acked: s.acknowledged, test: s.test };
  }
  if (prior?.state === 'refunded') return { state: 'refunded', productId: product.id, granted: [], acked: s.acknowledged, test: s.test };
  // 결제 주기(성공 주문)마다 한 번 지급한다. 유예 기간 중에는 새 성공 주문이 없으므로 권한만 이어진다.
  const order = s.latestOrderId ?? 'initial';
  const grantId = `iap:${hash}:${(await sha256Hex('order:' + order)).slice(0, 24)}`;
  const granted = await grantOnce(c, accountId, product, hash, grantId, product.grant.perPeriod ?? {}, {
    purchase: { state: 'granted', test: s.test, expiresAt: expiry, orderHash: await sha256Hex('order:' + order) },
    entitlement: { key: product.grant.entitlement?.key ?? 'monthly', expiresAt: expiry },
  });
  if (!granted) {
    // 같은 주기의 재조회: 만료 시각만 갱신한다(해지 예약·유예 연장).
    await c.db.prepare('UPDATE iap_entitlements SET expires_at = ? WHERE account_id = ? AND token_hash = ? AND revoked_at IS NULL').bind(expiry, accountId, hash).run();
    await c.db.prepare('UPDATE iap_purchases SET expires_at = ?, updated_at = ? WHERE token_hash = ?').bind(expiry, c.now, hash).run();
  }
  let acked = s.acknowledged;
  if (!acked) {
    try { await api.acknowledgeSubscription(product.id, token); acked = true; }
    catch (error) { if (!(error instanceof V1Error)) throw error; }
  }
  if (acked) await c.db.prepare('UPDATE iap_purchases SET acked = 1, updated_at = ? WHERE token_hash = ?').bind(c.now, hash).run();
  return { state: granted ? 'granted' : 'already', productId: product.id, granted: granted ? [grantId] : [], acked, test: s.test };
}

/** 구매를 계정에 결박한다. obfuscatedAccountId가 요청 계정의 발급값과 다르면 거부(남의 영수증·변조 차단). */
async function bindAccount(c: Ctx, obf: string | null, prior: PurchaseRow | null, who: { accountId?: string }): Promise<string> {
  const owner = await accountByObf(c.db, obf);
  if (!owner) fail(409, 'purchase-account-unknown');
  if (who.accountId && owner !== who.accountId) fail(409, 'purchase-account-mismatch');
  if (prior && prior.account_id !== owner) fail(409, 'purchase-owned-by-another-account');
  return owner;
}

async function upsertPurchase(c: Ctx, hash: string, accountId: string, product: IapProduct, stateName: string, o: { test: boolean; expiresAt?: number }) {
  await c.db.prepare(`INSERT INTO iap_purchases(token_hash, account_id, product_id, kind, state, expires_at, test, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_hash) DO UPDATE SET state = CASE WHEN iap_purchases.state = 'refunded' THEN 'refunded' ELSE excluded.state END,
      expires_at = COALESCE(excluded.expires_at, iap_purchases.expires_at), updated_at = excluded.updated_at
    WHERE iap_purchases.account_id = excluded.account_id`)
    .bind(hash, accountId, product.id, product.type, stateName, o.expiresAt ?? null, o.test ? 1 : 0, c.now, c.now).run();
}

/**
 * 지급 1회: 서버 문서에 보상을 더하고 원장·지급·구매·권한·퍼널을 한 배치로 쓴다. 이미 같은 grant_id가 있으면 false.
 * 문서 경합(다른 명령과 동시)은 최대 3회 다시 읽어 재시도한다.
 */
async function grantOnce(c: Ctx, accountId: string, product: IapProduct, hash: string, grantId: string, rewards: Record<string, number>,
  o: { purchase: { state: string; test: boolean; expiresAt?: number; orderHash?: string }; entitlement: { key: string; expiresAt: number | null } | null }): Promise<boolean> {
  for (const [key, value] of Object.entries(rewards)) if (!IAP_REWARD_KEYS.includes(key) || !Number.isSafeInteger(value) || value <= 0) fail(500, 'catalog-invalid');
  for (let attempt = 0; attempt < 3; attempt++) {
    const exists = await c.db.prepare('SELECT 1 AS x FROM iap_grants WHERE grant_id = ?').bind(grantId).first();
    if (exists) return false;
    const doc = await loadAccountDoc(c.db, accountId);
    const eco = loadEconomy(doc.state, { now: c.now });
    if (Object.keys(rewards).length) eco.addRewards(rewards, { silent: true, applyVip: false });
    const next = docOf(eco);
    const p = o.purchase;
    const writes: GuardedWrite[] = [
      { sql: `INSERT INTO iap_purchases(token_hash, account_id, product_id, kind, state, order_hash, expires_at, test, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${REV_GUARD}
        ON CONFLICT(token_hash) DO UPDATE SET state = CASE WHEN iap_purchases.state = 'refunded' THEN 'refunded' ELSE excluded.state END,
          order_hash = COALESCE(excluded.order_hash, iap_purchases.order_hash), expires_at = COALESCE(excluded.expires_at, iap_purchases.expires_at),
          updated_at = excluded.updated_at WHERE iap_purchases.account_id = excluded.account_id`,
        values: [hash, accountId, product.id, product.type, p.state, p.orderHash ?? null, p.expiresAt ?? null, p.test ? 1 : 0, c.now, c.now] },
      { sql: `INSERT INTO iap_grants(grant_id, account_id, token_hash, product_id, rewards, price_krw, granted_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${REV_GUARD}`,
        values: [grantId, accountId, hash, product.id, JSON.stringify(rewards), p.test ? 0 : product.priceKRW, c.now] },
    ];
    if (o.entitlement) writes.push({ sql: `INSERT INTO iap_entitlements(account_id, ent_key, token_hash, starts_at, expires_at) SELECT ?, ?, ?, ?, ? WHERE ${REV_GUARD}
        ON CONFLICT(account_id, ent_key, token_hash) DO UPDATE SET expires_at = excluded.expires_at WHERE iap_entitlements.revoked_at IS NULL`,
      values: [accountId, o.entitlement.key, hash, c.now, o.entitlement.expiresAt] });
    // 결제 퍼널의 '첫 결제'는 테스트가 아닌 서버 검증 지급에서만 기록한다.
    if (!p.test) writes.push({ sql: `INSERT OR IGNORE INTO funnel_milestones(account_id, step, first_at, cohort_day)
        SELECT ?, 'first_purchase', ?, CAST(created_at / 86400000 AS INTEGER) FROM accounts WHERE account_id = ? AND ${REV_GUARD}`,
      values: [accountId, c.now, accountId] });
    const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
      ledger: { opId: grantId, kind: 'iap:' + product.id, delta: { rewards, entitlement: o.entitlement?.key ?? null }, receipt: { grantId, productId: product.id, rewards } },
      projection: next.projection, writes });
    if (outcome.ok) return true;
    if (outcome.reason === 'duplicate') return false;
  }
  fail(409, 'conflict');
}

/** 환불·취소: 토큰의 모든 미역분개 지급을 되돌리고 권한을 철회한다. 소비한 재화는 0 아래로 내리지 않고 부채로 남긴다. */
export async function reverseToken(c: Ctx, accountId: string, hash: string, why: string): Promise<number> {
  const grants = await c.db.prepare('SELECT grant_id, product_id, rewards FROM iap_grants WHERE token_hash = ? AND account_id = ? AND reversed_at IS NULL')
    .bind(hash, accountId).all<{ grant_id: string; product_id: string; rewards: string }>();
  let reversed = 0;
  for (const g of grants.results ?? []) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await loadAccountDoc(c.db, accountId);
      const eco = loadEconomy(doc.state, { now: c.now });
      const rewards = JSON.parse(g.rewards) as Record<string, number>, debt: Record<string, number> = {};
      for (const [key, amount] of Object.entries(rewards)) {
        const field = IAP_REWARD_FIELD[key as keyof typeof IAP_REWARD_FIELD];
        if (!field) continue;
        const have = Math.max(0, Math.floor(Number(eco.s[field]) || 0)), take = Math.min(have, amount);
        eco.s[field] = have - take;
        if (amount > take) debt[key] = amount - take;
      }
      const next = docOf(eco);
      const outcome = await casCommit(c.db, { accountId, baseRev: doc.rev, doc: next.text, now: c.now,
        ledger: { opId: 'void:' + g.grant_id, kind: 'iap-void:' + g.product_id, delta: { rewards, debt, why }, receipt: { grantId: g.grant_id, debt } },
        projection: next.projection,
        writes: [{ sql: `UPDATE iap_grants SET reversed_at = ?, debt = ? WHERE grant_id = ? AND reversed_at IS NULL AND ${REV_GUARD}`,
          values: [c.now, Object.keys(debt).length ? JSON.stringify(debt) : null, g.grant_id] }] });
      if (outcome.ok) { reversed++; break; }
      if (outcome.reason === 'duplicate') break;
      if (attempt === 2) fail(409, 'conflict');
    }
  }
  await c.db.batch([
    c.db.prepare("UPDATE iap_entitlements SET revoked_at = ? WHERE account_id = ? AND token_hash = ? AND revoked_at IS NULL").bind(c.now, accountId, hash),
    c.db.prepare("UPDATE iap_purchases SET state = 'refunded', updated_at = ? WHERE token_hash = ? AND account_id = ?").bind(c.now, hash, accountId),
  ]);
  if (reversed) await abuseCheck(c, accountId);
  return reversed;
}

/** 90일 안에 환불 2건 이상이면 30일 지급 보류(payout_hold) + 감사 플래그. 하루 한 번만 건다. */
async function abuseCheck(c: Ctx, accountId: string): Promise<void> {
  const n = await c.db.prepare('SELECT COUNT(*) AS n FROM iap_grants WHERE account_id = ? AND reversed_at > ?').bind(accountId, c.now - ABUSE_WINDOW).first<{ n: number }>();
  if ((n?.n ?? 0) < 2) return;
  const recent = await c.db.prepare("SELECT 1 AS x FROM sanctions WHERE account_id = ? AND kind = 'payout_hold' AND reason = 'iap-refunds' AND at > ?").bind(accountId, c.now - DAY).first();
  if (recent) return;
  await c.db.batch([
    c.db.prepare("INSERT INTO sanctions(account_id, kind, until, reason, by, at) VALUES (?, 'payout_hold', ?, 'iap-refunds', 'system', ?)").bind(accountId, c.now + HOLD_MS, c.now),
    c.db.prepare("INSERT INTO audit_flags(account_id, run_id, kind, severity, detail, at) VALUES (?, NULL, 'iap-refunds', 2, ?, ?)").bind(accountId, JSON.stringify({ refunds90d: n?.n ?? 0 }), c.now),
  ]);
}

/** 지급 보류 중이면 새 결제 시작을 막는다(환불 남용 계정). */
export async function payoutHeld(db: D1Database, accountId: string, now: number): Promise<boolean> {
  return !!await db.prepare("SELECT 1 AS x FROM sanctions WHERE account_id = ? AND kind = 'payout_hold' AND (until IS NULL OR until > ?)").bind(accountId, now).first();
}

// ── 환불 대사(크론) ─────────────────────────────────────────
/** voidedpurchases를 읽어 아는 토큰만 역분개한다. RTDN을 놓쳐도 이 경로가 최종 안전망이다. */
export async function reconcileVoided(c: Ctx, sinceMs: number): Promise<{ seen: number; reversed: number }> {
  if (await billingReason(c)) return { seen: 0, reversed: 0 };
  const voided = await play(c).voided(sinceMs);
  let reversed = 0;
  for (const v of voided) {
    const hash = await tokenHash(v.purchaseToken);
    const row = await c.db.prepare('SELECT account_id FROM iap_purchases WHERE token_hash = ?').bind(hash).first<{ account_id: string }>();
    if (row) reversed += await reverseToken(c, row.account_id, hash, 'voided');
  }
  return { seen: voided.length, reversed };
}

export function productFor(id: unknown): IapProduct | null {
  return typeof id === 'string' && Object.hasOwn(IAP_BY_ID, id) ? IAP_BY_ID[id] : null;
}
