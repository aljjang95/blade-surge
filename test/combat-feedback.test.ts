import { expect, test } from 'bun:test';
import { Group } from 'three';
import { AudioSys } from '../src/engine/audio.js';
import { HeroBeacon } from '../src/game/hero-beacon.js';
import { enemySkillLabel } from '../src/game/enemies.js';

test('action beacon increases the hero silhouette signal only during committed combat states', () => {
  const root = new Group();
  const beacon = new HeroBeacon(root);
  try {
    beacon.update(true, 0, { state: 'idle', color: 0x9ffff0 });
    const idleLocator = beacon.locator.scale.y;
    beacon.update(true, 0, { state: 'attack', color: 0xffc45c });
    expect(beacon.focusRing.visible).toBe(true);
    expect(beacon.primaryRing.scale.x).toBeGreaterThan(1);
    expect(beacon.locator.scale.y).toBeGreaterThan(idleLocator);
    expect(beacon.focusRing.material.color.getHex()).toBe(0xffc45c);
  } finally {
    beacon.dispose();
  }
});

test('enemy skill labels keep mob roles and boss signatures visually distinct', () => {
  expect(enemySkillLabel({ special: 'slam' })).toBe('지면 강타');
  expect(enemySkillLabel({ mobRole: { key: 'crusher' } })).toBe('분쇄 강타');
  expect(enemySkillLabel({ def: { ranged: true } })).toBe('적의 주문');
});

