// MMO P1-E T1 개연성 표 보정·검증 드라이버 (docs/MMO_DESIGN.md P1-E 수용 기준: 정상 AUTO 클리어 100판 모두 통과).
// 실제 빌드(vite preview of dist)에서 캠페인 스테이지를 AUTO로 끝까지 진행하고, 클라이언트가 정산 때 보내는 사실(src/net/account.js facts)을
// 같은 순간(eco.completeStage / battle.defeat)에 그대로 캡처한다. 서버와 같은 순수 함수(validateFacts·plausibility)로 판정한다.
// 실행: bun run build && bun tools/mmo-calibrate.mjs --calibrate   /   bun tools/mmo-calibrate.mjs --verify 100
// 고정값: 판마다 새 저장, 튜토리얼 완료, 선택 영웅 레벨 = 권장 레벨, 에너지, 해금. 위치·체력·피해·처치·승리는 바꾸지 않는다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installMetricsDriver } from './metrics-driver.mjs';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { recommendedLevel } from '../src/data/loot-tables.js';
import { stageDef } from '../src/data/stages.js';
import { applyDifficulty, DIFFICULTIES } from '../src/game/difficulty.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { heroCombatProfile, plausibility, validateFacts, KILL_RANKS } from '../src/shared/settlement.js';
import { installAutoStarter } from './qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, fallback) => {
  const eq = argv.find((a) => a.startsWith('--' + k + '='));
  if (eq) return eq.slice(k.length + 3);
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const mode = flag('calibrate') ? 'calibrate' : flag('verify') ? 'verify' : null;
if (!mode) { console.error('사용법: bun tools/mmo-calibrate.mjs --calibrate [--seeds 4] | --verify [100]'); process.exit(2); }
const concurrency = Math.max(1, Number(opt('concurrency', 3)));
const tablePath = path.join(root, 'src/data/plausibility-table.json');
const outDir = path.join(root, 'work/qa/mmo-calibrate');
await fs.mkdir(outDir, { recursive: true });
const MAX_REVIVES = 3;

// 보정 대상: 1장 전 스테이지(스토리) + 다른 장 표본. 표본 장은 권장 레벨에서 AUTO가 이길 수 있는지도 함께 본다.
const CH1 = Array.from({ length: 10 }, (_, i) => `1-${i + 1}`);
const SAMPLE = (opt('sample', '2-1,2-5,2-10,3-1,3-5,4-1,5-1,6-1')).split(',').filter(Boolean);
const stageList = (opt('stages', '') || [...CH1, ...SAMPLE].join(',')).split(',').filter(Boolean);
const mix32 = (x) => { x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b); return (x ^ (x >>> 16)) >>> 0; };
// 보정과 검증은 다른 시드 영역을 쓴다(검증은 보정에서 본 적 없는 판).
const seedFor = (code, i, salt) => mix32((salt * 0x9e3779b9) ^ mix32(code.split('').reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) + i));

function planCalibrate() {
  const seeds = Number(opt('seeds', 4)), sampleSeeds = Number(opt('sample-seeds', 2));
  const jobs = [];
  for (const code of stageList) {
    const n = CH1.includes(code) ? seeds : sampleSeeds;
    for (let i = 0; i < n; i++) jobs.push({ code, difficulty: 'story', seed: seedFor(code, i, 0xca1b), lootSeed: seedFor(code, i, 0x1007) });
  }
  return jobs;
}

/** 검증: 표에 측정 행이 있는 스테이지를 돌아가며, 보정에 쓰지 않은 시드로 승리 N판을 채운다. */
async function planVerify(n) {
  const table = JSON.parse(await fs.readFile(tablePath, 'utf8'));
  const measured = Object.keys(table.stages || {}).map((k) => k.split(':')[0]);
  const codes = opt('stages', '') ? stageList : measured.length ? measured : CH1;
  let i = 0;
  return () => {
    const code = codes[i % codes.length], round = Math.floor(i / codes.length);
    i++;
    return { code, difficulty: 'story', seed: seedFor(code, round, 0x7e51f1), lootSeed: seedFor(code, round, 0x10071) };
  };
}

