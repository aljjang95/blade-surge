/**
 * 신규 계정 캠페인 연속 플레이 QA — 새 저장 하나로 1-1부터 --to(기본 3-10)까지 실제 키보드 입력으로 이어서 플레이한다.
 *   node tools/playtest-campaign.mjs [--to 3-10] [--from 1-1] [--budget-min 150] [--seed 1] [--out work/qa/campaign/<시각>]
 * 전제: `npx vite build` 산출물(dist). 고정 dt(1/60)로 렌더 없이 진행하고, 스크린샷·mp4 때만 렌더한다.
 * 규칙: 영웅 레벨·진행·스탯을 건드리지 않는다(에너지가 바닥나면 채우고 '에너지 벽'으로 기록). AUTO 없음, 승리 강제 없음.
 * 이동은 사람이 지도·화살표를 보고 가는 것과 같게 월드 거리장(buildFlow)을 따라 키로 걷는다(p.auto 는 항상 false).
 * 스테이지 사이에는 게임 자체 API(보상 수령·장비 교체·훈련·스킬 습득·강화·숙련·소환)만 쓰고 모두 기록한다.
 * 실기기 입력·GPU 프레임·체감 난이도의 최종 판단이 아니다(스트레스 없는 봇 입력, 결정적 dt).
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn, spawnSync } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';
import { MASTERY_NODES, STORY_EVENTS } from '../src/data/masterworks.js';
import { HEROES } from '../src/data/heroes.js';
import { ITEM_BY_ID, ENH_MAX, enhanceChance } from '../src/data/items.js';
import { HERO_CAMPAIGN_JOIN } from '../src/data/hero-roster.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname));
const TO = arg('to', '3-10'), FROM = arg('from', '1-1'), SEED = Number(arg('seed', 1)), BUDGET_MS = Number(arg('budget-min', 150)) * 60000;
// --enhance-min: 성공 확률이 이 값 이상인 단계까지만 강화한다(기본 0.8 = +5까지). 예전 규칙은 '+8까지(당시 100%)'였다.
const ENH_MIN = Number(arg('enhance-min', 0.8));
// --no-sure: 확정 강화(골드 웃돈)를 쓰지 않는다(기준선 재현용). --sure-reserve: 정비를 시작할 때 골드의 이 비율은 남긴다(기본 0.25, 최소 5만).
const SURE = !process.argv.includes('--no-sure'), SURE_RESERVE = Number(arg('sure-reserve', 0.25));
const PULL = process.argv.includes('--pull'), MAX_SEC = Number(arg('max-sec', 600)), RETRIES = Number(arg('retries', 2)), VIDEO_EVERY = Number(arg('video-every', 5));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const OUT = resolve(PROJ, arg('out', `work/qa/campaign/${stamp}`));
mkdirSync(resolve(OUT, 'shots'), { recursive: true });
const LOG = resolve(OUT, 'log.jsonl');
const log = (o) => { const line = JSON.stringify(o); appendFileSync(LOG, line + '\n'); console.log(line.length > 500 ? line.slice(0, 500) + '…' : line); };
const PORT = 4700 + Math.floor(Math.random() * 300), VIEWPORT = { width: 844, height: 390 };
const T0 = Date.now();
const codeIdx = (c) => { const [a, b] = c.split('-').map(Number); return (a - 1) * 10 + b; };
const idxCode = (i) => `${Math.ceil(i / 10)}-${((i - 1) % 10) + 1}`;

let build = {}; try { build = JSON.parse(readFileSync(resolve(PROJ, 'dist/version.json'), 'utf8')); } catch { /* version.json 은 `node tools/write-version.mjs` 가 만든다 */ }
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await br.newContext({ viewport: VIEWPORT }); // 새 컨텍스트 = 빈 localStorage
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push({ atS: Math.round((Date.now() - T0) / 1000), t: m.text().slice(0, 240) }); });
page.on('pageerror', (e) => errors.push({ atS: Math.round((Date.now() - T0) / 1000), t: 'PAGEERR ' + e.message.slice(0, 240) }));
page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push({ atS: Math.round((Date.now() - T0) / 1000), t: `HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}` }); });

const stages = [], friction = [], metaLog = [], joins = [], newHeroTrials = [];
let aborted = null;

