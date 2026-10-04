import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { UI } from '../src/ui/ui.js';
import { audio } from '../src/engine/audio.js';
import { HEROES, levelExp } from '../src/data/heroes.js';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle-base.js';

// The DOM boundary records native-style selectors, classes and style writes.
// setupHud/updateHud/showHud remain the production methods under test.
class El {
  dataset: Record<string, string> = {}; style: Record<string, any> = {};
  classes = new Set<string>(); attrs: Record<string, string> = {};
  selectors = new Map<string, El>(); queries: string[] = [];
  classOps: string[] = []; layoutReads = 0; parentElement: El | null = null;
  children: El[] = []; attributeWrites: Record<string, number> = {}; textWrites = 0;
  private text = '';
  hidden = false; disabled = false; src = ''; title = ''; onerror: (() => void) | null = null;
  constructor(public tagName = 'div', public namespaceURI: string | null = null) { this.style.setProperty = (key: string, value: string) => { this.style[key] = value; }; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) {
    this.text = value; this.textWrites++;
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  get className() { return [...this.classes].join(' '); }
  set className(value: string) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
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
  querySelector(selector: string): El | null {
    this.queries.push(selector);
    const known = this.selectors.get(selector); if (known) return known;
    const find = (parent: El): El | null => {
      for (const child of parent.children) {
        if (selector.startsWith('.') ? child.classes.has(selector.slice(1)) : child.tagName === selector) return child;
        const nested = find(child); if (nested) return nested;
      }
      return null;
    };
    return find(this);
  }
  setAttribute(key: string, value: string) { this.attrs[key] = value; this.attributeWrites[key] = (this.attributeWrites[key] || 0) + 1; }
  append(...children: El[]) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children: El[]) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = ''; this.append(...children); }
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
    createElement: (tag: string) => new El(tag),
    createElementNS: (namespace: string, tag: string) => new El(tag, namespace),
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
  // Model the actual index.html attack button; setup only appends passive nodes.
  const attack = get('btn-attack'), label = new El('span');
  attack.tagName = 'button'; label.textContent = '공격'; attack.append(label);
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
  const countChildren = (node: El): number => node.queries.length + node.children.reduce((n, child) => n + countChildren(child), 0);
  return f.skillBtns.reduce((n, button) => n + button.queries.length, get('btn-dodge').queries.length + countChildren(get('btn-attack')));
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

test('manual attack presentation preserves the existing target and cached nodes while exact readiness, reservation and finisher state change', () => {
  const f = fixture(), button = get('btn-attack'), children = [...button.children];
  const label = children[0], ring = children.find(child => child.tagName === 'svg')!;
  const stage = children.find(child => child.classList.contains('attack-combo-stage'))!;
  const cue = children.find(child => child.classList.contains('attack-combo-cue'))!;
  const arc = ring.children.find(child => child.classList.contains('attack-combo-ring-progress'))!;
  const combo = HEROES.knight.combo;
  // Prepared component state, not native input evidence. Real Player methods
  // determine readiness/progress; the rendering never consumes or queues input.
  Object.assign(f.player, { alive: true, state: 'attack', comboIdx: 0, current: combo[0],
    stateT: combo[0].dur * .1, hitDone: false, comboQueued: false,
    attackProgress: Player.prototype.attackProgress, canQueueCombo: Player.prototype.canQueueCombo });
  f.player.def.combo = combo;
  const sourceState = () => ({ stateT: f.player.stateT, comboIdx: f.player.comboIdx, queued: f.player.comboQueued });
  const before = sourceState(); update(f);
  expect(sourceState()).toEqual(before);
  expect(button.dataset.comboStatus).toBe('windup'); expect(stage.textContent).toBe(`1/${combo.length}타`);
  expect(label.textContent).toBe('공격'); expect(cue.textContent).toBe('준비');
  expect(arc.namespaceURI).toBe('http://www.w3.org/2000/svg'); expect(arc.style.strokeDashoffset).toBe('90');
  const ariaWrites = button.attributeWrites['aria-label'], textWrites = children.map(child => child.textWrites);
  f.player.stateT = combo[0].dur * .2; update(f);
  expect(arc.style.strokeDashoffset).toBe('80');
  expect(button.attributeWrites['aria-label']).toBe(ariaWrites); expect(children.map(child => child.textWrites)).toEqual(textWrites);
  f.player.stateT = combo[0].dur * .9; update(f);
  expect(f.player.canQueueCombo()).toBe(true); expect(f.player.comboQueued).toBe(false);
  expect(button.dataset.comboStatus).toBe('ready'); expect(label.textContent).toBe('연계'); expect(cue.textContent).toBe('다시 누르기');
  expect(button.attrs['aria-label']).toContain('다시 누르기'); expect(button.attrs['aria-keyshortcuts']).toBe('J Space');
  expect(button.dataset.comboNextStage).toBe('');
  f.player.comboQueued = true; update(f);
  expect(button.dataset.comboStatus).toBe('queued'); expect(button.dataset.comboStage).toBe('1');
  expect(button.dataset.comboNextStage).toBe('2'); expect(label.textContent).toBe('예약됨'); expect(cue.textContent).toBe('다음 2타');
  const finalIndex = combo.findIndex(attack => attack.finisher === true);
  f.player.comboIdx = finalIndex; f.player.current = combo[finalIndex]; f.player.stateT = f.player.current.dur * .9;
  update(f);
  expect(button.dataset.comboFinisher).toBe('true'); expect(stage.textContent).toBe(`${finalIndex + 1}/${combo.length}타 · 마무리`);
  expect(button.dataset.comboNextStage).toBe('1'); expect(cue.textContent).toBe('다음 1타');
  expect(button.disabled).toBe(false); expect(get('btn-attack')).toBe(button);
  expect(button.children).toHaveLength(children.length);
  button.children.forEach((child, index) => expect(child).toBe(children[index]));
  expect(ring.children.find(child => child.classList.contains('attack-combo-ring-progress'))).toBe(arc);
  expect(button.layoutReads + children.reduce((n, child) => n + child.layoutReads, 0)).toBe(0);
});

