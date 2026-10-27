import { STORE_CHANNEL } from '../platform/store-channel.js';
import { activeCampaignTownChapter } from './campaign-towns.js';

export const MUSIC_MIX = Object.freeze({ fade: 0.7, volume: 0.55 });
/** Android 스토어 빌드(WebView 는 Opus 를 항상 재생한다)만 지역곡을 더 작은 Opus(.ogg)로 받는다. 웹·앱인토스(iOS 사파리 포함)는 원본 mp3 그대로다. */
const OPUS_CHANNELS = new Set(['googleplay', 'onestore']);
/** 곡 이름 -> 공개 URL. 지역곡(regions/*)만 Opus 파일이 있고, 가챠곡(80kbps mp3)은 모든 채널에서 mp3 다. */
export const bgmUrl = (name, channel = STORE_CHANNEL) => `/bgm/${name}.${OPUS_CHANNELS.has(channel) && String(name).startsWith('regions/') ? 'ogg' : 'mp3'}`;
const REGIONS = new Set(['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming']);
// 장 번호나 조우 접두사로 고르는 지역(테마와 다른 곡·보스 계획을 쓰는 장). 새 지역은 여기 한 줄을 더한다.
const CHAPTER_REGION = Object.freeze({ 6: 'homecoming', 7: 'belltower' });
const PREFIX_REGIONS = Object.freeze(['homecoming', 'belltower']);
/** 테마가 아니라 장 번호·조우 접두사로 정해지는 지역 id(없으면 null). */
function campaignRegionId(stage) {
  for (const n of [stage?.ch, stage?.chapter?.id]) if (Object.hasOwn(CHAPTER_REGION, n)) return CHAPTER_REGION[n];
  for (const prefix of [stage?.encounterPrefix, stage?.chapter?.encounterPrefix]) if (PREFIX_REGIONS.includes(prefix)) return prefix;
  return null;
}
/**
 * 전용 곡이 아직 없는 지역의 곡 계획. 배송 전에는 fallback(이미 배송된 곡)을 쓰고, 생성한 파일이 들어오면 file 과 status: 'shipped' 를 적는다.
 * 7장 종탑 도시는 안개 낀 차가운 석조 도시라 서리 서고 곡이 가장 맞는 대체다. todo 는 FlowMusic 생성 대기 표시다.
 */
export const REGION_CUE_PLAN = Object.freeze([
  Object.freeze({ id: 'region-belltower', region: 'belltower', fallback: 'regions/frost', status: 'external-gui-pending', todo: '전용 BGM' }),
]);
/** 지역 id 의 지역 곡(전용 곡 계획이 있으면 배송 상태를 따른다). */
const regionTrack = region => {
  const cue = REGION_CUE_PLAN.find(entry => entry.region === region);
  return cue ? cueTrack(cue) : `regions/${region}`;
};

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
/** @typedef {{ch?: number, theme?: string, encounterPrefix?: string, encounter?: {rank?: string}, chapter?: {id?: number, theme?: string, encounterPrefix?: string}, expedition?: {kind?: string}}} MusicStage */

/**
 * All starts and resumes resolve through the same scene policy.
 * @param {{scene?: string, boss?: boolean, stage?: MusicStage | null}} context
 */
