import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { gatherEnemies, prepareEnemyGather } from '../src/game/crowd-gather.js';
import { countWhirlwindContacts, createCombatFlowFixture, loadCombatFlowRuntime, runCombatFlowScenario,
  spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

test('경타는 피해와 목표 중단을 유지하며 이동·공격·기존 강타 회복 시계를 반복 초기화하지 않는다', () => {
  for (const state of ['idle', 'move', 'attack', 'hurt']) {
    const f = createCombatFlowFixture(runtime), p: any = f.player;
    p.state = state; p.stateT = .21; p.comboIdx = 2; p.comboQueued = true;
    p.attackBufferT = .1; p.vel.set(3, 0, 1);
    const hp = p.hp;
    for (let i = 0; i < 5; i++) expect(p.hurt(20, { dirx: 1, kb: 3 })).toBe(true);
    expect(p.hp).toBe(hp - 5 * Math.round(20 * (1 - p.stats.def / (p.stats.def + 250))));
    expect(p.state).toBe(state); expect(p.stateT).toBe(.21);
    expect(p.comboIdx).toBe(2); expect(p.comboQueued).toBe(true); expect(p.attackBufferT).toBe(.1);
    expect(p.vel.toArray()).toEqual([3, 0, 1]); expect(p.kb.length()).toBe(0); expect(p.invuln).toBe(0);
    expect(f.events.objectiveInterrupts).toBe(5);
    expect(f.events.shakes).toEqual([.055]);
  }
});

test('강타는 기존 넉백·콤보 중단/재개를 유지하고 스킬 슈퍼아머에도 실제 밀림을 남긴다', () => {
  const f = createCombatFlowFixture(runtime), p: any = f.player;
  p.startCombo(2);
  for (let frame = 0; frame < 120 && !p.hitDone; frame++) stepCombatFlow(f, 1 / 120);
  expect(p.hitDone).toBe(true);
  p.hurt(20, { dirz: 1, kb: 6 });
  expect(p.state).toBe('hurt'); expect(p.stateT).toBe(0);
  expect(p.comboResume).toEqual({ idx: 3, t: 1.2 }); expect(p.kb.z).toBe(6);
  p.stateT = .18; p.hurt(20, { kb: 3 }); expect(p.stateT).toBe(.18);
  p.state = 'skill'; p.kb.set(0, 0, 0); p.hurt(20, { dirx: 1, kb: 9 });
  expect(p.state).toBe('skill'); expect(p.kb.x).toBe(9);
  expect(f.events.shakes).toEqual([.3, .3]);
});

test('경타에도 사망·방어·기존 회피 무적의 피해 경계가 그대로 적용된다', () => {
  const f = createCombatFlowFixture(runtime), p: any = f.player;
  p.invuln = .2;
  const hp = p.hp; expect(p.hurt(100, { kb: 3 })).toBe(false); expect(p.hp).toBe(hp);
  p.invuln = 0; p.hp = 1; expect(p.hurt(100, { kb: 3 })).toBe(true);
  expect(p.hp).toBe(0); expect(p.alive).toBe(false); expect(p.state).toBe('dead'); expect(f.game.active).toBe(false);
});

test('Lv1 철벽 강타는 외곽 적을 준비 중 실제로 모은 뒤 원래 접촉 시점에 피해를 준다', () => {
  const f = createCombatFlowFixture(runtime), p: any = f.player;
  const center = p.pos.clone().add(new Vector3(0, 0, 1.2));
  const e: any = spawnCombatFlowEnemy(f, center.x + 6.7, center.z);
  const hp = e.hp;
  expect(p.tryCastCombatSkill(1)).toBe(true);
  for (let i = 0; i < 8; i++) stepCombatFlow(f, 1 / 60);
  expect(e.hp).toBe(hp); expect(e.pos.distanceTo(center)).toBeLessThan(5);
  for (let i = 0; i < 10; i++) stepCombatFlow(f, 1 / 60);
  expect(e.hp).toBeLessThan(hp);
  expect(f.events.hits[0].at).toBeGreaterThanOrEqual(.7 * .35);
  expect(f.events.hits[0].at).toBeLessThan(.7 * .35 + 1 / 30);
  expect(Math.hypot(f.events.hits[0].x - center.x, f.events.hits[0].z - center.z)).toBeLessThan(5);
  expect(e.gatherT).toBe(0); expect(e.kb.length()).toBeGreaterThan(0);
});

test('Lv1 회오리는 첫 타 전에 외곽 적을 모으고 연타·충돌 뒤에도 실제 군집을 유지한다', () => {
  const f = createCombatFlowFixture(runtime, 'barbarian'), p: any = f.player;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    spawnCombatFlowEnemy(f, p.pos.x + Math.sin(a) * 5.3, p.pos.z + Math.cos(a) * 5.3);
  }
  expect(p.tryCastCombatSkill(0)).toBe(true);
  for (let i = 0; i < 8; i++) stepCombatFlow(f, 1 / 60);
  expect(f.events.hits).toHaveLength(0);
  expect(Math.max(...f.game.enemies.map((e: any) => e.pos.distanceTo(p.pos)))).toBeLessThan(4);
  for (let i = 0; i < 30; i++) stepCombatFlow(f, 1 / 60);
  expect(f.events.hits.length).toBeGreaterThan(8);
  expect(Math.max(...f.game.enemies.filter((e: any) => e.alive).map((e: any) => e.pos.distanceTo(p.pos)))).toBeLessThan(3.8);
  expect(f.game.enemies.every((e: any) => f.game.world.walkable(e.pos.x, e.pos.z))).toBe(true);
});

