import { ENEMIES, stageDef } from './stages.js';
import { EXPEDITION_ITEMS, EXPEDITION_SETS } from './expedition-items.js';
import { ENCOUNTER_ART, RIFT_ART } from './encounter-art.js';

export const MATERIALS = [
  { id: 'glass_leaf', name: '유리 잎', description: '유리 정원에서 얻는 바람의 결정' },
  { id: 'ember_core', name: '잿불 핵', description: '잿불 금고의 제련 재료' },
  { id: 'star_dust', name: '별가루', description: '별빛 서고의 얼음 결정' },
];
export const CONSUMABLES = [
  { id: 'hp_tonic', name: '회복 물약', description: '최대 체력 35% 회복', effect: { heal: 0.35 } },
  { id: 'overdrive', name: '과충전 물약', description: '12초 동안 공격력 25% 증가', effect: { atk: 0.25, duration: 12 } },
  { id: 'aegis', name: '수호 물약', description: '12초 동안 받는 피해 30% 감소', effect: { reduction: 0.3, duration: 12 } },
];
// Uses the existing enhancement inventory keys (STONE_KEY tiers 1/2/3).
export const MATERIAL_REFINING = [
  { id: 'glass_leaf', name: '강화석 정련', gold: 120, stones: 5 },
  { id: 'ember_core', name: '상급 강화석 정련', gold: 240, stones2: 2 },
  { id: 'star_dust', name: '전설 강화석 정련', gold: 360, stones3: 1 },
];
const dungeon = (id, name, theme, ch, minLevel, material, description, options = {}) => {
  const base = stageDef(ch, 1);
  return { id, name, theme, minLevel, energy: 4, description, ...options,
    stage: { ...base, theme, code: id, name, title: name, scale: 1 + (minLevel - 1) * 0.18, energy: 4, recPower: 2600 + (minLevel - 1) * 450,
      waves: base.waves.slice(0, 2).map(w => w.slice(0, 9)), objective: options.objective || description,
      encounter: { ...base.encounter, ...(options.bossPattern ? { pattern: [...options.bossPattern] } : {}) } },
    rewards: { gold: 280 + minLevel * 80, xp: 80 + minLevel * 20, materials: { [material]: 3 }, consumables: { hp_tonic: 1 } } };
};
const BASE_DUNGEONS = [
  dungeon('glass_garden', '유리 정원', 'garden', 1, 1, 'glass_leaf', '정원의 망령을 정화하고 유리 잎을 회수하세요.', {
    art: '/img/expansion/glass_garden.webp', accent: '#9be1ba', subtitle: 'GLASS CONSERVATORY',
    objective: '보물방 1곳에서 적 처치 후 중심 2초 공명 → 모든 구역 정화 → 정원의 수호자 처치',
    tactic: `옆길 보물방의 적을 처치하고 제단 중심의 빛 안에서 2초간 공명하세요. 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.garden_captain.tactic}`,
  }),
  dungeon('ember_vault', '잿불 금고', 'forge', 2, 2, 'ember_core', '제련소의 오크를 돌파하고 잿불 핵을 확보하세요.', {
    art: '/img/expansion/ember_vault.webp', accent: '#ffad6e', subtitle: 'EMBER TREASURY',
    objective: '정예방 1곳의 증원 각 2회 격파 → 모든 구역 정화 → 금고 수호자 처치',
    tactic: `정예방의 적과 2회 증원을 격파하면 보스 봉인이 풀립니다. ${ENEMIES.forge_captain.tactic}`,
  }),
  dungeon('star_archive', '별빛 서고', 'frost', 3, 3, 'star_dust', '얼어붙은 서고의 수호자를 물리치세요.', {
    art: '/img/expansion/star_archive.webp', accent: '#9bbdff', subtitle: 'ASTRAL ARCHIVE',
    objective: '모든 구역 정화 → 별빛 서고 수호자 처치',
    tactic: `긴 서가의 원거리 수호자를 먼저 격파하고 모든 구역을 정화하세요. ${ENEMIES.frost_captain.tactic}`,
  }),
  dungeon('bellfall_crypt', '종락의 지하 회랑', 'garden', 1, 2, 'glass_leaf', '멈춘 종 아래의 회랑을 열고, 시간을 삼킨 수호자를 깨우세요.', {
    art: RIFT_ART.glass_hour_sovereign, accent: '#86e4d0', subtitle: 'BELLFALL CRYPT',
    supportCasting: Object.freeze({ enemyId: 'glass_tollmage', windupSeconds: .9,
      healCue: '치유 준비 · 근접·강타로 중단', summonCue: '소환 준비 · 근접·강타로 중단' }),
    objective: '세 개의 종문을 순서대로 공명시키고 모든 구역을 정화한 뒤 시계유리의 주권자를 쓰러뜨리세요.',
    tactic: `각 종문의 적을 처치한 뒤 1번 → 2번 → 3번 순서로 중심의 빛 안에서 각각 연속 2초간 공명하세요. 순서가 아닌 종문은 기다리며, 종문 3곳과 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.glass_hour_sovereign.tactic}`,
    bossEnemy: 'glass_hour_sovereign', bossHp: 14500, bossName: '시계유리의 주권자', rosterMode: 'bellfall',
    roster: { trash: ['glass_shardling', 'bell_wisp', 'skel_shield', 'bomb_slime', 'glass_shardling', 'bone_orc'], ranged: ['glass_tollmage', 'ghost_skull', 'skel_priest'], elite: ['glass_warden', 'elite_bone_lord', 'elite_wraith'] },
  }),
  dungeon('cinder_tide_lock', '재의 밀물 수문', 'forge', 2, 2, 'ember_core', '용광로와 바다가 맞닿은 수문에서 꺼지지 않는 불씨를 회수하세요.', {
    art: ENCOUNTER_ART.boss_cinder_chain_executor, accent: '#ff9b64', subtitle: 'CINDER TIDE LOCK',
    objective: '정예방 2곳의 증원 각 2회 격파 → 냉각 밸브 2개 순서대로 개방 → 모든 구역 정화 → 쇠사슬의 집행자 처치',
    tactic: `1번 서쪽 수문 → 2번 동쪽 수문의 적과 각 2회 증원을 처치하세요. 붉은 과열 띠는 1.4초 예고 뒤 피해를 주며 매 분출 뒤 좌우가 바뀝니다. 반대편 청록 조작판에서 공격하지 않고 2초 유지하면 밸브가 열립니다. 이탈·피격·일시정지는 조작을 중단하며 다시 시도할 수 있습니다. ${ENEMIES.cinder_chain_executor.tactic}`,
    bossEnemy: 'cinder_chain_executor', bossHp: 15800, bossName: '쇠사슬의 집행자', rosterMode: 'cinderlock',
    roster: { trash: ['cinderling', 'chain_forger', 'orc_blob', 'bomb_imp', 'cinderling', 'imp'], ranged: ['ember_scribe', 'hywirl', 'armabee'], elite: ['slag_colossus', 'elite_orc_chief', 'elite_bluedemon'] },
  }),
  dungeon('nightglass_observatory', '밤유리 관측소', 'frost', 3, 3, 'star_dust', '거꾸로 흐르는 별빛 너머로 사라진 귀환 좌표의 흔적이 남아 있습니다.', {
    art: ENCOUNTER_ART.boss_nightglass_archivist, accent: '#9ed5ff', subtitle: 'NIGHTGLASS OBSERVATORY',
    objective: '기록 3장 순서대로 복원 → 모든 구역 정화 → 밤유리의 기록관 처치',
    tactic: `적을 처치한 뒤 기록대 앞 빛 안에서 행동 없이 2초 유지하세요. 출발 좌표 1번 → 잃어버린 항로 2번 → 귀환 좌표 3번 순서입니다. 이탈·공격·회피·피격·일시정지하면 유지 시간이 초기화됩니다. ${ENEMIES.nightglass_archivist.tactic}`,
    bossEnemy: 'nightglass_archivist', bossHp: 17200, bossName: '밤유리의 기록관', rosterMode: 'nightglass',
    roster: { trash: ['nightglass_page', 'frost_mirror', 'ghost', 'skel_rogue', 'frost_mirror', 'golem_guard'], ranged: ['archive_scribe', 'ghost_skull', 'skel_mage'], elite: ['archive_warden', 'elite_yeti', 'elite_golem'] },
  }),
  dungeon('eclipse_hydra_vault', '일식의 심연 수문', 'tide', 4, 1, 'glass_leaf', '검은 파도가 잠시 멈춘 수문에는 세 머리의 맹세가 남아 있습니다.', {
    art: ENCOUNTER_ART.boss_obsidian_hydra, accent: '#72e0d3', subtitle: 'ECLIPSE HYDRA VAULT',
    objective: '역류 밸브 세 개를 순서대로 잠그고 모든 구역을 정화한 뒤 흑요의 삼두룡을 쓰러뜨리세요.',
    tactic: `각 밸브 구역의 적을 처치한 뒤 1번 → 2번 → 3번 순서로 청록 빛 안에서 각각 연속 2초간 밸브를 잠그세요. 순서가 아닌 밸브는 기다리며, 밸브 3개와 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.obsidian_hydra.tactic}`,
    bossEnemy: 'obsidian_hydra', bossHp: 18800, bossName: '흑요의 삼두룡', rosterMode: 'eclipse',
    roster: { trash: ['eclipse_scalelet', 'glass_shardling', 'bomb_abyss', 'eclipse_tidecaller', 'squidle', 'blob_spiky'], ranged: ['abyss_seer', 'eclipse_tidecaller', 'glub'], elite: ['hydra_scaleguard', 'elite_dragonling', 'elite_golem'] },
  }),
  dungeon('ashforge_catacomb', '재벼림 지하 제련소', 'forge', 2, 2, 'ember_core', '꺼지지 않는 망치 소리를 따라가 재벼림의 심장을 회수하세요.', {
    art: ENCOUNTER_ART.boss_ash_colossus, accent: '#ff9b66', subtitle: 'ASHFORGE CATACOMB',
    objective: '과열 용광로 4곳을 순서대로 식히고 모든 구역을 정화한 뒤 잿빛 재벼림 거수를 쓰러뜨리세요.',
    tactic: `1번 → 2번 → 3번 → 4번 용광로 구역의 적을 처치하세요. 붉은 과열 띠는 1.4초 예고 뒤 피해를 주며 매 분출 뒤 좌우가 바뀝니다. 반대편 청록 조작판에서 공격하지 않고 2초 유지하면 용광로가 식습니다. 이탈·피격·일시정지는 조작을 중단하며 다시 시도할 수 있습니다. 용광로 4곳과 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.ash_colossus.tactic}`,
    bossEnemy: 'ash_colossus', bossHp: 20400, bossName: '잿빛 재벼림 거수', rosterMode: 'ashforge',
    roster: { trash: ['ash_chainling', 'chain_forger', 'bomb_imp', 'ash_smith', 'orc_blob', 'cinderling'], ranged: ['ember_scribe', 'ash_smith', 'tribal_shaman'], elite: ['foundry_bulwark', 'slag_colossus', 'elite_orc_chief'] },
  }),
  dungeon('astral_leviathan_spire', '성운의 레비아탄 첨탑', 'frost', 3, 3, 'star_dust', '별의 잔해가 쌓인 첨탑에서 귀환 좌표를 삼킨 레비아탄을 추적하세요.', {
    art: ENCOUNTER_ART.boss_astral_leviathan, accent: '#9ccaff', subtitle: 'ASTRAL LEVIATHAN SPIRE',
    objective: '별자리 4개 순서대로 복원 → 모든 구역 정화 → 성운의 레비아탄 처치',
    tactic: `적을 처치한 뒤 1번→2번→3번→4번 조율판의 모래시계 단서를 1초 읽고, 같은 문자·도형 판에서 1초 유지하세요. 오답은 판 밖에서 재시도하며 공격·회피·피격·전투 재개 때 현재 선택이 초기화됩니다. 별자리 4개 순서대로 복원하고 모든 구역을 정화해야 보스 봉인이 열립니다. ${ENEMIES.astral_leviathan.tactic}`,
    bossEnemy: 'astral_leviathan', bossHp: 22400, bossName: '성운의 레비아탄', rosterMode: 'astral',
    roster: { trash: ['astral_pagelet', 'nightglass_page', 'frost_mirror', 'astral_orbitling', 'ghost_skull', 'star_wisp'], ranged: ['archive_scribe', 'astral_pagelet', 'skel_mage'], elite: ['celestial_warden', 'archive_warden', 'elite_wraith'] },
  }),
  dungeon('verdigris_sanctum', '녹청의 성역', 'garden', 4, 4, 'glass_leaf', '잠든 성역의 뿌리 심장에 녹청의 수호자가 깃들어 있습니다.', {
    art: ENCOUNTER_ART.boss_verdigris_sentinel, accent: '#72e6ae', subtitle: 'VERDIGRIS SANCTUM',
    objective: '뿌리 문양이 켜진 생명 제단 세 개를 순서대로 정화하고 모든 구역을 정화한 뒤 녹청의 성역 거수를 쓰러뜨리세요.',
    tactic: `각 제단 구역의 적을 처치한 뒤 1번 → 2번 → 3번 순서로 초록 빛 안에서 각각 연속 2초간 정화하세요. 제단 순서는 길 순서와 다릅니다. 정화됐지만 차례가 아닌 보라 빛 제단 중심에 1초 머물면 포자가 터져 피해를 받습니다. 제단 3곳과 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.verdigris_sentinel.tactic}`,
    bossEnemy: 'verdigris_sentinel', bossHp: 23800, bossName: '녹청의 성역 거수', rosterMode: 'verdigris',
    roster: { trash: ['mossbound_scout', 'verdigris_rootcaller', 'blob_green', 'mossbound_scout', 'bomb_slime', 'bell_wisp'], ranged: ['verdigris_rootcaller', 'skel_priest', 'glub'], elite: ['ironbark_bulwark', 'glass_warden', 'elite_golem'] },
  }),
  dungeon('sable_mirage_basin', '흑사막 환영 분지', 'crown', 5, 5, 'star_dust', '거울 모래폭풍 속 왕좌에 흑사막 환영 여왕이 기다립니다.', {
    art: ENCOUNTER_ART.boss_sable_mirage_empress, accent: '#d9a1ff', subtitle: 'SABLE MIRAGE BASIN',
    objective: '가짜 왕좌 세 개를 부숴 환영 여왕의 본체를 드러내고 모든 구역을 정화한 뒤 흑사막 환영 여왕을 쓰러뜨리세요.',
    tactic: `각 왕좌 구역의 적을 처치한 뒤 보라 모래시계가 멈춘 동안 왕좌를 다섯 차례 공격해 부수세요. 모래시계가 도는 동안 때리면 모래가 반사되어 피해를 받습니다. 1번·2번·3번 왕좌는 어느 순서로 부숴도 됩니다. 왕좌 3개와 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.sable_mirage_empress.tactic}`,
    bossEnemy: 'sable_mirage_empress', bossHp: 25800, bossName: '흑사막 환영 여왕', rosterMode: 'sable',
    roster: { trash: ['mirage_hound', 'sandglass_seer', 'ninja', 'mirage_hound', 'bomb_abyss', 'squidle'], ranged: ['sandglass_seer', 'abyss_seer', 'glub'], elite: ['mirage_colossus', 'elite_bluedemon', 'elite_wraith'] },
  }),
  dungeon('comet_bastion', '혜성의 유성 요새', 'frost', 6, 6, 'ember_core', '부서진 혜성 요새에는 유성 기사단장의 맹세가 남아 있습니다.', {
    art: ENCOUNTER_ART.boss_comet_bastion, accent: '#82bfff', subtitle: 'COMET BASTION',
    objective: '궤도 고리 네 개를 정렬해 혜성 요새의 봉인을 흔들고 모든 구역을 정화한 뒤 혜성의 유성 기사단장을 쓰러뜨리세요.',
    tactic: `각 고리 구역의 적을 처치한 뒤 궤도 위 룬석을 몸으로 밀어 별 표식에 맞추면 고리가 정렬됩니다. 지나치면 반대편에서 되밀어야 합니다. 정렬 중 유성은 평소 푸른 궤도선 바깥에 떨어져 안쪽이 안전하지만, 붉은 원이 안쪽을 덮는 중심 유성 예고가 뜨면 푸른 선 밖으로 피하세요. 1번·2번·3번·4번 고리는 어느 순서로 정렬해도 됩니다. 고리 4개와 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.comet_bastion.tactic}`,
    bossEnemy: 'comet_bastion', bossHp: 28200, bossName: '혜성의 유성 기사단장', rosterMode: 'comet',
    roster: { trash: ['comet_spark', 'comet_orbit_mote', 'astral_pagelet', 'comet_spark', 'ghost_skull', 'frost_mirror'], ranged: ['comet_orbit_mote', 'archive_scribe', 'astral_pagelet'], elite: ['comet_bastion_warden', 'celestial_warden', 'elite_yeti'] },
  }),
];

