import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Vector3 } from 'three';
import { audio } from '../src/engine/audio.js';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CoolingValves } from '../src/game/cooling-valves.js';
import { EmberRearExposure } from '../src/game/ember-rear-exposure.js';
import { BossSignatures } from '../src/game/boss-signatures.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';
import { runBossSim } from '../tools/ember-deep-boss-sim.mjs';

// 잿불금고 심층 사슬 집행자 후방 노출(BUNDLE-14) 규칙 테스트. 계약은 BUNDLE-14-PLAN.md 3절이다.
const runtime: any = await loadCombatFlowRuntime();
runtime.BossSignatures = BossSignatures;
const DEF = ROUTE_OBJECTIVES.ember_deep.rear as any;
const DT = 1 / 60;
const ARMOR = 0.24; // cinder_chain_executor 의 방어 감쇄. 정의 값을 독립 상수로 다시 적어 둔다.

let restores: Array<() => void> = [];
beforeEach(() => {
  restores = (['ting', 'magic', 'boom', 'charge', 'play', 'whoosh'] as const).map(key => {
    const spy = spyOn(audio as any, key).mockImplementation(() => {});
    return () => spy.mockRestore();
  });
});
afterEach(() => { for (const restore of restores) restore(); });

// ---------------- 가짜 보스: 시그니처 시계를 직접 돌려 규칙만 본다 ----------------
function fakeBoss(extra: any = {}) {
  const boss: any = { alive: true, spawning: false, isBoss: true, state: 'attack', special: 'kiln_hammer', attackSequence: 1, atkCd: 0, yaw: 0,
    pos: new Vector3(0, 0, 0), damageVeil: null, runtimeSpeciesId: 'cinder_chain_executor',
    signatures: { plan: { key: 'kiln_hammer', lastStrike: 2.65 }, age: 0 }, ...extra };
  let completed = 0;
  Object.defineProperty(boss, 'completedAttackSequence', { configurable: true, get() {
    const plan = boss.signatures?.plan;
    if (boss.state === 'attack' && plan && boss.signatures.age >= plan.lastStrike) completed = boss.attackSequence;
    return completed;
  } });
  return boss;
}
function fakeGame(boss: any, extra: any = {}) {
  const toasts: string[] = [];
  return { active: true, paused: false, bossDefeated: false, boss, world: null as any, stage: { encounter: { enemyId: 'cinder_chain_executor' } },
    ui: { toast: (t: string) => toasts.push(t) }, toasts, ...extra };
}
function tick(c: EmberRearExposure, g: any, seconds: number, dt = DT) {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) { g.boss.signatures.age += dt; c.update(g, dt); }
}
function attach(def: any = DEF, bossExtra: any = {}) {
  const boss = fakeBoss(bossExtra), g = fakeGame(boss), c = new EmberRearExposure(def);
  c.update(g, DT);
  return { boss, g, c };
}
function open(x: ReturnType<typeof attach>) {
  x.boss.signatures.age = x.boss.signatures.plan.lastStrike;
  x.c.update(x.g, DT);
  expect(x.c.state).toBe('exposed');
}

test('정의: 사슬 집행자·용재 망치·창 4초·등 뒤 2배·정면 50%·내적 .35, 심층 잿불금고에만 있다', () => {
  expect(DEF).toEqual({ id: 'ember_deep_rear', boss: 'cinder_chain_executor', signature: 'kiln_hammer', window: 4,
    rearDot: .35, frontDot: .35, rear: 2, front: .5, autoDot: .6, meleeReach: 2.4, rangedReach: 6, sidePad: .9 });
  expect(Object.isFrozen(DEF)).toBe(true);
  for (const [key, value] of Object.entries(ROUTE_OBJECTIVES)) if (key !== 'ember_deep') expect((value as any).rear).toBeUndefined();
  for (const bad of [null, { ...DEF, window: 0 }, { ...DEF, rear: 0 }, { ...DEF, front: 0 }, { ...DEF, rearDot: 1 }, { ...DEF, frontDot: 0 },
    { ...DEF, autoDot: .2 }, { ...DEF, meleeReach: 0 }, { ...DEF, rangedReach: -1 }, { ...DEF, sidePad: -1 }, { ...DEF, boss: 1 }, { ...DEF, signature: null }]) {
    expect(() => new EmberRearExposure(bad as any)).toThrow(RangeError);
  }
});

