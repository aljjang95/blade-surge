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
  cmd(command) { return this.request('POST', '/cmd', command); }
  importSave(installId, save, clientHash) { return this.request('POST', '/import', { installId, save, clientHash }); }
  shadowSnapshot(cid, save, clientHash) { return this.request('POST', '/shadow/snapshot', { cid, save, clientHash }); }
  startRun(body) { return this.request('POST', '/runs/start', body); }
  settleRun(runId, facts) { return this.request('POST', `/runs/${runId}/settle`, facts); }
  /** 서버 시계 기준 현재 시각(표시용 오프셋만 보정한다). */
  serverNow() { return Date.now() + this.serverOffset; }
}

export const newCid = () => globalThis.crypto?.randomUUID?.() || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
