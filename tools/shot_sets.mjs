/**
 * 게이트 B 보조 — 회전 8 테마 세트 4종(서리결정·역병포자·룬각인·심연사슬)이
 * 실제로 발화하는지 **단언**하고 눈으로 본다.
 *   node tools/shot_sets.mjs [출력폴더=.rsi/shots]
 *
 * 하네스(metrics)는 레벨 1 · 장비 없음으로 돌기 때문에 세트 발동 효과가 한 번도 켜지지 않는다.
 * 회전 7 에서 각성기가 '층당 1회만 나가는' 버그를 하네스가 못 잡았던 것과 같은 구멍이다 — 이 컷이 유일한 눈이다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const PROJ = resolve(new URL('..', import.meta.url).pathname), PORT = 4198, OUT = resolve(PROJ, process.argv[2] || '.rsi/shots');
mkdirSync(OUT, { recursive: true });
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host'], { cwd: PROJ, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));

await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 });
await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());

/** 세트 4피스를 강제 장착하고 한 층을 열어 적 무리를 세운다 */
const setup = async (setId, heroId = 'knight', mobs = 14) => page.evaluate(async ({ setId, heroId, mobs }) => {
  const a = window.app, e = a.eco;
  a.testPause = false;
  if (!e.ownHero(heroId)) e.grantHero(heroId);
  e.s.selected = heroId; e.hero(heroId).level = 25; e.s.energy = 9999; e.s.fragments = 9999;
  for (const sl of ['weapon', 'armor', 'ring', 'boots']) { const r = e.craftSetItem(setId, sl); if (r.ok) e.equip(heroId, r.inst.uid); }
  e.save();
  a.battle.stop?.();
  await a.startStage(e.nextStage());
  a.testPause = true;
  const b = a.battle, p = b.player, V = p.pos.constructor;
  for (let i = 0; i < mobs; i++) {
    const ang = (i / mobs) * Math.PI * 2, r = 3 + (i % 3) * 1.2;
    b.spawnEnemy(i % 4 === 0 ? 'skel_rogue' : 'skel_minion', null, b.curRoom, p.pos.clone().add(new V(Math.cos(ang) * r, 0, Math.sin(ang) * r)));
  }
  for (const en of b.enemies) { en.spawning = 0; en.spawnT = 9; }
  for (let i = 0; i < 20; i++) a.step(1 / 60, false);
  return { procs: [...b.procs], sets: b.setBonus.map((s) => s.set.id + ':' + s.tier), enemies: b.enemies.filter((x) => x.alive).length };
}, { setId, heroId, mobs });

const step = (n, render = true) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.app.step(1 / 60, i === n - 1); }, n);
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'OK   ' : 'FAIL ') + name, detail ?? ''); };

// ───────────────── 서리결정 ─────────────────
{
  const info = await setup('frost');
  console.log('frost', JSON.stringify(info));
  // 주변 적을 반복 타격 → 5중첩에서 결정화
  const cry = await page.evaluate(() => {
    const b = window.app.battle, p = b.player;
    for (let k = 0; k < 90; k++) { b.hitRadius(p.pos, 7, p.atk * 0.02, { kb: 0, kind: 'slash', quiet: true, quietStop: true }); window.app.step(1 / 60, false); }
    return { total: b.sp.crystals, now: b.enemies.filter((e) => e.alive && e._crystal > 0).length };
  });
  check('서리 2세트 결정화', cry.total > 0, `누적 ${cry.total}회 · 현재 ${cry.now}마리`);
  await step(6);
  await page.screenshot({ path: `${OUT}/set_frost_crystal.png` });
  // 결정 상태에서 처치 → 기둥
  const pil = await page.evaluate(() => {
    const b = window.app.battle, p = b.player;
    for (let k = 0; k < 120 && b.sp.pillars.length < 2; k++) { b.hitRadius(p.pos, 8, p.atk * 6, { kb: 0, kind: 'slash', quiet: true, quietStop: true }); window.app.step(1 / 60, false); }
    return b.sp.pillars.length;
  });
  check('서리 4세트 얼음 기둥', pil > 0, `기둥 ${pil}개`);
  // 기둥이 적을 밀어내는가 — 기둥 옆에 적을 세우고 거리 변화를 본다
  const push = await page.evaluate(() => {
    const b = window.app.battle, V = b.player.pos.constructor, pl = b.sp.pillars[0];
    if (!pl) return null;
    const e = b.spawnEnemy('skel_minion', null, b.curRoom, pl.pos.clone().add(new V(0.9, 0, 0)));
    e.spawning = 0; e.spawnT = 9; e.stun = 99;   // AI 이동을 죽여 밀림만 본다
    const d0 = Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z);
    for (let i = 0; i < 30; i++) window.app.step(1 / 60, false);
    return { d0: +d0.toFixed(2), d1: +Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z).toFixed(2) };
  });
  check('얼음 기둥이 적을 밀어냄', push && push.d1 > push.d0 + 0.2, JSON.stringify(push));
  // 같은 놈을 계속 때려도 결정화가 연속으로 걸리면 안 된다 (2세트만으로 방 전체 영구 스턴)
  const lock = await page.evaluate(() => {
    const b = window.app.battle, p = b.player, V = p.pos.constructor;
    const e = b.spawnEnemy('skel_minion', null, b.curRoom, p.pos.clone().add(new V(2, 0, 0)));
    e.spawning = 0; e.spawnT = 9; e.maxHp = e.hp = 1e9;
    const before = b.sp.crystals;
    for (let k = 0; k < 360; k++) { b.damageEnemy(e, 1, { kb: 0, kind: 'slash', quiet: true, quietStop: true }); window.app.step(1 / 60, false); }
    return { crystals: b.sp.crystals - before, sec: 6 };
  });
  check('서리 결정화에 잠금이 있다', lock.crystals >= 1 && lock.crystals <= 2, `6초 동안 ${lock.crystals}회 (잠금 8초)`);
  await step(4);
  await page.screenshot({ path: `${OUT}/set_frost_pillar.png` });
}

