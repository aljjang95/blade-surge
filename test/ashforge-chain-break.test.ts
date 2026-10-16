import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Vector3 } from 'three';
import { audio } from '../src/engine/audio.js';
import { ROUTE_OBJECTIVES, routeObjectiveForStage } from '../src/data/route-objectives.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CoolingValves } from '../src/game/cooling-valves.js';
import { AshforgeChainBreak } from '../src/game/ashforge-chain-break.js';
import { BossSignatures } from '../src/game/boss-signatures.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';
import { runChainSim, summarize } from '../tools/ashforge-deep-boss-sim.mjs';

// 재벼림 심층 거수 사슬 끊기(BUNDLE-15) 규칙 테스트. 계약은 BUNDLE-15-PLAN.md 3절(3.6 우선)이다.
const runtime: any = await loadCombatFlowRuntime();
runtime.BossSignatures = BossSignatures;
const DEF = ROUTE_OBJECTIVES.ashforge_deep.chains as any;
const DT = 1 / 60;
const ARMOR = 0.29; // ash_colossus 의 방어 감쇄. 정의 값을 독립 상수로 다시 적어 둔다.
const ROOM = { x: 0, z: 0, w: 28, h: 28 };

let restores: Array<() => void> = [];
beforeEach(() => {
  restores = (['ting', 'magic', 'boom', 'charge', 'play', 'whoosh'] as const).map(key => {
    const spy = spyOn(audio as any, key).mockImplementation(() => {});
    return () => spy.mockRestore();
  });
});
afterEach(() => { for (const restore of restores) restore(); });

// ---------------- 가짜 보스·영웅: 시그니처 시계를 직접 돌려 규칙만 본다 ----------------
function fakeBoss(extra: any = {}) {
  const boss: any = { alive: true, spawning: false, isBoss: true, state: 'chase', special: null, attackSequence: 0, atkCd: 0, yaw: 0,
    pos: new Vector3(4, 0, 0), damageVeil: null, runtimeSpeciesId: 'ash_colossus', homeRoom: ROOM, radius: .7 * 2.45, def: { range: 3.6, scale: 2.45 },
    signatures: { plan: null, age: 0 }, ...extra };
  let completed = 0;
  Object.defineProperty(boss, 'completedAttackSequence', { configurable: true, get() {
    const plan = boss.signatures?.plan;
    if (boss.state === 'attack' && plan && boss.signatures.age >= plan.lastStrike) completed = boss.attackSequence;
    return completed;
  } });
  return boss;
}
function fakePlayer(x = 10, z = 8) { return { alive: true, hp: 1000, state: 'idle', pos: new Vector3(x, 0, z), def: {} }; }
function fakeGame(boss: any, extra: any = {}) {
  const toasts: string[] = [];
  const g: any = { active: true, paused: false, bossDefeated: false, boss, world: null as any, stage: { encounter: { enemyId: 'ash_colossus' } },
    ui: { toast: (t: string) => toasts.push(t) }, toasts, player: fakePlayer(), ...extra };
  boss.game = g;
  return g;
}
function tick(c: AshforgeChainBreak, g: any, seconds: number, dt = DT) {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) { if (g.boss.signatures) g.boss.signatures.age += dt; c.update(g, dt); }
}
function attach(def: any = DEF, bossExtra: any = {}, gameExtra: any = {}) {
  const boss = fakeBoss(bossExtra), g = fakeGame(boss, gameExtra), c = new AshforgeChainBreak(def);
  c.update(g, DT);
  return { boss, g, c };
}
/** 용재 망치 시전을 시작한다(착탄점 x). 다음 갱신에서 끌기가 정해진다. */
function cast(x: ReturnType<typeof attach>, impactX = 6, lastStrike = 2.65) {
  x.boss.state = 'attack'; x.boss.special = 'kiln_hammer'; x.boss.attackSequence++;
  x.boss.signatures.plan = { key: 'kiln_hammer', lastStrike, events: [{ x: impactX, z: 1 }] }; x.boss.signatures.age = 0;
  x.c.update(x.g, DT);
}
/** 마지막 고리를 터뜨리고 창을 연다. */
function open(x: ReturnType<typeof attach>, impactX = 6) {
  cast(x, impactX);
  x.boss.signatures.age = x.boss.signatures.plan.lastStrike;
  x.c.update(x.g, DT);
  expect(x.c.state).toBe('open');
  x.boss.state = 'chase'; x.boss.special = null;
}
function standOnPillar(x: ReturnType<typeof attach>) { x.g.player.pos.set(x.c.pillar.x, 0, x.c.pillar.z); x.g.player.state = 'idle'; }

