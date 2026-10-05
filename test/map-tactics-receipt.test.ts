import { expect, test } from 'bun:test';
import { GARDEN_MAP_TACTICS } from '../src/data/map-tactics.js';
import { mapTacticsReceiptView } from '../src/ui/map-tactics-receipt.js';

const receipt = (values = {}) => Object.freeze({ id: GARDEN_MAP_TACTICS.id, roomId: 3, selectedId: 'gather',
  label: '집결', affectedCount: 4, phase: 'spent', used: true, canceled: false, ...values });
test('실제 영수증의 제어 대상과 선택만 보여주며 정산을 새로 계산하지 않는다', () => {
  const source = receipt();
  expect(mapTacticsReceiptView(source)).toEqual({ title: '정원의 장치 · 집결', detail: '제어 대상 4명 · 이 방에서 1회 사용' });
  expect(source.affectedCount).toBe(4); expect(Object.isFrozen(source)).toBe(true);
  expect(mapTacticsReceiptView(receipt({ selectedId: 'release', label: '방출', affectedCount: 0 }))).toMatchObject({ title: '정원의 장치 · 방출', detail: '제어 대상 0명 · 이 방에서 1회 사용' });
});
test('중단·미사용은 성공을 꾸미지 않고 다른 경로나 현재 스냅샷은 거절한다', () => {
  expect(mapTacticsReceiptView(receipt({ canceled: true, phase: 'canceled' }))?.title).toContain('발동 중단');
  expect(mapTacticsReceiptView(receipt({ used: false, selectedId: null, label: null, affectedCount: 0 }))?.title).toContain('미사용');
  expect(mapTacticsReceiptView(receipt({ id: 'different' }))).toBeNull();
  expect(mapTacticsReceiptView(receipt({ affectedCount: -1 }))).toBeNull();
  expect(mapTacticsReceiptView({ ...receipt(), nodes: [] })).toBeNull();
});
