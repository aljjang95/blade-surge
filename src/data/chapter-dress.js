// 장별 몬스터 의상(아트 바이블 docs/MONSTER_ART_BIBLE.md) — 같은 Tripo 몸을 여러 장이 나눠 쓰므로,
// 장마다 '그 지역에 묶인 이유'가 보이도록 색·발광과 뼈에 붙이는 소품 실루엣을 입힌다.
// 키: 장 번호 → { palette, species: { 적 id: 의상 }, assets: { 라이브러리 asset id: 의상(종 표에 없을 때) } }
// 의상: { color?: 몸 색조(lerp), amount?: 0~1, emissive?: 기본 발광, props?: [소품 키] }
// 소품 키는 src/game/chapter-dress.js PROP_BUILDERS 에 있다. 새 Tripo 몸이 오면 monster-roster.js 의 asset 만 바꾸고
// 여기서 그 종의 소품을 빼면 된다(소품은 몸에 이미 있는 실루엣을 대신하던 것).

/** @typedef {{ dark: string, light: string, hues: [number, number], mix: number, baseMix?: number }} DressRemap */
/** @typedef {{ color?: string, amount?: number, emissive?: string, remap?: DressRemap, props?: string[] }} DressSpec */

/** 1장 잊힌 종의 정원 — 장례 행렬. 청록·묘비 회색, 관을 멘 해골, 떠도는 원령, 이름 없는 묘비·부서진 종·시들지 않는 꽃. */
// remap: 몸 텍스처의 보라·자주(해골 깃털·천, 원령 몸) 색을 상복 청록으로 옮긴다. 뼈(무채색)는 그대로 둔다.
const GARDEN_REMAP = { dark: '#16352f', light: '#a9e6d4', hues: [235, 345], mix: 0.95, baseMix: 0.12 };
const GARDEN_BONE = { color: '#a7beb6', amount: 0.22, emissive: '#071a16', remap: GARDEN_REMAP };
// 원령은 몸 전체가 보라라 색상 범위를 넓히고 거의 전부 옮긴다.
// 해골 주술사 몸의 파란 두건도 장례 사제의 청록 상복으로.
const MAGE_REMAP = { ...GARDEN_REMAP, hues: [190, 345] };
const GARDEN_SPIRIT = { remap: { dark: '#123f37', light: '#c4f7ea', hues: [180, 360], mix: 1, baseMix: 0.6 }, emissive: '#174a40' };

/** 2장 불씨 왕국의 용광로 — 그을음 낀 몸, 쇳물 주황 발광 소품. */
const FORGE_SKIN = { color: '#c9a48a', amount: 0.18, emissive: '#140600' };

/** 3장 거꾸로 흐르는 서리 도서관 — 백지 흰색·서리 하늘색. 보라 천·원령은 서리 청색으로, 초록 슬라임은 얼음빛으로. */
const FROST_REMAP = { dark: '#1d3550', light: '#cfeeff', hues: [235, 345], mix: 0.95, baseMix: 0.1 };
const FROST_BONE = { color: '#c6dcef', amount: 0.2, emissive: '#05101c', remap: FROST_REMAP };
const FROST_MAGE_REMAP = { ...FROST_REMAP, hues: [190, 345] };
const FROST_SPIRIT = { remap: { dark: '#1b3a5a', light: '#dff4ff', hues: [180, 360], mix: 1, baseMix: 0.5 }, emissive: '#16365a' };
const FROST_SLIME_REMAP = { dark: '#2a5a7a', light: '#e2f6ff', hues: [50, 190], mix: 0.9, baseMix: 0.2 };

