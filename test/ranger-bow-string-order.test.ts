import { expect, test } from 'bun:test';
import { Player } from '../src/game/player.js';

// 시위는 같은 프레임의 타격·발사 판정(updateCore) 뒤에 맞춘다. 앞에서 맞추면 발사 프레임에 놓은 손을 한 프레임 따라가
// 머리 속을 지났다(궁수 v5 기본공격 머리 여유 -13.3cm, skill0 -1.9cm).
test('궁수 시위는 상태 판정 뒤에 맞춘다', () => {
  const calls: string[] = [];
  const fake = {
    rangerAim: {},
    hitDone: false,
    updateCore() { calls.push('core'); this.hitDone = true; },
    updateBowRig() { calls.push('bow:' + this.hitDone); },
  };
  (Player.prototype.update as (this: unknown, dt: number) => void).call(fake, 1 / 60);
  expect(calls).toEqual(['core', 'bow:true']);
});

test('궁수가 아니면 시위를 맞추지 않는다', () => {
  const calls: string[] = [];
  const fake = { rangerAim: null, updateCore() { calls.push('core'); }, updateBowRig() { calls.push('bow'); } };
  (Player.prototype.update as (this: unknown, dt: number) => void).call(fake, 1 / 60);
  expect(calls).toEqual(['core']);
});
