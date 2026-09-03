// 장비·세트·강화 정의
export const SLOTS = ['weapon', 'armor', 'ring', 'boots'];
export const SLOT_NAME = { weapon: '무기', armor: '방어구', ring: '반지', boots: '신발' };

// 세트 — 두 계열
//  · 등급 세트(recruit/merc/knight/dragon): 등급이 같으면 자동으로 묶인다. 스탯형
//  · 테마 세트(storm/blood/gravity/phoenix): SR 전용 4피스. 2/4세트가 **플레이 방식을 바꾸는 발동 효과**를 연다 (PRD §4-3)
export const SETS = {
  recruit: { id: 'recruit', name: '신병 세트',   icon: '/img/set_wind.webp',   two: { atk: 0.05 },              four: { atk: 0.10, hp: 0.10 } },
  merc:    { id: 'merc',    name: '용병 세트',   icon: '/img/set_titan.webp',  two: { atk: 0.08, hp: 0.05 },    four: { atk: 0.15, hp: 0.15, crit: 0.05 } },
  knight:  { id: 'knight',  name: '기사단 세트', icon: '/img/set_abyss.webp',  two: { atk: 0.10, crit: 0.05 },  four: { atk: 0.22, hp: 0.20, crit: 0.08, critDmg: 0.2 } },
  dragon:  { id: 'dragon',  name: '용살자 세트', icon: '/img/set_dragon.webp', two: { atk: 0.15, crit: 0.05 },  four: { atk: 0.35, hp: 0.30, crit: 0.12, critDmg: 0.5, ultGain: 0.3 } },
  storm:   { id: 'storm',   name: '폭풍 세트',   icon: '/img/set_storm.webp',   color: 0x7fd9ff, themed: true,
             two:  { procs: ['storm_chain'], text: '콤보 마무리 타격이 명중하면 번개 사슬이 적 3명을 연쇄 타격' },
             four: { procs: ['storm_chain', 'storm_dash'], text: '회피 직후 3초간 공격속도 +40%, 회피 경로에 낙뢰' } },
  blood:   { id: 'blood',   name: '흡혈 세트',   icon: '/img/set_blood.webp',   color: 0xff3a5a, themed: true,
             two:  { procs: ['blood_leech'], text: '처치할 때마다 최대 HP의 3% 회복' },
             four: { procs: ['blood_leech', 'blood_rage'], text: 'HP 50% 이하일 때 공격력 +50%, 피격 시 피의 폭발로 주변을 밀쳐냄' } },
  gravity: { id: 'gravity', name: '중력 세트',   icon: '/img/set_gravity.webp', color: 0xb26bff, themed: true,
             two:  { procs: ['gravity_pull'], text: '기본 콤보의 진공 범위·흡인력 2배' },
             four: { procs: ['gravity_pull', 'gravity_hole'], text: '스킬을 쓰면 그 자리에 2초간 특이점 — 반경 7의 적을 빨아들임' } },
  phoenix: { id: 'phoenix', name: '불사조 세트', icon: '/img/set_phoenix.webp', color: 0xffa040, themed: true,
             two:  { ultGain: 0.3, procs: ['phoenix_burn'], text: '궁극기 수급 +30%, 궁극기 시전 시 불사조 화염 폭발' },
             four: { ultGain: 0.3, procs: ['phoenix_burn', 'phoenix_rebirth'], text: '층당 1회, 쓰러지면 불사조가 되어 HP 50%로 부활' } },
};
export const RARITY_SET = { N: 'recruit', R: 'merc', SR: 'knight', SSR: 'dragon' };
export const THEMED_SETS = ['storm', 'blood', 'gravity', 'phoenix'];