// ───────────────── 역병포자 ─────────────────
{
  const info = await setup('plague');
  console.log('plague', JSON.stringify(info));
  const c1 = await page.evaluate(() => {
    const b = window.app.battle, p = b.player;
    for (let k = 0; k < 60 && b.sp.cloudsMade === 0; k++) { b.hitRadius(p.pos, 3.5, p.atk * 6, { kb: 0, kind: 'magic', quiet: true, quietStop: true }); window.app.step(1 / 60, false); }
    return { made: b.sp.cloudsMade, live: b.sp.clouds.length, r: b.sp.clouds[0] ? +b.sp.clouds[0].r.toFixed(1) : 0 };
  });
  check('역병 2세트 포자 구름', c1.made > 0, JSON.stringify(c1));
  await step(6);
  await page.screenshot({ path: `${OUT}/set_plague_cloud.png` });
  // 구름 안에서 계속 죽이면 전염되어 자라야 한다
  const c2 = await page.evaluate(() => {
    const b = window.app.battle, p = b.player, V = p.pos.constructor;
    const before = b.sp.clouds[0] ? b.sp.clouds[0].r : 0;
    let blooms = b.sp.bloomed;
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < 6; i++) { const e = b.spawnEnemy('skel_minion', null, b.curRoom, (b.sp.clouds[0] ? b.sp.clouds[0].pos : p.pos).clone().add(new V((i % 3) - 1, 0, ((i / 3) | 0) - 0.5))); e.spawning = 0; e.spawnT = 9; }
      for (let k = 0; k < 20; k++) { b.hitRadius(b.sp.clouds[0] ? b.sp.clouds[0].pos : p.pos, 6, p.atk * 6, { kb: 0, kind: 'magic', quiet: true, quietStop: true }); window.app.step(1 / 60, false); }
    }
    return { before: +before.toFixed(1), chainMax: b.sp.chainMax, bloomed: b.sp.bloomed, delta: b.sp.bloomed - blooms };
  });
  check('역병 전염(구름 성장)', c2.chainMax > 3, JSON.stringify(c2));
  check('역병 4세트 개화', c2.bloomed > 0, `이 층에서 ${c2.bloomed}회`);
  const c3 = await page.evaluate(() => {
    const b = window.app.battle;
    const grown = b.sp.clouds.filter((c) => c.r >= 6).length;
    for (let i = 0; i < 700; i++) window.app.step(1 / 60, false);   // 아무것도 안 하고 12초
    return { grown, left: b.sp.clouds.length };
  });
  check('구름이 스스로를 먹여 살리지 않는다', c3.left === 0, JSON.stringify(c3));
  await step(4);
  await page.screenshot({ path: `${OUT}/set_plague_bloom.png` });
}