test('부착: 사슬 집행자 보스가 나타나면 armored 와 토스트 1회, 다른 보스·시그니처 없는 보스·등장 중에는 붙지 않는다', () => {
  const x = attach();
  expect(x.c.state).toBe('armored');
  expect(x.boss.damageVeil).toBe(x.c);
  expect(x.g.toasts).toEqual(['사슬 갑주 · 용재 망치가 박히면 등 뒤를 노리세요']);
  x.c.update(x.g, DT);
  expect(x.g.toasts.length).toBe(1);
  for (const extra of [{ runtimeSpeciesId: 'ash_colossus' }, { signatures: null }, { spawning: true }, { isBoss: false }, { alive: false }]) {
    const y = attach(DEF, extra);
    expect(y.c.state).toBe('idle');
    expect(y.boss.damageVeil).toBeNull();
  }
  // runtimeSpeciesId 가 없으면 stage.encounter.enemyId 로 판별한다.
  const boss = fakeBoss({ runtimeSpeciesId: undefined }), g = fakeGame(boss), c = new EmberRearExposure(DEF);
  c.update(g, DT);
  expect(c.state).toBe('armored');
});

test('열림: 용재 망치의 마지막 고리 직후 한 번만 열리고, 다른 시그니처·마지막 고리 전에는 열리지 않는다', () => {
  const x = attach();
  tick(x.c, x.g, 2.6);
  expect(x.c.state).toBe('armored');
  open(x);
  expect(x.c.windows).toBe(1);
  expect(x.c.windowLeft).toBe(DEF.window);
  expect(x.g.toasts.at(-1)).toBe('망치가 박혔다 · 4초 동안 등 뒤가 약점');
  // 창이 끝난 뒤 같은 망치(같은 attackSequence)로는 다시 열지 않는다.
  tick(x.c, x.g, DEF.window + .1);
  expect(x.c.state).toBe('armored');
  tick(x.c, x.g, 1);
  expect(x.c.windows).toBe(1);
  // 다른 시그니처(용광로 개방)는 열지 않는다.
  Object.assign(x.boss, { special: 'kiln_vents', attackSequence: 2 }); x.boss.signatures.plan = { key: 'kiln_vents', lastStrike: 2.75 }; x.boss.signatures.age = 0;
  tick(x.c, x.g, 3.5);
  expect(x.c.state).toBe('armored');
  // 다음 용재 망치는 다시 연다.
  Object.assign(x.boss, { special: 'kiln_hammer', attackSequence: 3 }); x.boss.signatures.plan = { key: 'kiln_hammer', lastStrike: 3.6 }; x.boss.signatures.age = 0;
  tick(x.c, x.g, 3.55);
  expect(x.c.state).toBe('armored');
  tick(x.c, x.g, .1);
  expect(x.c.state).toBe('exposed');
  expect(x.c.windows).toBe(2);
});

test('끊김: 마지막 고리 전에 망치가 끊기면 broken 을 세고 열지 않는다', () => {
  const x = attach();
  tick(x.c, x.g, 1);
  x.boss.state = 'hurt';
  x.c.update(x.g, DT);
  expect(x.c.broken).toBe(1);
  // 끊긴 뒤에는 시계가 마지막 고리 시각을 지나도(시전 상태가 아니라 완료가 쓰이지 않는다) 열리지 않는다.
  x.boss.signatures.age = 2.65;
  tick(x.c, x.g, .5);
  expect(x.c.state).toBe('armored');
  expect(x.c.windows).toBe(0);
  expect(x.c.broken).toBe(1);
});

