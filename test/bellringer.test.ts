import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { BELL, Bellringer, ringContains } from '../src/game/bellringer.js';
import { validPartyWarning } from '../src/party/combat-effects.js';
import { validPartySnapshot } from '../src/party/protocol.js';
import { ENEMIES, stageDef } from '../src/data/stages.js';
import { monsterRosterEntry } from '../src/data/monster-roster.js';

const DT = 1 / 60;

function makeEnemy(game: any, x = 0, z = 0, maxHp = 1000) {
  const enemy: any = {
    game, player: game.player, alive: true, spawning: false, state: 'chase', stun: 0, atk: 20, scale: 1, gatherT: 0, telegraph: 0, special: null,
    maxHp, def: { scale: 1 }, isBoss: false, pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), root: new THREE.Group(),
    announced: 0, announceSkill() { this.announced++; },
  };
  return enemy;
}
function fixture(playerAt = 8, { visuals = true } = {}) {
  const hits: any[] = [];
  const player: any = { alive: true, pos: new THREE.Vector3(playerAt, 0, 0), invuln: false,
    hurt(dmg: number, opts: any) { if (this.invuln) return false; hits.push({ dmg, opts }); return true; } };
  const game: any = { active: true, player, fx: { texts: [] as string[], damage(_p: any, _v: any, o: any) { this.texts.push(o?.text); }, shockTex() {} }, renderer: {}, enemies: [] as any[], scene: visuals ? new THREE.Scene() : null };
  const enemy = makeEnemy(game);
  game.enemies.push(enemy);
  enemy.bellringer = new Bellringer(enemy, () => 0);
  return { enemy, player, game, ringer: enemy.bellringer as Bellringer, hits };
}
// Actor 의 이동을 흉내 낸다: 속도를 위치에 적분.
function step(f: ReturnType<typeof fixture>, dt = DT) {
  const d = f.enemy.pos.distanceTo(f.player.pos);
  const busy = f.ringer.update(dt, d);
  f.enemy.pos.addScaledVector(f.enemy.vel, dt);
  return busy;
}
function until(f: ReturnType<typeof fixture>, pred: () => boolean, max = 1200) {
  let n = 0; while (!pred() && n++ < max) step(f); return n;
}

test('종지기는 새 AI 동사(bellringer)를 가진 잡몹이며 7장 로스터에만 섞인다', () => {
  const def: any = (ENEMIES as any).bell_ringer;
  expect(def.behavior).toBe('bellringer');
  expect(def.boss || def.elite || def.ranged || def.meleeRole).toBeFalsy();
  const rosters = new Set<string>();
  for (let st = 1; st <= 10; st++) for (const wave of stageDef(7, st).waves) for (const id of wave) if (id === 'bell_ringer') rosters.add(`7-${st}`);
  expect(rosters.size).toBe(10);
  for (let ch = 1; ch <= 6; ch++) for (let st = 1; st <= 10; st++) for (const wave of stageDef(ch, st).waves) expect(wave).not.toContain('bell_ringer');
  // 모델은 Tripo 슬롯(tll_ch7_bellringer)이고 라이브러리에 없으면 대체 실루엣을 쓴다.
  expect(monsterRosterEntry(def.model)).toMatchObject({ asset: 'tll_ch7_bellringer', fallback: 'skeleton_mage' });
});

test('쿨다운 뒤 멈춰 서서 0.9초 예고하고, 예고가 끝나면 첫 고리가 퍼진다', () => {
  const f = fixture(8);
  let t = 0;
  while (!f.ringer.phase && t < BELL.firstCooldown + 1) { step(f); t += DT; }
  expect(f.ringer.phase).toBe('toll');
  expect(f.enemy.special).toBe('bell');
  expect(f.enemy.announced).toBe(1);
  expect(f.enemy.telegraph).toBeGreaterThan(0);
  const x0 = f.enemy.pos.x;
  for (let i = 0; i < 20; i++) step(f);
  expect(f.enemy.pos.x).toBe(x0);
  expect(f.enemy.vel.length()).toBe(0);
  const frames = until(f, () => f.ringer.rings[0].active);
  expect(frames * DT + 20 * DT + DT).toBeGreaterThanOrEqual(BELL.windup - DT);
  expect(f.ringer.phase).toBe('recover');
  expect(f.enemy.special).toBeNull();
  expect(f.ringer.rings[0].r).toBeGreaterThanOrEqual(BELL.startRadius);
});

