import { beforeEach, afterEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { resolveJobHero } from '../src/data/jobs.js';
import { Player } from '../src/game/player.js';
import { SKILLS } from '../src/game/skills.js';
import { applyLook } from '../src/game/look.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('new and legacy saves receive Ranger once without altering existing progression', () => {
  const eco = new Economy();
  expect(eco.ownHero('ranger')).toBe(true);
  expect(eco.hero('ranger').shards).toBe(0);
  const legacy = structuredClone(eco.s);
  delete legacy.heroes.ranger;
  legacy.heroes.knight.level = 19; legacy.gold = 4321;
  const migrated = normalizeSave(legacy, eco.fresh());
  expect(migrated.heroes.ranger.level).toBe(1);
  expect(migrated.heroes.knight.level).toBe(19);
  expect(migrated.gold).toBe(4321);
  migrated.heroes.ranger.star = 4; migrated.heroes.ranger.shards = 37;
  migrated.heroes.ranger.level = 22; migrated.selected = 'ranger';
  eco.s = migrated; expect(eco.save()).toBe(true);
  for (let i = 0; i < 3; i++) {
    const loaded = new Economy();
    expect(loaded.s.selected).toBe('ranger');
    expect(loaded.hero('ranger')).toMatchObject({ star: 4, shards: 37, level: 22 });
    loaded.save();
  }
});

test('Ranger catalog is playable and does not replace the Rogue ranger job', () => {
  expect(HERO_ORDER).toContain('ranger');
  expect(HEROES.ranger).toMatchObject({ model: 'Ranger', rarity: 'SR', ranged: true, weapon: 'bow' });
  expect(HEROES.ranger.combo).toHaveLength(5);
  expect(HEROES.ranger.skills).toHaveLength(6);
  for (const sk of HEROES.ranger.skills) expect((SKILLS as any)[sk.id]).toBeDefined();
  expect(resolveJobHero(HEROES.rogue, 'ranger').id).toBe('rogue');
  expect(resolveJobHero(HEROES.ranger, 'guardian')).toBe(HEROES.ranger);
});

function archer() {
  const shots: any[] = [], timers: (() => void)[] = [];
  const game: any = { active: true, ui: { toast() {} }, hasProc: () => false,
    spawnProjectile: (shot: any) => shots.push(shot), after: (_delay: number, fn: () => void) => timers.push(fn) };
  const p: any = { def: HEROES.ranger, pos: new THREE.Vector3(), vel: new THREE.Vector3(), alive: true,
    atk: 100, jobResource: 0, game, model: new THREE.Group(),
    forward: (v: THREE.Vector3) => v.set(0, 0, 1),
    gainJobResource: Player.prototype.gainJobResource, arrowOrigin: Player.prototype.arrowOrigin };
  game.player = p;
  return { p, game, shots, timers };
}

test('five actual combo steps emit seven arrows and earn capped focus', () => {
  const { p, shots } = archer();
  for (const step of HEROES.ranger.combo) {
    p.current = step; Player.prototype.doComboHit.call(p);
  }
  expect(shots).toHaveLength(7);
  expect(shots.every(s => s.visual === 'arrow' && s.kind === 'slash')).toBe(true);
  expect(shots[2].dir.x).toBeLessThan(0); expect(shots[4].dir.x).toBeGreaterThan(0);
  expect(shots.slice(-2).every(s => s.pierce)).toBe(true);
  expect(shots.filter(s => s.finisher)).toHaveLength(1);
  expect(shots.at(-1).finisher).toBe(true);
  expect(p.jobResource).toBe(3);
});

test('bow world transform defines the launch position and equipment never reveals a loose Arrow', () => {
  const { p } = archer();
  p.model.position.set(5, 0, 8);
  const bow = new THREE.Group(); bow.name = 'Bow'; bow.position.set(.3, 1.4, .1); p.model.add(bow);
  const arrow = new THREE.Group(); arrow.name = 'Arrow'; p.model.add(arrow);
  const origin = p.arrowOrigin(new THREE.Vector3(0, 0, 1));
  expect(origin.toArray()).toEqual([5.3, 1.4, 8.45]);
  for (const item of [undefined, 'w_storm']) {
    applyLook(p.model, HEROES.ranger, item ? { weapon: { id: item, enh: 0 } } : {});
    expect(bow.visible).toBe(true); expect(arrow.visible).toBe(false);
  }
});

test('focus empowers piercing fire, ultimate and binding while retreat and quickshot restore it', () => {
  const { p, game, shots, timers } = archer();
  p.jobResource = 3; SKILLS.ranger_pierce.cast(game, p, { dmg: 100 } as any);
  expect(p.jobResource).toBe(0); expect(shots[0]).toMatchObject({ dmg: 200, visual: 'arrow', pierce: true });
  SKILLS.ranger_volley.cast(game, p, { dmg: 100 } as any);
  expect(shots.slice(-3).every(s => s.slow === 2)).toBe(true);
  SKILLS.ranger_retreat.cast(game, p, { dmg: 100 } as any);
  expect(p.vel.z).toBeLessThan(0); expect(p.invuln).toBe(.6); expect(p.jobResource).toBe(1);
  SKILLS.ranger_retreat.end(game, p); expect(p.vel.length()).toBe(0);
  p.jobResource = 3; SKILLS.ranger_tempest.cast(game, p, { dmg: 100 } as any);
  expect(p.jobResource).toBe(0); expect(shots.slice(-7).every(s => s.dmg === 150)).toBe(true);
  const count = shots.length;
  SKILLS.ranger_quickshot.cast(game, p, { dmg: 100 } as any); timers.splice(0).forEach(fn => fn());
  expect(shots.length - count).toBe(3); expect(p.jobResource).toBe(1);
  p.jobResource = 3; SKILLS.ranger_binding.cast(game, p, { dmg: 100 } as any);
  expect(p.jobResource).toBe(0); expect(shots.slice(-5).every(s => s.dmg === 200 && s.slow === 4)).toBe(true);
});

test('delayed quickshot arrows cannot leak into a stopped battle', () => {
  const { p, game, shots, timers } = archer();
  SKILLS.ranger_quickshot.cast(game, p, { dmg: 100 } as any);
  game.active = false; timers.forEach(fn => fn());
  expect(shots).toHaveLength(1);
});

test('actual skill entry enforces Ranger ultimate gauge and awakening levels', () => {
  const { p, game } = archer(); let cinematic = 0;
  Object.assign(p, { heroLevel: 1, state: 'idle', ult: 99, ultMax: 100, cds: [0,0,0,0,0,0],
    skillLevels: [1,1,1,1,1,1], unlocked: Player.prototype.unlocked, stopTrail() {}, autoAim() {}, playTimed() {} });
  game.ultCinematic = () => cinematic++;
  expect(Player.prototype.tryCastSkill.call(p, 3)).toBe(false);
  expect(Player.prototype.tryCastSkill.call(p, 4)).toBe(false);
  p.ult = 100;
  expect(Player.prototype.tryCastSkill.call(p, 3)).toBe(true);
  expect(p.ult).toBe(0); expect(p.state).toBe('ult'); expect(cinematic).toBe(1);
  expect(p.skillCtx.impl).toBe(SKILLS.ranger_tempest);
  p.state = 'idle'; p.heroLevel = 10;
  expect(Player.prototype.tryCastSkill.call(p, 4)).toBe(true);
  expect(p.cds[4]).toBe(12); expect(p.skillCtx.impl).toBe(SKILLS.ranger_quickshot);
});
