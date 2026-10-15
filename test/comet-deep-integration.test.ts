import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CometDeepOrbits } from '../src/game/comet-deep-orbits.js';
import { CometDeepOrbitView } from '../src/game/comet-deep-orbit-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { Battle } from '../src/game/battle-base.js';

// 교차 lane 통합 검사: rules lane 의 실제 컨트롤러, worldui lane 의 실제 뷰·목표 패널을
// 실제 심층 월드와 Battle 메서드(enterRoom·markCleared·updateExpedition) 위에서 함께 돌린다.
// 각 lane 테스트는 상대 lane 을 가짜로 대신했으므로, 여기서만 이름·phase·시계 표기 계약이 실제로 맞물리는지 확인한다.
const noop = () => {};
const DT = 1 / 30;

async function fixture() {
  const stage = buildExpeditionStage('dungeon', 'comet_bastion', null, { depth: 'deep' });
  const world = buildExpeditionWorld(stage);
  const drops: any[] = [], hurts: number[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, maxAlive: 34, curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [],
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, app: { eco: { s: {} }, reducedMotion: { matches: false } },
    scene: new Scene(), ui: { toast: noop, waveBanner: noop, setObjective: noop, setFloorLabel: noop, showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: noop, groundTex: noop, clearAll: noop, burst: noop, castCircle: noop },
    drops: { spawn: (...args: any[]) => drops.push(args), clear: noop }, rollDrop: () => ({ id: 'drop' }),
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, pos: new Vector3(world.startRoom.x, 0, world.startRoom.z),
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, hurt: (n: number) => { hurts.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) { g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop }); },
  });
  g.player.game = g;
  const route = createRouteObjectives(stage, world) as CometDeepOrbits;
  g.routeObjectives = route;
  await route.prepareView(g.scene);
  return { g, world, route, drops, hurts };
}
type F = Awaited<ReturnType<typeof fixture>>;
const gateOf = (f: F, id: number): any => f.route.gates.find((x: any) => x.room.id === id);
const entryOf = (f: F, id: number): any => (f.route.view as any).entries.find((e: any) => e.gate.room.id === id);
const items = (f: F) => f.drops.filter(d => d[1] === 'item').length;
const panel = (f: F) => battleObjectiveView(f.g).action as string;
const shown = (clock: number) => (Math.ceil(clock * 10 - 1e-9) / 10).toFixed(1);

function clearRoom(f: F, id: number) {
  const room = f.world.rooms[id];
  room.discovered = true;
  f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
  // 실제 Battle 프레임과 같은 경로: updateExpedition → routeObjectives.update.
  f.g.updateExpedition(DT);
}
/** 실제 autoPoint 를 향해 5 u/s 로 걷는 한 프레임. Battle.updateExpedition 을 통해 컨트롤러를 진행한다. */
function walk(f: F) {
  const p = f.g.player.pos, cur = f.route.current, pt = cur ? f.route.autoPoint(cur.room) : null;
  if (pt) { const dx = pt.x - p.x, dz = pt.z - p.z, l = Math.hypot(dx, dz); if (l > .65) { const s = Math.min(l, 5 * DT); p.x += dx / l * s; p.z += dz / l * s; } }
  f.g.updateExpedition(DT);
}

test('실제 컨트롤러·뷰·패널: 준비→붕괴→쉼터→폭풍→연결에서 문장·표시·판정이 같은 값을 읽는다', async () => {
  const f = await fixture();
  expect(f.route).toBeInstanceOf(CometDeepOrbits);
  expect(f.route.view).toBeInstanceOf(CometDeepOrbitView);
  const g = gateOf(f, 1), e = entryOf(f, 1), room = g.room;
  f.g.player.pos.set(room.x, 0, room.z - room.h / 2 + 1);
  clearRoom(f, 1);
  expect(g.phase).toBe('ready');
  expect(room.attunementPending).toBeFalsy();
  expect(panel(f)).toContain('룬석을 밀면 붕괴 9초 시작');
  const before = { cleared: f.g.roomsCleared, items: items(f) };
  const seen = new Set<string>();
  let warnFrames = 0;
  for (let i = 0; i < 30 * 40 && g.phase !== 'connected'; i++) {
    walk(f);
    seen.add(g.phase);
    const text = panel(f);
    if (g.phase === 'collapse' || g.phase === 'shelter') {
      // 패널의 남은 시간과 월드 카운트다운 호는 판정 시계 gate.clock 하나에서 나온다.
      expect(text).toContain(`붕괴 ${shown(g.clock)}초`);
      expect(text).not.toContain('붕괴 0.0초');
      expect(e.arc.visible).toBe(true);
      expect(room.cleared).toBe(false);
    }
    if (g.phase === 'storm' && g.present) {
      // 예고가 보일 때만 붉은 영역이 켜지고, 빈 원은 판정이 쓰는 stormShelter 위치에 있다.
      expect(e.red.visible).toBe(g.stormWarn);
      if (g.stormWarn) {
        warnFrames++;
        expect(e.ring.position.x).toBeCloseTo(g.stormShelter.x - g.center.x, 6);
        expect(e.ring.position.z).toBeCloseTo(g.stormShelter.z - g.center.z, 6);
        expect(text).toContain('빈 원으로 이동');
      }
      expect(room.cleared).toBe(false);
    }
  }
  expect([...seen]).toEqual(expect.arrayContaining(['ready', 'collapse', 'shelter', 'storm', 'connected']));
  expect(g.phase).toBe('connected');
  expect(warnFrames).toBeGreaterThan(30);
  expect(f.hurts).toEqual([]);
  // 연결 순간에만 Battle 이 방을 정화하고 방 보상(장비 1개)이 한 번 나온다.
  expect(room.cleared).toBe(true);
  expect(f.g.roomsCleared - before.cleared).toBe(1);
  expect(items(f) - before.items).toBe(1);
  for (let i = 0; i < 60; i++) walk(f);
  expect(f.g.roomsCleared - before.cleared).toBe(1);
  expect(items(f) - before.items).toBe(1);
  // 연결된 고리는 궤도선·룬석 2개만 그린다.
  expect(e.red.visible).toBe(false);
  expect(e.arc.visible).toBe(false);
  expect(f.route.progress).toBe(1);
  expect(battleObjectiveView(f.g).progress as number).toBe(1);
});

