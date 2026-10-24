import { expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { classify, loadSplit } from '../tools/optimize/asset-split.mjs';
import { buildStarterVillage } from '../src/game/starter-village-scene.js';
import { STARTER_PROP_NAMES, createStarterPropLoader, starterPropPath } from '../src/game/starter-village-props.js';
import { EARLY_GROUPS } from '../src/platform/remote-prefetch.js';
import { STARTER_COTTAGES, STARTER_DUMMIES, STARTER_FORGE_BUILDING } from '../src/data/starter-village.js';

const root = new URL('../', import.meta.url).pathname;

test('Tripo 소품 GLB 8종이 모두 있고 유효한 GLB 헤더·크기를 가진다', () => {
  expect([...STARTER_PROP_NAMES].sort()).toEqual(['board', 'cottage', 'dummy', 'forge', 'fountain', 'portal', 'stall', 'statue']);
  for (const name of STARTER_PROP_NAMES) {
    const file = root + 'public' + starterPropPath(name);
    expect(existsSync(file), name).toBe(true);
    expect(readFileSync(file).subarray(0, 4).toString('latin1'), name).toBe('glTF');
    expect(statSync(file).size, name).toBeLessThan(1_500_000);
  }
});

test('소품 GLB 8종은 core 가 아니라 remote 묶음 starter-village 로 분류되고 로비 진입 때 먼저 받는다', async () => {
  const split = await loadSplit();
  for (const name of STARTER_PROP_NAMES) expect(classify(`models/starter-village-v1/${name}.glb`, split), name).toMatchObject({ class: 'remote', group: 'starter-village' });
  expect(EARLY_GROUPS).toContain('starter-village');
});

test('로더: 받은 소품만 돌려주고 실패한 소품은 캐시하지 않아 다음 요청에서 다시 받는다', async () => {
  let attempts = 0;
  const loader = createStarterPropLoader(async (path: string) => {
    attempts++;
    if (path.endsWith('/board.glb') && attempts <= 8) throw new Error('offline');
    if (path.endsWith('/stall.glb')) return {};   // 장면이 없는 응답도 실패로 본다
    return { scene: new THREE.Group() };
  });
  const first = await loader.load();
  expect(first.has('cottage')).toBe(true);
  expect(first.has('board')).toBe(false);
  expect(first.has('stall')).toBe(false);
  expect(first.size).toBe(STARTER_PROP_NAMES.length - 2);
  const before = attempts;
  const second = await loader.load();
  expect(attempts - before).toBe(2);   // 받은 6종은 다시 받지 않고 실패한 2종만 재시도
  expect(second.has('board')).toBe(true);
  expect((await createStarterPropLoader(async () => { throw new Error('x'); }).load()).size).toBe(0);
});

// 바닥 중앙 피벗(최저 y=0)의 1m 상자 한 개 짜리 가짜 소품 템플릿.
const fakeTemplate = () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1); geometry.translate(0, .5, 0);
  const group = new THREE.Group(); group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x884422 })));
  return group;
};
const build = (quality = 'high') => {
  const owned = { geometries: new Set<any>(), materials: new Set<any>(), textures: new Set<any>() };
  const rootGroup = new THREE.Group();
  const starter = buildStarterVillage({ root: rootGroup, owned, environmentTexture: null, quality });
  return { owned, starter, rootGroup };
};
const visibleFallbacks = (rootGroup: THREE.Object3D) => {
  const out: Record<string, boolean> = {};
  rootGroup.traverse(node => { if (node.name.startsWith('Starter_Fallback_')) out[node.name.slice('Starter_Fallback_'.length)] = node.visible; });
  return out;
};

test('폴백: GLB 가 오기 전에는 소품별 절차 모델 묶음이 모두 보이고 허수아비도 흔들린다', () => {
  const { starter, rootGroup } = build();
  expect(visibleFallbacks(rootGroup)).toEqual({ cottage: true, forge: true, board: true, dummy: true, portal: true, statue: true, fountain: true, stall: true });
  expect(starter.fallbackMeshCount()).toBeGreaterThan(8);
  expect(starter.appliedProps()).toEqual([]);
  starter.strike({ x: STARTER_DUMMIES[0].x, z: STARTER_DUMMIES[0].z });
  for (let i = 0; i < 6; i++) starter.update(1 / 60);
  expect(Math.abs(starter.dummyAngles()[0])).toBeGreaterThan(0);
});