test('창 길이·공격 대기: 정확히 window 초(1/60 프레임 240개) 동안 열리고 atkCd 를 창 남은 시간 + dt 이상으로 붙잡는다', () => {
  const x = attach();
  open(x);
  x.boss.state = 'chase';
  let frames = 1, below = false;
  while (x.c.state === 'exposed' && frames < 1000) {
    x.boss.atkCd = 0;
    x.c.update(x.g, DT);
    if (x.c.state === 'exposed') { frames++; if (x.boss.atkCd < x.c.windowLeft + DT - 1e-12) below = true; }
  }
  expect(frames).toBe(Math.round(DEF.window / DT));
  expect(below).toBe(false);
  expect(x.c.windowLeft).toBe(0);
  // 원래 대기가 더 길면 줄이지 않는다.
  const y = attach(); open(y); y.boss.atkCd = 99; y.c.update(y.g, DT);
  expect(y.boss.atkCd).toBe(99);
});

test('일시정지·종료: 일시정지 중 창 시계가 멈추고, 보스 처치·사망·전투 종료·다른 월드·stop 이면 ended 로 끝나 배율이 1이 된다', () => {
  const x = attach(); open(x);
  const left = x.c.windowLeft;
  x.g.paused = true; tick(x.c, x.g, 2);
  expect(x.c.windowLeft).toBe(left);
  x.g.paused = false;
  for (const end of [(g: any) => { g.bossDefeated = true; }, (g: any) => { g.active = false; }, (g: any) => { g.boss.alive = false; }]) {
    const y = attach(); open(y); end(y.g); y.c.update(y.g, DT);
    expect(y.c.state).toBe('ended');
    expect(y.boss.damageVeil).toBeNull();
    expect(y.c.filter(100, 0, 1)).toBe(100);
    expect(y.c.pins(y.boss)).toBe(false);
  }
  const world = {}, boss = fakeBoss(), g = fakeGame(boss, { world }), c = new EmberRearExposure(DEF, world);
  c.update(g, DT); expect(c.state).toBe('armored');
  g.world = {}; c.update(g, DT); expect(c.state).toBe('ended');
  const z = attach(); open(z); z.c.stop(); z.c.stop();
  expect(z.c.state).toBe('ended');
  z.boss.state = 'attack'; z.boss.attackSequence = 9; z.boss.signatures.age = 99; tick(z.c, z.g, 1);
  expect(z.c.state).toBe('ended');
});

test('방향 판정: 공격자 → 보스 방향과 정면의 내적 .35 이상 등 뒤, -.35 이하 정면, 그 사이 옆. 방향 없으면 옆', () => {
  const x = attach(); open(x);
  // yaw 0 이면 정면은 +z. 공격자가 뒤(-z)에 있으면 공격자 → 보스 방향은 +z 다.
  expect(x.c.sideOf(0, 1)).toBe('rear');
  expect(x.c.sideOf(0, -1)).toBe('front');
  expect(x.c.sideOf(1, 0)).toBe('side');
  expect(x.c.sideOf(0, 0)).toBe('side');
  const c35 = Math.acos(.35);
  expect(x.c.sideOf(Math.sin(c35 - 1e-6), Math.cos(c35 - 1e-6))).toBe('rear');
  expect(x.c.sideOf(Math.sin(c35 + 1e-3), Math.cos(c35 + 1e-3))).toBe('side');
  // 보스가 돌면 같은 방향의 뜻도 돈다.
  x.boss.yaw = Math.PI / 2; // 정면 +x
  expect(x.c.sideOf(1, 0)).toBe('rear');
  expect(x.c.sideOf(-1, 0)).toBe('front');
  expect(x.c.sideOf(0, 1)).toBe('side');
});