const server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = 'http://127.0.0.1:' + server.httpServer.address().port;
const browser = await chromium.launch({ executablePath: opt('chromium', '/opt/pw-browsers/chromium'),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const storyEvents = STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) }));

async function runOne(job) {
  const [ch, st] = job.code.split('-').map(Number);
  // --level은 과레벨 탐색용(보정·검증 기본은 권장 레벨).
  const level = Number(opt('level', 0)) || recommendedLevel(ch, st);
  const row = { ...job, heroLevel: level, status: 'running', revives: 0, hpLost: 0, errors: [] };
  const t0 = Date.now();
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => row.errors.push(String(e).slice(0, 200)));
  try {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await page.evaluate(({ level }) => {
      const e = window.app.eco;
      if (!e.reset()) throw Error('새 저장 격리 실패');
      e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.tutorial = { completed: true };
      const h = e.hero(e.s.selected); h.level = level; h.exp = 0;
      e.save();
    }, { level });
    await page.locator('#boot-start').tap({ force: true });
    await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
    const pre = await page.evaluate(({ ch, st, level, seed, lootSeed }) => {
      const a = window.app, e = a.eco, b = a.battle;
      a.testPause = true; a.ui.closeModal();
      e.s.energy = 9999; e.s.tutorial = { completed: true };
      e.s.progress.unlocked = Math.max(e.s.progress.unlocked, e.stageIndex(ch, st));
      const h = e.hero(e.s.selected); h.level = level; h.exp = 0;
      e.save();
      a.journey.s.autoBattle = true;
      // 정산 사실 캡처: src/net/account.js facts()와 같은 식, 같은 순간.
      globalThis.__facts = null;
      const facts = (win, extra = {}) => {
        const k = b.drops?.killCounts || {}, s = b.drops?.summonedKills || null;
        const kills = { normal: k.normal || 0, elite: k.elite || 0, boss: k.boss || 0 };
        return { win, elapsedMs: Math.max(0, Math.round((b.elapsed || 0) * 1000)), kills, ...(s ? { summonedKills: { normal: s.normal, elite: s.elite, boss: s.boss } } : {}),
          roomsCleared: Math.max(0, b.roomsCleared | 0), damageDealt: Math.max(0, Math.round(b.dmgDealt || 0)), ...extra };
      };
      const start = b.start.bind(b);
      // 서버 티켓 대신 고정 lootSeed를 건다(account.js와 같이 start 전후로 설정).
      b.start = async (...args) => { b.v1Run = { lootSeed }; const out = await start(...args); b.v1Run = { lootSeed, contentId: `${ch}-${st}` }; return out; };
      const completeStage = e.completeStage.bind(e);
      e.completeStage = (stage, stars, opts = {}) => {
        if (b.v1Run && stage?.code === b.v1Run.contentId && !globalThis.__facts) globalThis.__facts = facts(true, { stars: Math.max(1, Math.min(3, stars | 0)), fullClear: !!opts.fullClear });
        return completeStage(stage, stars, opts);
      };
      const defeat = b.defeat.bind(b);
      b.defeat = (...args) => { const live = b.active; const out = defeat(...args); if (live && !globalThis.__facts) globalThis.__facts = facts(false); return out; };
      let state = seed >>> 0;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      return { save: JSON.parse(JSON.stringify(e.s)), heroId: e.s.selected };
    }, { ch, st, level, seed: job.seed, lootSeed: job.lootSeed });
    row.heroId = pre.heroId;
    // 서버가 정산 때 보는 것과 같은 계산: 출격 직전 저장 → EconomyCore → heroCombatProfile.
    const eco = EconomyCore.fromState(pre.save, { now: () => Date.now(), rng: Math.random });
    const profile = heroCombatProfile(eco, pre.heroId);
    row.saveHeroLevel = eco.hero(pre.heroId).level;
    row.heroAtk = profile.atk; row.maxHp = profile.maxHp;
    const started = await page.evaluate(({ ch, st }) => window.app.startStage({ ch, st }), { ch, st });
    if (started === false) throw Error('출격 실패');
    await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
    await page.evaluate(() => { const a = window.app; a.testPause = true; a.battle.player.auto = true; a.ui.closeModal(); globalThis.__deadT = 0; globalThis.__revives = 0; globalThis.__hpLost = 0; globalThis.__prevHp = a.battle.player.hp; });
    await page.evaluate(installMetricsDriver, { storyEvents });
    const stage = await page.evaluate(() => ({ code: window.app.battle.stage.code, difficulty: window.app.battle.stage.difficultyId || 'story', v1: !!window.app.battle.v1Run }));
    row.difficulty = stage.difficulty;
    if (stage.code !== job.code || !stage.v1) throw Error('스테이지·시드 모드 불일치 ' + JSON.stringify(stage));
    for (let chunk = 0; chunk < 160; chunk++) {
      const s = await page.evaluate((maxRevives) => {
        const a = window.app, b = a.battle, P = b.player;
        let pauseError = null;
        for (let i = 0; i < 600 && b.active; i++) {
          if (!P.alive) {
            if (b.paused) { pauseError = 'paused-dead:' + [...b.pauseReasons].join('|'); break; }
            a.step(1 / 60, false);
            if (!P.alive && b.active && (globalThis.__deadT = (globalThis.__deadT || 0) + 1) > 240) {
              globalThis.__deadT = 0; a.ui.closeModal?.();
              // 실제 플레이어의 부활 선택(최대 maxRevives회), 넘으면 포기(패배)한다.
              if (globalThis.__revives < maxRevives) { b.revivePlayer(); globalThis.__revives++; } else { b.defeat(); break; }
              globalThis.__prevHp = P.hp;
            }
            continue;
          }
          try { globalThis.__metricsDriver.step(1 / 60, false); }
          catch (err) { pauseError = String(err.message) + ' reasons=' + [...b.pauseReasons].join('|'); break; }
          if (P.hp < globalThis.__prevHp) globalThis.__hpLost += globalThis.__prevHp - P.hp;
          globalThis.__prevHp = P.hp;
        }
        return { active: b.active, pauseError, elapsed: b.elapsed, win: b.result?.win ?? null };
      }, MAX_REVIVES);
      if (s.pauseError) { row.status = 'paused-blocked'; row.pauseError = s.pauseError; break; }
      if (!s.active) break;
    }
    if (row.status === 'running') {
      // 승리 후 결과·정산 경로(completeStage)가 실제로 불릴 때까지 진행한다.
      for (let i = 0; i < 20; i++) {
        const done = await page.evaluate(() => { for (let k = 0; k < 60; k++) window.app.step(1 / 60, false); return !!globalThis.__facts; });
        if (done) break;
        await page.waitForTimeout(250);
      }
      const out = await page.evaluate(() => ({ facts: globalThis.__facts, active: window.app.battle.active, win: window.app.battle.result?.win ?? null,
        revives: globalThis.__revives, revived: window.app.battle.revived, hpLost: Math.round(globalThis.__hpLost) }));
      row.revives = out.revives; row.revivedCounter = out.revived; row.hpLost = out.hpLost;
      row.facts = out.facts;
      row.status = out.active ? 'timeout' : !out.facts ? 'no-facts' : out.facts.win ? 'win' : 'lost';
    }
  } catch (err) { row.status = 'error'; row.error = String(err.message).slice(0, 400); }
  finally { await context.close().catch(() => {}); }
  row.runMs = Date.now() - t0;
  if (row.facts) {
    const f = row.facts, stage = applyDifficulty(stageDef(...row.code.split('-').map(Number)), DIFFICULTIES[row.difficulty] || DIFFICULTIES.story);
    row.invalid = validateFacts(f);
    // 실시간 클라이언트: 서버 벽시계 경과 = 게임 경과.
    row.check = row.invalid ? null : plausibility(stage, f, { heroAtk: row.heroAtk, maxHp: row.maxHp, wallMs: f.elapsedMs });
    row.dpsRatio = f.damageDealt / (row.heroAtk * Math.max(1, f.elapsedMs) / 1000);
    // 참고용: 클라이언트는 revives·hpLost를 보내지 않는다. 보냈다면 어떤 판정인지 따로 기록한다.
    if (!row.invalid) row.checkWithExtras = plausibility(stage, { ...f, revives: row.revives, hpLost: row.hpLost }, { heroAtk: row.heroAtk, maxHp: row.maxHp, wallMs: f.elapsedMs });
  }
  const f = row.facts;
  console.log(JSON.stringify({ code: row.code, seed: row.seed, status: row.status, lv: row.heroLevel, atk: row.heroAtk, ms: f?.elapsedMs, kills: f?.kills, summoned: f?.summonedKills,
    rooms: f?.roomsCleared, dps: row.dpsRatio && +row.dpsRatio.toFixed(2), revives: row.revives, verdict: row.check?.verdict, issues: row.check?.issues, invalid: row.invalid || undefined, error: row.error, runS: Math.round(row.runMs / 1000) }));
  return row;
}

