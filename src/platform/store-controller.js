import { STORE_API, STORE_CHANNEL } from './store-channel.js';
import { createStoreAdapter } from './store-adapters.js';
import { audio } from '../engine/audio.js';

export class StoreController {
  constructor(app, { channel = STORE_CHANNEL, load = createStoreAdapter, fetcher = fetch } = {}) {
    this.app = app; this.channel = channel; this.load = load; this.fetcher = fetcher;
    this.adapter = null; this.capabilities = null; this.session = null; this.busy = false;
    this.disposed = false; this.suspended = false; this.generation = 0; this.initializing = null;
    this.lifetime = new AbortController();
  }
  active(generation = this.generation) {
    return generation === this.generation && !this.disposed && !this.suspended && !this.lifetime.signal.aborted
      && (typeof document === 'undefined' || !document.hidden) && this.app.mode === 'lobby' && !this.app.stageStarting;
  }
  async request(path, body) {
    if (this.disposed || this.suspended) throw Error('store-unavailable');
    const response = await this.fetcher(`${STORE_API}${path}`, { method: body ? 'POST' : 'GET', credentials: 'omit',
      headers: { 'X-Store-Channel': this.channel, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.session ? { Authorization: `Bearer ${this.session.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw Error('store-unavailable');
    return response.json();
  }
  async init() {
    if (this.channel === 'web' || this.disposed || this.suspended) return;
    if (this.initializing) return this.initializing;
    const generation = this.generation;
    const pending = (async () => {
      let adapter;
      try {
        adapter = this.adapter ?? await this.load(this.channel);
        if (generation !== this.generation || this.disposed || this.suspended) { await adapter.dispose?.(); return; }
        this.adapter = adapter;
        const capabilities = await this.request(`/capabilities?channel=${this.channel}`);
        if (generation !== this.generation || this.disposed || this.suspended) return;
        this.capabilities = { ...capabilities, billing: !!capabilities.billing && (!adapter.capabilities || !!adapter.capabilities.billing && !!adapter.capabilities.nativeSignIn),
          ads: !!capabilities.ads && (!adapter.capabilities || !!adapter.capabilities.ads
            && capabilities.adConfiguration?.appId === adapter.capabilities.adAppId
            && capabilities.adConfiguration?.interstitialId === adapter.capabilities.adUnitId) };
      } catch { if (generation === this.generation) this.capabilities = null; }
    })();
    this.initializing = pending;
    try { await pending; } finally { if (this.initializing === pending) this.initializing = null; }
  }
  async activate() {
    await this.init();
    const generation = this.generation, adapter = this.adapter;
    if (!this.active(generation)) return;
    await adapter?.orient?.();
    if (!this.active(generation)) await adapter?.dispose?.();
  }
  async authenticate(ensure = () => {}) {
    ensure();
    if (this.session && this.session.expiresAt > Date.now() + 60000) return;
    const identity = await this.adapter.authenticate(); ensure();
    const session = await this.request('/auth', { channel: this.channel,
      ...(this.channel === 'apps-in-toss' ? { code: identity.code } : { idToken: identity.idToken }) });
    ensure(); this.session = session;
  }
  async verify(receipt, intentId) {
    const result = await this.request('/verify', { channel: this.channel, intentId, ...receipt });
    if (result.adFree !== true) throw Error('purchase-incomplete');
    return result;
  }
  async ownFlow(action) {
    if (this.busy || !this.active()) return { ok: false };
    const generation = this.generation, signal = this.lifetime.signal;
    const isActive = () => this.active(generation);
    const ensure = () => { if (!isActive()) throw Error('store-interrupted'); };
    this.busy = true; this.app.input.clear();
    const release = audio.acquireMusicMute();
    try { ensure(); await action({ ensure, isActive, signal }); ensure(); return { ok: true }; }
    catch { return { ok: false }; }
    finally { release(); this.busy = false; }
  }
  purchase() {
    return this.ownFlow(async control => {
      if (!this.adapter || !this.capabilities?.billing) throw Error('store-unavailable');
      await this.authenticate(control.ensure);
      const intent = await this.request('/orders', { channel: this.channel, productId: 'remove_ads_v1', idempotencyKey: crypto.randomUUID() });
      control.ensure();
      await this.adapter.purchase(receipt => { control.ensure(); return this.verify(receipt, intent.intentId); }, intent.obfuscatedAccountId, control);
    });
  }
  restore() {
    return this.ownFlow(async control => {
      if (!this.adapter || !this.capabilities?.billing) throw Error('store-unavailable');
      await this.authenticate(control.ensure); control.ensure();
      await this.adapter.restore(receipt => { control.ensure(); return this.request('/restore', { channel: this.channel, ...receipt }); }, control);
    });
  }
  showAd() {
    return this.ownFlow(async control => {
      if (!this.adapter || !this.capabilities?.ads) throw Error('ad-unavailable');
      if (this.capabilities.billing) {
        await this.authenticate(control.ensure);
        const entitlement = this.channel === 'apps-in-toss' ? await this.request('/entitlements')
          : await this.request('/restore', { channel: this.channel, receipts: await this.adapter.receipts() });
        control.ensure(); if (entitlement.adFree === true) return;
      }
      control.ensure(); await this.adapter.showAd(control);
    });
  }
  privacyOptions() {
    return this.ownFlow(async control => { if (!this.adapter?.privacyOptions) throw Error('ad-unavailable'); await this.adapter.privacyOptions(control); });
  }
  async suspend() {
    this.suspended = true; this.generation++; this.lifetime.abort();
    const adapter = this.adapter; this.adapter = null; this.capabilities = null; this.session = null; this.initializing = null;
    await adapter?.dispose?.();
  }
  async resume() {
    if (this.disposed) return;
    this.suspended = false; this.lifetime = new AbortController(); await this.activate();
  }
  async dispose() { this.disposed = true; await this.suspend(); }
}
