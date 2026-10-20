import { afterEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Input } from '../src/engine/input.js';
import { Player, RANGER_DODGE_SHOT_AT } from '../src/game/player.js';
import { RangerAim, aimTargetValid, clearShot } from '../src/game/ranger-aim.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

// 수동 궁수 조준 보조 — 단위(RangerAim)와 실제 Player·Floor·투사체 시계 통합.
const runtime = await loadCombatFlowRuntime();
const players: Player[] = [];
afterEach(() => { for (const player of players.splice(0)) player.dispose(); });

const enemy = (x: number, z: number, extra: any = {}) => ({ alive: true, spawning: false, radius: .5, pos: new THREE.Vector3(x, 0, z), ...extra });
const shooterAt = (enemies: any[], world: any = null) => ({ pos: new THREE.Vector3(), game: { enemies, world } });
const wallAtX = (x0: number, x1: number) => ({ walkable: (x: number) => !(x >= x0 && x <= x1) });

test('가장 가까운 유효 대상을 고르고, 기존 대상은 유효한 동안 유지한다', () => {
  const near = enemy(0, 4), far = enemy(5, 0), aim = new RangerAim(), shooter = shooterAt([far, near]);
  expect(aim.select(shooter, 12)).toBe(near);
  far.pos.set(1, 0, 0);                       // 더 가까운 적이 생겨도 잠금 유지(대상 튐 방지)
  expect(aim.select(shooter, 12)).toBe(near);
  near.pos.set(0, 0, 12.4);                   // 몸 반경 포함 사거리 12 안 → 유지
  expect(aim.select(shooter, 12)).toBe(near);
  near.pos.set(0, 0, 12.6);                   // 사거리 밖 → 유지하지 않고 다음 대상(사거리 밖 잠금 여유 없음)
  expect(aim.select(shooter, 12)).toBe(far);
});

test('적 목록에서 빠진 대상(소멸·방 교체)은 살아 있어도 잠금을 유지하지 않는다', () => {
  const held = enemy(0, 3), other = enemy(0, 6), aim = new RangerAim(), game = { enemies: [held, other], world: null };
  const shooter = { pos: new THREE.Vector3(), game };
  expect(aim.select(shooter, 12)).toBe(held);
  game.enemies = [other];
  expect(aim.select(shooter, 12)).toBe(other);
  game.enemies = [];
  expect(aim.select(shooter, 12)).toBeNull(); expect(aim.target).toBeNull();
});

test('사망·등장 중·무적·사거리 밖·벽 너머는 대상이 아니며, 없으면 null 이다', () => {
  const aim = new RangerAim();
  for (const bad of [enemy(0, 3, { alive: false }), enemy(0, 3, { spawning: true }), enemy(0, 3, { invuln: .3 }), enemy(0, 12.6)]) {
    expect(aimTargetValid(shooterAt([bad]), bad, 12)).toBe(false);
    expect(aim.select(shooterAt([bad]), 12)).toBeNull();
  }
  const hidden = enemy(6, 0), wall = wallAtX(2.5, 3.5);
  expect(clearShot(wall, 0, 0, 6, 0)).toBe(false);
  expect(clearShot(wall, 0, 0, 0, 6)).toBe(true);
  expect(aim.select(shooterAt([hidden], wall), 12)).toBeNull();
  const visible = enemy(0, 9);
  expect(aim.select(shooterAt([hidden, visible], wall), 12)).toBe(visible);
  // 잠긴 대상이 벽 뒤로 들어가면 잠금을 푼다.
  const lockAim = new RangerAim(), walker = enemy(1.5, 0), shooter = shooterAt([walker], wall);
  expect(lockAim.select(shooter, 12)).toBe(walker);
  walker.pos.set(6, 0, 0); expect(lockAim.select(shooter, 12)).toBeNull();
});

test('같은 거리 동률은 적 목록 순서로 결정되고 반복해도 같다', () => {
  const a = enemy(3, 0), b = enemy(-3, 0), c = enemy(0, 3);
  for (let i = 0; i < 5; i++) expect(new RangerAim().select(shooterAt([a, b, c]), 12)).toBe(a);
  expect(new RangerAim().select(shooterAt([c, b, a]), 12)).toBe(c);
});

