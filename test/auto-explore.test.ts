import { expect, test } from 'bun:test';
import { Player } from '../src/game/player.js';

test('이전 던전 방이 미정화 상태여도 새 던전의 목표로 쓰지 않는다', () => {
  const cleared = { x: 0, z: 0, cleared: true };
  const next = { x: 20, z: 10, cleared: false };
  const oldRoom = { x: 0, z: 0, cleared: false };
  const game = {
    autoTarget: oldRoom, portal: null,
    world: { rooms: [cleared, next], bossRoom: null, sealed: false, buildFlow: (x: number, z: number) => [x, z], flowDir: () => [1, 0] },
  };
  const player = { game, pos: { x: 0, z: 0 } };
  expect(Player.prototype.autoExplore.call(player, 1 / 60)).toEqual({ x: 1, y: 0 });
  expect(game.autoTarget).toBe(next);
});

function autoEnemy(x: number, z: number, extra: any = {}) {
  return { alive: true, spawning: false, isBoss: false, isElite: false, telegraph: 0,
    hp: 100, maxHp: 100, pos: { x, z }, ...extra,
    distTo(other: any) { return Math.hypot(this.pos.x - other.pos.x, this.pos.z - other.pos.z); } };
}

function autoFixture(enemies: any[]) {
  const requests: string[] = [];
  const game: any = { enemies, stage: {}, world: null, input: { press(key: string) { requests.push(key); } } };
  const player = Object.assign(Object.create(Player.prototype), {
    game, pos: { x: 0, z: 0 }, state: 'idle', hitDone: false, dodgeCd: 0,
    def: { ranged: false, skills: [] }, heroLevel: 1, skillLoadout: [4, 5], cds: [],
    hp: 100, maxHp: 100, mp: 100, ult: 0, ultMax: 100, _autoHubCounts: [],
  });
  return { game, player, step() {
    requests.length = 0;
    return { move: Player.prototype.autoMove.call(player, 1 / 60), requests: requests.slice() };
  } };
}

test('AUTO는 보스·정예 가중치가 높은 무리로 이동하고 표적 선택에 난수를 쓰지 않는다', () => {
  const savedRandom = Math.random;
  Math.random = () => { throw new Error('표적 선택이 게임 난수를 소비했다'); };
  try {
    const boss = autoEnemy(0, 8, { isBoss: true, isElite: true });
    const f = autoFixture([autoEnemy(6, 0), autoEnemy(6, 1), autoEnemy(7, 0), boss]);
    expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
    boss.isBoss = false; boss.isElite = false;
    expect(f.step()).toEqual({ move: { x: 1, y: 0 }, requests: [] });
    const elite = autoEnemy(0, 6, { isElite: true });
    f.game.enemies = [autoEnemy(8, 0), autoEnemy(8, 1), elite];
    expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
    elite.isElite = false;
    expect(f.step()).toEqual({ move: { x: 1, y: 0 }, requests: [] });
  } finally { Math.random = savedRandom; }
});

test('AUTO의 정확히 4m인 이웃은 제외하고 같은 점수는 현재 roster의 첫 적을 고른다', () => {
  const first = autoEnemy(-3, 0), north = autoEnemy(0, 3), edge = autoEnemy(4, 3);
  const f = autoFixture([first, north, edge]);
  expect(f.step()).toEqual({ move: { x: -1, y: 0 }, requests: [] });
  f.game.enemies = [north, first, edge];
  expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
  f.game.enemies = [first, north, edge]; edge.pos.x = 3.999;
  expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
  edge.pos.x = 4.001;
  expect(f.step()).toEqual({ move: { x: -1, y: 0 }, requests: [] });
});

test('AUTO는 사망·등장·이동·roster 축소 뒤 다음 프레임의 실제 무리를 다시 고른다', () => {
  const east = autoEnemy(3, 0), north = autoEnemy(0, 3), support = autoEnemy(0, 3.5);
  const f = autoFixture([east, north, support]);
  expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
  support.alive = false;
  expect(f.step()).toEqual({ move: { x: 1, y: 0 }, requests: [] });
  support.alive = true; support.spawning = true;
  expect(f.step()).toEqual({ move: { x: 1, y: 0 }, requests: [] });
  support.spawning = false;
  expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
  support.pos.x = 3.5; support.pos.z = 0;
  expect(f.step()).toEqual({ move: { x: 1, y: 0 }, requests: [] });
  f.game.enemies = [north];
  expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
  f.game.enemies = [];
  expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: [] });
});

test('AUTO는 먼 무리의 기존 첫 적 폴백과 비유한 좌표의 비교 경계를 유지한다', () => {
  const f = autoFixture([autoEnemy(100, 0), autoEnemy(0, 99)]);
  expect(f.step()).toEqual({ move: { x: 1, y: 0 }, requests: [] });
  f.game.enemies = [autoEnemy(NaN, NaN, { isBoss: true }), autoEnemy(0, 3)];
  expect(f.step()).toEqual({ move: { x: 0, y: 1 }, requests: [] });
  f.game.enemies = [autoEnemy(NaN, NaN), autoEnemy(Infinity, Infinity)];
  expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: ['attack'] });
});

test('AUTO는 실제 스킬 조건과 쿨다운 뒤 기본 공격 요청을 그대로 유지한다', () => {
  const f = autoFixture([autoEnemy(1, 0)]);
  f.player.def.skills = [{ id: 'test_hit', cd: 2, mp: 3 }]; f.player.cds = [0];
  f.game.getComboLinkSnapshot = () => ({ ready: true });
  expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: ['skill0'] });
  f.player.cds[0] = 1;
  expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: ['attack'] });
  f.player.cds[0] = 0; f.game.getComboLinkSnapshot = () => ({ ready: false });
  expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: ['attack'] });
});

test('AUTO의 공격·commit 뒤 회피 요청 순서와 원래 회피 난수 소비를 유지한다', () => {
  const f = autoFixture([autoEnemy(1, 0, { isBoss: true, telegraph: .2 })]);
  const savedRandom = Math.random, rolls = [.1, .9, .4]; let consumed = 0;
  Math.random = () => rolls[consumed++];
  try {
    expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: ['attack', 'dodge'] });
    f.player.state = 'attack';
    expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: ['attack'] });
    f.player.hitDone = true;
    expect(f.step()).toEqual({ move: { x: 0, y: 0 }, requests: ['attack'] });
    expect(consumed).toBe(2); expect(Math.random()).toBe(.4);
  } finally { Math.random = savedRandom; }
});
