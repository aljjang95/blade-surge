// 장별 몬스터 의상(아트 바이블 docs/MONSTER_ART_BIBLE.md) — 같은 Tripo 몸을 여러 장이 나눠 쓰므로,
// 장마다 '그 지역에 묶인 이유'가 보이도록 색·발광과 뼈에 붙이는 소품 실루엣을 입힌다.
// 키: 장 번호 → { palette, species: { 적 id: 의상 }, assets: { 라이브러리 asset id: 의상(종 표에 없을 때) } }
// 의상: { color?: 몸 색조(lerp), amount?: 0~1, emissive?: 기본 발광, props?: [소품 키] }
// 소품 키는 src/game/chapter-dress.js PROP_BUILDERS 에 있다. 새 Tripo 몸이 오면 monster-roster.js 의 asset 만 바꾸고
// 여기서 그 종의 소품을 빼면 된다(소품은 몸에 이미 있는 실루엣을 대신하던 것).

import { DUNGEON_HOME, speciesStageOf } from './stages.js';

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
// 버섯 갓·연두 슬라임도 새벽 보라로(왕관에 먹힌 새벽의 그림자).
const CROWN_MUSH = { emissive: '#120a1c', remap: { dark: '#2a1640', light: '#d6b2f6', hues: [330, 40], mix: 0.8, baseMix: 0.1 } };
const CROWN_SLIME = { emissive: '#120a1c', remap: { dark: '#2a1640', light: '#dcc0fa', hues: [50, 190], mix: 0.9, baseMix: 0.2 } };
// 빈 왕관(나무 몸): 초록을 새벽 보라로 바꿔 왕관에 먹힌 그림자로.
const CROWN_HOLLOW = { emissive: '#120a1c', remap: { dark: '#24163a', light: '#c9a8f2', hues: [50, 170], mix: 0.9, baseMix: 0.2 } };

/** 6장 잔향 — 고향 장 의상 위에 1장과 같은 귀환 청록 발광. */
const ECHO_SKIN = { color: '#b9d6cc', amount: 0.2, emissive: '#13403a' };
/** 7장 금 간 종탑의 도시 — 바랜 황동. 보라 천·원령은 바랜 황동으로, 초록 슬라임은 녹청 황동으로. */
const BRASS_REMAP = { dark: '#3a3020', light: '#e6d6a6', hues: [235, 345], mix: 0.9, baseMix: 0.12 };
const BRASS_BONE = { color: '#d8ceb0', amount: 0.18, emissive: '#120d04', remap: BRASS_REMAP };
const BRASS_SPIRIT = { remap: { dark: '#3a3222', light: '#f0e2b8', hues: [180, 360], mix: 1, baseMix: 0.5 }, emissive: '#2a2210' };
const BRASS_SLIME = { remap: { dark: '#3a4a36', light: '#d8e0b0', hues: [50, 190], mix: 0.85, baseMix: 0.2 } };

