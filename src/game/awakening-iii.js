import * as THREE from 'three';
import { audio } from '../engine/audio.js';

/** Sunbreaker traces a visible lane out and draws surviving enemies back along it. */
export function solarLaneNodes(origin, facing, count = 4) {
  const direction = facing.clone().setY(0);
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
  direction.normalize();
  return Array.from({ length: count }, (_, i) => origin.clone().addScaledVector(direction, 2.5 * (i + 1)).setY(0));
}

function hitSolarPulse(game, player, ctx, at, seen, ratio, knockback) {
  let hit = 0;
  for (const enemy of game.enemies) {
    if (!enemy.alive || enemy.spawning || seen.has(enemy)) continue;
    const dx = enemy.pos.x - at.x, dz = enemy.pos.z - at.z;
    if (Math.hypot(dx, dz) - (enemy.radius || 0) * .5 > 3.2) continue;
    seen.add(enemy);
    game.damageEnemy(enemy, ctx.dmg * ratio, { kind: 'slash', kb: knockback, source: player,
      dirx: dx, dirz: dz, quietStop: hit > 0 });
    if (++hit >= 24) break;
  }
  return hit;
}

export const AWAKENING_III = {
  sunbreaker: {
    dur: .9,
    start(game, player) {
      // Player's bark path loads uncached clips without playing the first cast.
      // Play the first clip on the bark bus when that same pending load resolves.
      // Later casts use Player's normal bark path and need no extra playback.
      if (audio.voiceOn && audio.mix.voice && !audio.voiceBuf.hero_knight_skill6) {
        audio._loadVoice('hero_knight_skill6').then(buffer => {
          if (buffer && game.active && !game.paused && player.alive && player.skillCtx?.sk.id === 'sunbreaker')
            audio.bark('hero_knight_skill6', { vol: .95, min: 0, priority: 3 });
        });
      }
    },
    cast(game, player, ctx) {
      const origin = player.pos.clone().setY(0);
      const direction = player.forward(new THREE.Vector3()).setY(0).normalize();
      const nodes = solarLaneNodes(origin, direction);
      const forwardHit = new WeakSet(), returnHit = new WeakSet();
      ctx.data.solarLane = nodes.map(node => node.clone());
      game.fx.groundTex(origin, 'circle_gold', 0xffd060, { r0: .5, r1: 2.8, life: .55, spin: 1, y: .08 });
      game.fx.boltTex(origin.clone().setY(.42), nodes[nodes.length - 1].clone().setY(.42), 0xfff0b0, { width: .7, life: 1.25 });
      nodes.forEach((at, i) => game.after(i * .1, () => {
        if (!game.active || !player.alive) return;
        const from = i ? nodes[i - 1] : origin;
        game.fx.boltTex(from.clone().setY(.75), at.clone().setY(.75), 0xffe18a, { width: 1.7, life: .45 });
        game.fx.slashSprite(at.clone().setY(2.1), direction, 0xffefab,
          { size: 4.8, life: .48, speed: 3.2, tilt: -.2 });
        game.fx.shockTex(at, 0xffd060, { r1: 3.4, life: .5 });
        hitSolarPulse(game, player, ctx, at, forwardHit, 1, 4);
      }));
      [...nodes].reverse().forEach((at, i) => game.after(.48 + i * .1, () => {
        if (!game.active || !player.alive) return;
        const toward = i < nodes.length - 1 ? nodes[nodes.length - 2 - i] : origin;
        game.fx.boltTex(at.clone().setY(.75), toward.clone().setY(.75), 0xffb84a, { width: 2.0, life: .35 });
        game.fx.slashSprite(at.clone().setY(2.1), direction.clone().negate(), 0xffa33e,
          { size: 4.4, life: .38, speed: 3.2, tilt: .2, flip: true });
        game.fx.groundTex(at, 'circle_gold', 0xffc160, { r0: .4, r1: 3.2, life: .28, spin: -1, y: .08 });
        game.vacuum(toward, 4.5, 12);
        hitSolarPulse(game, player, ctx, at, returnHit, .75, 0);
        if (i === nodes.length - 1) game.fx.holyBurst(origin, { size: 4.2, life: .32 });
      }));
    },
  },
};
