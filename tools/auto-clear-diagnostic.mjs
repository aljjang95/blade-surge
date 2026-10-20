// 단기 원인 분석 전용. 실제 호출을 감싸 시전·피해 횟수를 관찰하며, 27개 완주 비교에는 auto-clear-qa.mjs를 쓴다.
// 테스트 고정값: 새 저장, 영웅·레벨, 에너지, 원정 접근/레벨 조건만 맞춘다. 위치·체력·피해·처치·승리는 바꾸지 않는다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { installMetricsDriver } from './metrics-driver.mjs';

const arg = k => process.argv.find(a => a.startsWith('--' + k + '='))?.slice(k.length + 3) || '';
const taskRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(arg('root') || taskRoot);
const { STORY_EVENTS } = await import(pathToFileURL(path.join(root, 'src/data/masterworks.js')).href);
const { EXPEDITION_CONQUESTS } = await import(pathToFileURL(path.join(root, 'src/data/expedition-conquests.js')).href);
const tag = arg('tag') || 'run';
const only = arg('only');
const heroId = arg('hero') || 'knight';
const heroLevel = Number(arg('level') || 45);
const seedBase = Number(arg('seed') || 0x5eed1019) >>> 0;
const out = path.join(taskRoot, 'work/qa/auto-20261020', tag);
await fs.mkdir(out, { recursive: true });
const ROUTES = [['bellfall_crypt','standard'],['eclipse_hydra_vault','standard'],['verdigris_sanctum','standard'],['cinder_tide_lock','standard'],['cinder_tide_lock','deep'],
  ['ashforge_catacomb','standard'],['nightglass_observatory','standard'],['nightglass_observatory','deep'],['astral_leviathan_spire','standard'],['sable_mirage_basin','standard'],['comet_bastion','standard']];