test('combat audio requests distinct haptic timings for telegraph, attack release, and ultimate release', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: (pattern: unknown) => { calls.push(pattern); return true; } } });
  try {
    new AudioSys().enemyTelegraph({ kind: 'slam', boss: true });
    new AudioSys().attackRelease({ finisher: true });
    new AudioSys().skillRelease({ ult: true });
    expect(calls).toEqual([[10, 14, 24], [16, 12, 34], [20, 16, 42]]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

import { PerspectiveCamera, Vector3 } from 'three';
import { FX } from '../src/engine/fx.js';
import { HeroEffectFocus } from '../src/engine/hero-effect-focus.js';
import { combatTextRegions, heroCombatTextRegion, placeCombatStatus } from '../src/engine/combat-feedback.js';

function intersects(a: any, b: any) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test('compact status animation clears the live hero and visible controls across supported viewports', () => {
  for (const [width, height] of [[844, 390], [640, 360], [390, 844]]) {
    const hero = { left: width / 2 - 42, right: width / 2 + 42, top: height / 2 - 55, bottom: height / 2 + 55 };
    const regions = [
      { left: 0, right: width, top: 0, bottom: height > width ? 184 : 80 },
      { left: 12, right: 140, top: height - 128, bottom: height - 12 },
      { left: width - 220, right: width - 8, top: height - 180, bottom: height - 8 },
    ];
    const result = placeCombatStatus({ x: width / 2, y: height / 2, label: '가드 붕괴', lift: -68, width, height, hero, regions });
    expect(result.blocked).toBe(false);
    expect(intersects(result.bounds, hero)).toBe(false);
    expect(regions.some(rect => intersects(result.bounds, rect))).toBe(false);
    expect(result.bounds.left).toBeGreaterThanOrEqual(0);
    expect(result.bounds.right).toBeLessThanOrEqual(width);
    expect(result.bounds.top).toBeGreaterThanOrEqual(0);
    expect(result.bounds.bottom).toBeLessThanOrEqual(height);
  }
});

test('placement rejects stale view input and reports a fully blocked viewport without mutating it', () => {
  const supplied = [{ left: 0, right: 390, top: 0, bottom: 844 }];
  const cached = combatTextRegions(supplied);
  supplied[0].right = 1;
  expect(cached[0].right).toBe(390);
  expect(combatTextRegions([{ left: NaN, right: 20, top: 0, bottom: 20 }])).toEqual([]);
  expect(heroCombatTextRegion({ x: .5, y: .5, z: 0, w: .1 }, 390, 844)).toBeNull();
  const result = placeCombatStatus({ x: NaN, y: Infinity, label: '방어', lift: -68, width: 390, height: 844, regions: cached });
  expect(result.blocked).toBe(true);
  expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true);
  expect(cached).toEqual([{ left: 0, right: 390, top: 0, bottom: 844 }]);
});

test('status presentation preserves damage node pressure and retirement without gameplay RNG through pool reuse', () => {
  // 실제 FX.damage의 풀 재사용과 전역 전투 난수의 비소비를 함께 확인한다.
  const fx: any = Object.create(FX.prototype);
  fx.camera = new PerspectiveCamera(55, 390 / 844, .1, 100);
  fx.camera.position.set(0, 8, 10); fx.camera.lookAt(0, 0, 0); fx.camera.updateMatrixWorld(true);
  fx.focus = new HeroEffectFocus(); fx.focus.setTarget({ alive: true }); fx.focus.area.value.set(.5, .5, .08, .1);
  fx.dmgPool = []; fx.maxDmg = 40; fx._damageRecent = []; fx._damageSerial = 0;
  fx._damageRandomState = 123;
  fx.setCombatTextRegions([{ left: 0, right: 390, top: 0, bottom: 184 }]);
  const created: any[] = [], observed: any[] = [];
  const layer: any = {
    children: [],
    get firstChild() { return this.children[0] || null; },
    appendChild(el: any) { this.children.push(el); el.parentNode = this; },
    removeChild(el: any) { this.children.splice(this.children.indexOf(el), 1); el.parentNode = null; },
  };
  fx.dmgLayer = layer;
  const globals = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const originalRandom = Math.random;
  let randomCalls = 0;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: 390, innerHeight: 844 } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      createElement() {
        const el: any = {
          dataset: {}, handlers: new Map(), style: { setProperty() {} }, offsetWidth: 0, parentNode: null,
          _text: '', get textContent() { return this._text; }, set textContent(value: unknown) { this._text = String(value); },
          setAttribute() {},
          addEventListener(type: string, callback: () => void) { this.handlers.set(type, callback); },
          removeEventListener(type: string, callback: () => void) { if (this.handlers.get(type) === callback) this.handlers.delete(type); },
        };
        created.push(el); return el;
      },
    } });
    Math.random = () => { randomCalls++; return .5; };
    const texts = ['BLOCK', 'GUARD BREAK', 'BREAK', 'MISS', null];
    for (let i = 0; i < 55; i++) {
      fx.damage(new Vector3(0, 0, 0), i + .4, { text: texts[i % 5], crit: i % 5 === 4 });
      const el = layer.children.at(-1);
      observed.push({ text: el.textContent, key: el.dataset.combatStatus, tag: el.dataset.tag, count: layer.children.length });
    }
    fx.damage(new Vector3(), 49.1, { kind: 'heal', text: '+49' });
    observed.push({ text: layer.children.at(-1).textContent, key: layer.children.at(-1).dataset.combatStatus });
    fx.damage(new Vector3(), 67.8, { heavy: true });
    observed.push({ text: layer.children.at(-1).textContent, key: layer.children.at(-1).dataset.combatStatus, tag: layer.children.at(-1).dataset.tag });
    Math.random = originalRandom;
    expect(randomCalls).toBe(0);
    expect(created.length).toBe(41);
    expect(layer.children.length).toBe(40);
    expect(fx.dmgPool.length).toBe(1);
    expect(observed.slice(0, 55).every((entry, i) => entry.count === Math.min(40, i + 1))).toBe(true);
    expect(observed[0].text).toBe('방어'); expect(observed[1].text).toBe('가드 붕괴');
    expect(observed[2].text).toBe('균형 붕괴'); expect(observed[3].text).toBe('빗나감');
    expect(observed[54]).toEqual({ text: '54!', key: undefined, tag: 'CRIT', count: 40 });
    expect(observed[55]).toEqual({ text: '+49', key: undefined });
    expect(observed[56]).toEqual({ text: '68', key: undefined, tag: 'HEAVY' });
    for (const el of [...layer.children]) el.handlers.get('animationend')();
    expect(layer.children.length).toBe(0); expect(fx.dmgPool.length).toBe(41);
    expect(created.every(el => el.handlers.size === 0 && el._dmgDone === null)).toBe(true);
  } finally {
    Math.random = originalRandom;
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

import { combatHudAnimationRegion, combatTextViewport } from '../src/engine/combat-feedback.js';

test('recent text density never selects a HUD-blocked status when a clear candidate exists', () => {
  const regions = [{ left: 361.28, top: 214, right: 482.72, bottom: 216 }];
  const recent = [
    ...Array.from({ length: 20 }, () => ({ bounds: { left: 361.28, top: 8, right: 482.72, bottom: 116 } })),
    ...Array.from({ length: 3 }, () => ({ bounds: { left: 8, top: 107, right: 129.44, bottom: 215 } })),
    ...Array.from({ length: 3 }, () => ({ bounds: { left: 714.56, top: 107, right: 836, bottom: 215 } })),
    ...Array.from({ length: 3 }, () => ({ bounds: { left: 361.28, top: 274, right: 482.72, bottom: 382 } })),
  ];
  const result = placeCombatStatus({ x: 422, y: 195, label: '가드 붕괴', lift: -68, width: 844, height: 390, regions, recent });
  expect(result.blocked).toBe(false);
  expect(intersects(result.bounds, regions[0])).toBe(false);
});

test('cached HUD envelopes contain the declared combo, streak and cue transforms for their full animation', () => {
  const box = { left: 240, top: 100, right: 380, bottom: 142 };
  const width = box.right - box.left, height = box.bottom - box.top;
  function corners(originX: number, originY: number, translateX: number, translateY: number, scale: number, degrees = 0) {
    const angle = degrees * Math.PI / 180;
    return [box.left, box.right].flatMap(x => [box.top, box.bottom].map(y => {
      const dx = x - originX, dy = y - originY;
      return { x: originX + translateX + scale * (dx * Math.cos(angle) - dy * Math.sin(angle)),
        y: originY + translateY + scale * (dx * Math.sin(angle) + dy * Math.cos(angle)) };
    }));
  }
  function inside(bounds: any, points: { x: number; y: number }[]) {
    return points.every(point => point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom);
  }
  const combo = combatHudAnimationRegion('combo', box, true);
  const oathStreak = combatHudAnimationRegion('kill-streak', box, true);
  const plainStreak = combatHudAnimationRegion('kill-streak', box, false);
  for (const t of [0, .25, .5, .75, 1]) {
    expect(inside(combo, corners(box.right, box.top + height / 2, 0, 0, 1.4 - .4 * t, -4 * (1 - t)))).toBe(true);
    expect(inside(oathStreak, corners(box.left + width / 2, box.top + height / 2, -width / 2, -4 * (1 - t), .92 + .08 * t))).toBe(true);
    expect(inside(plainStreak, corners(box.left + width / 2, box.top + height / 2, -width / 2, -height / 2, .86 + .14 * t))).toBe(true);
  }
  const cue = combatHudAnimationRegion('combat-cue', box, true);
  for (const [scale, dy] of [[.82, -12], [1.08, 0], [1, 0], [.96, -6], [.88, -10]]) {
    expect(inside(cue, corners(box.left + width / 2, box.top + height / 2, -width / 2, dy, scale))).toBe(true);
  }
  expect(combatHudAnimationRegion('combo', { left: 0, right: 0, top: 0, bottom: 0 }, true)).toBeNull();
});

test('compact text uses cached layer height and local HUD coordinates while numerical damage keeps legacy projection', () => {
  const camera = new PerspectiveCamera(55, 390 / 844, .1, 100);
  camera.position.set(0, 8, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const layerBounds = { left: 17, top: 23, right: 407, bottom: 423 };
  const viewport = combatTextViewport(layerBounds);
  expect(viewport?.height).toBe(400);
  const regions = combatTextRegions([{ left: 17, top: 23, right: 407, bottom: 103 }], viewport);
  expect(regions).toEqual([{ left: 0, top: 0, right: 390, bottom: 80 }]);
  function fixture(withLayer: boolean) {
    const fx: any = Object.create(FX.prototype);
    fx.camera = camera; fx.focus = new HeroEffectFocus();
    fx.dmgPool = []; fx.maxDmg = 40; fx._damageRecent = []; fx._damageSerial = 0;
    fx._damageRandomState = 123;
    fx.dmgLayer = { children: [], appendChild(el: any) { this.children.push(el); el.parentNode = this; } };
    fx.setCombatTextRegions(withLayer ? [{ left: 17, top: 23, right: 407, bottom: 103 }] : [], withLayer ? layerBounds : null);
    return fx;
  }
  const compactFx = fixture(true), numericFx = fixture(false);
  const globals = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const random = Math.random, pos = new Vector3(0, 0, 7);
  let calls = 0;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: 390, innerHeight: 844 } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
      dataset: {}, style: { setProperty() {} }, offsetWidth: 0,
      setAttribute() {}, addEventListener() {}, removeEventListener() {},
    }) } });
    Math.random = () => { calls++; return .5; };
    compactFx.damage(pos, 0, { text: 'GUARD BREAK' });
    const animationBounds = compactFx._damageRecent[0].bounds;
    compactFx._damageRecent = []; compactFx._damageSerial = 0;
    compactFx._damageRandomState = numericFx._damageRandomState;
    compactFx.damage(pos, 67.8);
    numericFx.damage(pos, 67.8);
    Math.random = random;
    expect(calls).toBe(0);
    expect(animationBounds.left).toBeGreaterThanOrEqual(0);
    expect(animationBounds.right).toBeLessThanOrEqual(390);
    expect(animationBounds.top).toBeGreaterThanOrEqual(0);
    expect(animationBounds.bottom).toBeLessThanOrEqual(400);
    const a = compactFx.dmgLayer.children.at(-1), b = numericFx.dmgLayer.children.at(-1);
    expect(a.style.left).toBe(b.style.left); expect(a.style.top).toBe(b.style.top);
    expect(parseFloat(a.style.top)).toBeGreaterThan(400);
    expect(a.textContent).toBe(b.textContent);
  } finally {
    Math.random = random;
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

import { UI } from '../src/ui/ui.js';

test('HUD cache reads stable animated layout and the actual layer once per bounds change', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const layer = { left: 17, top: 23, right: 861, bottom: 413 };
  const hud: any = { classList: { contains: () => true }, getBoundingClientRect: () => layer };
  const animated = [
    { id: 'combo', offsetLeft: 14, offsetTop: 94, offsetWidth: 90, offsetHeight: 30 },
    { id: 'kill-streak', offsetLeft: 360, offsetTop: 106, offsetWidth: 140, offsetHeight: 42 },
    { id: 'combat-cue', offsetLeft: 422, offsetTop: 90, offsetWidth: 200, offsetHeight: 35 },
  ].map(el => ({ ...el, offsetParent: hud, getBoundingClientRect() { throw new Error('변형 중인 좌표를 읽으면 안 된다'); } }));
  const snapshots: any[] = [];
  const ui: any = Object.assign(Object.create(UI.prototype), {
    el: { hud }, combatTextRegionEls: animated, combatTextLayerEl: { getBoundingClientRect: () => layer },
    app: { fx: { setCombatTextRegions: (regions: any, layerBounds: any) => snapshots.push({ regions, layerBounds }) } },
  });
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      documentElement: { classList: { contains: (key: string) => key === 'oath-visual' } },
    } });
    ui.refreshCombatTextRegions(); ui.refreshCombatTextRegions();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].layerBounds).toEqual(layer);
    const streak = snapshots[0].regions[1];
    expect(streak.top).toBeLessThanOrEqual(layer.top + 106 - 4);
    expect(streak.bottom).toBeGreaterThanOrEqual(layer.top + 106 + 42);
    layer.bottom = 373;
    ui.refreshCombatTextRegions();
    expect(snapshots.length).toBe(2);
    expect(snapshots[1].layerBounds.bottom).toBe(373);
    expect(snapshots[0].layerBounds.bottom).toBe(413);
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

