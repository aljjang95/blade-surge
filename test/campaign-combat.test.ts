import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { hazardContains, hazardPattern, RegionHazards } from '../src/game/region-hazards.js';
import { nextBossPattern } from '../src/game/enemies.js';
import { Battle } from '../src/game/battle.js';
import { CHAPTERS, stageDef, ENEMIES } from '../src/data/stages.js';
const enemies = ENEMIES as unknown as Record<string, { boss?: boolean; pattern: string[] }>;

test('모든 스테이지의 실제 보스방 소환은 해당 관문 보스를 사용한다', () => {
  for (const chapter of CHAPTERS) for (let st = 1; st <= 10; st++) {
    const stage = stageDef(chapter.id, st);
    const list = Battle.prototype.roomRoster.call({ stage, rosterSize: () => 0 }, { type: 'boss', id: 9 });
    expect(list[0]).toBe(stage.encounter.enemyId);
    expect(enemies[list[0]].boss).toBe(true);
    const boss = enemies[list[0]];
    const sequence = boss.pattern.map((_: string, i: number) => nextBossPattern(boss, i, 0));
    expect(sequence).toEqual(boss.pattern);
    expect(nextBossPattern(boss, boss.pattern.length, 0)).toBe(sequence[0]);
  }
});

test('고리 내부와 왕관의 중앙 안전 원은 실제 피격에서도 제외된다', () => {
  const room = { x: 0, z: 0, w: 24, h: 24 };
  const ring = hazardPattern('garden', room, { x: 0, z: 0 }, 0)[0];
  expect(hazardContains(ring, 0, 0)).toBe(false);
  expect(hazardContains(ring, 2.8, 0)).toBe(true);
  expect(hazardContains(ring, 4, 0)).toBe(false);
  for (const h of hazardPattern('crown', room, { x: 0, z: 0 }, 0)) {
    expect(hazardContains(h, .1, .1)).toBe(false);
    expect(hazardContains(h, Math.cos(h.angle) * 5, Math.sin(h.angle) * 5)).toBe(true);
    expect(hazardContains(h, -Math.sin(h.angle) * 5, Math.cos(h.angle) * 5)).toBe(false);
  }
});

test('서리 기록은 발밑 위치를 고정하고 과열과 밀물은 주기마다 방향을 바꾼다', () => {
  const room = { x: 10, z: 10, w: 24, h: 24 }, player = { x: 12, z: 11 };
  const frost = hazardPattern('frost', room, player, 0);
  player.x = 18;
  expect(frost[0].x).toBe(12); expect(frost[0].z).toBe(11);
  for (const theme of ['forge', 'tide']) {
    const a = hazardPattern(theme, room, player, 0), b = hazardPattern(theme, room, player, 1);
    expect(a[0].angle).not.toBe(b[0].angle);
    expect(a.every(h => h.delay >= 1.5)).toBe(true);
  }
});

test('예고 중 무피해, 발동은 한 번, 회피 성공에는 둔화 없음, 방 정화 후 취소와 GPU 자원 회수', () => {
  const room = { x: 0, z: 0, w: 24, h: 24, type: 'boss', cleared: false, spawned: true };
  let damageCalls = 0, dodging = false;
  const player = { pos: { x: 0, z: 0 }, alive: true, maxHp: 2800, slowT: 0, slow: 0, hurt: () => { damageCalls++; return !dodging; } };
  const game = { stage: { chapter: { theme: 'frost' }, encounter: { rank: 'finalboss' } }, scene: new THREE.Scene(), ui: { toast: () => {} }, player, world: { roomAt: () => room }, active: true, paused: false };
  const hazards = new RegionHazards(game); hazards.room = room; hazards.cooldown = 99;
  hazards.spawn(room); hazards.update(1.6); expect(damageCalls).toBe(0);
  hazards.update(.11); expect(damageCalls).toBe(1); expect(player.slowT).toBe(1.2);
  hazards.update(.05); expect(damageCalls).toBe(1);
  player.slowT = 0; dodging = true; hazards.spawn(room); hazards.update(1.71);
  expect(player.slowT).toBe(0); expect(hazards.hits).toBe(1);
  const calls = damageCalls; room.cleared = true; hazards.spawn(room); hazards.update(3);
  expect(damageCalls).toBe(calls); expect(hazards.slots.every(s => !s.mesh.visible)).toBe(true);
  let disposed = 0; hazards.geometry.addEventListener('dispose', () => disposed++);
  for (const slot of hazards.slots) slot.mesh.material.addEventListener('dispose', () => disposed++);
  hazards.dispose(); expect(disposed).toBe(7); expect(game.scene.children.length).toBe(0);
});