export function musicForScene({ scene = 'battle', stage = null, boss = false } = {}) {
  if (scene === 'gacha') return 'bgm_gacha';
  // 로비는 열려 있는 캠페인 마을의 지역 곡을 쓴다(1지역 마을은 기존 로비 곡).
  if (scene === 'lobby') return townMusic(activeCampaignTownChapter());
  if (stage?.expedition?.kind === 'arena') return 'regions/arena';
  if (boss) return bossMusic(stage);
  if (stage?.expedition?.kind === 'dungeon' && stage?.expedition?.depth === 'deep') {
    const routeCue = flowMusicBriefForRoute(stage.expedition.id);
    if (routeCue?.fallback) return routeCue.fallback;
  }
  if (stage?.expedition?.kind === 'dungeon' && REGIONS.has(stage?.theme)) return `regions/${stage.theme}`;
  const special = campaignRegionId(stage);
  if (special) return regionTrack(special);
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
// 지역 최종 보스(X-10)와 중간 보스(X-5)·수문장(X-3, X-7)은 서로 다른 곡을 쓴다. 지역별 전용 보스곡은
// FlowMusic GUI(대표님 PC 로그인 세션) 생성 대기다. 생성 전에는 fallback(이미 배송된 곡)을 쓴다.
// 생성된 파일을 public/bgm 에 넣으면 해당 항목에 file 과 status: 'shipped' 를 적는다(브리프: docs/audio/flowmusic-brief-h2.md).
const MIDBOSS_TRACK = 'expansion/flow-combat';
const BOSS_RANKS = Object.freeze({ midboss: 'midboss', warden: 'midboss', finalboss: 'finale' });
const REGION_IDS = Object.freeze(['garden', 'forge', 'frost', 'tide', 'crown', 'homecoming', 'belltower']);
export const BOSS_CUE_PLAN = Object.freeze(REGION_IDS.flatMap(region => [
  Object.freeze({ id: `boss-${region}-finale`, scene: 'boss', region, rank: 'finale', fallback: 'regions/boss', status: 'external-gui-pending' }),
  Object.freeze({ id: `boss-${region}-midboss`, scene: 'boss', region, rank: 'midboss', fallback: MIDBOSS_TRACK, status: 'external-gui-pending' }),
]));
/** 배송된 곡이 있으면 그 곡, 아니면 검증된 대체 곡. 생성 대기 항목이 깨진 URL 이 되지 않는다. */
const cueTrack = cue => cue.status === 'shipped' && cue.file ? cue.file : cue.fallback;
function stageRegion(stage) {
  const special = campaignRegionId(stage);
  if (special) return special;
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

// ---------- 캠페인 마을 곡 (X-1..X-10 지역 마을, 캠페인 마을 레인 c3 의 CAMPAIGN_TOWNS 와 같은 id) ----------
// 마을 전용 곡은 FlowMusic 생성 대기다(docs/audio/flowmusic-brief-h2.md). 대기 중에는 c3 의 campaignTownMusic 과 같은 대체 곡:
// 1지역은 기존 로비곡, 2~7지역은 그 지역 던전곡(7지역은 서리 서고 곡 대체). 로비(musicForScene)는 townMusic 을 써서 생성곡이 오면 status 만 바꾸면 된다.
export const TOWN_CUE_PLAN = Object.freeze([
  Object.freeze({ id: 'town-bellgarden', chapter: 1, town: 'bellgarden', fallback: 'regions/lobby', status: 'external-gui-pending' }),
  Object.freeze({ id: 'town-emberforge', chapter: 2, town: 'emberforge', fallback: 'regions/forge', status: 'external-gui-pending' }),
  Object.freeze({ id: 'town-frostarchive', chapter: 3, town: 'frostarchive', fallback: 'regions/frost', status: 'external-gui-pending' }),
  Object.freeze({ id: 'town-tidelight', chapter: 4, town: 'tidelight', fallback: 'regions/tide', status: 'external-gui-pending' }),
  Object.freeze({ id: 'town-dawncrown', chapter: 5, town: 'dawncrown', fallback: 'regions/crown', status: 'external-gui-pending' }),
  Object.freeze({ id: 'town-homeward', chapter: 6, town: 'homeward', fallback: 'regions/homecoming', status: 'external-gui-pending' }),
  Object.freeze({ id: 'town-bellspire', chapter: 7, town: 'bellspire', fallback: 'regions/frost', status: 'external-gui-pending', todo: '전용 BGM' }),
]);
/** 캠페인 지역(1~7) 마을의 배경음. 배송 전에는 대체 곡, 범위 밖은 1지역. */
export const townMusic = chapter => cueTrack(TOWN_CUE_PLAN.find(c => c.chapter === chapter) || TOWN_CUE_PLAN[0]);
/** 캠페인 지역(1~7)의 X-1..X-10 전체 곡 지도: 마을·일반 관문·중간 보스(X-3, X-5, X-7)·최종 보스(X-10). 재고표·QA 용. */
export function campaignMusicMap(chapter, { stageDef, perChapter = 10 }) {
  const stages = Array.from({ length: perChapter }, (_, i) => {
    const stage = stageDef(chapter, i + 1);
    return { stage: `${chapter}-${i + 1}`, rank: stage?.encounter?.rank || 'normal', battle: musicForScene({ stage }), boss: musicForScene({ stage, boss: true }), intro: bossIntroKind(stage) };
  });
  return { chapter, town: townMusic(chapter), stages };
}

/** musicForScene 이 돌려줄 수 있는 모든 곡(배송 검사·채널 산출물 검사용). */
export const MUSIC_TRACKS = Object.freeze([...new Set([
  'bgm_gacha', 'regions/lobby', 'regions/arena', 'regions/boss', MIDBOSS_TRACK,
  ...REGION_IDS.map(regionTrack),
  ...FLOWMUSIC_CUE_PLAN.map(cueTrack), ...BOSS_CUE_PLAN.map(cueTrack), ...TOWN_CUE_PLAN.map(cueTrack), ...REGION_CUE_PLAN.map(cueTrack),
])].sort());
