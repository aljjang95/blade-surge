#!/usr/bin/env bun
// 시드 전투 난수 진행 대조: 영웅 5 × 스킬 8 × 일반/저화질(lite) × 조준 유무 = 160경우를 실제 FX·SKILLS 로 시전하고,
// 단계(start · cast · update 틱 · after 콜백 · end)마다 Math.random 소비 횟수와 판정 호출(game.*)을 기록한다.
// 같은 파일을 두 체크아웃(main / 작업 브랜치)에 놓고 각각 실행한 뒤 --compare 로 비교한다.
//
//   bun tools/skill-rng-parity.mjs --out a.json
//   bun tools/skill-rng-parity.mjs --compare a.json b.json
//
// 소스는 import.meta 기준 ../src 를 쓰므로 어느 체크아웃에서 실행했는지가 곧 대상 코드다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

if (args.includes('--compare')) {
  const i = args.indexOf('--compare');
  process.exit(compare(args[i + 1], args[i + 2]));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => import(pathToFileURL(path.join(ROOT, 'src', p)).href);
const THREE = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);

// ---------- 환경 흉내: document, 텍스처 ----------
const gradient = { addColorStop() {} };
const context = new Proxy({ createRadialGradient: () => gradient, createLinearGradient: () => gradient }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const canvasEl = () => ({ getContext: () => context, style: {}, width: 0, height: 0 });
globalThis.document = { createElement: canvasEl, createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }), getElementById: () => ({ firstChild: null, appendChild() {}, removeChild() {} }), body: { appendChild() {} } };
const { VFX_TEX, VFX_LIST } = await src('engine/assets.js');
for (const n of VFX_LIST) VFX_TEX[n] ||= new THREE.Texture();
try { const sv = await src('engine/skill-vfx.js'); for (const n of sv.SKILL_VFX_TEXTURES || []) VFX_TEX[sv.skillVfxKey(n)] ||= new THREE.Texture(); } catch {}

const { FX } = await src('engine/fx.js');
const { SKILLS } = await src('game/skills.js');
const { HEROES } = await src('data/heroes.js');
const { HERO_SKILLS } = await src('engine/combat-sound-library.js');

// ---------- 난수: 고정 시드 LCG + 호출 횟수 ----------
let draws = 0, rseed = 0x1234abcd;
const seededRandom = () => { draws++; rseed = (Math.imul(rseed, 1664525) + 1013904223) >>> 0; return rseed / 4294967296; };
const nativeRandom = Math.random;
Math.random = seededRandom;

// ---------- 호출 기록 ----------
let calls = [];
const r4 = (n) => Math.round(n * 1e4) / 1e4;
function sum(v, d = 0) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return Number.isFinite(v) ? r4(v) : String(v);
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'function') return 'fn';
  if (v.isVector3) return [r4(v.x), r4(v.y), r4(v.z)];
  if (v.__enemyId !== undefined) return 'enemy#' + v.__enemyId;
  if (v.__stub) return '<' + v.__stub + '>';
  if (Array.isArray(v)) return d > 2 ? '[..]' : v.map((x) => sum(x, d + 1));
  if (typeof v === 'object') {
    if (d > 2) return '{..}';
    const o = {};
    for (const k of Object.keys(v).sort()) { if (k === 'skillCast' || k === 'source') { o[k] = '<ref>'; continue; } o[k] = sum(v[k], d + 1); }
    return o;
  }
  return String(v);
}
const rec = (name, a) => { calls.push(name + '(' + a.map((x) => JSON.stringify(sum(x))).join(',') + ')'); };