const runs = [];
for (let st = 1; st <= 10; st++) runs.push({ id: 'stage-1-' + st, kind: 'stage', st });
for (const [id, depth] of ROUTES) runs.push({ id: 'route-' + id + '-' + depth, kind: 'dungeon', target: id, depth });
for (const c of EXPEDITION_CONQUESTS) runs.push({ id: 'conquest-' + c.id, kind: 'dungeon', target: c.dungeonId, depth: 'deep', conquestId: c.id });
const selected = only ? runs.filter(r => only.split(',').some(o => r.id.includes(o))) : runs;
const build = JSON.parse(await fs.readFile(path.join(root, 'dist/version.json'), 'utf8'));
const report = { tag, head: build.sha, build,
  harnessSha256: createHash('sha256').update(await fs.readFile(import.meta.filename)).digest('hex'),
  artifactSha256: createHash('sha256').update(await fs.readFile(path.join(root, 'dist/index.html'))).digest('hex'),
  fixture: '시나리오마다 새 브라우저 저장, 기사 45레벨, 기본 장비·스킬, AUTO. 입장 제한만 해제. 사망 시 실제 부활 경로 호출(별도 집계).',
  viewport: { width: 844, height: 390 }, seedBase, heroId, heroLevel,
  diagnostic: true, stepsPerChunk: 600, maxChunks: 40, dt: 1 / 60,
  started: new Date().toISOString(), runs: [], errors: [] };
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = 'http://127.0.0.1:' + server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let page;
try {
for (const [index, run] of selected.entries()) {
  const seed = (seedBase ^ Math.imul(run.id.length * 131 + run.id.charCodeAt(run.id.length - 1), 0x9e3779b9)) >>> 0;
  const row = { ...run, seed, status: 'running', deaths: 0, samples: [], stallSuspects: [] }; report.runs.push(row); await save();
  const context = await browser.newContext({ viewport: report.viewport, hasTouch: true, isMobile: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await context.newPage();
  try {
page.on('pageerror', e => report.errors.push(String(e).slice(0, 300)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
await page.evaluate(({ heroId, heroLevel }) => {
  const a = window.app, e = a.eco;
  if (!e.reset()) throw Error('새 저장 격리 실패');
  e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.tutorial = { completed: true };
  e.s.selected = heroId; const h = e.hero(heroId); h.level = heroLevel; h.exp = 0;
  e.save();
}, { heroId, heroLevel });
await page.locator('#boot-start').tap({ force: true });
await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
await page.evaluate(() => { const a = window.app; a.testPause = true; a.ui.closeModal(); });
    const started = await page.evaluate(async ({ run, index, seedBase }) => {
      const a = window.app, e = a.eco;
      a.ui.hideResult?.(); a.expeditionUI?.close?.(); a.toLobby(); a.ui.closeModal(); a.testPause = true;
      if (a.expedition.s.pending && a.expeditionTicket) a.expedition.abandon(a.expeditionTicket);
      e.s.energy = 9999; e.s.tutorial = { completed: true };
      a.journey.s.autoBattle = true;
      a.expedition.s.level = Math.max(a.expedition.s.level || 1, 99);
      a.expedition.dungeonAccess = () => ({ ok: true }); a.expedition.conquestAccess = () => ({ ok: true });
      let state = (seedBase ^ Math.imul(run.id.length * 131 + run.id.charCodeAt(run.id.length - 1), 0x9e3779b9)) >>> 0;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      if (run.kind === 'stage') {
        e.s.progress.unlocked = Math.max(e.s.progress.unlocked, run.st);
        return await a.startStage({ ch: 1, st: run.st });
      }
      const opts = { depth: run.depth }; if (run.conquestId) opts.conquestId = run.conquestId;
      a.startExpedition('dungeon', run.target, opts);
      return true;
    }, { run, index, seedBase });
    if (started === false) throw Error('출격 실패');
    await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
    await page.evaluate(() => { const a = window.app; a.testPause = true; a.battle.player.auto = true; a.ui.closeModal(); });
    await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });
    row.fixture = await page.evaluate(() => {
      const a = window.app, p = a.battle.player;
      globalThis.__deadT = 0;
      const diag = globalThis.__autoDiag = { combos: {}, casts: {}, damage: {} };
      const combo = p.startCombo; p.startCombo = function(i, ...args) { diag.combos[i] = (diag.combos[i] || 0) + 1; return combo.call(this, i, ...args); };
      const cast = p.tryCastSkill; p.tryCastSkill = function(i, ...args) { const ok = cast.call(this, i, ...args); if (ok) { const id = this.def.skills[i].id; diag.casts[id] = (diag.casts[id] || 0) + 1; } return ok; };
      const damage = a.battle.damageEnemy; a.battle.damageEnemy = function(e, ...args) { const hp = e.hp, result = damage.call(this, e, ...args), key = e.isBoss ? "boss" : e.behavior || "normal"; diag.damage[key] = (diag.damage[key] || 0) + Math.max(0, hp - e.hp); return result; };
      return { heroLevel: p.heroLevel, maxHp: p.maxHp, atk: p.atk, def: p.defense, skills: p.skillLevels,
        saveHero: JSON.parse(JSON.stringify(a.eco.hero(a.eco.s.selected))) };
    });
    let lastSig = '', still = 0;
    for (let chunk = 0; chunk < 40; chunk++) {
      const s = await page.evaluate(() => {
        const a = window.app, b = a.battle, P = b.player, W = b.world;
        let pauseError = null, deaths = 0;
        for (let i = 0; i < 600 && b.active; i++) {
          if (!P.alive) {
            // 사망은 진행 막힘과 분리해 기록한다. 실제 부활 경로를 사용한다.
            if (b.paused) { pauseError = 'paused-dead:' + [...b.pauseReasons].join('|'); break; }
            a.step(1 / 60, false);
            if (!P.alive && b.active && (globalThis.__deadT = (globalThis.__deadT || 0) + 1) > 240) { b.revivePlayer(); a.ui.closeModal?.(); deaths++; globalThis.__deadT = 0; }
            continue;
          }
          try { globalThis.__metricsDriver.step(1 / 60, false); }
          catch (err) { pauseError = String(err.message) + ' reasons=' + [...b.pauseReasons].join('|'); break; }
        }
        const room = W?.roomAt(P.pos.x, P.pos.z), target = b.autoTarget;
        const near = b.enemies.filter(e => e.alive && !e.spawning).map(e => ({ d: +Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z).toFixed(1), id: e.def?.name, behavior: e.behavior, hp: Math.round(e.hp), room: e.homeRoom?.id, x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1) })).sort((x, y) => x.d - y.d).slice(0, 6);
        const enemyHp = Math.round(b.enemies.reduce((sum, e) => sum + (e.alive ? e.hp : 0), 0));
        return { active: b.active, paused: b.paused, pauseError, deaths, elapsed: +b.elapsed.toFixed(1), kills: b.kills, enemyHp,
          pos: [+P.pos.x.toFixed(1), +P.pos.z.toFixed(1)], state: P.state, hp: Math.round(P.hp), auto: P.auto, mp: P.mp, ult: P.ult, cds: P.cds.slice(), diag: structuredClone(globalThis.__autoDiag),
          aim: P.lockTarget ? { id: P.lockTarget.def?.name, behavior: P.lockTarget.behavior, alive: P.lockTarget.alive } : null,
          cleared: W ? W.rooms.filter(r => r.cleared).length : 0, rooms: W ? W.rooms.length : 0, sealed: !!W?.sealed,
          room: room?.id ?? null, target: target ? { id: target.id, type: target.type, cleared: target.cleared, attunementPending: !!target.attunementPending } : null,
          route: b.routeObjectives ? { progress: b.routeObjectives.progress, hint: b.routeObjectives.hint?.() } : null,
          conquest: b.conquest ? { progress: b.conquest.progress, failed: b.conquest.failed, hint: b.conquest.hint() } : null,
          portal: !!b.portal, boss: b.boss ? { alive: b.boss.alive, hp: Math.round(b.boss.hp) } : null, bossDefeated: !!b.bossDefeated,
          pending: b.pending.length, alive: b.enemies.filter(e => e.alive).length, near,
          result: b.result ? { win: b.result.win, rooms: b.result.rooms, route: b.result.routeObjective?.complete ?? null, conquest: b.result.conquest?.complete ?? null } : null };
      });
      row.deaths += s.deaths; row.last = s;
      if (chunk % 3 === 0) row.samples.push(s);
      if (s.pauseError) { row.status = 'paused-blocked'; break; }
      if (!s.active) break;
      // 보스전에서 제자리 공격은 진행이다. 적 총 체력이 줄지 않고 다른 진행도 없을 때만 멈춤으로 본다.
      const sig = [s.cleared, s.kills, s.route?.progress, s.conquest?.progress, Math.round(s.pos[0] / 2), Math.round(s.pos[1] / 2), s.bossDefeated, s.alive].join('|');
      const hpDrop = row.prevEnemyHp !== undefined && s.enemyHp < row.prevEnemyHp * .995; row.prevEnemyHp = s.enemyHp;
      still = sig === lastSig && !hpDrop ? still + 1 : 0; lastSig = sig;
      // 과거 30초 정지는 보스 대기·회복 때문에 오탐했다. 의심 지점만 남기고 끝까지 실행한다.
      if (still === 3) row.stallSuspects.push(s);
      if (chunk % 3 === 0) await save();
    }
    if (row.status === 'running') {
      // 결과 화면과 정산 경로가 실제로 열리는지 확인한다.
      await page.evaluate(() => { for (let i = 0; i < 360; i++) window.app.step(1 / 60, false); });
      await page.waitForTimeout(2500);
      row.settle = await page.evaluate(() => {
        const a = window.app, b = a.battle;
        // 일반 결과와 React 원정 결과는 서로 다른 화면이다. 실제 저장 완료 표시도 함께 검사한다.
        const result = b.stage?.expedition ? document.querySelector('.exp-result-save[data-save="saved"]') : document.getElementById('result');
        const box = result?.getBoundingClientRect();
        return { active: b.active, win: b.result?.win ?? null, resultVisible: !!box?.width && !!box?.height && getComputedStyle(result).visibility !== 'hidden',
          expeditionPending: !!a.expedition.s.pending, receipt: b.result?.expeditionReceipt ? { ok: b.result.expeditionReceipt.ok } : null };
      });
      row.status = row.last?.result?.win && row.settle.win && !row.settle.active && row.settle.resultVisible && !row.settle.expeditionPending && (run.kind === 'stage' || row.settle.receipt?.ok)
        ? 'win' : row.last?.active ? 'timeout' : row.last?.result?.win ? 'settlement-failed' : 'lost';
    }
    if (row.status !== 'win' || index === 0 || run.id === 'route-bellfall_crypt-standard') {
      await page.evaluate(() => window.app.step(0, true));
      row.screenshot = `${run.id}.png`;
      await page.screenshot({ path: path.join(out, row.screenshot) });
    }
  } catch (err) { row.status = 'error'; row.error = String(err.message).slice(0, 400); }
  finally { await context.close(); }
  row.unassistedWin = row.status === 'win' && row.deaths === 0;
  console.log(JSON.stringify({ id: row.id, status: row.status, elapsed: row.last?.elapsed, cleared: row.last ? row.last.cleared + '/' + row.last.rooms : null, deaths: row.deaths, settle: row.settle, error: row.error }));
  await save();
}
report.finished = new Date().toISOString();
await save();
} finally { await browser.close(); await server.close(); }

