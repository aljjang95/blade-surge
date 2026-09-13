// Independent GUI-generated portrait originals and provenance: docs/region-media.md.
// These illustrations identify encounters; animated 3D actors use the rig catalog.
const ids = [
  'arena_rookie', 'arena_duelist', 'arena_champion',
  'boss_warlord', 'boss_demon', 'boss_dragon',
  ...['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming'].flatMap(region =>
    ['captain', 'warden', 'midboss', 'finalboss'].map(rank => `${region}_${rank}`)),
];
export const ENCOUNTER_ART = Object.freeze(Object.fromEntries(ids.map(id => [id, `/img/encounters/${id}.webp`])));