import { Scene } from 'three';
import { Battle as RpgBattle } from '../src/game/rpg-battle.js';

function realDamageFixture() {
  const globals = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const created: any[] = [];
  const layer: any = {
    children: [],
    get firstChild() { return this.children[0] || null; },
    appendChild(el: any) { this.children.push(el); el.parentNode = this; },
    removeChild(el: any) { this.children.splice(this.children.indexOf(el), 1); el.parentNode = null; },
  };
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  const restore = () => {
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: 880, innerHeight: 400 } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: () => layer,
    createElement(tag: string) {
      if (tag === 'canvas') return { getContext: () => context };
      const el: any = { dataset: {}, handlers: new Map(), style: { setProperty() {} }, offsetWidth: 0, parentNode: null,
        setAttribute() {}, addEventListener(type: string, callback: () => void) { this.handlers.set(type, callback); },
        removeEventListener(type: string, callback: () => void) { if (this.handlers.get(type) === callback) this.handlers.delete(type); } };
      created.push(el); return el;
    },
  } });
  try {
    const camera = new PerspectiveCamera(55, 880 / 400, .1, 100);
    camera.position.set(0, 8, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const fx = new FX(new Scene(), camera);
    const retire = () => { for (const el of [...layer.children]) el.handlers.get('animationend')(); };
    return { fx, layer, created, retire, close() { fx.dispose(); restore(); } };
  } catch (error) { restore(); throw error; }
}

