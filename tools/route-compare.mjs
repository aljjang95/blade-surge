// 던전 동선 비교 — 같은 시드·영웅·저장에서 AUTO 로 mode=full / mode=direct 를 돌려 시간·보상을 견준다.
//   node tools/route-compare.mjs [--stages 1-1,1-5,1-10,2-5,3-5] [--hero knight] [--level rec|<숫자>] [--levels 2-5=40,3-5=50]
//        [--root <dist 가 있는 체크아웃>] [--seed 1] [--max-sec 900] [--determinism 1-1] [--out work/qa/route-compare/<시각>]
// 전제: `bun run build` 산출물(dist). vite preview + Playwright, 고정 dt(1/60)로 window.app 을 진행한다. p.auto 는 true(게임의 AUTO 경로).
// 동선은 localStorage 'bs.dungeonRoute.v1' 로만 바꾼다(게임이 입장 때 읽는다). 시드·영웅·레벨·에너지는 두 동선에 똑같이 적용한다.
// 결정성: --determinism 관문(기본 첫 관문)을 같은 조건으로 한 번 더 돌려 핵심 수치가 같은지 비교한다('off' 면 생략).
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CHROME } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';
import { installMetricsDriver } from './metrics-driver.mjs';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { recommendedLevel } from '../src/data/loot-tables.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const projectRoot = path.resolve(import.meta.dirname, '..');
// --root: dist 를 만든 다른 체크아웃(기본은 이 저장소). 결과는 항상 이 저장소의 work/ 아래에 쓴다.
const root = path.resolve(arg('root', projectRoot));
const STAGES = arg('stages', '1-1,1-5,1-10,2-5,3-5').split(',').map((s) => s.trim()).filter(Boolean);
const HERO = arg('hero', 'knight'), LEVEL = arg('level', 'rec'), SEED = Number(arg('seed', 1)) >>> 0;
const LEVELS = Object.fromEntries(arg('levels', '').split(',').filter(Boolean).map((x) => x.split('=')));
const MAX_SEC = Number(arg('max-sec', 900)), DET = arg('determinism', STAGES[0]);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const OUT = path.resolve(projectRoot, arg('out', `work/qa/route-compare/${stamp}`));
await fs.mkdir(OUT, { recursive: true });

const server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = 'http://127.0.0.1:' + server.httpServer.address().port;
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const storyEvents = STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id: cid }) => ({ id: cid })) }));

