import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Input } from '../src/engine/input.js';
import { Battle } from '../src/game/battle-base.js';
import { BattleTutorial } from '../src/ui/tutorial.js';

// DOM 경계만 대역으로 두고 실제 Input·Battle 정지 소유권·안내 코드를 검사한다.
// 자연 브라우저 입력·레이아웃·실기기 검증을 대신하지 않는다.
class ElementStub extends EventTarget {
  id = ''; tagName: string; textContent = ''; type = ''; hidden = false; disabled = false;
  style: Record<string, string> = {}; dataset: Record<string, string> = {};
  attributes = new Map<string, string>(); children: ElementStub[] = []; parent: ElementStub | null = null;
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, on: boolean) => { if (on) this.classes.add(name); else this.classes.delete(name); return on; },
  };
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); }
  set className(value: string) { this.classes = new Set(value.split(' ').filter(Boolean)); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  append(...children: ElementStub[]) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(child: ElementStub) { child.parent = this; this.children.unshift(child); }
  contains(child: ElementStub): boolean { return child === this || this.children.some(node => node.contains(child)); }
  querySelector(selector: string): ElementStub | null {
    if (selector === '.tutorial-card') return this.children.find(child => child.classes.has('tutorial-card')) || null;
    return null;
  }
  closest(selector: string) { return this.tagName === 'BUTTON' && selector.includes('button') ? this : null; }
  focus() {
    (document as any).activeElement = this;
    const event = new Event('focusin'); Object.defineProperty(event, 'target', { value: this }); document.dispatchEvent(event);
  }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

const originals = ['document', 'window', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let host: EventTarget, elements: Map<string, ElementStub>, all: ElementStub[];
let app: any, input: Input, battle: any, tutorial: BattleTutorial, saves: number, events: any[];
const stage = { code: '1-1', difficultyId: 'story' };

function key(type: string, code: string) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false }, target: { value: (document as any).activeElement } });
  host.dispatchEvent(event); return event;
}

beforeEach(() => {
  all = []; elements = new Map(); host = new EventTarget(); saves = 0; events = [];
  const element = (id: string, tag = 'div') => {
    const node = new ElementStub(tag); node.id = id; elements.set(id, node); all.push(node); return node;
  };
  const root = element('battle-tutorial'); root.hidden = true;
  const card = element('tutorial-panel'); card.classList.add('tutorial-card'); root.append(card);
  for (const id of ['tutorial-title', 'tutorial-copy', 'tutorial-step']) card.append(element(id));
  for (const id of ['tutorial-next', 'tutorial-skip']) card.append(element(id, 'button'));
  for (const id of ['btn-attack', 'btn-dodge', 'btn-auto']) element(id, 'button');
  element('hud'); element('gl', 'canvas'); element('joy'); element('joy-knob'); element('joy-base');
  const doc = Object.assign(new EventTarget(), {
    hidden: false, activeElement: elements.get('gl'),
    createElement: (tag: string) => { const node = new ElementStub(tag); all.push(node); return node; },
    getElementById: (id: string) => elements.get(id) || null,
    querySelector: (selector: string) => selector === '.joy-base' ? elements.get('joy-base') : selector.startsWith('#') ? elements.get(selector.slice(1)) || null : null,
    querySelectorAll: (selector: string) => selector === '.tutorial-focus' ? all.filter(node => node.classes.has('tutorial-focus')) : [],
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
  input = new Input(); input.enabled = true;
  battle = Object.assign(Object.create(Battle.prototype), {
    active: true, paused: false, pauseReasons: new Set(), stage, input, elapsed: 0, roomsCleared: 0,
    player: { alive: true, auto: false, state: 'idle', hp: 100, maxHp: 100 }, ui: { refreshComboFeedback() {} },
  });
  app = { mode: 'battle', battle, input, canvas: elements.get('gl'), _auto: false,
    eco: { s: { tutorial: { completed: false, retained: 'existing' }, gold: 12000, settings: { quality: 'low' } }, emit: () => { saves++; } },
    journey: { s: { autoBattle: false } }, funnel: { track: (name: string, data: any) => events.push({ name, data }) } };
  tutorial = new BattleTutorial(app);
});
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});

