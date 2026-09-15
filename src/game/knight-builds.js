import * as THREE from 'three';
import { SKILLS } from './skills.js';

export const KNIGHT_SLASH_VARIANTS = Object.freeze({
  classic: Object.freeze({ id:'classic', name:'기본 일섬', short:'현재 성검 일섬 유지', setId:null, proc:null, selectable:false }),
  return: Object.freeze({ id:'return', name:'귀환 검기', short:'왕복 궤적으로 같은 적을 다시 벤다', setId:'arm_echo', proc:'arm_echo_master', selectable:true }),
  fissure: Object.freeze({ id:'fissure', name:'지면 균열', short:'검기가 지난 자리에 지연 파열을 남긴다', setId:'arm_anchor', proc:'arm_anchor_master', selectable:true }),
  pierce: Object.freeze({ id:'pierce', name:'집중 관통', short:'폭을 줄이고 정예·보스 압박을 높인다', setId:'arm_aegis', proc:'arm_aegis_master', selectable:true }),
});

export const KNIGHT_SLASH_BUILD_IDS = Object.freeze(['return','fissure','pierce']);
export const normalizeKnightSlashVariant = value => KNIGHT_SLASH_VARIANTS[value]?.selectable ? value : 'classic';
export const knightSlashVariantInfo = value => KNIGHT_SLASH_VARIANTS[normalizeKnightSlashVariant(value)];
export function knightSlashVariantFromBonus(bonus) {
  const procs = Array.isArray(bonus?.procs) ? bonus.procs : [];
  return KNIGHT_SLASH_BUILD_IDS.find(id => procs.includes(KNIGHT_SLASH_VARIANTS[id].proc)) || 'classic';
}

export function applyKnightSlashVariant(game, player, ctx, variantId) {
  if (!game?.active || !player?.alive || player.def?.id !== 'knight' || ctx?.sk?.id !== 'holy_slash') return false;
  const variant = normalizeKnightSlashVariant(variantId);
  if (variant === 'classic') return false;
  const forward = player.forward(new THREE.Vector3()).normalize();
  if (variant === 'return') {
    const end = player.pos.clone().addScaledVector(forward, 12).setY(1.2);
    game.after(.24, () => {
      if (!game.active || !player.alive) return;
      const dir = player.pos.clone().setY(1.2).sub(end).normalize();
      game.fx.slashSprite?.(end, dir, 0xfff0a0, { size:3.4, life:.55, speed:24, tilt:.5 });
      game.spawnProjectile({ pos:end.clone(), dir, speed:24, radius:1.55, dmg:ctx.dmg*.48, color:0xffe29a, size:0, owner:player, kb:3, kind:'slash', pierce:true, life:.75, visual:null, noProc:true });
    });
    return true;
  }
  if (variant === 'fissure') {
    for (let i=1;i<=3;i++) {
      const at = player.pos.clone().addScaledVector(forward, i*3.2).setY(0);
      game.after(.10+i*.08, () => {
        if (!game.active || !player.alive) return;
        game.hitRadius(at, 2.35, ctx.dmg*.28, { kb:1, kind:'magic', source:player, noProc:true, quietStop:true, dirFrom:at });
        game.fx.shockTex?.(at, 0xffd060, { r1:3.2, life:.38 });
      });
    }
    return true;
  }
  const start = player.pos.clone().addScaledVector(forward, 1).setY(1.2);
  game.spawnProjectile({ pos:start, dir:forward, speed:30, radius:.85, dmg:ctx.dmg*.72, color:0xffffff, size:0, owner:player, kb:2, kind:'slash', pierce:true, life:.85, visual:null, noProc:true });
  return true;
}

let installed = false;
export function installKnightBuildVariants() {
  if (installed) return;
  const baseCast = SKILLS.holy_slash?.cast;
  if (typeof baseCast !== 'function') throw new Error('holy_slash implementation is unavailable');
  SKILLS.holy_slash.cast = function(game, player, ctx) {
    baseCast(game, player, ctx);
    if (game?.stage?.party) return;
    const bonus = game?.app?.eco?.heroEquipBonus?.(player.def?.id);
    applyKnightSlashVariant(game, player, ctx, knightSlashVariantFromBonus(bonus));
  };
  installed = true;
}
