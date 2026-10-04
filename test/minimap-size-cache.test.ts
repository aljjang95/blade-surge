import { afterEach, expect, test } from 'bun:test';
import { Minimap } from '../src/ui/minimap.js';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
});
function fixture(width = 88, height = 88, observed = true) {
  let widthReads = 0, heightReads = 0, notify: ((entries: Array<{ target: unknown; contentRect: { width: number; height: number } }>) => void) | undefined;
  const environment = { devicePixelRatio: 1, addEventListener() {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: environment });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: observed ? class {
    constructor(callback: typeof notify) { notify = callback; }
    observe() {}
  } : undefined });
  const context = new Proxy({}, { get: () => () => undefined });
  const dimensions = { width, height };
  const canvas = { ownerDocument: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
    get clientWidth() { widthReads++; return dimensions.width; },
    get clientHeight() { heightReads++; return dimensions.height; }, getContext: () => context, width: 0, height: 0 };
  const map = new Minimap(canvas);
  const room = { id: 0, x: 0, z: 0, w: 20, h: 20, type: 'start', discovered: true, cleared: true, gx: 0, gy: 0 };
  const floor = { rooms: [room], linkPending: [], sealed: false };
  const battle = { world: floor, player: { pos: { x: 0, z: 0 }, yaw: 0 }, curRoom: room, enemies: [] };
  map.setFloor(floor);
  return { map, canvas, battle, dimensions, environment, reads: () => [widthReads, heightReads],
    resize(w: number, h: number) { notify?.([{ target: canvas, contentRect: { width: w, height: h } }]); } };
}
test('반복 미니맵 그리기는 HUD 쓰기 이후 DOM 크기를 다시 읽지 않는다', () => {
  const f = fixture(), initialReads = f.reads();
  for (let frame = 0; frame < 75; frame++) f.map.draw(f.battle);
  expect(f.reads()).toEqual(initialReads);
  expect(f.canvas.width).toBe(88); expect(f.canvas.height).toBe(88);
});
test('크기 알림과 DPR 변경은 실제 캔버스 크기를 갱신하고 숨김 상태의 0 크기는 보존한다', () => {
  const f = fixture(), initialReads = f.reads();
  f.resize(72, 72); f.map.draw(f.battle); expect(f.canvas.width).toBe(72); expect(f.canvas.height).toBe(72);
  f.environment.devicePixelRatio = 2; f.map.draw(f.battle); expect(f.canvas.width).toBe(144); expect(f.canvas.height).toBe(144);
  f.resize(0, 0); f.map.draw(f.battle); expect(f.canvas.width).toBe(144);
  f.resize(420, 240); f.map.draw(f.battle); expect(f.canvas.width).toBe(840); expect(f.canvas.height).toBe(480);
  expect(f.reads()).toEqual(initialReads);
  const point = f.map.px(f.battle.player.pos.x, f.battle.player.pos.z);
  expect(point).toEqual([210, 120]);
});
test('처음 숨겨진 캔버스는 Floor 연결 시 실제 크기를 확인하고 이후 그리기에서는 캐시를 쓴다', () => {
  const f = fixture(0, 0, false); f.dimensions.width = 92; f.dimensions.height = 92;
  f.map.setFloor(f.battle.world); const initialReads = f.reads();
  f.map.draw(f.battle); f.map.draw(f.battle);
  expect(f.canvas.width).toBe(92); expect(f.canvas.height).toBe(92); expect(f.reads()).toEqual(initialReads);
});
