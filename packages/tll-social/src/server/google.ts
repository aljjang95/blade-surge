import { SocialError } from '../shared/validation';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

export interface VerifierOptions {
  fetch?: (url: string) => Promise<Response>;
  now?: () => number;
  jwksUrl?: string;
}

const b64urlBytes = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new SocialError('bad-token', 401);
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};
const b64urlJson = (value: string): any => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64urlBytes(value))); }
  catch { throw new SocialError('bad-token', 401); }
};

/** 구글 ID 토큰(RS256) 검증기. JWKS는 Cache-Control max-age 동안 캐시하고, 모르는 kid면 최소 60초 간격으로 다시 받는다. */
export function createGoogleVerifier(options: VerifierOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const url = options.jwksUrl ?? GOOGLE_JWKS_URL;
  const fetcher = options.fetch ?? ((target: string) => fetch(target));
  let cache: { keys: Map<string, CryptoKey>; expires: number } | null = null;
  let lastFetch = -Infinity;
  let pending: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    lastFetch = now();
    let response: Response;
    try { response = await fetcher(url); } catch { throw new SocialError('link-unavailable', 503); }
    if (!response.ok) throw new SocialError('link-unavailable', 503);
    let body: any;
    try { body = await response.json(); } catch { throw new SocialError('link-unavailable', 503); }
    const keys = new Map<string, CryptoKey>();
    for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
      if (jwk?.kty !== 'RSA' || typeof jwk.kid !== 'string' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
      if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
      if (jwk.use !== undefined && jwk.use !== 'sig') continue;
      try { keys.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, ALG, false, ['verify'])); }
      catch { /* 형식이 맞지 않는 키는 건너뛴다. */ }
    }
    const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600);
    cache = { keys, expires: now() + Math.min(Math.max(maxAge, 60), 86400) * 1000 };
  }
  async function keyFor(kid: string): Promise<CryptoKey | undefined> {
    const stale = !cache || cache.expires <= now();
    const missing = !!cache && !cache.keys.has(kid) && now() - lastFetch >= 60000;
    if (stale || missing) {
      pending ??= refresh().finally(() => { pending = null; });
      await pending;
    }
    return cache?.keys.get(kid);
  }

  // maxIatAgeMs: 발급 후 허용 경과(기본 10분). Pub/Sub push OIDC 토큰은 만료(1시간) 전까지 재사용될 수 있어 호출자가 넓힌다.
  async function verify(token: string, clientIds: string[], maxIatAgeMs = 600000): Promise<{ sub: string }> {
    if (typeof token !== 'string' || token.length > 4096) throw new SocialError('bad-token', 401);
    const parts = token.split('.');
    if (parts.length !== 3) throw new SocialError('bad-token', 401);
    const header = b64urlJson(parts[0]), claims = b64urlJson(parts[1]);
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw new SocialError('bad-token', 401);
    const key = await keyFor(header.kid);
    if (!key) throw new SocialError('bad-token', 401);
    const ok = await crypto.subtle.verify(ALG, key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) throw new SocialError('bad-token', 401);
    const t = now();
    if (!claims || typeof claims !== 'object') throw new SocialError('bad-token', 401);
    if (!ISSUERS.has(claims.iss)) throw new SocialError('bad-token', 401);
    if (typeof claims.aud !== 'string' || !clientIds.includes(claims.aud)) throw new SocialError('bad-token', 401);
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= t) throw new SocialError('token-expired', 401);
    if (!Number.isFinite(claims.iat) || claims.iat * 1000 > t + 60000 || claims.iat * 1000 < t - maxIatAgeMs) throw new SocialError('token-expired', 401);
    if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)) throw new SocialError('bad-token', 401);
    return { sub: claims.sub };
  }
  return { verify };
}

