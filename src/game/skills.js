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
};
