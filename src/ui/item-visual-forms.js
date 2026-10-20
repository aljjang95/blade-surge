// 영웅 문맥의 장비 외형 해석(순수 · DOM/three 없음). 목록 썸네일 · 선택 3D · 캡션이 같은 결과를 쓴다.
// 실제 장착 규칙은 tools/item-visual-forms.mjs 가 look.js LOOKS → ITEM_WEAPON_FORMS 와 병기고 판정에서 생성한
// src/data/item-presentation-forms.json 으로 읽는다. 테스트가 이 표를 실제 LOOKS 와 비교해 어긋남을 막는다.
//  - 영웅 문맥이 없으면(도감 · 소환 구성품) 기본 형태: 일반 무기 = 한손검, 병기고 = 원본 모델.
//  - 영웅 문맥이 있으면 그 영웅이 실제로 드는 형태: 활 · 지팡이 · 양손 대검 · 쌍단검 등.
//  - 병기고 무기: 검성 · 드라칸은 전용 모델을 손에 들고, 나머지는 기본 무기를 유지한 채 병기고 장식을 함께 착용한다.
import FORMS from '../data/item-presentation-forms.json';
import { HEROES } from '../data/heroes.js';

/** @typedef {'canonical'|'hero-form'|'armory-own'|'armory-ornament'} ItemFormVariant */
/**
 * @typedef {{ itemId: string|null, heroId: string|null, contextual: boolean, variant: ItemFormVariant, form: string, count: number,
 *   formKey: string, label: string, nodes: string[], renderKey: string|null }} ItemFormResolution
 */

export const ITEM_FORM_LABEL = Object.freeze({ ...FORMS.formLabels });
export const CANONICAL_WEAPON_FORM = FORMS.canonicalWeaponForm;
const SLOT_FORM_LABEL = Object.freeze({ armor: '방어구', ring: '반지', boots: '신발' });
const heroEntry = (heroId) => (typeof heroId === 'string' && Object.hasOwn(FORMS.heroes, heroId) ? FORMS.heroes[heroId] : null);
const formKeyOf = (form, count) => (count > 1 ? form + '-pair' : form);

/** 형태 표에 있는 영웅만 문맥으로 인정한다. 모르는 id 는 기본 형태로 돌아간다. */
export const itemFormHeroIds = () => Object.keys(FORMS.heroes);
export const isItemFormHero = (heroId) => !!heroEntry(heroId);

/** 캡션용 짧은 이름('바람추적자 실바' → '실바'). */
export function heroShortName(heroId) {
  const name = String(HEROES[heroId]?.name || '').trim();
  return name.split(/\s+/).pop() || name;
}

/**
 * 장비 하나를 영웅 문맥에서 어떤 형태로 보여 줄지. renderKey 가 null 이면 기본 썸네일이 곧 그 형태다.
 * @param {any} item ITEM_BY_ID 항목
 * @param {string|null} [heroId]
 * @returns {ItemFormResolution}
 */
export function resolveItemForm(item, heroId = null) {
  const hero = heroEntry(heroId);
  const itemId = item?.id ?? null;
  const base = { itemId, heroId: hero ? heroId : null, contextual: !!hero, nodes: [] };
  if (item?.slot !== 'weapon') {
    const slot = Object.hasOwn(SLOT_FORM_LABEL, item?.slot) ? item.slot : 'weapon';
    return { ...base, variant: 'canonical', form: slot, count: 1, formKey: slot, label: SLOT_FORM_LABEL[slot] || '장비', renderKey: null };
  }
  if (item.modelNode) {
    const armory = hero?.armoryWeapon;
    if (!armory) return { ...base, variant: 'canonical', form: 'armory', count: 1, formKey: 'armory', label: '병기고 원본 모델', renderKey: null };
    if (armory.mode === 'own-mesh') return { ...base, variant: 'armory-own', form: 'armory', count: 1, formKey: 'armory', label: '병기고 전용 모델', renderKey: null };
    const held = formKeyOf(armory.form, armory.count), formKey = 'ornament-' + held;
    return { ...base, variant: 'armory-ornament', form: armory.form, count: armory.count, formKey, label: (ITEM_FORM_LABEL[held] || '기본 무기') + ' + 병기고 장식', nodes: [...armory.nodes], renderKey: itemId + '@' + formKey };
  }
  const entry = hero?.weapon?.[item.rarity];
  if (!entry) return { ...base, contextual: false, heroId: null, variant: 'canonical', form: CANONICAL_WEAPON_FORM, count: 1, formKey: CANONICAL_WEAPON_FORM, label: ITEM_FORM_LABEL[CANONICAL_WEAPON_FORM], renderKey: null };
  const formKey = formKeyOf(entry.form, entry.count);
  return { ...base, variant: 'hero-form', form: entry.form, count: entry.count, formKey, label: ITEM_FORM_LABEL[formKey] || formKey, nodes: [...entry.nodes], renderKey: formKey === CANONICAL_WEAPON_FORM ? null : itemId + '@' + formKey };
}

/** 렌더 파일 이름. '@' 대신 '--' 를 써서 정적 호스트 · 캐시 키에서 이스케이프가 필요 없게 한다. */
export const itemFormRenderFile = (renderKey) => String(renderKey).replace('@', '--') + '.webp';

/**
 * 실제로 도달 가능한 (장비, 영웅 형태) 조합 중 기본 썸네일과 다른 그림이 필요한 것. key 순서로 고정한다.
 * @param {Record<string, any>} itemsById
 */
export function itemFormRenderTargets(itemsById) {
  const targets = new Map();
  for (const item of Object.values(itemsById)) {
    if (item?.slot !== 'weapon') continue;
    for (const heroId of itemFormHeroIds()) {
      const form = resolveItemForm(item, heroId);
      if (!form.renderKey) continue;
      const target = targets.get(form.renderKey) || { key: form.renderKey, id: item.id, variant: form.variant, form: form.form, count: form.count, formKey: form.formKey, nodes: form.nodes, heroes: [] };
      target.heroes.push(heroId);
      targets.set(form.renderKey, target);
    }
  }
  return [...targets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * 선택 3D 아래 · 상세 머리의 짧은 사실 캡션. 구현 사정은 말하지 않는다.
 * @param {ItemFormResolution} form
 * @param {any} item
 */
export function itemFormCaption(form, item) {
  const who = form.contextual ? heroShortName(form.heroId) : '';
  if (item?.slot === 'weapon') {
    if (form.contextual) return who + ' 착용 · ' + form.label;
    return form.form === 'armory' ? '병기고 원본 모델' : '기본 형태 · ' + form.label;
  }
  if (item?.modelNode) return '병기고 원본 모델 · 착용하면 같은 모델이 영웅에 붙습니다';
  if (item?.slot === 'armor') return '방어구 원형 · 착용하면 영웅의 등급 외형으로 보입니다';
  return '목록 그림과 같은 원형';
}
