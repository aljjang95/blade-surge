import { dungeonForStage } from './story-dungeons.js';
import { stageStory } from './campaign-story.js';
import { ENCOUNTER_ART, MOB_ART, RIFT_ART } from './encounter-art.js';
import { CAMPAIGN_MODELS } from './encounter-models.js';
import { BOSS_ENCOUNTERS, BOSS_RANK_ENCOUNTERS, BOSS_SIGNATURES } from './boss-encounters.js';
import { MOB_ROLE_ENEMIES } from './mob-roles.js';
import { recommendedLevel, representativeDrops } from './loot-tables.js';
import { CHAPTER_COUNT, STAGES_PER_CHAPTER } from './campaign-shape.js';

export { STAGES_PER_CHAPTER };

// 지역별 맹세와 기믹은 모험 화면과 전투가 함께 사용한다.
export const CHAPTERS = [
  { id: 1, name: '잊힌 종의 정원', theme: 'garden', color: '#87cbb0', boss: 'garden_finalboss', tagline: '누군가 이름을 부르는 동안, 우리는 사라지지 않는다.', summary: '아르카의 이름이 새겨진 묘비에서 시작된 원정. 침묵한 종을 깨워 망각에 묶인 첫 왕을 찾는다.', oath: '잊힌 이름을 다시 부르겠다는 맹세', mechanic: { name: '종의 공명', description: '방 중앙에서 순서대로 퍼지는 고리의 경고를 확인하고 빛나는 띠 밖으로 피하세요.' } },
  { id: 2, name: '불씨 왕국의 용광로', theme: 'forge', color: '#ed925d', boss: 'forge_finalboss', tagline: '살아 돌아오라는 말이, 가장 오래 타는 불이다.', summary: '드라칸의 고향은 끝없는 노동에 갇혔다. 생명을 연료 삼는 용광로를 멈추고 빼앗긴 온기를 돌려준다.', oath: '온기를 빼앗지 않고 나누겠다는 맹세', mechanic: { name: '냉각로 과열', description: '가로와 세로의 세 화염 띠가 번갈아 솟습니다. 붉은 경고선 사이로 이동하세요.' } },
  { id: 3, name: '거꾸로 흐르는 서리 도서관', theme: 'frost', color: '#a3ceef', boss: 'frost_finalboss', tagline: '지워 버린 실패의 끝에서, 다른 내일을 읽는다.', summary: '리아의 잃어버린 제자와 쓰이지 않은 일기가 기다린다. 금지된 기록을 열어 순환의 기원을 추적한다.', oath: '아픈 진실도 지우지 않겠다는 맹세', mechanic: { name: '지연 기록', description: '발밑과 주변에 남은 원이 잠시 뒤 폭발하며 느려집니다. 기록된 자리에서 즉시 이동하세요.' } },
  { id: 4, name: '별이 잠긴 심해', theme: 'tide', color: '#65c5d1', boss: 'tide_finalboss', tagline: '돌아갈 곳은 땅이 아니라, 기다리는 사람이다.', summary: '카인이 잃어버린 항로를 따라 가라앉은 선단을 구한다. 서로의 이름으로 등대를 이어 해왕의 사슬을 끊는다.', oath: '붙잡지 않고 귀환을 믿겠다는 맹세', mechanic: { name: '밀물', description: '세 물결 띠가 방을 순서대로 휩쓸며 밀쳐 냅니다. 다음 경고선을 보고 빈 구역으로 이동하세요.' } },
  { id: 5, name: '새벽을 먹는 왕관', theme: 'crown', color: '#e0c184', boss: 'crown_finalboss', tagline: '세상을 구하기 위해, 너를 잃어야 한다는 거짓말.', summary: '네브의 기억을 노리는 왕관으로 향한다. 누군가의 희생에 기대는 승리 대신 함께 살아갈 내일을 선택한다.', oath: '한 사람의 짐을 함께 나누겠다는 맹세', mechanic: { name: '왕관의 심판', description: '대각선 십자 경고 뒤에 빛이 떨어집니다. 중앙의 작은 안전 원이나 십자 밖으로 피하세요.' } },
  { id: 6, name: '함께 잇는 귀환로', theme: 'garden', encounterPrefix: 'homecoming', color: '#87cbb0', boss: 'homecoming_finalboss', tagline: '구한 세계를, 함께 살아갈 곳으로.', summary: '왕관이 부서진 다음 날. 다섯 지역에 남은 명령의 잔향을 걷어 내고 사람들의 귀환로를 연결한다.', oath: '돌아오는 누구도 홀로 남겨 두지 않겠다는 약속', mechanic: { name: '귀환의 공명', description: '남겨진 명령이 공명 고리로 번집니다. 경고 띠 밖으로 이동하며 귀환문을 지키세요.' } },
  { id: 7, name: '금 간 종탑의 도시', theme: 'crypt', encounterPrefix: 'belltower', color: '#c9b07a', boss: 'belltower_finalboss', tagline: '울리는 소리가 멈추기 전에, 박자를 세어라.', summary: '귀환의 아침 이후 균열이 종탑 도시를 덮쳤다. 박자를 잃은 종이 고리 충격파를 퍼뜨리는 거리를 지나, 금 간 대종의 주인에게 마지막 박자를 돌려준다.', oath: '울림을 막지 않고 함께 박자를 세겠다는 맹세', mechanic: { name: '어긋난 타종', description: '세 개의 종이 어긋난 박자로 고리를 퍼뜨립니다. 고리가 겹치는 한가운데나 고리 사이 빈틈으로 이동하세요.' } },
];
if (CHAPTERS.length !== CHAPTER_COUNT) throw new Error(`CHAPTERS(${CHAPTERS.length})와 campaign-shape.js CHAPTER_COUNT(${CHAPTER_COUNT})가 다릅니다.`);
// 의미 분기는 장 번호가 아니라 데이터 플래그로 읽는다. 표시·저장 지문을 바꾸지 않도록 열거되지 않는 속성으로 붙인다.
//  - finale: 다섯 왕의 이야기가 끝나는 장(최종 관문이 월드 피날레 연출을 켠다)
//  - homecoming: 후일담 장(최종 관문이 에필로그 피날레 연출을 켠다)
const CHAPTER_FLAGS = { 5: { finale: true }, 6: { homecoming: true } };
// 장 테마 → 보스 전투 틀(kit)·음성. 표에 없는 테마는 reaper/boss_demon.
const WARLORD_THEMES = new Set(['garden', 'crown', 'crypt']);
for (const chapter of CHAPTERS) {
  Object.defineProperties(chapter, {
    finale: { value: !!CHAPTER_FLAGS[chapter.id]?.finale },
    homecoming: { value: !!CHAPTER_FLAGS[chapter.id]?.homecoming },
  });
  // 표시용 진행 정보는 열거하지 않는다. 기존 경로·스테이지 JSON 지문과 저장 계약을 바꾸지 않는다.
  Object.defineProperties(chapter, { recommendedLevel: { value: recommendedLevel(chapter.id) }, representativeDrops: { value: representativeDrops(chapter.id) } });
}
const ROSTER = {
  garden: { trash: ['skel_minion', 'skel_rogue', 'ghost', 'bomb_slime', 'skel_shield', 'bone_orc', 'grave_burrower'], ranged: ['skel_mage', 'ghost_skull', 'skel_priest'], elite: ['elite_skel_captain', 'elite_bone_lord', 'elite_wraith'] },
  forge: { trash: ['orc', 'orc_blob', 'tribal', 'cacto_wall', 'bomb_imp', 'imp', 'ash_burrower'], ranged: ['hywirl', 'armabee', 'tribal_shaman'], elite: ['elite_orc_chief', 'elite_bluedemon'] },
  frost: { trash: ['ghost', 'skel_shield', 'blob_green', 'bone_orc', 'skel_rogue', 'golem_guard', 'frost_burrower'], ranged: ['ghost_skull', 'skel_mage', 'skel_priest'], elite: ['elite_yeti', 'elite_wraith', 'elite_golem'] },
  tide: { trash: ['squidle', 'blob_pink', 'alien', 'mushnub', 'bomb_abyss', 'golem_guard'], ranged: ['glub', 'abyss_seer', 'armabee_evo'], elite: ['elite_golem', 'elite_mushroom_king', 'elite_dragonling'] },
  crown: { trash: ['ninja', 'skel_shield', 'alien', 'bomb_abyss', 'bone_orc', 'imp'], ranged: ['abyss_seer', 'tribal_shaman', 'hywirl'], elite: ['elite_bluedemon', 'elite_skel_captain', 'elite_dragonling'] },
  // 7장 종탑 도시: 종지기(bellringer)가 무리에 섞인다. 나머지는 이미 검증된 언데드 틀이다.
  crypt: { trash: ['skel_minion', 'ghost', 'skel_shield', 'bomb_slime', 'skel_rogue', 'bone_orc', 'bell_ringer', 'blob_green'], ranged: ['skel_mage', 'ghost_skull', 'skel_priest'], elite: ['elite_skel_captain', 'elite_wraith', 'elite_bone_lord'] },
};
// The dungeon route is also a combat identity. Each authored layout gets its own
// pack composition so a different map changes the pressure, silhouettes and ranged mix.
const DUNGEON_ROSTERS = {
  procession: { trash: ['skel_minion', 'ghost', 'skel_rogue', 'skel_shield', 'bomb_slime', 'bone_orc', 'grave_burrower'], ranged: ['ghost_skull', 'skel_mage', 'skel_priest'], elite: ['elite_skel_captain', 'elite_wraith', 'elite_bone_lord'] },
  greenhouse: { trash: ['ghost', 'bomb_slime', 'skel_rogue', 'skel_minion', 'skel_shield', 'bone_orc'], ranged: ['skel_priest', 'ghost_skull', 'skel_mage'], elite: ['elite_wraith', 'elite_bone_lord', 'elite_skel_captain'] },
  tribunal: { trash: ['skel_shield', 'bone_orc', 'skel_minion', 'ghost', 'bomb_slime', 'skel_rogue'], ranged: ['skel_mage', 'skel_priest', 'ghost_skull'], elite: ['elite_bone_lord', 'elite_skel_captain', 'elite_wraith'] },
  confluence: { trash: ['squidle', 'ghost', 'alien', 'mushnub', 'bomb_abyss', 'skel_minion'], ranged: ['glub', 'ghost_skull', 'abyss_seer'], elite: ['elite_golem', 'elite_skel_captain', 'elite_dragonling'] },
  kiln: { trash: ['orc', 'orc_blob', 'tribal', 'cacto_wall', 'bomb_imp', 'imp', 'ash_burrower'], ranged: ['tribal_shaman', 'hywirl', 'armabee'], elite: ['elite_orc_chief', 'elite_bluedemon', 'elite_orc_chief'] },
  uprising: { trash: ['orc_blob', 'bomb_imp', 'orc', 'imp', 'tribal', 'cacto_wall'], ranged: ['hywirl', 'tribal_shaman', 'armabee'], elite: ['elite_bluedemon', 'elite_orc_chief', 'elite_bluedemon'] },
  archive: { trash: ['ghost', 'blob_green', 'skel_shield', 'bone_orc', 'skel_rogue', 'golem_guard', 'frost_burrower'], ranged: ['ghost_skull', 'skel_mage', 'skel_priest'], elite: ['elite_wraith', 'elite_yeti', 'elite_golem'] },
  reverseRiver: { trash: ['blob_green', 'golem_guard', 'ghost', 'skel_rogue', 'skel_shield', 'bone_orc'], ranged: ['skel_mage', 'ghost_skull', 'skel_priest'], elite: ['elite_golem', 'elite_wraith', 'elite_yeti'] },
  beacon: { trash: ['squidle', 'blob_pink', 'alien', 'mushnub', 'bomb_abyss', 'golem_guard'], ranged: ['abyss_seer', 'glub', 'armabee_evo'], elite: ['elite_dragonling', 'elite_golem', 'elite_mushroom_king'] },
  lostShip: { trash: ['blob_pink', 'squidle', 'bomb_abyss', 'alien', 'golem_guard', 'mushnub'], ranged: ['glub', 'armabee_evo', 'abyss_seer'], elite: ['elite_mushroom_king', 'elite_dragonling', 'elite_golem'] },
  emptyThrones: { trash: ['ninja', 'skel_shield', 'alien', 'bomb_abyss', 'bone_orc', 'imp'], ranged: ['abyss_seer', 'tribal_shaman', 'hywirl'], elite: ['elite_bluedemon', 'elite_dragonling', 'elite_skel_captain'] },
  addresses: { trash: ['skel_rogue', 'ghost', 'imp', 'bomb_slime', 'ninja', 'bone_orc'], ranged: ['ghost_skull', 'tribal_shaman', 'skel_mage'], elite: ['elite_wraith', 'elite_bluedemon', 'elite_skel_captain'] },
  // 7장 세 경로: 종지기를 무리마다 다른 자리에 섞고 원거리·정예 구성도 달리한다. 일반 몹 칸은 서로 다른 8종으로 두어 7칸 주기의 원거리 칸과 어긋나게 한다(종지기가 한 번도 안 나오는 방이 없게).
  bellstreet: { trash: ['skel_minion', 'bell_ringer', 'ghost', 'skel_shield', 'bomb_slime', 'skel_rogue', 'bone_orc', 'blob_green'], ranged: ['skel_mage', 'ghost_skull', 'skel_priest'], elite: ['elite_skel_captain', 'elite_wraith', 'elite_bone_lord'] },
  belfry: { trash: ['skel_shield', 'ghost', 'skel_rogue', 'bell_ringer', 'bone_orc', 'bomb_slime', 'skel_minion', 'blob_green'], ranged: ['ghost_skull', 'skel_priest', 'skel_mage'], elite: ['elite_bone_lord', 'elite_wraith', 'elite_skel_captain'] },
  crackedNave: { trash: ['ghost', 'bone_orc', 'skel_minion', 'skel_rogue', 'bell_ringer', 'skel_shield', 'bomb_slime', 'blob_green'], ranged: ['skel_priest', 'skel_mage', 'ghost_skull'], elite: ['elite_wraith', 'elite_skel_captain', 'elite_bone_lord'] },
};
// 장 전용 몸(2026-10-28 Tripo 1·2장): 여러 장이 같이 쓰는 적 id 는 def.model 을 공유하므로, 그 장의 전투 방 편성에서만
// 같은 수치·행동의 전용 적 id 로 바꾼다. 보상·정산 명단(rosterFor)·웨이브 id 는 그대로라 경제 밴드가 움직이지 않는다.
export const CHAPTER_SPECIES = Object.freeze({
  // 2026-10-28 운영 캡처: 편성 곡선(squads stageCurve)이 먼저 세우는 종(1장 방패·원거리, 2장 부족 전사·임프)이 옛 몸이라
  // 2-1 일반 방에 새 몸이 하나도 없었다. 처음 소개되는 주력 종도 장 전용 몸으로 바꾼다(수치·행동은 각 원본 복사).
  1: Object.freeze({ skel_minion: 'ch1_coffinbearer', ghost: 'ch1_mourner', skel_shield: 'ch1_tombguard', ghost_skull: 'ch1_mourner_wail', skel_mage: 'ch1_mourner_dirge', skel_rogue: 'ch1_hoodbearer', grave_burrower: 'ch1_gravewisp' }),
  2: Object.freeze({ orc: 'ch2_smith', tribal_shaman: 'ch2_emberimp', tribal: 'ch2_smith_line', imp: 'ch2_emberimp_line', bomb_imp: 'ch2_emberimp_bomb', cacto_wall: 'ch2_anvilguard', ash_burrower: 'ch2_ashimp' }),
  // 3장(2026-10-28 Tripo): 서리 해골 사서(방패·자객·뼈 오크·굴착 자리)·망령 검열관(원령·해골 망령·주술사·사제 자리).
  // 3-1·3-2 일반 방은 부패 슬라임이 31%라 그 자리도 사서 몸으로 바꾼다(곰팡이 핀 사서). 골렘 수호자는 옛 몸 그대로 소수로 남긴다.
  // 4장(2026-10-29 Tripo): 따개비 수부(부유 촉수·심연 슬라임·이계 침입자·포자 괴물·골렘 수호자 자리, 합류 경로의 해골 병사·원령)·
  // 미끼등 아귀(심연 눈알·심연 폭탄·심연 주시자 자리, 합류 경로의 해골 망령). 진화한 독침벌은 옛 몸 그대로 소수로 남긴다.
  4: Object.freeze({ squidle: 'ch4_drowned', blob_pink: 'ch4_drowned_line', alien: 'ch4_drowned_anchor', mushnub: 'ch4_drowned_coral', golem_guard: 'ch4_plankguard', skel_minion: 'ch4_deckhand', ghost: 'ch4_drowned_drift', bomb_abyss: 'ch4_lurer_bomb', glub: 'ch4_lurer', abyss_seer: 'ch4_lurer_seer', ghost_skull: 'ch4_lurer_glim' }),
  3: Object.freeze({ blob_green: 'ch3_moldkeeper', ghost: 'ch3_censor', ghost_skull: 'ch3_censor_slip', skel_mage: 'ch3_censor_tome', skel_priest: 'ch3_censor_quill', skel_shield: 'ch3_shelfguard', skel_rogue: 'ch3_librarian', bone_orc: 'ch3_keykeeper', frost_burrower: 'ch3_icecrawler', skel_minion: 'ch3_pagebearer' }),
  // 5장(2026-10-29 Tripo): 새벽 가면 닌자(닌자·임프·심연 폭탄 자리)·왕관 병사(방패병·뼈 오크·이계 침입자 자리)·
  // 왕관 고리 주술사(심연 주시자·화염 정령·부족 주술사 자리). 왕관 일반 방의 9종을 모두 바꾸고 정예만 옛 몸으로 남긴다.
  5: Object.freeze({ ninja: 'ch5_dawnninja', imp: 'ch5_dawnninja_squire', bomb_abyss: 'ch5_dawnninja_flare', skel_shield: 'ch5_swordwall', bone_orc: 'ch5_crownsoldier_chain', alien: 'ch5_crownsoldier', abyss_seer: 'ch5_seer', hywirl: 'ch5_seer_ember', tribal_shaman: 'ch5_seer_herald' }),
  // 6장(2026-10-29 Tripo, 잔향 장): 경로마다 가장 흔한 근접 졸병 자리를 귀환 열차 승객 잔향 갈래로 바꾼다(일반 방의 약 40~60%).
  // 나머지 자리는 그 경로의 고향 장(DUNGEON_HOME) 전용 몸으로 나온다 — 1~5장 적의 잔향이다(chapterSpeciesSwap).
  6: Object.freeze({ skel_minion: 'ch6_passenger', ghost: 'ch6_passenger_drift', skel_rogue: 'ch6_passenger_hurry', imp: 'ch6_passenger_child', tribal: 'ch6_passenger_porter', cacto_wall: 'ch6_passenger_trunk', golem_guard: 'ch6_passenger_gate', squidle: 'ch6_passenger_tide', mushnub: 'ch6_passenger_moss', frost_burrower: 'ch6_passenger_lost' }),
  // 7장(2026-10-29 Tripo): 해골 시민(졸병·방패병·자객·뼈 오크·폭탄 슬라임 자리)·굽쇠 주술사(주술사·사제·해골 망령·원령 자리).
  // 종지기는 이미 7장 전용 Tripo 몸이라 그대로 두고, 부패 슬라임(경로 6~10에서 약 12%)만 옛 몸으로 소수 남긴다. 정예도 옛 몸 그대로.
  7: Object.freeze({ skel_minion: 'ch7_citizen', skel_rogue: 'ch7_citizen_late', skel_shield: 'ch7_citizen_ledger', bone_orc: 'ch7_citizen_hauler', bomb_slime: 'ch7_citizen_fuse', skel_mage: 'ch7_tuner', skel_priest: 'ch7_tuner_cantor', ghost_skull: 'ch7_tuner_echo', ghost: 'ch7_tuner_drift' }),
});
// 잔향 장(homecoming)이 고향 장 전용 몸을 찾을 때의 테마 → 장 번호.
const ECHO_HOME_CHAPTER = Object.freeze({ garden: 1, forge: 2, frost: 3, tide: 4, crown: 5 });
const echoSwaps = new Map();
/**
 * 이 장·경로의 적 id → 장 전용 종 표. 잔향 장(6장)은 경로의 고향 장 표 위에 6장 승객 갈래를 덮는다
 * (예: 6-4 귀항 등대 → 4장 수부·아귀 + 승객). 다른 장은 CHAPTER_SPECIES 그대로.
 */
