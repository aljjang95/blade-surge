import { afterEach, beforeEach, expect, test } from 'bun:test';
import { LobbyCameraControls, normalizeLobbyCamera, walkingLobbyCameraPosition } from '../src/engine/lobby-camera.js';
import { HubControls } from '../src/engine/hub-controls.js';

class Surface extends EventTarget {
  id = ''; name = ''; value: any = ''; hidden = false; ui = false; captureFails = false;
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); captures = new Set<number>();
  children = new Set<unknown>(); onclick?: () => void;
  style = { transform: '' }; focusOptions?: { preventScroll?: boolean };
  contains(target: unknown) { return target === this || this.children.has(target); }
  closest(selector?: string) { return this.ui && selector !== '.citadel-hub-interact' && selector !== 'dialog, [role="dialog"]' ? this : null; }
  focus(options?: { preventScroll?: boolean }) { this.focusOptions = options; doc.activeElement = this; send(doc, 'focusin', { target: this }); }
  setPointerCapture(id: number) { if (this.captureFails) throw Error('rejected'); this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getBoundingClientRect() { return { left: 20, top: 170, width: 90, height: 90 }; }
}
const originals = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let doc: any, host: EventTarget, app: any, controls: LobbyCameraControls, pad: Surface, world: Surface;
let panel: any, toggle: Surface, buttons: Record<string, Surface>, clear: () => void, saveCount: number;
function send(surface: EventTarget, type: string, props: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
  surface.dispatchEvent(event);
  if (type === 'click') (surface as Surface).onclick?.();
  return event;
}
const pointer = (id = 1, target = world, touch = false) => ({ pointerId: id, pointerType: touch ? 'touch' : 'mouse',
  target, button: 0, clientX: 100, clientY: 100 });
