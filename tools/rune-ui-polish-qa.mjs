// 룬 UI 다듬기 실측: (1) 룬 박기 직후 안내 띠가 장비 상세의 전투력 숫자·소켓판·버튼과 겹치지 않는지, (2) 출격 전 전운 각인이 있을 때 HUD 각인 버튼이 44px 이상 크기로 보이고 플레이 영역을 가리지 않는지.
// 사용: bun run dev -- --port 5288 후 `node tools/rune-ui-polish-qa.mjs [baseUrl]`. 캡처는 RUNE_POLISH_OUT(기본 work/qa/rune-ui-polish)에 저장하고 커밋하지 않는다.
// 겹침·크기가 기준을 못 맞추면 exit 1. 헤드리스 셸 경로가 다르면 RUNE_QA_CHROME 로 지정한다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { installAutoStarter } from './qa-starter.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5288/';
const out = process.env.RUNE_POLISH_OUT || 'work/qa/rune-ui-polish';
const prefix = process.env.RUNE_POLISH_PREFIX || 'after';
const sizes = (process.env.RUNE_POLISH_SIZES || '844x390,1280x720,390x844').split(',').map((s) => s.split('x').map(Number));
await fs.mkdir(out, { recursive: true });
const report = { base, prefix, at: new Date().toISOString(), sizes: {}, errors: [], failures: [] };

