import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { audio } from '../src/engine/audio.js';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives, RouteObjectives } from '../src/game/route-objectives.js';
import { BellfallDeepBells } from '../src/game/bellfall-deep-bells.js';
import { BellfallDeepCounter } from '../src/game/bellfall-deep-counter.js';
import { BossSignatures, planBossSignature } from '../src/game/boss-signatures.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();
const DEF = ROUTE_OBJECTIVES.bellfall_deep.counter;
const DT = 1 / 60;
const noop = () => {};
const ARMOR = 0.23; // glass_hour_sovereign 의 방어 감쇄. 테스트는 정의 값을 독립 상수로 다시 적어 둔다.

const sounds: number[] = [];
let restores: Array<() => void> = [];
beforeEach(() => {
  sounds.length = 0;
  restores = (['ting', 'magic', 'boom'] as const).map(key => {
    const spy = spyOn(audio as any, key).mockImplementation(() => { sounds.push(1); });
    return () => spy.mockRestore();
  });
});
afterEach(() => { for (const restore of restores) restore(); });

// ---------------- 가짜 보스: 시그니처 시계를 직접 돌려 규칙만 본다 ----------------
function fakeBoss(extra: any = {}) {
  return { alive: true, spawning: false, isBoss: true, state: 'attack', special: 'bell_toll', attackSequence: 1, atkCd: 0,
    damageVeil: null, signatures: { plan: { key: 'bell_toll', lastStrike: 3.05 }, age: 0 }, ...extra };
}
function fakeGame(boss: any, extra: any = {}) {
  const toasts: string[] = [];
  return { active: true, paused: false, bossDefeated: false, boss, stage: { encounter: { enemyId: 'glass_hour_sovereign' } },
    ui: { toast: (t: string) => toasts.push(t) }, toasts, ...extra };
}
/** 시그니처 시계를 seconds 만큼 1/60 단위로 올리며 매 프레임 counter.update. */
function tick(c: BellfallDeepCounter, g: any, seconds: number, dt = DT) {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) { g.boss.signatures.age += dt; c.update(g, dt); }
}
function attach(def: any = DEF) {
  const boss = fakeBoss(), g = fakeGame(boss), c = new BellfallDeepCounter(def);
  c.update(g, DT);
  expect(c.state).toBe('veiled');
  return { boss, g, c };
}
/** 마지막 울림 프레임까지 진행해 창을 연다. */
function open(x: ReturnType<typeof attach>) {
  x.boss.signatures.age = x.boss.signatures.plan.lastStrike;
  x.c.update(x.g, DT);
  expect(x.c.state).toBe('open');
}

// ---------------- 실제 Enemy/BossSignatures 경로 ----------------
function realBossFixture() {
  const f = createCombatFlowFixture(runtime);
  const g: any = f.game;
  g.stage = buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' });
  const boss: any = spawnCombatFlowEnemy(f, f.room.x + 2, f.room.z, { id: 'glass_hour_sovereign', hp: 1e12, maxHp: 1e12, atk: 1, atkCd: 0 });
  boss.signatures = new BossSignatures(boss);
  g.boss = boss;
  f.player.maxHp = f.player.hp = 1e12;
  return { f, g, boss };
}
function withFixedRandom<T>(fn: () => T): T {
  const original = Math.random; Math.random = () => .5;
  try { return fn(); } finally { Math.random = original; }
}

