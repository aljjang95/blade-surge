import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Input } from '../src/engine/input.js';

// 눌려 있는 이동 키를 정지·창·부활 뒤에도 이어 가는 동작을 실제 이벤트로 관찰한다(BUNDLE-10 PLAN 3.2).
class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let host: EventTarget;
let doc: EventTarget & { hidden: boolean };
let input: Input;

// target 은 closest(selector) 가 selector 안에 들어 있는 태그 이름이면 요소를 돌려주는 가짜 요소다.
function target(tag: string) {
  return { closest: (selector: string) => (selector.split(',').some(part => part.trim() === tag || part.trim() === '[' + tag + ']') ? {} : null) };
}
function key(type: string, code: string, over: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: over.repeat ?? false } });
  for (const [name, value] of Object.entries(over)) if (name !== 'repeat') Object.defineProperty(event, name, { value });
  host.dispatchEvent(event);
  return event;
}
// 정지 화면이 열렸다 닫히는 경로(battle-base setPaused)와 같은 순서: 끄고 비우기 → 켜고 비우기.
const keys = () => input.keys as Record<string, boolean | undefined>;
function pause() { input.enabled = false; input.clear(); }
function resume() { input.enabled = true; input.clear(); }

beforeEach(() => {
  host = new EventTarget();
  const find = () => new ElementStub();
  doc = Object.assign(new EventTarget(), { hidden: false, getElementById: find, querySelector: find, querySelectorAll: () => [] });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
  (host as any).innerWidth = 390; (host as any).innerHeight = 700;
  input = new Input(); input.enabled = true;
});

afterEach(() => {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
});