test('gather 수렴은 실제 Actor/Floor에서 30·60·120fps와 기존 적 추격/속도에 관계없이 중심을 지나치지 않는다', () => {
  const distances: number[] = [];
  for (const fps of [30, 60, 120]) {
    const f = createCombatFlowFixture(runtime), center = f.player.pos.clone();
    const e: any = spawnCombatFlowEnemy(f, center.x + 6, center.z);
    e.vel.set(-30, 0, 9); e.kb.set(-20, 0, 4);
    expect(gatherEnemies(f.game, center, 7, 18, .4)).toBe(1);
    const vel = e.vel, kb = e.kb;
    for (let i = 0; i < fps * .4; i++) {
      stepCombatFlow(f, 1 / fps);
      expect(e.pos.x).toBeGreaterThanOrEqual(center.x);
      expect(f.game.world.walkable(e.pos.x, e.pos.z)).toBe(true);
    }
    distances.push(e.pos.distanceTo(center)); expect(e.vel).toBe(vel); expect(e.kb).toBe(kb);
  }
  expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(.2);
});

test('추격 중 gather 저항은 보스/엘리트 순서로 유지하며 기절을 추가하지 않는다', () => {
  const travel: number[] = [];
  for (const flags of [{}, { isElite: true }, { isBoss: true }]) {
    const f = createCombatFlowFixture(runtime), e: any = spawnCombatFlowEnemy(f, f.player.pos.x + 6, f.player.pos.z, flags);
    e.atkCd = 10;
    const from = e.pos.clone(); e.gather(f.player.pos.x, f.player.pos.z, 20, .3);
    e.update(.1);
    travel.push(e.pos.distanceTo(from)); expect(e.state).toBe('chase'); expect(e.stun).toBe(0);
  }
  expect(travel[0]).toBeCloseTo(2); expect(travel[1]).toBeCloseTo(1); expect(travel[2]).toBeCloseTo(.3);
});

test('고정된 예고·보스/엘리트 공격 원점과 돌진 경로는 gather가 움직이거나 취소하지 않는다', () => {
  for (const flags of [{}, { isElite: true }, { isBoss: true }]) {
    const f = createCombatFlowFixture(runtime), e: any = spawnCombatFlowEnemy(f, f.player.pos.x + 6, f.player.pos.z, flags);
    e.gather(f.player.pos.x, f.player.pos.z, 20, .3);
    e.state = 'attack'; e.stateT = .2; e.attackDur = 2; e.hitAt = .5; e.telegraph = .8; e.attackDone = false;
    const position = e.pos.clone();
    expect(e.gather(f.player.pos.x, f.player.pos.z, 20, .3)).toBe(false);
    e.update(.1);
    expect(e.pos.equals(position)).toBe(true); expect(e.state).toBe('attack'); expect(e.stateT).toBeCloseTo(.3);
    expect(e.telegraph).toBeCloseTo(.7); expect(e.attackDone).toBe(false); expect(e.stun).toBe(0);
  }
});