test('정의: 거수·용재 망치·사슬 3개·창 5초·버티기 1.2초·반경 1.6·휘청 5초·2배·약화 10%, 재벼림 심층에만 있다', () => {
  expect(DEF).toEqual({ id: 'ashforge_deep_chains', boss: 'ash_colossus', signature: 'kiln_hammer', count: 3, window: 5, hold: 1.2, radius: 1.6,
    pillarOffset: 8.4, anchorMargin: 1.2, exposed: 5, exposedMult: 2, weaken: .1 });
  expect(Object.isFrozen(DEF)).toBe(true);
  for (const [key, value] of Object.entries(ROUTE_OBJECTIVES)) if (key !== 'ashforge_deep') expect((value as any).chains).toBeUndefined();
  for (const bad of [null, { ...DEF, count: 0 }, { ...DEF, count: 1.5 }, { ...DEF, window: 0 }, { ...DEF, hold: 0 }, { ...DEF, hold: 5 }, { ...DEF, radius: 0 },
    { ...DEF, pillarOffset: 0 }, { ...DEF, anchorMargin: -1 }, { ...DEF, exposed: 0 }, { ...DEF, exposedMult: 1 }, { ...DEF, weaken: -.1 }, { ...DEF, boss: 1 }, { ...DEF, signature: null }]) {
    expect(() => new AshforgeChainBreak(bad as any)).toThrow(RangeError);
  }
});

test('부착: 거수 보스가 나타나면 chained·사슬 3개·토스트 1회, 다른 보스·시그니처 없는 보스·등장 중에는 붙지 않는다', () => {
  const x = attach();
  expect(x.c.state).toBe('chained');
  expect(x.boss.damageVeil).toBe(x.c);
  expect([x.c.count, x.c.chainsLeft, x.c.cuts]).toEqual([3, 3, 0]);
  expect(x.g.toasts).toEqual(['거수의 사슬 3개 · 망치가 끄는 반대편 기둥에서 버티세요']);
  tick(x.c, x.g, 1);
  expect(x.g.toasts.length).toBe(1);
  expect(x.c.pulling).toBe(false); expect(x.c.pullSide).toBe(0);
  for (const extra of [{ runtimeSpeciesId: 'cinder_chain_executor' }, { signatures: null }, { spawning: true }, { isBoss: false }]) {
    const y = attach(DEF, extra);
    expect(y.c.state).toBe('idle');
    expect(y.boss.damageVeil).toBeNull();
  }
});

test('끌기·기둥: 망치 착탄점 쪽 벽으로 사슬이 끌리고 기둥은 방 중심 반대편 8.4. 중심 근처면 창 번호 짝홀로 정한다', () => {
  const x = attach();
  cast(x, 6);
  expect(x.c.pulling).toBe(true); expect(x.c.pullSide).toBe(1);
  expect([x.c.pillar.x, x.c.pillar.z]).toEqual([-8.4, 0]);
  expect(x.c.anchor.x).toBeCloseTo(14 - 1.2, 9); expect(x.c.anchor.z).toBe(0);
  // 끌기 중에는 기둥이 닫혀 있어 버텨도 세지 않는다.
  standOnPillar(x); tick(x.c, x.g, 2);
  expect(x.c.hold).toBe(0); expect(x.c.cuts).toBe(0); expect(x.c.state).toBe('chained');
  const y = attach(); cast(y, -3);
  expect(y.c.pullSide).toBe(-1); expect(y.c.pillar.x).toBeCloseTo(8.4, 9); expect(y.c.anchor.x).toBeCloseTo(-12.8, 9);
  const z = attach(); cast(z, .5);
  expect(z.c.pullSide).toBe(1);
  // 작은 방에서는 기둥과 사슬 끝을 방 안쪽으로 자른다.
  const s = attach(DEF, { homeRoom: { x: 0, z: 0, w: 10, h: 10 } }); cast(s, 3);
  expect(s.c.pillar.x).toBeCloseTo(-5 + 1.2, 9); expect(s.c.anchor.x).toBeCloseTo(5 - 1.2, 9);
});

