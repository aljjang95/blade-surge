// BUNDLE-09 교차 통합(Opus): 실제 FalseThrones 와 실제 FalseThroneView·MirrorMazeView 를 함께 돌려
// 경로 목표 갱신 밖(준비·균열)과 안(미궁 시작·탈출)에서 바뀐 표시 입력이 같은 호출 안에 뷰에 반영되는지 본다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { Battle } from '../src/game/battle-base.js';
import { FalseThroneView } from '../src/game/false-throne-view.js';
import { MirrorMazeView, mirrorState } from '../src/game/mirror-maze-view.js';

const noop = () => {};
function fixture(depth = 'deep') {
  const stage = buildExpeditionStage('dungeon', 'sable_mirage_basin', null, { depth });
  const world = buildExpeditionWorld(stage);
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, maxAlive: 34, curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [],
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, app: { eco: { s: {} }, reducedMotion: { matches: false } },
    ui: { toast: noop, waveBanner: noop, setObjective: noop, setFloorLabel: noop, showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: noop, groundTex: noop, clearAll: noop, castCircle: noop, burst: noop }, drops: { spawn: noop, clear: noop }, rollDrop: () => null,
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, hurt: () => true },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route: any = createRouteObjectives(stage, world);
  g.routeObjectives = route;
  return { g, world, route };
}
type F = ReturnType<typeof fixture>;
async function withViews(depth = 'deep') { const f = fixture(depth); await f.route.prepareView(new Scene()); return f; }
function clearRoom(f: F, id: number) {
  const room: any = f.world.rooms[id]; f.g.enterRoom(room);
  for (const t of f.g.timers.splice(0)) t.fn();
  const gate = f.route.gates.find((x: any) => x.room === room);
  for (let i = 0; i < 6 && !room.cleared && !(gate && gate.ready); i++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
  }
  return room;
}
function breakThrone(f: F, id: number) {
  const gate = f.route.gates.find((g: any) => g.room.id === id); clearRoom(f, id);
  for (let i = 0; i < 60 && !gate.broken; i++) {
    for (let k = 0; k < 200 && gate.phase !== 'still'; k++) f.route.update(f.g, .05);
    f.g.player.pos.copy(gate.stand); f.g.hitArea(f.g.player, f.g.player.pos, 0, 2.4, 120, 10, {});
    f.route.update(f.g, .21);
  }
  return gate;
}
const translation = (mesh: any, i: number) => { const a = mesh.instanceMatrix.array; return [a[i * 16 + 12], a[i * 16 + 14]]; };

test('실제 prepareView: 심층은 왕좌 뷰와 거울 뷰를 함께 만들고 일반은 왕좌 뷰만 만든다', async () => {
  const deep = await withViews();
  expect(deep.route.view).toBeInstanceOf(FalseThroneView);
  expect(deep.route.mazeView).toBeInstanceOf(MirrorMazeView);
  expect(deep.route.view.entries.length).toBe(4);
  const std = await withViews('standard');
  expect(std.route.view).toBeInstanceOf(FalseThroneView);
  expect(std.route.mazeView).toBeNull();
  deep.route.stop(); std.route.stop();
  expect(deep.route.mazeView).toBeNull();
});

test('왕좌 준비(Battle.markCleared → beforeClear)는 경로 목표 갱신 없이 같은 호출 안에 왕좌 바닥 고리를 바꾼다', async () => {
  const f = await withViews();
  f.route.update(f.g, 1 / 60);
  const entry = f.route.view.entries.find((e: any) => e.gate.room.id === 3);
  expect(entry.floor.opacity).toBeCloseTo(.25);
  clearRoom(f, 3);   // 이 안에서 route.update 는 불리지 않는다
  expect(entry.gate.ready).toBe(true);
  expect(entry.floor.opacity).toBeCloseTo(.55);
});

test('미궁이 열리는 스텝에 거울 두 개와 발자국이 같은 update 안에 보이고, 탈출 스텝에 부서짐으로 바뀐 뒤 사라진다', async () => {
  const f = await withViews();
  for (const id of [2, 3, 5, 6]) breakThrone(f, id);
  for (const id of [1, 4, 7]) clearRoom(f, id);
  const mv = f.route.mazeView, m = f.route.maze;
  f.route.update(f.g, 1 / 60);   // 마지막 정화 뒤 첫 갱신 전 상태를 한 번 그린다(조건 성립 전 단계가 없으므로 이 스텝에 열린다)
  expect(m.phase).toBe('running');
  expect([...mv.states]).toEqual([mirrorState(f.route, 0), mirrorState(f.route, 1)]);
  expect([...mv.states]).toEqual(['real', 'illusion']);
  expect(mv.drawCalls).toBe(4);
  expect(mv.footprints).toBeGreaterThanOrEqual(1);
  expect(translation(mv.frame, 0)).toEqual([m.real.x, m.real.z].map(v => Math.fround(v)));
  expect(translation(mv.frame, 1)).toEqual([m.illusion.x, m.illusion.z].map(v => Math.fround(v)));
  expect(f.world.sealed).toBe(true);
  f.g.player.pos.set(m.real.x, 0, m.real.z);
  f.route.update(f.g, 1 / 60);
  expect(m.phase).toBe('done');
  expect([...mv.states]).toEqual(['shattered', 'shattered']);
  expect(f.world.sealed).toBe(false);
  for (let i = 0; i < 40; i++) f.route.update(f.g, 1 / 60);
  expect(mv.drawCalls).toBe(0);
  f.route.stop();
});

test('미궁 전에는 거울 뷰가 숨어 있고 일시정지 syncView 는 아무것도 바꾸지 않는다', async () => {
  const f = await withViews();
  f.route.update(f.g, 1 / 60);
  expect(f.route.mazeView.drawCalls).toBe(0);
  expect([...f.route.mazeView.states]).toEqual(['hidden', 'hidden']);
  f.g.paused = true;
  f.route.maze.phase = 'running';   // 표시 입력만 바꿔 일시정지 syncView 가 그리지 않는지 본다
  f.route.syncView(f.g);
  expect([...f.route.mazeView.states]).toEqual(['hidden', 'hidden']);
  f.route.stop();
});