export function chapterSpeciesSwap(chapterId, dungeonId) {
  const own = CHAPTER_SPECIES[chapterId];
  if (!CHAPTER_FLAGS[chapterId]?.homecoming) return own;
  const home = ECHO_HOME_CHAPTER[DUNGEON_HOME[dungeonId]];
  const key = `${chapterId}:${home || ''}`;
  if (!echoSwaps.has(key)) echoSwaps.set(key, Object.freeze({ ...(home && home !== chapterId ? CHAPTER_SPECIES[home] : {}), ...own }));
  return echoSwaps.get(key);
}
/** 캠페인 1~6장에서 적 id를 장 전용 종으로 바꾼다(소환·정예 접두사·지역 특성처럼 편성 밖에서 생기는 적도 같은 몸으로). */
export function chapterSpeciesId(stage, id) {
  if (!stage || stage.expedition) return id;
  return chapterSpeciesSwap(stage.chapter?.id, stage.dungeon?.id)?.[id] || id;
}
const swappedRosters = new Map();
function chapterSpecies(swap, roster) {
  if (!swap || !roster) return roster;
  let byRoster = swappedRosters.get(swap);
  if (!byRoster) swappedRosters.set(swap, byRoster = new Map());
  if (!byRoster.has(roster)) byRoster.set(roster, Object.fromEntries(Object.entries(roster).map(([key, ids]) => [key, ids.map((id) => swap[id] || id)])));
  return byRoster.get(roster);
}
// 던전 배치의 고향 지역(테마). 표에 없는 던전은 지역 기본 편성을 쓴다.
export const DUNGEON_HOME = {
  procession: 'garden', greenhouse: 'garden', tribunal: 'garden', kiln: 'forge', uprising: 'forge', archive: 'frost', reverseRiver: 'frost',
  beacon: 'tide', lostShip: 'tide', confluence: 'tide', emptyThrones: 'crown', addresses: 'garden', bellstreet: 'crypt', belfry: 'crypt', crackedNave: 'crypt',
};
const DUNGEON_BOSS_BASE = {
  procession: 'glass_hour_sovereign', greenhouse: 'verdigris_sentinel', tribunal: 'sable_mirage_empress', confluence: 'comet_bastion',
  kiln: 'cinder_chain_executor', uprising: 'ash_colossus', archive: 'nightglass_archivist', reverseRiver: 'astral_leviathan',
  beacon: 'obsidian_hydra', lostShip: 'obsidian_hydra', emptyThrones: 'sable_mirage_empress', addresses: 'comet_bastion',
  bellstreet: 'bell_gate_warden', belfry: 'bell_tollmaster', crackedNave: 'bell_nave_guardian',
};
const DUNGEON_BOSS_NAMES = {
  procession: '시계종의 주권자', greenhouse: '녹청 온실의 성역수', tribunal: '왕좌를 삼킨 환영왕', confluence: '합류 수로의 유성기사',
  kiln: '쌍화구 쇠사슬 집행자', uprising: '탈출 작업장의 재벼림 거수', archive: '밤유리 기록관', reverseRiver: '역류를 거스르는 레비아탄',
  beacon: '귀항 등대의 흑요룡', lostShip: '선실을 지키는 흑요룡', emptyThrones: '네 왕좌의 환영 여왕', addresses: '귀환문 앞 혜성 기사',
  bellstreet: '어긋난 거리의 수문 감시자', belfry: '종루의 타종 관리인', crackedNave: '금 간 대예배당의 종 수호자',
};
const RANK_LABELS = { captain: '관문 대장', warden: '수문장', midboss: '중간 보스', finalboss: '최종 보스' };
/** 권장 전투력: 적 공격과 같은 배율^0.7. 배율에 비례하던 값은 7-10에서 실제 승리선의 약 3.6배로 부풀었다(61%로도 승리). */
export function recommendedPowerFor(scale) { return Math.floor(2600 * Math.pow(scale, 0.7)); }
// 1장 권장 전투력 배율(2026-10-29). 신규 계정 연속 실입력 플레이(시드 4)에서 1장 전투력/권장이 입문 레벨 곡선 뒤에도 1-2 2.47 → 1-10 1.80으로
// 목표(약 1.6~1.9)보다 높았다. 1-1(첫 판·PRD 지표 측정 관문)은 그대로, 1-2 ×1.40 에서 1-10 ×1.03 으로 줄여 권장이 실제 위협을 따라오게 한다.
// 적 체력도 같은 표의 √ 만큼 올린다(squads.js CH1_RAMP). 보상·배율(scale)·드랍·정산은 그대로다.
export const CH1_REC_POWER_MUL = Object.freeze(Array.from({ length: 10 }, (_, i) => i === 0 ? 1 : +(1.4 - (i - 1) * .0411).toFixed(4)));