test('열림: 마지막 고리 다음 갱신에 한 번만 열리고, 마지막 고리 전·다른 시그니처에는 열리지 않는다. 고리 없이 끝나면 broken', () => {
  const x = attach();
  cast(x, 6);
  tick(x.c, x.g, 2.5);
  expect(x.c.state).toBe('chained');
  x.boss.signatures.age = 2.65; x.c.update(x.g, DT);
  expect(x.c.state).toBe('open'); expect(x.c.windows).toBe(1); expect(x.c.windowLeft).toBe(DEF.window);
  expect(x.g.toasts).toContain('사슬 기둥 열림 · 5초 안에 1.2초 버티기');
  tick(x.c, x.g, DEF.window + .1);
  expect(x.c.state).toBe('chained'); expect(x.c.misses).toBe(1); expect(x.c.pullSide).toBe(0);
  // 같은 망치(attackSequence)로는 다시 열리지 않는다.
  x.boss.state = 'attack'; x.boss.special = 'kiln_hammer'; tick(x.c, x.g, .5);
  expect(x.c.windows).toBe(1);
  // 다른 시그니처
  const y = attach(); y.boss.state = 'attack'; y.boss.special = 'kiln_vents'; y.boss.attackSequence = 1;
  y.boss.signatures.plan = { key: 'kiln_vents', lastStrike: 2, events: [{ x: 6, z: 0 }] }; tick(y.c, y.g, 3);
  expect(y.c.state).toBe('chained'); expect(y.c.pulling).toBe(false);
  // 마지막 고리 전에 끝남
  const z = attach(); cast(z, 6); tick(z.c, z.g, 1);
  z.boss.state = 'chase'; z.c.update(z.g, DT);
  expect(z.c.broken).toBe(1); expect(z.c.pulling).toBe(false); expect(z.c.state).toBe('chained');
});

test('버티기: 열린 기둥 반경 안에서 행동·피격 없이 1.2초(72프레임) 버티면 끊긴다. 이탈·공격·회피·피격은 0으로 되돌린다', () => {
  const x = attach(); open(x); standOnPillar(x);
  tick(x.c, x.g, .5);
  expect(x.c.hold).toBeCloseTo(.5, 6);
  x.g.player.state = 'attack'; x.c.update(x.g, DT); expect(x.c.hold).toBe(0);
  x.g.player.state = 'idle'; tick(x.c, x.g, .5);
  x.g.player.state = 'dodge'; x.c.update(x.g, DT); expect(x.c.hold).toBe(0);
  x.g.player.state = 'move'; tick(x.c, x.g, .5); expect(x.c.hold).toBeCloseTo(.5, 6);
  x.g.player.hp -= 1; x.c.update(x.g, DT); expect(x.c.hold).toBe(0);
  // 반경 경계: 1.6 은 안, 1.61 은 밖
  x.g.player.pos.set(x.c.pillar.x + 1.6, 0, x.c.pillar.z); x.c.update(x.g, DT); expect(x.c.hold).toBeCloseTo(DT, 9);
  x.g.player.pos.set(x.c.pillar.x + 1.61, 0, x.c.pillar.z); x.c.update(x.g, DT); expect(x.c.hold).toBe(0);
  const y = attach(); open(y); standOnPillar(y);
  for (let i = 0; i < 71; i++) y.c.update(y.g, DT);
  expect(y.c.state).toBe('open');
  y.c.update(y.g, DT);
  expect(y.c.state).toBe('exposed'); expect(y.c.cuts).toBe(1); expect(y.c.chainsLeft).toBe(2);
  expect(y.g.toasts).toContain('사슬 끊김 1/3 · 거수가 휘청인다');
  expect(y.c.lastCutT).toBe(0); expect(y.c.pullSide).toBe(0); expect(y.c.hold).toBe(0);
  // 창 끝 쪽에서 시작해 끝까지 못 채우면 놓침이다.
  const z = attach(); open(z); tick(z.c, z.g, DEF.window - 1); standOnPillar(z); tick(z.c, z.g, 1.1);
  expect(z.c.cuts).toBe(0); expect(z.c.misses).toBe(1); expect(z.c.state).toBe('chained');
});

test('일시정지·종료: 정지 중 창·버티기·휘청 시계가 멈추고, 보스 처치·사망·전투 종료·다른 월드·stop 이면 ended 로 끝나 배율이 1이 된다', () => {
  const x = attach(); open(x); standOnPillar(x); tick(x.c, x.g, .6);
  const left = x.c.windowLeft, hold = x.c.hold;
  x.g.paused = true; tick(x.c, x.g, 3);
  expect([x.c.windowLeft, x.c.hold, x.c.state]).toEqual([left, hold, 'open']);
  x.g.paused = false; tick(x.c, x.g, .7);
  expect(x.c.state).toBe('exposed');
  const ex = x.c.exposedLeft; x.g.paused = true; tick(x.c, x.g, 2); expect(x.c.exposedLeft).toBe(ex); x.g.paused = false;
  for (const end of [(g: any) => { g.bossDefeated = true; }, (g: any) => { g.boss.alive = false; }, (g: any) => { g.active = false; }]) {
    const y = attach(); open(y); end(y.g); y.c.update(y.g, DT);
    expect(y.c.state).toBe('ended'); expect(y.boss.damageVeil).toBeNull(); expect(y.c.filter(100)).toBe(100); expect(y.c.damageMult).toBe(1);
  }
  const world = {}; const w = attach(DEF, {}, {}); (w.c as any).world = world; w.g.world = {}; w.c.update(w.g, DT); expect(w.c.state).toBe('ended');
  const s = attach(); s.c.stop(); s.c.stop(); expect(s.c.state).toBe('ended'); s.c.update(s.g, DT); expect(s.c.state).toBe('ended');
});

