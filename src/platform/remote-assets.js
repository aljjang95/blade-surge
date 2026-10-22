// 스토어 네이티브 채널(googleplay·onestore)의 스트리밍 자산 해석기. 모든 로더가 이 모듈의 한 곳을 지난다.
//  - 빌드가 APK 에서 뺀 remote 파일(asset-manifest.json 의 remote)을 정식 호스트에서 받아 Cache Storage 에 내용 해시 키로 보관한다.
//  - 웹·앱인토스 채널은 enabled=false 라서 assetUrl 이 입력을 그대로 돌려준다(상대 URL 불변).
//  - 보관한 파일은 오프라인에서도 쓴다. 보관본이 없고 네트워크도 없으면 로더가 기존 폴백(이미지 숨김·곡 없음·1단계 몸체)으로 간다.
import { STORE_CHANNEL } from './store-channel.js';

export const STREAMING_CHANNELS = Object.freeze(['googleplay', 'onestore']);
export const CACHE_NAME = 'blade-remote-assets-v1';
export const DEFAULT_HOST = 'https://blade.tllhouse.com';
const MIME = Object.freeze({ webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ogg: 'audio/ogg', mp3: 'audio/mpeg',
  mp4: 'video/mp4', glb: 'model/gltf-binary', json: 'application/json' });
const extOf = (path) => (/\.([a-z0-9]+)$/i.exec(path)?.[1] || '').toLowerCase();

export class RemoteAssetError extends Error {
  constructor(path, cause) { super(`remote asset unavailable: ${path}`); this.name = 'RemoteAssetError'; this.remoteAssetUnavailable = true; this.path = path; this.cause = cause; }
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * @param {{channel?: string, host?: string, fetchImpl?: typeof fetch, caches?: CacheStorage|null, origin?: string, subtle?: SubtleCrypto|null,
 *   urlApi?: {createObjectURL(b: Blob): string, revokeObjectURL(u: string): void}, wait?: (ms: number) => Promise<void>, manifestUrl?: string,
 *   retries?: number, concurrency?: number, timeoutMs?: number}} [options]
 */
export function createRemoteAssets(options = {}) {
  const channel = options.channel ?? STORE_CHANNEL;
  const fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const origin = options.origin ?? globalThis.location?.origin ?? '';
  const subtle = options.subtle === undefined ? globalThis.crypto?.subtle ?? null : options.subtle;
  const urlApi = options.urlApi ?? globalThis.URL;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retries = options.retries ?? 2, concurrency = options.concurrency ?? 3, timeoutMs = options.timeoutMs ?? 45000;
  const manifestUrl = options.manifestUrl ?? '/asset-manifest.json';
  let host = options.host ?? DEFAULT_HOST;
  let enabled = false, manifest = null, cache = null;
  const remote = new Map();           // 경로 -> { h, b, g }
  const cachedPaths = new Set();      // Cache Storage 에 보관된 경로
  const blobUrls = new Map();         // 경로 -> blob: URL(이미지·곡·영상용 동기 해석)
  const inflight = new Map();         // 경로 -> Promise<ArrayBuffer|null>
  const cooling = new Map();          // 경로 -> 실패 후 암묵 재시도를 쉬는 시각(UI 가 URL 을 다시 물을 때마다 재시도하지 않게)
  const now = options.now ?? (() => Date.now());
  const listeners = new Set();
  const stats = { cacheHits: 0, networkFetches: 0, failures: 0, fallbackHits: 0, hashMismatches: 0, htmlResponses: 0, restored: 0, pruned: 0 };
  const progress = { pendingFiles: 0, pendingBytes: 0, doneBytes: 0, totalBytes: 0, failed: 0 };
  let queue = [], running = 0, runningLow = 0;
  const LOW_SLOTS = options.lowSlots ?? 1;   // 사전 내려받기는 동시 이만큼만(나머지 슬롯은 화면이 지금 필요한 파일 몫)

  const notify = () => { for (const listener of listeners) { try { listener({ ...progress, active: progress.pendingFiles > 0 }); } catch { /* 표시 실패가 로딩을 막지 않는다 */ } } };

  /** '/img/a.webp?x#t=3' -> { path: 'img/a.webp', fragment: '#t=3' }. 같은 출처 경로나 상대 경로만 받는다. */
  function normalize(input) {
    if (typeof input !== 'string' || !input) return null;
    let text = input, fragment = '';
    const hash = text.indexOf('#'); if (hash >= 0) { fragment = text.slice(hash); text = text.slice(0, hash); }
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
      if (!origin || !text.startsWith(origin + '/')) return null;
      text = text.slice(origin.length);
    } else if (text.startsWith('//')) return null;
    const query = text.indexOf('?'); if (query >= 0) text = text.slice(0, query);
    const path = text.replace(/^\/+/, '');
    if (!path || path.includes('..')) return null;
    return { path, fragment };
  }
  const remoteUrl = (path) => `${host}/${path}?v=${remote.get(path).h}`;

