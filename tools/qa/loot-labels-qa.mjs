// 드랍 이름표·식별 고리·드랍 크기 점검(대표님 2026-10-30 피드백): 고정 시드로 기사 1-1 을 열고 3초 자동 전투 뒤,
// 영웅 주변(자석 반경 밖)에 등급별 장비 8개를 떨어뜨리는 '주입 픽스처'로 이름표를 띄워 화면 크기마다 찍는다.
// 기록: 스크린샷, 이름표 사각형, 이름표끼리·HUD 와의 겹침 면적(0 이어야 함), 드랍 모델 크기, 고리 반경.
// 사용: node tools/qa/loot-labels-qa.mjs [--tag before|after] [--dev] [--sizes 360x640,390x700,390x844,844x390]
import { chromium } from 'playwright';
import { preview, createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from '../chrome.mjs';
import { installAutoStarter } from '../qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'after');
const sizes = arg('sizes', '360x640,390x700,390x844,844x390').split(',').map(s => s.split('x').map(Number));
const out = path.join(root, 'work/loot-labels', tag);
const report = { tag, fixture: '주입: 영웅 주변 반경 5.5~7 에 등급 N×4·S·E·U·L 장비 8개(eco.fieldDrop), 자동 전투 3초 뒤', seed: 'mulberry32 0xB1ADE', runs: [], errors: [] };
await fs.mkdir(out, { recursive: true });

let server, browser;
try {
  if (process.argv.includes('--dev')) { server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await server.listen(); }
  else server = await preview({ root, logLevel: 'error', build: { outDir: arg('dist', 'dist') }, preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch(launchOpts());
  for (const [W, H] of sizes) {
    const id = `${W}x${H}`;
    const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    await installAutoStarter(page);
    page.on('pageerror', e => report.errors.push(`${id}: ${e}`));
    await page.addInitScript(() => {
      let a = 0xB1ADE; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      try { localStorage.setItem('bladesurge_scene_seen_all', '1'); } catch {}
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
    const started = await page.evaluate(async () => {
      const app = window.app; app.ui.closeModal?.();
      const e = app.eco; e.s.tutorial = { completed: true }; e.s.energy = 999; e.s.selected = 'knight';
      const ok = await app.startStage(window.__stageDef(1, 1));
      app.companionAgent?.endBattle?.();
      return { ok };
    });
    const run = { id, viewport: { w: W, h: H }, started };
    if (!started.ok) { run.failure = '전투 시작 실패'; report.runs.push(run); await context.close(); continue; }
    await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 90000 }).catch(() => {});
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.evaluate(() => { const app = window.app; app.testPause = true; app.battle.player.auto = true; for (let i = 0; i < 180; i++) app.step(1 / 60, i === 179); });
    await page.screenshot({ path: path.join(out, `${id}-combat.jpg`), type: 'jpeg', quality: 85 });
    run.combat = await page.evaluate(() => {
      const b = window.app.battle, p = b.player, r = b.readability?.view;
      const beacon = p.beacon, ringR = g => g?.geometry?.parameters?.outerRadius ?? null;
      return {
        heroRing: { shadow: ringR(beacon?.shadowRing), primary: ringR(beacon?.primaryRing), focus: ringR(beacon?.focusRing) },
        gradeRingDiameter: p.gradeAura?.ring?.scale?.x ?? null,
        foeRings: r ? r.rings.geometry.instanceCount : null,
        foeRingRadius: r ? Array.from(r.ringAttr.array.slice(2, 3)) : null,
        enemyMarkers: b.enemies.filter(e => e.marker).map(e => ({ boss: !!e.isBoss, outer: ringR(e.marker) })),
      };
    });
    // 주입: 영웅을 멈추고(줍지 않게) 자석 반경 밖에 등급별 장비를 떨어뜨린다.
    run.drops = await page.evaluate(() => {
      const app = window.app, b = app.battle, p = b.player; p.auto = false;
      const rarities = ['N', 'N', 'N', 'N', 'S', 'E', 'U', 'L'], made = [];
      rarities.forEach((rarity, i) => {
        const inst = app.eco.fieldDrop ? { ...app.eco.fieldDrop(rarity), rarity } : null; if (!inst) return;
        const a = -Math.PI * .85 + i * (Math.PI * .7 / rarities.length), d = 5.6 + (i % 3) * .6;
        const pos = p.pos.clone(); pos.x += Math.cos(a) * d; pos.z += Math.sin(a) * d * .7; pos.y = 0;
        b.drops.spawn(pos, 'item', inst, { count: 1, spread: 0 }); made.push({ id: inst.id, rarity });
      });
      b.drops.magnetR = 0; // 캡처 동안 자석 끔(픽스처 전용)
      for (let i = 0; i < 120; i++) app.step(1 / 60, i === 119);
      const sizes = b.drops.items.filter(it => it.kind === 'item').map(it => ({ rarity: it.rarity, restY: +it.restY.toFixed(2), state: it.state, source: it.mesh.userData.lootSource || null }));
      return { made, items: sizes };
    });
    await page.screenshot({ path: path.join(out, `${id}-loot.jpg`), type: 'jpeg', quality: 85 });
    run.labels = await page.evaluate(() => {
      const ll = window.app.battle.lootLabels; if (!ll) return null;
      const labels = ll.snapshot();
      const hud = [...document.querySelectorAll('#hud .hud-player, #hud .hud-right-top, #hud .joy-base, #hud .actions .skill-btn, #hud #btn-dodge, #hud #btn-attack, #hud #objective, #hud .exp-potions, #hud #btn-map')]
        .map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
      const area = (a, c) => { const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); return w > 0 && h > 0 ? w * h : 0; };
      let labelLabel = 0, labelHud = 0;
      for (let i = 0; i < labels.length; i++) { for (let j = i + 1; j < labels.length; j++) labelLabel += area(labels[i], labels[j]); for (const r of hud) labelHud += area(labels[i], r); }
      return { labels: labels.map(l => ({ ...l, left: Math.round(l.left), top: Math.round(l.top), right: Math.round(l.right), bottom: Math.round(l.bottom) })), stats: { ...ll.stats }, overlap: { labelLabel, labelHud } };
    });
    report.runs.push(run);
    await context.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  report.status = report.errors.length ? 'errors' : 'done';
} catch (e) { report.status = 'fail'; report.failure = String(e?.stack || e); process.exitCode = 1; }
finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server?.close?.().catch?.(() => {});
  console.log(JSON.stringify({ status: report.status, runs: report.runs.map(r => ({ id: r.id, ok: !r.failure, labels: r.labels?.labels?.length ?? null, overlap: r.labels?.overlap ?? null, ring: r.combat?.heroRing })), errors: report.errors.slice(0, 5), failure: report.failure?.slice(0, 400) }));
}
process.exit(process.exitCode || 0);
