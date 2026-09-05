import { expect, test } from 'bun:test';
import { Battle } from '../src/game/battle.js';

test('사망 중 입력을 잠그고 부활 때 이전 예약을 비운다', () => {
  const input = { enabled: true, queue: ['attack'], clear() { this.queue = []; } };
  const battle = {
    app: {}, input, active: true, paused: false, revived: 0, heroId: 'knight', boss: null,
    player: { alive: false, pos: {}, revive() { this.alive = true; } },
    renderer: { desat: 0, shake() {} }, timeCtl: { slowmo() {} },
    hasProc() { return false; }, after() {}, hitRadius() {},
    fx: { holyBurst() {}, shockTex() {} },
  };
  Battle.prototype.onPlayerDeath.call(battle);
  expect(input.enabled).toBe(false); expect(input.queue).toEqual([]);
  Battle.prototype.revivePlayer.call(battle);
  expect(input.enabled).toBe(true); expect(battle.revived).toBe(1);
  Battle.prototype.revivePlayer.call(battle);
  expect(battle.revived).toBe(1);
});
