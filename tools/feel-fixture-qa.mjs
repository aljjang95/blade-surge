// 타격감 고정 픽스처(h3-feel): 다섯 영웅마다 같은 시드·같은 배치·같은 키 입력으로
// 3타 콤보(무리), 스킬(군중), 궁극기, 회피 취소, 피격(실제 적 경타 + 주입 강타), 중형(정예) 처치를 재생하고
// 히트스톱·적 피격 반응(플린치·넉백·섬광·피격 클립)·카메라·애니메이션 전환·입력 지연·취소 창·공격 간격을 프레임 단위로 잰다.
// 입력은 실제 키보드 이벤트(Input 의 keydown 처리기)로만 넣는다. 시간은 app.step(1/60) 고정이다.
// 시작 상태(적 체력·공격력·배치, 궁극기 게이지, 정예 체력 1 설정, 강타 피격 1회)만 픽스처가 고정하며 보고서에 표기한다.
// 사용: node tools/feel-fixture-qa.mjs <distDir> <outDir> [heroes=knight,barbarian,mage,rogue,ranger] [strips=1]
import { chromium } from 'playwright';
import { preview } from 'vite';
import { launchOpts } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJ = fileURLToPath(new URL('..', import.meta.url));
const DT = 1 / 60, MS = 1000 / 60;
export const HEROES = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'];
const SEED = 20261022;
const VIEW = { width: 844, height: 390 };