export const NEW_DUNGEONS = [
  dungeon('rootbound_grotto', '뿌리잠식 동굴', 'garden', 1, 3, 'glass_leaf', '뿌리 아래 잠든 샘을 되살리고 독성 포자를 걷어내세요.', {
    art: '/img/expansion/verdigris_sanctum.webp', accent: '#81dfa6', subtitle: 'ROOTBOUND GROTTO', rosterMode: 'rootbound',
    mechanic: { id: 'root_pulse', name: '뿌리 맥동', trigger: '포자 둥지를 먼저 파괴하면 안전한 샘이 열린다.', resolve: '샘 안에서 2초 유지하면 다음 구역의 맥동이 멈춘다.' },
    objective: '포자 둥지 2곳 파괴 → 샘 2곳 정화 → 모든 구역 정화 → 뿌리심장 수호자 처치',
    tactic: `포자 둥지를 먼저 끊고 샘 안에서 2초 유지하세요. 맥동하는 고리 바깥으로 이동한 뒤 빈틈에 반격하세요. ${ENEMIES.verdigris_sentinel.tactic}`,
    bossEnemy: 'verdigris_sentinel', bossHp: 24600, bossName: '뿌리심장 수호자',
    roster: { trash: ['mossbound_scout', 'blob_green', 'glass_shardling', 'bell_wisp', 'bomb_slime', 'mossbound_scout'], ranged: ['verdigris_rootcaller', 'glass_tollmage', 'skel_priest'], elite: ['ironbark_bulwark', 'glass_warden', 'elite_wraith'] },
    bossPattern: ['oath_tethers', 'oath_shelter', 'summon'],
  }),
  dungeon('hollowbell_arboretum', '공명목 수목원', 'garden', 1, 4, 'glass_leaf', '울리지 않는 나무종의 뿌리를 따라 잃어버린 공명편을 회수하세요.', {
    art: '/img/expansion/glass_garden.webp', accent: '#a4e8b9', subtitle: 'HOLLOWBELL ARBORETUM', rosterMode: 'hollowbell',
    mechanic: { id: 'bell_echo', name: '공명 메아리', trigger: '세 개의 공명 씨앗을 같은 순서로 깨운다.', resolve: '오답 씨앗은 잠시 봉인되며 다시 시도할 수 있다.' },
    objective: '공명 씨앗 3개 순서대로 활성화 → 모든 구역 정화 → 공명목의 파수자 처치',
    tactic: `씨앗을 1번부터 3번 순서로 활성화하세요. 오답 뒤에는 안전 고리 안에서 다음 신호를 기다리세요. ${ENEMIES.glass_hour_sovereign.tactic}`,
    bossEnemy: 'glass_hour_sovereign', bossHp: 25200, bossName: '공명목의 파수자',
    roster: { trash: ['bell_wisp', 'glass_shardling', 'ghost', 'skel_rogue', 'bomb_slime', 'bone_orc'], ranged: ['glass_tollmage', 'verdigris_rootcaller', 'ghost_skull'], elite: ['glass_warden', 'ironbark_bulwark', 'elite_wraith'] },
    bossPattern: ['bell_toll', 'bell_clap', 'bell_toll'],
  }),
  dungeon('slagwater_foundry', '슬래그워터 제련소', 'forge', 2, 5, 'ember_core', '식지 않는 슬래그 강을 건너 제련소의 압력핵을 차단하세요.', {
    art: '/img/expansion/ashforge_catacomb.webp', accent: '#ff9e66', subtitle: 'SLAGWATER FOUNDRY', rosterMode: 'slagwater',
    mechanic: { id: 'slag_pressure', name: '슬래그 압력', trigger: '압력 밸브를 순서대로 끊으면 과열 수치가 내려간다.', resolve: '붉은 띠가 사라진 뒤 다음 밸브를 2초 유지한다.' },
    objective: '압력 밸브 3개 순서대로 차단 → 모든 구역 정화 → 슬래그 압력왕 처치',
    tactic: `붉은 띠가 지나간 뒤 청록 밸브에서 2초 유지하세요. 밸브를 건너뛰면 압력이 다시 오릅니다. ${ENEMIES.ash_colossus.tactic}`,
    bossEnemy: 'ash_colossus', bossHp: 26800, bossName: '슬래그 압력왕',
    roster: { trash: ['ash_chainling', 'cinderling', 'chain_forger', 'bomb_imp', 'orc_blob', 'ash_chainling'], ranged: ['ash_smith', 'ember_scribe', 'tribal_shaman'], elite: ['foundry_bulwark', 'slag_colossus', 'elite_orc_chief'] },
    bossPattern: ['kiln_vents', 'kiln_hammer', 'dash'],
  }),
  dungeon('emberwake_drydock', '불씨항 건선거', 'forge', 2, 6, 'ember_core', '불씨항의 봉인된 건선거에서 도망친 제련 짐승을 추적하세요.', {
    art: '/img/expansion/cinder_tide_lock.webp', accent: '#ffb16b', subtitle: 'EMBERWAKE DRYDOCK', rosterMode: 'emberwake',
    mechanic: { id: 'furnace_tide', name: '용광로 밀물', trigger: '두 개의 배수문을 열어 불길의 방향을 바꾼다.', resolve: '배수문 반대편의 안전 구역에서 다음 파도를 기다린다.' },
    objective: '배수문 2개 개방 → 증원 2회 격파 → 모든 구역 정화 → 불씨항의 집행자 처치',
    tactic: `파도가 지나간 통로로 이동하고 배수문 반대편에서 조작하세요. 증원을 모두 끊어야 보스 봉인이 열립니다. ${ENEMIES.cinder_chain_executor.tactic}`,
    bossEnemy: 'cinder_chain_executor', bossHp: 27600, bossName: '불씨항의 집행자',
    roster: { trash: ['cinderling', 'chain_forger', 'bomb_imp', 'ash_chainling', 'imp', 'orc_blob'], ranged: ['ember_scribe', 'ash_smith', 'hywirl'], elite: ['slag_colossus', 'foundry_bulwark', 'elite_bluedemon'] },
    bossPattern: ['tide_sweep', 'tide_undertow', 'summon'],
  }),
  dungeon('aurora_icewell', '오로라 빙정호', 'frost', 3, 7, 'star_dust', '빙정호에 갇힌 오로라 조각을 회수하고 얼음의 역류를 멈추세요.', {
    art: '/img/expansion/nightglass_observatory.webp', accent: '#9edbff', subtitle: 'AURORA ICEWELL', rosterMode: 'aurora',
    mechanic: { id: 'aurora_retrace', name: '오로라 역행', trigger: '방금 지나온 안전 지점을 역순으로 다시 확인한다.', resolve: '기록된 원이 터지기 전 다음 빛점으로 이동한다.' },
    objective: '오로라 기록 3개 역순 복원 → 모든 구역 정화 → 빙정호의 기록관 처치',
    tactic: `3번에서 1번으로 역순 복원하세요. 기록된 원은 잠시 뒤 폭발하므로 이전 자리로 되돌아가지 마세요. ${ENEMIES.nightglass_archivist.tactic}`,
    bossEnemy: 'nightglass_archivist', bossHp: 28600, bossName: '빙정호의 기록관',
    roster: { trash: ['nightglass_page', 'frost_mirror', 'ghost', 'astral_orbitling', 'skel_shield', 'golem_guard'], ranged: ['archive_scribe', 'astral_pagelet', 'skel_mage'], elite: ['archive_warden', 'celestial_warden', 'elite_golem'] },
    bossPattern: ['archive_retrace', 'archive_hourglass', 'soulrain'],
  }),
  dungeon('crownfall_glacier', '왕관붕괴 빙하', 'frost', 3, 8, 'star_dust', '빙하에 박힌 왕관 파편을 모아 거짓 왕좌의 신호를 끊으세요.', {
    art: '/img/expansion/sable_mirage_basin.webp', accent: '#c4d8ff', subtitle: 'CROWNFALL GLACIER', rosterMode: 'crownfall',
    mechanic: { id: 'crown_verdict', name: '빙하의 판결', trigger: '두 개의 낙인을 바깥쪽 안전 지점으로 유도한다.', resolve: '중앙 절단선이 사라진 후 왕관 파편을 회수한다.' },
    objective: '왕관 파편 2개 회수 → 모든 구역 정화 → 빙하의 환영 여왕 처치',
    tactic: `낙인이 생기면 중앙 절단선에서 벗어나고, 판결이 끝난 뒤 파편을 회수하세요. ${ENEMIES.sable_mirage_empress.tactic}`,
    bossEnemy: 'sable_mirage_empress', bossHp: 29800, bossName: '빙하의 환영 여왕',
    roster: { trash: ['mirage_hound', 'frost_mirror', 'ninja', 'nightglass_page', 'bomb_abyss', 'ghost'], ranged: ['sandglass_seer', 'archive_scribe', 'abyss_seer'], elite: ['mirage_colossus', 'archive_warden', 'elite_wraith'] },
    bossPattern: ['crown_orbit', 'crown_verdict', 'fan'],
  }),
];

