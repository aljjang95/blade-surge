// 보이스 통일 계획 (2026-10-27) — 모든 대사는 한국어, 소유자(직업/아나운서/보스)마다 목소리 하나.
// 목소리 정체성은 Fish ICL 레퍼런스 클립 하나로 고정한다. 같은 소유자의 모든 대사는 같은 레퍼런스에서만 만든다.
//   · 영웅 5직업: 출시된 한국어 선택 대사(hero_<id>_select.mp3)가 레퍼런스(대본 = ko-lines.mjs refText).
//   · 아나운서(공용 대사): tools/voice/refs/narrator.mp3 (기존 아나운서 목소리, Seed 캐스팅 원본).
//   · 보스 3종: tools/voice/refs/boss_*.mp3 (보스별 한 목소리).
import { HERO_LINES, HERO_IDS } from './ko-lines.mjs';
import { CHAPTER_LORE } from '../../src/data/lore.js';

export const VOICE_DIR = 'public/sfx/voice';
export const FISH_MODEL = 's2.1-pro-free';   // Fish Audio S2.1 Pro 계열(무료 티어). 유료 s2.1-pro 는 크레딧 0 으로 402.

// 소유자 → 목소리. ref/refText 는 Fish references[0].
export const VOICES = {
  ...Object.fromEntries(HERO_IDS.map(id => [id, { id: `fish-icl:hero-${id}`, ref: `${VOICE_DIR}/hero_${id}_select.mp3`, refText: HERO_LINES[id].refText }])),
  announcer: { id: 'fish-icl:announcer', ref: 'tools/voice/refs/narrator.mp3', refText: 'Welcome, warrior! The Endless Castle awaits — let\'s climb!' },
  boss_warlord: { id: 'fish-icl:boss-warlord', ref: 'tools/voice/refs/boss_warlord.mp3', refText: 'Kekeke… flesh! Warm flesh! You will join my legion, little knight!' },
  boss_demon: { id: 'fish-icl:boss-demon', ref: 'tools/voice/refs/boss_demon.mp3', refText: 'Ahh… your soul smells delicious. Come closer. Let me taste your fear.' },
  boss_dragon: { id: 'fish-icl:boss-dragon', ref: 'tools/voice/refs/boss_dragon.mp3', refText: 'A thousand years I have slept… and you wake me for THIS?' },
};

// 챕터 보스 14명(lore.js CHAPTER_LORE[].bosses): 보스마다 Fish 라이브러리 보이스 1개(reference_id) — 영웅·다른 보스와 겹치지 않는다.
// 파일명 규칙: boss_c<장>_<mid|fin>_appear (런타임은 src/engine/boss-voice.js 가 `${키}_appear` 로 부른다).
const CH_VOICE = {
  'c1_mid': ['a9574d6184714eac96a0a892b719289f', 'sad', '세렌(남)'],
  'c1_fin': ['bb07cfc53e0f4e3d91ee823a825c35d4', 'serious', '에일른(남·노년)'],
  'c2_mid': ['7b0e100da67d49ad81bd63a407d2f964', 'sad', '이그란(남·노년)'],
  'c2_fin': ['fa7d528141974d3ba794e4482b153dc6', 'angry', '발드(남)'],
  'c3_mid': ['73da877014f349c0ad3eb136c7f1a0c7', 'serious', '오르딘(남)'],
  'c3_fin': ['2f06c7a428e9431fadd60af4dfe91763', 'calm', '이셀(여)'],
  'c4_mid': ['ff2945cbfd274c85b440bd39d8cb3729', 'sad', '마렌(여)'],
  'c4_fin': ['d4c65d5860504eb197b6943c3ff0f289', 'angry', '네레이스(남)'],
  'c5_mid': ['29da56534ac84ccd81092be4359a1639', 'tired', '아스텔(남)'],
  'c5_fin': ['d5a885f492854e068d8a72e14c851771', 'serious', '빈 왕관(무성·낮게)'],
  'c6_mid': ['ddda1d00f3684054a7e971b2dde89b5f', 'calm', '빈 의자의 증인(중성)'],
  'c6_fin': ['9aae54921dd944948ee08d35f6b5f984', 'whispering', '고립의 잔향(중성)'],
  'c7_mid': ['061a013646d04f0297560d4354d595fd', 'determined', '오르벤(남)'],
  'c7_fin': ['35856f20bd4a4896af91cee863519e6a', 'serious', '카델(남·거인)'],
};
export const CHAPTER_BOSS_LINES = [];
for (const row of CHAPTER_LORE) for (const [rank, tag] of [['midboss', 'mid'], ['finalboss', 'fin']]) {
  const key = `c${row.ch}_${tag}`, [referenceId, emotion] = CH_VOICE[key];
  VOICES[`boss_${key}`] = { id: `fish-lib:${referenceId}`, referenceId, label: `${row.bosses[rank].name} ${CH_VOICE[key][2]}` };
  CHAPTER_BOSS_LINES.push({ file: `boss_${key}_appear`, owner: `boss_${key}`, text: row.bosses[rank].shout, emotion, kind: 'line' });
}