test('실제 피해 숫자는 전역 난수 없이 유한한 위치 변화를 유지하고 animationend 뒤 같은 노드를 재사용한다', () => {
  const f = realDamageFixture(), originalRandom = Math.random, pos = new Vector3();
  const positions: string[] = [];
  let globalCalls = 0;
  try {
    // Three 생성자의 UUID 할당은 준비 단계에서 끝냈고 실제 표시 경로만 관찰한다.
    Math.random = () => { globalCalls++; throw new Error('피해 숫자가 전투 난수를 소비했다'); };
    for (let i = 0; i < 64; i++) {
      f.fx._damageRecent = []; f.fx._damageSerial = 0;
      f.fx.damage(pos, 50);
      const el = f.layer.children[0], x = parseFloat(el.style.left), y = parseFloat(el.style.top);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(26); expect(x).toBeLessThanOrEqual(854);
      expect(y).toBeGreaterThanOrEqual(72); expect(y).toBeLessThanOrEqual(320);
      positions.push(el.style.left + '/' + el.style.top);
      f.retire();
      expect(f.layer.children).toHaveLength(0); expect(f.fx.dmgPool).toHaveLength(1);
    }
    expect(new Set(positions).size).toBeGreaterThan(48);
    expect(f.created).toHaveLength(1);
    expect(f.created[0].handlers.size).toBe(0); expect(f.created[0]._dmgDone).toBeNull();
    expect(globalCalls).toBe(0);
  } finally { Math.random = originalRandom; f.close(); }
});

