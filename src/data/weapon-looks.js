// 무기 외형 규칙 (순수 데이터 — DOM·three 없이 테스트 가능).
// 같은 등급 무기도 이름에 맞는 속성색으로 빛나고, 등급이 오르면 영웅에 따라 무기 모양이 바뀐다(한손검→양손 대검 등).
// 강화 단계는 발광 세기와 오라로 보인다: +5 은은한 광, +10 속성색 오라, +15 금빛 오라, +20 신화 오라.
import { ITEM_BY_ID, RARITY_INFO } from './items.js';
import { GEAR_ITEMS } from './gear-catalog.js';
import { kitOf } from './heroes.js';

/** 영웅별 무기 모양 이름. key는 모델 안의 무기 노드. 드라칸 도끼는 한손·양손 메시가 같아 이름도 같다. */
export const WEAPON_FORMS = {
  knight: { '1H_Sword': '한손검', '2H_Sword': '양손 대검' },
  barbarian: { '1H_Axe': '전투도끼', '2H_Axe': '전투도끼' },
  mage: { '1H_Wand': '마법봉', '2H_Staff': '대마법 지팡이' },
  rogue: { Knife: '단검', Knife_Offhand: '쌍단검' },
  ranger: { Bow: '장궁' },
};

/** 무기 이름에 맞는 속성색. 목록에 없으면 등급색으로 빛난다. */
export const WEAPON_ELEMENT = {
  w_steel: ['#cfd8e3', '강철'], w_bronze: ['#d99a52', '청동'], w_hunter: ['#9bdc6a', '숲'], w_guard: ['#9fb4cc', '수비대'],
  w_flame: ['#ff6a2a', '불꽃'], w_frost: ['#8fe3ff', '서리'], w_rune: ['#ffd35a', '룬'], w_knight: ['#7fb8ff', '기사단 청광'],
  w_dragon: ['#ff5a2e', '용염'], w_sun: ['#ffd060', '태양'], w_king: ['#fff0a8', '성광'], sg_solar_grimoire: ['#ffd060', '태양'],
};
// 신규 무기는 표에 명시한 속성명만 쓴다. 아이템 이름을 속성으로 읽지 않는다.
for (const item of GEAR_ITEMS) if (item.slot === 'weapon') WEAPON_ELEMENT[item.id] = [item.look.weapon.palette.accent, item.look.weapon.element];

/**
 * 무기 강화 빛 단계(대표님 2026-10-27: 방어구 외형을 끄고 무기는 보이면서 강화가 오를수록 빛나는 것으로 차별점).
 * 위에서부터 처음 맞는 단계를 쓴다. emissive=무기 발광 가산, halo=칼날 광륜 불투명도, spark=초당 칼날 불씨 수,
 * sparkLife=불씨 수명(잔광), trail=휘두름 궤적 너비·수명 배율, color=발밑 고유 오라(null 이면 없음).
 * +0~5 는 등급 발광만 있고 강화 빛이 없다. 성능 예산은 docs/WEAPON_GLOW.md.
 */
export const ENHANCE_LOOK = [
  { min: 20, id: 'myth', name: '신화 오라', color: '#ff8af0', emissive: .5, halo: .9, haloScale: 1.45, spark: 14, sparkLife: 1.1, trail: 1.3 },
  { min: 15, id: 'aura', name: '금빛 오라', color: '#ffd060', emissive: .45, halo: .8, haloScale: 1.35, spark: 11, sparkLife: 1, trail: 1.25 },
  { min: 13, id: 'blaze', name: '강한 발광·잔광', color: null, emissive: .4, halo: .65, haloScale: 1.2, spark: 8, sparkLife: .9, trail: 1.2 },
  { min: 10, id: 'glow', name: '발광', color: null, emissive: .3, halo: .45, haloScale: 1, spark: 3.5, sparkLife: .5, trail: 1.08 },
  { min: 6, id: 'soft', name: '은은한 광', color: null, emissive: .15, halo: .25, haloScale: .85, spark: 0, sparkLife: 0, trail: 1 },
];
const NO_GLOW = Object.freeze({ min: 0, id: 'none', name: '', color: null, emissive: 0, halo: 0, haloScale: 0, spark: 0, sparkLife: 0, trail: 1 });
/** 강화 수치 → 빛 단계. 강화가 없거나 +5 이하면 'none'. */
export function weaponGlowTier(enh = 0) {
  const value = Math.max(0, Math.min(20, Math.floor(Number(enh) || 0)));
  return ENHANCE_LOOK.find((t) => value >= t.min) || NO_GLOW;
}
/** 미리보기에서 고를 수 있는 강화 단계(빛 단계마다 하나) */
export const ENHANCE_STEPS = [0, 6, 10, 13, 15, 20];

// 블룸 때문에 1.5를 넘으면 무기 형체가 뭉개진다 (look.js 주석 참조)
export const WEAPON_GLOW = { N: 0, S: 0.45, E: 0.75, U: 0.95, L: 1.15 };

/**
 * 영웅이 이 무기를 들면 어떻게 보이는지.
 * @param {string} heroId
 * @param {{id: string, enh?: number} | null | undefined} inst
 * @param {Record<string, {weapon: Record<string, string[]>}>} looks look.js LOOKS (영웅→등급→보일 무기 노드)
 */
export function weaponLook(rawHeroId, inst, looks) {
  const heroId = kitOf(rawHeroId); // 외형 표는 기준 영웅(kit) 것
  const it = inst ? ITEM_BY_ID[inst.id] : null;
  if (!it || it.slot !== 'weapon') return null;
  const enh = Math.max(0, Math.min(20, Math.floor(inst.enh || 0)));
  const [color, element] = WEAPON_ELEMENT[it.id] || [RARITY_INFO[it.rarity].color, RARITY_INFO[it.rarity].name];
  // 병기고 무기(modelNode)는 검성·드라칸에게 전용 메시가 붙으므로 KayKit 무기 노드표를 쓰지 않는다 (look.js와 같은 조건).
  const ownMesh = !!it.modelNode && ['knight', 'barbarian'].includes(heroId);
  const nodes = ownMesh ? [] : looks?.[heroId]?.weapon?.[it.rarity] || [];
  const forms = WEAPON_FORMS[heroId] || {};
  const offhand = nodes.find((n) => /Offhand$/.test(n) && forms[n]);
  // 소환 장비는 무기 모양이 아니라 함께 싸우는 수호체가 핵심이다.
  const form = it.summon ? it.summon.name + ' 소환' : ownMesh ? it.name + ' 전용 모델' : (offhand && forms[offhand]) || forms[nodes[0]] || '기본 무기';
  // 양손 무기는 방패를 내려놓는다 (검성의 양손 대검).
  const twoHanded = nodes.some((n) => /^2H_/.test(n));
  const tier = weaponGlowTier(enh);
  const glow = WEAPON_GLOW[it.rarity] + tier.emissive;
  // 발밑 오라는 +15 고유 오라부터. +10~14 는 칼날 광륜·불씨가 차이를 낸다.
  const aura = tier.color || null;
  return { id: it.id, name: it.name, rarity: it.rarity, enh, color, element, nodes, form, twoHanded, glow, tier: tier.name, glowTier: tier, aura };
}

/** 한 줄 설명. 예: "양손 대검 · 용염 발광 · +15 금빛 오라" */
export function weaponLookText(look) {
  if (!look) return '';
  return [look.form, look.glow > 0 ? look.element + ' 발광' : '발광 없음', look.tier ? '+' + look.enh + ' ' + look.tier : ''].filter(Boolean).join(' · ');
}
