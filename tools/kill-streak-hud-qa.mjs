// 전투 HUD 연속 처치 위치 실측: 실제 스테이지에 들어가 실제 처치로 연속 처치를 올리고 요소 위치를 잰다.
// 보호 구역은 하나다(대표님 규칙 2026-10-18 "화면 가운데 1/3"): 가로 [1/3, 2/3] × 세로 [HUD 상단 줄 아래, 화면 높이 85%].
// 연속 처치·알림·경고·배너·모든 HUD 요소가 이 한 구역으로 판정한다(예전 30~70% × 25~75% 상자는 폐지, 참고용 legacy30 수치만 따로 남긴다).
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installAutoStarter } from './qa-starter.mjs';
const origin = process.argv[2] || 'http://127.0.0.1:5181';
const out = path.resolve(process.argv[3] || 'work/qa-hud');
const views = (process.argv[4] || '1280x590,844x390,800x360').split(',').map(v => v.split('x').map(Number));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const result = [];
for (const [w, h] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
  await page.evaluate(async () => {
    app.ui.closeModal?.(); app.eco.s.energy = 100;
    if (!await app.startStage(app.eco.nextStage())) throw Error('stage start failed');
    app.battle.player.invuln = 1e6; app.companionAgent?.endBattle?.();
  });
  // 실제 처치: 적 체력은 그대로 두고 플레이어 공격력만 올려 자연 전투 루프(AUTO)에서 처치되게 한다.
  const kills = await page.evaluate(async () => {
    const b = app.battle; b.player.auto = true; b.player.atk *= 40;
    const t0 = performance.now(); let peak = 0;
    while (performance.now() - t0 < 30000 && peak < 21) { await new Promise(r => setTimeout(r, 150)); peak = Math.max(peak, b.killStreak); if (b.killStreak > 0) b.killStreakT = Math.max(b.killStreakT, 3); }
    b.player.auto = false; b.killStreakT = 30; b.ui?.setKillStreak?.(b.killStreak);
    return { killStreak: b.killStreak, peak, kills: b.kills };
  });
  // 화면 중앙을 차지하던 HUD 요소(경고·배너·긴 알림)를 실제 UI 경로로 띄워 함께 잰다.
  // 알림 큐에 쌓인 자연 알림을 비우고 긴 알림을 긴급(red)으로 올려 바로 보이게 한다.
  await page.evaluate(() => { app.ui.combatCue('적의 공격', 'red', 4000); app.ui.waveBanner('봉인 해제'); app.ui.combatNotices.clear(); app.ui.toast('이름의 장례길의 전투 방을 정리해 봉인을 해제하고 시계종의 주권자 · 관문 대장 처치', 'red'); });
  await page.waitForTimeout(350);
  const rects = await page.evaluate(() => {
    const r = sel => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), visible: cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && b.width > 0, cls: String(el.className) }; };
    const toasts = [...document.querySelectorAll('#toast-layer .toast')].map(t => { const b = t.getBoundingClientRect(); return { text: t.textContent, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; });
    const top = document.querySelector('.hud-top')?.getBoundingClientRect().bottom || 0; const P = { left: innerWidth / 3, right: innerWidth * 2 / 3, top, bottom: innerHeight * .85 }; const shown = el => { const cs = getComputedStyle(el), b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05 && b.width > 0 && b.height > 0; }; const hit = el => { const b = el.getBoundingClientRect(); return b.left < P.right && b.right > P.left && b.top < P.bottom && b.bottom > P.top; }; const violators = [...document.querySelectorAll('#hud > *, #toast-layer > *, #tutorial-toggle')].filter(el => !['dmg-layer', 'loot-layer', 'joy', 'battle-tutorial'].includes(el.id) && el.tagName !== 'CANVAS' && shown(el) && hit(el)).map(el => ({ id: el.id || el.className, text: (el.textContent || '').trim().slice(0, 30), r: (b => [b.left, b.top, b.right, b.bottom].map(Math.round))(el.getBoundingClientRect()) })); return { protectedArea: P, violators, vw: innerWidth, vh: innerHeight, killStreak: r('#kill-streak'), combo: r('#combo'), portrait: r('.hud-top, #hud-top, .player-panel, .hpbox'), cue: r('#combat-cue'), cancel: r('#skill-aim-cancel'), toasts };
  });
  const file = path.join(out, 'hud-' + w + 'x' + h + '.png');
  await page.screenshot({ path: file });
  const ks = rects.killStreak, P = rects.protectedArea;
  const overlap = a => a && a.x < P.right && a.x + a.w > P.left && a.y < P.bottom && a.y + a.h > P.top;
  // 참고용: 예전 기준(가로 30~70%)과 겹치는 알림 수. 판정에는 쓰지 않는다.
  const legacy30 = rects.toasts.filter(t => t.x + t.w > w * .3 && t.x < w * .7 && t.y < h * .75 && t.y + t.h > h * .25).length;
  const longNotice = rects.toasts.some(t => t.text.includes('이름의 장례길'));
  result.push({ viewport: w + 'x' + h, kills, rects, longNoticeShown: longNotice, centerClear: !(ks && ks.visible && overlap(ks)), playClear: rects.violators.length === 0, toastsCenterClear: longNotice && rects.toasts.every(t => !overlap(t)), legacy30ToastOverlap: legacy30, screenshot: file, errors });
  await ctx.close();
}
await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.map(r => ({ v: r.viewport, kills: r.kills, ks: r.rects.killStreak, combo: r.rects.combo, centerClear: r.centerClear, toastsClear: r.toastsCenterClear, longNoticeShown: r.longNoticeShown, legacy30: r.legacy30ToastOverlap, protectedArea: r.rects.protectedArea, playClear: r.playClear, violators: r.rects.violators, toasts: r.rects.toasts, errors: r.errors.slice(0, 3) })), null, 1));
if (result.some(r => !r.centerClear || !r.toastsCenterClear || !r.playClear || r.errors.length)) process.exitCode = 1;
