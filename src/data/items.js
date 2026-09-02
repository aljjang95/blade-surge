// 장비·세트·강화 정의
export const SLOTS = ['weapon', 'armor', 'ring', 'boots'];
export const SLOT_NAME = { weapon: '무기', armor: '방어구', ring: '반지', boots: '신발' };

// 세트: 등급별 4피스. 2세트/4세트 효과
export const SETS = {
  N:   { id: 'recruit', name: '신병 세트',   icon: '/img/set_wind.webp',   two: { atk: 0.05 },              four: { atk: 0.10, hp: 0.10 } },
  R:   { id: 'merc',    name: '용병 세트',   icon: '/img/set_titan.webp',  two: { atk: 0.08, hp: 0.05 },    four: { atk: 0.15, hp: 0.15, crit: 0.05 } },
  SR:  { id: 'knight',  name: '기사단 세트', icon: '/img/set_abyss.webp',  two: { atk: 0.10, crit: 0.05 },  four: { atk: 0.22, hp: 0.20, crit: 0.08, critDmg: 0.2 } },
  SSR: { id: 'dragon',  name: '용살자 세트', icon: '/img/set_dragon.webp', two: { atk: 0.15, crit: 0.05 },  four: { atk: 0.35, hp: 0.30, crit: 0.12, critDmg: 0.5, ultGain: 0.3 } },
};

export const ITEM_POOL = {
  weapon: [
    { id: 'w_iron',   name: '철검',        rarity: 'N',   atk: 18 },
    { id: 'w_steel',  name: '강철 대검',   rarity: 'R',   atk: 40 },
    { id: 'w_flame',  name: '화염 검',     rarity: 'SR',  atk: 85, crit: 0.03 },
    { id: 'w_dragon', name: '용살자의 검', rarity: 'SSR', atk: 180, crit: 0.08 },
  ],
  armor: [
    { id: 'a_leather', name: '가죽 갑옷',   rarity: 'N',   hp: 120 },
    { id: 'a_chain',   name: '사슬 갑옷',   rarity: 'R',   hp: 280, def: 6 },
    { id: 'a_knight',  name: '기사의 판금', rarity: 'SR',  hp: 600, def: 14 },
    { id: 'a_titan',   name: '거인의 흉갑', rarity: 'SSR', hp: 1300, def: 30 },
  ],
  ring: [
    { id: 'r_copper', name: '구리 반지',   rarity: 'N',   atk: 8 },
    { id: 'r_silver', name: '은 반지',     rarity: 'R',   atk: 18, crit: 0.02 },
    { id: 'r_ruby',   name: '루비 반지',   rarity: 'SR',  atk: 40, crit: 0.05 },
    { id: 'r_abyss',  name: '심연의 반지', rarity: 'SSR', atk: 90, crit: 0.12 },
  ],
  boots: [
    { id: 'b_cloth',  name: '천 신발',     rarity: 'N',   hp: 60 },
    { id: 'b_swift',  name: '신속의 장화', rarity: 'R',   hp: 140, atk: 8 },
    { id: 'b_wind',   name: '바람의 장화', rarity: 'SR',  hp: 300, atk: 20 },
    { id: 'b_sky',    name: '천공의 장화', rarity: 'SSR', hp: 650, atk: 45, crit: 0.04 },
  ],
};
export const ITEM_BY_ID = {};
for (const s of SLOTS) for (const it of ITEM_POOL[s]) ITEM_BY_ID[it.id] = { ...it, slot: s, set: SETS[it.rarity].id };

export const ITEM_ICON = (item) => `/img/it_${item.slot}_${item.rarity.toLowerCase()}.webp`;
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
