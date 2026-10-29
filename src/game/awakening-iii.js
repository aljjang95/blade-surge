import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { SKILL_PRELUDES } from '../engine/skill-signatures.js';
import { impactReady } from '../engine/skill-vfx.js';

/** 태양파쇄 예비 표식(skills.js skillPrelude 와 같은 규칙: 인스턴스 층만, 난수 미사용, 동작 줄이기 생략). */
function sunPrelude(game, player) {
  const impact = game.fx?.impact, fn = SKILL_PRELUDES.sunbreaker;
  if (!impactReady(impact) || !fn || game.app?.reducedMotion?.matches || typeof player.forward !== 'function') return;
  try { fn({ fx: game.fx, impact, player, at: player.pos, f: player.forward(new THREE.Vector3()), lite: !!game.fx.lite, scale: 1 }); } catch (error) { console.warn('skill prelude', 'sunbreaker', error); }
}

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
    start(game, player, ctx) {
      sunPrelude(game, player);
      // Player plays the cached bark synchronously. A cache miss must stay bound
      // to this cast; the same Battle object can be reused after stop/start.
      const key = 'hero_knight_skill6';
      if (!audio.voiceOn || !audio.mix.voice || audio.voiceBuf[key]) return;
      const generation = game._startGeneration;
      const valid = () => game.active && !game.paused && game._startGeneration === generation
        && game.player === player && player.alive && !player.disposed
        && player.skillCtx === ctx && !ctx.done && player.state === 'skill'
        && audio.voiceOn && audio.mix.voice;
      let handled = false;
      audio._loadVoice(key).then(buffer => {
        if (!handled && buffer && valid()) {
          handled = true;
          audio.bark(key, { vol: .95, min: 0, priority: 3 });
        }
      });
      // If the dedicated file is slow, give the first cast a cached shout
      // while keeping the named take ready for later casts.
      game.after(.35, () => {
        if (handled || !valid() || !audio.voiceBuf.hero_knight_skill0) return;
        handled = true;
        audio.bark('hero_knight_skill0', { vol: .7, min: 0, priority: 2 });
      });
    },
    cast(game, player, ctx) {
      // 연출 색만 크림·흰빛(0xfff0b0·0xffefab 등)에서 검성 금·주황으로 바꿨다: 재질은 호출마다 새로 만들어 색과 무관하게
      // Math.random 소비(UUID·회전)가 같다. 호출 수·수명·크기는 그대로(시드 전투 난수 진행 보존).
      const origin = player.pos.clone().setY(0);
      const direction = player.forward(new THREE.Vector3()).setY(0).normalize();
      const nodes = solarLaneNodes(origin, direction);
      const forwardHit = new WeakSet(), returnHit = new WeakSet();
      ctx.data.solarLane = nodes.map(node => node.clone());
      game.fx.groundTex(origin, 'circle_gold', 0xffb21e, { r0: .5, r1: 2.8, life: .55, spin: 1, y: .08 });
      game.fx.boltTex(origin.clone().setY(.42), nodes[nodes.length - 1].clone().setY(.42), 0xffb21e, { width: .7, life: 1.25 });
      nodes.forEach((at, i) => game.after(i * .1, () => {
        if (!game.active || !player.alive) return;
        const from = i ? nodes[i - 1] : origin;
        game.fx.boltTex(from.clone().setY(.75), at.clone().setY(.75), 0xffa020, { width: 1.7, life: .45 });
        game.fx.slashSprite(at.clone().setY(2.1), direction, 0xffb21e,
          { size: 4.8, life: .48, speed: 3.2, tilt: -.2 });
        game.fx.shockTex(at, 0xff9a20, { r1: 3.4, life: .5 });
        hitSolarPulse(game, player, ctx, at, forwardHit, 1, 4);
      }));
      [...nodes].reverse().forEach((at, i) => game.after(.48 + i * .1, () => {
        if (!game.active || !player.alive) return;
        const toward = i < nodes.length - 1 ? nodes[nodes.length - 2 - i] : origin;
        game.fx.boltTex(at.clone().setY(.75), toward.clone().setY(.75), 0xffb84a, { width: 2.0, life: .35 });
        game.fx.slashSprite(at.clone().setY(2.1), direction.clone().negate(), 0xffa33e,
          { size: 4.4, life: .38, speed: 3.2, tilt: .2, flip: true });
        game.fx.groundTex(at, 'circle_gold', 0xffc160, { r0: .4, r1: 3.2, life: .28, spin: -1, y: .08 });
        game.vacuum(toward, 3.2, 12);   // 표시된 낙점 원(반경 3.2) 안으로만 끌어 표시=판정을 지킨다(재감사 2026-10-19: 4.5였을 때 표시 밖 좌우 4m 적이 끌려와 맞음)
        hitSolarPulse(game, player, ctx, at, returnHit, .75, 0);
        if (i === nodes.length - 1) game.fx.holyBurst(origin, { size: 4.2, life: .32, color: 0xff9a18 });
      }));
    },
  },
};
