// /api/v1 공통 응답·본문 처리. 모든 응답은 no-store, 오류 본문은 코드만 담는다.
import { V1Error } from './db';

export const BODY_LIMIT = 8192;
export const IMPORT_LIMIT = 262144;

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
export function fail(status: number, code: string, extra: Record<string, unknown> = {}): never {
  throw new V1Error(status, code, extra);
}

/** 본문을 limit 바이트까지만 읽고 JSON 객체로 해석한다(5초 시한). */
export async function readJson(request: Request, limit = BODY_LIMIT): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) fail(415, 'content-type');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) fail(413, 'body-limit');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new V1Error(408, 'body-timeout')), 5000); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader!.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail(413, 'body-limit');
      chunks.push(value);
    }
  } catch (error) { void reader!.cancel().catch(() => {}); throw error; }
  finally { if (timer) clearTimeout(timer); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(400, 'json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'schema');
  return body as Record<string, unknown>;
}

/** 허용 키 밖의 필드가 있으면 거부한다(알 수 없는 필드 = 위조 의심). */
export function onlyKeys(body: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(400, 'unknown-field', { field: key.slice(0, 32) });
  for (const key of required) if (!(key in body)) fail(400, 'schema', { field: key });
}
export const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
export const isId = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9_:.-]+$/.test(v);
export const CID = /^[A-Za-z0-9-]{8,64}$/;