const L = (file, owner, text, emotion, kind = 'line') => ({ file, owner, text, emotion, kind });

// 공용 아나운서 (영어 → 한국어). 게임 코드가 부르는 이름은 그대로.
export const ANNOUNCER_LINES = [
  L('welcome', 'announcer', '돌아왔군, 전사여. 끝없는 성이 기다린다.', 'confident'),
  L('floor_start', 'announcer', '성이 깨어난다. 모든 구역을 정화하라.', 'determined'),
  L('floor_clear', 'announcer', '층 돌파! 훌륭하다!', 'excited'),
  L('boss_found', 'announcer', '보스가 가깝다. 정신 차려라.', 'serious'),
  L('boss_kill', 'announcer', '보스 처치! 영광은 네 것이다!', 'excited'),
  L('elite', 'announcer', '정예가 다가온다!', 'serious'),
  L('treasure', 'announcer', '보물방이다! 전부 챙겨라.', 'excited'),
  L('reinforce', 'announcer', '증원이다! 전열을 지켜라!', 'serious'),
  L('legend_drop', 'announcer', '전설이다! 전설 장비 획득!', 'excited'),
  L('unique_drop', 'announcer', '유니크 장비! 행운이 함께한다.', 'confident'),
  L('low_hp', 'announcer', '위험하다! 물러서라, 지금!', 'serious'),
  L('perfect', 'announcer', '완벽한 회피!', 'excited'),
  L('defeat', 'announcer', '쓰러졌다… 하지만 성은 네 이름을 기억한다.', 'sad'),
  L('rebirth', 'announcer', '불사조가 일어선다! 오늘은 아니다, 죽음아!', 'excited'),
  L('ult', 'announcer', '궁극기!', 'excited'),
  L('enh_success', 'announcer', '강화 성공!', 'excited'),
  L('enh_fail', 'announcer', '강화 실패. 강화석이 부서진다.', 'sad'),
  L('enh_destroy', 'announcer', '산산조각… 무기가 사라졌다.', 'sad'),
  L('set_blood', 'announcer', '흡혈 세트 각성. 피를 마셔라.', 'serious'),
  L('set_gravity', 'announcer', '중력 세트 각성. 아무것도 벗어날 수 없다.', 'serious'),
  L('set_phoenix', 'announcer', '불사조 세트 각성. 타올라 다시 태어나라.', 'excited'),
  L('set_storm', 'announcer', '폭풍 세트 각성. 번개를 타라.', 'excited'),
  L('boss_appear', 'announcer', '보스가 나타났다!', 'serious'),
  L('boss_phase', 'announcer', '보스가 강해진다!', 'serious'),
  L('boss_enrage', 'announcer', '보스가 폭주한다!', 'serious'),
  L('seal_break', 'announcer', '모든 구역 정화 완료. 봉인이 깨진다!', 'excited'),
  L('portal', 'announcer', '포탈이 열렸다. 준비되면 들어가라.', 'calm'),
];

// 보스 대사 (보스마다 목소리 하나).
const BOSS = {
  warlord: { appear: ['내 왕좌에 바칠 해골이 또 왔구나!', 'angry'], phase: ['감히 나를 베다니!', 'angry'], enrage: ['충분하다! 군단이여, 일어나라!', 'angry'], death: ['말도 안 돼… 내 군단이… 무너진다…', 'sad'] },
  demon: { appear: ['아아… 싱싱한 영혼이로군. 가까이 오너라.', 'confident'], phase: ['이제야 나의 관심을 끄는군.', 'confident'], enrage: ['통째로 삼켜 주마!', 'angry'], death: ['안 돼… 심연으로 돌아가다니… 안 돼!', 'sad'] },
  dragon: { appear: ['천 년의 잠을… 고작 이것 때문에 깨우느냐?', 'confident'], phase: ['하찮은 것. 불타라.', 'angry'], enrage: ['하늘이 네놈 위로 무너지리라!', 'angry'], death: ['천 년이… 네놈 손에… 끝나는구나…', 'sad'] },
};
export const BOSS_LINES = Object.entries(BOSS).flatMap(([boss, lines]) => Object.entries(lines)
  .map(([key, [text, emotion]]) => L(`boss_${boss}_${key}`, `boss_${boss}`, text, emotion)));

// 영웅 대사: ko-lines.mjs 가 정본. 파일명 hero_<id>_<key>. select 는 레퍼런스라 다시 만들지 않는다.
export const HERO_FILE_LINES = HERO_IDS.flatMap(id => HERO_LINES[id].lines
  .map(({ id: key, text, emotion, kind }) => L(`hero_${id}_${key}`, id, text, emotion, kind)));

export const ALL_LINES = [...HERO_FILE_LINES, ...ANNOUNCER_LINES, ...BOSS_LINES, ...CHAPTER_BOSS_LINES];
// 참조 클립이므로 재생성 금지.
export const REFERENCE_FILES = new Set(HERO_IDS.map(id => `hero_${id}_select`));