/** 모르는 프로퍼티는 호출만 기록하는 함수로 응답하는 스텁(이름은 prefix.name). */
function stub(prefix, base = {}, ret = {}) {
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined;
      return (...a) => { rec(prefix + '.' + k, a); return ret[k]?.(...a); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

// ---------- 가짜 적 / 영웅 / 게임 ----------
const ENEMY_POS = [[0, 5], [2, 8], [-3, 10], [1, 20]];
function makeEnemies(origin) {
  return ENEMY_POS.map(([x, z], i) => stub('enemy' + i, {
    __enemyId: i, id: i, alive: true, spawning: false, dead: false, radius: 0.6, hp: 1000, maxHp: 1000,
    pos: new THREE.Vector3(origin.x + x, 0, origin.z + z), vel: new THREE.Vector3(), kb: new THREE.Vector3(),
    isBoss: false, isElite: false, stun: 0, slowT: 0, def: { model: 'x' }, scale: 1,
  }));
}

function makeGame(fx, enemies, player, reduced = false) {
  const timers = [];
  const within = (c, r) => enemies.filter((e) => e.alive && Math.hypot(e.pos.x - c.x, e.pos.z - c.z) - e.radius * 0.5 <= r);
  const game = stub('game', {
    fx, enemies, player, active: true, paused: false, elapsed: 0, stage: { id: 1 }, timers,
    app: { reducedMotion: { matches: reduced } },
    scene: new THREE.Scene(),
    world: stub('world', { walkable: () => true, groundY: () => 0 }),
    renderer: stub('renderer'), timeCtl: stub('timeCtl'), ui: stub('ui'), input: { move: { x: 0, y: 0 }, aim: null },
    after(sec, fn) { calls.push('game.after(' + r4(sec) + ')'); timers.push({ t: sec, fn }); },
    hasProc: () => false,
  }, {
    hitRadius: (c, r) => within(c, r).length,
    hitArea: (c, r) => within(c, r).length,
    damageEnemy: (e, d) => d,
    vacuum: (c, r) => within(c, r).length,
    spawnProjectile: () => ({ __stub: 'projectile' }),
  });
  game.__timers = timers;
  return game;
}

function makePlayer(def) {
  return stub('player', {
    __stub: 'player', alive: true, def, atk: 100, hp: 1000, maxHp: 1000, mp: 100,
    pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), yaw: 0, invuln: 0, jobResource: 0, buffs: {}, stats: {}, model: new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())),
    distTo(e) { return Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); },
    forward(v = new THREE.Vector3()) { return v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); },
    face() {}, play() {}, playTimed() {}, startTrail() {}, stopTrail() {}, gainJobResource() {},
    arrowOrigin(v = new THREE.Vector3()) { return v.copy(this.pos).setY(1.2); },
    beacon: stub('beacon'), nearestEnemy() { return null; }, tintEmissive() {}, skillLevels: [1, 1, 1, 1, 1, 1, 1, 1],
  });
}

// ---------- 한 경우 실행 ----------
const DT = 1 / 30;
let sharedFx = null;
function runCase(hero, id, lite, aim) {
  const def = HEROES[hero];
  const sk = def.skills.find((s) => s.id === id);
  const impl = SKILLS[id];
  const out = { id, steps: [], error: null };
  if (!sk || !impl) { out.error = 'missing skill/impl'; return out; }
  rseed = 0x1234abcd; draws = 0; calls = [];
  // 실제 게임처럼 FX 하나를 계속 쓴다(재질 캐시가 데워진 뒤의 횟수). 경우 사이에는 남은 연출만 비운다.
  const fx = sharedFx || (sharedFx = new FX(new THREE.Scene(), new THREE.PerspectiveCamera()));
  fx.clearAll?.(); fx.setQuality(lite ? 'low' : 'high');
  const player = makePlayer(def);
  const enemies = makeEnemies(player.pos);
  const game = makeGame(fx, enemies, player);
  const c = { sk, impl, t: 0, cast: false, done: false, dmg: 100, level: 1, data: {} };
  if (aim) c.data.aimPoint = new THREE.Vector3(1.5, 0, 6);
  const step = (name, fn) => {
    const d0 = draws; calls = [];
    try { fn(); } catch (e) { calls.push('THROW ' + String(e && e.message).slice(0, 120)); }
    const d = draws - d0;
    if (d || calls.length) out.steps.push({ step: name, draws: d, calls: calls.slice() });
  };
  step('start', () => impl.start?.(game, player, c));
  const castT = (impl.dur || 0.8) * sk.castAt, total = impl.total || impl.dur || 0.8;
  const endT = total + 2.5;   // 끝난 뒤에도 after 콜백(지연 타격)이 남아 있을 수 있어 2.5초 더 진행
  let ended = false;
  for (let k = 0; k * DT < endT; k++) {
    const n = 'tick' + String(k).padStart(3, '0');
    game.elapsed += DT;
    // 1) fx 시계  2) game.after 타이머  3) 플레이어(캐스트 · update · 끝)
    step(n + '.fx', () => fx.update(DT));
    step(n + '.timers', () => {
      for (let i = game.__timers.length - 1; i >= 0; i--) { const tm = game.__timers[i]; tm.t -= DT; if (tm.t <= 0) { game.__timers.splice(i, 1); tm.fn(); } }
    });
    if (!ended) {
      c.t += DT;
      if (!c.cast && c.t >= castT) { c.cast = true; step(n + '.cast', () => impl.cast?.(game, player, c)); }
      step(n + '.update', () => impl.update?.(game, player, c, DT));
      if (c.t >= total) { ended = true; c.done = true; step(n + '.end', () => impl.end?.(game, player, c)); }
    }
  }
  out.totalDraws = draws;
  out.pendingTimers = game.__timers.length;
  return out;
}

