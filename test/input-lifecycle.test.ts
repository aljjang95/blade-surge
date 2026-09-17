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
let host: EventTarget;
let elements: Map<string, ElementStub>;
let input: Input;

function key(type: string, code: string) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
  host.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  elements = new Map(); host = new EventTarget();
  const find = (id: string) => { if (!elements.has(id)) elements.set(id, new ElementStub()); return elements.get(id); };
  const documentStub = Object.assign(new EventTarget(), { hidden: false, getElementById: find, querySelector: find, querySelectorAll: () => [] });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  input = new Input(); input.enabled = true;
});

afterEach(() => {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
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
