import { afterEach, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { HubMovement } from '../src/game/hub-movement.js';
import { HubControls } from '../src/engine/hub-controls.js';
import { Input } from '../src/engine/input.js';
import { CITADEL_HUB } from '../src/data/citadel-hub.js';

function hero() {
  const root = new THREE.Object3D();
  const clips = { Idle: new THREE.AnimationClip('Idle', 1, []), Running_A: new THREE.AnimationClip('Running_A', 1, []),
    Interact: new THREE.AnimationClip('Interact', 1, []) };
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clips.Idle).play();
  return { root, clips, mixer, t: 0, gesture: null as THREE.AnimationAction | null, gestureT: 0 };
}

describe('playable citadel movement', () => {
  test('uses selected showcase, camera-relative directions and normalized diagonal speed', () => {
    const s = hero(), hub = new HubMovement(CITADEL_HUB).attach(s);
    hub.update(.1, { x: 1, y: 1 });
    expect(Math.hypot(s.root.position.x, s.root.position.z - 3.6)).toBeCloseTo(.42, 8);
    expect(s.root.rotation.y).toBeCloseTo(Math.PI / 4, 8);
    expect(hub.moving).toBe(true);
    expect(hub.animation?.getClip().name).toBe('Running_A');
    hub.reset(); hub.update(.1, { x: 0, y: -1 }, Math.PI / 2);
    expect(s.root.position.x).toBeCloseTo(-.42, 8);
    expect(s.root.position.z).toBeCloseTo(3.6, 8);
    hub.update(.1, {});
    expect(hub.moving).toBe(false);
    expect(hub.animation?.getClip().name).toBe('Idle');
  });

  test('plaza edge includes hero radius and a stalled hero returns to idle', () => {
    const s = hero(), hub = new HubMovement(CITADEL_HUB).attach(s);
    hub.reset({ x: 11.6, y: 0, z: 0 });
    hub.update(.1, { x: 1, y: 0 }); hub.update(.1, { x: 1, y: 0 });
    expect(s.root.position.x).toBeCloseTo(11.66, 8);
    expect(hub.moving).toBe(false);
    expect(hub.animation?.getClip().name).toBe('Idle');
    hub.reset(); hub.update(8, { x: 1, y: 0 });
    expect(s.root.position.x).toBeCloseTo(.42, 8);
  });

  test('authored gate openings are reachable while their pillars and vendor table block walking', () => {
    const s = hero(), hub = new HubMovement(CITADEL_HUB).attach(s);
    const northGate = CITADEL_HUB.hotspots[0];
    hub.reset({ x: northGate.x, y: 0, z: -8 });
    for (let frame = 0; frame < 6; frame++) hub.update(.1, { x: 0, y: -1 });
    expect(s.root.position.z).toBeCloseTo(-10.52, 8);
    expect(hub.nearest?.id).toBe(northGate.id);
    hub.reset({ x: northGate.x - 1.27, y: 0, z: -8 });
    for (let frame = 0; frame < 10; frame++) hub.update(.1, { x: 0, y: -1 });
    expect(s.root.position.z).toBeGreaterThanOrEqual(-10.7 + .29 + .34);
    hub.reset({ x: -6.4, y: 0, z: 8.8 });
    for (let frame = 0; frame < 10; frame++) hub.update(.1, { x: 0, y: -1 });
    expect(s.root.position.z).toBeGreaterThanOrEqual(7.9 + .34);
  });

  test('proximity only selects the closest destination and hero swaps keep the location', () => {
    const s = hero(), hub = new HubMovement(CITADEL_HUB).attach(s);
    expect(hub.nearest).toBeNull();
    hub.reset({ x: -6.4, y: 0, z: 3.6 });
    expect(hub.nearest?.id).toBe('npc:potion-merchant');
    hub.update(.1, { x: 1, y: 0 });
    const swapped = hero(); hub.attach(swapped);
    expect(swapped.root.position.toArray()).toEqual(s.root.position.toArray());
    hub.detach(); hub.update(.1, { x: 1, y: 0 });
    expect(hub.nearest).toBeNull(); expect(hub.moving).toBe(false);
  });

  test('starting to walk cancels a showcase gesture without running the mixer twice', () => {
    const s = hero(), hub = new HubMovement(CITADEL_HUB).attach(s);
    s.gesture = s.mixer.clipAction(s.clips.Interact).play();
    hub.update(.1, { x: 1, y: 0 });
    expect(s.gesture).toBeNull();
    expect(s.mixer.time).toBe(0);
    expect(hub.animation?.getClip().name).toBe('Running_A');
  });
});

class Surface extends EventTarget {
  style: Record<string, string> & { transform: string } = { transform: '' };
  captures = new Set<number>();
  closest() { return null; }
  getBoundingClientRect() { return { left: 20, top: 200, width: 120, height: 120 }; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
}

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function controlsFixture() {
  const host = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: false });
  const joystick = new Surface(), knob = new Surface();
  let active = true;
  const controls = new HubControls({ isActive: () => active, joystick, knob, host, document });
  cleanups.push(() => controls.destroy());
  return { controls, host, document, joystick, knob, setActive: (value: boolean) => { active = value; } };
}

function key(host: EventTarget, type: string, code: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  const descriptors: PropertyDescriptorMap = { code: { value: code }, repeat: { value: false } };
  for (const [name, value] of Object.entries(properties)) descriptors[name] = { value };
  Object.defineProperties(event, descriptors); host.dispatchEvent(event); return event;
}

function pointer(surface: EventTarget, type: string, id: number, x: number, y: number) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { pointerId: { value: id }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
  surface.dispatchEvent(event);
}

