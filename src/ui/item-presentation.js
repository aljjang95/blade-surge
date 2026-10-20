// 아이템 표현의 단일 규칙(descriptor). 인벤 · 장비 칸 · 비교 시트 · 3D 미리보기가 같은 함수를 읽는다.
// 같은 itemId 는 어디서나 같은 3D 원본에서 같은 카메라·조명으로 구운 썸네일을 쓴다.
//  - /img/gear/<id>.webp : tools/art/gear-icon-studio(item-forge · armor-appearance) 기존 렌더
//  - /img/item-renders/<id>.webp : tools/item-render-studio 가 같은 리그·카메라로 구운 나머지 장비(병기고는 원본 GLB)
//  - /img/item-renders/forms/<id>--<form>.webp : 영웅 문맥 무기 형태(활 · 지팡이 · 쌍단검 · 병기고 장식 조합).
//    tools/item-render-variants 가 같은 카메라·조명과 선택 3D 와 같은 모델 빌더(item-visual-model.js)로 굽는다.
// 영웅 문맥(itemVisual(item, { heroId }))이 있으면 그 영웅이 실제로 드는 형태의 그림을, 없으면 기본 형태 그림을 쓴다.
// 렌더가 없거나 그림을 못 읽으면 다른 장비 그림이 아니라 중립 부위 실루엣으로만 바꾼다.
import RENDERS from '../data/item-presentation.json';
import { RARITY_COLOR, RARITY_INFO, SLOT_NAME } from '../data/items.js';
import { uiArt } from './illustrated.js';
import { itemFormCaption, itemFormRenderFile, resolveItemForm } from './item-visual-forms.js';

export const ITEM_RENDER_ROOT = '/img/item-renders/';
export const ITEM_FORM_RENDER_ROOT = '/img/item-renders/forms/';
const RENDERED = new Map((RENDERS.items || []).map((entry) => [entry.id, entry]));
const STUDIO_PREFIX = '/img/gear/';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** 3D 형상 원본 종류. 스튜디오와 런타임 미리보기가 같은 판정을 쓴다. */
export function itemRenderSource(item) {
  if (item?.modelNode) return 'armory-glb';
  if (item?.slot === 'armor') return 'armor-rig';
  return 'forge';
}

/** 기존 3D 렌더 아이콘(/img/gear/)이 없는 장비 = 새로 구울 대상. id 순서로 고정한다. */
export function itemRenderTargets(itemsById) {
  return Object.values(itemsById)
    .filter((item) => !String(item.icon || '').startsWith(STUDIO_PREFIX))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({ id: item.id, slot: item.slot, source: itemRenderSource(item) }));
}

export const itemSlotSilhouette = (slot) => uiArt('slot-' + (Object.hasOwn(SLOT_NAME, slot) ? slot : 'weapon'));

/**
 * 같은 장비라도 영웅 문맥에서는 그 영웅이 실제로 드는 형태의 그림을 돌려준다.
 * 문맥 없이 부르면 이전과 같은 기본 그림이다(도감 · 소환 구성품처럼 영웅이 정해지지 않은 화면).
 * @param {any} item ITEM_BY_ID 항목
 * @param {{ heroId?: string|null }} [context]
 * @returns {{ itemId: string|null, slot: string, slotName: string, rarity: string|null, rarityName: string, rarityColor: string, iconUrl: string, fallbackUrl: string, fallback: boolean, renderSet: string, source: string, modelKey: string|null,
 *   heroId: string|null, contextual: boolean, variant: string, form: string, formCount: number, formKey: string, formLabel: string, visualKey: string|null, caption: string }}
 */
