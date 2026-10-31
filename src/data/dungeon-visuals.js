// Dungeon identity is more than a palette: each route owns a landmark,
// horizon treatment, lighting language and a camera composition.
export const DUNGEON_VISUALS = Object.freeze({
  meadow: Object.freeze({ key: 'meadow', sky: { top: 0x3884c2, horizon: 0xc8e5e1, ground: 0x538458, stars: 0xffffff, celestial: 0xffedb9, density: 0 }, camera: { y: 10, z: 12, fov: 46, lookY: 1, lag: 8, yaw: -7, pitch: 0, zoom: 100, side: 0 } }),
  coast: Object.freeze({ key: 'coast', sky: { top: 0x278cc8, horizon: 0xa2e4e4, ground: 0x237fa4, stars: 0xffffff, celestial: 0xffe3a0, density: 0 }, camera: { y: 10, z: 12, fov: 46, lookY: 1, lag: 8, yaw: 8, pitch: 0, zoom: 100, side: 0 } }),
  mountain: Object.freeze({ key: 'mountain', sky: { top: 0x678ebf, horizon: 0xdde7ed, ground: 0x81939d, stars: 0xffffff, celestial: 0xfff4df, density: 0 }, camera: { y: 10, z: 12, fov: 46, lookY: 1, lag: 8, yaw: -9, pitch: 0, zoom: 100, side: 0 } }),
  city: Object.freeze({ key: 'city', sky: { top: 0x557fa9, horizon: 0xf2d7ad, ground: 0x9b8c7e, stars: 0xffffff, celestial: 0xffc97c, density: 0 }, camera: { y: 10, z: 12, fov: 46, lookY: 1, lag: 8, yaw: 6, pitch: 0, zoom: 100, side: 0 } }),
  memorial: Object.freeze({ key: 'memorial', landmark: 'memorial', sky: { top: 0x0b1b2c, horizon: 0x8ab9a9, ground: 0x16332f, stars: 0xffe0a0, celestial: 0xffc57a, density: .34 }, camera: { y: 7.2, z: 8.8, fov: 42, lookY: 1.08, lag: 7.8, yaw: -7, pitch: 2, zoom: 102, side: -.35 } }),
  kiln: Object.freeze({ key: 'kiln', landmark: 'kiln', sky: { top: 0x1b0911, horizon: 0xd35632, ground: 0x321410, stars: 0xffa15c, celestial: 0xff7b32, density: .26 }, camera: { y: 6.5, z: 7.5, fov: 44, lookY: 1.18, lag: 8.8, yaw: 9, pitch: 5, zoom: 106, side: .42 } }),
  archive: Object.freeze({ key: 'archive', landmark: 'archive', sky: { top: 0x07142e, horizon: 0x6f98ca, ground: 0x101e39, stars: 0xb8e5ff, celestial: 0xa8d7ff, density: .22 }, camera: { y: 8.7, z: 10.1, fov: 39, lookY: .82, lag: 5.8, yaw: -12, pitch: -3, zoom: 96, side: -.18 } }),
  beacon: Object.freeze({ key: 'beacon', landmark: 'beacon', sky: { top: 0x061e2a, horizon: 0x55c4c2, ground: 0x0a3032, stars: 0xa5fff0, celestial: 0xb4fff0, density: .2 }, camera: { y: 7.8, z: 9.8, fov: 41, lookY: .95, lag: 6.6, yaw: 15, pitch: 1, zoom: 100, side: .28 } }),
  tribunal: Object.freeze({ key: 'tribunal', landmark: 'tribunal', sky: { top: 0x21102f, horizon: 0xc77da9, ground: 0x2b1739, stars: 0xffd2e9, celestial: 0xffb7d6, density: .24 }, camera: { y: 6.9, z: 8.1, fov: 43, lookY: 1.28, lag: 8.1, yaw: -18, pitch: 4, zoom: 104, side: -.5 } }),
  confluence: Object.freeze({ key: 'confluence', landmark: 'confluence', sky: { top: 0x09221e, horizon: 0x78c79c, ground: 0x10362c, stars: 0xd2ffb1, celestial: 0xd7ffb0, density: .2 }, camera: { y: 8.1, z: 8.9, fov: 42, lookY: .9, lag: 6.2, yaw: 22, pitch: -1, zoom: 98, side: .36 } }),
  // 7장 종탑 도시: 석회빛 안개 낀 새벽과 낮은 구름. 3D 랜드마크 GLB 는 아직 없어 벽면 구조물(region-architecture)로 정체성을 낸다.
  belltower: Object.freeze({ key: 'belltower', landmark: 'belltower', sky: { top: 0x1c242c, horizon: 0xb4b09a, ground: 0x2a2d2b, stars: 0xe6dfc4, celestial: 0xd9d0b0, density: .12 }, camera: { y: 7.6, z: 9.2, fov: 42, lookY: 1.08, lag: 7.8, yaw: -6, pitch: 2, zoom: 102, side: -.3 } }),
  // 컨셉 던전: 넓은 무리 전투가 보이도록 조금 높고 넓은 기본 구도. 남쪽(카메라 쪽) 볼륨은 지형이 낮게 둔다.
  glacier: Object.freeze({ key: 'glacier', landmark: 'glacier', sky: { top: 0x2f6fb0, horizon: 0xc6f3ff, ground: 0x1f7f8c, stars: 0xffffff, celestial: 0xfff4d6, density: .04 }, camera: { y: 8.6, z: 9.2, fov: 44, lookY: .95, lag: 6.8, yaw: -6, pitch: 2, zoom: 96, side: 0 } }),
  quarry: Object.freeze({ key: 'quarry', landmark: 'quarry', sky: { top: 0x6d4a7a, horizon: 0xffc785, ground: 0x8f4a24, stars: 0xffe1b0, celestial: 0xffb050, density: .03 }, camera: { y: 8.6, z: 9.4, fov: 44, lookY: .9, lag: 6.6, yaw: 8, pitch: 1, zoom: 96, side: 0 } }),
});

