import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Vector3 } from 'three';
import { audio } from '../src/engine/audio.js';
import { routeObjectiveForStage } from '../src/data/route-objectives.js';
import { stageDef } from '../src/data/stages.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { CometBossOrbit } from '../src/game/comet-boss-orbit.js';
import { CometOrbits } from '../src/game/comet-orbits.js';
import { CometDeepOrbits } from '../src/game/comet-deep-orbits.js';
import { BossSignatures } from '../src/game/boss-signatures.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();
const DT = 1 / 60;
const noop = () => {};
// 정의 값은 독립 상수로 다시 적는다. first·every 는 시뮬로 조정될 수 있어 정의에서 읽는다.
const SAFE = 5.2, OUTER_MIN = 5.8, OUTER_MAX = 9, ESCAPE = 6.4, WARNING = 1.4, CENTER_EVERY = 3, DAMAGE = .07;

const sounds: string[] = [];
let restores: Array<() => void> = [];
beforeEach(() => {
  sounds.length = 0;
  restores = (['ting', 'boom'] as const).map(key => {
    const spy = spyOn(audio as any, key).mockImplementation(() => { sounds.push(key); });
    return () => spy.mockRestore();
  });
});
afterEach(() => { for (const restore of restores) restore(); });

const stageOf = (depth: 'standard' | 'deep') => buildExpeditionStage('dungeon', 'comet_bastion', null, { depth });
const DEF = (routeObjectiveForStage(stageOf('standard')) as any).boss;

function fakeBoss(extra: any = {}) {
  return { alive: true, spawning: false, isBoss: true, state: 'chase', attackSequence: 0, atkCd: 0, pos: new Vector3(),
    runtimeSpeciesId: 'comet_bastion', ...extra };
}
/** 영웅은 at(r, angle) 로 보스방 중심에서 r 만큼 떨어진 곳에 둔다. */
function fixture(depth: 'standard' | 'deep' = 'standard') {
  const stage = stageOf(depth), world = buildExpeditionWorld(stage);
  const toasts: string[] = [], hurts: Array<{ dmg: number; opts: any }> = [], circles: any[] = [];
  const hero: any = { alive: true, maxHp: 200, pos: new Vector3(), hurtResult: true,
    hurt: (dmg: number, opts: any) => { hurts.push({ dmg, opts }); return hero.hurtResult; } };
  const boss = fakeBoss();
  const g: any = { active: true, paused: false, bossDefeated: false, world, stage, boss, player: hero, enemies: [], pending: [],
    ui: { toast: (t: string) => toasts.push(t), setObjective: noop }, fx: { castCircle: (...a: any[]) => circles.push(a), damage: noop },
    renderer: { shake: noop }, app: { reducedMotion: { matches: false } }, autoTarget: null };
  const orbit = new CometBossOrbit(DEF, world);
  const at = (r: number, angle = 0) => hero.pos.set(world.bossRoom.x + Math.cos(angle) * r, 0, world.bossRoom.z + Math.sin(angle) * r);
  at(0);
  boss.pos.set(world.bossRoom.x + 3, 0, world.bossRoom.z);
  return { world, g, hero, boss, orbit, toasts, hurts, circles, at };
}
type F = ReturnType<typeof fixture>;
const attach = (f: F) => { f.orbit.update(f.g, DT); expect(f.orbit.state).toBe('armed'); };
/** state 가 목표가 될 때까지 올리고 걸린 update 횟수를 돌려준다. */
function until(f: F, state: string, max = 60 * 30, dt = DT) {
  for (let i = 1; i <= max; i++) { f.orbit.update(f.g, dt); if (f.orbit.state === state) return i; }
  throw new Error('상태가 되지 않았습니다: ' + state);
}
/** 진행 중인 예고를 낙하시킨다(영웅 위치는 호출 쪽이 정한다). */
function fall(f: F, dt = DT) { const before = f.orbit.strikes; until(f, 'armed', 60 * 5, dt); expect(f.orbit.strikes).toBe(before + 1); }
/** 다음 예고를 시작시키고 그 종류를 돌려준다. */
function nextWarn(f: F) { until(f, 'warn'); return f.orbit.kind; }
/** center 예고까지 outer 두 번을 영웅이 안전한 자리에서 흘려보낸다. */
function toCenter(f: F) { f.at(0); for (let i = 0; i < CENTER_EVERY - 1; i++) { expect(nextWarn(f)).toBe('outer'); fall(f); } expect(nextWarn(f)).toBe('center'); }
const frames = (seconds: number) => Math.round(seconds / DT);

