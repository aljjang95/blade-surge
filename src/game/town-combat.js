import { ALL_DUNGEONS, DUNGEON_BOSS_PATTERNS } from '../data/expansion.js';
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

const dungeonById = new Map(ALL_DUNGEONS.map(dungeon => [dungeon.id, dungeon]));

export function townDungeonCombat(id) {
  const dungeon = dungeonById.get(id);
  if (!dungeon) return null;
  return { id: dungeon.id, theme: dungeon.theme, mechanic: dungeon.mechanic || null,
    roster: dungeon.roster ? { trash: [...dungeon.roster.trash], ranged: [...dungeon.roster.ranged], elite: [...dungeon.roster.elite] } : null,
    boss: { enemyId: dungeon.bossEnemy || dungeon.stage.encounter.enemyId, name: dungeon.bossName || dungeon.name + ' 수호자', pattern: [...(DUNGEON_BOSS_PATTERNS[id] || [])] } };
}

export function townBossPattern(id, turn = 0, phase = 0) {
  const profile = townDungeonCombat(id);
  if (!profile || !profile.boss.pattern.length) return null;
  return profile.boss.pattern[(Math.max(0, phase) + Math.max(0, turn)) % profile.boss.pattern.length];
}
