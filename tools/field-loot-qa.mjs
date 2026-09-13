import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { installMetricsDriver } from './metrics-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const seed = Number(arg('seed', '20260914')), count = Number(arg('runs', '1'));
const hero = arg('hero', 'knight'), tag = arg('tag', 'candidate');
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(count) || count < 1 || count > 20) throw Error('Invalid seed/run count');
if (!['knight', 'mage'].includes(hero) || !/^[a-z0-9-]{1,40}$/.test(tag)) throw Error('Invalid hero/tag');
const out = path.join(root, `work/field-loot-${hero}-${seed}-${tag}`);
await mkdir(out, { recursive: true });
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  started: new Date().toISOString(), seed, hero, count, status: 'running', runs: [], errors: [],
  scope: 'Local production build; fresh isolated save, originally owned hero, actual AUTO combat at fixed 1/60s and first offered choices. No grants, currency/clock/HP/damage/position/victory edits. Between wins, equip earned inventory only when preview power improves. Observational spawn/collect wrappers leave gameplay calls and values unchanged. This is acquisition/settlement evidence, not phone FPS, manual-play balance or a year-long progression certification.',
};
report.sources = Object.fromEntries(await Promise.all(['src/game/drops.js', 'src/game/economy.js', 'src/game/battle-base.js', 'src/ui/ui.js', 'tools/field-loot-qa.mjs'].map(async file => [file, createHash('sha256').update((await readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n')).digest('hex')])));
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const assert = (ok, message) => { if (!ok) throw Error(message); };
let server, browser;
try {
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  report.build = await (await fetch(`${url}/version.json`)).json();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.addInitScript(seed => { let n = seed; Math.random = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }, seed);
  const boot = async () => {
    if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
    // The real welcome/daily popup can open after the lobby has appeared.
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.app.testPause = true; window.app.ui.closeModal(); });
  };
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await boot();
  report.initial = await page.evaluate(hero => {
    const a = window.app, e = a.eco;
    e.s.selected = hero; e.save(); a.showcaseHero(hero, true);
    return { gold: e.s.gold, energy: e.s.energy, stones: e.s.stones, stones2: e.s.stones2, stones3: e.s.stones3, hero: structuredClone(e.hero()), inventory: structuredClone(e.s.inventory), progress: structuredClone(e.s.progress) };
  }, hero);
  assert(report.initial.hero.level === 1 && report.initial.hero.star === 1 && report.initial.progress.unlocked === 1, 'Save is not a fresh hero/campaign');
  for (let i = 0; i < count; i++) {
    const run = { index: i, status: 'running' }; report.runs.push(run);
    run.before = await page.evaluate(() => {
      const a = window.app, e = a.eco; a.toLobby(); a.testPause = true; a.ui.closeModal();
      const stage = e.nextStage();
      return { stage: stage.code, energyCost: stage.energy, energy: e.s.energy, gold: e.s.gold, stones: e.s.stones, stones2: e.s.stones2, stones3: e.s.stones3, hero: structuredClone(e.hero()), power: e.heroPower(e.s.selected), inventoryCount: e.s.inventory.length };
    });
    if (run.before.energy < run.before.energyCost) { run.status = 'energy-exhausted'; break; }
    assert(await page.evaluate(() => window.app.startStage(window.app.eco.nextStage())), `Start rejected: ${run.before.stage}`);
    await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting);
    await page.evaluate(() => {
      const a = window.app, b = a.battle, d = b.drops; a.testPause = true; b.player.auto = true;
      const ledger = { spawned: { stone2: 0, stone3: 0 }, collected: { stone2: 0, stone3: 0 }, pickups: [] };
      window.__lootLedger = ledger;
      const spawn = d.spawn, collect = d.collect;
      d.spawn = function (pos, kind, payload, options) {
        if (kind in ledger.spawned) ledger.spawned[kind] += payload * (options?.count ?? 1);
        return spawn.call(this, pos, kind, payload, options);
      };
      d.collect = function (item) {
        const result = collect.call(this, item);
        if (item.kind in ledger.collected) { ledger.collected[item.kind] += item.payload; ledger.pickups.push({ kind: item.kind, quantity: item.payload, time: b.elapsed, stones2: this.stones2, stones3: this.stones3 }); }
        return result;
      };
    });
    await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });
    for (let chunk = 0; chunk < 60; chunk++) {
      run.last = await page.evaluate(() => {
        const b = window.app.battle;
        for (let n = 0; n < 600 && b.active; n++) window.__metricsDriver.step(1 / 60, false);
        return { active: b.active, win: b.result?.win, elapsed: b.elapsed, kills: b.kills, rooms: b.roomsCleared, hp: b.player.hp, maxHp: b.player.maxHp, stones2: b.drops.stones2, stones3: b.drops.stones3 };
      });
      if (!run.last.active) break;
      if (chunk % 10 === 0) { await save(); console.log(JSON.stringify({ stage: run.before.stage, ...run.last })); }
    }
    await page.evaluate(() => { for (let n = 0; n < 240; n++) window.app.step(1 / 60, false); window.app.step(.001, true); });
    run.after = await page.evaluate(() => {
      const a = window.app, e = a.eco, b = a.battle, d = b.drops;
      return { result: structuredClone(b.result), gold: e.s.gold, energy: e.s.energy, stones: e.s.stones, stones2: e.s.stones2, stones3: e.s.stones3, hero: structuredClone(e.hero()), power: e.heroPower(e.s.selected), inventoryCount: e.s.inventory.length, ledger: window.__lootLedger, counters: { stones2: d.stones2, stones3: d.stones3, strayStone2: Object.hasOwn(d, 'stone2'), strayStone3: Object.hasOwn(d, 'stone3') }, remaining: d.items.filter(it => ['stone2', 'stone3'].includes(it.kind)).map(it => ({ kind: it.kind, state: it.state, quantity: it.payload })), choices: window.__metricsDriver.snapshot().choices };
    });
    await page.screenshot({ path: path.join(out, `${run.before.stage}-result.png`) });
    await save();
    assert(run.last.win === true && run.after.result?.reward, `Natural AUTO did not clear ${run.before.stage}: ${JSON.stringify(run.last)}`);
    for (const [kind, key] of [['stone2', 'stones2'], ['stone3', 'stones3']]) {
      const picked = run.after.ledger.collected[kind];
      assert(picked > 0, `${run.before.stage}: no actual ${kind} pickup observed`);
      assert(run.after.counters[key] === picked, `${run.before.stage}: picked ${picked} ${kind}, collected counter is ${run.after.counters[key]}`);
      assert(run.after[key] - run.before[key] === picked, `${run.before.stage}: ${kind} settlement mismatch`);
      assert(run.after.result.reward.got.some(r => r.k === key && r.n === picked), `${run.before.stage}: ${key} missing from reward receipt`);
    }
    assert(!run.after.counters.strayStone2 && !run.after.counters.strayStone3, 'Transient invalid resource counters created');
    run.equipped = await page.evaluate(() => {
      const a = window.app, e = a.eco; a.toLobby(); const actions = [];
      for (const item of e.s.inventory) {
        const p = e.previewItem(e.s.selected, item.uid);
        if (!p.remove && p.after.power > p.before.power) { e.equip(e.s.selected, item.uid); actions.push({ uid: item.uid, id: item.id, beforePower: p.before.power, afterPower: p.after.power }); }
      }
      return actions;
    });
    run.status = 'pass'; await save();
    console.log(JSON.stringify({ stage: run.before.stage, status: run.status, seconds: run.last.elapsed, heroLevel: run.after.hero.level, stones2: run.after.ledger.collected.stone2, stones3: run.after.ledger.collected.stone3 }));
  }
  report.beforeReload = await page.evaluate(() => { const e = window.app.eco; return { stones2: e.s.stones2, stones3: e.s.stones3, hero: structuredClone(e.hero()), progress: structuredClone(e.s.progress) }; });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await boot();
  report.reloaded = await page.evaluate(() => { const e = window.app.eco; return { stones2: e.s.stones2, stones3: e.s.stones3, hero: structuredClone(e.hero()), progress: structuredClone(e.s.progress) }; });
  assert(JSON.stringify(report.beforeReload) === JSON.stringify(report.reloaded), 'Real reload changed earned resources, gear or progress');
  assert(report.errors.length === 0, `Page errors: ${JSON.stringify(report.errors)}`);
  report.status = report.runs.every(r => r.status === 'pass') ? 'pass' : 'progression-boundary';
} catch (error) { report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve()); report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, report: path.join(out, 'report.json'), failure: report.failure })); }
