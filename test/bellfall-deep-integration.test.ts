import { expect, test } from 'bun:test';
import { Color, Scene, Vector3 } from 'three';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { BellfallDeepBells } from '../src/game/bellfall-deep-bells.js';
import { BellfallDeepBellView } from '../src/game/bellfall-deep-bell-view.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';
import { Battle } from '../src/game/battle-base.js';

// 교차 lane 통합 검사: rules lane 의 실제 컨트롤러와 worldui lane 의 실제 뷰·목표창을
// 실제 심층 월드와 Battle 메서드(enterRoom·markCleared·updateExpedition) 위에서 함께 돌린다.
// 각 lane 테스트는 상대 lane 을 가짜로 대신했으므로, 여기서만 이름·phase·정답 비노출 계약이 실제로 맞물리는지 확인한다.
const noop = () => {};
const DT = 1 / 60;
const HEX = { lit: 0xffd060, dark: 0x1c2a5c, resonated: 0x88dfc3, discord: 0xb06cff };

async function fixture() {
  const stage = buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' });
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
  const route = createRouteObjectives(stage, world) as BellfallDeepBells;
  g.routeObjectives = route;
  await route.prepareView(g.scene);
  return { g, world, route, drops, hurts };
}
type F = Awaited<ReturnType<typeof fixture>>;
const view = (f: F) => f.route.view as unknown as BellfallDeepBellView & Record<string, any>;
const indexOf = (f: F, id: number) => f.route.gates.findIndex((x: any) => x.room.id === id);
const bellHex = (f: F, id: number) => { const c = new Color(); view(f).bell.getColorAt(indexOf(f, id), c); return c.getHex(); };
const ringHex = (f: F, id: number) => { const c = new Color(); view(f).ring.getColorAt(indexOf(f, id), c); return c.getHex(); };
const items = (f: F) => f.drops.filter(d => d[1] === 'item').length;
const labels = (f: F) => f.route.gates.map((x: any) => x.label as string);

function clearRoom(f: F, id: number) {
  const room = f.world.rooms[id];
  room.discovered = true;
  f.g.enterRoom(room);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
  f.g.markCleared(room);
  f.g.updateExpedition(DT);
}
function stand(f: F, id: number) { const r = f.world.rooms[id]; f.g.player.pos.set(r.x, 0, r.z); }
function run(f: F, seconds: number) { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) f.g.updateExpedition(DT); }