// ---- 실제 Player (dodge-buffer 테스트와 같은 생성 경로, GLB 대신 빈 클립) ----
function ranger(heroId = 'ranger') {
  const f: any = createCombatFlowFixture(runtime, heroId);
  f.game.fx.aura = () => {};
  const input: any = Object.assign(Object.create(Input.prototype), {
    enabled: true, move: { x: 0, y: 0 }, screenMove: { x: 0, y: 0 }, queue: [],
    attackHeld: false, attackSources: new Set(), clearListeners: new Set(), keys: {},
    gamepadMove: { x: 0, y: 0 }, gamepadButtons: new Uint8Array(8), gamepadConnected: false,
    joy: { active: false, id: null }, el: { knob: { style: {} }, base: { style: {} } },
  });
  f.game.input = input; f.game.pauseReasons = new Set(); f.game.sp = null;
  f.game.scene.remove(f.player.root);
  const def = f.player.def, position = f.player.pos.clone();
  const names = new Set(['Idle', 'Running_A', 'Dodge_Forward', 'Dodge_Backward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B',
    ...def.combo.map((c: any) => c.anim), ...def.skills.map((s: any) => s.anim).filter(Boolean)]);
  const gltf = { scene: new THREE.Group(), animations: [...names].map(name => new THREE.AnimationClip(name, 1, [])) };
  f.player = f.game.player = new Player(f.game, gltf, def, f.player.stats);
  f.player.pos.copy(position);
  players.push(f.player);
  return f;
}
const dt = 1 / 60;
const step = (f: any, n = 1) => { for (let i = 0; i < n; i++) stepCombatFlow(f, dt); };
const yawTo = (p: any, e: any) => Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const arrows = (f: any) => f.game.projectiles.filter((p: any) => p.owner === f.player);
function untilRelease(f: any) { for (let i = 0; i < 120 && !f.player.hitDone; i++) step(f); expect(f.player.hitDone).toBe(true); }

test('측면 이동 중 공격: 이동 방향과 무관하게 왼쪽 적을 조준해 화살 1발을 쏘고 계속 이동한다', () => {
  const f = ranger(), p: any = f.player, room = f.room;
  const target = spawnCombatFlowEnemy(f, room.x - 5, room.z, { atkCd: 99 });
  p.yaw = 0;
  f.game.input.move.z = 0; f.game.input.move.x = 1; f.game.input.move.y = 0;   // 오른쪽(+x)으로 이동
  step(f, 20);
  expect(p.state).toBe('move');
  f.game.input.press('attack'); step(f);
  expect(p.state).toBe('attack');
  expect(angle(p.yaw, yawTo(p, target))).toBeLessThan(.02);
  const x0 = p.pos.x;
  untilRelease(f);
  const shot = arrows(f);
  expect(shot).toHaveLength(1);
  expect(shot[0].dir.x).toBeLessThan(-.99);       // 이동 방향(+x)의 반대편 대상
  expect(p.pos.x).toBeGreaterThan(x0 + .1);        // 사격 중에도 실제로 이동했다
  expect(angle(p.yaw, yawTo(p, target))).toBeLessThan(.05);
  expect(p.lockTarget).toBe(target);
});

test('후퇴 사격: 적에게서 멀어지며 쏘고 다리 층은 뒷걸음으로 돈다. 사격이 끝나면 다리 층을 끈다', () => {
  const f = ranger(), p: any = f.player, room = f.room;
  const target = spawnCombatFlowEnemy(f, room.x, room.z + 5, { atkCd: 99 });
  f.game.input.move.x = 0; f.game.input.move.y = -1;      // -z 로 후퇴
  f.game.input.press('attack'); step(f);
  expect(p.state).toBe('attack'); expect(p.actionName).toBe('RangerBowUpper');
  const z0 = p.pos.z;
  step(f, 10);
  expect(p.pos.z).toBeLessThan(z0 - .1);
  expect(p._bowLegs.on).toBe(true); expect(p._bowLegs.run.timeScale).toBeLessThan(0);
  untilRelease(f);
  expect(arrows(f)[0].dir.z).toBeGreaterThan(.99);
  for (let i = 0; i < 120 && p.state === 'attack'; i++) step(f);
  expect(p.state).not.toBe('attack'); step(f);
  expect(p._bowLegs.on).toBe(false);
  expect(target.alive || target.hp < target.maxHp).toBe(true);
});

