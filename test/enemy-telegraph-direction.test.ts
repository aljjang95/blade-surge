import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

function fixture(id = 'skel_minion', yaw = 0) {
  const f = createCombatFlowFixture(runtime);
  const enemy: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z, { id });
  const warnings: any[] = [], shots: any[] = [];
  f.game.fx.slashArc = (position: Vector3, angle: number, _color: number, options: any) => {
    if (options.telegraph) warnings.push({ position: position.clone(), yaw: angle, ...options });
  };
  f.game.spawnProjectile = (shot: any) => { shots.push(shot); };
  enemy.yaw = yaw;
  f.player.pos.set(enemy.pos.x + Math.sin(yaw) * 1.6, 0, enemy.pos.z + Math.cos(yaw) * 1.6);
  return { ...f, enemy, warnings, shots };
}

function release(f: ReturnType<typeof fixture>, fps: number) {
  const { enemy } = f, deadline = enemy.attackDur * enemy.hitAt;
  for (let frame = 0; frame < fps * 5 && !enemy.attackDone; frame++) {
    enemy.update(1 / fps);
    if (enemy.stateT + 1e-9 < deadline) {
      expect(f.events.incoming).toHaveLength(0);
      expect(f.shots).toHaveLength(0);
    }
  }
  expect(enemy.attackDone).toBe(true);
  expect(enemy.stateT).toBeGreaterThanOrEqual(deadline);
  expect(enemy.stateT).toBeLessThan(deadline + 1 / fps + 1e-9);
}

test('일반 근접의 고정 예고 옆으로 걸어나가면 공격이 추적하지 않고 정면에 남으면 원래 시각에 맞는다', () => {
  for (const fps of [30, 60, 120]) for (const yaw of [0, 1.1, -2.7]) for (const sidestep of [false, true]) {
    const f = fixture('skel_minion', yaw);
    f.enemy.startAttack(1.6);
    expect(f.warnings).toHaveLength(1);
    const warned = f.warnings[0];
    if (sidestep) f.player.pos.set(f.enemy.pos.x + Math.cos(yaw) * 1.6, 0, f.enemy.pos.z - Math.sin(yaw) * 1.6);
    release(f, fps);
    expect(f.enemy.yaw).toBe(warned.yaw);
    expect(f.enemy.pos.equals(warned.position)).toBe(true);
    expect(f.events.incoming).toHaveLength(sidestep ? 0 : 1);
  }
});

test('구형 보스 부채꼴도 원래 예고 방향으로 발사하며 옆걸음한 표적에 재조준하지 않는다', () => {
  for (const fps of [30, 60, 120]) for (const yaw of [0, 1.1, -2.7]) {
    const f = fixture('boss_dragon', yaw), random = Math.random;
    Math.random = () => .1;
    try { f.enemy.startAttack(1.6); } finally { Math.random = random; }
    expect(f.enemy.special).toBe('fan');
    const warned = f.warnings[0];
    f.player.pos.set(f.enemy.pos.x + Math.cos(yaw) * 1.6, 0, f.enemy.pos.z - Math.sin(yaw) * 1.6);
    release(f, fps);
    expect(f.shots).toHaveLength(5);
    expect(f.enemy.yaw).toBe(warned.yaw);
    const forward = new Vector3(Math.sin(warned.yaw), 0, Math.cos(warned.yaw));
    expect(f.shots[2].dir.clone().setY(0).normalize().dot(forward)).toBeCloseTo(1, 10);
    const legacyPitch = (1.2 - 1.5) / Math.hypot(1.6, 1.2 - 1.5);
    for (const shot of f.shots) {
      expect(shot.dir.y).toBeCloseTo(legacyPitch, 10);
      expect(shot.dir.clone().setY(0).normalize().angleTo(forward)).toBeLessThan(warned.arc * Math.PI / 360);
    }
  }
});

test('실제 구형 보스 탄막은 예고 정면 영웅에게 피해를 주고 옆걸음한 영웅은 피한다', () => {
  for (const fps of [30, 60, 120]) for (const sidestep of [false, true]) {
    const f = fixture('boss_dragon');
    f.player.pos.set(f.enemy.pos.x, 0, f.enemy.pos.z + 6);
    f.game.spawnProjectile = runtime.Battle.prototype.spawnProjectile;
    const random = Math.random;
    Math.random = () => .1;
    try { f.enemy.startAttack(6); } finally { Math.random = random; }
    if (sidestep) f.player.pos.set(f.enemy.pos.x + 6, 0, f.enemy.pos.z);
    release(f, fps);
    expect(f.game.projectiles).toHaveLength(5);
    for (let frame = 0; frame < fps * 2; frame++) f.game.updateProjectiles(1 / fps);
    expect(f.events.incoming.length > 0).toBe(!sidestep);
    expect(f.game.projectiles).toHaveLength(0);
  }
});

test('방향 도형이 없는 기존 단발 마법은 발사 순간 표적 추적과 원래 준비 시간을 유지한다', () => {
  for (const fps of [30, 60, 120]) {
    const f = fixture('skel_mage');
    f.enemy.startAttack(1.6);
    f.player.pos.set(f.enemy.pos.x + 4, 0, f.enemy.pos.z);
    release(f, fps);
    expect(f.warnings).toHaveLength(0);
    expect(f.shots).toHaveLength(1);
    const expected = f.player.pos.clone().setY(1.2).sub(f.shots[0].pos).normalize();
    expect(f.shots[0].dir.dot(expected)).toBeCloseTo(1, 10);
  }
});

test('실제 Enemy·Actor·Floor는 2~24체 같은 좌표를 벽 안에서 분리하고 영웅을 밀거나 피해를 만들지 않는다', () => {
  for (const count of [2, 3, 8, 24]) for (const fps of [30, 60, 120]) {
    const f = createCombatFlowFixture(runtime), world = f.game.world;
    let wall = f.room.z;
    while (world.walkable(f.room.x, wall)) wall += .25;
    f.player.pos.set(f.room.x, 0, f.room.z - 4);
    const playerPosition = f.player.pos.clone(), hp = f.player.hp;
    for (let i = 0; i < count; i++) spawnCombatFlowEnemy(f, f.room.x, wall - 1.2, { packId: i + 1, atkCd: 10 });
    for (let frame = 0; frame < fps; frame++) {
      for (const enemy of f.game.enemies) enemy.update(1 / fps);
      runtime.resolveCrowdContacts(f.game.enemies, f.player, world, 1 / fps);
      for (const enemy of f.game.enemies) {
        expect(world.walkable(enemy.pos.x, enemy.pos.z)).toBe(true);
        expect(enemy.pos.z).toBeLessThan(wall);
      }
    }
    expect(f.player.pos.equals(playerPosition)).toBe(true);
    expect(f.player.hp).toBe(hp);
    for (let i = 0; i < f.game.enemies.length; i++) for (let j = i + 1; j < f.game.enemies.length; j++) {
      expect(f.game.enemies[i].distTo(f.game.enemies[j])).toBeGreaterThan(.1);
    }
  }
});
