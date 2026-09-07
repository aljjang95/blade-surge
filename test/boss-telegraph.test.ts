import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Enemy } from '../src/game/enemies.js';
import { ENEMIES } from '../src/data/stages.js';
import { Battle } from '../src/game/battle.js';

function fanFixture(yaw: number) {
  const warnings: Array<{ yaw: number; radius: number; arc: number }> = [];
  const shots: Array<{ pos: THREE.Vector3; dir: THREE.Vector3; speed: number; life: number }> = [];
  const enemy = Object.create(Enemy.prototype);
  Object.assign(enemy, {
    def: (ENEMIES as Record<string, any>).frost_captain,
    pos: new THREE.Vector3(40, 0, -30), yaw, isBoss: true,
    phase: 0, patternTurn: 0, atk: 40, A: (key: string) => key, playTimed: () => {},
    game: {
      player: { pos: new THREE.Vector3(40 + Math.sin(yaw) * 3, 0, -30 + Math.cos(yaw) * 3) },
      fx: { slashArc: (_pos: unknown, angle: number, _color: unknown, options: { radius: number; arc: number }) => warnings.push({ yaw: angle, ...options }) },
      spawnProjectile: (shot: typeof shots[number]) => shots.push(shot),
    },
  });
  return { enemy, warnings, shots };
}

test('부채꼴 예고를 보고 옆으로 피하면 실제 탄막은 원래 예고 방향을 유지한다', () => {
  for (const yaw of [0, Math.PI / 3, -Math.PI / 2]) {
    const { enemy, warnings, shots } = fanFixture(yaw);
    enemy.startAttack(3);
    expect(shots).toHaveLength(0);
    enemy.player.pos.copy(enemy.pos).add(new THREE.Vector3(Math.cos(yaw) * 3, 0, -Math.sin(yaw) * 3));
    enemy.doAttack();
    expect(shots).toHaveLength(5);
    const warnedDirection = new THREE.Vector3(Math.sin(warnings[0].yaw), 0, Math.cos(warnings[0].yaw));
    expect(shots[2].dir.dot(warnedDirection)).toBeCloseTo(1, 6);
    for (const shot of shots) {
      expect(shot.dir.y).toBe(0);
      const angle = shot.dir.angleTo(warnedDirection);
      expect(angle).toBeLessThan(THREE.MathUtils.degToRad(warnings[0].arc / 2));
    }
  }
});

test('캠페인 탄막 중심의 마지막 위치가 예고된 사거리를 넘지 않는다', () => {
  const { enemy, warnings, shots } = fanFixture(0);
  enemy.startAttack(3); enemy.doAttack();
  for (const shot of shots) {
    const end = shot.pos.clone().addScaledVector(shot.dir, shot.speed * shot.life);
    expect(Math.hypot(end.x - enemy.pos.x, end.z - enemy.pos.z)).toBeLessThanOrEqual(warnings[0].radius);
  }
});

function summonFixture() {
  const timers: Array<() => void> = [], rooms: unknown[] = [];
  const room = { id: 8, cleared: false };
  const boss = { alive: true, def: { name: '검수 보스', summon: 'skel_minion' }, homeRoom: room, pos: new THREE.Vector3(40, 0, -30) };
  const game = {
    active: true, bossDefeated: false, maxAlive: 3, enemies: [{ alive: true }],
    curRoom: { id: 9 }, after: (_time: number, action: () => void) => timers.push(action),
    spawnEnemy: (_type: unknown, _pos: unknown, home: unknown) => { rooms.push(home); game.enemies.push({ alive: true }); },
    ui: { toast: () => {} },
  };
  return { game, boss, room, rooms, timers };
}

test('추가 소환은 전투 정원까지만 나오며 소환자의 원래 방에 귀속된다', () => {
  const f = summonFixture();
  Battle.prototype.summonMinions.call(f.game, f.boss, 4);
  for (const timer of f.timers) timer();
  expect(f.rooms).toHaveLength(2);
  expect(f.game.enemies).toHaveLength(f.game.maxAlive);
  expect(f.rooms.every(room => room === f.room)).toBe(true);
});

test('예약 뒤 전투 종료·소환자 사망·보스 격파·방 정화가 생기면 추가 소환을 취소한다', () => {
  for (const end of [
    (f: ReturnType<typeof summonFixture>) => { f.game.active = false; },
    (f: ReturnType<typeof summonFixture>) => { f.boss.alive = false; },
    (f: ReturnType<typeof summonFixture>) => { f.game.bossDefeated = true; },
    (f: ReturnType<typeof summonFixture>) => { f.room.cleared = true; },
  ]) {
    const f = summonFixture();
    Battle.prototype.summonMinions.call(f.game, f.boss, 4);
    expect(f.timers).toHaveLength(4);
    end(f);
    for (const timer of f.timers) timer();
    expect(f.rooms).toHaveLength(0);
  }
});

test('원점에서 먼 던전의 투사체도 이동하고 수명이 다한 뒤 회수된다', () => {
  const projectile = { t: 0, pos: new THREE.Vector3(40, 2, -30), dir: new THREE.Vector3(0, 0, 1), speed: 13, life: 1, radius: .75, hostile: true, trail: false };
  const game = { projectiles: [projectile], player: { alive: true, pos: new THREE.Vector3(80, 0, -30) }, fx: {}, scene: { remove: () => {} } };
  Battle.prototype.updateProjectiles.call(game, 1 / 60);
  expect(game.projectiles).toHaveLength(1);
  expect(projectile.pos.z).toBeGreaterThan(-30);
  Battle.prototype.updateProjectiles.call(game, 1);
  expect(game.projectiles).toHaveLength(0);
});

test('보스 사망 뒤 플레이어가 죽어 있으면 승리 정산을 시작하지 않는다', () => {
  const game = { active: true, player: { alive: false }, result: null, input: { enabled: false, clear: () => { throw new Error('사망 상태에서 승리 연출이 시작됨'); } } };
  Battle.prototype.victory.call(game);
  expect(game.active).toBe(true);
  expect(game.result).toBeNull();
});
