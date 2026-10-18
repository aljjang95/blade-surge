import { SKILL_AIM_SHAPES } from '../skills.js';
import { TOWN_TRAINER_BY_ID } from '../../data/towns.js';
import { TOWN_COMBAT_ARTS } from '../../data/combat-arts.js';

function variant(player, id, name) {
  const learned = player.game?.app?.eco?.s?.towns?.learned;
  if (!learned) return false;
  for (const key in learned) {
    const ids = learned[key]; if (!Array.isArray(ids)) continue;
    for (let i = 0; i < ids.length; i++) {
      const offer = TOWN_TRAINER_BY_ID[ids[i]];
      if (offer?.skillId !== id || offer.heroId !== player.def.id || offer.variant !== name) continue;
      for (let j = 0; j < TOWN_COMBAT_ARTS.length; j++) if (TOWN_COMBAT_ARTS[j].skillId === id && TOWN_COMBAT_ARTS[j].variant === name) return true;
    }
  }
  return false;
}

/** 기본 판정/탐색 모양. angle은 hitArea와 같은 도 단위다. */
export function skillAimShape(skillId) { return SKILL_AIM_SHAPES[skillId] || null; }

/** 장착 변형과 현재 자원은 렌더 전용 재사용 객체에 반영한다. */
export function playerSkillAimShape(player, skillId, out) {
  const base = skillAimShape(skillId);
  if (!base) return null;
  out.kind = base.kind; out.range = base.range; out.width = base.width || 0;
  out.angle = base.angle || 0; out.radius = base.radius || 0; out.origin = base.origin || 0;
  out.projectileRange = base.projectileRange || 0; out.projectileAngle = base.projectileAngle || 0;
  out.endOffset = base.endOffset || 0;
  if (skillId === 'guardian_rebuke' && player.jobResource >= 3) out.range = out.radius = 6;
  if (skillId === 'ranger_pierce') out.width = (player.jobResource >= 3 ? 2.6 : 1.3) * (variant(player, skillId, 'star') ? 1.4 : 1);
  if (skillId === 'ranger_volley' && variant(player, skillId, 'extra')) out.angle = .72 * 180 / Math.PI;
  if (skillId === 'holy_slash' && player.def.id === 'knight' && !player.game.stage?.party && player.game.procs?.has('arm_aegis_master')) {
    out.range = 32 * .85; out.width = .72 * 2;
  }
  if (skillId === 'whirlwind' && variant(player, skillId, 'wide')) out.range = out.radius = 4.8;
  if (skillId === 'blizzard' && variant(player, skillId, 'wide')) out.range = out.radius = 8.6;
  if (skillId === 'bloodquake' && variant(player, skillId, 'echo')) out.range = out.radius = 9.5;
  if (skillId === 'poison_bomb' && variant(player, skillId, 'wide')) out.radius = 5.4;
  if (skillId === 'night_parade' && variant(player, skillId, 'wide')) out.radius = 6.5;
  if (skillId === 'fireball' && variant(player, skillId, 'split')) out.radius = 5.2;
  return out;
}
