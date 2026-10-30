// 스테이지 전투력/권장 비율 → 승패 곡선 측정기 (3개월 ch2-entry 덩어리, 2026-10-30).
// 같은 시작 상태(새 저장, 선택 영웅, 기본 장비)에서 영웅 레벨만 바꿔 전투력/권장 비율을 움직이고, AUTO 로 끝까지 싸운다.
// 부활 없음: 처음 쓰러지면 패배로 센다(봇 표본의 "쓰러짐"과 같은 기준). 받은 피해는 피격 호출 스택의 첫 게임 함수로 출처를 나눈다.
// 실행: bun run dev (별도) 후  node tools/qa/stage-power-sweep.mjs --stages=1-10,2-1,2-2 --levels=6,8,10,12 --seeds=3 [--origin=http://127.0.0.1:5173]
// 고정값: 저장·레벨·에너지·해금·Math.random 시드만. 위치·체력·피해·처치·승리는 바꾸지 않는다. 결과는 work/qa/power-sweep/<tag>.json.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installMetricsDriver } from '../metrics-driver.mjs';
import { installAutoStarter } from '../qa-starter.mjs';
import { STORY_EVENTS } from '../../src/data/masterworks.js';

const root = path.resolve(import.meta.dirname, '../..');
const opt = (k, d) => process.argv.find((a) => a.startsWith('--' + k + '='))?.slice(k.length + 3) ?? d;
const origin = opt('origin', 'http://127.0.0.1:5173');
const stages = opt('stages', '1-10,2-1,2-2').split(',').filter(Boolean);
const levels = opt('levels', '6,8,10,12').split(',').map(Number);
const seeds = Number(opt('seeds', 3));
const hero = opt('hero', '');
const tag = opt('tag', 'sweep');
const concurrency = Math.max(1, Number(opt('concurrency', 2)));
const maxGameS = Number(opt('max-s', 600));
const outDir = path.join(root, 'work/qa/power-sweep');
await fs.mkdir(outDir, { recursive: true });
const storyEvents = STORY_EVENTS.map(({ id, choices }) => ({ id, choices: choices.map(({ id }) => ({ id })) }));
const browser = await chromium.launch({ executablePath: opt('chromium', '/opt/pw-browsers/chromium'), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function runOne(job) {
  const [ch, st] = job.code.split('-').map(Number);
  const row = { ...job, status: 'running', errors: [] };
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => row.errors.push(String(e).slice(0, 200)));
  try {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await installAutoStarter(page);
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
    await page.evaluate(({ hero }) => {
      const e = window.app.eco;
      if (!e.reset()) throw Error('새 저장 격리 실패');
      e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.tutorial = { completed: true };
      if (hero && e.s.heroes?.[hero]) e.s.selected = hero;
      e.save();
    }, { hero });
    await page.locator('#boot-start').tap({ force: true });
    await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 180000 });
    const pre = await page.evaluate(({ ch, st, level, seed }) => {
      const a = window.app, e = a.eco;
      a.testPause = true; a.ui.closeModal();
      e.s.energy = 9999; e.s.tutorial = { completed: true };
      e.s.progress.unlocked = Math.max(e.s.progress.unlocked, e.stageIndex(ch, st));
      const h = e.hero(e.s.selected); h.level = level; h.exp = 0;
      e.save();
      a.journey.s.autoBattle = true;
      let state = seed >>> 0;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      return { heroId: e.s.selected, power: e.heroPower(e.s.selected), stats: e.heroBuildStats(e.s.selected) };
    }, { ch, st, level: job.level, seed: job.seed });
    row.heroId = pre.heroId; row.power = pre.power; row.atk = pre.stats.atk; row.hp = pre.stats.hp; row.def = pre.stats.def;
    const started = await page.evaluate(({ ch, st }) => window.app.startStage({ ch, st }), { ch, st });
    if (started === false) throw Error('출격 실패');
    await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
    row.recPower = await page.evaluate(() => window.app.battle.stage.recPower);
    row.ratio = +(row.power / row.recPower).toFixed(3);
    await page.evaluate(() => {
      const a = window.app, P = a.battle.player; a.testPause = true; P.auto = true; a.ui.closeModal();
      // 출처: 스택에서 player.hurt 바로 위의 함수 이름과 파일. 개발 서버(비압축)에서만 의미가 있다.
      const src = globalThis.__dmgSrc = {}; const hurt = P.hurt.bind(P);
      globalThis.__minHp = 1; globalThis.__roomAt = [];
      P.hurt = (dmg, opts = {}) => {
        const before = P.hp; const out = hurt(dmg, opts); const lost = before - P.hp;
        if (lost > 0) {
          const lines = (new Error().stack || '').split('\n').slice(2).map((l) => l.trim());
          const f = lines.find((l) => !/player\.js|stage-power-sweep/.test(l)) || '?';
          const m = f.match(/at (?:Object\.|new )?([\w.$<>]+)? ?\(?.*\/src\/([\w/.-]+\.js)/);
          const key = (opts.kind || 'blunt') + ' ← ' + (m ? (m[1] || 'anon') + '@' + m[2] : f.slice(0, 60));
          const s = src[key] || (src[key] = { dmg: 0, hits: 0 }); s.dmg += lost; s.hits++;
          globalThis.__minHp = Math.min(globalThis.__minHp, P.hp / P.maxHp);
        }
        return out;
      };
    });
    await page.evaluate(installMetricsDriver, { storyEvents });
    for (let chunk = 0; chunk < 400; chunk++) {
      const s = await page.evaluate((maxGameS) => {
        const a = window.app, b = a.battle, P = b.player;
        let pauseError = null;
        for (let i = 0; i < 600 && b.active; i++) {
          if (!P.alive) return { active: b.active, dead: true, elapsed: b.elapsed };
          try { globalThis.__metricsDriver.step(1 / 60, false); }
          catch (err) { pauseError = String(err.message) + ' reasons=' + [...b.pauseReasons].join('|'); break; }
          if (b.elapsed > maxGameS) return { active: true, timeout: true, elapsed: b.elapsed };
        }
        return { active: b.active, pauseError, elapsed: b.elapsed, win: b.result?.win ?? null, rooms: b.roomsCleared | 0 };
      }, maxGameS);
      if (s.pauseError) { row.status = 'paused-blocked'; row.pauseError = s.pauseError; break; }
      if (s.dead) { row.status = 'lost'; row.elapsed = Math.round(s.elapsed); break; }
      if (s.timeout) { row.status = 'timeout'; row.elapsed = Math.round(s.elapsed); break; }
      if (!s.active) { row.status = s.win === false ? 'lost' : 'win'; row.elapsed = Math.round(s.elapsed); break; }
    }
    const out = await page.evaluate(() => {
      const b = window.app.battle;
      return { src: globalThis.__dmgSrc, minHp: globalThis.__minHp, rooms: b.roomsCleared | 0, kills: b.drops?.killCounts || null,
        bossHpPct: (() => { const boss = (b.enemies || []).find((e) => e.alive && e.isBoss); return boss ? +(boss.hp / boss.maxHp).toFixed(2) : null; })() };
    });
    row.rooms = out.rooms; row.kills = out.kills; row.minHp = +out.minHp.toFixed(2); row.bossHpLeft = out.bossHpPct;
    const total = Object.values(out.src).reduce((a, s) => a + s.dmg, 0) || 1;
    row.dmgTaken = Math.round(total); row.dmgPerMaxHp = +(total / row.hp).toFixed(2);
    row.sources = Object.entries(out.src).sort((a, b) => b[1].dmg - a[1].dmg).slice(0, 8)
      .map(([k, s]) => ({ src: k, pct: +(s.dmg / total * 100).toFixed(1), hits: s.hits, avg: Math.round(s.dmg / s.hits) }));
  } catch (err) { row.status = 'error'; row.error = String(err.message).slice(0, 300); }
  finally { await context.close().catch(() => {}); }
  console.log(JSON.stringify({ code: row.code, lv: row.level, seed: row.seed, ratio: row.ratio, status: row.status, t: row.elapsed, rooms: row.rooms, minHp: row.minHp, boss: row.bossHpLeft, dmgX: row.dmgPerMaxHp, top: row.sources?.slice(0, 3).map((s) => s.src + ' ' + s.pct + '%'), err: row.error }));
  return row;
}

const jobs = [];
for (const code of stages) for (const level of levels) for (let i = 0; i < seeds; i++) jobs.push({ code, level, seed: (0x5eed + i * 7919) >>> 0 });
const rows = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => { while (next < jobs.length) rows.push(await runOne(jobs[next++])); }));
await browser.close();
const summary = {};
for (const r of rows) {
  const k = r.code + ' lv' + r.level, s = summary[k] || (summary[k] = { code: r.code, level: r.level, ratio: r.ratio, win: 0, lost: 0, other: 0, t: [] });
  if (r.status === 'win') s.win++; else if (r.status === 'lost') s.lost++; else s.other++;
  if (r.elapsed) s.t.push(r.elapsed);
}
const file = path.join(outDir, tag + '.json');
await fs.writeFile(file, JSON.stringify({ tag, origin, stages, levels, seeds, at: new Date().toISOString(), summary: Object.values(summary), rows }, null, 1));
for (const s of Object.values(summary)) console.log(`${s.code} lv${s.level} ratio ${s.ratio} → 승 ${s.win} 패 ${s.lost} 기타 ${s.other} · 시간 ${s.t.join('/')}`);
console.log('결과:', path.relative(root, file));