export const ITEM_POOL = {
  weapon: [
    { id: 'w_iron',   name: '철검',        rarity: 'N',   atk: 18 },
    { id: 'w_steel',  name: '강철 대검',   rarity: 'R',   atk: 40 },
    { id: 'w_flame',  name: '화염 검',     rarity: 'SR',  atk: 85, crit: 0.03 },
    { id: 'w_dragon', name: '용살자의 검', rarity: 'SSR', atk: 180, crit: 0.08 },
    { id: 'w_storm',   name: '뇌명검',       rarity: 'SR', set: 'storm',   atk: 80, crit: 0.04, icon: '/img/it_storm_weapon.webp' },
    { id: 'w_blood',   name: '흡혈귀의 송곳니', rarity: 'SR', set: 'blood', atk: 92, icon: '/img/it_blood_weapon.webp' },
    { id: 'w_gravity', name: '특이점 대검',   rarity: 'SR', set: 'gravity', atk: 78, crit: 0.03, icon: '/img/it_gravity_weapon.webp' },
    { id: 'w_phoenix', name: '불사조의 검',   rarity: 'SR', set: 'phoenix', atk: 84, crit: 0.05, icon: '/img/it_phoenix_weapon.webp' },
  ],
  armor: [
    { id: 'a_leather', name: '가죽 갑옷',   rarity: 'N',   hp: 120 },
    { id: 'a_chain',   name: '사슬 갑옷',   rarity: 'R',   hp: 280, def: 6 },
    { id: 'a_knight',  name: '기사의 판금', rarity: 'SR',  hp: 600, def: 14 },
    { id: 'a_titan',   name: '거인의 흉갑', rarity: 'SSR', hp: 1300, def: 30 },
    { id: 'a_storm',   name: '뇌운 갑주',     rarity: 'SR', set: 'storm',   hp: 540, def: 12, icon: '/img/it_storm_armor.webp' },
    { id: 'a_blood',   name: '핏빛 흉갑',     rarity: 'SR', set: 'blood',   hp: 680, def: 10, icon: '/img/it_blood_armor.webp' },
    { id: 'a_gravity', name: '암흑 물질 갑옷', rarity: 'SR', set: 'gravity', hp: 600, def: 16, icon: '/img/it_gravity_armor.webp' },
    { id: 'a_phoenix', name: '불사조 깃털 갑옷', rarity: 'SR', set: 'phoenix', hp: 560, def: 13, icon: '/img/it_phoenix_armor.webp' },
  ],
  ring: [
    { id: 'r_copper', name: '구리 반지',   rarity: 'N',   atk: 8 },
    { id: 'r_silver', name: '은 반지',     rarity: 'R',   atk: 18, crit: 0.02 },
    { id: 'r_ruby',   name: '루비 반지',   rarity: 'SR',  atk: 40, crit: 0.05 },
    { id: 'r_abyss',  name: '심연의 반지', rarity: 'SSR', atk: 90, crit: 0.12 },
    { id: 'r_storm',   name: '뇌전의 고리',   rarity: 'SR', set: 'storm',   atk: 38, crit: 0.06, icon: '/img/it_storm_ring.webp' },
    { id: 'r_blood',   name: '피의 서약 반지', rarity: 'SR', set: 'blood',   atk: 44, crit: 0.03, icon: '/img/it_blood_ring.webp' },
    { id: 'r_gravity', name: '사건의 지평선', rarity: 'SR', set: 'gravity', atk: 36, crit: 0.05, icon: '/img/it_gravity_ring.webp' },
    { id: 'r_phoenix', name: '잿불 반지',     rarity: 'SR', set: 'phoenix', atk: 40, crit: 0.05, icon: '/img/it_phoenix_ring.webp' },
  ],
  boots: [
    { id: 'b_cloth',  name: '천 신발',     rarity: 'N',   hp: 60 },
    { id: 'b_swift',  name: '신속의 장화', rarity: 'R',   hp: 140, atk: 8 },
    { id: 'b_wind',   name: '바람의 장화', rarity: 'SR',  hp: 300, atk: 20 },
    { id: 'b_sky',    name: '천공의 장화', rarity: 'SSR', hp: 650, atk: 45, crit: 0.04 },
    { id: 'b_storm',   name: '번개 걸음',     rarity: 'SR', set: 'storm',   hp: 280, atk: 22, icon: '/img/it_storm_boots.webp' },
    { id: 'b_blood',   name: '피 웅덩이 장화', rarity: 'SR', set: 'blood',   hp: 340, atk: 16, icon: '/img/it_blood_boots.webp' },
    { id: 'b_gravity', name: '무중력 장화',   rarity: 'SR', set: 'gravity', hp: 300, atk: 18, icon: '/img/it_gravity_boots.webp' },
    { id: 'b_phoenix', name: '불새의 발톱',   rarity: 'SR', set: 'phoenix', hp: 290, atk: 21, icon: '/img/it_phoenix_boots.webp' },
  ],
};
export const ITEM_BY_ID = {};
for (const s of SLOTS) for (const it of ITEM_POOL[s]) ITEM_BY_ID[it.id] = { ...it, slot: s, set: it.set || RARITY_SET[it.rarity] };
/** 세트 조각으로 제작 가능한 테마 세트 장비 (세트id → 슬롯 → 아이템 def) */
export const CRAFT_COST = 30;   // 세트 조각
export const craftable = (setId, slot) => ITEM_POOL[slot].find((it) => it.set === setId);

