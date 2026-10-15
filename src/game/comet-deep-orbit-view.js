// 혜성 요새 심층 궤도 고리 5개의 월드 표시(BUNDLE-01 계약 골격).
// 이 파일은 골격 커밋 뒤 worldui lane이 구현으로 교체한다. 계약은 TASK-DESIGN 9·10절이다.
//
// 읽기 계약: 뷰는 route(CometDeepOrbits)와 gate 필드를 읽기만 하고 쓰지 않는다.
//   route: def, world, gates, progress, complete, closed, current, collapseFailures, stormHits, offBy(gate), here
//   gate: room, label, index, phase('locked'|'ready'|'collapse'|'shelter'|'storm'|'connected'), present, angle, target, start,
//         stone, center, clock, connectT, slack, lockT, failures, hits, stormIndex(0..3), stormWarn, stormWarnT, stormShelter
// 수명주기: constructor(scene, route)에서만 geometry/material을 만든다. update에서는 할당하지 않는다.
//   dispose()는 그룹 제거와 모든 geometry/material 해제를 하며 반복 호출해도 안전해야 한다.
// 표시 영역은 판정 영역과 같다: 폭풍 붉은 원 = gate.center 반경 def.storm.radius, 빈 원 = gate.stormShelter 반경 def.shelterRadius.

/** @typedef {{ reduced: boolean }} CometDeepViewOptions */

export class CometDeepOrbitView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false;
  }
  /** @param {any} _route @param {number} _dt @param {CometDeepViewOptions} [_opts] */
  update(_route, _dt, _opts) {}
  dispose() { this.disposed = true; this.scene = null; this.route = null; }
}
