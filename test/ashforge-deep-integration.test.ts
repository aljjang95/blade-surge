// 재벼림 심층 심장로(BUNDLE-08) 교차 통합: 실제 CoolingValves 와 실제 EmberChainView 를 함께 돌린다.
// lane 테스트는 서로 가짜를 썼으므로, 방 발견 두 경로(enterRoom·peekRooms)의 같은 프레임 반영과 해방 연출의 상태 전이를 여기서 확인한다.
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CoolingValves } from '../src/game/cooling-valves.js';
import { EmberChainView } from '../src/game/ember-chain-view.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { Battle } from '../src/game/battle-base.js';

const noop = () => {};
// 적 모델·렌더링은 필요 없다. 방 입장, 대기열, 증원, 목표, 정화·보상, 봉인, 결과는 실제 Battle 코드를 쓴다.
function fixture(depth = 'deep', routeId = 'ashforge_catacomb') {
  const stage = buildExpeditionStage('dungeon', routeId, null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hits: number[] = [], labels: string[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34, curRoom: world.startRoom,
    timers: [], enemies: [], pending: [], projectiles: [], result: null,
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, app: { eco: { s: {} } }, sp: { clear: noop },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: (_p: any, _n: number, opts: any) => labels.push(opts.text), castCircle: noop, groundTex: noop, clearAll: noop, burst: noop, embers: noop },
    drops: { spawn: noop, clear: noop }, rollDrop: () => null,
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop,
      hurt: (n: number) => { hits.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop });
    },
  });
  const route = createRouteObjectives(stage, world) as CoolingValves;
  g.routeObjectives = route; g.autoTarget = route.autoRoom();
  return { g, world, route, messages, hits, labels, stage };
}
type F = ReturnType<typeof fixture>;
const gateOf = (f: F, id: number): any => f.route.gates.find((g: any) => g.room.id === id)!;

function enter(f: F, id: number) {
  const room = f.world.rooms[id]; f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  return room;
}
function killWave(f: F, room: any) {
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
}
/** 입장 → 모든 적 처치. 정예방은 실제 markCleared 증원 2회를 거쳐 세 번째 처치에서 정화 시도까지 간다. */
function defend(f: F, id: number) {
  const room = enter(f, id);
  for (let i = 0; i < (room.type === 'elite' ? 3 : 1); i++) killWave(f, room);
  return room;
}
/** 1/30초 하위 스텝으로 조건이 될 때까지 진행한다. pos 가 위치를 돌려주면 매 스텝 그 자리로 옮긴다. */
function run(f: F, pos: () => Vector3 | null, until: () => boolean, max = 900) {
  for (let i = 0; i < max; i++) {
    if (until()) return i;
    const p = pos(); if (p) f.g.player.pos.copy(p);
    f.g.updateExpedition(1 / 30);
  }
  throw new Error('조건에 도달하지 못했다');
}
const chainScale = (view: any, i: number) => {
  const a = view.chain.instanceMatrix.array; let max = 0;
  for (let k = 0; k < 4; k++) { const o = (i * 4 + k) * 16; max = Math.max(max, Math.hypot(a[o], a[o + 1], a[o + 2])); }
  return max;
};

test('실제 해방 뷰: 방에 들어선 스텝과 인접 미리보기로 발견한 스텝에 사슬이 보이고, 충격파 대기 → 열림 → 해방 → 해방 뒤로 바뀐다', async () => {
  const f = fixture(); const scene = new Scene();
  await f.route.prepareReleaseView(scene);
  const view: any = f.route.releaseView;
  expect(view).toBeInstanceOf(EmberChainView);
  expect(scene.children).toContain(view.group);
  expect(view.count).toBe(40);
  expect([...view.states]).toEqual(['hidden', 'hidden', 'hidden', 'hidden']);

  // 경로 1: 방 입장. Battle.enterRoom 이 syncView 를 부르므로 시간을 진행하지 않아도 같은 스텝에 보인다.
  f.g.enterRoom(f.world.rooms[2]);
  expect(view.states[0]).toBe('bound'); expect(chainScale(view, 0)).toBeGreaterThan(.9);
  expect(view.drawCalls).toBeGreaterThanOrEqual(1); expect(view.drawCalls).toBeLessThanOrEqual(2);

  // 경로 2: 인접 미리보기(0.4초마다). 방 3 근처로 가서 peekRooms 한 번에 방 3 과 그 이웃 방 4 가 발견되면 같은 호출 안에서 반영된다.
  const r4 = f.world.rooms[4];
  f.g.player.pos.set(r4.x, 0, r4.z); f.g.roomPeekT = 0; f.g.peekRooms(1 / 60);
  expect(r4.discovered).toBe(true); expect(view.states[1]).toBe('bound');

  // 1번 심장로: 증원 2회 뒤 준비 → 첫 충격파 전에는 shock(닫힘), 충격파 뒤 가열 구간은 open.
  const g0 = gateOf(f, 2);
  for (const t of f.g.timers.splice(0)) t.fn();
  for (let i = 0; i < 3; i++) killWave(f, f.world.rooms[2]);
  expect(g0.ready).toBe(true);
  f.g.player.pos.copy(g0.pad); f.g.updateExpedition(1 / 60);
  // 준비 직후에는 충격파가 아직 0 이라 어느 위상이든 닫혀 있다(shock).
  expect(g0.shocks).toBe(0); expect(view.states[0]).toBe('shock');
  run(f, () => g0.pad, () => g0.shocks >= 1 && g0.phase === 'heat');
  f.g.updateExpedition(1 / 60);
  expect(view.states[0]).toBe('open');
  run(f, () => g0.pad, () => g0.attuned);
  expect(view.states[0]).toBe('releasing');
  // 해방: 0.6초 안에 사슬이 사라지고 releaseSeconds(1.6) 뒤 released.
  for (let i = 0; i < 40; i++) f.g.updateExpedition(1 / 60);
  expect(chainScale(view, 0)).toBe(0);
  expect(view.states[0]).toBe('releasing');
  for (let i = 0; i < 60; i++) f.g.updateExpedition(1 / 60);
  expect(view.states[0]).toBe('released');

  // 일시정지에는 해방 뷰가 갱신되지 않는다(releaseAge 불변).
  const age = view.releaseAge[0]; f.g.paused = true; f.g.updateExpedition(1 / 60); f.g.paused = false;
  expect(view.releaseAge[0]).toBe(age);

  f.route.stop(); f.route.stop();
  expect(f.route.releaseView).toBeNull(); expect(scene.children).not.toContain(view.group);
});

test('일반 재벼림·재의 수문은 해방 뷰를 만들지 않는다', async () => {
  for (const [depth, id] of [['standard', 'ashforge_catacomb'], ['deep', 'cinder_tide_lock'], ['standard', 'cinder_tide_lock']]) {
    const stage = buildExpeditionStage('dungeon', id, null, { depth });
    const route = createRouteObjectives(stage, buildExpeditionWorld(stage)) as CoolingValves;
    await route.prepareReleaseView(new Scene());
    expect(route.releaseView).toBeNull();
    expect(route.padOpen(route.gates[0])).toBe(true);
  }
});

