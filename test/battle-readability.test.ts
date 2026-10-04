import { afterEach, expect, test } from 'bun:test';
import { BattleReadability } from '../src/ui/battle-readability.js';
import { Battle } from '../src/game/battle-base.js';
import { Input } from '../src/engine/input.js';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});
function fixture() {
  const world = { rooms: [] }, input: any = Object.assign(Object.create(Input.prototype), {
    queue: ['attack', 'interact'], attackSources: new Set(['button']), attackHeld: true, keys: { KeyW: true },
    gamepadButtons: new Uint8Array(8), gamepadMove: { x: 1, y: 1 }, move: { x: 1, y: 1 },
    screenMove: { x: 1, y: 1 }, joy: { active: true, id: 1 }, clearListeners: new Set(),
    el: { knob: { style: {} }, base: { style: {} } }, enabled: true,
  });
  const battle: any = Object.assign(Object.create(Battle.prototype), { world, active: true, paused: false,
    player: { alive: true }, pauseReasons: new Set(), input, routeObjectives: { interrupt() {} }, ui: { refreshComboFeedback() {} } });
  let canvasFocus = 0, mapFocus = 0;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const canvas = { focus() { expect(dialog.open).toBe(false); canvasFocus++; } };
  const view: any = Object.assign(Object.create(BattleReadability.prototype), { app: { battle, mode: 'battle', canvas },
    dialog, closeButton: { focus() {} }, mapButton: { focus() { mapFocus++; } }, refreshMap() {} });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  return { world, input, battle, dialog, view, canvasFocus: () => canvasFocus, mapFocus: () => mapFocus };
}
test('지도 열기와 종료는 실제 Input을 초기화하고 자기 정지만 해제한다', () => {
  const f = fixture(); f.battle.setPaused('companion', true);
  f.view.openMap();
  expect(f.dialog.open).toBe(true); expect([...f.battle.pauseReasons]).toEqual(['companion', 'tactical-map']);
  expect(f.input.queue).toEqual([]); expect(f.input.attackHeld).toBe(false); expect(f.input.joy.active).toBe(false);
  f.view.closeMap();
  expect(f.dialog.open).toBe(false); expect([...f.battle.pauseReasons]).toEqual(['companion']);
  expect(f.input.enabled).toBe(false); expect(f.canvasFocus()).toBe(0);
});
test('일반 지도 종료는 대화상자가 닫힌 뒤 게임 캔버스로 키보드 초점을 복귀한다', () => {
  const f = fixture(); f.view.openMap(); f.view.closeMap();
  expect(f.input.enabled).toBe(true); expect(f.input.keys).toEqual({});
  expect(f.canvasFocus()).toBe(1); expect(f.mapFocus()).toBe(0);
  expect(f.battle.pauseReasons.size).toBe(0);
});
test('지도 열기 실패는 기존 정지를 보존하고 자기 정지와 임시 월드만 되돌린다', () => {
  const f = fixture(); f.battle.setPaused('manual', true);
  f.dialog.showModal = () => { throw Error('dialog unavailable'); };
  expect(() => f.view.openMap()).toThrow('dialog unavailable');
  expect([...f.battle.pauseReasons]).toEqual(['manual']); expect(f.input.enabled).toBe(false);
  expect(f.view.mapBattle).toBeNull(); expect(f.view.mapWorld).toBeNull();
});