const VISUAL_BY_ROUTE = Object.freeze({
  windmeadow: 'meadow', sunbreak_coast: 'coast', skywind_pass: 'mountain', dawnward_city: 'city',
  procession: 'memorial', greenhouse: 'memorial', kiln: 'kiln', uprising: 'kiln',
  archive: 'archive', reverseRiver: 'archive', beacon: 'beacon', lostShip: 'beacon',
  tribunal: 'tribunal', emptyThrones: 'tribunal', confluence: 'confluence', addresses: 'confluence',
  glass_garden: 'memorial', ember_vault: 'kiln', star_archive: 'archive', bellfall_crypt: 'memorial',
  cinder_tide_lock: 'kiln', nightglass_observatory: 'archive', eclipse_hydra_vault: 'beacon',
  ashforge_catacomb: 'kiln', astral_leviathan_spire: 'archive', verdigris_sanctum: 'confluence',
  sable_mirage_basin: 'tribunal', comet_bastion: 'tribunal',
  glacier_tide_basin: 'glacier', sunbrass_quarry: 'quarry',
  bellstreet: 'belltower', belfry: 'belltower', crackedNave: 'belltower', crypt: 'belltower',
});

export function dungeonVisualFor(stage = {}) {
  const key = stage.expedition?.id || stage.dungeon?.id || stage.dungeon?.landmark || stage.chapter?.theme || 'memorial';
  const visualKey = VISUAL_BY_ROUTE[key] || VISUAL_BY_ROUTE[stage.chapter?.theme] || 'memorial';
  return DUNGEON_VISUALS[visualKey];
}

export function dungeonVisualKeyFor(value) {
  return VISUAL_BY_ROUTE[value] || value || 'memorial';
}
