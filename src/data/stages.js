// 챕터/스테이지 — 몹몰이형 대규모 웨이브, 엘리트, 챕터별 보스
export const CHAPTERS = [
  { id: 1, name: '어둠의 지하묘지', theme: 'crypt',  color: '#4cc3ff', boss: 'boss_warlord' },
  { id: 2, name: '불타는 왕좌',     theme: 'throne', color: '#ff5a3c', boss: 'boss_lich' },
  { id: 3, name: '심연의 제단',     theme: 'abyss',  color: '#b26bff', boss: 'boss_reaper' },
];
export const STAGES_PER_CHAPTER = 10;

const ENEMY_MIX = {
  crypt:  ['minion', 'minion', 'minion', 'warrior', 'rogue', 'minion', 'mage'],
  throne: ['minion', 'warrior', 'rogue', 'mage', 'minion', 'warrior', 'minion'],
  abyss:  ['rogue', 'mage', 'minion', 'warrior', 'rogue', 'minion', 'mage'],
};

export function stageDef(ch, st) {
  const chapter = CHAPTERS[ch - 1];
  const idx = (ch - 1) * STAGES_PER_CHAPTER + st; // 1..30
  const boss = st === 5 || st === 10;
  const scale = Math.pow(1.12, idx - 1);
  const mix = ENEMY_MIX[chapter.theme];
  const waves = [];
  const wcount = boss ? 2 : 3;
  for (let w = 0; w < wcount; w++) {
    // 몹몰이: 웨이브당 10~28마리, 뒤 웨이브일수록 많음
    const n = Math.min(28, 10 + Math.floor(idx * 0.6) + w * 4);
    const list = [];
    for (let i = 0; i < n; i++) list.push(mix[(i * 3 + w + st) % mix.length]);
    // 엘리트 1~3
    const elites = 1 + Math.floor(w / 1.5) + (idx > 10 ? 1 : 0);
    for (let e = 0; e < elites; e++) list.push('elite_' + ['warrior', 'rogue', 'mage'][(e + st) % 3]);
    waves.push(list);
  }
  if (boss) waves.push([chapter.boss, 'minion', 'minion', 'minion', 'minion']);
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

// hp/atk 는 스테이지 scale 로 곱해짐. 몹몰이용 잡몹은 약하고 많다.
export const ENEMIES = {
  minion:  { name: '해골 병사',   model: 'Skeleton_Minion',  hp: 140, atk: 18, spd: 4.6, range: 1.9, atkTime: 1.2, weapon: 'Skeleton_Blade', anim: '1H_Melee_Attack_Slice_Horizontal', exp: 8, scale: 0.95, gold: 1 },
  warrior: { name: '해골 전사',   model: 'Skeleton_Warrior', hp: 380, atk: 30, spd: 3.6, range: 2.3, atkTime: 1.5, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', anim: '1H_Melee_Attack_Chop', exp: 16, scale: 1.1, armor: 0.2, gold: 2 },
  rogue:   { name: '해골 자객',   model: 'Skeleton_Rogue',   hp: 180, atk: 26, spd: 6.2, range: 2.0, atkTime: 0.8, weapon: 'Skeleton_Blade', anim: 'Dualwield_Melee_Attack_Slice', exp: 12, scale: 0.95, dodge: 0.2, gold: 1 },
  mage:    { name: '해골 주술사', model: 'Skeleton_Mage',    hp: 150, atk: 36, spd: 3.0, range: 8.0, atkTime: 2.2, weapon: 'Skeleton_Staff', anim: 'Spellcast_Shoot', ranged: true, exp: 14, scale: 1.0, gold: 2 },
  // 엘리트: 크고 강하며 장비 드랍 확정
  elite_warrior: { name: '해골 대장', model: 'Skeleton_Warrior', hp: 1400, atk: 46, spd: 3.6, range: 2.6, atkTime: 1.5, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', anim: '1H_Melee_Attack_Chop', exp: 60, scale: 1.45, armor: 0.25, elite: true, tint: '#ffd080', gold: 8 },
  elite_rogue:   { name: '해골 암살단장', model: 'Skeleton_Rogue', hp: 900, atk: 40, spd: 6.4, range: 2.2, atkTime: 0.8, weapon: 'Skeleton_Blade', anim: 'Dualwield_Melee_Attack_Slice', exp: 50, scale: 1.35, dodge: 0.3, elite: true, tint: '#d0a0ff', gold: 8 },
  elite_mage:    { name: '해골 대주술사', model: 'Skeleton_Mage', hp: 700, atk: 55, spd: 3.0, range: 9, atkTime: 2.0, weapon: 'Skeleton_Staff', anim: 'Spellcast_Shoot', ranged: true, exp: 55, scale: 1.4, elite: true, tint: '#a0ffc0', gold: 8 },
  // 보스 3종
  boss_warlord: { name: '해골 군주',   model: 'Skeleton_Warrior', hp: 5200, atk: 60, spd: 3.6, range: 3.2, atkTime: 1.8, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', anim: '2H_Melee_Attack_Chop', exp: 150, scale: 2.1, boss: true, armor: 0.25, gold: 40, portrait: '/img/boss_warlord.webp', kit: 'warlord' },
  boss_lich:    { name: '리치 왕',     model: 'Skeleton_Mage',    hp: 4600, atk: 70, spd: 3.0, range: 9, atkTime: 1.6, weapon: 'Skeleton_Staff', anim: 'Spellcast_Shoot', ranged: true, exp: 170, scale: 2.0, boss: true, armor: 0.15, gold: 45, portrait: '/img/boss_lich.webp', kit: 'lich' },
  boss_reaper:  { name: '사신 그림자', model: 'Skeleton_Rogue',   hp: 5000, atk: 66, spd: 6.5, range: 2.6, atkTime: 1.0, weapon: 'Skeleton_Blade', anim: 'Dualwield_Melee_Attack_Slice', exp: 190, scale: 1.9, boss: true, dodge: 0.2, gold: 50, portrait: '/img/boss_reaper.webp', kit: 'reaper' },
};
