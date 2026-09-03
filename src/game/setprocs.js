// 테마 세트 발동 효과 — 회전 8 에서 추가된 4세트 (서리결정 · 역병포자 · 룬각인 · 심연사슬)
// PRD §4-3: 세트 효과는 **플레이 방식을 바꿔야** 한다. 각 세트는 기존에 없던 동사를 하나씩 가진다.
//   서리 — 적을 얼려 부수고, 그 자리에 **얼음 기둥(지형)** 을 세운다      → 플레이어가 지형을 만든다
//   역병 — 죽인 자리에 구름이 남고, 그 안에서 죽이면 **전염되어 커진다**  → '어디서 죽이느냐'가 목표가 된다
//   룬   — 콤보로 **장전**하고 회피로 쏟아붓거나 아껴서 쿨타임을 지운다   → 자원 관리 축
//   사슬 — 락온한 적과 **사슬로 이어져** 있고 질주하면 감아 끌어온다      → 원을 그리는 새 이동 패턴
import * as THREE from 'three';
import { audio } from '../engine/audio.js';

const CAP = { pillars: 6, clouds: 5 };
const CRYSTAL_LOCKOUT = 8;    // 한 놈을 다시 결정화하기까지. 없으면 2세트만으로 방 전체가 영구 스턴이 된다
const FROST_DECAY = 3;        // 서리 중첩이 유지되는 시간. 없으면 90초 전에 스친 놈이 다음 한 대에 얼어붙는다
const CLOUD_LIFE = 10;        // 구름의 절대 수명. 처치로 갱신되지만 이 상한은 못 넘는다 (자가증식 차단)
const FROST_TINT = new THREE.Color(0.12, 0.3, 0.42);

export class SetProcs {
  constructor(game) {
    this.g = game;
    this.pillars = [];        // 서리 4세트: 얼음 기둥
    this.clouds = [];         // 역병 2세트: 포자 구름
    this.runes = 0;           // 룬 2세트: 장전
    this.runeMax = 6;
    this.tether = null;       // 사슬 2세트: {e, t}
    this.tickT = 0; this.lineT = 0;
    this.frostCd = new WeakMap();
    this.bloomed = 0; this.tetherHits = 0; this.crystals = 0; this.cloudsMade = 0; this.chainMax = 0;
  }
  has(n) { return this.g.hasProc(n); }
  /** HUD 게이지에 무엇을 띄울지 — 켜진 세트가 있을 때만 */
  gauge() {
    if (this.has('rune_charge')) return { n: this.runes, max: this.runeMax, color: '#ffc94a', label: '룬', full: this.runes >= this.runeMax && this.has('rune_overload') };
    if (this.has('plague_spore')) { const c = this.biggestCloud(); return { n: c ? Math.round(c.r) : 0, max: 8, color: '#9ade5a', label: '포자' }; }
    if (this.has('frost_pillar')) return { n: this.pillars.length, max: CAP.pillars, color: '#8fd8e8', label: '결정' };
    if (this.has('frost_shatter')) { let m = 0; for (const e of this.g.enemies) if (e.alive && e._frost > m) m = e._frost; return { n: m, max: 5, color: '#8fd8e8', label: '서리' }; }
    if (this.has('abyss_tether')) return { n: this.tether ? Math.max(1, this.tetherHits) : 0, max: 8, color: '#50f0d0', label: '사슬' };
    return null;
  }
  /** audio.shatter 는 매 호출마다 33k 샘플 노이즈를 만든다 — 한 프레임에 12마리가 얼면 프레임이 튄다 */
  shatterSfx(vol) { const t = this.g.elapsed; if (t - (this._shSfx || -9) < 0.14) return; this._shSfx = t; audio.shatter({ vol }); }
  biggestCloud() { let b = null; for (const c of this.clouds) if (!b || c.r > b.r) b = c; return b; }

