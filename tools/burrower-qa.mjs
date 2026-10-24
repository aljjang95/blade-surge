/**
 * 잠복형(burrower) 몬스터 런타임 QA — 실제 빌드에서 종마다 숨기·접근·예고·솟구침·피해·무방비·기절 취소를 단언하고 단계별 화면을 남긴다.
 *   node tools/burrower-qa.mjs [출력폴더=work/qa/burrower]
 * 전제: bun run build 산출물(dist). 고정 dt(1/60) 진행이며 실기기 입력·프레임 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = 4294, OUT = resolve(PROJ, process.argv[2] || 'work/qa/burrower');
const SPECIES = ['grave_burrower', 'ash_burrower', 'frost_burrower'];
mkdirSync(OUT, { recursive: true });
const build = JSON.parse(readFileSync(resolve(PROJ, 'dist/version.json'), 'utf8'));
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')); };
try {
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  for (const species of SPECIES) {
    // 1) 단독 소환: 8m 앞에서 쿨다운 → 숨기 → 접근 → 예고 → 솟구침
    await page.evaluate(async (species) => {
      const a = window.app, e = a.eco; a.testPause = false; e.s.energy = 9999; e.save();
      // 모든 종을 같은 스테이지·같은 출발 배치에서 시험한다(스테이지마다 +8m 지점이 벽에 밀려 근접 시작이 되는 것을 막는다).
      a.battle?.stop?.(); window.__bqStage ||= e.nextStage(); await a.startStage(window.__bqStage); a.testPause = true;
      const b = a.battle, p = b.player; p.auto = false;
      for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
      p.hp = p.maxHp; p.invuln = 0;
      window.__bq = b.spawnEnemy(species, null, b.curRoom, p.pos.clone().add(new p.pos.constructor(8, 0, 0)));
      window.__bqStart = { d: +window.__bq.distTo(p).toFixed(2), active: b.active, stageId: b.stage?.id };
      window.__bqHp0 = p.hp;
    }, species);
    // 페이지 안에서 조건까지 고정 dt 로 진행하며 단계 전환만 기록한다. 화면은 찍는 순간에만 그린다.
    const runUntil = (until, max) => page.evaluate(({ until, max }) => {
      const a = window.app, en = window.__bq, b = a.battle, p = b.player, out = [];
      const snap = (k, event) => ({ k, event, phase: en.burrow?.phase || null, t: +(en.burrow?.t || 0).toFixed(2), spawning: en.spawning, visible: en.model.visible,
        y: +en.model.position.y.toFixed(2), tele: +(en.telegraph || 0).toFixed(2), erupted: en.burrow?.erupted || 0, playerHp: p.hp, hp0: window.__bqHp0,
        dist: +en.pos.distanceTo(p.pos).toFixed(2), autoTargetable: b.enemies.filter((x) => x.alive && !x.spawning).includes(en) });
      let prev = en.burrow?.phase || null;
      for (let k = 0; k < max; k++) {
        a.step(1 / 60, false);
        if (en.burrow?.hidden && en.hurt(100, { kb: .1 }) !== 0) out.push(snap(k, 'hidden-hurt-leak'));
        const ph = en.burrow?.phase || null;
        if (ph !== prev) { out.push(snap(k)); prev = ph; }
        if (until === 'tunnel' && ph === 'tunnel' && en.burrow.t > .3) { out.push(snap(k, 'shot')); break; }
        if (until === 'mark' && ph === 'mark' && en.burrow.t > .35) { out.push(snap(k, 'shot')); break; }
        if (until === 'erupt' && en.burrow?.erupted > 0) { out.push(snap(k, 'erupted')); break; }
      }
      a.step(1 / 60, true);
      return out;
    }, { until, max });
    const timeline = [];
    timeline.push(...await runUntil('tunnel', 900)); await page.screenshot({ path: `${OUT}/${species}-1-tunnel.png` });
    timeline.push(...await runUntil('mark', 600)); await page.screenshot({ path: `${OUT}/${species}-2-mark.png` });
    timeline.push(...await runUntil('erupt', 300)); await page.screenshot({ path: `${OUT}/${species}-3-erupt.png` });
    const phases = timeline.map((x) => x.event || x.phase);
    const sink = timeline.find((x) => x.phase === 'sink'), tunnel = timeline.find((x) => x.phase === 'tunnel'), mark = timeline.find((x) => x.phase === 'mark'), erupt = timeline.find((x) => x.event === 'erupted');
    const at = (x) => timeline.indexOf(x);
    const start = await page.evaluate(() => window.__bqStart);
    check(`${species}: 숨기→접근→예고→솟구침 순서`, !!(sink && tunnel && mark && erupt) && at(sink) < at(tunnel) && at(tunnel) < at(mark) && at(mark) < at(erupt), { phases: phases.join('>'), start, timeline: (sink && erupt) ? undefined : timeline });
    check(`${species}: 숨은 동안 조준·피격 제외`, !!tunnel && tunnel.spawning && !tunnel.visible && !tunnel.autoTargetable && !timeline.some((x) => x.event === 'hidden-hurt-leak'), tunnel);
    check(`${species}: 접근해서 예고`, !!mark && mark.dist < 3, mark?.dist);
    check(`${species}: 예고 중 반쯤 드러나 조준 가능`, !!mark && !mark.spawning && mark.visible && mark.autoTargetable && mark.tele > 0, mark);
    check(`${species}: 솟구침 피해(가만히 선 플레이어)`, !!erupt && erupt.playerHp < erupt.hp0, erupt && { before: erupt.hp0, after: erupt.playerHp });
    // 2) 무방비 배율: 솟구친 직후 같은 피해가 1.5배
    const exposed = await page.evaluate(() => {
      const en = window.__bq, armor = en.def.armor || 0, before = en.hp; const dealt = en.hurt(100, { kb: .1 });
      return { mul: en.burrow.damageMul(), dealt, expected: 100 * (1 - armor) * 1.5, hpLost: before - en.hp };
    });
    check(`${species}: 무방비 피해 1.5배`, exposed.mul === 1.5 && Math.abs(exposed.dealt - exposed.expected) < 1e-6, exposed);
    // 3) 예고 중 기절 → 취소
    const fizzle = await page.evaluate(async (species) => {
      const a = window.app; a.testPause = false; a.battle?.stop?.(); await a.startStage(window.__bqStage); a.testPause = true;
      const b = a.battle, p = b.player; p.auto = false;
      for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
      const en = b.spawnEnemy(species, null, b.curRoom, p.pos.clone().add(new p.pos.constructor(8, 0, 0)));
      return !!en && en.distTo(p) > 5;
    }, species);
    const fz = await page.evaluate(() => {
      const a = window.app, b = a.battle, p = b.player, en = b.enemies.filter((x) => x.alive && x.burrow).at(-1); p.hp = p.maxHp; const hp0 = p.hp;
      const trace = [];
      for (let k = 0; k < 900 && en.burrow.phase !== 'mark'; k++) { a.step(1 / 60, false); if (k % 30 === 0) trace.push([k, en.alive, en.state, en.spawning, +(en.stun || 0).toFixed(2), +(en.gatherT || 0).toFixed(2), +en.burrow.cd.toFixed(2), en.burrow.phase, +en.distTo(p).toFixed(2)].join(' ')); }
      const reached = en.burrow.phase === 'mark';
      en.hurt(1, { kb: .1, stun: .6 });
      for (let k = 0; k < 90; k++) a.step(1 / 60, k === 89);
      return { reached, fizzled: en.burrow.fizzled, erupted: en.burrow.erupted, hpLost: hp0 - p.hp, exposedMul: en.burrow.damageMul(), phase: en.burrow.phase, trace: reached ? undefined : trace };
    });
    check(`${species}: 예고 중 기절하면 솟구치기 취소`, fizzle && fz.reached && fz.fizzled === 1 && fz.erupted === 0, fz);
    await page.screenshot({ path: `${OUT}/${species}-4-fizzle.png` });
  }
  // 4) 실전: 자동 전투 30초 동안 잠복종 4마리가 실제로 습격하는지(경직·몰이에 막혀 사라지지 않는지) 센다.
  const auto = await page.evaluate(async () => {
    const a = window.app; a.testPause = false; a.battle?.stop?.(); await a.startStage(window.__bqStage); a.testPause = true;
    const b = a.battle, p = b.player; p.auto = true;
    for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
    const list = [];
    for (let i = 0; i < 4; i++) { const ang = i / 4 * Math.PI * 2; const en = b.spawnEnemy('grave_burrower', null, b.curRoom, p.pos.clone().add(new p.pos.constructor(Math.cos(ang) * 6, 0, Math.sin(ang) * 6))); en.maxHp = en.hp = en.hp * 6; list.push(en); }
    for (let k = 0; k < 1800; k++) a.step(1 / 60, k === 1799);
    return { erupted: list.reduce((n, e) => n + (e.burrow?.erupted || 0), 0), fizzled: list.reduce((n, e) => n + (e.burrow?.fizzled || 0), 0), alive: list.filter((e) => e.alive).length, playerAlive: p.alive };
  });
  check('자동 전투 30초: 잠행 습격(솟구침) 실제 발생', auto.erupted >= 2, auto);
  check('자동 전투 30초: 플레이어 생존', auto.playerAlive, auto);
  await page.screenshot({ path: `${OUT}/auto-combat.png` });
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5).join(' | '));
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ at: new Date().toISOString(), build, results, errors }, null, 2));
  await br.close(); srv.kill();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;





