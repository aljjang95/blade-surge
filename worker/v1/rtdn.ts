// BM D10a: Google Play 실시간 개발자 알림(RTDN) 수신 — Cloud Pub/Sub push 구독 → POST /api/v1/iap/rtdn.
// https://developer.android.com/google/play/billing/rtdn-reference
// https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
// 인증: Pub/Sub push의 OIDC 토큰(aud = RTDN_AUDIENCE, sub = 푸시 서비스 계정 고유 ID RTDN_PUSH_SUBJECT).
// 알림 본문은 신뢰하지 않는다. 토큰으로 Play를 다시 조회한 결과만 원장에 반영한다(processPurchase·reverseToken).
// 응답: 처리·무시 = 200(재전송 중단), 일시 오류 = 503(Pub/Sub가 재전송). 오류 원문은 싣지 않는다.
import { V1Error } from './db';
import type { Ctx } from './auth';
import { sha256Hex } from './token';
import { billingReason, processPurchase, productFor, reverseToken, tokenHash, type IapEnv } from './iap';
import { IAP_PACKAGE } from '../../src/shared/iap-catalog.js';

const LIMIT = 16384;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});

async function authorized(c: Ctx): Promise<boolean> {
  const env = c.env as unknown as IapEnv;
  if (!env.RTDN_AUDIENCE || !env.RTDN_PUSH_SUBJECT || !c.deps.verifyIdToken) throw new V1Error(503, 'rtdn-not-configured');
  const header = c.request.headers.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(header)) return false;
  try {
    const { sub } = await c.deps.verifyIdToken('pubsub', header.slice(7), [env.RTDN_AUDIENCE]);
    return sub === env.RTDN_PUSH_SUBJECT;
  } catch (error) {
    if (error && typeof error === 'object' && (error as { status?: number }).status === 503) throw new V1Error(503, 'rtdn-verifier-unavailable');
    return false;
  }
}

async function readBody(request: Request): Promise<Obj> {
  const text = await request.text().catch(() => '');
  if (!text || text.length > LIMIT) throw new V1Error(400, 'body');
  try { return obj(JSON.parse(text)); } catch { throw new V1Error(400, 'json'); }
}

/** Pub/Sub 메시지 하나를 처리하고 결과 코드를 돌려준다. */
export async function handleRtdn(c: Ctx): Promise<{ status: number; outcome: string }> {
  if (!await authorized(c)) return { status: 401, outcome: 'unauthorized' };
  const reason = await billingReason(c);
  // 결제가 닫혀 있으면 받기만 하고 버린다(재전송 폭주 방지). 놓친 환불은 크론 voidedpurchases 대사가 다시 잡는다.
  if (reason) return { status: 200, outcome: 'ignored:' + reason };
  const body = await readBody(c.request);
  const message = obj(body.message);
  if (typeof message.messageId !== 'string' || typeof message.data !== 'string' || message.data.length > LIMIT) return { status: 200, outcome: 'malformed' };
  const messageHash = await sha256Hex('rtdn:' + message.messageId);
  if (await c.db.prepare('SELECT 1 AS x FROM iap_rtdn WHERE message_hash = ?').bind(messageHash).first()) return { status: 200, outcome: 'duplicate' };
  let data: Obj;
  try { data = obj(JSON.parse(atob(message.data))); } catch { return record(c, messageHash, 'malformed', 'malformed'); }
  if (data.packageName !== IAP_PACKAGE) return record(c, messageHash, 'other', 'wrong-package');
  let kind = 'other', outcome = 'ignored';
  try {
    if (data.testNotification) { kind = 'test'; outcome = 'test'; }
    else if (data.voidedPurchaseNotification) {
      kind = 'voided';
      const v = obj(data.voidedPurchaseNotification);
      if (typeof v.purchaseToken === 'string' && v.purchaseToken.length <= 4096) {
        const hash = await tokenHash(v.purchaseToken);
        const row = await c.db.prepare('SELECT account_id FROM iap_purchases WHERE token_hash = ?').bind(hash).first<{ account_id: string }>();
        outcome = row ? `reversed:${await reverseToken(c, row.account_id, hash, 'rtdn-voided')}` : 'unknown-token';
      }
    } else if (data.oneTimeProductNotification || data.subscriptionNotification) {
      const n = obj(data.oneTimeProductNotification ?? data.subscriptionNotification);
      kind = data.oneTimeProductNotification ? 'product' : 'subscription';
      const product = productFor(n.sku ?? n.subscriptionId);
      if (!product || typeof n.purchaseToken !== 'string' || n.purchaseToken.length > 4096) outcome = 'unknown-product';
      else outcome = (await processPurchase(c, product, n.purchaseToken, {})).state;
    }
  } catch (error) {
    if (!(error instanceof V1Error)) throw error;
    // 제공자·DB 일시 오류는 재전송을 받는다. 계정 미결박·불일치 같은 영구 거부는 기록하고 끝낸다.
    if (error.status >= 500 || error.code === 'conflict') return { status: 503, outcome: 'retry' };
    outcome = 'rejected:' + error.code;
  }
  return record(c, messageHash, kind, outcome);
}

async function record(c: Ctx, messageHash: string, kind: string, outcome: string) {
  await c.db.prepare('INSERT OR IGNORE INTO iap_rtdn(message_hash, kind, received_at, outcome) VALUES (?, ?, ?, ?)').bind(messageHash, kind, c.now, outcome.slice(0, 64)).run();
  return { status: 200, outcome };
}
