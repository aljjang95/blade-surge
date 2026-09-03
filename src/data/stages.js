// 챕터/스테이지 — 몹몰이형 대규모 웨이브, 챕터마다 완전히 다른 몬스터 로스터
export const CHAPTERS = [
  { id: 1, name: '어둠의 지하묘지', theme: 'crypt',  color: '#4cc3ff', boss: 'boss_warlord' },
  { id: 2, name: '불타는 왕좌',     theme: 'throne', color: '#ff5a3c', boss: 'boss_demon' },
  { id: 3, name: '심연의 제단',     theme: 'abyss',  color: '#b26bff', boss: 'boss_dragon' },
];
export const STAGES_PER_CHAPTER = 10;

// 챕터별 잡몹 / 엘리트 풀 — 겹치지 않게 짜서 스테이지마다 그림이 바뀐다
const ROSTER = {
  crypt:  { trash: ['skel_minion', 'skel_rogue', 'ghost', 'bomb_slime', 'skel_shield', 'bone_orc'],
            ranged: ['skel_mage', 'ghost_skull', 'skel_priest'],
            elite: ['elite_skel_captain', 'elite_bone_lord', 'elite_wraith'] },
  throne: { trash: ['orc', 'orc_blob', 'tribal', 'cacto_wall', 'bomb_imp', 'imp'],
            ranged: ['hywirl', 'armabee', 'tribal_shaman'],
            elite: ['elite_orc_chief', 'elite_yeti', 'elite_bluedemon'] },
  abyss:  { trash: ['blob_pink', 'bomb_abyss', 'alien', 'golem_guard', 'mushnub', 'ninja'],
            ranged: ['glub', 'armabee_evo', 'abyss_seer'],
            elite: ['elite_mushroom_king', 'elite_golem', 'elite_dragonling'] },
};

export function stageDef(ch, st) {
  const chapter = CHAPTERS[ch - 1];
  const idx = (ch - 1) * STAGES_PER_CHAPTER + st; // 1..30
  const boss = st === 5 || st === 10;
  const scale = Math.pow(1.12, idx - 1);
  const R = ROSTER[chapter.theme];
  const waves = [];
  const wcount = boss ? 2 : 3;
  for (let w = 0; w < wcount; w++) {
    const n = Math.min(28, 10 + Math.floor(idx * 0.6) + w * 4);
    const list = [];
    for (let i = 0; i < n; i++) {
      // 6:1 비율로 원거리 섞기
      const pool = (i % 7 === 6) ? R.ranged : R.trash;
      list.push(pool[(i * 3 + w + st) % pool.length]);
    }
    const elites = 1 + Math.floor(w / 1.5) + (idx > 10 ? 1 : 0);
    for (let e = 0; e < elites; e++) list.push(R.elite[(e + st + w) % R.elite.length]);
    waves.push(list);
  }
  const energy = 6 + Math.floor(idx / 6);
  return {
    ch, st, idx, boss, chapter, name: `${idx}층 · ${chapter.name}`, waves, scale, energy,
    rosterFor: () => R,
    recPower: Math.floor(2600 * Math.pow(1.12, idx - 1)),
    rewards: {
      gold: Math.floor(400 * scale), exp: Math.floor(110 * scale), bp: 60 + (boss ? 60 : 0),
      firstGems: boss ? 300 : 60, dropChance: boss ? 1 : 0.6, stones: 2 + (boss ? 4 : 0),
    },
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
