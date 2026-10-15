// 결과 화면 전리품 카드와 실제 가방 아이템을 정본 아이템 정체성으로 잇는 순수 선택 도구(브라우저·상태 쓰기 없음).
// 결과 카드(src/expansion/hub.jsx LootReveal)는 uid·id 속성 없이 ITEM_BY_ID[id].rarity 글자와 .name만 보여 준다.
// 정본 카탈로그에서 (등급, 이름)이 정확히 같은 id를 찾아 카드 → 아이템 id로 바꾼다(부분 문자열 일치 없음).
// 그림 src로는 고르지 않는다. 뒤 검사가 결과 그림과 장착 그림의 일치이므로 src로 고르면 검사가 스스로 통과하게 된다.

/** 결과 카드 하나를 이번 보상 목록 안의 정본 아이템 id로 바꾼다. 정확히 하나가 아니면 null. */
export function resultCardItemId(card, loot, itemById) {
  const ids = [...new Set(loot.map((l) => l.id))].filter((id) => itemById[id] && itemById[id].rarity === card.rarity && itemById[id].name === card.name);
  return ids.length === 1 ? ids[0] : null;
}

/**
 * 결과에 실제로 보인 전리품 중 영웅 가방에도 있는 아이템을 고른다.
 * 우선순위: 선호 부위(궁수는 무기) → 보상 안에서 id가 하나뿐인 아이템(uid가 카드와 1:1) → 결과 카드 순서.
 * 같은 id가 여러 개면 카드는 그 중 하나지만 어느 uid인지 화면에 없으므로 sharedId로 남긴다(같은 정의·같은 영웅 문맥 그림).
 * @param {{ cards: {rarity:string,name:string}[], loot: {uid:number,id:string}[], bagUids: (number|string)[], itemById: Record<string, any>, preferSlot?: string }} input
 */
export function pickResultLoot({ cards, loot, bagUids, itemById, preferSlot = 'weapon' }) {
  const bag = new Set(bagUids.map(String));
  const rows = cards.map((card, index) => {
    const id = resultCardItemId(card, loot, itemById);
    const uids = id ? loot.filter((l) => l.id === id).map((l) => l.uid) : [];
    return { index, rarity: card.rarity, name: card.name, id, slot: id ? itemById[id].slot : null, uids, inBag: uids.filter((u) => bag.has(String(u))) };
  });
  const rank = (r) => (r.slot === preferSlot ? 0 : 2) + (r.uids.length === 1 ? 0 : 1);
  const best = rows.filter((r) => r.id && r.inBag.length).sort((a, b) => rank(a) - rank(b) || a.index - b.index)[0] || null;
  return { cards: rows, pick: best ? { uid: best.inBag[0], id: best.id, slot: best.slot, cardIndex: best.index, sharedId: best.uids.length > 1 } : null };
}
