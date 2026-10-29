// 인앱 브라우저(Threads·Instagram·카카오톡·네이버 앱 안 브라우저) 조작 품질 하네스.
// 모바일 Chromium 프로필 + 인앱 UA + 앱 바로 줄어든 뷰포트에서 CDP 터치(Input.dispatchTouchEvent)로 실제 입력을 넣고
// 조이스틱·멀티터치·하단 HUD 배치·소리 재개를 숫자로 판정한다. 실기기 WebView 확인을 대신하지 않는다.
// 사용: bun run qa:inapp            (빌드 산출물 dist 를 vite preview 로 띄워 검사)
//       node tools/qa/inapp-touch.mjs --origin=https://blade.tllhouse.com [--full] [--out=work/qa/inapp-<시각>]
//       --full: UA 4종 × 뷰포트 4종 전부(기본은 뷰포트마다 UA 하나씩 4회)
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S948N Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36';
export const IN_APP_UAS = {
  threads: `${ANDROID} Barcelona 390.0.0.28.85 Android (35/15; 450dpi; 1080x2340; samsung; SM-S948N; e3q; qcom; ko_KR; 812345678)`,
  instagram: `${ANDROID} Instagram 390.0.0.43.81 Android (35/15; 450dpi; 1080x2340; samsung; SM-S948N; e3q; qcom; ko_KR; 812345679)`,
  kakaotalk: `${ANDROID} KAKAOTALK/25.9.1 (INAPP)`,
  naver: `${ANDROID} NAVER(inapp; search; 2000; 12.10.3)`,
};
// 세로 두 종은 하단 앱 바·툴바가 차지한 뒤의 높이, 가로는 상태 표시줄을 뺀 높이.
export const IN_APP_VIEWPORTS = [{ width: 390, height: 700 }, { width: 360, height: 640 }, { width: 844, height: 390 }, { width: 390, height: 844 }];
const BAR = 56; // 인앱 브라우저가 스크롤·터치 때 접었다 펴는 앱 바 높이(대략)

function plan() {
  const uas = Object.keys(IN_APP_UAS);
  if (flag('full')) return IN_APP_VIEWPORTS.flatMap(viewport => uas.map(ua => ({ ua, viewport })));
  const runs = IN_APP_VIEWPORTS.map((viewport, i) => ({ ua: uas[i % uas.length], viewport }));
  return arg('limit') ? runs.slice(0, Number(arg('limit'))) : runs;
}

// 페이지 시작 전에 설치: 페이지 기본 동작(스크롤·당겨서 새로고침)이 일어났는지 window 버블 단계에서 기록한다.
const PROBE = `(() => {
  const p = window.__inappProbe = { touchmoves: 0, unprevented: 0, scroll: 0, pointercancel: 0, resize: 0, vvResize: 0 };
  addEventListener('touchmove', e => { p.touchmoves++; if (e.cancelable && !e.defaultPrevented) p.unprevented++; }, { passive: true });
  addEventListener('scroll', () => { p.scroll = Math.max(p.scroll, scrollY, document.scrollingElement?.scrollTop || 0); }, { passive: true, capture: true });
  addEventListener('pointercancel', () => { p.pointercancel++; }, { capture: true });
  addEventListener('resize', () => { p.resize++; });
  visualViewport?.addEventListener('resize', () => { p.vvResize++; });
})();`;

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
}
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const near = (a, b, eps = 0.08) => Math.abs(a - b) <= eps;

