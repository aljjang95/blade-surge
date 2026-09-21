import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle-base.js';
import { Enemy } from '../src/game/enemies.js';
import { HEROES } from '../src/data/heroes.js';

function manualPlayer(overrides: any = {}) {
  const p: any = Object.create(Player.prototype);
  Object.assign(p, {
    def: HEROES.knight, alive: true,
    auto: false,
    state: 'idle', stateT: 0, stun: 0, dodgeCd: 0,
    comboIdx: 0, comboQueued: false, attackBufferT: 0, hitDone: false,
    buffs: { atk: 1, spd: 1, atkSpd: 1, t: 0 }, stormT: 0,
    vel: new THREE.Vector3(), pos: new THREE.Vector3(), moveDir: new THREE.Vector3(),
    model: new THREE.Group(), game: { fx: { dust() {} } },
    playTimed() {}, play() {}, startTrail() {}, stopTrail() {},
    forward: (v: THREE.Vector3) => v.set(0, 0, 1),
    ...overrides,
  });
  return p;
}

test('manual basic attacks keep facing and spacing instead of auto-aiming or rushing', () => {
  let aimed = false;
  const p = manualPlayer({ autoAim: () => { aimed = true; return { pos: new THREE.Vector3(0, 0, 2) }; } });
  Player.prototype.startCombo.call(p, 0);
  expect(aimed).toBe(false);
  expect(p.state).toBe('attack');
  expect(p.vel.length()).toBe(0);
});

test('held attack does not reserve the entire combo; a fresh press does', () => {
  const started: number[] = [];
  const p = manualPlayer({ startCombo: (index: number) => started.push(index) });
  const held = { move: { x: 0, y: 0 }, attackHeld: true, consume: () => false };
  Player.prototype.handleInput.call(p, held, 0.016);
  expect(started).toHaveLength(0);

  const pressed = { move: { x: 0, y: 0 }, attackHeld: true, consume: (name: string) => name === 'attack' };
  Player.prototype.handleInput.call(p, pressed, 0.016);
  expect(started).toEqual([0]);
});

test('dodge cancel opens after anticipation and briefly after contact, with recovery risk between', () => {
  const p = manualPlayer({ state: 'attack', current: HEROES.knight.combo[0] });
  p.stateT = 0.05; expect(Player.prototype.canDodgeCancel.call(p)).toBe(false);
  p.stateT = 0.1;
  p.stateT = 0.1; p.hitDone = false; expect(Player.prototype.canDodgeCancel.call(p)).toBe(true);
  p.stateT = 0.28; p.hitDone = true; expect(Player.prototype.canDodgeCancel.call(p)).toBe(true);
  p.stateT = 0.4; expect(Player.prototype.canDodgeCancel.call(p)).toBe(false);
});

test('manual precision hitboxes do not forgive a target directly behind the hero', () => {
  const rear: any = { alive: true, spawning: false, radius: 0.5, pos: new THREE.Vector3(0, 0, -0.5) };
  const hits: any[] = [];
  const game: any = { enemies: [rear], damageEnemy: (...args: any[]) => hits.push(args) };
  const count = Battle.prototype.hitArea.call(game, null, new THREE.Vector3(), 0, 2.6, 120, 10, { precision: true });
  expect(count).toBe(0);
  const forgiving = Battle.prototype.hitArea.call(game, null, new THREE.Vector3(), 0, 2.6, 120, 10, {});
  expect(forgiving).toBe(1);
});

test('regular enemies flinch out of an attack on a manual basic-hit reaction', () => {
  let played = 0;
  const enemy: any = Object.create(Enemy.prototype);
  Object.assign(enemy, {
    alive: true, spawning: false, isBoss: false, isElite: false,
    state: 'attack', stateT: 0, stun: 0, hp: 100, maxHp: 100,
    def: { armor: 0, scale: 1 }, kb: new THREE.Vector3(), mats: [], flashColor: new THREE.Color(),
    game: { fx: {} }, telegraph: 1, attackDone: false,
    A: () => 'HitReact', play: () => { played++; },
  });
  const dealt = Enemy.prototype.hurt.call(enemy, 10, { hitReact: true, dirx: 0, dirz: 1, kb: 1 });
  expect(dealt).toBe(10);
  expect(enemy.state).toBe('hurt');
  expect(played).toBe(1);
});