test('강타·띄우기·죽음·폐기는 gather를 끝내고 기존 pull은 환경과 같은 충격 저항을 유지한다', () => {
  for (const finish of ['heavy', 'airborne', 'death', 'dispose']) {
    const f = createCombatFlowFixture(runtime), e: any = spawnCombatFlowEnemy(f, f.player.pos.x + 3, f.player.pos.z);
    e.gather(f.player.pos.x, f.player.pos.z, 20, .4);
    if (finish === 'heavy') e.hurt(1, { dirx: 1, kb: 6 });
    if (finish === 'airborne') e.hurt(1, { up: true, kb: 2 });
    if (finish === 'death') e.hurt(e.maxHp + 1, { kb: 1 });
    if (finish === 'dispose') e.dispose();
    expect(e.gatherT).toBe(0);
    const fresh: any = spawnCombatFlowEnemy(f, f.player.pos.x + 3, f.player.pos.z, { isElite: true });
    fresh.pull(f.player.pos.x, f.player.pos.z, 6);
    expect(fresh.kb.x).toBe(-3); expect(fresh.gatherT).toBe(0);
  }
});

test('지속 회오리의 다음 프레임 재몰이는 강타/띄우기/기절의 실제 넉백 소유권을 덮지 못한다', () => {
  for (const opts of [{ kb: 11 }, { kb: 2, up: true }, { kb: 7, stun: .8 }]) {
    const f = createCombatFlowFixture(runtime, 'barbarian'), p: any = f.player;
    const e: any = spawnCombatFlowEnemy(f, p.pos.x + 2, p.pos.z, { hp: 100000, maxHp: 100000, atkCd: 100 });
    p.tryCastCombatSkill(0); stepCombatFlow(f, 1 / 60);
    e.hurt(1, { dirx: 1, ...opts });
    const initialX = e.pos.x, beforeKb = e.kb.x, beforeVel = e.vel.x;
    expect(e.gatherBlockT).toBeGreaterThanOrEqual(.35);
    expect(e.gather(p.pos.x, p.pos.z, 30, .3)).toBe(false);
    stepCombatFlow(f, 1 / 60);
    expect(e.pos.x).toBeCloseTo(initialX + (beforeKb + beforeVel) / 60); expect(e.kb.x).toBeGreaterThan(0);
    expect(e.kb.x).toBeLessThan(beforeKb); expect(e.gatherT).toBe(0);
  }
});

test('실제 charger 계획의 swept path와 피해는 재몰이 요청 유무에 따라 바뀌지 않는다', () => {
  const key = Object.keys(runtime.ENEMIES).find(id => runtime.ENEMIES[id].meleeRole === 'charger')!;
  const rows: unknown[] = [];
  for (const gathering of [false, true]) {
    const f = createCombatFlowFixture(runtime), e: any = spawnCombatFlowEnemy(f, f.player.pos.x, f.player.pos.z + 6, { id: key });
    const plan = e.mobRole.start();
    let rejected = 0;
    for (let i = 0; i < 90 && e.mobRole.plan === plan; i++) {
      if (gathering && !e.gather(f.player.pos.x + 5, f.player.pos.z, 32, .4)) rejected++;
      stepCombatFlow(f, 1 / 60);
    }
    rows.push({ position: e.pos.toArray(), playerHp: f.player.hp, hits: e.mobRole.hits, casts: e.mobRole.casts,
      path: Array.from(e.mobRole.path.slice(0, e.mobRole.pathCount * 2)) });
    if (gathering) expect(rejected).toBeGreaterThan(0);
    e.mobRole.dispose();
  }
  expect(rows[0]).toEqual(rows[1]);
});

