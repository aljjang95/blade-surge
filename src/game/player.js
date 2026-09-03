import * as THREE from 'three';
import { Actor } from './actor.js';
import { audio } from '../engine/audio.js';
import { SKILLS } from './skills.js';

const _v = new THREE.Vector3();
const ALL_WEAPON_NODES = ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', 'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', '1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug'];

export class Player extends Actor {
  constructor(game, gltf, def, stats, skillLevels = [1, 1, 1, 1]) {
    super(game, gltf, { scale: 1.0 });
    this.def = def; this.stats = stats; this.skillLevels = skillLevels;
    this.maxHp = stats.hp; this.hp = stats.hp;
    this.setVisibleParts(def.show, ALL_WEAPON_NODES);
    this.state = 'idle'; this.stateT = 0;
    this.comboIdx = 0; this.comboQueued = false; this.hitDone = false; this.comboWindow = 0;
    this.cds = [0, 0, 0, 0]; this.ult = 0; this.ultMax = 100;
    this.buffs = { atk: 1, spd: 1, atkSpd: 1, t: 0 }; this.stormT = 0;
    this.auto = false; this.autoT = 0; this.magnetMul = 1;
    this.sprint = 0; this.sprintT = 0; this.lockTarget = null; this.perfectWindow = 0; this.perfectCd = 0;
    this.trail = null; this.current = null; this.skillCtx = null;
    this.moveDir = new THREE.Vector3();
    this.play('Idle');
    this.footT = 0;
  }
  get atk() { return this.stats.atk * this.buffs.atk * (this.game.hasProc?.('blood_rage') && this.hp < this.maxHp * 0.5 ? 1.5 : 1); }
  get busy() { return this.state === 'attack' || this.state === 'skill' || this.state === 'dodge' || this.state === 'ult' || this.state === 'hurt'; }
  addUlt(n) { this.ult = Math.min(this.ultMax, this.ult + n); }

