// 능력치·획득 확률과 독립된 외형 ID. 기존 아이템 정의를 변경하지 않는다.
export const ARMOR_VISUALS = Object.freeze({
  a_leather: Object.freeze({ hero: 'knight', file: 'a_leather.glb', label: '가죽 갑옷', rarity: 'N' }),
  a_bronze: Object.freeze({ hero: 'knight', file: 'a_bronze.glb', label: '청동 흉갑', rarity: 'S' }),
  a_knight: Object.freeze({ hero: 'knight', file: 'a_knight.glb', label: '기사의 판금', rarity: 'E' }),
  a_rime: Object.freeze({ hero: 'knight', file: 'a_rime.glb', label: '결정 갑주', rarity: 'U' }),
  a_king: Object.freeze({ hero: 'knight', file: 'a_king.glb', label: '왕의 갑주', rarity: 'L' }),
});
export const ARMOR_VISUAL_BASE = '/models/armor-pilot/v1/';
export function armorVisualFor(itemId, heroId) {
  return Object.hasOwn(ARMOR_VISUALS, itemId) && ARMOR_VISUALS[itemId].hero === heroId ? ARMOR_VISUALS[itemId] : null;
}
