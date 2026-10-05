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
  geometryReads = 0; offsetParent: El | null = null; offsetLeft = 0; offsetTop = 0;
  bounds = { left: 0, top: 0, width: 0, height: 0 };
  children: El[] = []; attributeWrites: Record<string, number> = {}; textWrites = 0;
  styleWrites: Record<string, number> = {}; datasetWrites: Record<string, number> = {}; hiddenWrites = 0;
  private text = '';
  private hiddenValue = false;
  disabled = false; src = ''; title = ''; onerror: (() => void) | null = null;
  constructor(public tagName = 'div', public namespaceURI: string | null = null) {
    this.style.setProperty = (key: string, value: string) => { this.styleWrites[key] = (this.styleWrites[key] || 0) + 1; this.style[key] = value; };
    this.style.getPropertyValue = (key: string) => String(this.style[key] ?? '');
    this.style.getPropertyPriority = () => '';
    this.style.removeProperty = (key: string) => {
      const previous = this.style.getPropertyValue(key); delete this.style[key]; return previous;
    };
    this.dataset = new Proxy(this.dataset, { set: (target, key: string, value: string) => {
      this.datasetWrites[key] = (this.datasetWrites[key] || 0) + 1; target[key] = value; return true;
    } });
  }
  get hidden() { return this.hiddenValue; }
  set hidden(value: boolean) { this.hiddenWrites++; this.hiddenValue = value; }
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
  get offsetWidth() { this.layoutReads++; return this.hidden || this.classes.has('hidden') ? 0 : this.bounds.width || 48; }
  get offsetHeight() { this.layoutReads++; return this.hidden || this.classes.has('hidden') ? 0 : this.bounds.height; }
  get childElementCount() { return this.children.length; }
  getBoundingClientRect() {
    this.geometryReads++;
    const { left, width } = this.bounds;
    const styledTop = Number.parseFloat(this.style.getPropertyValue('--battle-notice-top'));
    const top = Number.isFinite(styledTop) ? styledTop : this.bounds.top;
    const height = this.hidden || this.classes.has('hidden') ? 0 : this.bounds.height;
    return { x: left, y: top, left, top, width: height ? width : 0, height, right: left + (height ? width : 0), bottom: top + height };
  }
  querySelectorAll(selector: string): El[] {
    this.queries.push(selector);
    const alternatives = selector.split(',').map(value => value.trim().split(/\s+/));
    const matches = (el: El, token: string) => token.startsWith('.') ? el.classes.has(token.slice(1)) : el.tagName === token;
    const descendants: El[] = [];
    const visit = (parent: El) => { for (const child of parent.children) { descendants.push(child); visit(child); } };
    visit(this);
    return descendants.filter(el => alternatives.some(tokens => {
      if (!matches(el, tokens[tokens.length - 1])) return false;
      let parent = el.parentElement;
      for (let i = tokens.length - 2; i >= 0; i--) {
        while (parent && !matches(parent, tokens[i])) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    }));
  }
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
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  replaceChildren(...children: El[]) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = ''; this.append(...children); }
}