test('고리 두 겹은 gap 초 간격으로 출발하고 최대 반지름에서 사라진다', () => {
  const f = fixture(8);
  f.player.invuln = true;   // 맞지 않고 고리 진행만 본다
  until(f, () => f.ringer.rings[0].active);
  const first = f.ringer.rings[0].age;
  expect(f.ringer.rings[1].active).toBe(false);
  until(f, () => f.ringer.rings[1].active);
  expect(f.ringer.rings[0].age - first).toBeCloseTo(BELL.gap, 1);
  until(f, () => !f.ringer.ringing);
  expect(f.ringer.phase).toBeNull();
  expect(f.ringer.cd).toBeGreaterThan(BELL.cooldown - 3);   // 고리가 퍼지는 동안에도 쿨다운은 흐른다
  expect(f.hits.length).toBe(0);
});

test('서 있는 플레이어는 고리 하나당 한 번씩 총 두 번 맞고 경직 강타(kb 7)를 받는다', () => {
  const f = fixture(7);
  until(f, () => !f.ringer.ringing && f.ringer.tolls > 0 && f.ringer.phase === null);
  expect(f.hits.length).toBe(2);
  for (const hit of f.hits) { expect(hit.dmg).toBeCloseTo(20 * BELL.damageMul); expect(hit.opts.kb).toBe(BELL.knockback); expect(hit.opts.dirx).toBeGreaterThan(0); }
  expect(f.ringer.hits).toBe(2);
});

test('회피 무적으로 지나치면 피해가 없고, 같은 고리가 같은 플레이어를 다시 시도하지 않는다', () => {
  const f = fixture(7);
  f.player.invuln = true;
  let attempts = 0;
  const hurt = f.player.hurt.bind(f.player);
  f.player.hurt = (...args: any[]) => { attempts++; return hurt(...args); };
  until(f, () => f.ringer.tolls > 0 && f.ringer.phase === null && !f.ringer.ringing);
  expect(f.hits.length).toBe(0);
  expect(attempts).toBe(2);   // 고리 두 겹이 각각 한 번씩만 시도
});

test('첫 고리를 맞은 뒤 고리보다 빠르게 바깥으로 달려 빈틈에 올라타면 두 번째 고리는 맞지 않는다', () => {
  const f = fixture(6);
  let ridden = false;
  for (let i = 0; i < 1500 && !(f.ringer.tolls > 0 && f.ringer.phase === null && !f.ringer.ringing); i++) {
    step(f);
    if (f.hits.length === 1) ridden = true;
    if (ridden) f.player.pos.x += 7 * DT;   // 영웅이 고리 속도(5.2)보다 빠르게 바깥으로
  }
  expect(f.hits.length).toBe(1);
});

test('종지기 바로 옆(첫 고리 안쪽)과 최대 반지름 밖은 안전하다', () => {
  const near = fixture(.9);
  until(near, () => near.ringer.tolls > 0 && near.ringer.phase === null && !near.ringer.ringing);
  expect(near.hits.length).toBe(0);
  const far = fixture(BELL.maxRadius + 1.5);
  far.ringer.cd = 0;
  // 사거리 밖에서는 아예 치지 않는다.
  for (let i = 0; i < 200; i++) step(far);
  expect(far.ringer.tolls).toBe(0);
  expect(ringContains(10, 9 * 9)).toBe(true);
  expect(ringContains(10, 7.7 * 7.7)).toBe(false);
  expect(ringContains(10, 10.1 * 10.1)).toBe(false);
});