/** @type {Readonly<Record<number, { name: string, species: Record<string, DressSpec>, assets: Record<string, DressSpec> }>>} */
export const CHAPTER_DRESS = Object.freeze({
  1: {
    name: '장례 행렬',
    species: {
      // 관꾼 해골: 빈 관을 메고 상복 두건을 쓴 행렬의 맨 앞줄.
      skel_minion: { ...GARDEN_BONE, props: ['mourningHood', 'coffin'] },
      // 곡꾼: 이미 두건 쓴 몸이라 보라 천·검기를 상복 청록으로만 바꾼다(소품을 얹으면 실루엣이 탑처럼 솟는다).
      skel_rogue: { ...GARDEN_BONE, color: '#7f938d', amount: 0.3 },
      // 묘비 방패병: 이름이 지워진 묘비를 방패로 든다.
      skel_shield: { ...GARDEN_BONE, props: ['mourningHood', 'tombShield'] },
      // 장례 사제: 촛불 관을 쓰고 행렬을 이끈다.
      skel_mage: { ...GARDEN_BONE, remap: MAGE_REMAP, props: ['candleCrown'] },
      skel_priest: { ...GARDEN_BONE, remap: { ...MAGE_REMAP, light: '#e4f5ee' }, props: ['candleCrown'] },
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
      shadow_soldier: { ...GARDEN_BONE, color: '#7f938d', amount: 0.36 },
      skeleton_mage: { ...GARDEN_BONE, remap: MAGE_REMAP, props: ['candleCrown'] },
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
  2: {
    name: '멈추지 못한 장인',
    species: {
      // 앞치마 오크: 같은 하루의 노동에 굳은 장인. 앞치마와 등에 멘 망치.
      orc: { ...FORGE_SKIN, props: ['smithApron', 'forgeHammerBack'] },
      // 꼬마 화부: 풀무를 지고 불을 지핀다.
      orc_blob: { ...FORGE_SKIN, props: ['bellowsBack'] },
      // 부족 전사: 미완성 칼 다발을 지고 다닌다.
      tribal: { ...FORGE_SKIN, props: ['unfinishedBlades'] },
      // 가시 수호병 → 모루 방패.
      cacto_wall: { ...FORGE_SKIN, props: ['anvilShield'] },
      // 폭발 임프: 머리 심지에 불이 붙어 있다(자폭 경고와 같은 읽기).
      bomb_imp: { props: ['emberWick'] },
      imp: { ...FORGE_SKIN, props: ['emberCap'] },
      ash_burrower: { props: ['emberCap'] },
      // 부족 주술사: 깨진 질그릇 등잔을 머리에 이고 불씨를 던진다.
      tribal_shaman: { ...FORGE_SKIN, props: ['emberLantern'] },
      elite_orc_chief: { ...FORGE_SKIN, props: ['smithApron', 'unfinishedGreatsword'] },
      elite_bluedemon: { props: ['emberChains'] },
      // 대장장이 이그란(중간 보스)·화왕 발드(최종 보스, 왕관 용광로).
      forge_midboss: { ...FORGE_SKIN, props: ['smithApron', 'unfinishedBlades', 'forgeHammerBack'] },
      forge_finalboss: { ...FORGE_SKIN, emissive: '#2a0c02', props: ['crucibleCrown', 'emberChains'] },
    },
    assets: {
      goblin_brute: { ...FORGE_SKIN, props: ['smithApron', 'forgeHammerBack'] },
      goblin_raider: { ...FORGE_SKIN, props: ['bellowsBack'] },
      goblin_chief: { ...FORGE_SKIN, props: ['smithApron'] },
      treant: { ...FORGE_SKIN, props: ['anvilShield'] },
      mushroom_shaman: { props: ['emberCap'] },
      demon_lord: { props: ['crucibleCrown'] },
      ember_drake: { props: ['emberChains'] },
      frost_yeti: { ...FORGE_SKIN, props: ['smithApron'] },
      bone_knight: { ...FORGE_SKIN, props: ['unfinishedBlades'] },
      skeleton_mage: { ...FORGE_SKIN, props: ['emberLantern'] },
      slime: { props: ['emberWick'] },
    },
  },
  3: {
    name: '얼어붙은 증언',
    species: {
      // 서리 해골 사서: 얼어붙은 금서 더미를 지고, 서가를 방패로 든다.
      skel_shield: { ...FROST_BONE, props: ['shelfShield'] },
      bone_orc: { ...FROST_BONE, props: ['bookStackBack'] },
      skel_rogue: { ...FROST_BONE },
      // 망령: 얼음에 갇힌 증언 — 주위에 얼어붙은 종이가 맴돈다. 해골 망령(원거리)은 펼친 금서를 읽는다.
      ghost: { ...FROST_SPIRIT, props: ['frozenPages'] },
      ghost_skull: { ...FROST_SPIRIT, props: ['openTome'] },
      // 해골 주술사·사제: 금서를 펼치는 기록관 / 얼음 깃펜 관.
      skel_mage: { ...FROST_BONE, remap: FROST_MAGE_REMAP, props: ['openTome'] },
      skel_priest: { ...FROST_BONE, remap: { ...FROST_MAGE_REMAP, light: '#eef8ff' }, props: ['iceQuillCrown'] },
      // 부패 슬라임 → 서리 슬라임: 초록을 얼음빛으로, 머리에 얼음 결정.
      blob_green: { remap: FROST_SLIME_REMAP, props: ['iceShardsTop'] },
      frost_burrower: { props: ['iceShards'] },
      // 골렘 수호자: 검열관 — 등에 커다란 봉인 도장.
      golem_guard: { props: ['censorSeal'] },
      elite_golem: { props: ['censorSeal', 'iceShards'] },
      // 설산 거인 → 금서실 수문장: 열쇠 꾸러미와 책 더미.
      elite_yeti: { props: ['keyRing', 'bookStackBack'] },
      elite_wraith: { ...FROST_SPIRIT, props: ['openTome', 'spiritHalo'] },
      // 기록관 오르딘(중간 보스)·서리왕 이셀(최종 보스).
      frost_midboss: { props: ['bookStackBack', 'openTome'] },
      frost_finalboss: { emissive: '#0a1c30', props: ['iceCrown', 'keyRing'] },
    },
    assets: {
      bone_knight: { ...FROST_BONE, props: ['shelfShield'] },
      shadow_soldier: { ...FROST_BONE },
      skeleton_mage: { ...FROST_BONE, remap: FROST_MAGE_REMAP, props: ['openTome'] },
      goblin_chief: { ...FROST_BONE, props: ['bookStackBack'] },
      void_wisp: { ...FROST_SPIRIT, props: ['frozenPages'] },
      slime: { remap: FROST_SLIME_REMAP, props: ['iceShardsTop'] },
      frost_golem: { props: ['censorSeal'] },
      frost_yeti: { props: ['keyRing'] },
      goblin_raider: { props: ['iceShards'] },
      mushroom_shaman: { props: ['iceShards'] },
      treant: { props: ['iceShards'] },
      ember_drake: { remap: { dark: '#1a3350', light: '#d6f0ff', hues: [0, 70], mix: .85, baseMix: .2 } },
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