/** @type {Readonly<Record<number, { name: string, echo?: boolean, species: Record<string, DressSpec>, assets: Record<string, DressSpec> }>>} */
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
      // 세렌은 Tripo 몸(tll_ch1_tombknight)에 베일·상복 리본이 있고 묘비 방패를 실제 왼손 소품으로 든다 → 조기만 남긴다.
      garden_midboss: { ...GARDEN_BONE, props: ['funeralBanner'] },
      // 1장 전용 Tripo 몸(stages.js CHAPTER_SPECIES): 색은 원래 종과 같고, 몸에 이미 있는 관·두건·조종 소품은 뺀다.
      ch1_coffinbearer: { ...GARDEN_BONE },
      // 곡하는 원령은 전용 몸이 이미 청록 상복이라 텍스처 재배치(원령 공용 baseMix 0.6)가 무늬를 지워 단색처럼 보였다 — 발광만 준다.
      ch1_mourner: { emissive: '#174a40' },
      // 같은 몸의 역할 갈래: 묘비 방패병은 로스터 offhand로 묘비 방패를 들고, 울부짖는 원령은 머리 위 영혼 고리로 구분한다.
      ch1_tombguard: { ...GARDEN_BONE },
      // 해골 자객 자리: 관꾼 몸에 검은 두건을 씌워 앞길을 여는 척후로 읽히게 한다.
      ch1_hoodbearer: { ...GARDEN_BONE, color: '#8a9690', props: ['darkHood'] },
      ch1_mourner_wail: { emissive: '#1d5a4e', props: ['spiritHalo'] },
      // 무덤 균사 잠행꾼 자리: 묘혈에서 솟는 원령 — 몸에 묘지 백합이 엉켜 있다.
      ch1_gravewisp: { emissive: '#12382f', props: ['graveLilies'] },
      ch1_mourner_dirge: { emissive: '#174a40', props: ['candleCrown'] },
      // 소환 전용 1장 갈래(3차): 던전 대장·주술사가 부르는 졸병도 관꾼·원령 몸에 원래 종의 기척(종·혜성 빛·밤유리 베일·이끼·서리)을 남긴다.
      ch1_mourner_bell: { emissive: '#1d5a4e', props: ['brokenBell'] },
      ch1_mourner_comet: { color: '#a8c8f0', amount: 0.25, emissive: '#14284a' },
      ch1_mourner_night: { emissive: '#16365a', props: ['mourningVeil'] },
      ch1_hoodbearer_mirage: { ...GARDEN_BONE, color: '#b8a8d8', amount: 0.3, props: ['darkHood'] },
      ch1_coffinbearer_moss: { ...GARDEN_BONE, color: '#7f9a72', amount: 0.35, props: ['mossCap'] },
      ch1_tombguard_frost: { ...GARDEN_BONE, color: '#b8d4e8', amount: 0.3 },
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
      // 이그란은 Tripo 몸(tll_ch2_igran)에 앞치마와 등의 미완성 칼 다발이 있어 소품을 얹지 않는다.
      forge_midboss: { ...FORGE_SKIN },
      // 2장 전용 Tripo 몸: 장인은 앞치마가 몸에 있고 대장 망치를 손에 들어(로스터 weapon) 소품 없음, 불씨 임프는 머리 불꽃·손 등잔이 있어 소품 없음.
      ch2_smith: { ...FORGE_SKIN },
      ch2_emberimp: { ...FORGE_SKIN },
      // 같은 몸의 역할 갈래: 풀무 장인은 등에 미완성 칼 다발, 폭발 불씨 임프는 붉은 발광과 심지(자폭 경고)로 구분한다.
      ch2_smith_line: { ...FORGE_SKIN, props: ['unfinishedBlades'] },
      ch2_emberimp_line: { ...FORGE_SKIN },
      // 가시 방벽(나무 몸) 대신 장인 몸에 모루 방패, 잿더미 굴착꾼 대신 불씨 임프 몸에 불씨 모자.
      ch2_anvilguard: { ...FORGE_SKIN, props: ['anvilShield'] },
      ch2_ashimp: { ...FORGE_SKIN, props: ['emberCap'] },
      ch2_emberimp_bomb: { ...FORGE_SKIN, emissive: '#3a0a00', props: ['emberWick'] },
      // 소환 전용 2장 갈래(3차): 꼬마 오크 자리 임프는 등에 망치, 사슬 주조공·서리 거울 자리 장인은 모루 방패, 해골 병사 자리는 앞치마 견습.
      ch2_emberimp_called: { ...FORGE_SKIN, props: ['forgeHammerBack'] },
      ch2_anvilguard_chain: { ...FORGE_SKIN, props: ['anvilShield', 'emberChains'] },
      ch2_emberimp_haze: { ...FORGE_SKIN, color: '#e8b0a0', amount: 0.3 },
      ch2_smith_apprentice: { ...FORGE_SKIN, props: ['smithApron'] },
      ch2_emberimp_scribe: { ...FORGE_SKIN, props: ['openTome'] },
      ch2_anvilguard_mirror: { ...FORGE_SKIN, color: '#9fb4c8', amount: 0.3, props: ['anvilShield'] },
      ch2_emberimp_spark: { ...FORGE_SKIN, emissive: '#3a1400', props: ['emberCap'] },
      ch2_anvilguard_star: { ...FORGE_SKIN, color: '#a8b8e0', amount: 0.25, emissive: '#0c1838', props: ['anvilShield'] },
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
      // 오르딘은 Tripo 몸(tll_ch3_ordin)의 가슴에 얼음 석판이 있고 봉인 도장 철퇴를 손에 들어(로스터 weapon) 도장·금서 소품을 뺀다.
      frost_midboss: { emissive: '#0a1c30' },
      // 3장 전용 Tripo 몸(stages.js CHAPTER_SPECIES): 몸이 이미 백지 흰색·서리 하늘색이라 색은 장 팔레트 그대로 두고,
      // 사서 등의 책 더미·검열관의 두루마리 자락처럼 몸에 있는 실루엣과 겹치는 소품(bookStackBack·shelfShield·openTome)은 뺀다.
      ch3_librarian: { ...FROST_BONE },
      ch3_pagebearer: { ...FROST_BONE, props: ['frozenPages'] },
      // 서가 방패는 로스터 offhand(tll_ch3_shelfshield)로 왼손에 든다.
      ch3_shelfguard: { ...FROST_BONE },
      // 뼈 오크 자리: 금서실 열쇠 꾸러미를 찬 사서, 몸빛을 한 톤 어둡게.
      ch3_keykeeper: { ...FROST_BONE, color: '#9fb4c8', amount: 0.3, props: ['keyRing'] },
      // 서리굴 잠행꾼 자리: 얼음 바닥 밑에서 솟는 사서 — 몸에 얼음 결정.
      ch3_icecrawler: { ...FROST_BONE, props: ['iceShards'] },
      // 부패 슬라임 자리: 서고 습기의 곰팡이가 번진 사서 — 몸빛을 푸른 이끼색으로 물들인다.
      ch3_moldkeeper: { ...FROST_BONE, color: '#9cc7b4', amount: 0.38, emissive: '#06180f' },
      // 검열관은 전용 몸이 이미 서리 청색이라 재배치(원령 공용 baseMix 0.5)가 무늬를 지운다 — 발광만 준다.
      ch3_censor: { emissive: '#16365a' },
      ch3_censor_slip: { emissive: '#1d4470', props: ['frozenPages'] },
      // 금서는 로스터 weapon(tll_ch3_tome)으로 오른손에 든다. 사제 자리는 얼음 깃펜 관으로 구분한다.
      ch3_censor_tome: { emissive: '#16365a' },
      ch3_censor_quill: { emissive: '#16365a', props: ['iceQuillCrown'] },
      // 소환 전용 3장 갈래(3차): 서고·역류·법정·합류·행렬 경로 대장과 서기관들이 부르는 졸병도 사서·검열관 몸.
      ch3_censor_night: { emissive: '#1d4470', props: ['censorSeal'] },
      ch3_shelfguard_mirror: { ...FROST_BONE },
      ch3_librarian_shade: { ...FROST_BONE, color: '#b0a8d0', amount: 0.3, props: ['darkHood'] },
      ch3_censor_comet: { emissive: '#1a3a6a' },
      ch3_censor_bell: { emissive: '#16365a', props: ['brokenBell'] },
      ch3_censor_astral: { emissive: '#24346a', props: ['frozenPages'] },
      ch3_shelfguard_star: { ...FROST_BONE, emissive: '#0c1838' },
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
      // 심연 슬라임: 분홍을 심해 청록으로, 따개비가 붙는다. 심연 폭탄은 자폭 경고 색(자홍)을 유지한다(4장 캠페인 일반 방은 ch4_lurer_bomb로 바뀌고, 원본은 다른 경로·정예 소환에 남는다).
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
      // 마렌은 Tripo 몸(tll_ch4_maren)의 머리가 꺼진 등대 등실이고 장대 등롱을 손에 들어(로스터 weapon) 등대 렌즈·빛 주머니 소품을 뺀다.
      tide_midboss: { emissive: '#04282a' },
      // 4장 전용 Tripo 몸(stages.js CHAPTER_SPECIES): 몸이 이미 남색·청록이라 재배치(DEEP_SKIN remap)를 걸지 않고 발광만 준다.
      // 수부 몸에 있는 따개비·허리 닻사슬, 아귀 이마의 미끼등과 겹치는 소품(barnacles·lureLamp)은 뺀다.
      ch4_drowned: { emissive: '#021a1c' },
      // 심연 슬라임 자리: 해초에 덮인 수부 — 몸빛을 해초 녹색으로.
      ch4_drowned_line: { color: '#7fa88a', amount: 0.4, emissive: '#031a10' },
      // 이계 침입자 자리: 등에 녹슨 닻사슬을 하나 더 끄는 수부(허리 사슬과 다른 등 실루엣).
      ch4_drowned_anchor: { emissive: '#021a1c', props: ['anchorChain'] },
      // 포자 괴물 자리: 어깨에 산호가 자란 수부.
      ch4_drowned_coral: { emissive: '#021a1c', props: ['coralGrowth'] },
      // 판자 방패는 로스터 offhand(tll_ch4_plankshield)로 왼손에 든다.
      ch4_plankguard: { emissive: '#021a1c' },
      // 합류 경로의 해골 병사 자리: 몸빛을 한 톤 어둡게.
      ch4_deckhand: { color: '#6f8494', amount: 0.3, emissive: '#021a1c' },
      // 합류 경로의 원령 자리: 물에 불어 창백한 수부, 청록 발광을 조금 세게.
      ch4_drowned_drift: { color: '#bfd8e0', amount: 0.25, emissive: '#06302e' },
      ch4_lurer: { emissive: '#021a1c' },
      // 심연 폭탄 자리: 자폭 경고 — 몸에 붉은 발광(원본 분홍 색조는 stages.js BODY_TINTS 에서 뺐다).
      ch4_lurer_bomb: { emissive: '#5a1206' },
      // 심연 주시자 자리(지원 소환): 몸에 큰 빛 주머니(일반 아귀와 실루엣으로 갈리게 키웠다).
      ch4_lurer_seer: { emissive: '#021a1c', props: ['glowPouchesLarge'] },
      // 합류 경로의 해골 망령 자리: 청록 발광을 조금 세게.
      ch4_lurer_glim: { emissive: '#06302e' },
      // 소환 전용 4장 갈래(3차): 합류·서고·법정 경로 대장이 부르는 졸병도 아귀·수부 몸.
      ch4_lurer_comet: { emissive: '#06302e' },
      ch4_lurer_night: { emissive: '#06302e', props: ['glowPouches'] },
      ch4_plankguard_mirror: { emissive: '#021a1c', props: ['barnacles'] },
      ch4_drowned_mist: { color: '#a8c0d0', amount: 0.3, emissive: '#06302e' },
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
      bomb_slime: { props: ['crownRing'] },
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
      // 아스텔은 Tripo 몸(tll_ch5_astel)의 큰 투구에 왕관이 붙어 있고 찢긴 왕실 깃발을 망토로 두르며 손에 맹세 대검을 들어(로스터 weapon)
      // 뿔 왕관·성벽 검 방패·맹세 깃발 소품을 뺀다.
      crown_midboss: { emissive: '#120a1c' },
      // 5장 전용 Tripo 몸(stages.js CHAPTER_SPECIES): 몸이 이미 새벽 보라·금이라 색을 장 팔레트 그대로 두고 발광만 준다.
      // 닌자의 해 가면, 병사의 금관 투구, 주술사의 떠 있는 금빛 고리와 겹치는 소품(dawnMask·soldierCirclet·crownRing)은 뺀다.
      ch5_dawnninja: { emissive: '#120a1c' },
      // 임프 자리: 단검 없는 견습 — 몸빛을 한 톤 바랜 보라로, 키는 작게(로스터 Ch5_DawnNinjaSquire), 등에 연습용 목검.
      ch5_dawnninja_squire: { color: '#a89cc0', amount: 0.42, emissive: '#120a1c', props: ['squireBokken'] },
      // 심연 폭탄 자리: 자폭 경고 — 붉은 금 발광(원본 분홍 색조는 stages.js BODY_TINTS 에서 뺐다).
      ch5_dawnninja_flare: { emissive: '#5a2206' },
      ch5_crownsoldier: { emissive: '#120a1c' },
      // 뼈 오크 자리(분쇄): 어두운 강철 몸빛(금 사슬 소품은 병사 몸에서 머리 위로 떠 보여 뺐다).
      ch5_crownsoldier_chain: { color: '#5e5470', amount: 0.45, emissive: '#120a1c' },
      // 성벽 검 방패는 로스터 offhand(tll_ch5_swordwall)로 왼손에 든다.
      ch5_swordwall: { emissive: '#120a1c' },
      ch5_seer: { emissive: '#120a1c' },
      // 화염 정령 자리: 새벽불 — 따뜻한 금빛 발광과 머리 위로 솟은 화로 장대.
      ch5_seer_ember: { color: '#f0b49a', amount: 0.25, emissive: '#4a1e06', props: ['dawnBrazier'] },
      // 부족 주술사 자리(지원 소환): 칙령을 낭독하는 주술사 — 등에 맹세 깃발.
      ch5_seer_herald: { emissive: '#120a1c', props: ['oathBanner'] },
      // 소환 전용 5장 갈래(stages.js CHAPTER_SPECIES[5]): 던전 대장·주술사가 부르는 졸병도 5장 몸에 발광만.
      // 신기루 닌자는 몸빛을 옅은 라일락으로 바래게, 종소리·혜성불 닌자는 불빛 발광으로 원래 종의 기척을 남긴다.
      ch5_dawnninja_mirage: { color: '#c8b4e8', amount: 0.35, emissive: '#1c0e2c' },
      ch5_dawnninja_called: { color: '#a89cc0', amount: 0.42, emissive: '#120a1c', props: ['squireBokken'] },
      ch5_crownsoldier_levy: { emissive: '#120a1c' },
      ch5_crownsoldier_watch: { emissive: '#120a1c' },
      ch5_dawnninja_wisp: { color: '#b8e8e0', amount: 0.3, emissive: '#0e3a34' },
      ch5_dawnninja_spark: { color: '#a8c8f0', amount: 0.3, emissive: '#14284a' },
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
  // 6장 함께 잇는 귀환로: 적은 다섯 명령의 잔향이라 그 경로의 고향 장 의상(고향 장 전용 몸 포함)을
  // 잔향 청록 발광으로 덧입는다(chapterDressFor 의 echo 분기). 보스와 6장 전용 승객 갈래(ch6_*)만 직접 정한다.
  6: {
    name: '다섯 명령의 잔향',
    echo: true,
    species: {
      // 빈 의자의 증인: 상복 베일과 맹세 깃발. 고립의 잔향: 금 간 큰 종과 후광.
      // 증인은 Tripo 몸(tll_ch6_witness)이 깊은 두건을 쓰고 등에 빈 의자를 져 상복 베일·맹세 깃발 소품을 뺀다.
      homecoming_midboss: { emissive: ECHO_SKIN.emissive },
      // 6장 전용 Tripo 몸(stages.js CHAPTER_SPECIES[6]): 귀환 열차 승객 잔향. 밝은 잿빛 몸이 6장 청록 조명에서 하얗게 날아가
      // 몸빛을 한 톤 눌러 주고 발광은 약하게(#0a2420) 둔다.
      // 갈래는 몸빛(고향 지역의 흔적)과 손의 여행 가방(로스터 offhand)으로 나눈다. 나머지 자리는 고향 장 의상의 잔향(아래 echo 분기)이다.
      ch6_passenger: { color: '#8a9896', amount: 0.35, emissive: '#0a2420' },
      // 원령 자리: 더 바래고 청록 발광이 조금 센 승객.
      ch6_passenger_drift: { color: '#c8e4dc', amount: 0.2, emissive: '#16443c' },
      // 해골 자객 자리: 서두르는 승객 — 어깨 위로 솟은 큰 회중시계(같은 맨손 몸의 다른 승객과 윤곽으로 갈린다).
      ch6_passenger_hurry: { color: '#8a9896', amount: 0.35, emissive: '#0a2420', props: ['hurryClock'] },
      ch6_passenger_child: { color: '#b0c2bc', amount: 0.3, emissive: '#0a2420' },
      // 부족 전사 자리: 그을린 용광로의 짐꾼 — 몸빛을 그을음 갈색으로, 등에 묶은 가방 두 개.
      ch6_passenger_porter: { color: '#8c6a50', amount: 0.5, emissive: '#0a2420', props: ['luggagePack'] },
      ch6_passenger_trunk: { color: '#8a9896', amount: 0.35, emissive: '#0a2420' },
      // 골렘 수호자 자리: 개찰구를 지키던 승객 — 푸른 철빛.
      ch6_passenger_gate: { color: '#6a84a0', amount: 0.5, emissive: '#0a2420' },
      // 4장 바닷길에서 돌아온 승객: 바닷물빛 몸에 어깨 따개비, 등에 엇갈려 멘 노와 둥근 부표.
      ch6_passenger_tide: { color: '#4f8fa0', amount: 0.5, emissive: '#0a2420', props: ['barnacles', 'tideOar'] },
      // 포자 괴물 자리: 이끼 낀 승객 — 머리를 덮는 넓은 버섯 갓과 늘어진 이끼.
      ch6_passenger_moss: { color: '#6a8c5a', amount: 0.5, emissive: '#0a2420', props: ['mossCap'] },
      // 서리굴 잠행꾼 자리: 3장 서고에서 길을 잃은 승객 — 서리 하늘빛, 앞으로 내민 서리빛 장대 등.
      ch6_passenger_lost: { color: '#a8c4ec', amount: 0.45, emissive: '#0a2420', props: ['lostLantern'] },
      // 소환 전용: 6-3 주소 경로 주술사가 부르는 꼬마 오크 자리 — 작은 승객, 등에 묶은 가방.
      ch6_passenger_stray: { color: '#b0c2bc', amount: 0.3, emissive: '#0a2420', props: ['luggagePack'] },
      homecoming_finalboss: { ...ECHO_SKIN, props: ['brokenBellLarge', 'spiritHalo'] },
    },
    assets: {},
  },
  7: {
    name: '어긋난 박자',
    species: {
      // 해골 시민: 귀환 축하에 모였다가 어긋난 박자에 묶인 사람들 — 타종 명부를 진다.
      skel_minion: { ...BRASS_BONE, props: ['bellLedger'] },
      skel_rogue: { ...BRASS_BONE },
      // 종탑 문짝 방패.
      skel_shield: { ...BRASS_BONE, props: ['doorShield'] },
      bone_orc: { ...BRASS_BONE, props: ['clapperBack'] },
      ghost: { ...BRASS_SPIRIT, props: ['spiritBell'] },
      ghost_skull: { ...BRASS_SPIRIT, props: ['spiritBell'] },
      blob_green: { ...BRASS_SLIME, props: ['spiritBell'] },
      // 해골 주술사·사제: 소리 굽쇠.
      skel_mage: { ...BRASS_BONE, remap: { ...BRASS_REMAP, hues: [190, 345] }, props: ['tuningFork'] },
      skel_priest: { ...BRASS_BONE, remap: { ...BRASS_REMAP, hues: [190, 345] }, props: ['tuningFork', 'bellLedger'] },
      elite_skel_captain: { ...BRASS_BONE, props: ['doorShield', 'clapperBack'] },
      elite_wraith: { ...BRASS_SPIRIT, props: ['spiritBell', 'spiritHalo'] },
      elite_bone_lord: { ...BRASS_BONE, props: ['brokenBellLarge'] },
      // 7장 전용 Tripo 몸(stages.js CHAPTER_SPECIES[7]): 몸이 이미 바랜 황동·석회 팔레트라 BRASS_* 재배치를 걸지 않고 발광·몸빛만 준다.
      // 시민은 손에 타종 명부(로스터 offhand), 주술사는 굽쇠 지팡이(weapon)와 몸의 작은 종이 있어 bellLedger·tuningFork·spiritBell 소품은 뺀다.
      ch7_citizen: { emissive: '#140f04' },
      // 해골 자객 자리: 종소리에 늦어 뛰는 시민 — 먼지 낀 석회 몸빛, 뒤로 휘날리는 붉은 목도리(손에는 로스터 손종).
      ch7_citizen_late: { color: '#b8b2a2', amount: 0.3, emissive: '#140f04', props: ['lateScarf'] },
      ch7_citizen_ledger: { emissive: '#140f04' },
      // 뼈 오크 자리(분쇄): 종루 짐꾼 — 그을린 청동 몸빛, 등에 종추와 가슴을 가로지른 밧줄 타래.
      ch7_citizen_hauler: { color: '#9a7c52', amount: 0.4, emissive: '#140f04', props: ['clapperBack', 'haulerRope'] },
      // 폭탄 슬라임 자리: 자폭 경고 — 그을린 황동 몸빛과 붉은 금 발광, 등에 불 붙은 종 폭약통(머리 위로 튀는 불꽃 윤곽).
      ch7_citizen_fuse: { color: '#c89a5a', amount: 0.35, emissive: '#6a2a06', props: ['fuseKeg'] },
      ch7_tuner: { emissive: '#140f04' },
      // 해골 사제 자리(지원 소환): 명부를 낭송하는 주술사 — 따뜻한 황동 발광.
      ch7_tuner_cantor: { color: '#e0c68c', amount: 0.25, emissive: '#2a1e08' },
      // 해골 망령 자리: 불투명 몸에 옅은 석회빛, 발광을 조금 올린 울림 잔향 — 등 뒤 동심원 음파 고리.
      ch7_tuner_echo: { color: '#d8d6c8', amount: 0.3, emissive: '#2a2210', props: ['echoRings'] },
      // 원령 자리: 떠도는 조율사 — 앞으로 휜 장대 끝에 매단 풍경 셋.
      ch7_tuner_drift: { color: '#c4cfc8', amount: 0.3, emissive: '#2a2210', props: ['driftChimes'] },
    },
    // 종지기·오르벤·카델과 해골 시민·굽쇠 주술사 갈래는 7장 전용 Tripo 몸이라 BRASS 재배치를 입히지 않는다.
    assets: {
      bone_knight: { ...BRASS_BONE, props: ['bellLedger'] },
      void_wisp: { ...BRASS_SPIRIT, props: ['spiritBell'] },
      skeleton_mage: { ...BRASS_BONE, props: ['tuningFork'] },
      goblin_chief: { ...BRASS_BONE, props: ['clapperBack'] },
      shadow_soldier: { ...BRASS_BONE },
    },
  },
});

