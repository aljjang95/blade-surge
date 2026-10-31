import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createRemoteAssets, RemoteAssetError } from '../src/platform/remote-assets.js';
import { rewriteCss, rewriteMarkup } from '../src/platform/remote-dom.js';
import { createPrefetcher, frontier, nextRegionGroup } from '../src/platform/remote-prefetch.js';

// 스트리밍 자산 해석기: 가짜 네트워크·Cache Storage 로 보관·복원·검증·재시도·사전 내려받기 정책을 시험한다.
const HOST = 'https://blade.tllhouse.com';
const sha16 = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const bodies: Record<string, string> = {
  'img/encounters/forge_captain.webp': 'forge-captain-bytes', 'bgm/regions/forge.ogg': 'forge-ogg-bytes', 'assets/hero_knight_t2-Ab12.glb': 'glb-bytes', 'img/expansion/ember_vault.webp': 'ember',
};
const groups: Record<string, string> = { 'img/encounters/forge_captain.webp': 'region-2', 'bgm/regions/forge.ogg': 'region-2', 'assets/hero_knight_t2-Ab12.glb': 'heroes-t2', 'img/expansion/ember_vault.webp': 'expeditions' };
const manifest = () => ({ schema: 'blade-surge.asset-manifest.v1', channel: 'googleplay', host: HOST, hashLength: 16, groups: {},
  core: { files: 1, bytes: 1 }, remote: Object.fromEntries(Object.entries(bodies).map(([path, text]) => [path, { h: sha16(text), b: text.length, g: groups[path] }])) });

class FakeCache {
  store = new Map<string, Response>();
  async match(url: string) { const hit = this.store.get(url); return hit ? hit.clone() : undefined; }
  async put(url: string, response: Response) { this.store.set(url, response); }
  async keys() { return [...this.store.keys()].map(url => ({ url })); }
  async delete(request: { url: string }) { return this.store.delete(request.url); }
}
const fakeCaches = (cache = new FakeCache()) => ({ cache, open: async () => cache }) as unknown as CacheStorage & { cache: FakeCache };

function setup({ caches = fakeCaches(), failures = 0, served = bodies, channel = 'googleplay' }: { caches?: any; failures?: number; served?: Record<string, string>; channel?: string } = {}) {
  const calls: string[] = []; let remaining = failures;
  const fetchImpl = async (url: string) => {
    if (url === '/asset-manifest.json') return new Response(JSON.stringify(manifest()));
    calls.push(url);
    if (remaining > 0) { remaining -= 1; throw new Error('offline'); }
    const path = url.slice(HOST.length + 1).split('?')[0];
    return path in served ? new Response(served[path], { headers: { 'content-type': 'application/octet-stream' } }) : new Response('nope', { status: 404 });
  };
  const urls: string[] = [];
  const assets = createRemoteAssets({ channel, fetchImpl: fetchImpl as any, caches, origin: 'https://localhost', wait: async () => {},
    urlApi: { createObjectURL: () => { const u = `blob:https://localhost/${urls.length}`; urls.push(u); return u; }, revokeObjectURL() {} } });
  return { assets, calls, caches, urls };
}

test('웹·앱인토스 채널은 켜지지 않고 모든 주소를 그대로 돌려준다', async () => {
  for (const channel of ['web', 'apps-in-toss']) {
    const { assets, calls } = setup({ channel });
    expect(await assets.init()).toBe(false);
    expect(assets.assetUrl('/img/encounters/forge_captain.webp')).toBe('/img/encounters/forge_captain.webp');
    expect(calls).toEqual([]);
  }
});

