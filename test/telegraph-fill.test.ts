import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';
import { HeroEffectFocus } from '../src/engine/hero-effect-focus.js';
import { hazardFragmentShader } from '../src/game/region-hazards.js';

function withFx(run: (fx: any) => void) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    getContext: () => ({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, fillRect() {}, clearRect() {} }),
  }) } });
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, { scene: new THREE.Scene(), focus: new HeroEffectFocus(), items: [], _mats: {}, plane2: new THREE.PlaneGeometry(2, 2) });
  try { run(fx); } finally {
    while (fx.items.length) fx._finishItem(0);
    for (const material of Object.values(fx._mats)) (material as THREE.Material).dispose();
    fx.plane2.dispose(); fx._disk?.dispose();
    if (saved) Object.defineProperty(globalThis, 'document', saved); else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('적 예고 고리는 위험 경계를 r1 에 고정하고 사그라들지 않으며 안쪽 채움이 타격 시점까지 차오른다', () => withFx(fx => {
  const mesh = fx.ring(new THREE.Vector3(1, 0, 2), 0xff3030, { r0: 4.2, r1: 4.8, telegraph: true, life: 1, y: .06 });
  const item = fx.items[0], fill = mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(fill).toBeTruthy(); expect(fill.material.blending).toBe(THREE.NormalBlending);
  let lastFill = 0, lastOpacity = 0;
  for (const k of [.1, .4, .7, .95]) {
    item.update(k, k, 1 / 60);
    expect(mesh.scale.x).toBe(4.8);
    expect(mesh.material.opacity).toBeGreaterThan(lastOpacity); lastOpacity = mesh.material.opacity;
    expect(fill.scale.x).toBeGreaterThan(lastFill); lastFill = fill.scale.x;
  }
  expect(lastFill).toBeLessThanOrEqual(1);
}));

test('예고가 아닌 고리와 근접 참격 예고: 일반 고리는 예전처럼 퍼지며 사라지고, 참격 예고는 채움 자식을 가진다', () => withFx(fx => {
  const ring = fx.ring(new THREE.Vector3(), 0xffffff, { r0: .3, r1: 4, life: .5 });
  expect(ring).toBeUndefined();
  const plain = fx.items[0].obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  fx.items[0].update(.9, .45, 1 / 60); expect(plain.material.opacity).toBeLessThan(.2); expect(plain.children).toHaveLength(0);
  fx.slashArc(new THREE.Vector3(), 0, 0xff3030, { radius: 3, arc: 110, life: .8, telegraph: true, height: .1, thickness: 1 });
  const arc = fx.items[1].obj as THREE.Mesh;
  expect(arc.children).toHaveLength(1);
  fx.items[1].update(.5, .4, 1 / 60);
  expect(arc.children[0].scale.x).toBeCloseTo(.5);
  // 채움은 부모 지오메트리를 공유하므로 따로 해제하지 않는다(부모 ownGeo 한 번).
  expect((arc.children[0] as THREE.Mesh).geometry).toBe(arc.geometry);
}));

test('보스·지역 위험 셰이더는 남은 시간 progress 로 채움과 임박 경고를 그린다', () => {
  expect(hazardFragmentShader).toContain('uniform float shape, safeRadius, opacity, fired, progress;');
  expect(hazardFragmentShader).toContain('urgent');
});
