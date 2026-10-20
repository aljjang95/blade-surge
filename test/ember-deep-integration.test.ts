// 잿불금고 심층 냉각 밸브(BUNDLE-10) 교차 통합: 실제 Battle·CoolingValves·CoolingValveView·목표창을 함께 돌린다.
// rules lane 과 viewinput lane 은 서로 가짜를 썼으므로, 실제 증원(정예방 1회)·순서 대기·밀물 창·봉인 해제와
// 뷰의 밀물 색·닫힘 라벨이 같은 정의에서 맞는지 여기서 확인한다.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CoolingValves } from '../src/game/cooling-valves.js';
import { CoolingValveView } from '../src/game/cooling-valve-view.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { Battle } from '../src/game/battle-base.js';
import { battleObjectiveView } from '../src/ui/battle-objective-view.js';

const noop = () => {};
// 뷰는 라벨을 canvas 2d 로 그린다. document 가 없는 환경에서는 그린 글자를 기록하는 최소 대체를 테스트 동안만 둔다.
const drawn: string[][] = [];
const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document');
const realDocument = (globalThis as any).document;
beforeAll(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: {
    createElement: () => {
      const texts: string[] = []; drawn.push(texts);
      const context = { clearRect() {}, fillRect() {}, fillText: (t: string) => { texts.push(t); }, fillStyle: '', font: '', textAlign: '' };
      return { width: 0, height: 0, getContext: () => context };
    },
  } });
});
afterAll(() => {
  if (hadDocument) Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: realDocument });
  else delete (globalThis as any).document;
});
function makeGltf() {
  const scene = new THREE.Group(), body = new THREE.Group();
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); wheel.name = 'Wheel';
  const lens = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); lens.name = 'StatusLens';
  body.add(wheel, lens); scene.add(body);
  return { scene };
}