// 기존 12곳 공개 계약은 유지하고, 확장 통합 경로는 별도 카탈로그로 노출한다.
export const DUNGEONS = Object.freeze(BASE_DUNGEONS);
export const ALL_DUNGEONS = Object.freeze([...BASE_DUNGEONS, ...NEW_DUNGEONS]);

export const DUNGEON_MECHANICS = Object.freeze(Object.fromEntries(ALL_DUNGEONS.map(dungeon => [dungeon.id, dungeon.mechanic || null])));
export const DUNGEON_BOSS_PATTERNS = Object.freeze(Object.fromEntries(ALL_DUNGEONS.map(dungeon => [dungeon.id, Object.freeze([...(dungeon.bossPattern || dungeon.stage.encounter?.pattern || [])])] )));
export const JOBS = [
  { id: 'guardian', name: '수호 기사', heroId: 'knight', baseHero: 'knight', questId: 'first_oath', description: '기사 기반 · 생존과 보호에 특화' },
  { id: 'ranger', name: '바람 추적자', heroId: 'rogue', baseHero: 'rogue', questId: 'garden_scout', description: '도적 기반 · 민첩한 공격에 특화' },
];
export const RECIPES = [
  ...EXPEDITION_ITEMS.map(item => ({ id: `craft_${item.id}`, name: `${item.name} 제작`, description: '재료로 지정 장비를 확정 제작합니다.', itemId: item.id, gold: 12500, materials: { [EXPEDITION_SETS.find(s => s.id === item.set).material]: 9 } })),
  { id: 'storm_blade', name: '뇌명검 제작', itemId: 'w_storm', gold: 12500, materials: { glass_leaf: 9 } },
  { id: 'phoenix_blade', name: '불사조의 검 제작', itemId: 'w_phoenix', gold: 12500, materials: { ember_core: 12 } },
  { id: 'frost_blade', name: '한설검 제작', itemId: 'w_rime', gold: 12500, materials: { star_dust: 12 } },
  { id: 'brew_tonic', name: '회복 물약 제조', gold: 60, materials: { glass_leaf: 1 }, consumables: { hp_tonic: 2 } },
  { id: 'brew_overdrive', name: '과충전 물약 제조', gold: 90, materials: { ember_core: 1 }, consumables: { overdrive: 2 } },
  { id: 'brew_aegis', name: '수호 물약 제조', gold: 90, materials: { star_dust: 1 }, consumables: { aegis: 2 } },
];
const quest = (id, name, stat, target, rewards) => ({ id, name, description: name, stat, target, rewards });
export const EXPEDITION_QUESTS = [
  quest('first_oath', '탐험가의 서약 보상 받기', 'welcome', 1, { gold: 300, xp: 30, consumables: { hp_tonic: 2 } }),
  quest('garden_scout', '유리 정원 1회 클리어', 'glass_garden', 1, { xp: 60, materials: { glass_leaf: 3 } }),
  quest('campaign_scout', '캠페인 첫 승리', 'campaignWins', 1, { gold: 400, xp: 60 }),
  quest('garden_keeper', '유리 정원 3회 클리어', 'glass_garden', 3, { gold: 600, xp: 80 }),
  quest('ember_keeper', '잿불 금고 1회 클리어', 'ember_vault', 1, { xp: 90, materials: { ember_core: 3 } }),
  quest('star_keeper', '별빛 서고 1회 클리어', 'star_archive', 1, { xp: 100, materials: { star_dust: 3 } }),
  quest('first_craft', '장비 또는 물약 1회 제작', 'crafts', 1, { gold: 500, xp: 50 }),
  quest('field_medic', '전투에서 소모품 3회 사용', 'consumed', 3, { xp: 70, consumables: { aegis: 2 } }),
  quest('arena_debut', 'AI 결투장 첫 승리', 'arenaWins', 1, { gold: 300, xp: 60 }),
  quest('arena_veteran', 'AI 결투장 5회 승리', 'arenaWins', 5, { gold: 700, xp: 120 }),
  quest('expedition_veteran', '탐험 던전 10회 클리어', 'dungeonWins', 10, { gold: 1200, xp: 180 }),
];
export const ARENA_RIVALS = [
  { id: 'rookie', name: '연습 기사', heroId: 'knight', minLevel: 1, rating: 100, scale: 0.9, rank: 'I', description: '방패와 강타의 빈틈을 찾고 첫 승리를 기록하세요.' },
  { id: 'duelist', name: '바람의 결투가', heroId: 'rogue', minLevel: 2, rating: 300, scale: 1.25, rank: 'II', description: '빠른 돌진 이후의 공격 창을 읽어 측면을 잡으세요.' },
  { id: 'champion', name: '서리의 챔피언', heroId: 'mage', minLevel: 4, rating: 600, scale: 1.7, rank: 'III', description: '서리 경고를 읽고 탄막 사이의 짧은 틈을 좁히세요.' },
  { id: 'thunder_lancer', name: '검은 번개의 창', heroId: 'knight', minLevel: 5, rating: 900, scale: 1.9, rank: 'IV', description: '번개 창이 땅에 박힌 순간, 창끝 바깥으로 파고드세요.' },
  { id: 'sunwarden', name: '태양의 수문장', heroId: 'barbarian', minLevel: 6, rating: 1250, scale: 2.05, rank: 'V', description: '빛의 고리 바깥에서 강타를 피하고 회복 창을 끊으세요.' },
  { id: 'void_oracle', name: '공허유리의 예언자', heroId: 'mage', minLevel: 7, rating: 1650, scale: 2.2, rank: 'VI', description: '보랏빛 파편이 멈춘 짧은 순간에만 안전하게 접근하세요.' },
].map(r => ({ ...r, portrait: r.portrait || ENCOUNTER_ART[`arena_${r.id}`], description: r.description || 'AI 상대 연습 결투 · 에너지 무료', energy: 0, stage: { ...stageDef(1, 1), code: `arena_${r.id}`, name: r.name, scale: r.scale }, rewards: { gold: 60, xp: 25, rating: 15 } }));
export const accountLevelXp = level => 150 + (level - 1) * 75;