test('실제 컨트롤러·뷰·목표창: 점등 → 소등 → 불협 2회 → guide → 역순 공명에서 표시와 판정이 같은 값을 읽는다', async () => {
  const f = await fixture();
  expect(f.route).toBeInstanceOf(BellfallDeepBells);
  expect(view(f)).toBeInstanceOf(BellfallDeepBellView);
  for (const id of [2, 3, 5]) expect(f.world.rooms[id].objectiveProp).toBe('bellfall-bell');

  // 점등: 보물방 2·5 에 공명 제단이 생기지 않고, 방은 정화되지 않으며 보상도 나오지 않는다.
  stand(f, 2); clearRoom(f, 2);
  expect(f.route.phase).toBe('wake');
  expect(f.world.rooms[2].attunementPending).toBeFalsy();
  expect(f.world.rooms[2].cleared).toBe(false);
  expect(bellHex(f, 2)).toBe(HEX.lit);
  // 목표창 값은 step() 기본값(0·null) 리터럴로 추론되므로 비교를 위해 넓은 타입으로 읽는다.
  let panel: any = battleObjectiveView(f.g);
  expect(panel.title).toBe('종문 점등');
  expect(panel.progress).toBe(1);
  stand(f, 3); clearRoom(f, 3);
  stand(f, 5); clearRoom(f, 5);
  expect(f.world.rooms[5].attunementPending).toBeFalsy();
  expect(f.route.phase).toBe('toll');
  expect(items(f)).toBe(0);
  expect(f.g.roomsCleared).toBe(0);

  // 소등: 목표창은 방금 꺼진 종 이름만 보이고, 뷰 색은 같은 프레임에 dark 로 바뀐다.
  const tolled: string[] = [];
  for (let i = 0; i < 6 / DT && f.route.phase === 'toll'; i++) {
    f.g.updateExpedition(DT);
    panel = battleObjectiveView(f.g);
    if (f.route.phase !== 'toll') break;
    expect(panel.title).toBe('소등 순서 기억');
    expect(panel.roomId).toBeNull();
    const last = f.route.lastToll as any;
    if (last && tolled[tolled.length - 1] !== last.label) {
      tolled.push(last.label);
      expect(panel.action).toBe(`${last.label} 소등`);
      expect(bellHex(f, last.room.id)).toBe(HEX.dark);
    }
  }
  expect(tolled).toEqual(['2번 종문 · 북동쪽 종탑', '3번 종문 · 남쪽 납골실', '1번 종문 · 북쪽 예배실']);
  expect(f.route.phase).toBe('answer');

  // 공명 단계: 세 종은 같은 dark 색이고, 목표창은 어떤 종문 이름도 보이지 않는다(정답 비노출).
  panel = battleObjectiveView(f.g);
  expect(panel.action).toBe('마지막에 꺼진 종부터 중심 2초');
  expect(panel.roomId).toBeNull();
  for (const label of labels(f)) expect(panel.action).not.toContain(label);
  expect(new Set([2, 3, 5].map(id => bellHex(f, id)))).toEqual(new Set([HEX.dark]));
  expect(new Set([2, 3, 5].map(id => ringHex(f, id)))).toEqual(new Set([HEX.dark]));

  // 오답(마지막 정답인 방 3)에서 유지: 진행 호와 목표창 유지 값이 같은 hold 를 읽고, 2초에 불협.
  stand(f, 3);
  run(f, 1);
  panel = battleObjectiveView(f.g);
  expect((f.route.holdGate as any)?.room.id).toBe(3);
  expect(view(f).arc.visible).toBe(true);
  expect(view(f).arc.position.x).toBeCloseTo(f.world.rooms[3].x, 6);
  expect(panel.hold).toBe(Math.floor(f.route.hold * 10) / 10);
  expect(panel.holdTotal).toBe(2);
  run(f, 1);
  expect(f.route.discords).toBe(1);
  expect(f.hurts).toEqual([6]);
  expect(f.route.phase).toBe('toll');
  expect(bellHex(f, 3)).toBe(HEX.discord);
  expect(bellHex(f, 2)).toBe(HEX.lit);
  run(f, .6);
  expect(bellHex(f, 3)).not.toBe(HEX.discord);
  expect(f.world.rooms[3].cleared).toBe(false);

  // 두 번째 불협 뒤에는 guide 가 다음 정답(방 2)을 목표창과 흰 링으로 알려준다.
  f.g.player.pos.set(f.world.rooms[1].x, 0, f.world.rooms[1].z);
  run(f, 4.8);
  expect(f.route.phase).toBe('answer');
  expect(f.route.guide).toBeNull();
  stand(f, 5);
  run(f, 2);
  expect(f.route.discords).toBe(2);
  f.g.player.pos.set(f.world.rooms[1].x, 0, f.world.rooms[1].z);
  run(f, 4.8);
  panel = battleObjectiveView(f.g);
  expect((f.route.guide as any)?.room.id).toBe(2);
  expect(panel.action).toBe('다음 1번 종문 · 북쪽 예배실 · 중심 2초');
  expect(panel.roomId).toBe(2);
  expect(ringHex(f, 2)).not.toBe(HEX.dark);
  expect(ringHex(f, 5)).toBe(HEX.dark);

  // 정답 2 → 5 → 3: 마지막 공명 순간에만 Battle 이 세 방을 정화하고 방 보상이 방마다 한 번 나온다.
  for (const id of [2, 5]) { stand(f, id); run(f, 2); expect(bellHex(f, id)).toBe(HEX.resonated); }
  expect(f.g.roomsCleared).toBe(0);
  stand(f, 3); run(f, 2);
  expect(f.route.phase).toBe('done');
  for (const id of [2, 3, 5]) expect(f.world.rooms[id].cleared).toBe(true);
  expect(f.g.roomsCleared).toBe(3);
  const after = items(f);
  run(f, 1);
  expect(f.g.roomsCleared).toBe(3);
  expect(items(f)).toBe(after);
  expect(f.hurts).toEqual([6, 6]);
  // 완료 뒤 목표창은 기존 봉인 안내로 넘어간다(정예방 등 남은 구역).
  expect(battleObjectiveView(f.g).title).toBe('보스 봉인 해제');

  const report = f.route.finish(false) as any;
  expect(report).toMatchObject({ id: 'bellfall_deep_bells', label: '종문 역순 공명', complete: false, progress: 3, target: 3, discords: 2, tolls: 3 });
  expect(report.rooms).toEqual([2, 5, 3]);
  expect(f.route.finish(true)).toBe(report);
  f.route.stop();
  expect(f.route.view).toBeNull();
});

test('일시정지는 소등 시계와 공명 유지를 멈추고, 재개하면 같은 시각부터 이어진다', async () => {
  const f = await fixture();
  for (const id of [2, 3, 5]) { stand(f, id); clearRoom(f, id); }
  run(f, 1.5);
  const clock = f.route.tollClock, index = f.route.tollIndex;
  f.g.paused = true;
  run(f, 3);
  expect(f.route.tollClock).toBe(clock);
  expect(f.route.tollIndex).toBe(index);
  f.g.paused = false;
  run(f, 3.3);
  expect(f.route.phase).toBe('answer');
  stand(f, 2);
  run(f, 1.5);
  expect(f.route.hold).toBeGreaterThan(1.4);
  f.g.paused = true; f.g.updateExpedition(DT);
  expect(f.route.hold).toBe(0);
  expect(f.route.progress).toBe(0);
});