test('배율: 창 안에서만 등 뒤 2배·정면 50%·옆 1배, 창 밖·방향 없는 호출(중독 틱)은 1배이고 세지 않는다', () => {
  const x = attach();
  expect(x.c.filter(100, 0, 1)).toBe(100);
  expect(x.c.filter(100, 0, -1)).toBe(100);
  open(x);
  expect(x.c.filter(100, 0, 1)).toBe(200);
  expect(x.c.lastSide).toBe('rear');
  expect(x.c.filter(100, 0, -1)).toBe(50);
  expect(x.c.filter(100, 1, 0)).toBe(100);
  expect(x.c.filter(100)).toBe(100);
  expect([x.c.rearHits, x.c.frontHits, x.c.sideHits]).toEqual([1, 1, 1]);
  expect([x.c.rearDamage, x.c.frontDamage]).toEqual([200, 50]);
  expect(x.c.report()).toEqual({ id: 'ember_deep_rear', windows: 1, rearHits: 1, frontHits: 1, sideHits: 1, rearDamage: 200, frontDamage: 50, broken: 0 });
  expect(Object.isFrozen(x.c.report())).toBe(true);
});

test('지킴: armored 동안 시전 중인 용재 망치만 지키고, 다른 시그니처·다른 적·창이 열린 뒤·종료 뒤에는 지키지 않는다', () => {
  const x = attach();
  expect(x.c.guards(x.boss)).toBe(true);
  expect(x.c.guards({ ...x.boss })).toBe(false);
  x.boss.state = 'chase'; expect(x.c.guards(x.boss)).toBe(false);
  x.boss.state = 'attack'; x.boss.special = 'kiln_vents'; expect(x.c.guards(x.boss)).toBe(false);
  x.boss.special = 'kiln_hammer'; x.boss.signatures.plan = { key: 'kiln_vents', lastStrike: 2.75 }; expect(x.c.guards(x.boss)).toBe(false);
  x.boss.signatures.plan = { key: 'kiln_hammer', lastStrike: 2.65 };
  // 마지막 고리가 터진 프레임(창이 열리기 전 갱신 사이)에도 지킨다.
  x.boss.signatures.age = 2.65; expect(x.boss.completedAttackSequence).toBe(1); expect(x.c.guards(x.boss)).toBe(true);
  x.c.update(x.g, DT); expect(x.c.state).toBe('exposed');
  expect(x.c.guards(x.boss)).toBe(false);
  tick(x.c, x.g, DEF.window + .1); expect(x.c.state).toBe('armored');
  // 같은 망치(attackSequence)로는 다시 지키지 않는다.
  expect(x.c.guards(x.boss)).toBe(false);
  x.c.stop(); x.boss.attackSequence = 2; expect(x.c.guards(x.boss)).toBe(false);
});

// ---------------- 실제 Enemy/BossSignatures/Player 경로 ----------------
function realBossFixture() {
  const f: any = createCombatFlowFixture(runtime);
  const g: any = f.game;
  g.stage = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
  const boss: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 2.6, { id: 'cinder_chain_executor', hp: 1e12, maxHp: 1e12, atk: 1, atkCd: 0, radius: .7 * 2.3 });
  boss.signatures = new BossSignatures(boss);
  boss.runtimeSpeciesId = 'cinder_chain_executor';
  g.boss = boss;
  f.player.maxHp = f.player.hp = 1e12;
  return { f, g, boss };
}
function withFixedRandom<T>(fn: () => T): T {
  const original = Math.random; Math.random = () => .5;
  try { return fn(); } finally { Math.random = original; }
}