test('공유 정의: 일반·심층 개인 원정만 boss 정의를 갖고, 캠페인·파티·균열·다른 원정은 갖지 않는다', () => {
  for (const depth of ['standard', 'deep'] as const) {
    const def: any = (routeObjectiveForStage(stageOf(depth)) as any).boss;
    expect(def).toMatchObject({ enemy: 'comet_bastion', safe: SAFE, outerMin: OUTER_MIN, outerMax: OUTER_MAX, escape: ESCAPE, warning: WARNING, centerEvery: CENTER_EVERY, damage: DAMAGE });
    expect(def.first).toBeGreaterThan(0);
    expect(def.every).toBeGreaterThan(def.warning);
  }
  const stage = stageOf('standard');
  expect(routeObjectiveForStage({ ...stage, party: { id: 'p' } })).toBeNull();
  expect(routeObjectiveForStage({ ...stage, expedition: { ...stage.expedition, riftId: 'r' } })).toBeNull();
  expect(routeObjectiveForStage(stageDef(6, 10))).toBeNull(); // 캠페인 스테이지
  for (const [id, depth] of [['bellfall_crypt', 'standard'], ['bellfall_crypt', 'deep'], ['sable_mirage_basin', 'standard'], ['cinder_tide_lock', 'deep'], ['nightglass_observatory', 'deep']] as const) {
    const route: any = routeObjectiveForStage(buildExpeditionStage('dungeon', id, null, { depth }));
    expect(route && 'boss' in route).toBeFalsy();
  }
});

test('실제 일반·심층 월드에서 생성되고(도달성 통과) 보스방 중심이 궤도 중심이며, 걸을 수 없는 월드는 RangeError', () => {
  for (const depth of ['standard', 'deep'] as const) {
    const world = buildExpeditionWorld(stageOf(depth));
    const orbit = new CometBossOrbit(DEF, world);
    expect(orbit.state).toBe('idle');
    expect([orbit.center.x, orbit.center.z]).toEqual([world.bossRoom.x, world.bossRoom.z]);
    expect(world.roomAt(orbit.center.x, orbit.center.z)).toBe(world.bossRoom);
    expect(orbit.warnTotal).toBe(WARNING);
    expect(orbit.kind).toBeNull();
    expect(orbit.warnLeft).toBe(0);
  }
  const world: any = buildExpeditionWorld(stageOf('standard'));
  const blocked = Object.assign(Object.create(world), { buildFlow: () => new Int32Array(world.cols * world.rows).fill(-1) });
  expect(() => new CometBossOrbit(DEF, blocked)).toThrow(RangeError);
  expect(() => new CometBossOrbit(DEF, Object.assign(Object.create(world), { minX: undefined }))).toThrow(RangeError);
  expect(() => new CometBossOrbit({ ...DEF, warning: 0 }, world)).toThrow(RangeError);
  expect(() => new CometBossOrbit(null as any, world)).toThrow(RangeError);
});

test('CometOrbits·CometDeepOrbits 가 정의의 boss 로 컨트롤러를 만들고 bossOrbit 으로 내보낸다', () => {
  const standard = createRouteObjectives(stageOf('standard'), buildExpeditionWorld(stageOf('standard'))) as CometOrbits;
  const deep = createRouteObjectives(stageOf('deep'), buildExpeditionWorld(stageOf('deep'))) as CometDeepOrbits;
  expect(standard).toBeInstanceOf(CometOrbits);
  expect(deep).toBeInstanceOf(CometDeepOrbits);
  for (const route of [standard, deep]) {
    expect(route.bossOrbit).toBeInstanceOf(CometBossOrbit);
    expect(route.bossOrbit!.def).toBe(DEF);
    expect(route.bossOrbit!.state).toBe('idle');
  }
});

test('부착: 혜성 기사단장 보스만 붙고, 다른 종·소환 중·죽은 보스·보스가 아닌 적은 무시하며, 종 id 는 runtimeSpeciesId 가 우선', () => {
  const f = fixture();
  for (const [name, patch] of [['다른 종', { runtimeSpeciesId: 'glass_hour_sovereign' }], ['소환 중', { spawning: true }],
    ['죽은 보스', { alive: false }], ['보스 아님', { isBoss: false }]] as const) {
    Object.assign(f.boss, { runtimeSpeciesId: 'comet_bastion', spawning: false, alive: true, isBoss: true }, patch);
    for (let i = 0; i < 10; i++) f.orbit.update(f.g, DT);
    expect([name, f.orbit.state]).toEqual([name, 'idle']);
  }
  // runtimeSpeciesId 가 없으면 스테이지 조우의 적 id 로 판단한다.
  Object.assign(f.boss, { runtimeSpeciesId: undefined, spawning: false, alive: true, isBoss: true });
  f.g.stage = { encounter: { enemyId: 'glass_hour_sovereign' } };
  f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('idle');
  f.g.stage = { encounter: { enemyId: 'comet_bastion' } };
  f.g.boss = null; f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('idle');
  f.g.boss = f.boss; f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('armed');
  expect(f.orbit.boss).toBe(f.boss);
  f.orbit.update(f.g, DT);
  expect(f.toasts.filter(t => t === '푸른 궤도선 · 평소 유성은 선 바깥에 떨어집니다')).toHaveLength(1);
});

