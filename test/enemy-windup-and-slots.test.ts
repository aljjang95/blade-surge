import { expect, test } from 'bun:test';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

test('일반 공격은 시작 순간 예고 시계를 열고 추격 속도와 재몰이로 경고 원점을 바꾸지 않는다', () => {
  for (const fps of [30, 60, 120]) for (const gatherBefore of [false, true]) {
    const f = createCombatFlowFixture(runtime), e: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z);
    f.player.pos.set(e.pos.x, 0, e.pos.z + 1.6); e.yaw = 0; e.vel.set(4, 0, -2);
    if (gatherBefore) e.gather(e.pos.x + 4, e.pos.z, 20, .3);
    const origin = e.pos.clone(); e.startAttack(1.6);
    const deadline = e.attackDur * e.hitAt;
    expect(e.telegraph).toBe(deadline);
    expect(e.vel.length()).toBe(0);
    expect(e.gather(e.pos.x + 4, e.pos.z, 20, .3)).toBe(false);
    while (!e.attackDone) {
      e.update(1 / fps);
      expect(e.pos.equals(origin)).toBe(true);
      if (e.stateT + 1e-9 < deadline) expect(f.events.incoming).toHaveLength(0);
    }
    expect(f.events.incoming).toHaveLength(1);
    expect(e.stateT).toBeGreaterThanOrEqual(deadline);
    expect(e.stateT).toBeLessThan(deadline + 1 / fps + 1e-9);
  }
});

test('예고 중 강타는 원래 넉백과 경직으로 공격을 취소하고 뒤늦게 피해를 주지 않는다', () => {
  for (const fps of [30, 60, 120]) {
    const f = createCombatFlowFixture(runtime), e: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z);
    f.player.pos.set(e.pos.x, 0, e.pos.z + 1.6); e.yaw = 0; e.startAttack(1.6);
    const x = e.pos.x;
    e.hurt(1, { dirx: 1, kb: 6, stun: .8 });
    expect(e.state).toBe('hurt'); expect(e.telegraph).toBe(0); expect(e.kb.x).toBe(6);
    for (let frame = 0; frame < fps * .5; frame++) e.update(1 / fps);
    expect(e.pos.x).toBeGreaterThan(x); expect(f.events.incoming).toHaveLength(0);
  }
});

test('일반·역할 적은 어느 쪽이 먼저 공격해도 합쳐서 근접 공격 3명까지만 시작한다', () => {
  for (const firstRole of [false, true]) {
    const f = createCombatFlowFixture(runtime), enemies: any[] = [];
    for (let i = 0; i < 6; i++) enemies.push(spawnCombatFlowEnemy(f, f.room.x + i * .05, f.room.z + 1.6,
      { id: (i < 3) === firstRole ? 'orc' : 'skel_minion' }));
    for (const enemy of enemies) enemy.startAttack(enemy.distTo(f.player));
    expect(enemies.filter(enemy => enemy.state === 'attack')).toHaveLength(3);
    expect(enemies.slice(3).every(enemy => enemy.state === 'chase')).toBe(true);
    for (const enemy of enemies) enemy.mobRole?.dispose();
  }
});

test('공격 슬롯은 회복 중에는 유지하고 경직·사망 뒤 반환하며 역할별 기존 3명 한도도 유지한다', () => {
  for (const release of ['hurt', 'dead']) {
    const f = createCombatFlowFixture(runtime), active: any[] = [];
    for (let i = 0; i < 3; i++) {
      const enemy: any = spawnCombatFlowEnemy(f, f.room.x + i * .05, f.room.z + 1.6);
      enemy.startAttack(1.6); enemy.attackDone = true; enemy.stateT = enemy.attackDur * .8; active.push(enemy);
    }
    const waiting: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 3, { id: 'orc' });
    expect(waiting.mobRole.available(3)).toBe(false);
    if (release === 'hurt') active[0].hurt(1, { dirx: 1, kb: 6 });
    else active[0].kill(0, 0, 1);
    expect(waiting.mobRole.available(3)).toBe(true);
    waiting.startAttack(3);
    expect(waiting.state).toBe('attack');
    waiting.mobRole.dispose();
  }
});

test('근거리 일반 공격은 멀리서 이미 돌진 준비 중인 역할 적의 3개 슬롯을 우회하지 않는다', () => {
  const f = createCombatFlowFixture(runtime), active: any[] = [];
  for (let i = 0; i < 3; i++) {
    const enemy: any = spawnCombatFlowEnemy(f, f.room.x + i * .05, f.room.z + 7.5, { id: 'orc' });
    enemy.startAttack(enemy.distTo(f.player)); active.push(enemy);
  }
  const waiting: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 1.6);
  waiting.startAttack(1.6);
  expect(active.every(enemy => enemy.state === 'attack')).toBe(true);
  expect(waiting.state).toBe('chase');
  for (const enemy of active) enemy.mobRole.dispose();
});
