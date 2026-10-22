// 캠페인 지역별 마을. 지역 X의 마지막 관문 X-10을 처음 클리어하면 지역 X+1이 열리고
// 로비 마을이 그 지역의 마을로 바뀐다(저장됨). 이전에 해금한 마을은 로비의 마을 칩에서 다시 고른다.
// 마을 장면은 기존 로비 장면(citadel-hub-scene / lobby-world)의 팔레트·하늘·안개·조명·풍경만 바꾸는 "스킨"이며
// 게이트 배치·상인·교관·이동석 같은 서비스 마을(towns.js, 원정 던전 해금 기준)과는 별개다.
import { CHAPTERS, STAGES_PER_CHAPTER } from './stages.js';

const frozen = (value) => Object.freeze(value);
const palette = (stone, slate, ivory, gold, shadow, wood, teal) => frozen({ stone, slate, ivory, gold, shadow, wood, teal });
const atmosphere = (bg, fog, density, hemi, hemiI, sun, sunI, sunPos, rim, rimI) => frozen({
  bg, fog, density, hemi: frozen(hemi), hemiI, sun, sunI, sunPos: frozen(sunPos), rim, rimI,
});

/**
 * chapter 1 은 기존 성채 광장·숲 마을을 그대로 쓴다(skin 없음). 2~6 은 지역 던전의 색과 소품에서 만든 새 마을이다.
 * scenery 는 lobby-world.js 의 지역 마을 풍경 이름이다.
 */
export const CAMPAIGN_TOWNS = frozen([
  frozen({
    chapter: 1, id: 'bellgarden', name: '종지기 정원 마을', subtitle: 'BELL GARDEN', theme: 'garden', scenery: null,
    mood: '맑은 청록빛 종탑과 정원', accent: '#87cbb0', skin: null,
  }),
  frozen({
    chapter: 2, id: 'emberforge', name: '불씨 용광로 마을', subtitle: 'EMBER FORGE', theme: 'forge', scenery: 'forge',
    mood: '식지 않는 화로와 용암 수로', accent: '#ff9a50', waystone: 0xff8a3a,
    grove: frozen([0x8a3a1c, .55]),
    palette: palette(0x5a4a44, 0x453733, 0xe2c9a0, 0xff9a3d, 0x24191a, 0x4a2f22, 0xd2512a),
    atmosphere: atmosphere(0x24100f, 0x4a1d14, .018, [0xffb078, 0x2a1512], .9, 0xff7a38, 3, [-14, 12, 12], 0xff5a28, 1.6),
    sky: frozen({ horizon: 0xe0662e, zenith: 0x1f0d14, ground: 0x2a1512 }), ground: frozen({ inner: 0x3a2622, outer: 0x1b100f, y: -1.1 }),
  }),
  frozen({
    chapter: 3, id: 'frostarchive', name: '서리 서고 마을', subtitle: 'FROST ARCHIVE', theme: 'frost', scenery: 'archive',
    mood: '거꾸로 흐르는 책장과 보랏빛 서리', accent: '#c3b2ff', waystone: 0xb9a8ff,
    grove: frozen([0xc8baf6, .6]),
    palette: palette(0x7a72a8, 0x5d5688, 0xe9e4fa, 0xc3b2ff, 0x2c2650, 0x5b4a6a, 0x8f9cff),
    atmosphere: atmosphere(0x150f32, 0x352a6c, .015, [0xc0b4ff, 0x1d1840], .85, 0xd8d0ff, 1.9, [8, 22, 6], 0xb4a4ff, 1.8),
    sky: frozen({ horizon: 0xa898e6, zenith: 0x0d0a2a, ground: 0x241c4a }), ground: frozen({ inner: 0xd9d4f2, outer: 0x4a4580, y: -.8 }),
  }),
  frozen({
    chapter: 4, id: 'tidelight', name: '별잠 등대 마을', subtitle: 'TIDELIGHT', theme: 'tide', scenery: 'tide',
    mood: '가라앉은 선단 위로 켜진 등대', accent: '#6fe3d6', waystone: 0x5ef0e0,
    grove: frozen([0x2fb3b5, .55]),
    palette: palette(0x2f6670, 0x244f5a, 0xcfeee8, 0x7fe0d0, 0x0f2a33, 0x3d5a52, 0x2fb3b5),
    atmosphere: atmosphere(0x06222c, 0x0d4a57, .02, [0x7fe0d6, 0x0b2a33], .85, 0x9ff5e6, 1.7, [6, 20, 10], 0x5ee0ff, 2),
    sky: frozen({ horizon: 0x2c8fa0, zenith: 0x03121c, ground: 0x082a36 }), ground: frozen({ inner: 0x1f6c7a, outer: 0x07262f, y: -1.3 }),
  }),
  frozen({
    chapter: 5, id: 'dawncrown', name: '새벽 성문 마을', subtitle: 'DAWN GATE', theme: 'crown', scenery: 'crown',
    mood: '새벽을 삼키는 금빛 왕관의 그림자', accent: '#f2c45c', waystone: 0xffd36a,
    grove: frozen([0x9a62b8, .5]),
    palette: palette(0x6a5c78, 0x4e4260, 0xf0dca8, 0xf2c45c, 0x261c34, 0x5c4636, 0xb87ad8),
    atmosphere: atmosphere(0x1e1030, 0x4a2a5c, .016, [0xe8b6ff, 0x2a1a3a], .9, 0xffd27a, 2.8, [-10, 14, 12], 0xd6a0ff, 1.7),
    sky: frozen({ horizon: 0xf0a860, zenith: 0x1a0c34, ground: 0x2a1a3a }), ground: frozen({ inner: 0x4a3c58, outer: 0x1c1228, y: -1 }),
  }),
  frozen({
    chapter: 6, id: 'homeward', name: '함께 잇는 귀환 마을', subtitle: 'HOMEWARD', theme: 'garden', scenery: 'homeward',
    mood: '아침 햇살이 드는 다리와 들판', accent: '#ffd27a', waystone: 0xffd78a,
    palette: palette(0x8a8f78, 0x6c7260, 0xf4ecd0, 0xe9b85a, 0x3f4a3a, 0x7b5a3c, 0x6cbf8a),
    atmosphere: atmosphere(0x7fb6d8, 0xbfd9dc, .011, [0xfff0cf, 0x4f6b4a], 1.1, 0xffe0a0, 2.8, [-12, 18, 10], 0xffd0a0, 1.2),
    sky: frozen({ horizon: 0xffd9a8, zenith: 0x4f93c8, ground: 0x6f9a5a }), ground: frozen({ inner: 0x8fc36a, outer: 0x4f7a42, y: -.8 }),
  }),
]);

