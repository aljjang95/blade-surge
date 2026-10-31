// 포트원 V2 웹훅 수신 — POST /api/v1/iap/web/webhook (포트원 콘솔 결제 연동 → 웹훅, 버전 2024-04-25).
// https://developers.portone.io/opi/ko/integration/webhook/readme-v2 · 서명: Standard Webhooks(https://www.standardwebhooks.com)
// 원칙: ① 서명(webhook-id.webhook-timestamp.body, HMAC-SHA256)과 타임스탬프 허용오차(±5분)를 먼저 확인한다.
// ② 본문은 paymentId를 찾는 데만 쓴다. 상태·금액은 믿지 않고, 기존 단건 조회(GET /payments/{id}) → settleWebPayment(grantOnce·회수)로만 반영한다.
// ③ 같은 알림의 재전송·동시 도착은 grantOnce 원장 op_id와 회수 가드가 한 번만 반영한다(멱등).
// ④ 시크릿이 없으면 503(닫힘). 응답: 처리·무시 = 200(재전송 중단), 서명 불일치 = 401, 일시 오류 = 503(포트원이 재전송). 오류 원문·시크릿은 싣지 않는다.
import { V1Error } from './db';
import type { Ctx } from './auth';
import { ROW_COLUMNS, ROW_FROM, settleWebPayment, webPortoneApi, webReconcileReason, type PortoneEnv, type WebRow } from './portone';

const LIMIT = 16384;
/** 서명 시각 허용오차(Standard Webhooks 권장 5분). 재생(replay) 공격 창을 좁힌다. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60000;
const PAYMENT_ID = /^[A-Za-z0-9_-]{16,64}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});

async function webhookSecret(c: Ctx): Promise<string> {
  const source = (c.env as unknown as PortoneEnv).PORTONE_WEBHOOK_SECRET;
  const value = typeof source === 'string' ? source : source && typeof source.get === 'function' ? await source.get().catch(() => '') : '';
  return value.trim(); // 저장 값 끝의 줄바꿈·공백 방어
}

/** whsec_ 접두를 떼고 base64로 푼 키(Standard Webhooks 규칙). 형식이 틀리면 null(설정 오류 → 503). */
function secretKey(secret: string): Uint8Array<ArrayBuffer> | null {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  try { return Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0)); } catch { return null; }
}

/**
 * Standard Webhooks 서명 확인. webhook-signature는 공백으로 나뉜 'v1,<base64>' 목록(키 교체 중 여러 개)이고 하나라도 맞으면 통과.
 * 비교는 crypto.subtle.verify(상수 시간)로 한다.
 */
export async function verifyWebhookSignature(secret: string, headers: Headers, body: string, now: number): Promise<'ok' | 'bad-signature' | 'stale' | 'bad-secret'> {
  const key = secretKey(secret);
  if (!key) return 'bad-secret';
  const id = headers.get('webhook-id') ?? '', ts = headers.get('webhook-timestamp') ?? '', sig = headers.get('webhook-signature') ?? '';
  if (!id || id.length > 256 || !/^\d{1,12}$/.test(ts) || !sig || sig.length > 2048) return 'bad-signature';
  if (Math.abs(now - Number(ts) * 1000) > WEBHOOK_TOLERANCE_MS) return 'stale';
  const hmac = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${id}.${ts}.${body}`);
  for (const part of sig.split(' ')) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0)); } catch { continue; }
    if (bytes.length === 32 && await crypto.subtle.verify('HMAC', hmac, bytes, signed)) return 'ok';
  }
  return 'bad-signature';
}

/** 웹훅 본문에서 paymentId만 꺼낸다. 2024-04-25 형식(data.paymentId)과 옛 형식(payment_id)을 받는다. 결제 알림이 아니면 null. */
export function webhookPaymentId(body: Obj): string | null {
  const type = typeof body.type === 'string' ? body.type : null;
  if (type !== null && !type.startsWith('Transaction.')) return null;
  const id = obj(body.data).paymentId ?? body.payment_id;
  return typeof id === 'string' && PAYMENT_ID.test(id) ? id : null;
}

/** 웹훅 하나를 처리하고 응답 코드·결과를 돌려준다. 판매 스위치(WEB_BILLING_ENABLED)와 무관하게 대사처럼 돈다(판매를 멈춰도 취소는 반영). */
export async function handlePortoneWebhook(c: Ctx): Promise<{ status: number; outcome: string }> {
  const secret = await webhookSecret(c);
  if (!secret) return { status: 503, outcome: 'webhook-not-configured' };
  const length = c.request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > LIMIT)) return { status: 413, outcome: 'body-limit' };
  const text = await c.request.text().catch(() => '');
  if (!text || text.length > LIMIT) return { status: 400, outcome: 'body' };
  const verified = await verifyWebhookSignature(secret, c.request.headers, text, c.now);
  if (verified === 'bad-secret') return { status: 503, outcome: 'webhook-not-configured' };
  if (verified !== 'ok') return { status: 401, outcome: verified === 'stale' ? 'stale' : 'unauthorized' };
  let body: Obj;
  try { body = obj(JSON.parse(text)); } catch { return { status: 200, outcome: 'malformed' }; }
  const paymentId = webhookPaymentId(body);
  if (!paymentId) return { status: 200, outcome: 'ignored' };
  const row = await c.db.prepare(`SELECT ${ROW_COLUMNS} FROM ${ROW_FROM} WHERE w.payment_id = ?`).bind(paymentId).first<WebRow>();
  // 이 서버가 발급하지 않은 결제(다른 상점·다른 제품)는 처리하지 않고 재전송도 받지 않는다.
  if (!row) return { status: 200, outcome: 'unknown-payment' };
  const reason = await webReconcileReason(c);
  if (reason) return { status: 503, outcome: 'retry:' + reason };
  try {
    const payment = await webPortoneApi(c).getPayment(row.payment_id);
    // 알림은 왔는데 조회가 아직 안 되면 잠시 뒤 재전송으로 다시 본다.
    if (!payment) return { status: 503, outcome: 'retry:payment-not-found' };
    const settled = await settleWebPayment(c, row, payment);
    return { status: 200, outcome: settled.state };
  } catch (error) {
    if (error instanceof V1Error && error.status < 500) return { status: 200, outcome: 'rejected:' + error.code }; // 검증 실패는 감사 플래그를 남겼다(재전송해도 같다).
    if (error instanceof V1Error) return { status: 503, outcome: 'retry:' + error.code };
    throw error;
  }
}
