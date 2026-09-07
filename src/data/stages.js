import { stageStory } from './campaign-story.js';

// 지역별 맹세와 기믹은 모험 화면과 전투가 함께 사용한다.
export const CHAPTERS = [
  { id: 1, name: '잊힌 종의 정원', theme: 'garden', color: '#87cbb0', boss: 'garden_finalboss', tagline: '누군가 이름을 부르는 동안, 우리는 사라지지 않는다.', summary: '아르카의 이름이 새겨진 묘비에서 시작된 원정. 침묵한 종을 깨워 망각에 묶인 첫 왕을 찾는다.', oath: '잊힌 이름을 다시 부르겠다는 맹세', mechanic: { name: '종의 공명', description: '방 중앙에서 순서대로 퍼지는 고리의 경고를 확인하고 빛나는 띠 밖으로 피하세요.' } },
  { id: 2, name: '불씨 왕국의 용광로', theme: 'forge', color: '#ed925d', boss: 'forge_finalboss', tagline: '살아 돌아오라는 말이, 가장 오래 타는 불이다.', summary: '드라칸의 고향은 끝없는 노동에 갇혔다. 생명을 연료 삼는 용광로를 멈추고 빼앗긴 온기를 돌려준다.', oath: '온기를 빼앗지 않고 나누겠다는 맹세', mechanic: { name: '냉각로 과열', description: '가로와 세로의 세 화염 띠가 번갈아 솟습니다. 붉은 경고선 사이로 이동하세요.' } },
  { id: 3, name: '거꾸로 흐르는 서리 도서관', theme: 'frost', color: '#a3ceef', boss: 'frost_finalboss', tagline: '지워 버린 실패의 끝에서, 다른 내일을 읽는다.', summary: '리아의 잃어버린 제자와 쓰이지 않은 일기가 기다린다. 금지된 기록을 열어 순환의 기원을 추적한다.', oath: '아픈 진실도 지우지 않겠다는 맹세', mechanic: { name: '지연 기록', description: '발밑과 주변에 남은 원이 잠시 뒤 폭발하며 느려집니다. 기록된 자리에서 즉시 이동하세요.' } },
  { id: 4, name: '별이 잠긴 심해', theme: 'tide', color: '#65c5d1', boss: 'tide_finalboss', tagline: '돌아갈 곳은 땅이 아니라, 기다리는 사람이다.', summary: '카인이 잃어버린 항로를 따라 가라앉은 선단을 구한다. 서로의 이름으로 등대를 이어 해왕의 사슬을 끊는다.', oath: '붙잡지 않고 귀환을 믿겠다는 맹세', mechanic: { name: '밀물', description: '세 물결 띠가 방을 순서대로 휩쓸며 밀쳐 냅니다. 다음 경고선을 보고 빈 구역으로 이동하세요.' } },
  { id: 5, name: '새벽을 먹는 왕관', theme: 'crown', color: '#e0c184', boss: 'crown_finalboss', tagline: '세상을 구하기 위해, 너를 잃어야 한다는 거짓말.', summary: '네브의 기억을 노리는 왕관으로 향한다. 누군가의 희생에 기대는 승리 대신 함께 살아갈 내일을 선택한다.', oath: '한 사람의 짐을 함께 나누겠다는 맹세', mechanic: { name: '왕관의 심판', description: '대각선 십자 경고 뒤에 빛이 떨어집니다. 중앙의 작은 안전 원이나 십자 밖으로 피하세요.' } },
];
export const STAGES_PER_CHAPTER = 10;
const ROSTER = {
  garden: { trash: ['skel_minion', 'skel_rogue', 'ghost', 'bomb_slime', 'skel_shield', 'bone_orc'], ranged: ['skel_mage', 'ghost_skull', 'skel_priest'], elite: ['elite_skel_captain', 'elite_bone_lord', 'elite_wraith'] },
  forge: { trash: ['orc', 'orc_blob', 'tribal', 'cacto_wall', 'bomb_imp', 'imp'], ranged: ['hywirl', 'armabee', 'tribal_shaman'], elite: ['elite_orc_chief', 'elite_bluedemon'] },
  frost: { trash: ['ghost', 'skel_shield', 'blob_green', 'bone_orc', 'skel_rogue', 'golem_guard'], ranged: ['ghost_skull', 'skel_mage', 'skel_priest'], elite: ['elite_yeti', 'elite_wraith', 'elite_golem'] },
  tide: { trash: ['squidle', 'blob_pink', 'alien', 'mushnub', 'bomb_abyss', 'golem_guard'], ranged: ['glub', 'abyss_seer', 'armabee_evo'], elite: ['elite_golem', 'elite_mushroom_king', 'elite_dragonling'] },
  crown: { trash: ['ninja', 'skel_shield', 'alien', 'bomb_abyss', 'bone_orc', 'imp'], ranged: ['abyss_seer', 'tribal_shaman', 'hywirl'], elite: ['elite_bluedemon', 'elite_skel_captain', 'elite_dragonling'] },
};
const RANK_LABELS = { captain: '관문 대장', warden: '수문장', midboss: '중간 보스', finalboss: '최종 보스' };
export function stageDef(ch, st) {
  if (!Number.isInteger(ch) || !Number.isInteger(st) || ch < 1 || ch > CHAPTERS.length || st < 1 || st > STAGES_PER_CHAPTER) throw new RangeError('스테이지는 1-1부터 5-10까지입니다.');
  const chapter = CHAPTERS[ch - 1], idx = (ch - 1) * STAGES_PER_CHAPTER + st;
  const rank = st === 10 ? 'finalboss' : st === 5 ? 'midboss' : st === 3 || st === 7 ? 'warden' : 'captain';
  const boss = rank !== 'captain', scale = Math.pow(1.12, Math.min(idx - 1, 19)) * (1 + Math.max(0, idx - 20) * 0.045);
  const R = ROSTER[chapter.theme], scene = stageStory(ch, st), enemyId = chapter.theme + '_' + rank;
  const waves = [];
  for (let w = 0; w < (boss ? 2 : 3); w++) {
    const list = [], n = Math.min(28, 10 + Math.floor(idx * 0.6) + w * 4);
    for (let i = 0; i < n; i++) { const pool = i % 7 === 6 ? R.ranged : R.trash; list.push(pool[(i + w + st) % pool.length]); }
    for (let e = 0; e < 1 + Math.floor(w / 1.5) + (idx > 10 ? 1 : 0); e++) list.push(R.elite[(e + st + w) % R.elite.length]);
    waves.push(list);
  }
  const enemy = ENEMIES[enemyId];
  return {
    ch, st, idx, code: `${ch}-${st}`, title: scene.title, chapter, name: `${ch}-${st} · ${scene.title}`,
    boss, finale: ch === 5 && st === 10, waves, scale, energy: 6 + Math.floor(idx / 6),
    rosterFor: () => R, recPower: Math.floor(2600 * scale),
    encounter: { rank, label: RANK_LABELS[rank], name: enemy.name, enemyId, tactic: enemy.tactic },
    story: { opening: scene.opening, revelation: scene.revelation, aftermath: scene.aftermath },
    objective: `전투 방을 정리해 봉인을 해제하고 ${enemy.name} 처치`,
    rewards: { gold: Math.floor(400 * scale), exp: Math.floor(110 * scale), bp: 60 + (boss ? 60 : 0), firstGems: rank === 'finalboss' ? 300 : boss ? 150 : 60, dropChance: boss ? 1 : 0.6, stones: 2 + (boss ? 4 : 0) },
  };
}

