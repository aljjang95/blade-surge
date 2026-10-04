import { GARDEN_MAP_TACTICS } from '../data/map-tactics.js';

/** 정산 영수증만 표시하며 현재 장치 스냅샷으로 결과를 만들지 않는다. */
export function mapTacticsReceiptView(receipt) {
  if (!receipt || receipt.id !== GARDEN_MAP_TACTICS.id || receipt.roomId !== GARDEN_MAP_TACTICS.roomId || typeof receipt.used !== 'boolean') return null;
  if ('nodes' in receipt || typeof receipt.canceled !== 'boolean') return null;
  if (!receipt.used) return Object.freeze({ title: '정원의 장치 · 미사용', detail: '이번 전투에서는 장치를 사용하지 않았습니다.' });
  const label = receipt.selectedId === 'gather' ? '집결' : receipt.selectedId === 'release' ? '방출' : null;
  if (!label || !Number.isSafeInteger(receipt.affectedCount) || receipt.affectedCount < 0) return null;
  return Object.freeze({ title: `정원의 장치 · ${label}${receipt.canceled ? ' · 발동 중단' : ''}`,
    detail: `제어 대상 ${receipt.affectedCount}명 · 이 방에서 1회 사용` });
}
