import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { HEROES } from '../src/data/heroes.js';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle-base.js';
import { comboFeedback } from '../src/ui/combo-feedback.js';

// These are component fixtures, not natural gameplay or browser evidence.
// Graphics constructors are omitted; actual Player methods and shipped combos run.
function playerFor(def: (typeof HEROES)[keyof typeof HEROES], index = 0, progress = 0, speed = 1, storm = false) {
  const current = def.combo[index];
  const player: any = Object.assign(Object.create(Player.prototype), {
    def, current, comboIdx: index, alive: true, auto: false, state: 'attack', hitDone: false, comboQueued: false,
    stateT: current.dur / (speed * (storm ? 1.4 : 1)) * progress,
    buffs: { atkSpd: speed }, stormT: storm ? 2 : 0,
    stun: 0, dodgeCd: 0, attackBufferT: 0, dodgeBufferT: 0, moveDir: new THREE.Vector3(),
  });
  return player;
}
const battleFor = (player: any) => ({ active: true, paused: false, player });
const input = (fresh: boolean, held = false) => ({ move: { x: 0, y: 0 }, attackHeld: held,
  consume: (action: string) => fresh && action === 'attack' });

for (const definition of Object.values(HEROES)) test(`${definition.id}: all authored attacks expose only actual queue availability and accepted reservations`, () => {
  for (const [index, current] of definition.combo.entries()) {
    const player = playerFor(definition, index), battle = battleFor(player);
    expect(player.canQueueCombo()).toBe(false);
    expect(comboFeedback(battle)).toMatchObject({ status: 'windup', stage: index + 1,
      total: definition.combo.length, finisher: current.finisher === true, progress: 0, nextStage: null });
    // Early fresh intent and a continuously held button are not accepted reservations.
    player.handleInput(input(true), .016);
    expect(player.comboQueued).toBe(false); expect(comboFeedback(battle).status).toBe('windup');
    player.stateT = current.dur * .9;
    expect(player.canQueueCombo()).toBe(true);
    player.handleInput(input(false, true), .016);
    expect(player.comboQueued).toBe(false); expect(comboFeedback(battle).status).toBe('ready');
    player.handleInput(input(true), .016);
    expect(player.comboQueued).toBe(true);
    expect(comboFeedback(battle)).toMatchObject({ status: 'queued', label: '예약됨', stage: index + 1,
      nextStage: index + 1 < definition.combo.length ? index + 2 : 1 });
  }
});

test('progress and queue feedback follow actual Player timing under attack speed and storm rather than an independent wall clock', () => {
  for (const definition of Object.values(HEROES)) for (const speed of [1, 1.3]) for (const storm of [false, true]) {
    const player = playerFor(definition, 0, .5, speed, storm), battle = battleFor(player);
    expect(comboFeedback(battle).progress).toBeCloseTo(player.attackProgress(), 12);
    expect(comboFeedback(battle).progress).toBeCloseTo(.5, 12);
    expect(comboFeedback(battle).status).toBe(player.canQueueCombo() ? 'ready' : 'windup');
  }
});

test('hit completion uses existing Player acceptance, and remaining spin ticks do not falsely claim that the next attack already started', () => {
  const index = HEROES.barbarian.combo.findIndex(attack => attack.ticks === 3);
  const player = playerFor(HEROES.barbarian, index, .31), battle = battleFor(player);
  player.hitDone = true; player.ticksLeft = 2; player.comboQueued = true;
  expect(player.canQueueCombo()).toBe(true);
  expect(comboFeedback(battle)).toMatchObject({ status: 'queued', stage: index + 1, nextStage: index + 2 });
  expect(player.ticksLeft).toBe(2); expect(player.comboIdx).toBe(index);
});