/** 브라우저 안 측정기. 직렬화되므로 바깥 변수를 쓰지 않는다. */
export function installFeelProbe() {
  const app = window.app, T = window.__THREE;
  const q = { frame: 0, rows: [], hits: [], stops: [], hurts: [], tracked: [], marks: [] };
  const B = () => app.battle;
  const BONE = /hips|spine|chest|neck|head|arm|hand|leg|thigh|shin|calf|foot/i;
  let bones = [], prev = [];
  const bindBones = () => {
    const p = B().player; bones = []; prev = [];
    p.model.traverse(o => { if (o.isBone && BONE.test(o.name)) { bones.push(o); prev.push(o.quaternion.clone()); } });
  };
  const poseDelta = () => {
    let mx = 0;
    for (let i = 0; i < bones.length; i++) {
      const a = bones[i].quaternion, b = prev[i];
      const d = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
      const ang = 2 * Math.acos(d) * 57.29578; if (ang > mx) mx = ang; b.copy(a);
    }
    return Math.round(mx * 100) / 100;
  };
  const mr = a => { const m = a.motionRoot; return Math.round((Math.hypot(m.position.x, m.position.z) + Math.abs(m.position.y) * 0 + Math.abs(m.rotation.x) * .5 + Math.abs(m.rotation.z) * .5) * 1000) / 1000; };
  const weights = a => (a.mixer._actions || []).filter(x => x.getEffectiveWeight() > .01).map(x => [x.getClip().name, Math.round(x.getEffectiveWeight() * 100) / 100]);
  const r3 = n => Math.round(n * 1000) / 1000;
  q.row = () => {
    const b = B(), p = b.player, tc = b.timeCtl, cam = app.renderer.camera;
    return { f: q.frame, sc: r3(tc.scale), stop: r3(tc.stop), slow: tc.slowT > 0 ? r3(tc.slow) : 1,
      ps: p.state, pa: p.actionName, hd: !!p.hitDone, ci: p.comboIdx, inv: r3(p.invuln), cq: p.state === 'attack' ? p.canQueueCombo() : null,
      cd: p.state === 'attack' ? p.canDodgeCancel() : null, pose: poseDelta(), w: weights(p),
      cam: [r3(cam.position.x - p.pos.x), r3(cam.position.y), r3(cam.position.z - p.pos.z)], fov: r3(cam.fov), kick: r3(app.renderer.kickOffset || 0),
      pmr: mr(p), pfl: r3(p.flashT), px: r3(p.pos.x), pz: r3(p.pos.z), hp: Math.round(p.hp),
      e: q.tracked.map(e => ({ a: e.alive, x: r3(e.pos.x), z: r3(e.pos.z), kb: r3(Math.hypot(e.kb.x, e.kb.z)), mr: mr(e), fl: r3(e.flashT),
        st: e.state, an: e.actionName, y: r3(e.motionRoot.position.y), sx: r3(e.motionRoot.scale.y), dead: !!e.dead, vis: e.model.visible })) };
  };
  q.step = (n = 1, renderLast = false) => {
    for (let i = 0; i < n; i++) {
      const render = renderLast && i === n - 1;
      app.step(1 / 60, render); q.frame++;
      q.rows.push(q.row());
    }
    return q.frame;
  };
  q.until = (pred, limit = 600) => { for (let i = 0; i < limit; i++) { if (pred()) return true; q.step(1); } return pred(); };
  q.mark = label => { q.marks.push({ f: q.frame, label }); return q.frame; };
  q.reset = () => { q.rows = []; q.hits = []; q.stops = []; q.hurts = []; q.marks = []; };
  q.wrap = () => {
    const b = B(), p = b.player;
    if (!b.timeCtl.__feel) {
      const tc = b.timeCtl, hs = tc.hitstop, sm = tc.slowmo;
      tc.hitstop = function(sec) { const before = this.stop; hs.call(this, sec); q.stops.push({ f: q.frame + 1, sec: r3(sec), granted: r3(this.stop - before) }); };
      tc.slowmo = function(scale, sec, ease) { q.stops.push({ f: q.frame + 1, slowmo: [r3(scale), r3(sec), r3(ease || 0)] }); return sm.call(this, scale, sec, ease); };
      tc.__feel = true;
    }
    if (!p.__feel) {
      const h = p.hurt;
      p.hurt = function(d, o) { const r = h.call(this, d, o); q.hurts.push({ f: q.frame + 1, kb: o?.kb ?? 2, accepted: r, state: this.state }); return r; };
      p.__feel = true;
    }
    bindBones();
  };
  /** 적을 모두 치우고 영웅을 시작 방 중앙에 세운 뒤 지정 배치로 적을 낸다. */
  q.arena = (spec = []) => {
    const b = B(), p = b.player, room = b.world.startRoom;
    for (const e of b.enemies) e.dispose(); b.enemies.length = 0; b.pending.length = 0; b.projectiles.length = 0;
    p.lockTarget = null; p.state = 'idle'; p.stateT = 0; p.hitDone = false; p.current = null; p.comboIdx = 0; p.vel.set(0, 0, 0); p.kb.set(0, 0, 0); p.stun = 0;
    p.hp = p.maxHp; p.mp = p.maxMp; p.invuln = 0; p.dodgeCd = 0; p.comboResume = null; p.counterWindow = 0; p.attackBufferT = 0; p.comboQueued = false;
    for (let i = 0; i < p.cds.length; i++) p.cds[i] = 0;
    p.pos.set(room.x, 0, room.z); p.yaw = 0; p.play('Idle', { fade: 0 });
    b.input.clear();
    q.tracked = [];
    for (const s of spec) {
      const at = new T.Vector3(room.x + Math.sin(s.ang) * s.dist, 0, room.z + Math.cos(s.ang) * s.dist);
      const e = b.spawnEnemy(s.species, null, room, at);
      if (!e) throw Error('적 생성 실패 ' + s.species);
      e.hp = e.maxHp = s.hp ?? 1e6; e.atk = s.atk ?? 0; e.atkCd = s.atkCd ?? 1e6; if (s.elite) e.isElite = true;
      q.tracked.push(e);
    }
    // 등장 연출이 끝나 전투 상태가 될 때까지 실제 루프로 진행한다.
    q.until(() => q.tracked.every(e => !e.spawning), 240);
    q.tracked.forEach((e, i) => { e.pos.set(room.x + Math.sin(spec[i].ang) * spec[i].dist, e.pos.y, room.z + Math.cos(spec[i].ang) * spec[i].dist); e.kb.set(0, 0, 0); });
    p.pos.set(room.x, 0, room.z); p.yaw = 0; p.vel.set(0, 0, 0);
    q.step(20);
    return { room: [room.x, room.z], tracked: q.tracked.map(e => ({ name: e.def.name, model: e.def.model, rig: e.rigName, elite: !!e.isElite, scale: e.scale })) };
  };
  q.roster = () => { const r = B().stage.rosterFor('elite'); return { trash: r.trash, elite: r.elite, ranged: r.ranged }; };
  q.player = () => { const p = B().player; return { state: p.state, idx: p.comboIdx, hitDone: p.hitDone, combo: p.def.combo.length, canQueue: p.canQueueCombo(), canDodge: p.canDodgeCancel(), ult: p.ult, ultMax: p.ultMax, alive: p.alive, action: p.actionName, invuln: p.invuln }; };
  /** 몬스터·영웅 클립 감사: 논리 키가 실제 클립으로 풀리는지, 비었거나 1프레임짜리 클립이 없는지. */
  q.audit = () => {
    const RIGKEYS = ['idle', 'idleCombat', 'walk', 'run', 'attack', 'attackHeavy', 'hit', 'hitHeavy', 'death', 'dodge', 'spawn', 'cast', 'summon', 'raise', 'attackSpin', 'attackJump', 'dash', 'back'];
    const out = { monsters: {}, hero: null };
    const seen = new Set();
    for (const [id, def] of Object.entries(window.__EN || {})) {
      const g = app.models[def.model]; if (!g || seen.has(def.model)) continue; seen.add(def.model);
      const names = new Set(g.animations.map(a => a.name));
      const lib = g.scene.userData.libraryAsset;
      const rigName = lib ? 'library' : def.model.startsWith('Big_') ? 'big' : def.model.startsWith('Blob_') ? 'blob' : def.model.startsWith('Flying_') ? 'flying' : 'kaykit';
      const empty = g.animations.filter(a => !a.tracks.length || a.duration < .05).map(a => a.name);
      out.monsters[def.model] = { example: id, rigName, clips: g.animations.length, empty, keys: Object.fromEntries(RIGKEYS.map(k => [k, null])) };
      // 실제 Actor.A 와 같은 규칙으로 해석하기 위해 임시 Actor 를 만들지 않고 첫 생성 적에서 확인한다(아래 resolveKeys).
      out.monsters[def.model].names = [...names];
    }
    return out;
  };
  q.resolveKeys = (keys) => {
    const out = {};
    for (const e of q.tracked) {
      const m = {}; for (const k of keys) { const before = Math.random; let calls = 0; Math.random = () => { calls++; return 0; }; const name = e.A(k); Math.random = before; m[k] = { clip: name, direct: [].concat(e.rig[k] || []).includes(name), rng: calls }; }
      out[e.def.model] = { rig: e.rigName, keys: m };
    }
    return out;
  };
  window.__feel = q;
}