  function isRemote(input) { const n = enabled ? normalize(input) : null; return !!n && remote.has(n.path); }

  /** 동기 해석. remote 가 아니면 입력 그대로, 보관본이 있으면 blob URL, 없으면 호스트 URL(그리고 백그라운드로 보관 시작). */
  function assetUrl(input, { prefetch = true } = {}) {
    if (!enabled) return input;
    const n = normalize(input);
    if (!n || !remote.has(n.path)) return input;
    const blob = blobUrls.get(n.path);
    if (blob) return blob + n.fragment;
    if (prefetch && !inflight.has(n.path) && !((cooling.get(n.path) || 0) > now())) void ensure([n.path]).catch(() => {});
    return remoteUrl(n.path) + n.fragment;
  }

  async function openCache() {
    if (cache || !globalThis.caches && !options.caches) return cache;
    try { cache = await (options.caches ?? globalThis.caches).open(CACHE_NAME); } catch { cache = null; }
    return cache;
  }
  const cacheKey = (path) => remoteUrl(path);

  async function sha16(buffer) {
    if (!subtle) return null;
    try { return hex(await subtle.digest('SHA-256', buffer)).slice(0, manifest?.hashLength || 16); } catch { return null; }
  }

  async function download(path) {
    const entry = remote.get(path), url = remoteUrl(path);
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetchImpl(url, { mode: 'cors', credentials: 'omit', signal: controller?.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const type = response.headers?.get?.('content-type') || null;
        // 정식 호스트는 사라진 경로를 SPA 폴백(index.html, 200)으로 돌려줄 수 있다. 이미지·곡·모델 자리에 HTML 이 오면 실패다.
        if (/text\/html/i.test(type || '') && extOf(path) !== 'html') { stats.htmlResponses += 1; throw new Error('HTML response for a binary asset'); }
        const buffer = await response.arrayBuffer();
        stats.networkFetches += 1;
        // 내용 해시가 매니페스트와 다르면 다른 빌드의 파일이거나 폴백 문서이므로 쓰지도 보관하지도 않고 실패로 센다(재시도 뒤 RemoteAssetError).
        const actual = await sha16(buffer);
        if (actual && actual !== entry.h) { stats.hashMismatches += 1; throw new Error(`hash mismatch (host serves another build): ${path}`); }
        return { buffer, type };
      } catch (error) { last = error; }
      finally { if (timer) clearTimeout(timer); }
      if (attempt < retries) await wait(700 * (attempt + 1) ** 2);
    }
    throw new RemoteAssetError(path, last);
  }

  async function fromCache(path) {
    const store = await openCache(); if (!store) return null;
    try { const response = await store.match(cacheKey(path)); return response ? response : null; } catch { return null; }
  }
  const mimeFor = (path, type) => (type && !/octet-stream/i.test(type) ? type : MIME[extOf(path)] || 'application/octet-stream');

  function makeBlobUrl(path, buffer, type) {
    if (extOf(path) === 'glb' || extOf(path) === 'json') return;
    const previous = blobUrls.get(path); if (previous) return;
    try { blobUrls.set(path, urlApi.createObjectURL(new Blob([buffer], { type: mimeFor(path, type) }))); } catch { /* blob 을 못 만들면 호스트 URL 로 간다 */ }
  }

