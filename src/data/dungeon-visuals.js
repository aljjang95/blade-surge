// Dungeon identity is more than a palette: each route owns a landmark,
// horizon treatment, lighting language and a camera composition.
export const DUNGEON_VISUALS = Object.freeze({
  memorial: Object.freeze({ key: 'memorial', landmark: 'memorial', sky: { top: 0x0b1b2c, horizon: 0x8ab9a9, ground: 0x16332f, stars: 0xffe0a0, celestial: 0xffc57a, density: .34 }, camera: { y: 7.2, z: 8.8, fov: 42, lookY: 1.08, lag: 7.8, yaw: -7, pitch: 2, zoom: 102, side: -.35 } }),
  kiln: Object.freeze({ key: 'kiln', landmark: 'kiln', sky: { top: 0x1b0911, horizon: 0xd35632, ground: 0x321410, stars: 0xffa15c, celestial: 0xff7b32, density: .26 }, camera: { y: 6.5, z: 7.5, fov: 44, lookY: 1.18, lag: 8.8, yaw: 9, pitch: 5, zoom: 106, side: .42 } }),
  archive: Object.freeze({ key: 'archive', landmark: 'archive', sky: { top: 0x07142e, horizon: 0x6f98ca, ground: 0x101e39, stars: 0xb8e5ff, celestial: 0xa8d7ff, density: .22 }, camera: { y: 8.7, z: 10.1, fov: 39, lookY: .82, lag: 5.8, yaw: -12, pitch: -3, zoom: 96, side: -.18 } }),
  beacon: Object.freeze({ key: 'beacon', landmark: 'beacon', sky: { top: 0x061e2a, horizon: 0x55c4c2, ground: 0x0a3032, stars: 0xa5fff0, celestial: 0xb4fff0, density: .2 }, camera: { y: 7.8, z: 9.8, fov: 41, lookY: .95, lag: 6.6, yaw: 15, pitch: 1, zoom: 100, side: .28 } }),
  tribunal: Object.freeze({ key: 'tribunal', landmark: 'tribunal', sky: { top: 0x21102f, horizon: 0xc77da9, ground: 0x2b1739, stars: 0xffd2e9, celestial: 0xffb7d6, density: .24 }, camera: { y: 6.9, z: 8.1, fov: 43, lookY: 1.28, lag: 8.1, yaw: -18, pitch: 4, zoom: 104, side: -.5 } }),
  confluence: Object.freeze({ key: 'confluence', landmark: 'confluence', sky: { top: 0x09221e, horizon: 0x78c79c, ground: 0x10362c, stars: 0xd2ffb1, celestial: 0xd7ffb0, density: .2 }, camera: { y: 8.1, z: 8.9, fov: 42, lookY: .9, lag: 6.2, yaw: 22, pitch: -1, zoom: 98, side: .36 } }),
});

const VISUAL_BY_ROUTE = Object.freeze({
  procession: 'memorial', greenhouse: 'memorial', kiln: 'kiln', uprising: 'kiln',
  archive: 'archive', reverseRiver: 'archive', beacon: 'beacon', lostShip: 'beacon',
  tribunal: 'tribunal', emptyThrones: 'tribunal', confluence: 'confluence', addresses: 'confluence',
  glass_garden: 'memorial', ember_vault: 'kiln', star_archive: 'archive', bellfall_crypt: 'memorial',
  cinder_tide_lock: 'kiln', nightglass_observatory: 'archive', eclipse_hydra_vault: 'beacon',
  ashforge_catacomb: 'kiln', astral_leviathan_spire: 'archive', verdigris_sanctum: 'confluence',
  sable_mirage_basin: 'tribunal', comet_bastion: 'tribunal',
});

export function dungeonVisualFor(stage = {}) {
  const key = stage.expedition?.id || stage.dungeon?.id || stage.dungeon?.landmark || stage.chapter?.theme || 'memorial';
  const visualKey = VISUAL_BY_ROUTE[key] || VISUAL_BY_ROUTE[stage.chapter?.theme] || 'memorial';
  return DUNGEON_VISUALS[visualKey];
}

export function dungeonVisualKeyFor(value) {
  return VISUAL_BY_ROUTE[value] || value || 'memorial';
}
