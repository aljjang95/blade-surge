import * as THREE from 'three';
import { Player } from './player.js';
import { Enemy } from './enemies.js';
import { DropSystem } from './drops.js';
import { ENEMIES } from '../data/stages.js';
import { HEROES, heroStats } from '../data/heroes.js';
import { loadModel } from '../engine/assets.js';
import { RARITY_WEIGHT_STAGE, RARITY_WEIGHT_ELITE, RARITY_WEIGHT_BOSS } from '../data/items.js';
import { audio } from '../engine/audio.js';

const _v = new THREE.Vector3();
const pickWeighted = (w) => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = Math.random() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };

/** 히트스탑 / 슬로우모션 타임 컨트롤 */
export class TimeCtl {
  constructor() { this.stop = 0; this.slow = 1; this.slowT = 0; this.scale = 1; }
  hitstop(sec) { this.stop = Math.max(this.stop, sec); }
  slowmo(scale, sec) { this.slow = Math.min(this.slow, scale); this.slowT = Math.max(this.slowT, sec); }
  step(realDt) {
    if (this.stop > 0) { this.stop -= realDt; this.scale = 0; return 0; }
    if (this.slowT > 0) { this.slowT -= realDt; if (this.slowT <= 0) this.slow = 1; }
    this.scale = this.slow; return realDt * this.slow;
  }
}

export class Battle {
  constructor(app) {
    this.app = app; this.scene = app.renderer.scene; this.renderer = app.renderer; this.fx = app.fx; this.input = app.input; this.ui = app.ui; this.arena = app.arena;
    this.timeCtl = new TimeCtl();
    this.enemies = []; this.projectiles = []; this.timers = [];
    this.drops = new DropSystem(this);
    this.player = null; this.active = false; this.paused = false;
    this.combo = 0; this.comboT = 0; this.kills = 0; this.maxCombo = 0; this.dmgDealt = 0; this.elapsed = 0;
    this.wave = 0; this.waveT = 0; this.stage = null; this.boss = null; this.result = null; this.revived = 0;
    this.pending = []; // 지속 스폰 큐
    this.maxAlive = 34;
  }
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  rollDrop(table) {
    const w = table === 'boss' ? RARITY_WEIGHT_BOSS : table === 'elite' ? RARITY_WEIGHT_ELITE : RARITY_WEIGHT_STAGE;
    const rar = pickWeighted(w);
    const inst = this.app.eco.fieldDrop(rar);
    return { ...inst, rarity: rar };
  }

  async start(stage, heroId, heroState, equipBonus) {
    this.stage = stage; this.active = true; this.paused = false; this.result = null; this.revived = 0;
    this.enemies.length = 0; this.projectiles.length = 0; this.timers.length = 0; this.pending.length = 0; this.fx.clearAll(); this.drops.clear();
    this.combo = 0; this.kills = 0; this.maxCombo = 0; this.dmgDealt = 0; this.elapsed = 0; this.wave = 0; this.boss = null;
    const def = HEROES[heroId]; const stats = heroStats(def, heroState, equipBonus);
    this.setBonus = equipBonus.active || [];
    this.arena.build(stage.chapter.theme);
    const gltf = await loadModel(def.model);
    this.player = new Player(this, gltf, def, stats, heroState.skills || [1, 1, 1, 1]);
    this.player.pos.set(0, 0, 4); this.player.yaw = Math.PI;
    this.drops.setup(this.app.models.dungeon);
    this.renderer.rig.mode = 'battle'; this.renderer.rig.target.copy(this.player.pos); this.renderer.rig.pos.copy(this.player.pos).add(this.renderer.rig.offset);
    this.weaponsGltf = await loadModel('skel_weapons');
    this.ui.setupHud(def, this.player);
    this.input.enabled = true; this.input.clear();
    audio.playMusic(Math.random() < 0.5 ? 'bgm_battle' : 'bgm_battle2');
    this.ui.showHud(true);
    // 성능: 저사양이면 동시 적 수 제한
    const q = this.app.eco.s.settings.quality;
    this.maxAlive = q === 'low' ? 16 : q === 'mid' ? 24 : 34;
    this.after(0.5, () => this.nextWave());
  }
  stop() { this.active = false; this.input.enabled = false; this.input.clear(); this.ui.showHud(false); for (const e of this.enemies) e.dispose(); this.enemies.length = 0; for (const p of this.projectiles) if (p.mesh) this.scene.remove(p.mesh); this.projectiles.length = 0; this.player?.dispose(); this.player = null; this.fx.clearAll(); this.drops.clear(); this.timers.length = 0; this.pending.length = 0; this.renderer.desat = 0; }

