import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Input } from '../src/engine/input.js';

class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  closest() { return null; }
  getBoundingClientRect() { return {left:10,top:300}; }
}

const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let host: EventTarget;
let elements: Map<string, ElementStub>;
let input: Input;
let gamepad: any = null;
let gamepads: any[] | null = null;

function key(type: string, code: string) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
  host.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  elements = new Map(); host = new EventTarget(); gamepad = null; gamepads = null;
  const find = (id: string) => { if (!elements.has(id)) elements.set(id, new ElementStub()); return elements.get(id); };
  const documentStub = Object.assign(new EventTarget(), { hidden: false, getElementById: find, querySelector: find, querySelectorAll: () => [] });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => gamepads ?? (gamepad ? [gamepad] : []) } });
  input = new Input(); input.enabled = true;
});

afterEach(() => {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
});

describe('사람 입력 수명주기', () => {
  test('카메라 우클릭 해제는 왼쪽 버튼 공격을 끊지 않는다', () => {
    const down = new Event('mousedown',{cancelable:true});
    Object.defineProperty(down,'button',{value:0}); elements.get('btn-attack')!.dispatchEvent(down);
    const rightUp = new Event('mouseup'); Object.defineProperty(rightUp,'button',{value:2}); host.dispatchEvent(rightUp);
    expect(input.attackHeld).toBe(true);
    const leftUp = new Event('mouseup'); Object.defineProperty(leftUp,'button',{value:0}); host.dispatchEvent(leftUp);
    expect(input.attackHeld).toBe(false);
  });
  test('터치 이동은 별도 마우스 이동과 해제에 소유권을 빼앗기지 않는다', () => {
    const start = new Event('touchstart', {cancelable:true});
    Object.defineProperty(start, 'changedTouches', {value:[{identifier:7,clientX:80,clientY:550}]});
    elements.get('joy')!.dispatchEvent(start);
    const move = new Event('mousemove', {cancelable:true});
    Object.defineProperties(move, {clientX:{value:300},clientY:{value:300}});
    host.dispatchEvent(move); host.dispatchEvent(new Event('mouseup'));
    expect(input.joy.active).toBe(true);
    expect(input.screenMove).toEqual({x:0,y:0});
  });
  test('공격 키 두 개 중 하나를 놓아도 나머지 홀드는 유지한다', () => {
    key('keydown','KeyJ'); key('keydown','Space'); key('keyup','KeyJ');
    expect(input.attackHeld).toBe(true);
    key('keyup','Space'); expect(input.attackHeld).toBe(false);
  });
  test('공격 터치의 소유자가 아닌 손가락과 마우스는 홀드를 해제하지 않는다', () => {
    const touch = (type:string, id:number) => {
      const event = new Event(type, {cancelable:true});
      Object.defineProperty(event,'changedTouches',{value:[{identifier:id}]});
      elements.get('btn-attack')!.dispatchEvent(event);
    };
    touch('touchstart',9); touch('touchend',8); host.dispatchEvent(new Event('mouseup'));
    expect(input.attackHeld).toBe(true);
    key('keydown','KeyJ'); touch('touchend',9); expect(input.attackHeld).toBe(true);
    key('keyup','KeyJ'); expect(input.attackHeld).toBe(false);
  });
  for (const cancelable of [false, true]) test(`공격 터치 해제 cancelable=${cancelable}는 키 홀드를 보존하고 허용된 기본 동작만 취소한다`, () => {
    const button = elements.get('btn-attack')!;
    const start = new Event('touchstart', { cancelable: true });
    Object.defineProperty(start, 'changedTouches', { value: [{ identifier: 9 }] });
    button.dispatchEvent(start); key('keydown', 'KeyJ');
    const end = new Event(cancelable ? 'touchend' : 'touchcancel', { cancelable });
    Object.defineProperty(end, 'changedTouches', { value: [{ identifier: 9 }] });
    let prevented = 0;
    end.preventDefault = () => { prevented++; Event.prototype.preventDefault.call(end); };
    button.dispatchEvent(end);
    expect(prevented).toBe(cancelable ? 1 : 0);
    expect(end.defaultPrevented).toBe(cancelable);
    expect(input.attackSources.has('button')).toBe(false);
    expect(input.attackHeld).toBe(true);
    key('keyup', 'KeyJ'); expect(input.attackHeld).toBe(false);
    // 취소 뒤 새 손가락도 같은 버튼을 다시 누를 수 있다.
    button.dispatchEvent(start); expect(input.attackHeld).toBe(true);
  });
  test('카메라 패드로 포커스 이동 시 키 이동만 멈추고 터치는 유지한다', () => {
    key('keydown','KeyW'); key('keydown','KeyJ');
    Object.assign(input.joy, {active:true,id:7}); input.screenMove.x = 1;
    const focus = new Event('focusin');
    Object.defineProperty(focus,'target',{value:{closest:()=>({})}});
    document.dispatchEvent(focus);
    expect(input.keys).toEqual({}); expect(input.attackHeld).toBe(false);
    expect(input.joy.active).toBe(true); expect(input.screenMove.x).toBe(1);
  });
  test('브라우저 단축키와 이미 처리한 카메라 키는 게임에 전달하지 않는다', () => {
    for (const property of ['ctrlKey','metaKey','altKey','defaultPrevented']) {
      const event = new Event('keydown',{cancelable:true});
      Object.defineProperties(event,{code:{value:'KeyW'},[property]:{value:true}});
      host.dispatchEvent(event); input.update(); expect(input.move.y).toBe(0);
    }
  });
  test('터치 조이스틱 중심은 화면 좌표를 부모 영역 좌표로 변환한다', () => {
    const touch = (type:string, identifier:number, clientX:number, clientY:number) => {
      const e = new Event(type, {cancelable:true});
      Object.defineProperty(e, 'changedTouches', {value:[{identifier,clientX,clientY}]});
      elements.get('joy')!.dispatchEvent(e);
    };
    touch('touchstart',7,80,550);
    expect(elements.get('.joy-base')!.style.left).toBe('70px');
    expect(elements.get('.joy-base')!.style.top).toBe('250px');
    touch('touchmove',7,132,550); input.update();
    expect(input.move.x).toBe(1);
    touch('touchend',8,132,550); expect(input.joy.active).toBe(true);
    touch('touchcancel',7,132,550); input.update();
    expect(input.joy.active).toBe(false); expect(input.move.x).toBe(0);
  });
  test('키를 누른 뒤 포커스를 잃으면 이동/홀드/예약이 모두 해제된다', () => {
    key('keydown', 'KeyW'); key('keydown', 'KeyJ'); input.update();
    expect(input.move.y).toBe(-1);
    expect(input.attackHeld).toBe(true);
    host.dispatchEvent(new Event('blur')); input.update();
    expect(input.move.y).toBe(0);
    expect(input.attackHeld).toBe(false);
    expect(input.queue).toEqual([]);
  });
  test('비활성 동안의 키와 터치 공격은 복귀 뒤 실행되지 않는다', () => {
    input.enabled = false;
    key('keydown', 'KeyW'); key('keydown', 'KeyJ');
    elements.get('btn-attack')!.dispatchEvent(new Event('mousedown', { cancelable: true }));
    input.enabled = true; input.update();
    expect(input.move.y).toBe(0);
    expect(input.attackHeld).toBe(false);
    expect(input.queue).toEqual([]);
  });
  test('같은 스킬을 연타해도 미래 쿨타임까지 예약되지 않는다', () => {
    for (let i = 0; i < 1000; i++) input.press('skill0');
    expect(input.queue).toEqual(['skill0']);
    expect(input.consume('skill0')).toBe(true);
    expect(input.consume('skill0')).toBe(false);
  });
  test('공격 Space는 브라우저 버튼 활성화에 중복 전달하지 않는다', () => {
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(input.queue).toEqual(['attack']);
  });
  test('양쪽 Shift는 같은 회피를 한 번 예약하고 비활성·메뉴 포커스는 유지한다', () => {
    for (const code of ['ShiftLeft', 'ShiftRight']) {
      expect(key('keydown', code).defaultPrevented).toBe(true);
      expect(input.consume('dodge')).toBe(true);
      expect(input.consume('dodge')).toBe(false);
      key('keyup', code);
      input.enabled = false; key('keydown', code); input.enabled = true;
      expect(input.queue).toEqual([]);
      const menuKey = new Event('keydown', { cancelable: true });
      Object.defineProperties(menuKey, { code: { value: code }, target: { value: { closest: () => ({}) } } });
      host.dispatchEvent(menuKey);
      expect(input.queue).toEqual([]);
      expect(menuKey.defaultPrevented).toBe(false);
    }
  });
  test('게임패드 앞 슬롯이 비었거나 끊겨도 뒤의 연결된 패드로 이동·회피한다', () => {
    const pad = { connected: true, axes: [.8, 0], buttons: [{ pressed: false }, { pressed: true }] };
    for (const first of [null, undefined, { connected: false }]) {
      input.clear(); gamepads = [first, pad]; input.update();
      expect(input.gamepadConnected).toBe(true);
      expect(input.move.x).toBeGreaterThan(.7);
      expect(input.consume('dodge')).toBe(true);
      input.update(); expect(input.consume('dodge')).toBe(false);
    }
  });
  test('패드 연결 해제는 패드 홀드만 정리하고 키보드 이동과 공격을 보존한다', () => {
    gamepads = [null, { connected: true, axes: [.8, 0], buttons: [{ pressed: true }] }];
    input.update(); input.consume('attack');
    expect(input.attackSources.has('gamepad')).toBe(true);
    key('keydown', 'KeyW'); key('keydown', 'KeyJ');
    gamepads = [null, null]; input.update();
    expect(input.gamepadConnected).toBe(false);
    expect(input.attackSources.has('gamepad')).toBe(false);
    expect(input.attackHeld).toBe(true);
    expect(input.move).toEqual({ x: 0, y: -1 });
    key('keyup', 'KeyJ'); key('keyup', 'KeyW'); input.update();
    expect(input.attackHeld).toBe(false);
    expect(input.move).toEqual({ x: 0, y: 0 });
  });
  test('표준 게임패드는 키보드·터치와 같은 명령 큐와 공격 홀드 경로를 사용한다', () => {
    gamepad = { connected: true, axes: [.8, 0], buttons: [{ pressed: true, value: 1 }] };
    input.update();
    expect(input.move.x).toBeGreaterThan(.7);
    expect(input.queue).toEqual(['attack']);
    expect(input.attackHeld).toBe(true);
    input.update();
    expect(input.queue).toEqual(['attack']);
    gamepad.buttons[0] = { pressed: false, value: 0 };
    input.update();
    expect(input.attackHeld).toBe(false);
  });
  test('회전과 페이지 이탈은 터치 조이스틱과 공격을 남기지 않는다', () => {
    for (const type of ['resize','orientationchange','pagehide']) {
      input.joy.active = true; input.screenMove.x = 1; input.screenMove.y = .5;
      input.attackHeld = true; input.press('skill0');
      host.dispatchEvent(new Event(type)); input.update();
      expect(input.joy.active).toBe(false);
      expect(input.screenMove).toEqual({x:0,y:0});
      expect(input.move).toEqual({x:0,y:0});
      expect(input.attackHeld).toBe(false); expect(input.queue).toEqual([]);
    }
  });
});