test('휘청·약화: 끊기면 5초 동안 휘청(공격 대기 붙잡기)·피해 (1+.1k)×2, 끝나면 chained 에서 1+.1k 가 남고, 3개를 끊으면 unchained(배율만 남음)', () => {
  const x = attach();
  expect(x.c.filter(100)).toBe(100);
  open(x); expect(x.c.filter(100)).toBe(100);
  standOnPillar(x); tick(x.c, x.g, DEF.hold);
  expect(x.c.state).toBe('exposed');
  expect(x.boss.atkCd).toBeGreaterThanOrEqual(DEF.exposed);
  expect(x.c.damageMult).toBeCloseTo(1.1 * 2, 9);
  expect(x.c.filter(100)).toBeCloseTo(220, 9);
  expect(x.c.filter(100, null)).toBeCloseTo(220, 9);
  expect(x.c.exposedDamage).toBeCloseTo(440, 9);
  tick(x.c, x.g, 2); expect(x.boss.atkCd).toBeGreaterThanOrEqual(x.c.exposedLeft);
  tick(x.c, x.g, 3.1);
  expect(x.c.state).toBe('chained'); expect(x.c.damageMult).toBeCloseTo(1.1, 9); expect(x.c.filter(100)).toBeCloseTo(110, 9);
  expect(x.c.exposedDamage).toBeCloseTo(440, 9);
  for (let k = 2; k <= 3; k++) { open(x); standOnPillar(x); tick(x.c, x.g, DEF.hold); expect(x.c.cuts).toBe(k); tick(x.c, x.g, DEF.exposed + .1); }
  expect(x.c.state).toBe('unchained'); expect(x.c.chainsLeft).toBe(0);
  expect(x.boss.damageVeil).toBe(x.c);
  expect(x.c.filter(100)).toBeCloseTo(130, 9);
  expect(x.g.toasts).toContain('거수의 사슬이 모두 끊겼다');
  // unchained 에서는 망치를 지키지 않고 묶지 않으며 더 열지 않는다.
  cast(x, 6); expect(x.c.guards(x.boss)).toBe(false); x.boss.signatures.age = 3; x.c.update(x.g, DT);
  expect(x.c.state).toBe('unchained'); expect(x.c.pins(x.boss)).toBe(false);
  expect(x.c.report()).toEqual({ id: 'ashforge_deep_chains', count: 3, windows: 3, cuts: 3, misses: 0, exposedDamage: 440, broken: 0 });
});

test('묶임 pins: exposed 는 늘 묶고, open 은 영웅이 사거리(3.6 × .92) 밖일 때만 묶으며 공격 대기를 붙잡지 않는다. chained 는 묶지 않는다', () => {
  const x = attach();
  expect(x.c.pins(x.boss)).toBe(false);
  x.boss.atkCd = 0; open(x);
  expect(x.boss.atkCd).toBe(0);
  x.g.player.pos.set(4 + 3.6 * .92 + .01, 0, 0); expect(x.c.pins(x.boss)).toBe(true);
  x.g.player.pos.set(4 + 3.6 * .92 - .01, 0, 0); expect(x.c.pins(x.boss)).toBe(false);
  x.g.player.alive = false; expect(x.c.pins(x.boss)).toBe(true); x.g.player.alive = true;
  expect(x.c.pins({ ...x.boss })).toBe(false);
  standOnPillar(x); tick(x.c, x.g, DEF.hold);
  x.g.player.pos.set(4.5, 0, 0); expect(x.c.pins(x.boss)).toBe(true);
});