test('fresh first departure is playable immediately and starts with a collapsed guide', () => {
  key('keydown', 'KeyW'); key('keydown', 'Space'); input.update();
  const queue = [...input.queue];
  expect(tutorial.begin(stage)).toBe(true);
  expect(battle.paused).toBe(false); expect(battle.pauseReasons.size).toBe(0); expect(input.enabled).toBe(true);
  expect((input.keys as Record<string, boolean>).KeyW).toBe(true); expect(input.attackHeld).toBe(true); expect(input.queue).toEqual(queue);
  expect(elements.get('battle-tutorial')!.hidden).toBe(false); expect(elements.get('tutorial-panel')!.hidden).toBe(true);
  expect((tutorial as any).toggle.textContent).toBe('조작 안내 보기'); expect(events).toEqual([]);
  expect(saves).toBe(0); expect(app.eco.s.tutorial.completed).toBe(false);
});

test('actual attack, dodge and skill state transitions never pause or clear an ongoing command', () => {
  tutorial.begin(stage);
  key('keydown', 'Space'); input.press('skill0');
  for (const [state, phase] of [['attack', 'dodge'], ['dodge', 'skill'], ['skill', 'clear']]) {
    battle.player.state = state; tutorial.update();
    expect((tutorial as any).phase).toBe(phase);
    expect(battle.paused).toBe(false); expect(battle.pauseReasons.size).toBe(0); expect(input.enabled).toBe(true);
    expect(input.attackHeld).toBe(true); expect(input.queue).toEqual(['attack', 'skill0']);
  }
});

test('folding and rereading return only tutorial button focus to the playable canvas', () => {
  tutorial.begin(stage); const toggle = (tutorial as any).toggle as ElementStub;
  toggle.focus(); toggle.dispatchEvent(new Event('click'));
  expect(elements.get('tutorial-panel')!.hidden).toBe(false); expect((document as any).activeElement).toBe(app.canvas);
  expect(elements.get('tutorial-copy')!.textContent).toContain('다시 누르기');
  key('keydown', 'KeyW'); key('keydown', 'Space'); input.update();
  expect(input.move.y).toBe(-1); expect(input.attackHeld).toBe(true);
  key('keyup', 'Space'); key('keyup', 'KeyW');
  toggle.focus(); toggle.dispatchEvent(new Event('click'));
  expect(elements.get('tutorial-panel')!.hidden).toBe(true); expect((document as any).activeElement).toBe(app.canvas);
  key('keydown', 'KeyW'); input.update(); expect(input.move.y).toBe(-1);
  expect(battle.paused).toBe(false); expect(saves).toBe(0);
});

test('manual and companion pause owners stay authoritative while the guide is hidden', () => {
  tutorial.begin(stage); tutorial.setExpanded(true);
  battle.setPaused('manual', true); battle.setPaused('companion', true);
  const previousFocus = elements.get('btn-auto'); previousFocus!.focus();
  tutorial.update(); tutorial.resumeCurrent(); tutorial.nextTip();
  expect([...battle.pauseReasons]).toEqual(['manual', 'companion']); expect(input.enabled).toBe(false);
  expect(elements.get('battle-tutorial')!.hidden).toBe(true); expect((document as any).activeElement).toBe(previousFocus);
  expect((tutorial as any).phase).toBe('attack');
  battle.setPaused('manual', false); tutorial.update(); expect(elements.get('battle-tutorial')!.hidden).toBe(true);
  battle.setPaused('companion', false); tutorial.update(); expect(elements.get('battle-tutorial')!.hidden).toBe(false);
});

test('ending an interrupted first run and redeparting preserves an incomplete save and current AUTO', () => {
  battle.player.auto = true; app.journey.s.autoBattle = true; app._auto = true;
  tutorial.begin(stage); tutorial.setExpanded(true); tutorial.end();
  expect(app.eco.s.tutorial).toEqual({ completed: false, retained: 'existing' }); expect(saves).toBe(0);
  expect(elements.get('battle-tutorial')!.hidden).toBe(true);
  expect(tutorial.begin(stage)).toBe(true); expect(elements.get('tutorial-panel')!.hidden).toBe(true);
  expect(battle.player.auto).toBe(true); expect(app.journey.s.autoBattle).toBe(true); expect(app._auto).toBe(true);
  expect(input.enabled).toBe(true); expect(battle.paused).toBe(false);
});

