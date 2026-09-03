// 장비·세트·강화 정의
export const SLOTS = ['weapon', 'armor', 'ring', 'boots'];
export const SLOT_NAME = { weapon: '무기', armor: '방어구', ring: '반지', boots: '신발' };

// 세트 — 두 계열
//  · 등급 세트(recruit/merc/knight/dragon): 등급이 같으면 자동으로 묶인다. 스탯형
//  · 테마 세트 8종(폭풍·흡혈·중력·불사조·서리결정·역병포자·룬각인·심연사슬): 유니크 4피스.
//    2/4세트가 **플레이 방식을 바꾸는 발동 효과**를 연다 (PRD §4-3). 스탯만 주는 테마 세트는 만들지 않는다
export const SETS = {
  recruit: { id: 'recruit', name: '신병 세트',   icon: '/img/set_wind.webp',   two: { atk: 0.05 },              four: { atk: 0.10, hp: 0.10 } },
  merc:    { id: 'merc',    name: '용병 세트',   icon: '/img/set_titan.webp',  two: { atk: 0.08, hp: 0.05 },    four: { atk: 0.15, hp: 0.15, crit: 0.05 } },
  knight:  { id: 'knight',  name: '기사단 세트', icon: '/img/set_abyss.webp',  two: { atk: 0.10, crit: 0.05 },  four: { atk: 0.22, hp: 0.20, crit: 0.08, critDmg: 0.2 } },
  dragon:  { id: 'dragon',  name: '용살자 세트', icon: '/img/set_dragon.webp', two: { atk: 0.15, crit: 0.05 },  four: { atk: 0.35, hp: 0.30, crit: 0.12, critDmg: 0.5, ultGain: 0.3 } },
  storm:   { id: 'storm',   name: '폭풍 세트',   icon: '/img/set_storm.webp',   color: 0x7fd9ff, themed: true, voiced: true,
             two:  { procs: ['storm_chain'], text: '콤보 마무리 타격이 명중하면 번개 사슬이 적 3명을 연쇄 타격' },
             four: { procs: ['storm_chain', 'storm_dash'], text: '회피 직후 3초간 공격속도 +40%, 회피 경로에 낙뢰' } },
  blood:   { id: 'blood',   name: '흡혈 세트',   icon: '/img/set_blood.webp',   color: 0xff3a5a, themed: true, voiced: true,
             two:  { procs: ['blood_leech'], text: '처치할 때마다 최대 HP의 3% 회복' },
             four: { procs: ['blood_leech', 'blood_rage'], text: 'HP 50% 이하일 때 공격력 +50%, 피격 시 피의 폭발로 주변을 밀쳐냄' } },
  gravity: { id: 'gravity', name: '중력 세트',   icon: '/img/set_gravity.webp', color: 0xb26bff, themed: true, voiced: true,
             two:  { procs: ['gravity_pull'], text: '기본 콤보의 진공 범위·흡인력 2배' },
             four: { procs: ['gravity_pull', 'gravity_hole'], text: '스킬을 쓰면 그 자리에 2초간 특이점 — 반경 7의 적을 빨아들임' } },
  phoenix: { id: 'phoenix', name: '불사조 세트', icon: '/img/set_phoenix.webp', color: 0xffa040, themed: true, voiced: true,
             two:  { ultGain: 0.3, procs: ['phoenix_burn'], text: '궁극기 수급 +30%, 궁극기 시전 시 불사조 화염 폭발' },
             four: { ultGain: 0.3, procs: ['phoenix_burn', 'phoenix_rebirth'], text: '층당 1회, 쓰러지면 불사조가 되어 HP 50%로 부활' } },
  frost:   { id: 'frost',   name: '서리결정 세트', icon: '/img/set_frost.webp',   color: 0x8fd8e8, themed: true,
             two:  { procs: ['frost_shatter'], text: '타격마다 서리 중첩 — 5중첩에서 적이 결정화되어 멈추고, 그 상태로 죽으면 파편이 터진다' },
             four: { procs: ['frost_shatter', 'frost_pillar'], text: '결정이 깨진 자리에 6초간 얼음 기둥이 서서 적을 밀어낸다. 기둥이 무너지며 냉기 폭발' } },
  plague:  { id: 'plague',  name: '역병포자 세트', icon: '/img/set_plague.webp',  color: 0x9ade5a, themed: true,
             two:  { procs: ['plague_spore'], text: '처치한 자리에 포자 구름 — 구름 안에서 또 죽이면 전염되어 구름이 자란다' },
             four: { procs: ['plague_spore', 'plague_bloom'], text: '구름이 반경 6까지 자라면 역병 개화 — 구름 전체가 폭발한다' } },
  rune:    { id: 'rune',    name: '룬각인 세트',   icon: '/img/set_rune.webp',    color: 0xffc94a, themed: true,
             two:  { procs: ['rune_charge'], text: '콤보가 맞을 때마다 룬 장전(최대 6). 회피하면 장전된 만큼 유도 참격이 쏟아진다' },
             four: { procs: ['rune_charge', 'rune_overload'], text: '만장전(6)에서 스킬을 쓰면 과부하 — 룬을 태우고 그 스킬의 쿨타임이 0이 된다' } },
  tether:  { id: 'tether',  name: '심연사슬 세트', icon: '/img/set_tether.webp',  color: 0x50f0d0, themed: true,
             two:  { procs: ['abyss_tether'], text: '락온한 적과 심연의 사슬로 이어진다 — 사슬에 닿는 적이 베이고 느려진다' },
             four: { procs: ['abyss_tether', 'abyss_reel'], text: '사슬이 걸린 채 회피하면 사슬을 감아 — 닿은 적을 전부 내 쪽으로 끌어온다' } },
};
// ---------- 등급 5단계 (던파식) ----------
export const RARITIES = ['N', 'S', 'E', 'U', 'L'];
export const RARITY_INFO = {
  N: { name: '노말',     color: '#e6e6e6', mult: 1.0, sell: 200 },
  S: { name: '스페셜',   color: '#5ce07a', mult: 1.6, sell: 900 },
  E: { name: '에픽',     color: '#4cc3ff', mult: 2.6, sell: 4000 },
  U: { name: '유니크',   color: '#c07cff', mult: 3.6, sell: 12000 },
  L: { name: '레전드리', color: '#ff9a2e', mult: 5.5, sell: 40000 },
};
export const RARITY_SET = { N: 'recruit', S: 'merc', E: 'knight', U: null, L: 'dragon' };
export const THEMED_SETS = ['storm', 'blood', 'gravity', 'phoenix', 'frost', 'plague', 'rune', 'tether'];
// 가챠(영웅 등급 R/SR/SSR)에서 장비가 나올 때의 등급 대응
export const GACHA_ITEM_RARITY = { R: 'S', SR: 'E', SSR: 'L' };

