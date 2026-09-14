// Independent portrait originals and provenance: docs/region-media.md plus
// docs/media/seasonal-encounter-art.json. These illustrations identify
// encounters; animated 3D actors use the rig catalog.
const ids = [
  'arena_rookie', 'arena_duelist', 'arena_champion',
  'arena_thunder_lancer', 'arena_sunwarden', 'arena_void_oracle',
  'boss_warlord', 'boss_demon', 'boss_dragon',
  'boss_obsidian_hydra', 'boss_ash_colossus', 'boss_astral_leviathan',
  ...['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming'].flatMap(region =>
    ['captain', 'warden', 'midboss', 'finalboss'].map(rank => `${region}_${rank}`)),
];
export const ENCOUNTER_ART = Object.freeze(Object.fromEntries(ids.map(id => [id, `/img/encounters/${id}.webp`])));

// Mob portraits are kept in the same immutable catalog so roster data cannot
// silently fall back to a duplicate hero portrait when a seasonal route loads.
export const MOB_ART = Object.freeze({
  glass_shardling: '/img/encounters/mob_glass_shardling.webp',
  chain_forger: '/img/encounters/mob_ember_chain_forger.webp',
  nightglass_page: '/img/encounters/mob_nightglass_page.webp',
});

// Endgame expedition art is kept separate from the campaign identity catalog:
// the portrait is a generated encounter asset and does not replace a campaign
// boss portrait or rig.  The original is preserved under .codex/generated_images.
export const RIFT_ART = Object.freeze({
  glass_hour_sovereign: '/img/encounters/chronicle_glass_hour_sovereign.webp',
});
