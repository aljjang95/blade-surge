// 챕터/스테이지 — 몹몰이형 대규모 웨이브, 챕터마다 완전히 다른 몬스터 로스터
export const CHAPTERS = [
  { id: 1, name: '어둠의 지하묘지', theme: 'crypt',  color: '#4cc3ff', boss: 'boss_warlord' },
  { id: 2, name: '불타는 왕좌',     theme: 'throne', color: '#ff5a3c', boss: 'boss_demon' },
  { id: 3, name: '심연의 제단',     theme: 'abyss',  color: '#b26bff', boss: 'boss_dragon' },
];
export const STAGES_PER_CHAPTER = 10;

// 챕터별 잡몹 / 엘리트 풀 — 겹치지 않게 짜서 스테이지마다 그림이 바뀐다
const ROSTER = {
  crypt:  { trash: ['skel_minion', 'skel_rogue', 'ghost', 'blob_green', 'skel_minion', 'bone_orc'],
            ranged: ['skel_mage', 'ghost_skull'],
            elite: ['elite_skel_captain', 'elite_bone_lord', 'elite_wraith'] },
  throne: { trash: ['orc', 'orc_blob', 'tribal', 'cactoro', 'orc', 'imp'],
            ranged: ['hywirl', 'armabee'],
            elite: ['elite_orc_chief', 'elite_yeti', 'elite_bluedemon'] },
  abyss:  { trash: ['blob_pink', 'blob_spiky', 'alien', 'squidle', 'mushnub', 'ninja'],
            ranged: ['glub', 'armabee_evo'],
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
  if (boss) waves.push([chapter.boss, R.trash[0], R.trash[1], R.trash[0], R.trash[2]]);
  const energy = 6 + Math.floor(idx / 6);
  return {
    ch, st, idx, boss, chapter, name: `${ch}-${st} ${chapter.name}`, waves, scale, energy,
    recPower: Math.floor(900 * Math.pow(1.15, idx - 1)),
    rewards: {
      gold: Math.floor(400 * scale), exp: Math.floor(110 * scale), bp: 60 + (boss ? 60 : 0),
      firstGems: boss ? 300 : 60, dropChance: boss ? 1 : 0.6, stones: 2 + (boss ? 4 : 0),
    },
  };
}

// scale = 모델 배율(리그 기본 배율에 곱해짐). hp/atk 은 스테이지 scale 로 곱해진다.
export const ENEMIES = {
  // ================= 1장 · 어둠의 지하묘지 (언데드) =================
  skel_minion: { name: '해골 병사', model: 'Skeleton_Minion', hp: 140, atk: 18, spd: 4.6, range: 1.9, atkTime: 1.2, weapon: 'Skeleton_Blade', exp: 8, scale: 0.95, gold: 1 },
  skel_rogue:  { name: '해골 자객', model: 'Skeleton_Rogue', hp: 180, atk: 26, spd: 6.2, range: 2.0, atkTime: 0.8, weapon: 'Skeleton_Blade', exp: 12, scale: 0.95, dodge: 0.2, gold: 1 },
  skel_mage:   { name: '해골 주술사', model: 'Skeleton_Mage', hp: 150, atk: 36, spd: 3.0, range: 8.0, atkTime: 2.2, weapon: 'Skeleton_Staff', ranged: true, exp: 14, scale: 1.0, gold: 2, projColor: 0x60ff80 },
  ghost:       { name: '원령', model: 'Flying_Ghost', hp: 120, atk: 22, spd: 5.4, range: 2.1, atkTime: 1.1, exp: 11, scale: 1.25, gold: 1, ghostly: true },
  ghost_skull: { name: '해골 망령', model: 'Flying_Ghost_Skull', hp: 140, atk: 32, spd: 3.4, range: 8.5, atkTime: 2.0, ranged: true, exp: 15, scale: 1.2, gold: 2, ghostly: true, projColor: 0x80d0ff },
  blob_green:  { name: '부패 슬라임', model: 'Blob_GreenBlob', hp: 200, atk: 16, spd: 3.2, range: 1.7, atkTime: 1.4, exp: 9, scale: 1.0, gold: 1 },
  bone_orc:    { name: '뼈 오크', model: 'Big_Orc_Skull', hp: 320, atk: 28, spd: 3.8, range: 2.2, atkTime: 1.5, exp: 15, scale: 1.0, armor: 0.15, gold: 2 },
  elite_skel_captain: { name: '해골 대장', model: 'Skeleton_Warrior', hp: 1400, atk: 46, spd: 3.6, range: 2.6, atkTime: 1.5, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', exp: 60, scale: 1.45, armor: 0.25, elite: true, tint: '#ffd080', gold: 8 },
  elite_bone_lord:    { name: '골편 군주', model: 'Big_Orc_Skull', hp: 1300, atk: 44, spd: 3.4, range: 2.8, atkTime: 1.6, exp: 58, scale: 1.35, armor: 0.2, elite: true, tint: '#d0e0ff', gold: 8 },
  elite_wraith:       { name: '대원령', model: 'Flying_Ghost', hp: 900, atk: 42, spd: 5.6, range: 2.4, atkTime: 1.0, exp: 55, scale: 1.7, elite: true, tint: '#a0d0ff', ghostly: true, gold: 8 },

  // ================= 2장 · 불타는 왕좌 (오크 · 악마) =================
  orc:      { name: '오크 전사', model: 'Big_Orc', hp: 300, atk: 26, spd: 4.0, range: 2.2, atkTime: 1.3, exp: 12, scale: 1.0, gold: 2 },
  orc_blob: { name: '꼬마 오크', model: 'Blob_Orc', hp: 170, atk: 20, spd: 4.8, range: 1.8, atkTime: 1.0, exp: 10, scale: 1.0, gold: 1 },
  tribal:   { name: '부족 전사', model: 'Big_Tribal', hp: 280, atk: 30, spd: 4.4, range: 2.2, atkTime: 1.2, exp: 13, scale: 1.0, gold: 2 },
  cactoro:  { name: '가시 수호병', model: 'Big_Cactoro', hp: 420, atk: 24, spd: 3.2, range: 2.1, atkTime: 1.6, exp: 15, scale: 1.0, armor: 0.2, gold: 2 },
  imp:      { name: '임프', model: 'Blob_Mushnub', hp: 150, atk: 24, spd: 5.6, range: 1.8, atkTime: 0.9, exp: 11, scale: 1.0, gold: 1 },
  hywirl:   { name: '화염 정령', model: 'Flying_Hywirl', hp: 160, atk: 38, spd: 3.6, range: 8.5, atkTime: 2.0, ranged: true, exp: 16, scale: 1.0, gold: 2, projColor: 0xff8040 },
  armabee:  { name: '독침벌', model: 'Flying_Armabee', hp: 130, atk: 30, spd: 5.0, range: 7.5, atkTime: 1.7, ranged: true, exp: 14, scale: 1.0, gold: 2, projColor: 0xffe060 },
  elite_orc_chief: { name: '오크 족장', model: 'Big_Orc', hp: 1500, atk: 50, spd: 3.8, range: 2.8, atkTime: 1.5, exp: 62, scale: 1.5, armor: 0.25, elite: true, tint: '#ffb060', gold: 8 },
  elite_yeti:      { name: '설산 거인', model: 'Big_Yeti', hp: 1800, atk: 48, spd: 3.0, range: 3.0, atkTime: 1.8, exp: 68, scale: 1.55, armor: 0.3, elite: true, tint: '#c0e8ff', gold: 9 },
  elite_bluedemon: { name: '푸른 악마', model: 'Big_BlueDemon', hp: 1200, atk: 56, spd: 4.6, range: 2.6, atkTime: 1.2, exp: 65, scale: 1.4, elite: true, tint: '#a0c0ff', gold: 9 },

  // ================= 3장 · 심연의 제단 (이계 · 용) =================
  blob_pink:  { name: '심연 슬라임', model: 'Blob_PinkBlob', hp: 260, atk: 24, spd: 3.6, range: 1.8, atkTime: 1.3, exp: 13, scale: 1.0, gold: 2 },
  blob_spiky: { name: '가시 슬라임', model: 'Blob_GreenSpikyBlob', hp: 300, atk: 28, spd: 3.4, range: 1.8, atkTime: 1.4, exp: 14, scale: 1.0, armor: 0.15, gold: 2 },
  alien:      { name: '이계 침입자', model: 'Big_Alien', hp: 340, atk: 34, spd: 4.4, range: 2.3, atkTime: 1.2, exp: 16, scale: 1.0, gold: 2 },
  squidle:    { name: '부유 촉수', model: 'Flying_Squidle', hp: 200, atk: 30, spd: 4.6, range: 2.2, atkTime: 1.1, exp: 15, scale: 1.0, gold: 2 },
  mushnub:    { name: '포자 괴물', model: 'Blob_Mushnub_Evolved', hp: 320, atk: 26, spd: 3.4, range: 1.9, atkTime: 1.4, exp: 15, scale: 1.0, gold: 2 },
  ninja:      { name: '그림자 닌자', model: 'Big_Ninja', hp: 240, atk: 40, spd: 6.4, range: 2.1, atkTime: 0.85, exp: 18, scale: 1.0, dodge: 0.25, gold: 2 },
  glub:       { name: '심연 눈알', model: 'Flying_Glub', hp: 180, atk: 44, spd: 3.2, range: 9.0, atkTime: 2.0, ranged: true, exp: 18, scale: 1.0, gold: 3, projColor: 0xb26bff },
  armabee_evo:{ name: '진화한 독침벌', model: 'Flying_Armabee_Evolved', hp: 200, atk: 40, spd: 5.2, range: 8.0, atkTime: 1.6, ranged: true, exp: 18, scale: 1.0, gold: 3, projColor: 0xd0a0ff },
  elite_mushroom_king: { name: '버섯 왕', model: 'Big_MushroomKing', hp: 2000, atk: 54, spd: 3.0, range: 3.0, atkTime: 1.7, exp: 75, scale: 1.5, armor: 0.25, elite: true, tint: '#e0a0ff', gold: 10 },
  elite_golem:         { name: '심연 골렘', model: 'Flying_Goleling_Evolved', hp: 1700, atk: 52, spd: 3.4, range: 2.8, atkTime: 1.6, exp: 72, scale: 1.6, armor: 0.3, elite: true, tint: '#a0ffd0', gold: 10 },
  elite_dragonling:    { name: '새끼 용', model: 'Flying_Dragon', hp: 1400, atk: 60, spd: 5.4, range: 2.8, atkTime: 1.3, exp: 78, scale: 1.5, elite: true, tint: '#ffc0a0', gold: 10 },

  // ================= 보스 3종 =================
  boss_warlord: { name: '해골 군주', model: 'Skeleton_Warrior', hp: 5200, atk: 60, spd: 3.6, range: 3.2, atkTime: 1.8, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', exp: 150, scale: 2.2, boss: true, armor: 0.25, gold: 40, portrait: '/img/boss_warlord.webp', kit: 'warlord', summon: 'skel_minion' },
  boss_demon:   { name: '심연의 대악마', model: 'Big_Demon', hp: 5600, atk: 68, spd: 4.0, range: 3.4, atkTime: 1.6, exp: 175, scale: 2.3, boss: true, armor: 0.2, gold: 45, portrait: '/img/boss_lich.webp', kit: 'reaper', summon: 'imp' },
  boss_dragon:  { name: '고대 용 발카르', model: 'Flying_Dragon_Evolved', hp: 6200, atk: 74, spd: 4.6, range: 3.2, atkTime: 1.5, exp: 200, scale: 2.6, boss: true, armor: 0.2, gold: 55, portrait: '/img/boss_reaper.webp', kit: 'dragon', summon: 'squidle', projColor: 0xff7a30 },
};