export function stageDef(ch, st) {
  if (!Number.isInteger(ch) || !Number.isInteger(st) || ch < 1 || ch > CHAPTERS.length || st < 1 || st > STAGES_PER_CHAPTER) throw new RangeError(`스테이지는 1-1부터 ${CHAPTERS.length}-${STAGES_PER_CHAPTER}까지입니다.`);
  const chapter = CHAPTERS[ch - 1], idx = (ch - 1) * STAGES_PER_CHAPTER + st;
  const dungeon = dungeonForStage(ch, st);
  const rank = st === STAGES_PER_CHAPTER ? 'finalboss' : st === 5 ? 'midboss' : st === 3 || st === 7 ? 'warden' : 'captain';
  const boss = rank !== 'captain', scale = Math.pow(1.12, Math.min(idx - 1, 19)) * (1 + Math.max(0, idx - 20) * 0.045);
  // 지역 정체성: 경로가 다른 지역의 던전 배치를 빌려도 몬스터는 그 지역 무리다(2-3 용광로에서 정원 해골이 나오던 문제).
  // 던전 고유 편성은 그 던전의 고향 지역에서만 쓴다. 다섯 지역을 순례하는 귀환 장(homecoming)은 던전 편성을 그대로 둔다.
  const home = DUNGEON_HOME[dungeon.id];
  const R = chapterSpecies(chapterSpeciesSwap(chapter.id, dungeon.id), (DUNGEON_ROSTERS[dungeon.id] && (home === chapter.theme || CHAPTER_FLAGS[chapter.id]?.homecoming) ? DUNGEON_ROSTERS[dungeon.id] : null) || ROSTER[chapter.theme]), scene = stageStory(ch, st);
  // rosterFor()(보상·정산 stageRankValues·원정 waves·확장 던전이 펼쳐 쓰는 명단)는 기존 던전 편성을 그대로 둔다.
  // 캠페인 전투 방 편성만 열거되지 않는 combatRosterFor()로 지역 무리를 쓴다 — 90일 경제 밴드·원정 지문이 움직이지 않는다.
  const rewardR = DUNGEON_ROSTERS[dungeon.id] || ROSTER[chapter.theme];
  // Named story encounters retain their authored identity, portrait and finale rig.
  // Dungeon variants belong to the intervening captains and wardens.
  const storyBoss = rank === 'midboss' || rank === 'finalboss';
  const dungeonBossId = !storyBoss && DUNGEON_BOSS_BASE[dungeon.id] ? `dungeon_${dungeon.id}_${rank}` : null;
  // Keep the campaign contract stable for saves/catalogue data. Battle.start
  // resolves this id to dungeonBossId at the actual spawn boundary.
  const enemyId = (chapter.encounterPrefix || chapter.theme) + '_' + rank;
  const waves = [];
  for (let w = 0; w < (boss ? 2 : 3); w++) {
    const list = [], n = Math.min(28, 10 + Math.floor(idx * 0.6) + w * 4);
    for (let i = 0; i < n; i++) { const pool = i % 7 === 6 ? rewardR.ranged : rewardR.trash; list.push(pool[(i + w + st) % pool.length]); }
    for (let e = 0; e < 1 + Math.floor(w / 1.5) + (idx > 10 ? 1 : 0); e++) list.push(rewardR.elite[(e + st + w) % rewardR.elite.length]);
    waves.push(list);
  }
  const enemy = ENEMIES[enemyId];
  const dungeonBoss = (dungeonBossId && ENEMIES[dungeonBossId]) || enemy;
  const stage = {
    ch, st, idx, code: `${ch}-${st}`, title: scene.title, chapter, name: `${ch}-${st} · ${scene.title}`,
    dungeon, dungeonBossId, epilogueFinale: chapter.homecoming && st === STAGES_PER_CHAPTER,
    boss, finale: chapter.finale && st === STAGES_PER_CHAPTER, waves, scale, energy: 6 + Math.floor(idx / 6),
    rosterFor: () => rewardR, recPower: Math.floor(recommendedPowerFor(scale) * (ch === 1 ? CH1_REC_POWER_MUL[st - 1] : 1)),
    encounter: { rank, label: RANK_LABELS[rank], name: dungeonBoss.name, enemyId, dungeonBossId, tactic: dungeonBoss.tactic || enemy.tactic },
    story: { opening: scene.opening, revelation: scene.revelation, aftermath: scene.aftermath },
    objective: `${dungeon.name}의 전투 방을 정리해 봉인을 해제하고 ${dungeonBoss.name} 처치`,
    rewards: { gold: Math.floor(400 * scale), exp: Math.floor(110 * scale), bp: 60 + (boss ? 60 : 0), firstGems: rank === 'finalboss' ? 300 : boss ? 150 : 60, dropChance: boss ? 1 : 0.6, stones: 2 + (boss ? 4 : 0) },
  };
  // 캠페인 표식은 열거되지 않는 속성으로 둔다: 원정·아레나 정의가 stageDef 를 펼쳐(spread) 쓰므로 그쪽 필드·지문이 바뀌지 않고,
  // 원정 전투가 캠페인 보스 표식을 물려받지 않는다. 캠페인 UI 는 stageDef 객체에서 직접 읽는다.
  return Object.defineProperties(stage, {
    combatRosterFor: { value: () => R },
    recommendedLevel: { value: recommendedLevel(ch, st) }, representativeDrops: { value: chapter.representativeDrops },
    midboss: { value: rank === 'midboss' }, regionBoss: { value: rank === 'finalboss' },
    unlocksChapter: { value: st === STAGES_PER_CHAPTER && ch < CHAPTERS.length ? ch + 1 : null },
  });
}