test('예고 중 기절시키면 종소리가 나기 전에 끊기고 잠시 뒤 다시 친다', () => {
  const f = fixture(8);
  until(f, () => f.ringer.phase === 'toll');
  f.enemy.stun = .5;
  step(f);
  expect(f.ringer.phase).toBeNull();
  expect(f.ringer.interrupted).toBe(1);
  expect(f.ringer.ringing).toBe(false);
  expect(f.enemy.special).toBeNull();
  expect(f.ringer.cd).toBe(BELL.retryCooldown);
  f.enemy.stun = 0;
  until(f, () => f.ringer.phase === 'toll');
  expect(f.ringer.tolls).toBe(2);
});

test('종이 먼저 피해를 받고, 깨지면 주변 적 기절과 종지기 무방비, 이후 종을 치지 못한다', () => {
  const f = fixture(8);
  const neighbour = makeEnemy(f.game, 2, 0); neighbour.hp = 100;
  const far = makeEnemy(f.game, 20, 0);
  const boss = makeEnemy(f.game, 1, 1); boss.isBoss = true;
  f.game.enemies.push(neighbour, far, boss);
  const bell = f.ringer.bellHp;
  expect(bell).toBeCloseTo(1000 * BELL.bellHpRatio);
  // 종이 피해를 흡수하는 동안 종지기 몸에는 닿지 않는다.
  expect(f.ringer.absorb(100)).toBe(0);
  expect(f.ringer.bellHp).toBe(bell - 100);
  until(f, () => f.ringer.phase === 'toll');
  // 깨지는 타격: 종 체력을 넘은 몫만 몸에 닿는다.
  const overflow = f.ringer.absorb(f.ringer.bellHp + 30);
  expect(overflow).toBe(30);
  expect(f.ringer.intact).toBe(false);
  expect(f.ringer.shattered).toBe(1);
  expect(f.ringer.phase).toBeNull();                 // 진행 중이던 예고가 취소된다
  expect(f.enemy.stun).toBeGreaterThanOrEqual(BELL.exposeSeconds);
  expect(neighbour.stun).toBe(BELL.stunSeconds);     // 반경 안 적 2초 기절
  expect(far.stun).toBe(0);                          // 반경 밖은 영향 없음
  expect(boss.stun).toBe(0);                         // 보스는 기절하지 않는다
  expect(f.game.fx.texts).toContain('종 파괴');
  // 무방비: 받는 피해 1.5배, 시간이 지나면 보통 피해.
  expect(f.ringer.absorb(100)).toBe(100 * BELL.exposedDamageMul);
  for (let i = 0; i < 4 * 60; i++) step(f);
  expect(f.ringer.absorb(100)).toBe(100);
  // 종이 없으면 더는 울리지 않는다.
  f.ringer.cd = 0; f.enemy.stun = 0;
  for (let i = 0; i < 600; i++) step(f);
  expect(f.ringer.tolls).toBe(1);
});

test('같은 시드의 두 번 실행은 고리 반경·피해 시각이 같다(결정성)', () => {
  const run = () => {
    const f = fixture(7); const timeline: number[] = [];
    for (let i = 0; i < 900; i++) { step(f); timeline.push(f.ringer.rings[0].r, f.ringer.rings[1].r, f.hits.length); }
    return timeline;
  };
  expect(run()).toEqual(run());
});

test('동시에 고리를 치는 종지기는 최대 maxActive 마리다', () => {
  const f = fixture(8);
  const others = [1, 2].map((i) => { const e = makeEnemy(f.game, 0, i * 3); e.bellringer = new Bellringer(e, () => 0); f.game.enemies.push(e); return e; });
  f.ringer.cd = others[0].bellringer.cd = others[1].bellringer.cd = 0;
  for (const e of [f.enemy, ...others]) e.bellringer.update(DT, 8);
  const tolling = [f.enemy, ...others].filter((e) => e.bellringer.phase === 'toll').length;
  expect(tolling).toBe(BELL.maxActive);
});