test('실제 Enemy.hurt: 같은 원피해에 방어 감쇄 뒤 장막 veil배·반격 창 open배, 카운터 없는 적은 불변', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const other: any = spawnCombatFlowEnemy(f, f.room.x - 3, f.room.z, { id: 'glass_hour_sovereign', hp: 1e12, maxHp: 1e12 });
    const minion: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 3, { id: 'skel_minion', hp: 1e12, maxHp: 1e12 });
    const hit = (e: any, raw: number) => { const before = e.hp; e.hurt(raw, { kb: 2 }); return before - e.hp; };
    const base = 1000 * (1 - ARMOR);

    expect(hit(boss, 1000)).toBeCloseTo(base, 6); // 카운터 부착 전
    const c = new BellfallDeepCounter(DEF);
    c.update(g, DT);
    expect(boss.damageVeil).toBe(c);
    expect(hit(boss, 1000)).toBeCloseTo(base * DEF.veil, 6);
    expect(c.veiledHits).toBe(1);
    expect(c.veiledDamage).toBeCloseTo(base * DEF.veil, 6);

    // 같은 보스 정의라도 장막이 안 붙은 개체(일반 종락·공명목·유리 정원 보스)는 그대로 맞는다.
    expect(other.damageVeil ?? null).toBeNull();
    expect(hit(other, 1000)).toBeCloseTo(base, 6);
    expect(hit(minion, 1000)).toBeCloseTo(1000 * (1 - (minion.def.armor || 0)), 6);

    boss.state = 'attack'; boss.special = 'bell_toll'; boss.attackSequence = 1; boss.signatures.plan = { key: 'bell_toll', lastStrike: 3.05 }; boss.signatures.age = 3.05;
    c.update(g, DT);
    expect(c.state).toBe('open');
    expect(hit(boss, 1000)).toBeCloseTo(base * DEF.open, 6);
    expect(c.openHits).toBe(1);
    expect(c.openDamage).toBeCloseTo(base * DEF.open, 6);
    expect(c.veiledHits).toBe(1); // 열림 중 피해는 장막 집계에 섞이지 않는다.
  });
});

test('실제 삼중 조종: 마지막 고리 프레임 다음 update 에서 열리고 그 전에는 열리지 않으며, 열린 동안 새 공격이 없다', () => {
  const run = (withCounter: boolean) => withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const c = new BellfallDeepCounter(DEF);
    if (withCounter) c.update(g, DT);
    let lastStrike = -1, struckFrame = -1, openFrame = -1, windowEnd = -1, seqAtOpen = 0;
    const log = { openBeforeStrike: false, openedOnNextUpdate: false, atkCdBelowWindow: false, framesOpen: 0 };
    for (let frame = 0; frame < 60 * 14; frame++) {
      if (withCounter) {
        c.update(g, DT);
        if (c.state === 'open') {
          if (openFrame < 0) { openFrame = frame; seqAtOpen = boss.attackSequence; log.openedOnNextUpdate = struckFrame === frame - 1; log.openBeforeStrike = struckFrame < 0; }
          log.framesOpen++;
          if (boss.atkCd + 1e-9 < c.windowLeft) log.atkCdBelowWindow = true;
        } else if (openFrame >= 0 && windowEnd < 0) windowEnd = frame;
      }
      stepCombatFlow(f, DT);
      const plan = boss.signatures.plan;
      if (plan && lastStrike < 0) lastStrike = plan.lastStrike;
      if (struckFrame < 0 && plan && boss.signatures.age + 1e-9 >= plan.lastStrike) struckFrame = frame;
    }
    return { c, boss, log, lastStrike, struckFrame, openFrame, windowEnd, seqAtOpen };
  });

  const on = run(true);
  // 실제 planBossSignature 의 lastStrike(1.35 + 2 × 0.85)를 그대로 쓴다.
  const plan = planBossSignature('bell_toll', { origin: { x: 0, z: 0 }, target: { x: 3, z: 0 } })!;
  expect(on.lastStrike).toBeCloseTo(plan.lastStrike, 9);
  expect(on.struckFrame).toBeGreaterThan(0);
  expect(on.openFrame).toBe(on.struckFrame + 1); // 마지막 고리 프레임의 바로 다음 컨트롤러 update
  expect(on.log.openBeforeStrike).toBe(false);
  expect(on.log.openedOnNextUpdate).toBe(true);
  expect(on.log.atkCdBelowWindow).toBe(false);
  expect(on.c.windows).toBeGreaterThanOrEqual(1);
  expect(Math.abs(on.log.framesOpen / 60 - DEF.window)).toBeLessThanOrEqual(DT * 1.01 + (on.c.windows - 1) * DEF.window);
  // 첫 창이 닫히기까지 보스는 새 공격(attackSequence 증가)을 시작하지 않았다.
  const windowFrames = Math.round(DEF.window / DT);
  const probe = withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const c = new BellfallDeepCounter(DEF);
    c.update(g, DT);
    // 창이 열려 있는 모든 프레임의 스텝(마지막 프레임 포함)에서 attackSequence 가 변하지 않아야 한다.
    let seq = 0, openAt = -1, seqAfter = 0;
    for (let frame = 0; frame < 60 * 14 && (openAt < 0 || frame < openAt + windowFrames + 2); frame++) {
      c.update(g, DT);
      if (openAt < 0 && c.state === 'open') { openAt = frame; seq = boss.attackSequence; }
      const inside = c.state === 'open';
      stepCombatFlow(f, DT);
      if (inside) seqAfter = boss.attackSequence;
    }
    return { seq, seqAfter, openAt, finalSeq: boss.attackSequence };
  });
  expect(probe.openAt).toBeGreaterThan(0);
  expect(probe.seqAfter).toBe(probe.seq);
  // 창이 닫힌 직후에는 보스가 다시 공격을 시작한다(장막이 공격을 영구히 막지 않는다).
  expect(probe.finalSeq).toBe(probe.seq + 1);

  // 대조군: 카운터가 없으면 같은 시간 안에 보스가 다음 공격을 시작한다(그래서 위 검사가 의미가 있다).
  const off = run(false);
  expect(off.boss.attackSequence).toBeGreaterThan(on.seqAtOpen);
});