test('실제 Enemy.hurt: 방어 감쇄 뒤 창 안 등 뒤 2배·정면 50%·옆 1배, 부착 전·창 밖·중독 틱은 그대로', () => {
  withFixedRandom(() => {
    const { g, boss } = realBossFixture();
    const hit = (dirx: number, dirz: number) => { const before = boss.hp; boss.hurt(1000, { kb: 0, dirx, dirz }); return before - boss.hp; };
    const base = 1000 * (1 - ARMOR);
    expect(hit(0, 1)).toBeCloseTo(base, 6);
    const c = new EmberRearExposure(DEF);
    c.update(g, DT);
    expect(boss.damageVeil).toBe(c);
    boss.yaw = 0;
    expect(hit(0, 1)).toBeCloseTo(base, 6);
    boss.state = 'attack'; boss.special = 'kiln_hammer'; boss.attackSequence = 1; boss.signatures.plan = { key: 'kiln_hammer', lastStrike: 2.65 }; boss.completedAttackSequence = 1;
    c.update(g, DT);
    expect(c.state).toBe('exposed');
    expect(hit(0, 1)).toBeCloseTo(base * DEF.rear, 6);
    expect(hit(0, -1)).toBeCloseTo(base * DEF.front, 6);
    expect(hit(1, 0)).toBeCloseTo(base, 6);
    expect([c.rearHits, c.frontHits, c.sideHits]).toEqual([1, 1, 1]);
    // 중독 틱: Enemy.update 가 방향 없이 filter(raw) 를 부른다.
    boss.poison = 1; boss.poisonT = 0; boss.state = 'chase';
    const before = boss.hp; boss.update(1e-6);
    expect(before - boss.hp).toBeCloseTo(boss.maxHp * .02 + 8, 3);
    expect([c.rearHits, c.frontHits, c.sideHits]).toEqual([1, 1, 1]);
  });
});

test('실제 Enemy 경로: 용재 망치 중 치명타 강타·기절·스킬 기절은 망치를 끊지 않고 마지막 고리 뒤 창이 열린다. 창이 열린 뒤에는 경직이 그대로 걸린다', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const c = new EmberRearExposure(DEF, null);
    const playerUpdate = f.player.update;
    f.player.update = function(dt: number) { playerUpdate.call(this, dt); c.update(g, dt); };
    boss.patternTurn = 2;
    let opened = false, interrupted = false, hits = 0;
    for (let frame = 0; frame < 60 * 12 && !opened; frame++) {
      stepCombatFlow(f, DT);
      if (c.state === 'exposed') { opened = true; break; }
      if (boss.special === 'kiln_hammer' && boss.state === 'attack' && !boss.attackDone && frame % 10 === 0) {
        boss.hurt(10, { crit: true, kb: 8, stun: 1, dirx: 0, dirz: 1 });
        boss.stun = .5; // 스킬·세트 효과가 기절을 직접 쓰는 경로(Enemy.update 가 지운다)
        hits++;
      }
      if (hits > 0 && boss.state !== 'attack' && !opened) interrupted = true;
    }
    expect(hits).toBeGreaterThan(3);
    expect(interrupted).toBe(false);
    expect(opened).toBe(true);
    expect(c.broken).toBe(0);
    // 창이 열린 뒤에는 지키지 않는다: 기절이 그대로 걸린다.
    boss.hurt(10, { crit: true, kb: 8, stun: 1, dirx: 0, dirz: 1 });
    expect(boss.stun).toBeGreaterThan(0);
  });
});

