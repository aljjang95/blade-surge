/** Small authored Blender surfaces share the shipped rigs, textures and clips. */
export const ENCOUNTER_MODELS = {
  Skeleton_BellKing: { base: 'Skeleton_Warrior', file: 'bell-king-v1', remove: ['mesh_1'] },
  Big_KilnTyrant: { base: 'Big_Demon', file: 'kiln-tyrant-v1' },
  Big_ArchiveMonarch: { base: 'Big_Yeti', file: 'archive-monarch-v1' },
  Flying_AbyssRegent: { base: 'Flying_Dragon_Evolved', file: 'abyss-regent-v1' },
  Skeleton_HollowRegent: { base: 'Skeleton_Warrior', file: 'hollow-regent-v1', remove: ['mesh_1'] },
  Skeleton_OathRemnant: { base: 'Skeleton_Warrior', file: 'oath-remnant-v1', remove: ['mesh_1'] },
};
export const CAMPAIGN_MODELS = {
  garden_finalboss: 'Skeleton_BellKing',
  forge_finalboss: 'Big_KilnTyrant',
  frost_finalboss: 'Big_ArchiveMonarch',
  tide_finalboss: 'Flying_AbyssRegent',
  crown_finalboss: 'Skeleton_HollowRegent',
  homecoming_finalboss: 'Skeleton_OathRemnant',
};
