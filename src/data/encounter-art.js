// Independent GUI-generated portrait originals and provenance: docs/region-media.md.
// These illustrations identify encounters; animated 3D actors use the rig catalog.
const ids = [
  'arena_rookie', 'arena_duelist', 'arena_champion',
  'boss_warlord', 'boss_demon', 'boss_dragon',
  ...['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming'].flatMap(region =>
    ['captain', 'warden', 'midboss', 'finalboss'].map(rank => `${region}_${rank}`)),
];
export const ENCOUNTER_ART = Object.freeze(Object.fromEntries(ids.map(id => [id, `/img/encounters/${id}.webp`])));

// Endgame expedition art is kept separate from the campaign identity catalog:
// the portrait is a generated encounter asset and does not replace a campaign
// boss portrait or rig.  The original is preserved under .codex/generated_images.
export const RIFT_ART = Object.freeze({
  glass_hour_sovereign: '/img/encounters/chronicle_glass_hour_sovereign.webp',
});