const keyFor = { attack: 'KeyJ', dodge: 'KeyK', skill0: 'Digit1', skill1: 'Digit2', skill2: 'Digit3', ult: 'KeyR' };

async function runHero(browser, origin, hero, out, strips) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(origin);
  await page.locator('#boot-start:not(.hidden)').waitFor();
  await page.evaluate(hero => {
    const eco = window.app.eco; eco.reset();
    (eco.s.roster.policy = 1, eco.s.roster.starterChosen = true);
    eco.s.daily.last = Math.floor(Date.now() / 86400000); eco.s.tutorial = { completed: true };
    eco.s.selected = hero; eco.hero(hero).level = 10; eco.hero(hero).exp = 0; eco.save(); window.app.journey.setAuto(false);
  }, hero);
  await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app.mode === 'lobby' && !document.getElementById('boot').classList.contains('show'));
  await page.evaluate(async ({ seed }) => {
    const app = window.app; app.ui.closeModal(); app.testPause = true;
    let s = seed; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    if (await app.startStage(app.eco.nextStage()) !== true) throw Error('출격 실패');
    app.companionAgent?.endBattle?.(); app.battle.player.auto = false;
    app.renderer.setCameraPreset('top');
  }, { seed: SEED });
  await page.evaluate(installFeelProbe);
  await page.evaluate(() => { window.__feel.wrap(); window.__feel.step(60); });
  const roster = await page.evaluate(() => window.__feel.roster());
  const trash = roster.trash[0], elite = roster.elite[0];
  const press = async action => { await page.keyboard.down(keyFor[action]); await page.keyboard.up(keyFor[action]); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shots = [];
  const shoot = async (scenario, label) => {
    if (!strips) return;
    const file = join(out, `${hero}-${scenario}-${String(shots.length).padStart(2, '0')}-${label}.png`);
    await ev(() => window.app.step(0, true)); await page.screenshot({ path: file }); shots.push({ scenario, label, file });
  };
  const result = { hero, roster, scenarios: {}, errors };
  const fan = (n, dist, spread = 1.2) => Array.from({ length: n }, (_, i) => ({ species: trash, dist: dist + (i % 2) * .4, ang: n === 1 ? 0 : -spread / 2 + spread * i / (n - 1) }));
  const ring = (n, dist) => Array.from({ length: n }, (_, i) => ({ species: trash, dist, ang: i / n * Math.PI * 2 }));
  const take = () => ev(() => { const q = window.__feel; const r = { rows: q.rows, hits: q.hits, stops: q.stops, hurts: q.hurts, marks: q.marks }; q.reset(); return r; });

  // S1 3타 콤보: 무리 5마리. 다음 타 예약 창이 열리는 즉시 누른다.
  result.scenarios.combo3 = { setup: await ev(s => window.__feel.arena(s), fan(5, 2.1)) };
  await ev(() => window.__feel.reset());
  await ev(() => window.__feel.mark('press-0')); await press('attack');
  for (let k = 0; k < 3; k++) {
    await ev(k => { const q = window.__feel, p = window.app.battle.player; q.until(() => p.state === 'attack' && p.comboIdx === k && p.hitDone, 300); q.mark('contact-' + k); }, k);
    if (k === 2) await shoot('combo3', 'contact3');
    if (k < 2) {
      await ev(() => { const q = window.__feel, p = window.app.battle.player; q.until(() => p.canQueueCombo(), 120); q.mark('press-next'); });
      await press('attack');
    }
  }
  for (const n of [2, 3, 4]) { await ev(n => window.__feel.step(n), n); await shoot('combo3', `+${n}`); }
  await ev(() => window.__feel.step(40));
  Object.assign(result.scenarios.combo3, await take());

  // S2 스킬 1번: 앞쪽 군중 8마리.
  result.scenarios.skill = { setup: await ev(s => window.__feel.arena(s), fan(8, 3.2, 1.6)) };
  await ev(() => window.__feel.reset()); await ev(() => window.__feel.mark('press-skill0')); await press('skill0');
  for (const n of [6, 10, 10, 14]) { await ev(n => window.__feel.step(n), n); await shoot('skill', `f${await ev(() => window.__feel.frame)}`); }
  await ev(() => window.__feel.step(80));
  Object.assign(result.scenarios.skill, await take());

  // S3 궁극기: 게이지만 채우고(픽스처 고정) 실제 키로 발동.
  result.scenarios.ult = { setup: await ev(s => window.__feel.arena(s), ring(8, 3.4)) };
  await ev(() => { const p = window.app.battle.player; p.ult = p.ultMax; window.__feel.reset(); window.__feel.mark('press-ult'); });
  await press('ult');
  for (const n of [8, 14, 18, 22, 26]) { await ev(n => window.__feel.step(n), n); await shoot('ult', `f${await ev(() => window.__feel.frame)}`); }
  await ev(() => window.__feel.step(120));
  Object.assign(result.scenarios.ult, await take());

  // S4 회피 취소: 1타 접촉 뒤 회피 창이 열리는 첫 프레임에 회피, 회피가 끝나면 공격(콤보 이어가기).
  result.scenarios.dodgeCancel = { setup: await ev(s => window.__feel.arena(s), fan(3, 2.1)) };
  await ev(() => { window.__feel.reset(); window.__feel.mark('press-0'); }); await press('attack');
  await ev(() => { const q = window.__feel, p = window.app.battle.player; q.until(() => p.state === 'attack' && p.hitDone, 120); q.mark('contact-0'); q.until(() => p.canDodgeCancel(), 120); q.mark('press-dodge'); });
  await press('dodge');
  await ev(() => { const q = window.__feel, p = window.app.battle.player; q.until(() => p.state === 'dodge', 30); q.mark('dodge-start'); });
  for (const n of [3, 5, 6]) { await ev(n => window.__feel.step(n), n); await shoot('dodge', `f${await ev(() => window.__feel.frame)}`); }
  await ev(() => { const q = window.__feel, p = window.app.battle.player; q.until(() => p.state !== 'dodge', 60); q.mark('dodge-end'); q.mark('press-resume'); });
  await press('attack');
  await ev(() => { const q = window.__feel, p = window.app.battle.player; q.until(() => p.state === 'attack' && p.hitDone, 120); q.mark('resume-contact'); q.step(30); });
  Object.assign(result.scenarios.dodgeCancel, await take());

  // S5 피격: (a) 실제 적 1마리의 경타, (b) 강타(kb 7) 1회 주입.
  result.scenarios.hurt = { setup: await ev(s => window.__feel.arena(s), [{ species: trash, dist: 1.3, ang: 0, atk: 30, atkCd: .2 }]) };
  await ev(() => { const q = window.__feel; q.reset(); q.mark('wait-enemy'); const n0 = q.hurts.length; q.until(() => q.hurts.length > n0, 360); q.mark('light-hit'); });
  await shoot('hurt', 'light');
  await ev(() => { const q = window.__feel; q.step(30); for (const e of q.tracked) { e.atk = 0; e.atkCd = 1e6; } });
  await ev(() => { const q = window.__feel, p = window.app.battle.player; p.invuln = 0; q.mark('heavy-inject'); p.hurt(60, { kb: 7, dirx: 0, dirz: -1, kind: 'blunt' }); });
  for (const n of [2, 4, 6]) { await ev(n => window.__feel.step(n), n); await shoot('hurt', `heavy+${await ev(() => window.__feel.frame)}`); }
  await ev(() => window.__feel.step(40));
  Object.assign(result.scenarios.hurt, await take());

  // S6 중형 처치: 정예 1(마무리 직전에 체력 1로 고정) + 체력 1 졸개 2. 콤보 끝까지 실제 키로 진행한다.
  result.scenarios.kill = { setup: await ev(s => window.__feel.arena(s), [{ species: elite, dist: 2.2, ang: 0, elite: true }, { species: trash, dist: 2.4, ang: -.5, hp: 1 }, { species: trash, dist: 2.4, ang: .5, hp: 1 }]) };
  result.scenarios.kill.keys = await ev(() => window.__feel.resolveKeys(['idle', 'idleCombat', 'run', 'attack', 'attackHeavy', 'hit', 'hitHeavy', 'death', 'dodge', 'spawn', 'cast']));
  await ev(() => { window.__feel.reset(); window.__feel.mark('press-0'); }); await press('attack');
  const comboLen = (await ev(() => window.__feel.player())).combo;
  for (let k = 0; k < comboLen; k++) {
    if (k === comboLen - 1) await ev(() => { const e = window.__feel.tracked[0]; if (e.alive) e.hp = 1; window.__feel.mark('elite-hp1'); });
    const ok = await ev(k => { const q = window.__feel, p = window.app.battle.player; const r = q.until(() => p.state === 'attack' && p.comboIdx === k && p.hitDone, 300); q.mark('contact-' + k); return r; }, k);
    if (!ok) break;
    if (k === comboLen - 1) { await shoot('kill', 'finisher'); break; }
    await ev(() => { const q = window.__feel, p = window.app.battle.player; q.until(() => p.canQueueCombo(), 120); q.mark('press-next'); });
    await press('attack');
  }
  for (const n of [4, 8, 12, 16]) { await ev(n => window.__feel.step(n), n); await shoot('kill', `f${await ev(() => window.__feel.frame)}`); }
  await ev(() => window.__feel.step(150));
  Object.assign(result.scenarios.kill, await take());
  result.audit = await ev(() => window.__feel.audit());
  result.shots = shots;
  await context.close();
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [distArg = 'dist', outArg = '/tmp/claude-0/lanes-shots/h3-feel/run', heroArg = HEROES.join(','), stripArg = '1'] = process.argv.slice(2);
  const out = resolve(outArg); mkdirSync(out, { recursive: true });
  const server = await preview({ root: PROJ, configFile: false, build: { outDir: resolve(PROJ, distArg) }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch(launchOpts({ headless: true }));
  const report = { dist: resolve(PROJ, distArg), seed: SEED, dt: DT, viewport: VIEW, heroes: {} };
  try {
    for (const hero of heroArg.split(',')) {
      const t0 = Date.now();
      report.heroes[hero] = await runHero(browser, origin, hero, out, stripArg === '1');
      console.log(JSON.stringify({ hero, sec: Math.round((Date.now() - t0) / 1000), errors: report.heroes[hero].errors.length }));
      writeFileSync(join(out, 'raw.json'), JSON.stringify(report));
    }
  } finally {
    await browser.close(); await new Promise(r => server.httpServer.close(r));
  }
  writeFileSync(join(out, 'raw.json'), JSON.stringify(report));
  console.log('ok', out, MS.toFixed(2));
}