  // ─────────────────────── 서리결정 ───────────────────────
  /** 2세트: 타격마다 서리 중첩, 5중첩에서 결정화(정지 + 받는 피해 30%↑) */
  frostStack(e) {
    if (!e.alive || e._crystal > 0) return;
    const now = this.g.elapsed;
    if ((this.frostCd.get(e) || 0) > now) return;     // 다단히트 한 번에 5중첩 되는 것 방지
    if ((e._crystalLock || 0) > now) return;          // 결정화 직후 재결정 금지
    this.frostCd.set(e, now + 0.12);
    e._frost = (e._frost || 0) + 1; e._frostT = FROST_DECAY;
    if (e._frost < 5) { if (e._frost >= 3) this.g.fx.embers(e.pos, 0x8fd8e8, { n: 2, radius: 0.5, life: 0.4, rise: 1.2 }); return; }
    e._frost = 0; e._crystal = 1.6; this.crystals++;
    e._crystalLock = now + CRYSTAL_LOCKOUT;
    e.stun = Math.max(e.stun, e.isBoss ? 0.45 : 1.6);
    e._preTint = e._preTint || e.tintEmissive || null;   // 엘리트/광폭화 틴트를 되돌려주기 위해 기억한다
    e.tintEmissive = FROST_TINT;
    this.g.fx.iceBurst(e.pos, { size: 2.6 * e.def.scale, life: 0.45 });
    this.g.fx.flash(e.pos.clone().setY(1.1 * e.def.scale), 0xbdf0ff, { size: 2.2, life: 0.2 });
    this.shatterSfx(0.28);
  }
  /** 결정 상태에서 죽으면 파편이 터진다. 4세트면 그 자리에 기둥이 선다 */
  frostDeath(e) {
    const at = e.pos.clone().setY(0);
    this.g.fx.iceBurst(at.clone().setY(0.9), { size: 5, life: 0.5 });
    this.g.fx.burst(at.clone().setY(1), 0xbdf0ff, { n: 20, speed: 10, size: 0.32 });
    this.g.hitRadius(at, 4.2, this.g.player.atk * 1.4, { kb: 7, kind: 'magic', slow: 2, dirFrom: at });
    this.shatterSfx(0.5); audio.play('hit_bell', { vol: 0.25, rate: 1.8 });
    if (!this.has('frost_pillar')) return;
    if (this.pillars.length >= CAP.pillars) this.shatterPillar(this.pillars.find((x) => !x.done));
    this.pillars.push({ pos: at.clone(), t: 6 });
    this.g.fx.groundTex(at, 'ice', 0x8fd8e8, { r0: 0.4, r1: 2.4, life: 6, spin: 0.2, y: 0.07, fadeIn: 0.2, hold: 5.2 });
    this.g.fx.texFlash(at, 'ice', 0xbdf0ff, { size: 4.2, life: 6, spin: 0, grow: 1.0, y: 1.4 });
  }
  shatterPillar(p) {
    if (!p || p.done) return; p.done = true;
    this.g.fx.iceBurst(p.pos.clone().setY(1), { size: 6, life: 0.5 });
    this.g.fx.shockTex(p.pos, 0x8fd8e8, { r1: 6, life: 0.45 });
    this.g.fx.burst(p.pos.clone().setY(1), 0xbdf0ff, { n: 26, speed: 12, size: 0.35 });
    this.g.hitRadius(p.pos, 5.5, this.g.player.atk * 1.8, { kb: 9, kind: 'magic', slow: 2.5, stun: 0.4, dirFrom: p.pos });
    this.shatterSfx(0.55); audio.boom({ vol: 0.3, dur: 0.25, low: 150 }); this.g.renderer.shake(0.25);
  }

  // ─────────────────────── 역병포자 ───────────────────────
  /** 2세트: 처치 자리에 포자 구름. 구름 안에서 죽이면 전염되어 커진다 */
  spore(e) {
    const at = e.pos.clone().setY(0);
    let host = null;
    for (const c of this.clouds) if (Math.hypot(c.pos.x - at.x, c.pos.z - at.z) < c.r) { host = c; break; }
    if (host) {
      host.r = Math.min(8, host.r + 0.7); host.chain++; if (host.chain > this.chainMax) this.chainMax = host.chain;
      // 처치로 수명이 갱신되지만 born 부터 CLOUD_LIFE 를 넘지 못한다.
      // 이 상한이 없으면 구름의 지속 피해가 스스로 적을 죽여 스스로를 먹여 살린다 (무한 자동 청소기)
      host.t = Math.min(5, host.born + CLOUD_LIFE - this.g.elapsed);
      host.pos.lerp(at, 0.25);
      this.g.fx.embers(at.clone().setY(0.4), 0x9ade5a, { n: 6, radius: 1.2, life: 0.9, rise: 2.2 });
      if (host.chain === 3) { this.g.ui.toast('역병이 번진다', 'gold'); audio.dark({ vol: 0.25, base: 180, dur: 0.4 }); }
      if (this.has('plague_bloom') && host.r >= 6) this.bloom(host);
      return;
    }
    if (this.clouds.length >= CAP.clouds) this.clouds[0].t = 0;   // 배열을 그 자리에서 건드리지 않는다 (update 가 순회 중일 수 있다)
    this.clouds.push({ pos: at, r: 3.2, t: 5, chain: 1, tick: 0, vis: 0, born: this.g.elapsed }); this.cloudsMade++;
    this.g.fx.dustPuff(at.clone().setY(0.5), { size: 4, life: 1.2, color: 0x9ade5a });
  }