export function itemVisual(item, context = {}) {
  const slot = item?.slot && Object.hasOwn(SLOT_NAME, item.slot) ? item.slot : 'weapon';
  const fallbackUrl = itemSlotSilhouette(slot);
  if (!item?.id) return { itemId: null, slot, slotName: SLOT_NAME[slot], rarity: null, rarityName: '', rarityColor: '#9aa3b2', iconUrl: fallbackUrl, fallbackUrl, fallback: true, renderSet: 'slot-silhouette', source: 'none', modelKey: null,
    heroId: null, contextual: false, variant: 'canonical', form: slot, formCount: 1, formKey: slot, formLabel: '', visualKey: null, caption: '' };
  const studio = String(item.icon || '').startsWith(STUDIO_PREFIX);
  const rendered = RENDERED.has(item.id);
  const source = itemRenderSource(item);
  const form = resolveItemForm(item, context?.heroId ?? null);
  let iconUrl = studio ? item.icon : rendered ? ITEM_RENDER_ROOT + item.id + '.webp' : fallbackUrl;
  let fallback = !studio && !rendered;
  let renderSet = studio ? 'gear-icon-studio' : rendered ? 'item-render-studio' : 'slot-silhouette';
  if (form.renderKey) {
    // 도달 가능한 모든 조합의 그림은 test/item-visual-forms.test.ts 가 매니페스트 · 파일로 보장한다.
    // 그래서 런타임 번들에 출처 매니페스트(item-presentation-variants.json)를 싣지 않는다.
    // 그림을 못 읽으면 기본(다른 형태) 그림이 아니라 img onerror 의 중립 실루엣으로만 바뀐다.
    iconUrl = ITEM_FORM_RENDER_ROOT + itemFormRenderFile(form.renderKey);
    fallback = false;
    renderSet = 'item-form-render';
  }
  return {
    itemId: item.id,
    slot,
    slotName: SLOT_NAME[slot],
    rarity: item.rarity || null,
    rarityName: RARITY_INFO[item.rarity]?.name || '',
    rarityColor: RARITY_COLOR[item.rarity] || '#9aa3b2',
    iconUrl,
    fallbackUrl,
    fallback,
    renderSet,
    source,
    modelKey: source === 'armory-glb' ? 'armory:' + item.modelNode : source + ':' + item.id,
    heroId: form.heroId,
    contextual: form.contextual,
    variant: form.variant,
    form: form.form,
    formCount: form.count,
    formKey: form.formKey,
    formLabel: form.label,
    // 같은 그림 = 같은 visualKey. 기본 그림을 쓰면 itemId, 영웅 형태 그림이면 'id@형태'.
    visualKey: form.renderKey || item.id,
    caption: itemFormCaption(form, item),
  };
}

/**
 * 문자열 렌더러용 img. 실패하면 한 번만 중립 실루엣으로 바꾸고 다른 장비 그림은 쓰지 않는다.
 * @param {any} item
 * @param {string} [attrs]
 * @param {{ heroId?: string|null }} [context]
 */
export function itemIconHtml(item, attrs = '', context = {}) {
  const visual = itemVisual(item, context);
  return '<img src="' + esc(visual.iconUrl) + '" alt="" data-item-visual="' + esc(visual.renderSet) + '" data-item-form="' + esc(visual.formKey) + '"'
    + (visual.heroId ? ' data-item-hero="' + esc(visual.heroId) + '"' : '') + attrs
    + ' onerror="this.onerror=null;this.dataset.itemVisual=\'slot-silhouette\';this.src=\'' + esc(visual.fallbackUrl) + '\'">';
}

/**
 * DOM 렌더러용 img 노드.
 * @param {any} item
 * @param {string} [className]
 * @param {{ heroId?: string|null }} [context]
 */
export function itemIconNode(item, className = '', context = {}) {
  const visual = itemVisual(item, context);
  const img = document.createElement('img');
  img.alt = ''; if (className) img.className = className;
  img.dataset.itemVisual = visual.renderSet;
  img.dataset.itemForm = visual.formKey;
  if (visual.heroId) img.dataset.itemHero = visual.heroId;
  img.src = visual.iconUrl;
  img.onerror = () => { img.onerror = null; img.dataset.itemVisual = 'slot-silhouette'; img.src = visual.fallbackUrl; };
  return img;
}