test('completion keeps save fields, AUTO and input, and rereading never saves or completes twice', () => {
  tutorial.begin(stage); tutorial.setExpanded(true);
  for (const state of ['attack', 'dodge', 'skill']) { battle.player.state = state; tutorial.update(); }
  battle.roomsCleared = 1; tutorial.update();
  expect(app.eco.s.tutorial).toEqual({ completed: true, retained: 'existing' }); expect(app.eco.s.gold).toBe(12000);
  expect(saves).toBe(1); expect(events.filter(event => event.name === 'tutorial_complete')).toHaveLength(1);
  key('keydown', 'Space'); tutorial.setExpanded(true); tutorial.nextTip(); tutorial.finish(true);
  expect(input.attackHeld).toBe(true); expect(input.queue).toEqual(['attack']); expect(input.enabled).toBe(true);
  expect(battle.player.auto).toBe(false); expect(saves).toBe(1); expect(events.filter(event => event.name === 'tutorial_complete')).toHaveLength(1);
  tutorial.end(); expect(tutorial.begin(stage)).toBe(false); expect(elements.get('tutorial-panel')!.hidden).toBe(true);
  expect(saves).toBe(1); expect(input.enabled).toBe(true); expect(battle.paused).toBe(false);
});

test('expanded guide folds after eight actual battle seconds and allows reopening', () => {
  tutorial.begin(stage); tutorial.setExpanded(true); battle.elapsed = 7.99; tutorial.update();
  expect(elements.get('tutorial-panel')!.hidden).toBe(false);
  battle.elapsed = 8; tutorial.update(); expect(elements.get('tutorial-panel')!.hidden).toBe(true);
  tutorial.setExpanded(true); expect(elements.get('tutorial-panel')!.hidden).toBe(false);
  expect(battle.paused).toBe(false); expect(saves).toBe(0);
});

test('clearing the first room without dodge or skill lessons completes the saved onboarding once', () => {
  tutorial.begin(stage); battle.player.state = 'attack'; tutorial.update();
  expect((tutorial as any).phase).toBe('dodge');
  battle.roomsCleared = 1; tutorial.update();
  expect(app.eco.s.tutorial.completed).toBe(true); expect(saves).toBe(1); expect((tutorial as any).phase).toBeNull();
  tutorial.update(); expect(saves).toBe(1); expect(events.filter(event => event.name === 'tutorial_complete')).toHaveLength(1);
  expect(input.enabled).toBe(true); expect(battle.paused).toBe(false);
});

test('a collapsed optional lesson never suppresses the first low-health potion hint', () => {
  const potion: any = new ElementStub('button'); potion.parentElement = { dataset: {} };
  potion.querySelector = () => ({ textContent: '3' });
  const previousQuery = document.querySelector.bind(document);
  (document as any).querySelector = (selector: string) => selector === '.exp-potions [data-potion="hp_tonic"]' ? potion : previousQuery(selector);
  tutorial.begin(stage); battle.player.hp = 50; tutorial.update();
  expect((tutorial as any).healTipLevel).toBe(1); expect(potion.classes.has('tutorial-focus')).toBe(true);
  expect(potion.parentElement.dataset.healTier).toBe('early'); expect(battle.paused).toBe(false); expect(input.enabled).toBe(true);
  battle.player.state = 'attack'; tutorial.update(); expect(potion.classes.has('tutorial-focus')).toBe(true);
});

test('legacy tutorial owner cleanup preserves independent manual pause and focused controls', () => {
  tutorial.begin(stage); battle.setPaused('manual', true); battle.setPaused('tutorial', true);
  const focused = elements.get('btn-auto'); focused!.focus(); tutorial.finish(true);
  expect([...battle.pauseReasons]).toEqual(['manual']); expect(battle.paused).toBe(true); expect(input.enabled).toBe(false);
  expect((document as any).activeElement).toBe(focused); expect(battle.player.auto).toBe(false);
});
