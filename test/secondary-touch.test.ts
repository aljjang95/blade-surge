import { expect, test } from 'bun:test';
import { bindSecondaryTouchActivation } from '../src/engine/secondary-touch.js';

// 조이스틱·시점 손가락을 누른 채 일시정지 등을 탭하는 보조 터치 활성화.
// 대상 단계에서 capture 리스너가 먼저 돌고 stopImmediatePropagation이 뒤 리스너를 막는 브라우저 순서를 따른다.
// isTrusted는 실제 Event에서 바꿀 수 없으므로 일반 객체로 전달한다(스크립트 click()은 isTrusted=false).
type Listener = { type: string, fn: (event: any) => void, capture: boolean };
class Button {
  disabled = false; hidden = false; clicks = 0; listeners: Listener[] = [];
  addEventListener(type: string, fn: (event: any) => void, capture?: boolean) { this.listeners.push({ type, fn, capture: !!capture }); }
  removeEventListener(type: string, fn: (event: any) => void, capture?: boolean) { this.listeners = this.listeners.filter(l => !(l.type === type && l.fn === fn && l.capture === !!capture)); }
  dispatch(type: string, props: Record<string, unknown>) {
    const event: any = { type, defaultPrevented: false, stopped: false, isTrusted: false, ...props,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const l of [...this.listeners.filter(l => l.capture), ...this.listeners.filter(l => !l.capture)]) {
      if (event.stopped) break;
      if (l.type === type) l.fn(event);
    }
    return event;
  }
  getBoundingClientRect() { return { left: 100, top: 10, right: 140, bottom: 50 }; }
  click() { this.dispatch('click', {}); }
}
const send = (el: Button, type: string, props: Record<string, unknown>) => el.dispatch(type, props);
const touch = (id: number, x = 120, y = 30, primary = false) => ({ pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y });
function setup() {
  let clock = 0;
  const button = new Button();
  button.addEventListener('click', () => { button.clicks++; });
  const off = bindSecondaryTouchActivation(button as any, { now: () => clock });
  return { button, off, tick: (ms: number) => { clock += ms; } };
}

test('a secondary touch tap activates the button once through its normal click handler', () => {
  const { button } = setup();
  send(button, 'pointerdown', touch(7)); send(button, 'pointerup', touch(7, 123, 31));
  expect(button.clicks).toBe(1);
});
test('primary touch, mouse, moved, outside, canceled, disabled and hidden taps do not add an activation', () => {
  const { button } = setup();
  send(button, 'pointerdown', touch(1, 120, 30, true)); send(button, 'pointerup', touch(1, 120, 30, true));
  send(button, 'pointerdown', { ...touch(2), pointerType: 'mouse' }); send(button, 'pointerup', { ...touch(2), pointerType: 'mouse' });
  send(button, 'pointerdown', touch(3)); send(button, 'pointerup', touch(3, 120 + 20, 30));
  send(button, 'pointerdown', touch(4, 138, 30)); send(button, 'pointerup', touch(4, 145, 30));
  send(button, 'pointerdown', touch(5)); send(button, 'pointercancel', touch(5)); send(button, 'pointerup', touch(5));
  button.disabled = true; send(button, 'pointerdown', touch(6)); send(button, 'pointerup', touch(6)); button.disabled = false;
  button.hidden = true; send(button, 'pointerdown', touch(8)); send(button, 'pointerup', touch(8)); button.hidden = false;
  expect(button.clicks).toBe(0);
});
test('a browser click that follows the activated secondary tap is not handled twice, later clicks still work', () => {
  const { button, tick } = setup();
  send(button, 'pointerdown', touch(9)); send(button, 'pointerup', touch(9));
  expect(button.clicks).toBe(1);
  const duplicate = send(button, 'click', { isTrusted: true });
  expect(button.clicks).toBe(1); expect(duplicate.defaultPrevented).toBe(true);
  tick(10); send(button, 'click', { isTrusted: true }); expect(button.clicks).toBe(2);
  send(button, 'pointerdown', touch(10)); send(button, 'pointerup', touch(10)); expect(button.clicks).toBe(3);
  tick(700); send(button, 'click', { isTrusted: true }); expect(button.clicks).toBe(4);
});
test('release removes every listener', () => {
  const { button, off } = setup();
  off(); send(button, 'pointerdown', touch(11)); send(button, 'pointerup', touch(11));
  expect(button.clicks).toBe(0);
});
