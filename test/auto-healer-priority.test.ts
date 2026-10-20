import { expect, test } from 'bun:test';
import { Player } from '../src/game/player.js';

function enemy(x: number, z: number, extra: any = {}) {
  return { alive: true, spawning: false, isBoss: false, isElite: false, telegraph: 0, hp: 100, maxHp: 100, pos: { x, z }, ...extra,
    distTo(o: any) { return Math.hypot(this.pos.x - o.pos.x, this.pos.z - o.pos.z); } };
}
function step(enemies: any[]) {
  const requests: string[] = [];
  const game: any = { enemies, stage: {}, world: null, input: { press(k: string) { requests.push(k); } } };
  const p = Object.assign(Object.create(Player.prototype), { game, pos: { x: 0, z: 0 }, state: 'idle', hitDone: false, dodgeCd: 0,
    def: { ranged: false, skills: [] }, heroLevel: 1, skillLoadout: [4, 5], cds: [], hp: 100, maxHp: 100, mp: 100, ult: 0, ultMax: 100, _autoHubCounts: [] });
  const move = Player.prototype.autoMove.call(p, 1 / 60);
  return { move: { x: move.x, y: move.y }, requests };
}

test('AUTO는 보스 곁의 치유 주술사를 먼저 처치하러 간다', () => {
  const boss = enemy(0, 8, { isBoss: true, hp: 50, maxHp: 100 });
  // 보스 동쪽 3m의 주술사. 보스 무리 가중치가 더 커도 주술사 쪽으로 이동해야 한다.
  expect(step([boss, enemy(4, 8, { behavior: 'shaman' })]).move.x).toBeGreaterThan(.3);
  // 주술사가 아닌 일반 몹이면 기존처럼 보스(정북)로 간다.
  expect(step([boss, enemy(4, 8)]).move).toEqual({ x: 0, y: 1 });
  // 보스에서 멀리 떨어진 주술사는 회복 범위 밖이므로 무시한다.
  expect(step([boss, enemy(-30, 0, { behavior: 'shaman' })]).move).toEqual({ x: 0, y: 1 });
});