test('AUTO 회피용 도달 시간은 예고 남은 시간 + 거리/속도이고 지나간 고리는 무한대다', () => {
  const f = fixture(8);
  until(f, () => f.ringer.phase === 'toll');
  const t0 = f.ringer.impactIn(f.player);
  expect(t0).toBeCloseTo(Math.max(0, BELL.windup - f.ringer.t) + (8 - BELL.startRadius) / BELL.speed, 5);
  until(f, () => f.ringer.rings[0].active);
  const t1 = f.ringer.impactIn(f.player) as number;
  expect(t1).toBeLessThan(t0 as number);
  expect(new Bellringer(makeEnemy(f.game), () => 0).impactIn(f.player)).toBeNull();
  until(f, () => !f.ringer.ringing);
  expect(f.ringer.impactIn(f.player)).toBeNull();
});

test('파티 스냅샷: 종 체력·예고 진행·고리 반경이 검증을 통과하고 게스트 복제본이 같은 모양을 그린다', () => {
  const f = fixture(8);
  f.player.invuln = true;
  const calm = f.ringer.partyState();
  expect(calm).toEqual({ bh: 1 });
  until(f, () => f.ringer.phase === 'toll');
  expect(f.ringer.partyState().ph).toBeGreaterThan(0);
  expect(validPartyWarning(f.ringer.partyWarning('e1'))).toBe(true);
  until(f, () => f.ringer.rings[0].active);
  const state = f.ringer.partyState();
  expect(state.rr).toBeGreaterThanOrEqual(BELL.startRadius);
  const snapshot = {
    tick: 1, elapsed: 1,
    players: [0, 1].map((i) => ({ id: 'p' + i, heroId: 'knight', x: 0, z: 0, yaw: 0, hp: 10, maxHp: 10, state: 'idle', anim: 'Idle', ult: 0, cds: [0, 0, 0, 0] })),
    enemies: [{ id: 'e1', key: 'bell_ringer', x: 0, z: 0, yaw: 0, hp: 10, maxHp: 10, state: 'chase', anim: 'Idle', boss: false, elite: false, ...state }],
    rooms: [{ id: 0, discovered: true, cleared: false, activated: true }], roomsCleared: 0, bossDefeated: false, portal: null, events: [],
  };
  expect(validPartySnapshot(snapshot)).toBe(true);
  expect(validPartySnapshot({ ...snapshot, enemies: [{ ...snapshot.enemies[0], rr: 99 }] })).toBe(false);
  expect(validPartySnapshot({ ...snapshot, enemies: [{ ...snapshot.enemies[0], bh: 2 }] })).toBe(false);
  // 게스트: 호스트 값으로 복제본이 종·고리를 그린다. 같은 스냅샷이 여러 프레임 보이면 고리는 속도로 이어진다.
  const guest = fixture(30);
  const item = { bh: .5, rr: 4, rs: 0 };
  guest.ringer.applyParty(item, DT);
  expect(guest.ringer.bellHp).toBeCloseTo(guest.ringer.bellMax * .5);
  expect(guest.ringer.rings[0].mesh!.visible).toBe(true);
  expect(guest.ringer.rings[0].mesh!.scale.x).toBeCloseTo(4);
  guest.ringer.applyParty(item, .1);
  expect(guest.ringer.rings[0].mesh!.scale.x).toBeCloseTo(4 + BELL.speed * .1);
  guest.ringer.applyParty({ bh: 0 }, DT);
  expect(guest.ringer.rings[0].mesh!.visible).toBe(false);
  expect(guest.ringer.bell!.visible).toBe(false);
});

