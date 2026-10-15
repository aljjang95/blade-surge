import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CometOrbits, angleDiff } from '../src/game/comet-orbits.js';
import { Battle } from '../src/game/battle-base.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';

const noop = () => {};
function fixture(depth = 'standard') {
  const stage = buildExpeditionStage('dungeon', 'comet_bastion', null, { depth });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hurts: number[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, maxAlive: 34, curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [],
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, app: { eco: { s: {} } },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop,
      showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: noop, groundTex: noop, clearAll: noop, castCircle: noop, burst: noop }, drops: { spawn: noop, clear: noop }, rollDrop: () => null,
    roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop,
      hurt: (n: number) => { hurts.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route = createRouteObjectives(stage, world) as CometOrbits;
  g.routeObjectives = route; g.autoTarget = route?.autoRoom() || null;
  return { g, world, route, messages, hurts };
}
type F = ReturnType<typeof fixture>;
function clearRoom(f: F, id: number) {
  const room = f.world.rooms[id]; f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
  return room;
}
const gateOf = (f: F, id: number) => f.route.gates.find((g: any) => g.room.id === id)!;
const onTrack = (g: any, a: number, r: number) => new Vector3(g.room.x + Math.sin(a) * r, 0, g.room.z + Math.cos(a) * r);
/** 실제 AUTO 처럼 autoPoint 를 향해 초당 5칸으로 걷는다. */
function autoWalk(f: F, gate: any, seconds: number) {
  const dt = 1 / 30, p = f.g.player.pos;
  for (let t = 0; t < seconds; t += dt) {
    const cur = f.route.current; if (!cur || gate.aligned) return t;
    const pt = f.route.autoPoint(cur.room);
    if (pt) { const dx = pt.x - p.x, dz = pt.z - p.z, l = Math.hypot(dx, dz); if (l > .65) { const s = Math.min(l, 5 * dt); p.x += dx / l * s; p.z += dz / l * s; } }
    f.route.update(f.g, dt);
  }
  return seconds;
}

test('standard places four reachable orbit rings; deep and excluded modes keep their own rules', () => {
  const f = fixture();
  expect(f.route).toBeInstanceOf(CometOrbits);
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([1, 3, 5, 7]);
  for (const gate of f.route.gates) {
    expect(gate.room.objectiveProp).toBe('comet-orbit');
    expect(Math.abs(angleDiff(gate.target, gate.angle))).toBeGreaterThan(2);
  }
  // 심층은 공명 대신 별도의 궤도 고리 5개 컨트롤러(kind 'deep-orbits')를 쓰고 일반판 컨트롤러를 쓰지 않는다.
  expect(fixture('deep').route).not.toBeInstanceOf(CometOrbits);
  expect((fixture('deep').route as any).def.kind).toBe('deep-orbits');
  const base = f.g.stage;
  for (const stage of [{ ...base, party: {} }, { ...base, riftId: 'x' }, { ...base, expedition: { ...base.expedition, conquestId: 'x' } }]) {
    expect(createRouteObjectives(stage, f.world)).toBeNull();
  }
});

test('the stone moves only when pushed after the room is cleared, and only away from the hero', () => {
  const f = fixture(), g = gateOf(f, 1), d = f.route.def;
  f.g.enterRoom(g.room); for (const timer of f.g.timers.splice(0)) timer.fn();
  const start = g.angle;
  f.g.player.pos.copy(onTrack(g, g.angle - .1, d.track)); f.route.update(f.g, .1);
  expect(g.angle).toBe(start);   // 적이 남아 있으면 움직이지 않는다
  for (const e of f.g.enemies) e.alive = false; f.g.markCleared(g.room);
  expect(g.ready).toBe(true); expect(g.room.cleared).toBe(false);
  f.g.player.pos.copy(onTrack(g, start - .1, d.track)); f.route.update(f.g, 1 / 30);
  expect(angleDiff(g.angle, start)).toBeGreaterThan(0);   // 뒤에서 밀면 앞으로
  const pushed = g.angle;
  f.g.player.pos.copy(onTrack(g, pushed + .1, d.track)); f.route.update(f.g, 1 / 30);
  expect(angleDiff(g.angle, pushed)).toBeLessThan(0);    // 반대편에서 밀면 되돌아간다
  f.g.player.pos.copy(onTrack(g, g.angle, d.track - d.band - .5)); const still = g.angle; f.route.update(f.g, 1 / 30);
  expect(g.angle).toBe(still);   // 궤도 띠 밖에서는 밀리지 않는다
});

test('alignment needs the stone held on the star briefly; it clears the room and any order works', () => {
  const f = fixture();
  for (const id of [7, 1, 5, 3]) {
    const g = gateOf(f, id); clearRoom(f, id);
    f.g.player.pos.copy(g.center); g.angle = g.target + .05; f.route.update(f.g, .2);
    expect(g.aligned).toBe(false);
    f.route.update(f.g, .25);
    expect(g.aligned).toBe(true); expect(g.room.cleared).toBe(true);
  }
  expect(f.route.complete).toBe(true);
  expect(f.messages.some(m => /궤도 고리 4개 정렬/.test(m))).toBe(true);
  expect(f.route.canUnseal()).toBe(false);
  for (const room of f.world.rooms) if (!['start', 'boss'].includes(room.type)) room.cleared = true;
  expect(f.route.canUnseal()).toBe(true);
});

test('outer meteors spare the inside; every third is a center meteor that only spares the outside', () => {
  const f = fixture(), g = gateOf(f, 1), d = f.route.def, m = d.meteor;
  clearRoom(f, 1);
  const park = (r: number) => f.g.player.pos.copy(onTrack(g, g.target + Math.PI, r));
  park(2);
  for (let i = 0; i < 2; i++) { f.route.update(f.g, m.every); expect(g.warn).toBe('outer'); f.route.update(f.g, m.warning); }
  expect(f.hurts.length).toBe(0);
  f.route.update(f.g, m.every); expect(g.warn).toBe('center');
  expect(battleObjectiveView(f.g).action).toBe('중심 유성 · 푸른 선 밖으로');
  f.route.update(f.g, m.warning);
  expect(f.hurts.length).toBe(1); expect(f.hurts[0]).toBeCloseTo(7); expect(f.route.meteorHits).toBe(1);
  park(d.escape);
  for (let i = 0; i < 2; i++) { f.route.update(f.g, m.every); f.route.update(f.g, m.warning); }
  expect(f.hurts.length).toBe(3);   // 바깥 유성 두 번은 대피 위치(바깥 고리)에 맞는다
  f.route.update(f.g, m.every); expect(g.warn).toBe('center'); f.route.update(f.g, m.warning);
  expect(f.hurts.length).toBe(3);   // 중심 유성은 바깥에서 피한다
});

test('AUTO pushes every stone onto its star, dodges center meteors, and never pushes the wrong way forever', () => {
  const f = fixture();
  for (const id of [1, 3, 5, 7]) {
    const g = gateOf(f, id); clearRoom(f, id);
    // 문 쪽에서 들어오는 것처럼 룬석 앞쪽(목표 쪽) 바깥에서 출발한다.
    f.g.player.pos.copy(onTrack(g, g.angle + Math.sign(angleDiff(g.target, g.angle)) * .6, f.route.def.escape));
    const used = autoWalk(f, g, 40);
    expect(g.aligned).toBe(true);
    expect(used).toBeLessThan(20);
  }
  expect(f.route.meteorHits).toBeLessThanOrEqual(2);
  expect(f.hurts.length).toBe(f.route.meteorHits);
});

test('objective panel and report reflect real progress; a loss is never complete', () => {
  const f = fixture(), g = gateOf(f, 1);
  g.room.discovered = true;
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '궤도 고리 정렬', action: '이 구역의 적을 먼저 처치', progress: 0, total: 4 });
  clearRoom(f, 1);
  expect(battleObjectiveView(f.g).action).toMatch(/^룬석을 밀어 별에 맞추기 · \d+°$/);
  const report = f.route.finish(false);
  expect(report).toMatchObject({ id: 'comet_orbit_rings', label: '궤도 고리 정렬', complete: false, progress: 0, target: 4, meteorHits: 0 });
  expect(f.route.finish(true)).toBe(report);
});
