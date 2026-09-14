export const MUSIC_MIX = Object.freeze({ fade: 0.7, volume: 0.55 });
const REGIONS = new Set(['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming']);

// FLOW web generation brief.  `fallback` is the verified shipped cue used
// until the authenticated FlowMusic GUI exports the replacement master; a
// pending cue must never become a broken URL in a live build.
export const FLOWMUSIC_CUE_PLAN = Object.freeze([
  { id: 'lobby-aurora-20260914', scene: 'lobby', target: 'lobby', fallback: 'regions/lobby', status: 'external-gui-pending' },
  { id: 'dungeon-tide-eclipse-20260914', scene: 'dungeon', route: 'eclipse_hydra_vault', target: 'tide', fallback: 'regions/tide', status: 'external-gui-pending' },
  { id: 'dungeon-forge-ash-20260914', scene: 'dungeon', route: 'ashforge_catacomb', target: 'forge', fallback: 'regions/forge', status: 'external-gui-pending' },
  { id: 'dungeon-frost-astral-20260914', scene: 'dungeon', route: 'astral_leviathan_spire', target: 'frost', fallback: 'regions/frost', status: 'external-gui-pending' },
  { id: 'arena-valor-six-20260914', scene: 'arena', target: 'arena', fallback: 'regions/arena', status: 'external-gui-pending' },
  { id: 'boss-signature-trilogy-20260914', scene: 'boss', target: 'boss', fallback: 'regions/boss', status: 'external-gui-pending' },
]);

export function flowMusicBriefForRoute(routeId) {
  return FLOWMUSIC_CUE_PLAN.find(cue => cue.route === routeId) || null;
}
/** @typedef {{ch?: number, theme?: string, encounterPrefix?: string, chapter?: {id?: number, theme?: string, encounterPrefix?: string}, expedition?: {kind?: string}}} MusicStage */

/**
 * All starts and resumes resolve through the same scene policy.
 * @param {{scene?: string, boss?: boolean, stage?: MusicStage | null}} context
 */
export function musicForScene({ scene = 'battle', stage = null, boss = false } = {}) {
  if (scene === 'gacha') return 'bgm_gacha';
  if (scene === 'lobby') return 'regions/lobby';
  if (stage?.expedition?.kind === 'arena') return 'regions/arena';
  if (boss) return 'regions/boss';
  if (stage?.ch === 6 || stage?.chapter?.id === 6 || stage?.encounterPrefix === 'homecoming' || stage?.chapter?.encounterPrefix === 'homecoming') return 'regions/homecoming';
  const theme = stage?.theme || stage?.chapter?.theme;
  return `regions/${REGIONS.has(theme) ? theme : 'garden'}`;
}

/**
 * An awaited intro must not overwrite a later lobby, result or replacement battle.
 * @param {{mode: string, active: boolean, stage: MusicStage | null, expectedStage: MusicStage, boss?: boolean}} context
 */
export function musicAfterIntro({ mode, active, stage, expectedStage, boss = false }) {
  return mode === 'battle' && active && stage === expectedStage ? musicForScene({ stage, boss }) : null;
}
