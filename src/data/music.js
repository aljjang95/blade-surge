import { STORE_CHANNEL } from '../platform/store-channel.js';
import { activeCampaignTownChapter, campaignTownMusic } from './campaign-towns.js';

export const MUSIC_MIX = Object.freeze({ fade: 0.7, volume: 0.55 });
/** Android 스토어 빌드(WebView 는 Opus 를 항상 재생한다)만 지역곡을 더 작은 Opus(.ogg)로 받는다. 웹·앱인토스(iOS 사파리 포함)는 원본 mp3 그대로다. */
const OPUS_CHANNELS = new Set(['googleplay', 'onestore']);
/** 곡 이름 -> 공개 URL. 지역곡(regions/*)만 Opus 파일이 있고, 가챠곡(80kbps mp3)은 모든 채널에서 mp3 다. */
export const bgmUrl = (name, channel = STORE_CHANNEL) => `/bgm/${name}.${OPUS_CHANNELS.has(channel) && String(name).startsWith('regions/') ? 'ogg' : 'mp3'}`;
const REGIONS = new Set(['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming']);

// FLOW web generation brief.  `fallback` is the verified shipped cue used
// until the authenticated FlowMusic GUI exports the replacement master; a
// pending cue must never become a broken URL in a live build.
export const FLOWMUSIC_CUE_PLAN = Object.freeze([
  { id: 'lobby-aurora-20260914', scene: 'lobby', target: 'lobby', fallback: 'regions/lobby', status: 'external-gui-pending' },
  { id: 'dungeon-garden-glass-20260914', scene: 'dungeon', route: 'glass_garden', target: 'garden', fallback: 'regions/garden', status: 'external-gui-pending' },
  { id: 'dungeon-forge-ember-20260914', scene: 'dungeon', route: 'ember_vault', target: 'forge', fallback: 'regions/forge', status: 'external-gui-pending' },
  { id: 'dungeon-frost-star-20260914', scene: 'dungeon', route: 'star_archive', target: 'frost', fallback: 'regions/frost', status: 'external-gui-pending' },
  { id: 'dungeon-garden-bellfall-20260914', scene: 'dungeon', route: 'bellfall_crypt', target: 'garden', fallback: 'regions/garden', status: 'external-gui-pending' },
  { id: 'dungeon-tide-cinder-20260914', scene: 'dungeon', route: 'cinder_tide_lock', target: 'tide', fallback: 'regions/tide', status: 'external-gui-pending' },
  { id: 'dungeon-frost-nightglass-20260914', scene: 'dungeon', route: 'nightglass_observatory', target: 'frost', fallback: 'regions/frost', status: 'external-gui-pending' },
  { id: 'dungeon-tide-eclipse-20260914', scene: 'dungeon', route: 'eclipse_hydra_vault', target: 'tide', fallback: 'regions/tide', status: 'external-gui-pending' },
  { id: 'dungeon-forge-ash-20260914', scene: 'dungeon', route: 'ashforge_catacomb', target: 'forge', fallback: 'regions/forge', status: 'external-gui-pending' },
  { id: 'dungeon-frost-astral-20260914', scene: 'dungeon', route: 'astral_leviathan_spire', target: 'frost', fallback: 'regions/frost', status: 'external-gui-pending' },
  { id: 'dungeon-garden-verdigris-20260914', scene: 'dungeon', route: 'verdigris_sanctum', target: 'garden', fallback: 'regions/garden', status: 'external-gui-pending' },
  { id: 'dungeon-crown-sable-20260914', scene: 'dungeon', route: 'sable_mirage_basin', target: 'crown', fallback: 'regions/crown', status: 'external-gui-pending' },
  { id: 'dungeon-frost-comet-20260914', scene: 'dungeon', route: 'comet_bastion', target: 'frost', fallback: 'regions/frost', status: 'external-gui-pending' },
  // 컨셉 던전 심층 칸(2026-10-17). 대체 곡은 기본 원정이 이미 쓰는 지역 곡과 같아 실제 재생은 바뀌지 않는다.
  { id: 'dungeon-tide-glacier-20261017', scene: 'dungeon', route: 'glacier_tide_basin', target: 'tide', fallback: 'regions/tide', status: 'external-gui-pending' },
  { id: 'dungeon-forge-sunbrass-20261017', scene: 'dungeon', route: 'sunbrass_quarry', target: 'forge', fallback: 'regions/forge', status: 'external-gui-pending' },
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
  // 로비는 열려 있는 캠페인 마을의 지역 곡을 쓴다(1지역 마을은 기존 로비 곡).
  if (scene === 'lobby') return campaignTownMusic(activeCampaignTownChapter());
  if (stage?.expedition?.kind === 'arena') return 'regions/arena';
  if (boss) return 'regions/boss';
  if (stage?.expedition?.kind === 'dungeon' && stage?.expedition?.depth === 'deep') {
    const routeCue = flowMusicBriefForRoute(stage.expedition.id);
    if (routeCue?.fallback) return routeCue.fallback;
  }
  if (stage?.expedition?.kind === 'dungeon' && REGIONS.has(stage?.theme)) return `regions/${stage.theme}`;
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