test('지킴: chained 동안 시전 중인 용재 망치만 지키고, 다른 시그니처·다른 적·창이 열린 뒤·종료 뒤에는 지키지 않는다', () => {
  const x = attach();
  expect(x.c.guards(x.boss)).toBe(false);
  cast(x, 6);
  expect(x.c.guards(x.boss)).toBe(true);
  expect(x.c.guards({ ...x.boss })).toBe(false);
  x.boss.special = 'slam'; expect(x.c.guards(x.boss)).toBe(false); x.boss.special = 'kiln_hammer';
  x.boss.signatures.age = 2.65; expect(x.c.guards(x.boss)).toBe(true);
  x.c.update(x.g, DT); expect(x.c.state).toBe('open'); expect(x.c.guards(x.boss)).toBe(false);
  tick(x.c, x.g, DEF.window + .1); expect(x.c.state).toBe('chained');
  x.boss.state = 'attack'; expect(x.c.guards(x.boss)).toBe(false);
  x.c.stop(); x.boss.attackSequence++; expect(x.c.guards(x.boss)).toBe(false);
});

test('autoHold: 열린 창에서만 기둥 지점(같은 벡터)을 주고, 보스 몸이 길을 막으면 옆 경유점 → 닿으면 래치, 남은 창이 모자라거나 0.5초 진전 없으면 null', () => {
  const x = attach();
  const p: any = fakePlayer(10, 0);
  expect(x.c.autoHold(p)).toBeNull();
  open(x, 6);
  // 보스(4,0)가 영웅(10,0) → 기둥(-8.4,0) 직선 위에 있다: 옆 경유점(보스 중심에서 수직으로 몸 + 1).
  const body = .7 * 2.45 + .7;
  const a = x.c.autoHold(p)!;
  expect(a.x).toBeCloseTo(4, 9); expect(Math.abs(a.z)).toBeCloseTo(body + 1, 9);
  // 경유점에 닿으면 이 창에서는 기둥만 준다.
  p.pos.set(a.x, 0, a.z); const b = x.c.autoHold(p)!;
  expect(b).toBe(a); expect([b.x, b.z]).toEqual([-8.4, 0]);
  p.pos.set(10, 0, 0); expect(x.c.autoHold(p)!.x).toBe(-8.4);
  // 경유점으로 가는 도중 직선이 트이면(보스 옆을 지나침) 그 창에서는 기둥만 준다(다시 막혀도 경유점으로 돌아가지 않는다).
  const v = attach(); open(v, 6); const r: any = fakePlayer(10, 0);
  expect(v.c.autoHold(r)!.x).toBeCloseTo(4, 9);
  r.pos.set(7, 0, 3.5); expect(v.c.autoHold(r)!.x).toBe(-8.4);
  r.pos.set(10, 0, 0); expect(v.c.autoHold(r)!.x).toBe(-8.4);
  // 기둥 안(.3)이면 기둥 중심을 그대로 준다.
  p.pos.set(-8.3, 0, 0); expect(x.c.autoHold(p)!.x).toBe(-8.4);
  // 보스를 피한 직선이면 바로 기둥.
  const y = attach(); open(y, 6); const q: any = fakePlayer(10, 6);
  expect([y.c.autoHold(q)!.x, y.c.autoHold(q)!.z]).toEqual([-8.4, 0]);
  // 진전 없음 0.5초 → 포기(움직일 수 있는 idle 에서만 시계가 흐른다).
  q.state = 'attack'; for (let i = 0; i < 60; i++) { y.c.update(y.g, DT); expect(y.c.autoHold(q)).not.toBeNull(); }
  q.state = 'idle'; let gaveUp = false;
  for (let i = 0; i < 40 && !gaveUp; i++) { y.c.update(y.g, DT); gaveUp = y.c.autoHold(q) === null; }
  expect(gaveUp).toBe(true);
  // 남은 창 < 남은 버티기 → null
  const z = attach(); open(z, 6); tick(z.c, z.g, DEF.window - DEF.hold + .05);
  expect(z.c.autoHold(fakePlayer(-2, 0))).toBeNull();
  const d = attach(); open(d, 6); expect(d.c.autoHold({ ...fakePlayer(), alive: false })).toBeNull();
  d.boss.alive = false; expect(d.c.autoHold(fakePlayer())).toBeNull();
});

// ---------------- 실제 Enemy/BossSignatures/Player 경로 ----------------
function realBossFixture() {
  const f: any = createCombatFlowFixture(runtime);
  const g: any = f.game;
  g.stage = buildExpeditionStage('dungeon', 'ashforge_catacomb', null, { depth: 'deep' });
  const boss: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 2.6, { id: 'ash_colossus', hp: 1e12, maxHp: 1e12, atk: 1, atkCd: 0, radius: .7 * 2.45, homeRoom: f.room });
  boss.signatures = new BossSignatures(boss);
  boss.runtimeSpeciesId = 'ash_colossus';
  g.boss = boss;
  f.player.maxHp = f.player.hp = 1e12;
  return { f, g, boss };
}
function withFixedRandom<T>(fn: () => T): T {
  const original = Math.random; Math.random = () => .5;
  try { return fn(); } finally { Math.random = original; }
}
function wire(f: any, g: any, c: AshforgeChainBreak) {
  const playerUpdate = f.player.update;
  f.player.update = function(dt: number) { playerUpdate.call(this, dt); c.update(g, dt); };
}

