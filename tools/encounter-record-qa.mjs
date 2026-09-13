import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { DUNGEONS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { encounterLocationLabel } from '../src/game/rpg-encounters.js';
import { installMetricsDriver } from './metrics-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = key => process.argv.find(a => a.startsWith('--' + key + '='))?.slice(key.length + 3) || '';
const hash = b => createHash('sha256').update(b).digest('hex');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const supplied = path.resolve(root, arg('save')), relative = path.relative(root, supplied).replaceAll('\\', '/');
assert(relative.startsWith('work/natural-progression-') && relative.endsWith('.json'), 'Expected local synthetic acquisition checkpoint');
const saveBytes = await fs.readFile(supplied), acquired = JSON.parse(saveBytes);
assert(hash(saveBytes) === arg('sha256') && acquired.syntheticQaOnly && acquired.schema === 'bladesurge-synthetic-qa-save/v1', 'Synthetic checkpoint mismatch');
assert(acquired.save.spentKRW === 0 && !acquired.save.purchases.length && !acquired.save.expedition.pending, 'Expected settled free-play profile');
const parent = JSON.parse(await fs.readFile(path.join(path.dirname(supplied), 'report.json'), 'utf8'));
assert(parent.status === 'pass' && parent.runs.some(r => r.checkpointAfter?.sha256 === hash(saveBytes) && r.checkpointAfter.path.replaceAll('\\', '/') === relative), 'Missing successful acquisition receipt');
const out = path.join(root, 'work/encounter-record-qa'); await fs.mkdir(out, { recursive: true });
const sourceFiles = ['src/game/rpg-core.js', 'src/game/rpg-encounters.js', 'src/game/rpg-battle.js', 'src/ui/rpg.js', 'src/game/rpg-catalogue.js', 'src/game/save.js', 'src/data/stages.js', 'src/data/expedition-depths.js', 'tools/encounter-record-qa.mjs'];
const report = { status: 'running', started: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Local compiled Chromium build with the preserved free-play mage acquired on bc345e8. Actual stage starts, AUTO and first offered choices at fixed1/60s, original spawn observations, real victories, displayed HUD, codex and reload. No stat, level, equipment, currency, kill or victory grants. Prior acquisition is separate evidence, not a claim the candidate earned that whole history. No physical mobile FPS/OS-install/audio or live-party proof.',
  acquisition: { path: relative, sha256: hash(saveBytes), head: acquired.head }, errors: [], runs: [],
  sources: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash((await fs.readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n'))]))) };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await fs.copyFile(import.meta.filename, path.join(out, 'driver.mjs'));
let server, browser, page;
try {
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  report.build = await (await fetch(url + '/version.json')).json();
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8'); report.entry = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  report.entrySha256 = hash(await fs.readFile(path.join(root, 'dist', report.entry)));
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1100, height: 760 }, hasTouch: true, reducedMotion: 'reduce' });
  page.setDefaultTimeout(30000); page.on('pageerror', e => report.errors.push(String(e)));
  await page.addInitScript(save => { if (!localStorage.getItem('bladesurge_save_v1')) localStorage.setItem('bladesurge_save_v1', JSON.stringify(save)); }, acquired.save);
  const boot = async () => {
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.locator('#boot-start').tap();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
    await page.waitForTimeout(800); await page.evaluate(() => { window.app.testPause = true; window.app.ui.closeModal(); });
  };
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); await boot();
  report.initial = await page.evaluate(() => structuredClone(window.app.eco.s.rpg));
  assert(isDeepStrictEqual(report.initial, acquired.save.rpg), 'Legacy discoveries changed before encountering anything');
  const routes = [{ kind: 'campaign', ch: 6, st: 1 }, { kind: 'campaign', ch: 6, st: 10 },
    ...EXPEDITION_DEPTHS.map(d => ({ kind: 'dungeon', id: d.id, depth: 'deep' })), { kind: 'dungeon', id: 'ember_vault', depth: 'standard' }, { kind: 'arena', id: 'duelist', depth: 'standard' },
    { kind: 'dungeon', id: await page.evaluate(ids => ids[window.app.journey.s.day % ids.length], DUNGEONS.map(d => d.id)), depth: 'standard', rift: true }];
  for (const [index, route] of routes.entries()) {
    const run = { index, route, status: 'running' }; report.runs.push(run);
    run.before = await page.evaluate(route => {
      const a = window.app; a.expeditionUI.close(); a.ui.closeModal(); a.toLobby(); a.testPause = true;
      const actions = [];
      if (a.eco.s.energy < 20 && route.kind !== 'arena') {
        const sku = a.eco.sku('en2'), before = { gems: a.eco.s.gems, energy: a.eco.s.energy };
        if (sku.kind !== 'gem' || sku.price !== 100 || sku.rewards.energy !== 120) throw Error('Changed energy catalog');
        const result = a.eco.purchase('en2'); if (!result?.ok) throw Error('Earned energy refill unavailable');
        actions.push({ sku: 'en2', before, after: { gems: a.eco.s.gems, energy: a.eco.s.energy } });
      }
      return { rpg: structuredClone(a.battle.ensureRpg()), gold: a.eco.s.gold, gems: a.eco.s.gems, energy: a.eco.s.energy, hero: structuredClone(a.eco.hero()), actions };
    }, route);
    const started = await page.evaluate(({ route, index }) => {
      const a = window.app; let seed = (Math.imul(20261102, index + 1) ^ 0x9e3779b9) >>> 0;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      if (route.kind === 'campaign') { a.meta.chapter = route.ch; a.meta.stage = null; a.meta.renderStages(); document.querySelector('[data-stage="' + route.ch + '-' + route.st + '"]').click(); return a.startStage(a.meta.stage); }
      return a.startExpedition(route.kind, route.id, { depth: route.depth, rift: !!route.rift });
    }, { route, index });
    assert(started, 'Departure rejected ' + JSON.stringify(route)); await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting);
    run.stage = await page.evaluate(() => {
      const a = window.app, b = a.battle; b.player.auto = true; a.testPause = true; window.__encounterSpawns = []; window.__encounterTarget = null;
      const spawn = b.spawnEnemy; b._qaRestore = () => { b.spawnEnemy = spawn; delete b._qaRestore; };
      b.spawnEnemy = function (...args) {
        const enemy = spawn.apply(this, args); if (!enemy) return enemy;
        const record = structuredClone(this.ensureRpg().bestiary[enemy.speciesId]);
        const difficulty = this.run?.enabled ? this.run.difficulty : null;
        window.__encounterSpawns.push({ id: enemy.speciesId, name: enemy.def.name, level: enemy.level, boss: enemy.isBoss, elite: enemy.isElite, maxHp: enemy.maxHp, atk: enemy.atk,
          expectedHp: Math.round(Math.floor(enemy.def.hp * this.stage.scale) * (difficulty?.enemyHp || 1)), expectedAtk: enemy.def.atk * this.stage.scale ** .7 * (difficulty?.enemyAtk || 1),
          record, bossHud: enemy.isBoss ? document.querySelector('#boss-name').textContent : null });
        return enemy;
      };
      return { idx: b.stage.idx, scale: b.stage.scale, code: b.stage.code, encounter: b.stage.encounter.enemyId, expedition: b.stage.expedition, riftId: b.stage.riftId };
    });
    await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });
    let bossCaptured = false;
    for (let chunk = 0; chunk < 180; chunk++) {
      run.last = await page.evaluate(captured => {
        const b = window.app.battle;
        for (let i = 0; i < 600 && b.active; i++) {
          window.__metricsDriver.step(1 / 60, false);
          if (!b.rpgView.target.hidden) window.__encounterTarget = b.rpgView.target.textContent;
          if (!captured && b.boss?.alive && !b.boss.spawning) break;
        }
        return { active: b.active, win: b.result?.win, elapsed: b.elapsed, kills: b.kills, hp: b.player.hp, boss: !!b.boss?.alive && !b.boss.spawning };
      }, bossCaptured);
      assert(!run.last.active || run.last.hp > 0, 'Actual AUTO died: ' + JSON.stringify(run.last));
      if (!bossCaptured && run.last.boss) {
        await page.evaluate(() => window.app.step(.001, true));
        await page.screenshot({ path: path.join(out, index + '-boss.png') }); bossCaptured = true;
      }
      if (chunk % 20 === 0) { await save(); console.log(JSON.stringify({ route, ...run.last })); }
      if (!run.last.active) break;
    }
    await page.evaluate(() => { for (let i = 0; i < 240; i++) window.app.step(1 / 60, false); window.app.step(.001, true); });
    run.after = await page.evaluate(() => {
      const a = window.app, b = a.battle; b.flushRpg(); b._qaRestore();
      return { rpg: structuredClone(b.ensureRpg()), spawns: window.__encounterSpawns, targetText: window.__encounterTarget,
        result: structuredClone(b.result), hero: structuredClone(a.eco.hero()), energy: a.eco.s.energy, gems: a.eco.s.gems, gold: a.eco.s.gold };
    });
    assert(run.last.win && run.after.result?.win, 'No actual victory for ' + JSON.stringify(route));
    const spawns = run.after.spawns; assert(spawns.length > 0 && spawns.some(e => e.boss), 'Missing real spawn observations');
    for (const e of spawns) {
      assert(e.maxHp === e.expectedHp && Math.abs(e.atk - e.expectedAtk) < 1e-8, 'Display change altered combat stats');
      if (route.kind === 'campaign') {
        assert(e.level === run.stage.idx + (e.boss ? 4 : e.elite ? 2 : 0), 'Wrong late campaign level');
        assert(e.record.lastFloor === run.stage.idx && e.record.lastEncounter?.floor === run.stage.idx, 'Late campaign place truncated');
      } else {
        const previous = run.before.rpg.bestiary[e.id];
        assert(e.level === null && e.record.highestLevel === (previous?.highestLevel || 1) && e.record.lastFloor === (previous?.lastFloor || 1), 'Template level changed numeric history');
        assert(e.record.lastEncounter?.kind === route.kind && e.record.lastEncounter?.id === route.id, 'Wrong actual expedition place');
        if (route.kind === 'dungeon') assert(e.record.lastEncounter?.depth === route.depth, 'Wrong actual dungeon depth');
        if (route.rift) assert(run.stage.riftId && e.record.lastEncounter?.riftId === run.stage.riftId, 'Wrong actual daily rift rule');
      }
    }
    const boss = spawns.find(e => e.boss), expectedPrefix = route.kind === 'campaign' ? 'Lv.' + boss.level : route.kind === 'arena' ? 'AI 결투' : route.rift ? '균열' : route.depth === 'deep' ? '심층' : '원정';
    assert(boss.bossHud.startsWith(expectedPrefix + ' '), 'Wrong boss HUD context');
    assert(run.after.targetText && (route.kind === 'campaign' ? /Lv\.(5[1-9]|6[0-4])\b/.test(run.after.targetText) : run.after.targetText.startsWith(expectedPrefix + ' ')), 'Target HUD context missing');
    if (route.kind !== 'campaign') assert(run.after.result.expeditionReceipt?.ok, 'Expedition settlement failed');
    const expectedEncounter = route.kind === 'campaign' ? { kind: 'campaign', floor: run.stage.idx }
      : route.kind === 'arena' ? { kind: 'arena', id: route.id }
      : { kind: 'dungeon', id: route.id, depth: route.depth, ...(route.rift ? { riftId: run.stage.riftId } : {}) };
    const lastRecord = run.after.rpg.bestiary[boss.id], expectedLocation = encounterLocationLabel(expectedEncounter);
    assert(isDeepStrictEqual(lastRecord.lastEncounter, expectedEncounter), 'Settled encounter does not match the requested route');
    await page.evaluate(id => { const a = window.app; a.expeditionUI.close(); a.toLobby(); a.battle.rpgView.selected = id; a.battle.rpgView.tab = 'bestiary'; }, boss.id);
    if (index === 1 || index === 2 || index === 6) {
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
      if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
    }
    await page.locator('.rpg-open').tap();
    await page.locator('#rpg-codex:modal').waitFor();
    run.codex = await page.locator('.rpg-detail').innerText(); assert(run.codex.includes(expectedLocation), 'Actual place absent from codex');
    assert((await page.locator('.rpg-reference').innerText()).startsWith('캠페인 '), 'Reference stats do not identify their campaign context');
    if (route.kind !== 'campaign') assert(!run.codex.includes('최고 레벨 기록'), 'Expedition-only context shows a misleading numeric high water');
    if (index === 1 || index === 2 || index === 6) {
      await page.locator('.rpg-encounter-location').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, index + '-codex-mobile.png') });
      assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), 'New codex location causes page overflow');
    }
    await page.locator('.rpg-close').tap(); await page.setViewportSize({ width: 1100, height: 760 });
    run.status = 'pass'; await save(); console.log(JSON.stringify({ route, status: run.status, seconds: run.last.elapsed, spawns: spawns.length, bossHud: boss.bossHud, location: expectedLocation }));
  }
  report.beforeReload = await page.evaluate(() => { window.app.battle.flushRpg(); window.app.eco.save(); return structuredClone(window.app.eco.s.rpg); });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await boot();
  report.afterReload = await page.evaluate(() => structuredClone(window.app.eco.s.rpg));
  assert(isDeepStrictEqual(report.beforeReload, report.afterReload), 'Actual browser reload changed encounter records');
  assert(!report.errors.length, 'Page errors: ' + report.errors.join('; ')); report.status = 'pass';
} catch (error) {
  report.status = 'fail'; report.failure = String(error.stack || error); process.exitCode = 1;
  if (page) try { await page.screenshot({ path: path.join(out, 'failure.png') }); } catch {}
} finally {
  await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve());
  report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, path: path.join(out, 'report.json'), failure: report.failure }));
}
