import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Floor } from '../src/game/world.js';
import { PACK, Pack, PursuitField, alertPack, escapeWall, lineClear, packNoise, planRoomPacks, updatePursuit } from '../src/game/pack-pursuit.js';
import { Battle } from '../src/game/battle-base.js';
import { DropSystem } from '../src/game/drops.js';
import { loadCrowdFlowRuntime, runCrowdFlow } from '../tools/crowd-flow-sim.mjs';

// 시작방(0)과 일반방(1)이 폭 6 복도 하나로만 이어지는 실제 Floor. 복도 띠 밖의 두 방 사이는 벽이다.
const floor = () => new Floor(1, 'garden', 7, { spacing: [24, 24], size: [16, 16], width: 6,
  cells: [[0, 0], [1, 0], [3, 0]], edges: [[0, 1], [1, 2]], types: ['start', 'normal', 'boss'] } as any);
const mob = (world: any, x: number, z: number, extra: any = {}) => ({ alive: true, spawning: false, isBoss: false, isElite: false,
  def: { spd: 4.6, ranged: false }, pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), radius: .7, state: 'chase', ...extra });
const gameOf = (world: any, player: any, enemies: any[] = []) => ({ world, player, enemies, elapsed: 0, stage: {}, fx: { ring() {} } });

test('시야가 벽에 막힌 경계 무리는 감지 거리 안이어도 깨어나지 않고, 열린 시야에서는 무리 전체가 순서대로 반응한다', () => {
  const world = floor(), A = world.rooms[0], B = world.rooms[1];
  // 마주 본 두 방의 벽 쪽 가장자리, 복도 띠(A.z±3) 바깥: 직선거리는 감지 거리 안이지만 사이가 벽이다.
  const z = A.z + 5.5;
  const enemy = mob(world, B.x - B.w / 2 + .6, z), mate = mob(world, enemy.pos.x + 1.2, enemy.pos.z - .4);
  const player = { alive: true, pos: new THREE.Vector3(A.x + A.w / 2 - .6, 0, z), stats: { spd: 6.2 } };
  expect(world.walkable(enemy.pos.x, enemy.pos.z) && world.walkable(player.pos.x, player.pos.z)).toBe(true);
  expect(Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.z - player.pos.z)).toBeLessThan(PACK.sight);
  expect(lineClear(world, enemy.pos.x, enemy.pos.z, player.pos.x, player.pos.z)).toBe(false);
  const pack = new Pack(B, enemy.pos.x, enemy.pos.z);
  for (const e of [enemy, mate]) { (e as any).pack = pack; pack.members.push(e); }
  const game = gameOf(world, player, [enemy, mate]), route = { x: 0, z: 0, pace: 1, los: true };
  for (let i = 0; i < 30; i++) { game.elapsed += 1 / 60; expect(updatePursuit(enemy, game, player, 5, 1 / 60, route)).toBe(false); }
  expect(pack.aggro).toBe(false);
  // 같은 방 안으로 들어서면 시야가 열린다. 감지한 적은 즉시, 동료는 정해진 반응 간격 뒤에 움직인다.
  player.pos.set(enemy.pos.x + 6, 0, B.z);
  game.elapsed += 1 / 60;
  expect(updatePursuit(enemy, game, player, 6.7, 1 / 60, route)).toBe(true);
  expect(pack.aggro).toBe(true);
  expect((mate as any).reactT).toBeCloseTo(PACK.reactStep);
});

test('경보와 피격 소리는 시야가 닿는 이웃 무리에만 번지고 벽 너머 무리는 끌어오지 않는다', () => {
  const world = floor(), A = world.rooms[0], B = world.rooms[1];
  const a = mob(world, B.x - 3, B.z), b = mob(world, B.x + 5, B.z + 2), hidden = mob(world, A.x + 3, A.z + 3);
  const packs = [a, b, hidden].map(e => { const p = new Pack(B, e.pos.x, e.pos.z); (e as any).pack = p; p.members.push(e); return p; });
  expect(Math.hypot(a.pos.x - hidden.pos.x, a.pos.z - hidden.pos.z)).toBeGreaterThan(PACK.noiseRadius);
  const near = mob(world, B.x - B.w / 2 + 1.5, B.z - B.h / 2 + 1.5);
  const wallPack = new Pack(B, near.pos.x, near.pos.z); (near as any).pack = wallPack; wallPack.members.push(near);
  const game = gameOf(world, { alive: true, pos: new THREE.Vector3(B.x, 0, B.z) }, [a, b, hidden, near]);
  packNoise(game, a);
  expect(packs[0].aggro).toBe(true); expect(packs[1].aggro).toBe(true); expect(packs[2].aggro).toBe(false);
  // 같은 적의 소리는 0.5초 안에 다시 퍼뜨리지 않는다.
  const before = wallPack.aggro; packNoise(game, a); expect(wallPack.aggro).toBe(before);
  expect(alertPack(game, packs[0], a)).toBe(false);
});

