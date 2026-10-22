import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ExitCue, exitCuePoints, exitCueTarget, EXIT_CUE } from '../src/game/exit-cue.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { stageDef } from '../src/data/stages.js';

const world = (id = 'glass_garden') => { const stage: any = buildExpeditionStage('dungeon', id, null); return { stage, world: buildExpeditionWorld(stage) as any }; };

test('화살표는 시작방 중심에서 출구 복도 방향(가로 먼저, 다음 세로)으로 놓인다', () => {
  const east = exitCuePoints({ x: 0, z: 0 }, { x: 30, z: 0 });
  expect(east).toHaveLength(EXIT_CUE.count);
  expect(east[0][0]).toBeCloseTo(EXIT_CUE.start); expect(east[1][0] - east[0][0]).toBeCloseTo(EXIT_CUE.step);
  expect(east.every(([, z]) => Math.abs(z) < 1e-9)).toBe(true);
  // 끝점이 -z 를 향하는 화살표를 yaw 로 돌려 진행 방향(+x)을 가리키게 한다.
  const tip = (yaw: number) => new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  expect(tip(east[0][2]).x).toBeCloseTo(1); expect(tip(east[0][2]).z).toBeCloseTo(0);
  // 꺾인 복도: 가로로 가다 모서리(B.x, A.z)에서 세로로 꺾는다.
  const bent = exitCuePoints({ x: 0, z: 0 }, { x: 8, z: 20 }, { count: 6, step: 3, start: 3 });
  expect(bent[0][0]).toBeCloseTo(3); expect(bent[0][1]).toBeCloseTo(0);
  const down = bent.find(([x, z]) => z > 1)!;
  expect(down[0]).toBeCloseTo(8); expect(tip(down[2]).z).toBeCloseTo(1);
  // 목적지에 닿기 전에 끝나는 짧은 복도는 있는 만큼만 놓는다.
  expect(exitCuePoints({ x: 0, z: 0 }, { x: 6, z: 0 })).toHaveLength(1);
});

test('유리 정원 시작방 안내는 첫 이웃방을 가리키고 다른 던전·첫 캠페인도 대상이다', () => {
  const { stage, world: w } = world();
  const target = exitCueTarget(stage, w);
  expect(target).toBe(w.rooms[w.startRoom.links[0]]);
  expect(target.type).not.toBe('start');
  for (const id of ['ember_vault', 'star_archive']) { const f = world(id); expect(exitCueTarget(f.stage, f.world)).not.toBeNull(); }
  expect(exitCueTarget(stageDef(1, 1), w)).not.toBeNull();   // 첫 캠페인 1-1
  // 이웃방이 이미 열렸거나 파티 판은 대상이 아니다.
  target.spawned = true; expect(exitCueTarget(stage, w)).toBeNull(); target.spawned = false;
  expect(exitCueTarget({ ...stage, party: {} }, w)).toBeNull();
  expect(exitCueTarget({ code: '2-3' }, w)).toBeNull();
});

test('안내는 이웃방이 열리면 사라지고 정리 때 장면에서 모두 빠진다', () => {
  const { stage, world: w } = world(), scene = new THREE.Scene();
  const cue = new ExitCue(scene, w.startRoom, exitCueTarget(stage, w));
  expect(scene.children).toContain(cue.group);
  cue.update(.5, true); expect(cue.group.visible).toBe(true);
  expect(cue.marks.every((m: any) => m.material.opacity >= .3 - 1e-9 && m.material.opacity <= .85 + 1e-9)).toBe(true);
  cue.update(.1, true, true); expect(cue.marks.every((m: any) => m.material.opacity === .55)).toBe(true);   // 움직임 줄이기: 고정
  cue.update(.1, false); expect(cue.group.visible).toBe(false);
  cue.update(.1, true); expect(cue.group.visible).toBe(true);
  cue.target.spawned = true; cue.update(.1, true); expect(cue.group.visible).toBe(false);
  cue.dispose(); expect(scene.children).not.toContain(cue.group); expect(() => cue.update(1)).not.toThrow(); cue.dispose();
});