test('실제 Enemy.hurt: 방어 감쇄 뒤 휘청 동안 (1+.1)×2, 휘청 뒤 1.1, 중독 틱도 같은 배율, 부착 전은 그대로', () => {
  withFixedRandom(() => {
    const { g, boss } = realBossFixture();
    const hit = () => { const before = boss.hp; boss.hurt(1000, { kb: 0, dirx: 0, dirz: 1, attacker: g.player }); return before - boss.hp; };
    const base = 1000 * (1 - ARMOR);
    expect(hit()).toBeCloseTo(base, 6);
    const c = new AshforgeChainBreak(DEF);
    c.update(g, DT);
    expect(boss.damageVeil).toBe(c);
    expect(hit()).toBeCloseTo(base, 6);
    boss.state = 'attack'; boss.special = 'kiln_hammer'; boss.attackSequence = 1;
    boss.signatures.plan = { key: 'kiln_hammer', lastStrike: 2.65, events: [{ x: boss.pos.x + 3, z: boss.pos.z }] }; boss.completedAttackSequence = 1;
    c.update(g, DT);
    expect(c.state).toBe('open');
    g.player.pos.set(c.pillar.x, 0, c.pillar.z); g.player.state = 'idle';
    for (let i = 0; i < 72; i++) c.update(g, DT);
    expect(c.state).toBe('exposed');
    expect(hit()).toBeCloseTo(base * 1.1 * 2, 6);
    boss.poison = 1; boss.poisonT = 0; boss.state = 'chase';
    { const before = boss.hp; boss.update(1e-6); expect(before - boss.hp).toBeCloseTo((boss.maxHp * .02 + 8) * 2.2, 0); }
    boss.poison = 0;
    for (let i = 0; i < 60 * 5 + 2; i++) c.update(g, DT);
    expect(c.state).toBe('chained');
    expect(hit()).toBeCloseTo(base * 1.1, 6);
  });
});

test('실제 Enemy 경로: 용재 망치 중 치명타 강타·기절은 망치를 끊지 않고 마지막 고리 다음 스텝에 창이 열린다. 열린 뒤에는 기절이 그대로 걸린다', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const c = new AshforgeChainBreak(DEF, null);
    wire(f, g, c);
    // 1단계 패턴 ['kiln_vents','slam','kiln_hammer','fan'] 의 셋째가 용재 망치다.
    boss.patternTurn = 2;
    let opened = -1, strike = -1, interrupted = false, hits = 0;
    for (let frame = 0; frame < 60 * 12; frame++) {
      stepCombatFlow(f, DT);
      if (strike < 0 && boss.special === 'kiln_hammer' && boss.completedAttackSequence === boss.attackSequence && boss.attackSequence > 0) strike = frame;
      if (c.state === 'open') { opened = frame; break; }
      if (boss.special === 'kiln_hammer' && boss.state === 'attack' && !boss.attackDone && frame % 10 === 0) {
        boss.hurt(10, { crit: true, kb: 8, stun: 1, dirx: 0, dirz: 1 });
        boss.stun = .5;
        hits++;
      }
      if (hits > 0 && boss.state !== 'attack' && opened < 0 && strike < 0) interrupted = true;
    }
    expect(hits).toBeGreaterThan(3);
    expect(interrupted).toBe(false);
    expect(strike).toBeGreaterThanOrEqual(0);
    expect(opened).toBe(strike + 1);
    expect(c.broken).toBe(0);
    boss.hurt(10, { crit: true, kb: 8, stun: 1, dirx: 0, dirz: 1 });
    expect(boss.stun).toBeGreaterThan(0);
  });
});

