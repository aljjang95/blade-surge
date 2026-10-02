import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { UI } from '../src/ui/ui.js';
import { audio } from '../src/engine/audio.js';
import { levelExp } from '../src/data/heroes.js';

// The DOM boundary records native-style selectors, classes and style writes.
// setupHud/updateHud/showHud remain the production methods under test.
class El {
  dataset: Record<string, string> = {}; style: Record<string, any> = {};
  classes = new Set<string>(); attrs: Record<string, string> = {};
  selectors = new Map<string, El>(); queries: string[] = [];
  classOps: string[] = []; layoutReads = 0; parentElement: El | null = null;
  textContent = ''; hidden = false; src = ''; title = ''; onerror: (() => void) | null = null;
  constructor() { this.style.setProperty = (key: string, value: string) => { this.style[key] = value; }; }
  get classList() { return {
    contains: (key: string) => this.classes.has(key),
    toggle: (key: string, force?: boolean) => {
      this.classOps.push(`toggle:${key}:${force}`);
      const on = force ?? !this.classes.has(key);
      if (on) this.classes.add(key); else this.classes.delete(key);
      return on;
    },
    add: (...keys: string[]) => { for (const key of keys) { this.classOps.push(`add:${key}`); this.classes.add(key); } },
    remove: (...keys: string[]) => { for (const key of keys) { this.classOps.push(`remove:${key}`); this.classes.delete(key); } },
  }; }
  get offsetWidth() { this.layoutReads++; return 48; }
  querySelector(selector: string) { this.queries.push(selector); return this.selectors.get(selector) ?? null; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  replaceChildren() {}
}

let nodes: Map<string, El>, originalDocument: PropertyDescriptor | undefined;
function observeAudio() { return spyOn(audio, 'play').mockImplementation(() => undefined); }
let play: ReturnType<typeof observeAudio>;
const get = (id: string) => {
  if (!nodes.has(id)) nodes.set(id, new El());
  return nodes.get(id)!;
};
beforeEach(() => {
  nodes = new Map(); originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: get, querySelectorAll: () => [],
  } });
  play = observeAudio();
});
afterEach(() => {
  play.mockRestore();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});
function controls() {
  const buttons = Array.from({ length: 6 }, () => {
    const button = new El(); button.selectors.set('.cd', new El()); button.selectors.set('img', new El());
    button.selectors.set('.lock b', new El()); return button;
  });
  get('btn-dodge').selectors.set('.dodge-cd', new El());
  return buttons;
}
function fixture() {
  const skillBtns = controls(), hero = { level: 1, exp: 20 };
  const skills = [
    { name: 'one', desc: 'one', icon: 'one.png', cd: 4, mp: 5 },
    { name: 'two', desc: 'two', icon: 'two.png', cd: 8 },
    { name: 'three', desc: 'three', icon: 'three.png', cd: 10, mp: 20 },
    { name: 'ult', desc: 'ult', icon: 'ult.png', ult: true },
    { name: 'four', desc: 'four', icon: 'four.png', cd: 12, unlock: 10 },
    { name: 'five', desc: 'five', icon: 'five.png', cd: 15, unlock: 20 },
  ];
  const def = { skills, color: '#123456', portrait: 'hero.png' }, slots = [0, 1, 2, 3, 4, 5];
  const player: any = { def, hp: 80, maxHp: 100, mp: 10, maxMp: 40, ult: 50, ultMax: 100,
    dodgeCd: 1.25, cds: [2, 0, 0, 0, 5, 6], auto: false,
    combatSkillIndex: (slot: number) => slots[slot],
    combatSkill: (slot: number) => ({ index: slots[slot], skill: player.def.skills[slots[slot]] }),
    unlocked: (index: number) => hero.level >= (player.def.skills[index].unlock || 1),
  };
  get('hud-ult').parentElement = new El();
  const battle: any = { player, active: true, heroId: 'test', elapsed: 2, routeObjectives: null,
    sp: null, boss: null, canBossShortcut: () => false };
  const ui: any = Object.assign(Object.create(UI.prototype), { skillBtns, _astralChoiceHud: false,
    app: { battle }, eco: { hero: () => hero }, el: { hud: get('hud'), toast: get('toast-layer') },
    comboEl: get('combo'), killStreakEl: get('kill-streak'), combatCueEl: get('combat-cue'),
    lootLayer: get('loot-layer'), combatNotices: { clear() {} }, hurtT: 0, miniT: 0,
    minimap: { draw() {} },
  });
  ui.setupHud(def, player);
  return { ui, battle, player, hero, skillBtns, slots };
}
function queryCount(f: ReturnType<typeof fixture>) {
  return f.skillBtns.reduce((n, button) => n + button.queries.length, get('btn-dodge').queries.length);
}
function update(f: ReturnType<typeof fixture>) {
  const before = queryCount(f); f.ui.updateHud(f.battle, .016);
  expect(queryCount(f)).toBe(before);
}
// Inspect actual children through the DOM fixture, rather than through cache fields.
function readControls(f: ReturnType<typeof fixture>) {
  return f.skillBtns.map(button => ({ cd: button.querySelector('.cd')!.style['--p'],
    ready: button.dataset.ready, locked: button.classList.contains('locked'),
    ultReady: button.classList.contains('ready'), flash: button.classList.contains('ready-flash') }));
}

