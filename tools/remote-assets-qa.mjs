// 스트리밍 자산 실측(lane f7-stream): APK 와 같은 폴더(remote 제외)를 Capacitor 출처(https://localhost)로 서빙하고, 정식 호스트(https://blade.tllhouse.com)는
// 로컬 web dist 로 대신 응답한다(public/_headers 의 CORS 규칙을 그대로 적용). 제목 → 로비 → 1-1 → (시드 저장) 2지역 마을 → 소환 화면을 지나며
// 404/CORS 오류가 없는지, 두 번째 로드(호스트 오프라인)가 보관본으로 뜨는지 확인한다. 렌더는 소프트웨어(SwiftShader)이며 실기기 증거가 아니다.
// 사용: node tools/remote-assets-qa.mjs [out=work/remote-assets-qa] [apk-web=work/store-builds/googleplay/web] [host-dist=dist]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const out = path.resolve(process.argv[2] || 'work/remote-assets-qa');
const apkDir = path.resolve(process.argv[3] || 'work/store-builds/googleplay/web');
const hostDir = path.resolve(process.argv[4] || 'dist');
const APP = 'https://localhost', HOST = 'https://blade.tllhouse.com';
await fs.mkdir(out, { recursive: true });
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml',
  glb: 'model/gltf-binary', mp3: 'audio/mpeg', ogg: 'audio/ogg', mp4: 'video/mp4', woff2: 'font/woff2', webmanifest: 'application/manifest+json', txt: 'text/plain' };
const report = { started: new Date().toISOString(), viewport: '844x390 dsf2 touch', checks: [], phases: {}, errors: [], shots: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); };

// public/_headers 에서 경로별 응답 헤더를 읽는다(배포 설정과 같은 규칙으로 CORS·캐시를 흉내 낸다).
const headerRules = [];
{
  let current = null;
  for (const line of (await fs.readFile(new URL('../public/_headers', import.meta.url), 'utf8')).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = { re: new RegExp('^' + line.trim().replace(/\*/g, '.*') + '$'), headers: {} }; headerRules.push(current); }
    else { const [k, ...v] = line.trim().split(':'); current.headers[k.trim().toLowerCase()] = v.join(':').trim(); }
  }
}
const headersFor = (pathname) => Object.assign({}, ...headerRules.filter((rule) => rule.re.test(pathname)).map((rule) => rule.headers));

