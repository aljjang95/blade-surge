export const MUSIC_MIX = Object.freeze({ fade: 0.7, volume: 0.55 });
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
/** @typedef {{ch?: number, theme?: string, townId?: string, encounterPrefix?: string, encounter?: {rank?: string}, chapter?: {id?: number, theme?: string, encounterPrefix?: string}, expedition?: {kind?: string}}} MusicStage */

/**
 * All starts and resumes resolve through the same scene policy.
 * @param {{scene?: string, boss?: boolean, stage?: MusicStage | null}} context
 */
export function musicForScene({ scene = 'battle', stage = null, boss = false } = {}) {
  if (scene === 'gacha') return 'bgm_gacha';
  if (scene === 'lobby') return 'regions/lobby';
  if (scene === 'town') return cueTrack(TOWN_CUES[stage?.townId] || TOWN_CUES.oathhold);
  if (stage?.expedition?.kind === 'arena') return 'regions/arena';
  if (boss) return bossMusic(stage);
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

// ---------- 보스·중간 보스·마을 곡 (2026-10-22 사운드 레인 h2) ----------
// 지역 최종 보스(X-10)와 중간 보스(X-5)·수문장(X-3, X-7)은 서로 다른 곡을 쓴다. 지역별 전용 보스곡·마을곡은
// FlowMusic GUI(대표님 PC 로그인 세션) 생성 대기다. 생성 전에는 fallback(이미 배송된 곡)을 쓴다.
// 생성된 파일을 public/bgm 에 넣으면 해당 항목에 file 과 status: 'shipped' 를 적는다(브리프: docs/audio/flowmusic-brief-h2.md).
const MIDBOSS_TRACK = 'expansion/flow-combat';
const BOSS_RANKS = Object.freeze({ midboss: 'midboss', warden: 'midboss', finalboss: 'finale' });
const REGION_IDS = Object.freeze(['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming']);
export const BOSS_CUE_PLAN = Object.freeze(REGION_IDS.flatMap(region => [
  Object.freeze({ id: `boss-${region}-finale`, scene: 'boss', region, rank: 'finale', fallback: 'regions/boss', status: 'external-gui-pending' }),
  Object.freeze({ id: `boss-${region}-midboss`, scene: 'boss', region, rank: 'midboss', fallback: MIDBOSS_TRACK, status: 'external-gui-pending' }),
]));
export const TOWN_CUES = Object.freeze({
  oathhold: Object.freeze({ id: 'town-oathhold', scene: 'town', town: 'oathhold', fallback: 'regions/lobby', status: 'external-gui-pending' }),
  emberport: Object.freeze({ id: 'town-emberport', scene: 'town', town: 'emberport', fallback: 'regions/lobby', status: 'external-gui-pending' }),
  starcrest: Object.freeze({ id: 'town-starcrest', scene: 'town', town: 'starcrest', fallback: 'regions/lobby', status: 'external-gui-pending' }),
});
/** 배송된 곡이 있으면 그 곡, 아니면 검증된 대체 곡. 생성 대기 항목이 깨진 URL 이 되지 않는다. */
const cueTrack = cue => cue.status === 'shipped' && cue.file ? cue.file : cue.fallback;
function stageRegion(stage) {
  if (stage?.ch === 6 || stage?.chapter?.id === 6 || stage?.encounterPrefix === 'homecoming' || stage?.chapter?.encounterPrefix === 'homecoming') return 'homecoming';
  const theme = stage?.theme || stage?.chapter?.theme;
  return REGION_IDS.includes(theme) ? theme : 'garden';
}
/** 보스 곡: 캠페인 순위(최종/중간/수문장)와 지역으로 고른다. 순위가 없는 원정·대장 보스는 기존 보스곡이다. */
function bossMusic(stage) {
  // 원정(던전·심층)의 보스는 캠페인 순위를 물려받아도 원정 보스다. 기존 보스곡을 유지한다.
  const rank = stage?.expedition ? null : BOSS_RANKS[stage?.encounter?.rank];
  if (!rank) return 'regions/boss';
  const region = stageRegion(stage);
  const cue = BOSS_CUE_PLAN.find(c => c.region === region && c.rank === rank);
  return cue ? cueTrack(cue) : 'regions/boss';
}
/** 보스 등장 스팅어 종류(엔진 audio.bossIntro 가 쓴다). */
export const bossIntroKind = (stage) => (!stage?.expedition && BOSS_RANKS[stage?.encounter?.rank]) || 'boss';

// ---------- 루프 지점·음량 보정 (tools/audio/bgm-loop-points.py 실측, 2026-10-22) ----------
// 지역곡은 완결된 곡이라 끝 4~12초가 페이드·여운이고 그대로 반복하면 무음 뒤 처음으로 뚝 돌아간다.
// 엔진은 loopEnd 전 crossfade 초 동안 loopStart 부터 새로 재생해 겹친다. loopEnd 는 추정 템포의 마디 정수배다.
// trimDb 는 통합 라우드니스를 지역곡 마스터 기준(-18 LUFS)에 맞춘다(가챠 -15.5, 중간 보스곡 -13.9 LUFS 측정).
export const BGM_LOOPS = Object.freeze({
  'regions/arena': Object.freeze({ loopStart: 0, loopEnd: 172.138, trimDb: 0 }),
  'regions/boss': Object.freeze({ loopStart: 0, loopEnd: 161.143, trimDb: 0 }),
  'regions/crown': Object.freeze({ loopStart: 0, loopEnd: 170.323, trimDb: 0 }),
  'regions/forge': Object.freeze({ loopStart: 0.05, loopEnd: 167.323, trimDb: 0 }),
  'regions/frost': Object.freeze({ loopStart: 0, loopEnd: 166.857, trimDb: 0.2 }),
  'regions/garden': Object.freeze({ loopStart: 0, loopEnd: 140.437, trimDb: 0 }),
  'regions/homecoming': Object.freeze({ loopStart: 0, loopEnd: 156, trimDb: 0 }),
  'regions/lobby': Object.freeze({ loopStart: 0.05, loopEnd: 166.204, trimDb: 0 }),
  'regions/tide': Object.freeze({ loopStart: 0.05, loopEnd: 168.817, trimDb: 0 }),
  'bgm_gacha': Object.freeze({ loopStart: 0, loopEnd: 158.571, trimDb: -2.5 }),
  'expansion/flow-combat': Object.freeze({ loopStart: 0.05, loopEnd: 59.127, trimDb: -4.1 }),
});
export const BGM_CROSSFADE = 2.5;
/** 곡의 재생 이득 보정(선형). 표에 없는 곡은 1. */
export const bgmTrimGain = name => Math.pow(10, (BGM_LOOPS[name]?.trimDb || 0) / 20);

/** musicForScene 이 돌려줄 수 있는 모든 곡(배송 검사·채널 산출물 검사용). */
export const MUSIC_TRACKS = Object.freeze([...new Set([
  'bgm_gacha', 'regions/lobby', 'regions/arena', 'regions/boss', MIDBOSS_TRACK,
  ...REGION_IDS.map(r => `regions/${r}`),
  ...FLOWMUSIC_CUE_PLAN.map(cueTrack), ...BOSS_CUE_PLAN.map(cueTrack), ...Object.values(TOWN_CUES).map(cueTrack),
])].sort());
