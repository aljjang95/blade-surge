// REST 요청 래퍼: 타임아웃·오류 정규화, 절대 throw하지 않는다
/**
 * @typedef {{ ok: true, status: number, data: any }} SocialOk
 * @typedef {{ ok: false, error: string, status: number, retryAfterMs?: number, queued?: boolean }} SocialFail
 * @typedef {SocialOk | SocialFail} SocialResult
 * @typedef {{ setTimeout(fn: () => void, ms: number): any, clearTimeout(id: any): void }} Timers
 */

export const REQUEST_TIMEOUT_MS = 8000;
const TIMEOUT = Symbol('timeout');

/**
 * @param {string} error
 * @param {number} status
 * @param {number} [retryAfterMs]
 * @returns {SocialFail}
 */
export function fail(error, status = 0, retryAfterMs) {
  return retryAfterMs === undefined ? { ok: false, error, status } : { ok: false, error, status, retryAfterMs };
}

/**
 * @param {string | null | undefined} header
 * @param {number} nowMs
 */
function parseRetryAfter(header, nowMs) {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined;
}

/**
 * @param {{
 *   baseUrl: string,
 *   fetchImpl: ((input: string, init?: any) => Promise<any>) | null | undefined,
 *   timers: Timers,
 *   now: () => number,
 *   getKey: () => string,
 *   timeoutMs?: number,
 * }} options
 */
export function createRequester({ baseUrl, fetchImpl, timers, now, getKey, timeoutMs = REQUEST_TIMEOUT_MS }) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {{ body?: any, query?: Record<string, string | number | null | undefined>, auth?: boolean, key?: string }} [options]
   * @returns {Promise<SocialResult>}
   */
  return async function request(method, path, options = {}) {
    if (typeof fetchImpl !== 'function') return fail('fetch-unavailable');
    let url = baseUrl + path;
    if (options.query) {
      const parts = [];
      for (const [name, value] of Object.entries(options.query)) {
        if (value === undefined || value === null || value === '') continue;
        parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
      }
      if (parts.length) url += '?' + parts.join('&');
    }
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json' };
    if (options.auth !== false) headers.Authorization = 'Bearer ' + (options.key ?? getKey());
    /** @type {any} */
    const init = { method, headers, credentials: 'same-origin', cache: 'no-store' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    // AbortSignal.timeout 대신 주입 가능한 타이머로 직접 끊는다(테스트·구형 브라우저 공통 경로).
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) init.signal = controller.signal;
    let timer = null;
    const timeout = new Promise(resolve => {
      timer = timers.setTimeout(() => {
        try { controller?.abort(); } catch { /* 무시 */ }
        resolve(TIMEOUT);
      }, timeoutMs);
    });
    const run = async () => {
      const res = await fetchImpl(url, init);
      const raw = typeof res.text === 'function' ? await res.text() : '';
      let body = null;
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = null; }
      }
      return { res, body, raw };
    };
    try {
      const outcome = await Promise.race([run(), timeout]);
      if (outcome === TIMEOUT) return fail('timeout');
      const { res, body, raw } = /** @type {{ res: any, body: any, raw: string }} */ (outcome);
      const status = Number(res.status) || 0;
      if (res.ok) {
        if (raw && body === null) return fail('bad-response', status);
        return { ok: true, status, data: body };
      }
      const code = body && typeof body.error === 'string' ? body.error
        : body && typeof body.code === 'string' ? body.code
          : 'http-' + status;
      let retryAfterMs = body && Number.isFinite(body.retryAfterMs) ? Number(body.retryAfterMs) : undefined;
      if (retryAfterMs === undefined) {
        const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
        retryAfterMs = parseRetryAfter(header, now());
      }
      return fail(code, status, retryAfterMs);
    } catch (error) {
      if (error && /** @type {any} */ (error).name === 'AbortError') return fail('timeout');
      return fail('network');
    } finally {
      timers.clearTimeout(timer);
    }
  };
}

/**
 * 오프라인·일시 장애처럼 나중에 다시 보내면 성공할 수 있는 실패인가.
 * @param {SocialFail} result
 */
export function isRetryable(result) {
  return result.error === 'network' || result.error === 'timeout' || result.error === 'offline'
    || result.status === 429 || result.status >= 500;
}