test('pause ownership refreshes feedback after each original input clear without advancing paused simulation', () => {
  const player = playerFor(HEROES.knight, 0, .9);
  let clearCount = 0, hudCount = 0;
  const order: string[] = [];
  const refreshes: Array<{ status: string; clears: number; enabled: boolean; owners: string[] }> = [];
  const battle: any = Object.assign(Object.create(Battle.prototype), battleFor(player), {
    pauseReasons: new Set(), input: { enabled: true, clear() { clearCount++; order.push('clear'); } },
    ui: {
      updateHud() { hudCount++; },
      refreshComboFeedback(current: any) {
        expect(current).toBe(battle);
        order.push('feedback');
        refreshes.push({ status: comboFeedback(current).status, clears: clearCount,
          enabled: current.input.enabled, owners: [...current.pauseReasons] });
      },
    }, timeCtl: { step() { throw Error('paused simulation advanced'); } },
  });
  expect(comboFeedback(battle).status).toBe('ready');
  battle.setPaused('manual', true); battle.setPaused('masterworks', true);
  expect(comboFeedback(battle).status).toBe('neutral'); expect(battle.input.enabled).toBe(false);
  battle.update(.016); expect(hudCount).toBe(0);
  battle.setPaused('manual', false);
  expect(comboFeedback(battle).status).toBe('neutral');
  battle.setPaused('masterworks', false);
  expect(comboFeedback(battle).status).toBe('ready'); expect(battle.input.enabled).toBe(true);
  expect(clearCount).toBe(4); expect(player.stateT).toBe(HEROES.knight.combo[0].dur * .9);
  expect(order).toEqual(['clear', 'feedback', 'clear', 'feedback', 'clear', 'feedback', 'clear', 'feedback']);
  expect(refreshes).toEqual([
    { status: 'neutral', clears: 1, enabled: false, owners: ['manual'] },
    { status: 'neutral', clears: 2, enabled: false, owners: ['manual', 'masterworks'] },
    { status: 'neutral', clears: 3, enabled: false, owners: ['masterworks'] },
    { status: 'ready', clears: 4, enabled: true, owners: [] },
  ]);
});

test('AUTO, nonattack states, death, inactive result and missing authoritative replica data cannot expose manual ready or queued guidance', () => {
  for (const state of ['idle', 'move', 'skill', 'dodge', 'ult', 'hurt', 'dead']) {
    const player = playerFor(HEROES.rogue, 1, .9); player.state = state; player.comboQueued = true;
    expect(comboFeedback(battleFor(player))).toMatchObject({ status: 'neutral', progress: 0, stage: 0, nextStage: null });
  }
  const player = playerFor(HEROES.rogue, 1, .9), battle = battleFor(player);
  player.auto = true; expect(comboFeedback(battle).status).toBe('neutral');
  player.auto = false; player.alive = false; expect(comboFeedback(battle).status).toBe('neutral');
  player.alive = true; battle.active = false; expect(comboFeedback(battle).status).toBe('neutral');
  expect(comboFeedback(undefined).status).toBe('neutral');
  expect(comboFeedback(battleFor({ alive: true, auto: false, state: 'attack' })).status).toBe('neutral');
});

test('stale or malformed attack observations fall back to neutral instead of inventing queue readiness', () => {
  const player = playerFor(HEROES.knight, 0, .9), battle = battleFor(player);
  player.current = HEROES.knight.combo[1]; expect(comboFeedback(battle).status).toBe('neutral');
  player.current = HEROES.knight.combo[0]; player.comboIdx = -1; expect(comboFeedback(battle).status).toBe('neutral');
  player.comboIdx = 0;
  for (const time of [NaN, Infinity, -1, HEROES.knight.combo[0].dur]) {
    player.stateT = time; expect(comboFeedback(battle).status).toBe('neutral');
  }
});

test('the projection changes no actor field, input intent, stats, resource or shipped definition', () => {
  const player = playerFor(HEROES.ranger, 4, .8, 1.3, true), battle = battleFor(player);
  player.comboQueued = true; player.hp = 500; player.mp = 30; player.ult = 40;
  const fields = JSON.stringify(player), catalog = JSON.stringify(HEROES);
  Object.freeze(player.buffs); Object.freeze(player); Object.freeze(battle);
  for (let i = 0; i < 3; i++) {
    const view = comboFeedback(battle);
    expect(view).toMatchObject({ status: 'queued', finisher: true, stage: 5, total: 5, nextStage: 1 });
    expect(view.detail).toContain('마무리');
  }
  expect(JSON.stringify(player)).toBe(fields); expect(JSON.stringify(HEROES)).toBe(catalog);
});