test('실제 용재 망치: 마지막 고리 다음 갱신에 열리고, 창 동안 보스는 제자리·같은 방향·새 공격 없음, 창이 닫힌 뒤 다시 공격한다', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const c = new EmberRearExposure(DEF, null);
    const playerUpdate = f.player.update;
    f.player.update = function(dt: number) { playerUpdate.call(this, dt); c.update(g, dt); };
    // 1단계 패턴 ['kiln_vents','slam','kiln_hammer','fan'] 의 셋째가 용재 망치다.
    boss.patternTurn = 2;
    let strikeFrame = -1, openFrame = -1, frame = 0, yaw = 0, seq = 0, pos = new Vector3(), drift = 0, movedWhilePinned = false, closeFrame = -1, nextAttack = -1;
    for (; frame < 60 * 20; frame++) {
      const was = c.state;
      stepCombatFlow(f, DT);
      if (strikeFrame < 0 && boss.special === 'kiln_hammer' && boss.completedAttackSequence === boss.attackSequence && boss.attackSequence > 0) strikeFrame = frame;
      if (was !== 'exposed' && c.state === 'exposed') { openFrame = frame; yaw = boss.yaw; seq = boss.attackSequence; pos.copy(boss.pos); }
      if (c.state === 'exposed') {
        if (boss.yaw !== yaw || boss.attackSequence !== seq) movedWhilePinned = true;
        if (boss.state === 'chase' && boss.vel.lengthSq() > 0) movedWhilePinned = true;
        drift = Math.max(drift, boss.pos.distanceTo(pos));
      }
      if (was === 'exposed' && c.state === 'armored') closeFrame = frame;
      if (closeFrame >= 0 && boss.attackSequence > seq) { nextAttack = frame; break; }
    }
    expect(strikeFrame).toBeGreaterThanOrEqual(0);
    // 마지막 고리는 enemies.update 안에서 터지고, 컨트롤러는 다음 스텝의 경로 목표 단계(player.update 뒤)에서 연다.
    expect(openFrame).toBe(strikeFrame + 1);
    expect(movedWhilePinned).toBe(false);
    expect(drift).toBeLessThan(1e-9);
    expect(closeFrame - openFrame).toBe(Math.round(DEF.window / DT));
    expect(nextAttack).toBeGreaterThan(closeFrame);
  });
});

test('autoFlank: 정면이면 영웅 쪽 옆 경유점, 옆·뒤 바깥이면 등 뒤 점, 등 뒤 사거리 안이면 null, 원거리는 6, 창 밖·보스 사망은 null, 같은 벡터 재사용', () => {
  const x = attach(); 
  const player: any = { alive: true, pos: new Vector3(0, 0, 3), def: { ranged: false } };
  expect(x.c.autoFlank(player)).toBeNull();
  open(x);
  const r = DEF.meleeReach + DEF.sidePad;
  // 정면(+z)에서 약간 오른쪽(+x, 오른쪽 = (fz,-fx) = (1,0)).
  player.pos.set(.5, 0, 3);
  const a = x.c.autoFlank(player)!;
  expect(a.x).toBeCloseTo(r, 9); expect(a.z).toBeCloseTo(-.8, 9);
  player.pos.set(-.5, 0, 3);
  const b = x.c.autoFlank(player)!;
  expect(b).toBe(a);
  expect(b.x).toBeCloseTo(-r, 9); expect(b.z).toBeCloseTo(-.8, 9);
  // 옆 뒤쪽(along < -.5)이지만 등 뒤 원뿔 밖이면 등 뒤 점.
  player.pos.set(3, 0, -1);
  const c = x.c.autoFlank(player)!;
  expect(c.x).toBeCloseTo(0, 9); expect(c.z).toBeCloseTo(-DEF.meleeReach, 9);
  // 등 뒤 원뿔(내적 ≥ autoDot) 안, 사거리 + .6 안이면 null.
  player.pos.set(0, 0, -2.4);
  expect(x.c.autoFlank(player)).toBeNull();
  // 등 뒤 원뿔 안이지만 멀면 등 뒤 점으로 다가간다.
  player.pos.set(0, 0, -9);
  expect(x.c.autoFlank(player)!.z).toBeCloseTo(-DEF.meleeReach, 9);
  // 원거리 영웅은 rangedReach 거리의 등 뒤.
  player.def.ranged = true; player.pos.set(0, 0, -6);
  expect(x.c.autoFlank(player)).toBeNull();
  player.pos.set(0, 0, 5);
  expect(Math.hypot(x.c.autoFlank(player)!.x, 0)).toBeCloseTo(DEF.rangedReach + DEF.sidePad, 9);
  // 보스방 안쪽으로 자른다(가장자리 1.2).
  x.boss.homeRoom = { x: 0, z: 0, w: 6, h: 6 };
  player.def.ranged = false; player.pos.set(0, 0, -9);
  expect(x.c.autoFlank(player)!.z).toBeCloseTo(-1.8, 9);
  // 방 가장자리에서 잘린 옆 경유점에 이미 닿았으면 같은 경유점에 세우지 않고 등 뒤 점을 준다(b14 모의 진단: 기사 L40 시드 5).
  x.boss.homeRoom = { x: 0, z: 0, w: 4.4, h: 40 };
  player.pos.set(.5, 0, 3);
  const edge = x.c.autoFlank(player)!;
  expect(edge.x).toBeCloseTo(1, 9); expect(edge.z).toBeCloseTo(-.8, 9);
  player.pos.set(1, 0, -.6);
  const behind = x.c.autoFlank(player)!;
  expect(behind.x).toBeCloseTo(0, 9); expect(behind.z).toBeCloseTo(-DEF.meleeReach, 9);
  player.alive = false; expect(x.c.autoFlank(player)).toBeNull();
  player.alive = true; x.boss.alive = false; expect(x.c.autoFlank(player)).toBeNull();
});

