/**
 * 아바타 입기/벗기 실시간 전환 QA — 영웅 화면 옷장에서 같은 인스턴스 몸 교체(와이프), 미리보기, 상점 입어 보기 원복, 전투 몸 일치.
 *   node tools/avatar-tryon-qa.mjs [출력폴더=work/qa/avatar-tryon] [--url=http://localhost:5173/]
 * --url 이 없으면 vite dev 서버를 직접 띄운다. 844×390 영상(webm)과 전후 스크린샷, result.json(프레임 간격 포함)을 남긴다.
 */
import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const args = process.argv.slice(2), OUT = resolve(PROJ, args.find((a) => !a.startsWith('--')) || 'work/qa/avatar-tryon');
const PORT = 5199, URL_ARG = args.find((a) => a.startsWith('--url='))?.slice(6);
const BASE = URL_ARG || `http://localhost:${PORT}/`;
mkdirSync(OUT, { recursive: true });
const srv = URL_ARG ? null : spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv?.kill(); throw new Error('dev server did not start'); }

const VIEW = { width: 844, height: 390 };
const br = await chromium.launch(launchOpts());
const context = await br.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: VIEW } });
const page = await context.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [], results = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 240)); });
const missing = [];
page.on('response', (response) => { if (response.status() === 404) missing.push(response.url().replace(BASE, '/')); });
page.on('pageerror', (error) => errors.push('PAGEERR ' + error.message.slice(0, 240)));
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')); };
const shot = (name) => page.screenshot({ path: resolve(OUT, name + '.png') });

/** 전환 하나: 클릭 전후 인스턴스·믹서·몸 id, 전환 중 프레임 간격(rAF)을 잰다. 중간(약 0.2초) 화면도 찍는다. */
async function transition(label, act, expectBody) {
  const before = await page.evaluate(() => {
    const w = window.app.wardrobe.instance; window.__wardrobeRef = w;
    window.__ft = []; let last = performance.now();
    const loop = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length < 240) window.__ftId = requestAnimationFrame(loop); };
    cancelAnimationFrame(window.__ftId || 0); window.__ftId = requestAnimationFrame(loop);
    return { body: w?.root.userData.libraryBodyAssetId, time: w?.mixer.time ?? null };
  });
  // 전환 전 기준 프레임(같은 길이) 먼저 잰다.
  await page.waitForTimeout(500);
  const baseline = await page.evaluate(() => window.__ft.splice(0));
  await act();
  await page.waitForTimeout(180); await shot(label + '-mid');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const w = window.app.wardrobe.instance;
    return { same: w === window.__wardrobeRef, body: w?.root.userData.libraryBodyAssetId, time: w?.mixer.time ?? null, phase: w?.wipe.phase, ft: window.__ft.splice(0) };
  });
  await shot(label + '-after');
  const max = (list) => Math.round(Math.max(0, ...list));
  const median = (list) => { const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] || 0); };
  check(`${label}: 같은 인스턴스(캔버스·믹서 유지)`, after.same, { before: before.body, after: after.body });
  check(`${label}: 몸 = ${expectBody ?? '기본'}`, expectBody ? after.body === expectBody : !String(after.body).startsWith('avatar_'), after.body);
  check(`${label}: 애니메이션 시간 이어짐`, after.time > before.time, { before: before.time, after: after.time });
  check(`${label}: 와이프 끝(idle)`, after.phase === 'idle', after.phase);
  const frames = { baselineMedianMs: median(baseline), baselineMaxMs: max(baseline), transitionMedianMs: median(after.ft), transitionMaxMs: max(after.ft), samples: after.ft.length };
  results.push({ name: `${label}: 프레임 간격`, ok: true, detail: frames }); console.log('INFO ', label, JSON.stringify(frames));
  return frames;
}

