import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { SKILLS } from '../src/game/skills.js';

test('dense Judgment keeps eight damage pulses and particle cues with bounded meshes', () => {
  const counts = { hits: 0, pillars: 0, flashes: 0, bursts: 0, lights: 0 };
  const player: any = {
    pos: new THREE.Vector3(),
    distTo: (enemy: any) => enemy.pos.length(),
    forward: (out: THREE.Vector3) => out.set(0, 0, 1),
  };
  const timers: (() => void)[] = [];
  const game: any = {
    enemies: Array.from({ length: 8 }, (_, i) => ({
      alive: true, spawning: false, pos: new THREE.Vector3(i * .8, 0, 2),
    })),
    after: (_delay: number, callback: () => void) => timers.push(callback),
    hitRadius: () => counts.hits++,
    renderer: { shake() {}, flashScreen() {} },
    fx: {
      castCircle() {},
      firePillar: () => counts.pillars++,
      holyBurst: () => counts.flashes++,
      burst: () => counts.bursts++,
      light: () => counts.lights++,
    },
  };
  SKILLS.judgment.start(game, player);
  SKILLS.judgment.cast(game, player, { dmg: 100 });
  expect(timers).toHaveLength(8);
  timers.forEach(run => run());
  // 성광 원화(holyBurst)는 크림 고리라 뺐다(메시 0): 착지 섬광은 인스턴스 층 knightJudgmentStrike 가 맡는다.
  expect(counts).toEqual({ hits: 8, pillars: 4, flashes: 0, bursts: 8, lights: 3 });
});
