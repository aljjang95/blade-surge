import { expect, test } from 'bun:test';
import { Input } from '../src/engine/input.js';

class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

test('F and owned context touches share one command queue, respect repeat/focus/disable boundaries and preserve attack input', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const host = new EventTarget(), elements = new Map<string, ElementStub>();
  const find = (id: string) => {
    if (!elements.has(id)) elements.set(id, new ElementStub());
    return elements.get(id)!;
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  Object.defineProperty(globalThis, 'document', { configurable: true, value:
    Object.assign(new EventTarget(), { hidden: false, getElementById: find, querySelector: find, querySelectorAll: () => [] }) });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
  const key = (code: string, repeat = false, editing = false) => {
    const e = new Event('keydown', { cancelable: true });
    Object.defineProperties(e, { code: { value: code }, repeat: { value: repeat } });
    if (editing) Object.defineProperty(e, 'target', { value: { closest: () => true } });
    host.dispatchEvent(e); return e;
  };
  const touch = (type: string, identifier: number) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperty(e, 'changedTouches', { value: [{ identifier }] });
    find('btn-map-interact').dispatchEvent(e);
  };
  try {
    const input = new Input(); input.enabled = true;
    expect(key('KeyF').defaultPrevented).toBe(true);
    touch('touchstart', 7);
    expect(input.queue).toEqual(['interact']);
    expect(input.consume('interact')).toBe(true); expect(input.consume('interact')).toBe(false);
    key('KeyF', true); touch('touchstart', 9);
    expect(input.consume('interact')).toBe(false);
    touch('touchend', 9); touch('touchstart', 9);
    expect(input.consume('interact')).toBe(false);
    touch('touchend', 7); touch('touchstart', 9);
    expect(input.consume('interact')).toBe(true);
    key('KeyJ'); expect(input.consume('attack')).toBe(true); expect(input.attackHeld).toBe(true);
    touch('touchcancel', 9); expect(input.attackHeld).toBe(true);
    input.clear(); input.enabled = false;
    key('KeyF'); touch('touchstart', 11); expect(input.queue).toHaveLength(0);
    input.enabled = true; key('KeyF', false, true); expect(input.queue).toHaveLength(0);
    touch('touchstart', 11); expect(input.consume('interact')).toBe(true);
    host.dispatchEvent(new Event('blur')); expect(input.queue).toHaveLength(0);
    expect(input.attackHeld).toBe(false);
    touch('touchstart', 12); expect(input.consume('interact')).toBe(true);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