test('창 길이는 1/60 스텝과 dt 한 번 모두 3.5초(±1/60)이고 시계는 게임 시간만 쓴다', () => {
  const stepped = attach();
  open(stepped);
  let frames = 0;
  while (stepped.c.state === 'open' && frames < 1000) { stepped.c.update(stepped.g, DT); frames++; }
  expect(Math.abs(frames * DT - DEF.window)).toBeLessThanOrEqual(DT + 1e-9);
  expect(stepped.c.windowLeft).toBe(0);

  const big = attach();
  open(big);
  expect(big.c.windowLeft).toBe(DEF.window);
  big.c.update(big.g, DEF.window - DT * 2);
  expect(big.c.state).toBe('open');
  expect(big.c.windowLeft).toBeCloseTo(DT * 2, 9);
  big.c.update(big.g, DT * 2);
  expect(big.c.state).toBe('veiled');

  const single = attach();
  open(single);
  single.c.update(single.g, DEF.window);
  expect(single.c.state).toBe('veiled');
  expect(single.c.windows).toBe(1);
});

test('마지막 울림 전에는 열리지 않고, 열리는 순간 토스트·소리가 한 번씩 나온다', () => {
  const { boss, g, c } = attach();
  boss.signatures.age = 3.04;
  c.update(g, DT);
  expect(c.state).toBe('veiled');
  expect(c.windows).toBe(0);
  expect(sounds.length).toBe(0);
  boss.signatures.age = 3.05;
  c.update(g, DT);
  expect(c.state).toBe('open');
  expect(c.windows).toBe(1);
  expect(sounds.length).toBe(1);
  expect(g.toasts.filter((t: string) => t.includes('장막이 걷혔다'))).toEqual(['장막이 걷혔다 · 3.5초 반격']);
  expect(g.toasts.filter((t: string) => t.startsWith('합창 장막'))).toHaveLength(1);
});

test('열림 중 보스 atkCd 는 windowLeft 이상으로 유지되고 원래 대기보다 짧아지지 않는다', () => {
  const { boss, g, c } = attach();
  boss.atkCd = 0.4;
  open({ boss, g, c });
  expect(boss.atkCd).toBeGreaterThanOrEqual(DEF.window);
  expect(boss.atkCd).toBeLessThanOrEqual(DEF.window + DT + 1e-9); // 같은 프레임의 대기 감소 1스텝만큼만 더 붙잡는다
  for (let i = 0; i < 100; i++) {
    boss.atkCd = Math.max(0, boss.atkCd - DT); // Enemy.update 의 대기 감소
    c.update(g, DT);
    expect(boss.atkCd).toBeGreaterThanOrEqual(c.windowLeft - 1e-9);
  }
  // 원래 대기가 더 길면 줄이지 않는다.
  boss.atkCd = 9;
  c.update(g, DT);
  expect(boss.atkCd).toBe(9);
  // 창이 닫히는 프레임에도 atkCd 를 건드리지 않는다.
  boss.atkCd = 0.2;
  c.update(g, DEF.window);
  expect(c.state).toBe('veiled');
  expect(boss.atkCd).toBe(0.2);
});