// ---------- 전체 ----------
const heroes = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'];
const matrix = [];
for (const hero of heroes) HERO_SKILLS[hero].forEach((id, slot) => { for (const lite of [false, true]) for (const aim of [false, true]) matrix.push([hero, slot, id, lite, aim]); });

// 웜업: 실제 게임은 캐시(재질·지오메트리)가 데워진 뒤에 시전하므로 한 번 돌려 버리고 두 번째 패스를 기록한다.
for (const [hero, , id, lite, aim] of matrix) runCase(hero, id, lite, aim);
const cases = {};
for (const [hero, slot, id, lite, aim] of matrix) {
  const key = `${hero}/${slot}:${id}/${lite ? 'lite' : 'full'}/${aim ? 'aim' : 'noaim'}`;
  cases[key] = runCase(hero, id, lite, aim);
}
Math.random = nativeRandom;
const result = { root: ROOT, cases: Object.keys(cases).length, data: cases };
const outPath = argOf('--out');
if (outPath) { fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(result, null, 1)); }
const errs = Object.entries(cases).filter(([, v]) => v.error || v.steps.some((s) => s.calls.some((c) => c.startsWith('THROW'))));
console.log(`경우 ${result.cases}개 실행, 예외/누락 ${errs.length}개${outPath ? ', 저장 ' + outPath : ''}`);
for (const [k, v] of errs.slice(0, 10)) console.log('  ', k, v.error || v.steps.flatMap((s) => s.calls).find((c) => c.startsWith('THROW')));
process.exit(0);

// ---------- 비교 ----------
function compare(fa, fb) {
  const A = JSON.parse(fs.readFileSync(fa, 'utf8')).data, B = JSON.parse(fs.readFileSync(fb, 'utf8')).data;
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  let bad = 0, steps = 0;
  for (const k of keys) {
    const a = A[k], b = B[k];
    if (!a || !b) { bad++; console.log(`불일치 ${k}: 한쪽에만 있음`); continue; }
    const sa = new Map(a.steps.map((s) => [s.step, s])), sb = new Map(b.steps.map((s) => [s.step, s]));
    const names = [...new Set([...sa.keys(), ...sb.keys()])].sort();
    const lines = [];
    for (const n of names) {
      steps++;
      const x = sa.get(n), y = sb.get(n);
      if (!x || !y) { lines.push(`  ${n}: ${x ? 'A만' : 'B만'} 있음 (draws ${(x || y).draws}, calls ${(x || y).calls.length})`); continue; }
      if (x.draws !== y.draws) lines.push(`  ${n}: Math.random ${x.draws} -> ${y.draws} (${y.draws - x.draws >= 0 ? '+' : ''}${y.draws - x.draws})`);
      if (JSON.stringify(x.calls) !== JSON.stringify(y.calls)) {
        const ca = x.calls, cb = y.calls; const first = ca.findIndex((c, i) => c !== cb[i]);
        const i = first < 0 ? Math.min(ca.length, cb.length) : first;
        lines.push(`  ${n}: 판정/호출 차이 #${i} A=${ca[i] ?? '(없음)'} | B=${cb[i] ?? '(없음)'}`);
      }
    }
    if (a.totalDraws !== b.totalDraws) lines.push(`  총 소비 ${a.totalDraws} -> ${b.totalDraws}`);
    if (lines.length) { bad++; console.log(`불일치 ${k}`); lines.forEach((l) => console.log(l)); }
  }
  console.log(`경우 ${keys.length}개, 비교한 단계 ${steps}개, 불일치 경우 ${bad}개`);
  return bad ? 1 : 0;
}