test('붕괴 시간 초과: 패널은 0.1 다음 판정 프레임에 실패하며 방·보상은 그대로, 다시 연결하면 보상 1회', async () => {
  const f = await fixture();
  const g = gateOf(f, 2), room = g.room;
  f.g.player.pos.set(room.x, 0, room.z + room.h / 2 - 1);
  clearRoom(f, 2);
  expect(room.attunementPending).toBeFalsy();
  // 한 번만 밀어 붕괴를 시작하고, 궤도 띠 밖(방 중심)으로 물러나 손을 뗀다.
  for (let i = 0; i < 300 && g.phase === 'ready'; i++) walk(f);
  expect(g.phase).toBe('collapse');
  f.g.player.pos.set(room.x, 0, room.z);
  const texts: string[] = [], clocks: number[] = [];
  for (let i = 0; i < 30 * 10 && g.phase === 'collapse'; i++) { f.g.updateExpedition(DT); texts.push(panel(f)); clocks.push(g.clock); }
  expect(g.phase).toBe('ready');
  expect(g.failures).toBe(1);
  expect(f.route.collapseFailures).toBe(1);
  // 실패 직전 프레임의 표시는 0.1이고, 시계가 남아 있는 동안 0.0은 한 번도 보이지 않는다.
  expect(texts[texts.length - 2]).toContain('붕괴 0.1초');
  expect(texts.some(t => t.includes('붕괴 0.0초'))).toBe(false);
  expect(clocks[clocks.length - 2]).toBeGreaterThan(0);
  expect(g.angle).toBeCloseTo(g.start, 9);
  expect(room.cleared).toBe(false);
  expect(f.g.treasureRooms).toBe(0);
  expect(items(f)).toBe(0);
  // 같은 고리를 다시 연결하면 보물방 보상은 정확히 한 번이다.
  for (let i = 0; i < 30 * 40 && g.phase !== 'connected'; i++) walk(f);
  expect(g.phase).toBe('connected');
  expect(room.cleared).toBe(true);
  expect(f.g.treasureRooms).toBe(1);
  expect(items(f)).toBe(3);
  expect(room.attunementPending).toBeFalsy();
});

test('폭풍 예고 중 사망하면 예고가 거둬지고 뷰도 같은 프레임에 숨긴다, 결과 동결 뒤 뷰가 사라진다', async () => {
  const f = await fixture();
  const g = gateOf(f, 3), e = entryOf(f, 3), room = g.room;
  f.g.player.pos.set(room.x - room.w / 2 + 1, 0, room.z);
  clearRoom(f, 3);
  for (let i = 0; i < 30 * 40 && !(g.phase === 'storm' && g.stormWarn); i++) walk(f);
  expect(g.stormWarn).toBe(true);
  expect(e.red.visible).toBe(true);
  f.g.player.alive = false;
  f.g.updateExpedition(DT);
  expect(g.stormWarn).toBe(false);
  expect(e.red.visible).toBe(false);
  const report = f.route.finish(false);
  expect(report.complete).toBe(false);
  expect(report.progress).toBe(0);
  expect(f.route.finish(true)).toBe(report);
  expect((f.route.view as any).group.visible).toBe(false);
  f.route.stop();
  expect(f.route.view).toBeNull();
  expect(f.g.scene.getObjectByName('TLL_CometDeepOrbits')).toBeUndefined();
});
