import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactLights } from '../src/engine/impact-lights.js';
import { FX } from '../src/engine/fx.js';
import { VFX_TEX } from '../src/engine/assets.js';

test('타격 조명은 생성·소멸·포화·전투 초기화 뒤에도 같은 네 노드를 유지한다', () => {
  const scene = new THREE.Scene(), pool = new ImpactLights(scene);
  const nodes = [...scene.children];
  for (let i = 0; i < 20; i++) pool.emit(new THREE.Vector3(i, 0, 0), 0xffcc66, 10, 8, .4);
  expect(scene.children).toEqual(nodes); expect(nodes.length).toBe(4);
  expect(nodes.every((n) => n.visible)).toBe(true);
  expect(pool.slots.some((s) => s.light.position.x === 19)).toBe(true);
  pool.update(.5);
  expect(pool.slots.every((s) => s.light.intensity === 0 && s.light.visible)).toBe(true);
  pool.clear(); expect(scene.children).toEqual(nodes);
  pool.setEnabled(false); pool.emit(new THREE.Vector3(), 0xffffff, 10, 8, 1);
  expect(pool.slots.every((s) => !s.light.visible && s.light.intensity === 0)).toBe(true);
  pool.setEnabled(true); expect(scene.children).toEqual(nodes); expect(nodes.every((n) => n.visible)).toBe(true);
});

test('효과 색은 재질 보관 수를 늘리지 않고 서로의 색/투명도도 공유하지 않는다', () => {
  const fx = Object.create(FX.prototype); fx._mats = {};
  const red = fx._keep(new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, side: THREE.DoubleSide }));
  const blue = fx._keep(new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, side: THREE.DoubleSide }));
  red.opacity = .2;
  expect(Object.keys(fx._mats).length).toBe(1); expect(blue.opacity).toBe(1);
  const retained = Object.values(fx._mats)[0] as THREE.MeshBasicMaterial;
  expect(retained).not.toBe(red); expect(retained.color.getHex()).toBe(0xff0000);
  expect(blue.color.getHex()).toBe(0x0000ff);
  red.dispose(); blue.dispose(); expect(retained.opacity).toBe(1); retained.dispose();
});

test('효과 강제 종료는 종료 콜백과 전용 지오메트리를 한 번 정리하고 공유 면은 보존한다', () => {
  const fx = Object.create(FX.prototype); fx.scene = new THREE.Scene(); fx.items = [];
  const owned = new THREE.BufferGeometry(), shared = new THREE.BufferGeometry();
  let ownedDisposed = 0, sharedDisposed = 0, ended = 0;
  owned.addEventListener('dispose', () => ownedDisposed++); shared.addEventListener('dispose', () => sharedDisposed++);
  const group = new THREE.Group();
  const a = new THREE.Mesh(owned, new THREE.MeshBasicMaterial()), b = new THREE.Mesh(shared, new THREE.MeshBasicMaterial()); a.userData.ownGeo = true; group.add(a, b);
  fx.add(group, 1, undefined, () => ended++); fx._finishItem(0);
  expect(fx.items.length).toBe(0); expect(group.parent).toBeNull();
  expect(ended).toBe(1); expect(ownedDisposed).toBe(1); expect(sharedDisposed).toBe(0);
  shared.dispose(); a.material.dispose(); b.material.dispose();
});

test('잔상의 인덱스 버퍼는 원본 캐릭터의 GPU 자원과 독립적이다', () => {
  const fx = Object.create(FX.prototype); fx.scene = new THREE.Scene(); fx.items = []; fx._mats = {}; fx.quality = 'high';
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)); geometry.setIndex([0,1,2]);
  const source = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  Object.assign(source, { isSkinnedMesh: true, getVertexPosition: (i: number, out: THREE.Vector3) => out.fromBufferAttribute(geometry.attributes.position, i) });
  fx.ghost(source, 0xffffff);
  const copy = fx.items[0].obj.children[0].geometry as THREE.BufferGeometry;
  expect(copy.index).not.toBe(geometry.index); expect([...copy.index!.array]).toEqual([...geometry.index!.array]);
  fx._finishItem(0); expect([...geometry.index!.array]).toEqual([0,1,2]);
  geometry.dispose(); source.material.dispose();
  for (const m of Object.values(fx._mats)) (m as THREE.Material).dispose();
});

test('프레임 속도가 바뀌어도 텍스처 효과는 같은 시간 동안 같은 각도만 회전한다', () => {
  const texture = new THREE.Texture(), textures = VFX_TEX as Record<string, THREE.Texture>; textures.test_rotation = texture;
  try {
    for (const hz of [30,60,120]) {
      const fx = Object.create(FX.prototype); fx.scene = new THREE.Scene(); fx.items = []; fx._mats = {};
      const sprite = fx.texFlash(new THREE.Vector3(), 'test_rotation', 0xffffff, { spin: 1, life: 2 });
      const angle = sprite.material.rotation;
      for (let i=0;i<hz;i++) fx.items[0].update((i+1)/hz/2,(i+1)/hz,1/hz);
      expect(sprite.material.rotation-angle).toBeCloseTo(1,8);
      fx._finishItem(0); for (const m of Object.values(fx._mats)) (m as THREE.Material).dispose();
    }
  } finally { delete textures.test_rotation; texture.dispose(); }
});