async function enterLobby(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  await page.locator('#boot-start').tap();
  // 운영(계정 서버 열림)은 첫 실행에 로그인 시트를 띄운다. 인앱 첫 방문자처럼 '게스트로 시작'을 누른다.
  const guest = page.getByRole('button', { name: '게스트로 시작' });
  const deadline = Date.now() + 180000;
  while (!(await page.evaluate(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show')))) {
    if (Date.now() > deadline) throw Error('lobby wait timed out');
    if (await guest.isVisible().catch(() => false)) await guest.tap().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.app.ui.closeModal?.());
  // 인앱 브라우저는 전체화면·회전 잠금을 못 하는 경우가 많아 세로 이용자는 '세로로 계속하기'를 누른다.
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
}

async function lobbyChecks(page, cdp, viewport, out) {
  // 로비(성채) 조이스틱: 걷기 모드를 켜고 드래그 중 앱 바 접힘(resize)에도 입력이 이어지는지 본다.
  await page.evaluate(() => window.app.setHubWalkMode?.(true)); await settle(page);
  const stick = await page.evaluate(() => {
    const el = window.app.hubUI?.touchStick; const r = el?.getBoundingClientRect();
    if (!el || !r || !r.width || getComputedStyle(el).visibility === 'hidden' || !el.offsetParent) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, touchAction: getComputedStyle(el).touchAction, active: !!window.app.canWalkHub?.() };
  });
  if (!stick || !stick.active) { out.lobby = { skipped: stick ? 'hub-inactive' : 'no-visible-stick' }; return; }
  const p = { x: stick.x, y: stick.y, id: 1 };
  await touch(cdp, 'touchStart', [p]);
  for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [{ ...p, x: p.x + i * 8 }]);
  await settle(page);
  const before = await page.evaluate(() => ({ ...window.app.hubControls.update() }));
  await page.setViewportSize({ width: viewport.width, height: viewport.height + BAR }); await settle(page);
  await touch(cdp, 'touchMove', [{ ...p, x: p.x + 50 }]); await settle(page);
  const afterBar = await page.evaluate(() => ({ pointer: !!window.app.hubControls.pointer, move: { ...window.app.hubControls.update() } }));
  await touch(cdp, 'touchEnd', []);
  await page.setViewportSize(viewport); await settle(page);
  const released = await page.evaluate(() => ({ ...window.app.hubControls.update() }));
  await page.evaluate(() => window.app.setHubWalkMode?.(false));
  out.lobby = {
    touchAction: stick.touchAction, before, afterBar, released,
    pass: { holdsThroughBarResize: afterBar.pointer && afterBar.move.x > 0.5, releaseStops: near(released.x, 0, 1e-6) && near(released.y, 0, 1e-6), touchActionNone: stick.touchAction === 'none' },
  };
}

async function keyboardCheck(page, viewport, out) {
  // A5 키보드: 커뮤니티 채팅(없으면 닉네임) 입력창에 포커스 → 키보드만큼 창이 줄어도(adjustResize) 입력창이 보이는지.
  await page.evaluate(() => window.app.social?.open?.('chat')); await settle(page);
  const field = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled])';
  const found = await page.evaluate(sel => {
    const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent && e.getBoundingClientRect().width > 40 && e.closest('[class*=tls]'));
    if (!el) return null; el.setAttribute('data-inapp-kb', '1'); el.focus(); return { tag: el.tagName, placeholder: el.placeholder || '' };
  }, field);
  if (!found) { out.keyboard = { skipped: 'no-visible-input' }; await page.evaluate(() => window.app.social?.close?.()); return; }
  const kb = Math.round(viewport.height * .42);
  await page.setViewportSize({ width: viewport.width, height: viewport.height - kb }); await settle(page); await page.waitForTimeout(250);
  const rect = await page.evaluate(() => { const e = document.querySelector('[data-inapp-kb]'); const r = e.getBoundingClientRect(); const vh = visualViewport ? visualViewport.height : innerHeight; return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: Math.round(vh), focused: document.activeElement === e }; });
  await page.setViewportSize(viewport);
  await page.evaluate(() => { document.activeElement?.blur?.(); window.app.social?.close?.(); }); await settle(page);
  out.keyboard = { ...found, keyboardPx: kb, rect, pass: { inputVisibleAboveKeyboard: rect.top >= 0 && rect.bottom <= rect.vh } };
}

async function startBattle(page) {
  const started = await page.evaluate(async () => {
    const app = window.app; const e = app.eco;
    e.s.tutorial = { completed: true }; e.s.energy = 999;
    return await app.startStage(window.__stageDef(1, 1));
  });
  if (!started) throw Error('battle did not start');
  await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .5 && window.app.input.enabled, null, { timeout: 120000 });
  await page.evaluate(() => {
    const input = window.app.input; const log = input.__pressLog = [];
    const press = input.press.bind(input); input.press = a => { log.push(a); press(a); };
    window.app.battle.player.auto = false;
  });
}

