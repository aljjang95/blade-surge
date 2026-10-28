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

/** 4장 별이 잠긴 심해 — 남색·청록, 심해 청록 발광. 보라·분홍 몸은 심해 청록으로, 붉은 용은 남청으로. */
const DEEP_SKIN = { emissive: '#021a1c', remap: { dark: '#0d2a3a', light: '#7fe8dc', hues: [235, 345], mix: 0.95, baseMix: 0.12 } };
const DEEP_DRAKE = { emissive: '#021a1c', remap: { dark: '#0e2a44', light: '#86e6dc', hues: [330, 60], mix: 0.85, baseMix: 0.15 } };
// 심해 버섯·슬라임: 붉은 갓·연두 몸을 심해 청록으로(빛 주머니 발광과 같은 색 계열).
const DEEP_MUSH = { emissive: '#021a1c', remap: { dark: '#0c2c36', light: '#8ef0e2', hues: [330, 40], mix: 0.85, baseMix: 0.1 } };
const DEEP_SLIME = { emissive: '#021a1c', remap: { dark: '#0c2c36', light: '#9af2e6', hues: [50, 190], mix: 0.9, baseMix: 0.2 } };

/** 5장 새벽을 먹는 왕관 — 새벽 보라와 금. 보라는 그대로 두고(장 색) 금 소품과 새벽빛 발광으로 왕관의 집행관을 표시한다. */
const CROWN_SKIN = { color: '#d9c9e8', amount: 0.14, emissive: '#120a1c' };
// 빈 왕관(나무 몸): 초록을 새벽 보라로 바꿔 왕관에 먹힌 그림자로.
// 버섯 갓·연두 슬라임도 새벽 보라로(왕관에 먹힌 새벽의 그림자).
const CROWN_MUSH = { emissive: '#120a1c', remap: { dark: '#2a1640', light: '#d6b2f6', hues: [330, 40], mix: 0.8, baseMix: 0.1 } };
const CROWN_SLIME = { emissive: '#120a1c', remap: { dark: '#2a1640', light: '#dcc0fa', hues: [50, 190], mix: 0.9, baseMix: 0.2 } };
const CROWN_HOLLOW = { emissive: '#120a1c', remap: { dark: '#24163a', light: '#c9a8f2', hues: [50, 170], mix: 0.9, baseMix: 0.2 } };

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
      frost_midboss: { props: ['censorSeal', 'openTome'] },
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
  4: {
    name: '조난 신호의 형체',
    species: {
      // 부유 촉수·심연 눈알: 가짜 등대 빛을 매단 심해 생물.
      squidle: { ...DEEP_SKIN, props: ['lureLamp'] },
      glub: { ...DEEP_SKIN, props: ['lureLamp'] },
      abyss_seer: { ...DEEP_SKIN, props: ['lureLamp', 'glowPouches'] },
      // 심연 슬라임: 분홍을 심해 청록으로, 따개비가 붙는다. 심연 폭탄은 자폭 경고 색(자홍)을 유지한다.
      blob_pink: { ...DEEP_SLIME, props: ['barnaclesTop'] },
      bomb_abyss: { props: ['barnaclesTop'] },
      // 이계 침입자 → 난파선 판자 방패를 든 수부.
      alien: { ...DEEP_SKIN, props: ['plankShield', 'barnacles'] },
      // 포자 괴물: 심해 빛 주머니를 단 버섯.
      mushnub: { ...DEEP_MUSH, props: ['glowPouches'] },
      // 골렘 수호자 → 산호 골렘.
      golem_guard: { ...DEEP_SKIN, props: ['coralGrowth'] },
      elite_golem: { ...DEEP_SKIN, props: ['coralGrowth', 'anchorChain'] },
      elite_mushroom_king: { ...DEEP_MUSH, props: ['glowPouches', 'coralGrowth'] },
      elite_dragonling: { ...DEEP_DRAKE, props: ['glowPouches'] },
      // 4장 confluence 경로에 섞이는 해골·원령: 따개비 해골·익사한 원령.
      skel_minion: { ...DEEP_SKIN, props: ['anchorChain', 'barnacles'] },
      elite_skel_captain: { ...DEEP_SKIN, props: ['plankShield', 'anchorChain'] },
      ghost: { ...DEEP_SKIN, props: ['lureLamp'] },
      ghost_skull: { ...DEEP_SKIN, props: ['lureLamp'] },
      // 등대지기 마렌(중간 보스)·해왕 네레이스(최종 보스).
      tide_midboss: { ...DEEP_MUSH, props: ['lighthouseLens', 'glowPouches'] },
      tide_finalboss: { ...DEEP_DRAKE, emissive: '#04282a', props: ['tideCrown', 'glowPouches'] },
    },
    assets: {
      star_owl: { ...DEEP_SKIN, props: ['lureLamp'] },
      slime: { ...DEEP_SLIME, props: ['barnaclesTop'] },
      shadow_soldier: { ...DEEP_SKIN, props: ['plankShield'] },
      mushroom_shaman: { ...DEEP_MUSH, props: ['glowPouches'] },
      frost_golem: { ...DEEP_SKIN, props: ['coralGrowth'] },
      ember_drake: { ...DEEP_DRAKE, props: ['glowPouches'] },
      bone_knight: { ...DEEP_SKIN, props: ['anchorChain', 'barnacles'] },
      void_wisp: { ...DEEP_SKIN, props: ['lureLamp'] },
      skeleton_mage: { ...DEEP_SKIN, props: ['lureLamp'] },
      goblin_chief: { ...DEEP_SKIN, props: ['anchorChain'] },
      frost_yeti: { ...DEEP_SKIN, props: ['coralGrowth'] },
      demon_lord: { ...DEEP_SKIN, props: ['tideCrown'] },
      treant: { ...DEEP_SKIN, props: ['coralGrowth'] },
      fire_phoenix: { ...DEEP_SKIN },
    },
  },
  5: {
    name: '집행관의 손발',
    species: {
      // 그림자 닌자: 새벽빛 가면. 이계 침입자·해골 병사 → 왕관 병사(작은 금관).
      ninja: { ...CROWN_SKIN, props: ['dawnMask'] },
      alien: { ...CROWN_SKIN, props: ['soldierCirclet', 'swordWallShield'] },
      skel_minion: { ...CROWN_SKIN, props: ['soldierCirclet'] },
      skel_rogue: { ...CROWN_SKIN, props: ['dawnMask'] },
      // 성벽 검 방패.
      skel_shield: { ...CROWN_SKIN, props: ['soldierCirclet', 'swordWallShield'] },
      bone_orc: { ...CROWN_SKIN, props: ['goldChains'] },
      imp: { ...CROWN_MUSH, props: ['soldierCirclet'] },
      bomb_abyss: { props: ['crownRing'] },
      bomb_slime: { ...CROWN_SLIME, props: ['crownRing'] },
      // 심연 주시자: 왕관 고리. 원거리·주술사는 금관.
      abyss_seer: { ...CROWN_SKIN, props: ['crownRing'] },
      ghost: { ...CROWN_SKIN, props: ['crownRing'] },
      ghost_skull: { ...CROWN_SKIN, props: ['crownRing'] },
      tribal_shaman: { ...CROWN_SKIN, props: ['soldierCirclet'] },
      skel_mage: { ...CROWN_SKIN, props: ['soldierCirclet'] },
      skel_priest: { ...CROWN_SKIN, props: ['hornCrown'] },
      // 정예: 왕관 뿔의 푸른 악마, 금 사슬의 새끼 용, 맹세 깃발의 해골 대장.
      elite_bluedemon: { ...CROWN_SKIN, props: ['hornCrown', 'goldChains'] },
      elite_dragonling: { ...CROWN_SKIN, props: ['goldChains'] },
      elite_skel_captain: { ...CROWN_SKIN, props: ['soldierCirclet', 'oathBanner'] },
      elite_bone_lord: { ...CROWN_SKIN, props: ['goldChains'] },
      elite_wraith: { ...CROWN_SKIN, props: ['crownRing'] },
      // 첫 기사 아스텔(중간 보스)·빈 왕관(최종 보스: 몸 위에 떠 있는 빈 금관).
      crown_midboss: { ...CROWN_SKIN, props: ['hornCrown', 'swordWallShield', 'oathBanner'] },
      crown_finalboss: { ...CROWN_HOLLOW, emissive: '#1a0a2a', props: ['emptyCrown', 'goldChains'] },
    },
    assets: {
      shadow_soldier: { ...CROWN_SKIN, props: ['dawnMask'] },
      bone_knight: { ...CROWN_SKIN, props: ['soldierCirclet'] },
      goblin_chief: { ...CROWN_SKIN, props: ['goldChains'] },
      mushroom_shaman: { ...CROWN_MUSH, props: ['soldierCirclet'] },
      slime: { ...CROWN_SLIME, props: ['crownRing'] },
      star_owl: { ...CROWN_SKIN, props: ['crownRing'] },
      goblin_raider: { ...CROWN_SKIN, props: ['soldierCirclet'] },
      demon_lord: { ...CROWN_SKIN, props: ['hornCrown'] },
      ember_drake: { ...CROWN_SKIN, props: ['goldChains'] },
      void_wisp: { ...CROWN_SKIN, props: ['crownRing'] },
      skeleton_mage: { ...CROWN_SKIN, props: ['soldierCirclet'] },
      treant: { ...CROWN_HOLLOW, props: ['emptyCrown'] },
      frost_yeti: { ...CROWN_SKIN, props: ['hornCrown'] },
      frost_golem: { ...CROWN_SKIN, props: ['goldChains'] },
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
