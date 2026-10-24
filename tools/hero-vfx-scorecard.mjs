// 영웅별 VFX 점수표 계측(h1b). 실제 개발 서버·실제 부팅 탭·실제 공격/스킬 버튼 터치 1회 + API 시전 고정 프레임.
// 사용: node tools/hero-vfx-scorecard.mjs --out <폴더> [--heroes knight,ranger] [--only holy_slash,combo] [--tag before] [--tier 0..4]
// --tier: 측정 직전(app.testPause 로 실시간 루프가 멈춘 뒤) 적응 품질 단계(frameGovernor·renderer.thermalTier)를 고정한다.
//         단계 2 이상은 블룸 패스(밉 5단 흐림·합성 ≈ 드로우콜 13)를 끈다. 지정하지 않으면 그때 단계를 그대로 기록만 한다.
// 산출(커밋 금지): <out>/<tag>/<hero>-<case>-<ms>.png, <out>/<tag>/<hero>-montage.png, <out>/<tag>/metrics.json
// 주입: 영웅 레벨 50·스킬 습득·쿨다운/MP/궁극기 게이지·적 배치·적 고정·Math.random 시드·app.testPause(1/60초 고정 스텝).
// 지표: bright = 휘도 ≥ 220 픽셀 비율, white = 세 채널 모두 ≥ 235(백화), changed = 시전 직전 프레임 대비 바뀐 픽셀 비율,
//       hue = 바뀐 픽셀 중 채도 ≥ .35 인 픽셀의 주 색상(30° 구간), sat = 바뀐 픽셀 평균 채도.
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
const out = path.resolve(arg('out', 'work/hero-vfx-scorecard'), tag);
const heroes = (arg('heroes') || 'knight,ranger,mage,rogue,barbarian').split(',');
const only = arg('only') ? new Set(arg('only').split(',')) : null;
const VIEW = { width: 844, height: 390 };
await fs.mkdir(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
const browser = await chromium.launch(launchOpts());
const report = { tag, origin, viewport: VIEW, started: new Date().toISOString(), heroes: {}, errors: [] };
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
  // 피해 숫자(DOM, CSS 애니메이션이라 실제 시간에 따라 깜빡임)는 흰 픽셀 지표를 오염시키므로 기본으로 숨긴다(--show-dmg 로 표시).
  if (!process.argv.includes('--show-dmg')) await page.addStyleTag({ content: '#dmg-layer{visibility:hidden!important}' });
  await page.waitForTimeout(1000);
  for (const hero of heroes) {
    const start = await page.evaluate(async hero => {
      const app = window.app; app.ui.closeModal?.();
      const e = app.eco; e.s.tutorial = { completed: true }; e.s.energy = 100; e.s.selected = hero;
      const h = e.hero(hero); h.level = 50; h.exp = 0; h.skills = h.skills.map(v => Math.max(1, v || 0));
      const ex = e.s.expedition; if (ex) { ex.unlockedJobs = []; ex.selectedJob = null; }
      if (!await app.startStage(app.eco.nextStage())) return { ok: false };
      app.companionAgent?.endBattle?.();
      return { ok: true };
    }, hero);
    if (!start.ok) throw Error(hero + ' 전투 시작 실패');
    await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 90000 });
    await page.waitForTimeout(600);
    // 실제 터치 1회: 공격 버튼과 첫 스킬 버튼을 손가락으로 누른다(입력 경로 확인, 점수 프레임은 아래 고정 스텝).
    const touch = {};
    for (const [k, sel] of [['attack', '#btn-attack'], ['skill0', '.skill-btn[data-skill="0"]']]) {
      const loc = page.locator(sel).first();
      touch[k] = await loc.isVisible().catch(() => false) ? (await loc.tap().then(() => true).catch(() => false)) : false;
      await page.waitForTimeout(700);
    }
    touch.stateAfter = await page.evaluate(() => window.app.battle.player.state);
    const def = await page.evaluate(() => {
      const app = window.app, b = app.battle, p = b.player;
      app.testPause = true;
      const realRandom = Math.random; window.__seed = seed => { let st = (seed * 2654435761) >>> 0 || 1; Math.random = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
      window.__unseed = () => { Math.random = realRandom; };
      const o = p.pos.clone(); window.__o = o;
      const offsets = [[0, -4], [-1.6, -5.2], [1.6, -5.2], [0, -6.6], [-2.8, -6.8], [2.8, -6.8], [-1.2, -8.2], [1.2, -8.2]];
      const type = Object.keys(window.__EN).find(k => !window.__EN[k].boss && !window.__EN[k].isBoss && /goblin|skeleton|grunt|imp|slime/i.test(k)) || Object.keys(window.__EN)[0];
      window.__pool = window.__pool || [];
      window.__fixture = (hp = 1e12) => {
        for (const e of b.enemies) if (!window.__pool.includes(e)) { e.update = () => {}; e.pos.set(o.x + 5000, 0, o.z + 5000); }
        while (window.__pool.length < offsets.length) { const e = b.spawnEnemy(type, null, null, o.clone()); e.update = () => {}; window.__pool.push(e); }
        window.__pool.forEach((e, i) => { e.alive = true; e.dead = false; e.spawning = false; e.maxHp = e.hp = hp; e.pos.set(o.x + offsets[i][0], 0, o.z + offsets[i][1]); if (e.mesh) e.mesh.visible = true; if (e.group) e.group.visible = true; });
        p.pos.copy(o); p.vel.set(0, 0, 0); p.state = 'idle'; p.stateT = 0; p.skillCtx = null; p.stun = 0; p.invuln = 1e9; p.hp = p.maxHp;
        p.cds.fill(0); p.mp = p.maxMp = 9999; p.ult = p.ultMax; p.auto = false; p.sanctum = null; p.dr = 0; p.drT = 0; p.buffs.atk = p.buffs.spd = p.buffs.atkSpd = 1; p.buffs.t = 0; p.stormT = 0; p.yaw = Math.PI; p.stats.crit = 0;
        b.timers.length = 0; for (const q of b.projectiles) q.mesh?.removeFromParent?.(); b.projectiles.length = 0;
        app.input.clear(); app.fx.clearAll();
      };
      window.__step = n => { for (let i = 0; i < n; i++) app.step(1 / 60, i === n - 1); };
      return { skills: p.def.skills.map(s => ({ id: s.id, ult: !!s.ult, castAt: s.castAt || .4 })), type };
    });
    if (arg('tier') !== '') await page.evaluate(t => { const g = window.__perfGovernor; if (g) g.tier = t; window.app.renderer.setThermalTier(t); }, +arg('tier'));
    const cases = [{ id: 'combo', kind: 'combo' }, { id: 'crit', kind: 'crit' }, { id: 'kill', kind: 'kill' }, ...def.skills.map((s, i) => ({ id: s.id, kind: 'skill', index: i, castAt: s.castAt, ult: s.ult }))]
      .filter(c => !only || only.has(c.id));
    const rows = [];
    for (const c of cases) {
      await page.evaluate(({ c }) => { window.__seed(7); window.__fixture(c.kind === 'kill' ? 1 : 1e12); window.__step(20); }, { c });
      // --pre: 진단용 페이지 코드(예: 특정 fx 메서드 끄기). 기본 측정에는 쓰지 않는다.
      if (arg('pre')) await page.evaluate(code => (0, eval)(code), arg('pre'));
      const basePng = await page.screenshot();
      const started = await page.evaluate(({ c }) => {
        const p = window.app.battle.player;
        if (c.kind === 'skill') return p.tryCastSkill(c.index);
        if (c.kind === 'crit') p.stats.crit = 1;
        window.app.input.press('attack'); return true;
      }, { c });
      // 시점: 스킬은 castAt 기준 +.05/+.25/+.6/+1.05초(지연 판정 절정 포함), 평타 계열은 누른 뒤 .18/.4/.7/1초(연타는 그 사이 계속 누른다).
      const times = c.kind === 'skill' ? [c.castAt + .05, c.castAt + .25, c.castAt + .6, c.castAt + 1.05] : c.kind === 'combo' ? [.9, 1.3, 1.7, 2.1] : [.18, .4, .7, 1];
      let frame = 0; const shots = [];
      for (const t of times) {
        const target = Math.round(t * 60);
        const calls = await page.evaluate(({ n, combo }) => {
          const info = window.app.renderer.r.info;
          for (let i = 0; i < n; i++) {
            if (combo && i % 12 === 0) window.app.input.press('attack');
            if (i === n - 1) { info.autoReset = false; info.reset(); }
            window.app.step(1 / 60, i === n - 1);
          }
          const v = info.render.calls; info.autoReset = true; return v;
        }, { n: target - frame, combo: c.kind === 'combo' });
        frame = target;
        const png = await page.screenshot();
        const file = `${hero}-${c.id}-${Math.round(t * 1000)}.png`;
        await fs.writeFile(path.join(out, file), png);
        const live = await page.evaluate(() => { const r = window.app.renderer; const f = window.app.fx; return { particles: f.sparks.n + f.glow.n + f.smoke.n, fxItems: f.items.length, exposure: +(window.app.fx._exposure || 0).toFixed(1), bloom: +(r.bloom?.strength ?? 0).toFixed(3), impactSpawned: f.impact?.spawned ?? null, impactLive: f.impact?.live?.() ?? null, thermalTier: r.thermalTier, governorTier: window.__perfGovernor?.tier ?? null, bloomOn: !!r.bloom?.enabled, quality: r.quality, fxQuality: f.quality ?? null, resolutionScale: r.resolutionScale }; });
        shots.push({ t: +t.toFixed(2), file, calls, ...(await metrics(png, basePng)), ...live });
      }
      const peak = shots.reduce((m, s) => Math.max(m, s.bright), 0), peakWhite = shots.reduce((m, s) => Math.max(m, s.white), 0);
      rows.push({ ...c, started, peakBright: peak, peakWhite, shots });
      await page.evaluate(() => window.__unseed());
    }
    report.heroes[hero] = { touch, enemy: def.type, rows };
    // 몽타주: 행=케이스, 열=4시점, 절반 크기.
    const W = VIEW.width / 2, H = VIEW.height / 2, composites = [];
    for (const [ri, row] of rows.entries()) for (const [ci, s] of row.shots.entries()) composites.push({ input: await sharp(path.join(out, s.file)).resize(W, H).toBuffer(), left: ci * W, top: ri * H });
    await sharp({ create: { width: W * 4, height: H * rows.length, channels: 3, background: '#000' } }).composite(composites).png().toFile(path.join(out, `${hero}-montage.png`));
    await page.evaluate(() => { window.app.testPause = false; window.__pool = []; window.app.toLobby?.(); });
    await page.waitForTimeout(800);
    console.error(hero, '완료', rows.length);
  }
} finally {
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
