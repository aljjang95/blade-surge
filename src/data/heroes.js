// 영웅 정의 — 모델(KayKit Adventurers, CC0), 애니메이션, 스킬, 기본 스탯
export const RARITY = {
  N:   { name: 'N',   color: '#9aa3b2', mult: 1.0 },
  R:   { name: 'R',   color: '#4cc3ff', mult: 1.2 },
  SR:  { name: 'SR',  color: '#b26bff', mult: 1.5 },
  SSR: { name: 'SSR', color: '#ffcf5a', mult: 2.0 },
};

export const HEROES = {
  knight: {
    id: 'knight', name: '검성 아르카', title: '성검의 계승자', rarity: 'SSR', model: 'Knight', portrait: '/img/hero_knight.webp',
    weapon: '1h', color: '#ffcf5a', accent: '#fff3c0',
    show: ['1H_Sword', 'Round_Shield'],
    base: { hp: 1400, atk: 120, def: 40, crit: 0.15, critDmg: 1.6, spd: 6.2 },
    // 6타: 베기 → 베기 → 찌르기(돌진) → 회전베기(2연타·진공) → 베기 → 내려찍기(마무리)
    combo: [
      { anim: '1H_Melee_Attack_Slice_Horizontal', hitAt: 0.42, dmg: 0.9,  range: 2.6, arc: 140, kb: 1.5, dur: 0.5 },
      { anim: '1H_Melee_Attack_Slice_Diagonal',   hitAt: 0.40, dmg: 0.95, range: 2.6, arc: 120, kb: 1.5, dur: 0.5 },
      { anim: '1H_Melee_Attack_Stab',             hitAt: 0.38, dmg: 1.1,  range: 3.0, arc: 70,  kb: 2.5, dur: 0.5, move: 'lunge', lunge: 3.5 },
      { anim: '2H_Melee_Attack_Spin',             hitAt: 0.40, dmg: 0.7,  range: 3.2, arc: 360, kb: 2.0, dur: 0.7, move: 'spin', ticks: 2 },
      { anim: '1H_Melee_Attack_Slice_Horizontal', hitAt: 0.40, dmg: 1.0,  range: 2.7, arc: 150, kb: 2.0, dur: 0.5 },
      { anim: '1H_Melee_Attack_Chop',             hitAt: 0.45, dmg: 1.9,  range: 2.9, arc: 160, kb: 5.0, dur: 0.72, finisher: true },
    ],
    skills: [
      { id: 'holy_slash',  name: '성검 일섬', icon: '/img/sk_knight_1.webp', cd: 5,  anim: '1H_Melee_Attack_Slice_Horizontal', castAt: 0.4, dmg: 3.2, desc: '전방으로 거대한 빛의 참격을 날려 관통 피해' },
      { id: 'shield_bash', name: '철벽 강타', icon: '/img/sk_knight_2.webp', cd: 8,  anim: 'Block_Hit', castAt: 0.35, dmg: 2.4, desc: '방패로 지면을 강타해 주변 적을 기절시키고 밀쳐냄' },
      { id: 'judgment',    name: '심판의 빛', icon: '/img/sk_knight_3.webp', cd: 12, anim: 'Spellcast_Raise', castAt: 0.5, dmg: 2.0, desc: '주변 모든 적에게 빛의 기둥이 낙하' },
      { id: 'dragon_slash', name: '용살검 · 천공', icon: '/img/sk_knight_ult.webp', ult: true, anim: '2H_Melee_Attack_Chop', castAt: 0.55, dmg: 12, desc: '하늘을 가르는 일격. 전방 광역에 압도적인 피해' },
      // ── 각성 (레벨 구간 해금) ──
      { id: 'chain_bind',  name: '성쇄 · 결박', icon: '/img/sk_kn_a1.webp', cd: 11, unlock: 10, awaken: 1, anim: 'Spellcast_Raise', castAt: 0.35, dmg: 3.0, desc: '빛의 사슬이 주변 적을 끌어와 2초간 결박한다. 사슬이 끊기며 폭발' },
      { id: 'sanctuary',   name: '천상의 성역', icon: '/img/sk_kn_a2.webp', cd: 22, unlock: 20, awaken: 2, anim: 'Spellcast_Raise', castAt: 0.4,  dmg: 0.9, desc: '7초간 성역 전개. 적은 밖으로 나갈 수 없고 지속 피해, 나는 받는 피해 35% 감소' },
    ],
  },
  barbarian: {
    id: 'barbarian', name: '광전사 드라칸', title: '피의 도끼', rarity: 'SSR', model: 'Barbarian', portrait: '/img/hero_barbarian.webp',
    weapon: '2h', color: '#ff5a3c', accent: '#ffd0b0',
    show: ['2H_Axe'],
    base: { hp: 1800, atk: 150, def: 30, crit: 0.20, critDmg: 1.8, spd: 5.8 },
    // 5타: 베기 → 찌르기(돌진) → 회오리(3연타·진공) → 내려찍기 → 도약 강타(마무리·충격파)
    combo: [
      { anim: '2H_Melee_Attack_Slice',    hitAt: 0.45, dmg: 1.1, range: 3.0, arc: 160, kb: 2.0, dur: 0.6 },
      { anim: '2H_Melee_Attack_Stab',     hitAt: 0.40, dmg: 1.2, range: 3.4, arc: 80,  kb: 3.0, dur: 0.55, move: 'lunge', lunge: 4 },
      { anim: '2H_Melee_Attack_Spinning', hitAt: 0.30, dmg: 0.6, range: 3.4, arc: 360, kb: 1.5, dur: 0.85, move: 'spin', ticks: 3 },
      { anim: '2H_Melee_Attack_Chop',     hitAt: 0.5,  dmg: 1.6, range: 3.0, arc: 170, kb: 3.0, dur: 0.7 },
      { anim: 'Jump_Full_Short',          hitAt: 0.62, dmg: 2.4, range: 4.5, arc: 360, kb: 7.0, dur: 0.9, move: 'slam', finisher: true },
    ],
    skills: [
      { id: 'whirlwind',  name: '회오리 참격', icon: '/img/sk_barb_1.webp', cd: 7,  anim: '2H_Melee_Attack_Spin', castAt: 0.3, dmg: 0.9, ticks: 5, desc: '도끼를 휘돌려 주변 적을 연속으로 베어냄' },
      { id: 'quake',      name: '대지 분쇄', icon: '/img/sk_barb_2.webp', cd: 10, anim: '2H_Melee_Attack_Chop', castAt: 0.5, dmg: 4.0, desc: '땅을 내리쳐 충격파로 광역 피해와 넉백' },
      { id: 'berserk',    name: '광폭화',   icon: '/img/sk_barb_3.webp', cd: 16, anim: 'Cheer', castAt: 0.2, dmg: 0, desc: '8초간 공격력 +60%, 공격속도 +30%' },
      { id: 'hell_axe',   name: '지옥의 도끼', icon: '/img/sk_barb_ult.webp', ult: true, anim: 'Jump_Full_Short', castAt: 0.5, dmg: 14, desc: '불타는 거대 도끼를 낙하시켜 전장을 불태움' },
      // ── 각성 (레벨 구간 해금) ──
      { id: 'bull_rush',   name: '광란의 돌진', icon: '/img/sk_bb_a1.webp', cd: 9,  unlock: 10, awaken: 1, anim: '2H_Melee_Attack_Stab', castAt: 0.1, dmg: 2.4, desc: '적을 앞으로 밀어 모으며 돌진하고, 벽처럼 뭉친 적을 끝에서 폭발시킨다' },
      { id: 'magma_zone',  name: '용암 분출 · 진', icon: '/img/sk_bb_a2.webp', cd: 24, unlock: 20, awaken: 2, anim: '2H_Melee_Attack_Chop', castAt: 0.45, dmg: 1.8, desc: '주변에 용암 기둥이 차례로 솟아 적을 띄우고, 갈라진 균열이 9초간 남아 지진다' },
    ],
  },
  mage: {
    id: 'mage', name: '대마도사 리아', title: '별을 부르는 자', rarity: 'SR', model: 'Mage', portrait: '/img/hero_mage.webp',
    weapon: 'staff', color: '#4cc3ff', accent: '#d0f0ff', ranged: true,
    show: ['2H_Staff'],
    base: { hp: 1000, atk: 170, def: 20, crit: 0.12, critDmg: 1.7, spd: 5.6 },
    // 5타: 화살 → 화살 → 부채꼴 3발 → 관통 대화살 → 노바(마무리·주변 흡인 후 폭발)
    combo: [
      { anim: 'Spellcast_Shoot', hitAt: 0.35, dmg: 0.85, range: 9, arc: 30, kb: 0.8, dur: 0.45, projectile: 'bolt' },
      { anim: 'Spellcast_Shoot', hitAt: 0.35, dmg: 0.85, range: 9, arc: 30, kb: 0.8, dur: 0.45, projectile: 'bolt' },
      { anim: 'Spellcast_Long',  hitAt: 0.45, dmg: 0.7,  range: 9, arc: 60, kb: 1.5, dur: 0.6, projectile: 'bolt', move: 'fan' },
      { anim: 'Spellcast_Shoot', hitAt: 0.35, dmg: 1.4,  range: 9, arc: 30, kb: 2.5, dur: 0.5, projectile: 'bigbolt' },
      { anim: 'Spellcast_Raise', hitAt: 0.5,  dmg: 1.8,  range: 4.5, arc: 360, kb: 4.0, dur: 0.8, move: 'nova', finisher: true },
    ],
    skills: [
      { id: 'fireball',   name: '화염구',     icon: '/img/sk_mage_1.webp', cd: 5,  anim: 'Spellcast_Shoot', castAt: 0.35, dmg: 3.5, desc: '폭발하는 화염구를 발사해 광역 피해' },
      { id: 'chain',      name: '번개 사슬',  icon: '/img/sk_mage_2.webp', cd: 9,  anim: 'Spellcast_Raise', castAt: 0.45, dmg: 2.2, desc: '적들을 연쇄하는 번개. 최대 6명 타격' },
      { id: 'blizzard',   name: '빙결 폭풍',  icon: '/img/sk_mage_3.webp', cd: 13, anim: 'Spellcast_Long', castAt: 0.5, dmg: 0.8, ticks: 6, desc: '주변에 얼음 폭풍을 일으켜 지속 피해와 둔화' },
      { id: 'meteor',     name: '메테오 스톰', icon: '/img/sk_mage_ult.webp', ult: true, anim: 'Spellcast_Raise', castAt: 0.5, dmg: 4.5, ticks: 5, desc: '하늘에서 운석이 쏟아져 전장을 초토화' },
      // ── 각성 (레벨 구간 해금) ──
      { id: 'arc_reflect', name: '프리즘 난반사', icon: '/img/sk_mg_a1.webp', cd: 10, unlock: 10, awaken: 1, anim: 'Spellcast_Shoot', castAt: 0.35, dmg: 1.6, desc: '빛의 창이 적과 벽을 튕기며 최대 12회 반사. 반사마다 피해가 커진다' },
      { id: 'chrono_seal', name: '시간 봉인',   icon: '/img/sk_mg_a2.webp', cd: 26, unlock: 20, awaken: 2, anim: 'Spellcast_Raise', castAt: 0.4, dmg: 0.6, desc: '주변 적의 시간을 3초간 멈춘다. 멈춘 동안 준 피해가 각인되어 해제 순간 터진다' },
    ],
  },
  rogue: {
    id: 'rogue', name: '암살자 카인', title: '그림자 속의 칼날', rarity: 'SR', model: 'Rogue', portrait: '/img/hero_rogue.webp',
    weapon: 'dual', color: '#b26bff', accent: '#e8d0ff',
    show: ['Knife', 'Knife_Offhand'],
    base: { hp: 1100, atk: 135, def: 25, crit: 0.35, critDmg: 2.0, spd: 7.2 },
    // 6타: 베기 → 찍기 → 베기 → 그림자 관통(적을 뚫고 지나가며 베기) → 찍기 → 쌍검 찌르기(마무리)
    combo: [
      { anim: 'Dualwield_Melee_Attack_Slice', hitAt: 0.35, dmg: 0.75, range: 2.3, arc: 120, kb: 1.0, dur: 0.38 },
      { anim: 'Dualwield_Melee_Attack_Chop',  hitAt: 0.35, dmg: 0.75, range: 2.3, arc: 120, kb: 1.0, dur: 0.38 },
      { anim: 'Dualwield_Melee_Attack_Slice', hitAt: 0.35, dmg: 0.8,  range: 2.3, arc: 120, kb: 1.0, dur: 0.38 },
      { anim: 'Dodge_Forward',                hitAt: 0.35, dmg: 1.1,  range: 2.4, arc: 360, kb: 1.5, dur: 0.45, move: 'lunge', lunge: 5, through: true },
      { anim: 'Dualwield_Melee_Attack_Chop',  hitAt: 0.35, dmg: 0.85, range: 2.3, arc: 120, kb: 1.2, dur: 0.38 },
      { anim: 'Dualwield_Melee_Attack_Stab',  hitAt: 0.4,  dmg: 1.7,  range: 2.7, arc: 90,  kb: 3.5, dur: 0.55, finisher: true },
    ],
    skills: [
      { id: 'shadow_dash', name: '그림자 질주', icon: '/img/sk_rogue_1.webp', cd: 6,  anim: 'Dodge_Forward', castAt: 0.1, dmg: 2.6, desc: '적을 관통하며 질주해 경로상 모든 적을 베어냄' },
      { id: 'poison_bomb', name: '독무 폭탄',   icon: '/img/sk_rogue_2.webp', cd: 9,  anim: 'Throw', castAt: 0.45, dmg: 0.6, ticks: 8, desc: '독 연막을 투척해 지속 피해' },
      { id: 'flurry',      name: '환영 난무',   icon: '/img/sk_rogue_3.webp', cd: 11, anim: 'Dualwield_Melee_Attack_Stab', castAt: 0.2, dmg: 0.7, ticks: 8, desc: '잔상을 남기며 8연속 찌르기' },
      { id: 'thousand',    name: '천 개의 칼날', icon: '/img/sk_rogue_ult.webp', ult: true, anim: 'Spellcast_Raise', castAt: 0.4, dmg: 1.4, ticks: 10, desc: '하늘에서 수천의 칼날이 쏟아짐' },
      // ── 각성 (레벨 구간 해금) ──
      { id: 'shadow_mark', name: '그림자 표식', icon: '/img/sk_rg_a1.webp', cd: 10, unlock: 10, awaken: 1, anim: 'Dualwield_Melee_Attack_Stab', castAt: 0.3, dmg: 1.5, desc: '최대 8명에게 표식을 새기고 분신이 차례로 순간이동해 벤다. 표식은 서로를 끌어당기며 터진다' },
      { id: 'void_step',   name: '공허 보법',   icon: '/img/sk_rg_a2.webp', cd: 25, unlock: 20, awaken: 2, anim: 'Dodge_Forward', castAt: 0.1, dmg: 1.2, desc: '공허에 잠겨 무적이 된 채 적들 사이를 12번 순간이동하며 베고, 마지막 적에서 터져 나온다' },
    ],
  },
};

