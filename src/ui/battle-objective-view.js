const count = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const seconds = value => Math.floor(count(value) * 10) / 10;
const step = (title, action, values = {}) => Object.freeze({ title, action, progress: 0, total: 0,
  hold: 0, holdTotal: 0, roomId: null, ...values });

/** 현재 컨트롤러의 상태만 투영하며 전투 정산과 퍼즐 정답에는 접근하지 않는다. */
function mainObjectiveView(battle) {
  const world = battle?.world;
  if (!world) return step('원정 목표', '전장을 준비하고 있습니다.');
  const boss = world.bossRoom;
  if (boss?.cleared) return step('정화 완료', '원정 결과를 확인하세요.');
  const route = battle.routeObjectives;
  const pendingAltar = world.rooms.find(room => room.attunementPending && !room.attuned && !room.cleared);
  if (pendingAltar && (!route || route.coexistsAttunement)) {
    return step('보물 제단 공명', '중심에서 2초 유지', { roomId: pendingAltar.discovered ? pendingAltar.id : null,
      hold: seconds(pendingAltar.attunementT), holdTotal: 2 });
  }
  if (route?.world === world && !route.closed && Array.isArray(route.gates)) {
    const gate = route.gates[route.progress];
    if (gate) {
      const kind = route.def?.kind;
      const title = kind === 'constellations' ? '별자리 복원' : kind === 'records' ? '기록 복원'
        : kind === 'cooling' ? '냉각선 복구' : '종문 조율';
      const values = { progress: count(route.progress), total: route.gates.length,
        roomId: gate.room.discovered ? gate.room.id : null };
      if (!gate.room.discovered) return step(title, '다음 구역을 찾아 이동', values);
      if (!gate.ready) return step(title, '이 구역의 적과 증원 처치', values);
      if (kind === 'constellations') {
        // 단계만 읽고 단서의 실제 내용은 월드 소품에 유지한다.
        const action = route.phase === 'retry' ? '판 밖으로 나와 다시 읽기' : route.phase === 'select'
          ? '월드 단서와 같은 판에서 1초 유지' : route.phase === 'read'
            ? '모래시계 단서 1초 읽기' : '전투를 마치고 모래시계로 이동';
        return step(title, action, { ...values, hold: route.phase === 'read' ? seconds(route.read) : seconds(route.hold),
          holdTotal: route.phase === 'read' ? count(route.def.readSeconds) : route.phase === 'select' ? count(route.def.holdSeconds) : 0 });
      }
      const action = kind === 'cooling' ? gate.phase === 'warning' || gate.phase === 'vent'
        ? '분출을 피하고 청록 조작판으로 이동' : '청록 조작판에서 2초 유지'
        : kind === 'records' ? '기록대에서 2초 유지' : '중심에서 2초 유지';
      return step(title, action, { ...values, hold: seconds(route.hold), holdTotal: count(route.def.holdSeconds) });
    }
  }
  const remaining = world.rooms.filter(room => !room.cleared && !['start', 'boss'].includes(room.type)).length;
  if (world.sealed) return step('보스 봉인 해제', `남은 구역 ${remaining}곳 정화`, {
    progress: world.rooms.filter(room => room.cleared && !['start', 'boss'].includes(room.type)).length,
    total: world.rooms.filter(room => !['start', 'boss'].includes(room.type)).length });
  return boss?.discovered ? step('보스 처치', '발견한 보스 구역으로 이동', { roomId: boss.id })
    : step('보스 찾기', '미탐험 구역을 따라 이동');
}

export function battleObjectiveView(battle) {
  const primary = mainObjectiveView(battle), conquest = battle?.conquest;
  if (!conquest || conquest.world !== battle.world || !conquest.def) return primary;
  const { kind, priority, order, target } = conquest.def;
  const instruction = kind === 'altars' ? `${order.map(id => id === 2 ? 'A' : 'B').join(' → ')} 제단`
    : kind === 'priority' ? `표식 ${priority === 'first' ? '먼저' : '마지막'} 처치`
      : kind === 'breaks' ? '보스 BREAK' : 'BREAK 중 명중';
  return Object.freeze({ ...primary, challenge: conquest.failed ? '전술 조건 미달 · 원정 계속'
    : conquest.progress >= target ? '전술 조건 달성 · 보스 처치 후 기록'
      : `전술 · ${instruction} · ${conquest.progress}/${target}` });
}

/** 생성기가 만든 실제 순서와 연결을 읽고 미발견 지형은 복사하지 않는다. */
export function discoveredMapView(world) {
  if (!world) return { rooms: [], corridors: [], sealed: false };
  const known = world.rooms.filter(room => room.discovered);
  const roomByCell = new Map(world.rooms.map(room => [`${room.gx},${room.gy}`, room]));
  const corridors = [];
  for (const [from, to] of world.linkPending || []) {
    const a = roomByCell.get(from.join(',')), b = roomByCell.get(to.join(','));
    if (!a?.discovered || !b?.discovered) continue;
    corridors.push({ fromId: a.id, toId: b.id, points: [[a.x, a.z], [b.x, a.z], [b.x, b.z]],
      width: world.layout?.width || 6, sealed: !!world.sealed && (a === world.bossRoom || b === world.bossRoom) });
  }
  return { rooms: known.map(room => ({ id: room.id, x: room.x, z: room.z, w: room.w, h: room.h,
    type: room.type, label: room.label || '', cleared: !!room.cleared, attunementPending: !!room.attunementPending,
    conquestLabel: room.conquestLabel || '' })), corridors, sealed: !!world.sealed };
}

export function discoveredPoint(view, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (view.rooms.some(room => Math.abs(x - room.x) <= room.w / 2 && Math.abs(z - room.z) <= room.h / 2)) return true;
  return view.corridors.some(corridor => corridor.points.slice(1).some(([bx, bz], index) => {
    const [ax, az] = corridor.points[index], half = corridor.width / 2;
    return x >= Math.min(ax, bx) - half && x <= Math.max(ax, bx) + half
      && z >= Math.min(az, bz) - half && z <= Math.max(az, bz) + half;
  }));
}

/** 현재 플레이어 위치는 공개 정보이며 미발견 방의 크기는 경계에 넣지 않는다. */
export function discoveredMapBounds(view, playerPosition) {
  return { minX: Math.min(playerPosition.x - 6, ...view.rooms.map(room => room.x - room.w / 2)),
    maxX: Math.max(playerPosition.x + 6, ...view.rooms.map(room => room.x + room.w / 2)),
    minZ: Math.min(playerPosition.z - 6, ...view.rooms.map(room => room.z - room.h / 2)),
    maxZ: Math.max(playerPosition.z + 6, ...view.rooms.map(room => room.z + room.h / 2)) };
}