test('실제 용재 망치: 열린 창에서 영웅이 멀면 거수는 제자리(추격 속도 0), 끊긴 뒤 휘청 동안 새 공격 없음, 휘청이 끝나면 다시 공격한다', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const c = new AshforgeChainBreak(DEF, null);
    wire(f, g, c);
    boss.patternTurn = 2;
    g.player.auto = false;
    let frame = 0, chasedWhileOpen = false, seqAtCut = -1, attackedExposed = false, closed = -1, nextAttack = -1;
    for (; frame < 60 * 30; frame++) {
      const was = c.state;
      if (c.state === 'open') { g.player.pos.set(c.pillar.x, 0, c.pillar.z); g.player.state = 'idle'; }
      stepCombatFlow(f, DT);
      if (was === 'open' && c.state === 'open' && boss.state === 'chase' && boss.vel.lengthSq() > 0) chasedWhileOpen = true;
      if (was === 'open' && c.state === 'exposed') seqAtCut = boss.attackSequence;
      if (was === 'exposed' && c.state === 'exposed' && boss.attackSequence !== seqAtCut) attackedExposed = true;
      if (was === 'exposed' && c.state === 'chained') closed = frame;
      if (closed >= 0 && boss.attackSequence > seqAtCut) { nextAttack = frame; break; }
    }
    expect(c.cuts).toBe(1);
    expect(chasedWhileOpen).toBe(false);
    expect(attackedExposed).toBe(false);
    expect(nextAttack).toBeGreaterThan(closed);
  });
});

test('Player.autoMove: 경로 목표가 기둥 지점을 주면 그쪽으로만 움직이고, 닿으면 0 이동으로 서며 공격·스킬을 누르지 않는다. null 이면 평소 전투', () => {
  withFixedRandom(() => {
    const { f, g, boss } = realBossFixture();
    const point = new Vector3(f.player.pos.x + 5, 0, f.player.pos.z);
    g.routeObjectives.autoHold = () => point;
    g.input.clear();
    const out = f.player.autoMove(DT);
    expect(out.x).toBeCloseTo(1, 9); expect(out.y).toBeCloseTo(0, 9);
    expect(g.input.queue).toEqual([]);
    const here = new Vector3(f.player.pos.x + .1, 0, f.player.pos.z);
    g.routeObjectives.autoHold = () => here;
    const still = f.player.autoMove(DT);
    expect([still.x, still.y]).toEqual([0, 0]);
    expect(g.input.queue).toEqual([]);
    g.routeObjectives.autoHold = () => null;
    f.player.pos.set(boss.pos.x, 0, boss.pos.z - 2);
    f.player.autoMove(DT);
    expect(g.input.queue).toContain('attack');
  });
});

test('냉각 장치 연결: 재벼림 심층만 사슬 끊기를 만들고 결과 보고에 chains 를 붙인다. 다른 냉각 정의의 보고 모양은 그대로', () => {
  const stage: any = buildExpeditionStage('dungeon', 'ashforge_catacomb', null, { depth: 'deep' });
  const route: any = createRouteObjectives(stage, buildExpeditionWorld(stage));
  expect(route).toBeInstanceOf(CoolingValves);
  expect(route.chains).toBeInstanceOf(AshforgeChainBreak);
  expect(route.chains.def).toBe(DEF);
  expect(route.rear).toBeNull();
  expect(route.autoHold(fakePlayer())).toBeNull();
  const report = route.finish(false);
  expect(Object.keys(report)).toEqual(['id', 'label', 'complete', 'progress', 'target', 'rooms', 'overheatHits', 'chains']);
  expect(report.chains).toEqual({ id: 'ashforge_deep_chains', count: 3, windows: 0, cuts: 0, misses: 0, exposedDamage: 0, broken: 0 });
  for (const [routeId, depth] of [['ashforge_catacomb', 'standard'], ['cinder_tide_lock', 'standard'], ['cinder_tide_lock', 'deep'], ['ember_vault', 'deep']]) {
    const s: any = buildExpeditionStage('dungeon', routeId, null, { depth });
    const r: any = createRouteObjectives(s, buildExpeditionWorld(s));
    expect(r).toBeInstanceOf(CoolingValves);
    expect(r.chains).toBeNull();
    expect(r.autoHold(fakePlayer())).toBeNull();
    expect(Object.keys(r.finish(true))).not.toContain('chains');
  }
  const s2: any = buildExpeditionStage('dungeon', 'ashforge_catacomb', null, { depth: 'deep' });
  const r2: any = createRouteObjectives(s2, buildExpeditionWorld(s2));
  r2.stop(); r2.stop();
  expect(r2.chains.state).toBe('ended');
  expect(r2.autoHold(fakePlayer())).toBeNull();
});