test('부착 뒤 first 초에 첫 예고가 뜨고, 예고 warning 초 뒤에 낙하한다(1/60 스텝과 큰 dt)', () => {
  const f = fixture();
  attach(f);
  const toWarn = until(f, 'warn');
  expect(Math.abs(toWarn * DT - DEF.first)).toBeLessThanOrEqual(DT + 1e-6);
  expect(f.orbit.kind).toBe('outer');
  expect(f.orbit.warnLeft).toBeCloseTo(WARNING, 6);
  expect(sounds).toEqual(['ting']);
  f.at(7); // 예고 중에는 어디에 서 있어도 피해가 없다
  for (let i = 0; i < 20; i++) f.orbit.update(f.g, DT);
  expect(f.hurts).toHaveLength(0);
  f.at(4);
  const toFall = until(f, 'armed') + 20;
  expect(Math.abs(toFall * DT - WARNING)).toBeLessThanOrEqual(DT + 1e-6);
  expect(f.orbit.strikes).toBe(1);
  expect(f.orbit.warnLeft).toBe(0);
  expect(f.orbit.kind).toBeNull();
  expect(sounds).toEqual(['ting', 'boom']);
  // 다음 예고는 낙하 뒤 every 초 지점이다.
  const next = until(f, 'warn');
  expect(Math.abs(next * DT - DEF.every)).toBeLessThanOrEqual(DT + 1e-6);

  // 큰 dt: 한 번의 update 가 예고 시작과 낙하를 한꺼번에 처리하지 않는다.
  const g2 = fixture(); attach(g2);
  g2.orbit.update(g2.g, DEF.every);
  expect(g2.orbit.state).toBe('warn');
  expect(g2.orbit.strikes).toBe(0);
  g2.orbit.update(g2.g, WARNING + 1);
  expect(g2.orbit.state).toBe('armed');
  expect(g2.orbit.strikes).toBe(1);
});

test('유성 종류: 1·2번째는 outer, 세 번째마다 center', () => {
  const f = fixture();
  attach(f);
  const kinds: Array<string | null> = [];
  for (let i = 0; i < 6; i++) { kinds.push(nextWarn(f)); fall(f); }
  expect(kinds).toEqual(['outer', 'outer', 'center', 'outer', 'outer', 'center']);
  expect(f.orbit.strikes).toBe(6);
  expect(f.orbit.centerStrikes).toBe(2);
  expect(f.toasts.filter(t => t === '중심 유성 예고 · 푸른 선 밖으로')).toHaveLength(2);
});

test('outer 낙하: 선 안쪽(반지름 4.0)은 무피해, 바깥 고리(7.0)는 최대 체력의 7% 마법 피해', () => {
  const inner = fixture(); attach(inner); expect(nextWarn(inner)).toBe('outer'); inner.at(4.0); fall(inner);
  expect(inner.hurts).toHaveLength(0);
  expect(inner.orbit.hits).toBe(0);

  const outer = fixture(); attach(outer); expect(nextWarn(outer)).toBe('outer'); outer.at(7.0, Math.PI / 2); fall(outer);
  expect(outer.hurts).toHaveLength(1);
  expect(outer.hurts[0].dmg).toBeCloseTo(outer.hero.maxHp * DAMAGE, 9);
  expect(outer.hurts[0].opts).toMatchObject({ kb: 2, kind: 'magic' });
  // 피해 방향은 궤도 중심에서 영웅 쪽이다.
  expect(outer.hurts[0].opts.dirx).toBeCloseTo(0, 6);
  expect(outer.hurts[0].opts.dirz).toBeCloseTo(1, 6);
  expect(outer.orbit.hits).toBe(1);
  expect(outer.toasts).toContain('유성 충돌 · 바깥 유성은 푸른 선 안쪽이 안전');
  expect(outer.circles.at(-1)[2]).toMatchObject({ radius: OUTER_MAX });
});

test('center 낙하: 선 안쪽(반지름 3)은 피해, 바깥(6.4)은 무피해', () => {
  const inside = fixture(); attach(inside); toCenter(inside); inside.at(3); fall(inside);
  expect(inside.hurts).toHaveLength(1);
  expect(inside.hurts[0].dmg).toBeCloseTo(inside.hero.maxHp * DAMAGE, 9);
  expect(inside.toasts).toContain('유성 충돌 · 중심 유성은 푸른 선 밖으로');
  expect(inside.circles.at(-1)[2]).toMatchObject({ radius: SAFE });

  const outside = fixture(); attach(outside); toCenter(outside); outside.at(6.4); fall(outside);
  expect(outside.hurts).toHaveLength(0);
  expect(outside.orbit.hits).toBe(0);
  expect(outside.orbit.centerStrikes).toBe(1);
});