const hudRects = page => page.evaluate(() => {
  const vv = window.visualViewport; const vh = vv ? vv.height + vv.offsetTop : innerHeight, vw = vv ? vv.width + vv.offsetLeft : innerWidth;
  const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
  const pick = (name, el) => {
    if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (!r.width || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
    return { name, left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), touchAction: cs.touchAction };
  };
  const items = [pick('joy-base', document.querySelector('#joy .joy-base')), pick('attack', document.getElementById('btn-attack')), pick('dodge', document.getElementById('btn-dodge'))];
  document.querySelectorAll('#hud .skill-btn').forEach(b => items.push(pick('skill' + b.dataset.skill, b)));
  const list = items.filter(Boolean);
  const overlaps = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 0 && h > 0) overlaps.push({ a: a.name, b: b.name, w, h });
  }
  const outside = list.filter(r => r.bottom > vh - 0.5 || r.right > vw + 0.5 || r.left < -0.5 || r.top < -0.5).map(r => r.name);
  // 플레이 영역: 주인공을 화면에 투영한 점 둘레(짧은 변의 22%)에 조작 버튼이 들어오면 결함.
  const app = window.app, T = window.__THREE, cam = app.renderer?.camera, pl = app.battle?.player;
  let hero = null;
  if (T && cam && pl) { const v = new T.Vector3(pl.pos.x, pl.pos.y + 1, pl.pos.z).project(cam); hero = { x: Math.round((v.x + 1) / 2 * innerWidth), y: Math.round((1 - v.y) / 2 * innerHeight), r: Math.round(Math.min(vw, vh) * .22) }; }
  const coversPlay = hero ? list.filter(r => {
    const dx = Math.max(r.left - hero.x, 0, hero.x - r.right), dy = Math.max(r.top - hero.y, 0, hero.y - r.bottom);
    return Math.hypot(dx, dy) < hero.r;
  }).map(r => r.name) : ['hero-unknown'];
  return { viewport: { vw: Math.round(vw), vh: Math.round(vh), sab }, hero, list, overlaps, outside, coversPlay,
    joyTouchAction: getComputedStyle(document.getElementById('joy')).touchAction };
});