export const ITEM_ICON = (item) => item.icon || `/img/it_${item.slot}_${item.rarity.toLowerCase()}.webp`;
export const RARITY_COLOR = { N: '#9aa3b2', R: '#4cc3ff', SR: '#b26bff', SSR: '#ffcf5a' };

// ---------- 강화 (+0 ~ +20) ----------
export const ENH_MAX = 20;
/** 성공 확률: +8까지 100%, 이후 감소 */
export const enhanceChance = (lv) => lv < 8 ? 1 : lv < 12 ? 0.7 - (lv - 8) * 0.05 : lv < 16 ? 0.45 - (lv - 12) * 0.05 : 0.25 - (lv - 16) * 0.03;
/** 실패 시 파괴 확률 (+12 이상). 보호 주문서로 0 */
export const destroyChance = (lv) => lv < 12 ? 0 : lv < 16 ? 0.1 : 0.25;
/** 실패 시 단계 하락 (+8~+11: 0, +12~: 1) */
export const enhanceCost = (lv) => Math.floor(300 * Math.pow(1.32, lv));
export const enhanceStones = (lv) => lv < 5 ? 0 : lv < 10 ? 1 : lv < 15 ? 3 : 6;
/** 강화석 등급 — 비석 3종: +9까지 하급(stones), +14까지 중급(stones2), 그 위는 상급(stones3) */
export const enhanceStoneTier = (lv) => lv < 10 ? 1 : lv < 15 ? 2 : 3;
export const STONE_KEY = { 1: 'stones', 2: 'stones2', 3: 'stones3' };
export const STONE_NAME = { 1: '강화석', 2: '상급 강화석', 3: '전설 강화석' };
export const STONE_ICON = { 1: '/img/icon_stone_1.webp', 2: '/img/icon_stone_2.webp', 3: '/img/icon_stone_3.webp' };
export const enhanceMult = (lv) => 1 + lv * 0.12 + (lv >= 10 ? 0.2 : 0) + (lv >= 15 ? 0.3 : 0) + (lv >= 20 ? 0.5 : 0);
export const ENH_TIER = (lv) => lv >= 20 ? 'mythic' : lv >= 15 ? 'legend' : lv >= 10 ? 'epic' : lv >= 5 ? 'rare' : '';

export function itemStats(inst) {
  const def = ITEM_BY_ID[inst.id];
  const m = enhanceMult(inst.enh || 0);
  return { atk: Math.floor((def.atk || 0) * m), hp: Math.floor((def.hp || 0) * m), def: Math.floor((def.def || 0) * m), crit: def.crit || 0 };
}

export const RARITY_WEIGHT_STAGE = { N: 62, R: 28, SR: 9, SSR: 1 };
export const RARITY_WEIGHT_ELITE = { N: 10, R: 55, SR: 30, SSR: 5 };
export const RARITY_WEIGHT_BOSS  = { N: 0, R: 40, SR: 45, SSR: 15 };
export const RARITY_WEIGHT_GACHA = { R: 86, SR: 12, SSR: 2 };
