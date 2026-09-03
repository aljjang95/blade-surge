import * as THREE from 'three';
import { audio } from '../engine/audio.js';

const _v = new THREE.Vector3();
const fwd = (p, d = 1) => p.forward(new THREE.Vector3()).multiplyScalar(d).add(p.pos);
const targets = (game, p, max = 6, range = 10) => game.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < range).sort((a, b) => p.distTo(a) - p.distTo(b)).slice(0, max);
/** 적이 가장 밀집한 지점 (몹몰이 조준 보정) */
function densest(game, p, range = 11, radius = 3.5) {
  const list = game.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < range);
  if (!list.length) return null;
  let best = null, bestN = -1;
  for (const c of list) { let n = 0; for (const e of list) { const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z; if (dx * dx + dz * dz < radius * radius) n += e.isBoss ? 4 : e.isElite ? 2 : 1; } if (n > bestN) { bestN = n; best = c; } }
  return best ? best.pos.clone() : null;
}

export const SKILLS = {
  // ================= 검성 (성스러운 빛 · 몹몰이 심판) =================
  holy_slash: {
    dur: 0.6,
    start(game, p) { game.fx.castCircle(p.pos, 0xffd060, { radius: 2.6, life: 0.5 }); },
    cast(game, p, c) {
      const f = p.forward(new THREE.Vector3()); const spawn = fwd(p, 1); spawn.y = 1.2;
      game.fx.slashSprite(spawn, f, 0xfff0a0, { size: 4.2, life: 0.7, speed: 22, tilt: -0.5 });
      game.fx.slashSprite(spawn, f, 0xffffff, { size: 3.0, life: 0.55, speed: 24, tilt: -0.5 });
      game.fx.holyBurst(spawn, { size: 4, life: 0.3 }); game.fx.light(spawn, 0xffd060, 9, 12, 0.5);
      audio.bladeWave({ vol: 0.7 }); audio.holy({ vol: 0.3, base: 880, dur: 0.6 });
      game.renderer.shake(0.25); audio.vibe(30);
      game.spawnProjectile({ pos: spawn.clone(), dir: f, speed: 22, radius: 2.0, dmg: c.dmg, color: 0xfff0a0, size: 0, owner: p, kb: 5, kind: 'slash', pierce: true, life: 0.7, visual: null });
    },
  },
  shield_bash: {
    dur: 0.7,
    cast(game, p, c) {
      const center = fwd(p, 1.2);
      // 몹몰이: 먼저 끌어당기고 때린다
      game.vacuum(center, 7, 22);
      game.hitRadius(center, 5.0, c.dmg, { kb: 7, kind: 'blunt', stun: 1.4, source: p });
      game.fx.shockTex(center, 0xffe0a0, { r1: 6.5, life: 0.5 });
      game.fx.explosion(center, { size: 4.5, color: 0xffe0b0, life: 0.45 });
      game.fx.dustPuff(center, { size: 5 }); game.fx.burst(center.clone().setY(0.5), 0xffd080, { n: 26, speed: 9, size: 0.4 });
      game.fx.light(center, 0xffd080, 12, 14, 0.4);
      game.renderer.shake(0.8); game.renderer.punch(1); game.timeCtl.hitstop(0.09);
      audio.boom({ vol: 0.8, dur: 0.5, low: 70 }); audio.play('hit_plate', { vol: 0.9, rate: 0.8 }); audio.vibe([40, 30, 60]);
    },
  },
  judgment: {
    dur: 1.0, total: 1.5,
    start(game, p) { game.fx.castCircle(p.pos, 0xfff3b0, { radius: 4, life: 1.0 }); },
    cast(game, p, c) {
      const ts = targets(game, p, 8, 12);
      audio.magic({ vol: 0.4, base: 523, notes: [0, 4, 7, 12, 16], step: 0.06 });
      const pts = ts.length ? ts.map((e) => e.pos.clone()) : [fwd(p, 3)];
      pts.forEach((pt, i) => {
        const delay = i * 0.07;
        game.after(delay, () => {
          game.fx.firePillar(pt, { height: 11, width: 2.0, life: 0.5, color: 0xfff0c0 });
          game.hitRadius(pt, 2.2, c.dmg, { kb: 2, kind: 'magic', up: true, source: p, quietStop: i > 1 });
          game.fx.holyBurst(pt, { size: 3.5, life: 0.35 }); game.fx.burst(pt.clone().setY(0.6), 0xfff0c0, { n: 12, speed: 7, size: 0.35, up: 1.2 });
          if (i < 3) game.fx.light(pt, 0xfff0c0, 8, 8, 0.4);
          game.renderer.shake(0.22); audio.holy({ vol: 0.22, base: 659 + i * 40, dur: 0.5 }); audio.thump({ vol: 0.4, freq: 80 });
        });
      });
      game.renderer.flashScreen(0.35, 0xfff0c0);
    },
  },
  dragon_slash: {
    dur: 1.2, total: 2.1,
    start(game, p, c) {
      game.fx.castCircle(p.pos, 0xffd060, { radius: 6, life: 1.2 });
      game.fx.firePillar(p.pos, { height: 9, width: 2.4, life: 1.0, color: 0xffd060 });
      game.fx.embers(p.pos, 0xffcf5a, { n: 30, radius: 1.5, life: 1.2, rise: 5 });
      audio.magic({ vol: 0.5, base: 330, notes: [0, 7, 12, 19, 24], step: 0.09, type: 'sawtooth' });
      c.data.vac = 0;
    },
    update(game, p, c, dt) { c.data.vac -= dt; if (c.data.vac <= 0 && c.t < 1.1) { c.data.vac = 0.1; game.vacuum(p.pos, 12, 9); } },
    cast(game, p, c) {
      const f = p.forward(new THREE.Vector3());
      game.hitArea(p, p.pos, p.yaw, 10, 220, c.dmg, { kb: 12, kind: 'slash', finisher: true, up: true, source: p });
      // 3중 참격 + 관통 파동
      for (let i = -1; i <= 1; i++) {
        const d = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.32);
        const sp = p.pos.clone().addScaledVector(d, 1.5).setY(1.3);
        game.fx.slashSprite(sp, d, i === 0 ? 0xffffff : 0xffe080, { size: 5.5, life: 0.8, speed: 20, tilt: -0.5 + i * 0.25 });
        game.spawnProjectile({ pos: sp.clone(), dir: d, speed: 20, radius: 2.2, dmg: c.dmg * 0.5, color: 0xffe080, size: 0, owner: p, kb: 6, kind: 'slash', pierce: true, life: 0.8, visual: null });
      }
      const hitC = fwd(p, 3.5);
      game.fx.explosion(hitC, { size: 11, color: 0xffe0a0, life: 0.7 });
      game.fx.shockTex(hitC, 0xffd060, { r1: 14, life: 0.7 }); game.fx.holyBurst(hitC, { size: 12, life: 0.5 });
      game.fx.dustPuff(hitC, { size: 8 }); game.fx.burst(hitC.setY(1), 0xffe080, { n: 50, speed: 14, size: 0.5, up: 0.8 });
      game.fx.light(fwd(p, 3), 0xffd060, 16, 18, 0.6);
      game.renderer.shake(1); game.renderer.punch(1.5); game.renderer.flashScreen(0.45, 0xfff0c0); game.renderer.aberr = 1.2; game.timeCtl.hitstop(0.16); game.timeCtl.slowmo(0.35, 0.5);
      audio.boom({ vol: 1, dur: 0.9, low: 50 }); audio.bladeWave({ vol: 1 }); audio.holy({ vol: 0.45, base: 523, dur: 1.1 }); audio.vibe([80, 40, 120]);
    },
  },

  // ================= 광전사 (불 · 회전 몹몰이) =================
  whirlwind: {
    dur: 1.6, total: 1.6,
    start(game, p, c) { p.play('2H_Melee_Attack_Spinning', { fade: 0.05, speed: 2.2 }); c.data.tick = 0; p.startTrail(); audio.whoosh({ vol: 0.5, pitch: 0.7, dur: 0.5 }); game.fx.castCircle(p.pos, 0xff7a4a, { radius: 3.8, life: 1.5 }); },
    update(game, p, c, dt) {
      const m = game.input.move; const spd = p.stats.spd * 0.6; p.vel.set(m.x * spd, 0, m.y * spd);
      game.vacuum(p.pos, 5.5, 7); // 회전하며 빨아들임
      c.data.tick -= dt;
      if (c.data.tick <= 0) {
        c.data.tick = 0.22; const i = c.data.n = (c.data.n || 0) + 1;
        game.hitRadius(p.pos, 3.8, c.dmg, { kb: 2.5, kind: 'slash', source: p, dirFrom: p.pos, quietStop: i % 2 === 0 });
        game.fx.slashSprite(p.pos.clone().setY(1.1), new THREE.Vector3(Math.sin(i * 1.5), 0, Math.cos(i * 1.5)), 0xff9a5a, { size: 4.4, life: 0.22, tilt: -1.45 });
        game.fx.burst(p.pos.clone().setY(1), 0xffa060, { n: 5, speed: 6, size: 0.3 });
        if (i % 3 === 0) game.fx.dustPuff(p.pos, { size: 3, life: 0.5 });
        audio.whoosh({ vol: 0.45, pitch: 0.9 + (i % 4) * 0.06, dur: 0.25 }); game.renderer.shake(0.12);
      }
    },
    end(game, p) { p.stopTrail(); },
  },
  quake: {
    dur: 0.9,
    cast(game, p, c) {
      const center = fwd(p, 1.5);
      game.vacuum(center, 9, 12);
      game.hitRadius(center, 8, c.dmg, { kb: 9, kind: 'blunt', up: true, stun: 0.8, source: p, dirFrom: center });
      [0, 0.08, 0.16].forEach((d, i) => game.after(d, () => { game.fx.shockTex(center, i === 1 ? 0xffffff : 0xff9a4a, { r1: 5 + i * 4, life: 0.5 + i * 0.1 }); game.renderer.shake(0.5); audio.thump({ vol: 0.8, freq: 55 - i * 8, dur: 0.3 }); }));
      game.fx.explosion(center, { size: 8, color: 0xff9a50, life: 0.6 });
      game.fx.scorch(center, { radius: 4.5, life: 5 }); game.fx.dustPuff(center, { size: 7, life: 1.1 });
      game.fx.burst(center.clone().setY(0.4), 0xff8040, { n: 40, speed: 12, size: 0.5, up: 1.5, grav: 20 });
      game.fx.light(center, 0xff8040, 14, 16, 0.5);
      game.renderer.shake(1); game.renderer.punch(1.2); game.timeCtl.hitstop(0.12); game.renderer.flashScreen(0.3, 0xffa060);
      audio.boom({ vol: 1, dur: 0.8, low: 45 }); audio.play('hit_mining', { vol: 1, rate: 0.7 }); audio.vibe([60, 30, 90]);
    },
  },
  berserk: {
    dur: 0.8,
    cast(game, p, c) {
      p.buffs.atk = 1.6; p.buffs.atkSpd = 1.3; p.buffs.spd = 1.2; p.buffs.t = 8; p.tintEmissive = new THREE.Color(0.35, 0.02, 0.02);
      game.fx.castCircle(p.pos, 0xff3030, { radius: 4.5, life: 1.0, demon: true });
      game.fx.firePillar(p.pos, { height: 8, width: 2.6, life: 0.9, color: 0xff3030 });
      game.fx.shockTex(p.pos, 0xff4040, { r1: 7, life: 0.5 });
      game.fx.embers(p.pos, 0xff4040, { n: 40, radius: 1.5, life: 1.5, rise: 4 });
      game.fx.light(p.pos, 0xff2020, 12, 12, 0.8);
      game.renderer.flashScreen(0.4, 0xff2020); game.renderer.shake(0.5); game.renderer.aberr = 0.8;
      audio.boom({ vol: 0.6, dur: 0.6, low: 80 }); audio.dark({ vol: 0.55, base: 160, dur: 0.9 }); audio.vibe([50, 50, 50, 50, 100]);
      game.ui.toast('광폭화! 공격력 +60%', 'red');
    },
  },
  hell_axe: {
    dur: 1.0, total: 2.4,
    start(game, p, c) { audio.fire({ vol: 0.5, dur: 1.2 }); audio.magic({ vol: 0.5, base: 196, notes: [0, 5, 7, 12], step: 0.12, type: 'sawtooth' }); game.fx.castCircle(p.pos, 0xff5020, { radius: 5, life: 1.0, demon: true }); game.fx.embers(p.pos, 0xff5020, { n: 30, radius: 2, life: 1.5, rise: 6 }); },
    cast(game, p, c) {
      const target = densest(game, p, 13, 4) || fwd(p, 4);
      c.data.target = target;
      const orb = game.fx.orb(0xff5a20, 1.8); orb.position.copy(target).setY(16); game.scene.add(orb);
      game.fx.castCircle(target, 0xff5a20, { radius: 8, life: 0.8, demon: true });
      const fall = 0.5;
      game.fx.add(orb, fall, (k) => { orb.position.y = 16 * (1 - k * k); orb.children[1].scale.setScalar(7 * (1 + k)); game.fx.embers(orb.position, 0xff7a30, { n: 3, radius: 0.5, life: 0.5, rise: -2 }); });
      // 낙하 중 진공
      let vt = 0; game.fx.add(new THREE.Object3D(), fall, (k, t, dt) => { vt -= dt; if (vt <= 0) { vt = 0.08; game.vacuum(target, 10, 16); } });
      game.after(fall, () => {
        game.hitRadius(target, 8.5, c.dmg, { kb: 11, kind: 'blunt', up: true, stun: 1, source: p, dirFrom: target });
        game.fx.explosion(target, { size: 14, color: 0xffb070, life: 0.8 });
        game.fx.scorch(target, { radius: 6, life: 8 });
        [0, 0.1, 0.2].forEach((d, i) => game.after(d, () => game.fx.shockTex(target, i === 1 ? 0xffffff : 0xff6a20, { r1: 7 + i * 4, life: 0.6 })));
        game.fx.burst(target.clone().setY(0.5), 0xff7a20, { n: 70, speed: 16, size: 0.6, up: 1.4, grav: 18 });
        game.fx.dustPuff(target, { size: 10, life: 1.4 }); game.fx.embers(target, 0xff6020, { n: 60, radius: 5, life: 2.2, rise: 4 });
        game.fx.light(target, 0xff6020, 20, 22, 1);
        game.renderer.shake(1); game.renderer.punch(1.6); game.renderer.flashScreen(0.5, 0xffa060); game.renderer.aberr = 1.2; game.timeCtl.hitstop(0.18); game.timeCtl.slowmo(0.3, 0.6);
        audio.boom({ vol: 1, dur: 1.2, low: 40 }); audio.play('hit_mining', { vol: 1, rate: 0.5 }); audio.fire({ vol: 0.5, dur: 1.5 }); audio.vibe([100, 50, 150]);
      });
    },
  },

  // ================= 대마도사 (원소 · 광역 몹몰이) =================
  fireball: {
    dur: 0.6,
    start(game, p) { game.fx.castCircle(p.pos, 0xff7a20, { radius: 2.4, life: 0.5 }); },
    cast(game, p, c) {
      const f = p.forward(new THREE.Vector3()); const sp = fwd(p, 1); sp.y = 1.4;
      game.spawnProjectile({ pos: sp, dir: f, speed: 15, radius: 1.0, dmg: c.dmg, color: 0xff7a20, size: 0.9, owner: p, kb: 5, kind: 'magic', life: 1.0, trail: 0xff7a20, explode: { radius: 4.2, color: 0xff7a20 } });
      game.fx.flash(sp, 0xff9a40, { size: 2.4 }); audio.fire({ vol: 0.5, dur: 0.5 }); audio.whoosh({ vol: 0.4, pitch: 0.6, dur: 0.4 });
    },
  },
  chain: {
    dur: 0.9,
    start(game, p) { game.fx.castCircle(p.pos, 0xa0e0ff, { radius: 3, life: 0.8 }); },
    cast(game, p, c) {
      let from = p.pos.clone().setY(1.6); let cur = p; const hit = new Set(); const chainN = 10;
      let step = 0;
      const next = () => {
        let best = null, bd = step === 0 ? 12 : 7;
        for (const e of game.enemies) { if (!e.alive || e.spawning || hit.has(e)) continue; const d = Math.hypot(e.pos.x - cur.pos.x, e.pos.z - cur.pos.z); if (d < bd) { bd = d; best = e; } }
        if (!best) return;
        hit.add(best); const to = best.pos.clone().setY(1.2);
        game.fx.boltTex(from, to, 0xa0e0ff, { width: 1.8, life: 0.28 });
        game.fx.flash(to, 0xc0f0ff, { size: 2.4 }); game.fx.burst(to, 0xa0e0ff, { n: 10, speed: 7, size: 0.3 });
        if (step < 4) game.fx.light(to, 0x80c0ff, 8, 8, 0.3);
        game.damageEnemy(best, c.dmg * (1 - step * 0.05), { kind: 'magic', kb: 1, stun: 0.4, source: p, dirx: to.x - from.x, dirz: to.z - from.z, quietStop: step > 2 });
        audio.zap({ vol: 0.4, dur: 0.22 }); game.renderer.shake(0.15); if (step < 2) audio.vibe(20);
        from = to; cur = best; step++;
        if (step < chainN) game.after(0.055, next);
      };
      next(); game.renderer.flashScreen(0.3, 0xa0e0ff);
    },
  },
  blizzard: {
    dur: 1.0, total: 3.4,
    start(game, p, c) { c.data.tick = 0.3; audio.magic({ vol: 0.4, base: 587, notes: [0, 3, 7, 10, 14], step: 0.07 }); game.fx.castCircle(p.pos, 0x80e0ff, { radius: 7, life: 3.2 }); },
    update(game, p, c, dt) {
      const m = game.input.move; const spd = p.stats.spd * 0.5; p.vel.set(m.x * spd, 0, m.y * spd);
      if (c.t > 0.6 && p.actionName !== 'Spellcasting') p.play('Spellcasting', { fade: 0.2 });
      game.vacuum(p.pos, 7, 4);
      for (let i = 0; i < (game.fx.lite ? 2 : 5); i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 6.5; game.fx.glow.emit(p.pos.x + Math.cos(a) * r, 5 + Math.random() * 3, p.pos.z + Math.sin(a) * r, 0, -14, 0, new THREE.Color(0xa0e8ff), 0.35, 0.5, { grav: 20, shrink: 0.5 }); }
      c.data.tick -= dt;
      if (c.data.tick <= 0) {
        c.data.tick = 0.4; const i = c.data.n = (c.data.n || 0) + 1;
        game.hitRadius(p.pos, 6.8, c.dmg, { kb: 0.5, kind: 'magic', slow: 1.2, source: p, dirFrom: p.pos, quietStop: true });
        game.fx.shockTex(p.pos, 0xc0f0ff, { r1: 7.5, life: 0.5 });
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 4;
        game.fx.iceBurst(p.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), { size: 4, life: 0.45 });
        game.fx.burst(p.pos.clone().setY(0.3), 0xd0f4ff, { n: 20, speed: 8, size: 0.35, up: 0.6, spread: 0.6 });
        audio.ice({ vol: 0.45, dur: 0.5 }); audio.whoosh({ vol: 0.28, pitch: 1.5, dur: 0.4 }); game.renderer.shake(0.15);
      }
    },
  },
  meteor: {
    dur: 1.0, total: 3.0,
    start(game, p, c) { audio.magic({ vol: 0.5, base: 261, notes: [0, 7, 12, 19, 24, 31], step: 0.1, type: 'sawtooth' }); game.fx.castCircle(p.pos, 0xff9a40, { radius: 6, life: 1.0, demon: true }); game.fx.firePillar(p.pos, { height: 8, width: 2, life: 0.9, color: 0xff9a40 }); },
    cast(game, p, c) {
      const focus = densest(game, p, 15, 5) || fwd(p, 4);
      const pts = [];
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + Math.random(); const r = i === 0 ? 0 : 1.5 + Math.random() * 4; pts.push(focus.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r))); }
      pts.forEach((pt, i) => game.after(i * 0.19, () => {
        const orb = game.fx.orb(0xff6a20, 1.3); const start = pt.clone().add(new THREE.Vector3(6, 18, 4)); orb.position.copy(start); game.scene.add(orb);
        game.fx.castCircle(pt, 0xff6a20, { radius: 4, life: 0.5, demon: true });
        game.fx.add(orb, 0.4, (k) => { orb.position.lerpVectors(start, pt, k * k); game.fx.embers(orb.position, 0xff8a30, { n: 3, radius: 0.4, life: 0.5, rise: 1 }); });
        game.after(0.4, () => {
          game.vacuum(pt, 6, 8);
          game.hitRadius(pt, 4.2, c.dmg, { kb: 7, kind: 'magic', up: true, source: p, dirFrom: pt, quietStop: i > 1 });
          game.fx.explosion(pt, { size: 7, color: 0xffa060, life: 0.55 });
          game.fx.shockTex(pt, 0xffa040, { r1: 6, life: 0.5 });
          game.fx.burst(pt.clone().setY(0.5), 0xff8a30, { n: 26, speed: 12, size: 0.5, up: 1.3, grav: 16 });
          game.fx.dustPuff(pt, { size: 5 }); if (i < 3) game.fx.light(pt, 0xff7a20, 14, 14, 0.6); game.fx.scorch(pt, { radius: 3.2, life: 6 });
          game.renderer.shake(0.7); game.renderer.punch(0.6); if (i === 0) game.renderer.flashScreen(0.3, 0xffa060); game.timeCtl.hitstop(0.05);
          audio.boom({ vol: 0.85, dur: 0.7, low: 50 }); audio.vibe([50, 20, 50]);
        });
      }));
      game.after(1.7, () => game.timeCtl.slowmo(0.4, 0.4));
    },
  },

  // ================= 암살자 (그림자 · 관통 몹몰이) =================
  shadow_dash: {
    dur: 0.6, total: 0.6,
    start(game, p, c) {
      const t = densest(game, p, 13, 3.5); if (t) p.face(t.x, t.z);
      const f = p.forward(new THREE.Vector3()); p.vel.copy(f).multiplyScalar(28); p.invuln = 0.6; c.data.hit = new Set(); c.data.g = 0;
      audio.whoosh({ vol: 0.7, pitch: 0.5, dur: 0.5 }); game.fx.dustPuff(p.pos, { size: 2.5, life: 0.5 }); game.fx.flash(p.pos.clone().setY(1), 0xb26bff, { size: 3.5 });
      game.renderer.aberr = 0.9; game.renderer.radial = 0.4; audio.vibe(30);
    },
    update(game, p, c, dt) {
      c.data.g += dt; if (c.data.g > 0.035) { c.data.g = 0; game.fx.ghost(p.model, 0xb26bff, { life: 0.35, opacity: 0.6 }); game.fx.embers(p.pos, 0xb26bff, { n: 3, radius: 0.5, life: 0.5 }); }
      for (const e of game.enemies) { if (!e.alive || c.data.hit.has(e)) continue; if (p.distTo(e) < 2.6) { c.data.hit.add(e); game.damageEnemy(e, c.dmg, { kind: 'slash', kb: 2, stun: 0.5, source: p, dirx: p.vel.x, dirz: p.vel.z, quietStop: c.data.hit.size > 2 }); game.fx.slashSprite(e.pos.clone().setY(1.1), p.forward(new THREE.Vector3()), 0xd0a0ff, { size: 3, life: 0.22, tilt: -1.2 }); } }
      if (c.t > 0.42) p.vel.multiplyScalar(Math.pow(0.001, dt));
    },
    end(game, p, c) { p.vel.set(0, 0, 0); game.fx.slashSprite(p.pos.clone().setY(1.1), p.forward(new THREE.Vector3()), 0xd0a0ff, { size: 4.5, life: 0.3, tilt: -1.4 }); game.fx.shockTex(p.pos, 0xb26bff, { r1: 4, life: 0.3 }); audio.whoosh({ vol: 0.5, pitch: 1.4, dur: 0.2 }); },
  },
  poison_bomb: {
    dur: 0.8, total: 0.8,
    cast(game, p, c) {
      const target = densest(game, p, 13, 3.5) || fwd(p, 5);
      const orb = game.fx.orb(0x60ff80, 0.6); const start = p.pos.clone().setY(1.5); game.scene.add(orb);
      const fl = 0.5;
      game.fx.add(orb, fl, (k) => { orb.position.lerpVectors(start, target, k); orb.position.y = 1.5 + Math.sin(k * Math.PI) * 4; });
      audio.whoosh({ vol: 0.3, pitch: 1.5, dur: 0.3 });
      game.after(fl, () => {
        audio.play('hit_glass', { vol: 0.7, rate: 0.8 }); audio.fire({ vol: 0.3, dur: 0.8 });
        game.fx.explosion(target, { size: 5, color: 0x80ff90, life: 0.5 });
        game.fx.castCircle(target, 0x60ff80, { radius: 4.5, life: 4.2, demon: true });
        let ticks = 9; const tick = () => {
          if (ticks-- <= 0) return;
          game.vacuum(target, 5, 3);
          game.hitRadius(target, 4.2, c.dmg, { kb: 0, kind: 'magic', poison: true, source: p, dirFrom: target, quiet: true });
          for (let i = 0; i < (game.fx.lite ? 4 : 9); i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 4; game.fx.smoke.emit(target.x + Math.cos(a) * r, 0.3, target.z + Math.sin(a) * r, 0, 0.8, 0, new THREE.Color(0x3aa050), 2.4, 1.2, { grav: -0.4, drag: 0.95, shrink: 1.6 }); }
          game.fx.embers(target, 0x80ff90, { n: 6, radius: 3, life: 0.9, rise: 1.5 });
          game.after(0.45, tick);
        }; tick();
      });
    },
  },
  flurry: {
    dur: 1.4, total: 1.4,
    start(game, p, c) { c.data.tick = 0; c.data.n = 0; p.startTrail(); game.fx.castCircle(p.pos, 0xb26bff, { radius: 3, life: 1.3 }); const e = p.nearestEnemy(9); if (e) { p.face(e.pos.x, e.pos.z); if (p.distTo(e) > 2.2) p.vel.copy(p.forward(new THREE.Vector3())).multiplyScalar((p.distTo(e) - 1.8) / 0.3); } },
    update(game, p, c, dt) {
      if (c.t > 0.3) p.vel.set(0, 0, 0);
      game.vacuum(p.pos, 4.5, 6);
      c.data.tick -= dt;
      if (c.data.tick <= 0 && c.data.n < 10) {
        c.data.tick = 0.115; const i = c.data.n++;
        const anims = ['Dualwield_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Chop']; p.playTimed(anims[i % 3], 0.24, { fade: 0.03 });
        game.hitArea(p, p.pos, p.yaw, 3.4, 150, c.dmg, { kb: 0.6, kind: 'slash', source: p, quietStop: true });
        game.fx.slashSprite(p.pos.clone().setY(0.9 + (i % 3) * 0.35), p.forward(new THREE.Vector3()), 0xd0a0ff, { size: 3.2, life: 0.18, tilt: (i % 2 ? 0.6 : -1.6), flip: i % 2 === 1 });
        if (i % 2 === 0) game.fx.ghost(p.model, 0xb26bff, { life: 0.25, opacity: 0.4 });
        audio.whoosh({ vol: 0.32, pitch: 1.3 + i * 0.07, dur: 0.12 });
        if (i === 9) { game.hitArea(p, p.pos, p.yaw, 4, 180, c.dmg * 2.5, { kb: 6, kind: 'slash', finisher: true, source: p }); game.fx.explosion(fwd(p, 1.5), { size: 5, color: 0xd0a0ff, life: 0.4 }); game.fx.shockTex(p.pos, 0xb26bff, { r1: 5, life: 0.4 }); game.renderer.shake(0.5); game.timeCtl.hitstop(0.08); }
      }
    },
    end(game, p) { p.stopTrail(); },
  },
  thousand: {
    dur: 1.0, total: 3.0,
    start(game, p, c) { audio.magic({ vol: 0.5, base: 293, notes: [0, 3, 7, 10, 12, 15, 19], step: 0.08, type: 'triangle' }); game.fx.castCircle(p.pos, 0xb26bff, { radius: 7, life: 1.0, demon: true }); game.fx.firePillar(p.pos, { height: 9, width: 2.2, life: 1.0, color: 0xb26bff }); game.fx.embers(p.pos, 0xd0a0ff, { n: 40, radius: 1.5, life: 1.4, rise: 6 }); },
    cast(game, p, c) {
      let wave = 0;
      const tick = () => {
        if (wave++ >= 12) { game.fx.shockTex(p.pos, 0xb26bff, { r1: 15, life: 0.8 }); game.fx.explosion(p.pos, { size: 10, color: 0xd0a0ff, life: 0.6 }); game.renderer.shake(0.8); game.timeCtl.slowmo(0.35, 0.5); audio.boom({ vol: 0.7, dur: 0.7 }); return; }
        game.vacuum(p.pos, 12, 7);
        const ts = targets(game, p, 5, 10); const pts = ts.length ? ts.map((e) => e.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5))) : [fwd(p, 3 + Math.random() * 3)];
        for (const pt of pts) {
          const dir = new THREE.Vector3(0.15, -1, 0.1).normalize(); const sp = pt.clone().add(new THREE.Vector3(-1.2, 8, -0.8));
          game.fx.slashSprite(sp, dir, 0xd0a0ff, { size: 2.2, life: 0.16, speed: 52, tilt: 0 });
          game.after(0.13, () => { game.hitRadius(pt, 2.2, c.dmg, { kb: 1.5, kind: 'slash', source: p, dirFrom: pt, quietStop: true }); game.fx.burst(pt.clone().setY(0.4), 0xd0a0ff, { n: 8, speed: 7, size: 0.3 }); game.fx.flash(pt.clone().setY(0.6), 0xe0c0ff, { size: 2.2, life: 0.15 }); game.fx.shockTex(pt, 0xb26bff, { r1: 2.4, life: 0.28 }); audio.clang({ vol: 0.32, freq: 2600, dur: 0.25 }); game.renderer.shake(0.12); });
        }
        audio.whoosh({ vol: 0.28, pitch: 1.6, dur: 0.15 });
        game.after(0.15, tick);
      }; tick();
      game.renderer.flashScreen(0.4, 0xd0a0ff); game.renderer.aberr = 1;
    },
  },
  // ================================================================
  // 각성 스킬 — 레벨 구간 해금 (Lv.10 / Lv.20)
  // 규칙: 각성기는 기존 스킬에 없는 '새 동사' 를 하나씩 가진다.
  //   결박 / 경계장판 / 밀어모으기 / 순차분출+균열 / 반사투사체 / 시간정지 / 분신표식 / 순간이동연쇄
  // ================================================================

  // ── 검성 Lv.10 : 결박 (끌어와 묶고, 사슬이 끊기며 터진다) ──
  chain_bind: {
    dur: 0.85,
    start(game, p, c) {
      game.fx.castCircle(p.pos, 0xffe08a, { radius: 5.5, life: 0.85 });
      audio.magic({ vol: 0.4, base: 440, notes: [0, 5, 9, 12], step: 0.05 });
      c.data.bound = [];
    },
    cast(game, p, c) {
      const ts = targets(game, p, 8, 12);
      c.data.bound = ts;
      game.vacuum(p.pos, 12, 30);
      const chest = () => p.pos.clone().setY(1.5);
      ts.forEach((e, i) => game.after(i * 0.045, () => {
        if (!e.alive) return;
        game.fx.boltTex(chest(), e.pos.clone().setY(1.0), 0xffe08a, { width: 2.4, life: 0.55 });
        game.fx.castCircle(e.pos, 0xffd060, { radius: 1.7, life: 1.9 });
        e.stun = Math.max(e.stun, 2.0 * (e.isBoss ? 0.35 : 1));
        game.damageEnemy(e, c.dmg * 0.45, { kind: 'magic', kb: 0, source: p, quietStop: i > 1 });
        audio.clang({ vol: 0.28, freq: 1700 + i * 130, dur: 0.22 });
      }));
      game.renderer.flashScreen(0.26, 0xfff0c0); game.renderer.shake(0.35); audio.vibe([20, 20, 40]);
      // 결박 유지 — 사슬이 1.4초간 계속 조인다
      let n = 12;
      const hold = () => {
        if (n-- <= 0 || !game.active) return;
        game.vacuum(p.pos, 12, 11);
        for (const e of c.data.bound) if (e.alive) { e.stun = Math.max(e.stun, 0.45); if (n % 3 === 0) game.fx.boltTex(chest(), e.pos.clone().setY(1.0), 0xffd060, { width: 1.2, life: 0.16 }); }
        game.after(0.12, hold);
      }; game.after(0.25, hold);
      // 사슬 파열
      game.after(1.75, () => {
        if (!game.active) return;
        const center = p.pos.clone();
        for (const e of c.data.bound) if (e.alive) game.fx.boltTex(center.clone().setY(1.4), e.pos.clone().setY(1), 0xffffff, { width: 3.2, life: 0.2 });
        game.hitRadius(center, 7.5, c.dmg, { kb: 10, kind: 'magic', up: true, source: p, dirFrom: center });
        game.fx.shockTex(center, 0xffe08a, { r1: 9.5, life: 0.55 });
        game.fx.holyBurst(center, { size: 9, life: 0.45 });
        game.fx.burst(center.clone().setY(0.8), 0xfff0c0, { n: 46, speed: 13, size: 0.45, up: 1.1 });
        game.fx.light(center, 0xffd060, 15, 16, 0.5);
        game.renderer.shake(0.8); game.renderer.punch(1); game.timeCtl.hitstop(0.1); game.renderer.flashScreen(0.35, 0xfff0c0);
        audio.boom({ vol: 0.9, dur: 0.7, low: 60 }); audio.holy({ vol: 0.4, base: 660, dur: 0.8 }); audio.vibe([60, 30, 90]);
      });
    },
  },

  // ── 검성 Lv.20 : 성역 (경계 밖으로 못 나간다 + 내 피해 감소) ──
  sanctuary: {
    dur: 1.0,
    start(game, p) { game.fx.castCircle(p.pos, 0xfff3b0, { radius: 7, life: 1.0 }); audio.magic({ vol: 0.45, base: 523, notes: [0, 4, 7, 12], step: 0.08 }); },
    cast(game, p, c) {
      const center = p.pos.clone().setY(0); const R = 8.0, LIFE = 7.0;
      p.dr = 0.35; p.drT = LIFE; p.sanctum = { pos: center, r: R };
      // 지면 성역 + 회전 룬
      game.fx.groundTex(center, 'circle_gold', 0xffe08a, { r0: R * 0.2, r1: R, life: LIFE, spin: 0.5, y: 0.07, fadeIn: 0.3, hold: LIFE - 1.2 });
      game.fx.castCircle(center, 0xffd060, { radius: R * 0.55, life: LIFE });
      // 경계 빛기둥 8개
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const at = center.clone().add(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
        game.after(i * 0.05, () => game.fx.firePillar(at, { height: 6.5, width: 1.1, life: LIFE * 0.9, color: 0xfff0c0 }));
      }
      game.fx.light(center, 0xffd060, 12, 18, 0.8);
      game.renderer.flashScreen(0.3, 0xfff0c0); game.renderer.shake(0.4);
      audio.holy({ vol: 0.5, base: 523, dur: 1.4 }); audio.boom({ vol: 0.5, dur: 0.5, low: 80 }); audio.vibe([40, 30, 60]);
      let t = 0, ticks = Math.round(LIFE / 0.5);
      const tick = () => {
        if (ticks-- <= 0 || !game.active) { p.sanctum = null; p.dr = 0; p.drT = 0; return; }
        t += 0.5;
        // 경계: 밖으로 나가려는 적을 안으로 밀어 넣는다 (진공이 아니라 '벽')
        for (const e of game.enemies) {
          if (!e.alive || e.spawning) continue;
          const dx = e.pos.x - center.x, dz = e.pos.z - center.z, d = Math.hypot(dx, dz);
          if (d > R - 1.2 && d < R + 3.5) { e.pull(center.x, center.z, 16); if (Math.random() < 0.4) game.fx.flash(e.pos.clone().setY(1.1), 0xfff0c0, { size: 1.8, life: 0.16 }); }
        }
        game.hitRadius(center, R, c.dmg, { kb: 0, kind: 'magic', source: p, dirFrom: center, quiet: true });
        const a = Math.random() * Math.PI * 2, r = Math.random() * R;
        game.fx.holyBurst(center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), { size: 3, life: 0.35 });
        game.fx.embers(center, 0xfff0c0, { n: 6, radius: R * 0.8, life: 1.2, rise: 3 });
        audio.holy({ vol: 0.14, base: 784, dur: 0.4 });
        game.after(0.5, tick);
      }; tick();
      game.ui.toast('성역 전개 — 받는 피해 35% 감소', 'gold');
    },
  },

  // ── 광전사 Lv.10 : 밀어 모으기 (당기지 않고 앞으로 민다) ──
  bull_rush: {
    dur: 0.75, total: 0.75,
    start(game, p, c) {
      const t = densest(game, p, 14, 4); if (t) p.face(t.x, t.z);
      const f = p.forward(new THREE.Vector3());
      // 무적은 스킬 길이(0.75)만큼. 짧으면 끝자락에 무방비로 무리 한가운데 선다
      p.vel.copy(f).multiplyScalar(21); p.invuln = 0.8; c.data.hit = new Map(); c.data.g = 0;
      p.startTrail();
      game.fx.dustPuff(p.pos, { size: 3.2, life: 0.6 }); game.fx.firePillar(p.pos, { height: 4, width: 1.6, life: 0.4, color: 0xff7a30 });
      game.renderer.aberr = 0.8; game.renderer.radial = 0.45;
      audio.whoosh({ vol: 0.7, pitch: 0.45, dur: 0.6 }); audio.fire({ vol: 0.4, dur: 0.6 }); audio.vibe(35);
    },
    update(game, p, c, dt) {
      c.data.g += dt;
      if (c.data.g > 0.04) { c.data.g = 0; game.fx.ghost(p.model, 0xff7a30, { life: 0.3, opacity: 0.5 }); game.fx.embers(p.pos, 0xff8a40, { n: 4, radius: 0.7, life: 0.5, rise: 2 }); game.fx.dust(p.pos, { n: 3, size: 1.4 }); }
      const f = p.forward(_v);   // 프레임 루프에서 할당하지 않는다
      for (const e of game.enemies) {
        if (!e.alive || e.spawning) continue;
        const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z; const d = Math.hypot(dx, dz);
        if (d > 3.6) continue;
        const ahead = (dx * f.x + dz * f.z) > -0.8;
        if (!ahead) continue;
        // 불도저 — 앞으로 밀어서 끌고 간다 (진공의 반대)
        e.pull(p.pos.x + f.x * 6, p.pos.z + f.z * 6, 15 * dt * 60);   // 프레임당 힘 — dt 보정만 하고 크기는 회오리(7/프레임) 기준
        e.stun = Math.max(e.stun, 0.25);
        const n = (c.data.hit.get(e) || 0);
        if (n < 3 && c.t > n * 0.2) {
          c.data.hit.set(e, n + 1);
          game.damageEnemy(e, c.dmg * 0.32, { kind: 'blunt', kb: 0, source: p, dirx: f.x, dirz: f.z, quietStop: true });
          game.fx.flash(e.pos.clone().setY(1.1), 0xffb070, { size: 2, life: 0.14 });
        }
      }
      if (c.t > 0.55) p.vel.multiplyScalar(Math.pow(0.002, dt));
    },
    end(game, p, c) {
      p.vel.set(0, 0, 0); p.stopTrail();
      const center = fwd(p, 2.4);
      game.hitRadius(center, 6.2, c.dmg, { kb: 13, kind: 'blunt', up: true, stun: 0.7, source: p, dirFrom: p.pos });
      game.fx.explosion(center, { size: 9, color: 0xffa060, life: 0.6 });
      game.fx.shockTex(center, 0xff8a40, { r1: 8, life: 0.5 });
      game.fx.scorch(center, { radius: 4, life: 5 }); game.fx.dustPuff(center, { size: 7, life: 1.1 });
      game.fx.burst(center.clone().setY(0.6), 0xff8040, { n: 44, speed: 14, size: 0.5, up: 1.4, grav: 18 });
      game.fx.light(center, 0xff8040, 14, 15, 0.5);
      game.renderer.shake(0.9); game.renderer.punch(1.1); game.timeCtl.hitstop(0.12); game.renderer.flashScreen(0.28, 0xffa060);
      audio.boom({ vol: 0.95, dur: 0.7, low: 50 }); audio.play('hit_mining', { vol: 0.9, rate: 0.75 }); audio.vibe([70, 30, 100]);
    },
  },

  // ── 광전사 Lv.20 : 순차 분출 + 남는 균열 장판 ──
  magma_zone: {
    dur: 0.95,
    start(game, p) { game.fx.castCircle(p.pos, 0xff6a20, { radius: 6, life: 0.95, demon: true }); audio.charge({ vol: 0.4, dur: 0.8 }); audio.fire({ vol: 0.4, dur: 0.9 }); },
    cast(game, p, c) {
      const center = p.pos.clone().setY(0);
      // 1) 주변에 기둥이 차례로 솟는다 — 맞은 적은 뜬다
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        const at = center.clone().add(new THREE.Vector3(Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6));
        game.after(i * 0.11, () => {
          game.fx.firePillar(at, { height: 9, width: 2.2, life: 0.55, color: 0xff7a30 });
          game.fx.castCircle(at, 0xff5020, { radius: 2.6, life: 0.4, demon: true });
          game.hitRadius(at, 2.9, c.dmg, { kb: 3, kind: 'magic', up: true, source: p, dirFrom: at, quietStop: i > 1 });
          game.fx.burst(at.clone().setY(0.4), 0xff8a40, { n: 20, speed: 11, size: 0.45, up: 1.6, grav: 16 });
          game.fx.embers(at, 0xff6020, { n: 14, radius: 1.4, life: 1.4, rise: 5 });
          if (i < 3) game.fx.light(at, 0xff7020, 12, 12, 0.4);
          game.renderer.shake(0.45); audio.fire({ vol: 0.45, dur: 0.4 }); audio.thump({ vol: 0.5, freq: 70 - i * 4, dur: 0.3 });
        });
      }
      // 2) 갈라진 균열이 9초 남는다 — 밟고 있으면 계속 지진다
      game.after(0.75, () => {
        if (!game.active) return;
        const LIFE = 9;
        game.fx.scorch(center, { radius: 6.4, life: LIFE + 1 });
        game.fx.groundTex(center, 'circle_demon', 0xff5a20, { r0: 1, r1: 6.4, life: LIFE, spin: -0.35, y: 0.06, fadeIn: 0.2, hold: LIFE - 1.5 });
        game.fx.shockTex(center, 0xff6a20, { r1: 7.5, life: 0.6 });
        game.renderer.shake(0.7); game.renderer.punch(0.8); audio.boom({ vol: 0.8, dur: 0.8, low: 45 }); audio.vibe([60, 40, 80]);
        let n = Math.round(LIFE / 0.55);
        const tick = () => {
          if (n-- <= 0 || !game.active) return;
          game.hitRadius(center, 6.4, c.dmg * 0.28, { kb: 0.4, kind: 'magic', slow: 0.8, source: p, dirFrom: center, quiet: true });
          const a = Math.random() * Math.PI * 2, r = Math.random() * 6;
          const at = center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
          game.fx.embers(at, 0xff7a30, { n: 5, radius: 1, life: 1.1, rise: 3.5 });
          if (n % 3 === 0) { game.fx.firePillar(at, { height: 3.4, width: 1.0, life: 0.35, color: 0xff8a40 }); audio.fire({ vol: 0.18, dur: 0.3 }); }
          game.after(0.55, tick);
        }; tick();
      });
    },
  },

  // ── 대마도사 Lv.10 : 반사 투사체 (적과 벽을 튕기며 커진다) ──
  arc_reflect: {
    dur: 0.6,
    start(game, p) { game.fx.castCircle(p.pos, 0xa0d8ff, { radius: 2.8, life: 0.55 }); audio.magic({ vol: 0.35, base: 880, notes: [0, 7, 12], step: 0.04 }); },
    cast(game, p, c) {
      const state = { pos: fwd(p, 1.2).setY(1.3), dir: p.forward(new THREE.Vector3()), bounces: 0, hit: new Set(), acc: 0 };
      const MAXB = 12, SPEED = 30;
      const prev = new THREE.Vector3();
      const lance = game.fx.orb(0x9fd8ff, 0.55); lance.position.copy(state.pos);
      lance.userData.core.userData.ownGeo = true;   // fx 가 정리할 수 있게 표시 (안 하면 캐스트마다 지오메트리가 샌다)
      const disposeLance = () => { lance.userData.core.material.dispose(); lance.userData.halo.material.dispose(); };

      audio.zap({ vol: 0.5, dur: 0.3 });
      game.fx.add(lance, 2.6, (k, t, dt) => {
        if (state.done) return;
        prev.copy(state.pos);
        state.pos.addScaledVector(state.dir, SPEED * dt);
        lance.position.copy(state.pos);
        game.fx.boltTex(prev, state.pos, 0xbfeaff, { width: 0.9, life: 0.14 });
        // 적 반사
        let bounced = false;
        for (const e of game.enemies) {
          if (!e.alive || e.spawning || state.hit.has(e)) continue;
          if (Math.hypot(e.pos.x - state.pos.x, e.pos.z - state.pos.z) > 1.7) continue;
          state.hit.add(e); state.bounces++;
          const mul = 1 + state.bounces * 0.22;
          game.damageEnemy(e, c.dmg * mul, { kind: 'magic', kb: 2.2, source: p, dirx: state.dir.x, dirz: state.dir.z, quietStop: state.bounces > 2 });
          game.fx.flash(e.pos.clone().setY(1.2), 0xdff4ff, { size: 2.6, life: 0.18 });
          game.fx.burst(e.pos.clone().setY(1.1), 0xbfeaff, { n: 12, speed: 8, size: 0.3 });
          game.fx.shockTex(e.pos, 0x9fd8ff, { r1: 2.4, life: 0.25 });
          audio.clang({ vol: 0.3, freq: 1400 + state.bounces * 180, dur: 0.2 });
          // 다음 적을 향해 굴절
          let best = null, bd = 15;
          for (const o of game.enemies) { if (!o.alive || o.spawning || state.hit.has(o)) continue; const d = Math.hypot(o.pos.x - state.pos.x, o.pos.z - state.pos.z); if (d < bd) { bd = d; best = o; } }
          if (best) state.dir.set(best.pos.x - state.pos.x, 0, best.pos.z - state.pos.z).normalize();
          else state.dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), 2.1 + Math.random());
          bounced = true; break;
        }
        // 벽 반사 — 탐침은 실제 스텝 크기로, 반사 뒤엔 벽에서 떼어 놓는다.
        // 제자리에서 튕기면 12회를 0.2초에 다 태우고 아무것도 못 맞힌 채 끝난다
        if (!bounced && game.world && !game.world.walkable(state.pos.x, state.pos.z)) {
          const step = Math.max(0.35, SPEED * dt);
          state.pos.copy(prev); state.bounces++;
          const bx = !game.world.walkable(prev.x + state.dir.x * step, prev.z);
          const bz = !game.world.walkable(prev.x, prev.z + state.dir.z * step);
          if (bx) state.dir.x = -state.dir.x;
          if (bz) state.dir.z = -state.dir.z;
          if (!bx && !bz) state.dir.negate();                       // 오목한 구석: 되돌아 나온다
          state.pos.addScaledVector(state.dir, step * 1.2);          // 벽에서 떼어 놓기
          if (!game.world.walkable(state.pos.x, state.pos.z)) state.pos.copy(p.pos).setY(1.3);   // 그래도 벽 안이면 시전자에게 회수
          game.fx.flash(state.pos, 0xdff4ff, { size: 2.2, life: 0.16 });
          game.fx.shockTex(_v.copy(state.pos).setY(0), 0x9fd8ff, { r1: 2, life: 0.22 });
          audio.play('ui_pluck', { vol: 0.3, rate: 1.6 });
        }
        if (state.bounces >= MAXB) {
          game.hitRadius(state.pos, 4.5, c.dmg * 2.4, { kb: 8, kind: 'magic', up: true, source: p, dirFrom: state.pos });
          game.fx.explosion(state.pos, { size: 7, color: 0xbfeaff, life: 0.5 });
          game.fx.shockTex(state.pos.clone().setY(0), 0x9fd8ff, { r1: 6, life: 0.5 });
          game.fx.burst(state.pos.clone(), 0xdff4ff, { n: 36, speed: 13, size: 0.4 });
          game.renderer.shake(0.6); game.timeCtl.hitstop(0.08); audio.boom({ vol: 0.7, dur: 0.5, low: 90 }); audio.vibe([40, 20, 60]);
          state.done = true; lance.visible = false;
        }
      }, disposeLance);
      game.renderer.flashScreen(0.2, 0xbfeaff);
    },
  },

  // ── 대마도사 Lv.20 : 시간 정지 + 각인 (멈춘 동안 준 피해가 해제 순간 터진다) ──
  chrono_seal: {
    dur: 1.0,
    start(game, p) { game.fx.castCircle(p.pos, 0xc0d8ff, { radius: 8, life: 1.0 }); audio.magic({ vol: 0.5, base: 392, notes: [0, 5, 10, 14, 19], step: 0.09, type: 'triangle' }); audio.charge({ vol: 0.4, dur: 0.9 }); },
    cast(game, p, c) {
      const center = p.pos.clone(); const R = 9.5, FREEZE = 3.0;
      const sealed = game.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < R).slice(0, 24).map((e) => ({ e, hp: e.hp }));
      game.fx.groundTex(center, 'circle_demon', 0xc0d8ff, { r0: 1, r1: R, life: FREEZE + 0.5, spin: -1.2, y: 0.07, fadeIn: 0.1, hold: FREEZE });
      game.fx.shockTex(center, 0xdfe8ff, { r1: R + 1.5, life: 0.6 });
      game.renderer.flashScreen(0.5, 0xdfe8ff); game.renderer.aberr = 1.3; game.renderer.shake(0.5);
      game.timeCtl.slowmo(0.25, 0.5);
      audio.ice({ vol: 0.6, dur: 0.9 }); audio.dark({ vol: 0.35, base: 90, dur: 1.2 }); audio.vibe([80, 40, 40]);
      for (const s of sealed) {
        s.e.stun = Math.max(s.e.stun, FREEZE * (s.e.isBoss ? 0.4 : 1));
        game.fx.iceBurst(s.e.pos, { size: 3, life: 0.4 });
        game.fx.castCircle(s.e.pos, 0xc0d8ff, { radius: 1.4, life: FREEZE });
      }
      game.ui.toast(`시간 봉인 — ${sealed.length}명 정지`, 'gold');
      // 정지 유지 (넉백까지 얼린다)
      let n = Math.round(FREEZE / 0.1);
      const hold = () => {
        if (n-- <= 0 || !game.active) return;
        for (const s of sealed) { if (!s.e.alive) continue; s.e.kb.set(0, 0, 0); s.e.vel.set(0, 0, 0); s.e.stun = Math.max(s.e.stun, 0.3); }
        if (n % 6 === 0) for (const s of sealed) if (s.e.alive) game.fx.embers(s.e.pos, 0xc0d8ff, { n: 2, radius: 0.6, life: 0.6, rise: 1.2 });
        game.after(0.1, hold);
      }; hold();
      // 해제 — 각인된 피해가 터진다
      game.after(FREEZE, () => {
        if (!game.active) return;
        game.renderer.flashScreen(0.45, 0xdfe8ff); game.timeCtl.slowmo(0.35, 0.5); game.renderer.shake(0.9); game.renderer.punch(1.2);
        audio.boom({ vol: 1, dur: 0.9, low: 55 }); audio.shatter({ vol: 0.7 }); audio.vibe([90, 40, 120]);
        sealed.forEach((s, i) => game.after(i * 0.05, () => {
          const taken = Math.max(0, s.hp - (s.e.alive ? s.e.hp : 0));
          const at = s.e.pos.clone();
          game.fx.explosion(at, { size: 6, color: 0xdfe8ff, life: 0.5 });
          game.fx.iceBurst(at, { size: 5, life: 0.45 });
          game.fx.burst(at.clone().setY(0.8), 0xc0d8ff, { n: 22, speed: 11, size: 0.4 });
          game.hitRadius(at, 3.8, c.dmg + taken * 0.75, { kb: 7, kind: 'magic', up: true, source: p, dirFrom: at, quietStop: i > 1 });
          if (i < 3) game.fx.light(at, 0xc0d8ff, 12, 12, 0.4);
          audio.ice({ vol: 0.35, dur: 0.4 }); game.renderer.shake(0.25);
        }));
      });
    },
  },

  // ── 암살자 Lv.10 : 표식 + 분신 순간이동 참격 ──
  shadow_mark: {
    dur: 0.7,
    start(game, p) { game.fx.castCircle(p.pos, 0xb26bff, { radius: 4, life: 0.7 }); audio.dark({ vol: 0.4, base: 180, dur: 0.6 }); },
    cast(game, p, c) {
      const ts = targets(game, p, 8, 13);
      if (!ts.length) { game.fx.shockTex(p.pos, 0xb26bff, { r1: 5, life: 0.4 }); return; }
      for (const e of ts) { game.fx.castCircle(e.pos, 0xb26bff, { radius: 1.5, life: 1.5, demon: true }); game.fx.embers(e.pos, 0xd0a0ff, { n: 8, radius: 0.8, life: 0.9, rise: 2 }); }
      audio.whoosh({ vol: 0.5, pitch: 0.8, dur: 0.4 });
      // 분신 3체가 표식을 차례로 친다
      ts.forEach((e, i) => game.after(0.18 + i * 0.09, () => {
        if (!e.alive) return;
        const side = (i % 3) - 1;
        const at = e.pos.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 1.6, 0, Math.sin(i * 2.1) * 1.6));
        game.fx.ghost(p.model, 0xb26bff, { life: 0.32, opacity: 0.55, at });
        game.fx.slashSprite(e.pos.clone().setY(1.1), new THREE.Vector3(e.pos.x - at.x, 0, e.pos.z - at.z).normalize(), 0xd0a0ff, { size: 3.4, life: 0.2, tilt: side * 1.2 });
        game.damageEnemy(e, c.dmg, { kind: 'slash', kb: 1.2, source: p, dirx: e.pos.x - at.x, dirz: e.pos.z - at.z, quietStop: i > 1 });
        game.fx.flash(e.pos.clone().setY(1.2), 0xe0c0ff, { size: 2.2, life: 0.16 });
        audio.hit('slash', { heavy: i % 3 === 0 }); if (i < 3) audio.vibe(15);
        game.renderer.shake(0.18);
      }));
      // 표식 폭발 — 서로를 끌어당기며 터진다 (표식끼리 뭉친다)
      game.after(0.18 + ts.length * 0.09 + 0.25, () => {
        if (!game.active) return;
        const alive = ts.filter((e) => e.alive);
        if (!alive.length) return;
        const hub = alive.reduce((a, e) => a.add(e.pos), new THREE.Vector3()).multiplyScalar(1 / alive.length);
        for (const e of alive) game.fx.boltTex(e.pos.clone().setY(1), hub.clone().setY(1), 0xb26bff, { width: 1.4, life: 0.28 });
        game.vacuum(hub, 14, 26);
        game.after(0.18, () => {
          game.hitRadius(hub, 5.5, c.dmg * 1.6, { kb: 6, kind: 'slash', up: true, source: p, dirFrom: hub });
          game.fx.texFlash(hub, 'singularity', 0xb26bff, { size: 9, life: 0.5, spin: 0.6, grow: 1.5, y: 0.6 });
          game.fx.explosion(hub, { size: 7, color: 0xd0a0ff, life: 0.5 });
          game.fx.shockTex(hub, 0xb26bff, { r1: 6.5, life: 0.5 });
          game.fx.burst(hub.clone().setY(0.8), 0xd0a0ff, { n: 40, speed: 12, size: 0.42 });
          game.renderer.shake(0.7); game.renderer.punch(0.9); game.timeCtl.hitstop(0.1); game.renderer.flashScreen(0.3, 0xd0a0ff);
          audio.boom({ vol: 0.8, dur: 0.6, low: 70 }); audio.dark({ vol: 0.4, base: 120, dur: 0.6 }); audio.vibe([60, 30, 80]);
        });
      });
    },
  },

  // ── 암살자 Lv.20 : 무적 잠수 + 순간이동 연쇄 ──
  void_step: {
    dur: 0.45, total: 2.0,
    start(game, p, c) {
      c.data.n = 0; c.data.tick = 0; c.data.last = null;
      p.invuln = 2.1; p.startTrail();
      for (const m of p.mats) { m.transparent = true; m.opacity = 0.35; }
      game.fx.texFlash(p.pos, 'singularity', 0x8a4aff, { size: 8, life: 0.5, spin: 0.8, grow: 1.4, y: 0.5 });
      game.fx.shockTex(p.pos, 0x8a4aff, { r1: 5, life: 0.4 });
      game.renderer.aberr = 1.1; game.renderer.radial = 0.5; game.renderer.desat = 0.45;
      audio.dark({ vol: 0.6, base: 70, dur: 1.4 }); audio.suck({ vol: 0.4, dur: 1.2 }); audio.vibe([60, 30, 30]);
    },
    update(game, p, c, dt) {
      p.vel.set(0, 0, 0);
      c.data.tick -= dt;
      if (c.data.tick > 0 || c.data.n >= 12) return;
      c.data.tick = 0.13;
      const list = game.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < 18);
      if (!list.length) { c.data.n++; return; }
      const e = list[(c.data.n * 3 + 1) % list.length];
      const from = p.pos.clone();
      const a = Math.random() * Math.PI * 2;
      const at = _v.set(e.pos.x + Math.cos(a) * 1.5, 0, e.pos.z + Math.sin(a) * 1.5);
      // 순간이동 — 반드시 걸을 수 있는 칸으로. 벽 안으로 뛰면 resolve 가 못 빼내서 층이 끝날 때까지 갇힌다
      const W = game.world;
      if (W && !W.walkable(at.x, at.z)) { at.set(e.pos.x, 0, e.pos.z); if (!W.walkable(at.x, at.z)) { c.data.n++; return; } }
      game.fx.ghost(p.model, 0x8a4aff, { life: 0.28, opacity: 0.5 });
      p.pos.set(at.x, 0, at.z); p.face(e.pos.x, e.pos.z);
      p.playTimed(c.data.n % 2 ? 'Dualwield_Melee_Attack_Slice' : 'Dualwield_Melee_Attack_Stab', 0.2, { fade: 0.03 });   // dur(0.5) 로 한 번 재생하면 나머지 1.5초는 마지막 프레임에서 멈춰 있다
      game.fx.boltTex(from.clone().setY(1), p.pos.clone().setY(1), 0xb26bff, { width: 1.6, life: 0.18 });
      game.fx.slashSprite(e.pos.clone().setY(1.1), p.forward(new THREE.Vector3()), 0xd0a0ff, { size: 3.6, life: 0.18, tilt: (c.data.n % 2 ? 0.8 : -1.5), flip: c.data.n % 2 === 1 });
      game.fx.flash(p.pos.clone().setY(1), 0x8a4aff, { size: 2.4, life: 0.15 });
      game.hitArea(p, p.pos, p.yaw, 3.6, 200, c.dmg, { kb: 1.4, kind: 'slash', source: p, quietStop: c.data.n % 3 !== 0 });
      audio.whoosh({ vol: 0.35, pitch: 1.2 + c.data.n * 0.06, dur: 0.14 });
      game.renderer.shake(0.16);
      c.data.n++; c.data.last = e;
    },
    end(game, p, c) {
      p.stopTrail();
      for (const m of p.mats) { m.opacity = 1; m.transparent = false; }
      game.renderer.desat = 0;
      const at = p.pos.clone();
      game.hitRadius(at, 7.5, c.dmg * 3.2, { kb: 12, kind: 'slash', up: true, finisher: true, source: p, dirFrom: at });
      game.fx.texFlash(at, 'singularity', 0xb26bff, { size: 12, life: 0.6, spin: 1.2, grow: 1.6, y: 1 });
      game.fx.explosion(at, { size: 10, color: 0xd0a0ff, life: 0.6 });
      game.fx.shockTex(at, 0x8a4aff, { r1: 9, life: 0.6 });
      game.fx.burst(at.clone().setY(1), 0xd0a0ff, { n: 60, speed: 15, size: 0.5, up: 0.9 });
      game.fx.light(at, 0xb26bff, 16, 18, 0.6);
      game.renderer.shake(1); game.renderer.punch(1.4); game.renderer.flashScreen(0.4, 0xd0a0ff); game.timeCtl.hitstop(0.14); game.timeCtl.slowmo(0.35, 0.5);
      audio.boom({ vol: 1, dur: 0.9, low: 50 }); audio.bladeWave({ vol: 0.8 }); audio.vibe([90, 40, 130]);
    },
  },
};