test('pause ownership and HUD/setup boundaries reset cached manual cues without replacing controls or retaining unknown timing', () => {
  const f = fixture(), button = get('btn-attack'), children = [...button.children], combo = HEROES.knight.combo;
  Object.assign(f.player, { alive: true, state: 'attack', comboIdx: 0, current: combo[0],
    stateT: combo[0].dur * .9, hitDone: false, comboQueued: true,
    attackProgress: Player.prototype.attackProgress, canQueueCombo: Player.prototype.canQueueCombo });
  f.player.def.combo = combo;
  update(f); expect(button.dataset.comboStatus).toBe('queued');
  let clearCount = 0;
  Object.assign(f.battle, { pauseReasons: new Set(), ui: f.ui, input: { enabled: true, clear() { clearCount++; } } });
  const beforeQueries = queryCount(f), stateT = f.player.stateT;
  Battle.prototype.setPaused.call(f.battle, 'manual', true);
  expect(button.dataset.comboStatus).toBe('neutral'); expect(f.battle.input.enabled).toBe(false);
  expect(children[0].textContent).toBe('공격'); expect(children.filter(child => child.tagName === 'span').slice(1).every(child => child.hidden)).toBe(true);
  Battle.prototype.setPaused.call(f.battle, 'journal', true);
  Battle.prototype.setPaused.call(f.battle, 'manual', false);
  expect(button.dataset.comboStatus).toBe('neutral'); expect(f.battle.input.enabled).toBe(false);
  Battle.prototype.setPaused.call(f.battle, 'journal', false);
  expect(button.dataset.comboStatus).toBe('queued'); expect(f.battle.input.enabled).toBe(true);
  expect(clearCount).toBe(4); expect(f.player.stateT).toBe(stateT); expect(f.player.comboQueued).toBe(true);
  expect(queryCount(f)).toBe(beforeQueries);
  f.player.auto = true; update(f); expect(button.dataset.comboStatus).toBe('neutral');
  f.player.auto = false; f.player.current = { ...combo[0] }; update(f); expect(button.dataset.comboStatus).toBe('neutral');
  f.player.current = combo[0]; update(f); expect(button.dataset.comboStatus).toBe('queued');
  f.ui.showHud(false); expect(button.dataset.comboStatus).toBe('neutral');
  f.ui.setupHud(f.player.def, f.player); expect(button.dataset.comboStatus).toBe('neutral');
  expect(button.children).toHaveLength(children.length);
  button.children.forEach((child, index) => expect(child).toBe(children[index]));
  expect(get('btn-attack')).toBe(button); expect(button.disabled).toBe(false);
  f.ui.showHud(true); update(f); expect(button.dataset.comboStatus).toBe('queued');
});
