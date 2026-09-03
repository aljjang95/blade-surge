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
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

// ---------- PRD §2 목표 밴드 ----------
const BANDS = {
  errors:             { max: 0,                 label: '콘솔 에러' },
  bootMs:             { max: 12000,             label: '부트 시간(ms)' },
  floorClearSec:      { min: 150, max: 420,     label: '층 클리어(초)' },
  killsPerFloor:      { min: 35,                label: '층당 처치' },
  maxAliveSeen:       { min: 14,                label: '동시 생존 최대' },
  dropsPerFloor:      { min: 8,                 label: '층당 드랍' },
  longestDryStreakSec:{ max: 35,                label: '무보상 최장(초)' },
  hitTakenRatio:      { min: 0.05, max: 0.45,   label: '피격 비율' },
  avgFrameMs:         { max: 42,                label: '평균 프레임(ms)' },
  p95FrameMs:         { max: 90,                label: 'p95 프레임(ms)' },
  rhythmBeats:        { min: 6,                 label: '도파민 8박자 발화' },
  drawCalls:          { max: 420,               label: '드로우콜' },
};
// 기준선 대비 회귀 허용치
const REGRESSION = { avgFrameMs: 1.15, drawCalls: 1.20 };

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const PROJ = resolve(new URL('..', import.meta.url).pathname);

// ---------- --compare 모드 ----------
if (args.includes('--compare')) {
  const i = args.indexOf('--compare');
  const base = JSON.parse(readFileSync(args[i + 1], 'utf8'));
  const head = JSON.parse(readFileSync(args[i + 2], 'utf8'));
  let bad = 0;
  console.log('지표            기준선 →   이번      판정');
  for (const k of Object.keys(BANDS)) {
    const b = base[k], h = head[k];
    if (b == null || h == null) continue;
    const lim = REGRESSION[k];
    const regressed = lim && b > 0 && h > b * lim;
    if (regressed) bad++;
    const arrow = h === b ? '=' : h > b ? '▲' : '▼';
    console.log(`${BANDS[k].label.padEnd(16)}${String(b).padStart(7)} → ${String(h).padStart(7)}  ${arrow}${regressed ? '  회귀!' : ''}`);
  }
  console.log(bad ? `\n회귀 ${bad}건 — 이번 회전은 실패다.` : '\n회귀 없음.');
  process.exit(bad ? 1 : 0);
}

// ---------- 측정 모드 ----------
const OUT = arg('--out', '.rsi/head.json');
const SHOTS = arg('--shots', '.rsi/shots');
const PORT = Number(arg('--port', '4193'));
const FLOOR_TIMEOUT_SEC = Number(arg('--timeout', '600'));

mkdirSync(resolve(PROJ, dirname(OUT)), { recursive: true });
mkdirSync(resolve(PROJ, SHOTS), { recursive: true });

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host'], { cwd: PROJ, stdio: 'ignore' });
const bail = async (msg, br) => { console.error('실패: ' + msg); try { await br?.close(); } catch {} srv.kill(); process.exit(1); };

for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const br = await chromium.launch({ args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));

