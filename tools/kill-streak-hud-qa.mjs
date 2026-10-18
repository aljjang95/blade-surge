// 전투 HUD 연속 처치 위치 실측: 실제 스테이지에 들어가 실제 처치로 연속 처치를 올리고 요소 위치를 잰다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
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
  await page.evaluate(() => { app.ui.combatCue('적의 공격', 'red', 4000); app.ui.waveBanner('봉인 해제'); app.ui.toast('이름의 장례길의 전투 방을 정리해 봉인을 해제하고 시계종의 주권자 · 관문 대장 처치'); });
  await page.waitForTimeout(350);
  const rects = await page.evaluate(() => {
    const r = sel => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), visible: cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && b.width > 0, cls: String(el.className) }; };
    const toasts = [...document.querySelectorAll('#toast-layer .toast')].map(t => { const b = t.getBoundingClientRect(); return { text: t.textContent, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; });
    const top = document.querySelector('.hud-top')?.getBoundingClientRect().bottom || 0; const P = { left: innerWidth / 3, right: innerWidth * 2 / 3, top, bottom: innerHeight * .85 }; const shown = el => { const cs = getComputedStyle(el), b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > .05 && b.width > 0 && b.height > 0; }; const hit = el => { const b = el.getBoundingClientRect(); return b.left < P.right && b.right > P.left && b.top < P.bottom && b.bottom > P.top; }; const violators = [...document.querySelectorAll('#hud > *, #toast-layer > *, #tutorial-toggle')].filter(el => !['dmg-layer', 'loot-layer', 'joy', 'battle-tutorial'].includes(el.id) && el.tagName !== 'CANVAS' && shown(el) && hit(el)).map(el => ({ id: el.id || el.className, text: (el.textContent || '').trim().slice(0, 30), r: (b => [b.left, b.top, b.right, b.bottom].map(Math.round))(el.getBoundingClientRect()) })); return { protectedArea: P, violators, vw: innerWidth, vh: innerHeight, killStreak: r('#kill-streak'), combo: r('#combo'), portrait: r('.hud-top, #hud-top, .player-panel, .hpbox'), cue: r('#combat-cue'), cancel: r('#skill-aim-cancel'), toasts };
  });
  const file = path.join(out, 'hud-' + w + 'x' + h + '.png');
  await page.screenshot({ path: file });
  const ks = rects.killStreak, cx0 = w * .3, cx1 = w * .7, cy0 = h * .25, cy1 = h * .75;
  const overlap = a => a && a.x < cx1 && a.x + a.w > cx0 && a.y < cy1 && a.y + a.h > cy0;
  result.push({ viewport: w + 'x' + h, kills, rects, centerClear: !(ks && ks.visible && overlap(ks)), playClear: rects.violators.length === 0, toastsCenterClear: rects.toasts.every(t => !overlap(t)), screenshot: file, errors });
  await ctx.close();
}
await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.map(r => ({ v: r.viewport, kills: r.kills, ks: r.rects.killStreak, combo: r.rects.combo, centerClear: r.centerClear, toastsClear: r.toastsCenterClear, playClear: r.playClear, violators: r.rects.violators, toasts: r.rects.toasts, errors: r.errors.slice(0, 3) })), null, 1));
