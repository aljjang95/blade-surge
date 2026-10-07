// 원본 기합·음성은 별도 버스를 유지한다. 아래 자산은 로컬에서 직접 합성한 효과음이다.
const PREFIX = 'crafted/combat-v1/';
export const COMBAT_SOUND_NAMES = Object.freeze([
  'blade', 'heavy', 'dual', 'bow', 'arcane', 'holy', 'earth', 'shadow', 'fire', 'frost', 'storm', 'ultimate',
]);
export const COMBAT_SOUND_FILES = Object.freeze(COMBAT_SOUND_NAMES.map(name => PREFIX + name));

const SKILL_FAMILIES = Object.freeze({
  holy_slash: 'holy', shield_bash: 'earth', judgment: 'holy', dragon_slash: 'holy',
  chain_bind: 'holy', sanctuary: 'holy', sunbreaker: 'holy', heavenfall: 'holy',
  whirlwind: 'heavy', quake: 'earth', berserk: 'earth', hell_axe: 'fire',
  bull_rush: 'heavy', magma_zone: 'fire', bloodquake: 'earth', cataclysm: 'fire',
  fireball: 'fire', chain: 'storm', blizzard: 'frost', meteor: 'fire',
  arc_reflect: 'arcane', chrono_seal: 'arcane', star_prison: 'arcane', absolute_zero: 'frost',
  shadow_dash: 'shadow', poison_bomb: 'shadow', flurry: 'dual', thousand: 'dual',
  shadow_mark: 'shadow', void_step: 'shadow', night_parade: 'shadow', eclipse_edge: 'shadow',
  ranger_pierce: 'bow', ranger_volley: 'bow', ranger_retreat: 'bow', ranger_tempest: 'storm',
  ranger_quickshot: 'bow', ranger_binding: 'bow', gale_hunt: 'bow', skyfall_arrows: 'storm',
});
const HERO_FAMILIES = Object.freeze({ knight: 'holy', barbarian: 'earth', mage: 'arcane', rogue: 'shadow', ranger: 'bow' });

export function attackSound(weapon, ranged = false) {
  const family = weapon === 'bow' ? 'bow' : weapon === 'staff' ? 'arcane'
    : weapon === '2h' ? 'heavy' : weapon === 'dual' ? 'dual' : ranged ? 'arcane' : 'blade';
  return PREFIX + family;
}
export function skillSound(skillId, heroId = '') {
  const family = Object.hasOwn(SKILL_FAMILIES, skillId) ? SKILL_FAMILIES[skillId]
    : Object.hasOwn(HERO_FAMILIES, heroId) ? HERO_FAMILIES[heroId] : 'arcane';
  return PREFIX + family;
}
export const ULTIMATE_SOUND = PREFIX + 'ultimate';
