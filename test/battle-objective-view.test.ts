import { expect, test } from 'bun:test';
import { Floor } from '../src/game/world.js';
import { battleObjectiveView, discoveredMapBounds, discoveredMapView, discoveredPoint } from '../src/ui/battle-objective-view.js';

type MappedRoom = Readonly<{ id: number; x: number; z: number; w: number; h: number; type: string;
  label: string; cleared: boolean; attunementPending: boolean; conquestLabel: string }>;

test('발견 지도는 실제 연결의 양끝을 발견한 뒤에만 복도와 구역을 공개한다', () => {
  const world = new Floor(1, 'frost', 13);
  world.rooms.forEach(room => { room.discovered = room === world.startRoom; });
  const first = discoveredMapView(world);
  const firstRooms: readonly MappedRoom[] = first.rooms;
  expect(firstRooms.map(room => room.id)).toEqual([world.startRoom.id]);
  expect(first.corridors).toEqual([]);
  expect(firstRooms.some(room => room.type === 'boss')).toBe(false);
  const id = world.startRoom.links![0], neighbor = world.rooms[id]; neighbor.discovered = true;
  const second = discoveredMapView(world);
  const secondRooms: readonly MappedRoom[] = second.rooms;
  expect(second.corridors.length).toBeGreaterThan(0);
  expect(second.corridors.every(edge => secondRooms.some(room => room.id === edge.fromId)
    && secondRooms.some(room => room.id === edge.toId))).toBe(true);
  const edge = second.corridors[0], a = edge.points[0], b = edge.points[1];
  expect(discoveredPoint(second, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).toBe(true);
  const hidden = world.rooms.find(room => !room.discovered)!;
  expect(secondRooms.some(room => room.id === hidden.id)).toBe(false);
});

test('미발견 복도로 이동 중인 자신의 위치는 지도 경계 안에 유지한다', () => {
  const room = { id: 0, x: 0, z: 0, w: 16, h: 16, type: 'start', label: '', cleared: true,
    attunementPending: false, conquestLabel: '' };
  const known = { rooms: [room], corridors: [], sealed: true };
  const position = { x: 0, z: 18 }, bounds = discoveredMapBounds(known, position);
  expect(bounds.maxZ).toBe(24); expect(bounds.minZ).toBe(-8);
  expect(position.z).toBeLessThan(bounds.maxZ);
  expect(discoveredPoint(known, 0, 18)).toBe(false);
});

test('별자리 단계는 정답이나 종료 메서드에 접근하지 않고 실제 단계와 유지량만 표시한다', () => {
  const room = { id: 1, discovered: true, cleared: false, type: 'normal' }, world: any = { rooms: [room], sealed: true };
  const gate: any = { room, ready: true };
  Object.defineProperty(gate, 'answer', { get() { throw Error('정답 누출'); } });
  const route: any = { world, progress: 0, phase: 'select', hold: .439, def: { kind: 'constellations', holdSeconds: 1 }, gates: [gate],
    finish() { throw Error('정산 호출'); }, autoPoint() { throw Error('AUTO 답 누출'); }, hint() { throw Error('문구 파싱'); } };
  const view = battleObjectiveView({ world, routeObjectives: route });
  expect(view).toMatchObject({ title: '별자리 복원', progress: 0, total: 1, hold: .4, holdTotal: 1, roomId: 1 });
  expect(view.action).toContain('월드 단서');
  room.discovered = false;
  expect(battleObjectiveView({ world, routeObjectives: route })).toMatchObject({ roomId: null, hold: 0, action: '다음 구역을 찾아 이동' });
});

test('심층 기록의 미완료 보조 제단은 실제 컨트롤러 우선순위를 유지한다', () => {
  const altar = { id: 2, discovered: true, attunementPending: true, attuned: false, cleared: false, type: 'treasure', attunementT: 1.24 };
  const record = { id: 6, discovered: true, cleared: false, type: 'elite' };
  const world: any = { rooms: [altar, record], sealed: true }, route: any = { world, coexistsAttunement: true,
    progress: 0, hold: 0, def: { kind: 'records', holdSeconds: 2 }, gates: [{ room: record, ready: true }] };
  expect(battleObjectiveView({ world, routeObjectives: route })).toMatchObject({ title: '보물 제단 공명', roomId: 2, hold: 1.2 });
  altar.attuned = true; altar.attunementPending = false;
  expect(battleObjectiveView({ world, routeObjectives: route })).toMatchObject({ title: '기록 복원', roomId: 6 });
});

test('선택 전술 공략은 필수 정화와 함께 표시하며 실패를 완료로 바꾸지 않는다', () => {
  const world: any = { rooms: [{ id: 0, type: 'start', cleared: true }, { id: 1, type: 'elite', cleared: false }], sealed: true };
  const conquest: any = { world, def: { kind: 'priority', priority: 'last', target: 2 }, progress: 1, failed: false };
  expect(battleObjectiveView({ world, conquest })).toMatchObject({ title: '보스 봉인 해제', challenge: '전술 · 표식 마지막 처치 · 1/2' });
  conquest.failed = true; expect(battleObjectiveView({ world, conquest })).toHaveProperty('challenge', '전술 조건 미달 · 원정 계속');
});
