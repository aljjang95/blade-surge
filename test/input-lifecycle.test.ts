import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Input } from '../src/engine/input.js';

class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  closest() { return null; }
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
});