  /** 4세트: 구름이 반경 6 을 넘으면 개화 — 폭발하고 작게 되돌아가 다시 자란다 */
  bloom(c) {
    if (c.blooming) return;
    c.blooming = true; this.bloomed++;
    this.g.fx.texFlash(c.pos.clone().setY(1.6), 'holy_burst', 0x9ade5a, { size: c.r * 2.2, life: 0.6, spin: 0.6, grow: 1.6, y: 1.6 });
    this.g.fx.explosion(c.pos, { size: c.r * 1.5, color: 0xb0ff70, life: 0.6 });
    this.g.fx.burst(c.pos.clone().setY(1.2), 0x9ade5a, { n: 44, speed: 13, size: 0.45, up: 1 });
    this.g.fx.shockTex(c.pos, 0xb0ff70, { r1: c.r * 1.6, life: 0.5 });
    this.g.hitRadius(c.pos, c.r, this.g.player.atk * 2.6, { kb: 8, kind: 'magic', poison: true, dirFrom: c.pos });
    this.g.renderer.shake(0.45); this.g.renderer.flashScreen(0.22, 0x9ade5a);
    audio.boom({ vol: 0.6, dur: 0.5, low: 70 }); audio.magic({ vol: 0.35, base: 260, notes: [0, 3, 7], step: 0.05, type: 'sawtooth' });
    this.g.ui.toast('역병 개화!', 'gold');
    c.t = 0;   // 개화하면 구름은 진다. 되돌려 놓으면 제 지속피해로 스스로를 다시 키운다
  }

