// 스킬 VFX 고정 시간 갤러리: 영웅별 기본 스킬 3개 + 궁극기를 같은 자리·같은 적 배치에서 시전하고
// 시전 후 고정 시각(초)마다 프레임을 찍어 한 장(영웅별 contact sheet)으로 묶는다.
// 픽스처 주입(명시): 적 4마리를 영웅 앞 고정 위치로 옮기고 체력을 크게·경직을 길게 둔다. 판정·피해 공식은 건드리지 않는다.
// 사용: node tools/skill-vfx-gallery.mjs --tag before|after [--dist dist] [--heroes knight,...] [--w 844 --h 390]
import { chromium } from 'playwright';
import { preview, createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'before');
const heroes = arg('heroes', 'knight,barbarian,mage,rogue,ranger').split(',');
const W = Number(arg('w', 844)), H = Number(arg('h', 390));
const TIMES = arg('times', '0.12,0.3,0.55,0.9').split(',').map(Number);
const SLOTS = arg('slots', '0,1,2,3').split(',').map(Number);
const out = path.join(root, 'work/skill-vfx-gallery', tag);
await fs.mkdir(out, { recursive: true });
const report = { tag, viewport: { w: W, h: H }, times: TIMES, heroes: {}, errors: [] };

let server, browser;
try {
  // --dev: 빌드 없이 vite 개발 서버로 연다(반복 작업용). 기본은 빌드 산출물(--dist) 미리보기.
  if (process.argv.includes('--dev')) { server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await server.listen(); }
  else server = await preview({ root, logLevel: 'error', build: { outDir: arg('dist', 'dist') }, preview: { host: '127.0.0.1', port: 0 } });
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch(launchOpts());
  for (const hero of heroes) {
    const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage(); await installAutoStarter(page);
    page.on('pageerror', e => report.errors.push(`${hero}: ${String(e).slice(0, 200)}`));
    await page.addInitScript(() => { let a = 0xB1ADE; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
    await page.locator('#boot-start').tap();
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 180000 });
    const ok = await page.evaluate(async hero => {
      const app = window.app; app.ui.closeModal?.(); const e = app.eco;
      e.s.tutorial = { completed: true }; e.s.energy = 999; if (!e.s.roster.owned.includes(hero)) e.s.roster.owned.push(hero);
      e.s.selected = hero; const h = e.hero(hero); if (h) { h.level = Math.max(h.level || 1, 40); h.skills = [5, 5, 5, 5, 5, 5]; }
      e.s.progress.unlocked = Math.max(e.s.progress.unlocked, 1);
      return await app.startStage(window.__stageDef(1, 1));
    }, hero);
    if (!ok) { report.heroes[hero] = { failure: 'start' }; await context.close(); continue; }
    await page.waitForFunction(() => window.app.battle?.active && window.app.battle.player && window.app.battle.elapsed > .3, null, { timeout: 90000 });
    if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
    await page.addStyleTag({ content: '.tutorial,.coach,#coach,.toast-wrap{display:none!important}' });
    await page.evaluate(() => {
      const app = window.app; app.testPause = true; const b = app.battle; b.player.auto = false;
      window.__stage = () => {
        const p = b.player; p.yaw = Math.PI; p.mp = p.maxMp; p.cds?.fill?.(0); p.ult = p.ultMax; p.invuln = 1e9; p.hp = p.maxHp;
        // 각성 스킬(슬롯 4~7)도 찍도록 레벨·습득을 연다(갤러리 전용, 저장하지 않는다). 앞 스킬이 길면 다음 시전이 막히므로 시전 상태를 끝낸다.
        p.heroLevel = Math.max(p.heroLevel || 1, 99); if (Array.isArray(p.skillLevels)) p.skillLevels = p.skillLevels.map(v => Math.max(v || 0, 1)); else p.skillLevels = Array(8).fill(1);
        if (p.skillCtx) p.skillCtx.done = true; if (p.state === 'skill' || p.state === 'ult') p.state = 'idle';
        // 적이 생길 때까지 진행한 뒤 4마리를 영웅 앞 고정 자리로 옮긴다.
        if (!window.__foeType) window.__foeType = Object.keys(window.__EN).find(k => { const d = window.__EN[k]; return d && !d.boss && app.models?.[d.model] && (d.scale || 1) <= 1.2; });
        for (let k = b.enemies.filter(e => e.alive).length; k < 4 && window.__foeType; k++) b.spawnEnemy(window.__foeType, p.pos);
        for (let i = 0; i < 240 && b.enemies.filter(e => e.alive && !e.spawning).length < 4; i++) app.step(1 / 60, false);
        const spots = [[0, -2.2], [-1.4, -3.2], [1.5, -3.4], [0.3, -4.6]];
        const foes = b.enemies.filter(e => e.alive && !e.spawning).slice(0, 4);
        foes.forEach((e, i) => { e.pos.set(p.pos.x + spots[i][0], 0, p.pos.z + spots[i][1]); e.maxHp = e.hp = 1e9; e.stun = 99; e.vel?.set?.(0, 0, 0); });
        p.yaw = Math.PI; p._shownYaw = Math.PI; p.lockTarget = foes[0] || null;
        return foes.length;
      };
    });
    const sheet = [];
    for (const slot of SLOTS) {
      const placed = await page.evaluate(() => window.__stage());
      // --probe "<식>": 시전 직전 페이지에서 평가(원인 추적용, 예: "app.battle.fx.impact.mesh.visible=false"). 기본 실행에는 영향 없음.
      if (arg('probe')) await page.evaluate(code => { const app = window.app; void app; return eval(code); }, arg('probe'));
      const started = await page.evaluate(slot => { const p = window.app.battle.player; p.yaw = Math.PI; return p.tryCastSkill(slot); }, slot);
      const skill = await page.evaluate(slot => window.app.battle.player.def.skills?.[slot]?.id || String(slot), slot);
      let elapsed = 0; const frames = [];
      for (const t of TIMES) {
        const n = Math.max(1, Math.round((t - elapsed) * 60)); elapsed += n / 60;
        await page.evaluate(n => { for (let i = 0; i < n; i++) window.app.step(1 / 60, i === n - 1); }, n);
        const file = path.join(out, `${hero}-s${slot}-${String(t).replace('.', '_')}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 82 }); frames.push(file);
        // --dump: 이 프레임에 살아 있는 fx 항목(종류·텍스처·색·크기·영웅 거리)과 점광원을 report 에 남긴다(백화 원인 추적용).
        if (process.argv.includes('--dump')) (report.dump ||= {})[path.basename(file)] = await page.evaluate(() => {
          const b = window.app.battle, fx = b.fx, p = b.player.pos;
          const items = fx.items.map(it => { const o = it.obj, m = o.material, u = m?.uniforms;
            return { type: o.type, mat: m?.type, map: m?.map?.name || m?.map?.image?.src?.split('/').pop() || (u?.uTex?.value?.image?.src || '').split('/').pop() || '', color: (m?.color || u?.uColor?.value)?.getHexString?.(), opacity: +(m?.opacity ?? u?.uAlpha?.value ?? 1).toFixed(2), scale: +o.scale.x.toFixed(2), d: +Math.hypot(o.position.x - p.x, o.position.z - p.z).toFixed(1), t: +(it.t / it.life).toFixed(2) }; });
          const lights = (fx.impactLights?.lights || fx.impactLights?.pool || []).filter(l => l.intensity > 0).map(l => ({ i: +l.intensity.toFixed(1), c: l.color.getHexString(), d: +Math.hypot(l.position.x - p.x, l.position.z - p.z).toFixed(1) }));
          const glow = []; const v = new (fx.scene.position.constructor)();
          fx.scene.traverseVisible(o => { const m = o.material; if (!m || Array.isArray(m) || o.isSkinnedMesh || !o.getWorldPosition || !(m.transparent || m.blending === 2)) return; o.getWorldPosition(v); const d = Math.hypot(v.x - p.x, v.z - p.z); if (d < 3.5) glow.push({ name: o.name || o.parent?.name || '', type: o.type, blend: m.blending, map: m.map?.name || m.map?.image?.src?.split?.('/').pop() || '', parents: (() => { let n = [], q = o.parent; while (q && n.length < 4) { n.push(q.name || q.type); q = q.parent; } return n.join('<'); })(), mat: m.type, color: m.color?.getHexString?.(), op: +(m.opacity ?? 1).toFixed(2), s: +o.scale.x.toFixed(2), y: +v.y.toFixed(1), d: +d.toFixed(1), fx: fx.items.some(it => it.obj === o), u: m.uniforms ? Object.keys(m.uniforms).slice(0, 8).join(',') : '' }); });
          return { items, lights, glow, impactLive: fx.impact?.live ?? null };
        });
      }
      sheet.push({ slot, skill, started, placed, frames });
      await page.evaluate(() => { for (let i = 0; i < 150; i++) window.app.step(1 / 60, false); });
    }
    report.heroes[hero] = sheet.map(s => ({ slot: s.slot, skill: s.skill, started: s.started, placed: s.placed }));
    // 영웅별 시트: 행 = 스킬, 열 = 시각
    try {
      const inputs = sheet.flatMap(s => s.frames);
      const cols = TIMES.length, rows = sheet.length;
      const filter = inputs.map((_, i) => `[${i}:v]scale=422:-2[v${i}]`).join(';') + ';' +
        inputs.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${inputs.length}:layout=` +
        inputs.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|') + '[out]';
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs.flatMap(f => ['-i', f]), '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', path.join(out, `${hero}-sheet.jpg`)]);
      report.heroes[hero].sheet = `work/skill-vfx-gallery/${tag}/${hero}-sheet.jpg`;
      void rows;
    } catch (e) { report.errors.push(`${hero} sheet: ${String(e).slice(0, 200)}`); }
    await context.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  report.status = 'done';
} catch (e) { report.status = 'fail'; report.failure = String(e?.stack || e); process.exitCode = 1; }
finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server?.close?.().catch?.(() => {});
  console.log(JSON.stringify({ status: report.status, heroes: report.heroes, errors: report.errors.slice(0, 5), failure: report.failure?.slice(0, 400) }));
}
process.exit(process.exitCode || 0);
