// Independent portrait originals and provenance: docs/region-media.md plus
// docs/media/seasonal-encounter-art.json. These illustrations identify
// encounters; animated 3D actors use the rig catalog.
const ids = [
  'arena_rookie', 'arena_duelist', 'arena_champion',
  'arena_thunder_lancer', 'arena_sunwarden', 'arena_void_oracle',
  'boss_warlord', 'boss_demon', 'boss_dragon',
  'boss_obsidian_hydra', 'boss_ash_colossus', 'boss_astral_leviathan',
  'boss_verdigris_sentinel', 'boss_sable_mirage_empress', 'boss_comet_bastion',
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
  mossbound_scout: '/img/encounters/mob_mossbound_scout.webp',
  verdigris_rootcaller: '/img/encounters/mob_verdigris_rootcaller.webp',
  ironbark_bulwark: '/img/encounters/mob_ironbark_bulwark.webp',
  mirage_hound: '/img/encounters/mob_mirage_hound.webp',
  sandglass_seer: '/img/encounters/mob_sandglass_seer.webp',
  mirage_colossus: '/img/encounters/mob_mirage_colossus.webp',
  comet_spark: '/img/encounters/mob_comet_spark.webp',
  comet_orbit_mote: '/img/encounters/mob_comet_orbit_mote.webp',
  comet_bastion_warden: '/img/encounters/mob_comet_bastion_warden.webp',
});

// Endgame expedition art is kept separate from the campaign identity catalog:
// the portrait is a generated encounter asset and does not replace a campaign
// boss portrait or rig.  The original is preserved under .codex/generated_images.
export const RIFT_ART = Object.freeze({
  glass_hour_sovereign: '/img/encounters/chronicle_glass_hour_sovereign.webp',
});