/** 관문 하나 × 동선 하나. 새 컨텍스트(빈 저장)에서 시작해 매번 같은 조건이다. */
async function runOne(code, mode) {
  const [ch, st] = code.split('-').map(Number);
  // --level rec(기본): 관문 권장 레벨. 숫자면 전 관문 고정, --levels 로 관문별 덮어쓰기.
  const level = Number(LEVELS[code] ?? (LEVEL === 'rec' ? recommendedLevel(ch, st) : LEVEL));
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await installAutoStarter(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await page.evaluate(({ HERO, level }) => {
      const e = window.app.eco;
      if (!e.reset()) throw Error('새 저장 격리 실패');
      e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.tutorial = { completed: true };
      e.s.selected = HERO; const h = e.hero(HERO); h.level = level; h.exp = 0; e.save();
    }, { HERO, level });
    await page.locator('#boot-start').tap({ force: true });
    await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
    const entered = await page.evaluate(async ({ ch, st, mode, SEED }) => {
      const a = window.app, e = a.eco;
      a.ui.closeModal(); a.testPause = true;
      localStorage.setItem('bs.dungeonRoute.v1', JSON.stringify({ mode, guide: true }));
      let s = SEED >>> 0;   // mulberry32
      Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      e.s.energy = 9999; e.s.progress.unlocked = Math.max(e.s.progress.unlocked, (ch - 1) * 10 + st);
      setInterval(() => { document.querySelector('.lore-scene-skip')?.click(); }, 250);
      const ok = await a.startStage({ ch, st });
      a.testPause = true;
      if (ok === false) return { ok: false, reason: 'startStage false' };
      for (let i = 0; i < 100 && !(a.battle?.active && a.battle.player); i++) await new Promise((r) => setTimeout(r, 100));
      const b = a.battle; if (!b?.active) return { ok: false, reason: 'battle not active' };
      b.player.auto = true; a.ui.closeModal?.();
      return { ok: true, energy: b.stage.energy, recPower: b.stage.recPower, power: e.heroPower(e.s.selected), routeMode: b.routeMode, early: !!b.routeOpenEarly,
        rooms: b.world.rooms.length, hero: { id: e.s.selected, level: e.hero().level } };
    }, { ch, st, mode, SEED });
    if (!entered.ok) return { code, mode, error: entered.reason };
    await page.evaluate(installMetricsDriver, { storyEvents });
    let last = null, deaths = 0;
    for (let chunk = 0; chunk < 400; chunk++) {
      last = await page.evaluate((maxSec) => {
        const a = window.app, b = a.battle, P = b.player; let err = null, d = 0, dead = 0;
        for (let i = 0; i < 600 && b.active && b.elapsed < maxSec; i++) {
          if (!P.alive) {
            if (b.paused) { err = 'paused-dead'; break; }
            a.step(1 / 60, false);
            if (!P.alive && b.active && ++dead > 240) { b.revivePlayer(); a.ui.closeModal?.(); d++; dead = 0; }
            continue;
          }
          try { globalThis.__metricsDriver.step(1 / 60, false); } catch (x) { err = String(x.message).slice(0, 160); break; }
        }
        return { active: b.active, err, deaths: d, elapsed: b.elapsed };
      }, MAX_SEC);
      deaths += last.deaths;
      if (!last.active || last.err || last.elapsed >= MAX_SEC) break;
    }
    const res = await page.evaluate(() => {
      const a = window.app, b = a.battle;
      for (let i = 0; i < 900 && !(b.result && a.ui.resultData === b.result && b.result.reward); i++) a.step(1 / 60, false);
      const r = b.result, rw = r?.reward;
      const opt = b.world.rooms.filter((x) => x.type !== 'start' && x.type !== 'boss');
      return { hasResult: !!r, win: !!r?.win, elapsed: +(r?.time ?? b.elapsed).toFixed(2), battleElapsed: +b.elapsed.toFixed(2), kills: r?.kills ?? b.kills,
        rooms: r?.rooms ?? null, totalRooms: r?.totalRooms ?? null, optionalCleared: opt.filter((x) => x.cleared).length, optionalTotal: opt.length,
        fullClear: !!r?.fullClear, stars: r?.stars ?? null,
        exp: rw?.totalExp ?? null, stageExp: rw?.exp ?? null, combatExp: rw?.combatExp ?? null,
        gold: (rw?.got || []).filter((g) => g.k === 'gold').reduce((n, g) => n + g.n, 0), got: (rw?.got || []).map((g) => g.k + ':' + g.n), loot: (rw?.loot || []).length,
        fullClearBonus: rw?.fullClearBonus || null, routeMode: b.routeMode, bossDefeated: !!b.bossDefeated };
    });
    return { code, mode, level, seed: SEED, ...entered, deaths, timeout: last?.elapsed >= MAX_SEC, pauseError: last?.err || null, errors, ...res };
  } catch (err) { return { code, mode, error: String(err.message).slice(0, 300) }; }
  finally { await ctx.close(); }
}