async function pool(next, shouldStop) {
  const rows = [];
  const worker = async () => { for (let job; !shouldStop(rows) && (job = next()); ) rows.push(await runOne(job)); };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return rows;
}

const t0 = Date.now();
const summed = (o) => KILL_RANKS.reduce((a, k) => a + (o?.[k] || 0), 0);
let report;
try {
  if (mode === 'calibrate') {
    const jobs = planCalibrate();
    let i = 0;
    const rows = await pool(() => jobs[i++], () => false);
    const table = JSON.parse(await fs.readFile(tablePath, 'utf8'));
    const byKey = new Map();
    for (const r of rows) if (r.facts && !r.invalid) { const k = `${r.code}:${r.difficulty}`; (byKey.get(k) || byKey.set(k, []).get(k)).push(r); }
    const stages = {}, observed = {};
    let maxDps = 0;
    for (const [key, list] of [...byKey].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
      const wins = list.filter((r) => r.facts.win);
      if (!wins.length) continue;
      const max = (fn) => Math.max(...list.map(fn));
      const kills = Object.fromEntries(KILL_RANKS.map((k) => [k, Math.max(1, Math.ceil(max((r) => r.facts.kills[k] || 0) * 1.5))]));
      const summonedMax = max((r) => summed(r.facts.summonedKills));
      const maxRooms = max((r) => r.facts.roomsCleared) + 4;
      // 엘리트는 일반 방마다 35% 확률로 추가되므로 표본 최댓값이 아니라 방 수로 묶는다(방당 최대 2).
      kills.elite = Math.max(kills.elite, maxRooms * 2);
      stages[key] = {
        minClearMs: Math.max(10000, Math.floor(Math.min(...wins.map((r) => r.facts.elapsedMs)) * 0.5)),
        kills, summonedKills: Math.ceil(summonedMax * 1.5) + 10, maxRooms,
      };
      observed[key] = { runs: list.length, wins: wins.length, elapsedMs: [Math.min(...wins.map((r) => r.facts.elapsedMs)), Math.max(...wins.map((r) => r.facts.elapsedMs))],
        kills: Object.fromEntries(KILL_RANKS.map((k) => [k, [Math.min(...list.map((r) => r.facts.kills[k] || 0)), max((r) => r.facts.kills[k] || 0)]])),
        summonedMax, roomsMax: max((r) => r.facts.roomsCleared), dpsMax: +max((r) => r.dpsRatio).toFixed(2), revivesMax: max((r) => r.revives) };
      maxDps = Math.max(maxDps, max((r) => r.dpsRatio));
    }
    const d = table.defaults, rowsList = Object.values(stages);
    const defaults = {
      minClearMs: Math.min(d.minClearMs, ...rowsList.map((r) => r.minClearMs)),
      kills: Object.fromEntries(KILL_RANKS.map((k) => [k, Math.max(d.kills[k], ...rowsList.map((r) => r.kills[k]))])),
      summonedKills: Math.max(d.summonedKills, ...rowsList.map((r) => r.summonedKills)),
      maxRooms: Math.max(d.maxRooms, ...rowsList.map((r) => r.maxRooms)),
    };
    const dpsNeed = Math.ceil(maxDps * 1.3);
    const dpsPerAtk = Math.max(table.dpsPerAtk, dpsNeed);
    const next = { version: 'p1-calibrated-' + new Date().toISOString().slice(0, 10).replaceAll('-', ''), note: table.note,
      dpsPerAtk, damageSlack: table.damageSlack, maxRevives: table.maxRevives, wallClockSlack: table.wallClockSlack, defaults, stages };
    next.note = 'MMO P1-E T1 개연성 상한. tools/mmo-calibrate.mjs --calibrate가 권장 레벨 AUTO 클리어 관측값으로 스테이지·난이도별 값을 채운다(처치 ×1.5, 엘리트는 방 수×2 이상, 소환 ×1.5+10, 방 +4, 최소 시간 ×0.5). 표에 없는 스테이지는 defaults를 쓴다.';
    await fs.writeFile(tablePath, JSON.stringify(next, null, 2) + '\n');
    report = { mode, runs: rows.length, wins: rows.filter((r) => r.status === 'win').length, statuses: countBy(rows, 'status'), maxDpsObserved: +maxDps.toFixed(3), dpsNeed, dpsPerAtk,
      observed, table: next, rows: rows.map(slim), runtimeS: Math.round((Date.now() - t0) / 1000) };
  } else {
    const n = Number(opt('verify', 100)) || 100, maxAttempts = Number(opt('max-attempts', Math.ceil(n * 1.5)));
    const next = await planVerify(n);
    let issued = 0;
    const rows = await pool(() => (issued++ < maxAttempts ? next() : null), (rs) => rs.filter((r) => r.status === 'win').length >= n);
    const wins = rows.filter((r) => r.status === 'win');
    const bad = wins.filter((r) => r.invalid || r.check?.verdict !== 'ok');
    const losses = rows.filter((r) => r.status === 'lost');
    report = { mode, target: n, attempts: rows.length, wins: wins.length, losses: losses.length, statuses: countBy(rows, 'status'),
      okWins: wins.length - bad.length, rejectedOrSoft: bad.map(slim), lossesChecked: countBy(losses.map((r) => ({ v: r.check?.verdict || r.invalid })), 'v'),
      extrasNote: '클라이언트는 revives·hpLost를 보내지 않는다. checkWithExtras는 보냈을 때의 참고 판정이다.',
      extrasVerdicts: countBy(wins.map((r) => ({ v: r.checkWithExtras?.verdict + ':' + (r.checkWithExtras?.issues || []).join('|') })), 'v'),
      maxDpsObserved: +Math.max(0, ...wins.map((r) => r.dpsRatio)).toFixed(3), pass: wins.length >= n && bad.length === 0,
      rows: rows.map(slim), runtimeS: Math.round((Date.now() - t0) / 1000) };
  }
} finally { await browser.close(); await server.close(); }

function countBy(rows, key) { const o = {}; for (const r of rows) o[r[key]] = (o[r[key]] || 0) + 1; return o; }
function slim(r) {
  return { code: r.code, difficulty: r.difficulty, seed: r.seed, lootSeed: r.lootSeed, status: r.status, heroId: r.heroId, heroLevel: r.heroLevel, saveHeroLevel: r.saveHeroLevel,
    heroAtk: r.heroAtk, maxHp: r.maxHp, facts: r.facts, revives: r.revives, hpLost: r.hpLost, dpsRatio: r.dpsRatio && +r.dpsRatio.toFixed(3), invalid: r.invalid,
    check: r.check, checkWithExtras: r.checkWithExtras, error: r.error, pauseError: r.pauseError, pageErrors: r.errors?.slice(0, 3), runMs: r.runMs };
}
const file = path.join(outDir, mode === 'calibrate' ? 'calibrate.json' : 'report.json');
await fs.writeFile(file, JSON.stringify(report, null, 2));
const { rows: _rows, table: _table, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
console.log('report →', path.relative(root, file));
if (mode === 'verify' && !report.pass) process.exitCode = 1;