/** 장 테마 → 장 번호(6장 잔향이 경로의 고향 장 의상을 찾을 때). */
const THEME_CHAPTER = Object.freeze({ garden: 1, forge: 2, frost: 3, tide: 4, crown: 5, crypt: 7 });
const ECHO_GLOW = '#13403a';

/**
 * 이 관문의 적에게 입힐 의상. 원정(전용 로스터·아트)은 제외한다 — 6장 심층 원정만 6장 몸·의상을 입는다(stages.js speciesStageOf).
 * @param {{ expedition?: { depth?: string, [key: string]: unknown } | null, ch?: number, st?: number, chapter?: { id?: number }, dungeon?: { id?: string } | null } | null | undefined} stage
 * @param {string} species 런타임 적 id
 * @param {string | null | undefined} asset 실제 로드된 라이브러리 asset id
 * @returns {DressSpec | null}
 */
export function chapterDressFor(stage, species, asset) {
  const key = speciesStageOf(stage);
  if (!key) return null;
  const ch = key.chapterId;
  const table = CHAPTER_DRESS[ch];
  if (!table) return null;
  if (Object.hasOwn(table.species, species)) return table.species[species];
  if (table.echo) {
    // 잔향: 이 경로의 고향 장 의상(없으면 1~5장 중 먼저 찾은 것)에 귀환 청록 발광을 덧입힌다.
    const home = THEME_CHAPTER[DUNGEON_HOME[key.dungeonId]];
    for (const c of [home, 1, 2, 3, 4, 5]) {
      const t = c && c !== ch ? CHAPTER_DRESS[c] : null;
      const spec = t && (Object.hasOwn(t.species, species) ? t.species[species] : asset && Object.hasOwn(t.assets, asset) ? t.assets[asset] : null);
      if (spec) return echoOf(spec);
    }
    return null;
  }
  return asset && Object.hasOwn(table.assets, asset) ? table.assets[asset] : null;
}

const echoCache = new Map();
/** @param {DressSpec} spec @returns {DressSpec} */
function echoOf(spec) {
  if (!echoCache.has(spec)) echoCache.set(spec, Object.freeze({ ...spec, emissive: ECHO_GLOW }));
  return echoCache.get(spec);
}