test('피격 구역 경계: outer 는 5.8~9, center 는 5.2 이하이고 낙하 시각의 위치만 본다', () => {
  const run = (kind: 'outer' | 'center', r: number) => {
    const f = fixture(); attach(f);
    if (kind === 'center') toCenter(f); else expect(nextWarn(f)).toBe('outer');
    f.at(r); fall(f);
    return f.orbit.hits;
  };
  expect([5.5, 5.79, 5.81, 7, 8.99, 9.01, 9.5].map(r => run('outer', r))).toEqual([0, 0, 1, 1, 1, 0, 0]);
  expect([0, 2.5, 5.19, 5.21, 6.4, 9].map(r => run('center', r))).toEqual([1, 1, 1, 0, 0, 0]);

  // 예고 중에 구역 안에 있었어도 낙하 때 벗어나 있으면 피해가 없다.
  const f = fixture(); attach(f); nextWarn(f);
  f.at(7); for (let i = 0; i < 30; i++) f.orbit.update(f.g, DT);
  f.at(4); fall(f);
  expect(f.orbit.hits).toBe(0);
});

test('Player.hurt 가 false(무적 등)를 돌려주면 hits 를 세지 않고, 죽은 영웅에게는 피해를 주지 않는다', () => {
  const f = fixture(); attach(f); nextWarn(f);
  f.hero.hurtResult = false; f.at(7); fall(f);
  expect(f.hurts).toHaveLength(1);
  expect(f.orbit.hits).toBe(0);
  expect(f.orbit.strikes).toBe(1);
  expect(f.toasts.some(t => t.startsWith('유성 충돌'))).toBe(false);

  f.hero.hurtResult = true; nextWarn(f); f.hero.alive = false;
  for (let i = 0; i < 300; i++) f.orbit.update(f.g, DT);
  expect(f.hurts).toHaveLength(1);
  expect(f.orbit.hits).toBe(0);
});

test('보스가 공격 중이면 예고를 미루고, 공격이 끝나면 쌓인 시계로 바로 시작한다', () => {
  const f = fixture(); attach(f);
  f.boss.state = 'attack';
  for (let i = 0; i < frames(10); i++) f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('armed');
  expect(f.orbit.strikes).toBe(0);
  expect(sounds).toEqual([]);
  f.boss.state = 'chase';
  f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('warn');
});

test('예고 중에는 보스의 공격 대기를 붙잡는다(더 긴 대기는 줄이지 않고, 공격이 시작되면 관찰값으로 센다)', () => {
  const f = fixture(); attach(f);
  until(f, 'warn');
  expect(f.boss.atkCd).toBeGreaterThanOrEqual(WARNING);
  // 실제 Enemy 처럼 orbit.update 뒤에 프레임마다 dt 를 줄여도 낙하 프레임까지 대기가 0 이하로 내려가지 않는다.
  f.boss.atkCd -= DT;
  expect(f.boss.atkCd).toBeGreaterThan(0);
  for (let i = 0; i < 200 && f.orbit.state === 'warn'; i++) {
    f.orbit.update(f.g, DT);
    f.boss.atkCd -= DT;
    expect(f.boss.atkCd).toBeGreaterThan(0);
  }
  expect(f.orbit.attackStartsDuringWarn).toBe(0);
  const long = fixture(); attach(long); long.boss.atkCd = 50; until(long, 'warn');
  expect(long.boss.atkCd).toBe(50);
  // 예고 중 attackSequence 가 바뀌면 관찰값이 올라간다(0이어야 한다는 계약을 실제로 실패할 수 있게 한다).
  const seen = fixture(); attach(seen); until(seen, 'warn');
  seen.boss.attackSequence = 4; seen.orbit.update(seen.g, DT);
  expect(seen.orbit.attackStartsDuringWarn).toBe(1);
  seen.orbit.update(seen.g, DT);
  expect(seen.orbit.attackStartsDuringWarn).toBe(1);
});

/** 실제 Enemy(혜성 기사단장)와 BossSignatures 를 보스방에 두는 고정. 영웅 체력은 사실상 무한이다. */
function realFixture(depth: 'standard' | 'deep' = 'standard') {
  const f = createCombatFlowFixture(runtime);
  const g: any = f.game;
  const stage = stageOf(depth), world = buildExpeditionWorld(stage), room = world.bossRoom;
  room.spawned = true; room.discovered = true;
  Object.assign(g, { stage, world, curRoom: room, boss: null, bossDefeated: false });
  f.room = room;
  f.player.pos.set(room.x - 1, 0, room.z);
  f.player.maxHp = f.player.hp = 1e12;
  const boss: any = spawnCombatFlowEnemy(f, room.x + 3, room.z, { id: 'comet_bastion', hp: 1e12, maxHp: 1e12, atk: 1, atkCd: 0, isBoss: true });
  boss.runtimeSpeciesId = 'comet_bastion';
  boss.signatures = new BossSignatures(boss);
  g.boss = boss;
  return { f, g, boss, world, orbit: new CometBossOrbit(DEF, world) };
}
function withFixedRandom<T>(fn: () => T): T {
  const original = Math.random; Math.random = () => .5;
  try { return fn(); } finally { Math.random = original; }
}