test('보스가 대기를 프레임마다 dt 만큼 줄여도 창이 열려 있는 동안에는 대기가 0 이하가 되지 않는다', () => {
  const { boss, g, c } = attach();
  boss.atkCd = 0;
  open({ boss, g, c });
  let openFrames = 0;
  while (c.state === 'open') {
    boss.atkCd -= DT; // Enemy.update chase 분기: 대기 감소 뒤 atkCd <= 0 이면 새 공격
    expect(boss.atkCd).toBeGreaterThan(DT / 2); // 부동소수점 오차로 우연히 0 을 넘는 경우를 배제하려고 반 스텝 여유를 둔다
    openFrames++;
    c.update(g, DT);
    if (openFrames > 1000) throw new Error('창이 닫히지 않습니다');
  }
  expect(Math.abs(openFrames * DT - DEF.window)).toBeLessThanOrEqual(DT + 1e-9);
  // 창이 닫힌 첫 프레임에는 보스가 다시 공격을 시작할 수 있다.
  boss.atkCd -= DT;
  expect(boss.atkCd).toBeLessThanOrEqual(1e-9);
});

test('끊긴 조종은 열리지 않고 broken 이 늘며, 다음 조종은 정상적으로 열린다', () => {
  const { boss, g, c } = attach();
  tick(c, g, 1.2);
  boss.signatures.plan = null; boss.state = 'hurt'; // 강타·기절로 BossSignatures.clear + 상태 변경
  tick(c, g, 0.1);
  expect(c.state).toBe('veiled');
  expect(c.broken).toBe(1);
  expect(c.windows).toBe(0);
  tick(c, g, 5);
  expect(c.broken).toBe(1);
  expect(c.windows).toBe(0);
  // 다음 조종(attackSequence 2)을 끝까지 맞이하면 열린다.
  boss.state = 'attack'; boss.attackSequence = 2; boss.signatures.plan = { key: 'bell_toll', lastStrike: 3.05 }; boss.signatures.age = 0;
  tick(c, g, 3.1);
  expect(c.state).toBe('open');
  expect(c.windows).toBe(1);
  expect(c.broken).toBe(1);
});

test('실제 보스를 강타(kb 8)로 끊으면 그 조종에서는 열리지 않는다', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const c = new BellfallDeepCounter(DEF);
    c.update(g, DT);
    for (let frame = 0; frame < 300 && !(boss.state === 'attack' && boss.signatures.plan); frame++) { c.update(g, DT); stepCombatFlow(f, DT); }
    expect(boss.special).toBe('bell_toll');
    const seq = boss.attackSequence;
    for (let i = 0; i < 20; i++) { c.update(g, DT); stepCombatFlow(f, DT); }
    boss.hurt(10, { kb: 8 });
    expect(boss.state).toBe('hurt');
    for (let i = 0; i < 10; i++) { c.update(g, DT); stepCombatFlow(f, DT); }
    expect(c.broken).toBe(1);
    expect(c.windows).toBe(0);
    expect(c.state).toBe('veiled');
    expect(boss.attackSequence).toBe(seq);
  });
});

test('열린 뒤 조종이 끊겨도 창은 유지된다', () => {
  const x = attach();
  open(x);
  x.boss.signatures.plan = null; x.boss.state = 'hurt';
  tick(x.c, x.g, 1);
  expect(x.c.state).toBe('open');
  expect(x.c.windowLeft).toBeCloseTo(DEF.window - 1, 6);
  expect(x.c.broken).toBe(0);
  tick(x.c, x.g, 2.6);
  expect(x.c.state).toBe('veiled');
});

test('같은 attackSequence 로는 두 번 열리지 않는다', () => {
  const x = attach();
  open(x);
  x.c.update(x.g, DEF.window);
  expect(x.c.state).toBe('veiled');
  tick(x.c, x.g, 2); // 같은 조종이 아직 attack 상태로 남아 있다
  expect(x.c.state).toBe('veiled');
  expect(x.c.windows).toBe(1);
  expect(x.c.broken).toBe(0);
  x.boss.attackSequence = 2; x.boss.signatures.age = 0;
  tick(x.c, x.g, 3.1);
  expect(x.c.state).toBe('open');
  expect(x.c.windows).toBe(2);
});