async function battleChecks(page, cdp, viewport, out) {
  const joy = await page.evaluate(() => { const r = document.getElementById('joy').getBoundingClientRect(); return { x: r.left + r.width * .35, y: r.top + r.height * .6, right: r.right }; });
  const read = () => page.evaluate(() => { const i = window.app.input; return { active: i.joy.active, sx: +i.screenMove.x.toFixed(3), sy: +i.screenMove.y.toFixed(3), attackHeld: i.attackHeld }; });
  const res = {};
  await page.evaluate(() => Object.assign(window.__inappProbe, { touchmoves: 0, unprevented: 0, scroll: 0, pointercancel: 0 }));

  // A2-1 방향·거리: 오른쪽 60px, 아래 60px.
  const f = { x: joy.x, y: joy.y, id: 11 };
  await touch(cdp, 'touchStart', [f]);
  for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [{ ...f, x: f.x + i * 10 }]);
  res.right = await read();
  for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [{ ...f, x: f.x, y: f.y + i * 10 }]);
  res.down = await read();
  // A2-2 앱 바 접힘(창 높이만 바뀌는 resize) 중에도 끊기지 않는다.
  await page.setViewportSize({ width: viewport.width, height: viewport.height + BAR }); await settle(page);
  await touch(cdp, 'touchMove', [{ ...f, x: f.x - 60, y: f.y }]);
  res.afterBarResize = await read();
  await page.setViewportSize(viewport); await settle(page);
  await touch(cdp, 'touchMove', [{ ...f, x: f.x, y: f.y - 60 }]);
  res.afterBarRestore = await read();
  // A2-3 손가락을 조이스틱 영역 밖(화면 오른쪽 끝)까지 끌어도 이어진다.
  await touch(cdp, 'touchMove', [{ ...f, x: Math.min(viewport.width - 4, joy.right + 120), y: f.y }]);
  res.outsideArea = await read();
  // A3 멀티터치: 조이스틱 유지 + 공격 홀드 + 스킬 탭.
  const atk = await page.evaluate(() => { const r = document.getElementById('btn-attack').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const sk = await page.evaluate(() => { const b = [...document.querySelectorAll('#hud .skill-btn')].find(el => el.offsetParent && el.getBoundingClientRect().width); const r = b?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, slot: b.dataset.skill } : null; });
  const held = { ...f, x: f.x + 50, y: f.y };
  await touch(cdp, 'touchMove', [held]);
  await touch(cdp, 'touchStart', [held, { ...atk, id: 12 }]);
  res.multiAttack = await read();
  if (sk) {
    await touch(cdp, 'touchStart', [held, { ...atk, id: 12 }, { x: sk.x, y: sk.y, id: 13 }]);
    await touch(cdp, 'touchEnd', [held, { ...atk, id: 12 }]);
  }
  await touch(cdp, 'touchMove', [{ ...held, x: held.x + 2 }, { ...atk, id: 12 }]);
  res.multiAfterSkill = await read();
  await touch(cdp, 'touchEnd', [{ ...held, x: held.x + 2 }]);
  res.afterAttackRelease = await read();
  await touch(cdp, 'touchEnd', []);
  await settle(page);
  res.released = await read();
  res.pressLog = await page.evaluate(() => window.app.input.__pressLog.slice(-12));
  // A2-4 touchcancel(브라우저·앱이 제스처를 가져감) 뒤 정지 → 다음 터치에서 바로 복구.
  await touch(cdp, 'touchStart', [f]);
  await touch(cdp, 'touchMove', [{ ...f, x: f.x + 40 }]);
  await touch(cdp, 'touchCancel', []);
  res.afterCancel = await read();
  await touch(cdp, 'touchStart', [f]);
  for (let i = 1; i <= 4; i++) await touch(cdp, 'touchMove', [{ ...f, y: f.y - i * 15 }]);
  res.recovered = await read();
  await touch(cdp, 'touchEnd', []);
  res.probe = await page.evaluate(() => ({ ...window.__inappProbe }));
  res.hud = await hudRects(page);
  res.audio = await page.evaluate(() => window.__audioState?.() ?? 'unknown');

  // 동료 네브 첫 등장 소개 카드: 강제로 다시 띄워 실제 자리가 HUD·주인공 둘레와 겹치지 않는지(없으면 안 띄움도 통과).
  res.nebCard = await page.evaluate(async () => {
    const app = window.app, p = app.companionAgent?.presence, settings = app.eco?.s?.settings;
    if (!p || !p.active || !settings) return { skipped: 'no-companion' };
    const seen = settings.companionIntroSeen;
    settings.companionIntroSeen = false; p.cardState = 'idle'; p.elapsed = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 4000 && p.cardState === 'idle') await new Promise(r => setTimeout(r, 100));
    const card = document.querySelector('#hud .neb-intro'); const r = card?.getBoundingClientRect();
    const out = { state: p.cardState, visible: !!card && !card.hidden && r.width > 0 };
    if (out.visible) {
      out.rect = { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
      const T = window.__THREE, cam = app.renderer?.camera, pl = app.battle?.player;
      const v = new T.Vector3(pl.pos.x, pl.pos.y + 1, pl.pos.z).project(cam);
      const hero = { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, r: Math.min(innerWidth, innerHeight) * .22 };
      const dx = Math.max(r.left - hero.x, 0, hero.x - r.right), dy = Math.max(r.top - hero.y, 0, hero.y - r.bottom);
      out.heroDist = Math.round(Math.hypot(dx, dy)); out.heroR = Math.round(hero.r);
      const sel = '.hud-player, #objective, #bossbar, .hud-right-top, #btn-map, .joy-base, .actions .skill-btn, #btn-dodge, #btn-attack, .exp-potions, .oath-camera-details, .battle-camera-controls, #btn-bag, #battle-bag';
      out.overlaps = [...document.querySelectorAll(sel)].map(el => ({ el, b: el.getBoundingClientRect() }))
        .filter(({ b }) => b.width && b.height && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top)
        .map(({ el }) => el.id || el.className);
      out.inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }
    card?.click(); settings.companionIntroSeen = seen;
    return out;
  });
  const pressed = new Set(res.pressLog);
  out.battle = res;
  out.battle.pass = {
    direction: res.right.active && res.right.sx > .9 && near(res.right.sy, 0, .1) && res.down.sy > .9 && near(res.down.sx, 0, .1),
    holdsThroughBarResize: res.afterBarResize.active && res.afterBarResize.sx < -.9 && res.afterBarRestore.active && res.afterBarRestore.sy < -.9,
    holdsOutsideArea: res.outsideArea.active && res.outsideArea.sx > .9,
    multiAttack: res.multiAttack.active && res.multiAttack.attackHeld && pressed.has('attack'),
    multiSkill: !sk || (pressed.has('skill' + sk.slot) && res.multiAfterSkill.active),
    releaseStops: !res.released.active && res.released.sx === 0 && res.released.sy === 0 && !res.released.attackHeld,
    cancelStops: !res.afterCancel.active && res.afterCancel.sx === 0,
    cancelRecovers: res.recovered.active && res.recovered.sy < -.9,
    noPageScroll: res.probe.scroll === 0 && res.probe.unprevented === 0,
    joyTouchActionNone: res.hud.joyTouchAction === 'none' && res.hud.list.every(r => r.touchAction === 'none'),
    hudNoOverlap: res.hud.overlaps.length === 0,
    hudInsideViewport: res.hud.outside.length === 0,
    hudClearOfPlay: res.hud.coversPlay.length === 0,
    audioRunningAfterTouch: res.audio === 'running',
    nebCardClear: !!res.nebCard.skipped || !res.nebCard.visible || (res.nebCard.heroDist >= res.nebCard.heroR && res.nebCard.overlaps.length === 0 && res.nebCard.inside),
  };
}

