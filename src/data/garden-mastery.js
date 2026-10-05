import { mapTacticsForStage } from './map-tactics.js';

// 기존 기본 개인 정원의 장치방만 저작한다. 새 능력·보상·공격 시계는 만들지 않는다.
export const GARDEN_MASTERY = Object.freeze({
  version: 'garden_mastery_v1', label: '두 입구의 사냥터', roomId: 3,
  approachRoomIds: Object.freeze([1, 2]),
  replacementSlot: 3, replacementEnemyId: 'bone_orc',
  approachHint: '전투방·보물방 두 입구 · 자객의 측면 예고 확인, 분쇄 뒤 회복기에 반격',
  priorityHint: '자객의 측면 예고 확인 · 회복기에 집결 반격 / 방출 뒤 대각 이동으로 해골 망령 압박',
  hints: Object.freeze({
    gather: '회복기에 모아 반격 · 이미 뜬 예고는 유지',
    release: '간격 확보 후 예고 밖 대각 이동으로 해골 망령 압박 · 예고는 유지',
  }),
});

/** 같은 카탈로그 범위만 읽는다. 저장 기록의 누락 버전을 추정하는 함수가 아니다. */
export function gardenMasteryForStage(stage) {
  return mapTacticsForStage(stage) ? GARDEN_MASTERY : null;
}

/** 기존 방 안의 이동 단서. 바닥·회피 판정이나 고정 안전지대를 추가하지 않는다. */
export function gardenMasteryDiagonals(room) {
  return Object.freeze([-1, 1].map(side => Object.freeze({
    fromX: room.x + side * 2.4, fromZ: room.z + 1.5,
    toX: room.x + side * (room.w / 2 - 3.2), toZ: room.z + room.h / 2 - 3.2,
  })));
}
