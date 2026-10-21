import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Input } from '../src/engine/input.js';
import { Player } from '../src/game/player.js';
import { HEROES } from '../src/data/heroes.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

// ---------- 입력 계층: 버튼 홀드 수명주기와 멀티터치 ----------
class ElementStub extends EventTarget {
  style: Record<string, any> = { setProperty() {}, removeProperty() {} };
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {}, toggle() {} };
  closest() { return null; }
  getBoundingClientRect() { return { left: 700, top: 250, width: 60, height: 60 }; }
}
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let host: EventTarget, documentStub: any, elements: Map<string, ElementStub>, input: Input, skillButton: ElementStub;

function touch(target: EventTarget, type: string, id: number, x = 0, y = 0) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'changedTouches', { value: [{ identifier: id, clientX: x, clientY: y }] });
  target.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  elements = new Map(); host = new EventTarget();
  const find = (id: string) => { if (!elements.has(id)) elements.set(id, new ElementStub()); return elements.get(id)!; };
  skillButton = new ElementStub(); skillButton.dataset.skill = '3';
  documentStub = Object.assign(new EventTarget(), { hidden: false, getElementById: find, querySelector: find,
    querySelectorAll: (selector: string) => selector === '.skill-btn' ? [skillButton] : [] });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
  input = new Input(); input.enabled = true;
});
afterEach(() => {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
});

