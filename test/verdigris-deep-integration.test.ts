// BUNDLE-11 Opus 교차 통합: 실제 규칙(VerdigrisDeepAltars) → 실제 뷰(VerdigrisDeepView) → 실제 목표창·결과 줄.
// lane 테스트는 서로 가짜 route·가짜 뷰로만 봤다. 여기서는 실제 Battle 경로로 방을 정리하고 같은 route 를 뷰·목표창이 읽는다.
import { expect, test } from 'bun:test';
import { Color, Matrix4, Quaternion, Scene, Vector3 } from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { Battle } from '../src/game/battle-base.js';
import { VerdigrisDeepView, altarState } from '../src/game/verdigris-deep-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { sporeChannelResultLine } from '../src/expansion/hub.jsx';

const noop = () => {};
const CH = ROUTE_OBJECTIVES.verdigris_deep.channel;

function fixture() {
  const stage = buildExpeditionStage('dungeon', 'verdigris_sanctum', null, { depth: 'deep' });
  const world = buildExpeditionWorld(stage);
  const messages: string[] = [];
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
      forward: (v: Vector3) => v.set(1, 0, 0), dispose: noop, play: noop, hurt: () => true },
    spawnEnemy(_id: string, _near: any, room: any) {
      g.routeObjectives?.spawn(room); g.enemies.push({ alive: true, homeRoom: room, dispose: noop, pos: new Vector3(9999, 0, 9999), radius: .5 });
    },
  });
  const route: any = createRouteObjectives(stage, world);
  g.routeObjectives = route; g.autoTarget = route.autoRoom();
  return { g, world, route, messages };
}
type F = ReturnType<typeof fixture>;
const room = (f: F, id: number): any => f.world.rooms[id];
const at = (f: F, id: number, dx = 0) => { const r = room(f, id); f.g.player.pos.set(r.x + dx, 0, r.z); };
function clearRoom(f: F, id: number) {
  const r = room(f, id); f.g.enterRoom(r);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  const gate = f.route.gates.find((x: any) => x.room === r);
  for (let i = 0; i < 6 && !r.cleared && !(gate && gate.ready); i++) {
    for (const e of f.g.enemies) if (e.homeRoom === r) e.alive = false;
    f.g.markCleared(r);
  }
}
const steps = (f: F, n: number) => { for (let i = 0; i < n; i++) f.route.update(f.g, 1 / 60); };
const panel = (f: F) => battleObjectiveView(f.g) as any;
const m4 = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3(), c = new Color();
const beamAt = (view: any, i: number) => { view.beam.getMatrixAt(i, m4); m4.decompose(p, q, s); return { x: p.x, z: p.z, h: s.y }; };
const bandHex = (view: any, i: number) => { view.bands.getColorAt(i, c); return c.getHex(); };

