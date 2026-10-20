import { expect, test } from 'bun:test';
import { bindTouchActivation } from '../src/engine/touch-activation.js';

// 전투 핵심 버튼의 실제 터치 탭 활성화(보조 터치·멀티터치 직후 주 터치 모두).
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
const nativeClick = (id: number) => ({ isTrusted: true, pointerId: id, pointerType: 'touch' });
function setup() {
  let clock = 0;
  const button = new Button();
  button.addEventListener('click', () => { button.clicks++; });
  const off = bindTouchActivation(button as any, { now: () => clock });
  return { button, off, tick: (ms: number) => { clock += ms; } };
}
const tap = (b: Button, id: number, primary = false) => { send(b, 'pointerdown', touch(id, 120, 30, primary)); send(b, 'pointerup', touch(id, 121, 31, primary)); };

test('secondary touch tap with no browser click activates once', () => {
  const { button } = setup();
  tap(button, 7); expect(button.clicks).toBe(1);
});
test('primary touch tap activates once whether or not the browser sends its click (post multi-touch resume)', () => {
  const { button, tick } = setup();
  tap(button, 21, true); expect(button.clicks).toBe(1);          // 재개 버튼: click이 오지 않는 경로
  tick(40); tap(button, 22, true);
  const duplicate = send(button, 'click', nativeClick(22));         // 보통 경로: 같은 포인터 click이 뒤따름
  expect(button.clicks).toBe(2); expect(duplicate.defaultPrevented).toBe(true);
});
test('keyboard, mouse and a different pointer click right after a touch activation still work', () => {
  const { button, tick } = setup();
  tap(button, 9); expect(button.clicks).toBe(1);
  tick(30); send(button, 'click', { isTrusted: true, pointerId: -1, pointerType: '' }); expect(button.clicks).toBe(2);
  tick(30); send(button, 'click', { isTrusted: true, pointerId: 1, pointerType: 'mouse' }); expect(button.clicks).toBe(3);
  tick(30); send(button, 'click', nativeClick(12)); expect(button.clicks).toBe(4);
  send(button, 'click', nativeClick(9)); expect(button.clicks).toBe(4);   // 원래 포인터의 늦은 click은 한 번 막는다
  send(button, 'click', nativeClick(9)); expect(button.clicks).toBe(5);   // 막은 뒤에는 다시 막지 않는다
  tap(button, 10); tick(700); send(button, 'click', nativeClick(10)); expect(button.clicks).toBe(7); // 창이 지나면 막지 않는다
});
test('a legacy engine click without pointer fields right after a touch activation is treated as its duplicate', () => {
  const { button } = setup();
  tap(button, 5, true); send(button, 'click', { isTrusted: true }); expect(button.clicks).toBe(1);
});
test('mouse pointers, moved, round-trip, outside, canceled, disabled and hidden taps add no activation', () => {
  const { button } = setup();
  send(button, 'pointerdown', { ...touch(2), pointerType: 'mouse' }); send(button, 'pointerup', { ...touch(2), pointerType: 'mouse' });
  send(button, 'pointerdown', touch(3)); send(button, 'pointerup', touch(3, 140 + 5, 30));
  send(button, 'pointerdown', touch(13)); send(button, 'pointermove', touch(13, 120, 60)); send(button, 'pointermove', touch(13, 121, 30)); send(button, 'pointerup', touch(13, 121, 30));
  send(button, 'pointerdown', touch(4, 138, 30)); send(button, 'pointerup', touch(4, 145, 30));
  send(button, 'pointerdown', touch(5)); send(button, 'pointercancel', touch(5)); send(button, 'pointerup', touch(5));
  button.disabled = true; tap(button, 6); button.disabled = false;
  button.hidden = true; tap(button, 8); button.hidden = false;
  expect(button.clicks).toBe(0);
  send(button, 'pointerdown', touch(14)); send(button, 'pointermove', touch(14, 125, 33)); send(button, 'pointerup', touch(14, 125, 33));
  expect(button.clicks).toBe(1);
});
test('release removes every listener', () => {
  const { button, off } = setup();
  off(); tap(button, 11);
  expect(button.clicks).toBe(0);
});