  /** 한 파일을 보관본 또는 네트워크에서 받아 보관한다. 같은 경로의 동시 요청은 하나로 합친다. */
  function fetchOne(path) {
    if (inflight.has(path)) return inflight.get(path);
    const entry = remote.get(path);
    const job = (async () => {
      const hit = await fromCache(path);
      if (hit && /text\/html/i.test(hit.headers?.get?.('content-type') || '') && extOf(path) !== 'html') { try { await (await openCache())?.delete(cacheKey(path)); } catch { /* 다음에 다시 치운다 */ } cachedPaths.delete(path); }
      else if (hit) {
        const buffer = await hit.arrayBuffer();
        stats.cacheHits += 1; cachedPaths.add(path);
        makeBlobUrl(path, buffer, hit.headers?.get?.('content-type'));
        return buffer;
      }
      progress.pendingFiles += 1; progress.pendingBytes += entry.b; progress.totalBytes += entry.b; notify();
      try {
        const { buffer, type } = await download(path);
        const store = await openCache();
        if (store) { try { await store.put(cacheKey(path), new Response(buffer.slice(0), { status: 200, headers: { 'content-type': mimeFor(path, type), 'content-length': String(buffer.byteLength) } })); cachedPaths.add(path); } catch { /* 저장 공간 부족이어도 이번 세션은 쓴다 */ } }
        makeBlobUrl(path, buffer, type);
        return buffer;
      } catch (error) { stats.failures += 1; progress.failed += 1; cooling.set(path, now() + 30000); throw error; }
      finally { progress.pendingFiles -= 1; progress.pendingBytes -= entry.b; progress.doneBytes += entry.b; if (progress.pendingFiles === 0) { progress.totalBytes = 0; progress.doneBytes = 0; } notify(); }
    })();
    inflight.set(path, job);
    job.then(() => inflight.delete(path), () => inflight.delete(path));
    return job;
  }

  function pump() {
    while (running < concurrency) {
      const index = queue.findIndex((task) => !task.low || runningLow < LOW_SLOTS);
      if (index < 0) break;
      const [task] = queue.splice(index, 1); running += 1; if (task.low) runningLow += 1;
      fetchOne(task.path).then(task.resolve, task.reject).finally(() => { running -= 1; if (task.low) runningLow -= 1; pump(); });
    }
  }
  const schedule = (path, priority) => new Promise((resolve, reject) => {
    if (priority === 'high') for (const queued of queue) if (queued.path === path) queued.low = false;
    const task = { path, resolve, reject, low: priority === 'low' };
    if (priority === 'high') queue.unshift(task); else queue.push(task);
    pump();
  });

  /** 경로들을 받아 보관한다. 실패한 경로는 failed 로 모은다(던지지 않는다). */
  async function ensure(inputs, { priority = 'high' } = {}) {
    const paths = [...new Set((Array.isArray(inputs) ? inputs : [inputs]).map((input) => normalize(input)?.path).filter((path) => path && remote.has(path)))];
    const failed = [];
    if (enabled) await Promise.all(paths.map((path) => {
      if (cachedPaths.has(path) && (blobUrls.has(path) || extOf(path) === 'glb')) return Promise.resolve();
      // 최근에 실패한 경로는 쉬는 동안 다시 부르지 않는다(실패로만 보고). 읽기 요청(readBuffer)은 로더가 자체 폴백을 쓰므로 쉬지 않는다.
      if (!inflight.has(path) && (cooling.get(path) || 0) > now()) { failed.push(path); return Promise.resolve(); }
      return schedule(path, priority).catch(() => { failed.push(path); });
    }));
    return { requested: paths.length, failed };
  }

  /** GLB 처럼 바이트가 필요한 로더용: 보관본 또는 네트워크. 실패하면 RemoteAssetError. */
  async function readBuffer(input) {
    const n = normalize(input);
    if (!enabled || !n || !remote.has(n.path)) throw new RemoteAssetError(String(input), new Error('not a remote asset'));
    return schedule(n.path, 'high');
  }

