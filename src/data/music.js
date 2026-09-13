export const MUSIC_MIX = Object.freeze({ fade: 0.7, volume: 0.55 });
const REGIONS = new Set(['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming']);
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