export const HERO_ORDER = ['knight', 'barbarian', 'mage', 'rogue'];

// 레벨업 필요 EXP / 골드
export const levelExp = (lv) => Math.floor(100 * Math.pow(1.18, lv - 1));
export const levelGold = (lv) => Math.floor(200 * Math.pow(1.15, lv - 1));
export const starShards = (star) => [0, 20, 40, 80, 160, 320][star] || 999;
export const skillUpGold = (lv) => Math.floor(500 * Math.pow(1.4, lv - 1));

export function heroStats(def, state, equipBonus = { atk: 0, hp: 0, crit: 0, def: 0 }) {
  const lv = state?.level || 1, star = state?.star || 1;
  const rm = RARITY[def.rarity].mult;
  const lvm = 1 + (lv - 1) * 0.08;
  const stm = 1 + (star - 1) * 0.25;
  const eb = equipBonus;
  const hp = Math.floor((def.base.hp * lvm * stm * rm + (eb.hp || 0)) * (1 + (eb.hpPct || 0)));
  const atk = Math.floor((def.base.atk * lvm * stm * rm + (eb.atk || 0)) * (1 + (eb.atkPct || 0)));
  const defv = Math.floor(def.base.def * lvm) + (eb.def || 0);
  const crit = Math.min(0.8, def.base.crit + (eb.crit || 0));
  const critDmg = def.base.critDmg + (eb.critDmg || 0);
  const ultGain = 1 + (eb.ultGain || 0);
  const power = Math.floor(atk * 6 + hp * 0.5 + defv * 4 + crit * 1000 + (critDmg - 1.5) * 500);
  return { hp, atk, def: defv, crit, critDmg, ultGain, spd: def.base.spd, power };
}
