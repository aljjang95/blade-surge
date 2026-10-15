// 아이템 표현의 단일 규칙(descriptor). 인벤 · 장비 칸 · 비교 시트 · 3D 미리보기가 같은 함수를 읽는다.
// 같은 itemId 는 어디서나 같은 3D 원본에서 같은 카메라·조명으로 구운 썸네일을 쓴다.
//  - /img/gear/<id>.webp : tools/art/gear-icon-studio(item-forge · armor-appearance) 기존 렌더
//  - /img/item-renders/<id>.webp : tools/item-render-studio 가 같은 리그·카메라로 구운 나머지 장비(병기고는 원본 GLB)
// 렌더가 없거나 그림을 못 읽으면 다른 장비 그림이 아니라 중립 부위 실루엣으로만 바꾼다.
import RENDERS from '../data/item-presentation.json';
import { RARITY_COLOR, RARITY_INFO, SLOT_NAME } from '../data/items.js';
import { uiArt } from './illustrated.js';

export const ITEM_RENDER_ROOT = '/img/item-renders/';
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
 * @param {any} item ITEM_BY_ID 항목
 * @returns {{ itemId: string|null, slot: string, slotName: string, rarity: string|null, rarityName: string, rarityColor: string, iconUrl: string, fallbackUrl: string, fallback: boolean, renderSet: string, source: string, modelKey: string|null }}
 */
export function itemVisual(item) {
  const slot = item?.slot && Object.hasOwn(SLOT_NAME, item.slot) ? item.slot : 'weapon';
  const fallbackUrl = itemSlotSilhouette(slot);
  if (!item?.id) return { itemId: null, slot, slotName: SLOT_NAME[slot], rarity: null, rarityName: '', rarityColor: '#9aa3b2', iconUrl: fallbackUrl, fallbackUrl, fallback: true, renderSet: 'slot-silhouette', source: 'none', modelKey: null };
  const studio = String(item.icon || '').startsWith(STUDIO_PREFIX);
  const rendered = RENDERED.has(item.id);
  const source = itemRenderSource(item);
  return {
    itemId: item.id,
    slot,
    slotName: SLOT_NAME[slot],
    rarity: item.rarity || null,
    rarityName: RARITY_INFO[item.rarity]?.name || '',
    rarityColor: RARITY_COLOR[item.rarity] || '#9aa3b2',
    iconUrl: studio ? item.icon : rendered ? ITEM_RENDER_ROOT + item.id + '.webp' : fallbackUrl,
    fallbackUrl,
    fallback: !studio && !rendered,
    renderSet: studio ? 'gear-icon-studio' : rendered ? 'item-render-studio' : 'slot-silhouette',
    source,
    modelKey: source === 'armory-glb' ? 'armory:' + item.modelNode : source + ':' + item.id,
  };
}

/** 문자열 렌더러용 img. 실패하면 한 번만 중립 실루엣으로 바꾸고 다른 장비 그림은 쓰지 않는다. */
export function itemIconHtml(item, attrs = '') {
  const visual = itemVisual(item);
  return '<img src="' + esc(visual.iconUrl) + '" alt="" data-item-visual="' + esc(visual.renderSet) + '"' + attrs
    + ' onerror="this.onerror=null;this.dataset.itemVisual=\'slot-silhouette\';this.src=\'' + esc(visual.fallbackUrl) + '\'">';
}

/** DOM 렌더러용 img 노드. */
export function itemIconNode(item, className = '') {
  const visual = itemVisual(item);
  const img = document.createElement('img');
  img.alt = ''; if (className) img.className = className;
  img.dataset.itemVisual = visual.renderSet;
  img.src = visual.iconUrl;
  img.onerror = () => { img.onerror = null; img.dataset.itemVisual = 'slot-silhouette'; img.src = visual.fallbackUrl; };
  return img;
}