// scale = 모델 배율(리그 기본 배율에 곱해짐). hp/atk 은 스테이지 scale 로 곱해진다.
// 기준: 1층 = 레벨 1 SSR 영웅(hp 2800 · atk 240 · def 40). 잡몹은 기본 콤보 2타, 엘리트 ~15타, 보스 ~45초.
// 잡몹 한 대 ≈ 최대 HP 의 0.7%, 원거리 1%, 폭탄·엘리트 2%, 보스 강타 2.5% — AUTO 가 한 층에 25~35% 를 잃는 수준 (적 위협 회전 2026-09-04: 이전 수치는 정액 방어 차감 때문에 잡몹 1타 = 1 피해였다)
export const ENEMIES = {
  // ================= 1장 · 어둠의 지하묘지 (언데드) =================
  skel_minion: { name: '해골 병사', model: 'Skeleton_Minion', hp: 490, atk: 20, spd: 4.6, range: 1.9, atkTime: 1.2, weapon: 'Skeleton_Blade', exp: 8, scale: 0.95, gold: 1 },
  skel_rogue:  { name: '해골 자객', model: 'Skeleton_Rogue', hp: 630, atk: 29, spd: 6.2, range: 2.0, atkTime: 0.8, weapon: 'Skeleton_Blade', exp: 12, scale: 0.95, dodge: 0.2, gold: 1 },
  skel_mage:   { name: '해골 주술사', model: 'Skeleton_Mage', hp: 525, atk: 29, spd: 3.0, range: 8.0, atkTime: 2.2, weapon: 'Skeleton_Staff', ranged: true, exp: 14, scale: 1.0, gold: 2, projColor: 0x60ff80 },
  ghost:       { name: '원령', model: 'Flying_Ghost', hp: 420, atk: 24, spd: 5.4, range: 2.1, atkTime: 1.1, exp: 11, scale: 1.25, gold: 1, ghostly: true },
  ghost_skull: { name: '해골 망령', model: 'Flying_Ghost_Skull', hp: 490, atk: 26, spd: 3.4, range: 8.5, atkTime: 2.0, ranged: true, exp: 15, scale: 1.2, gold: 2, ghostly: true, projColor: 0x80d0ff },
  blob_green:  { name: '부패 슬라임', model: 'Blob_GreenBlob', hp: 700, atk: 18, spd: 3.2, range: 1.7, atkTime: 1.4, exp: 9, scale: 1.0, gold: 1 },
  bone_orc:    { name: '뼈 오크', model: 'Big_Orc_Skull', hp: 1120, atk: 31, spd: 3.8, range: 2.2, atkTime: 1.5, exp: 15, scale: 1.0, armor: 0.15, gold: 2 },
  elite_skel_captain: { name: '해골 대장', model: 'Skeleton_Warrior', hp: 5600, atk: 51, spd: 3.6, range: 2.6, atkTime: 1.5, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', exp: 60, scale: 1.45, armor: 0.25, elite: true, tint: '#ffd080', gold: 8 },
  elite_bone_lord:    { name: '골편 군주', model: 'Big_Orc_Skull', hp: 5200, atk: 48, spd: 3.4, range: 2.8, atkTime: 1.6, exp: 58, scale: 1.35, armor: 0.2, elite: true, tint: '#d0e0ff', gold: 8 },
  elite_wraith:       { name: '대원령', model: 'Flying_Ghost', hp: 3600, atk: 46, spd: 5.6, range: 2.4, atkTime: 1.0, exp: 55, scale: 1.7, elite: true, tint: '#a0d0ff', ghostly: true, gold: 8 },

  // --- 새 행동 3종 (PRD §4-6: 스탯만 다른 리스킨 금지) ---
  // bomber: 돌진 → 2.2 안에서 0.7초 도화선 → 자폭. (Blob_GreenSpikyBlob 은 다른 블롭의 2.2배 크기 GLB — scale 0.5 로 맞춘다. 0.95 였을 때 영웅의 4배짜리 괴물이 화면을 덮었다) 아군도 다친다 → 진공으로 무리에 끌어넣으면 연쇄 폭발
  bomb_slime:  { name: '폭탄 슬라임', model: 'Blob_GreenSpikyBlob', hp: 385, atk: 33, spd: 6.4, range: 1.6, atkTime: 1.0, exp: 12, scale: 0.5, gold: 1, behavior: 'bomber', tint: '#ffd060' },
  // shaman: 거리 유지 + 6초마다 주변 아군 회복 + 9초마다 소환. 먼저 잡아야 한다
  skel_priest: { name: '해골 사제', model: 'Skeleton_Mage', hp: 595, atk: 18, spd: 3.2, range: 8.0, atkTime: 2.4, weapon: 'Skeleton_Staff', ranged: true, exp: 18, scale: 1.05, gold: 3, projColor: 0xa0ffb0, behavior: 'shaman', summon: 'skel_minion', tint: '#b0ffc0' },
  // shield: 정면 피해 80% 감소. 뒤·옆에서 치거나, 마무리 타격(kb≥4) 4번이면 가드 브레이크 3초
  skel_shield: { name: '해골 방패병', model: 'Skeleton_Warrior', hp: 1260, atk: 26, spd: 3.4, range: 2.2, atkTime: 1.6, weapon: 'Skeleton_Blade', shield: 'Skeleton_Shield_Large_A', exp: 16, scale: 1.05, gold: 2, armor: 0.1, behavior: 'shield' },
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
  blob_spiky: { name: '가시 슬라임', model: 'Blob_GreenSpikyBlob', hp: 1050, atk: 31, spd: 3.4, range: 1.8, atkTime: 1.4, exp: 14, scale: 0.55, armor: 0.15, gold: 2 },
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
  boss_warlord: { name: '해골 군주', model: 'Skeleton_Warrior', hp: 31200, atk: 45, spd: 3.6, range: 3.2, atkTime: 1.8, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', exp: 150, scale: 2.2, boss: true, armor: 0.25, gold: 40, portrait: '/img/boss_warlord.webp', kit: 'warlord', summon: 'skel_minion' },
  boss_demon:   { name: '심연의 대악마', model: 'Big_Demon', hp: 33600, atk: 51, spd: 4.0, range: 3.4, atkTime: 1.6, exp: 175, scale: 2.3, boss: true, armor: 0.2, gold: 45, portrait: '/img/boss_lich.webp', kit: 'reaper', summon: 'imp' },
  boss_dragon:  { name: '고대 용 발카르', model: 'Flying_Dragon_Evolved', hp: 37200, atk: 56, spd: 4.6, range: 3.2, atkTime: 1.5, exp: 200, scale: 2.6, boss: true, armor: 0.2, gold: 55, portrait: '/img/boss_reaper.webp', kit: 'dragon', summon: 'squidle', projColor: 0xff7a30 },
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
};
const RANK_STATS = {
  captain: { hp: 13000, atk: 40, scale: 1.45, exp: 90, gold: 20 },
  warden: { hp: 19000, atk: 44, scale: 1.7, exp: 120, gold: 28 },
  midboss: { hp: 27000, atk: 48, scale: 1.95, exp: 160, gold: 40 },
  finalboss: { hp: 35000, atk: 53, scale: 2.25, exp: 220, gold: 55 },
};
for (const chapter of CHAPTERS) {
  const theme = chapter.theme;
  const summon = ROSTER[theme].trash[0];
  for (const [rank, [baseId, name, pattern, tactic]] of Object.entries(CAMPAIGN_ENCOUNTERS[theme])) {
    const base = ENEMIES[baseId];
    ENEMIES[theme + '_' + rank] = {
      ...base, ...RANK_STATS[rank], name, boss: true, elite: false, ranged: false,
      behavior: undefined, rank, pattern, tactic, summon, tint: chapter.color, range: 3.2,
      armor: rank === 'captain' ? 0.12 : 0.2, atkTime: rank === 'finalboss' ? 1.7 : 1.9,
      kit: theme === 'garden' || theme === 'crown' ? 'warlord' : theme === 'frost' ? 'lich' : theme === 'tide' ? 'dragon' : 'reaper',
      voiceKey: theme === 'garden' || theme === 'crown' ? 'boss_warlord' : theme === 'tide' ? 'boss_dragon' : 'boss_demon',
      portrait: base.portrait || (theme === 'garden' ? '/img/boss_warlord.webp' : theme === 'tide' ? '/img/boss_reaper.webp' : '/img/boss_lich.webp'),
      projColor: Number.parseInt(chapter.color.slice(1), 16),
    };
  }
}