  // ---------------- 입력 처리 ----------------
  handleInput(input, dt) {
    if (!this.alive) return;
    let mx = input.move.x, my = input.move.y;
    if (this.auto) { const m = this.autoMove(dt); mx = m.x; my = m.y; }
    // 카메라 기준 이동: 화면 위 = -z 방향
    this.moveDir.set(mx, 0, my);
    const wantMove = this.moveDir.lengthSq() > 0.01;

    // 회피
    if (input.consume('dodge') && this.state !== 'dodge' && this.state !== 'ult' && this.stun <= 0) return this.dodge(wantMove ? this.moveDir : null);
    // 스킬
    for (let i = 0; i < 4; i++) if (input.consume('skill' + i)) { if (this.tryCastSkill(i)) return; }
    // 공격
    if (input.consume('attack') || (input.attackHeld && this.state !== 'attack')) {
      if (this.state === 'attack') { if (this.hitDone) this.comboQueued = true; }
      else if (this.state === 'idle' || this.state === 'move') this.startCombo(0);
    }
    // 이동
    if (this.state === 'idle' || this.state === 'move') {
      if (wantMove) {
        // 계속 달리면 스프린트로 가속 (넓은 필드 이동 스트레스 완화)
        this.sprintT = Math.min(1.6, this.sprintT + dt);
        this.sprint = this.sprintT > 0.7 ? Math.min(1, (this.sprintT - 0.7) / 0.6) : 0;
        const spd = this.stats.spd * this.buffs.spd * (this.slow ? 0.5 : 1) * (1 + this.sprint * 0.45);
        this.vel.copy(this.moveDir).multiplyScalar(spd);
        this.faceDir(this.moveDir.x, this.moveDir.z);
        if (this.state !== 'move') { this.state = 'move'; this.play('Running_A', { fade: 0.15 }); }
        this.action.timeScale = (1.1 + this.sprint * 0.35) * this.buffs.spd;
        this.footT += dt;
        if (this.footT > (this.sprint > 0.5 ? 0.2 : 0.28)) { this.footT = 0; this.game.fx.dust(this.pos, { n: this.sprint > 0.5 ? 3 : 2, size: 0.6 + this.sprint * 0.4, life: 0.5, speed: 1 }); }
        if (this.sprint > 0.6 && Math.random() < dt * 8) this.game.fx.embers(this.pos, this.def.color, { n: 1, radius: 0.4, life: 0.35, size: 0.2, rise: 1 });
      } else {
        this.sprintT = Math.max(0, this.sprintT - dt * 3); this.sprint = 0;
        this.vel.set(0, 0, 0);
        if (this.state !== 'idle') { this.state = 'idle'; this.play('Idle', { fade: 0.2 }); }
      }
    }
  }
  nearestEnemy(maxDist = 99) {
    let best = null, bd = maxDist;
    for (const e of this.game.enemies) { if (!e.alive || e.spawning) continue; const d = this.distTo(e); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  autoAim(maxDist = 7) {
    // 이미 조준 중인 대상이 사거리 안이면 유지 (타겟 튐 방지 = 손맛)
    let e = (this.lockTarget && this.lockTarget.alive && this.distTo(this.lockTarget) < maxDist * 1.3) ? this.lockTarget : this.nearestEnemy(maxDist);
    if (e) { this.face(e.pos.x, e.pos.z); this.lockTarget = e; }
    return e;
  }

  // ---------------- 기본 콤보 ----------------
  startCombo(idx) {
    const c = this.def.combo[idx]; if (!c) return;
    this.state = 'attack'; this.stateT = 0; this.comboIdx = idx; this.comboQueued = false; this.hitDone = false; this.current = c;
    this.vel.set(0, 0, 0);
    const target = this.autoAim(this.def.ranged ? 12 : 7);
    const dur = c.dur / (this.buffs.atkSpd * (this.stormT > 0 ? 1.4 : 1));
    this.playTimed(c.anim, dur, { fade: 0.06 });
    // 근접이면 살짝 전진(러쉬감)
    if (!this.def.ranged) { const f = this.forward(_v); const d = target ? Math.max(0, Math.min(2.2, this.distTo(target) - 1.6)) : 0.6; this.vel.copy(f).multiplyScalar(d / Math.max(0.15, c.hitAt * dur)); }
    audio.whoosh({ vol: 0.35 + idx * 0.1, pitch: this.def.ranged ? 1.6 : 1 + idx * 0.15, dur: 0.22 });
    if (!this.def.ranged) this.startTrail();
  }
  startTrail() {
    if (this.trail) this.trail.stop();
    const hand = this.def.weapon === 'dual' ? 'handslot.r' : 'handslot.r'; const len = this.def.weapon === '2h' ? 1.6 : 1.2;
    this.trail = this.game.fx.trail(() => this.weaponPoints(hand, len), this.def.color, { segs: 14, life: 0.2 });
  }
  stopTrail() { if (this.trail) { this.trail.stop(); this.trail = null; } }
  doComboHit() {
    const c = this.current; const dmg = this.atk * c.dmg;
    const f = this.forward(_v.clone());
    if (c.projectile) {
      const spawn = this.pos.clone().add(f.clone().multiplyScalar(0.8)); spawn.y = 1.3;
      this.game.spawnProjectile({ pos: spawn, dir: f, speed: 22, radius: 0.7, dmg, color: this.def.color, size: c.projectile === 'bigbolt' ? 0.7 : 0.4, owner: this, kb: c.kb, kind: 'magic', pierce: c.projectile === 'bigbolt' });
      audio.magic({ vol: 0.2, base: 660, notes: [0, 7], step: 0.03 });
      this.game.fx.flash(spawn, this.def.color, { size: 1.2, life: 0.15 });
    } else {
      const hits = this.game.hitArea(this, this.pos, this.yaw, c.range, c.arc, dmg, { kb: c.kb, kind: 'slash', finisher: c.finisher });
      const gravity = this.game.hasProc('gravity_pull');
      if (gravity && !c.finisher) this.game.vacuum(this.pos.clone().addScaledVector(f, 1.5), 6, 5);   // 중력 2세트: 모든 타격이 끌어당긴다
      if (c.finisher && hits && this.game.hasProc('storm_chain')) this.game.stormChain(this.pos.clone().addScaledVector(f, c.range * 0.7), this.atk * 0.6);
      const tilt = this.comboIdx === 1 ? 0.7 : this.comboIdx === 2 ? -1.4 : -0.3;
      const sp = this.pos.clone().addScaledVector(f, c.range * 0.45).setY(1.15);
      this.game.fx.slashSprite(sp, f, this.def.color, { size: c.range * 1.7, life: c.finisher ? 0.32 : 0.22, tilt, flip: this.comboIdx % 2 === 1 });
      if (c.finisher) {
        // 마무리 타격: 살짝 몹몰이 + 충격파
        this.game.vacuum(this.pos.clone().addScaledVector(f, 1.5), gravity ? 11 : 5.5, gravity ? 16 : 8);
        this.game.fx.shockTex(this.pos.clone().addScaledVector(f, 1.2), this.def.color, { r1: 4.2, life: 0.35 });
        this.game.fx.explosion(this.pos.clone().addScaledVector(f, 1.6), { size: 3.2, color: this.def.accent, life: 0.35 });
        this.game.renderer.shake(0.35); this.game.fx.dustPuff(this.pos.clone().addScaledVector(f, 1.5), { size: 2.4, life: 0.5 });
      }
      if (!hits) audio.whoosh({ vol: 0.15, pitch: 1.8, dur: 0.12 });
    }
  }
  // ---------------- 회피 ----------------
  dodge(dir) {
    this.stopTrail(); this.state = 'dodge'; this.stateT = 0; this.invuln = 0.4;
    this.perfectWindow = 0.28;   // 이 안에 피격 판정이 스치면 퍼펙트
    const d = dir ? dir.clone().normalize() : this.forward(_v.clone());
    this.faceDir(d.x, d.z);
    this.vel.copy(d).multiplyScalar(19);
    this.play('Dodge_Forward', { once: true, fade: 0.05, speed: 1.6 });
    audio.whoosh({ vol: 0.5, pitch: 0.7, dur: 0.3 }); audio.vibe(15);
    this.game.fx.dust(this.pos, { n: 8, size: 1.2 });
    this.ghostT = 0;
    if (this.game.hasProc('storm_dash')) {   // 폭풍 4세트: 공속 버프 + 경로 낙뢰 2발
      this.stormT = 3; this.tintEmissive = new THREE.Color(0.1, 0.3, 0.5);
      for (let i = 1; i <= 2; i++) { const at = this.pos.clone().addScaledVector(d, i * 2.6); this.game.after(0.1 * i, () => this.game.stormStrike(at, this.atk * 0.8)); }
    }
  }
  // ---------------- 스킬 ----------------
  tryCastSkill(i) {
    const sk = this.def.skills[i]; if (!sk) return false;
    if (sk.ult) { if (this.ult < this.ultMax) { this.game.ui.toast('궁극기 게이지 부족', 'red'); audio.play('ui_error', { vol: 0.5 }); return false; } }
    else if (this.cds[i] > 0) return false;
    if (this.state === 'ult' || this.state === 'dodge' || this.stun > 0) return false;
    if (this.state === 'skill' && this.skillCtx && !this.skillCtx.done) return false;
    this.stopTrail();
    const impl = SKILLS[sk.id]; if (!impl) return false;
    if (sk.ult) { this.ult = 0; this.state = 'ult'; } else { this.cds[i] = sk.cd; this.state = 'skill'; }
    this.stateT = 0; this.vel.set(0, 0, 0);
    this.autoAim(12);
    const lvMult = 1 + (this.skillLevels[i] - 1) * 0.12;
    this.skillCtx = { sk, impl, t: 0, cast: false, done: false, dmg: this.atk * sk.dmg * lvMult, level: this.skillLevels[i], data: {} };
    if (sk.anim) this.playTimed(sk.anim, impl.dur || 0.8, { fade: 0.06 });
    if (sk.ult) { this.game.ultCinematic(sk, this); audio.charge({ vol: 0.35, dur: 0.7 }); audio.voice(`hero_${this.def.id}_ult`, { min: 8, duck: 0.5, dur: 1.6 }); if (this.game.hasProc('phoenix_burn')) this.game.after(0.35, () => this.game.phoenixBurn(this)); }
    else if (this.game.hasProc('gravity_hole')) { const t = this.lockTarget && this.lockTarget.alive ? this.lockTarget.pos.clone() : this.pos.clone().addScaledVector(this.forward(_v.clone()), 4); this.game.singularity(t); }
    impl.start?.(this.game, this, this.skillCtx);
    return true;
  }
  // ---------------- 피격 ----------------
  hurt(dmg, { dirx = 0, dirz = 0, kb = 2, kind = 'blunt' } = {}) {
    if (!this.alive) return false;
    if (this.invuln > 0) {
      // 회피 직후 스치면 퍼펙트 — 슬로우모 + 궁극기 게이지 + 반격 버프
      if (this.perfectWindow > 0 && this.perfectCd <= 0) {
        this.perfectWindow = 0; this.perfectCd = 1.2;
        this.game.onPerfectDodge(this);
      }
      return false;
    }
    const red = Math.max(1, dmg - this.stats.def * 0.5) * (1 - Math.min(0.6, this.stats.def / (this.stats.def + 400)));
    this.hp -= red;
    this.flash(0xff4040, 0.15);
    this.game.fx.damage(this.pos, red, { kind: 'self' });
    this.game.fx.burst(this.pos.clone().setY(1.2), 0xff5a5a, { n: 8, speed: 5, size: 0.3 });
    this.game.renderer.shake(0.3); this.game.renderer.flashScreen(0.18, 0xff2040); this.game.ui.hurtVignette();
    audio.hit('hurt'); audio.vibe([30, 20, 30]);
    this.knockback(dirx, dirz, kb);
    if (this.game.hasProc('blood_rage') && (this._bloodCd || 0) <= this.game.elapsed) { this._bloodCd = this.game.elapsed + 1.5; this.game.bloodBurst(this); }
    // 스킬/궁극기 중엔 슈퍼아머
    if (this.state !== 'skill' && this.state !== 'ult' && this.state !== 'dodge') { this.stopTrail(); this.state = 'hurt'; this.stateT = 0; this.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { once: true, fade: 0.05, speed: 1.6 }); }
    if (this.hp <= 0) { this.hp = 0; this.stopTrail(); this.state = 'dead'; this.die(); this.game.onPlayerDeath(); }
    return true;
  }
  revive() { this.alive = true; this.dead = false; this.deathT = -1; this.hp = this.maxHp; this.state = 'idle'; this.invuln = 2; this.pos.y = 0; for (const m of this.mats) m.transparent = false; this.play('Idle'); }

  // ---------------- 자동 전투 ----------------
  autoMove(dt) {
    const out = { x: 0, y: 0 };
    const list = this.game.enemies.filter((e) => e.alive && !e.spawning);
    if (!list.length) return this.autoExplore(dt);
    let hub = null, bestN = -1;
    for (const c of list) { let n = 0; for (const e of list) { const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z; if (dx * dx + dz * dz < 16) n += e.isBoss ? 5 : e.isElite ? 2 : 1; } const dist = this.distTo(c); const score = n - dist * 0.35; if (score > bestN) { bestN = score; hub = c; } }
    const e = hub || list[0];
    const d = this.distTo(e); const want = this.def.ranged ? 7 : 1.9;
    if (this.state === 'idle' || this.state === 'move') {
      // 스킬 우선: 적이 3마리 이상 뭉쳤을 때 광역기 우선
      const cluster = list.reduce((a, x) => a + (x.distTo(e) < 4.5 ? 1 : 0), 0);
      for (let i = 3; i >= 0; i--) {
        const sk = this.def.skills[i]; const ready = sk.ult ? this.ult >= this.ultMax : this.cds[i] <= 0;
        if (!ready) continue;
        const wantCluster = sk.ult ? 3 : i === 0 ? 1 : 2;
        if (cluster >= wantCluster && d < (this.def.ranged ? 11 : 8)) { this.game.input.press('skill' + i); return out; }
      }
      if (d > want + 0.4) {
        const W = this.game.world; const er = W && W.roomAt(e.pos.x, e.pos.z), pr = W && W.roomAt(this.pos.x, this.pos.z);
        const flow = (W && er && er !== pr) ? W.buildFlow(er.x, er.z) : null;   // 다른 방의 적: 직선은 벽에 박힌다
        const fd = flow && W.flowDir(flow, this.pos.x, this.pos.z);
        if (fd) { out.x = fd[0]; out.y = fd[1]; }
        else { const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1; out.x = dx / l; out.y = dz / l; }
      }
      else if (this.def.ranged && d < want - 3) { const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1; out.x = -dx / l; out.y = -dz / l; }
      else this.game.input.press('attack');
      // 예고 회피
      const threat = list.find((x) => x.telegraph > 0 && this.distTo(x) < 4);
      if (threat && Math.random() < dt * 3) this.game.input.press('dodge');
    } else if (this.state === 'attack' && this.hitDone && d < want + 1.5) this.game.input.press('attack');   // 사거리 밖(물러서는 원거리 몹)이면 콤보를 끊고 이동으로 돌아간다 — 안 끊으면 허공 콤보가 영원히 이어진다
    return out;
  }
  /** 적이 없으면 다음 목표 방으로 이동 (보스 발견 시 보스방 우선) */
  autoExplore(dt) {
    const out = { x: 0, y: 0 };
    const g = this.game, W = g.world; if (!W) return out;
    let target = g.autoTarget;
    if (!target || target.cleared) {
      const cands = W.rooms.filter((r) => !r.cleared);
      if (!cands.length) return out;
      // 보스방을 찾았으면 보스 우선, 아니면 가장 가까운 미클리어 방
      const boss = W.bossRoom;
      target = (boss && !boss.cleared && boss.discovered) ? boss
        : cands.sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z))[0];
      g.autoTarget = target;
    }
    const flow = W.buildFlow(target.x, target.z);
    const d = W.flowDir(flow, this.pos.x, this.pos.z);
    if (d) { out.x = d[0]; out.y = d[1]; }
    else { const dx = target.x - this.pos.x, dz = target.z - this.pos.z, l = Math.hypot(dx, dz) || 1; out.x = dx / l; out.y = dz / l; }
    return out;
  }

  // ---------------- 업데이트 ----------------
  update(dt) {
    super.update(dt);
    if (this.perfectWindow > 0) this.perfectWindow -= dt;
    if (this.stormT > 0) { this.stormT -= dt; this.game.fx.aura(this.pos, 0x7fd9ff, 1.5); if (this.stormT <= 0 && this.buffs.t <= 0) this.tintEmissive = null; }
    if (this.perfectCd > 0) this.perfectCd -= dt;
    // 락온: 조준 대상이 계속 바뀌지 않도록 유지
    if (this.lockTarget && (!this.lockTarget.alive || this.distTo(this.lockTarget) > 11)) this.lockTarget = null;
    for (let i = 0; i < 4; i++) if (this.cds[i] > 0) this.cds[i] = Math.max(0, this.cds[i] - dt);
    if (this.buffs.t > 0) { this.buffs.t -= dt; this.game.fx.aura(this.pos, 0xff3030, 2); if (this.buffs.t <= 0) { this.buffs.atk = 1; this.buffs.spd = 1; this.buffs.atkSpd = 1; this.tintEmissive = null; } }
    if (!this.alive) return;
    this.stateT += dt;
    if (this.state === 'attack') {
      const c = this.current; const dur = c.dur / (this.buffs.atkSpd * (this.stormT > 0 ? 1.4 : 1)); const t = this.stateT / dur;
      if (!this.hitDone && t >= c.hitAt) { this.hitDone = true; this.doComboHit(); this.vel.multiplyScalar(0.2); }
      if (this.hitDone && this.trail && t >= c.hitAt + 0.25) this.stopTrail();
      if (this.hitDone) this.vel.multiplyScalar(Math.pow(0.001, dt));
      // 콤보 연계 창: hitAt 이후 ~ 끝
      if (this.hitDone && this.comboQueued && t >= c.hitAt + 0.18) { const next = this.comboIdx + 1; if (next < this.def.combo.length) { this.startCombo(next); return; } }
      if (t >= 1) { this.stopTrail(); this.state = 'idle'; this.play('Idle', { fade: 0.2 }); this.vel.set(0, 0, 0); if (this.comboQueued || this.game.input.attackHeld) this.startCombo(0); }
    } else if (this.state === 'dodge') {
      this.ghostT += dt; if (this.ghostT > 0.05) { this.ghostT = 0; this.game.fx.ghost(this.model, this.def.color, { life: 0.3, opacity: 0.5 }); }
      this.vel.multiplyScalar(Math.pow(0.02, dt));
      if (this.stateT > 0.32) { this.state = 'idle'; this.vel.set(0, 0, 0); this.play('Idle', { fade: 0.15 }); }
    } else if (this.state === 'hurt') {
      this.vel.set(0, 0, 0);
      if (this.stateT > 0.32) { this.state = 'idle'; this.play('Idle', { fade: 0.15 }); }
    } else if (this.state === 'skill' || this.state === 'ult') {
      const c = this.skillCtx; c.t += dt;
      const castT = (c.impl.dur || 0.8) * c.sk.castAt;
      if (!c.cast && c.t >= castT) { c.cast = true; c.impl.cast?.(this.game, this, c); }
      c.impl.update?.(this.game, this, c, dt);
      if (c.t >= (c.impl.total || c.impl.dur || 0.8)) { c.done = true; c.impl.end?.(this.game, this, c); this.state = 'idle'; this.vel.set(0, 0, 0); this.stopTrail(); this.play('Idle', { fade: 0.2 }); }
    }
  }
}