// 슬롯별 기준치 — 강화가 등급과 무관하게 이 값을 기준으로 붙는다 (구린 무기도 고강이면 세다)
export const SLOT_BASE = { weapon: { atk: 20 }, armor: { hp: 130, def: 3 }, ring: { atk: 9, crit: 0 }, boots: { hp: 65, atk: 4 } };

// 아이템: 슬롯당 N4 · S4 · E4 · U(테마 4 + 단독 1) · L3.  mult 는 RARITY_INFO.mult 를 기본으로, 개별 보정(k)
const W = (id, name, rarity, k = 1, extra = {}) => ({ id, name, rarity, atk: Math.round(SLOT_BASE.weapon.atk * RARITY_INFO[rarity].mult * k), ...extra });
const A = (id, name, rarity, k = 1, extra = {}) => ({ id, name, rarity, hp: Math.round(SLOT_BASE.armor.hp * RARITY_INFO[rarity].mult * k), def: Math.round(SLOT_BASE.armor.def * RARITY_INFO[rarity].mult * k), ...extra });
const R = (id, name, rarity, k = 1, extra = {}) => ({ id, name, rarity, atk: Math.round(SLOT_BASE.ring.atk * RARITY_INFO[rarity].mult * k), ...extra });
const B = (id, name, rarity, k = 1, extra = {}) => ({ id, name, rarity, hp: Math.round(SLOT_BASE.boots.hp * RARITY_INFO[rarity].mult * k), atk: Math.round(SLOT_BASE.boots.atk * RARITY_INFO[rarity].mult * k), ...extra });
export const ITEM_POOL = {
  weapon: [
    W('w_iron', '철검', 'N'), W('w_rusty', '녹슨 장검', 'N', 0.9), W('w_wood', '훈련용 목검', 'N', 0.8, { crit: 0.01 }), W('w_cleaver', '푸줏간 식칼', 'N', 1.1),
    W('w_steel', '강철 대검', 'S'), W('w_bronze', '청동 곡도', 'S', 0.95, { crit: 0.02 }), W('w_hunter', '사냥꾼의 검', 'S', 1.05), W('w_guard', '수비대 장검', 'S', 0.9, { crit: 0.03 }),
    W('w_flame', '화염 검', 'E', 1, { crit: 0.03 }), W('w_frost', '서리 검', 'E', 0.95, { crit: 0.05 }), W('w_rune', '룬 각인 검', 'E', 1.05), W('w_knight', '기사단 장검', 'E', 1, { crit: 0.04 }),
    W('w_storm', '뇌명검', 'U', 1, { set: 'storm', crit: 0.04, icon: '/img/it_storm_weapon.webp' }),
    W('w_blood', '흡혈귀의 송곳니', 'U', 1.1, { set: 'blood', icon: '/img/it_blood_weapon.webp' }),
    W('w_gravity', '특이점 대검', 'U', 0.95, { set: 'gravity', crit: 0.03, icon: '/img/it_gravity_weapon.webp' }),
    W('w_phoenix', '불사조의 검', 'U', 1, { set: 'phoenix', crit: 0.05, icon: '/img/it_phoenix_weapon.webp' }),
    W('w_rime', '한설검', 'U', 1, { set: 'frost', crit: 0.04, icon: '/img/it_frost_weapon.webp' }),
    W('w_plague', '역병의 낫', 'U', 1.05, { set: 'plague', icon: '/img/it_plague_weapon.webp' }),
    W('w_sigil', '각인 대검', 'U', 1.1, { set: 'rune', crit: 0.03, icon: '/img/it_rune_weapon.webp' }),
    W('w_chain', '심연의 사슬검', 'U', 1, { set: 'tether', crit: 0.05, icon: '/img/it_tether_weapon.webp' }),
    W('w_void', '공허의 조각검', 'U', 1.15, { crit: 0.08 }),
    W('w_dragon', '용살자의 검', 'L', 1, { crit: 0.08 }), W('w_sun', '태양의 대검', 'L', 1.08, { crit: 0.06 }), W('w_king', '왕의 성검', 'L', 0.95, { crit: 0.12 }),
  ],
  armor: [
    A('a_leather', '가죽 갑옷', 'N'), A('a_cloth', '누더기 로브', 'N', 0.85), A('a_padded', '누빔 갑옷', 'N', 1.05), A('a_scrap', '고철 흉갑', 'N', 1.1),
    A('a_chain', '사슬 갑옷', 'S'), A('a_scale', '비늘 갑옷', 'S', 1.05), A('a_ranger', '순찰자의 가죽옷', 'S', 0.9, { crit: 0.02 }), A('a_bronze', '청동 흉갑', 'S', 1.1),
    A('a_knight', '기사의 판금', 'E'), A('a_mithril', '미스릴 사슬', 'E', 0.95, { crit: 0.03 }), A('a_wyvern', '와이번 가죽 갑옷', 'E', 1.05), A('a_paladin', '성기사 갑주', 'E', 1.1),
    A('a_storm', '뇌운 갑주', 'U', 1, { set: 'storm', icon: '/img/it_storm_armor.webp' }),
    A('a_blood', '핏빛 흉갑', 'U', 1.1, { set: 'blood', icon: '/img/it_blood_armor.webp' }),
    A('a_gravity', '암흑 물질 갑옷', 'U', 1.05, { set: 'gravity', icon: '/img/it_gravity_armor.webp' }),
    A('a_phoenix', '불사조 깃털 갑옷', 'U', 0.95, { set: 'phoenix', icon: '/img/it_phoenix_armor.webp' }),
    A('a_rime', '결정 갑주', 'U', 1.05, { set: 'frost', icon: '/img/it_frost_armor.webp' }),
    A('a_plague', '포자 외피', 'U', 1.1, { set: 'plague', icon: '/img/it_plague_armor.webp' }),
    A('a_sigil', '룬각인 흉갑', 'U', 1, { set: 'rune', icon: '/img/it_rune_armor.webp' }),
    A('a_bind', '결속 갑주', 'U', 1.05, { set: 'tether', icon: '/img/it_tether_armor.webp' }),
    A('a_void', '공허의 갑주', 'U', 1.15),
    A('a_titan', '거인의 흉갑', 'L'), A('a_sun', '태양의 판금', 'L', 1.08), A('a_king', '왕의 갑주', 'L', 0.95, { crit: 0.04 }),
  ],
  ring: [
    R('r_copper', '구리 반지', 'N'), R('r_bone', '뼈 반지', 'N', 0.9), R('r_wood', '나무 반지', 'N', 0.85, { crit: 0.01 }), R('r_iron', '철 반지', 'N', 1.1),
    R('r_silver', '은 반지', 'S', 1, { crit: 0.02 }), R('r_jade', '옥 반지', 'S', 0.95, { crit: 0.03 }), R('r_amber', '호박 반지', 'S', 1.05), R('r_pearl', '진주 반지', 'S', 0.9, { crit: 0.04 }),
    R('r_ruby', '루비 반지', 'E', 1, { crit: 0.05 }), R('r_sapphire', '사파이어 반지', 'E', 0.95, { crit: 0.06 }), R('r_emerald', '에메랄드 반지', 'E', 1.05, { crit: 0.03 }), R('r_moon', '달빛 반지', 'E', 1, { crit: 0.05 }),
    R('r_storm', '뇌전의 고리', 'U', 1, { set: 'storm', crit: 0.06, icon: '/img/it_storm_ring.webp' }),
    R('r_blood', '피의 서약 반지', 'U', 1.1, { set: 'blood', crit: 0.03, icon: '/img/it_blood_ring.webp' }),
    R('r_gravity', '사건의 지평선', 'U', 0.95, { set: 'gravity', crit: 0.05, icon: '/img/it_gravity_ring.webp' }),
    R('r_phoenix', '잿불 반지', 'U', 1, { set: 'phoenix', crit: 0.05, icon: '/img/it_phoenix_ring.webp' }),
    R('r_rime', '설화의 반지', 'U', 1, { set: 'frost', crit: 0.05, icon: '/img/it_frost_ring.webp' }),
    R('r_plague', '창궐의 인장', 'U', 1.05, { set: 'plague', crit: 0.03, icon: '/img/it_plague_ring.webp' }),
    R('r_sigil', '장전의 고리', 'U', 1, { set: 'rune', crit: 0.06, icon: '/img/it_rune_ring.webp' }),
    R('r_chain', '심연의 고리', 'U', 1.05, { set: 'tether', crit: 0.04, icon: '/img/it_tether_ring.webp' }),
    R('r_void', '공허의 인장', 'U', 1.1, { crit: 0.1 }),
    R('r_abyss', '심연의 반지', 'L', 1, { crit: 0.12 }), R('r_sun', '태양의 인장', 'L', 1.08, { crit: 0.1 }), R('r_king', '왕의 반지', 'L', 0.95, { crit: 0.15 }),
  ],
  boots: [
    B('b_cloth', '천 신발', 'N'), B('b_straw', '짚신', 'N', 0.85), B('b_worn', '해진 가죽 장화', 'N', 1.05), B('b_wooden', '나막신', 'N', 0.95),
    B('b_swift', '신속의 장화', 'S'), B('b_ranger', '순찰자의 장화', 'S', 1.05), B('b_chain', '사슬 각반', 'S', 1.1), B('b_silk', '비단 신발', 'S', 0.9, { crit: 0.02 }),
    B('b_wind', '바람의 장화', 'E'), B('b_knight', '기사의 철화', 'E', 1.1), B('b_shadow', '그림자 장화', 'E', 0.95, { crit: 0.04 }), B('b_mithril', '미스릴 장화', 'E', 1.05),
    B('b_storm', '번개 걸음', 'U', 1, { set: 'storm', icon: '/img/it_storm_boots.webp' }),
    B('b_blood', '피 웅덩이 장화', 'U', 1.1, { set: 'blood', icon: '/img/it_blood_boots.webp' }),
    B('b_gravity', '무중력 장화', 'U', 1, { set: 'gravity', icon: '/img/it_gravity_boots.webp' }),
    B('b_phoenix', '불새의 발톱', 'U', 0.95, { set: 'phoenix', icon: '/img/it_phoenix_boots.webp' }),
    B('b_rime', '빙결 각반', 'U', 1, { set: 'frost', icon: '/img/it_frost_boots.webp' }),
    B('b_plague', '균사 장화', 'U', 1.05, { set: 'plague', icon: '/img/it_plague_boots.webp' }),
    B('b_sigil', '주문 새김 장화', 'U', 1.1, { set: 'rune', icon: '/img/it_rune_boots.webp' }),
    B('b_bind', '결속 각반', 'U', 1, { set: 'tether', icon: '/img/it_tether_boots.webp' }),
    B('b_void', '공허의 장화', 'U', 1.15, { crit: 0.03 }),
    B('b_sky', '천공의 장화', 'L', 1, { crit: 0.04 }), B('b_sun', '태양의 장화', 'L', 1.08), B('b_king', '왕의 장화', 'L', 0.95, { crit: 0.06 }),
  ],
};
export const ITEM_BY_ID = {};
for (const s of SLOTS) { const seen = {}; ITEM_POOL[s].forEach((it) => {
  const k = seen[it.rarity] = (seen[it.rarity] ?? -1) + 1;   // 등급 안에서 몇 번째 디자인인지 → 시트 아이콘
  const sheetIcon = it.set ? null : it.rarity === 'U' ? `/img/it_u_${s}.webp` : `/img/it_${it.rarity.toLowerCase()}_${s}_${Math.min(3, k)}.webp`;
  ITEM_BY_ID[it.id] = { ...it, slot: s, set: it.set || RARITY_SET[it.rarity] || null, variant: k, sheetIcon };
}); }
/** 등급별 아이템 목록 */
export const ITEMS_OF = (rarity, slot = null) => Object.values(ITEM_BY_ID).filter((it) => it.rarity === rarity && (!slot || it.slot === slot));
/** 등급 순서 인덱스 (정렬용) */
export const rarityRank = (r) => RARITIES.indexOf(r);
/** 세트 조각으로 제작 가능한 테마 세트 장비 (세트id → 슬롯 → 아이템 def) */
export const CRAFT_COST = 30;   // 세트 조각
export const craftable = (setId, slot) => ITEM_POOL[slot].find((it) => it.set === setId);

