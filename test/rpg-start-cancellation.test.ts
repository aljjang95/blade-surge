import { expect, spyOn, test } from 'bun:test';
import { Battle as BaseBattle } from '../src/game/battle-base.js';
import { Battle } from '../src/game/rpg-battle.js';

test('a late cancelled base start cannot erase the newer RPG run ledger and growth snapshot', async () => {
  const resolves: Array<() => void> = [];
  const base = spyOn(BaseBattle.prototype, 'start').mockImplementation(function(this: any) {
    this._startGeneration = (this._startGeneration || 0) + 1;
    return new Promise<void>(resolve => resolves.push(resolve));
  });
  const game: any = Object.create(Battle.prototype);
  game.ensureRpg = () => {}; game.rpgView = { refresh() {} };
  try {
    const stale = game.start({}, 'knight', { level: 1, exp: 0 }, {});
    const current = game.start({}, 'mage', { level: 8, exp: 9 }, {});
    resolves[1](); await current;
    game.combatXp = 77; game.saveT = .7;
    const ledger = game.killLedger, clock = game.timeCtl, growth = game.growthStart;
    resolves[0](); await stale;
    expect(game.killLedger).toBe(ledger); expect(game.timeCtl).toBe(clock);
    expect(game.combatXp).toBe(77); expect(game.saveT).toBe(.7);
    expect(game.growthStart).toBe(growth); expect(game.growthStart.heroId).toBe('mage');
  } finally { base.mockRestore(); }
});
