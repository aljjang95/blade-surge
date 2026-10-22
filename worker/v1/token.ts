// MMO P1-B: 무상태 HMAC 세션 토큰 `v1.<payload>.<sig>` (docs/MMO_DESIGN.md 3.2).
// payload {aid, ch, ver, iat, exp, att}. 서명 키는 SESSION_HMAC(Secrets Store 또는 문자열 시크릿).
// 상태 변경 요청은 D1에서 accounts.token_ver·status를 함께 읽어 로그아웃·차단을 즉시 반영한다.

export const CHANNELS = ['web', 'googleplay', 'onestore', 'apps-in-toss'] as const;
export type Channel = typeof CHANNELS[number];
export interface SessionClaims { aid: string; ch: Channel; ver: number; iat: number; exp: number; att: 0 | 1 }
export type SecretSource = string | { get(): Promise<string> } | undefined;

export const TOKEN_TTL_MS = 60 * 60 * 1000;
const SKEW_MS = 60 * 1000;
const ACCOUNT_ID = /^p_[0-9a-f]{24}$/;
const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

const keyCache = new Map<string, Promise<CryptoKey>>();
export async function resolveSecret(source: SecretSource): Promise<string | null> {
  const value = typeof source === 'string' ? source : source && typeof source.get === 'function' ? await source.get() : null;
  // 32바이트 미만의 키는 서명 키로 쓰지 않는다(설정 누락을 기능 비활성으로 닫는다).
  return typeof value === 'string' && value.length >= 32 ? value : null;
}
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, key);
  }
  return key;
}

export async function signToken(secret: string, claims: SessionClaims): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode('v1.' + payload)));
  return `v1.${payload}.${b64url(sig)}`;
}

export type TokenCheck = { ok: true; claims: SessionClaims } | { ok: false; reason: 'format' | 'signature' | 'expired' };

/** 서명(상수 시간 verify)·형식·만료를 검사한다. token_ver·계정 상태는 호출자가 D1에서 확인한다. */
export async function verifyToken(secret: string, token: unknown, now: number): Promise<TokenCheck> {
  if (typeof token !== 'string' || token.length > 1024) return { ok: false, reason: 'format' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'format' };
  const sig = fromB64url(parts[2]);
  if (!sig || sig.byteLength !== 32) return { ok: false, reason: 'format' };
  if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, encoder.encode('v1.' + parts[1]))) return { ok: false, reason: 'signature' };
  let claims: SessionClaims;
  try {
    const bytes = fromB64url(parts[1]);
    if (!bytes) return { ok: false, reason: 'format' };
    claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return { ok: false, reason: 'format' }; }
  if (!validClaims(claims)) return { ok: false, reason: 'format' };
  if (claims.exp <= now || claims.iat > now + SKEW_MS) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

function validClaims(c: unknown): c is SessionClaims {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return Object.keys(o).length === 6 && typeof o.aid === 'string' && ACCOUNT_ID.test(o.aid)
    && (CHANNELS as readonly unknown[]).includes(o.ch) && Number.isSafeInteger(o.ver) && (o.ver as number) >= 1
    && Number.isSafeInteger(o.iat) && Number.isSafeInteger(o.exp) && (o.exp as number) > (o.iat as number)
    && (o.exp as number) - (o.iat as number) <= TOKEN_TTL_MS && (o.att === 0 || o.att === 1);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