const origin = arg('origin');
const out = path.resolve(root, arg('out') || `work/qa/inapp-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(out, { recursive: true });
let server, browser;
const report = { started: new Date().toISOString(), origin: origin || 'dist(preview)', runs: [] };
try {
  let url = origin;
  if (!url) { server = await preview({ root, logLevel: 'error', build: { outDir: arg('dist') || 'dist' }, preview: { host: '127.0.0.1', port: 0 } }); url = 'http://127.0.0.1:' + server.httpServer.address().port; }
  browser = await chromium.launch(launchOpts());
  for (const { ua, viewport } of plan()) {
    const run = { ua, viewport, errors: [], console401: [] };
    const context = await browser.newContext({ viewport, userAgent: IN_APP_UAS[ua], isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'ko-KR' });
    await context.addInitScript(PROBE); await installAutoStarter(context);
    const page = await context.newPage();
    page.on('pageerror', e => run.errors.push(String(e).slice(0, 200)));
    page.on('response', r => { if (r.status() === 401) run.console401.push(new URL(r.url()).pathname); });
    const cdp = await context.newCDPSession(page);
    try {
      await enterLobby(page, url);
      await lobbyChecks(page, cdp, viewport, run);
      await keyboardCheck(page, viewport, run);
      await startBattle(page);
      await battleChecks(page, cdp, viewport, run);
      await page.screenshot({ path: path.join(out, `${ua}-${viewport.width}x${viewport.height}.png`) });
    } catch (e) {
      run.errors.push(String(e?.stack || e).slice(0, 400));
      await page.screenshot({ path: path.join(out, `fail-${ua}-${viewport.width}x${viewport.height}.png`) }).catch(() => {});
    }
    const prefixed = (name, pass) => Object.fromEntries(Object.entries(pass || {}).map(([k, v]) => [name + '.' + k, v]));
    const passes = { ...(run.battle?.pass || {}), ...prefixed('lobby', run.lobby?.pass), ...prefixed('keyboard', run.keyboard?.pass) };
    run.failed = Object.entries(passes).filter(([, v]) => !v).map(([k]) => k);
    if (!run.battle) run.failed.push('battle-not-run');
    run.ok = run.failed.length === 0 && run.errors.length === 0;
    report.runs.push(run);
    console.log(JSON.stringify({ ua, viewport: `${viewport.width}x${viewport.height}`, ok: run.ok, failed: run.failed, lobby: run.lobby?.skipped || 'ran', keyboard: run.keyboard?.skipped || 'ran', audio: run.battle?.audio, neb: run.battle?.nebCard && (run.battle.nebCard.skipped || (run.battle.nebCard.visible ? `${JSON.stringify(run.battle.nebCard.rect)} heroDist=${run.battle.nebCard.heroDist}/${run.battle.nebCard.heroR} overlaps=${run.battle.nebCard.overlaps.length}` : 'not-shown')), unprevented: run.battle?.probe?.unprevented, scroll: run.battle?.probe?.scroll, overlaps: run.battle?.hud?.overlaps?.length, outside: run.battle?.hud?.outside, coversPlay: run.battle?.hud?.coversPlay, http401: run.console401, errors: run.errors.length }));
    await context.close();
  }
} finally {
  await browser?.close(); await server?.close?.().catch?.(() => {});
}
report.ok = report.runs.every(r => r.ok);
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${report.ok ? '인앱 터치 QA 통과' : '인앱 터치 QA 실패'} — ${path.relative(root, out)}/report.json`);
process.exit(report.ok ? 0 : 1);