test('경로 거리장은 벽을 돌아 복도로 안내하고 같은 목표 셀에서는 다시 퍼뜨리지 않는다', () => {
  const world = floor(), A = world.rooms[0], B = world.rooms[1];
  const field = new PursuitField(world);
  expect(field.seed(A.x, A.z)).toBe(true);
  const gen = field.gen; field.seed(A.x + .2, A.z + .2); expect(field.gen).toBe(gen);
  // B 방 구석에서 경로를 따라 내려가면 직선(벽)이 아니라 복도를 지나 시작방에 닿는다.
  const pos = { x: B.x - 4, z: B.z - 4 }, out = { x: 0, z: 0 };
  let last = field.distanceAt(pos.x, pos.z), steps = 0;
  expect(last).toBeGreaterThan(Math.hypot(B.x - A.x, B.z - A.z));
  while (last > 2 && steps++ < 400) {
    expect(field.step(pos.x, pos.z, out)).toBe(true);
    pos.x += out.x * .5; pos.z += out.z * .5;
    expect(world.walkable(pos.x, pos.z)).toBe(true);
    const now = field.distanceAt(pos.x, pos.z); expect(now).toBeLessThanOrEqual(last); last = now;
  }
  expect(last).toBeLessThanOrEqual(2);
  // 반경 밖은 -1 이라 끝없는 추격 대신 추적 상실로 처리된다.
  const short = new PursuitField(world, 8); short.seed(A.x, A.z);
  expect(short.distanceAt(B.x, B.z)).toBe(-1);
});

test('방 무리 앵커는 입구 반대편에서 서로 떨어져 있고 벽 속 중심은 가장 가까운 바닥으로 보정된다', () => {
  const world = floor(), B = world.rooms[1];
  const entry = { x: B.x - B.w / 2, z: B.z }, packs = planRoomPacks(world, B, 13, entry.x, entry.z)!;
  expect(packs.length).toBe(3);
  for (const p of packs) { expect(Math.hypot(p.x - entry.x, p.z - entry.z)).toBeGreaterThanOrEqual(7); expect(world.walkable(p.x, p.z)).toBe(true); }
  expect(packs[0].x).toBeGreaterThan(B.x);
  for (let i = 0; i < packs.length; i++) for (let j = i + 1; j < packs.length; j++) expect(Math.hypot(packs[i].x - packs[j].x, packs[i].z - packs[j].z)).toBeGreaterThan(5);
  const stuck = new THREE.Vector3(B.x, 0, B.z + B.h / 2 + 1.2);
  expect(world.walkable(stuck.x, stuck.z)).toBe(false);
  expect(escapeWall(world, stuck)).toBe(true); expect(world.walkable(stuck.x, stuck.z)).toBe(true);
  expect(Math.hypot(stuck.x - B.x, stuck.z - (B.z + B.h / 2 + 1.2))).toBeLessThan(3.2);
});

test('몰이 졸개는 처치 보상·의뢰 처치 수를 늘리지 않는다', () => {
  const spawned: any[] = [];
  const drops = Object.assign(Object.create(DropSystem.prototype), { game: { stage: {} }, spawn: (...a: any[]) => spawned.push(a) });
  DropSystem.prototype.onKill.call(drops, { packFollower: true, def: { gold: 3 }, pos: new THREE.Vector3() }, { scale: 1 });
  expect(spawned).toHaveLength(0);
  const quests = { kills: 0 }, e: any = { isBoss: false, isElite: false, homeRoom: null, pos: new THREE.Vector3(), alive: false, packFollower: true };
  const g: any = { conquest: null, kills: 0, waveKilled: 0, player: { alive: true, addUlt() {}, addMp() {} }, sp: null, hasProc: () => false,
    stage: {}, app: { eco: { s: { quests } } }, ui: { setKillStreak() {}, toast() {} }, drops: { onKill() {} },
    fx: { burst() {}, dustPuff() {}, explosion() {}, killConfirm() {} }, renderer: { shake() {} }, pending: [], active: true, enemies: [e], after() {}, elapsed: 0 };
  Battle.prototype.onEnemyDeath.call(g, e);
  expect(quests.kills).toBe(0); expect(g.kills).toBe(1);
});

test('예약 생성이 남은 방은 먼저 선 적을 모두 잡아도 닫히지 않고, 마지막 예약이 취소돼도 결국 닫힌다', () => {
  const room: any = { id: 1, type: 'normal', cleared: false, spawnsDue: 2 };
  const cleared: any[] = [];
  const g: any = { active: true, enemies: [], pending: [], markCleared: (r: any) => { r.cleared = true; cleared.push(r); } };
  Battle.prototype.settleRoomSpawn.call(g, room); expect(cleared).toHaveLength(0);
  g.enemies.push({ alive: true, homeRoom: room });
  Battle.prototype.settleRoomSpawn.call(g, room); expect(cleared).toHaveLength(0);
  g.enemies[0].alive = false; room.spawnsDue = 1;
  Battle.prototype.settleRoomSpawn.call(g, room); expect(cleared).toEqual([room]);
});

const runtime = await loadCrowdFlowRuntime();
test('실제 방 흐름: 벽 모서리 직선 추격 고착 없이 원정을 끝내고, 원정 방은 무리 단위로 함께 붙는다', () => {
  // b069872 에서 이 시드의 오크 전사는 시작방 쪽 벽 모서리로 직선 추격하다 멈췄다(플레이어가 돌아갈 때까지 방 정화가 막힘).
  const stuck = runCrowdFlow(runtime, { route: 'ember_vault', hero: 'mage', auto: false, seconds: 240 });
  expect(stuck.victory).toBe(true); expect(stuck.stuckEnemies).toBe(0); expect(stuck.allEnemiesWalkable).toBe(true);
  const pack = runCrowdFlow(runtime, { route: 'bellfall_crypt', hero: 'knight', auto: true, seconds: 300 });
  expect(pack.victory).toBe(true);
  expect(pack.maxEngaged).toBeGreaterThanOrEqual(10);
  expect(pack.packKillRatio).toBeGreaterThan(.5);
  expect(pack.soloKillRatio).toBeLessThan(.2);
});
