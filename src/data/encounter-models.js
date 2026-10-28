/** Small authored Blender surfaces share the shipped rigs, textures and clips. */
export const ENCOUNTER_MODELS = {
  Skeleton_Vanguard: { base: 'Skeleton_Minion', file: 'forge-vanguard-v2' },
  Skeleton_Skirmisher: { base: 'Skeleton_Rogue', file: 'forge-skirmisher-v2' },
  Skeleton_Runekeeper: { base: 'Skeleton_Mage', file: 'forge-runekeeper-v2' },
  Skeleton_Bulwark: { base: 'Skeleton_Warrior', file: 'forge-bulwark-v2' },
  Skeleton_BellKing: { base: 'Skeleton_Warrior', file: 'bell-king-v1', remove: ['mesh_1'] },
  Big_KilnTyrant: { base: 'Big_Demon', file: 'kiln-tyrant-v1' },
  Big_ArchiveMonarch: { base: 'Big_Yeti', file: 'archive-monarch-v1' },
  Flying_AbyssRegent: { base: 'Flying_Dragon_Evolved', file: 'abyss-regent-v1' },
  Skeleton_HollowRegent: { base: 'Skeleton_Warrior', file: 'hollow-regent-v1', remove: ['mesh_1'] },
  Skeleton_OathRemnant: { base: 'Skeleton_Warrior', file: 'oath-remnant-v1', remove: ['mesh_1'] },
};
export const CAMPAIGN_MODELS = {
  // 1·2장 중간 보스: Tripo 전용 몸(애도의 기사 세렌 tll_ch1_tombknight, 대장장이 이그란 tll_ch2_igran).
  garden_midboss: 'Ch1_TombKnight',
  forge_midboss: 'Ch2_Igran',
  // 3장 중간 보스: 기록관 오르딘(tll_ch3_ordin, 봉인 도장 철퇴).
  frost_midboss: 'Ch3_Ordin',
  garden_finalboss: 'Skeleton_BellKing',
  forge_finalboss: 'Big_KilnTyrant',
  frost_finalboss: 'Big_ArchiveMonarch',
  tide_finalboss: 'Flying_AbyssRegent',
  crown_finalboss: 'Skeleton_HollowRegent',
  homecoming_finalboss: 'Skeleton_OathRemnant',
  // 7장: Tripo 모델 슬롯(tll_ch7_midboss / tll_ch7_finalboss). 들어오기 전에는 로스터의 대체 실루엣이 선다.
  belltower_midboss: 'Bell_Warden',
  belltower_finalboss: 'Bell_Sovereign',
};
