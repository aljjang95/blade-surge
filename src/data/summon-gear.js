// 소환 장비 — 기존 네 슬롯에 장착하면 전투 중 전용 수호체가 함께 싸운다.
// 아이콘은 등급 시트를 재사용하고, 필드 드랍 3D 실루엣은 summonShape로 분리한다.
export const SUMMON_GEAR = [
  { id: 'sg_ember_lantern', name: '잿불 소환등', slot: 'weapon', rarity: 'U', atk: 46, crit: 0.05, summonShape: 'lantern', summon: { id: 'ember_fox', name: '잿불 여우', color: 0xff7130, flash: 'phoenix', interval: 3.4, radius: 5.5, ratio: 0.55, orbit: 1.45, height: 1.55 } },
  { id: 'sg_solar_grimoire', name: '태양의 소환서', slot: 'weapon', rarity: 'L', atk: 88, crit: 0.08, summonShape: 'grimoire', summon: { id: 'solar_hawk', name: '태양 매', color: 0xffd060, flash: 'holy_burst', interval: 2.8, radius: 6.5, ratio: 0.82, orbit: 1.7, height: 1.8 } },
  { id: 'sg_moonward_aegis', name: '월영 수호갑', slot: 'armor', rarity: 'U', hp: 620, def: 18, summonShape: 'aegis', summon: { id: 'moon_sentinel', name: '월영 수호자', color: 0x8fd8e8, flash: 'ice', interval: 3.8, radius: 4.8, ratio: 0.48, orbit: 1.35, height: 1.35, heal: 0.015 } },
  { id: 'sg_abyss_husk', name: '심연의 공생갑', slot: 'armor', rarity: 'L', hp: 910, def: 27, summonShape: 'aegis', summon: { id: 'abyss_stalker', name: '심연 추적자', color: 0xb26bff, flash: 'singularity', interval: 3.1, radius: 6.2, ratio: 0.76, orbit: 1.6, height: 1.45 } },
  { id: 'sg_astral_prism', name: '성운 공명석', slot: 'ring', rarity: 'U', atk: 36, crit: 0.08, summonShape: 'prism', summon: { id: 'astral_wisp', name: '성운 위습', color: 0x70b8ff, flash: 'lightning_chain', interval: 2.6, radius: 5.8, ratio: 0.46, orbit: 1.25, height: 1.65 } },
  { id: 'sg_orbit_crown', name: '궤도의 왕관', slot: 'ring', rarity: 'L', atk: 62, crit: 0.12, summonShape: 'prism', summon: { id: 'orbit_drone', name: '궤도 드론', color: 0xd7f4ff, flash: 'lightning', interval: 2.2, radius: 7.2, ratio: 0.68, orbit: 1.9, height: 1.9 } },
  { id: 'sg_stormstep_treads', name: '폭풍 소환각', slot: 'boots', rarity: 'U', hp: 310, atk: 20, crit: 0.04, summonShape: 'treads', summon: { id: 'storm_mote', name: '폭풍 정령', color: 0x7affe0, flash: 'lightning', interval: 3.0, radius: 5.2, ratio: 0.5, orbit: 1.5, height: 1.25 } },
  { id: 'sg_comet_stride', name: '혜성의 행군화', slot: 'boots', rarity: 'L', hp: 480, atk: 32, crit: 0.06, summonShape: 'treads', summon: { id: 'comet_hound', name: '혜성 사냥개', color: 0xff9ad8, flash: 'explosion', interval: 2.5, radius: 6.8, ratio: 0.74, orbit: 1.75, height: 1.2 } },
];
