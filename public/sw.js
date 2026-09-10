/* Replaced only in dist by write-version.mjs. The source worker is never registered in dev. */
const RELEASE = '__BLADE_PWA_RELEASE__';
const PREFIX = 'blade-surge-pwa-';
const SHELL = `${PREFIX}${RELEASE}-shell`, RUNTIME = `${PREFIX}${RELEASE}-runtime`;
const SHELL_URLS = ['/offline.html', '/manifest.webmanifest', '/img/icon.png'];
const MAX_ENTRIES = 24, MAX_BYTES = 1024 * 1024;
let cacheQueue = Promise.resolve();

function publicAsset(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin && !url.search &&
    !request.headers.has('authorization') && !request.headers.has('range') &&
    /^\/(?:assets|img|models|audio)\/.+\.(?:js|css|png|webp|jpg|jpeg|svg|woff2|glb|gltf|mp3|ogg|wav)$/i.test(url.pathname);
}
async function remember(request, response) {
  if (!response.ok || response.status !== 200 || response.type === 'opaque' || response.headers.has('set-cookie') ||
      /no-store|private/i.test(response.headers.get('cache-control') || '')) return;
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) return;
  const reader = response.clone().body?.getReader();
  let bytes = 0;
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) { reader.cancel().catch(() => {}); return; }
    }
  }
  // Serialize eviction so parallel image requests cannot overrun the count budget.
  cacheQueue = cacheQueue.catch(() => {}).then(async () => {
    const cache = await caches.open(RUNTIME);
    await cache.delete(request);
    await cache.put(request, response);
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
  });
  await cacheQueue;
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_URLS.map(url => new Request(url, { cache: 'reload' })))));
  // No skipWaiting: an open game keeps its current worker until an explicit update or next launch.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== SHELL && key !== RUNTIME) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never intercept APIs, identity, billing, redirects into a login, or version checks.
  if (url.pathname.startsWith('/api/') || /\/(?:auth|login|logout|checkout|purchase|payment)(?:\/|$)/i.test(url.pathname) || url.pathname === '/version.json') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(SHELL)).match('/offline.html')));
    return;
  }
  if (!publicAsset(request)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.redirected) return response;
      event.waitUntil(remember(request, response.clone()).catch(() => {}));
      return response;
    } catch (error) {
      const cached = await (await caches.open(RUNTIME)).match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