  // ─────────────────────── 룬각인 ───────────────────────
  /** 2세트: 기본 콤보가 맞을 때마다 룬 1개 장전 */
  charge(n = 1) {
    if (!this.has('rune_charge') || this.runes >= this.runeMax) return;
    const before = this.runes;
    this.runes = Math.min(this.runeMax, this.runes + n);
    this.g.fx.embers(this.g.player.pos.clone().setY(1.2), 0xffc94a, { n: 3, radius: 0.7, life: 0.5, rise: 2.5 });
    if (before < this.runeMax && this.runes >= this.runeMax) {
      audio.play('ui_pluck', { vol: 0.4, rate: 1.6 });
      this.g.fx.holyBurst(this.g.player.pos, { size: 3.4, life: 0.35, color: 0xffc94a });
      if (this.has('rune_overload')) this.g.ui.toast('만장전 — 스킬이 과부하된다', 'gold');
    } else audio.play('ui_pluck', { vol: 0.16, rate: 1 + this.runes * 0.12 });
  }
  /** 2세트: 회피하면 장전된 룬이 전부 유도 참격으로 쏟아진다 */
  discharge(dir) {
    const n = this.runes; if (!n) return; this.runes = 0;
    const p = this.g.player, dmg = p.atk * 0.9;
    const pool = this.g.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < 15);
    for (let i = 0; i < n; i++) this.g.after(i * 0.07, () => {
      if (!this.g.active) return;
      let t = null;                                   // 룬마다 배열을 새로 만들지 않는다 (회피 한 번에 6번 할당)
      for (let k = 0; k < pool.length; k++) { const c = pool[(i + k) % pool.length]; if (c.alive) { t = c; break; } }
      const at = t ? t.pos.clone().setY(1.1 * t.def.scale) : p.pos.clone().addScaledVector(dir, 3 + i).setY(1.1);
      this.g.fx.slashSprite(at, dir, 0xffc94a, { size: 3.4, life: 0.26, tilt: (i % 2 ? 0.8 : -0.8) });
      this.g.fx.flash(at, 0xffe090, { size: 1.8, life: 0.14 });
      if (t) this.g.damageEnemy(t, dmg, { kb: 4, kind: 'slash', dirx: at.x - p.pos.x, dirz: at.z - p.pos.z, quietStop: i > 0 });
      audio.pick('hit_metal', 3, { vol: 0.22, rate: 1.2 + i * 0.08, min: 0.02 });
    });
    audio.whoosh({ vol: 0.4, pitch: 1.4, dur: 0.3 });
  }
  /** 4세트: 만장전에서 스킬을 쓰면 룬을 전부 태우고 그 스킬의 쿨타임을 지운다 */
  overload(i) {
    if (!this.has('rune_overload') || this.runes < this.runeMax) return false;
    this.runes = 0;
    const p = this.g.player;
    this.g.after(0.05, () => { if (this.g.active) p.cds[i] = 0; });
    this.g.fx.holyBurst(p.pos, { size: 8, life: 0.5, color: 0xffc94a });
    this.g.fx.groundTex(p.pos, 'circle_gold', 0xffc94a, { r0: 1, r1: 6, life: 0.7, spin: 2 });
    this.g.fx.burst(p.pos.clone().setY(1.2), 0xffe090, { n: 30, speed: 10, size: 0.4, up: 1 });
    this.g.renderer.flashScreen(0.25, 0xffd060); this.g.renderer.punch(0.4);
    this.g.ui.toast('과부하! 쿨타임 초기화', 'gold');
    audio.magic({ vol: 0.45, base: 660, notes: [0, 7, 12, 19], step: 0.04 }); audio.vibe([15, 10, 30]);
    return true;
  }

  // ─────────────────────── 심연사슬 ───────────────────────
  /** 2세트: 락온한 적과 사슬로 이어진다. 사슬 선에 닿는 적이 베인다 */
  tetherUpdate(dt) {
    const p = this.g.player;
    // 사슬은 **제 표적을 스스로 쥔다.** 락온(lockTarget)은 거리 11 에서 풀리는데, 거기에 얹으면
    // 조금만 벌어져도 사슬이 툭툭 끊긴다 — 살아 있고 17 안이면 계속 이어져 있어야 '이어져 있다'가 성립한다
    let t = this.tether && this.tether.e;
    if (t && (!t.alive || t.spawning || p.distTo(t) > 17)) { t = null; this.tether = null; this.tetherHits = 0; }
    const lock = (p.lockTarget && p.lockTarget.alive && !p.lockTarget.spawning) ? p.lockTarget : null;
    if (lock && lock !== t) t = null;                 // 락온을 바꾸면 사슬도 그리로 옮겨 간다
    if (!t) {
      const cand = lock || p.nearestEnemy(14);        // 락온이 없으면 가장 가까운 놈을 문다 — 세트는 항상 뭔가 해야 한다
      if (!cand) { this.tetherHits = 0; return; }
      t = cand; this.tether = { e: t, t: 0 }; audio.play('ui_pluck', { vol: 0.2, rate: 0.7 });
    }
    this.tether.t += dt;
    // 선 그리기 — 0.12초마다 한 번 (매 프레임 그리면 드로우콜이 튄다)
    this.lineT -= dt;
    if (this.lineT <= 0) {
      this.lineT = 0.1;
      this.g.fx.boltTex(p.pos.clone().setY(1.1), t.pos.clone().setY(1.0 * t.def.scale), 0x50f0d0, { life: 0.18, width: 1.8 });
      this.g.fx.embers(p.pos.clone().lerp(t.pos, 0.5).setY(1.0), 0x50f0d0, { n: 2, radius: 0.5, life: 0.4, rise: 0.6 });
    }
    // 선에 닿은 적에게 0.4초마다 피해
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = 0.4;
    const ax = p.pos.x, az = p.pos.z, bx = t.pos.x, bz = t.pos.z;
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
    let n = 0;
    // 표적 자신도 벤다 — '이어져 있다'면서 정작 문 놈만 멀쩡한 건 말이 안 된다
    this.g.damageEnemy(t, p.atk * 0.24, { kb: 0, kind: 'magic', quiet: true, quietStop: true, noProc: true });
    for (const e of this.g.enemies) {
      if (!e.alive || e.spawning || e === t) continue;
      let s = ((e.pos.x - ax) * vx + (e.pos.z - az) * vz) / L2;
      s = Math.max(0, Math.min(1, s));
      const cx = ax + vx * s, cz = az + vz * s;
      if (Math.hypot(e.pos.x - cx, e.pos.z - cz) > 1.4 + e.radius * 0.5) continue;
      this.g.damageEnemy(e, p.atk * 0.32, { kb: 1, kind: 'magic', slow: 0.8, dirx: e.pos.x - cx, dirz: e.pos.z - cz, quiet: n > 0, quietStop: true, noProc: true });
      if (++n >= 6) break;
    }
    this.tetherHits = n;
    if (n) audio.pick('hit_soft', 2, { vol: 0.16, rate: 0.8, min: 0.1 });
  }
  /** 4세트: 사슬이 걸린 채 회피하면 감아 끌어온다 — 원을 그리며 몹을 모으는 새 이동 패턴 */
  reel() {
    const th = this.tether; if (!th || !th.e.alive) return;
    const p = this.g.player, t = th.e;
    // 사슬에 걸린 놈들을 **회피를 시작한 순간의 선** 으로 잡아 둔다.
    // 대시가 끝난 뒤에 다시 재면 선이 이미 휘어 있어 아무도 안 걸린다 (실측: 0마리)
    const ax = p.pos.x, az = p.pos.z, vx = t.pos.x - ax, vz = t.pos.z - az, L2 = vx * vx + vz * vz || 1;
    const caught = [t];
    for (const e of this.g.enemies) {
      if (!e.alive || e.spawning || e === t) continue;
      let u = ((e.pos.x - ax) * vx + (e.pos.z - az) * vz) / L2; u = Math.max(0, Math.min(1.25, u));   // 표적 너머로도 조금 감긴다
      const cx = ax + vx * u, cz = az + vz * u;
      if (Math.hypot(e.pos.x - cx, e.pos.z - cz) > 3.0 + e.radius * 0.5) continue;
      caught.push(e);
      if (caught.length >= 12) break;
    }
    this.g.fx.boltTex(p.pos.clone().setY(1.1), t.pos.clone().setY(1.0 * t.def.scale), 0x7affe0, { life: 0.2, width: 2 });
    audio.play('hit_bell', { vol: 0.25, rate: 0.7 });
    // 대시(약 0.15초)가 끝난 뒤에 감는다 — 대시 시작점으로 끌면 내가 도망친 만큼 오히려 멀어진다
    this.g.after(0.16, () => { if (this.g.active) this._reelNow(caught); });
  }
  _reelNow(caught) {
    const p = this.g.player; let n = 0;
    // 그냥 끌어당기면 game.vacuum 의 리스킨이다 (PRD §5). 사슬은 **감긴다** —
    // 안쪽으로 당기는 힘에 회피 방향의 접선 힘을 얹어, 적이 나를 중심으로 휘돌아 한 덩어리로 뭉친다
    const dx0 = p.vel.x, dz0 = p.vel.z, vl = Math.hypot(dx0, dz0) || 1;
    const sx = -dz0 / vl, sz = dx0 / vl;   // 회피 방향의 수직 = 감기는 방향
    for (const e of caught) {
      if (!e.alive || e.spawning) continue;
      e.pull(p.pos.x, p.pos.z, 22);
      const side = ((e.pos.x - p.pos.x) * sx + (e.pos.z - p.pos.z) * sz) >= 0 ? 1 : -1;
      e.kb.x += sx * 15 * side; e.kb.z += sz * 15 * side;   // 접선 — 휘감는다
      e.slow = 0.5; e.slowT = 1.2; n++;
      this.g.fx.flash(e.pos.clone().setY(1.0 * e.def.scale), 0x50f0d0, { size: 1.6, life: 0.16 });
      this.g.fx.boltTex(p.pos.clone().setY(1.1), e.pos.clone().setY(1.0 * e.def.scale), 0x50f0d0, { life: 0.22, width: n === 1 ? 2.4 : 1 });
    }
    this.g.fx.groundTex(p.pos, 'shockwave', 0x50f0d0, { r0: 0.5, r1: 6, life: 0.4, spin: 1.5 });
    this.g.fx.embers(p.pos, 0x50f0d0, { n: 12, radius: 2, life: 0.7, rise: 2 });
    audio.suck({ vol: 0.4, dur: 0.5 }); this.g.renderer.shake(0.3);
    // 감아 온 뒤 한 번 더 끌어당겨 무리가 흩어지지 않게 (몹몰이 세트다)
    // 한 바퀴 돈 뒤 안쪽으로 조여 한 덩어리로 만든다
    if (n) this.g.after(0.3, () => { if (this.g.active) for (const e of caught) if (e.alive) e.pull(p.pos.x, p.pos.z, 20); });
  }

  // ─────────────────────── 훅 ───────────────────────
  onHit(e) { if (this.has('frost_shatter')) this.frostStack(e); }
  onComboHit(hits) { if (hits > 0) this.charge(1); }
  onDodge(dir) {
    if (this.has('rune_charge')) this.discharge(dir);
    if (this.has('abyss_reel')) this.reel();
  }
  onSkillCast(i, sk) { if (!sk.ult) return this.overload(i); return false; }
  onKill(e) {
    if (e._crystal > 0 && this.has('frost_shatter')) this.frostDeath(e);
    if (this.has('plague_spore')) this.spore(e);
  }
  /** 결정화된 적은 받는 피해가 늘어난다 */
  dmgMul(e) { return e._crystal > 0 ? 1.3 : 1; }

  update(dt) {
    const p = this.g.player; if (!p) return;
    // 결정/서리 중첩 지속
    if (this.has('frost_shatter')) for (const e of this.g.enemies) {
      if (e._crystal > 0) { e._crystal -= dt; if (e._crystal <= 0) { e._crystal = 0; e.tintEmissive = e._preTint || null; e._preTint = null; } }
      else if (e._frost > 0) { e._frostT -= dt; if (e._frostT <= 0) { e._frost--; e._frostT = FROST_DECAY; } }
    }
    // 얼음 기둥 — 적을 밀어내는 소프트 벽. 시간이 다하면 스스로 부서진다.
    // shatterPillar 안의 처치가 다시 frostDeath 를 불러 배열을 흔들 수 있으므로, 순회 중엔 표시만 하고 뒤에서 걸러낸다
    let deadPillar = false;
    for (const pl of this.pillars) {
      if (pl.done) { deadPillar = true; continue; }
      pl.t -= dt;
      for (const e of this.g.enemies) {
        if (!e.alive || e.spawning) continue;
        const dx = e.pos.x - pl.pos.x, dz = e.pos.z - pl.pos.z, d = Math.hypot(dx, dz);
        if (d > 2.0 || d < 0.01) continue;
        e.kb.x += dx / d * 108 * dt; e.kb.z += dz / d * 108 * dt;   // 밀어낸다
      }
      if (pl.t <= 0) { this.shatterPillar(pl); deadPillar = true; }
    }
    if (deadPillar) this.pillars = this.pillars.filter((x) => !x.done);
    // 포자 구름
    let deadCloud = false;
    for (const c of this.clouds) {
      if (c.t <= 0) { deadCloud = true; continue; }
      c.t -= dt; c.tick -= dt; c.vis -= dt;
      // 링을 주기적으로 다시 그린다 — 한 번만 그리면 자란 구름이 눈에 안 보이는 피해 장판이 된다
      if (c.vis <= 0 && c.t > 0) { c.vis = 1.4; this.g.fx.groundTex(c.pos, 'circle_gold', 0x9ade5a, { r0: c.r * 0.35, r1: c.r, life: 1.6, spin: 0.5, y: 0.06, fadeIn: 0.2, hold: 0.9 }); }
      if (c.tick <= 0) {
        c.tick = 0.6;
        // 많이 먹인 구름일수록 아프다 — '어디서 죽이느냐'가 보상이 되어야 성장 자체가 목표가 된다
        const dmg = p.atk * Math.min(0.6, 0.18 + c.chain * 0.03);
        let n = 0;
        for (const e of this.g.enemies) {
          if (!e.alive || e.spawning) continue;
          if (Math.hypot(e.pos.x - c.pos.x, e.pos.z - c.pos.z) > c.r) continue;
          this.g.damageEnemy(e, dmg, { kb: 0, kind: 'magic', quiet: n > 0, quietStop: true, slow: 0.8, noProc: true });
          if (++n >= 10) break;
        }
        if (c.r > 4) this.g.fx.embers(c.pos.clone().setY(0.3), 0x9ade5a, { n: 5, radius: c.r * 0.7, life: 1.1, rise: 1.6 });
      }
      if (c.t <= 0) deadCloud = true;
    }
    if (deadCloud) this.clouds = this.clouds.filter((c) => c.t > 0);
    if (this.has('abyss_tether')) this.tetherUpdate(dt);
  }
  clear() { this.pillars.length = 0; this.clouds.length = 0; this.runes = 0; this.tether = null; this.bloomed = 0; this.tetherHits = 0; this.crystals = 0; this.cloudsMade = 0; this.chainMax = 0; }
}