// ───────────────── 룬각인 ─────────────────
{
  const info = await setup('rune');
  console.log('rune', JSON.stringify(info));
  const r1 = await page.evaluate(() => {
    const b = window.app.battle, p = b.player;
    // 실제 콤보를 돌려서 장전되는지 본다 (onComboHit 을 직접 부르면 훅이 붙어 있는지를 못 잰다)
    for (let k = 0; k < 400 && b.sp.runes < 6; k++) {
      if (p.state === 'idle' || p.state === 'move') p.startCombo(0);
      p.comboQueued = true;
      window.app.step(1 / 60, false);
    }
    return b.sp.runes;
  });
  check('룬 2세트 장전(실제 콤보)', r1 > 0, `${r1}/6`);
  await step(2);
  await page.screenshot({ path: `${OUT}/set_rune_charged.png` });
  const r2 = await page.evaluate(() => {
    const b = window.app.battle, p = b.player, V = p.pos.constructor;
    for (let i = 0; i < 8; i++) { const ang = (i / 8) * Math.PI * 2; const e = b.spawnEnemy('skel_minion', null, b.curRoom, p.pos.clone().add(new V(Math.cos(ang) * 4, 0, Math.sin(ang) * 4))); if (e) { e.spawning = 0; e.spawnT = 9; e.maxHp = e.hp = 1e9; } }
    for (let i = 0; i < 4; i++) window.app.step(1 / 60, false);
    const before = b.sp.runes, dmg0 = b.dmgDealt;
    p.dodge(new V(1, 0, 0));
    for (let i = 0; i < 45; i++) window.app.step(1 / 60, false);
    return { before, after: b.sp.runes, dmg: Math.round(b.dmgDealt - dmg0) };
  });
  check('룬 회피 방출', r2.before > 0 && r2.after === 0 && r2.dmg > 0, JSON.stringify(r2));
  await page.screenshot({ path: `${OUT}/set_rune_discharge.png` });
  // 4세트 과부하 — 만장전에서 스킬을 쓰면 그 스킬 쿨타임이 0 이 된다
  const r3 = await page.evaluate(() => {
    const b = window.app.battle, p = b.player;
    b.sp.runes = 6;
    p.state = 'idle'; p.cds[0] = 0;
    const ok = p.tryCastSkill(0);
    const cdAtCast = p.cds[0];
    for (let i = 0; i < 12; i++) window.app.step(1 / 60, false);
    return { ok, cdAtCast: +cdAtCast.toFixed(2), cdAfter: +p.cds[0].toFixed(2), runes: b.sp.runes };
  });
  check('룬 4세트 과부하(쿨 0)', r3.ok && r3.cdAtCast > 0 && r3.cdAfter === 0 && r3.runes === 0, JSON.stringify(r3));
  await step(8);
  await page.screenshot({ path: `${OUT}/set_rune_overload.png` });
}

// 원거리 영웅(대마도사)도 장전되는가 — fan/projectile 분기에 훅이 없어 세트가 통째로 죽어 있었다
{
  await setup('rune', 'mage');
  const rm = await page.evaluate(() => {
    const b = window.app.battle, p = b.player;
    for (let k = 0; k < 400 && b.sp.runes < 6; k++) {
      if (p.state === 'idle' || p.state === 'move') p.startCombo(0);
      p.comboQueued = true;
      window.app.step(1 / 60, false);
    }
    return { ranged: !!p.def.ranged, runes: b.sp.runes };
  });
  check('룬 장전이 원거리 영웅에서도 된다', rm.ranged && rm.runes >= 3, JSON.stringify(rm));
  await page.screenshot({ path: `${OUT}/set_rune_mage.png` });
}

