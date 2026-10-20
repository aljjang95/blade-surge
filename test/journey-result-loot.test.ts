import { expect, test } from 'bun:test';
import { pickResultLoot, resultCardItemId } from '../tools/playability-journey-loot.mjs';
import { ITEM_BY_ID } from '../src/data/items.js';

// PC 설치 Chrome 3a33 자연 승리 실제 기록: 보상 14개(uid 순서 아님), 결과 카드는 희귀도 상위 6개.
const loot = [[1, 'gear_weapon_n_1'], [2, 'b_wooden'], [4, 'gear_ring_e_3'], [6, 'b_cloth'], [8, 'gear_weapon_e_1'], [7, 'b_chain'], [9, 'b_silk'],
  [11, 'gear_ring_s_3'], [10, 'gear_boots_n_3'], [14, 'gear_ring_e_2'], [13, 'gear_weapon_s_2'], [12, 'a_sigil'], [3, 'b_silk'], [5, 'w_guard']].map(([uid, id]) => ({ uid: uid as number, id: id as string }));
const cards = ['U룬각인 흉갑', 'E별빛 이중환', 'E파쇄 도살검', 'E푸른 매듭환', 'S사슬 각반', 'S비단 신발'].map((t) => ({ rarity: t[0], name: t.slice(1) }));
const allBag = loot.map((l) => String(l.uid));

test('3a33 실제 결과: 보상 첫 아이템이 아니라 결과에 보인 궁수 무기를 고른다', () => {
  const { pick, cards: rows } = pickResultLoot({ cards, loot, bagUids: allBag, itemById: ITEM_BY_ID });
  expect(pick).toEqual({ uid: 8, id: 'gear_weapon_e_1', slot: 'weapon', cardIndex: 2, sharedId: false });
  expect(rows.map((r) => r.id)).toEqual(['a_sigil', 'gear_ring_e_3', 'gear_weapon_e_1', 'gear_ring_e_2', 'b_chain', 'b_silk']);
  // 같은 id 두 개(b_silk uid 9·3)는 카드 하나에 두 uid로 남는다.
  expect(rows[5].uids).toEqual([9, 3]);
});

test('결과에 보인 무기가 가방에 없으면 다음 결과 카드, 같은 id 중복보다 1:1 아이템을 먼저 고른다', () => {
  const bag = allBag.filter((u) => u !== '8');
  expect(pickResultLoot({ cards, loot, bagUids: bag, itemById: ITEM_BY_ID }).pick).toMatchObject({ uid: 12, id: 'a_sigil', cardIndex: 0 });
  const silkOnly = pickResultLoot({ cards, loot, bagUids: ['3', '1'], itemById: ITEM_BY_ID }).pick;
  expect(silkOnly).toMatchObject({ uid: 3, id: 'b_silk', cardIndex: 5, sharedId: true });
});

test('결과에 보인 아이템이 가방에 하나도 없으면 고르지 않는다(결과 그림 비교는 NOT_RUN으로 남는다)', () => {
  expect(pickResultLoot({ cards, loot, bagUids: ['1', '2'], itemById: ITEM_BY_ID }).pick).toBeNull();
});

test('카드 정체성은 등급과 이름이 정확히 같은 정본 아이템만 받는다', () => {
  expect(resultCardItemId({ rarity: 'E', name: '파쇄 도살검' }, loot, ITEM_BY_ID)).toBe('gear_weapon_e_1');
  expect(resultCardItemId({ rarity: 'E', name: '도살검' }, loot, ITEM_BY_ID)).toBeNull();
  expect(resultCardItemId({ rarity: 'N', name: '파쇄 도살검' }, loot, ITEM_BY_ID)).toBeNull();
  // 이번 보상에 없는 아이템 이름은 카탈로그에 있어도 받지 않는다.
  const king = (ITEM_BY_ID as Record<string, { rarity: string, name: string }>).b_king;
  expect(resultCardItemId({ rarity: king.rarity, name: king.name }, loot, ITEM_BY_ID)).toBeNull();
});
