// 같은 원본 모델·재질·카메라에서 피격 신호만 비교하는 시각 증거.
// 이 장면은 제어된 렌더 검사이며 실제 한 층 완주 증거는 metrics가 담당한다.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';

const origin = process.argv[2] || 'http://127.0.0.1:5173';
const out = resolve(process.argv[3] || 'work/combat-clarity');
const hero = process.argv[4] || 'knight', quality = process.argv[5] || 'mid';
assert.ok(['knight', 'barbarian', 'mage', 'rogue', 'ranger'].includes(hero));
assert.ok(['low', 'mid', 'high'].includes(quality));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(launchOpts({ headless: true }));
const errors = [];
const report = { origin, hero, quality, controlledScene: true, cases: [], errors };
try {
  report.build = await (await fetch(origin + '/version.json')).json();
  const page = await browser.newPage({ viewport: { width: 880, height: 400 }, serviceWorkers: 'block' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
  await page.evaluate(({ hero, quality }) => {
    const eco = window.app.eco;
    assertReset(eco.reset());
    eco.s.selected = hero; eco.s.settings.quality = quality;
    eco.s.tutorial = { completed: true }; eco.save();
    function assertReset(ok) { if (!ok) throw new Error('저장 초기화 실패'); }
  }, { hero, quality });
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app.mode === 'lobby');
  await page.evaluate(async () => {
    const app = window.app;
    app.ui.closeModal(); app.applySettings(); app.testPause = true;
    let seed = 20261001;
    Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    await app.startStage(app.eco.nextStage());
    const b = app.battle, room = b.world.rooms.find(r => r.type === 'normal');
    b.player.auto = false; b.player.pos.set(room.x, 0, room.z);
    for (let i = 0; i < 120; i++) app.step(1 / 60, false);
    const enemy = b.enemies.find(e => e.alive && !e.spawning && !e.isBoss);
    if (!enemy) throw new Error('비교할 적이 없습니다.');
    globalThis.__clarityEnemy = enemy;
    for (const e of b.enemies) e.root.visible = e === enemy;
    enemy.pos.copy(b.player.pos); enemy.pos.x += 1.65; enemy.yaw = -Math.PI / 2;
    b.player.yaw = Math.PI / 2;
    for (const actor of [b.player, enemy]) { actor.flashT = 0; actor.update(0); }
    for (let i = 0; i < 60; i++) app.renderer.update(1 / 60, 1 / 60);
    app.renderer.render();
  });
  for (const mode of ['normal', 'reduced']) {
    await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    for (const [id, color, duration, age] of [['rest', 0xffffff, 0, 0], ['hit', 0xffffff, .12, 0], ['critical', 0xffd040, .18, 0], ['decay', 0xffffff, .12, .06]]) {
      const sample = await page.evaluate(({ color, duration, age }) => {
        const e = globalThis.__clarityEnemy;
        e.flashT = 0; e.update(0);
        if (duration) { e.flash(color, duration); e.update(age); }
        window.app.renderer.render();
        if (!window.app.renderer.camera.position.toArray().every(Number.isFinite)) throw new Error('유효하지 않은 비교 카메라');
        return { type: e.type, hp: e.hp, position: e.pos.toArray(),
          materials: e.mats.map(m => ({ name: m.name, color: m.color.toArray(), emissive: m.emissive.toArray(), intensity: m.emissiveIntensity })) };
      }, { color, duration, age });
      await page.screenshot({ path: resolve(out, `${mode}-${id}.png`) });
      report.cases.push({ mode, id, ...sample });
    }
  }
  assert.deepEqual(errors, []);
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.failure = error.stack; process.exitCode = 1; }
finally {
  await browser.close();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, errors, failure: report.failure }));
}