/** 브라우저 안 하네스. 한 번 설치하고 스테이지마다 enter/tick/settle 을 부른다. */
function installCampaign({ seed, masteryNodes, heroSkills, itemSlot, storyFirst, maxSec, pullEnabled, itemRarity, enhChance, enhMin, sureOn, sureReserve }) {
  const a = window.app, e = a.eco;
  let st = seed >>> 0;
  Math.random = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const toasts = [];
  const origToast = a.ui.toast.bind(a.ui);
  a.ui.toast = (msg, kind) => { toasts.push(String(msg).replace(/<[^>]+>/g, '').slice(0, 120)); return origToast(msg, kind); };
  setInterval(() => { document.querySelector('.lore-scene-skip')?.click(); }, 250); // 입장 장면은 건너뛰기 버튼으로 넘긴다
  const held = new Set();
  const key = (code, down) => { if (down === held.has(code)) return; down ? held.add(code) : held.delete(code); window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true })); };
  const tap = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true })); };
  // 화면 조이스틱을 마우스 이벤트(input.js 의 start/move/end)로 조작한다: 모바일 사람 손과 같은 아날로그 경로.
  const joy = (kx, ky) => {
    const inp = a.input, area = document.getElementById('joy'); if (!inp || !area) return;
    if (!inp.joy.active) area.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 300, button: 0, bubbles: true, cancelable: true }));
    const R = inp.joy.radius, m = Math.hypot(kx, ky), k = m > 1 ? 1 / m : 1;
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: inp.joy.cx + kx * k * R, clientY: inp.joy.cy + ky * k * R, bubbles: true, cancelable: true }));
  };
  const joyRelease = () => { if (a.input?.joy?.active) window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })); };
  const SKILL_KEYS = ['Digit1', 'Digit2', 'Digit3', 'KeyR', 'KeyQ', 'KeyE'];
  const C = { m: null, toasts };
  window.__C = C;

  C.enter = async (code) => {
    const [ch, s] = code.split('-').map(Number);
    for (const k of [...held]) key(k, false); joyRelease();
    a.testPause = false;
    if (a.mode !== 'lobby') a.toLobby?.();
    a.ui.closeModal?.();
    const def = window.__stageDef(ch, s);
    let energyWall = null;
    e.tickEnergy?.();
    if (e.s.energy < def.energy) { energyWall = { have: e.s.energy, need: def.energy }; e.s.energy = e.energyMax; e.save(); }
    const energyBefore = e.s.energy;
    const ok = await a.startStage({ ch, st: s });
    a.testPause = true;
    if (ok === false) return { ok: false, reason: 'startStage false', energyWall, toasts: toasts.slice(-3) };
    for (let i = 0; i < 50 && !(a.battle?.active && a.battle.player); i++) await new Promise((r) => setTimeout(r, 100));
    const b = a.battle, p = b.player;
    if (!b.active || !p) return { ok: false, reason: 'battle not active', energyWall };
    p.auto = false; a.ui.closeModal?.();
    window.__MAXSEC = maxSec;
    const m = C.m = {
      code, frames: 0, dmgTaken: 0, hits: 0, dmgBy: {}, offers: [], pausedFrames: 0, softlock: null, abort: null,
      lastReward: 0, longestDry: 0, lootN: b.drops.loot.length, rooms: b.roomsCleared || 0, mat: 0, dodgeCd: 0, skillT: 0, lastPos: [p.pos.x, p.pos.z], posT: 0,
      shotRoom1: false, shotBoss: false, bossSeen: null, killsSeen: new WeakSet(), kinds: {}, castCount: 0, atkFrames: 0, maxAlive: 0,
      toastsFrom: toasts.length, skillsUsed: {}, deadFrames: 0, stuckN: 0, lastKills: -1, flow: null, flowKey: '',
    };
    const origHurt = p.hurt.bind(p);
    p.hurt = (amt, o) => {
      const before = p.hp; const r = origHurt(amt, o);
      if (p.hp < before) {
        m.hits++; m.dmgTaken += before - p.hp;
        let src = null, best = 5;
        for (const en of b.enemies) { const d = en.distTo(p); if (d < best && (en.alive || en.fuse >= 0)) { best = d; src = en; } }
        const k = (o?.kind === 'fire' ? 'fire:' : '') + (src ? (src.runtimeSpeciesId || src.def.name) + (src.isBoss ? '(boss)' : src.isElite ? '(elite)' : '') : 'far/proj/hazard');
        m.dmgBy[k] = +((m.dmgBy[k] || 0) + (before - p.hp) / p.maxHp * 100).toFixed(1);
      }
      return r;
    };
    const hid = e.s.selected;
    return { ok: true, energyWall, energyBefore, energyAfter: e.s.energy, stage: { code: def.code, recPower: def.recPower, energy: def.energy, boss: !!def.boss, title: def.title }, hero: { id: hid, level: e.hero().level, power: e.heroPower(hid), maxHp: p.maxHp } };
  };

  const resolveOffers = (m) => {
    const b = a.battle; let n = 0;
    for (let g = 0; g < 8 && b.active; g++) {
      const offer = b.currentOffer?.(); if (!offer) break;
      let res;
      if (offer.kind === 'boon') { const id = offer.ids?.[0]; res = b.selectBoon?.(id); if (res?.ok) m.offers.push('boon:' + id); }
      else if (offer.kind === 'story') { const cid = storyFirst[offer.id]; res = b.selectStory?.(cid); if (res?.ok) m.offers.push('story:' + offer.id + ':' + cid); }
      if (!res?.ok) break; n++;
    }
    return n;
  };

  C.tick = (n, renderEvery = 0) => {
    const m = C.m, b = a.battle, p = b.player, W = b.world;
    let snap = null;
    for (let k = 0; k < n; k++) {
      m.frames++;
      if (!p.alive) { // 쓰러짐: 부활 창에서 '아니오'를 고른 것으로 본다(보석 부활 없음)
        m.deadFrames++;
        for (const kk of [...held]) key(kk, false); joyRelease();
        a.step(1 / 60, false);
        if (m.deadFrames > 130 && b.active) { a.ui.closeModal?.(); b.defeat(); }
        if (!b.active) break;
        continue;
      }
      if (b.paused) {
        m.pausedFrames++;
        const r = resolveOffers(m);
        if (r) { m.lastReward = b.elapsed; m.pausedFrames = 0; }
        if (m.pausedFrames === 200) { a.ui.closeModal?.(); m.softlock = 'paused:' + [...b.pauseReasons].join('|'); }
        if (m.pausedFrames > 900) { m.abort = 'paused-softlock'; break; }
        a.step(1 / 60, false);
        continue;
      }
      const alive = b.enemies.filter((x) => x.alive && !x.spawning);
      m.maxAlive = Math.max(m.maxAlive, alive.length);
      for (const en of b.enemies) {
        if (!en.alive && !m.killsSeen.has(en)) {
          m.killsSeen.add(en);
          const kind = en.isBoss ? 'boss' : en.isElite ? 'elite' : 'normal'; m.kinds[kind] = (m.kinds[kind] || 0) + 1;
          if (kind !== 'normal') m.lastReward = b.elapsed;
        }
      }
      // 보상 이벤트: 장비 획득·방 클리어·재료/조각·제안 선택·정예/보스 처치
      const matNow = (b.drops.stones || 0) + (b.drops.stones2 || 0) + (b.drops.stones3 || 0) + (b.drops.fragments || 0);
      const lootNow = b.drops.loot.length, roomsNow = b.roomsCleared || 0;
      if (lootNow > m.lootN || roomsNow > m.rooms || matNow > m.mat) m.lastReward = b.elapsed;
      m.lootN = lootNow; m.rooms = roomsNow; m.mat = matNow;
      m.longestDry = Math.max(m.longestDry, b.elapsed - m.lastReward);
      // ---- 사람처럼 조작 ----
      const near = alive.filter((x) => !(x.burrow?.phase === 'under')).sort((x, y) => x.distTo(p) - y.distTo(p));
      const tgt = near[0], engaged = tgt && tgt.distTo(p) < 15;
      let wx = 0, wz = 0, attack = false;
      m.dodgeCd -= 1 / 60; m.skillT -= 1 / 60;
      if (engaged) {
        const threat = near.find((x) => x.telegraph > 0 && x.telegraph < .4 && x.distTo(p) < (x.def.ranged ? 3 : (x.def.range || 2) + 2.5));
        const dx = tgt.pos.x - p.pos.x, dz = tgt.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
        const reach = p.def.ranged ? 7 : 2.2;
        let keg;
        const prop = b.roomProps?.list.find((q) => !q.used && Math.hypot(q.x - p.pos.x, q.z - p.pos.z) < 8 && near.filter((x) => Math.hypot(x.pos.x - q.x, x.pos.z - q.z) < 5).length >= 3);
        if (prop && !(threat && m.dodgeCd <= 0)) {
          const qx = prop.x - p.pos.x, qz = prop.z - p.pos.z, qd = Math.hypot(qx, qz) || 1;
          if (qd > 1.6) { wx = qx / qd; wz = qz / qd; } else { attack = true; wx = qx / qd * .3; wz = qz / qd * .3; }
        } else if ((keg = b.roomProps?.list.find((q) => q.kind === 'keg' && q.fuse >= 0 && Math.hypot(q.x - p.pos.x, q.z - p.pos.z) < 6))) {
          const qx = p.pos.x - keg.x, qz = p.pos.z - keg.z, qd = Math.hypot(qx, qz) || 1; wx = qx / qd; wz = qz / qd;
        } else if (threat && m.dodgeCd <= 0) {
          const ax = p.pos.x - threat.pos.x, az = p.pos.z - threat.pos.z, ad = Math.hypot(ax, az) || 1; wx = ax / ad; wz = az / ad; tap('KeyK'); m.dodgeCd = 1.1;
        } else if (d > reach) {
          // 벽 뒤 적은 거리장으로 돌아간다(사람이 복도를 도는 것과 같다)
          let clear = true;
          if (W?.walkable) for (let s = 1; s < 6; s++) if (!W.walkable(p.pos.x + dx * s / 6, p.pos.z + dz * s / 6)) { clear = false; break; }
          if (clear || !W?.buildFlow) { wx = dx / d; wz = dz / d; }
          else { const f = W.buildFlow(tgt.pos.x, tgt.pos.z), dir = W.flowDir(f, p.pos.x, p.pos.z); if (dir) { wx = dir[0]; wz = dir[1]; } else { wx = dx / d; wz = dz / d; } }
        } else { attack = true; if (p.state !== 'attack') { wx = dx / d * .3; wz = dz / d * .3; } }
        // 스킬: 쿨다운·MP·궁극 게이지를 보고 쓴다
        if (m.skillT <= 0 && d < (p.def.ranged ? 11 : 6)) {
          const crowd = near.filter((x) => x.distTo(p) < 5).length, big = tgt.isElite || tgt.isBoss;
          for (let slot = 5; slot >= 0; slot--) {
            const i = slot < 4 ? slot : (p.skillLoadout ? p.skillLoadout[slot - 4] : slot);
            const sk = p.def.skills[i]; if (!sk || !p.unlocked(i)) continue;
            const mpCost = sk.mp || 0;
            const ready = sk.ult ? p.ult >= p.ultMax : (p.cds[i] <= 0 && mpCost <= (Number.isFinite(p.mp) ? p.mp : 999));
            if (!ready) continue;
            if (sk.ult && !(big || crowd >= 4)) continue;
            if (!sk.ult && !(crowd >= 2 || big || p.def.ranged || d < 4)) continue;
            tap(SKILL_KEYS[slot]); m.skillT = .55; m.castCount++; m.skillsUsed[sk.id || i] = (m.skillsUsed[sk.id || i] || 0) + 1; break;
          }
        }
      } else if (W) {
        // 교전 상대가 없으면 지도(미클리어 방·포탈·경로 목표)를 따라 걷는다.
        let gx = null, gz = null;
        const goal = b.routeObjectives?.autoGoal?.();
        if (b.portal) { gx = b.portal.pos.x; gz = b.portal.pos.z; }
        else if (goal) { gx = goal.x; gz = goal.z; }
        else {
          let t = b.autoTarget;
          if (!t || t.cleared || !W.rooms.includes(t)) {
            let nearest = null, dist = Infinity;
            for (const room of W.rooms) { if (room.cleared || (W.sealed && room === W.bossRoom)) continue; const d = Math.hypot(room.x - p.pos.x, room.z - p.pos.z); if (d < dist) { dist = d; nearest = room; } }
            const boss = W.bossRoom;
            t = nearest ? ((boss && !boss.cleared && boss.discovered && !W.sealed) ? boss : nearest) : null;
            b.autoTarget = t;
          }
          if (t) { const pt = b.routeObjectives?.autoPoint?.(t) || t; gx = pt.x; gz = pt.z; }
        }
        if (gx != null && Math.hypot(gx - p.pos.x, gz - p.pos.z) > .65) {
          const ddx = gx - p.pos.x, ddz = gz - p.pos.z, dl = Math.hypot(ddx, ddz) || 1;
          let dir = null;
          if (W.buildFlow && W.walkable) {
            let clr = true; for (let s = 1; s <= 8; s++) if (!W.walkable(p.pos.x + ddx * s / 8, p.pos.z + ddz * s / 8)) { clr = false; break; }
            if (!clr) { if (!m.flow || m.flowKey !== gx + ',' + gz) { m.flow = W.buildFlow(gx, gz); m.flowKey = gx + ',' + gz; } dir = W.flowDir(m.flow, p.pos.x, p.pos.z); }
          }
          if (dir) { wx = dir[0]; wz = dir[1]; } else { wx = ddx / dl; wz = ddz / dl; }
        }
      }
      // 월드 방향 → 카메라 기준 키(8방향)
      const yaw = a.input?.getCameraYaw?.() ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
      const kx = wx * c - wz * s, ky = wx * s + wz * c;
      joy(kx, ky); // 가상 조이스틱(마우스 이벤트 경로) — 아날로그 방향. 공격·회피·스킬은 키보드 이벤트
      key('KeyJ', attack);
      if (attack) m.atkFrames++;
      // 스턱 감지: 40초(게임) 동안 위치·처치 변화가 없으면 소프트락 후보 3회 → 중단
      m.posT += 1 / 60;
      if (m.posT > 40) {
        const moved = Math.hypot(p.pos.x - m.lastPos[0], p.pos.z - m.lastPos[1]);
        if (moved < 1.5 && b.kills === m.lastKills) { m.softlock = m.softlock || (() => {
          const un = (W?.rooms || []).filter((r) => !r.cleared).map((r) => `${r.type || '?'}@${r.x?.toFixed?.(0)},${r.z?.toFixed?.(0)}${r === W.bossRoom ? '[boss]' : ''}${r.discovered ? '' : '[hidden]'}`);
          const T = b.autoTarget;
          return `stuck@${b.elapsed.toFixed(0)}s pos=${p.pos.x.toFixed(0)},${p.pos.z.toFixed(0)} alive=${alive.length} enemies=${b.enemies.filter((x) => x.alive).map((x) => (x.def?.name || '?') + (x.spawning ? '(spawning)' : '') + '@' + x.pos.x.toFixed(0) + ',' + x.pos.z.toFixed(0)).slice(0, 5).join('|')} portal=${!!b.portal} sealed=${!!W?.sealed} bossDefeated=${!!b.bossDefeated} boss=${!!b.boss}/${b.boss?.alive} target=${T ? T.type + '@' + T.x?.toFixed?.(0) + ',' + T.z?.toFixed?.(0) : null} unclearedRooms=${un.join(',')} goal=${JSON.stringify(b.routeObjectives?.autoGoal?.() || null)} keys=${[...held].join('')} joy=${a.input?.joy?.active}:${a.input?.move?.x?.toFixed?.(2)},${a.input?.move?.y?.toFixed?.(2)} flowKey=${m.flowKey} flowDir=${(() => { try { const f = T && W.buildFlow(T.x, T.z); return JSON.stringify(f && W.flowDir(f, p.pos.x, p.pos.z)); } catch (er) { return 'err:' + er.message; } })()} walk8=${[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]].map(([a, c]) => W.walkable(p.pos.x + a * 1.5, p.pos.z + c * 1.5) ? 1 : 0).join('')} r=${p.radius} vel=${p.vel ? p.vel.x?.toFixed?.(2) + ',' + p.vel.z?.toFixed?.(2) : '-'} state=${p.state}`;
        })(); if (++m.stuckN >= 3) { m.abort = 'stuck'; break; } }
        m.lastPos = [p.pos.x, p.pos.z]; m.lastKills = b.kills; m.posT = 0;
      }
      // 스크린샷 시점: 1번 방 입장(교전 전 대형) / 보스 조우
      if (!m.shotRoom1 && m.frames >= 70 && alive.length) { m.shotRoom1 = true; snap = 'room1'; }
      const boss = b.boss && b.boss.alive ? b.boss : null;
      if (boss && !m.bossSeen && boss.distTo(p) < 16 && !boss.spawning) { m.bossSeen = +b.elapsed.toFixed(1); m.bossShotAt = m.frames + 45; }
      if (m.bossShotAt && !m.shotBoss && m.frames >= m.bossShotAt) { m.shotBoss = true; snap = 'boss'; }
      a.step(1 / 60, renderEvery > 0 && m.frames % renderEvery === 0);
      if (snap) { a.step(0, true); break; }
      if (!b.active || b.bossDefeated) break;
      if (b.elapsed > window.__MAXSEC) { m.abort = 'timeout'; break; }
    }
    return { snap, t: +b.elapsed.toFixed(1), alive: b.enemies.filter((x) => x.alive).length, hp: Math.round(p.hp / p.maxHp * 100), kills: b.kills, active: b.active, dead: !p.alive, won: !!b.bossDefeated, abort: C.m.abort || null };
  };

  /** 승리/패배 후 결과 화면(정산)까지 진행하고 영수증 요약을 돌려준다. */
  C.settle = () => {
    const b = a.battle, m = C.m;
    for (const k of [...held]) key(k, false); joyRelease();
    if (b.active && m.abort) { try { b.defeat(); } catch {} }
    for (let i = 0; i < 400; i++) { if (b.result && a.ui.resultData === b.result) break; a.step(1 / 60, false); }
    const r = b.result;
    if (!r) return { ok: false, reason: 'no result' };
    const rw = r.reward, h = e.hero(b.heroId);
    return { ok: true, win: !!r.win, stars: r.stars ?? null, time: +(r.time ?? b.elapsed).toFixed(1), kills: r.kills, rooms: r.rooms ?? null, totalRooms: r.totalRooms ?? null, fullClear: !!r.fullClear, revives: r.revives || 0,
      reward: rw ? { ups: rw.ups, exp: rw.exp, combatExp: rw.combatExp, first: rw.first, got: (rw.got || []).map((g) => g.k + ':' + g.n), loot: (rw.loot || []).length, heroJoin: rw.heroJoin, regionUnlock: !!rw.regionUnlock, awakened: (rw.awakened || []).map((x) => x.name), saveError: rw.saveError } : null,
      heroLevel: h.level, heroExp: h.exp, toasts: toasts.slice(m.toastsFrom) };
  };

  C.report = () => {
    const m = C.m, b = a.battle, p = b.player;
    return { hits: m.hits, dmgTakenPct: +(m.dmgTaken / p.maxHp * 100).toFixed(1), dmgBy: m.dmgBy, longestDry: +m.longestDry.toFixed(1), kinds: m.kinds, offers: m.offers, softlock: m.softlock, abort: m.abort,
      castCount: m.castCount, skillsUsed: m.skillsUsed, maxAlive: m.maxAlive, bossSeen: m.bossSeen, elapsed: +b.elapsed.toFixed(1), atkShare: +(m.atkFrames / Math.max(1, m.frames)).toFixed(2) };
  };

  /** 스테이지 사이: 합리적인 플레이어가 하는 일(게임 API 그대로). 하는 일은 전부 돌려준다. */
  C.meta = () => {
    const acts = [];
    const did = (kind, detail) => acts.push({ kind, ...detail });
    for (const k of [...held]) key(k, false);
    if (a.mode !== 'lobby') a.toLobby?.();
    a.ui.closeModal?.();
    const id = e.s.selected;
    const gold0 = e.s.gold;
    try {
      // 1) 보상 수령: 출석·우편·임무·여정·패스
      if (e.dailyAvailable?.()) { const r = e.claimDaily(); did('claimDaily', { r: r && JSON.stringify(r).slice(0, 80) }); }
      for (const mm of e.s.mail || []) if (!mm.read) { const r = e.claimMail(mm.id); if (r) did('claimMail', { id: mm.id, title: mm.tit || mm.title }); }
      for (const q of e.quests()) if (q.done && !q.claimed) { e.claimQuest(q.id); did('claimQuest', { id: q.id, name: q.name }); }
      try { const snap = a.journey.snapshot(); for (const s of snap.steps || []) { if (s.ready && !s.claimed) { const r = a.journey.claimStep(s.id); did('claimJourney', { id: s.id, ok: !!r?.ok }); } } } catch (err) { did('journeyErr', { err: String(err).slice(0, 80) }); }
      for (let lv = 1; lv <= e.passLevel; lv++) if (!e.s.pass.claimedFree.includes(lv)) { const r = e.claimPass(lv, false); if (r) did('claimPass', { lv }); }
      // 2) 소환: 게임 견적이 가능한 배너(초보자 → 영웅)를 10연으로
      for (let g = 0; g < 4 && pullEnabled; g++) {
        const banner = ['beginner', 'hero'].find((bid) => e.pullQuote(10, bid).ok);
        if (!banner) break;
        const q = e.pullQuote(10, banner), res = e.pull(10, banner);
        if (!res) break;
        did('pull10', { banner, currency: q.currency, results: res.map((x) => (x.id || x.item?.id || x.hero || '?') + (x.rar ? '/' + x.rar : '')) });
      }
      // 3a) 장비(새 UI 그대로): 영웅 탭 가방의 "더 좋은 장비 장착" → "가방 정리"(확인 단계 포함)를 사람이 누르듯 눌러 본다.
      {
        a.meta.heroSel = id; a.meta.heroPane = 'gear'; a.meta.bagClean = null; a.meta.openTab('heroes');
        const q = (sel) => document.querySelector('#hero-bag ' + sel);
        const press = (sel) => { const b = q(sel); if (!b || b.disabled) return false; b.click(); return true; };
        for (let g = 0; g < 3; g++) {
          const before = e.heroPower(id), worn0 = JSON.stringify(e.hero(id).equip);
          if (!press('[data-bag-best]')) break;
          const after = e.heroPower(id);
          if (JSON.stringify(e.hero(id).equip) === worn0) break;
          did('uiEquipBest', { power: `${before}->${after}`, swaps: Object.keys(e.hero(id).equip).filter((k) => JSON.parse(worn0)[k] !== e.hero(id).equip[k]).length });
        }
        const bag0 = e.s.inventory.length;
        if (press('[data-bag-clean]') && press('[data-clean-go]') && press('[data-clean-confirm]')) did('uiBagClean', { bag: `${bag0}->${e.s.inventory.length}` });
        else { a.meta.bagClean = null; }
        a.meta.bagClean = null;
      }
      // 3b) 새 UI가 놓친 교체가 남았는지 점검: 아무도 안 낀 장비 중 전투력이 오르는 것을 슬롯마다 최선으로 낀다(남은 것은 equip 으로 기록)
      for (let guard = 0; guard < 12; guard++) {
        const h = e.hero(id), worn = new Set(Object.entries(e.s.heroes).flatMap(([hid, hh]) => hid === id ? [] : Object.values(hh.equip || {})));
        const base = e.heroPower(id); let best = null;
        for (const inst of e.s.inventory) {
          if (worn.has(inst.uid) || Object.values(h.equip || {}).includes(inst.uid)) continue;
          const slot = itemSlot[inst.id]; if (!slot) continue;
          const after = e.heroBuildStats(id, { ...h.equip, [slot]: inst.uid }, e.s.inventory).power;
          if (after > base && (!best || after > best.after)) best = { inst, slot, after };
        }
        if (!best) break;
        const old = h.equip[best.slot]; e.equip(id, best.inst.uid);
        did('equip', { slot: best.slot, item: best.inst.id, enh: best.inst.enh, power: `${base}->${e.heroPower(id)}`, replaced: old || null });
      }
      // 4) 훈련(골드로 레벨 마무리): 게임이 허용할 때 반복
      for (let g = 0; g < 10; g++) { const q = e.trainingQuote(id); if (!q.ok) { if (g === 0 && q.reason) did('trainBlocked', { reason: q.reason, need: q.cost, exp: `${q.exp}/${q.need}` }); break; } if (!e.levelUpHero(id)) break; did('trainLevelUp', { to: e.hero(id).level, cost: q.cost, gold: q.cost }); }
      // 5) 스킬 포인트: 낮은 레벨부터
      const skills = heroSkills[id];
      if (skills) for (let g = 0; g < 30; g++) {
        let learned = false;
        const order = skills.map((s, i) => ({ i, rank: Math.floor(Number(e.hero(id).skills?.[i]) || 0) })).sort((x, y) => x.rank - y.rank || x.i - y.i);
        for (const { i } of order) { const r = e.learnSkill(id, i); if (r?.ok) { did('learnSkill', { index: i, name: skills[i].name, level: r.level }); learned = true; break; } }
        if (!learned) break;
      }
      // 6) 숙련(명성)
      try {
        const mw = a.masterworks?.s; if (mw) for (let g = 0; g < 10; g++) {
          const unlocked = mw.unlocked || [];
          const node = masteryNodes.find((n) => !unlocked.includes(n.id) && mw.renown >= n.cost && (n.tier === 1 || unlocked.includes(n.path + '_' + (n.tier - 1))));
          if (!node) break; const r = a.masterworks.unlock(node.id); if (!r?.ok) break; did('mastery', { id: node.id, name: node.name, cost: node.cost });
        }
      } catch (err) { did('masteryErr', { err: String(err).slice(0, 80) }); }
      // 7) 강화: 착용 장비 중 가장 낮은 강화부터, 성공 확률 enhMin 이상인 단계까지(실패도 기록), 남은 골드·강화석 한도 안에서
      for (let g = 0; g < 60; g++) {
        const h = e.hero(id), worn = Object.values(h.equip || {}).map((uid) => e.s.inventory.find((x) => x.uid === uid)).filter(Boolean).filter((x) => (enhChance[x.enh] ?? 0) >= enhMin).sort((x, y) => x.enh - y.enh);
        if (!worn.length) break;
        const t = worn[0], from = t.enh, g0 = e.s.gold, r = e.enhance(t.uid);
        if (!r.ok) { did('enhanceBlocked', { reason: r.reason, item: t.id, enh: from }); break; }
        did('enhance', { item: t.id, from, to: r.enh, success: r.success, chance: r.chance, gold: g0 - e.s.gold, ...(r.destroyed ? { destroyed: true } : {}), ...(r.down ? { down: r.down } : {}) });
      }
      // 7b) 확정 강화(골드 웃돈): 위에서 멈춘(성공 확률 enhMin 미만) 착용 장비를, 정비 시작 골드의 sureReserve(최소 5만)를 남기는 한도에서
      //     강화 화면의 '확정 강화'와 같은 호출 eco.enhance(uid, { sure: true })로 올린다. 가장 낮은 강화부터, 실패가 없으므로 기록은 성공만.
      if (sureOn) {
        const reserve = Math.max(50000, Math.floor(gold0 * sureReserve));
        for (let g = 0; g < 40; g++) {
          const h = e.hero(id), worn = Object.values(h.equip || {}).map((uid) => e.s.inventory.find((x) => x.uid === uid)).filter(Boolean)
            .map((x) => ({ x, q: e.enhanceQuote(x.uid) })).filter(({ q }) => q && q.sureGold && q.chance < enhMin).sort((p, q) => p.x.enh - q.x.enh);
          if (!worn.length) break;
          const { x: t, q } = worn[0];
          if (e.s.gold - (q.gold + q.sureGold) < reserve) { did('sureSkip', { item: t.id, enh: t.enh, need: q.gold + q.sureGold, reserve }); break; }
          const g0 = e.s.gold, from = t.enh, r = e.enhance(t.uid, { sure: true });
          if (!r.ok) { did('sureBlocked', { reason: r.reason, item: t.id, enh: from }); break; }
          did('enhanceSure', { item: t.id, from, to: r.enh, gold: g0 - e.s.gold, sureGold: r.sureGold });
        }
      }
    } catch (err) { did('metaError', { err: String(err && err.stack || err).slice(0, 300) }); }
    // 인벤토리 진단: 가방 등급 분포, 착용 장비, 안 낀 장비 중 슬롯별 최대 전투력 변화
    let inv = null;
    try {
      const byRarity = {}; for (const x of e.s.inventory) { const r = itemRarity[x.id] || '?'; byRarity[r] = (byRarity[r] || 0) + 1; }
      const h = e.hero(id), base = e.heroPower(id), bestDelta = {};
      for (const x of e.s.inventory) { const slot = itemSlot[x.id]; if (!slot || h.equip[slot] === x.uid) continue; const d = e.heroBuildStats(id, { ...h.equip, [slot]: x.uid }, e.s.inventory).power - base; if (bestDelta[slot] === undefined || d > bestDelta[slot]) bestDelta[slot] = d; }
      inv = { total: e.s.inventory.length, byRarity, worn: Object.entries(h.equip || {}).map(([slot, uid]) => { const x = e.s.inventory.find((y) => y.uid === uid); return x ? `${slot}:${x.id}(${itemRarity[x.id]}+${x.enh})` : `${slot}:-`; }), bestUnwornPowerDelta: bestDelta, stones: [e.s.stones, e.s.stones2, e.s.stones3], fragments: e.s.fragments };
    } catch (err) { inv = { err: String(err).slice(0, 80) }; }
    // 골드 소비처별 합계(이번 정비): 훈련·일반 강화·확정 강화 웃돈. 나머지(소환 등 보석·소환권)는 골드를 쓰지 않는다.
    const spend = { training: 0, enhance: 0, sure: 0 };
    for (const x of acts) { if (x.kind === 'trainLevelUp') spend.training += x.gold || 0; else if (x.kind === 'enhance') spend.enhance += x.gold || 0; else if (x.kind === 'enhanceSure') { spend.enhance += (x.gold || 0) - (x.sureGold || 0); spend.sure += x.sureGold || 0; } }
    return { acts, inv, spend, gold: [gold0, e.s.gold], gems: e.s.gems, energy: e.s.energy, power: e.heroPower(id), level: e.hero(id).level, tickets: e.s.tickets };
  };

  C.state = () => { const hid = e.s.selected; return { mode: a.mode, hero: hid, level: e.hero().level, exp: e.hero().exp, power: e.heroPower(hid), unlocked: e.s.progress.unlocked, gold: e.s.gold, gems: e.s.gems, energy: e.s.energy, energyMax: e.energyMax, owned: [...(e.s.roster?.owned || [])], inventory: e.s.inventory.length, equip: e.hero().equip, levels: Object.fromEntries(Object.entries(e.s.heroes).map(([k, v]) => [k, v.level])) }; };
  C.select = (hid) => { if (!e.s.roster?.owned?.includes(hid)) return false; e.s.selected = hid; e.reconcileOwnership?.(); e.save(); return e.s.selected === hid; };
  C.equipFree = (hid) => { // 새 동료: 아무도 안 낀 장비 중 슬롯마다 최선을 낀다(합류 영웅이 맨몸이 되지 않게)
    const acts = []; const worn = new Set(Object.values(e.s.heroes).flatMap((hh) => Object.values(hh.equip || {})));
    for (let g = 0; g < 8; g++) {
      const h = e.hero(hid), base = e.heroPower(hid); let best = null;
      for (const inst of e.s.inventory) { if (worn.has(inst.uid)) continue; const slot = itemSlot[inst.id]; if (!slot || h.equip[slot]) continue; const after = e.heroBuildStats(hid, { ...h.equip, [slot]: inst.uid }, e.s.inventory).power; if (after > base && (!best || after > best.after)) best = { inst, slot, after }; }
      if (!best) break; e.equip(hid, best.inst.uid); worn.add(best.inst.uid); acts.push({ kind: 'equipFree', hero: hid, slot: best.slot, item: best.inst.id });
    }
    return acts;
  };
  return true;
}

