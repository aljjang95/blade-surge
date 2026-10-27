/**
 * 전투·던전 정체성 직접 플레이 QA — 실제 키보드 입력(input.js 경로)으로 한 스테이지를 끝까지 플레이하고
 * 몬스터 종별 행동 다양성·방별 편성·피격·처치·클리어 시간을 기록하며 0.25초마다 화면을 남긴다(ffmpeg 가 있으면 mp4).
 *   node tools/playtest-identity.mjs --stage 1-1 [--level 1] [--out work/qa/playtest] [--max-sec 420] [--hero knight]
 * 전제: bun run build 산출물(dist). 고정 dt(1/60) 진행. 봇은 '사람처럼' 이동·평타 홀드·스킬·예고 회피만 하며
 * 승리 강제·적 삭제·무적은 쓰지 않는다. 방 사이 이동만 AUTO 길찾기를 빌린다(전투 중에는 꺼진다).
 * 실기기 입력·GPU 프레임 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn, spawnSync } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const STAGE = arg('stage', '1-1'), [CH, ST] = STAGE.split('-').map(Number);
const LEVEL = Number(arg('level', 0)), HERO = arg('hero', ''), MAX_SEC = Number(arg('max-sec', 420));
const OUT = resolve(PROJ, arg('out', `work/qa/playtest/${STAGE}`)), FRAMES = resolve(OUT, 'frames');
const PORT = 4300 + Math.floor(Math.random() * 400), VIEWPORT = { width: 844, height: 390 };
rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true });
const build = JSON.parse(readFileSync(resolve(PROJ, 'dist/version.json'), 'utf8'));
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: VIEWPORT })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });

let report;
try {
  await installAutoStarter(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  const entered = await page.evaluate(async ({ ch, st, level, hero }) => {
    const a = window.app, e = a.eco; a.testPause = false; e.s.energy = 9999; e.s.progress.unlocked = (ch - 1) * 10 + st;
    if (hero && e.s.heroes[hero]) e.s.selected = hero;
    if (level > 0) e.hero().level = level;
    e.save(); a.battle?.stop?.();
    const stage = e.nextStage(); await a.startStage(stage); a.testPause = true;
    const b = a.battle, p = b.player; p.auto = false;
    // 봇 상태와 기록기. 키 입력은 window 키 이벤트(실제 input.js 경로)로만 넣는다.
    const held = new Set();
    const key = (code, down) => { if (down === held.has(code)) return; down ? held.add(code) : held.delete(code); window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true })); };
    const tap = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true })); };
    const types = {}, rooms = {}, hitLog = [];
    let kills = 0, maxAlive = 0, hits = 0, frames = 0, skillT = 0, dodgeCd = 0, hp0 = p.hp, dmgTaken = 0, deaths = 0;
    const seen = new WeakSet();
    const origHurt = p.hurt.bind(p);
    p.hurt = (amt, o) => { const before = p.hp; const r = origHurt(amt, o); if (p.hp < before) { hits++; dmgTaken += before - p.hp; } return r; };
    window.__pt = {
      stage: { code: stage.code, dungeon: stage.dungeon?.id, theme: stage.chapter?.theme, waves: stage.waves.map((w) => w.length) },
      tick(n, renderEvery) {
        for (let k = 0; k < n; k++) {
          frames++;
          const alive = b.enemies.filter((x) => x.alive && !x.spawning);
          maxAlive = Math.max(maxAlive, alive.length);
          for (const en of b.enemies) {
            const id = en.runtimeSpeciesId || en.def?.id || en.def?.name;
            const t = types[id] || (types[id] = { name: en.def.name, n: 0, acts: {}, kills: 0 });
            if (!seen.has(en)) { seen.add(en); t.n++; const rid = en.homeRoom?.id ?? 'x'; const r = rooms[rid] || (rooms[rid] = { types: {}, type: en.homeRoom?.type, first: b.elapsed }); r.types[id] = (r.types[id] || 0) + 1; }
            const act = en.alive ? (en.burrow?.phase ? 'burrow:' + en.burrow.phase : en.bellringer?.phase ? 'bell:' + en.bellringer.phase : en.mobRole?.phase ? 'role:' + en.mobRole.key : en.fuse >= 0 ? 'fuse' : en.special ? 'sp:' + en.special : en.state) : 'dead';
            if (en._ptAct !== act) { en._ptAct = act; t.acts[act] = (t.acts[act] || 0) + 1; if (act === 'dead') { t.kills++; kills++; } }
          }
          // ---- 사람처럼 조작 ----
          const near = alive.filter((x) => !(x.burrow?.phase === 'under')).sort((x, y) => x.distTo(p) - y.distTo(p));
          const tgt = near[0], engaged = tgt && tgt.distTo(p) < 15;
          p.auto = !engaged && !b.bossDefeated;
          let wx = 0, wz = 0, attack = false;
          dodgeCd -= 1 / 60; skillT -= 1 / 60;
          if (engaged) {
            const threat = near.find((x) => x.telegraph > 0 && x.telegraph < .4 && x.distTo(p) < (x.def.ranged ? 3 : (x.def.range || 2) + 2.5));
            const dx = tgt.pos.x - p.pos.x, dz = tgt.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
            const reach = p.def.ranged ? 7 : 2.2;
            if (threat && dodgeCd <= 0) {
              const ax = p.pos.x - threat.pos.x, az = p.pos.z - threat.pos.z, ad = Math.hypot(ax, az) || 1; wx = ax / ad; wz = az / ad; tap('KeyK'); dodgeCd = 1.1;
            } else if (d > reach) { wx = dx / d; wz = dz / d; }
            else { attack = true; if (p.state !== 'attack') { wx = dx / d * .3; wz = dz / d * .3; } }
            const crowd = near.filter((x) => x.distTo(p) < 5).length;
            if (skillT <= 0 && (crowd >= 3 || tgt.isElite || tgt.isBoss) && d < 6) { tap(['Digit1', 'Digit2', 'Digit3', 'KeyR', 'KeyQ', 'KeyE'][Math.floor(frames / 7) % 6]); skillT = .9; }
          }
          // 월드 방향 → 카메라 기준 키(8방향)
          const yaw = a.input?.getCameraYaw?.() ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
          const kx = wx * c - wz * s, ky = wx * s + wz * c;
          key('KeyD', kx > .38); key('KeyA', kx < -.38); key('KeyS', ky > .38); key('KeyW', ky < -.38);
          key('KeyJ', attack);
          const hpBefore = p.hp;
          a.step(1 / 60, renderEvery > 0 && frames % renderEvery === 0);
          if (!p.alive) { deaths++; break; }
          if (b.bossDefeated || !b.active) break;
        }
        return { t: +b.elapsed.toFixed(2), alive: b.enemies.filter((x) => x.alive).length, hp: Math.round(p.hp / p.maxHp * 100), kills, done: !!b.bossDefeated || !b.active, dead: !p.alive };
      },
      report() {
        return { kills, maxAlive, hits, dmgTakenPct: +(dmgTaken / p.maxHp * 100).toFixed(1), deaths, frames, elapsed: +b.elapsed.toFixed(1), bossDefeated: !!b.bossDefeated, types, rooms, hero: p.def.id, level: e.hero().level };
      },
    };
    return window.__pt.stage;
  }, { ch: CH, st: ST, level: LEVEL, hero: HERO });
  console.log('stage', JSON.stringify(entered));
  let f = 0, last;
  while (true) {
    last = await page.evaluate(() => window.__pt.tick(15, 15));
    await page.screenshot({ path: `${FRAMES}/${String(f++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 70 });
    if (f % 40 === 0) console.log(JSON.stringify(last));
    if (last.done || last.dead || last.t > MAX_SEC) break;
  }
  report = await page.evaluate(() => window.__pt.report());
  report.stage = entered; report.end = last; report.errors = errors; report.build = build;
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '8', '-i', `${FRAMES}/%05d.jpg`, '-vf', 'scale=844:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', resolve(OUT, `play-${STAGE}.mp4`)]);
  console.log('video', ff.status === 0 ? resolve(OUT, `play-${STAGE}.mp4`) : 'ffmpeg 실패/없음');
} finally { await br.close(); srv.kill(); }
const sum = { kills: report.kills, maxAlive: report.maxAlive, hits: report.hits, dmgTakenPct: report.dmgTakenPct, deaths: report.deaths, elapsed: report.elapsed, cleared: report.bossDefeated, errors: report.errors.length };
console.log('SUMMARY', JSON.stringify(sum));
for (const [id, t] of Object.entries(report.types)) console.log(' ', id.padEnd(22), `n=${t.n}`.padEnd(6), Object.entries(t.acts).map(([k, v]) => `${k}:${v}`).join(' '));
for (const [id, r] of Object.entries(report.rooms)) console.log('  room', id, r.type, Object.keys(r.types).length + '종', JSON.stringify(r.types));