// ───────────────── 심연사슬 ─────────────────
{
  const info = await setup('tether');
  console.log('tether', JSON.stringify(info));
  const t1 = await page.evaluate(() => {
    const b = window.app.battle, p = b.player;
    p.autoAim?.(14);
    if (!p.lockTarget) p.lockTarget = b.enemies.find((e) => e.alive);
    const dmg0 = b.dmgDealt;
    for (let i = 0; i < 70; i++) window.app.step(1 / 60, false);
    return { tether: !!b.sp.tether, target: !!p.lockTarget, dmg: Math.round(b.dmgDealt - dmg0) };
  });
  check('사슬 2세트 연결', t1.tether, JSON.stringify(t1));
  check('사슬이 선 위의 적을 벤다', t1.dmg > 0, `누적 ${t1.dmg}`);
  await step(2);
  await page.screenshot({ path: `${OUT}/set_tether_line.png` });
  const t2 = await page.evaluate(() => {
    const b = window.app.battle, p = b.player, V = p.pos.constructor;
    // 남아 있는 무리를 치운다 — 사슬은 한 번에 12마리까지만 감으므로 주변 잡몹이 자리를 다 먹으면 측정이 안 된다
    for (const e of b.enemies) { e.alive = false; e.dead = true; }
    for (let i = 0; i < 3; i++) window.app.step(1 / 60, false);
    // 멀리 있는 표적을 직접 세우고, 사슬 선 위에 적을 늘어놓는다
    const dir = new V(1, 0, 0);
    const mk = (d, off) => { const e = b.spawnEnemy('skel_minion', null, b.curRoom, p.pos.clone().addScaledVector(dir, d).add(new V(0, 0, off))); if (!e) return null; e.spawning = 0; e.spawnT = 9; e.stun = 999; e.maxHp = e.hp = 1e9; return e; };   // 사슬 지속 피해로 죽어버리면 '끌려왔는지'를 못 잰다
    const t = mk(9, 0); if (!t) return null;
    p.lockTarget = t;
    const marks = [4, 5.2, 6.4, 7.6].map((d, i) => mk(d, i % 2 ? 0.6 : -0.6)).filter(Boolean);
    for (let i = 0; i < 8; i++) { p.lockTarget = t; window.app.step(1 / 60, false); }   // 먼 표적을 락온 → 사슬이 그리로 붙는다
    const live = () => marks.filter((e) => e.alive);
    const d0 = live().reduce((a, e) => a + p.distTo(e), 0) / (live().length || 1);
    const tgt = b.sp.tether && b.sp.tether.e === t;
    p.dodge(new V(0, 0, 1));
    for (let i = 0; i < 60; i++) window.app.step(1 / 60, false);
    const d1 = live().reduce((a, e) => a + p.distTo(e), 0) / (live().length || 1);
    return { d0: +d0.toFixed(2), d1: +d1.toFixed(2), n: live().length, lockedFar: tgt };
  });
  check('사슬 4세트 감아 끌어오기', t2 && t2.n >= 3 && t2.d1 < t2.d0 - 1, JSON.stringify(t2));
  await page.screenshot({ path: `${OUT}/set_tether_reel.png` });
}

// HUD 세트 게이지가 실제로 보이는가
const gauge = await page.evaluate(() => {
  const el = document.getElementById('hud-setgauge');
  return { hidden: el.classList.contains('hidden'), label: document.getElementById('sg-label').textContent, pips: document.getElementById('sg-pips').childElementCount };
});
check('HUD 세트 게이지 표시', !gauge.hidden && gauge.pips > 0, JSON.stringify(gauge));

// 로비 세트 제작 화면 — 테마 세트가 8종으로 늘었다. 그리드가 넘치거나 겹치면 안 된다
{
  const craft = await page.evaluate(async () => {
    const a = window.app;
    a.battle.stop?.(); a.testPause = false;
    a.toLobby();
    a.eco.s.fragments = 9999; a.eco.save();
    a.meta.showCraft(a.eco.s.selected);
    await new Promise((r) => setTimeout(r, 350));
    const g = document.querySelector('.craft-grid');
    if (!g) return null;
    const box = g.getBoundingClientRect();
    // 8종은 한 화면에 안 들어간다 — 세로로 **스크롤이 되어야** 새 세트에 손이 닿는다
    const scrollable = g.scrollHeight > g.clientHeight + 2 ? (g.scrollTop = g.scrollHeight, g.scrollTop > 0) : true;
    return { sets: g.querySelectorAll('.craft-set').length, slots: g.querySelectorAll('[data-craft]').length, overflowsX: g.scrollWidth > g.clientWidth + 2, offscreen: box.right > window.innerWidth + 2, scrollable };
  });
  check('세트 제작 그리드 8종', craft && craft.sets === 8 && craft.slots === 32 && !craft.overflowsX && !craft.offscreen && craft.scrollable, JSON.stringify(craft));
  await page.screenshot({ path: `${OUT}/set_craft.png` });
  await page.evaluate(() => window.app.ui.closeModal());
}

console.log('\nerrors', errors.slice(0, 12));
const failed = results.filter((r) => !r.ok);
console.log(`\n단언 ${results.length - failed.length}/${results.length} 통과` + (errors.length ? ` · 콘솔 에러 ${errors.length}` : ''));
await br.close(); srv.kill();
process.exit(failed.length || errors.length ? 1 : 0);
