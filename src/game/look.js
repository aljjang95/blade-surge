import * as THREE from 'three';
import { RARITY_INFO, ITEM_BY_ID } from '../data/items.js';
import { materialsOf } from '../engine/assets.js';

/**
 * 장비 외형 (PRD §4-1) — 무기·방어구 장착이 실제 모델에 반영된다.
 *  · 무기 등급 → 보이는 무기 메시가 바뀐다 (KayKit Adventurers 는 리그마다 무기 메시를 2~4종 품고 있다)
 *  · 방어구 등급 → 방패/보조 메시
 *  · 등급 → 무기 발광색(N 없음 → L 주황), 강화 +마다 더 밝게. 몸통은 방어구 등급색을 아주 약하게
 *  · +10 이상이면 오라(잔불) — 성능 영향 없는 순수 외형
 * 뼈대는 규칙(등급표), 외형은 모델에 이미 있는 메시라 새 에셋이 없다.
 */
export const ALL_WEAPON_NODES = ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', 'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', '1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug'];

// 영웅별: 무기 슬롯이 다루는 노드 그룹 / 방어구 슬롯이 다루는 노드 그룹, 등급별 조합
export const LOOKS = {
  knight: {
    weaponNodes: ['1H_Sword', '2H_Sword', '1H_Sword_Offhand'], armorNodes: ['Round_Shield', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield'],
    weapon: { N: ['1H_Sword'], S: ['1H_Sword'], E: ['1H_Sword'], U: ['2H_Sword'], L: ['2H_Sword'] },
    armor:  { N: ['Round_Shield'], S: ['Badge_Shield'], E: ['Rectangle_Shield'], U: ['Spike_Shield'], L: ['Spike_Shield'] },
  },
  barbarian: {
    weaponNodes: ['1H_Axe', '2H_Axe', '1H_Axe_Offhand'], armorNodes: ['Barbarian_Round_Shield'],
    weapon: { N: ['1H_Axe'], S: ['1H_Axe'], E: ['1H_Axe', '1H_Axe_Offhand'], U: ['2H_Axe'], L: ['2H_Axe'] },
    armor:  { N: [], S: [], E: [], U: [], L: [] },
  },
  mage: {
    weaponNodes: ['1H_Wand', '2H_Staff'], armorNodes: ['Spellbook', 'Spellbook_open'],
    weapon: { N: ['1H_Wand'], S: ['2H_Staff'], E: ['2H_Staff'], U: ['2H_Staff'], L: ['2H_Staff'] },
    armor:  { N: [], S: [], E: ['Spellbook'], U: ['Spellbook'], L: ['Spellbook_open'] },
  },
  rogue: {
    weaponNodes: ['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable'], armorNodes: [],
    weapon: { N: ['Knife'], S: ['Knife', 'Knife_Offhand'], E: ['Knife', 'Knife_Offhand'], U: ['Knife', 'Knife_Offhand'], L: ['Knife', 'Knife_Offhand'] },
    armor:  { N: [], S: [], E: [], U: [], L: [] },
  },
};
// 발광 강도 — 블룸이 걸려 있어 1.5 를 넘으면 무기가 형체 없는 덩어리가 되고, 몸통 0.19 는 통짜로 바랜다 (스크린샷 대조)
const WEAPON_GLOW = { N: 0, S: 0.45, E: 0.75, U: 0.95, L: 1.15 };
const BODY_GLOW = { N: 0, S: 0.02, E: 0.035, U: 0.05, L: 0.07 };

/**
 * @param model  spawnCharacter 가 만든 root (재질은 메시별로 이미 클론돼 있다)
 * @param def    HEROES[id]
 * @param equip  { weapon: inst|null, armor: inst|null, ... }  (inst = { id, enh })
 * @returns { trailColor, aura }  — 무기 궤적 색, 오라 색(없으면 null)
 */
export function applyLook(model, def, equip = {}) {
  const L = LOOKS[def.id];
  const w = equip.weapon ? ITEM_BY_ID[equip.weapon.id] : null, a = equip.armor ? ITEM_BY_ID[equip.armor.id] : null;
  // 보일 노드: 슬롯이 비었으면 def.show 중 그 그룹 것, 있으면 등급표
  let show = new Set(def.show);
  if (L) {
    if (w) { for (const n of L.weaponNodes) show.delete(n); for (const n of L.weapon[w.rarity] || []) show.add(n); }
    if (a) { for (const n of L.armorNodes) show.delete(n); for (const n of L.armor[a.rarity] || []) show.add(n); }
  }
  for (const n of ALL_WEAPON_NODES) { const o = model.getObjectByName(n); if (o) o.visible = show.has(n); }
  // 발광 — 무기 메시는 등급색, 몸통은 방어구 등급색을 아주 약하게. Actor.update 가 flash 뒤에 baseEmissive 로 되돌린다
  const wCol = w ? new THREE.Color(RARITY_INFO[w.rarity].color) : null, aCol = a ? new THREE.Color(RARITY_INFO[a.rarity].color) : null;
  const wGlow = w ? WEAPON_GLOW[w.rarity] + Math.min(20, equip.weapon.enh || 0) * 0.025 : 0;
  const aGlow = a ? BODY_GLOW[a.rarity] + Math.min(20, equip.armor.enh || 0) * 0.0015 : 0;
  const sGlow = a ? WEAPON_GLOW[a.rarity] * 0.6 + Math.min(20, equip.armor.enh || 0) * 0.02 : 0;   // 방패·보조
  const wNodes = new Set(L ? L.weaponNodes : []), aNodes = new Set(L ? L.armorNodes : []);
  model.traverse((o) => {
    if (!o.isMesh) return;
    let owner = null; for (let p = o; p && p !== model; p = p.parent) { if (wNodes.has(p.name)) { owner = 'w'; break; } if (aNodes.has(p.name)) { owner = 'a'; break; } }
    for (const material of materialsOf(o)) {
      if (!material.emissive) continue;
      const base = material.userData.baseEmissive || (material.userData.baseEmissive = new THREE.Color(0));
      if (model.userData.authoredContract) base.copy(material.userData.authoredEmissive || new THREE.Color(0));
      else if (owner === 'w') base.copy(wCol || new THREE.Color(0)).multiplyScalar(wGlow);
      else if (owner === 'a') base.copy(aCol || new THREE.Color(0)).multiplyScalar(sGlow);
      else base.copy(aCol || new THREE.Color(0)).multiplyScalar(aGlow);
      material.emissive.copy(base);
    }
  });
  const enhMax = Math.max(...['weapon', 'armor', 'ring', 'boots'].map((s) => equip[s]?.enh || 0));
  const auraCol = enhMax >= 15 ? 0xffd060 : enhMax >= 10 ? (wCol ? wCol.getHex() : def.color) : null;
  return { trailColor: w && w.rarity !== 'N' ? wCol.getHex() : new THREE.Color(def.color).getHex(), aura: auraCol, enhMax };
}