const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/`);
try { await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 }); }
catch { await bail('부트 실패\n' + errors.slice(0, 10).join('\n'), br); }
const bootMs = Date.now() - t0;

// 일일보상/모달을 치우고 레벨을 올려 층을 돌 수 있게 한다
await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.hero().level = 30; e.save(); });
await page.click('#boot-start', { force: true });
await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());

const started = await page.evaluate(async () => {
  try { await window.app.startStage(window.app.eco.nextStage()); return true; }
  catch (e) { return String(e.message); }
});
if (started !== true) await bail('startStage: ' + started, br);
await page.waitForTimeout(1200);

// 결정적 스텝으로 전환 + AUTO
await page.evaluate(() => { window.app.testPause = true; window.app.battle.player.auto = true; });

const DT = 1 / 60, CHUNK = 120;   // 한 번에 2초씩 밟는다
const maxChunks = Math.ceil(FLOOR_TIMEOUT_SEC / (CHUNK * DT));
let shots = 0, sawBossFight = false, prevLoot = 0, dryFrames = 0, longestDry = 0;
const frameMs = [], aliveSeen = [], drawCalls = [];
const beats = { explore: false, encounter: false, vacuum: false, drop: false, setProgress: false, bossFound: false, bossKill: false, floorClear: false };
let s = null, gameSec = 0, hpLow = 0;

for (let k = 0; k < maxChunks; k++) {
  const r = await page.evaluate(({ dt, n }) => {
    const app = window.app, t = [];
    const info = app.renderer?.r?.info;
    if (info) { info.autoReset = false; info.reset(); }
    for (let i = 0; i < n; i++) { const a = performance.now(); app.step(dt, i === n - 1); t.push(performance.now() - a); }
    const b = app.battle, W = b.world;
    return {
      frames: t,
      calls: app.renderer?.r?.info?.render?.calls ?? 0,
      active: b.active,
      alive: b.enemies.filter((e) => e.alive).length,
      kills: b.kills,
      loot: b.drops?.loot?.length ?? 0,
      hp: b.player.hp, maxHp: b.player.maxHp,
      disc: W.rooms.filter((x) => x.discovered).length,
      clr: W.rooms.filter((x) => x.cleared).length,
      rooms: W.rooms.length,
      bossFound: !!b.bossFound,
      inBoss: b.curRoom?.type === 'boss',
      sets: (() => { try { return app.eco.setCount?.() ?? 0; } catch { return 0; } })(),
    };
  }, { dt: DT, n: CHUNK });

  frameMs.push(...r.frames);
  drawCalls.push(r.calls);
  aliveSeen.push(r.alive);
  gameSec += CHUNK * DT;

  // 도파민 8박자 발화 감지
  if (r.disc > 1) beats.explore = true;
  if (r.alive > 0) beats.encounter = true;
  if (r.alive >= 6) beats.vacuum = true;              // 무리가 실제로 깔렸다
  if (r.loot > prevLoot) { beats.drop = true; dryFrames = 0; } else dryFrames += CHUNK;
  longestDry = Math.max(longestDry, dryFrames);
  if (r.sets > 0) beats.setProgress = true;
  if (r.bossFound) beats.bossFound = true;
  if (r.inBoss && r.alive > 0) sawBossFight = true;
  if (sawBossFight && r.clr === r.rooms) beats.bossKill = true;
  if (!r.active) beats.floorClear = true;
  prevLoot = r.loot;
  if (r.maxHp > 0) hpLow = Math.max(hpLow, 1 - r.hp / r.maxHp);   // 이번 층에서 가장 많이 깎였던 지점

  // 스크린샷: 초반 / 보스 발견 / 종료
  if ((k === 3 || (r.bossFound && shots === 1)) && shots < 2) {
    await page.screenshot({ path: resolve(PROJ, SHOTS, `s${shots}.png`) }); shots++;
  }
  s = r;
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
  maxAliveSeen: Math.max(...aliveSeen),
  dropsPerFloor: prevLoot,
  longestDryStreakSec: round(longestDry * DT, 1),
  hitTakenRatio: round(hpLow, 3),
  avgFrameMs: round(frameMs.reduce((a, b) => a + b, 0) / frameMs.length),
  p95FrameMs: round(sorted[Math.floor(sorted.length * 0.95)]),
  rhythmBeats: Object.values(beats).filter(Boolean).length,
  drawCalls: Math.max(...drawCalls),
  _beats: beats,
  _roomsCleared: `${s.clr}/${s.rooms}`,
  _endReason: s.active ? '시간초과' : (s.clr >= s.rooms ? '전구역클리어' : '보스처치'),
  _avgAlive: round(aliveSeen.reduce((a, b) => a + b, 0) / aliveSeen.length, 1),
  _errorSamples: errors.slice(0, 5),
  _at: new Date().toISOString(),
};

writeFileSync(resolve(PROJ, OUT), JSON.stringify(m, null, 2));
await br.close(); srv.kill();

// ---------- 판정 ----------
let failed = 0;
console.log('\n지표                     값        밴드            판정');
for (const [k, band] of Object.entries(BANDS)) {
  const v = m[k];
  const lo = band.min ?? -Infinity, hi = band.max ?? Infinity;
  const ok = v >= lo && v <= hi;
  if (!ok) failed++;
  const range = `${band.min ?? ''}${band.min != null && band.max != null ? '~' : ''}${band.max != null ? (band.min != null ? band.max : '≤' + band.max) : '≥' + band.min}`;
  console.log(`${band.label.padEnd(18)}${String(v).padStart(9)}   ${range.padEnd(14)}  ${ok ? 'OK' : '벗어남'}`);
}
console.log(`\n박자: ${Object.entries(beats).filter(([, v]) => v).map(([k]) => k).join(' · ') || '없음'}`);
console.log(`구역: ${m._roomsCleared}   스크린샷: ${SHOTS}/`);
if (m.errors) console.log('에러:\n  ' + m._errorSamples.join('\n  '));
console.log(failed ? `\n${failed}개 지표가 밴드를 벗어났다 — 이번 회전은 실패다.` : '\n전 지표 통과.');
process.exit(failed ? 1 : 0);