test('실제 RPG 피해의 표시·억제와 서로 다른 DOM 수명은 다음 전투 난수와 피해량을 바꾸지 않는다', () => {
  const seeded = () => {
    let state = 20260905;
    return () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
  };
  function scenario(earlyRetirement: boolean) {
    const f = realDamageFixture(), originalRandom = Math.random, pos = new Vector3();
    const amounts: number[] = [];
    let calls = 0, admitted = 0;
    try {
      for (let i = 0; i < 4; i++) f.fx.damage(pos, 1);
      const player = { stats: { crit: 0, critDmg: 2, ultGain: 1 }, auto: true, addUlt() {} };
      const battle: any = Object.assign(Object.create(RpgBattle.prototype), {
        active: true, paused: false, player, fx: f.fx, combo: 0, maxCombo: 0, dmgDealt: 0,
        app: { reducedMotion: { matches: false } }, ui: { setCombo() {} },
      });
      const enemy: any = { alive: true, spawning: false, pos, def: { scale: 1 },
        hurt(amount: number) { amounts.push(amount); return amount; } };
      const gameRandom = seeded();
      Math.random = () => { calls++; return gameRandom(); };
      for (let i = 0; i < 32; i++) {
        if (earlyRetirement || i === 16) f.retire();
        const before = f.layer.children.length;
        // proc/contact 연출을 생략하는 실제 요청에도 숫자의 기존 4-node admission은 그대로 실행한다.
        battle.damageEnemy(enemy, 100, { noProc: true });
        if (f.layer.children.length > before) admitted++;
      }
      expect(calls).toBe(64);
      const next = Array.from({ length: 4 }, () => Math.random());
      f.retire();
      expect(f.layer.children).toHaveLength(0); expect(f.fx.dmgPool).toHaveLength(4);
      expect(f.created).toHaveLength(4);
      expect(f.created.every(el => el.handlers.size === 0 && el._dmgDone === null)).toBe(true);
      expect(amounts.every(amount => Number.isFinite(amount) && amount >= 90 && amount < 110)).toBe(true);
      return { amounts, next, admitted };
    } finally { Math.random = originalRandom; f.close(); }
  }
  const early = scenario(true), late = scenario(false), untouched = seeded();
  for (let i = 0; i < 64; i++) untouched();
  const expectedNext = Array.from({ length: 4 }, () => untouched());
  expect(early.admitted).toBe(32); expect(late.admitted).toBe(4);
  expect(early.amounts).toEqual(late.amounts);
  expect(early.next).toEqual(expectedNext); expect(late.next).toEqual(expectedNext);
});
