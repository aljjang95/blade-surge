// 장별 몬스터 의상(아트 바이블 docs/MONSTER_ART_BIBLE.md) — 같은 Tripo 몸을 여러 장이 나눠 쓰므로,
// 장마다 '그 지역에 묶인 이유'가 보이도록 색·발광과 뼈에 붙이는 소품 실루엣을 입힌다.
// 키: 장 번호 → { palette, species: { 적 id: 의상 }, assets: { 라이브러리 asset id: 의상(종 표에 없을 때) } }
// 의상: { color?: 몸 색조(lerp), amount?: 0~1, emissive?: 기본 발광, props?: [소품 키] }
// 소품 키는 src/game/chapter-dress.js PROP_BUILDERS 에 있다. 새 Tripo 몸이 오면 monster-roster.js 의 asset 만 바꾸고
// 여기서 그 종의 소품을 빼면 된다(소품은 몸에 이미 있는 실루엣을 대신하던 것).

/** @typedef {{ color?: string, amount?: number, emissive?: string, ghostGlow?: string, props?: string[] }} DressSpec */

/** 1장 잊힌 종의 정원 — 장례 행렬. 청록·묘비 회색, 관을 멘 해골, 떠도는 원령, 이름 없는 묘비·부서진 종·시들지 않는 꽃. */
const GARDEN_BONE = { color: '#a7beb6', amount: 0.3, emissive: '#071a16' };
const GARDEN_SPIRIT = { color: '#bff5e6', amount: 0.35, ghostGlow: '#2b7a69' };

/** @type {Readonly<Record<number, { name: string, species: Record<string, DressSpec>, assets: Record<string, DressSpec> }>>} */
export const CHAPTER_DRESS = Object.freeze({
  1: {
    name: '장례 행렬',
    species: {
      // 관꾼 해골: 빈 관을 메고 상복 두건을 쓴 행렬의 맨 앞줄.
      skel_minion: { ...GARDEN_BONE, props: ['mourningHood', 'coffin'] },
      // 곡꾼: 짙은 두건과 상장 띠. 빠르게 옆으로 파고드는 자객 역할.
      skel_rogue: { ...GARDEN_BONE, color: '#7f938d', amount: 0.36, props: ['darkHood'] },
      // 묘비 방패병: 이름이 지워진 묘비를 방패로 든다.
      skel_shield: { ...GARDEN_BONE, props: ['mourningHood', 'tombShield'] },
      // 장례 사제: 촛불 관을 쓰고 행렬을 이끈다.
      skel_mage: { ...GARDEN_BONE, props: ['candleCrown'] },
      skel_priest: { ...GARDEN_BONE, color: '#d7e8df', amount: 0.3, props: ['candleCrown', 'mourningHood'] },
      // 묘지기: 부서진 종을 등에 지고 다닌다.
      bone_orc: { ...GARDEN_BONE, props: ['brokenBell'] },
      // 원령: 아무도 부르지 않은 이름의 마지막 목소리 — 작은 조종(弔鐘)을 매달고 청록으로 빛난다.
      ghost: { ...GARDEN_SPIRIT, props: ['spiritBell'] },
      ghost_skull: { ...GARDEN_SPIRIT, props: ['spiritBell'] },
      // 시들지 않는 꽃: 무덤가 슬라임과 균사 잠행꾼에 흰 꽃이 핀다.
      bomb_slime: { props: ['graveLilies'] },
      grave_burrower: { color: '#9fb39c', amount: 0.25, props: ['graveLilies'] },
      // 정예: 장례 기수(관+조기), 큰 종을 진 골편 군주, 대원령.
      elite_skel_captain: { ...GARDEN_BONE, props: ['mourningHood', 'coffin', 'funeralBanner'] },
      elite_bone_lord: { ...GARDEN_BONE, props: ['brokenBellLarge'] },
      elite_wraith: { ...GARDEN_SPIRIT, props: ['spiritBell', 'spiritHalo'] },
      // 애도의 기사 세렌(중간 보스)·종왕 에일른(최종 보스).
      garden_midboss: { ...GARDEN_BONE, props: ['mourningVeil', 'tombShield', 'funeralBanner'] },
      garden_finalboss: { ...GARDEN_BONE, emissive: '#0e2c25', props: ['bellCrown', 'brokenBellLarge'] },
    },
    // 관문 대장·수문장(던전 경로 보스)처럼 종 표에 없는 1장 적은 몸(asset) 기준으로 장 정체성을 입힌다.
    assets: {
      bone_knight: { ...GARDEN_BONE, props: ['mourningHood', 'coffin'] },
      shadow_soldier: { ...GARDEN_BONE, color: '#7f938d', amount: 0.36, props: ['darkHood'] },
      skeleton_mage: { ...GARDEN_BONE, props: ['candleCrown'] },
      goblin_chief: { ...GARDEN_BONE, props: ['brokenBell'] },
      void_wisp: { ...GARDEN_SPIRIT, props: ['spiritBell'] },
      slime: { props: ['graveLilies'] },
      mushroom_shaman: { props: ['graveLilies'] },
      ember_drake: { color: '#8fb7aa', amount: 0.4, emissive: '#06201a' },
      frost_yeti: { color: '#9fb8b0', amount: 0.35, props: ['brokenBellLarge'] },
      demon_lord: { color: '#8fa8a0', amount: 0.35, props: ['bellCrown'] },
      treant: { color: '#9fb39c', amount: 0.3, props: ['graveLilies'] },
    },
  },
});

/**
 * 이 관문의 적에게 입힐 의상. 원정(전용 로스터·아트)은 제외한다.
 * @param {{ expedition?: unknown, ch?: number, chapter?: { id?: number } } | null | undefined} stage
 * @param {string} species 런타임 적 id
 * @param {string | null | undefined} asset 실제 로드된 라이브러리 asset id
 * @returns {DressSpec | null}
 */
export function chapterDressFor(stage, species, asset) {
  if (!stage || stage.expedition) return null;
  const ch = stage.chapter?.id ?? stage.ch;
  const table = CHAPTER_DRESS[ch];
  if (!table) return null;
  if (Object.hasOwn(table.species, species)) return table.species[species];
  return asset && Object.hasOwn(table.assets, asset) ? table.assets[asset] : null;
}