describe('눌린 이동 키 되살리기', () => {
  test('누른 채 정지했다 해제하면 키를 다시 누르지 않아도 이동이 이어진다', () => {
    key('keydown', 'KeyD'); input.update();
    expect(input.move.x).toBe(1);
    pause(); input.update();
    expect(input.move).toEqual({ x: 0, y: 0 });
    resume(); input.update();
    expect(input.move.x).toBe(1);
    expect(keys().KeyD).toBe(true);
  });
  test('방향키와 두 키 조합도 이어지고 대각선은 정규화된다', () => {
    key('keydown', 'ArrowUp'); key('keydown', 'KeyD');
    pause(); resume(); input.update();
    expect(input.move.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(input.move.y).toBeCloseTo(-Math.SQRT1_2, 6);
  });
  test('입력이 꺼진 동안은 눌려 있어도 이동이 0이다', () => {
    key('keydown', 'KeyW'); pause();
    for (let i = 0; i < 5; i++) { input.update(); expect(input.move).toEqual({ x: 0, y: 0 }); }
    expect(keys().KeyW).toBeUndefined();
  });
  test('clear() 만 불려도(enabled 유지) 다음 갱신에서 이어진다', () => {
    key('keydown', 'KeyS'); input.update(); input.clear();
    expect(input.keys).toEqual({});
    input.update(); expect(input.move.y).toBe(1);
  });
  test('enabled 만 껐다 켜도(clear 없이) 눌린 이동 키가 이어진다', () => {
    key('keydown', 'KeyA'); input.update();
    input.enabled = false; input.update(); input.enabled = true; input.keys = {}; input.update();
    expect(input.move.x).toBe(-1);
  });
  test('창 안에서 keyup 을 받은 키는 되살리지 않는다', () => {
    key('keydown', 'KeyD'); key('keydown', 'KeyW'); pause();
    key('keyup', 'KeyD', { target: target('button') });
    resume(); input.update();
    expect(input.move.x).toBe(0); expect(input.move.y).toBe(-1);
  });
  test('창이 열려 있는 동안 새로 누른 키는 되살리지 않는다', () => {
    pause(); key('keydown', 'KeyD', { target: target('button') });
    resume(); input.update();
    expect(input.move).toEqual({ x: 0, y: 0 });
  });
  test('blur·pagehide·visibilitychange(hidden) 뒤에는 되살리지 않는다', () => {
    const cases: Array<[string, () => void]> = [
      ['blur', () => host.dispatchEvent(new Event('blur'))],
      ['pagehide', () => host.dispatchEvent(new Event('pagehide'))],
      ['hidden', () => { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); doc.hidden = false; }],
    ];
    for (const [, lose] of cases) {
      key('keydown', 'KeyD'); lose(); pause(); resume(); input.update();
      expect(input.move).toEqual({ x: 0, y: 0 });
      key('keyup', 'KeyD');
    }
  });
  test('보이는 상태로 돌아오는 visibilitychange 는 held 를 지우지 않는다', () => {
    key('keydown', 'KeyD'); doc.dispatchEvent(new Event('visibilitychange')); pause(); resume(); input.update();
    expect(input.move.x).toBe(1);
  });
  test('blur 뒤 다시 누르면 새로 이동한다', () => {
    key('keydown', 'KeyD'); host.dispatchEvent(new Event('blur')); input.update();
    key('keydown', 'KeyD'); input.update();
    expect(input.move.x).toBe(1);
  });
  test('글자 입력 요소 대상 keydown 은 held 에 넣지 않는다', () => {
    for (const tag of ['input', 'textarea', 'select', 'contenteditable']) {
      key('keydown', 'KeyD', { target: target(tag) }); pause(); resume(); input.update();
      expect(input.move.x).toBe(0);
    }
  });
  test('button·dialog 대상 keydown 은 held 에 넣어 창을 닫은 뒤 이어진다', () => {
    for (const tag of ['button', 'dialog']) {
      key('keydown', 'KeyD', { target: target(tag) }); pause(); resume(); input.update();
      expect(input.move.x).toBe(1);
      key('keyup', 'KeyD'); input.clear(); input.update();
      expect(input.move.x).toBe(0);
    }
  });
  test('ctrl·meta·alt 동반 keydown 은 held 에 넣지 않는다', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      key('keydown', 'KeyD', { [modifier]: true }); pause(); resume(); input.update();
      expect(input.move.x).toBe(0);
    }
  });
  test('입력이 켜지기 전부터 눌려 있던 키는 자동 반복(repeat)만 들어와도 held 가 되지 않는다', () => {
    input.enabled = false; input.clear();
    key('keydown', 'KeyD'); input.enabled = true; input.clear();
    key('keydown', 'KeyD', { repeat: true }); input.update();
    expect(input.move.x).toBe(0);
    pause(); resume(); input.update();
    expect(input.move.x).toBe(0);
  });
  test('공격·회피·스킬 키는 되살리지 않는다', () => {
    for (const code of ['KeyJ', 'Space', 'KeyK', 'ShiftLeft', 'KeyF', 'KeyR', 'Digit1']) key('keydown', code);
    input.update(); pause(); resume(); input.update();
    expect(input.attackHeld).toBe(false);
    expect(input.queue).toEqual([]);
    expect(keys().KeyJ).toBeUndefined(); expect(keys().Space).toBeUndefined();
  });
  test('되살린 키도 keyup 으로 멈춘다', () => {
    key('keydown', 'KeyD'); pause(); resume(); input.update();
    key('keyup', 'KeyD'); input.update();
    expect(input.move.x).toBe(0); expect(keys().KeyD).toBe(false);
  });
  test('터치 조이스틱이 활성이면 키보드 복원이 조이스틱 이동을 덮지 않는다', () => {
    key('keydown', 'KeyD'); pause(); resume();
    Object.assign(input.joy, { active: true, id: 3 }); input.screenMove.x = 0; input.screenMove.y = 1;
    input.update();
    expect(input.move).toEqual({ x: 0, y: 1 });
  });
  test('resize·orientationchange 는 keys 를 비우지만 held 는 남아 다음 갱신에서 이동이 이어진다(키는 계속 눌려 있다)', () => {
    for (const type of ['resize', 'orientationchange']) {
      key('keydown', 'KeyD'); input.update();
      if (type === 'resize') (host as any).innerWidth += 100; // 폭이 바뀐 resize만 clear 한다
      host.dispatchEvent(new Event(type));
      expect(keys().KeyD).toBeUndefined();
      input.update();
      expect(input.move.x).toBe(1); expect(keys().KeyD).toBe(true);
      key('keyup', 'KeyD'); input.update();
    }
  });
  test('Meta keyup 은 held 를 비운다(macOS 는 Cmd 를 누른 동안 다른 키의 keyup 을 보내지 않는다)', () => {
    key('keydown', 'KeyD'); input.update();
    key('keyup', 'MetaLeft', { key: 'Meta' });
    pause(); resume(); input.update();
    expect(input.move.x).toBe(0); expect(keys().KeyD).toBeUndefined();
  });
});