test('Player.autoMove: 경로 목표가 우회 지점을 주면 그쪽으로만 움직이고 공격·스킬을 누르지 않는다. null 이면 평소 전투', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const point = new Vector3(f.player.pos.x + 5, 0, f.player.pos.z);
    g.routeObjectives.autoFlank = () => point;
    g.input.clear();
    const out = f.player.autoMove(DT);
    expect(out.x).toBeCloseTo(1, 9); expect(out.y).toBeCloseTo(0, 9);
    expect(g.input.queue).toEqual([]);
    g.routeObjectives.autoFlank = () => null;
    f.player.pos.set(boss.pos.x, 0, boss.pos.z - 2);
    f.player.autoMove(DT);
    expect(g.input.queue).toContain('attack');
    // 우회 지점에 이미 닿았으면(0.3 안) 멈춰 서지 않고 평소 전투로 넘어간다.
    g.input.clear();
    const here = new Vector3(f.player.pos.x + .1, 0, f.player.pos.z);
    g.routeObjectives.autoFlank = () => here;
    f.player.autoMove(DT);
    expect(g.input.queue).toContain('attack');
  });
});

test('냉각 밸브 연결: 심층 잿불금고만 후방 노출을 만들고 결과 보고에 rear 를 붙인다. 다른 냉각 정의의 보고 모양은 그대로', () => {
  const stage: any = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
  const route: any = createRouteObjectives(stage, buildExpeditionWorld(stage));
  expect(route).toBeInstanceOf(CoolingValves);
  expect(route.rear).toBeInstanceOf(EmberRearExposure);
  expect(route.rear.def).toBe(DEF);
  expect(route.autoFlank({ alive: true, pos: new Vector3(), def: {} })).toBeNull();
  const report = route.finish(false);
  expect(Object.keys(report)).toEqual(['id', 'label', 'complete', 'progress', 'target', 'rooms', 'overheatHits', 'rear']);
  expect(report.rear).toEqual({ id: 'ember_deep_rear', windows: 0, rearHits: 0, frontHits: 0, sideHits: 0, rearDamage: 0, frontDamage: 0, broken: 0 });
  expect(route.autoFlank({ alive: true, pos: new Vector3(), def: {} })).toBeNull();
  for (const [routeId, depth] of [['ashforge_catacomb', 'deep'], ['ashforge_catacomb', 'standard'], ['cinder_tide_lock', 'standard'], ['cinder_tide_lock', 'deep']]) {
    const s: any = buildExpeditionStage('dungeon', routeId, null, { depth });
    const r: any = createRouteObjectives(s, buildExpeditionWorld(s));
    expect(r).toBeInstanceOf(CoolingValves);
    expect(r.rear).toBeNull();
    expect(Object.keys(r.finish(true))).toEqual(['id', 'label', 'complete', 'progress', 'target', 'rooms', 'overheatHits']);
  }
  // stop 은 후방 노출도 끝낸다.
  const s2: any = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
  const r2: any = createRouteObjectives(s2, buildExpeditionWorld(s2));
  r2.stop(); r2.stop();
  expect(r2.rear.state).toBe('ended');
  // 파티·균열·전술 공략·일반 잿불금고는 경로 목표 자체가 없다.
  expect(routeObjectiveForStage(buildExpeditionStage('dungeon', 'ember_vault', null))).toBeNull();
});