test('실제 Enemy: 예고 동안 새 공격을 시작하지 않고, 컨트롤러가 없으면 같은 조건에서 바로 공격한다', () => {
  withFixedRandom(() => {
    // 대조군: 컨트롤러 없이 atkCd 0 인 보스는 몇 프레임 안에 공격을 시작한다.
    const control = realFixture();
    for (let i = 0; i < frames(3) && !control.boss.attackSequence; i++) control.boss.update(DT);
    expect(control.boss.attackSequence || 0).toBeGreaterThan(0);

    const { g, boss, orbit } = realFixture();
    orbit.update(g, DT);
    expect(orbit.state).toBe('armed');
    // 보스를 갱신하지 않고 시계만 채워 예고를 시작시킨다(예고 시작 시점의 atkCd 는 0 이다).
    for (let i = 0; i < frames(10) && orbit.state !== 'warn'; i++) orbit.update(g, DT);
    expect(orbit.state).toBe('warn');
    expect(boss.state).toBe('chase');
    // Battle 순서: 매 프레임 orbit.update 직후 enemies.update. 예고가 시작된 프레임의 보스 갱신도 포함한다.
    let framesInWarn = 1;
    boss.update(DT);
    expect([boss.state, boss.attackSequence || 0]).toEqual(['chase', 0]);
    do {
      orbit.update(g, DT);
      boss.update(DT);
      expect([boss.state, boss.attackSequence || 0]).toEqual(['chase', 0]);
      framesInWarn++;
    } while (orbit.state === 'warn' && framesInWarn < 200);
    expect(orbit.strikes).toBe(1);
    expect(orbit.attackStartsDuringWarn).toBe(0);
    expect(Math.abs(framesInWarn * DT - WARNING)).toBeLessThanOrEqual(DT + 1e-6);
    // 낙하가 끝나면 대기가 풀려 보스가 다시 공격할 수 있다.
    let started = false;
    for (let i = 0; i < frames(3) && !started; i++) { orbit.update(g, DT); boss.update(DT); started = (boss.attackSequence || 0) > 0; }
    expect(started).toBe(true);
  });
});

test('실제 Enemy 를 Battle 순서(orbit → enemies)로 오래 돌려도 예고 중 공격 시작 관찰값은 0이다', () => {
  withFixedRandom(() => {
    for (const depth of ['standard', 'deep'] as const) {
      const { g, boss, orbit } = realFixture(depth);
      for (let i = 0; i < frames(40); i++) { orbit.update(g, DT); boss.update(DT); g.elapsed += DT; }
      expect(orbit.strikes).toBeGreaterThan(0);
      expect(orbit.attackStartsDuringWarn).toBe(0);
      expect(boss.attackSequence || 0).toBeGreaterThan(0); // 예고 사이에는 보스도 공격한다
    }
  });
});

test('영웅이 보스방 밖이면 시계가 멈추고, 예고 중이면 피해 없이 취소된다', () => {
  const base = fixture(); attach(base);
  const full = until(base, 'warn');

  const f = fixture(); attach(f);
  for (let i = 0; i < 40; i++) f.orbit.update(f.g, DT);
  f.hero.pos.set(f.world.startRoom.x, 0, f.world.startRoom.z);
  expect(f.world.roomAt(f.hero.pos.x, f.hero.pos.z)).not.toBe(f.world.bossRoom);
  for (let i = 0; i < frames(20); i++) f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('armed');
  f.at(0);
  const rest = until(f, 'warn');
  expect(Math.abs(40 + rest - full)).toBeLessThanOrEqual(1);

  // 예고 중 방을 나가면 취소: 낙하·피해·strikes 가 없다.
  const w = fixture(); attach(w); until(w, 'warn');
  w.at(7); for (let i = 0; i < 30; i++) w.orbit.update(w.g, DT);
  w.hero.pos.set(w.world.startRoom.x, 0, w.world.startRoom.z);
  w.orbit.update(w.g, DT);
  expect([w.orbit.state, w.orbit.kind, w.orbit.warnLeft]).toEqual(['armed', null, 0]);
  for (let i = 0; i < frames(10); i++) w.orbit.update(w.g, DT);
  expect(w.orbit.strikes).toBe(0);
  expect(w.hurts).toHaveLength(0);
  // 돌아오면 새 시계로 다시 시작하고, 예고 취소가 첫 예고 순번을 소모하지 않는다(3번째마다 center 순번은 낙하·예고 시작 기준).
  w.at(7);
  const again = until(w, 'warn');
  expect(Math.abs(again * DT - DEF.every)).toBeLessThanOrEqual(DT + 1e-6);
  expect(w.orbit.strikes).toBe(0);
});

test('취소된 예고는 순번을 쓰지 않는다: 두 번째(outer) 예고가 취소되면 다음 예고도 outer 이고, 세 번째로 떨어지는 유성이 center 다(리뷰 P3-4)', () => {
  const f = fixture(); attach(f);
  f.at(0);
  expect(nextWarn(f)).toBe('outer'); fall(f);
  expect(nextWarn(f)).toBe('outer');
  f.hero.pos.set(f.world.startRoom.x, 0, f.world.startRoom.z);
  f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('armed');
  f.at(0);
  expect(nextWarn(f)).toBe('outer'); fall(f);
  expect(nextWarn(f)).toBe('center');
  f.at(ESCAPE); fall(f);
  expect([f.orbit.strikes, f.orbit.centerStrikes, f.hurts.length]).toEqual([3, 1, 0]);
});