// 아이콘: 명시 → 등급 시트(it_<등급>_<슬롯>_<n>) → 옛 등급 아이콘 폴백
const LEGACY_ICON = { N: 'n', S: 'r', E: 'sr', U: 'sr', L: 'ssr' };
export const ITEM_ICON = (item) => item.icon || (item.sheetIcon ? item.sheetIcon : `/img/it_${item.slot}_${LEGACY_ICON[item.rarity] || 'n'}.webp`);
export const RARITY_COLOR = { N: RARITY_INFO.N.color, S: RARITY_INFO.S.color, E: RARITY_INFO.E.color, U: RARITY_INFO.U.color, L: RARITY_INFO.L.color };

// ---------- 강화 (+0 ~ +20, 던파식) ----------
// 핵심: 강화 보너스는 등급이 아니라 **슬롯 기준치(SLOT_BASE)** 에 붙는다. 흰 무기 +10 이 레전드리 +0 보다 세다.
export const ENH_MAX = 20;
/** 성공 확률 */
export const enhanceChance = (lv) => lv < 8 ? 1 : ({ 8: 0.85, 9: 0.75, 10: 0.65, 11: 0.5, 12: 0.4, 13: 0.3, 14: 0.25, 15: 0.2, 16: 0.15, 17: 0.13, 18: 0.11, 19: 0.09 }[lv] ?? 0.08);
/** 실패 시 파괴 확률 (+12 이상). 보호 주문서로 0 */
export const destroyChance = (lv) => lv < 12 ? 0 : lv < 15 ? 0.1 : 0.2;
/** 실패 시 단계 하락: +10 이상에서 1 (던파 +11↑ 하락에 해당) */
export const enhanceDown = (lv) => lv >= 10 ? 1 : 0;
export const enhanceCost = (lv) => Math.floor(250 * Math.pow(1.3, lv));
export const enhanceStones = (lv) => lv < 3 ? 0 : lv < 8 ? 1 : lv < 12 ? 2 : lv < 16 ? 3 : 5;
/** 강화석 등급 — 비석 3종: +9까지 하급(stones), +14까지 중급(stones2), 그 위는 상급(stones3) */
export const enhanceStoneTier = (lv) => lv < 10 ? 1 : lv < 15 ? 2 : 3;
export const STONE_KEY = { 1: 'stones', 2: 'stones2', 3: 'stones3' };
export const STONE_NAME = { 1: '강화석', 2: '상급 강화석', 3: '전설 강화석' };
export const STONE_ICON = { 1: '/img/icon_stone_1.webp', 2: '/img/icon_stone_2.webp', 3: '/img/icon_stone_3.webp' };
/** 강화 단위 누적 — 단계가 오를수록 한 단계의 가치가 커진다 (+10 = 17, +12 = 25, +15 = 40, +20 = 81) */
const ENH_STEP = [0, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 7, 7, 7, 10, 10];
export const enhanceUnits = (lv) => { let u = 0; for (let i = 1; i <= Math.min(ENH_MAX, lv); i++) u += ENH_STEP[i]; return u; };
/** 기본 스탯 배율(약하게) — 등급 차이는 유지하되 강화 플랫 보너스가 주역 */
export const enhanceMult = (lv) => 1 + lv * 0.05;
export const ENH_TIER = (lv) => lv >= 20 ? 'mythic' : lv >= 15 ? 'legend' : lv >= 10 ? 'epic' : lv >= 5 ? 'rare' : '';

export function itemStats(inst) {
  const def = ITEM_BY_ID[inst.id]; const lv = inst.enh || 0;
  const m = enhanceMult(lv), u = enhanceUnits(lv), sb = SLOT_BASE[def.slot];
  return {
    atk: Math.floor((def.atk || 0) * m + (sb.atk || 0) * u * 0.6),
    hp: Math.floor((def.hp || 0) * m + (sb.hp || 0) * u * 0.6),
    def: Math.floor((def.def || 0) * m + (sb.def || 0) * u * 0.5),
    crit: def.crit || 0,
  };
}

// 드랍 등급 가중치 — 좋은 건 드물어야 좋은 것이다. 잡몹은 흰·초록, 유니크·레전드리는 보스에서나
export const RARITY_WEIGHT_STAGE = { N: 70, S: 24, E: 5.5, U: 0.4, L: 0.1 };
export const RARITY_WEIGHT_ELITE = { N: 25, S: 50, E: 20, U: 4, L: 1 };
export const RARITY_WEIGHT_BOSS  = { N: 0, S: 35, E: 45, U: 15, L: 5 };
export const RARITY_WEIGHT_GACHA = { R: 86, SR: 12, SSR: 2 };
