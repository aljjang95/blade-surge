import { expect, test } from 'bun:test';
import { pickLootLabels, stackUp, lootLabelText, estimateLabelWidth, LOOT_LABEL } from '../src/ui/loot-labels.js';
import { LOOT_MODEL_SIZE } from '../src/game/loot-models.js';
import { LOOT_AURA } from '../src/game/loot-auras.js';
import { FOE_RING_SCALE } from '../src/game/combat-readability.js';
import { ITEM_BY_ID } from '../src/data/items.js';

// 대표님 2026-10-30 피드백: 드랍 이름표 · 작은 식별 고리 · 작은 드랍 모델.
const anyId = Object.keys(ITEM_BY_ID)[0];
const drop = (serial: number, rarity: string, x: number, over: any = {}): any => ({ kind: 'item', state: 'idle', land: .5, serial, rarity, t: 1,
  payload: { id: anyId, rarity }, mesh: { position: { x, y: .6, z: 0 } }, restY: .6, ...over });
const player = { pos: { x: 0, z: 0 } };

test('이름표 후보: 고등급 먼저, 같은 등급은 가까운 순, 노말은 3개까지, 착지 전 · 자석 중 · 재화는 제외', () => {
  const items = [
    drop(1, 'N', 1), drop(2, 'N', 2), drop(3, 'N', 3), drop(4, 'N', 4), drop(5, 'N', 5),
    drop(6, 'L', 9), drop(7, 'E', 2), drop(8, 'E', 1),
    drop(9, 'U', 1, { state: 'fly' }), drop(10, 'U', 1, { state: 'magnet' }), drop(11, 'S', 1, { land: -1 }),
    { kind: 'gold', state: 'idle', land: 0, mesh: { position: { x: 0, y: 0, z: 0 } } },
  ];
  const picked = pickLootLabels(items, player);
  expect(picked.map((it: any) => it.serial)).toEqual([6, 8, 7, 1, 2, 3]);
  expect(pickLootLabels(items, player, [], { max: 2 }).map((it: any) => it.serial)).toEqual([6, 8]);
  expect(pickLootLabels(items, null)).toEqual([]);
});

test('이름표는 겹치면 위로 쌓이고, 쌓을 거리가 한도를 넘으면 숨긴다', () => {
  const placed = [{ left: 0, right: 100, top: 80, bottom: 97 }, { left: 0, right: 100, top: 61, bottom: 78 }];
  const r = { left: 10, right: 90, top: 85, bottom: 102 };
  expect(stackUp(r, placed, 2)).toBe(true);
  expect(r.bottom).toBe(61 - LOOT_LABEL.gap); expect(r.bottom - r.top).toBe(17);
  const far = { left: 10, right: 90, top: 85, bottom: 102 };
  expect(stackUp(far, placed, 2, { limit: 10 })).toBe(false);
  const free = { left: 200, right: 260, top: 85, bottom: 102 };
  expect(stackUp(free, placed, 2)).toBe(true); expect(free.top).toBe(85);
});

test('이름 글자: 장비 이름(고통 단계 접두 포함), 모르는 장비는 빈 글자, 폭은 범위 안', () => {
  expect(lootLabelText({ id: anyId })).toBe(ITEM_BY_ID[anyId].name);
  expect(lootLabelText({ id: anyId, tp: 30 })).toContain(ITEM_BY_ID[anyId].name);
  expect(lootLabelText({ id: 'no_such_item' })).toBe('');
  expect(estimateLabelWidth('가')).toBeGreaterThanOrEqual(36);
  expect(estimateLabelWidth('가'.repeat(40))).toBe(168);
});

test('드랍 모델은 영웅 키(≈1.9)의 0.3~0.55배, 바닥 고리는 영웅 고리보다 작거나 비슷하다', () => {
  for (const size of Object.values(LOOT_MODEL_SIZE)) { expect(size).toBeLessThanOrEqual(1.9 * .55); expect(size).toBeGreaterThanOrEqual(1.9 * .3); }
  for (const spec of Object.values(LOOT_AURA)) expect(spec.ground[0]).toBeLessThanOrEqual(1);
  expect(FOE_RING_SCALE).toBeLessThanOrEqual(.9);
});