test('일시정지 중에는 clock·warnLeft 가 변하지 않는다', () => {
  const base = fixture(); attach(base);
  const full = until(base, 'warn');

  const f = fixture(); attach(f);
  for (let i = 0; i < 30; i++) f.orbit.update(f.g, DT);
  f.g.paused = true;
  for (let i = 0; i < frames(20); i++) f.orbit.update(f.g, DT);
  expect(f.orbit.state).toBe('armed');
  f.g.paused = false;
  const rest = until(f, 'warn');
  expect(Math.abs(30 + rest - full)).toBeLessThanOrEqual(1);

  for (let i = 0; i < 25; i++) f.orbit.update(f.g, DT);
  const left = f.orbit.warnLeft, cd = f.boss.atkCd;
  f.g.paused = true;
  for (let i = 0; i < frames(20); i++) f.orbit.update(f.g, DT);
  expect(f.orbit.warnLeft).toBe(left);
  expect(f.boss.atkCd).toBe(cd);
  expect(f.orbit.strikes).toBe(0);
  f.g.paused = false; f.at(4);
  fall(f);
  expect(f.orbit.strikes).toBe(1);
});

test('보스 처치·보스 사망·stop·전투 종료·다른 월드에서 ended 가 되고 예고는 취소되며 돌아오지 않는다', () => {
  // 보스 처치 플래그
  const a = fixture(); attach(a); until(a, 'warn'); a.at(7);
  a.g.bossDefeated = true; a.orbit.update(a.g, DT);
  expect([a.orbit.state, a.orbit.kind, a.orbit.warnLeft, a.orbit.strikes, a.hurts.length]).toEqual(['ended', null, 0, 0, 0]);
  a.g.bossDefeated = false;
  for (let i = 0; i < frames(10); i++) a.orbit.update(a.g, DT);
  expect(a.orbit.state).toBe('ended');
  expect(a.orbit.strikes).toBe(0);
  // 보스 사망(플래그보다 먼저 알아챈 경우)
  const b = fixture(); attach(b); until(b, 'warn'); b.at(7);
  b.boss.alive = false; b.orbit.update(b.g, DT);
  expect([b.orbit.state, b.orbit.strikes, b.hurts.length]).toEqual(['ended', 0, 0]);
  b.boss.alive = true; b.orbit.update(b.g, DT);
  expect(b.orbit.state).toBe('ended');
  // stop 은 반복해도 안전하고 idle·armed·warn 어디서든 ended 로 만든다.
  const c = fixture(); c.orbit.stop(); c.orbit.stop();
  expect(c.orbit.state).toBe('ended');
  c.orbit.update(c.g, DT);
  expect(c.orbit.state).toBe('ended');
  const d = fixture(); attach(d); until(d, 'warn'); d.at(7); d.orbit.stop();
  for (let i = 0; i < frames(5); i++) d.orbit.update(d.g, DT);
  expect([d.orbit.state, d.orbit.strikes, d.hurts.length]).toEqual(['ended', 0, 0]);
  expect(d.orbit.autoEvade(d.hero)).toBeNull();
  // 전투 종료·다른 월드
  const e = fixture(); attach(e); e.g.active = false; e.orbit.update(e.g, DT);
  expect(e.orbit.state).toBe('ended');
  const h = fixture(); attach(h); h.g.world = buildExpeditionWorld(stageOf('standard')); h.orbit.update(h.g, DT);
  expect(h.orbit.state).toBe('ended');
});