test('cached children preserve cooldown, MP, lock, ultimate and ready transitions without per-tick selectors', () => {
  const f = fixture(); f.skillBtns[0].classList.add('tutorial-target'); update(f);
  expect(readControls(f)).toEqual([
    { cd: '50%', ready: '0', locked: false, ultReady: false, flash: false },
    { cd: '0%', ready: '1', locked: false, ultReady: false, flash: true },
    { cd: '0%', ready: '0', locked: false, ultReady: false, flash: false },
    { cd: '50%', ready: '0', locked: false, ultReady: false, flash: false },
    { cd: '0%', ready: '0', locked: true, ultReady: false, flash: false },
    { cd: '0%', ready: '0', locked: true, ultReady: false, flash: false },
  ]);
  expect(get('btn-dodge').classList.contains('cooling')).toBe(true);
  expect(get('btn-dodge').querySelector('.dodge-cd')!.textContent).toBe('1.3');
  expect(get('hud-hp').style.width).toBe('80%'); expect(get('hud-hp-txt').textContent).toBe('80 / 100');
  expect(get('hud-mp').style.width).toBe('25%'); expect(get('hud-mp-txt').textContent).toBe('MP 10 / 40');
  expect(get('hud-exp-txt').textContent).toBe(`EXP 20 / ${levelExp(1)}`);
  expect(get('hud-ult').style.width).toBe('50%');
  expect(play.mock.calls.map(call => call[0])).toEqual(['ui_pluck']);
  f.player.hp = 20; f.player.mp = 25; f.player.ult = 100; f.player.dodgeCd = .001;
  f.player.cds = [0, 4, 0, 0, 3, 0]; f.hero.level = 20; f.hero.exp = 200;
  update(f);
  expect(readControls(f)).toEqual([
    { cd: '0%', ready: '1', locked: false, ultReady: false, flash: true },
    { cd: '50%', ready: '0', locked: false, ultReady: false, flash: true },
    { cd: '0%', ready: '1', locked: false, ultReady: false, flash: true },
    { cd: '0%', ready: '1', locked: false, ultReady: true, flash: true },
    { cd: '25%', ready: '0', locked: false, ultReady: false, flash: false },
    { cd: '0%', ready: '1', locked: false, ultReady: false, flash: true },
  ]);
  expect(get('btn-dodge').classList.contains('cooling')).toBe(false);
  expect(get('btn-dodge').querySelector('.dodge-cd')!.hidden).toBe(true);
  expect(get('hud-hp').style.width).toBe('20%'); expect(get('hud-vignette').style.opacity).toBe(.42);
  expect(get('hud-mp').style.width).toBe('62.5%'); expect(get('hud-mp-txt').textContent).toBe('MP 25 / 40');
  expect(get('hud-exp-txt').textContent).toBe(`EXP 200 / ${levelExp(20)}`);
  expect(get('hud-ult').parentElement!.classList.contains('full')).toBe(true);
  const flashes = f.skillBtns.map(button => button.layoutReads), calls = play.mock.calls.length;
  update(f); expect(f.skillBtns.map(button => button.layoutReads)).toEqual(flashes);
  expect(play.mock.calls.length).toBe(calls);
  f.player.mp = 0; update(f);
  expect(f.skillBtns[0].dataset.ready).toBe('0'); expect(f.skillBtns[2].dataset.ready).toBe('0');
  f.player.mp = 25; update(f); expect(play.mock.calls.length).toBe(calls + 2);
  expect(f.skillBtns[0].classList.contains('tutorial-target')).toBe(true);
});