describe('공격 버튼 홀드 수명주기', () => {
  test('버튼을 누르고 있는 동안 attackHeld 가 유지되고 떼면 풀린다', () => {
    const button = elements.get('btn-attack')!;
    touch(button, 'touchstart', 3);
    for (let i = 0; i < 10; i++) { input.update(); expect(input.attackHeld).toBe(true); }
    touch(button, 'touchend', 3);
    expect(input.attackHeld).toBe(false);
  });
  for (const [name, release] of [
    ['touchcancel', () => touch(elements.get('btn-attack')!, 'touchcancel', 3)],
    ['blur', () => host.dispatchEvent(new Event('blur'))],
    ['pagehide', () => host.dispatchEvent(new Event('pagehide'))],
    ['visibilitychange(hidden)', () => { documentStub.hidden = true; documentStub.dispatchEvent(new Event('visibilitychange')); }],
    ['orientationchange', () => host.dispatchEvent(new Event('orientationchange'))],
    ['clear (일시정지·사망·전투 종료 경로)', () => input.clear()],
  ] as const) test(`${name} 은 공격 홀드를 놓지 못한 채 남기지 않는다`, () => {
    touch(elements.get('btn-attack')!, 'touchstart', 3);
    expect(input.attackHeld).toBe(true);
    release();
    input.update();
    expect(input.attackHeld).toBe(false);
    // 놓친 touchend 뒤에도 새 손가락으로 다시 누를 수 있다(소유권이 남아 있지 않다).
    touch(elements.get('btn-attack')!, 'touchstart', 4);
    expect(input.attackHeld).toBe(true);
  });
  test('버튼 위 길게 누르기 컨텍스트 메뉴는 열리지 않는다(브라우저가 터치를 취소하지 못하게)', () => {
    const menu = new Event('contextmenu', { cancelable: true });
    elements.get('btn-attack')!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
  test('조이스틱 + 공격 홀드 + 스킬 탭이 동시에 되고 서로를 끊지 않는다', () => {
    const joy = elements.get('joy')!, attack = elements.get('btn-attack')!;
    touch(joy, 'touchstart', 1, 80, 300); touch(joy, 'touchmove', 1, 132, 300);
    touch(attack, 'touchstart', 2);
    input.update();
    expect(input.attackHeld).toBe(true); expect(input.move.x).toBeGreaterThan(0.9);
    // 세 번째 손가락으로 궁극기 버튼 탭
    touch(skillButton, 'touchstart', 3, 730, 280); touch(host, 'touchend', 3, 730, 280);
    input.update();
    expect(input.queue).toContain('skill3');
    expect(input.attackHeld).toBe(true); expect(input.joy.active).toBe(true); expect(input.move.x).toBeGreaterThan(0.9);
    // 조이스틱 손가락만 떼도 공격 홀드는 유지, 공격을 떼면 풀린다.
    touch(joy, 'touchend', 1); input.update();
    expect(input.move.x).toBe(0); expect(input.attackHeld).toBe(true);
    touch(attack, 'touchend', 2); expect(input.attackHeld).toBe(false);
  });
  test('키보드 J·Space 홀드도 같은 attackHeld 를 쓰고 blur 로 풀린다', () => {
    const key = (type: string, code: string) => { const e = new Event(type, { cancelable: true }); Object.defineProperties(e, { code: { value: code }, repeat: { value: false } }); host.dispatchEvent(e); };
    key('keydown', 'Space'); expect(input.attackHeld).toBe(true);
    host.dispatchEvent(new Event('blur')); expect(input.attackHeld).toBe(false);
    key('keydown', 'KeyJ'); expect(input.attackHeld).toBe(true); key('keyup', 'KeyJ'); expect(input.attackHeld).toBe(false);
  });
});

// ---------- 게임 계층: 실제 Player + 전투 시계 ----------
const runtime = await loadCombatFlowRuntime();
const players: Player[] = [];
afterEach(() => { for (const player of players.splice(0)) player.dispose(); });

function fixture(heroId: string) {
  const f: any = createCombatFlowFixture(runtime, heroId);
  f.game.fx.aura = () => {};
  f.game.app.eco = { s: { settings: { autoTarget: false } } };
  f.game.pauseReasons = new Set();
  f.game.scene.remove(f.player.root);
  const def = f.player.def, position = f.player.pos.clone();
  const names = new Set(['Idle', 'Running_A', 'Dodge_Forward', 'Dodge_Backward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B',
    ...def.combo.map((c: any) => c.anim), ...def.skills.map((s: any) => s.anim).filter(Boolean)]);
  const gltf = { scene: new THREE.Group(), animations: [...names].map(name => new THREE.AnimationClip(name, 1, [])) };
  f.player = f.game.player = new Player(f.game, gltf, def, f.player.stats);
  f.player.pos.copy(position);
  players.push(f.player);
  return f;
}
function countStarts(f: any) {
  const starts: number[] = [], original = f.player.startCombo.bind(f.player);
  f.player.startCombo = (idx: number, yaw: number | null) => { starts.push(f.game.elapsed); return original(idx, yaw); };
  return starts;
}

describe('홀드 평타 반복', () => {
  for (const heroId of Object.keys(HEROES)) test(`${heroId}: 3초 홀드 동안 평타가 끊김 없이 이어지고 떼면 멈춘다`, () => {
    const f = fixture(heroId), p: any = f.player, dt = 1 / 60, starts = countStarts(f);
    f.game.input.attackHeld = true;
    for (let i = 0; i < 180; i++) stepCombatFlow(f, dt);
    const slowest = Math.max(...p.def.combo.map((c: any) => c.dur)) + 0.25;
    // 평타 길이가 0.4~0.9초대이므로 3초 안에 최소 3번은 시작한다(탭 한 번이면 1번).
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeLessThan(slowest);
    expect(f.game.elapsed - starts[starts.length - 1]).toBeLessThan(slowest);
    // 떼면 진행 중인 타만 끝나고 새 평타가 시작되지 않는다.
    f.game.input.attackHeld = false;
    for (let i = 0; i < 60; i++) stepCombatFlow(f, dt);
    const afterRelease = starts.length;
    for (let i = 0; i < 120; i++) stepCombatFlow(f, dt);
    expect(starts.length).toBe(afterRelease);
    expect(p.state).toBe('idle');
  });
  test('홀드 반복 속도는 탭을 정확히 맞춰 연타한 것(연계 창 기준)과 같다', () => {
    const tap = fixture('knight'), hold = fixture('knight'), dt = 1 / 60;
    const tapStarts = countStarts(tap), holdStarts = countStarts(hold);
    hold.game.input.attackHeld = true;
    for (let i = 0; i < 240; i++) {
      // 탭 쪽은 매 스텝 새 입력을 넣어(최대 연타) 연계 창 한계 속도를 잰다.
      tap.game.input.press('attack');
      stepCombatFlow(tap, dt); stepCombatFlow(hold, dt);
    }
    expect(holdStarts.length).toBe(tapStarts.length);
  });
  test('AUTO 는 홀드 값과 무관하게 자체 루프를 쓴다(홀드가 이중 입력을 만들지 않는다)', () => {
    const f = fixture('knight'), p: any = f.player;
    p.auto = true; p.autoMove = () => ({ x: 0, y: 0 });
    const starts = countStarts(f);
    f.game.input.attackHeld = true;
    p.handleInput(f.game.input, 1 / 60);
    expect(starts.length).toBe(0); expect(p.attackBufferT).toBe(0);
  });
  test('입력이 꺼진 상태의 남은 홀드 값은 공격을 시작하지 않는다', () => {
    const f = fixture('knight'), starts = countStarts(f);
    f.game.input.attackHeld = true; f.game.input.enabled = false;
    for (let i = 0; i < 30; i++) stepCombatFlow(f, 1 / 60);
    expect(starts.length).toBe(0);
  });
  test('회피·스킬 뒤에도 홀드면 공격이 이어지고, 회피 우선권은 그대로다', () => {
    const f = fixture('knight'), p: any = f.player, dt = 1 / 60, starts = countStarts(f);
    f.game.input.attackHeld = true;
    for (let i = 0; i < 120 && !(p.state === 'attack' && p.canDodgeCancel()); i++) stepCombatFlow(f, dt);
    expect(p.canDodgeCancel()).toBe(true);
    f.game.input.press('dodge'); stepCombatFlow(f, dt);
    expect(p.state).toBe('dodge');
    for (let i = 0; i < 40; i++) stepCombatFlow(f, dt);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(p.state === 'attack' || p.state === 'idle').toBe(true);
  });
});

// ---------- 궁수 궁극기 방향 ----------
describe('궁수 궁극기 방향', () => {
  function ultFixture(heroId = 'ranger') {
    const f = fixture(heroId), p: any = f.player;
    p.ult = p.ultMax; p.mp = p.maxMp; p.ultMax = 100;
    f.game.ultCinematic = () => {}; f.game.onSkillReleased = () => {};
    p.arrowOrigin = (dir: THREE.Vector3) => p.pos.clone().addScaledVector(dir, .9).setY(1.2);
    return f;
  }
  const ultSlot = (p: any) => p.def.skills.findIndex((s: any) => s.ult);
  function castUlt(f: any, move: { x: number; y: number }, opts: { shooting?: boolean } = {}) {
    const p: any = f.player, dt = 1 / 60, input = f.game.input;
    // 조준 보조 대상이 있는 사격 중 상태: 몸은 입력과 다른 쪽(+z)을 보고 있다.
    if (opts.shooting) { p.yaw = 0; p.state = 'attack'; p.current = p.def.combo[0]; p.hitDone = true; p.stateT = p.current.dur * 0.8; p.stateT = Math.max(p.stateT, 0.01); }
    input.move.x = move.x; input.move.y = move.y;
    input.press('skill' + ultSlot(p));
    p.handleInput(input, dt);
    expect(p.state).toBe('ult');
    f.game.projectiles.length = 0;
    for (let i = 0; i < 80 && f.game.projectiles.length === 0; i++) stepCombatFlow(f, dt);
    return f.game.projectiles.map((pr: any) => pr.vel ? pr.vel.clone().setY(0).normalize() : pr.dir.clone().setY(0).normalize());
  }
  const dirs = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };
  for (const [name, move] of Object.entries(dirs)) for (const shooting of [false, true]) {
    test(`ranger: 이동 입력 ${name}${shooting ? '(사격 중)' : ''} 으로 궁극기 7발의 중심이 그 방향으로 나간다`, () => {
      const f = ultFixture(), shots = castUlt(f, move, { shooting });
      expect(shots.length).toBe(7);
      const center = shots.reduce((a: THREE.Vector3, v: THREE.Vector3) => a.add(v), new THREE.Vector3()).normalize();
      const want = new THREE.Vector3(move.x, 0, move.y).normalize();
      expect(center.dot(want)).toBeGreaterThan(0.98);
    });
  }
  test('ranger: 이동 입력이 없으면 바라보던 방향(기존 동작)으로 나간다', () => {
    const f = ultFixture(), p: any = f.player;
    p.yaw = Math.PI / 2;
    const shots = castUlt(f, { x: 0, y: 0 });
    const center = shots.reduce((a: THREE.Vector3, v: THREE.Vector3) => a.add(v), new THREE.Vector3()).normalize();
    expect(center.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0.98);
  });
  test('ranger: 끌어서 정한 조준은 이동 입력보다 우선한다', () => {
    const f = ultFixture(), p: any = f.player, input = f.game.input;
    input.move.x = -1; input.move.y = 0;
    input.aimedCasts = new Map([[ultSlot(p), { slot: ultSlot(p), x: 0, z: 1, dist01: 1 }]]);
    input.takeAim = function (slot: number) { const a = this.aimedCasts.get(slot); this.aimedCasts.delete(slot); return a; };
    input.press('skill' + ultSlot(p));
    p.handleInput(input, 1 / 60);
    expect(p.state).toBe('ult');
    expect(Math.sin(p.yaw)).toBeCloseTo(0, 5); expect(Math.cos(p.yaw)).toBeCloseTo(1, 5);
  });
  test('ranger: 이동 입력을 쓰는 방향 보정은 지점(aimPoint)을 만들지 않고 객체를 재사용한다', () => {
    const f = ultFixture(), p: any = f.player;
    f.game.input.move.x = 1; f.game.input.move.y = 0;
    f.game.input.press('skill' + ultSlot(p));
    p.handleInput(f.game.input, 1 / 60);
    expect(p.skillCtx.data.aimPoint).toBeUndefined();
    const first = p._heldMoveAim; p.moveDir.set(0, 0, 1);
    expect(p.heldMoveAim(true)).toBe(first);
    expect(p.heldMoveAim(false)).toBeNull();
  });
  test('ranger 의 일반 스킬(관통·삼중)도 같은 이동 방향 규칙을 따른다', () => {
    for (const slot of [0, 1]) {
      const f = ultFixture(), p: any = f.player, input = f.game.input;
      p.cds.fill(0); p.yaw = 0;
      input.move.x = -1; input.move.y = 0;
      p.mp = p.maxMp;
      input.press('skill' + slot);
      p.handleInput(input, 1 / 60);
      expect(Math.sin(p.yaw)).toBeCloseTo(-1, 5);
    }
  });
  test('ranger 가 아닌 영웅은 기존대로 동작한다(방향 보정 없음)', () => {
    const f = fixture('knight'), p: any = f.player;
    p.moveDir.set(1, 0, 0);
    expect(p.heldMoveAim(true)).toBeNull();
  });
});