const browser = await chromium.launch({ ...(process.env.RUNE_QA_CHROME ? { executablePath: process.env.RUNE_QA_CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** 두 사각형의 교차 면적(px²). */
const area = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0 && h > 0 ? Math.round(w * h) : 0; };

try {
  for (const [w, h] of sizes) {
    const tag = w + 'x' + h, rec = { checks: {}, shots: [] };
    report.sizes[tag] = rec;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < h || w <= 900, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(tag + ' pageerror ' + e.message));
    await installAutoStarter(page);
    await page.goto(base, { waitUntil: 'commit' });
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await page.tap('#boot-start');
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
    const shot = async (name) => { const p = `${out}/${prefix}-${tag}-${name}.png`; await page.waitForTimeout(200); await page.screenshot({ path: p, timeout: 120000 }); rec.shots.push(p); };
    const ignoreRotate = async () => { const ignore = page.locator('#btn-ignore-rotate'); if (await ignore.isVisible().catch(() => false)) { await ignore.click(); await page.waitForTimeout(200); } };
    const touch = async (loc) => { await ignoreRotate(); await loc.waitFor({ state: 'visible' }); await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const b = await loc.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(150); };

    // ---- 1) 룬 박기 안내 띠 vs 전투력 ----
    await page.evaluate(() => {
      const app = window.app, eco = app.eco, s = eco.s;
      app.ui.closeModal(); app.testPause = true; s.gold = 184000;
      const inst = { uid: s.invSeq++, id: 'a_titan', enh: 12 }; s.inventory.push(inst);
      const heroId = s.heroes.knight ? 'knight' : Object.keys(s.heroes)[0];
      s.selected = heroId;
      const hero = s.heroes[heroId]; hero.equip = { ...hero.equip, armor: null };
      eco.runeState().bag = { storm_edge: [1, 3, 0], ember_edge: [2, 0, 0] };
      eco.save(); eco.emit?.();
      window.__qa = { armor: inst.uid, heroId };
      app.meta.openTab('heroes');
    });
    await page.waitForTimeout(300);
    const ids = await page.evaluate(() => window.__qa);
    await page.evaluate(({ armor, heroId }) => window.app.meta.showItem(armor, heroId), ids);
    await touch(page.locator('[data-side-tab="rune"]'));
    await page.locator('.rs-pane').waitFor();
    await touch(page.locator('#rs-insert'));
    await page.locator('.rune-picker').waitFor({ timeout: 10000 });
    await touch(page.locator('.rp-cell[data-key="storm_edge:2"]'));
    await touch(page.locator('#rp-go'));
    await page.locator('.rs-pane').waitFor();
    await page.locator('.rs-notice, #toast-layer .toast').first().waitFor({ timeout: 3000 });
    await page.waitForTimeout(350); // 등장 애니메이션이 끝난 뒤 최종 위치를 잰다
    const toastRes = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; };
      // 안내는 룬 소켓 탭 안(.rs-notice)에 떠야 하고, 앱 토스트(#toast-layer)로 따로 뜨면 실패로 본다.
      const stray = [...document.querySelectorAll('#toast-layer .toast')].filter((x) => /박기 완료|교체 완료/.test(x.textContent)).length;
      const toast = document.querySelector('.rs-pane .rs-notice');
      if (!toast) return { error: 'no-notice', stray };
      const t = box(toast);
      const targets = { power: '.is-power', sockets: '.rs-pane .rs-socket', synergy: '.rs-syn', buttons: '#rs-insert,#rs-swap,#rs-overview', sideTabs: '[data-side-tab]', preview: '.item-detail,.is-name,.modal-box h2' };
      const hits = {}; let total = 0;
      for (const [k, sel] of Object.entries(targets)) {
        let a = 0;
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
          const ww = Math.min(t.right, r.right) - Math.max(t.left, r.left), hh = Math.min(t.bottom, r.bottom) - Math.max(t.top, r.top);
          if (ww > 0 && hh > 0) a += Math.round(ww * hh);
        }
        hits[k] = a; total += a;
      }
      const power = document.querySelector('.is-power');
      return { stray, toast: { ...t, text: toast.textContent }, power: power && box(power), hits, total, vw: innerWidth, vh: innerHeight, inViewport: t.left >= 0 && t.right <= innerWidth && t.top >= 0 && t.bottom <= innerHeight };
    });
    rec.checks.toast = toastRes;
    await shot('1-rune-toast');
    if (toastRes.error || toastRes.stray > 0 || toastRes.total > 0 || !toastRes.inViewport) report.failures.push(`${tag} 안내 띠 겹침/이탈: ${JSON.stringify(toastRes.hits)} inViewport=${toastRes.inViewport}`);

    // ---- 2) HUD 각인 버튼 ----
    await page.evaluate(async () => {
      app.ui.closeModal?.(); app.eco.s.energy = 100; app.testPause = false;
      app.battle.setPreRunBoons(['ember_edge', 'ember_edge']);
      if (!await app.startExpedition('dungeon', 'glass_garden', { depth: 'standard' })) throw Error('expedition start failed');
    });
    await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    const hudRes = await page.evaluate(() => {
      app.testPause = true; for (let i = 0; i < 30; i++) app.step(1 / 60, i === 29);
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
      const b = app.battle.chronicle.hud, r = box(b);
      const hud = document.getElementById('hud');
      const BLOCK = ['.hud-player', '.hud-center .wave', '.hud-center .stage-name', '#btn-pause', '#btn-auto', '#btn-boss-shortcut', '#btn-map', '#objective', '.joy-base', '.actions .skill-btn', '#btn-dodge', '#btn-attack', '.exp-potions'];
      const overlaps = [];
      for (const s of BLOCK) for (const el of hud.querySelectorAll(s)) {
        const o = box(el); if (!o.w || !o.h) continue;
        const ww = Math.min(r.right, o.right) - Math.max(r.left, o.left), hh = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
        if (ww > 0 && hh > 0) overlaps.push({ id: el.id || s, area: Math.round(ww * hh) });
      }
      // 플레이 영역: 화면 가운데 3분의 1(가로) x 가운데 3분의 1(세로) 와의 교차
      const cx = { left: innerWidth / 3, right: innerWidth * 2 / 3, top: innerHeight / 3, bottom: innerHeight * 2 / 3 };
      const ww = Math.min(r.right, cx.right) - Math.max(r.left, cx.left), hh = Math.min(r.bottom, cx.bottom) - Math.max(r.top, cx.top);
      return { hidden: b.hidden, parent: b.parentElement?.id || b.parentElement?.className, rect: r, text: b.textContent, overlaps, centerArea: ww > 0 && hh > 0 ? Math.round(ww * hh) : 0, inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    });
    rec.checks.hud = hudRes;
    await shot('2-hud-engrave');
    if (hudRes.hidden || hudRes.rect.w < 44 || hudRes.rect.h < 44) report.failures.push(`${tag} HUD 각인 버튼 크기 ${hudRes.rect.w}x${hudRes.rect.h} hidden=${hudRes.hidden}`);
    if (hudRes.overlaps.length || hudRes.centerArea > 0 || !hudRes.inViewport) report.failures.push(`${tag} HUD 각인 버튼 겹침/이탈: ${JSON.stringify(hudRes.overlaps)} center=${hudRes.centerArea} inViewport=${hudRes.inViewport}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(`${out}/${prefix}-report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ failures: report.failures, errors: report.errors, sizes: Object.fromEntries(Object.entries(report.sizes).map(([k, v]) => [k, { toast: v.checks.toast && { hits: v.checks.toast.hits, total: v.checks.toast.total, rect: v.checks.toast.toast }, hud: v.checks.hud && { rect: v.checks.hud.rect, parent: v.checks.hud.parent, overlaps: v.checks.hud.overlaps, centerArea: v.checks.hud.centerArea } }])) }, null, 1));
process.exit(report.failures.length ? 1 : 0);
