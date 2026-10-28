import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { CHAPTER_DRESS, chapterDressFor } from '../src/data/chapter-dress.js';
import { ENEMIES, CHAPTERS, stageDef } from '../src/data/stages.js';
import { attachDressProp, DRESS_PROP_KEYS, dressPropTriangles } from '../src/game/chapter-dress.js';
import { CHAPTER_GRADES, gradeAtmosphere, sceneryPlacements } from '../src/game/chapter-scenery.js';

test('1장 의상은 1장 로스터의 모든 잡몹·원거리·정예·보스를 덮고 존재하는 적·소품만 가리킨다', () => {
  const garden = CHAPTER_DRESS[1];
  for (const id of Object.keys(garden.species)) {
    if (!id.startsWith('garden_')) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
    for (const key of garden.species[id].props || []) expect(DRESS_PROP_KEYS).toContain(key);
  }
  for (const spec of Object.values(garden.assets)) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  // 처음 30분(1장 1~10관문) 로스터의 각 적이 종 표나 몸 표로 의상을 받는다.
  const def: any = stageDef(1, 1);
  const roster = typeof def.combatRosterFor === 'function' ? def.combatRosterFor() : null;
  const ids = roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : ['skel_minion', 'ghost', 'skel_mage'];
  for (const id of ids) expect(garden.species[id] || null, id).toBeTruthy();
});

test('2장 의상은 2장 로스터 전부와 중간·최종 보스를 덮는다', () => {
  const forge = CHAPTER_DRESS[2];
  for (const id of Object.keys(forge.species)) if (!id.startsWith('forge_')) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
  for (const spec of [...Object.values(forge.species), ...Object.values(forge.assets)]) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  const def: any = stageDef(2, 1);
  const roster = def.combatRosterFor?.();
  const ids = roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : [];
  // 독침벌(armabee)은 몸(fire_phoenix) 기준 의상으로 덮인다.
  for (const id of ids) expect(chapterDressFor({ chapter: { id: 2 } }, id, (ENEMIES as any)[id]?.model === 'Flying_Armabee' ? 'fire_phoenix' : null), id).toBeTruthy();
});

test('의상은 캠페인 장에만 입히고 원정은 제외한다', () => {
  expect(chapterDressFor({ chapter: { id: 1 } }, 'skel_minion', 'bone_knight')?.props).toContain('coffin');
  expect(chapterDressFor({ chapter: { id: 1 }, expedition: { id: 'x' } }, 'skel_minion', 'bone_knight')).toBeNull();
  expect(chapterDressFor({ chapter: { id: 3 } }, 'skel_minion', 'bone_knight')).toBeNull();
  // 종 표에 없는 1장 경로 보스는 몸 기준 의상.
  expect(chapterDressFor({ chapter: { id: 1 } }, 'dungeon_tribunal_captain', 'ember_drake')).toBeTruthy();
  expect(CHAPTERS[0].theme).toBe('garden');
});

test('소품은 예산(소품당 1,200 삼각형) 안이고 뼈 휴식 행렬 기준으로 붙는다', () => {
  for (const key of DRESS_PROP_KEYS) expect(dressPropTriangles(key, 2.5), key).toBeLessThan(1200);
  const root = new THREE.Group(); root.scale.setScalar(0.4);
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; hips.position.y = 1;
  const spine = new THREE.Bone(); spine.name = 'mixamorig:Spine2'; spine.position.y = .4; spine.rotation.x = .7; spine.scale.setScalar(100);
  hips.add(spine); root.add(hips); root.updateWorldMatrix(true, true);
  const socket = attachDressProp(root, 'coffin', 2.5)!;
  expect(socket).toBeTruthy();
  expect(socket.parent).toBe(spine);
  // 소켓 월드 축 = 모델 축(뼈 회전·cm 배율 상쇄), 위치 = 뼈 + at × 키.
  root.updateWorldMatrix(true, true);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  socket.matrixWorld.decompose(p, q, s);
  expect(s.x).toBeCloseTo(0.4 * 1.25, 4);
  expect(p.y).toBeCloseTo(0.4 * (1.4 + 0.02 * 2.5), 4);
  expect(p.z).toBeCloseTo(0.4 * (-0.12 * 2.5), 4);
  expect(attachDressProp(new THREE.Group(), 'coffin', 2)).toBeNull();
});

test('1장 대기 보정은 경로 색을 장 색 쪽으로 섞고 다른 장은 그대로 둔다', () => {
  const tribunal = { fog: 0x2a2139, bg: 0x171323, hemi: [0xd1b7d6, 0x342743], torch: 0xf5a2d4, tint: 0xd5c0d8 };
  const graded = gradeAtmosphere(tribunal, 1);
  expect(graded.fog).not.toBe(tribunal.fog);
  const g = new THREE.Color(graded.fog), target = new THREE.Color(CHAPTER_GRADES[1].fog), from = new THREE.Color(tribunal.fog);
  expect(Math.abs(g.g - target.g)).toBeLessThan(Math.abs(from.g - target.g));
  expect(gradeAtmosphere(tribunal, 3)).toBe(tribunal);
});

test('장 소품은 방 가장자리 띠에만, 문 근처를 비워 결정적으로 놓인다', () => {
  const floor = { seed: 7, rooms: [{ id: 0, x: 0, z: 0, w: 20, h: 16 }, { id: 1, x: 30, z: 0, w: 20, h: 16 }], gates: [{ x: 10, z: 0, w: 2, h: 8 }] };
  const a = sceneryPlacements(floor, 1), b = sceneryPlacements(floor, 1);
  expect(a).toEqual(b);
  const all = Object.values(a).flat();
  expect(all.length).toBeGreaterThan(6);
  for (const it of all) {
    const room = floor.rooms[it.room];
    const edge = Math.min(room.w / 2 - Math.abs(it.x - room.x), room.h / 2 - Math.abs(it.z - room.z));
    expect(edge).toBeGreaterThanOrEqual(.79);
    expect(edge).toBeLessThanOrEqual(1.81);
    expect(Math.abs(it.x - 10) < 3.2 && Math.abs(it.z) < 6.2).toBe(false);
  }
  expect(sceneryPlacements(floor, 3)).toEqual({});
});