test('냉각 장치 update: 심장로 규칙이 조기 반환(영웅 쓰러짐 등)해도 사슬 끊기가 먼저 갱신된다', () => {
  const stage: any = buildExpeditionStage('dungeon', 'ashforge_catacomb', null, { depth: 'deep' });
  const world: any = buildExpeditionWorld(stage);
  const route: any = createRouteObjectives(stage, world);
  const boss = fakeBoss({ homeRoom: world.bossRoom, pos: new Vector3(world.bossRoom.x + 4, 0, world.bossRoom.z) });
  const g: any = fakeGame(boss, { world, player: { alive: false, pos: new Vector3() }, enemies: [], pending: [], fx: { damage() {} } });
  route.update(g, DT);
  expect(route.chains.state).toBe('chained');
  boss.state = 'attack'; boss.special = 'kiln_hammer'; boss.attackSequence = 1;
  boss.signatures.plan = { key: 'kiln_hammer', lastStrike: 2.65, events: [{ x: world.bossRoom.x + 5, z: world.bossRoom.z }] };
  route.update(g, DT);
  expect(route.chains.pullSide).toBe(1);
  expect(route.chains.pillar.x).toBeCloseTo(world.bossRoom.x - DEF.pillarOffset, 9);
  boss.signatures.age = 2.65; route.update(g, DT);
  expect(route.chains.state).toBe('open');
});

test('전술 문구: 재벼림 심층 보스 전술 뒤에 정의 값으로 만든 사슬 문장이 붙고, 일반 재벼림·재의 수문에는 없다', () => {
  const deep: any = EXPEDITION_DEPTHS.find((d: any) => d.id === 'ashforge_catacomb' && d.depth === 'deep');
  const sentence = '용재 망치가 내려칠 때 사슬이 망치 쪽으로 끌리고 반대편에 사슬 기둥이 섭니다. 마지막 고리 뒤 ' + DEF.window
    + '초 동안 거수는 쫓아오지 못합니다. 그 안에 열린 기둥에서 행동 없이 ' + DEF.hold + '초 버티면 사슬이 끊겨 거수가 ' + DEF.exposed
    + '초 동안 휘청이며 받는 피해가 ' + DEF.exposedMult + '배가 되고, 끊을 때마다 남은 전투 동안 받는 피해가 ' + Math.round(DEF.weaken * 100)
    + '%씩 늘어납니다(사슬 ' + DEF.count + '개).';
  expect(deep.tactic.endsWith(' ' + sentence)).toBe(true);
  const stage: any = buildExpeditionStage('dungeon', 'ashforge_catacomb', null, { depth: 'deep' });
  expect(stage.encounter.tactic).toContain(sentence);
  for (const [id, depth] of [['ashforge_catacomb', undefined], ['cinder_tide_lock', undefined]] as const) {
    const s: any = buildExpeditionStage('dungeon', id, null, depth ? { depth } : undefined);
    expect(s.encounter.tactic).not.toMatch(/사슬 기둥/);
  }
  expect(routeObjectiveForStage(buildExpeditionStage('dungeon', 'ashforge_catacomb', null))).not.toBe(ROUTE_OBJECTIVES.ashforge_deep);
});

test('보스전 AUTO 모의(실제 Player/Enemy/BossSignatures/군중 접촉, 1/60초): 기둥에서 사슬 3개를 끊고 휘청 중 새 공격 0·망치 끊김 0, 기사 L40 은 끔보다 빨리 잡는다', () => {
  const rows: any[] = [];
  for (const seed of [1, 2, 3]) for (const mode of ['on', 'off', 'nohold']) rows.push(runChainSim(runtime, AshforgeChainBreak, DEF, { hero: 'knight', seed, mode, heroLevel: 40, maxSeconds: 300 }));
  for (const r of rows.filter(r => r.mode === 'on')) {
    expect(r.cuts).toBe(DEF.count);
    expect(r.broken).toBe(0);
    expect(r.attacksExposed).toBe(0);
    expect(r.exposedSeconds).toBeGreaterThanOrEqual(DEF.count * DEF.exposed - 1e-6);
    expect(r.exposedSeconds).toBeLessThan(DEF.count * DEF.exposed + .1);
    expect(r.killSeconds).not.toBeNull();
  }
  for (const r of rows.filter(r => r.mode === 'off')) expect(r.windows).toBe(0);
  for (const r of rows.filter(r => r.mode === 'nohold')) { expect(r.cuts).toBe(0); expect(r.misses).toBe(r.windows - (r.windowLog.at(-1)?.bossDied ? 1 : 0)); }
  const s: any = summarize(rows);
  const on = s.find((x: any) => x.mode === 'on'), off = s.find((x: any) => x.mode === 'off'), nohold = s.find((x: any) => x.mode === 'nohold');
  expect(on.killMedian).toBeLessThan(off.killMedian);
  expect(on.killMedian).toBeLessThan(nohold.killMedian);
});