try {
  await page.goto(BASE);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 180000 });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  // 첫 실행: 시작 영웅 선택(검성 아르카)
  const starter = page.getByRole('button', { name: /이 영웅으로 시작/ }).first();
  if (await starter.isVisible().catch(() => false)) { await starter.click(); await page.waitForTimeout(2000); }
  for (let i = 0; i < 4; i++) { const close = page.getByRole('button', { name: '닫기' }).first(); if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(400); } }
  await page.evaluate(() => {
    const app = window.app, eco = app.eco;
    app.ui.confirm = async () => true; eco.s.gems = 20000; eco.s.selected = 'knight';
    if (!eco.s.avatars.owned.includes('avatar_knight_sakura')) eco.buyAvatar('avatar_knight_sakura');
    eco.equipAvatar('knight', null); eco.emit();
    app.meta.avatarPick = { knight: 'avatar_knight_sakura' };
    app.meta.openTab('heroes');
  });
  await page.waitForSelector('[data-avatar-action]', { timeout: 60000 });
  await page.waitForFunction(() => window.app.wardrobe.instance?.frame, null, { timeout: 60000 });
  // 프리로드: 영웅 화면 진입만으로 기사 아바타 두 몸이 받아진다.
  const preloaded = await page.waitForFunction(() => window.app.wardrobe.preloader.pending().length === 0 && window.app.wardrobe.preloader.held().includes('avatar_knight_pumpkin'), null, { timeout: 60000 }).then(() => true, () => false);
  check('영웅 화면 진입 시 기사 아바타 몸 프리로드', preloaded, await page.evaluate(() => window.app.wardrobe.preloader.held()));
  await page.waitForTimeout(1200);
  await shot('01-hero-base');

  const frames = {};
  frames.equip = await transition('02-equip', () => page.click('[data-avatar-action]'), 'avatar_knight_sakura');
  frames.unequip = await transition('03-unequip', () => page.click('[data-avatar-action]'), null);
  // 미보유 아바타 미리보기(다음 ▸ 로 호박등 기사 → 미리보기)
  await page.click('[data-avatar-next]'); await page.waitForTimeout(500);
  frames.preview = await transition('04-preview', () => page.click('[data-avatar-try]'), 'avatar_knight_pumpkin');
  frames.previewEnd = await transition('05-preview-end', () => page.click('[data-avatar-try]'), null);
  const ecoAfterPreview = await page.evaluate(() => ({ owned: window.app.eco.s.avatars.owned.includes('avatar_knight_pumpkin'), equipped: window.app.eco.equippedAvatar('knight') }));
  check('미리보기는 보유·착용을 바꾸지 않음', !ecoAfterPreview.owned && ecoAfterPreview.equipped === null, ecoAfterPreview);

  // 상점 입어 보기
  const shopBefore = await page.evaluate(() => { window.app.meta.openTab('shop', 'avatar'); return JSON.stringify({ gems: window.app.eco.s.gems, avatars: window.app.eco.s.avatars }); });
  await page.waitForSelector('[data-avatar-tryon="avatar_knight_pumpkin"]', { timeout: 30000 });
  await shot('06-shop-card');
  await page.click('[data-avatar-tryon="avatar_knight_pumpkin"]');
  await page.waitForSelector('#tryon-stage canvas', { timeout: 30000 });
  await page.waitForTimeout(250); await shot('07-shop-tryon-start');
  await page.waitForTimeout(1300); await shot('08-shop-tryon-wearing');
  await page.click('[data-tryon-toggle]'); await page.waitForTimeout(200); await shot('09-shop-tryon-mid');
  await page.waitForTimeout(900); await shot('10-shop-tryon-original');
  await page.click('#m-cancel'); await page.waitForTimeout(400);
  const shopAfter = await page.evaluate(() => JSON.stringify({ gems: window.app.eco.s.gems, avatars: window.app.eco.s.avatars }));
  check('상점 입어 보기 닫으면 저장·보석 원래대로', shopAfter === shopBefore, '');
  check('입어 보기 미리보기 루트 정리', await page.evaluate(() => !window.app.wardrobe.previewRoot), '');

  // 전투 입장: 장착 아바타와 전투 몸 일치
  await page.evaluate(async () => { const eco = window.app.eco; eco.equipAvatar('knight', 'avatar_knight_sakura'); eco.s.energy = 9999; await window.app.startStage(eco.nextStage()); });
  const battleBody = await page.waitForFunction(() => window.app.battle?.player?.model?.userData.libraryBodyAssetId, null, { timeout: 90000 }).then((h) => h.jsonValue(), () => null);
  check('전투 플레이어 몸 = 장착 아바타', battleBody === 'avatar_knight_sakura', battleBody);
  await page.waitForTimeout(1500); await shot('11-battle-avatar');
  writeFileSync(resolve(OUT, 'frames.json'), JSON.stringify(frames, null, 2));
} finally {
  // vite dev 에는 Worker(/api/*)가 없어 그 404 만은 환경 소음으로 뺀다(정적 자산 404 는 그대로 실패).
  const apiOnly = missing.length > 0 && missing.every((url) => url.startsWith('/api/'));
  const real = errors.filter((text) => !(apiOnly && /status of 404/.test(text)));
  check('콘솔 오류 0(dev /api 404 제외)', real.length === 0, real.slice(0, 5).join(' | '));
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ at: new Date().toISOString(), viewport: VIEW, renderer: 'swiftshader(headless, GPU 없음)', results, errors, missing }, null, 2));
  if (missing.length) console.log('404 ' + missing.join(' '));
  const video = page.video();
  await context.close(); await br.close(); srv?.kill();
  if (video) console.log('VIDEO ' + await video.path());
}
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