describe('citadel input boundary', () => {
  test('keyboard interaction fires once per press and ignores focused UI, shortcuts and repeats', () => {
    const { controls, host } = controlsFixture();
    key(host, 'keydown', 'KeyW'); key(host, 'keydown', 'KeyD');
    expect(Math.hypot(controls.update().x, controls.move.y)).toBeCloseTo(1, 8);
    key(host, 'keydown', 'KeyE'); expect(controls.consumeInteract()).toBe(true);
    key(host, 'keydown', 'KeyE', { repeat: true }); expect(controls.consumeInteract()).toBe(false);
    key(host, 'keyup', 'KeyE'); key(host, 'keydown', 'Space'); expect(controls.consumeInteract()).toBe(true);
    controls.clear();
    for (const properties of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { target: { closest: () => ({}) } }]) {
      key(host, 'keydown', 'KeyW', properties); expect(controls.update()).toEqual({ x: 0, y: 0 });
    }
  });

  test('restored nearby-button focus resumes walking and E while Space stays native', () => {
    const { controls, host, document } = controlsFixture();
    const nearbyButton = {};
    const target = { closest: (selector: string) => selector === '.citadel-hub-interact' || selector.startsWith('button,') ? nearbyButton : null };
    key(host, 'keydown', 'KeyD'); key(host, 'keydown', 'KeyE');
    const restoredFocus = new Event('focusin');
    Object.defineProperty(restoredFocus, 'target', { value: target }); document.dispatchEvent(restoredFocus);
    expect(controls.update()).toEqual({ x: 0, y: 0 }); expect(controls.consumeInteract()).toBe(false);
    expect(key(host, 'keydown', 'KeyW', { target }).defaultPrevented).toBe(true);
    expect(key(host, 'keydown', 'ArrowRight', { target }).defaultPrevented).toBe(true);
    expect(controls.update().x).toBeGreaterThan(0); expect(controls.move.y).toBeLessThan(0);
    expect(key(host, 'keydown', 'KeyE', { target }).defaultPrevented).toBe(true);
    expect(controls.consumeInteract()).toBe(true);
    expect(key(host, 'keydown', 'Space', { target }).defaultPrevented).toBe(false);
    expect(controls.consumeInteract()).toBe(false);
    controls.clear();
    const otherButton = {}, dialog = {};
    for (const blockedTarget of [
      { closest: (selector: string) => selector.startsWith('button,') ? otherButton : null },
      { closest: (selector: string) => selector === 'dialog, [role="dialog"]' ? dialog : target.closest(selector) },
    ]) {
      key(host, 'keydown', 'KeyW', { target: blockedTarget }); key(host, 'keydown', 'KeyE', { target: blockedTarget });
      expect(controls.update()).toEqual({ x: 0, y: 0 }); expect(controls.consumeInteract()).toBe(false);
    }
  });

  test('touch owns one pointer and cancel, blur, hidden document or inactive hub releases it', () => {
    const { controls, host, document, joystick, knob, setActive } = controlsFixture();
    pointer(joystick, 'pointerdown', 7, 80, 260); pointer(joystick, 'pointermove', 7, 130, 260);
    expect(controls.update()).toEqual({ x: 1, y: 0 });
    pointer(joystick, 'pointerup', 9, 80, 260); expect(controls.pointer?.id).toBe(7);
    pointer(joystick, 'pointercancel', 7, 80, 260); expect(controls.update()).toEqual({ x: 0, y: 0 });
    for (const boundary of ['blur', 'hidden', 'inactive']) {
      pointer(joystick, 'pointerdown', 7, 130, 260); key(host, 'keydown', 'KeyW'); key(host, 'keydown', 'KeyE');
      if (boundary === 'blur') host.dispatchEvent(new Event('blur'));
      else if (boundary === 'hidden') { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
      else { setActive(false); controls.update(); }
      document.hidden = false; setActive(true);
      expect(controls.update()).toEqual({ x: 0, y: 0 }); expect(controls.consumeInteract()).toBe(false);
      expect(joystick.captures.size).toBe(0); expect(knob.style.transform).toBe('translate(-50%, -50%)');
    }
  });

  test('holding lobby movement or interaction through battle entry leaves combat input empty', () => {
    const fixture = controlsFixture(), { controls, host, setActive } = fixture;
    const elements = new Map<string, Surface>();
    const find = (id: string) => { if (!elements.has(id)) elements.set(id, new Surface()); return elements.get(id)!; };
    const documentStub = Object.assign(fixture.document, { getElementById: find, querySelector: find, querySelectorAll: () => [] });
    for (const [name, value] of [['window', host], ['document', documentStub], ['navigator', {}]] as const) {
      const old = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, { configurable: true, value });
      cleanups.push(() => { if (old) Object.defineProperty(globalThis, name, old); else Reflect.deleteProperty(globalThis, name); });
    }
    const battleInput = new Input();
    key(host, 'keydown', 'KeyW'); key(host, 'keydown', 'KeyE'); key(host, 'keydown', 'Space');
    expect(controls.update().y).toBe(-1); expect(controls.consumeInteract()).toBe(true);
    setActive(false); controls.clear(); battleInput.clear(); battleInput.enabled = true;
    key(host, 'keydown', 'KeyW', { repeat: true }); key(host, 'keydown', 'KeyE', { repeat: true }); key(host, 'keydown', 'Space', { repeat: true });
    battleInput.update();
    expect(battleInput.move).toEqual({ x: 0, y: 0 }); expect(battleInput.queue).toEqual([]); expect(battleInput.attackHeld).toBe(false);
    key(host, 'keyup', 'KeyW'); key(host, 'keydown', 'KeyW'); battleInput.update();
    expect(battleInput.move.y).toBe(-1);
  });
});