  function groupPaths(group) { return [...remote].filter(([, row]) => row.g === group).map(([path]) => path); }
  const isCached = (input) => { const n = normalize(input); return !!n && cachedPaths.has(n.path); };
  const groupCached = (group) => groupPaths(group).every((path) => cachedPaths.has(path));
  const groupBytes = (group) => groupPaths(group).reduce((sum, path) => sum + remote.get(path).b, 0);
  const prefetchGroup = (group) => ensure(groupPaths(group).filter((path) => !cachedPaths.has(path)), { priority: 'low' });

  async function init({ restoreBudgetMs = 1500 } = {}) {
    if (!STREAMING_CHANNELS.includes(channel)) return false;
    let loaded;
    try {
      const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      loaded = await response.json();
    } catch (error) { console.warn('asset manifest unavailable; remote streaming disabled', error); return false; }
    if (loaded?.schema !== 'blade-surge.asset-manifest.v1' || typeof loaded.remote !== 'object') { console.warn('asset manifest shape unexpected'); return false; }
    manifest = loaded; host = options.host ?? loaded.host ?? host;
    for (const [path, row] of Object.entries(loaded.remote)) remote.set(path, row);
    enabled = true;
    const store = await openCache();
    if (store) {
      // 이전 버전 보관본(해시가 바뀐 파일)을 치우고, 맞는 보관본을 읽어 둔다(이미지·곡·영상은 blob URL 로, GLB 는 필요할 때 읽는다).
      let keys = [];
      try { keys = await store.keys(); } catch { keys = []; }
      const wanted = new Map([...remote.keys()].map((path) => [remoteUrl(path), path]));
      const valid = [];
      for (const request of keys) {
        const path = wanted.get(request.url);
        if (path) { cachedPaths.add(path); valid.push(path); } else { stats.pruned += 1; try { await store.delete(request); } catch { /* 다음 실행에서 다시 치운다 */ } }
      }
      const restore = (async () => {
        const todo = valid.filter((path) => extOf(path) !== 'glb');
        for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(async (path) => {
          const response = await fromCache(path); if (!response) return;
          try { makeBlobUrl(path, await response.arrayBuffer(), response.headers?.get?.('content-type')); stats.restored += 1; } catch { /* 호스트 URL 로 간다 */ }
        }));
      })();
      // 복원이 오래 걸려도 부팅은 예산(restoreBudgetMs) 안에서 이어 간다. 남은 복원은 뒤에서 계속되고, 그동안 해석은 호스트 주소로 간다.
      let budget; await Promise.race([restore, new Promise((resolve) => { budget = setTimeout(resolve, restoreBudgetMs); })]); clearTimeout(budget);
    }
    return true;
  }

  /** remote 로 분류된 같은 출처 경로의 <img>/<video>/<audio>/<source> 로딩이 실패하면 호스트 주소로 한 번 다시 시도한다. */
  function installFallback(doc = globalThis.document) {
    if (!doc?.addEventListener) return () => {};
    const handler = (event) => {
      const el = event.target;
      if (!enabled || !el || !/^(IMG|VIDEO|AUDIO|SOURCE)$/.test(el.tagName) || el.dataset?.remoteFallback) return;
      const n = normalize(el.getAttribute('src'));
      if (!n || !remote.has(n.path)) return;
      el.dataset.remoteFallback = '1'; stats.fallbackHits += 1;
      el.setAttribute('src', assetUrl(el.getAttribute('src')));
      if (el.tagName === 'SOURCE') el.parentElement?.load?.();
    };
    doc.addEventListener('error', handler, true);
    return () => doc.removeEventListener('error', handler, true);
  }

  return {
    init, assetUrl, ensure, readBuffer, prefetchGroup, isRemote, isCached, groupCached, groupBytes, groupPaths, installFallback,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get enabled() { return enabled; }, get stats() { return stats; }, get progress() { return { ...progress }; }, get manifest() { return manifest; },
    get host() { return host; }, normalize,
  };
}

/** 앱 전체가 쓰는 하나의 인스턴스. */
export const remoteAssets = createRemoteAssets();
export const assetUrl = (input, options) => remoteAssets.assetUrl(input, options);
export const ensureAssets = (inputs, options) => remoteAssets.ensure(inputs, options);
export const readRemoteBuffer = (input) => remoteAssets.readBuffer(input);
export const isRemoteAsset = (input) => remoteAssets.isRemote(input);
