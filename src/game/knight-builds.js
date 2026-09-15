import * as THREE from 'three';
import { audio } from '../engine/audio.js';

export const KNIGHT_SLASH_VARIANTS = Object.freeze({
  classic: Object.freeze({ id:'classic', name:'기본 일섬', short:'현재 성검 일섬 유지', setId:null, proc:null, selectable:false }),
  return: Object.freeze({ id:'return', name:'귀환 검기', short:'왕복 궤적으로 같은 적을 다시 벤다', setId:'arm_echo', proc:'arm_echo_master', selectable:true }),
  fissure: Object.freeze({ id:'fissure', name:'지면 균열', short:'닻으로 모은 적을 지연 파열 위에 붙잡는다', setId:'arm_anchor', proc:'arm_anchor_master', selectable:true }),
  pierce: Object.freeze({ id:'pierce', name:'집중 관통', short:'폭을 줄이고 정예 압박을 높인다', setId:'arm_aegis', proc:'arm_aegis_master', selectable:true }),
});

export const KNIGHT_SLASH_BUILD_IDS = Object.freeze(/** @type {const} */ (['return','fissure','pierce']));
export const normalizeKnightSlashVariant = value => typeof value === 'string' && Object.hasOwn(KNIGHT_SLASH_VARIANTS, value) && KNIGHT_SLASH_VARIANTS[value].selectable ? value : 'classic';
export const knightSlashVariantInfo = value => KNIGHT_SLASH_VARIANTS[normalizeKnightSlashVariant(value)];
export function knightSlashVariantFromBonus(bonus) {
  const procs = Array.isArray(bonus?.procs) ? bonus.procs : [];
  return KNIGHT_SLASH_BUILD_IDS.find(id => procs.includes(KNIGHT_SLASH_VARIANTS[id].proc)) || 'classic';
}

export function applyKnightSlashVariant(game, player, ctx, variantId) {
  if (!game?.active || game.paused || game.stage?.party || !player?.alive || player.def?.id !== 'knight' || ctx?.sk?.id !== 'holy_slash' || !Number.isFinite(ctx.dmg) || ctx.dmg < 0) return false;
  if (game.player && game.player !== player) return false;
  const world = game.world, owner = game.player, life = player.knightLifeEpoch || 0;
  const valid = () => game.active && !game.paused && player.alive && game.world === world && game.player === owner && (player.knightLifeEpoch || 0) === life;
  const variant = normalizeKnightSlashVariant(variantId);
  if (variant === 'classic') return false;
  const forward = player.forward(new THREE.Vector3()).normalize();
  if (variant === 'return') {
    const end = player.pos.clone().addScaledVector(forward, 12).setY(1.2);
    game.after(.34, () => {
      if (!valid()) return;
      const dir = player.pos.clone().setY(1.2).sub(end).normalize();
      game.fx.slashSprite?.(end, dir, 0xfff0a0, { size:3.4, life:.55, speed:26, tilt:.5 });
      game.spawnProjectile({ pos:end.clone(), dir, speed:26, radius:1.45, dmg:ctx.dmg*.48, color:0xffe29a, size:0, owner:player, kb:3, kind:'slash', pierce:true, life:.78, visual:null });
      audio.whoosh({ vol:.32, pitch:1.45, dur:.2 });
    });
    return true;
  }
  if (variant === 'fissure') {
    const at = player.pos.clone().addScaledVector(forward, 6).setY(0);
    game.fx.groundTex?.(at.clone(), 'circle_gold', 0xffb85a, { r0:1, r1:4.2, life:1.45, spin:0 });
    [0.25,0.65,1.05].forEach((delay,index) => game.after(delay, () => {
      if (!valid()) return;
      game.vacuum?.(at, 4.5, 8);
      game.hitRadius(at, 3.2, ctx.dmg*.28, { kb:index===2?5:1, kind:'slash', source:player, noProc:true, quietStop:true, dirFrom:at });
      game.fx.shockTex?.(at, 0xffc96f, { r1:3.8+index*.3, life:.3 });
    }));
    return true;
  }
  const start = player.pos.clone().addScaledVector(forward, 1).setY(1.2);
  game.fx.slashSprite?.(start, forward, 0xfff3b0, { size:3.1, life:.55, speed:30, tilt:-.5 });
  game.fx.light?.(start, 0xffd060, 8, 10, .35);
  audio.bladeWave({ vol:.66 }); audio.holy({ vol:.24, base:980, dur:.45 }); audio.vibe(24);
  game.spawnProjectile({ pos:start, dir:forward, speed:32, radius:.72, dmg:ctx.dmg*1.35, color:0xfff3b0, size:0, owner:player, kb:9, kind:'slash', pierce:true, life:.85, visual:null });
  return true;
}

export function knightSlashVariantForBattle(game, player) {
  if (game?.stage?.party || player?.def?.id !== 'knight') return 'classic';
  const procs = game?.procs instanceof Set ? [...game.procs] : [];
  return knightSlashVariantFromBonus({ procs });
}