test('발사 전에 대상이 죽으면 다른 유효 대상으로, 없으면 현재 방향으로 쏘며 위치를 옮기지 않는다', () => {
  const f = ranger(), p: any = f.player, room = f.room;
  const first = spawnCombatFlowEnemy(f, room.x + 4, room.z, { atkCd: 99 });
  const second = spawnCombatFlowEnemy(f, room.x, room.z - 6, { atkCd: 99 });
  f.game.input.press('attack'); step(f);
  expect(p.rangerAim.target).toBe(first);
  first.alive = false;
  untilRelease(f);
  expect(arrows(f)[0].dir.z).toBeLessThan(-.99);   // second 방향
  expect(p.rangerAim.target).toBe(second);
  // 대상이 전혀 없으면 마지막 방향 유지
  const g = ranger(), q: any = g.player;
  const lone = spawnCombatFlowEnemy(g, g.room.x + 4, g.room.z, { atkCd: 99 });
  g.game.input.press('attack'); step(g);
  const yaw = q.yaw, at = q.pos.clone(); lone.alive = false;
  untilRelease(g);
  expect(angle(q.yaw, yaw)).toBeLessThan(1e-9);
  expect(q.pos.distanceTo(at)).toBeLessThan(1e-6);
  expect(arrows(g)[0].dir.x).toBeGreaterThan(.99);
});

test('대상이 없으면 기존 방향(이동 입력이 있으면 그 입력 방향)으로 쏘고 AUTO 로 바뀌지 않는다', () => {
  const f = ranger(), p: any = f.player;
  p.yaw = Math.PI / 2;
  f.game.input.press('attack'); step(f);
  expect(p.auto).toBe(false); expect(p.lockTarget).toBeNull();
  expect(angle(p.yaw, Math.PI / 2)).toBeLessThan(1e-9);
  untilRelease(f);
  expect(arrows(f)).toHaveLength(1); expect(arrows(f)[0].dir.x).toBeGreaterThan(.99);
  // 사거리 밖 적은 무시한다
  const g = ranger(), q: any = g.player;
  spawnCombatFlowEnemy(g, g.room.x, g.room.z + 30, { atkCd: 99 });
  q.yaw = 0; g.game.input.press('attack'); step(g);
  expect(q.rangerAim.target).toBeNull(); expect(q.yaw).toBe(0);
});

test('벽 너머 적은 조준하지 않는다(실제 원정 Floor 보행 마스크)', () => {
  const f = ranger(), p: any = f.player, W = f.game.world;
  // 사거리 안에서 보행 가능하지만 직선 시야가 벽에 막힌 지점을 실제 마스크에서 찾는다.
  let behind: THREE.Vector3 | null = null;
  const roomy = (x: number, z: number) => W.walkable(x, z) && W.walkable(x + .6, z) && W.walkable(x - .6, z) && W.walkable(x, z + .6) && W.walkable(x, z - .6);
  for (let sz = W.minZ + 1; sz < W.minZ + W.rows && !behind; sz += 2) for (let sx = W.minX + 1; sx < W.minX + W.cols && !behind; sx += 2) {
    if (!roomy(sx, sz)) continue;
    for (let dz = -9; dz <= 9 && !behind; dz += 1) for (let dx = -9; dx <= 9 && !behind; dx += 1) {
      const x = sx + dx, z = sz + dz;
      if (Math.hypot(dx, dz) < 9 && roomy(x, z) && !clearShot(W, sx, sz, x, z, .5)) { p.pos.set(sx, 0, sz); behind = new THREE.Vector3(x, 0, z); }
    }
  }
  expect(behind).not.toBeNull();
  const hidden = spawnCombatFlowEnemy(f, behind!.x, behind!.z, { atkCd: 99 });
  expect(clearShot(W, p.pos.x, p.pos.z, hidden.pos.x, hidden.pos.z, hidden.radius)).toBe(false);
  p.yaw = 0; f.game.input.press('attack'); step(f);
  expect(p.rangerAim.target).toBeNull(); expect(p.yaw).toBe(0);
});

