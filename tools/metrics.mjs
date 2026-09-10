#!/usr/bin/env node
/**
 * RSI 루프 게이트 A — 자동 채점 하네스.
 *
 *   node tools/metrics.mjs --out .rsi/head.json --shots .rsi/shots
 *   node tools/metrics.mjs --compare .rsi/base.json .rsi/head.json
 *
 * 한 층을 AUTO 로 끝까지 자동 플레이시키면서 PRD §2 의 지표를 뽑고,
 * 밴드를 벗어나면 exit 1 로 떨어진다. 게임 시간은 app.step(dt) 로 결정적으로 밟는다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'node:url';
import { BANDS, REGRESSION, assessMetrics, compareMetrics } from './metrics-contract.mjs';
import { installMetricsDriver } from './metrics-driver.mjs';
import { STORY_EVENTS } from '../src/data/masterworks.js';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const PROJ = fileURLToPath(new URL('..', import.meta.url));

// ---------- --compare 모드 ----------
if (args.includes('--compare')) {
  const i = args.indexOf('--compare');
  const base = JSON.parse(readFileSync(args[i + 1], 'utf8'));
  const head = JSON.parse(readFileSync(args[i + 2], 'utf8'));
  const failures = compareMetrics(base, head);
  if (!Array.isArray(base._choices) || !Array.isArray(head._choices) || JSON.stringify(base._choices) !== JSON.stringify(head._choices)) failures.push('choice-trace-mismatch');
  if (base._heroLevelStart !== 1 || head._heroLevelStart !== 1) failures.push('start-level-mismatch');
  const bad = new Set(failures).size;
  console.log('지표            기준선 →   이번      판정');
  for (const k of Object.keys(BANDS)) {
    const b = base[k], h = head[k];
    if (!Number.isFinite(b) || !Number.isFinite(h)) { console.log(`${k}: 유효한 표본 누락`); continue; }
    const lim = REGRESSION[k];
    const regressed = lim && b > 0 && h > b * lim;
    const arrow = h === b ? '=' : h > b ? '▲' : '▼';
    console.log(`${BANDS[k].label.padEnd(16)}${String(b).padStart(7)} → ${String(h).padStart(7)}  ${arrow}${regressed ? '  회귀!' : ''}`);
  }
  console.log(`선택 기록       ${JSON.stringify(base._choices)} → ${JSON.stringify(head._choices)}${failures.includes('choice-trace-mismatch') ? '  불일치!' : ''}`);
  console.log(`영웅 레벨       ${base._heroLevelStart}→${base._heroLevelEnd} / ${head._heroLevelStart}→${head._heroLevelEnd}`);
  console.log(bad ? `\n회귀 ${bad}건 — 이번 회전은 실패다.` : '\n회귀 없음.');
  process.exit(bad ? 1 : 0);
}

// ---------- 측정 모드 ----------
const OUT = arg('--out', '.rsi/head.json');
const SHOTS = arg('--shots', '.rsi/shots');
const PORT = Number(arg('--port', '4193'));
const FLOOR_TIMEOUT_SEC = Number(arg('--timeout', '600'));
const SEED = Number(arg('--seed', '20260905'));
if (!Number.isSafeInteger(SEED) || SEED < 0 || SEED > 0xffffffff) throw new Error('--seed must be a uint32');

mkdirSync(resolve(PROJ, dirname(OUT)), { recursive: true });
mkdirSync(resolve(PROJ, SHOTS), { recursive: true });

let serverReady = false, serverError = '';
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: PROJ, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', (chunk) => { if (String(chunk).includes(`http://127.0.0.1:${PORT}/`)) serverReady = true; });
srv.stderr.on('data', (chunk) => { serverError = (serverError + String(chunk)).slice(-500); });
srv.on('error', (error) => { serverError = error.message; });
const bail = async (msg, br) => { console.error('실패: ' + msg); try { await br?.close(); } catch {} srv.kill(); process.exit(1); };

let served = false;
for (let i = 0; i < 60; i++) {
  if (srv.exitCode !== null) await bail('측정 서버 시작 실패: ' + serverError);
  if (serverReady) try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) { served = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!served) await bail('측정 서버 준비 시간초과: ' + serverError);

const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();
// 웹폰트 CDN 은 헤드리스 컨테이너에서 프록시를 타지 않아 커넥션 리셋이 난다 —
// 게임이 아니라 CDN 을 재는 셈이라 하네스에선 빈 CSS 로 즉시 응답한다 (실측: 부트 0.9초 → 12.8초)
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));

const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/`);
try { await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 }); }
catch { await bail('부트 실패\n' + errors.slice(0, 10).join('\n'), br); }
const bootMs = Date.now() - t0;

// 저장소와 Masterworks runSeq까지 명시적으로 새 게임으로 격리한다.
const startLevel = await page.evaluate(() => {
  const e = window.app.eco;
  if (!e.reset()) throw new Error('새 저장 격리에 실패했습니다.');
  e.s.daily.last = Math.floor(Date.now() / 86400000);
  e.s.selected = 'knight'; e.hero('knight').level = 1; e.hero('knight').exp = 0; e.save();
  return e.hero('knight').level;
});
await page.click('#boot-start', { force: true });
await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());

const started = await page.evaluate(async (seed) => {
  // 지형 장식과 몹 표본을 동일한 시작 조건으로 비교한다. 테스트 브라우저 안에서만 적용.
  let state = seed >>> 0;
  Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  window.app.testPause = true;
  try { await window.app.startStage(window.app.eco.nextStage()); return true; }
  catch (e) { return String(e.message); }
}, SEED);
if (started !== true) await bail('startStage: ' + started, br);
await page.waitForTimeout(1200);

// 결정적 스텝으로 전환 + AUTO
await page.evaluate(() => { window.app.testPause = true; window.app.battle.player.auto = true; });
await page.evaluate(installMetricsDriver, { storyEvents: STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) })) });

// 전투 객체를 직접 변형하던 셰이더 워밍업은 표본 오염을 피하려고 제거했다.
// 프레임 지표는 이제 첫 플레이어가 실제로 겪는 최초 컴파일 비용까지 포함한다.

const DT = 1 / 60, CHUNK = 120;   // 한 번에 2초씩 밟는다
// 렌더는 청크 RENDER_EVERY 개마다 한 번. SwiftShader 는 난전 프레임 하나에 벽시계 5~30초를 태운다(JS 쪽 frameMs 에는 안 잡힌다 —
// 래스터는 GPU 프로세스에서 비동기로 돈다). 밀도 복구 후 매 청크 렌더로는 한 층이 bash 178초 상한을 넘겨 측정이 끊겼다.
const RENDER_EVERY = Number(arg('--render-every', '3'));
const maxChunks = Math.ceil(FLOOR_TIMEOUT_SEC / (CHUNK * DT));
let shots = 0, denseShot = false, sawBossFight = false, prevLoot = 0, dryFrames = 0, longestDry = 0;
const frameMs = [], aliveSeen = [], drawCalls = [];
const beats = { explore: false, encounter: false, vacuum: false, drop: false, setProgress: false, bossFound: false, bossKill: false, floorClear: false };
let s = null, gameSec = 0, hpLow = 0;

for (let k = 0; k < maxChunks; k++) {
  const doRender = k % RENDER_EVERY === 0 || (!denseShot && s && s.alive >= 10);   // 무리가 깔린 직후 청크는 반드시 그린다
  const r = await page.evaluate(({ dt, n, doRender }) => {
    const app = window.app, t = [];
    const info = app.renderer?.r?.info;
    if (info) { info.autoReset = false; info.reset(); }
    let advanced = 0, peakMissingHealth = 0;
    for (let i = 0; i < n && app.battle.active; i++) {
      const a = performance.now(); advanced += globalThis.__metricsDriver.step(dt, doRender && i === n - 1); t.push(performance.now() - a);
      const player = app.battle.player;
      if (player.maxHp > 0) peakMissingHealth = Math.max(peakMissingHealth, 1 - player.hp / player.maxHp);
    }
    const b = app.battle, W = b.world;
    return {
      frames: t,
      calls: app.renderer?.r?.info?.render?.calls ?? 0,
      rendered: doRender,
      active: b.active,
      won: b.result?.win === true,
      alive: b.enemies.filter((e) => e.alive).length,
      peak: b.peakAlive ?? 0,   // 게임 쪽 프레임 단위 누적 — 2초 샘플링이 놓치는 피크
      kills: b.kills,
      loot: b.drops?.loot?.length ?? 0,
      hp: b.player.hp, maxHp: b.player.maxHp,
      disc: W.rooms.filter((x) => x.discovered).length,
      clr: W.rooms.filter((x) => x.cleared).length,
      rooms: W.rooms.length,
      bossFound: !!b.bossFound,
      inBoss: b.curRoom?.type === 'boss',
      sets: (() => { try { return app.eco.setCount?.() ?? 0; } catch { return 0; } })(),
      advanced,
      peakMissingHealth,
    };
  }, { dt: DT, n: CHUNK, doRender });

  frameMs.push(...r.frames);
  if (r.rendered) drawCalls.push(r.calls);
  aliveSeen.push(r.alive);
  gameSec += r.advanced;

  // 도파민 8박자 발화 감지
  if (r.disc > 1) beats.explore = true;
  if (r.alive > 0) beats.encounter = true;
  if (r.alive >= 6) beats.vacuum = true;              // 무리가 실제로 깔렸다
  if (r.loot > prevLoot) { beats.drop = true; dryFrames = 0; } else dryFrames += r.advanced / DT;
  longestDry = Math.max(longestDry, dryFrames);
  if (r.sets > 0) beats.setProgress = true;
  if (r.bossFound) beats.bossFound = true;
  if (r.inBoss && r.alive > 0) sawBossFight = true;
  if (sawBossFight && r.clr === r.rooms) beats.bossKill = true;
  if (r.won) beats.floorClear = true;
  prevLoot = r.loot;
  hpLow = Math.max(hpLow, r.peakMissingHealth); // 청크 사이 피격 후 회복도 놓치지 않는다.

  // 무리가 실제로 깔린 순간 — 밀도 회전의 게이트 B 는 이 한 장으로 본다
  if (!denseShot && r.rendered && r.alive >= 10) { denseShot = true; const a = Date.now(); await page.screenshot({ path: resolve(PROJ, SHOTS, 'dense.png') }); if (args.includes('--verbose')) console.error(`  shot dense ${Date.now() - a}ms`); }
  // 스크린샷: 보스 발견 / 종료 (초반 컷은 dense.png 가 대신한다 — 스크린샷 한 장이 SwiftShader 에서 5~30초다)
  if (r.rendered && r.bossFound && shots < 1) {
    const a = Date.now(); await page.screenshot({ path: resolve(PROJ, SHOTS, `s${shots}.png`) }); shots++; if (args.includes('--verbose')) console.error(`  shot s${shots - 1} ${Date.now() - a}ms`);
  }
  s = r;
  if (args.includes('--verbose')) console.error(`[${Math.round(gameSec)}s]${r.rendered ? 'R' : ' '} alive=${r.alive} peak=${r.peak} kills=${r.kills} loot=${r.loot} rooms=${r.clr}/${r.rooms} hp=${Math.round(r.hp)} calls=${r.calls} chunkMs=${Math.round(r.frames.reduce((a, b) => a + b, 0))} maxMs=${Math.round(Math.max(...r.frames))} wall=${Math.round((Date.now() - t0) / 1000)}s`);
  if (!r.active) break;
}
await page.screenshot({ path: resolve(PROJ, SHOTS, `s${shots}.png`) });

const sorted = [...frameMs].sort((a, b) => a - b);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const m = {
  errors: errors.length,
  bootMs,
  floorClearSec: round(gameSec, 1),
  killsPerFloor: s.kills,
  maxAliveSeen: Math.max(s.peak, ...aliveSeen),
  _maxAliveSampled: Math.max(...aliveSeen),
  dropsPerFloor: prevLoot,
  longestDryStreakSec: round(longestDry * DT, 1),
  hitTakenRatio: round(hpLow, 3),
  avgFrameMs: round(frameMs.reduce((a, b) => a + b, 0) / frameMs.length),
  p95FrameMs: round(sorted[Math.floor(sorted.length * 0.95)]),
  rhythmBeats: Object.values(beats).filter(Boolean).length,
  drawCalls: Math.max(...drawCalls),
  _beats: beats,
  _roomsCleared: `${s.clr}/${s.rooms}`,
  _won: s.won,
  _seed: SEED,
  _choices: await page.evaluate(() => globalThis.__metricsDriver.snapshot().choices),
  _heroLevelStart: startLevel,
  _heroLevelEnd: await page.evaluate(() => window.app.eco.hero('knight').level),
  _endReason: s.active ? '시간초과' : !s.won ? '패배' : (s.clr >= s.rooms ? '전구역클리어' : '보스처치'),
  _avgAlive: round(aliveSeen.reduce((a, b) => a + b, 0) / aliveSeen.length, 1),
  _errorSamples: errors.slice(0, 5),
  _at: new Date().toISOString(),
};

writeFileSync(resolve(PROJ, OUT), JSON.stringify(m, null, 2));
await br.close(); srv.kill();

// ---------- 판정 ----------
const failures = assessMetrics(m);
const failed = failures.length;
console.log('\n지표                     값        밴드            판정');
for (const [k, band] of Object.entries(BANDS)) {
  const v = m[k];
  const lo = band.min ?? -Infinity, hi = band.max ?? Infinity;
  const ok = v >= lo && v <= hi;
  const range = `${band.min ?? ''}${band.min != null && band.max != null ? '~' : ''}${band.max != null ? (band.min != null ? band.max : '≤' + band.max) : '≥' + band.min}`;
  console.log(`${band.label.padEnd(18)}${String(v).padStart(9)}   ${range.padEnd(14)}  ${ok ? 'OK' : '벗어남'}`);
}
console.log(`\n박자: ${Object.entries(beats).filter(([, v]) => v).map(([k]) => k).join(' · ') || '없음'}`);
console.log(`구역: ${m._roomsCleared}   스크린샷: ${SHOTS}/`);
if (!m._won) console.log('실제 승리 없음 — 완주 게이트 실패');
if (m.errors) console.log('에러:\n  ' + m._errorSamples.join('\n  '));
console.log(failed ? `\n${failed}개 지표가 밴드를 벗어났다 — 이번 회전은 실패다.` : '\n전 지표 통과.');
process.exit(failed ? 1 : 0);