export const CAMPAIGN_TOWN_BY_CHAPTER = frozen(Object.fromEntries(CAMPAIGN_TOWNS.map((town) => [town.chapter, town])));
export const CAMPAIGN_TOWN_COUNT = CAMPAIGN_TOWNS.length;

export function campaignTown(chapter) {
  return CAMPAIGN_TOWN_BY_CHAPTER[chapter] || CAMPAIGN_TOWNS[0];
}

/** unlocked(출격 가능한 마지막 관문의 1부터 시작하는 번호)가 가리키는 가장 먼 해금 지역. */
export function latestTownChapter(progress) {
  const floors = CHAPTERS.length * STAGES_PER_CHAPTER;
  const unlocked = Number.isSafeInteger(progress?.unlocked) ? Math.max(1, Math.min(floors, progress.unlocked)) : 1;
  return Math.min(CAMPAIGN_TOWN_COUNT, Math.ceil(unlocked / STAGES_PER_CHAPTER));
}

const asChapter = (value) => (Number.isSafeInteger(value) && value >= 1 && value <= CAMPAIGN_TOWN_COUNT ? value : 0);

/**
 * 저장된 { current, celebrated }과 진행도에서 마을 상태를 정한다. 순수 함수이고 여러 번 적용해도 같다.
 * - current: 지금 로비가 보여 주는 마을(해금된 마을만). 값이 없거나 잘못되면 가장 최근에 해금한 마을.
 * - celebrated: 해금 축하를 이미 보여 준 가장 먼 마을. 값이 없으면(기존 저장) 이미 해금한 마을은 축하한 것으로 본다.
 */
export function resolveCampaignTown(progress, saved) {
  const latest = latestTownChapter(progress);
  const current = asChapter(saved?.current), celebrated = asChapter(saved?.celebrated);
  return {
    latest,
    current: current && current <= latest ? current : latest,
    celebrated: Math.min(latest, celebrated || latest),
  };
}

/** 처음 클리어한 관문이 다음 지역을 여는지(X-10 이고 마지막 지역이 아님). */
export function regionUnlockedBy(stage) {
  return stage && stage.st === STAGES_PER_CHAPTER && stage.ch < CAMPAIGN_TOWN_COUNT ? campaignTown(stage.ch + 1) : null;
}

/** 지역 마을이 로비에 흘리는 배경음. 1지역은 기존 로비 곡을 그대로 쓴다. */
export function campaignTownMusic(chapter) {
  const town = campaignTown(chapter);
  return town.chapter === 1 ? 'regions/lobby' : `regions/${chapter === 6 ? 'homecoming' : town.theme}`;
}

// 로비 장면이 읽는 현재 마을. 저장이 아니라 화면 상태이며 Economy → app 이 동기화한다.
let activeChapter = 1;
export const activeCampaignTownChapter = () => activeChapter;
export function setActiveCampaignTownChapter(chapter) { activeChapter = asChapter(chapter) || 1; return activeChapter; }
/** 로비 장면에 입힐 스킨. 1지역(원형 성채)은 null. */
export const activeCampaignSkin = () => campaignTown(activeChapter).skin === null ? null : campaignTown(activeChapter);
