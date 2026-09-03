import * as THREE from 'three';
import { Actor } from './actor.js';
import { getPart } from '../engine/assets.js';
import { audio } from '../engine/audio.js';
import { rigOf, RIGS } from '../data/rigs.js';

const _v = new THREE.Vector3();

export class Enemy extends Actor {
  constructor(game, gltf, weaponsGltf, def, scaleMult, pos) {
    const rig = rigOf(def.model);
    super(game, gltf, { scale: def.scale * (RIGS[rig].scale || 1), tint: def.tint || (def.boss ? '#ffb0b0' : null), rig });
    this.def = def; this.type = def.name; this.isBoss = !!def.boss; this.isElite = !!def.elite;
    this.maxHp = Math.floor(def.hp * scaleMult); this.hp = this.maxHp; this.atk = def.atk * Math.pow(scaleMult, 0.7);
    this.pos.copy(pos); this.face(0, 0);
    // 무기 장착
    if (this.rigName === 'kaykit') {
      if (def.weapon) { const w = getPart(weaponsGltf, def.weapon); const h = this.node('handslot.r'); if (h) h.add(w); }
      if (def.shield) { const s = getPart(weaponsGltf, def.shield); const h = this.node('handslot.l'); if (h) h.add(s); }
      if (/자객|암살|사신/.test(def.name)) { const w = getPart(weaponsGltf, 'Skeleton_Blade'); const h = this.node('handslot.l'); if (h) h.add(w); }
    }
    // 눈 발광
    this.model.traverse((o) => { if (o.isMesh && /Eyes/.test(o.name)) { o.material.emissive = new THREE.Color(def.boss ? 0xff2020 : def.elite ? 0xffc040 : 0x40ff80); o.material.emissiveIntensity = 2.5; this.eyeMat = o.material; } });
    this.mats = this.mats.filter((m) => m !== this.eyeMat);
    if (def.elite) this.tintEmissive = new THREE.Color(0.06, 0.04, 0.0);
    if (def.ghostly) { for (const m of this.mats) { m.transparent = true; m.opacity = 0.8; m.depthWrite = false; } this.tintEmissive = new THREE.Color(0.18, 0.34, 0.5); }
    this.state = 'spawn'; this.stateT = 0; this.spawning = true; this.telegraph = 0;
    this.atkCd = 0.6 + Math.random() * 1.2; this.hitAt = 0.5; this.attackDur = def.atkTime; this.attackDone = false;
    this.stagger = 0; this.poison = 0; this.poisonT = 0; this.phase = 0; this.enraged = false; this.special = null;
    this.radius = 0.7 * def.scale;
    if (this.has('spawn')) { this.play(this.A('spawn'), { once: true, fade: 0, speed: 1.7 }); this.spawnLen = (this.clips[this.A('spawn')]?.duration || 1) / 1.7; }
    else { this.play(this.A('idle'), { fade: 0 }); this.spawnLen = 0.42; this.popIn = 0; this.model.scale.setScalar(0.01); }
    game.fx.dust(pos, { n: def.boss ? 20 : 5, size: 1.4 });
    if (def.boss) { game.fx.castCircle(pos, 0xff3030, { radius: 4.5, life: 1.6, demon: true }); game.fx.firePillar(pos, { height: 9, width: 3, life: 1.4, color: 0xff5050 }); }
    else if (def.elite) game.fx.groundTex(pos, 'shockwave', 0xffc040, { r0: 0.3, r1: 3.5, life: 0.6 });
    else game.fx.ring(pos, 0x40ff80, { r0: 0.2, r1: 2, life: 0.4 });
    audio.spawnRise({ vol: def.boss ? 0.5 : def.elite ? 0.35 : 0.14, boss: !!def.boss });
    // 엘리트/보스는 발밑 마커로 난전 중에도 식별
    if (def.elite || def.boss) {
      const col = def.boss ? 0xff3040 : 0xffc040;
      const mk = new THREE.Mesh(new THREE.RingGeometry(def.boss ? 1.5 : 0.95, def.boss ? 1.9 : 1.25, 28),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      mk.rotation.x = -Math.PI / 2; mk.position.y = 0.07; mk.renderOrder = 3;
      this.root.add(mk); this.marker = mk;
    }
  }
  get player() { return this.game.player; }
  /** 몹몰이: 중심으로 끌어당김 */
  pull(cx, cz, force) { const dx = cx - this.pos.x, dz = cz - this.pos.z; const d = Math.hypot(dx, dz) || 1; if (d < 0.8) return; const f = force * (this.isBoss ? 0.15 : this.isElite ? 0.5 : 1); this.kb.x += dx / d * f; this.kb.z += dz / d * f; }
  hurt(dmg, { crit = false, dirx = 0, dirz = 0, kb = 2, stun = 0, kind = 'slash', up = false, slow = 0, poison = false } = {}) {
    if (!this.alive || this.spawning) return 0;
    if (this.def.dodge && Math.random() < this.def.dodge && this.state === 'chase' && !this.stun) {
      this.play(this.A('dodge'), { once: true, fade: 0.05, speed: 1.5 }); this.state = 'dodge'; this.stateT = 0; this.kb.set(-dirx, 0, -dirz).normalize().multiplyScalar(-8);
      this.game.fx.damage(this.pos, 0, { text: 'MISS' }); this.game.fx.ghost(this.model, 0x80ff90, { life: 0.3, opacity: 0.4 });
      return 0;
    }
    const armor = this.def.armor || 0; dmg *= 1 - armor;
    this.hp -= dmg;
    this.flash(crit ? 0xffd040 : 0xffffff, crit ? 0.18 : 0.12);
    const resist = this.isBoss ? 0.25 : this.isElite ? 0.5 : 1;
    this.knockback(dirx, dirz, kb * resist * (this.def.armor ? 0.6 : 1));
    if (stun > 0) this.stun = Math.max(this.stun, stun * (this.isBoss ? 0.4 : 1));
    if (slow > 0) { this.slow = 0.5; this.slowT = slow; }
    if (poison) { this.poison = 4; }
    const staggerOK = (!this.isBoss || crit || kb >= 6) && (!this.isElite || crit || kb >= 4); const warrior = this.def.armor && !crit && kb < 4;
    if (staggerOK && !warrior && this.state !== 'dead') {
      if (this.state !== 'attack' || kb >= 4) { this.state = 'hurt'; this.stateT = 0; this.stagger = 0.22 + Math.min(0.4, kb * 0.03); this.play(this.A('hit'), { once: true, fade: 0.04, speed: 1.8 }); this.telegraph = 0; this.attackDone = false; }
    }
    if (this.hp <= 0) { this.hp = 0; this.kill(dirx, dirz, kb); }
    return dmg;
  }
  kill(dirx, dirz, kb) {
    this.die(); this.state = 'dead'; this.telegraph = 0;
    this.kb.set(dirx, 0, dirz).normalize().multiplyScalar(Math.max(4, kb * 1.5));
    if (this.eyeMat) this.eyeMat.emissiveIntensity = 0;
    this.game.onEnemyDeath(this);
  }
  update(dt) {
    super.update(dt);
    if (this.marker) { if (this.alive) { this.marker.rotation.z += dt * 1.2; this.marker.material.opacity = 0.5 + Math.sin(this.game.elapsed * 3) * 0.18; } else this.marker.visible = false; }
    if (this.poison > 0) { this.poison -= dt; this.poisonT -= dt; if (this.poisonT <= 0) { this.poisonT = 0.5; if (this.alive) { const d = this.maxHp * 0.02 + 8; this.hp -= d; this.game.fx.damage(this.pos, d, { kind: 'skill' }); this.game.fx.embers(this.pos, 0x80ff90, { n: 3, radius: 0.5, life: 0.6 }); if (this.hp <= 0) { this.hp = 0; this.kill(0, 0, 2); } } } this.tintEmissive = new THREE.Color(0, 0.25, 0.05); }
    else if (this.tintEmissive && !this.enraged && !this.isElite) this.tintEmissive = null;
    if (!this.alive) return;
    this.stateT += dt; const p = this.player; if (!p) return;
    const d = this.distTo(p); const spdMul = (this.slow ? 0.5 : 1) * (this.enraged ? 1.35 : 1);
    if (this.state === 'spawn') {
      if (this.popIn !== undefined) { const k = Math.min(1, this.stateT / this.spawnLen); const e = 1 + Math.sin(Math.min(1, k) * Math.PI) * 0.25; this.model.scale.setScalar(this.scale * (k < 1 ? k * e : 1)); }
      if (this.stateT > this.spawnLen * 0.8) { this.spawning = false; this.state = 'chase'; this.play(this.A('idleCombat'), { fade: 0.2 }); if (this.isBoss) { this.game.renderer.shake(0.6); audio.play('hit_bell', { vol: 0.6, rate: 0.5 }); } }
      return;
    }
    if (this.stun > 0 && this.state !== 'dead') { this.vel.set(0, 0, 0); if (!this.rig.hit.includes(this.actionName) && this.state !== 'hurt') { this.play(this.A('hit'), { once: true, clamp: true, fade: 0.05 }); } this.telegraph = 0; this.attackDone = false; if (this.state === 'attack') this.state = 'chase'; return; }
    if (this.isBoss) {
      if (this.phase === 0 && this.hp < this.maxHp * 0.6) { this.phase = 1; this.game.bossPhase(this, 1); }
      if (this.phase === 1 && this.hp < this.maxHp * 0.3) { this.phase = 2; this.enraged = true; this.tintEmissive = new THREE.Color(0.4, 0.02, 0.02); this.game.bossPhase(this, 2); }
    }
    if (this.state === 'hurt') { this.vel.set(0, 0, 0); if (this.stateT > this.stagger) { this.state = 'chase'; this.play(this.A('idleCombat'), { fade: 0.12 }); } return; }
    if (this.state === 'dodge') { if (this.stateT > 0.4) { this.state = 'chase'; this.play(this.A('idle'), { fade: 0.1 }); } return; }
    // 분리 (몹몰이 시 겹침 방지, 가까운 것만)
    let sx = 0, sz = 0; let cnt = 0;
    for (const o of this.game.enemies) { if (o === this || !o.alive) continue; const dx = this.pos.x - o.pos.x; if (dx > 2.5 || dx < -2.5) continue; const dz = this.pos.z - o.pos.z; if (dz > 2.5 || dz < -2.5) continue; const dd = Math.hypot(dx, dz); const min = this.radius + o.radius + 0.2; if (dd < min && dd > 0.001) { sx += dx / dd * (min - dd) * 5; sz += dz / dd * (min - dd) * 5; if (++cnt > 6) break; } }

    if (this.state === 'chase') {
      this.atkCd -= dt;
      const range = this.def.range;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      this.faceDir(dx, dz);
      if (d > range * 0.92 && !(this.def.ranged && d < range * 0.6)) {
        const spd = this.def.spd * spdMul; this.vel.set(dx / d * spd + sx, 0, dz / d * spd + sz);
        const run = this.def.spd < 4 ? this.A('walk') : this.A('run');
        if (this.actionName !== run) this.play(run, { fade: 0.15, speed: spdMul * (this.def.spd > 5 ? 1.2 : 1) });
      } else if (this.def.ranged && d < range * 0.45) {
        const spd = this.def.spd * 0.8; this.vel.set(-dx / d * spd + sx, 0, -dz / d * spd + sz); if (this.actionName !== this.A('back')) this.play(this.A('back'), { fade: 0.15 });
      } else {
        this.vel.set(sx, 0, sz);
        if (this.atkCd <= 0 && p.alive) this.startAttack(d);
        else if (this.actionName !== this.rig.idleCombat && this.actionName !== this.rig.idle) this.play(this.A('idleCombat'), { fade: 0.15 });
      }
    } else if (this.state === 'attack') {
      this.vel.set(0, 0, 0);
      if (this.special === 'dash' && this.dashV) { this.vel.copy(this.dashV); }
      const t = this.stateT / this.attackDur;
      if (!this.attackDone && t < this.hitAt && this.special !== 'dash') { const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z; this.faceDir(dx, dz); this.telegraph = this.hitAt * this.attackDur - this.stateT; }
      if (!this.attackDone && t >= this.hitAt) { this.attackDone = true; this.telegraph = 0; this.doAttack(); }
      if (t >= 1) { this.state = 'chase'; this.dashV = null; this.atkCd = (this.def.atkTime * 0.6 + Math.random() * 0.8) * (this.enraged ? 0.6 : 1); this.play(this.A('idleCombat'), { fade: 0.15 }); }
    }
  }
  startAttack(d) {
    this.state = 'attack'; this.stateT = 0; this.attackDone = false;
    let anim = this.def.ranged ? this.A('cast') : this.A('attack'); this.special = null;
    if (this.isBoss) {
      const r = Math.random(); const kit = this.def.kit;
      if (kit === 'warlord') { if (r < 0.3) { anim = this.A('attackSpin'); this.special = 'spin'; } else if (r < 0.55) { anim = this.A('attackJump'); this.special = 'slam'; } else if (this.phase >= 1 && r < 0.7) { anim = this.A('summon'); this.special = 'summon'; } }
      else if (kit === 'lich') { if (r < 0.35) { anim = this.A('raise'); this.special = 'soulrain'; } else if (this.phase >= 1 && r < 0.55) { anim = this.A('summon'); this.special = 'summon'; } else { this.special = 'fan'; } }
      else if (kit === 'reaper') { if (r < 0.45 && d > 3) { anim = this.A('dash'); this.special = 'dash'; } else if (r < 0.7) { anim = this.A('attackSpin'); this.special = 'spin'; } else if (this.phase >= 1 && r < 0.8) { anim = this.A('summon'); this.special = 'summon'; } }
      else if (kit === 'dragon') { if (r < 0.35) { anim = this.A('attackHeavy'); this.special = 'fan'; } else if (r < 0.6) { anim = this.A('attackHeavy'); this.special = 'slam'; } else if (this.phase >= 1 && r < 0.75) { anim = this.A('summon'); this.special = 'summon'; } }
    }
    if (this.isElite && !this.isBoss && Math.random() < 0.3) { anim = this.A('attackHeavy'); this.special = 'spin'; }
    let dur = (this.def.atkTime) * (this.enraged ? 0.75 : 1) * (this.special === 'spin' ? 1.4 : this.special === 'dash' ? 0.9 : 1);
    this.attackDur = dur; this.hitAt = this.special === 'spin' ? 0.55 : this.special === 'summon' ? 0.6 : this.special === 'dash' ? 0.5 : this.special === 'soulrain' ? 0.6 : 0.52;
    this.playTimed(anim, dur, { fade: 0.08 });
    const f = this.forward(_v.clone()); const g = this.game;
    if (this.special === 'dash') { const p = this.player; const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z; const dd = Math.hypot(dx, dz) || 1; const travel = Math.min(9, dd + 1.5); this.dashV = new THREE.Vector3(dx / dd, 0, dz / dd).multiplyScalar(travel / (dur * this.hitAt)); this.faceDir(dx, dz); g.fx.slashArc(this.pos, this.yaw, 0xff3030, { radius: travel, arc: 30, height: 0.1, life: dur * this.hitAt, thickness: 1 }); audio.whoosh({ vol: 0.5, pitch: 0.5, dur: 0.5 }); }
    else if (this.def.ranged) { g.fx.flash(this.pos.clone().setY(1.6 * this.def.scale), this.isBoss ? 0xa0ff90 : 0xa0ff90, { size: 1.5 * this.def.scale, life: dur * this.hitAt }); if (this.isBoss) audio.magic({ vol: 0.25, base: 200, notes: [0, 1, 0], step: 0.1, type: 'square' }); }
    else if (this.special === 'spin') g.fx.ring(this.pos, 0xff3030, { r0: 4.2, r1: 4.8, life: dur * this.hitAt, y: 0.06, width: 1 });
    else if (this.special === 'slam') g.fx.ring(this.pos.clone().addScaledVector(f, 2), 0xff3030, { r0: 3.6, r1: 4.2, life: dur * this.hitAt, y: 0.06 });
    else if (this.special === 'summon') { g.fx.castCircle(this.pos, 0xff3030, { radius: 4, life: dur, demon: true }); }
    else if (this.special === 'soulrain') { const p = this.player; this.rainPts = []; for (let i = 0; i < 6; i++) { const pt = p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8)); if (i === 0) pt.copy(p.pos); this.rainPts.push(pt); g.fx.ring(pt, 0x80ff90, { r0: 1.8, r1: 2.2, life: dur * this.hitAt, y: 0.06 }); } g.fx.castCircle(this.pos, 0x80ff90, { radius: 4, life: dur, demon: true }); }
    else g.fx.slashArc(this.pos, this.yaw, 0xff3030, { radius: this.def.range + 0.5, arc: 110, height: 0.1, life: dur * this.hitAt, tilt: 0, thickness: 0.9 });
    if (this.isBoss && this.special !== 'dash') audio.whoosh({ vol: 0.4, pitch: 0.5, dur: 0.5 });
  }
  doAttack() {
    const p = this.player; const g = this.game; const f = this.forward(_v.clone());
    const dmg = this.atk * (this.special === 'slam' ? 1.6 : this.special === 'spin' ? 1.2 : this.special === 'dash' ? 1.5 : 1);
    if (this.special === 'summon') { g.summonMinions(this, this.isBoss ? 4 : 2); return; }
    if (this.special === 'soulrain') {
      for (const pt of this.rainPts || []) { g.fx.firePillar(pt, { height: 6, width: 2.2, life: 0.6, color: 0x80ff90 }); g.fx.burst(pt.clone().setY(0.5), 0x80ff90, { n: 12, speed: 6, size: 0.3 }); if (Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z) < 2.2) p.hurt(dmg, { dirx: p.pos.x - pt.x, dirz: p.pos.z - pt.z, kb: 6, kind: 'magic' }); }
      audio.boom({ vol: 0.6, dur: 0.6, low: 70 }); g.renderer.shake(0.4); return;
    }
    if (this.special === 'fan') {
      const pc2 = this.def.projColor || 0x60ff80;
      for (let i = -2; i <= 2; i++) { const dir = p.pos.clone().setY(1.2).sub(this.pos.clone().setY(1.5)).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.28); const sp = this.pos.clone().addScaledVector(f, 0.8).setY(1.5 * this.def.scale); g.spawnProjectile({ pos: sp, dir, speed: 13, radius: 0.75, dmg: dmg * 0.7, color: pc2, size: 0.6, owner: this, kb: 3, kind: 'magic', life: 1.8, trail: pc2, hostile: true }); }
      audio.magic({ vol: 0.3, base: 300, notes: [0, -5, -7], step: 0.05, type: 'square' }); return;
    }
    if (this.def.ranged) {
      const sp = this.pos.clone().addScaledVector(f, 0.8).setY(1.5 * this.def.scale); const dir = p.pos.clone().setY(1.2).sub(sp).normalize();
      const pc = this.def.projColor || 0x60ff80;
      g.spawnProjectile({ pos: sp, dir, speed: 11, radius: 0.7, dmg, color: pc, size: 0.5, owner: this, kb: 3, kind: 'magic', life: 1.6, trail: pc, hostile: true });
      audio.magic({ vol: 0.2, base: 330, notes: [0, -5], step: 0.05, type: 'square' });
      return;
    }
    if (this.special === 'spin') {
      g.fx.slashArc(this.pos, this.yaw, 0xff5050, { radius: 4.8, arc: 330, height: 1.2, life: 0.35, thickness: 0.5 }); g.fx.dust(this.pos, { n: 14, size: 2 }); g.renderer.shake(0.4);
      if (p.distTo(this) < 4.8) p.hurt(dmg, { dirx: p.pos.x - this.pos.x, dirz: p.pos.z - this.pos.z, kb: 9, kind: 'blunt' });
      return;
    }
    if (this.special === 'slam') {
      const c = this.pos.clone().addScaledVector(f, 2);
      g.fx.shockTex(c, 0xff6a3a, { r1: 5.5, life: 0.5 }); g.fx.dustPuff(c, { size: 5 }); g.fx.burst(c.clone().setY(0.4), 0xff7a40, { n: 24, speed: 9, size: 0.4 }); g.renderer.shake(0.7); audio.boom({ vol: 0.7, dur: 0.5, low: 50 });
      if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < 4.2) p.hurt(dmg, { dirx: p.pos.x - c.x, dirz: p.pos.z - c.z, kb: 10, kind: 'blunt' });
      return;
    }
    if (this.special === 'dash') {
      this.dashV = null; g.fx.slashArc(this.pos, this.yaw, 0xd070ff, { radius: 3.2, arc: 160, height: 1.2, life: 0.25, tilt: 0.8 }); g.fx.ghost(this.model, 0xb26bff, { life: 0.35, opacity: 0.5 }); audio.whoosh({ vol: 0.6, pitch: 1.2, dur: 0.2 });
      if (p.distTo(this) < 3.2) p.hurt(dmg, { dirx: p.pos.x - this.pos.x, dirz: p.pos.z - this.pos.z, kb: 7, kind: 'blunt' });
      return;
    }
    audio.whoosh({ vol: 0.35, pitch: this.isBoss ? 0.5 : 0.9, dur: 0.3 });
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z; const d = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz); let diff = Math.abs(ang - this.yaw); diff = Math.min(diff, Math.PI * 2 - diff);
    if (d < this.def.range + 0.6 && diff < 1.1) { p.hurt(dmg, { dirx: dx, dirz: dz, kb: this.isBoss ? 6 : 3, kind: 'blunt' }); g.fx.slashArc(this.pos, this.yaw, 0xff5050, { radius: this.def.range, arc: 110, height: 1.2, life: 0.2, tilt: 0.8 }); }
  }
}