test('종지기가 죽거나 전투가 끝나면 고리를 거두고 시각 자원을 해제한다', () => {
  const f = fixture(8);
  f.player.invuln = true;
  until(f, () => f.ringer.rings[0].active);
  f.game.active = false;
  step(f);
  expect(f.ringer.ringing).toBe(false);
  expect(f.ringer.rings[0].mesh!.visible).toBe(false);
  const scene = f.game.scene as THREE.Scene;
  const before = scene.children.length;
  f.ringer.dispose();
  expect(scene.children.length).toBe(before - 2);
  expect(f.enemy.root.children.length).toBe(0);
  f.ringer.dispose();   // 두 번 불러도 안전
});

// ---------- 실제 Enemy · Player 통합 ----------
import { enemyImpactIn, enemyPartyWarnings } from '../src/game/enemies.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

function realFixture(distance = 7) {
  const f: any = createCombatFlowFixture(runtime);
  const enemy: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z, { id: 'bell_ringer', partyId: 'bell-1' });
  enemy.bellringer = new Bellringer(enemy, () => 0);
  enemy.packId = 1;
  f.player.pos.set(enemy.pos.x + distance, 0, enemy.pos.z);
  f.player.hp = f.player.maxHp = 1e9;
  return { f, enemy };
}

test('실제 Enemy 에서: 예고 중 제자리에 서고, AUTO 도달 시간이 유한하며, 파티 경고가 나가고, 고리가 실제 Player 를 친다', () => {
  const { f, enemy } = realFixture(7);
  let frames = 0, warnedRing = false, finite = false;
  while (frames++ < 600 && !(enemy.bellringer.tolls > 0 && !enemy.bellringer.busy)) {
    stepCombatFlow(f, 1 / 60);
    if (enemy.bellringer.phase === 'toll') {
      expect(enemy.state).toBe('chase');
      expect(enemy.vel.length()).toBe(0);
      const warning = enemyPartyWarnings(enemy)[0];
      if (warning) { warnedRing = warning.kind === 'ring' && validPartyWarning(warning); }
      finite ||= Number.isFinite(enemyImpactIn(enemy, f.player));
    }
  }
  expect(warnedRing).toBe(true);
  expect(finite).toBe(true);
  expect(enemy.bellringer.hits).toBe(2);
  expect(f.events.incoming.filter((hit: any) => hit.kb === BELL.knockback)).toHaveLength(2);
  expect(f.events.damageTaken).toBeGreaterThan(0);
});

test('실제 Enemy.hurt: 종이 피해를 먼저 받아 몸 체력이 그대로이고, 깨지면 무방비로 체력이 깎이며, 기절 타격은 예고를 끊는다', () => {
  const { f, enemy } = realFixture(7);
  const bellHp = enemy.bellringer.bellHp;
  enemy.hurt(bellHp * .5, { kb: 0 });
  expect(enemy.hp).toBe(enemy.maxHp);
  expect(enemy.bellringer.bellHp).toBeCloseTo(bellHp * .5);
  // 예고 시작 후 기절 타격이 즉시 끊는다.
  for (let i = 0; i < 400 && enemy.bellringer.phase !== 'toll'; i++) stepCombatFlow(f, 1 / 60);
  expect(enemy.bellringer.phase).toBe('toll');
  enemy.hurt(1, { kb: 0, stun: .6 });
  expect(enemy.bellringer.phase).toBeNull();
  expect(enemy.bellringer.interrupted).toBe(1);
  // 종을 깨는 타격.
  const neighbour: any = spawnCombatFlowEnemy(f, enemy.pos.x + 2, enemy.pos.z, { id: 'skel_minion' });
  enemy.hurt(enemy.bellringer.bellHp + 10, { kb: 0 });
  expect(enemy.bellringer.intact).toBe(false);
  expect(neighbour.stun).toBeGreaterThanOrEqual(BELL.stunSeconds - 1e-9);
  expect(enemy.hp).toBeLessThan(enemy.maxHp);        // 넘친 피해 10 은 몸에 닿는다
  const before = enemy.hp;
  enemy.hurt(100, { kb: 0 });
  expect(before - enemy.hp).toBeGreaterThan(100 * (1 - (enemy.def.armor || 0)) * 1.4);   // 무방비 1.5배
});