test('applyProps: 8종을 모두 바꾸면 폴백이 숨고, 지오메트리는 공유하며 장면이 해제하지 않고 재질은 복제해 소유한다', () => {
  const { starter, rootGroup, owned } = build();
  const templates = new Map(STARTER_PROP_NAMES.map(name => [name, fakeTemplate()] as const));
  const hidden = { visible: true };   // 허브 장면의 기존 상점 좌판 자리
  const adopted = new THREE.Group(); starter.adoptFallback('stall', adopted);
  expect(starter.applyProps(templates).sort()).toEqual([...STARTER_PROP_NAMES].sort());
  expect(Object.values(visibleFallbacks(rootGroup)).every(v => v === false)).toBe(true);
  expect(adopted.visible).toBe(false);
  // 이미 바꾼 소품은 다시 바꾸지 않는다.
  expect(starter.applyProps(templates)).toEqual([]);

  const cottage = rootGroup.getObjectByName('Starter_Prop_cottage') as THREE.InstancedMesh;
  const templateMesh = templates.get('cottage')!.children[0] as THREE.Mesh;
  expect(cottage.isInstancedMesh).toBe(true);
  expect(cottage.count).toBe(STARTER_COTTAGES.length);
  expect(cottage.geometry).toBe(templateMesh.geometry);                  // 지오메트리 공유
  expect(cottage.material).not.toBe(templateMesh.material);              // 재질은 장면 복제본
  expect(owned.materials.has(cottage.material as any)).toBe(true);
  for (const name of STARTER_PROP_NAMES) {
    const geometry = (templates.get(name)!.children[0] as THREE.Mesh).geometry;
    expect(owned.geometries.has(geometry), name).toBe(false);            // 템플릿 소유라 장면이 해제하지 않는다
  }
  void hidden;
  // 허수아비 3기는 같은 지오메트리·재질을 쓰는 Mesh 이고 흔들리는 pivot 안에 있다.
  const dummies: THREE.Mesh[] = [];
  rootGroup.traverse(node => { if (node.name === 'Starter_Prop_dummy') dummies.push(node as THREE.Mesh); });
  expect(dummies.length).toBe(STARTER_DUMMIES.length);
  expect(new Set(dummies.map(mesh => mesh.geometry)).size).toBe(1);
  expect(new Set(dummies.map(mesh => mesh.material)).size).toBe(1);
  starter.strike({ x: STARTER_DUMMIES[1].x, z: STARTER_DUMMIES[1].z });
  for (let i = 0; i < 6; i++) starter.update(1 / 60);
  expect(Math.abs(starter.dummyAngles()[1])).toBeGreaterThan(0);
  expect(Math.abs(dummies[1].parent!.rotation.x)).toBeGreaterThan(0);
  expect(dummies[0].parent!.rotation.x).toBe(0);
  // 대장간 건물은 작업장 뒤(+x)에 정해진 자리·yaw 로 선다.
  const forge = rootGroup.getObjectByName('Starter_Prop_forge')!;
  expect([forge.position.x, forge.position.z, forge.rotation.y]).toEqual([STARTER_FORGE_BUILDING.x, STARTER_FORGE_BUILDING.z, STARTER_FORGE_BUILDING.yaw]);
});

test('applyProps: 메시 없는 템플릿·모르는 이름은 그 소품만 폴백으로 남기고 나머지는 바뀐다', () => {
  const { starter, rootGroup } = build();
  const done = starter.applyProps({ board: new THREE.Group(), statue: fakeTemplate(), nonsense: fakeTemplate() });
  expect(done).toEqual(['statue']);
  const visible = visibleFallbacks(rootGroup);
  expect(visible.board).toBe(true);        // 메시가 없어 폴백 유지
  expect(visible.statue).toBe(false);
  expect(visible.fountain).toBe(true);     // 템플릿이 오지 않은 소품
  expect(rootGroup.getObjectByName('Starter_Prop_board')).toBeUndefined();
  // 폴백인 채로 늦게 adopt 한 허브 좌판은 숨지 않고, 바뀐 뒤에 adopt 하면 곧바로 숨는다.
  const late = new THREE.Group(); starter.adoptFallback('stall', late); expect(late.visible).toBe(true);
  starter.applyProps({ stall: fakeTemplate() });
  expect(late.visible).toBe(false);
  const later = new THREE.Group(); starter.adoptFallback('stall', later); expect(later.visible).toBe(false);
});

test('applyProps: 장면이 해제(retire)된 뒤 도착한 GLB 는 무시한다', () => {
  const { starter, rootGroup } = build();
  starter.retire();
  expect(starter.applyProps({ cottage: fakeTemplate() })).toEqual([]);
  expect(visibleFallbacks(rootGroup).cottage).toBe(true);
});

test('분수 물줄기는 GLB 분수(높이 1.74m)에 맞춰 내려가고, 오두막 그림자는 low 품질에서 끈다', () => {
  const high = build('high'), jetFallbackY = (high.rootGroup.getObjectByName('Starter_FountainJet') as THREE.Object3D).position.y;
  expect(jetFallbackY).toBeCloseTo(1.8);
  high.starter.applyProps({ fountain: fakeTemplate(), cottage: fakeTemplate() });
  expect((high.rootGroup.getObjectByName('Starter_FountainJet') as THREE.Object3D).position.y).toBeLessThan(1.74);
  expect((high.rootGroup.getObjectByName('Starter_Prop_cottage') as THREE.Mesh).castShadow).toBe(true);
  const low = build('low'); low.starter.applyProps({ cottage: fakeTemplate() });
  expect((low.rootGroup.getObjectByName('Starter_Prop_cottage') as THREE.Mesh).castShadow).toBe(false);
});