test('잘못된 벽 너머 목표점도 실제 Floor.resolve를 우회하거나 봉인을 넘어가지 않는다', () => {
  const f = createCombatFlowFixture(runtime);
  let wall = f.room.z;
  while (f.game.world.walkable(f.room.x, wall)) wall += .25;
  const e: any = spawnCombatFlowEnemy(f, f.room.x, wall - 1.2);
  e.gather(f.room.x, wall + 4, 32, .4);
  for (let i = 0; i < 30; i++) {
    stepCombatFlow(f, 1 / 60);
    expect(f.game.world.walkable(e.pos.x, e.pos.z)).toBe(true); expect(e.pos.z).toBeLessThan(wall);
    expect(f.game.world.roomAt(e.pos.x, e.pos.z)).not.toBe(f.game.world.bossRoom);
  }
});

test('지연된 .25초 단계의 새 몰이는 실제 Floor 마스크의 얇은 벽 뒤 이동 가능한 지점으로 관통하지 않는다', () => {
  const f = createCombatFlowFixture(runtime), world = f.game.world;
  // 실제 Floor 충돌기를 유지하고 단일 셀 벽만 주입해 endpoint-only 관통을 재현한다.
  const column = Math.floor(f.room.x - world.minX) + 2, wall = world.minX + column;
  for (let row = 0; row < world.rows; row++) world.mask[row * world.cols + column] = 0;
  f.player.pos.x -= 5;
  const e: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z);
  e.gather(f.room.x + 8, f.room.z, 32, .4);
  stepCombatFlow(f, .25);
  expect(e.pos.x).toBeLessThan(wall); expect(world.walkable(e.pos.x, e.pos.z)).toBe(true);
});

test('실제 전투 pause에는 몰이/피해/공격이 진행하지 않고 비활성/죽은 소유자의 잔여 몰이를 폐기한다', () => {
  const f = createCombatFlowFixture(runtime), e: any = spawnCombatFlowEnemy(f, f.player.pos.x + 6, f.player.pos.z);
  e.gather(f.player.pos.x, f.player.pos.z, 20, .4);
  const position = e.pos.clone(); f.game.paused = true;
  for (let i = 0; i < 60; i++) stepCombatFlow(f, 1 / 60);
  expect(e.pos.equals(position)).toBe(true); expect(e.gatherT).toBe(.4); expect(f.game.elapsed).toBe(0);
  f.game.paused = false; f.player.alive = false;
  expect(prepareEnemyGather(e, 1 / 60)).toBe(false); expect(e.gatherT).toBe(0);
  expect(e.gather(0, 0, NaN, 1)).toBe(false);
  e.alive = false; expect(e.gather(0, 0, 20, 1)).toBe(false);
});

test('실제 단계 기반 수동 전투 시뮬은 동일 시드에서 재현되며 적 AI 피해를 계속 받는다', () => {
  const a = runCombatFlowScenario(runtime, { seed: 20261008, fps: 60, hero: 'knight' });
  const b = runCombatFlowScenario(runtime, { seed: 20261008, fps: 60, hero: 'knight' });
  expect(a).toEqual(b); expect(a.outgoingHits).toBeGreaterThan(0);
  expect(a.damageTaken).toBeGreaterThan(0); expect(a.movement).toBeGreaterThan(0);
  expect(a.lightDamageCount).toBeGreaterThan(0); expect(a.lightInterruptions).toBe(0);
  expect(a.gatheredIntoFirstContact).toBeGreaterThanOrEqual(6); expect(a.allEnemiesWalkable).toBe(true);
});

test('실제 회오리 종료까지 30·60·120fps에서 기존 .22초 간격을 쓰고 피해 상한을 넘지 않는다', () => {
  for (const fps of [30, 60, 120]) {
    const row = countWhirlwindContacts(runtime, fps);
    expect(row.done).toBe(true); expect(row.ticks).toBe(7);
    expect(row.acceptedHits).toBe(7); expect(row.damage).toBeLessThanOrEqual(row.damageUpperBound);
    expect(row.firstHitAt).toBeGreaterThanOrEqual(.16);
  }
});
