// BUNDLE-12 Opus 교차 통합: 실제 규칙(AstralDeepConstellations) → 실제 고리 뷰(AstralDeepRingView) → 실제 목표창·결과 줄.
// lane 테스트는 서로 가짜 route·가짜 뷰로만 봤다. 여기서는 실제 Battle 경로로 방을 정리하고 같은 route 를 뷰·목표창이 읽는다.
// 성좌 뷰(AstralConstellationView)는 캔버스 문자가 필요해 여기서 만들지 않는다(일반판 테스트가 따로 본다).
import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { Battle } from '../src/game/battle-base.js';
import { AstralDeepRingView } from '../src/game/astral-deep-ring-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { astralDeepRingResultLine } from '../src/expansion/hub.jsx';

const noop = () => {};
const RING = ROUTE_OBJECTIVES.astral_deep.ring;

function fixture() {
  const stage = buildExpeditionStage('dungeon', 'astral_leviathan_spire', null, { depth: 'deep' });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [], hurts: number[] = [];
  const g: any = Object.create(Battle.prototype);
  Object.assign(g, { stage, world, active: true, paused: false, bossDefeated: false, roomsCleared: 0,
    treasureRooms: 0, kills: 0, maxCombo: 0, dmgDealt: 0, elapsed: 0, revived: 0, maxAlive: 34,
    curRoom: world.startRoom, timers: [], enemies: [], pending: [], projectiles: [], result: null,
    pauseReasons: new Set(), input: { enabled: true, clear: noop }, sp: { clear: noop }, app: { eco: { s: {} }, reducedMotion: { matches: false } },
    ui: { toast: (text: string) => messages.push(text), waveBanner: noop, setObjective: noop, setFloorLabel: noop, showHud: noop, showBoss: noop, showResult: noop },
    renderer: { desat: 0, shake: noop, flashScreen: noop }, arena: { openSeal: noop }, openPortal: noop,
    fx: { damage: noop, groundTex: noop, clearAll: noop, castCircle: noop, burst: noop, embers: noop },
    drops: { spawn: noop, clear: noop }, rollDrop: () => ({}), roomRoster: () => ['guard', 'guard'],
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new Vector3(world.startRoom.x, 0, world.startRoom.z), game: g,
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop, hurt: (n: number) => { hurts.push(n); return true; } },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn?.(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route: any = createRouteObjectives(stage, world);
  g.routeObjectives = route; g.autoTarget = route.autoRoom();
  const scene = new Scene();
  route.ringView = new AstralDeepRingView(scene, route);
  return { g, world, route, messages, hurts, scene };
}
type F = ReturnType<typeof fixture>;
const flush = (f: F) => { for (const timer of f.g.timers.splice(0)) timer.fn(); };
function clearRoom(f: F, id: number) {
  const room = f.world.rooms[id], gate = f.route.gates.find((x: any) => x.room === room);
  f.g.enterRoom(room); flush(f);
  for (let i = 0; i < 6 && !room.cleared && !(gate && gate.ready); i++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
  }
}
function restore(f: F) {
  const gate = f.route.gates[f.route.progress];
  clearRoom(f, gate.room.id);
  f.g.player.pos.copy(gate.pos); f.route.update(f.g, 1);
  f.g.player.pos.copy(gate.pads.find((p: any) => p.id === gate.answer).pos);
  f.route.update(f.g, .99); f.route.update(f.g, .01); f.route.update(f.g, .01);
}
const panel = (f: F) => battleObjectiveView(f.g) as any;
const ringRoom = (f: F) => f.world.rooms[RING.roomId];
const visible = (f: F, name: string) => !!f.scene.getObjectByName(name)?.visible;

test('실제 규칙 → 고리 뷰·목표창·결과 줄: 2번 성좌 대기, 4/4 뒤 다음 update 에 고리 열림, 집결 예고·섬광, 정화 뒤 봉인 해제·뷰 숨김', () => {
  const f = fixture(), view = f.route.ringView;
  // 길에서 먼저 지나는 방 2(2번 성좌)를 정리해도 차례가 아니면 방이 정화되지 않고 목표창은 1번(방 3)을 가리킨다.
  clearRoom(f, 1); clearRoom(f, 2);
  expect(f.route.gates[1].ready).toBe(true); expect(f.world.rooms[2].cleared).toBe(false);
  f.route.update(f.g, 1 / 60);
  expect(panel(f)).toMatchObject({ title: '별자리 복원', roomId: null });
  f.world.rooms[3].discovered = true;
  expect(panel(f)).toMatchObject({ title: '별자리 복원', roomId: 3 });
  // 고리는 성좌 단계 동안 보이지 않는다(첫 update 뒤 drawCalls 0).
  expect(view.drawCalls).toBe(0);
  for (let i = 0; i < 4; i++) restore(f);
  expect(f.route.progress).toBe(4); expect(f.world.rooms[2].cleared).toBe(true);
  expect(f.messages).toContain('모든 별자리 복원 · 모든 구역을 정화하면 성좌 외곽 고리가 열립니다');
  clearRoom(f, 4); clearRoom(f, 7); flush(f);
  expect(f.world.sealed).toBe(true);
  // 모든 구역이 정화된 직후(아직 update 전)에는 idle 이고 목표창은 남은 구역 안내다.
  expect(f.route.ring.phase).toBe('idle');
  expect(panel(f)).toMatchObject({ title: '별자리 복원', action: '남은 구역 정화' });
  // 영웅은 방 7 밖(방 6 중심)에 있다: 다음 update 에 열리고, 열리는 스텝에는 시간이 흐르지 않는다.
  const r6 = f.world.rooms[6]; f.g.player.pos.set(r6.x, 0, r6.z);
  f.route.update(f.g, 1 / 60);
  expect(f.route.ring.phase).toBe('open'); expect(f.route.ring.clock).toBe(0);
  expect(view.drawCalls).toBeGreaterThan(0);
  expect(visible(f, 'TLL_AstralDeepRingLine')).toBe(true); expect(visible(f, 'TLL_AstralDeepRingMarks')).toBe(true);
  expect(panel(f)).toMatchObject({ title: '외곽 고리 정화', action: '성좌 외곽 고리로 이동', roomId: RING.roomId, progress: 0, total: 4 });
  // 방 7 중심(core 안)으로 들어서면 정화가 시작되고, 집결 예고 동안 경계 고리·파편이, 터질 때 섬광이 보이며 피해는 집결마다 한 번이다.
  const r7 = ringRoom(f); f.g.player.pos.set(r7.x, 0, r7.z);
  f.route.update(f.g, 1 / 60);
  expect(f.route.ring.phase).toBe('running'); expect(f.route.ring.limit).toBe(RING.limit);
  while (f.route.ring.shard.state !== 'warning') f.route.update(f.g, 1 / 60);
  expect(visible(f, 'TLL_AstralDeepRingCoreBorder')).toBe(true); expect(visible(f, 'TLL_AstralDeepRingShards')).toBe(true);
  expect(visible(f, 'TLL_AstralDeepRingCoreFlash')).toBe(false);
  expect(panel(f).action).toMatch(/^파편이 모이면 중심 밖으로 · \d+초$/);
  while (f.route.ring.shard.state !== 'burst') f.route.update(f.g, 1 / 60);
  expect(visible(f, 'TLL_AstralDeepRingCoreFlash')).toBe(true); expect(visible(f, 'TLL_AstralDeepRingCoreBorder')).toBe(false);
  while (f.route.ring.shard.state === 'burst') f.route.update(f.g, 1 / 60);
  expect(f.route.ring.shardHits).toBe(1); expect(f.hurts).toEqual([100 * RING.damage]);
  // 성표 네 곳을 차례로 정화한다(유지 중에는 목표창 hold 가 오르고 성표 색이 바뀐다).
  for (let i = 0; i < 3; i++) {
    f.g.player.pos.copy(f.route.ring.marks[i].pos);
    f.route.update(f.g, .5);
    expect(panel(f).hold).toBeGreaterThan(0);
    f.route.update(f.g, .5);
  }
  // 마지막 성표는 실제 스텝(1/60)으로 채워 완료 직후 줄어드는 연출이 보이는지 본다.
  f.g.player.pos.copy(f.route.ring.marks[3].pos);
  while (f.route.ring.phase !== 'done') f.route.update(f.g, 1 / 60);
  expect(f.route.ring.phase).toBe('done'); expect(f.world.sealed).toBe(false);
  expect(panel(f).title).not.toBe('외곽 고리 정화');
  expect(f.messages.filter(m => m.startsWith('성표 정화'))).toEqual(['성표 정화 · 1/4', '성표 정화 · 2/4', '성표 정화 · 3/4']);
  // 완료 뒤 .5초 안에 고리 뷰가 사라진다.
  expect(view.drawCalls).toBeGreaterThan(0);
  for (let i = 0; i < 31; i++) f.route.update(f.g, 1 / 60);
  expect(view.drawCalls).toBe(0);
  const report = f.route.finish(false);
  expect(report.complete).toBe(false);
  expect(report.ring).toEqual({ purified: true, marks: 4, collapses: 0, shardHits: 1, seconds: report.ring.seconds });
  expect(astralDeepRingResultLine(report.ring)).toBe('외곽 고리 정화 완료 · 성표 4/4 · 파편 피격 1회 · 붕괴 0회');
  f.route.stop(); expect(view.disposed).toBe(true); expect(f.scene.getObjectByName('TLL_AstralDeepRing')).toBeUndefined();
});

