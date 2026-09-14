import { stageDef } from './stages.js';
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
    stage: { ...base, code: id, name, title: name, scale: 1 + (minLevel - 1) * 0.18, energy: 4, recPower: 2600 + (minLevel - 1) * 450,
      waves: base.waves.slice(0, 2).map(w => w.slice(0, 9)), objective: description },
    rewards: { gold: 280 + minLevel * 80, xp: 80 + minLevel * 20, materials: { [material]: 3 }, consumables: { hp_tonic: 1 } } };
};
export const DUNGEONS = [
  dungeon('glass_garden', '유리 정원', 'garden', 1, 1, 'glass_leaf', '정원의 망령을 정화하고 유리 잎을 회수하세요.', {
    art: '/img/expansion/glass_garden.webp', accent: '#9be1ba', subtitle: 'GLASS CONSERVATORY',
    objective: '갈림길을 돌파하고 정원의 수호자를 정화하세요.', tactic: '정화 후 옆길 제단 중심에 2초 머물러 유리 잎을 회수하고 수호자를 처치하세요.',
  }),
  dungeon('ember_vault', '잿불 금고', 'forge', 2, 2, 'ember_core', '제련소의 오크를 돌파하고 잿불 핵을 확보하세요.', {
    art: '/img/expansion/ember_vault.webp', accent: '#ffad6e', subtitle: 'EMBER TREASURY',
    objective: '좁은 제련 통로에서 화염 경고를 피하세요.', tactic: '좁은 제련로에서 두 차례 증원을 격파하고 과열 경고선을 피해 금고 수호자를 처치하세요.',
  }),
  dungeon('star_archive', '별빛 서고', 'frost', 3, 3, 'star_dust', '얼어붙은 서고의 수호자를 물리치세요.', {
    art: '/img/expansion/star_archive.webp', accent: '#9bbdff', subtitle: 'ASTRAL ARCHIVE',
    objective: '서리 기록을 피해 별빛 지식을 되찾으세요.', tactic: '긴 서가의 원거리 수호자를 먼저 격파하고 지연 폭발을 피해 기록관을 처치하세요.',
  }),
  dungeon('bellfall_crypt', '종락의 지하 회랑', 'garden', 1, 2, 'glass_leaf', '멈춘 종 아래의 회랑을 열고, 시간을 삼킨 수호자를 깨우세요.', {
    art: RIFT_ART.glass_hour_sovereign, accent: '#86e4d0', subtitle: 'BELLFALL CRYPT',
    objective: '세 개의 종문을 순서대로 공명시키고 시계유리의 주권자를 쓰러뜨리세요.',
    tactic: '종문이 켜진 순서를 기억해 반대쪽 안전 지대로 이동하세요. 마지막 공명 뒤에만 긴 반격 창이 열립니다.',
    bossEnemy: 'glass_hour_sovereign', bossHp: 14500, bossName: '시계유리의 주권자', rosterMode: 'bellfall',
    roster: { trash: ['glass_shardling', 'bell_wisp', 'skel_shield', 'bomb_slime', 'glass_shardling', 'bone_orc'], ranged: ['glass_tollmage', 'ghost_skull', 'skel_priest'], elite: ['glass_warden', 'elite_bone_lord', 'elite_wraith'] },
  }),
  dungeon('cinder_tide_lock', '재의 밀물 수문', 'forge', 2, 2, 'ember_core', '용광로와 바다가 맞닿은 수문에서 꺼지지 않는 불씨를 회수하세요.', {
    art: '/img/encounters/tide_midboss.webp', accent: '#ff9b64', subtitle: 'CINDER TIDE LOCK',
    objective: '수문 양쪽의 냉각 밸브를 지키고 쇠사슬의 집행자를 격파하세요.',
    tactic: '밸브가 번갈아 과열됩니다. 경고선 바깥에서 증원을 끊고, 망치가 떨어진 뒤 중앙을 가로지르세요.',
    bossEnemy: 'cinder_chain_executor', bossHp: 15800, bossName: '쇠사슬의 집행자', rosterMode: 'cinderlock',
    roster: { trash: ['cinderling', 'chain_forger', 'orc_blob', 'bomb_imp', 'cinderling', 'imp'], ranged: ['ember_scribe', 'hywirl', 'armabee'], elite: ['slag_colossus', 'elite_orc_chief', 'elite_bluedemon'] },
  }),
  dungeon('nightglass_observatory', '밤유리 관측소', 'frost', 3, 3, 'star_dust', '거꾸로 흐르는 별빛을 관측해 사라진 귀환 좌표를 복원하세요.', {
    art: '/img/encounters/frost_midboss.webp', accent: '#9ed5ff', subtitle: 'NIGHTGLASS OBSERVATORY',
    objective: '되감긴 기록 세 장을 복원하고 밤유리의 기록관을 잠재우세요.',
    tactic: '방금 지나온 세 자리가 역순으로 폭발합니다. 모래시계가 닫히기 전에 바깥 고리로 이동하세요.',
    bossEnemy: 'nightglass_archivist', bossHp: 17200, bossName: '밤유리의 기록관', rosterMode: 'nightglass',
    roster: { trash: ['nightglass_page', 'frost_mirror', 'ghost', 'skel_rogue', 'frost_mirror', 'golem_guard'], ranged: ['archive_scribe', 'ghost_skull', 'skel_mage'], elite: ['archive_warden', 'elite_yeti', 'elite_golem'] },
  }),
];
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
  { id: 'rookie', name: '연습 기사', heroId: 'knight', minLevel: 1, rating: 100, scale: 0.9 },
  { id: 'duelist', name: '바람의 결투가', heroId: 'rogue', minLevel: 2, rating: 300, scale: 1.25 },
  { id: 'champion', name: '서리의 챔피언', heroId: 'mage', minLevel: 4, rating: 600, scale: 1.7 },
].map(r => ({ ...r, portrait: ENCOUNTER_ART[`arena_${r.id}`], description: 'AI 상대 연습 결투 · 에너지 무료', energy: 0, stage: { ...stageDef(1, 1), code: `arena_${r.id}`, name: r.name, scale: r.scale }, rewards: { gold: 60, xp: 25, rating: 15 } }));
export const accountLevelXp = level => 150 + (level - 1) * 75;