test('일시정지 중에는 창 시계와 감시가 모두 멈춘다', () => {
  const x = attach();
  open(x);
  tick(x.c, x.g, 1);
  const left = x.c.windowLeft;
  x.g.paused = true;
  for (let i = 0; i < 300; i++) x.c.update(x.g, DT);
  expect(x.c.windowLeft).toBe(left);
  expect(x.c.state).toBe('open');
  x.g.paused = false;
  x.c.update(x.g, DT);
  expect(x.c.windowLeft).toBeCloseTo(left - DT, 9);

  // 일시정지 중에는 보스 처치 같은 종료 사유도 재개 때까지 미룬다.
  const y = attach();
  y.g.paused = true; y.g.bossDefeated = true;
  y.c.update(y.g, DT);
  expect(y.c.state).toBe('veiled');
  y.g.paused = false;
  y.c.update(y.g, DT);
  expect(y.c.state).toBe('ended');
});

test('부착 조건: 살아 있고 등장 중이 아닌 심층 보스에만 붙는다', () => {
  const spawning = fakeBoss({ spawning: true }), g = fakeGame(spawning), c = new BellfallDeepCounter(DEF);
  c.update(g, DT);
  expect(c.state).toBe('idle');
  expect(spawning.damageVeil).toBeNull();
  spawning.spawning = false;
  const none = fakeGame(null);
  c.update(none, DT);
  expect(c.state).toBe('idle');
  const other = fakeGame(fakeBoss(), { stage: { encounter: { enemyId: 'cinder_chain_executor' } } });
  c.update(other, DT);
  expect(c.state).toBe('idle');
  const dead = fakeGame(fakeBoss({ alive: false }));
  c.update(dead, DT);
  expect(c.state).toBe('idle');
  const noSignature = fakeGame(fakeBoss({ signatures: null }));
  c.update(noSignature, DT);
  expect(c.state).toBe('idle');
  expect(c.boss).toBeNull();
  c.update(g, DT);
  expect(c.state).toBe('veiled');
  expect(c.boss).toBe(spawning);
  expect(spawning.damageVeil).toBe(c);
  expect(c.damageMul()).toBe(DEF.veil);
});

test('보스 처치·stop·전투 종료·다른 월드에서 ended 가 되고 장막이 풀린다', () => {
  const killed = attach();
  killed.g.bossDefeated = true;
  killed.c.update(killed.g, DT);
  expect(killed.c.state).toBe('ended');
  expect(killed.boss.damageVeil).toBeNull();
  expect(killed.c.damageMul()).toBe(1);
  expect(killed.c.filter(100)).toBe(100);
  expect(killed.c.veiledHits).toBe(0);

  const died = attach();
  died.boss.alive = false;
  died.c.update(died.g, DT);
  expect(died.c.state).toBe('ended');
  expect(died.boss.damageVeil).toBeNull();

  const stopped = attach();
  open(stopped);
  stopped.c.stop();
  expect(stopped.c.state).toBe('ended');
  expect(stopped.c.windowLeft).toBe(0);
  expect(stopped.boss.damageVeil).toBeNull();
  stopped.c.stop();
  tick(stopped.c, stopped.g, 5);
  expect(stopped.c.state).toBe('ended'); // ended 는 되돌아오지 않는다
  expect(stopped.c.windows).toBe(1);

  const over = attach();
  over.g.active = false;
  over.c.update(over.g, DT);
  expect(over.c.state).toBe('ended');

  const world = {}, moved = new BellfallDeepCounter(DEF, world), boss = fakeBoss(), g = fakeGame(boss, { world });
  moved.update(g, DT);
  expect(moved.state).toBe('veiled');
  g.world = {};
  moved.update(g, DT);
  expect(moved.state).toBe('ended');
  expect(boss.damageVeil).toBeNull();
});

test('update·filter 는 보스 시그니처 계획과 부착 대상을 바꾸지 않고 읽기 상태만 갱신한다', () => {
  const x = attach();
  const plan = x.boss.signatures.plan, keys = Object.keys(x.c).join();
  for (let i = 0; i < 1200; i++) {
    x.boss.signatures.age += DT;
    x.c.update(x.g, DT);
    expect(typeof x.c.filter(10)).toBe('number');
  }
  expect(x.boss.signatures.plan).toBe(plan);
  expect(x.c.boss).toBe(x.boss);
  expect(Object.keys(x.c).join()).toBe(keys);
  expect(x.g.toasts.length).toBeLessThanOrEqual(3); // 부착 1 + 열림 1(같은 조종은 한 번만)
});

