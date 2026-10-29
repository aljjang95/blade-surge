// MMO P1-F: /api/v1 클라이언트. 세션 토큰은 메모리에만 두고 만료·폐기되면 기기 키로 다시 받는다.
import { apiUrl } from '../platform/api-base.js';

export class AccountError extends Error {
  constructor(status, body) { super(body?.error || 'http-' + status); this.status = status; this.body = body || {}; }
}

export class AccountClient {
  /** @param {{ deviceKey: string, channel?: string, fetchImpl?: typeof fetch, url?: (path: string) => string }} options */
  constructor({ deviceKey, channel = 'web', fetchImpl = globalThis.fetch?.bind(globalThis), url = (path) => apiUrl(path) }) {
    this.deviceKey = deviceKey; this.channel = channel; this.fetchImpl = fetchImpl; this.url = url;
    this.token = null; this.account = null; this.serverOffset = 0;
  }
  async raw(method, path, body, token = this.token) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await this.fetchImpl(this.url('/api/v1' + path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit' });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (Number.isFinite(data?.serverTime)) this.serverOffset = data.serverTime - Date.now();
    if (!res.ok) throw new AccountError(res.status, data);
    return data;
  }
  async session() {
    const data = await this.raw('POST', '/auth/session', { deviceKey: this.deviceKey, channel: this.channel }, null);
    this.token = data.token; this.account = data;
    return data;
  }
  /** 토큰이 없거나 만료·폐기면 한 번 다시 받아 재시도한다. */
  async request(method, path, body) {
    if (!this.token) await this.session();
    try { return await this.raw(method, path, body); }
    catch (error) {
      if (!(error instanceof AccountError) || error.status !== 401) throw error;
      await this.session();
      return this.raw(method, path, body);
    }
  }
  me() { return this.request('GET', '/me'); }
  // 계정 로그인: 제공자 목록은 인증이 필요 없다(서버가 키 유무로 판단, V1이 꺼져 있으면 503).
  providers() { return this.raw('GET', '/auth/providers', undefined, null); }
  /** 카카오·ChatGPT 로그인 시작. link 는 세션이 필요하고 recover 는 세션 없이 기기 키를 보낸다. 응답 { url } 로 location.assign 한다. */
  oauthStart(provider, mode) {
    if (mode === 'recover') return this.raw('POST', '/auth/oauth/start', { provider, mode, deviceKey: this.deviceKey, channel: this.channel }, null);
    return this.request('POST', '/auth/oauth/start', { provider, mode });
  }
  /** 구글 id_token 으로 현재 계정에 연동(세션 필요). 이미 다른 진행에 묶였으면 409 linked-elsewhere { mine, other }. */
  link(provider, idToken) { return this.request('POST', '/auth/link', { provider, idToken }); }
  /** 구글 id_token 으로 기존 진행을 이 기기로 복원(세션 불필요). 연동이 없으면 404 no-link. */
  async recover(provider, idToken) {
    const data = await this.raw('POST', '/auth/recover', { provider, idToken, deviceKey: this.deviceKey, channel: this.channel }, null);
    this.token = null; this.account = null; // 기기 키가 다른 계정으로 옮겨졌으니 이전 세션은 버린다
    return data;
  }
  /** 회원 탈퇴(세션 필요). */
  deleteAccount() { return this.request('POST', '/auth/delete', { confirm: 'DELETE' }); }
  cmd(command) { return this.request('POST', '/cmd', command); }
  importSave(installId, save, clientHash) { return this.request('POST', '/import', { installId, save, clientHash }); }
  shadowSnapshot(cid, save, clientHash) { return this.request('POST', '/shadow/snapshot', { cid, save, clientHash }); }
  startRun(body) { return this.request('POST', '/runs/start', body); }
  settleRun(runId, facts) { return this.request('POST', `/runs/${runId}/settle`, facts); }
  // BM: 인앱 결제(서버가 검증·지급의 유일한 근거). 구매 토큰은 반환 경로로만 흐르고 기록하지 않는다.
  iapCatalog() { return this.request('GET', '/iap/catalog'); }
  iapIntent(productId) { return this.request('POST', '/iap/intent', { productId }); }
  iapVerify(productId, purchaseToken) { return this.request('POST', '/iap/verify', { productId, purchaseToken }); }
  iapState() { return this.request('GET', '/iap/state'); }
  funnel(events) { return this.request('POST', '/funnel', { events }); }
  /** 서버 시계 기준 현재 시각(표시용 오프셋만 보정한다). */
  serverNow() { return Date.now() + this.serverOffset; }
}

export const newCid = () => globalThis.crypto?.randomUUID?.() || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