const runs = [];
const log = (r) => { runs.push(r); console.error(JSON.stringify({ code: r.code, mode: r.mode, win: r.win, t: r.elapsed, rooms: `${r.rooms}/${r.totalRooms}`, exp: r.exp, gold: r.gold, error: r.error })); };
try {
  for (const code of STAGES) for (const mode of ['full', 'direct']) log(await runOne(code, mode));
  // 결정성: 같은 조건으로 한 번 더 돌려 핵심 수치를 견준다.
  const det = [];
  if (DET && DET !== 'off') for (const mode of ['full', 'direct']) {
    const a = runs.find((r) => r.code === DET && r.mode === mode), b = await runOne(DET, mode);
    const keys = ['win', 'elapsed', 'kills', 'rooms', 'totalRooms', 'fullClear', 'stars', 'exp', 'gold', 'loot'];
    const diff = keys.filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${a?.[k]} vs ${b[k]}`);
    det.push({ code: DET, mode, same: !diff.length, diff, first: a && Object.fromEntries(keys.map((k) => [k, a[k]])), second: Object.fromEntries(keys.map((k) => [k, b[k]])) });
  }
  // 동선 합계: 분당 = 합계/총 분, 판당 = 합계/총 에너지.
  const sum = {};
  for (const mode of ['full', 'direct']) {
    const rs = runs.filter((r) => r.mode === mode && !r.error);
    const sec = rs.reduce((n, r) => n + r.elapsed, 0), energy = rs.reduce((n, r) => n + (r.energy || 0), 0);
    const exp = rs.reduce((n, r) => n + (r.exp || 0), 0), gold = rs.reduce((n, r) => n + (r.gold || 0), 0);
    sum[mode] = { stages: rs.length, wins: rs.filter((r) => r.win).length, sec: +sec.toFixed(1), energy, exp, gold,
      expPerMin: +(exp / (sec / 60)).toFixed(1), goldPerMin: +(gold / (sec / 60)).toFixed(1), expPerEnergy: +(exp / energy).toFixed(2), goldPerEnergy: +(gold / energy).toFixed(2) };
  }
  const perStage = STAGES.map((code) => {
    const f = runs.find((r) => r.code === code && r.mode === 'full'), d = runs.find((r) => r.code === code && r.mode === 'direct');
    const pm = (r, k) => (r && !r.error && r.elapsed ? +(r[k] / (r.elapsed / 60)).toFixed(1) : null);
    return { code, full: f, direct: d, expPerMin: { full: pm(f, 'exp'), direct: pm(d, 'exp') }, goldPerMin: { full: pm(f, 'gold'), direct: pm(d, 'gold') } };
  });
  const summary = { stamp, head: JSON.parse(await fs.readFile(path.join(root, 'dist/version.json'), 'utf8').catch(() => '{}')),
    fixture: { hero: HERO, level: LEVEL, levels: LEVELS, seed: SEED, energy: 9999, viewport: '844x390', dt: '1/60', auto: true, maxSec: MAX_SEC }, runs, perStage, totals: sum, determinism: det };
  await fs.writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  const pad = (v, n) => String(v ?? '-').padEnd(n);
  console.log('관문  동선    승  시간(s) 처치 정화  전체  별  경험치  골드  장비  에너지 | 분당exp 분당골드');
  for (const p of perStage) for (const mode of ['full', 'direct']) {
    const r = p[mode]; if (!r) continue;
    if (r.error) { console.log(pad(p.code, 6) + pad(mode, 8) + 'ERR ' + r.error); continue; }
    console.log(pad(p.code, 6) + pad(mode, 8) + pad(r.win ? 'O' : 'X', 3) + pad(r.elapsed, 8) + pad(r.kills, 5) + pad(`${r.optionalCleared}/${r.optionalTotal}`, 6)
      + pad(r.fullClear ? 'Y' : 'n', 6) + pad(r.stars, 3) + pad(r.exp, 8) + pad(r.gold, 6) + pad(r.loot, 5) + pad(r.energy, 6) + '| ' + pad(p.expPerMin[mode], 8) + p.goldPerMin[mode]);
  }
  console.log('\n합계', JSON.stringify(sum));
  console.log('결정성', JSON.stringify(det.map((d) => ({ code: d.code, mode: d.mode, same: d.same, diff: d.diff }))));
  console.log('저장:', path.join(OUT, 'summary.json'));
} finally { await browser.close(); await server.close(); }