test('CometOrbits·CometDeepOrbits: update 첫머리에서 보스 유성이 돌고 finish 보고에 bossMeteors·bossCenterMeteors·bossMeteorHits 가 실린다', () => {
  for (const depth of ['standard', 'deep'] as const) {
    // 낙하가 없으면 세 필드는 0 이고, 고리 규칙이 아직 시작 전이어도 보스 유성은 route.update 로 부착된다.
    const idle = fixture(depth);
    const first = createRouteObjectives(idle.g.stage, idle.world) as CometOrbits | CometDeepOrbits;
    idle.g.routeObjectives = first;
    expect(first.autoEvade(idle.hero)).toBeNull();
    first.update(idle.g, DT);
    expect(first.bossOrbit!.state).toBe('armed');
    const zero: any = first.finish(false);
    expect([zero.bossMeteors, zero.bossCenterMeteors, zero.bossMeteorHits]).toEqual([0, 0, 0]);
    // 결과가 정해지면(패배 포함) 보스 유성도 끝난다. 패배 뒤 Battle 은 route 를 갱신하지 않으므로 finish 가 거둔다(리뷰 P3-5).
    expect(first.bossOrbit!.state).toBe('ended');

    const r2 = fixture(depth);
    const rt = createRouteObjectives(r2.g.stage, r2.world) as CometOrbits | CometDeepOrbits;
    const bo = rt.bossOrbit!;
    r2.g.routeObjectives = rt;
    const go = (state: string) => { for (let i = 0; i < 60 * 30; i++) { rt.update(r2.g, DT); if (bo.state === state) return; } throw new Error(state); };
    rt.update(r2.g, DT);
    go('warn'); r2.at(7); expect(rt.autoEvade(r2.hero)).not.toBeNull(); go('armed'); // outer, 영웅 바깥 고리: 피해
    go('warn'); r2.at(4); go('armed');                                              // outer, 선 안쪽: 무피해
    go('warn'); expect(bo.kind).toBe('center'); r2.at(3); go('armed');               // center, 선 안쪽: 피해
    const report: any = rt.finish(true);
    expect([report.bossMeteors, report.bossCenterMeteors, report.bossMeteorHits]).toEqual([3, 1, 2]);
    expect(bo.state).toBe('ended');
    expect(rt.finish(false)).toBe(report); // 동결
    expect(Object.isFrozen(report)).toBe(true);
    // 기존 필드는 그대로다.
    expect(report.id).toBe(depth === 'standard' ? 'comet_orbit_rings' : 'comet_deep_orbits');
    expect(report.complete).toBe(false);
    expect(report.progress).toBe(0);
    if (depth === 'standard') expect(report.meteorHits).toBe(0); else expect([report.collapseFailures, report.stormHits]).toEqual([0, 0]);
    // stop 은 보스 유성을 끝낸다.
    rt.stop();
    expect(bo.state).toBe('ended');
  }
});

test('autoEvade: warn 이 아니면 null, 지점은 그 kind 의 피격 구역 밖이며 구역 밖(여유 0.5 포함)이면 null, 같은 객체를 재사용한다', () => {
  const f = fixture(); attach(f);
  expect(f.orbit.autoEvade(f.hero)).toBeNull(); // armed
  const zone = (kind: string, r: number) => kind === 'center' ? r <= SAFE : r >= OUTER_MIN && r <= OUTER_MAX;
  const margin = (kind: string, r: number) => kind === 'center' ? r <= SAFE + .5 : r >= OUTER_MIN - .5 && r <= OUTER_MAX + .5;
  let point: any = null;
  for (const kind of ['outer', 'center'] as const) {
    if (kind === 'outer') expect(nextWarn(f)).toBe('outer'); else { fall(f); expect(nextWarn(f)).toBe('outer'); fall(f); expect(nextWarn(f)).toBe('center'); }
    for (let r = .01; r <= 12; r += .25) { // 경계의 부동소수 오차를 피하려고 격자를 살짝 비튼다
      for (let k = 0; k < 8; k++) {
        const angle = k / 8 * Math.PI * 2 + .3;
        f.at(r, angle);
        const e = f.orbit.autoEvade(f.hero);
        if (!e) { expect(margin(kind, r)).toBe(false); continue; }
        expect(margin(kind, r)).toBe(true);
        const er = Math.hypot(e.x - f.orbit.center.x, e.z - f.orbit.center.z);
        expect(zone(kind, er)).toBe(false);
        // 바깥 유성은 띠의 바깥 절반이면 바깥(outerMax + 0.8)으로, 안쪽 절반이면 선 안쪽(safe − 1.2)으로 빠진다(리뷰 P3-6).
        expect(er).toBeCloseTo(kind === 'center' ? ESCAPE : r >= (OUTER_MIN + OUTER_MAX) / 2 ? OUTER_MAX + .8 : SAFE - 1.2, 6);
        if (r > .01) expect(Math.atan2(e.z - f.orbit.center.z, e.x - f.orbit.center.x)).toBeCloseTo(Math.atan2(Math.sin(angle), Math.cos(angle)), 6);
        point ??= e;
        expect(e).toBe(point); // 같은 Vector3 재사용
      }
    }
  }
  // 중심에 서 있는 영웅은 보스 반대쪽으로 빠진다(보스는 +x 쪽에 있다).
  f.at(0);
  const away = f.orbit.autoEvade(f.hero)!;
  expect(away.x).toBeCloseTo(f.orbit.center.x - ESCAPE, 6);
  expect(away.z).toBeCloseTo(f.orbit.center.z, 6);
  // 낙하하면 다시 null
  fall(f);
  expect(f.orbit.autoEvade(f.hero)).toBeNull();
});

test('update 와 판정은 옵션 객체·좌표를 재사용한다(새 객체를 만들지 않는다)', () => {
  const f = fixture(); attach(f);
  const center = f.orbit.center;
  expect(nextWarn(f)).toBe('outer'); f.at(7); fall(f);
  expect(nextWarn(f)).toBe('outer'); f.at(7, 1); fall(f);
  expect(nextWarn(f)).toBe('center'); f.at(3); fall(f);
  expect(f.hurts.length).toBe(3);
  expect(f.hurts[1].opts).toBe(f.hurts[0].opts);
  expect(f.hurts[2].opts).toBe(f.hurts[0].opts);
  expect(f.circles[1][2]).toBe(f.circles[0][2]);   // outer 연출 옵션
  expect(f.circles[1][1]).toBe(0x9fd0ff);
  expect(f.orbit.center).toBe(center);
  expect(f.circles[0][0]).toBe(center);
});

