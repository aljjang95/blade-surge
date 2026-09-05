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