beforeEach(() => {
  pad = new Surface(); world = new Surface(); toggle = new Surface(); host = new EventTarget(); saveCount = 0;
  world.id = 'gl'; pad.ui = toggle.ui = true;
  buttons = Object.fromEntries(['lobby-camera-reset', 'lobby-camera-zoom-in', 'lobby-camera-zoom-out'].map(id => [id, Object.assign(new Surface(), { ui: true })]));
  const presets = ['oath', 'front', 'city', 'side', 'back'].map(lobbyView => Object.assign(new Surface(), { dataset: { lobbyView }, ui: true }));
  const inputs = ['yaw', 'pitch', 'zoom'].map(name => Object.assign(new Surface(), { name, ui: true }));
  panel = Object.assign(new Surface(), { hidden: true, querySelectorAll: (selector: string) => selector === 'input' ? inputs : presets });
  const elements: Record<string, Surface> = { ...buttons, 'lobby-camera-pad': pad, 'lobby-camera-panel': panel, 'lobby-camera-toggle': toggle };
  doc = Object.assign(new EventTarget(), { hidden: false, getElementById: (id: string) => elements[id] || null, querySelector: () => null });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  app = { mode: 'lobby', meta: { tab: 'home' }, canvas: world, lobbyVisible: true, blocked: false,
    renderer: { lobbyNavigation: true }, eco: { s: { settings: { lobbyCamera: normalizeLobbyCamera(null) } }, save: () => { saveCount++; } },
    input: { onClear: (fn: () => void) => { clear = fn; } } };
  app.canWalkHub = () => app.mode === 'lobby' && app.meta.tab === 'home' && !app.blocked && app.lobbyVisible;
  controls = new LobbyCameraControls(app); controls.updateActivity();
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

test('walking renderer profile preserves the default frame, reacts to saved orbit and zoom, and reuses offsets', () => {
  const base = walkingLobbyCameraPosition(false), portrait = walkingLobbyCameraPosition(true);
  expect(base.x).toBe(0); expect(base.y).toBeCloseTo(1.1 + 15 * Math.sin(35 * Math.PI / 180));
  expect(portrait.y).toBeCloseTo(1.1 + 16.5 * Math.sin(48 * Math.PI / 180));
  const changed = walkingLobbyCameraPosition(false, { yaw: 109, pitch: 11, zoom: 120 });
  expect(changed.x).toBeGreaterThan(8); expect(changed.z).toBeCloseTo(0);
  expect(Math.hypot(changed.x, changed.y - 1.1, changed.z)).toBeCloseTo(12.5);
  expect(walkingLobbyCameraPosition(false, { yaw: 109, pitch: 11, zoom: 120 })).toBe(changed);
  expect(walkingLobbyCameraPosition(false, null)).toBe(base);
});
test('empty-world mouse drag changes the rendered walking view and saves only after release', () => {
  const base = { ...walkingLobbyCameraPosition(false, app.renderer.lobbyCamera) };
  expect(send(doc, 'pointerdown', pointer()).defaultPrevented).toBe(true);
  send(doc, 'pointermove', { ...pointer(), clientX: 200, clientY: 120 });
  expect(controls.value).toEqual({ yaw: -26, pitch: 14, zoom: 100 });
  expect(walkingLobbyCameraPosition(false, app.renderer.lobbyCamera).x).not.toBe(base.x);
  expect(saveCount).toBe(0);
  send(doc, 'pointerup', pointer()); expect(saveCount).toBe(1); expect(world.captures.size).toBe(0);
  send(doc, 'pointermove', { ...pointer(), clientX: 400 }); expect(controls.value.yaw).toBe(-26);
});
test('joystick touch and a foreign UI touch never enter the camera gesture', () => {
  const joystick = new Surface(), hub = new HubControls({ isActive: app.canWalkHub, joystick, host, document: doc });
  const stick = { ...pointer(8, joystick, true), clientX: 96, clientY: 215 };
  send(joystick, 'pointerdown', stick); send(doc, 'pointerdown', stick);
  expect(hub.pointer?.id).toBe(8); expect(controls.drag).toBeUndefined();
  send(doc, 'pointerdown', pointer(9, pad, true));
  send(doc, 'pointermove', { ...pointer(9, pad, true), clientX: 180 });
  expect(controls.value.yaw).toBe(-17); expect(hub.pointer?.id).toBe(8); expect(hub.update().x).toBeGreaterThan(0);
  send(doc, 'pointerup', stick); expect(pad.hasPointerCapture(9)).toBe(true);
  const interact = new Surface(); interact.ui = true;
  send(doc, 'pointerdown', pointer(10, interact, true)); expect(controls.second).toBeUndefined();
  send(doc, 'pointerup', pointer(9, pad, true));
  expect(hub.pointer?.id).toBe(8); expect(hub.update().x).toBeGreaterThan(0); hub.destroy();
});
test('two camera-pad touches pinch and the remaining touch continues without an orbit jump', () => {
  send(doc, 'pointerdown', pointer(2, pad, true));
  send(doc, 'pointerdown', { ...pointer(3, pad, true), clientX: 140 });
  send(doc, 'pointermove', { ...pointer(3, pad, true), clientX: 180 });
  expect(controls.value.zoom).toBe(135); expect(controls.value.yaw).toBe(19);
  send(doc, 'pointerup', pointer(2, pad, true));
  expect(pad.hasPointerCapture(2)).toBe(false); expect(pad.hasPointerCapture(3)).toBe(true);
  send(doc, 'pointermove', { ...pointer(3, pad, true), clientX: 180 }); expect(controls.value.yaw).toBe(19);
  send(doc, 'pointermove', { ...pointer(3, pad, true), clientX: 200 }); expect(controls.value.yaw).toBe(10);
  send(doc, 'pointerup', pointer(3, pad, true)); expect(pad.captures.size).toBe(0); expect(saveCount).toBe(1);
});
test('capture clear and modal, stage or battle boundaries preserve the chosen view without stale drag', () => {
  send(doc, 'pointerdown', pointer()); send(doc, 'pointermove', { ...pointer(), clientX: 160 });
  const selected = controls.value; clear(); expect(world.captures.size).toBe(0);
  send(doc, 'pointermove', { ...pointer(), clientX: 300 }); expect(controls.value).toEqual(selected);
  for (const blocked of [true, false]) {
    app.blocked = blocked; controls.updateActivity();
    if (!blocked) send(doc, 'pointerdown', pointer(4));
    else expect(send(doc, 'pointerdown', pointer(4)).defaultPrevented).toBe(false);
  }
  app.mode = 'battle'; controls.updateActivity(); expect(world.captures.size).toBe(0); expect(panel.hidden).toBe(true);
  app.mode = 'lobby'; controls.updateActivity(); expect(controls.value).toEqual(selected);
  expect(send(doc, 'pointermove', { ...pointer(4), clientX: 450 }).defaultPrevented).toBe(false);
});
test('visibility, resize, pagehide and canceled pinch release every owned pointer', () => {
  for (const type of ['blur', 'resize', 'orientationchange', 'pagehide']) {
    send(doc, 'pointerdown', pointer(2, pad, true)); send(doc, 'pointerdown', { ...pointer(3, pad, true), clientX: 140 });
    send(host, type); expect(pad.captures.size).toBe(0);
  }
  send(doc, 'pointerdown', pointer(2, pad, true)); doc.hidden = true; send(doc, 'visibilitychange'); expect(pad.captures.size).toBe(0);
  doc.hidden = false; send(doc, 'pointerdown', pointer(2, pad, true)); send(doc, 'pointerdown', pointer(3, pad, true));
  send(doc, 'pointercancel', pointer(3, pad, true)); expect(pad.captures.size).toBe(0);
});
test('UI clicks, plain world touch, invalid wheel and failed capture leave the view unchanged', () => {
  const selected = controls.value;
  send(doc, 'pointerdown', pointer(1, world, true));
  world.ui = true; send(doc, 'pointerdown', pointer()); send(doc, 'wheel', { target: world, deltaY: -1 }); world.ui = false;
  world.captureFails = true; send(doc, 'pointerdown', pointer()); world.captureFails = false;
  for (const props of [{ ctrlKey: true }, { metaKey: true }, { deltaY: 0 }, { deltaY: NaN }]) send(doc, 'wheel', { target: world, deltaY: -1, ...props });
  expect(controls.value).toEqual(selected); expect(world.captures.size).toBe(0); expect(saveCount).toBe(0);
});
test('wheel, visible zoom controls and reset remain independent of battle framing', () => {
  app.renderer.battleCamera = { yaw: 35, zoom: 90 };
  expect(send(doc, 'wheel', { target: world, deltaY: -1 }).defaultPrevented).toBe(true); expect(controls.value.zoom).toBe(105);
  send(buttons['lobby-camera-zoom-in'], 'click'); expect(controls.value.zoom).toBe(115);
  send(buttons['lobby-camera-zoom-out'], 'click'); expect(controls.value.zoom).toBe(105);
  send(doc, 'pointerdown', pointer()); send(buttons['lobby-camera-reset'], 'click');
  expect(world.captures.size).toBe(0); expect(controls.value).toEqual({ yaw: 19, pitch: 11, zoom: 100 });
  expect(app.renderer.battleCamera).toEqual({ yaw: 35, zoom: 90 });
  expect(send(pad, 'keydown', { key: 'ArrowLeft', ctrlKey: true }).defaultPrevented).toBe(false);
  expect(send(pad, 'keydown', { key: 'ArrowLeft' }).defaultPrevented).toBe(true); expect(controls.value.yaw).toBe(11);
  send(pad, 'keydown', { key: 'Home' }); expect(controls.value.yaw).toBe(19);
});
test('focused camera action buttons and closing the panel return ownership so native hub W resumes', () => {
  const hub = new HubControls({ isActive: app.canWalkHub, host, document: doc });
  const actions: Surface[] = [...panel.querySelectorAll('[data-lobby-view]'), ...Object.values(buttons)];
  for (const button of actions) {
    button.focus();
    expect(send(host, 'keydown', { code: 'KeyW', target: doc.activeElement }).defaultPrevented).toBe(false);
    expect(hub.update()).toEqual({ x: 0, y: 0 });
    send(button, 'click');
    expect(doc.activeElement).toBe(world); expect(world.focusOptions).toEqual({ preventScroll: true });
    expect(send(host, 'keydown', { code: 'KeyW', target: doc.activeElement }).defaultPrevented).toBe(true);
    expect(hub.update()).toEqual({ x: 0, y: -1 }); send(host, 'keyup', { code: 'KeyW' });
  }
  panel.hidden = false; toggle.focus(); send(toggle, 'click');
  expect(panel.hidden).toBe(true); expect(doc.activeElement).toBe(world);
  expect(send(host, 'keydown', { code: 'KeyW', target: doc.activeElement }).defaultPrevented).toBe(true);
  expect(hub.update()).toEqual({ x: 0, y: -1 }); hub.destroy();
});
test('panel opening, slider and pad keyboard focus stay native and actions never steal other or inactive focus', () => {
  const hub = new HubControls({ isActive: app.canWalkHub, host, document: doc });
  const blockedW = () => {
    expect(send(host, 'keydown', { code: 'KeyW', target: doc.activeElement }).defaultPrevented).toBe(false);
    expect(hub.update()).toEqual({ x: 0, y: 0 });
  };
  toggle.focus(); send(toggle, 'click'); expect(panel.hidden).toBe(false); expect(doc.activeElement).toBe(toggle); blockedW();
  const slider: Surface = panel.querySelectorAll('input')[0];
  slider.focus(); slider.value = 75; send(slider, 'input'); expect(controls.value.yaw).toBe(75);
  expect(doc.activeElement).toBe(slider); blockedW();
  pad.focus(); send(pad, 'keydown', { key: 'Home' }); expect(controls.value.yaw).toBe(19);
  expect(doc.activeElement).toBe(pad); blockedW();
  const unrelated = Object.assign(new Surface(), { ui: true }); unrelated.focus();
  send(buttons['lobby-camera-reset'], 'click'); expect(doc.activeElement).toBe(unrelated); blockedW();
  for (const state of [{ blocked: true }, { mode: 'battle' }, { lobbyVisible: false }, { renderer: { lobbyNavigation: false } }]) {
    Object.assign(app, { blocked: false, mode: 'lobby', lobbyVisible: true, renderer: { lobbyNavigation: true } }, state);
    buttons['lobby-camera-reset'].focus(); send(buttons['lobby-camera-reset'], 'click');
    expect(doc.activeElement).toBe(buttons['lobby-camera-reset']);
    panel.hidden = false; toggle.focus(); send(toggle, 'click'); expect(doc.activeElement).toBe(toggle);
  }
  hub.destroy();
});
