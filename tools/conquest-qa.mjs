import { chromium, firefox, webkit } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EXPEDITION_CONQUESTS } from '../src/data/expedition-conquests.js';
import { SUMMON_GEAR } from '../src/data/summon-gear.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { installMetricsDriver } from './metrics-driver.mjs';
import { installConquestMediaObserver, classifyMediaCancellations } from './conquest-media-observer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = key => process.argv.find(a => a.startsWith('--' + key + '='))?.slice(key.length + 3) || '';
const summonOrder = process.argv.includes('--summon-order');
const tag = arg('tag'); if (tag && !/^[a-z0-9-]{1,35}$/.test(tag)) throw Error('Invalid evidence tag');
const out = path.join(root, 'work/conquest-qa' + (tag ? '-' + tag : ''));
const seed = Number(arg('seed') || 20261104); if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('Expected uint32 seed');
const hash = b => createHash('sha256').update(b).digest('hex');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const relative = 'work/natural-progression-mage-20261031-chapter-six/after-21-star_archive-deep.json';
const bytes = await fs.readFile(path.join(root, relative)), acquired = JSON.parse(bytes);
assert(hash(bytes) === '93ef4b18a148b9f343228324e6d22142b11b65fd1d01ebf9bfe5344bde5964a2' && acquired.syntheticQaOnly && acquired.schema === 'bladesurge-synthetic-qa-save/v1', 'Acquired profile mismatch');
assert(acquired.save.spentKRW === 0 && !acquired.save.purchases.length && !acquired.save.expedition.pending, 'Expected settled free-play save');
const parent = JSON.parse(await fs.readFile(path.join(root, path.dirname(relative), 'report.json'), 'utf8'));
assert(parent.status === 'pass' && parent.runs.some(r => r.checkpointAfter?.sha256 === hash(bytes) && r.checkpointAfter.path.replaceAll('\\', '/') === relative), 'Missing prior acquisition proof');
// 소환 장비 회귀만 분리한다. 장비는 격리 QA 세이브에만 넣으며 획득 증거로 취급하지 않는다.
const syntheticEquipment = summonOrder ? SUMMON_GEAR.filter(item => item.rarity === 'U') : [];
if (summonOrder) {
  const save = acquired.save; save.selected = 'mage';
  let uid = Math.max(save.invSeq, 1 + Math.max(0, ...save.inventory.map(item => item.uid)));
  for (const def of syntheticEquipment) {
    save.inventory.push({ uid, id: def.id, enh: 0 }); save.heroes.mage.equip[def.slot] = uid++;
  }
  save.invSeq = uid;
}
const sources = execFileSync('rg', ['--files', 'src'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(f => f.replaceAll('\\', '/'));
sources.push('tools/conquest-qa.mjs', 'tools/metrics-driver.mjs', 'tools/conquest-media-observer.mjs');
await fs.mkdir(out, { recursive: true });
const report = { status: 'running', started: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Compiled local build. Existing acquired free mage checkpoint on bc345e8 is restored once in an isolated save. Actual departures, AUTO and first native offered choice at fixed 1/60s; no combat position, HP, damage, kill, mark or victory edits. Owned free gems may fund the catalogued energy refill, recorded below. Prior acquisition is separate evidence. Mobile UI/touch emulation is not physical-phone, OS installation, thermal or manual combat proof.',
  acquisition: { path: relative, sha256: hash(bytes), head: acquired.head }, syntheticEquipment: syntheticEquipment.map(item => item.id), seed, runs: [], ui: [], errors: [], requestFailures: [], httpErrors: [], media: [], mediaRequests: [],
  sources: Object.fromEntries(await Promise.all(sources.map(async f => [f, hash((await fs.readFile(path.join(root, f), 'utf8')).replaceAll('\r\n', '\n'))]))) };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await fs.copyFile(import.meta.filename, path.join(out, 'driver.mjs'));
let server, browser;
const attach = (page, engine) => {
  const requests = new WeakMap();
  const request = r => { const row={ engine, url:r.url(), at:Date.now(), type:r.resourceType(), range:r.headers().range || null }; requests.set(r,row); if(row.type==='media') report.mediaRequests.push(row); };
  const error = e => report.errors.push({ engine, error: String(e) });
  const failed = r => { const row=requests.get(r), timing=r.timing(); if(row) Object.assign(row,{started:timing.startTime,timing,failedAt:timing.responseEnd>=0?timing.startTime+timing.responseEnd:Date.now(),nodeFailureAt:Date.now(),error:r.failure()?.errorText}); report.requestFailures.push(row || { engine, url:r.url(), error:r.failure()?.errorText,failedAt:Date.now() }); };
  const response = r => { const row=requests.get(r.request()),timing=r.request().timing(); if(row) Object.assign(row,{started:timing.startTime,status:r.status(),responseAt:timing.responseStart>=0?timing.startTime+timing.responseStart:Date.now(),nodeResponseAt:Date.now(),contentRange:r.headers()['content-range']||null}); if (r.status() >= 400) report.httpErrors.push({ engine, url: r.url(), status: r.status() }); };
  page.on('request',request); page.on('pageerror', error); page.on('requestfailed', failed); page.on('response', response);
  return () => { page.off('request',request); page.off('pageerror', error); page.off('requestfailed', failed); page.off('response', response); };
};
async function boot(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
  await page.evaluate(() => { window.app.testPause = true; window.app.ui.closeModal(); });
  await page.waitForTimeout(1000);
}
try {
  server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8'); report.entry = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  report.entrySha256 = hash(await fs.readFile(path.join(root, 'dist', report.entry)));
  report.build = await (await fetch(url + '/version.json')).json();
  if (!process.argv.includes('--ui-only')) {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, hasTouch: true, reducedMotion: 'reduce' }), detach = attach(page, 'combat-chromium');
    await page.addInitScript(installConquestMediaObserver);
    await page.addInitScript(s => { if (!localStorage.getItem('bladesurge_save_v1')) localStorage.setItem('bladesurge_save_v1', JSON.stringify(s)); }, acquired.save);
    await boot(page, url);
    for (const [index, c] of EXPEDITION_CONQUESTS.filter(c => !summonOrder || c.kind === 'priority').entries()) {
      const run = { id: c.id, status: 'running' }; report.runs.push(run); await save();
      run.before = await page.evaluate(() => {
        const a = window.app; a.expeditionUI.close(); a.toLobby(); a.ui.closeModal(); a.testPause = true;
        const actions = [];
        if (a.eco.s.energy < 6) {
          const sku = a.eco.sku('en2'), before = { gems: a.eco.s.gems, energy: a.eco.s.energy };
          if (sku.kind !== 'gem' || sku.price !== 100 || sku.rewards.energy !== 120) throw Error('Changed energy catalog');
          if (!a.eco.purchase('en2')?.ok) throw Error('Owned free energy refill failed');
          actions.push({ sku: 'en2', before, after: { gems: a.eco.s.gems, energy: a.eco.s.energy } });
        }
        return { actions, marks: [...a.expedition.s.conquests], materials: { ...a.expedition.s.materials }, energy: a.eco.s.energy };
      });
      await page.evaluate(({ c, index, seed }) => {
        const a = window.app; let state = (Math.imul(seed, index + 1) ^ 0x9e3779b9) >>> 0;
        Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
        a.expeditionUI.open('dungeons');
      }, { c, index, seed });
      await page.locator('.exp-route-tabs').getByRole('button', { name: '전술 공략', exact: false }).tap();
      const departure=page.locator('[data-conquest="'+c.id+'"] .exp-primary'); await departure.scrollIntoViewIfNeeded(); await departure.tap();
      await page.waitForFunction(id=>window.app.battle.active&&!window.app.stageStarting&&window.app.battle.stage.expedition.conquestId===id,c.id,{timeout:120000});
      await page.evaluate(() => {
        window.app.testPause = true; const b = window.app.battle; b.player.auto = true; window.__conquestDeaths = [];
        const death = b.onEnemyDeath, damage = b.damageEnemy; const lastHit = new WeakMap();
        b.damageEnemy = function(e, amount, opts = {}) { if(e) lastHit.set(e, {kind:opts.kind,finisher:!!opts.finisher,quiet:!!opts.quiet,player:!opts.source||opts.source===this.player,state:this.player.state,combo:this.player.comboIdx,skill:this.player.skillCtx?.sk.id}); return damage.call(this,e,amount,opts); };
        b.onEnemyDeath = function(e) { const result = death.call(this,e); if(e.conquestInitial) window.__conquestDeaths.push({room:e.homeRoom.id,target:!!e.conquestTarget,name:e.def.name,maxHp:e.maxHp,hit:lastHit.get(e),pos:{x:e.pos.x,z:e.pos.z},progress:this.conquest.progress}); return result; };
        b._qaConquestRestore = () => { b.onEnemyDeath = death; b.damageEnemy = damage; delete b._qaConquestRestore; };
      });
      if (summonOrder) {
        run.summons = await page.evaluate(() => window.app.battle.sp.summons.map(s => s.id));
        assert(run.summons.length === 4, 'Expected four equipped combat familiars');
      }
      await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });
      run.pause = await page.evaluate(() => {
        const b = window.app.battle, before = { elapsed: b.elapsed, progress: b.conquest.progress, markerT: b.conquest.markerT };
        b.setPaused('manual', true); for (let i = 0; i < 120; i++) window.app.step(1 / 60, false);
        const after = { elapsed: b.elapsed, progress: b.conquest.progress, markerT: b.conquest.markerT }; b.setPaused('manual', false); return { before, after };
      });
      assert(JSON.stringify(run.pause.before) === JSON.stringify(run.pause.after), 'Paused simulation advanced');
      let captured = false;
      for (let chunk = 0; chunk < 180; chunk++) {
        run.last = await page.evaluate(captured => {
          const b = window.app.battle;
          for (let i = 0; i < 600 && b.active; i++) { window.__metricsDriver.step(1 / 60, false); if (!captured && b.boss?.alive && !b.boss.spawning) break; }
          return { active: b.active, win: b.result?.win, elapsed: b.elapsed, kills: b.kills, hp: b.player.hp, progress: b.conquest.progress, failed: b.conquest.failed, boss: !!b.boss?.alive && !b.boss.spawning };
        }, captured);
        if (!captured && run.last.boss) {
          run.boss = await page.evaluate(() => { const b = window.app.battle; window.app.step(.001, true); return { name: b.boss.def.name, pattern: b.boss.def.pattern, maxHp: b.boss.maxHp, atk: b.boss.atk, hint: document.querySelector('.conquest-hint')?.textContent }; });
          await page.screenshot({ path: path.join(out, c.id + '-boss.png') }); captured = true;
        }
        if (!run.last.active) break;
        if (chunk % 12 === 0) { await save(); console.log(JSON.stringify({ id: c.id, ...run.last })); }
      }
      for (let i = 0; i < 4; i++) await page.evaluate(() => { for (let frame = 0; frame < 180; frame++) window.app.step(1 / 60, false); });
      run.after = await page.evaluate(() => {
        const a = window.app, b = a.battle; a.step(.001, true);
        b._qaConquestRestore();
        return { result: structuredClone(a.expeditionUI.result), outcome: b.result?.conquest, deaths:window.__conquestDeaths, rooms: b.world.rooms.map(r => ({ id: r.id, cleared: r.cleared, attuned: !!r.attuned, waves: r.forgeWave || 0 })),
          marks: [...a.expedition.s.conquests], materials: { ...a.expedition.s.materials }, pending: a.expedition.s.pending, choices: window.__metricsDriver.snapshot().choices, peakAlive: b.peakAlive, maxAlive: b.maxAlive };
      });
      const resultCard=page.locator('.exp-conquest-result'); await resultCard.scrollIntoViewIfNeeded();
      assert(await page.locator('.loot-pop, .reward-fly').count()===0,'Combat rewards cover the result');
      await page.screenshot({ path: path.join(out, c.id + '-result.png') }); await save();
      assert(run.after.result?.win && !run.after.result.saveError && run.after.outcome?.complete, `${c.id}: real conquest did not complete: ${JSON.stringify(run.last)}`);
      assert(run.after.rooms.every(r => r.cleared) && run.after.pending === null, 'Unfinished rooms or receipt');
      assert(run.after.marks.length === run.before.marks.length + 1 && run.after.marks.includes(c.id) && run.after.result.rewards.conquest.firstClear, 'Missing first-success mark');
      const deep = EXPEDITION_DEPTHS.find(d => d.id === c.dungeonId), material = Object.keys(c.firstRewards.materials)[0];
      assert(run.after.materials[material] - run.before.materials[material] === deep.rewards.materials[material] + c.firstRewards.materials[material], 'First bonus amount mismatch');
      assert(run.after.choices.length === 1 && run.after.choices[0].startsWith('boon:') && run.after.peakAlive <= run.after.maxAlive, 'Choice interruption or actor budget regression');
      if (c.kind === 'altars') assert(JSON.stringify(run.after.outcome.altars) === JSON.stringify(c.order), 'Actual altar sequence differs');
      if (c.kind === 'priority') assert(run.after.outcome.cancelledWaves === 2 && run.after.rooms.every(r => !r.waves), 'Signal did not cancel actual reinforcements');
      run.status = 'pass'; await save(); console.log(JSON.stringify({ id: c.id, status: 'pass', elapsed: run.last.elapsed, kills: run.last.kills }));
    }
    await page.waitForTimeout(1000);
    const saved = await page.evaluate(() => { window.app.eco.save(); return structuredClone(window.app.eco.s.expedition); });
    report.media.push({engine:'combat-chromium',snapshot:await page.evaluate(()=>window.__conquestMedia.snapshot())});
    await boot(page, url);
    report.reload = await page.evaluate(() => structuredClone(window.app.expedition.s));
    assert(JSON.stringify(report.reload.conquests) === JSON.stringify(saved.conquests) && JSON.stringify(report.reload.materials) === JSON.stringify(saved.materials) && !report.reload.pending, 'Settled marks/rewards changed on reload');
    detach(); await browser.close(); browser = null;
  }
  if (!process.argv.includes('--combat-only')) for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
    browser = await launcher.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' }), detach = attach(page, engine);
    await page.addInitScript(installConquestMediaObserver);
    await page.addInitScript(s => { if (!localStorage.getItem('bladesurge_save_v1')) localStorage.setItem('bladesurge_save_v1', JSON.stringify(s)); }, acquired.save);
    await boot(page, url); await page.locator('#btn-battle').tap(); await page.locator('.exp-route-tabs').getByRole('button', { name: '전술 공략', exact: false }).tap();
    const ui = { engine, version: browser.version(), layouts: [], status: 'running' }; report.ui.push(ui);
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(size); if (await page.locator('#btn-ignore-rotate').isVisible()) await page.locator('#btn-ignore-rotate').tap();
      const layout = { ...size, rows: [] }; ui.layouts.push(layout);
      for (const c of EXPEDITION_CONQUESTS) {
        const row = page.locator('[data-conquest="' + c.id + '"]'), summary = row.locator('summary'), button = row.locator('.exp-primary');
        await summary.scrollIntoViewIfNeeded(); if (!await row.locator('details').getAttribute('open').then(v => v !== null)) await summary.tap();
        await button.scrollIntoViewIfNeeded();
        const bounds = await button.evaluate(e => { const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { disabled: e.disabled, height: r.height, inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, hit: hit === e || e.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
        assert(bounds.disabled === !!c.previous && bounds.height >= 44 && bounds.inside && bounds.hit && !bounds.overflow, `${engine}/${size.width}/${c.id}: ${JSON.stringify(bounds)}`);
        layout.rows.push({ id: c.id, ...bounds });
      }
      await page.locator('[data-conquest="garden_dawn"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `${engine}-${size.width}x${size.height}.png`) });
    }
    const unchanged = await page.evaluate(() => ({ marks: window.app.expedition.s.conquests, pending: window.app.expedition.s.pending }));
    assert(!unchanged.marks.length && !unchanged.pending, 'Reading tactics created progress or charged departure');
    await page.locator('.exp-close').tap(); assert(await page.locator('#btn-battle').isVisible(), 'Return to lobby failed');
    report.media.push({engine,snapshot:await page.evaluate(()=>window.__conquestMedia.snapshot())});
    ui.status = 'pass'; detach(); await browser.close(); browser = null; await save();
  }
  report.mediaCancellations = classifyMediaCancellations(report.requestFailures, report.media);
  assert(!report.errors.length && !report.mediaCancellations.unresolved.length && !report.httpErrors.length, 'Unresolved online runtime/network failure: ' + JSON.stringify({ errors: report.errors, requests: report.mediaCancellations.unresolved, httpErrors: report.httpErrors }));
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(resolve => server?.httpServer.close(resolve) || resolve()); report.finished = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, path: path.join(out, 'report.json'), failure: report.failure })); }
