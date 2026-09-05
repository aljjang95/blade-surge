import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CompanionCombatant } from '../src/companion/combatant.js';

function makeGltf() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0x6a9aa0 })));
  return { scene, animations: [] };
}

function makeGame() {
  const timers: Array<() => void> = [];
  const calls = { damage: 0, vacuum: 0, guard: 0, signal: [] as string[] };
  const player = {
    alive: true,
    hp: 100,
    maxHp: 100,
    atk: 120,
    yaw: 0,
    invuln: 0,
    pos: new THREE.Vector3(0, 0, 0),
  };
  const game = {
    scene: new THREE.Scene(),
    active: true,
    elapsed: 1,
    player,
    enemies: [] as Array<Record<string, unknown>>,
    world: { resolve: (_ox: number, _oz: number, x: number, z: number) => [x, z] },
    after: (_seconds: number, callback: () => void) => timers.push(callback),
    vacuum: () => { calls.vacuum += 1; return 1; },
    damageEnemy: () => { calls.damage += 1; },
    fx: {
      boltTex: () => undefined,
      castCircle: () => undefined,
      damage: () => { calls.guard += 1; },
      groundTex: () => undefined,
      holyBurst: () => undefined,
      shockTex: () => undefined,
    },
  };
  return { game, player, timers, calls };
}

describe('CompanionCombatant', () => {
  test('몰이 진형은 적을 견인하고 Battle 피해 경계를 사용한다', () => {
    const { game, timers, calls } = makeGame();
    const enemy = {
      alive: true,
      spawning: false,
      isBoss: false,
      isElite: false,
      def: { scale: 1 },
      pos: new THREE.Vector3(2, 0, 0),
    };
    game.enemies.push(enemy);
    const companion = new CompanionCombatant(game, makeGltf(), (signal: string) => calls.signal.push(signal));
    companion.attackCd = 0;
    companion.setTactic('gather');

    companion.update(0.1);
    expect(timers).toHaveLength(1);
    timers[0]();

    expect(calls.vacuum).toBe(1);
    expect(calls.damage).toBe(1);
    expect(calls.signal).toContain('gather-cast');
    companion.dispose();
  });

  test('수호 진형은 위기 체력에서만 회복막을 소비한다', () => {
    const { game, player, timers, calls } = makeGame();
    player.hp = 40;
    const companion = new CompanionCombatant(game, makeGltf(), (signal: string) => calls.signal.push(signal));
    companion.healCd = 0;
    companion.setTactic('guard');

    companion.update(0.1);
    expect(timers).toHaveLength(1);
    timers[0]();

    expect(player.hp).toBe(49);
    expect(player.invuln).toBeGreaterThan(0);
    expect(calls.guard).toBe(1);
    expect(calls.signal).toContain('guard-heal');
    companion.dispose();
  });

  test('파쇄 진형은 가까운 잡몹보다 사거리 안 정예를 우선한다', () => {
    const { game } = makeGame();
    const normal = { alive: true, spawning: false, isBoss: false, isElite: false, def: { scale: 1 }, pos: new THREE.Vector3(1, 0, 0) };
    const elite = { alive: true, spawning: false, isBoss: false, isElite: true, def: { scale: 1 }, pos: new THREE.Vector3(5, 0, 0) };
    game.enemies.push(normal, elite);
    const companion = new CompanionCombatant(game, makeGltf(), () => undefined);
    companion.setTactic('break');

    expect(companion.nearestTarget(10)).toBe(elite);
    companion.dispose();
  });
});