test('냉각 밸브 update: 밸브 규칙이 조기 반환(보스 처치 전 모든 밸브 완료·보스방)해도 후방 노출이 먼저 갱신된다', () => {
  const stage: any = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
  const world: any = buildExpeditionWorld(stage);
  const route: any = createRouteObjectives(stage, world);
  const boss = fakeBoss();
  const g: any = fakeGame(boss, { world, player: { alive: false, pos: new Vector3() }, enemies: [], pending: [], fx: { damage() {} } });
  route.update(g, DT);
  expect(route.rear.state).toBe('armored');
  boss.signatures.age = 2.65; route.update(g, DT);
  expect(route.rear.state).toBe('exposed');
});

test('전술 문구: 심층 잿불금고 보스 전술 뒤에 정의 값으로 만든 후방 문장이 붙고, 전술 공략·일반 잿불금고에는 없다', () => {
  const deep: any = EXPEDITION_DEPTHS.find((d: any) => d.id === 'ember_vault' && d.depth === 'deep');
  const sentence = '용재 망치의 마지막 고리가 터지면 ' + DEF.window + '초 동안 집행자가 제자리에 묶입니다. 그동안 등 뒤에서 치면 피해 ' + DEF.rear
    + '배, 정면은 사슬 갑주에 막혀 ' + Math.round(DEF.front * 100) + '%입니다.';
  expect(deep.tactic.endsWith(' ' + sentence)).toBe(true);
  const stage: any = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
  expect(stage.encounter.tactic).toContain(sentence);
  expect(deep.conquestTactic).not.toMatch(/등 뒤|사슬 갑주/);
  const standard: any = buildExpeditionStage('dungeon', 'ember_vault', null);
  expect(standard.encounter.tactic).not.toMatch(/등 뒤|사슬 갑주/);
});

test('보스전 AUTO 모의(실제 Player/Enemy/BossSignatures/군중 접촉, 1/60초): 등 뒤 타격이 없는 창은 열린 순간 채널 스킬·영웅 쓰러짐·창 도중 보스 처치뿐이고, 망치는 끊기지 않으며 창 안 새 공격은 0, 끔이면 창 없음', () => {
  const cases: Array<[string, number]> = [['knight', 1], ['knight', 2], ['knight', 5], ['mage', 1], ['mage', 2]];
  for (const [hero, seed] of cases) {
    const on: any = runBossSim(runtime, EmberRearExposure, DEF, { hero, seed, mode: 'on', heroLevel: 40, maxSeconds: 240 });
    expect(on.windows).toBeGreaterThan(0);
    expect(on.attacksInWindow).toBe(0);
    expect(on.windowLog.length).toBe(on.windows);
    // 채널 스킬(state 'skill')은 영웅을 묶어 우회할 수 없다(b14 진단: 법사 시드 2, 창이 열릴 때 3초 채널 중 정면 7타). 그 밖의 창은 모두 등 뒤 타격이 있어야 한다.
    // 창 도중 보스가 쓰러진 마지막 창(b14 진단: 기사 시드 5)도 등 뒤로 갈 시간이 없었던 창이다.
    for (const w of on.windowLog) if (!w.rear && !w.bossDied) expect(['skill', 'dead']).toContain(w.heroState);
    expect(on.broken).toBe(0);
    expect(on.rearHits).toBeGreaterThan(on.frontHits);
    const off: any = runBossSim(runtime, EmberRearExposure, DEF, { hero, seed, mode: 'off', heroLevel: 40, maxSeconds: 240 });
    expect(off.windows).toBe(0);
  }
});