test('사격 준비 중 대상이 벽 뒤로 숨으면 그쪽으로 돌지 않고, 마지막 유효 방향으로 쏘아 숨은 대상을 맞히지 않는다', () => {
  // fresh ranger 리뷰 P2-2 재현(wall-track-probe)의 회귀. 투사체는 원래 벽을 검사하지 않으므로 조준 추적이 막아야 한다.
  const f: any = ranger(), p: any = f.player, w = f.game.world, base = w.walkable.bind(w);
  const px = p.pos.x, pz = p.pos.z; let wallOn = false;
  w.walkable = (x: number, z: number) => (wallOn && x - px > 2.5 && x - px < 3.5 && z - pz > .5 ? false : base(x, z));
  const e: any = spawnCombatFlowEnemy(f, px + 6, pz, { atkCd: 999, stun: 999 });
  const pin = e.pos.clone(); p.yaw = Math.PI;
  f.game.input.press('attack');
  const hp0 = e.hp; let validYaw = NaN, dir: any = null;
  for (let i = 0; i < 90; i++) {
    if (i === 3) { validYaw = p.yaw; wallOn = true; pin.set(px + 6, 0, pz + 3); }   // 발사 전 벽 뒤로 옆걸음
    e.pos.copy(pin); e.stun = 999;
    step(f);
    const a = arrows(f)[0]; if (a && !dir) dir = { x: a.dir.x, z: a.dir.z };
  }
  expect(angle(validYaw, Math.PI / 2)).toBeLessThan(.02);
  expect(dir).not.toBeNull();
  const shot = Math.atan2(dir.x, dir.z);
  expect(angle(shot, Math.atan2(6, 3))).toBeGreaterThan(.2);   // 숨은 대상 방향이 아니다
  expect(angle(shot, validYaw)).toBeLessThan(.05);              // 마지막 유효 방향
  expect(e.hp).toBe(hp0);
  expect(p.rangerAim.target).toBeNull(); expect(p.lockTarget).not.toBe(e);
});
test('회피 중 공격 입력은 회피 0.16초 뒤 사격으로 이어지고 회피 속도를 이어 받는다', () => {
  const f = ranger(), p: any = f.player, room = f.room;
  const target = spawnCombatFlowEnemy(f, room.x, room.z + 6, { atkCd: 99 });
  f.game.input.move.x = 1; f.game.input.press('dodge'); step(f);
  expect(p.state).toBe('dodge');
  f.game.input.press('attack'); step(f);
  expect(p.state).toBe('dodge');            // 너무 이른 입력은 버퍼로 보존
  for (let i = 0; i < 30 && p.state === 'dodge'; i++) step(f);
  expect(p.state).toBe('attack');
  expect(p.stateT).toBeLessThan(.05);
  expect(Math.hypot(p.vel.x, p.vel.z)).toBeGreaterThan(1);   // 굴러가던 속도를 유지한 채 사격
  expect(angle(p.yaw, yawTo(p, target))).toBeLessThan(.05);
  expect(RANGER_DODGE_SHOT_AT).toBeLessThan(.32);
  untilRelease(f);
  expect(arrows(f)).toHaveLength(1);
});

test('AUTO 궁수와 근접 영웅은 기존 경로(autoAim·정지·전신 클립)를 그대로 쓴다', () => {
  const f = ranger(), p: any = f.player;
  spawnCombatFlowEnemy(f, f.room.x + 4, f.room.z, { atkCd: 99 });
  p.auto = true; p.vel.set(3, 0, 0);
  p.startCombo(0);
  expect(p.actionName).toBe('Bow_Shoot'); expect(p.vel.length()).toBe(0);
  expect(angle(p.yaw, Math.PI / 2)).toBeLessThan(.02);
  const k = ranger('knight'), q: any = k.player;
  // 근접 수동 경로(입력 방향 유지·정지)는 자동 타겟팅을 끈 설정의 계약이다(2026-10-19 기본값 변경).
  k.game.app.eco = { s: { settings: { autoTarget: false } } };
  spawnCombatFlowEnemy(k, k.room.x - 3, k.room.z, { atkCd: 99 });
  expect(q.rangerAim).toBeNull();
  q.vel.set(2, 0, 0); q.startCombo(0, .7);
  expect(q.yaw).toBe(.7); expect(q.vel.length()).toBe(0);
});

test('같은 입력·같은 배치의 이동 사격은 반복 실행에서 같은 결과를 낸다(리플레이 결정성)', () => {
  // 적 AI·피격 연출의 기존 난수는 combat-flow-sim 과 같은 고정 시드로 재현한다. 조준 보조는 난수를 쓰지 않는다.
  const seeded = (seed: number) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
  const run = () => {
    const original = Math.random; Math.random = seeded(20261015);
    try {
    const f = ranger(), p: any = f.player, room = f.room, log: number[] = [];
    spawnCombatFlowEnemy(f, room.x - 4, room.z + 3, { atkCd: 99 });
    spawnCombatFlowEnemy(f, room.x + 4, room.z + 3, { atkCd: 99 });
    for (let frame = 0; frame < 240; frame++) {
      f.game.input.move.x = Math.sin(frame / 30); f.game.input.move.y = Math.cos(frame / 45) * .5;
      if (frame % 20 === 0) f.game.input.press('attack');
      if (frame === 90) f.game.input.press('dodge');
      step(f);
      log.push(+p.pos.x.toFixed(6), +p.pos.z.toFixed(6), +p.yaw.toFixed(6));
    }
    return { log, shots: arrows(f).map((a: any) => a.dir.toArray().map((v: number) => +v.toFixed(6))) };
    } finally { Math.random = original; }
  };
  const a = run(), b = run();
  expect(a.log).toEqual(b.log); expect(a.shots).toEqual(b.shots);
  expect(a.shots.length).toBeGreaterThan(0);
});