// 로비 진입 때 백그라운드로 받는 첫 보스 곡 묶음(early-music)만 부팅·1-1 구간의 허용 호스트 요청이다(화면·모델·일러스트는 전부 core 여야 한다).
const EARLY = new Set(['/bgm/regions/boss.ogg', '/bgm/expansion/flow-combat.mp3']);
const unexpectedHost = () => log.host.filter((r) => !EARLY.has(r.path.split('?')[0]));
const log = { local: [], host: [], hostOffline: false, hostDelay: 0, bad: [] };
async function serve(route, root, label, request) {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"qa-mock"}' });
  if (label === 'host' && log.hostDelay) await new Promise((resolve) => setTimeout(resolve, log.hostDelay));
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.join(root, rel);
  if (!file.startsWith(root)) return route.fulfill({ status: 403, body: '' });
  let bytes;
  try { bytes = await fs.readFile(file); } catch {
    log.bad.push(`${label} 404 ${url.pathname}`); log[label].push({ path: url.pathname, status: 404 });
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  }
  const ext = rel.split('.').pop();
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'accept-ranges': 'bytes', ...headersFor(url.pathname) };
  if (label === 'host') {
    // 다른 출처로 보내는 요청이므로 CORS 규칙을 브라우저처럼 검사하도록 Origin 을 확인하고, 허용 출처가 아니면 헤더를 붙이지 않는다.
    const origin = request.headers().origin;
    if (origin && headers['access-control-allow-origin'] !== origin) delete headers['access-control-allow-origin'];
  }
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers().range || '');
  let status = 200, body = bytes;
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], bytes.length - 1) : bytes.length - 1;
    status = 206; body = bytes.subarray(start, end + 1); headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`;
  }
  log[label].push({ path: url.pathname + url.search, status, bytes: body.length });
  return route.fulfill({ status, headers, body });
}

const browser = await chromium.launch(launchOpts());
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
await context.route(`${APP}/**`, (route, request) => serve(route, apkDir, 'local', request));
await context.route(`${HOST}/**`, (route, request) => (log.hostOffline && !new URL(request.url()).pathname.startsWith('/api/')
  ? route.abort('internetdisconnected') : serve(route, hostDir, 'host', request)));

const KEY = 'bladesurge_save_v1';
const today = Math.floor(Date.now() / 86400000);
const base = { heroes: { knight: { level: 45 } }, tutorial: { completed: true }, daily: { day: 0, last: today } };
const stars = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${1 + Math.floor(i / 10)}-${(i % 10) + 1}`, 3]));
const seeds = {
  fresh: { ...base, progress: { unlocked: 1, stars: {}, difficulty: 'story' } },
  town2: { ...base, progress: { unlocked: 11, stars: stars(10), difficulty: 'story' }, campaignTown: { current: 1, celebrated: 2 },
    avatars: { owned: ['avatar_knight_sakura'], equipped: { knight: 'avatar_knight_sakura' } } },
};

async function newPage(name, seed) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${name}: pageerror ${String(e).slice(0, 240)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/qa-mock|\/api\//.test(m.text())) errors.push(`${name}: ${m.text().slice(0, 240)}`); });
  page.on('requestfailed', (r) => { if (!/\/api\//.test(r.url())) errors.push(`${name}: requestfailed ${r.url().slice(0, 120)} ${r.failure()?.errorText}`); });
  await page.addInitScript(([key, data]) => { if (!sessionStorage.getItem('qa-seeded')) { localStorage.setItem(key, JSON.stringify(data)); sessionStorage.setItem('qa-seeded', '1'); } }, [KEY, seed]);
  const shot = async (label) => { const file = `${name}-${label}.png`; await page.screenshot({ path: path.join(out, file), timeout: 120000 }); report.shots.push(file); };
  const tap = async (selector, timeout = 20000) => {
    const target = page.locator(selector).first();
    try { await target.tap({ timeout }); } catch (error) {
      if (/performing tap action/.test(String(error.message))) { await page.waitForTimeout(800); return; }
      const box = await target.boundingBox(); if (!box) throw error; await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
  };
  const boot = async () => {
    const started = Date.now();
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
    const bootMs = Date.now() - started;
    await tap('#boot-start');
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), undefined, { timeout: 180000 });
    await page.waitForTimeout(1500);
    for (let n = 0; n < 4; n++) { if (!await page.locator('#modal.show #m-cancel').isVisible().catch(() => false)) break; await tap('#modal.show #m-cancel'); await page.waitForTimeout(300); }
    return bootMs;
  };
  const stats = () => page.evaluate(() => { const r = window.__remoteAssets; return r ? { enabled: r.enabled, ...r.stats, progress: r.progress } : null; });
  return { page, errors, shot, tap, boot, stats };
}
const openMenuTab = async (t, tab) => { await t.tap('#meta .oath-nav-menu'); await t.page.waitForTimeout(500); await t.tap(`#oath-menu [data-tab="${tab}"]`); await t.page.waitForTimeout(900);
  if ((await t.page.evaluate(() => window.app.meta.tab)) !== tab) await t.page.evaluate((x) => window.app.meta.openTab(x), tab); };
const snapshot = () => ({ local: log.local.length, host: log.host.length, bad: log.bad.length });

try {
  // ===== A. 콜드 스타트: 제목 → 로비 → 1-1 =====
  const a = await newPage('A-cold', seeds.fresh);
  const bootMs = await a.boot();
  const aBoot = await a.stats();
  check('스트리밍이 켜지고(googleplay 빌드) 매니페스트를 읽었다', aBoot?.enabled === true, aBoot);
  const apkFetchedRemote = log.local.filter((r) => /^\/(bgm\/regions\/(forge|frost|tide|crown|homecoming|arena)|assets\/(hero_.*_t[23]|avatar_)|video\/)/.test(r.path));
  check('부팅 중 APK 쪽에는 remote 파일을 한 번도 요청하지 않았다', apkFetchedRemote.length === 0, apkFetchedRemote.slice(0, 3));
  check('부팅 중 정식 호스트 요청이 없다(첫 화면은 전부 core)', unexpectedHost().length === 0, unexpectedHost().map((r) => r.path.split('?')[0]));
  await a.shot('01-lobby');
  await openMenuTab(a, 'stage'); await a.page.waitForTimeout(600);
  await a.shot('02-campaign-1');
  await a.tap('#stage-grid [data-stage="1-1"]'); await a.page.waitForTimeout(400);
  await a.shot('03-stage-1-1-detail');
  await a.tap('#st-go'); await a.page.waitForTimeout(600);
  await a.page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 240000 });
  await a.page.evaluate(() => { const app = window.app; app.testPause = true; app.battle.player.auto = true; app.ui.closeModal?.(); for (let i = 0; i < 420; i++) app.step(1 / 60, i === 419); });
  await a.shot('04-battle-1-1');
  const aBattle = await a.page.evaluate(() => ({ active: window.app.battle.active, kills: window.app.battle.kills }));
  check('1-1 전투가 열리고 진행된다', aBattle.active, aBattle);
  check('1-1 까지 정식 호스트 요청과 로컬 404 가 없다', unexpectedHost().length === 0 && log.bad.length === 0, { ...snapshot(), host: log.host.map((r) => r.path.split('?')[0]), bad: log.bad.slice(0, 3) });
  await a.page.evaluate(() => { window.app.testPause = false; window.app.toLobby(); });
  await a.page.waitForFunction(() => window.app.mode === 'lobby', null, { timeout: 60000 });
  report.phases.A = { bootMs, requests: snapshot(), stats: await a.stats(), hostPaths: log.host.map((r) => r.path.split('?')[0] + ' ' + r.status) };

  // ===== B. 2지역 마을(시드 저장) → 지역 곡·일러스트·아바타 몸체가 정식 호스트에서 내려온다 =====
  await a.page.evaluate(([key, data]) => { localStorage.setItem(key, JSON.stringify(data)); sessionStorage.setItem('qa-seeded', '1'); }, [KEY, seeds.town2]);
  const hostBefore = log.host.length;
  const b = a;
  const bootB = await b.boot();   // 같은 페이지를 다시 연다(보관소는 컨텍스트에 남는다)
  await b.shot('05-lobby-town1-avatar');
  const afterBoot = await b.stats();
  const avatarPath = log.host.slice(hostBefore).find((r) => /avatar_knight_sakura/.test(r.path));
  check('아바타 몸체(GLB, remote)를 정식 호스트에서 받아 로비에 적용했다', !!avatarPath || afterBoot.cacheHits > 0, { avatarPath, stats: afterBoot });
  const body = await b.page.evaluate(() => window.app.showcase?.root?.userData?.libraryBodyAssetId || null);
  check('로비 영웅이 아바타 몸체를 입고 있다', body === 'avatar_knight_sakura', body);
  // 마을 칩 → 2지역 마을
  await b.tap('#campaign-town-chip'); await b.page.waitForTimeout(500);
  await b.tap('#campaign-town-menu [data-town="2"]'); await b.page.waitForTimeout(2500);
  await b.shot('06-town2');
  const town = await b.page.evaluate(() => ({ chip: document.querySelector('#campaign-town-chip')?.textContent, state: window.app.eco.campaignTownState() }));
  check('2지역 마을로 바뀐다', /불씨 용광로 마을/.test(town.chip) && town.state.current === 2, town);
  await b.page.waitForTimeout(2500);
  const forgeReq = log.host.filter((r) => /bgm\/regions\/forge\.ogg/.test(r.path));
  check('2지역 마을 곡(forge.ogg)을 정식 호스트에서 받았다', forgeReq.length >= 1, forgeReq.slice(0, 2));
  // 캠페인 2지역: 조우 일러스트
  await openMenuTab(b, 'stage'); await b.tap('#chapter-tabs [data-ch="2"]'); await b.page.waitForTimeout(1500);
  await b.tap('#stage-grid [data-stage="2-1"]'); await b.page.waitForTimeout(1800);
  await b.shot('07-campaign-2-detail');
  const art = await b.page.evaluate(() => [...document.querySelectorAll('#meta img')].filter((i) => /encounters|keyart/.test(i.currentSrc || i.src) || /^blob:/.test(i.currentSrc || i.src))
    .map((i) => ({ src: (i.currentSrc || i.src).slice(0, 80), ok: i.complete && i.naturalWidth > 0, broken: i.complete && i.naturalWidth === 0 })));
  check('2지역 조우 일러스트가 보인다(깨진 이미지 없음)', art.length > 0 && art.every((x) => !x.broken), art.filter((x) => x.broken));
  const encReq = log.host.filter((r) => /img\/(encounters|ui-crafted\/keyart)\/forge/.test(r.path));
  check('2지역 일러스트·키아트를 정식 호스트에서 받았다', encReq.length >= 1, encReq.slice(0, 3));
  // 소환 화면
  await openMenuTab(b, 'gacha'); await b.page.waitForTimeout(1500);
  await b.shot('08-gacha');
  const gacha = await b.page.evaluate(() => ({ tab: window.app.meta.tab, banner: document.querySelector('#banner-art')?.complete && document.querySelector('#banner-art')?.naturalWidth > 0, bannerSrc: document.querySelector('#banner-art')?.currentSrc }));
  check('소환 화면이 열리고 배너가 보인다', gacha.tab === 'gacha' && gacha.banner, gacha);
  await b.page.waitForTimeout(1500);
  const bStats = await b.stats();
  report.phases.B = { bootMs: bootB, requests: snapshot(), stats: bStats, hostRequests: log.host.slice(hostBefore).map((r) => r.path + ' ' + r.status).slice(0, 60) };
  check('진행 중 로컬 404·호스트 404 가 없다', log.bad.length === 0, log.bad.slice(0, 5));
  check('폴백 보정(오류 후 재시도)이 한 번도 필요하지 않았다', bStats.fallbackHits === 0, bStats);
  check('내려받은 파일이 보관됐다', bStats.networkFetches > 0 && bStats.failures === 0, bStats);
  const cacheKeys = await b.page.evaluate(async () => (await (await caches.open('blade-remote-assets-v1')).keys()).map((r) => r.url.replace(location.origin, '')));
  check('Cache Storage 에 해시 키로 보관됐다', cacheKeys.length >= bStats.networkFetches && cacheKeys.every((u) => /\?v=[0-9a-f]{16}$/.test(u)), cacheKeys.length);
  await b.page.close();

  // ===== C. 웜 스타트 + 호스트 오프라인: 보관본에서 뜬다 =====
  log.hostOffline = true;
  const hostCountBefore = log.host.length;
  const c = await newPage('C-warm-offline', seeds.town2);
  const bootC = await c.boot();
  const cBody = await c.page.evaluate(() => window.app.showcase?.root?.userData?.libraryBodyAssetId || null);
  check('호스트가 끊긴 두 번째 실행에서도 아바타 몸체(보관본)로 로비가 뜬다', cBody === 'avatar_knight_sakura', cBody);
  await c.page.evaluate(() => window.app.eco.setCampaignTown(2)); await c.page.waitForTimeout(2500);
  await openMenuTab(c, 'stage'); await c.tap('#chapter-tabs [data-ch="2"]'); await c.page.waitForTimeout(1200);
  await c.tap('#stage-grid [data-stage="2-1"]'); await c.page.waitForTimeout(1800);
  await c.shot('09-offline-campaign-2');
  const art2 = await c.page.evaluate(() => [...document.querySelectorAll('#meta img')].filter((i) => /encounters|keyart/.test(i.currentSrc || i.src) || /^blob:/.test(i.currentSrc || i.src))
    .map((i) => ({ src: (i.currentSrc || i.src).slice(0, 60), ok: i.complete && i.naturalWidth > 0, broken: i.complete && i.naturalWidth === 0 })));
  check('오프라인에서도 2지역 일러스트가 보관본으로 보인다(깨진 이미지 없음)', art2.length > 0 && art2.every((x) => !x.broken), art2.filter((x) => x.broken));
  await openMenuTab(c, 'gacha'); await c.page.waitForTimeout(1200);
  await c.shot('10-offline-gacha');
  const cStats = await c.stats();
  report.phases.C = { bootMs: bootC, stats: cStats, hostRequestsWhileOffline: log.host.length - hostCountBefore };
  check('두 번째 로드는 네트워크 내려받기 0건, 모두 보관본', cStats.networkFetches === 0 && cStats.cacheHits > 0 && cStats.failures === 0, cStats);
  check('두 번째 로드에서 정식 호스트로 나간 성공 응답이 없다', log.host.length === hostCountBefore, log.host.slice(hostCountBefore, hostCountBefore + 3));

  // ===== D. 내려받는 동안 표시: 호스트를 느리게 만들어 로비·전투에서 가장자리 표시가 플레이 영역을 가리지 않는지 본다 =====
  log.hostOffline = false; log.hostDelay = 9000;
  await c.page.evaluate(() => window.app.toLobby?.());
  void c.page.evaluate(() => window.__remoteAssets.prefetchGroup('region-4')).catch(() => {});
  await c.page.waitForTimeout(1600);
  await c.shot('11-indicator-lobby');
  const dockLobby = await c.page.evaluate(() => { const n = document.querySelector('.remote-dl'); if (!n || n.hidden) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: n.textContent, pe: getComputedStyle(n).pointerEvents }; });
  check('내려받는 동안 가장자리 표시가 뜬다(입력을 막지 않는다)', !!dockLobby && dockLobby.pe === 'none' && dockLobby.y <= 2, dockLobby);
  await c.page.evaluate(() => { window.app.eco.s.energy = 100; window.app.startStage(window.__stageDef(1, 1)); });
  await c.page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 240000 });
  await c.page.evaluate(() => { const app = window.app; app.testPause = true; app.battle.player.auto = true; app.ui.closeModal?.(); for (let i = 0; i < 240; i++) app.step(1 / 60, i === 239); });
  // 전투가 뜨는 사이 낡은 요청이 끝났을 수 있어 전투 화면에서 새 묶음을 내려받게 하고 표시가 뜬 뒤에 잰다.
  void c.page.evaluate(() => window.__remoteAssets.prefetchGroup('region-5')).catch(() => {});
  await c.page.waitForTimeout(1600);
  await c.shot('12-indicator-battle');
  // 전투 중에는 위쪽 중앙 WAVE 표시와 겹치지 않게 띠를 숨긴다(내려받기는 계속된다).
  const dockBattle = await c.page.evaluate(() => { const n = document.querySelector('.remote-dl'); return n ? { display: getComputedStyle(n).display, battleClass: n.classList.contains('remote-dl-battle'), downloading: window.__remoteAssets.progress.pendingFiles } : null; });
  check('전투 중에는 내려받기 띠가 숨고(HUD 와 겹치지 않음) 내려받기는 계속된다', !!dockBattle && dockBattle.display === 'none' && dockBattle.battleClass && dockBattle.downloading > 0, dockBattle);
  log.hostDelay = 0;
  report.errors.push(...a.errors, ...c.errors);
} catch (error) {
  check('QA 실행 중 예외 없음', false, String(error.stack || error).slice(0, 600));
}
const fatal = report.errors.filter((e) => /CORS|ERR_BLOCKED|Failed to load resource: net::ERR_FAILED|cross-origin|Access to /i.test(e));
check('CORS 오류가 없다', fatal.length === 0, fatal.slice(0, 3));
check('페이지 오류가 없다', !report.errors.some((e) => /pageerror/.test(e)), report.errors.filter((e) => /pageerror/.test(e)).slice(0, 3));
report.log = { local: log.local.length, host: log.host.length, bad: log.bad };
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
await browser.close();
const failed = report.checks.filter((c) => !c.ok);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} 통과`, failed.length ? '실패: ' + failed.map((c) => c.name).join(' | ') : '');
process.exit(failed.length ? 1 : 0);