test('실제 규칙 → 실제 뷰·목표창: 점등 이동, 비점등 보라 고리, 수로 열림·분출 색·돌파 뒤 숨김, 보스 흐름과 결과 줄', async () => {
  const f = fixture();
  await f.route.prepareView(new Scene());
  const view = f.route.view;
  expect(view).toBeInstanceOf(VerdigrisDeepView);

  // 1) 첫 점등은 방 2. 방 3 을 먼저 정리하면 정화 준비가 된 비점등 제단(보라)이고 방은 정화되지 않는다.
  clearRoom(f, 3);
  expect(f.route.gates[2].ready).toBe(true); expect(room(f, 3).cleared).toBe(false);
  expect(altarState(f.route, 2)).toBe('danger');
  clearRoom(f, 2); at(f, 2);
  expect(altarState(f.route, 0)).toBe('lit');
  expect(panel(f)).toMatchObject({ title: '생명 제단 정화', action: '뿌리 빛 제단 중심에서 2초 유지', roomId: 2, progress: 0, total: 4 });
  steps(f, 30);
  // 인스턴스 행렬은 Float32 라 좌표는 소수 넷째 자리까지 비교한다.
  expect(beamAt(view, 0).x).toBeCloseTo(room(f, 2).x, 4); expect(beamAt(view, 0).z).toBeCloseTo(room(f, 2).z, 4);
  expect(beamAt(view, 0).h).toBeGreaterThan(1);

  // 2) 방 2 정화 → 뿌리 빛이 방 5 로 옮겨 간다. 방 5 는 아직 발견 전이라 목표창은 이동 안내, 기둥은 방 2 에서 사라진다.
  steps(f, 100);
  expect(f.route.progress).toBe(1); expect(f.route.litMoves).toBe(1); expect(f.route.lit.room.id).toBe(5);
  expect(f.messages).toContain('뿌리 샘 제단 정화 · 1/4 · 뿌리 빛이 이끼 못 제단으로 옮겨 갑니다');
  expect(altarState(f.route, 0)).toBe('purified');
  expect(beamAt(view, 0).h).toBe(0);
  expect(panel(f)).toMatchObject({ action: '다음 구역을 찾아 이동', roomId: null, progress: 1 });
  clearRoom(f, 1); clearRoom(f, 4); clearRoom(f, 5); at(f, 5); steps(f, 1);
  expect(altarState(f.route, 1)).toBe('lit');
  expect(panel(f)).toMatchObject({ roomId: 5, action: '뿌리 빛 제단 중심에서 2초 유지' });
  steps(f, 125);
  expect(f.route.lit.room.id).toBe(3); expect(altarState(f.route, 2)).toBe('lit');
  at(f, 3); steps(f, 125);
  clearRoom(f, 6); at(f, 6); steps(f, 125);
  expect(f.route.progress).toBe(4); expect(f.route.lit).toBeNull();

  // 3) 남은 정예방 7 을 정리하면 다음 update 에서 수로가 열린다. 목표창은 서쪽 입구 안내, 수로 메시가 보인다.
  clearRoom(f, 7);
  expect(f.route.channel.phase).toBe('idle');
  expect(panel(f)).toMatchObject({ title: '생명 제단 정화', action: '남은 구역 정화' });
  at(f, 6); steps(f, 1);
  expect(f.route.channel.phase).toBe('open');
  expect(f.world.sealed).toBe(true);
  expect(view.bands.visible).toBe(true); expect(view.drawCalls).toBeGreaterThan(2);
  expect(panel(f)).toMatchObject({ title: '포자 수로 돌파', action: '서쪽 수로 입구로 이동', roomId: 7 });

  // 4) 출발선 안쪽에서 시작. 첫 띠가 분출하는 스텝에 뷰 색이 분출 색이고, 목표창은 남은 초를 보인다.
  at(f, 7, CH.startLine - .5); steps(f, 1);
  expect(f.route.channel.phase).toBe('running');
  expect(panel(f).action).toBe('포자 물결이 지나간 뒤 동쪽 출구로 · ' + Math.ceil(f.route.channel.left) + '초');
  let guard = 0;
  while (f.route.channel.bands[0].state !== 'burst' && guard++ < 400) steps(f, 1);
  expect(f.route.channel.bands[0].state).toBe('burst');
  expect(bandHex(view, 0)).toBe(CH.color);
  while (f.route.channel.bands[0].state === 'burst' && guard++ < 800) steps(f, 1);
  expect(bandHex(view, 0)).toBe(0x2f5d3a);

  // 5) 도착선을 넘으면 돌파, 봉인 해제. 뷰는 .5초 뒤 수로를 숨기고 목표창은 보스 흐름으로 간다.
  at(f, 7, CH.finishLine + .2); steps(f, 1);
  expect(f.route.channel.phase).toBe('done'); expect(f.world.sealed).toBe(false);
  steps(f, 40);
  expect(view.bands.visible).toBe(false);
  expect(panel(f).title).toMatch(/^보스/);

  // 6) 결과 줄은 실제 보고에서 만든다(패배 보고라도 돌파 기록은 사실대로).
  const report = f.route.finish(false);
  expect(report.complete).toBe(false);
  expect(report.rooms).toEqual([2, 5, 3, 6]);
  expect(report.channel.crossed).toBe(true);
  expect(sporeChannelResultLine(report.channel)).toBe('포자 수로 돌파 완료 · 포자 피격 ' + report.channel.sporeHits + '회 · 범람 0회');
  f.route.stop();
  expect(f.route.view).toBeNull();
});