const shotPath = (code, tag, attempt, extra = '') => resolve(OUT, 'shots', `${code}${extra}-${tag}${attempt > 1 ? '-a' + attempt : ''}.jpg`);
const screenshot = async (path) => { try { await page.screenshot({ path, type: 'jpeg', quality: 78 }); } catch (err) { log({ evt: 'shot-fail', err: String(err).slice(0, 100) }); } };
const timeLeft = () => BUDGET_MS - (Date.now() - T0);

async function playStage(code, attempt, { tag = '' } = {}) {
  const t0 = Date.now();
  const wantVideo = VIDEO_EVERY > 0 && codeIdx(code) % VIDEO_EVERY === 0 && attempt === 1 && !tag;
  const FR = resolve(OUT, 'frames', code); if (wantVideo) { rmSync(FR, { recursive: true, force: true }); mkdirSync(FR, { recursive: true }); }
  const entered = await page.evaluate((c) => window.__C.enter(c), code);
  if (!entered.ok) return { code, attempt, tag, result: 'start-failed', detail: entered };
  if (entered.energyWall) friction.push({ kind: 'energy-wall', at: code, attempt, ...entered.energyWall });
  let f = 0, last;
  const chunk = wantVideo ? 24 : 600;
  const extra = tag ? '-' + tag : '';
  while (true) {
    last = await page.evaluate(([n, r]) => window.__C.tick(n, r), [chunk, wantVideo ? chunk : 0]);
    if (last.snap) await screenshot(shotPath(code, last.snap, attempt, extra));
    else if (wantVideo) { await page.screenshot({ path: `${FR}/${String(f++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 60 }); }
    if (!last.active || last.dead || last.won || last.abort) break;
    if (timeLeft() < 0) { aborted = 'budget'; await page.evaluate(() => { window.__C.m.abort = 'budget'; }); break; }
  }
  const settle = await page.evaluate(() => window.__C.settle());
  const rep = await page.evaluate(() => window.__C.report());
  let mp4 = null;
  if (wantVideo && f > 4) {
    const out = resolve(OUT, `play-${code}.mp4`);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', `${FR}/%05d.jpg`, '-vf', 'scale=844:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
    mp4 = ff.status === 0 ? out : null; if (mp4) rmSync(FR, { recursive: true, force: true });
  }
  const win = !!settle.win;
  return {
    code, attempt, tag, hero: entered.hero.id, result: win ? 'win' : (rep.abort ? 'abort:' + rep.abort : 'loss'),
    clearS: settle.time ?? rep.elapsed, deaths: win ? 0 : 1, levelBefore: entered.hero.level, levelAfter: settle.heroLevel ?? entered.hero.level,
    power: entered.hero.power, recPower: entered.stage.recPower, powerRatio: +(entered.hero.power / entered.stage.recPower).toFixed(2),
    kills: settle.kills ?? last.kills, kinds: rep.kinds, longestDryS: rep.longestDry, hpLostPct: rep.dmgTakenPct, hits: rep.hits,
    topDamage: Object.entries(rep.dmgBy).sort((x, y) => y[1] - x[1]).slice(0, 4), stars: settle.stars, rooms: settle.rooms !== null && settle.rooms !== undefined ? `${settle.rooms}/${settle.totalRooms}` : null,
    reward: settle.reward, offers: rep.offers, toasts: settle.toasts, softlock: rep.softlock, casts: rep.castCount, skillsUsed: rep.skillsUsed, bossSeenAtS: rep.bossSeen, atkShare: rep.atkShare,
    stageEnergy: entered.stage.energy, energyWall: entered.energyWall || null, wallS: +((Date.now() - t0) / 1000).toFixed(0), mp4,
    shots: { room1: shotPath(code, 'room1', attempt, extra), boss: shotPath(code, 'boss', attempt, extra) },
  };
}

async function doMeta(label) {
  const r = await page.evaluate(() => window.__C.meta());
  const row = { evt: 'meta', label, ...r }; metaLog.push(row); log({ evt: 'meta', label, inv: r.inv, n: r.acts.length, gold: r.gold, spend: r.spend, gems: r.gems, power: r.power, level: r.level, acts: r.acts.map((x) => x.kind + (x.item ? ':' + x.item : '') + (x.name ? ':' + x.name : '') + (x.to ? '>' + x.to : '')).slice(0, 40) });
  return r;
}

function writeReport(final = false) {
  const wins = stages.filter((s) => s.result === 'win' && !s.tag);
  const levelUps = []; let lv = 1;
  for (const s of stages.filter((x) => !x.tag && x.result === 'win')) { if (s.levelAfter > lv) { levelUps.push({ code: s.code, from: lv, to: s.levelAfter }); lv = s.levelAfter; } }
  const rep = { build, args: { to: TO, from: FROM, seed: SEED, budgetMin: BUDGET_MS / 60000, retries: RETRIES }, wallMin: +((Date.now() - T0) / 60000).toFixed(1), final, aborted, stages, friction, joins, newHeroTrials, metaLog, errors, levelUps,
    cadence: { stagesCleared: wins.length, levelUps: levelUps.length, stagesPerLevelUp: levelUps.length ? +(wins.length / levelUps.length).toFixed(2) : null } };
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(rep, null, 1));
  const L = [];
  L.push(`# 캠페인 연속 플레이 요약 (${String(build.sha || '').slice(0, 8)}) — ${final ? '완료' : '진행 중'}`, '', `벽시계 ${rep.wallMin}분 · 시드 ${SEED} · ${FROM} → ${TO} · ${aborted ? '중단: ' + aborted : '중단 없음'}`, '');
  L.push('| 코드 | 시도 | 결과 | 영웅 | Lv 전→후 | 전투력/권장 | 클리어(s) | 사망 | 처치 | 무보상 최장(s) | HP 손실% | 별 |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of stages) L.push(`| ${s.code}${s.tag ? '(' + s.tag + ')' : ''} | ${s.attempt} | ${s.result} | ${s.hero || ''} | ${s.levelBefore ?? ''}→${s.levelAfter ?? ''} | ${s.powerRatio ?? ''} (${s.power ?? ''}/${s.recPower ?? ''}) | ${s.clearS ?? ''} | ${s.deaths ?? ''} | ${s.kills ?? ''} | ${s.longestDryS ?? ''} | ${s.hpLostPct ?? ''} | ${s.stars ?? ''} |`);
  L.push('', '## 레벨업', levelUps.map((u) => `${u.code}: Lv${u.from}→${u.to}`).join(' · ') || '없음', '', `레벨업 주기: 클리어 ${wins.length}스테이지 / 레벨업 ${levelUps.length}회 = ${rep.cadence.stagesPerLevelUp ?? '-'} 스테이지당 1회`, '');
  const gearActs = metaLog.flatMap((m) => m.acts.map((x) => ({ label: m.label, ...x })));
  const lastInv = metaLog.at(-1);
  L.push('## 장비·재화', `- UI 장비 교체(uiEquipBest) ${gearActs.filter((x) => x.kind === 'uiEquipBest').length}회 · 가방 정리(uiBagClean) ${gearActs.filter((x) => x.kind === 'uiBagClean').length}회 · UI가 놓친 추가 교체(equip) ${gearActs.filter((x) => x.kind === 'equip').length}회`,
    ...gearActs.filter((x) => ['uiEquipBest', 'uiBagClean', 'equip'].includes(x.kind)).map((x) => `  - ${x.label}: ${x.kind} ${x.power || x.bag || ''}${x.swaps ? ' (' + x.swaps + '곳)' : ''}`),
    lastInv ? `- 마지막 정비 시점: 골드 ${lastInv.gold?.[1]} · 보석 ${lastInv.gems} · 가방 ${lastInv.inv?.total}개 ${JSON.stringify(lastInv.inv?.byRarity)} · 안 낀 최선 장비 전투력 변화 ${JSON.stringify(lastInv.inv?.bestUnwornPowerDelta)}` : '', '');
  {
    // 골드 소비처: 장(章) 끝마다 보유 골드와 그때까지의 누적 소비
    const acc = { training: 0, enhance: 0, sure: 0 }, rows = [];
    for (const m of metaLog) { for (const k of Object.keys(acc)) acc[k] += m.spend?.[k] || 0; if (/-10$/.test(m.label) || m === metaLog.at(-1)) rows.push(`| ${m.label} | ${m.gold?.[1] ?? ''} | ${acc.training} | ${acc.enhance} | ${acc.sure} | ${m.inv?.worn?.join(' ') ?? ''} |`); }
    L.push('## 골드 소비처', '| 시점 | 보유 골드 | 누적 훈련 | 누적 일반 강화 | 누적 확정 강화 웃돈 | 착용 |', '|---|---|---|---|---|---|', ...rows, '');
  }
  L.push('## 마찰', ...friction.map((f) => `- ${JSON.stringify(f)}`), '', '## 합류', ...joins.map((j) => `- ${JSON.stringify(j)}`), ...newHeroTrials.map((j) => `- 첫 사용: ${JSON.stringify(j)}`), '', `## 콘솔 오류 ${errors.length}건`, ...errors.slice(0, 20).map((x) => `- ${x.t}`));
  writeFileSync(resolve(OUT, 'summary.md'), L.join('\n'));
  return rep;
}

try {
  await installAutoStarter(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 180000 });
  const ls0 = await page.evaluate(() => { try { return localStorage.length; } catch { return -1; } });
  log({ evt: 'boot', build, localStorageKeysBeforeStart: ls0 });
  await page.click('#boot-start', { force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  const heroSkills = Object.fromEntries(Object.entries(HEROES).map(([k, h]) => [k, (h.skills || []).map((s) => ({ id: s.id, name: s.name }))]));
  const itemSlot = Object.fromEntries(Object.entries(ITEM_BY_ID).map(([k, v]) => [k, v.slot]));
  const itemRarity = Object.fromEntries(Object.entries(ITEM_BY_ID).map(([k, v]) => [k, v.rarity]));
  const storyFirst = Object.fromEntries(STORY_EVENTS.map((ev) => [ev.id, ev.choices?.[0]?.id]));
  await page.evaluate(installCampaign, { seed: SEED, masteryNodes: MASTERY_NODES.map((n) => ({ id: n.id, name: n.name, cost: n.cost, tier: n.tier, path: n.path })), heroSkills, itemSlot, storyFirst, maxSec: MAX_SEC, pullEnabled: PULL, itemRarity, enhChance: Array.from({ length: ENH_MAX + 1 }, (_, lv) => lv >= ENH_MAX ? 0 : enhanceChance(lv)), enhMin: ENH_MIN, sureOn: SURE, sureReserve: SURE_RESERVE });
  const s0 = await page.evaluate(() => window.__C.state());
  log({ evt: 'fresh-state', ...s0 });
  const known = new Set(s0.owned);
  await doMeta('start');
  const fromI = codeIdx(FROM), toI = codeIdx(TO);
  let stop = false;
  for (let idx = fromI; idx <= toI && !stop && !aborted; idx++) {
    const code = idxCode(idx);
    // 합류한 새 동료가 있으면 이 스테이지를 한 번 그 영웅으로 써 본다(첫 사용 체감).
    const st0 = await page.evaluate(() => window.__C.state());
    const fresh = st0.owned.filter((h) => !known.has(h));
    for (const h of fresh) known.add(h);
    let trialWon = false;
    for (const h of fresh) {
      joins.push({ hero: h, beforeStage: code, level: st0.levels[h], mainHero: st0.hero, mainLevel: st0.levels[st0.hero], mainPower: st0.power });
      const sel = await page.evaluate((x) => { const ok = window.__C.select(x); return ok; }, h);
      if (!sel) { newHeroTrials.push({ hero: h, code, error: 'select failed' }); continue; }
      const eq = await page.evaluate((x) => window.__C.equipFree(x), h);
      const row = await playStage(code, 1, { tag: 'newhero-' + h });
      row.freeGearEquipped = eq.length; stages.push(row); log({ evt: 'stage', ...row });
      newHeroTrials.push({ hero: h, code, result: row.result, level: row.levelBefore, power: row.power, recPower: row.recPower, powerRatio: row.powerRatio, mainPower: st0.power, mainLevel: st0.levels[st0.hero], clearS: row.clearS, kills: row.kills, hpLostPct: row.hpLostPct, topDamage: row.topDamage, casts: row.casts, gear: eq.length });
      await page.evaluate((x) => window.__C.select(x), st0.hero);
      if (row.result === 'win') trialWon = true;
      writeReport();
    }
    if (trialWon) { await doMeta('after-newhero-' + code); continue; } // 그 영웅으로 이 스테이지를 이미 깼다
    let won = false, attempt = 0;
    while (attempt <= RETRIES && !won && !aborted) {
      attempt++;
      const row = await playStage(code, attempt);
      stages.push(row); log({ evt: 'stage', ...row });
      writeReport();
      if (row.result === 'win') { won = true; break; }
      if (row.result.startsWith('abort:') || row.result === 'start-failed') { friction.push({ kind: 'abort', at: code, attempt, result: row.result, softlock: row.softlock }); if (row.result === 'start-failed') break; }
      await doMeta(`after-loss-${code}-${attempt}`);
    }
    if (!won && !aborted) {
      // 벽: 사람이라면 앞 스테이지를 다시 돌아 골드·경험치를 모은 뒤 도전한다(최대 2회). 그래도 안 되면 멈춘다.
      friction.push({ kind: 'wall', at: code, attempts: attempt });
      log({ evt: 'wall', code, attempts: attempt });
      if (idx > 1) {
        for (let g = 1; g <= 2 && !aborted; g++) {
          const prev = idxCode(idx - 1), row = await playStage(prev, g, { tag: 'grind' });
          stages.push(row); log({ evt: 'stage', ...row }); await doMeta(`after-grind-${prev}-${g}`);
        }
        const row = await playStage(code, attempt + 1, { tag: 'post-grind' });
        stages.push(row); log({ evt: 'stage', ...row }); writeReport();
        won = row.result === 'win';
        if (won) friction.push({ kind: 'wall-cleared-by-grind', at: code });
      }
      if (!won) { stop = true; friction.push({ kind: 'stopped-at-wall', at: code }); }
    }
    if (won) await doMeta(`after-${code}`);
  }
  // 마지막 단계에서 새로 합류한 영웅(예: 3-10 클리어 → 도적)도 한 번 써 본다.
  if (!stop && !aborted) {
    const st0 = await page.evaluate(() => window.__C.state());
    const fresh = st0.owned.filter((h) => !known.has(h));
    for (const h of fresh) {
      known.add(h);
      joins.push({ hero: h, afterStage: TO, level: st0.levels[h], mainHero: st0.hero, mainLevel: st0.levels[st0.hero], mainPower: st0.power });
      if (!(await page.evaluate((x) => window.__C.select(x), h))) continue;
      const eq = await page.evaluate((x) => window.__C.equipFree(x), h);
      const row = await playStage(TO, 1, { tag: 'newhero-' + h });
      row.freeGearEquipped = eq.length; stages.push(row); log({ evt: 'stage', ...row });
      newHeroTrials.push({ hero: h, code: TO, result: row.result, level: row.levelBefore, power: row.power, recPower: row.recPower, powerRatio: row.powerRatio, mainPower: st0.power, mainLevel: st0.levels[st0.hero], clearS: row.clearS, kills: row.kills, hpLostPct: row.hpLostPct, topDamage: row.topDamage, casts: row.casts, gear: eq.length });
      await page.evaluate((x) => window.__C.select(x), st0.hero);
    }
  }
} catch (err) {
  aborted = 'exception: ' + String(err && err.stack || err).slice(0, 400);
  log({ evt: 'exception', err: aborted });
} finally {
  const rep = writeReport(true);
  log({ evt: 'done', out: OUT, wallMin: rep.wallMin, stages: stages.length, aborted });
  await br.close().catch(() => {}); srv.kill();
}