// ---------------- 종문 컨트롤러 연결과 다른 던전 ----------------
test('BellfallDeepBells 가 카운터를 만들고 종문 조기 반환과 무관하게 갱신하며 finish 에 반격 창 횟수를 싣는다', async () => {
  const stage = buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' });
  const world = buildExpeditionWorld(stage);
  const route = createRouteObjectives(stage, world) as BellfallDeepBells;
  expect(route).toBeInstanceOf(BellfallDeepBells);
  const counter = route.counter!;
  expect(counter).toBeInstanceOf(BellfallDeepCounter);
  expect(counter.def).toBe(ROUTE_OBJECTIVES.bellfall_deep.counter);

  const boss = fakeBoss(), g: any = fakeGame(boss, { world, player: { alive: true, maxHp: 100, pos: { x: world.startRoom.x, y: 0, z: world.startRoom.z }, hurt: noop },
    enemies: [], pending: [], fx: { castCircle: noop }, autoTarget: null });
  g.ui.setObjective = noop;
  route.update(g, DT);
  expect(counter.state).toBe('veiled');
  boss.signatures.age = 3.05;
  route.update(g, DT);
  expect(counter.state).toBe('open');
  g.paused = true; // 종문 쪽은 일시정지로 조기 반환하지만 카운터도 시계를 멈춘다
  route.update(g, DT);
  expect(counter.windowLeft).toBe(DEF.window);
  g.paused = false;
  g.bossDefeated = true; // 종문 쪽 조기 반환 조건에서도 카운터는 먼저 끝낸다
  route.update(g, DT);
  expect(counter.state).toBe('ended');
  expect(boss.damageVeil).toBeNull();
  const report = route.finish(true) as any;
  expect(report.counterWindows).toBe(1);
  expect(report.id).toBe('bellfall_deep_bells');
  expect(report.discords).toBe(0);

  const second = createRouteObjectives(stage, buildExpeditionWorld(stage)) as BellfallDeepBells;
  const b2 = fakeBoss(), g2: any = fakeGame(b2, { world: second.world });
  second.counter!.update(g2, DT);
  expect(b2.damageVeil).toBe(second.counter);
  second.stop();
  expect(second.counter!.state).toBe('ended');
  expect(b2.damageVeil).toBeNull();
  expect((second.finish(false) as any).counterWindows).toBe(0);
});

test('심층이 아닌 종락·공명목 수목원·유리 정원 심층·파티·균열은 카운터가 없고 보스 피해가 그대로다', () => {
  const standard = buildExpeditionStage('dungeon', 'bellfall_crypt', null);
  const hollow = buildExpeditionStage('dungeon', 'hollowbell_arboretum', null);
  const garden = buildExpeditionStage('dungeon', 'glass_garden', null, { depth: 'deep' });
  const party = { ...buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' }), party: { id: 'p' } };
  const rift = { ...buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' }), riftId: 'r' };
  for (const stage of [standard, hollow, garden, party, rift]) {
    const def: any = routeObjectiveForStage(stage);
    expect(def?.counter).toBeUndefined();
  }
  expect(routeObjectiveForStage(party)).toBeNull();
  expect(routeObjectiveForStage(rift)).toBeNull();
  expect(createRouteObjectives(garden, buildExpeditionWorld(garden))).toBeNull();
  const normal = createRouteObjectives(standard, buildExpeditionWorld(standard)) as any;
  expect(normal).toBeInstanceOf(RouteObjectives);
  expect(normal.counter).toBeUndefined();

  // 장막이 없으면 같은 보스 정의도 방어 감쇄만 받는다(실제 Enemy.hurt).
  const f = createCombatFlowFixture(runtime);
  for (const stage of [standard, hollow, garden]) {
    (f.game as any).stage = stage;
    const boss: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z, { id: 'glass_hour_sovereign', hp: 1e12, maxHp: 1e12 });
    const before = boss.hp;
    boss.hurt(1000, { kb: 2 });
    expect(before - boss.hp).toBeCloseTo(1000 * (1 - ARMOR), 6);
    expect(boss.damageVeil ?? null).toBeNull();
  }
});

test('정의가 올바르지 않으면 생성을 거부한다', () => {
  expect(() => new BellfallDeepCounter({ ...DEF, window: 0 })).toThrow(RangeError);
  expect(() => new BellfallDeepCounter({ ...DEF, veil: 0 })).toThrow(RangeError);
  expect(() => new BellfallDeepCounter(null as any)).toThrow(RangeError);
});