// 적 모델·렌더링은 필요 없다. 방 입장, 대기열, 증원, 목표, 정화·보상, 봉인은 실제 Battle 코드를 쓴다.
function fixture(routeId = 'ember_vault', depth = 'deep') {
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
    player: { alive: true, hp: 100, maxHp: 100, state: 'idle', pos: new THREE.Vector3(), game: g,
      forward: (v: THREE.Vector3) => v.set(1, 0, 0), dispose: noop, play: noop,
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
/** 입장 → 모든 적 처치. 정예방은 실제 markCleared 증원(mechanics.reinforcements 회)을 거쳐 마지막 처치에서 정화 시도까지 간다. */
function defend(f: F, id: number) {
  const room = enter(f, id), waves = room.type === 'elite' ? f.stage.expedition.mechanics.reinforcements + 1 : 1;
  for (let i = 0; i < waves; i++) {
    for (const e of f.g.enemies) if (e.homeRoom === room) e.alive = false;
    f.g.markCleared(room);
    for (const timer of f.g.timers.splice(0)) timer.fn();
  }
  return room;
}
/** 1/30초씩 조건이 될 때까지 진행한다. 매 스텝 영웅을 pos() 자리에 둔다. 유지가 늘면 그 스텝에 조작판이 열려 있어야 한다. */
function run(f: F, pos: () => THREE.Vector3, until: () => boolean, max = 900) {
  for (let i = 0; i < max; i++) {
    if (until()) return i;
    const gate: any = f.route.gates[f.route.progress];
    const before = f.route.hold;
    f.g.player.pos.copy(pos()); f.g.updateExpedition(1 / 30);
    if (gate && !gate.attuned && f.route.hold > before) expect(f.route.padOpen(gate)).toBe(true);
  }
  throw new Error('조건에 도달하지 못했다');
}

test('실제 Battle: 정예방 증원 1회 → 밀물이 지나간 뒤에만 열리는 조작판 → 순서 대기 → 3/3 과 모든 구역 뒤 봉인 해제', () => {
  const f = fixture();
  expect(f.route.def.id).toBe('ember_tide_valves_deep');
  expect(f.route.gates.map((g: any) => g.room.id)).toEqual([2, 3, 4]);
  expect(f.stage.expedition.mechanics.reinforcements).toBe(1);
  // 출발 직후에는 1번 밸브 방을 아직 발견하지 않았다.
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '냉각 밸브 개방', action: '다음 구역을 찾아 이동', progress: 0, total: 3, roomId: null });

  defend(f, 1);
  expect(f.world.rooms[1].cleared).toBe(true);
  // 3번(방 4)을 2번보다 먼저 정리해도 열리지 않고 그 방도 정화되지 않는다.
  const r4 = defend(f, 4), g4 = gateOf(f, 4);
  expect(g4.ready).toBe(true); expect(g4.attuned).toBe(false); expect(r4.cleared).toBe(false);

  // 1번(방 2, 정예): 첫 처치 뒤에는 증원이 남아 준비되지 않는다.
  const r2 = enter(f, 2), g2 = gateOf(f, 2);
  for (const e of f.g.enemies) if (e.homeRoom === r2) e.alive = false;
  f.g.markCleared(r2);
  expect(g2.ready).toBe(false);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  for (const e of f.g.enemies) if (e.homeRoom === r2) e.alive = false;
  f.g.markCleared(r2);
  expect(g2.ready).toBe(true); expect(r2.cleared).toBe(false);
  expect(f.messages).toContain('1번 냉각 밸브 · 좌현 화물칸 방어 완료 · 밀물이 빠진 뒤 청록 조작판에서 2초 유지');
  expect(battleObjectiveView(f.g)).toMatchObject({ title: '냉각 밸브 개방', action: '밀물이 빠진 뒤 옮겨 간 조작판으로 이동', progress: 0, total: 3 });

  // 준비 뒤 첫 밀물이 지나가기 전에는 조작판 위에 서 있어도 유지가 0 이다.
  run(f, () => g2.pad, () => g2.phase === 'warning');
  expect(f.route.hold).toBe(0);
  expect(battleObjectiveView(f.g).action).toBe('밀물을 피한 뒤 옮겨 간 조작판으로 이동');
  expect(f.route.hint()).toContain('밀물 경고');
  run(f, () => g2.pad, () => g2.phase === 'vent');
  expect(f.route.hint()).toContain('밀물');
  run(f, () => g2.pad, () => g2.phase === 'heat');
  expect(g2.shocks).toBe(1);
  expect(f.route.hint()).toContain('물 빠짐');
  run(f, () => g2.pad, () => g2.attuned);
  expect(r2.cleared).toBe(true);
  expect(f.labels.some(t => t === '밀물 뒤 조작판')).toBe(true);
  expect(f.labels.some(t => t.includes('충격파'))).toBe(false);

  // 2번(방 3, 정예) → 3번(방 4, 이미 준비됨: 차례가 되면 밀물을 한 번 다시 겪어야 열린다).
  defend(f, 3); const g3 = gateOf(f, 3);
  run(f, () => g3.pad, () => g3.attuned);
  expect(f.world.sealed).toBe(true);
  const before = g4.shocks;
  run(f, () => g4.pad, () => g4.attuned);
  expect(g4.shocks).toBeGreaterThan(before);
  expect(f.route.progress).toBe(3);
  expect(f.world.rooms.filter((r: any) => !['start', 'boss'].includes(r.type)).every((r: any) => r.cleared)).toBe(true);
  expect(f.route.canUnseal()).toBe(true);
  // 봉인 해제는 마지막 정화 1.2초 뒤 Battle 타이머로 온다(battle-base markCleared).
  expect(f.world.sealed).toBe(true);
  for (const timer of f.g.timers.splice(0)) timer.fn();
  expect(f.world.sealed).toBe(false);
  expect(f.route.finish(true)).toMatchObject({ id: 'ember_tide_valves_deep', label: '냉각 밸브 개방', progress: 3, target: 3, rooms: [2, 3, 4] });
  expect(f.messages.join('\n')).not.toContain('충격파');
});

test('실제 뷰: 잿불금고 심층은 파란 밀물 띠와 밀물 대기 라벨, 재벼림 심층은 주황 띠와 충격파 대기 그대로', () => {
  for (const [id, color, wait] of [['ember_vault', 0x3d8cff, '밀물 대기'], ['ashforge_catacomb', 0xff863e, '충격파 대기']] as const) {
    drawn.length = 0;
    const f = fixture(id), first: any = f.route.gates[0];
    const view: any = new CoolingValveView(new THREE.Scene(), makeGltf(), f.route);
    f.route.view = view;
    defend(f, first.room.id);
    expect(first.ready).toBe(true);
    // 준비 순간(beforeClear 의 syncView) 같은 호출 안에서 닫힘 라벨이 그려진다.
    expect(drawn[0].at(-1)).toBe('01 · ' + wait);
    expect(view.entries[0].vent.material.uniforms.color.value.getHex()).toBe(color);
    run(f, () => first.pad, () => first.phase === 'warning');
    expect(view.entries[0].vent.visible).toBe(true);
    f.route.stop();
  }
});
test('전술 공략(밸브 없는 심층 동선)의 보스 전술 문구에는 밸브·밀물 안내가 없고, 개인 심층에는 있다', () => {
  const solo = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
  expect(solo.encounter.tactic).toContain('냉각 밸브');
  for (const conquestId of ['vault_signal', 'vault_manifest']) {
    const stage = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep', conquestId });
    expect(createRouteObjectives(stage, buildExpeditionWorld(stage))).toBeNull();
    expect(stage.encounter.tactic).not.toMatch(/냉각 밸브|밀물|조작판/);
    expect(stage.encounter.tactic).toContain('화물칸의 정예방마다 적과 1회 증원을 격파하세요.');
  }
});
