// 일반 보스 공격 예고 점수표(h1c). 실제 개발 서버·실제 부팅 탭·실제 공격 버튼 터치 1회 + 보스 패턴 고정 시전·1/60초 고정 스텝 프레임.
// 사용: node tools/boss-telegraph-scorecard.mjs --out <폴더> [--tag before] [--stages 1-5,5-10] [--patterns basic,spin] [--tier 2] [--pre <진단 코드>]
// 산출(커밋 금지): <out>/<tag>/<stage>-<pattern>-<pct>.png, <out>/<tag>/<stage>-montage.png, <out>/<tag>/metrics.json
// 주입: 스테이지 직접 시작, 보스 이외 적 치우기·고정, 보스 패턴 목록을 한 패턴으로 덮어 startAttack 1회, 플레이어 무적·정지,
//       Math.random 시드, app.testPause(1/60초 고정 스텝). 판정·피해 코드는 건드리지 않는다.
// 시점: 예고 시간 T(돌진은 .45 지점까지)의 25%·60%·93% 와 타격 뒤 .12초. 기준 프레임은 시전 직전.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { metrics } from './vfx-metrics.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const arg = (k, d = '') => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const root = path.resolve(import.meta.dirname, '..');
const tag = arg('tag', 'run');
const out = path.resolve(arg('out', 'work/boss-telegraph-scorecard'), tag);
// 기본: 1장 중간보스(X-5)와 5장 최종보스(X-10, 고유기와 일반 패턴이 섞인 보스).
const stages = (arg('stages') || '1-5,5-10').split(',').map(s => s.split('-').map(Number));
const patterns = (arg('patterns') || 'basic,spin,slam,fan,soulrain,summon,dash').split(',');
const VIEW = { width: 844, height: 390 };
await fs.mkdir(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
const browser = await chromium.launch(launchOpts());
const report = { tag, origin, viewport: VIEW, started: new Date().toISOString(), stages: {}, errors: [] };
try {
  const context = await browser.newContext({ viewport: VIEW, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(String(e).slice(0, 300)));
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 180000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
  if (!process.argv.includes('--show-dmg')) await page.addStyleTag({ content: '#dmg-layer{visibility:hidden!important}' });
  await page.waitForTimeout(1000);
  for (const [ch, st] of stages) {
    const code = `${ch}-${st}`;
    const start = await page.evaluate(async ({ ch, st }) => {
      const app = window.app; app.ui.closeModal?.();
      const e = app.eco; e.s.tutorial = { completed: true }; e.s.energy = 100; e.s.selected = 'knight';
      const h = e.hero('knight'); h.level = 50; h.exp = 0;
      const ex = e.s.expedition; if (ex) { ex.unlockedJobs = []; ex.selectedJob = null; }
      e.s.progress.unlocked = Math.max(e.s.progress.unlocked, e.stageIndex(ch, st));   // 측정 탭의 새 저장에서만 해금한다.
      const stage = window.__stageDef(ch, st);
      if (!await app.startStage(stage)) return { ok: false };
      app.companionAgent?.endBattle?.();
      return { ok: true, boss: stage.dungeonBossId || stage.encounter.enemyId };
    }, { ch, st });
    if (!start.ok) throw Error(code + ' 전투 시작 실패');
    await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 90000 });
    await page.waitForTimeout(600);
    // 실제 터치 1회(입력 경로 확인). 점수 프레임은 아래 고정 스텝.
    const touch = { attack: await page.locator('#btn-attack').first().tap().then(() => true).catch(() => false) };
    await page.waitForTimeout(500);
    const def = await page.evaluate(({ bossId }) => {
      const app = window.app, b = app.battle, p = b.player;
      app.testPause = true;
      const realRandom = Math.random; window.__seed = seed => { let s = (seed * 2654435761) >>> 0 || 1; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
      window.__unseed = () => { Math.random = realRandom; };
      const o = p.pos.clone();
      let boss = b.enemies.find(e => e.isBoss && e.alive);
      if (!boss) boss = b.spawnEnemy(bossId, null, null, o.clone().add(new window.__THREE.Vector3(0, 0, -6)));
      if (!boss) return { ok: false };
      const baseDef = boss.def;
      window.__boss = boss;
      window.__fixture = pattern => {
        for (const e of b.enemies) if (e !== boss) { e.update = () => {}; e.pos.set(o.x + 5000, 0, o.z + 5000); }
        b.timers.length = 0; for (const q of b.projectiles) q.mesh?.removeFromParent?.(); b.projectiles.length = 0;
        boss.alive = true; boss.dead = false; boss.spawning = false; boss.stun = 0; boss.breakT = 0; boss.hp = boss.maxHp = 1e12; boss.phase = 1; boss.patternTurn = 0;
        boss.signatures?.clear(); boss.clearDashWarning?.();
        boss.def = { ...baseDef, pattern: [pattern], phasePatterns: null };
        boss.pos.set(o.x, 0, o.z - 4.5); boss.vel.set(0, 0, 0); boss.kb?.set?.(0, 0, 0); boss.state = 'chase'; boss.stateT = 0; boss.atkCd = 0; boss.telegraph = 0;
        boss.yaw = Math.atan2(o.x - boss.pos.x, o.z - boss.pos.z);
        p.pos.copy(o); p.vel.set(0, 0, 0); p.state = 'idle'; p.stateT = 0; p.skillCtx = null; p.stun = 0; p.invuln = 1e9; p.hp = p.maxHp; p.auto = false; p.yaw = Math.PI;
        app.input.clear(); app.fx.clearAll();
      };
      window.__step = n => { for (let i = 0; i < n; i++) app.step(1 / 60, i === n - 1); };
      return { ok: true, boss: boss.def.name, type: Object.keys(window.__EN).find(k => window.__EN[k] === baseDef) || bossId, signature: !!baseDef.signatureBoss };
    }, { bossId: start.boss });
    if (!def.ok) throw Error(code + ' 보스 없음');
    if (arg('tier') !== '') await page.evaluate(t => { const g = window.__perfGovernor; if (g) g.tier = t; window.app.renderer.setThermalTier(t); }, +arg('tier'));
    const rows = [];
    for (const pattern of patterns) {
      await page.evaluate(pattern => { window.__seed(11); window.__fixture(pattern); window.__step(12); }, pattern);
      // --pre: 진단용 페이지 코드(예: 특정 fx 메서드 끄기). 기본 측정에는 쓰지 않는다.
      if (arg('pre')) await page.evaluate(code => (0, eval)(code), arg('pre'));
      const basePng = await page.screenshot();
      const cast = await page.evaluate(() => {
        const boss = window.__boss, p = window.app.battle.player;
        boss.yaw = Math.atan2(p.pos.x - boss.pos.x, p.pos.z - boss.pos.z);
        boss.startAttack(boss.distTo(p));
        const T = boss.special === 'dash' ? boss.attackDur * .45 : boss.attackDur * boss.hitAt;
        return { special: boss.special, state: boss.state, T, attackDur: boss.attackDur, hitAt: boss.hitAt };
      });
      if (cast.state !== 'attack') { rows.push({ pattern, cast, skipped: true }); continue; }
      const times = [.25 * cast.T, .6 * cast.T, .93 * cast.T, cast.T + .12];
      let frame = 0; const shots = [];
      for (const [ti, t] of times.entries()) {
        const target = Math.max(frame + 1, Math.round(t * 60));
        const calls = await page.evaluate(n => {
          const info = window.app.renderer.r.info;
          for (let i = 0; i < n; i++) { if (i === n - 1) { info.autoReset = false; info.reset(); } window.app.step(1 / 60, i === n - 1); }
          const v = info.render.calls; info.autoReset = true; return v;
        }, target - frame);
        frame = target;
        const png = await page.screenshot();
        const file = `${code}-${pattern}-${['25', '60', '93', 'hit'][ti]}.png`;
        await fs.writeFile(path.join(out, file), png);
        const live = await page.evaluate(() => { const r = window.app.renderer, f = window.app.fx; return { particles: f.sparks.n + f.glow.n + f.smoke.n, fxItems: f.items.length, bloom: +(r.bloom?.strength ?? 0).toFixed(3), thermalTier: r.thermalTier, bloomOn: !!r.bloom?.enabled, impactLive: f.impact?.live?.() ?? null }; });
        shots.push({ t: +t.toFixed(3), file, calls, ...(await metrics(png, basePng)), ...live });
      }
      rows.push({ pattern, cast, peakBright: Math.max(...shots.map(s => s.bright)), peakWhite: Math.max(...shots.map(s => s.white)), shots });
      await page.evaluate(() => window.__unseed());
    }
    report.stages[code] = { touch, ...def, rows };
    const W = VIEW.width / 2, H = VIEW.height / 2, composites = [], shown = rows.filter(r => r.shots);
    for (const [ri, row] of shown.entries()) for (const [ci, s] of row.shots.entries()) composites.push({ input: await sharp(path.join(out, s.file)).resize(W, H).toBuffer(), left: ci * W, top: ri * H });
    if (composites.length) await sharp({ create: { width: W * 4, height: H * shown.length, channels: 3, background: '#000' } }).composite(composites).png().toFile(path.join(out, `${code}-montage.png`));
    await page.evaluate(() => { window.app.testPause = false; window.app.toLobby?.(); });
    await page.waitForTimeout(800);
    console.error(code, def.boss, '완료', rows.length);
  }
} finally {
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
