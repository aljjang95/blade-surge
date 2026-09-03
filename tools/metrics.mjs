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

// 일일보상/모달을 치운다. 영웅은 레벨 1(첫 플레이어 그대로) — 레벨 30 으로 재던 때는 1층을 11배 초과 전력으로 돌아 피격 0·1분 클리어가 나왔다 (window.__LV 로 바꿀 수 있다)
await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.hero().level = Number(window.__LV || 1); e.save(); });
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

// 워밍업: 이 층 로스터의 적 타입을 전부 한 번씩 그려 셰이더를 미리 컴파일한다.
// SwiftShader 는 새 프로그램 변종을 처음 만나는 프레임에서 수 초~수십 초를 멈추는데, 그건 렌더 비용이 아니라 컴파일 비용이다.
// 밀도 복구 후 한 층이 178초 호출 상한을 넘겨 측정이 불가능해져 넣었다. 측정 창 밖이라 avgFrameMs 는 기준선(컴파일 포함)보다 낮게 나온다.
const warm = await page.evaluate(() => {
  const app = window.app, b = app.battle, R = b.stage.rosterFor('normal');
  const types = [...new Set([...R.trash, ...R.ranged, ...R.elite, b.stage.chapter.boss])];
  const before = b.enemies.length;
  const made = types.map((t) => b.spawnEnemy(t, null, b.world.startRoom)).filter(Boolean);
  const auto = b.player.auto; b.player.auto = false; b.input.enabled = false;
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) app.step(1 / 60, i === 20 || i === 39);
  const ms = performance.now() - t0;
  for (const e of made) { e.dispose(); const i = b.enemies.indexOf(e); if (i >= 0) b.enemies.splice(i, 1); }
  for (const p of b.projectiles) if (p.mesh) b.scene.remove(p.mesh);
  b.projectiles.length = 0; b.boss = null; app.ui.showBoss('', false); b.fx.clearAll(); b.timers.length = 0; b.pending.length = 0;
  b.peakAlive = 0; b.elapsed = 0; b.kills = 0; b.combo = 0; b.maxCombo = 0; b.dmgDealt = 0;
  b.player.hp = b.player.maxHp; b.player.kb.set(0, 0, 0); b.player.stun = 0;
  b.player.auto = auto; b.input.enabled = true;
  return { types: made.length, leftover: b.enemies.length - before, ms: Math.round(ms) };
});
console.log(`워밍업: 적 ${warm.types}종 셰이더 컴파일 ${warm.ms}ms${warm.leftover ? ' (잔여 ' + warm.leftover + ')' : ''}`);

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
    for (let i = 0; i < n; i++) { const a = performance.now(); app.step(dt, doRender && i === n - 1); t.push(performance.now() - a); }
    const b = app.battle, W = b.world;
    return {
      frames: t,
      calls: app.renderer?.r?.info?.render?.calls ?? 0,
      rendered: doRender,
      active: b.active,
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
    };
  }, { dt: DT, n: CHUNK, doRender });

  frameMs.push(...r.frames);
  if (r.rendered) drawCalls.push(r.calls);
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