// ---------------- AUTO (실제 Player.autoMove) ----------------
function autoFixture(evade: any) {
  const f = createCombatFlowFixture(runtime);
  const g: any = f.game, p: any = f.player;
  g.routeObjectives = { interrupt: noop, ...(evade ? { autoEvade: evade } : {}) };
  p.auto = true; p.pos.set(f.room.x, 0, f.room.z);
  const e: any = spawnCombatFlowEnemy(f, f.room.x + 1.2, f.room.z, { id: 'comet_bastion', hp: 1e9, maxHp: 1e9 });
  g.boss = e;
  return { f, g, p, e };
}
const pressed = (g: any) => [...g.input.queue];

test('AUTO: 회피 지점이 있으면 그쪽으로 걷고 공격·스킬을 누르지 않으며, 없거나 autoEvade 가 없으면 기존 AUTO 와 같다', () => {
  // 기존 동작: 적이 바로 앞이면 공격을 누른다(autoEvade 없는 원정).
  const base = autoFixture(null);
  const baseMove = base.p.autoMove(DT);
  expect(pressed(base.g)).toContain('attack');
  expect(baseMove).toEqual({ x: 0, y: 0 });
  // autoEvade 가 null 을 돌려줘도 같다.
  const none = autoFixture(() => null);
  expect(none.p.autoMove(DT)).toEqual({ x: 0, y: 0 });
  expect(pressed(none.g)).toEqual(pressed(base.g));

  // 회피 지점이 있으면 (-x 쪽 5칸) 그 방향으로 이동하고 공격·스킬·회피를 누르지 않는다(idle).
  let target: Vector3 | null = null;
  const evade = autoFixture(() => target);
  target = new Vector3(evade.p.pos.x - 5, 0, evade.p.pos.z);
  const out = evade.p.autoMove(DT);
  expect(out.x).toBeCloseTo(-1, 6);
  expect(out.y).toBeCloseTo(0, 6);
  expect(pressed(evade.g)).toEqual([]);
  // 이미 지점에 거의 닿았으면 제자리에서 공격하지 않는다.
  target = new Vector3(evade.p.pos.x - .1, 0, evade.p.pos.z);
  expect(evade.p.autoMove(DT)).toEqual({ x: 0, y: 0 });
  expect(pressed(evade.g)).toEqual([]);

  // 공격 동작 중: 타격이 끝났으면(hitDone) 이동 방향을 정한 채 회피를 누르고, 끝나기 전에는 누르지 않는다.
  const atk = autoFixture(() => target);
  target = new Vector3(atk.p.pos.x, 0, atk.p.pos.z + 5);
  atk.p.state = 'attack'; atk.p.hitDone = false; atk.p.dodgeCd = 0;
  const early = atk.p.autoMove(DT);
  expect(pressed(atk.g)).toEqual([]);
  expect(early.y).toBeCloseTo(1, 6);
  atk.p.hitDone = true;
  const late = atk.p.autoMove(DT);
  expect(pressed(atk.g)).toEqual(['dodge']);
  expect([late.x, late.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6)]);
  atk.g.input.queue.length = 0; atk.p.dodgeCd = 1;
  atk.p.autoMove(DT);
  expect(pressed(atk.g)).toEqual([]);
});

test('AUTO: 실제 CometBossOrbit 예고 중 구역 안의 영웅은 안전 지점 쪽으로 움직이고, 구역 밖이면 평소처럼 싸운다', () => {
  const f = fixture(); attach(f);
  f.g.routeObjectives = { autoEvade: (p: any) => f.orbit.autoEvade(p), interrupt: noop };
  const enemy = { alive: true, spawning: false, isBoss: true, pos: f.boss.pos, telegraph: 0, breakT: 0, distTo: (o: any) => Math.hypot(o.pos.x - f.boss.pos.x, o.pos.z - f.boss.pos.z) };
  const input = { queue: [] as string[], press(n: string) { this.queue.push(n); }, move: { x: 0, y: 0 } };
  const hero: any = Object.assign(Object.create(runtime.Player.prototype), { game: { ...f.g, enemies: [enemy], input, routeObjectives: f.g.routeObjectives, stage: f.g.stage },
    pos: f.hero.pos, state: 'idle', stateT: 0, def: { ranged: false, skills: [] }, skillLoadout: [], distTo: (o: any) => Math.hypot(o.pos.x - f.hero.pos.x, o.pos.z - f.hero.pos.z) });
  nextWarn(f);
  f.at(7);
  const m = hero.autoMove(DT); // 바깥 고리 7.0 → 선 안쪽 4.0 방향(중심을 향해 -x)
  expect(m.x).toBeLessThan(-.99);
  expect(input.queue).toEqual([]);
  f.at(4);
  hero.autoMove(DT);
  expect(f.orbit.autoEvade(hero)).toBeNull();
});