test('remote 가 아닌 주소는 그대로, remote 는 해시 쿼리가 붙은 호스트 주소로 해석한다(보관 전)', async () => {
  const { assets } = setup();
  expect(await assets.init()).toBe(true);
  expect(assets.assetUrl('/img/ui-crafted/x.webp')).toBe('/img/ui-crafted/x.webp');
  expect(assets.assetUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
  expect(assets.assetUrl('https://other.example/img/encounters/forge_captain.webp')).toBe('https://other.example/img/encounters/forge_captain.webp');
  const resolved = assets.assetUrl('/img/encounters/forge_captain.webp');
  expect(resolved).toBe(`${HOST}/img/encounters/forge_captain.webp?v=${sha16(bodies['img/encounters/forge_captain.webp'])}`);
  // 같은 출처 절대 주소, 조각(#t=)도 같은 방식으로 해석한다.
  expect(assets.assetUrl('https://localhost/bgm/regions/forge.ogg#t=5')).toBe(`${HOST}/bgm/regions/forge.ogg?v=${sha16(bodies['bgm/regions/forge.ogg'])}#t=5`);
});

test('ensure: 내려받아 해시를 검증하고 Cache Storage 에 보관하며, 같은 파일은 한 번만 받는다', async () => {
  const { assets, calls, caches } = setup();
  await assets.init();
  const result = await assets.ensure(['/img/encounters/forge_captain.webp', 'img/encounters/forge_captain.webp', '/bgm/regions/forge.ogg']);
  expect(result).toEqual({ requested: 2, failed: [] });
  expect(calls.length).toBe(2);
  expect([...caches.cache.store.keys()].sort()).toEqual([
    `${HOST}/bgm/regions/forge.ogg?v=${sha16(bodies['bgm/regions/forge.ogg'])}`, `${HOST}/img/encounters/forge_captain.webp?v=${sha16(bodies['img/encounters/forge_captain.webp'])}`]);
  // 보관된 이미지는 이제 blob URL 로 동기 해석된다(오프라인에서도 쓸 수 있다).
  expect(assets.assetUrl('/img/encounters/forge_captain.webp')).toMatch(/^blob:/);
  expect(assets.assetUrl('/bgm/regions/forge.ogg#t=1')).toMatch(/^blob:.*#t=1$/);
  expect(assets.stats.networkFetches).toBe(2);
});

test('두 번째 실행: 보관본을 복원해 네트워크 없이 blob 으로 해석하고, 낡은 해시 보관본은 지운다', async () => {
  const caches = fakeCaches();
  const first = setup({ caches });
  await first.assets.init(); await first.assets.ensure(['/img/encounters/forge_captain.webp', '/assets/hero_knight_t2-Ab12.glb']);
  caches.cache.store.set(`${HOST}/img/old.webp?v=deadbeefdeadbeef`, new Response('old'));
  caches.cache.store.set(`${HOST}/img/encounters/forge_captain.webp?v=0000000000000000`, new Response('stale hash'));
  const second = setup({ caches, failures: 99 });   // 네트워크는 전부 실패한다
  await second.assets.init();
  expect(second.assets.stats.pruned).toBe(2);
  expect(second.assets.assetUrl('/img/encounters/forge_captain.webp')).toMatch(/^blob:/);
  expect(second.calls).toEqual([]);
  // GLB 는 필요할 때 보관본에서 바이트를 읽는다.
  const buffer = await second.assets.readBuffer('/assets/hero_knight_t2-Ab12.glb');
  expect(new TextDecoder().decode(buffer)).toBe('glb-bytes');
  expect(second.calls).toEqual([]);
  expect(second.assets.stats.cacheHits).toBe(1);
});

test('오프라인에서 보관본이 없으면 RemoteAssetError 로 실패하고 암묵 재시도는 한동안 쉰다', async () => {
  const { assets, calls } = setup({ failures: 99 });
  await assets.init();
  await expect(assets.readBuffer('/assets/hero_knight_t2-Ab12.glb')).rejects.toBeInstanceOf(RemoteAssetError);
  expect(calls.length).toBe(3);   // 처음 + 재시도 2회
  const before = calls.length;
  assets.assetUrl('/img/expansion/ember_vault.webp');   // URL 을 묻는 것만으로 받기 시작하지만
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(calls.length).toBeGreaterThan(before);
  const failed = calls.length;
  assets.assetUrl('/img/expansion/ember_vault.webp'); assets.assetUrl('/img/expansion/ember_vault.webp');
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(calls.length).toBe(failed);   // 실패 직후 반복 호출은 네트워크를 다시 두드리지 않는다
});

test('일시 실패는 재시도로 복구하고, 호스트가 다른 빌드를 주면(해시 불일치) 실패로 처리해 쓰지도 보관하지도 않는다', async () => {
  const flaky = setup({ failures: 1 });
  await flaky.assets.init();
  expect((await flaky.assets.ensure(['/img/expansion/ember_vault.webp'])).failed).toEqual([]);
  const skew = setup({ served: { ...bodies, 'img/expansion/ember_vault.webp': 'DIFFERENT BUILD' } });
  await skew.assets.init();
  expect((await skew.assets.ensure(['/img/expansion/ember_vault.webp'])).failed).toEqual(['img/expansion/ember_vault.webp']);
  expect(skew.assets.stats.hashMismatches).toBe(3);   // 첫 시도 + 재시도 2회
  expect(skew.assets.stats.failures).toBe(1);
  expect(skew.caches.cache.store.size).toBe(0);
  expect(skew.urls.length).toBe(0);
  await expect(skew.assets.readBuffer('/img/expansion/ember_vault.webp')).rejects.toBeInstanceOf(RemoteAssetError);
});

test('호스트가 사라진 remote 경로를 SPA 폴백(text/html 200)으로 돌려줘도 실패로 처리한다', async () => {
  const fetchImpl = async (url: string) => (url === '/asset-manifest.json' ? new Response(JSON.stringify(manifest()))
    : new Response('<!doctype html><title>app</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const caches = fakeCaches();
  const assets = createRemoteAssets({ channel: 'googleplay', fetchImpl: fetchImpl as any, caches, origin: 'https://localhost', wait: async () => {}, urlApi: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } });
  await assets.init();
  expect((await assets.ensure(['/img/encounters/forge_captain.webp'])).failed).toEqual(['img/encounters/forge_captain.webp']);
  expect(assets.stats.htmlResponses).toBe(3);
  expect(caches.cache.store.size).toBe(0);
});

test('보관본이 있지만 blob 이 아직 없으면 assetUrl 이 ensure 로 보관본을 읽는다(네트워크 없이)', async () => {
  const caches = fakeCaches();
  const first = setup({ caches }); await first.assets.init();
  await first.assets.ensure(['/img/encounters/forge_captain.webp']);
  const callsBefore = first.calls.length;
  // 복원이 부팅 예산에 못 닿은 상황: 보관본 목록은 알지만 blob 은 없다.
  const slow = Object.assign(Object.create(caches.cache), { match: async (url: string) => { await new Promise(resolve => setTimeout(resolve, 30)); return caches.cache.match(url); } });
  const second = setup({ caches: { open: async () => slow } }); await second.assets.init({ restoreBudgetMs: 0 });
  const url = second.assets.assetUrl('/img/encounters/forge_captain.webp');
  expect(url.startsWith(HOST)).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(second.calls.length).toBe(0);
  expect(second.assets.assetUrl('/img/encounters/forge_captain.webp').startsWith('blob:')).toBe(true);
  expect(callsBefore).toBeGreaterThan(0);
});

test('낮은 우선순위(사전 내려받기)는 동시 1개만 쓰고 높은 우선순위 슬롯을 비워 둔다', async () => {
  let active = 0, peakLow = 0; const release: (() => void)[] = [];
  const fetchImpl = async (url: string) => {
    if (url === '/asset-manifest.json') return new Response(JSON.stringify(manifest()));
    active += 1; peakLow = Math.max(peakLow, active);
    await new Promise<void>(resolve => release.push(resolve)); active -= 1;
    const path = url.slice(HOST.length + 1).split('?')[0];
    return new Response(bodies[path], { headers: { 'content-type': 'application/octet-stream' } });
  };
  const assets = createRemoteAssets({ channel: 'googleplay', fetchImpl: fetchImpl as any, caches: fakeCaches(), origin: 'https://localhost', wait: async () => {}, urlApi: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } });
  await assets.init();
  const lowDone = assets.ensure(['/img/encounters/forge_captain.webp', '/bgm/regions/forge.ogg', '/img/expansion/ember_vault.webp'], { priority: 'low' });
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(peakLow).toBe(1);
  const high = assets.ensure(['/assets/hero_knight_t2-Ab12.glb']);   // 화면이 지금 필요한 파일은 낮은 우선순위가 밀려도 바로 받는다
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(peakLow).toBe(2);
  while (release.length || active) { release.shift()?.(); await new Promise(resolve => setTimeout(resolve, 2)); }
  await Promise.all([lowDone, high]);
});

test('ensure 도 실패 직후 쉬는 경로는 다시 받지 않는다', async () => {
  const { assets, calls } = setup({ failures: 3 });
  await assets.init();
  expect((await assets.ensure(['/img/expansion/ember_vault.webp'])).failed.length).toBe(1);
  const n = calls.length;
  expect((await assets.ensure(['/img/expansion/ember_vault.webp'])).failed.length).toBe(1);
  expect(calls.length).toBe(n);
});

test('진행 표시: 받는 동안 active 이고 끝나면 꺼진다. 묶음 사전 내려받기는 보관된 파일을 건너뛴다', async () => {
  const { assets, calls } = setup();
  await assets.init();
  const states: boolean[] = [];
  assets.subscribe((state: any) => states.push(state.active));
  expect(assets.groupCached('region-2')).toBe(false);
  await assets.ensure(['/img/encounters/forge_captain.webp']);
  const before = calls.length;
  const result = await assets.prefetchGroup('region-2');
  expect(result.requested).toBe(1);        // forge.ogg 만 남아 있었다
  expect(calls.length).toBe(before + 1);
  expect(assets.groupCached('region-2')).toBe(true);
  expect(states[0]).toBe(true); expect(states.at(-1)).toBe(false);
});

test('DOM 문자열 변환: src="…"·poster·url(…) 의 remote 경로만 바꾼다', () => {
  const resolve = (value: string) => (value.startsWith('/img/encounters/') ? 'https://h' + value : value);
  expect(rewriteMarkup('<img src="/img/encounters/a.webp"><img src=\'/img/ui/x.webp\'>', resolve)).toBe('<img src="https://h/img/encounters/a.webp"><img src=\'/img/ui/x.webp\'>');
  expect(rewriteCss('linear-gradient(#000,#111),url(\'/img/encounters/a.webp\')', resolve)).toBe('linear-gradient(#000,#111),url(\'https://h/img/encounters/a.webp\')');
  expect(rewriteMarkup('<p>/img/encounters/a.webp</p>', resolve)).toBe('<p>/img/encounters/a.webp</p>');
});

test('사전 내려받기 정책: X-8 에서 다음 지역을, 와이파이에서 한가할 때 나머지를 받고, 데이터 절약 모드는 받지 않는다', async () => {
  expect(frontier({ unlocked: 18 })).toEqual({ chapter: 2, stage: 8 });
  expect(nextRegionGroup({ unlocked: 7 })).toBe(null);
  expect(nextRegionGroup({ unlocked: 8 })).toBe('region-2');
  expect(nextRegionGroup({ unlocked: 18 })).toBe('region-3');
  expect(nextRegionGroup({ unlocked: 28 })).toBe('region-4');
  expect(nextRegionGroup({ unlocked: 58 })).toBe('region-7');   // 6지역 다음은 7지역(아직 묶음 파일이 없어도 이름은 만든다)
  expect(nextRegionGroup({ unlocked: 68 })).toBe(null);   // 7지역 다음은 없다
  const run = async (connection: any, unlocked: number) => {
    const { assets } = setup(); await assets.init();
    const asked: string[] = [];
    const fake = { enabled: true, groupCached: () => false, prefetchGroup: async (group: string) => { asked.push(group); return { requested: 1, failed: [] }; } };
    const prefetcher = createPrefetcher(fake as any, { nav: { connection } as any, idle: fn => { void fn(); } });
    prefetcher.onLobby({ unlocked });
    await new Promise(resolve => setTimeout(resolve, 10));
    return asked;
  };
  expect(await run({ type: 'cellular' }, 8)).toEqual(['early-music', 'starter-village', 'item-icons', 'region-2']);   // 셀룰러: 첫 보스 곡·초보자 마을 소품·장비 아이콘 묶음 + X-8 에서 다음 지역만
  expect(await run({ type: 'cellular' }, 3)).toEqual(['early-music', 'starter-village', 'item-icons']);               // 아직 X-8 전이면 첫 보스 곡·마을 소품·장비 아이콘만
  expect((await run({ type: 'wifi' }, 3)).slice(0, 4)).toEqual(['early-music', 'starter-village', 'item-icons', 'region-2']);   // 와이파이: 한가할 때 다음 지역부터 순서대로
  expect((await run({ type: 'wifi' }, 3)).length).toBeGreaterThan(4);
  expect(await run({ type: 'wifi', saveData: true }, 8)).toEqual([]);   // 데이터 절약 모드는 첫 보스 곡·마을 소품도 받지 않는다
});

test('assetUrl({ prefetch: false }) 는 호스트 주소만 돌려주고 보관용 내려받기를 시작하지 않는다(BGM 이중 다운로드 방지)', async () => {
  const { assets, calls } = setup();
  await assets.init();
  expect(assets.assetUrl('/bgm/regions/forge.ogg', { prefetch: false })).toBe(`${HOST}/bgm/regions/forge.ogg?v=${sha16(bodies['bgm/regions/forge.ogg'])}`);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(calls).toEqual([]);
});

test('사전 내려받기: 실패한 묶음은 쉬었다가(30초, 60초, …) 다시 받고 그 사이 로비 재진입은 두드리지 않는다', async () => {
  let clock = 0, asked = 0;   // 로비 진입마다 바로 받는 묶음이 셋(early-music, starter-village, item-icons)이라 시도 횟수는 3의 배수로 센다
  const fake = { enabled: true, groupCached: () => false, prefetchGroup: async () => { asked += 1; return { requested: 1, failed: ['x'] }; } };
  const prefetcher = createPrefetcher(fake as any, { nav: { connection: { type: 'cellular' } } as any, idle: fn => { void fn(); }, now: () => clock });
  const lobby = async () => { prefetcher.onLobby({ unlocked: 3 }); await new Promise(resolve => setTimeout(resolve, 5)); };
  await lobby(); expect(asked).toBe(3);
  await lobby(); expect(asked).toBe(3);          // 쉬는 중
  clock = 31000; await lobby(); expect(asked).toBe(6);
  clock = 31000 + 59000; await lobby(); expect(asked).toBe(6);   // 두 번째 실패 뒤 60초 쉼
  clock = 31000 + 61000; await lobby(); expect(asked).toBe(9);
});