test('setupHud rebinds replaced cooldown children and current skill loadout without updating detached nodes', () => {
  const f = fixture(); update(f);
  const oldCooldowns = f.skillBtns.map(button => button.querySelector('.cd')!);
  const oldStyles = oldCooldowns.map(node => node.style['--p']);
  const oldDodge = get('btn-dodge').querySelector('.dodge-cd')!, nextDodge = new El();
  nodes.set('btn-dodge', nextDodge); nextDodge.selectors.set('.dodge-cd', new El());
  f.skillBtns.forEach(button => button.selectors.set('.cd', new El()));
  f.slots.splice(0, 6, 2, 1, 0, 3, 5, 4); f.hero.level = 20;
  f.player.def = { ...f.player.def, portrait: 'next.png', color: '#fedcba' };
  f.ui.setupHud(f.player.def, f.player);
  expect(get('hud-portrait').src).toBe('next.png');
  expect(f.skillBtns.map(button => button.dataset.skillIndex)).toEqual(['2', '1', '0', '3', '5', '4']);
  expect(f.skillBtns.map(button => button.dataset.ready)).toEqual(['0', '0', '0', '0', '0', '0']);
  expect(f.skillBtns.every(button => !button.classList.contains('ready-flash'))).toBe(true);
  f.player.dodgeCd = 2.5; f.player.mp = 30; f.player.cds = [1, 2, 3, 0, 6, 12]; update(f);
  expect(readControls(f).map(control => control.cd)).toEqual(['30%', '25%', '25%', '50%', '80%', '50%']);
  expect(nextDodge.querySelector('.dodge-cd')!.textContent).toBe('2.5');
  expect(oldDodge.textContent).toBe('1.3'); expect(oldCooldowns.map(node => node.style['--p'])).toEqual(oldStyles);
  f.skillBtns[0].querySelector('img')!.onerror!();
  expect(f.skillBtns[0].style.background).toBe('linear-gradient(135deg, #fedcba, #222)');
});

test('Astral HUD scope changes once per transition and resets across victory, hide, retry and campaign', () => {
  const f = fixture(), hud = get('hud'); update(f); update(f);
  const toggles = () => hud.classOps.filter(op => op.startsWith('toggle:astral-choice-hud:'));
  expect(toggles()).toEqual([]);
  f.battle.routeObjectives = { def: { id: 'astral_constellations_standard' } }; update(f); update(f);
  expect(hud.classList.contains('astral-choice-hud')).toBe(true); expect(toggles()).toEqual(['toggle:astral-choice-hud:true']);
  f.battle.active = false; update(f); update(f);
  expect(hud.classList.contains('astral-choice-hud')).toBe(false);
  expect(toggles()).toEqual(['toggle:astral-choice-hud:true', 'toggle:astral-choice-hud:false']);
  f.battle.active = true; update(f); f.ui.showHud(false);
  expect(hud.classList.contains('astral-choice-hud')).toBe(false);
  f.ui.showHud(true); update(f); update(f);
  expect(hud.classList.contains('astral-choice-hud')).toBe(true);
  expect(toggles().filter(op => op.endsWith(':true'))).toHaveLength(3);
  f.battle.routeObjectives = null; update(f); update(f);
  expect(hud.classList.contains('astral-choice-hud')).toBe(false);
  f.battle.routeObjectives = { def: { id: 'bellfall_crypt_standard' } }; update(f);
  expect(hud.classList.contains('astral-choice-hud')).toBe(false);
  f.battle.player = null; f.battle.routeObjectives = { def: { id: 'astral_constellations_standard' } }; update(f);
  expect(hud.classList.contains('astral-choice-hud')).toBe(true);
  f.battle.active = false; update(f);
  expect(hud.classList.contains('astral-choice-hud')).toBe(false);
});


test('dodge cooldown keeps the native .01 visibility boundary and display rounding', () => {
  const f = fixture(), dodge = get('btn-dodge'), cd = dodge.querySelector('.dodge-cd')!;
  for (const [value, hidden] of [[.02, false], [.01, true], [0, true], [.03, false]] as const) {
    f.player.dodgeCd = value; update(f);
    expect(cd.hidden).toBe(hidden); expect(dodge.classList.contains('cooling')).toBe(!hidden);
    expect(cd.textContent).toBe('0.0');
  }
});