// The platform delivers explicit resize notifications; it does not emulate CSS or a browser render.
class ResizeBoundary {
  observed = new Set<El>(); unobserved: El[] = [];
  constructor(private notify: () => void) {}
  observe(el: El) { this.observed.add(el); }
  unobserve(el: El) { this.observed.delete(el); this.unobserved.push(el); }
  deliver(el: El) { expect(this.observed.has(el)).toBe(true); this.notify(); }
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
  const documentElement = new El('html'); documentElement.classList.add('oath-visual');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: get, querySelectorAll: () => [], documentElement,
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
  const hud = get('hud'), header = new El(), center = new El();
  header.className = 'hud-top'; center.className = 'hud-center';
  const wave = get('hud-wave'), stage = get('hud-stage'), target = new El(), posture = new El();
  wave.className = 'wave'; stage.className = 'stage-name'; target.className = 'rpg-target'; posture.className = 'mw-posture';
  center.append(wave, stage, target, posture); header.append(center); hud.append(header, get('bossbar'), get('combat-cue'));
  hud.bounds = { left: 0, top: 0, width: 880, height: 400 };
  header.bounds = { left: 14, top: 14, width: 852, height: 90 };
  wave.bounds = { left: 244, top: 14, width: 200, height: 22 };
  stage.bounds = { left: 244, top: 39, width: 200, height: 16 };
  target.bounds = { left: 244, top: 60, width: 300, height: 20 };
  posture.bounds = { left: 244, top: 84, width: 300, height: 15 };
  get('bossbar').classList.add('hidden'); get('combat-cue').offsetParent = hud;
  get('toast-layer').bounds = { left: 330, top: 64, width: 220, height: 24 };
  const ui: any = Object.assign(Object.create(UI.prototype), { skillBtns, _astralChoiceHud: false,
    app: { battle }, eco: { hero: () => hero }, el: { hud: get('hud'), toast: get('toast-layer') },
    comboEl: get('combo'), killStreakEl: get('kill-streak'), combatCueEl: get('combat-cue'),
    lootLayer: get('loot-layer'), combatNotices: { clear() {} }, hurtT: 0, miniT: 0,
    minimap: { draw() {} },
    combatNoticeHeaderEls: [], combatNoticeObservedHeaders: new Set<El>(),
  });
  const resize = new ResizeBoundary(() => ui.refreshCombatNoticeLayout());
  ui.combatNoticeResize = resize;
  for (const el of [hud, get('toast-layer'), header, get('bossbar'), get('combat-cue')]) resize.observe(el);
  ui.setupHud(def, player);
  return { ui, battle, player, hero, skillBtns, slots, resize, header, wave, stage, target, posture };
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
  expect(get('hud-hp').style.width).toBe('20%'); expect(get('hud-vignette').style.opacity).toBe('0.42');
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

test('같은 HUD 값은 반복 쓰지 않고 실제 MP·EXP·막대 소수 변화는 즉시 반영한다', () => {
  const f = fixture(); update(f);
  const labels = [get('hud-hp-txt'), get('hud-mp-txt'), get('hud-exp-txt'), get('btn-dodge').querySelector('.dodge-cd')!];
  const bars = [get('hud-hp'), get('hud-mp'), get('hud-exp'), get('hud-ult'), get('hud-vignette'),
    ...f.skillBtns.map(button => button.querySelector('.cd')!)];
  const textWrites = labels.map(label => label.textWrites), styleWrites = bars.map(bar => ({ ...bar.styleWrites }));
  const readyWrites = f.skillBtns.map(button => button.datasetWrites.ready || 0);
  const hiddenWrites = [labels[3].hiddenWrites, get('btn-boss-shortcut').hiddenWrites];
  const flashes = f.skillBtns.map(button => button.layoutReads), sounds = play.mock.calls.length;
  for (let frame = 0; frame < 30; frame++) update(f);
  expect(labels.map(label => label.textWrites)).toEqual(textWrites); expect(bars.map(bar => bar.styleWrites)).toEqual(styleWrites);
  expect(f.skillBtns.map(button => button.datasetWrites.ready || 0)).toEqual(readyWrites);
  expect([labels[3].hiddenWrites, get('btn-boss-shortcut').hiddenWrites]).toEqual(hiddenWrites);
  expect(f.skillBtns.map(button => button.layoutReads)).toEqual(flashes); expect(play.mock.calls.length).toBe(sounds);
  f.player.mp = 10.000000000000002; f.player.hp = 80.00000000000001; f.player.cds[0] = 1.9999999999999998;
  update(f);
  expect(get('hud-mp').style.width).toBe(Math.max(0, f.player.mp / f.player.maxMp) * 100 + '%');
  expect(get('hud-hp').style.width).toBe(Math.max(0, f.player.hp / f.player.maxHp) * 100 + '%');
  expect(f.skillBtns[0].querySelector('.cd')!.style['--p']).toBe(Math.max(0, f.player.cds[0] / 4) * 100 + '%');
  expect(labels[1].textWrites).toBe(textWrites[1]);
  f.player.mp = 11; f.hero.exp = 21; update(f);
  expect(labels[1].textContent).toBe('MP 11 / 40'); expect(labels[1].textWrites).toBe(textWrites[1] + 1);
  expect(labels[2].textContent).toBe(`EXP 21 / ${levelExp(1)}`); expect(labels[2].textWrites).toBe(textWrites[2] + 1);
});

test('외부 HUD 초기화와 같은 값의 setupHud 재호출도 실제 표시와 준비 전환을 복원한다', () => {
  const f = fixture(); f.player.ult = 100; update(f);
  const hp = get('hud-hp'), mp = get('hud-mp'), exp = get('hud-exp'), cd = f.skillBtns[0].querySelector('.cd')!;
  get('hud-hp-txt').textContent = ''; get('hud-mp-txt').textContent = ''; get('hud-exp-txt').textContent = '';
  hp.style.width = '0%'; mp.style.width = '0%'; exp.style.width = '0%'; cd.style['--p'] = '0%';
  get('btn-dodge').querySelector('.dodge-cd')!.hidden = true; get('btn-boss-shortcut').hidden = false;
  update(f);
  expect(hp.style.width).toBe('80%'); expect(mp.style.width).toBe('25%'); expect(exp.style.width).toBe(20 / levelExp(1) * 100 + '%');
  expect(get('hud-hp-txt').textContent).toBe('80 / 100'); expect(get('hud-mp-txt').textContent).toBe('MP 10 / 40');
  expect(get('hud-exp-txt').textContent).toBe(`EXP 20 / ${levelExp(1)}`); expect(cd.style['--p']).toBe('50%');
  expect(get('btn-dodge').querySelector('.dodge-cd')!.hidden).toBe(false); expect(get('btn-boss-shortcut').hidden).toBe(true);
  f.ui.showHud(false); f.ui.showHud(true); f.ui.setupHud(f.player.def, f.player);
  expect(get('hud-ult').parentElement!.classList.contains('full')).toBe(false);
  const sounds = play.mock.calls.length, flashes = f.skillBtns.map(button => button.layoutReads); update(f);
  expect(get('hud-ult').parentElement!.classList.contains('full')).toBe(true); expect(cd.style['--p']).toBe('50%');
  expect(f.skillBtns[1].dataset.ready).toBe('1'); expect(f.skillBtns[3].dataset.ready).toBe('1');
  expect(play.mock.calls.length).toBe(sounds + 2);
  expect(f.skillBtns.map(button => button.layoutReads)).toEqual(flashes.map((count, slot) => count + (slot === 1 || slot === 3 ? 1 : 0)));
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

// Supplied DOM bounds test the real layout methods and observer/lifecycle wiring.
// They do not prove browser CSS grid/cascade, physical viewport or native art readability.
test('combat notice follows a newly observed absolute target row and stays out of normal HUD ticks', () => {
  const f = fixture(), toast = get('toast-layer'); f.ui.showHud(true);
  expect(f.resize.observed.has(f.target)).toBe(true); expect(f.resize.observed.has(f.posture)).toBe(true);
  const notice = new El(); notice.textContent = '20연속 처치 · 전장의 지배자'; toast.append(notice);
  f.resize.deliver(toast);
  expect(toast.style['--battle-notice-top']).toBe('110px');
  expect(get('hud').style['--combat-notice-bottom']).toBe('134px');
  f.target.bounds = { left: 244, top: 126.4, width: 300, height: 32 };
  f.resize.deliver(f.target);
  expect(toast.style['--battle-notice-top']).toBe('165px');
  expect(get('hud').style['--combat-notice-bottom']).toBe('189px');
  expect(notice.textContent).toBe('20연속 처치 · 전장의 지배자');
  const writes = toast.styleWrites['--battle-notice-top']; f.resize.deliver(f.target);
  expect(toast.styleWrites['--battle-notice-top']).toBe(writes);
  const headerNodes = [f.header, f.wave, f.stage, f.target, f.posture, get('bossbar')];
  const reads = headerNodes.map(el => el.geometryReads);
  for (let frame = 0; frame < 30; frame++) update(f);
  expect(headerNodes.map(el => el.geometryReads)).toEqual(reads);
});

test('provided growing portrait header and separate visible boss bounds reserve the full notice row', () => {
  const f = fixture(), toast = get('toast-layer'), boss = get('bossbar');
  get('hud').bounds = { left: 0, top: 0, width: 390, height: 844 };
  f.header.bounds = { left: 14, top: 8, width: 362, height: 310.5 };
  f.target.bounds = { left: 14, top: 252.25, width: 362, height: 23.25 };
  f.posture.bounds = { left: 14, top: 294, width: 362, height: 24.5 };
  f.ui.showHud(true); toast.append(new El()); f.resize.deliver(f.header);
  expect(toast.style['--battle-notice-top']).toBe('325px');
  expect(get('hud').style['--combat-notice-bottom']).toBe('349px');
  boss.bounds = { left: 14, top: 324, width: 362, height: 52.25 }; boss.classList.remove('hidden');
  f.resize.deliver(boss);
  expect(toast.style['--battle-notice-top']).toBe('383px');
  expect(get('hud').style['--combat-notice-bottom']).toBe('407px');
  boss.classList.add('hidden'); f.resize.deliver(boss);
  expect(toast.style['--battle-notice-top']).toBe('325px');
});

test('real cue ownership and clear lifecycle separate a notice from the stable animated danger envelope', () => {
  const f = fixture(), cue = get('combat-cue'), toast = get('toast-layer'), owner = {}, foreign = {};
  cue.bounds = { left: 440, top: 150, width: 132, height: 30 }; cue.offsetLeft = 440; cue.offsetTop = 150;
  f.ui.showHud(true); toast.append(new El()); f.resize.deliver(toast);
  try {
    f.ui.combatCue('치유 준비 · 근접·강타로 중단', 'red', 5000, owner);
    expect(f.ui.combatCueOwner).toBe(owner); expect(cue.classList.contains('on')).toBe(true);
    // Offset box bottom180 + existing envelope4.2 +6 gap rounds upward to191.
    expect(toast.style['--battle-notice-top']).toBe('191px');
    expect(get('hud').style['--combat-notice-bottom']).toBe('215px');
    expect(f.ui.clearCombatCue(foreign, cue.textContent)).toBe(false);
    expect(toast.style['--battle-notice-top']).toBe('191px');
    expect(f.ui.clearCombatCue(owner, cue.textContent)).toBe(true);
    expect(toast.style['--battle-notice-top']).toBe('110px');
    expect(get('hud').style['--combat-notice-bottom']).toBe('134px');
  } finally { clearTimeout(f.ui.combatCueTimer); }
});

test('HUD exit clears notice positioning and reentry observes replacement target leaves without retaining the old owner', () => {
  const f = fixture(), toast = get('toast-layer'); f.ui.showHud(true); toast.append(new El()); f.resize.deliver(toast);
  expect(f.ui.combatNoticeObservedHeaders.size).toBe(4);
  f.ui.showHud(false);
  expect(toast.style.getPropertyValue('--battle-notice-top')).toBe('');
  expect(get('hud').style['--combat-notice-bottom']).toBe('0px');
  expect(f.ui.combatNoticeHeaderEls).toEqual([]);
  const parent = f.target.parentElement!, nextTarget = new El(); f.target.remove(); nextTarget.className = 'rpg-target';
  nextTarget.bounds = { left: 244, top: 150, width: 300, height: 60 }; parent.append(nextTarget);
  f.ui.showHud(true);
  expect(f.resize.observed.has(f.target)).toBe(false); expect(f.resize.unobserved).toContain(f.target);
  expect(f.resize.observed.has(nextTarget)).toBe(true); expect(f.ui.combatNoticeObservedHeaders.size).toBe(4);
  expect(toast.style['--battle-notice-top']).toBe('216px');
  expect(get('hud').style['--combat-notice-bottom']).toBe('0px');
  toast.append(new El()); f.resize.deliver(nextTarget);
  expect(get('hud').style['--combat-notice-bottom']).toBe('240px');
});
