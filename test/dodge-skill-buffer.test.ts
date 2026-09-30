import { expect, test } from 'bun:test';
import { Player } from '../src/game/player.js';

// handleInput 만 떼어 실행한다. 회피 상태 전환과 스킬 발동은 기록만 한다.
function rig(state: string) {
  const casts: number[] = [];
  const queue: string[] = [];
  const input = { move: { x: 0, y: 0 }, attackHeld: false, queue, press(a: string) { if (!queue.includes(a)) queue.push(a); }, consume(a: string) { const i = queue.indexOf(a); if (i < 0) return false; queue.splice(i, 1); return true; } };
  const player: any = {
    alive: true, auto: false, state, stateT: 0, dodgeCd: 1, stun: 0, skillBuffer: null,
    moveDir: { set() { return this; }, lengthSq: () => 0 },
    vel: { set() { return this; }, copy() { return this; }, multiplyScalar() { return this; } },
    tryCastCombatSkill(slot: number) { if (this.state === 'dodge') return false; casts.push(slot); this.state = 'skill'; return true; },
    canDodgeCancel: () => true,
    play() {}, faceDir() {}, startCombo() {},
  };
  const run = () => Player.prototype.handleInput.call(player, input, 1 / 60);
  return { player, input, casts, run };
}

test('회피 중 누른 스킬은 버려지지 않고 회피가 끝나면 발동한다', () => {
  const { player, input, casts, run } = rig('dodge');
  input.press('skill0'); run();
  expect(casts).toEqual([]);
  expect(input.queue).toEqual([]);
  player.state = 'idle'; run();
  expect(casts).toEqual([0]);
  expect(player.skillBuffer).toBeNull();
});

test('회피 중 여러 번 누르면 마지막 스킬 하나만 남는다', () => {
  const { player, input, casts, run } = rig('dodge');
  input.press('skill0'); run(); input.press('skill2'); run();
  player.state = 'idle'; run(); run();
  expect(casts).toEqual([2]);
});

test('같은 프레임에 두 스킬이 들어오면 슬롯 번호가 아니라 나중에 누른 스킬을 남긴다', () => {
  const { player, input, casts, run } = rig('dodge');
  input.press('skill2'); input.press('skill0'); run();
  expect(input.queue).toEqual([]);
  player.state = 'idle'; run();
  expect(casts).toEqual([0]);
});

test('새 회피를 시작하면 이전 회피에서 예약한 스킬은 지운다', () => {
  const { player, input, casts, run } = rig('dodge');
  input.press('skill1'); run();
  player.state = 'idle'; player.dodgeCd = 0;
  let dodged = 0; player.dodge = () => { dodged++; player.state = 'dodge'; };
  input.press('dodge'); run();
  expect(dodged).toBe(1); expect(player.skillBuffer).toBeNull(); expect(casts).toEqual([]);
});

test('부활하면 사망 전 예약한 스킬을 지운다', () => {
  const p: any = { beacon: null, mats: [], maxHp: 10, pos: { y: 0 }, play() {}, skillBuffer: { slot: 0 } };
  Player.prototype.revive.call(p);
  expect(p.skillBuffer).toBeNull();
});
