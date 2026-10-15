// 통합 교차 확인(BUNDLE-07, Opus): rules lane 의 prepareView 연결과 worldui lane 의 뷰가 실제로 만나는지 본다.
// 일식 일반(3)·심층(4)은 뷰를 만들고, 뷰 정의가 없는 종문 경로는 만들지 않으며, 규칙 update 가 뷰 상태를 끌고 간다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { BackflowValveView, valveState } from '../src/game/backflow-valve-view.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';

function setup(id: string, depth: 'standard' | 'deep') {
  const stage = buildExpeditionStage('dungeon', id, null, { depth });
  const world = buildExpeditionWorld(stage);
  const route: any = createRouteObjectives(stage, world);
  return { stage, world, route };
}

test('일식 일반·심층은 prepareView 로 밸브 수만큼의 실제 뷰를 만들고, 종문 경로는 만들지 않는다', async () => {
  for (const [depth, n] of [['standard', 3], ['deep', 4]] as const) {
    const { route } = setup('eclipse_hydra_vault', depth);
    const scene = new Scene();
    await route.prepareView(scene);
    expect(route.view).toBeInstanceOf(BackflowValveView);
    expect(route.view.count).toBe(n);
    expect(scene.getObjectByName('TLL_BackflowValves')).toBeTruthy();
    // 아직 어느 방도 발견하지 않았다: 모두 hidden, 그리는 것 없음.
    expect(route.view.drawCalls).toBe(0);
    route.stop();
    expect(route.view).toBeNull();
    expect(scene.getObjectByName('TLL_BackflowValves')).toBeUndefined();
  }
  const bell = setup('bellfall_crypt', 'standard');
  await bell.route.prepareView(new Scene());
  expect(bell.route.view).toBeNull();
});

test('심층 규칙 update 가 뷰를 끌고 간다: 다음 밸브 → 유지 중 → 봉인, 차례 아닌 밸브는 대기', async () => {
  const { world, route } = setup('eclipse_hydra_vault', 'deep');
  await route.prepareView(new Scene());
  const rooms = world.rooms;
  for (const id of [2, 4, 5, 7]) rooms[id].discovered = true;
  // 영웅은 처음에 1번 밸브 빛(반경 3) 밖에 있다.
  const pos = new Vector3(rooms[2].x + 5, 0, rooms[2].z);
  const game: any = { world, active: true, paused: false, bossDefeated: false, enemies: [], pending: [], autoTarget: null,
    player: { alive: true, pos }, app: { reducedMotion: { matches: true } },
    fx: { castCircle() {}, damage() {} }, ui: { setObjective() {}, toast() {} }, markCleared(room: any) { room.cleared = true; } };
  // 방 2 와 방 5 의 적을 정리했다고 둔다(방 5 는 차례가 아니라 기다린다).
  for (const id of [2, 5]) {
    const gate = route.gates.find((g: any) => g.room.id === id);
    route.prepareRoom(gate.room, 0); gate.room.spawned = true;
    expect(route.beforeClear(game, gate.room)).toBe(true);
  }
  route.update(game, 1 / 60);
  expect([0, 1, 2, 3].map(i => valveState(route, i))).toEqual(['next', 'waiting', 'waiting', 'waiting']);
  pos.set(rooms[2].x, 0, rooms[2].z);
  // 뷰는 규칙 갱신 뒤 같은 스텝의 상태를 그린다: 유지가 시작된 바로 그 스텝에 '유지 중'(상태 코드 2)이다.
  route.update(game, 1 / 60);
  expect(valveState(route, 0)).toBe('holding');
  expect(route.view.state[0]).toBe(2);
  route.update(game, 1);
  expect(route.view.drawCalls).toBeLessThanOrEqual(3);
  route.update(game, 1);
  expect(route.progress).toBe(1);
  expect(valveState(route, 0)).toBe('sealed');
  expect(route.view.state[0]).toBe(1);
  expect(valveState(route, 3)).toBe('waiting');
  // 일시정지 중에는 뷰를 갱신하지 않는다(뷰 update 호출 없음).
  let calls = 0; const original = route.view.update.bind(route.view);
  route.view.update = (...a: any[]) => { calls++; return original(...a); };
  game.paused = true; route.update(game, 1 / 60); expect(calls).toBe(0);
  game.paused = false; route.update(game, 1 / 60); expect(calls).toBe(1);
  route.stop();
});
