import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { SKILLS } from '../src/game/skills.js';

const baseFx = { castCircle() {}, shockTex() {}, explosion() {}, dustPuff() {}, burst() {}, light() {}, slashSprite() {}, flash() {}, holyBurst() {}, abilitySignature() {} };
const game = (calls: unknown[], timers: Array<() => void>) => ({
  app: { eco: { s: { towns: { learned: {} } } } },
  active: true,
  enemies: [],
  input: { move: { x: 0, y: 0 } },
  after: (_time: number, callback: () => void) => timers.push(callback),
  hitRadius: (...args: unknown[]) => calls.push(args),
  spawnProjectile: (...args: unknown[]) => calls.push(args),
  fx: baseFx,
  renderer: { shake() {}, punch() {}, flashScreen() {} },
  vacuum() {},
  scene: { add() {} },
});

function player(learned: string[]) {
  return { def: { id: 'knight' }, pos: new THREE.Vector3(), forward: (out: THREE.Vector3) => out.set(0, 0, 1),
    game: { app: { eco: { s: { towns: { learned: { knight: learned } } } } } } } as any;
}

test('교관 기술 습득 전후로 철벽 강타의 실제 타격 횟수가 달라진다', () => {
  const normalCalls: unknown[] = [], normalTimers: Array<() => void> = [];
  const normal = player([]); normal.game = game(normalCalls, normalTimers); normal.game.app.eco.s.towns.learned.knight = [];
  SKILLS.shield_bash.cast(normal.game, normal, { data: { gatherCenter: new THREE.Vector3() }, dmg: 100 });
  normalTimers.forEach(run => run());
  const learnedCalls: unknown[] = [], learnedTimers: Array<() => void> = [];
  const learned = player(['oathhold_knight_aftershock']); learned.game = game(learnedCalls, learnedTimers); learned.game.app.eco.s.towns.learned.knight = ['oathhold_knight_aftershock'];
  SKILLS.shield_bash.cast(learned.game, learned, { data: { gatherCenter: new THREE.Vector3() }, dmg: 100 });
  learnedTimers.forEach(run => run());
  expect(normalCalls.filter(call => Array.isArray(call) && call[0] instanceof THREE.Vector3)).toHaveLength(1);
  expect(learnedCalls.filter(call => Array.isArray(call) && call[0] instanceof THREE.Vector3)).toHaveLength(2);
});
