import * as THREE from 'three';
import { Actor } from './actor.js';
import { audio } from '../engine/audio.js';
import { SKILLS } from './skills.js';
import { applyLook } from './look.js';

const _v = new THREE.Vector3();

export class Player extends Actor {
  constructor(game, gltf, def, stats, skillLevels = [1, 1, 1, 1], equip = {}) {
    super(game, gltf, { scale: 1.0 });
    this.def = def; this.stats = stats; this.skillLevels = skillLevels;
    this.maxHp = stats.hp; this.hp = stats.hp;
    this.look = applyLook(this.model, def, equip);   // 장비 외형: 무기/방패 메시 + 등급 발광 + 궤적색
    this.auraT = 0;
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
    audio.preloadBarks([0, 1, 2, 3].map((i) => `hero_${def.id}_atk${i}`).concat([0, 1].map((i) => `hero_${def.id}_fin${i}`), [0, 1, 2].map((i) => `hero_${def.id}_hurt${i}`), [0, 1, 2].map((i) => `hero_${def.id}_skill${i}`), [`hero_${def.id}_perfect`]));
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
    // 선입력: 콤보 중 누르거나 '누르고 있으면' 다음 타 예약. 이전엔 hitDone 뒤의 '탭'만 받아서 — 버튼을 누르고 있는 사람은 영원히 1타만 반복했다 (끊기는 느낌의 진범)
    if (input.consume('attack') || input.attackHeld) {
      if (this.state === 'attack') this.comboQueued = true;
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
    if (idx === 0 && this.comboResume && this.comboResume.t > 0) { idx = this.comboResume.idx; this.comboResume = null; }
    const c = this.def.combo[idx]; if (!c) return;
    this.state = 'attack'; this.stateT = 0; this.comboIdx = idx; this.comboQueued = false; this.hitDone = false; this.current = c;
    this.vel.set(0, 0, 0);
    const target = this.autoAim(this.def.ranged ? 12 : 7);
    const dur = c.dur / (this.buffs.atkSpd * (this.stormT > 0 ? 1.4 : 1));
    this.playTimed(c.anim, dur, { fade: 0.06 });
    this.ticksLeft = c.ticks ? c.ticks - 1 : 0; this.nextTick = 0; this.through = null;
    const f = this.forward(_v);
    if (c.move === 'lunge') {
      // 돌진: 대상까지(없으면 절반) 타격 시점에 도착. through 면 적을 뚫고 지나가 뒤에서 벤다 (도적)
      const dist = target ? Math.max(1, Math.min(c.lunge, this.distTo(target) - (c.through ? -1.6 : 1.3))) : c.lunge * 0.5;
      this.vel.copy(f).multiplyScalar(dist / Math.max(0.12, c.hitAt * dur)); this.invuln = Math.max(this.invuln, c.through ? c.hitAt * dur + 0.1 : 0);
      this.game.fx.dust(this.pos, { n: 5, size: 1 }); if (c.through) this.ghostT = 0;
    } else if (c.move === 'slam') {
      const dist = target ? Math.max(0, Math.min(4, this.distTo(target) - 1.5)) : 1.5;
      this.vel.copy(f).multiplyScalar(dist / Math.max(0.15, c.hitAt * dur));
      this.game.fx.ring(this.pos.clone().addScaledVector(f, dist), this.def.color, { r0: c.range - 0.3, r1: c.range + 0.2, life: c.hitAt * dur, y: 0.06, width: 1 });   // 착지 예고
    } else if (c.move === 'spin') {
      this.game.vacuum(this.pos.clone(), c.range + 1.5, 7);   // 회전베기: 먼저 끌어모은다
      this.vel.copy(f).multiplyScalar(0.8);
    } else if (!this.def.ranged) { const d = target ? Math.max(0, Math.min(2.2, this.distTo(target) - 1.6)) : 0.6; this.vel.copy(f).multiplyScalar(d / Math.max(0.15, c.hitAt * dur)); }   // 근접이면 살짝 전진(러쉬감)
    audio.whoosh({ vol: 0.35 + idx * 0.08, pitch: this.def.ranged ? 1.6 : (c.move === 'slam' ? 0.6 : 1 + idx * 0.12), dur: c.move === 'spin' ? 0.4 : 0.22 });
    // 기합 — 던파식. 마무리 타는 항상, 일반 타는 확률로 (매 타마다 지르면 시끄럽다)
    const V = `hero_${this.def.id}_`;
    if (c.finisher) audio.bark(V + 'fin', { n: 2, vol: 0.95, min: 0.6 });
    else if (c.move || Math.random() < 0.45) audio.bark(V + 'atk', { n: 4, vol: 0.75, min: 0.35 });
    if (!this.def.ranged) this.startTrail();
  }
  startTrail() {
    if (this.trail) this.trail.stop();
    const hand = this.def.weapon === 'dual' ? 'handslot.r' : 'handslot.r'; const len = this.def.weapon === '2h' ? 1.6 : 1.2;
    this.trail = this.game.fx.trail(() => this.weaponPoints(hand, len), this.look.trailColor, { segs: 14, life: 0.2 });
  }
  stopTrail() { if (this.trail) { this.trail.stop(); this.trail = null; } }
  doComboHit(tick = 0) {
    const c = this.current; const dmg = this.atk * c.dmg;
    const f = this.forward(_v.clone());
    const gravity = this.game.hasProc('gravity_pull');
    if (c.move === 'fan') {   // 부채꼴 3발
      for (let i = -1; i <= 1; i++) { const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.3); const spawn = this.pos.clone().add(dir.clone().multiplyScalar(0.8)); spawn.y = 1.3; this.game.spawnProjectile({ pos: spawn, dir, speed: 20, radius: 0.6, dmg, color: this.def.color, size: 0.4, owner: this, kb: c.kb, kind: 'magic' }); }
      audio.magic({ vol: 0.25, base: 520, notes: [0, 4, 7], step: 0.03 }); this.game.fx.flash(this.pos.clone().addScaledVector(f, 0.8).setY(1.3), this.def.color, { size: 1.6, life: 0.15 });
      return;
    }
    if (c.move === 'nova') {   // 노바: 끌어모아 터뜨린다
      this.game.vacuum(this.pos.clone(), c.range + 2, gravity ? 14 : 9);
      const hits = this.game.hitRadius(this.pos, c.range, dmg, { kb: c.kb, kind: 'magic', finisher: true });
      this.game.fx.holyBurst(this.pos, { size: c.range * 2.4, life: 0.45, color: this.def.accent }); this.game.fx.shockTex(this.pos, this.def.color, { r1: c.range * 1.6, life: 0.4 }); this.game.fx.ring(this.pos, this.def.color, { r0: 0.5, r1: c.range + 1, life: 0.35, vertical: false });
      this.game.renderer.shake(0.4); audio.magic({ vol: 0.4, base: 330, notes: [0, 7, 12], step: 0.04 }); audio.boom({ vol: 0.4, dur: 0.4, low: 90 });
      if (!hits) audio.whoosh({ vol: 0.15, pitch: 1.8, dur: 0.12 });
      return;
    }
    if (c.move === 'slam') {   // 도약 강타: 착지점 반경
      const cpos = this.pos.clone().addScaledVector(f, 0.8);
      const hits = this.game.hitRadius(cpos, c.range, dmg, { kb: c.kb, kind: 'blunt', finisher: true });
      this.game.fx.shockTex(cpos, this.def.color, { r1: c.range * 1.5, life: 0.45 }); this.game.fx.dustPuff(cpos, { size: c.range * 1.2, life: 0.6 }); this.game.fx.explosion(cpos, { size: 4, color: this.def.accent, life: 0.4 }); this.game.fx.burst(cpos.clone().setY(0.4), this.def.color, { n: 20, speed: 8, size: 0.4 });
      this.game.renderer.shake(0.7); this.game.renderer.punch(0.5); audio.boom({ vol: 0.7, dur: 0.5, low: 55 }); audio.vibe(30);
      if (hits && this.game.hasProc('storm_chain')) this.game.stormChain(cpos, this.atk * 0.6);
      return;
    }
    if (c.move === 'spin') {   // 회전베기: 360°, ticks 연타
      const hits = this.game.hitArea(this, this.pos, this.yaw, c.range, 360, dmg, { kb: c.kb, kind: 'slash', quietStop: tick > 0 });
      this.game.fx.slashArc(this.pos, this.yaw + tick * 2.1, this.def.color, { radius: c.range + 0.3, arc: 300, height: 1.1, life: 0.22, thickness: 0.6 });
      this.game.fx.dust(this.pos, { n: 4, size: 1.2 });
      if (tick === 0 || gravity) this.game.vacuum(this.pos.clone(), c.range + 1.5, gravity ? 10 : 5);
      audio.whoosh({ vol: 0.3, pitch: 1.1 + tick * 0.15, dur: 0.18 });
      if (!hits) audio.whoosh({ vol: 0.12, pitch: 1.8, dur: 0.1 });
      return;
    }
    if (c.projectile) {
      const spawn = this.pos.clone().add(f.clone().multiplyScalar(0.8)); spawn.y = 1.3;
      this.game.spawnProjectile({ pos: spawn, dir: f, speed: 22, radius: 0.7, dmg, color: this.def.color, size: c.projectile === 'bigbolt' ? 0.7 : 0.4, owner: this, kb: c.kb, kind: 'magic', pierce: c.projectile === 'bigbolt' });
      audio.magic({ vol: 0.2, base: 660, notes: [0, 7], step: 0.03 });
      this.game.fx.flash(spawn, this.def.color, { size: 1.2, life: 0.15 });
    } else {
      const hits = this.game.hitArea(this, this.pos, this.yaw, c.range, c.arc, dmg, { kb: c.kb, kind: 'slash', finisher: c.finisher });
      if (c.through) { this.game.fx.ghost(this.model, this.def.color, { life: 0.3, opacity: 0.5 }); this.game.fx.slashArc(this.pos, this.yaw, this.def.color, { radius: c.range, arc: 300, height: 1, life: 0.2 }); }   // 관통: 지나온 자리에 잔상
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
    if (!sk.ult) audio.bark(`hero_${this.def.id}_skill${i}`, { vol: 0.95, min: 1.5 });   // 스킬 이름 외침
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
    // 비율 경감만. 정액 차감(dmg - def*0.5)은 레벨 1 방어 40 이 1층 잡몹 공격 18 을 통째로 먹어 모든 피격이 1 이 됐다 (hitTakenRatio 0 의 진범)
    const red = Math.max(1, Math.round(dmg * (1 - Math.min(0.6, this.stats.def / (this.stats.def + 250)))));
    this.hp -= red;
    this.flash(0xff4040, 0.15);
    this.game.fx.damage(this.pos, red, { kind: 'self' });
    this.game.fx.burst(this.pos.clone().setY(1.2), 0xff5a5a, { n: 8, speed: 5, size: 0.3 });
    this.game.renderer.shake(0.3); this.game.renderer.flashScreen(0.18, 0xff2040); this.game.ui.hurtVignette();
    audio.hit('hurt'); audio.vibe([30, 20, 30]); audio.bark(`hero_${this.def.id}_hurt`, { n: 3, vol: 0.8, min: 0.7 });
    this.knockback(dirx, dirz, kb);
    if (this.game.hasProc('blood_rage') && (this._bloodCd || 0) <= this.game.elapsed) { this._bloodCd = this.game.elapsed + 1.5; this.game.bloodBurst(this); }
    // 스킬/궁극기 중엔 슈퍼아머. 기본 콤보 중에도 경타(kb<6)는 끊지 못한다 — 무리 속에서 잡몹 한 대마다 콤보가 1타로 돌아가던 것이 '끊김'의 절반
    const armored = this.state === 'skill' || this.state === 'ult' || this.state === 'dodge' || (this.state === 'attack' && kb < 6);
    if (!armored) {
      if (this.state === 'attack') { this.comboResume = { idx: Math.min(this.comboIdx + 1, this.def.combo.length - 1), t: 1.2 }; }   // 강타에 끊겨도 1.2초 안에 다시 누르면 이어서
      this.stopTrail(); this.state = 'hurt'; this.stateT = 0; this.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { once: true, fade: 0.05, speed: 1.6 });
    }
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
    } else if (this.state === 'attack' && d < want + 2.5) this.game.input.press('attack');   // 사거리 밖(물러서는 원거리 몹)이면 콤보를 끊고 이동으로 돌아간다 — 안 끊으면 허공 콤보가 영원히 이어진다
    // 예고 회피 — 콤보 중에도 타격이 끝났으면 캔슬해서 구른다. 보스·엘리트의 큰 예고는 거의 확실히, 잡몹은 절반쯤 (적 위협 회전: 콤보 중 회피 불가라 보스전에서 HP 의 30% 를 그냥 맞았다)
    if (this.state === 'idle' || this.state === 'move' || (this.state === 'attack' && this.hitDone)) {
      const threat = list.find((x) => x.telegraph > 0 && this.distTo(x) < (x.isBoss ? 5.5 : x.isElite ? 5 : 4));
      if (threat && Math.random() < dt * (threat.isBoss || threat.isElite ? 9 : 3)) this.game.input.press('dodge');
    }
    return out;
  }
  /** 적이 없으면 다음 목표 방으로 이동 (보스 발견 시 보스방 우선) */
  autoExplore(dt) {
    const out = { x: 0, y: 0 };
    const g = this.game, W = g.world; if (!W) return out;
    if (g.portal) { const dx = g.portal.pos.x - this.pos.x, dz = g.portal.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1; out.x = dx / l; out.y = dz / l; return out; }   // 봉인 해제 포탈 → 보스방 앞
    let target = g.autoTarget;
    if (!target || target.cleared) {
      const cands = W.rooms.filter((r) => !r.cleared && !(W.sealed && r === W.bossRoom));   // 봉인된 보스방은 못 들어간다
      if (!cands.length) return out;
      // 봉인이 풀린 보스방을 찾았으면 보스 우선, 아니면 가장 가까운 미클리어 방
      const boss = W.bossRoom;
      target = (boss && !boss.cleared && boss.discovered && !W.sealed) ? boss
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
    if (this.comboResume) { this.comboResume.t -= dt; if (this.comboResume.t <= 0) this.comboResume = null; }
    if (this.look.aura && this.alive) { this.auraT -= dt; if (this.auraT <= 0) { this.auraT = this.look.enhMax >= 15 ? 0.12 : 0.22; this.game.fx.aura(this.pos, this.look.aura, 1); } }   // +10 이상 강화: 잔불 오라
    // 락온: 조준 대상이 계속 바뀌지 않도록 유지
    if (this.lockTarget && (!this.lockTarget.alive || this.distTo(this.lockTarget) > 11)) this.lockTarget = null;
    for (let i = 0; i < 4; i++) if (this.cds[i] > 0) this.cds[i] = Math.max(0, this.cds[i] - dt);
    if (this.buffs.t > 0) { this.buffs.t -= dt; this.game.fx.aura(this.pos, 0xff3030, 2); if (this.buffs.t <= 0) { this.buffs.atk = 1; this.buffs.spd = 1; this.buffs.atkSpd = 1; this.tintEmissive = null; } }
    if (!this.alive) return;
    this.stateT += dt;
    if (this.state === 'attack') {
      const c = this.current; const dur = c.dur / (this.buffs.atkSpd * (this.stormT > 0 ? 1.4 : 1)); const t = this.stateT / dur;
      if (!this.hitDone && t >= c.hitAt) { this.hitDone = true; this.doComboHit(0); if (c.move !== 'spin') this.vel.multiplyScalar(c.move === 'lunge' ? 0.35 : 0.2); this.nextTick = c.hitAt + (1 - c.hitAt) / (c.ticks || 1); }
      if (this.hitDone && this.ticksLeft > 0 && t >= this.nextTick) { this.ticksLeft--; this.doComboHit((c.ticks || 1) - this.ticksLeft - 1); this.nextTick += (1 - c.hitAt) / (c.ticks || 1); }   // 회오리 연타
      if (c.through && this.ghostT !== undefined) { this.ghostT += dt; if (this.ghostT > 0.06 && !this.hitDone) { this.ghostT = 0; this.game.fx.ghost(this.model, this.def.color, { life: 0.25, opacity: 0.4 }); } }
      if (this.hitDone && this.trail && t >= c.hitAt + 0.25 && !this.ticksLeft) this.stopTrail();
      if (this.hitDone && c.move !== 'spin') this.vel.multiplyScalar(Math.pow(0.001, dt));
      // 콤보 연계 창: 타격 직후부터 (0.18 → 0.1: 타 사이 공백이 '끊김'으로 읽혔다). 연타 중엔 마지막 tick 뒤
      const chainAt = c.ticks ? this.nextTick - 0.02 : c.hitAt + 0.1;
      if (this.hitDone && this.comboQueued && !this.ticksLeft && t >= chainAt) { const next = this.comboIdx + 1; if (next < this.def.combo.length) { this.startCombo(next); return; } else if (t >= c.hitAt + 0.3) { this.startCombo(0); return; } }   // 마무리 뒤에도 idle 을 거치지 않고 1타로
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
