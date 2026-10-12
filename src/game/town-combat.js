import { TOWN_TRAINER_BY_ID } from '../data/towns.js';
import { TOWN_COMBAT_ARTS } from '../data/combat-arts.js';

function learnedOffers(player) {
  const state = player?.game?.app?.eco?.s?.towns;
  if (!state?.learned || typeof state.learned !== 'object') return [];
  const ids = Object.values(state.learned).flatMap(value => Array.isArray(value) ? value : []);
  return ids.map(id => TOWN_TRAINER_BY_ID[id]).filter(Boolean);
}

export function townSkillOffers(player, skillId) {
  return learnedOffers(player).filter(offer => offer.skillId === skillId && offer.heroId === player?.def?.id);
}

export function hasTownSkillVariant(player, skillId, variant) {
  return townSkillOffers(player, skillId).some(offer => offer.variant === variant && TOWN_COMBAT_ARTS.some(art => art.skillId === skillId && art.variant === variant));
}