  // ---------------- 웨이브 (몹몰이: 대량 스폰 + 지속 보충) ----------------
  nextWave() {
    if (this.wave >= this.stage.waves.length) return this.victory();
    const list = this.stage.waves[this.wave].slice(); this.wave++;
    const isBoss = list.some((t) => ENEMIES[t]?.boss);
    this.ui.setWave(this.wave, this.stage.waves.length, isBoss);
    this.ui.waveBanner(isBoss ? 'BOSS' : `WAVE ${this.wave}`);
    audio.waveHorn({ vol: 0.5, boss: isBoss });
    if (isBoss) { audio.playMusic(Math.random() < 0.5 ? 'bgm_boss' : 'bgm_boss2'); this.renderer.shake(0.5); }
    // 보스/엘리트는 먼저, 잡몹은 큐로 지속 스폰(동시 상한 유지)
    const now = [], queue = [];
    for (const t of list) { const d = ENEMIES[t]; if (d?.boss || d?.elite) now.push(t); else queue.push(t); }
    // 첫 물량을 크게 (몹몰이 손맛)
    const initial = Math.min(queue.length, Math.max(8, Math.floor(this.maxAlive * 0.6)));
    for (let i = 0; i < initial; i++) this.after(0.1 + i * 0.06, () => this.spawnEnemy(queue[i]));
    this.pending = queue.slice(initial);
    now.forEach((t, i) => this.after(0.5 + i * 0.4, () => this.spawnEnemy(t)));
    this.waveTotal = list.length; this.waveKilled = 0;
  }
  spawnEnemy(type, near = null) {
    const def = ENEMIES[type]; const gltf = this.app.models[def.model]; if (!gltf) return;
    let pos;
    if (near) { const a = Math.random() * Math.PI * 2; pos = near.clone().add(new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3)); }
    else {
      const a = Math.random() * Math.PI * 2; const r = def.boss ? 8 : 10 + Math.random() * 4.5;
      pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      if (this.player && pos.distanceTo(this.player.pos) < 6) pos.multiplyScalar(-1);
    }
    const e = new Enemy(this, gltf, this.weaponsGltf, def, this.stage.scale, pos);
    this.enemies.push(e);
    if (def.boss) { this.boss = e; this.ui.showBoss(def.name, true, def.portrait); }
    return e;
  }
  summonMinions(boss, n) { for (let i = 0; i < n; i++) this.after(i * 0.12, () => this.spawnEnemy('minion', boss.pos)); this.ui.toast(`${boss.def.name}이(가) 병사를 소환했다!`, 'red'); audio.magic({ vol: 0.4, base: 150, notes: [0, -2, -4], step: 0.12, type: 'sawtooth' }); }
  bossPhase(boss, phase) {
    if (phase === 1) { this.ui.toast('보스 2페이즈!', 'red'); this.fx.shockTex(boss.pos, 0xff3030, { r1: 9, life: 0.8 }); }
    else { this.ui.toast(`${boss.def.name} 광폭화!`, 'red'); this.fx.firePillar(boss.pos, { height: 11, width: 3.5, life: 1.2, color: 0xff2020 }); this.renderer.flashScreen(0.4, 0xff2020); this.renderer.shake(0.8); audio.boom({ vol: 0.8, dur: 0.8 }); }
  }
  onEnemyDeath(e) {
    this.kills++; this.waveKilled++; this.player.addUlt(e.isBoss ? 30 : e.isElite ? 16 : 5);
    this.app.eco.s.quests.kills++;
    this.drops.onKill(e, this.stage);
    const big = e.isBoss || e.isElite;
    this.fx.burst(e.pos.clone().setY(1), 0xe0e0ff, { n: big ? 40 : 12, speed: 8, size: 0.4, up: 1 });
    if (big) { this.fx.explosion(e.pos, { size: e.isBoss ? 7 : 4, color: e.isBoss ? 0xff8080 : 0xffd080 }); this.renderer.shake(0.4); }
    else this.fx.dustPuff(e.pos, { size: 2, life: 0.6 });
    audio.play('hit_wood', { vol: 0.3, rate: 1.35, min: 0.05 }); if (big) audio.dark({ vol: 0.4, base: 200, dur: 0.5 });
    // 지속 스폰: 죽은 만큼 큐에서 보충
    if (this.pending.length && this.active) this.after(0.6 + Math.random() * 0.6, () => { if (this.pending.length && this.active) this.spawnEnemy(this.pending.shift()); });
    if (e.isBoss) {
      this.ui.showBoss('', false); this.boss = null;
      this.timeCtl.slowmo(0.15, 1.8); this.renderer.punch(1.4); this.renderer.flashScreen(0.9, 0xffffff); this.renderer.aberr = 2; this.renderer.shake(1);
      this.fx.explosion(e.pos, { size: 12, life: 0.8, color: 0xffd0a0 }); this.fx.holyBurst(e.pos, { size: 14, life: 0.7 });
      this.fx.burst(e.pos.clone().setY(1.5), 0xff5050, { n: 80, speed: 14, size: 0.6, up: 1 }); this.fx.shockTex(e.pos, 0xffd060, { r1: 16, life: 0.9 });
      audio.boom({ vol: 1, dur: 1.4, low: 40 }); audio.play('jingle_win1', { vol: 0.8, delay: 0.8 }); audio.vibe([100, 50, 100, 50, 200]);
      this.after(2.6, () => this.victory());
    } else if (!this.pending.length && this.enemies.every((x) => !x.alive)) {
      this.after(0.9, () => this.nextWave());
    }
  }
  onPlayerDeath() {
    this.renderer.desat = 0.7; this.timeCtl.slowmo(0.3, 1.5); this.renderer.shake(0.6); audio.playMusic(null);
    this.after(1.8, () => { if (this.active) this.ui.showRevive(this); });
  }
  revivePlayer() {
    this.player.revive(); this.renderer.desat = 0; this.revived++;
    this.fx.holyBurst(this.player.pos, { size: 9, life: 0.6 }); this.fx.shockTex(this.player.pos, 0xffd060, { r1: 9, life: 0.7 });
    this.hitRadius(this.player.pos, 7, 1, { kb: 14, stun: 1.5, kind: 'magic', source: this.player, dirFrom: this.player.pos });
    audio.playMusic(this.boss ? 'bgm_boss' : 'bgm_battle'); audio.magic({ vol: 0.5, base: 523, notes: [0, 4, 7, 12], step: 0.08 });
  }
  defeat() { this.active = false; this.result = { win: false, kills: this.kills, maxCombo: this.maxCombo, dmg: this.dmgDealt, time: this.elapsed }; this.ui.showResult(this, false); }
  victory() {
    if (!this.active) return; this.active = false; this.input.enabled = false; this.input.clear();
    this.player.play('Cheer', { fade: 0.2 }); audio.playMusic(null); audio.play('jingle_win0', { vol: 0.9 });
    this.fx.burst(this.player.pos.clone().setY(1), 0xffd060, { n: 60, speed: 9, size: 0.5, up: 1.5, grav: 6, life: 1.2 }); this.fx.embers(this.player.pos, 0xffe080, { n: 40, radius: 2, life: 2, rise: 3 });
    // 남은 드랍 자동 수거
    this.player.magnetMul = 99;
    const hpRatio = this.player.hp / this.player.maxHp; const stars = this.revived ? 1 : hpRatio > 0.7 ? 3 : hpRatio > 0.3 ? 2 : 1;
    this.result = { win: true, stars, kills: this.kills, maxCombo: this.maxCombo, dmg: this.dmgDealt, time: this.elapsed };
    this.after(1.6, () => this.ui.showResult(this, true));
  }

  // ---------------- 히트 판정 ----------------
  hitArea(src, pos, yaw, range, arcDeg, dmg, opts = {}) {
    const half = THREE.MathUtils.degToRad(arcDeg) / 2; let n = 0;
    const r2 = (range + 1.5) * (range + 1.5);
    for (const e of this.enemies) {
      if (!e.alive || e.spawning) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      const d = Math.hypot(dx, dz) - e.radius * 0.6;
      if (d > range) continue;
      const ang = Math.atan2(dx, dz); let diff = Math.abs(ang - yaw); diff = Math.min(diff, Math.PI * 2 - diff);
      if (diff > half && d > 0.9) continue;
      this.damageEnemy(e, dmg, { ...opts, dirx: dx, dirz: dz }); n++;
      if (n >= 24) break;
    }
    return n;
  }
  hitRadius(center, radius, dmg, opts = {}) {
    let n = 0; const r2 = (radius + 1.5) * (radius + 1.5);
    for (const e of this.enemies) {
      if (!e.alive || e.spawning) continue;
      const dx = e.pos.x - center.x, dz = e.pos.z - center.z;
      if (dx * dx + dz * dz > r2) continue;
      if (Math.hypot(dx, dz) - e.radius * 0.5 > radius) continue;
      const from = opts.dirFrom || center;
      this.damageEnemy(e, dmg, { ...opts, dirx: e.pos.x - from.x, dirz: e.pos.z - from.z }); n++;
      if (n >= 30) break;
    }
    return n;
  }
  /** 몹몰이 진공: 반경 안 적을 중심으로 끌어당김 */
  vacuum(center, radius, force = 14) {
    let n = 0;
    if (this._vacSfx === undefined || this.elapsed - this._vacSfx > 0.45) { this._vacSfx = this.elapsed; audio.suck({ vol: 0.22, dur: 0.4 }); }
    for (const e of this.enemies) { if (!e.alive || e.spawning) continue; const dx = e.pos.x - center.x, dz = e.pos.z - center.z; if (dx * dx + dz * dz > radius * radius) continue; e.pull(center.x, center.z, force); n++; }
    return n;
  }
  damageEnemy(e, dmg, opts = {}) {
    const p = this.player; const crit = Math.random() < p.stats.crit;
    let amount = dmg * (0.9 + Math.random() * 0.2) * (crit ? p.stats.critDmg : 1);
    const dealt = e.hurt(amount, { ...opts, crit });
    if (dealt <= 0) return;
    this.dmgDealt += dealt;
    this.combo++; this.comboT = 2.5; this.maxCombo = Math.max(this.maxCombo, this.combo); this.ui.setCombo(this.combo);
    p.addUlt((crit ? 3 : 2) * (p.stats.ultGain || 1));
    const hitPos = e.pos.clone().setY(1.1 * e.def.scale);
    // 다수 타격 시 데미지 숫자 솎아내기 (성능)
    if (this.fx.dmgLayer.children.length < 26 || crit) this.fx.damage(hitPos, dealt, { crit, kind: opts.kind === 'magic' ? 'skill' : '' });
    const dirx = opts.dirx || 0, dirz = opts.dirz || 0;
    const color = opts.kind === 'magic' ? 0xa0e0ff : crit ? 0xffd040 : 0xfff0d0;
    if (!opts.quiet) {
      const heavy = opts.finisher || crit;
      this.fx.flash(hitPos, color, { size: crit ? 3 : 1.8, life: 0.14 });
      this.fx.directional(hitPos, _v.set(dirx, 0, dirz).normalize(), color, { n: crit ? 18 : 8, speed: crit ? 12 : 8 });
      if (crit) { this.fx.texFlash(hitPos, 'holy_burst', 0xffd040, { size: 2.6, life: 0.22, y: 0, grow: 1.4 }); this.fx.light(e.pos, 0xffd040, 6, 6, 0.25); }
      audio.hit(opts.kind || 'slash', { crit, heavy });
      if (!opts.quietStop) this.timeCtl.hitstop(opts.finisher ? 0.1 : crit ? 0.06 : 0.035);
      this.renderer.shake(opts.finisher ? 0.5 : crit ? 0.3 : 0.12);
      if (heavy) audio.vibe(crit ? [10, 10, 25] : 20);
    }
  }

  // ---------------- 투사체 ----------------
  spawnProjectile({ pos, dir, speed, radius, dmg, color, size = 0.4, owner, kb = 2, kind = 'magic', life = 1.2, pierce = false, trail = null, explode = null, hostile = false, visual = undefined }) {
    let mesh = null;
    if (visual !== null && size > 0) { mesh = this.fx.orb(color, size); mesh.position.copy(pos); this.scene.add(mesh); }
    this.projectiles.push({ pos: pos.clone(), dir: dir.clone().normalize(), speed, radius, dmg, color, owner, kb, kind, life, t: 0, pierce, hit: new Set(), mesh, trail, explode, hostile });
  }
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.t += dt; p.pos.addScaledVector(p.dir, p.speed * dt); if (p.mesh) { p.mesh.position.copy(p.pos); p.mesh.rotation.y += dt * 8; }
      if (p.trail) this.fx.embers(p.pos, p.trail, { n: 2, radius: 0.15, life: 0.35, size: 0.35, rise: 0.5 });
      let done = p.t >= p.life || Math.hypot(p.pos.x, p.pos.z) > 17;
      if (p.hostile) {
        const pl = this.player; if (pl && pl.alive && Math.hypot(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z) < p.radius + 0.6) { pl.hurt(p.dmg, { dirx: p.dir.x, dirz: p.dir.z, kb: p.kb, kind: p.kind }); done = true; this.fx.burst(p.pos, p.color, { n: 12, speed: 5, size: 0.3 }); }
      } else {
        for (const e of this.enemies) {
          if (!e.alive || e.spawning || p.hit.has(e)) continue;
          if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < p.radius + e.radius) {
            p.hit.add(e);
            if (p.explode) { this.explode(p); done = true; break; }
            this.damageEnemy(e, p.dmg, { kb: p.kb, kind: p.kind, dirx: p.dir.x, dirz: p.dir.z, source: p.owner });
            if (!p.pierce) { done = true; this.fx.burst(p.pos, p.color, { n: 10, speed: 5, size: 0.3 }); break; }
          }
        }
      }
      if (done) { if (p.explode && p.t >= p.life && !p.hit.size) this.explode(p); if (p.mesh) this.scene.remove(p.mesh); this.projectiles.splice(i, 1); }
    }
  }
  explode(p) {
    const c = p.pos.clone().setY(0); const ex = p.explode;
    this.hitRadius(c, ex.radius, p.dmg, { kb: p.kb, kind: 'magic', up: true, source: p.owner, dirFrom: c });
    this.fx.explosion(c, { size: ex.radius * 2.2, color: ex.color, life: 0.55 });
    this.fx.shockTex(c, ex.color, { r1: ex.radius * 1.8, life: 0.45 });
    this.fx.burst(c.clone().setY(0.6), ex.color, { n: 30, speed: 11, size: 0.5, up: 1.2, grav: 14 });
    this.fx.dustPuff(c, { size: ex.radius * 1.6 }); this.fx.light(c, ex.color, 12, 12, 0.5); this.fx.scorch(c, { radius: ex.radius * 0.8, life: 4 });
    this.renderer.shake(0.6); this.renderer.punch(0.6); audio.boom({ vol: 0.8, dur: 0.6, low: 60 }); audio.fire({ vol: 0.3, dur: 0.5 }); audio.vibe([40, 20, 50]);
  }

  // ---------------- 궁극기 연출 ----------------
  ultCinematic(sk, p) {
    this.ui.ultCinema(sk.name, p.def);
    this.timeCtl.slowmo(0.25, 0.7); this.renderer.radial = 0.35; this.renderer.punch(1.2); this.renderer.aberr = 0.8;
    audio.duck(0.2, 2.5); audio.play('ui_max', { vol: 0.8, rate: 0.6 }); audio.vibe([60, 30, 60, 30, 120]);
    this.fx.castCircle(p.pos, p.def.color, { radius: 5, life: 1.2 });
    this.fx.light(p.pos, p.def.color, 12, 14, 1.2);
    for (const e of this.enemies) if (e.alive) e.stun = Math.max(e.stun, 0.8);
  }

  // ---------------- 프레임 ----------------
  update(realDt) {
    if (!this.player) return;
    if (this.paused) return;
    const dt = this.timeCtl.step(realDt);
    this.elapsed += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
    this.input.update();
    if (this.active) this.player.handleInput(this.input, dt);
    this.player.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) { const e = this.enemies[i]; e.update(dt); if (e.dead) { e.dispose(); this.enemies.splice(i, 1); } }
    this.updateProjectiles(dt);
    this.drops.update(dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.ui.setCombo(0); } }
    // 카메라: 적 밀도에 따라 살짝 줌아웃 (몹몰이 시야 확보)
    const rig = this.renderer.rig; rig.target.lerp(this.player.pos, 1 - Math.exp(-realDt * 8));
    const near = this.enemies.reduce((a, e) => a + (e.alive && e.distTo(this.player) < 9 ? 1 : 0), 0);
    const zoomOut = Math.min(1, near / 14);
    const baseY = this.boss && this.boss.alive ? 11.5 : 10.4, baseZ = this.boss && this.boss.alive ? 10.2 : 9.0;
    rig.offset.y += ((baseY + zoomOut * 2.2) - rig.offset.y) * Math.min(1, realDt * 2);
    rig.offset.z += ((baseZ + zoomOut * 1.8) - rig.offset.z) * Math.min(1, realDt * 2);
    this.arena.update(realDt, this.fx);
    this.ui.updateHud(this, realDt);
  }
}