// scale = 모델 배율(리그 기본 배율에 곱해짐). hp/atk 은 스테이지 scale 로 곱해진다.
// 기준: 1층 = 레벨 1 SSR 영웅(hp 2800 · atk 240 · def 40). 잡몹은 기본 콤보 2타, 엘리트 ~15타, 보스 ~45초.
// 잡몹 한 대 ≈ 최대 HP 의 0.7%, 원거리 1%, 폭탄·엘리트 2%, 보스 강타 2.5% — AUTO 가 한 층에 25~35% 를 잃는 수준 (적 위협 회전 2026-09-04: 이전 수치는 정액 방어 차감 때문에 잡몹 1타 = 1 피해였다)
export const ENEMIES = {
  // ================= 1장 · 어둠의 지하묘지 (언데드) =================
  skel_minion: { name: '해골 병사', model: 'Skeleton_Vanguard', hp: 490, atk: 20, spd: 4.6, range: 1.9, atkTime: 1.2, weapon: 'Skeleton_Blade', exp: 8, scale: 0.95, gold: 1 },
  skel_rogue:  { name: '해골 자객', model: 'Skeleton_Skirmisher', hp: 630, atk: 29, spd: 6.2, range: 2.0, atkTime: 0.8, weapon: 'Skeleton_Blade', exp: 12, scale: 0.95, dodge: 0.2, gold: 1 },
  skel_mage:   { name: '해골 주술사', model: 'Skeleton_Runekeeper', hp: 525, atk: 29, spd: 3.0, range: 8.0, atkTime: 2.2, weapon: 'Skeleton_Staff', ranged: true, exp: 14, scale: 1.0, gold: 2, projColor: 0x60ff80 },
  ghost:       { name: '원령', model: 'Flying_Ghost', hp: 420, atk: 24, spd: 5.4, range: 2.1, atkTime: 1.1, exp: 11, scale: 1.25, gold: 1, ghostly: true },
  ghost_skull: { name: '해골 망령', model: 'Flying_Ghost_Skull', hp: 490, atk: 26, spd: 3.4, range: 8.5, atkTime: 2.0, ranged: true, exp: 15, scale: 1.2, gold: 2, ghostly: true, projColor: 0x80d0ff },
  blob_green:  { name: '부패 슬라임', model: 'Blob_GreenBlob', hp: 700, atk: 18, spd: 3.2, range: 1.7, atkTime: 1.4, exp: 9, scale: 1.0, gold: 1 },
  bone_orc:    { name: '뼈 오크', model: 'Big_Orc_Skull', hp: 1120, atk: 31, spd: 3.8, range: 2.2, atkTime: 1.5, exp: 15, scale: 1.0, armor: 0.15, gold: 2 },
  elite_skel_captain: { name: '해골 대장', model: 'Skeleton_Bulwark', hp: 5600, atk: 51, spd: 3.6, range: 2.6, atkTime: 1.5, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', exp: 60, scale: 1.45, armor: 0.25, elite: true, tint: '#ffd080', gold: 8 },
  elite_bone_lord:    { name: '골편 군주', model: 'Big_Orc_Skull', hp: 5200, atk: 48, spd: 3.4, range: 2.8, atkTime: 1.6, exp: 58, scale: 1.35, armor: 0.2, elite: true, tint: '#d0e0ff', gold: 8 },
  elite_wraith:       { name: '대원령', model: 'Flying_Ghost', hp: 3600, atk: 46, spd: 5.6, range: 2.4, atkTime: 1.0, exp: 55, scale: 1.7, elite: true, tint: '#a0d0ff', ghostly: true, gold: 8 },

  // --- 새 행동 3종 (PRD §4-6: 스탯만 다른 리스킨 금지) ---
  // bomber: 돌진 → 2.2 안에서 0.7초 도화선 → 자폭. (Blob_GreenSpikyBlob 은 다른 블롭의 2.2배 크기 GLB — scale 0.5 로 맞춘다. 0.95 였을 때 영웅의 4배짜리 괴물이 화면을 덮었다) 아군도 다친다 → 진공으로 무리에 끌어넣으면 연쇄 폭발
  bomb_slime:  { name: '폭탄 슬라임', model: 'Blob_GreenSpikyBlob', hp: 385, atk: 33, spd: 6.4, range: 1.6, atkTime: 1.0, exp: 12, scale: 0.5, visualScale: 0.65, gold: 1, behavior: 'bomber', tint: '#ffd060' },
  // shaman: 거리 유지 + 6초마다 주변 아군 회복 + 9초마다 소환. 먼저 잡아야 한다
  skel_priest: { name: '해골 사제', model: 'Skeleton_Runekeeper', hp: 595, atk: 18, spd: 3.2, range: 8.0, atkTime: 2.4, weapon: 'Skeleton_Staff', ranged: true, exp: 18, scale: 1.05, gold: 3, projColor: 0xa0ffb0, behavior: 'shaman', summon: 'skel_minion', tint: '#b0ffc0' },
  // shield: 정면 피해 80% 감소. 뒤·옆에서 치거나, 마무리 타격(kb≥4) 4번이면 가드 브레이크 3초
  skel_shield: { name: '해골 방패병', model: 'Skeleton_Bulwark', hp: 1260, atk: 26, spd: 3.4, range: 2.2, atkTime: 1.6, weapon: 'Skeleton_Blade', shield: 'Skeleton_Shield_Large_A', exp: 16, scale: 1.05, gold: 2, armor: 0.1, behavior: 'shield' },
  // burrower: 땅속으로 숨어(조준·몰이·피격 불가) 다가온 뒤 0.75초 예고 원 자리에서 솟구쳐 띄운다.
  // 예고 중에는 반쯤 드러나 맞을 수 있고 기절시키면 취소된다. 솟은 직후 0.9초는 무방비(받는 피해 1.5배).
  grave_burrower: { name: '무덤 균사 잠행꾼', model: 'Blob_Mushnub_Evolved', hp: 640, atk: 24, spd: 4.4, range: 1.9, atkTime: 1.2, exp: 13, scale: 0.6, gold: 1, behavior: 'burrower', tint: '#c9a27a' },
  ash_burrower: { name: '잿더미 굴착꾼', model: 'Big_Cactoro', hp: 900, atk: 33, spd: 4.2, range: 2.0, atkTime: 1.25, exp: 16, scale: 0.95, gold: 2, behavior: 'burrower', tint: '#ff9a62' },
  frost_burrower: { name: '서리굴 잠행꾼', model: 'Blob_Orc', hp: 820, atk: 28, spd: 4.3, range: 2.0, atkTime: 1.2, exp: 15, scale: 1.0, gold: 2, behavior: 'burrower', tint: '#9fd8ff' },
  // bellringer: 종을 매단 채 다가와 10 이내에서 멈추고 0.9초 예고 뒤 고리 충격파 두 겹을 바깥으로 퍼뜨린다(고리 사이 빈틈·회피 무적으로 피함).
  // 매단 종이 피해를 먼저 받아 깨질 때까지는 쓰러지지 않고, 종이 깨지면 주변 적이 2초 기절하고 종지기는 무방비가 된다.
  bell_ringer: { name: '종지기', model: 'Bell_Ringer', hp: 1260, atk: 31, spd: 3.5, range: 2.3, atkTime: 1.4, exp: 17, scale: 1.05, gold: 2, behavior: 'bellringer', tint: '#e0c68c' },
  // ================= 2장 · 불타는 왕좌 (오크 · 악마) =================
  orc:      { name: '오크 전사', model: 'Big_Orc', hp: 1050, atk: 29, spd: 4.0, range: 2.2, atkTime: 1.3, exp: 12, scale: 1.0, gold: 2 },
  orc_blob: { name: '꼬마 오크', model: 'Blob_Orc', hp: 595, atk: 22, spd: 4.8, range: 1.8, atkTime: 1.0, exp: 10, scale: 1.0, gold: 1 },
  tribal:   { name: '부족 전사', model: 'Big_Tribal', hp: 980, atk: 33, spd: 4.4, range: 2.2, atkTime: 1.2, exp: 13, scale: 1.0, gold: 2 },
  cactoro:  { name: '가시 수호병', model: 'Big_Cactoro', hp: 1470, atk: 26, spd: 3.2, range: 2.1, atkTime: 1.6, exp: 15, scale: 1.0, armor: 0.2, gold: 2 },
  imp:      { name: '임프', model: 'Blob_Mushnub', hp: 525, atk: 26, spd: 5.6, range: 1.8, atkTime: 0.9, exp: 11, scale: 1.0, gold: 1 },
  hywirl:   { name: '화염 정령', model: 'Flying_Hywirl', hp: 560, atk: 30, spd: 3.6, range: 8.5, atkTime: 2.0, ranged: true, exp: 16, scale: 1.0, gold: 2, projColor: 0xff8040 },
  armabee:  { name: '독침벌', model: 'Flying_Armabee', hp: 455, atk: 24, spd: 5.0, range: 7.5, atkTime: 1.7, ranged: true, exp: 14, scale: 1.0, gold: 2, projColor: 0xffe060 },
  elite_orc_chief: { name: '오크 족장', model: 'Big_Orc', hp: 6000, atk: 55, spd: 3.8, range: 2.8, atkTime: 1.5, exp: 62, scale: 1.5, armor: 0.25, elite: true, tint: '#ffb060', gold: 8 },
  elite_yeti:      { name: '설산 거인', model: 'Big_Yeti', hp: 7200, atk: 53, spd: 3.0, range: 3.0, atkTime: 1.8, exp: 68, scale: 1.55, armor: 0.3, elite: true, tint: '#c0e8ff', gold: 9 },
  elite_bluedemon: { name: '푸른 악마', model: 'Big_BlueDemon', hp: 4800, atk: 62, spd: 4.6, range: 2.6, atkTime: 1.2, exp: 65, scale: 1.4, elite: true, tint: '#a0c0ff', gold: 9 },

  bomb_imp:      { name: '폭발 임프', model: 'Blob_Mushnub', hp: 455, atk: 42, spd: 6.8, range: 1.6, atkTime: 1.0, exp: 14, scale: 1.0, gold: 1, behavior: 'bomber', tint: '#ff9060' },
  tribal_shaman: { name: '부족 주술사', model: 'Big_Tribal', hp: 910, atk: 22, spd: 3.6, range: 8.0, atkTime: 2.2, ranged: true, exp: 20, scale: 1.0, gold: 3, projColor: 0xff8040, behavior: 'shaman', summon: 'orc_blob', tint: '#ffd0a0' },
  cacto_wall:    { name: '가시 방벽', model: 'Big_Cactoro', hp: 1820, atk: 29, spd: 3.0, range: 2.1, atkTime: 1.7, exp: 18, scale: 1.1, gold: 2, armor: 0.15, behavior: 'shield' },
  // ================= 3장 · 심연의 제단 (이계 · 용) =================
  blob_pink:  { name: '심연 슬라임', model: 'Blob_PinkBlob', hp: 910, atk: 26, spd: 3.6, range: 1.8, atkTime: 1.3, exp: 13, scale: 1.0, gold: 2 },
  blob_spiky: { name: '가시 슬라임', model: 'Blob_GreenSpikyBlob', hp: 1050, atk: 31, spd: 3.4, range: 1.8, atkTime: 1.4, exp: 14, scale: 0.55, visualScale: 0.65, armor: 0.15, gold: 2 },
  alien:      { name: '이계 침입자', model: 'Big_Alien', hp: 1190, atk: 37, spd: 4.4, range: 2.3, atkTime: 1.2, exp: 16, scale: 1.0, gold: 2 },
  squidle:    { name: '부유 촉수', model: 'Flying_Squidle', hp: 700, atk: 33, spd: 4.6, range: 2.2, atkTime: 1.1, exp: 15, scale: 1.0, gold: 2 },
  mushnub:    { name: '포자 괴물', model: 'Blob_Mushnub_Evolved', hp: 1120, atk: 29, spd: 3.4, range: 1.9, atkTime: 1.4, exp: 15, scale: 1.0, gold: 2 },
  ninja:      { name: '그림자 닌자', model: 'Big_Ninja', hp: 840, atk: 44, spd: 6.4, range: 2.1, atkTime: 0.85, exp: 18, scale: 1.0, dodge: 0.25, gold: 2 },
  glub:       { name: '심연 눈알', model: 'Flying_Glub', hp: 630, atk: 35, spd: 3.2, range: 9.0, atkTime: 2.0, ranged: true, exp: 18, scale: 1.0, gold: 3, projColor: 0xb26bff },
  armabee_evo:{ name: '진화한 독침벌', model: 'Flying_Armabee_Evolved', hp: 700, atk: 32, spd: 5.2, range: 8.0, atkTime: 1.6, ranged: true, exp: 18, scale: 1.0, gold: 3, projColor: 0xd0a0ff },
  bomb_abyss:  { name: '심연 폭탄', model: 'Blob_PinkBlob', hp: 560, atk: 51, spd: 7.0, range: 1.6, atkTime: 1.0, exp: 16, scale: 1.0, gold: 2, behavior: 'bomber', tint: '#ff70ff' },
  abyss_seer:  { name: '심연 주시자', model: 'Flying_Glub', hp: 770, atk: 27, spd: 3.4, range: 9.0, atkTime: 2.2, ranged: true, exp: 22, scale: 1.05, gold: 3, projColor: 0xb26bff, behavior: 'shaman', summon: 'squidle', tint: '#d0b0ff' },
  golem_guard: { name: '골렘 수호자', model: 'Flying_Goleling_Evolved', hp: 2240, atk: 33, spd: 3.0, range: 2.4, atkTime: 1.8, exp: 20, scale: 1.15, gold: 3, armor: 0.2, behavior: 'shield' },
  elite_mushroom_king: { name: '버섯 왕', model: 'Big_MushroomKing', hp: 8000, atk: 59, spd: 3.0, range: 3.0, atkTime: 1.7, exp: 75, scale: 1.5, armor: 0.25, elite: true, tint: '#e0a0ff', gold: 10 },
  elite_golem:         { name: '심연 골렘', model: 'Flying_Goleling_Evolved', hp: 6800, atk: 57, spd: 3.4, range: 2.8, atkTime: 1.6, exp: 72, scale: 1.6, armor: 0.3, elite: true, tint: '#a0ffd0', gold: 10 },
  elite_dragonling:    { name: '새끼 용', model: 'Flying_Dragon', hp: 5600, atk: 66, spd: 5.4, range: 2.8, atkTime: 1.3, exp: 78, scale: 1.5, elite: true, tint: '#ffc0a0', gold: 10 },

  // ================= 보스 3종 =================
  boss_warlord: { name: '해골 군주', model: 'Skeleton_Bulwark', hp: 31200, atk: 45, spd: 3.6, range: 3.2, atkTime: 1.8, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', exp: 150, scale: 2.2, boss: true, armor: 0.25, gold: 40, portrait: '/img/boss_warlord.webp', kit: 'warlord', summon: 'skel_minion' },
  boss_demon:   { name: '심연의 대악마', model: 'Big_Demon', hp: 33600, atk: 51, spd: 4.0, range: 3.4, atkTime: 1.6, exp: 175, scale: 2.3, boss: true, armor: 0.2, gold: 45, portrait: '/img/boss_lich.webp', kit: 'reaper', summon: 'imp' },
  boss_dragon:  { name: '고대 용 발카르', model: 'Flying_Dragon_Evolved', hp: 37200, atk: 56, spd: 4.6, range: 3.2, atkTime: 1.5, exp: 200, scale: 2.6, boss: true, armor: 0.2, gold: 55, portrait: '/img/boss_reaper.webp', kit: 'dragon', summon: 'squidle', projColor: 0xff7a30 },

  // ================= 종락·재의 밀물·밤유리 원정 =================
  // These encounters reuse verified rigs with authored phase signatures and
  // dedicated portrait/colour identity; they are not claimed as new GLB files.
  glass_shardling: { name: '유리 파편충', model: 'Blob_GreenSpikyBlob', hp: 760, atk: 31, spd: 5.8, range: 1.7, atkTime: 1.0, exp: 16, scale: 0.55, visualScale: 0.65, gold: 2, behavior: 'bomber', tint: '#7fffe1' },
  bell_wisp: { name: '종의 잔영', model: 'Flying_Ghost', hp: 610, atk: 28, spd: 5.8, range: 2.2, atkTime: 1.0, exp: 16, scale: 1.3, gold: 2, ghostly: true, dodge: 0.12, tint: '#b4fff3' },
  glass_tollmage: { name: '시계종 주술사', model: 'Skeleton_Runekeeper', hp: 720, atk: 23, spd: 3.3, range: 8.5, atkTime: 2.1, ranged: true, exp: 21, scale: 1.08, gold: 3, projColor: 0x7fe8ff, behavior: 'shaman', summon: 'glass_shardling', tint: '#b8f5ff' },
  glass_warden: { name: '유리 회랑 감시자', model: 'Skeleton_Bulwark', hp: 6400, atk: 55, spd: 3.5, range: 2.8, atkTime: 1.5, exp: 72, scale: 1.5, armor: 0.27, elite: true, behavior: 'shield', weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', tint: '#8fffe2', gold: 10 },
  cinderling: { name: '재의 파편', model: 'Blob_Mushnub', hp: 820, atk: 38, spd: 5.5, range: 1.7, atkTime: 1.0, exp: 17, scale: 1.0, gold: 2, behavior: 'bomber', tint: '#ff9c66' },
  chain_forger: { name: '사슬 벼림꾼', model: 'Big_Orc', hp: 1320, atk: 39, spd: 3.6, range: 2.4, atkTime: 1.5, exp: 20, scale: 1.05, armor: 0.18, behavior: 'shield', tint: '#ffc078', gold: 3 },
  ember_scribe: { name: '불씨 기록술사', model: 'Flying_Hywirl', hp: 850, atk: 31, spd: 3.8, range: 8.5, atkTime: 2.0, ranged: true, exp: 23, scale: 1.05, gold: 3, projColor: 0xff7540, behavior: 'shaman', summon: 'cinderling', tint: '#ffd09b' },
  slag_colossus: { name: '슬래그 거수', model: 'Big_BlueDemon', hp: 7600, atk: 62, spd: 3.0, range: 3.0, atkTime: 1.8, exp: 78, scale: 1.45, armor: 0.3, elite: true, tint: '#ff9b66', gold: 11 },
  nightglass_page: { name: '밤유리 서기관', model: 'Flying_Ghost_Skull', hp: 780, atk: 30, spd: 3.4, range: 9.0, atkTime: 2.0, ranged: true, exp: 22, scale: 1.25, gold: 3, projColor: 0x8ad9ff, behavior: 'shaman', summon: 'frost_mirror', tint: '#bde9ff' },
  frost_mirror: { name: '서리 거울벌', model: 'Blob_GreenBlob', hp: 1180, atk: 34, spd: 3.7, range: 1.8, atkTime: 1.4, exp: 19, scale: 1.05, armor: 0.16, behavior: 'shield', tint: '#99d8ff', gold: 3 },
  archive_scribe: { name: '되감기 기록자', model: 'Skeleton_Runekeeper', hp: 900, atk: 27, spd: 3.2, range: 8.5, atkTime: 2.2, ranged: true, exp: 24, scale: 1.1, gold: 3, projColor: 0x9fbdff, behavior: 'shaman', summon: 'frost_mirror', tint: '#d2ddff' },
  archive_warden: { name: '밤유리 수문장', model: 'Big_Yeti', hp: 8200, atk: 59, spd: 3.1, range: 3.0, atkTime: 1.8, exp: 82, scale: 1.6, armor: 0.31, elite: true, behavior: 'shield', tint: '#a7d7ff', gold: 11 },
  // ================= 시즌 전선 · 일식·재벼림·성운 =================
  eclipse_scalelet: { name: '일식 비늘새끼', model: 'Flying_Dragon', hp: 880, atk: 36, spd: 5.2, range: 2.1, atkTime: 1.15, exp: 19, scale: 0.9, gold: 2, behavior: 'bomber', tint: '#63e7dd' },
  eclipse_tidecaller: { name: '역류 조율사', model: 'Flying_Squidle', hp: 920, atk: 29, spd: 3.6, range: 8.5, atkTime: 2.0, ranged: true, exp: 24, scale: 1.05, gold: 3, projColor: 0x54d8d2, behavior: 'shaman', summon: 'eclipse_scalelet', tint: '#9effef' },
  hydra_scaleguard: { name: '삼두룡 비늘수호자', model: 'Big_Alien', hp: 8600, atk: 64, spd: 3.1, range: 3.0, atkTime: 1.75, exp: 86, scale: 1.55, armor: 0.28, elite: true, behavior: 'shield', tint: '#75d8d0', gold: 12 },
  ash_chainling: { name: '잿불 사슬꾼', model: 'Blob_Orc', hp: 900, atk: 41, spd: 5.0, range: 2.0, atkTime: 1.05, exp: 18, scale: 1.0, gold: 2, behavior: 'bomber', tint: '#ff9b66' },
  ash_smith: { name: '재벼림 주조사', model: 'Big_Orc', hp: 1020, atk: 30, spd: 3.5, range: 8.0, atkTime: 2.1, ranged: true, exp: 24, scale: 1.05, gold: 3, projColor: 0xff7849, behavior: 'shaman', summon: 'ash_chainling', tint: '#ffc08a' },
  foundry_bulwark: { name: '지하 제련 방벽', model: 'Big_BlueDemon', hp: 8900, atk: 67, spd: 2.9, range: 3.2, atkTime: 1.9, exp: 90, scale: 1.58, armor: 0.32, elite: true, behavior: 'shield', tint: '#ffad72', gold: 12 },
  astral_pagelet: { name: '성운 쪽지령', model: 'Flying_Ghost_Skull', hp: 840, atk: 32, spd: 4.0, range: 8.5, atkTime: 1.9, ranged: true, exp: 23, scale: 1.2, gold: 3, projColor: 0x9bcaff, behavior: 'shaman', summon: 'astral_orbitling', tint: '#d2e8ff' },
  astral_orbitling: { name: '궤도 파편', model: 'Blob_GreenBlob', hp: 980, atk: 35, spd: 4.2, range: 1.8, atkTime: 1.3, exp: 19, scale: 1.0, gold: 3, behavior: 'shield', tint: '#83baff' },
  star_wisp: { name: '별빛 잔영', model: 'Flying_Ghost', hp: 680, atk: 30, spd: 5.6, range: 2.2, atkTime: 1.0, exp: 18, scale: 1.25, gold: 2, ghostly: true, tint: '#c0e4ff' },
  celestial_warden: { name: '천체 서고 수문장', model: 'Big_Yeti', hp: 9400, atk: 65, spd: 3.0, range: 3.1, atkTime: 1.8, exp: 94, scale: 1.62, armor: 0.3, elite: true, behavior: 'shield', tint: '#accfff', gold: 13 },
  mossbound_scout: { name: '이끼 덮인 정찰자', model: 'Big_Cactoro', hp: 980, atk: 38, spd: 5.8, range: 2.0, atkTime: 0.95, exp: 23, scale: 1.0, gold: 3, dodge: 0.16, tint: '#8ee6a8' },
  verdigris_rootcaller: { name: '녹청 뿌리술사', model: 'Big_Tribal', hp: 1120, atk: 32, spd: 3.4, range: 8.2, atkTime: 2.0, ranged: true, exp: 27, scale: 1.05, gold: 4, projColor: 0x72e6ae, behavior: 'shaman', summon: 'mossbound_scout', tint: '#b0f0bb' },
  ironbark_bulwark: { name: '철나무 방벽', model: 'Flying_Goleling_Evolved', hp: 10200, atk: 72, spd: 2.7, range: 3.2, atkTime: 1.95, exp: 108, scale: 1.7, armor: 0.34, elite: true, behavior: 'shield', tint: '#78d99c', gold: 15 },
  mirage_hound: { name: '환영 사냥개', model: 'Big_Ninja', hp: 1040, atk: 49, spd: 6.5, range: 2.2, atkTime: 0.85, exp: 26, scale: 1.0, gold: 3, dodge: 0.22, tint: '#d6a0ff' },
  sandglass_seer: { name: '모래시계 예언자', model: 'Flying_Glub', hp: 1180, atk: 35, spd: 3.5, range: 9.0, atkTime: 2.2, ranged: true, exp: 29, scale: 1.06, gold: 4, projColor: 0xc084ff, behavior: 'shaman', summon: 'mirage_hound', tint: '#ecd0ff' },
  mirage_colossus: { name: '환영 사암 거수', model: 'Big_BlueDemon', hp: 11200, atk: 76, spd: 2.8, range: 3.4, atkTime: 1.9, exp: 116, scale: 1.72, armor: 0.33, elite: true, behavior: 'shield', tint: '#d3a2ff', gold: 16 },
  comet_spark: { name: '혜성 불씨', model: 'Flying_Ghost', hp: 920, atk: 40, spd: 5.9, range: 2.2, atkTime: 1.0, exp: 25, scale: 1.25, gold: 3, ghostly: true, tint: '#8bc9ff' },
  comet_orbit_mote: { name: '궤도 운석편', model: 'Blob_PinkBlob', hp: 1240, atk: 42, spd: 4.1, range: 2.0, atkTime: 1.25, exp: 28, scale: 1.05, gold: 4, armor: 0.14, behavior: 'shield', tint: '#9ccfff' },
  comet_bastion_warden: { name: '혜성 요새 수문장', model: 'Big_Yeti', hp: 12400, atk: 80, spd: 2.9, range: 3.3, atkTime: 1.85, exp: 124, scale: 1.74, armor: 0.35, elite: true, behavior: 'shield', tint: '#8bbdff', gold: 18 },
  obsidian_hydra: { name: '흑요의 삼두룡', model: 'Flying_AbyssRegent', hp: 18800, atk: 72, spd: 4.2, range: 3.4, atkTime: 1.55, exp: 300, scale: 2.5, boss: true, armor: 0.27, gold: 62, kit: 'dragon', portrait: ENCOUNTER_ART.boss_obsidian_hydra, signatureBoss: true,
    phasePatterns: [['tide_sweep','fan','tide_undertow','slam'], ['tide_undertow','tide_sweep','summon','fan'], ['tide_sweep','tide_undertow','dash']],
    phaseHints: ['먼저 지나간 물결 뒤로 이동하세요.', '세 머리가 들리면 중앙에서 벗어나세요.', '역류가 닫히기 전에 마지막 틈을 찾으세요.'],
    tactic: '물결이 지나간 통로가 잠시 안전합니다. 세 머리가 동시에 고개를 들면 중앙에서 벗어나세요.', projColor: 0x63e7dd },
  ash_colossus: { name: '잿빛 재벼림 거수', model: 'Skeleton_OathRemnant', hp: 20400, atk: 75, spd: 3.4, range: 3.6, atkTime: 1.6, exp: 320, scale: 2.45, boss: true, armor: 0.29, gold: 66, kit: 'reaper', portrait: ENCOUNTER_ART.boss_ash_colossus, signatureBoss: true,
    phasePatterns: [['kiln_vents','slam','kiln_hammer','fan'], ['kiln_hammer','kiln_vents','summon','slam'], ['kiln_vents','kiln_hammer','dash']],
    phaseHints: ['중앙 과열선 옆으로 이동하세요.', '사슬이 당기는 반대편으로 빠지세요.', '마지막 망치 뒤 냉각로가 열립니다.'],
    tactic: '사슬이 끌리는 방향의 반대편으로 이동한 뒤 망치 충격파가 지나가면 냉각로를 활성화하세요.', projColor: 0xff9b66 },
  astral_leviathan: { name: '성운의 레비아탄', model: 'Big_ArchiveMonarch', hp: 22400, atk: 78, spd: 3.2, range: 3.5, atkTime: 1.7, exp: 340, scale: 2.55, boss: true, armor: 0.3, gold: 70, kit: 'lich', summon: 'astral_pagelet', portrait: ENCOUNTER_ART.boss_astral_leviathan, signatureBoss: true,
    phasePatterns: [['archive_retrace','fan','archive_hourglass','slam'], ['archive_hourglass','archive_retrace','summon','fan'], ['archive_retrace','archive_hourglass','soulrain']],
    phaseHints: ['지나온 별자리를 역순으로 피하세요.', '모래시계의 바깥과 안쪽을 번갈아 이동하세요.', '마지막 기록 파편이 닫힐 때 반격하세요.'],
    tactic: '모래시계가 가리킨 별자리만 밟고, 기록 파편이 모이면 외곽 고리로 빠져나오세요.', projColor: 0x9bcaff },
  verdigris_sentinel: { name: '녹청의 성역 거수', model: 'Skeleton_HollowRegent', hp: 23800, atk: 80, spd: 3.5, range: 3.5, atkTime: 1.65, exp: 360, scale: 2.5, boss: true, armor: 0.31, gold: 74, kit: 'warlord', summon: 'mossbound_scout', portrait: ENCOUNTER_ART.boss_verdigris_sentinel, signatureBoss: true,
    phasePatterns: [['bell_toll','crown_orbit','bell_clap','slam'], ['bell_clap','bell_toll','summon','crown_orbit'], ['bell_toll','bell_clap','dash']],
    phaseHints: ['생명 제단의 고리 사이로 이동하세요.', '양옆 뿌리 종 뒤 중앙이 흔들립니다.', '마지막 성역 공명 뒤 반격하세요.'],
    tactic: '뿌리 문양이 켜진 순서대로 제단을 밟고, 포자 폭발 전에 외곽 수로로 빠지세요.', projColor: 0x72e6ae },
  sable_mirage_empress: { name: '흑사막 환영 여왕', model: 'Flying_AbyssRegent', hp: 25800, atk: 84, spd: 4.4, range: 3.6, atkTime: 1.45, exp: 390, scale: 2.4, boss: true, armor: 0.28, gold: 80, kit: 'dragon', summon: 'mirage_hound', portrait: ENCOUNTER_ART.boss_sable_mirage_empress, signatureBoss: true,
    phasePatterns: [['crown_orbit','crown_verdict','fan','slam'], ['crown_verdict','crown_orbit','summon','spin'], ['crown_orbit','crown_verdict','dash']],
    phaseHints: ['회전 칼날의 중앙 빈 원을 이용하세요.', '가짜 왕좌 두 개 뒤 절단선이 내려옵니다.', '마지막 환영이 사라진 뒤 본체를 노리세요.'],
    tactic: '모래 발자국이 사라지는 쪽은 환영입니다. 보라색 모래시계가 멈춘 순간만 공격하세요.', projColor: 0xd9a1ff },
  comet_bastion: { name: '혜성의 유성 기사단장', model: 'Big_ArchiveMonarch', hp: 28200, atk: 88, spd: 3.1, range: 3.8, atkTime: 1.8, exp: 420, scale: 2.6, boss: true, armor: 0.33, gold: 88, kit: 'lich', summon: 'comet_spark', portrait: ENCOUNTER_ART.boss_comet_bastion, signatureBoss: true,
    phasePatterns: [['oath_tethers','archive_retrace','oath_shelter','slam'], ['oath_shelter','oath_tethers','summon','archive_retrace'], ['oath_tethers','oath_shelter','dash']],
    phaseHints: ['궤도선과 연결된 선 옆으로 이동하세요.', '빈 쉼터가 옮겨 가면 다음 고리로 빠지세요.', '마지막 혜성 파편이 닫힐 때 반격하세요.'],
    tactic: '끊어진 명령의 연결선 예고 옆으로 비켜서고, 함께 잇는 귀환의 빈 쉼터 원을 따라 다음 쉼터로 옮기며, 되감는 기록의 지나온 자리로는 돌아가지 마세요.', projColor: 0x82bfff },
  glass_hour_sovereign: { name: '시계유리의 주권자', model: 'Skeleton_BellKing', hp: 14500, atk: 62, spd: 3.8, range: 3.2, atkTime: 1.65, exp: 240, scale: 2.25, boss: true, armor: 0.23, gold: 48, kit: 'warlord', summon: 'bell_wisp', portrait: RIFT_ART.glass_hour_sovereign, signatureBoss: true,
    phasePatterns: [['bell_toll','slam','bell_clap','spin'], ['bell_clap','summon','bell_toll','slam'], ['bell_toll','bell_clap','spin']],
    phaseHints: ['세 종의 빛이 켜지는 순서를 읽으세요.', '양옆 종 뒤 중앙의 공명을 피하세요.', '마지막 울림 뒤에만 긴 반격 창이 열립니다.'],
    tactic: '종문이 켜진 순서를 기억해 반대쪽 안전 지대로 이동하세요. 마지막 공명 뒤에만 긴 반격 창이 열립니다.', projColor: 0x86e4d0 },
  cinder_chain_executor: { name: '쇠사슬의 집행자', model: 'Big_KilnTyrant', hp: 15800, atk: 66, spd: 3.8, range: 3.4, atkTime: 1.6, exp: 255, scale: 2.3, boss: true, armor: 0.24, gold: 52, kit: 'reaper', summon: 'chain_forger', portrait: ENCOUNTER_ART.boss_cinder_chain_executor, signatureBoss: true,
    phasePatterns: [['kiln_vents','slam','kiln_hammer','fan'], ['kiln_hammer','kiln_vents','summon','slam'], ['kiln_vents','kiln_hammer','dash']],
    phaseHints: ['중앙 냉각선 옆으로 이동하세요.', '망치가 닿은 자리 뒤에 충격파가 옵니다.', '과열 통로의 방향이 바뀝니다.'],
    tactic: '밸브가 번갈아 과열됩니다. 경고선 바깥에서 증원을 끊고, 망치가 떨어진 뒤 중앙을 가로지르세요.', projColor: 0xff9b64 },
  nightglass_archivist: { name: '밤유리의 기록관', model: 'Big_ArchiveMonarch', hp: 17200, atk: 68, spd: 3.4, range: 3.2, atkTime: 1.7, exp: 270, scale: 2.35, boss: true, armor: 0.25, gold: 56, kit: 'lich', summon: 'nightglass_page', portrait: ENCOUNTER_ART.boss_nightglass_archivist, signatureBoss: true,
    phasePatterns: [['archive_retrace','fan','archive_hourglass','slam'], ['archive_hourglass','archive_retrace','summon','fan'], ['archive_retrace','archive_hourglass','soulrain']],
    phaseHints: ['지나온 길이 역순으로 터집니다.', '바깥 고리 다음은 안쪽 원입니다.', '네 번째 기록과 마지막 공명까지 확인하세요.'],
    tactic: '방금 지나온 세 자리가 역순으로 폭발합니다. 모래시계가 닫히기 전에 바깥 고리로 이동하세요.', projColor: 0x9ed5ff },
  // ================= 컨셉 던전 전용 보스 (2026-10-17) =================
  // 전투 수치·판정 크기(scale)·kit는 교체 전 보스(obsidian_hydra / ash_colossus)와 같다. 바뀌는 것은 이름·외형·기술뿐이다.
  // 외형은 다른 던전·심층·캠페인 최종 보스가 쓰지 않는 기존 라이브러리 자산(frost_golem / shadow_soldier)이며 새 GLB가 아니다.
  // 전용 초상은 없다(보스 바 초상 숨김). tactic·phaseHints는 아래에서 실제 기술 이름·cue로 채운다.
  tidegate_titan: { name: '빙하 수문의 거신', model: 'Big_TidegateTitan', hp: 18800, atk: 72, spd: 4.2, range: 3.4, atkTime: 1.55, exp: 300, scale: 2.5, boss: true, armor: 0.27, gold: 62, kit: 'dragon', signatureBoss: true, tint: '#8ff7ff',
    phasePatterns: [['tidegate_flood','slam','tidegate_ring_gap','fan'], ['tidegate_ring_gap','tidegate_flood','spin','slam'], ['tidegate_flood','tidegate_ring_gap','dash']],
    projColor: 0x8ff7ff },
  pulley_colossus: { name: '도르래 거수', model: 'Big_PulleyColossus', hp: 20400, atk: 75, spd: 3.4, range: 3.6, atkTime: 1.6, exp: 320, scale: 2.45, boss: true, armor: 0.29, gold: 66, kit: 'reaper', signatureBoss: true, tint: '#ffb35c',
    phasePatterns: [['pulley_ore_fall','slam','pulley_chain_line','spin'], ['pulley_chain_line','pulley_ore_fall','fan','slam'], ['pulley_ore_fall','pulley_chain_line','dash']],
    projColor: 0xffb35c },
  // 7장 종탑 도시 경로 보스의 바탕. 관문 대장·수문장 변형(dungeon_<경로>_<계급>)이 이 몸과 기술을 물려받는다(수치는 계급표가 덮어쓴다).
  // 모델은 Tripo 슬롯(monster-roster Bell_*)을 쓰고, 세 박자 종소리(bell_threefold)는 지역 최종 보스만 쓴다.
  bell_gate_warden: { name: '종탑 수문의 감시자', model: 'Bell_Warden', hp: 15200, atk: 64, spd: 3.6, range: 3.2, atkTime: 1.65, exp: 250, scale: 2.25, boss: true, armor: 0.24, gold: 50, kit: 'warlord', summon: 'skel_minion', signatureBoss: true, tint: '#e0c68c',
    phasePatterns: [['bell_pair','slam','spin'], ['bell_pair','summon','bell_pair','slam'], ['bell_pair','spin','bell_pair']], projColor: 0xe0c68c },
  bell_tollmaster: { name: '타종 관리인', model: 'Bell_Ringer', hp: 14800, atk: 62, spd: 3.5, range: 3.2, atkTime: 1.65, exp: 245, scale: 2.2, boss: true, armor: 0.22, gold: 49, kit: 'warlord', summon: 'skel_priest', signatureBoss: true, tint: '#d9c08a',
    phasePatterns: [['bell_pair','bell_crack','slam'], ['bell_crack','bell_pair','summon','spin'], ['bell_pair','bell_crack','bell_pair']], projColor: 0xd9c08a },
  bell_nave_guardian: { name: '대예배당의 종 수호자', model: 'Bell_Sovereign', hp: 16200, atk: 66, spd: 3.4, range: 3.4, atkTime: 1.7, exp: 255, scale: 2.4, boss: true, armor: 0.26, gold: 52, kit: 'warlord', summon: 'skel_shield', signatureBoss: true, tint: '#cfb27a',
    phasePatterns: [['bell_crack','slam','spin'], ['bell_pair','bell_crack','summon','slam'], ['bell_crack','spin','bell_crack']], projColor: 0xcfb27a },
};

// 검수된 기존 리그만 재사용한다. 전용 원화의 3D 모델이 완성됐다는 뜻은 아니다.
const CAMPAIGN_ENCOUNTERS = {
  garden: {
    captain: ['elite_skel_captain', '장례 행렬 대장', ['slam'], '강타의 원을 벗어난 뒤 후방을 공격하세요.'],
    warden: ['elite_bone_lord', '침묵의 종지기', ['slam', 'spin'], '중앙의 공명 고리와 회전 공격 사이의 빈 곳을 찾으세요.'],
    midboss: ['boss_warlord', '애도의 기사 세렌', ['spin', 'slam', 'summon'], '소환된 병사를 먼저 모아 처리하고 강타 뒤에 반격하세요.'],
    finalboss: ['boss_warlord', '종왕 에일른', ['slam', 'summon', 'spin', 'slam'], '종의 공명 띠를 피하면서 소환과 회전 공격의 순서를 읽으세요.'],
  },
  forge: {
    captain: ['elite_orc_chief', '화구 경비대장', ['slam'], '과열 경고선에서 벗어난 뒤 느린 강타의 빈틈을 노리세요.'],
    warden: ['elite_bluedemon', '재의 감독관', ['dash', 'slam'], '돌진의 옆으로 피하고 다음 화염 띠까지 확인하세요.'],
    midboss: ['elite_orc_chief', '대장장이 이그란', ['slam', 'spin', 'slam'], '망치의 넓은 강타를 연달아 피한 뒤 접근하세요.'],
    finalboss: ['boss_demon', '화왕 발드', ['fan', 'dash', 'summon', 'spin'], '부채꼴 화염을 옆으로 피하고 소환 중에 적을 몰아 처리하세요.'],
  },
  frost: {
    captain: ['elite_wraith', '서고 경비대장', ['fan'], '탄막 사이를 통과하며 기록된 발밑 원에서 이동하세요.'],
    warden: ['elite_yeti', '백지의 검열관', ['slam', 'soulrain'], '낙하 경고가 생기면 같은 위치에서 공격을 계속하지 마세요.'],
    midboss: ['elite_golem', '기록관 오르딘', ['soulrain', 'fan', 'slam'], '지연 기록과 낙하 원을 벗어난 뒤 부채꼴 탄막의 옆으로 돌아가세요.'],
    finalboss: ['boss_demon', '서리왕 이셀', ['soulrain', 'summon', 'fan', 'soulrain'], '추적 기록을 한 방향으로 유도하고 소환된 적부터 정리하세요.'],
  },
  tide: {
    captain: ['elite_golem', '침몰 선단 대장', ['slam'], '밀물이 닿기 전에 빈 띠로 이동하고 강타 후 반격하세요.'],
    warden: ['elite_dragonling', '해구의 추격자', ['dash', 'fan'], '밀물 방향을 확인하며 돌진과 탄막을 옆으로 피하세요.'],
    midboss: ['elite_mushroom_king', '등대지기 마렌', ['fan', 'summon', 'soulrain'], '부유하는 적을 먼저 처리하고 등대의 낙하 경고에서 빠져나오세요.'],
    finalboss: ['boss_dragon', '해왕 네레이스', ['fan', 'dash', 'slam', 'summon'], '파도에 밀릴 곳을 미리 비우고 돌진이 끝난 왕의 뒤를 잡으세요.'],
  },
  crown: {
    captain: ['elite_skel_captain', '왕관의 근위대장', ['spin', 'slam'], '십자 심판의 안전 구역을 확인하고 회전 후 강타까지 피하세요.'],
    warden: ['elite_bluedemon', '새벽의 집행관', ['dash', 'soulrain', 'spin'], '돌진 이후 바로 멈추지 말고 낙하 원 밖으로 이동하세요.'],
    midboss: ['boss_warlord', '첫 기사 아스텔', ['spin', 'dash', 'summon', 'slam'], '소환 병사를 정리한 뒤 회전과 돌진이 끝나는 순간을 노리세요.'],
    finalboss: ['boss_dragon', '새벽을 먹는 빈 왕관', ['slam', 'fan', 'soulrain', 'dash', 'summon', 'spin'], '다섯 왕의 공격이 순서대로 이어집니다. 십자 심판의 중앙 안전 원을 활용하세요.'],
  },
  // 7장 종탑 도시: 조우 키는 encounterPrefix(belltower). 중간·최종 보스의 실제 기술은 BOSS_ENCOUNTERS 가 덮어쓴다.
  belltower: {
    captain: ['elite_skel_captain', '종탑 순찰대장', ['slam'], '어긋난 종소리의 고리를 확인하고 강타 뒤 후방을 공격하세요.'],
    warden: ['elite_bone_lord', '시청 종루의 종지기', ['slam', 'spin'], '종이 울리면 고리 사이 빈틈이나 한가운데로 이동한 뒤 반격하세요.'],
    midboss: ['boss_warlord', '종탑 수문 기사 오르벤', ['spin', 'slam', 'summon'], '왼쪽 종과 오른쪽 종이 번갈아 울립니다. 두 고리가 닿지 않는 가운데에서 박자를 세세요.'],
    finalboss: ['boss_warlord', '금 간 대종의 주인 카델', ['slam', 'summon', 'spin', 'slam'], '세 박자 종소리의 고리가 겹치는 한가운데만 안전합니다. 마지막 울림 뒤에 반격하세요.'],
  },
};
// 귀환로(6장)는 정원(1장)의 전투 틀을 그대로 쓰고 이름만 후일담 조우로 바꾼다. 장 번호가 아니라 조우 키(encounterPrefix)로 고른다.
const HOMECOMING_NAMES = { captain: '귀환로를 막는 잔병장', warden: '끊어진 명령의 파수꾼', midboss: '공허한 서약의 잔향', finalboss: '마지막 고립의 잔향' };
CAMPAIGN_ENCOUNTERS.homecoming = Object.fromEntries(Object.entries(CAMPAIGN_ENCOUNTERS.garden).map(([rank, [baseId, , pattern, tactic]]) => [rank, [baseId, HOMECOMING_NAMES[rank], pattern, tactic]]));
const RANK_STATS = {
  // 관문도 궁극기 한 번 뒤에 패턴을 보여줄 체력이 필요하다.
  // 기존 첫 보스(31,200)를 기준으로 계급 간 6k/8k/8k 차이를 보존한다.
  // 보이는 크기는 size-bands.js 가 영웅×1.8 이상으로 맞춘다(판정 반경은 이 scale 그대로).
  captain: { hp: 31200, atk: 40, scale: 1.45, exp: 90, gold: 20 },
  warden: { hp: 37200, atk: 44, scale: 1.7, exp: 120, gold: 28 },
  midboss: { hp: 45200, atk: 48, scale: 1.95, exp: 160, gold: 40 },
  finalboss: { hp: 53200, atk: 53, scale: 2.25, exp: 220, gold: 55 },
};
// 층 배율의 증가가 완만해지는 후반에는 지역 보스 → 다음 지역 중간 보스의 실효 체력이 8% 넘게 내려간다(test/campaign-structure.test.ts 의 곡선 보호선).
// 7장 중간·최종 보스는 계급 체력에 이 배율을 곱해 6-10 → 7-5 경계를 보호선 안에 둔다. 최종 보스 > 중간 보스 순서는 그대로다.
const BOSS_HP_MUL = { 7: 1.05 };
for (const chapter of CHAPTERS) {
  const theme = chapter.theme;
  const summon = ROSTER[theme].trash[0];
  for (const [rank, [baseId, name, pattern, tactic]] of Object.entries(CAMPAIGN_ENCOUNTERS[chapter.encounterPrefix || theme])) {
    const base = ENEMIES[baseId];
    ENEMIES[(chapter.encounterPrefix || theme) + '_' + rank] = {
      ...base, ...RANK_STATS[rank], ...((rank === 'midboss' || rank === 'finalboss') && BOSS_HP_MUL[chapter.id] ? { hp: Math.round(RANK_STATS[rank].hp * BOSS_HP_MUL[chapter.id]) } : {}), name, boss: true, elite: false, ranged: false,
      behavior: undefined, rank, pattern, tactic, summon, tint: chapter.color, range: 3.2,
      armor: rank === 'captain' ? 0.12 : 0.2, atkTime: rank === 'finalboss' ? 1.7 : 1.9,
      kit: WARLORD_THEMES.has(theme) ? 'warlord' : theme === 'frost' ? 'lich' : theme === 'tide' ? 'dragon' : 'reaper',
      voiceKey: WARLORD_THEMES.has(theme) ? 'boss_warlord' : theme === 'tide' ? 'boss_dragon' : 'boss_demon',
      portrait: ENCOUNTER_ART[(chapter.encounterPrefix || theme) + '_' + rank],
      projColor: Number.parseInt(chapter.color.slice(1), 16),
    };
  }
}

for (const id of ['boss_warlord', 'boss_demon', 'boss_dragon']) ENEMIES[id].portrait = ENCOUNTER_ART[id];
for (const [id, portrait] of Object.entries(MOB_ART)) if (ENEMIES[id]) ENEMIES[id].portrait = portrait;
for (const [id, model] of Object.entries(CAMPAIGN_MODELS)) ENEMIES[id].model = model;
for (const [id, encounter] of Object.entries({ ...BOSS_ENCOUNTERS, ...BOSS_RANK_ENCOUNTERS })) {
  Object.assign(ENEMIES[id], { signatureBoss:true, pattern:encounter.phases[0], phasePatterns:encounter.phases, phaseHints:encounter.phaseHints, tactic:encounter.tactic });
}
// The empty crown now has its own humanoid silhouette and real rig weapon socket.
ENEMIES.crown_finalboss.weapon = 'Skeleton_Blade';
ENEMIES.crown_finalboss.shield = 'Skeleton_Shield_Large_A';
for (const [id,role] of Object.entries(MOB_ROLE_ENEMIES)) ENEMIES[id].meleeRole = role;

// These variant encounters reuse real phase attacks, not their illustration's
// imagined altars, spores or valves. Keep advice bound to the executable cues.
const signatureAdvice = patterns => [...new Set(patterns)].filter(key => BOSS_SIGNATURES[key])
  .map(key => `${BOSS_SIGNATURES[key].name}: ${BOSS_SIGNATURES[key].cue}`).join(' · ');
for (const id of new Set(Object.values(DUNGEON_BOSS_BASE))) {
  const def = ENEMIES[id];
  def.tactic = signatureAdvice(def.phasePatterns.flat());
  def.phaseHints = def.phasePatterns.map(signatureAdvice);
}
// 컨셉 전용 보스도 같은 규칙으로 실제 기술의 이름·cue만 안내한다(카드·준비·페이즈 알림이 같은 문장을 쓴다).
for (const id of ['tidegate_titan', 'pulley_colossus']) {
  const def = ENEMIES[id];
  Object.assign(def, { pattern: def.phasePatterns[0], tactic: signatureAdvice(def.phasePatterns.flat()), phaseHints: def.phasePatterns.map(signatureAdvice) });
}

// Keep each authored dungeon's boss silhouette and attack vocabulary distinct.
// The source rigs are existing verified assets; the dungeon identity is layered
// with a dedicated name, rank stats, portrait, tint and phase signature.
for (const [dungeonId, sourceId] of Object.entries(DUNGEON_BOSS_BASE)) {
  const source = ENEMIES[sourceId];
  if (!source) continue;
  for (const [rank, stats] of Object.entries(RANK_STATS)) {
    const id = `dungeon_${dungeonId}_${rank}`;
    ENEMIES[id] = {
      ...source, ...stats,
      name: `${DUNGEON_BOSS_NAMES[dungeonId]} · ${RANK_LABELS[rank]}`,
      boss: true, elite: false, ranged: false, rank,
      pattern: source.phasePatterns?.[0] || source.pattern || [],
      phasePatterns: source.phasePatterns,
      phaseHints: source.phaseHints,
      tactic: source.tactic,
      voiceKey: source.voiceKey || sourceId,
      signatureBoss: true,
    };
  }
}

// 장 전용 몸 적(CHAPTER_SPECIES): 원래 적의 수치·행동·초상·근접 역할을 그대로 복사하고 이름과 모델만 바꾼다.
const CHAPTER_SPECIES_DEFS = {
  ch1_coffinbearer: ['skel_minion', '관꾼 해골', 'Ch1_CoffinBearer'],
  ch1_mourner: ['ghost', '곡하는 원령', 'Ch1_Mourner'],
  ch2_smith: ['orc', '앞치마 오크 장인', 'Ch2_Smith'],
  ch2_emberimp: ['tribal_shaman', '불씨 임프', 'Ch2_EmberImp'],
  ch1_tombguard: ['skel_shield', '묘비 방패병', 'Ch1_TombGuard'],
  ch1_mourner_wail: ['ghost_skull', '울부짖는 원령', 'Ch1_Mourner'],
  ch2_smith_line: ['tribal', '풀무 오크 장인', 'Ch2_Smith'],
  ch2_emberimp_line: ['imp', '불씨 꼬마 임프', 'Ch2_EmberImp'],
  ch2_emberimp_bomb: ['bomb_imp', '폭발 불씨 임프', 'Ch2_EmberImp'],
  ch1_hoodbearer: ['skel_rogue', '두건 쓴 길잡이', 'Ch1_CoffinBearer'],
  ch1_gravewisp: ['grave_burrower', '묘혈 원령', 'Ch1_Mourner'],
  ch1_mourner_dirge: ['skel_mage', '만가 부르는 원령', 'Ch1_Mourner'],
  ch2_anvilguard: ['cacto_wall', '모루 방패 장인', 'Ch2_Smith'],
  ch2_ashimp: ['ash_burrower', '잿불 굴착 임프', 'Ch2_EmberImp'],
  ch3_censor: ['ghost', '망령 검열관', 'Ch3_Censor'],
  ch3_censor_slip: ['ghost_skull', '쪽지 날리는 검열관', 'Ch3_Censor'],
  ch3_censor_tome: ['skel_mage', '금서 낭독 검열관', 'Ch3_CensorTome'],
  ch3_censor_quill: ['skel_priest', '깃펜 든 검열관', 'Ch3_CensorTome'],
  // 깃펜 검열관(skel_priest 자리)이 부르는 지원병(summon skel_minion)도 3장 사서 몸으로 나온다.
  ch3_pagebearer: ['skel_minion', '책 나르는 사서', 'Ch3_Librarian'],
  ch3_librarian: ['skel_rogue', '서리 해골 사서', 'Ch3_Librarian'],
  ch3_shelfguard: ['skel_shield', '서가 방패 사서', 'Ch3_ShelfGuard'],
  ch3_keykeeper: ['bone_orc', '열쇠지기 사서', 'Ch3_Librarian'],
  ch3_icecrawler: ['frost_burrower', '얼음 밑 사서', 'Ch3_Librarian'],
  ch3_moldkeeper: ['blob_green', '곰팡이 핀 사서', 'Ch3_Librarian'],
  // 4장: 따개비 수부(tll_ch4_drowned) 갈래 7종·미끼등 아귀(tll_ch4_lurer) 갈래 4종. 원본 종 크기가 다른 자리(원령 1.25·골렘 수호자 1.15·해골 망령 1.2)는 로스터 항목을 나눴다.
  ch4_drowned: ['squidle', '따개비 수부', 'Ch4_Drowned'],
  ch4_drowned_line: ['blob_pink', '따개비 덮인 수부', 'Ch4_Drowned'],
  ch4_drowned_anchor: ['alien', '닻 끄는 수부', 'Ch4_Drowned'],
  ch4_drowned_coral: ['mushnub', '산호 핀 수부', 'Ch4_Drowned'],
  ch4_plankguard: ['golem_guard', '판자 방패 수부', 'Ch4_PlankGuard'],
  ch4_deckhand: ['skel_minion', '갑판 수부', 'Ch4_Drowned'],
  ch4_drowned_drift: ['ghost', '떠밀려 온 수부', 'Ch4_DrownedDrift'],
  ch4_lurer: ['glub', '미끼등 아귀', 'Ch4_Lurer'],
  ch4_lurer_bomb: ['bomb_abyss', '경고등 아귀', 'Ch4_Lurer'],
  ch4_lurer_seer: ['abyss_seer', '빛주머니 아귀', 'Ch4_Lurer'],
  ch4_lurer_glim: ['ghost_skull', '깜빡이 아귀', 'Ch4_LurerGlim'],
  // 5장: 새벽 가면 닌자(tll_ch5_dawnninja) 갈래 3종·왕관 병사(tll_ch5_crownsoldier) 갈래 3종·왕관 고리 주술사(tll_ch5_seer) 갈래 3종.
  ch5_dawnninja: ['ninja', '새벽 가면 닌자', 'Ch5_DawnNinja'],
  ch5_dawnninja_squire: ['imp', '새벽 견습 닌자', 'Ch5_DawnNinjaBare'],
  ch5_dawnninja_flare: ['bomb_abyss', '봉화 닌자', 'Ch5_DawnNinjaBare'],
  ch5_crownsoldier: ['alien', '왕관 병사', 'Ch5_CrownSoldier'],
  ch5_crownsoldier_chain: ['bone_orc', '금사슬 왕관 병사', 'Ch5_CrownSoldier'],
  ch5_swordwall: ['skel_shield', '성벽 검 방패병', 'Ch5_SwordWall'],
  ch5_seer: ['abyss_seer', '왕관 고리 주술사', 'Ch5_Seer'],
  ch5_seer_ember: ['hywirl', '새벽불 주술사', 'Ch5_Seer'],
  ch5_seer_herald: ['tribal_shaman', '칙령 낭독 주술사', 'Ch5_Seer'],
  // 6장: 귀환 열차 승객 잔향(tll_ch6_passenger) 갈래 10종. 원본 종 크기가 다른 자리(원령 1.25)는 로스터 항목을 나눴다.
  ch6_passenger: ['skel_minion', '귀환 열차 승객', 'Ch6_Passenger'],
  ch6_passenger_drift: ['ghost', '떠도는 승객 잔향', 'Ch6_PassengerDrift'],
  ch6_passenger_hurry: ['skel_rogue', '서두르는 승객', 'Ch6_PassengerBare'],
  ch6_passenger_child: ['imp', '꼬마 승객', 'Ch6_PassengerSmall'],
  ch6_passenger_porter: ['tribal', '짐꾼 승객', 'Ch6_Passenger'],
  ch6_passenger_trunk: ['cacto_wall', '가방 방패 승객', 'Ch6_PassengerTrunk'],
  ch6_passenger_gate: ['golem_guard', '개찰구 승객', 'Ch6_PassengerTrunk'],
  ch6_passenger_tide: ['squidle', '바닷길 승객', 'Ch6_PassengerBare'],
  ch6_passenger_moss: ['mushnub', '이끼 낀 승객', 'Ch6_PassengerBare'],
  ch6_passenger_lost: ['frost_burrower', '길 잃은 승객', 'Ch6_PassengerBare'],
  // 7장: 해골 시민(tll_ch7_citizen) 갈래 5종·굽쇠 주술사(tll_ch7_tuner) 갈래 4종. 원본 종 크기가 다른 자리(폭탄 슬라임 0.33·해골 망령 1.2·원령 1.25)는 로스터 항목을 나눴다.
  ch7_citizen: ['skel_minion', '해골 시민', 'Ch7_Citizen'],
  ch7_citizen_late: ['skel_rogue', '늦은 해골 시민', 'Ch7_CitizenBare'],
  ch7_citizen_ledger: ['skel_shield', '명부 방패 시민', 'Ch7_CitizenLedger'],
  ch7_citizen_hauler: ['bone_orc', '종루 짐꾼 시민', 'Ch7_CitizenHauler'],
  ch7_citizen_fuse: ['bomb_slime', '폭음 시민', 'Ch7_CitizenFuse'],
  ch7_tuner: ['skel_mage', '굽쇠 주술사', 'Ch7_Tuner'],
  ch7_tuner_cantor: ['skel_priest', '명부 낭송 주술사', 'Ch7_TunerLedger'],
  ch7_tuner_echo: ['ghost_skull', '울림 잔향 주술사', 'Ch7_TunerEcho'],
  ch7_tuner_drift: ['ghost', '떠도는 조율사', 'Ch7_TunerDrift'],
};
/** 장 전용 종 id → 수치를 복사한 원래 적 id(지역 동사처럼 원래 종에 묶인 규칙을 찾을 때). 원래 종이면 그대로. */
const SPECIES_SOURCE = Object.freeze(Object.fromEntries(Object.entries(CHAPTER_SPECIES_DEFS).map(([id, [sourceId]]) => [id, sourceId])));
export function speciesSourceId(id) { return SPECIES_SOURCE[id] || id; }
// 3장 검열관 몸은 흰 법복이 텍스처에 이미 그려져 있어, 원령의 반투명·청색 발광(ghostly)을 물려받으면 무늬가 하얗게 날아간다 — 불투명으로 둔다.
// 4장 수부·아귀도 원령·해골 망령 자리(ch4_drowned_drift·ch4_lurer_glim)를 맡지만 불투명한 Tripo 몸이다.
// 6장 떠도는 승객 잔향(원령 자리)도 불투명한 Tripo 몸이다(얼굴의 청록 발광은 텍스처에 있다). 7장 굽쇠 주술사의 해골 망령·원령 자리도 같다.
const OPAQUE_SPIRIT_BODIES = new Set(['Ch3_Censor', 'Ch3_CensorTome', 'Ch4_DrownedDrift', 'Ch4_LurerGlim', 'Ch6_PassengerDrift', 'Ch7_TunerEcho', 'Ch7_TunerDrift']);
// 몸 색조(enemies.js lerp 0.32)만 원본과 다르게 두는 갈래(null = 색조 없음). 심연 폭탄·주시자의 분홍·보라 색조가 남색 아귀 몸을
// 보라로 물들였다 — 붉은 색조도 남색과 섞이면 보라가 되어, 경고등 아귀는 색조를 빼고 의상의 붉은 발광으로 경고한다. 빛주머니 아귀는 청록.
// 수치·행동은 그대로다.
// 5장 봉화 닌자(심연 폭탄 분홍)·주술사 갈래(주시자 연보라·부족 주술사 살구)·6장 길 잃은 승객(서리 하늘색)은 원본 색조가 보라·금, 회색·청록
// 몸을 탁하게 물들여 색조를 뺀다(봉화 닌자는 의상의 붉은 금 발광으로 자폭을 경고한다). 7장 명부 낭송 주술사도 해골 사제의 연두 색조가
// 바랜 황동·석회 몸을 초록으로 물들여 뺀다(폭음 시민은 폭탄 슬라임의 금빛 색조가 황동과 맞아 그대로 둔다).
const BODY_TINTS = Object.freeze({ ch4_lurer_bomb: null, ch4_lurer_seer: '#a8f0e4', ch5_dawnninja_flare: null, ch5_seer: null, ch5_seer_herald: null, ch6_passenger_lost: null, ch7_tuner_cantor: null });
for (const [id, [sourceId, name, model]] of Object.entries(CHAPTER_SPECIES_DEFS)) {
  ENEMIES[id] = { ...ENEMIES[sourceId], name, model };
  if (OPAQUE_SPIRIT_BODIES.has(model)) delete ENEMIES[id].ghostly;
  if (id in BODY_TINTS) { if (BODY_TINTS[id]) ENEMIES[id].tint = BODY_TINTS[id]; else delete ENEMIES[id].tint; }
}
// 1~7장 중간·최종 보스가 부르는 지원병도 그 장 전용 몸으로 나온다(수치는 같은 원본 복사본). 5장 = 새벽 가면 닌자, 6장 = 귀환 열차 승객, 7장 = 해골 시민.
for (const rank of ['captain', 'warden', 'midboss', 'finalboss']) {
  for (const [prefix, chapterId] of [['garden', 1], ['forge', 2], ['frost', 3], ['tide', 4], ['crown', 5], ['homecoming', 6], ['belltower', 7]]) {
    const def = ENEMIES[`${prefix}_${rank}`];
    if (def && CHAPTER_SPECIES[chapterId][def.summon]) def.summon = CHAPTER_SPECIES[chapterId][def.summon];
  }
}
