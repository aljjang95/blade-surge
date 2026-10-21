import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX, FX_EXPOSURE } from '../src/engine/fx.js';
import { VFX_TEX } from '../src/engine/assets.js';

function withFx(run: (fx: FX) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => context }), getElementById: () => ({ firstChild: null }),
  } });
  const fx = new FX(new THREE.Scene(), new THREE.PerspectiveCamera());
  const textures = VFX_TEX as Record<string, THREE.Texture>, previous = textures.holy_burst, texture = new THREE.Texture();
  textures.holy_burst = texture;
  try { run(fx); } finally {
    fx.dispose(); texture.dispose();
    if (previous) textures.holy_burst = previous; else delete textures.holy_burst;
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}
const rgb = (fx: FX) => ((fx.items.at(-1)!.obj as THREE.Sprite).material.color.r);

test('궁극기처럼 큰 장식이 겹치면 뒤에 오는 장식의 RGB 만 낮춰 화면이 하얗게 날아가지 않는다', () => withFx(fx => {
  const p = new THREE.Vector3();
  fx.texFlash(p, 'holy_burst', 0xffffff, { size: 4 }); const first = rgb(fx);
  for (let i = 0; i < 4; i++) fx.texFlash(p, 'holy_burst', 0xffffff, { size: 12 });
  const crowded = rgb(fx);
  expect(first).toBe(1);
  expect(crowded).toBeLessThan(.8); expect(crowded).toBeGreaterThanOrEqual(FX_EXPOSURE.floor - 1e-9);
  // 크기·수명은 그대로다.
  expect((fx.items.at(-1)!.obj as THREE.Sprite).scale.x).toBeCloseTo(12 * .4); expect(fx.items.at(-1)!.life).toBe(.35);
  // sim 시간이 흐르면 예산이 돌아오고, 히트스톱(dt 0)에는 그대로다.
  fx.update(0); fx.texFlash(p, 'holy_burst', 0xffffff, { size: 1 }); expect(rgb(fx)).toBeLessThan(1);
  fx.update(2); fx.texFlash(p, 'holy_burst', 0xffffff, { size: 4 }); expect(rgb(fx)).toBe(1);
}));

test('적 예고 마법진은 예산에 넣지도 낮추지도 않고 clearAll 은 예산을 비운다', () => withFx(fx => {
  const p = new THREE.Vector3(), color = new THREE.Color(0xff3030);
  for (let i = 0; i < 6; i++) fx.texFlash(p, 'holy_burst', 0xffffff, { size: 14 });
  fx.groundTex(p, 'shockwave', color, { r1: 9, telegraph: true });
  const warning = fx.items.at(-1)!.obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(warning.material.color.equals(color)).toBe(true);
  fx.clearAll(); fx.texFlash(p, 'holy_burst', 0xffffff, { size: 4 }); expect(rgb(fx)).toBe(1);
}));

test('차가운 영웅색(보라·청·비취)으로 칠하는 불꽃·폭발 원화는 밝기 결로 바꿔 색을 살리고, 따뜻한 색·흰빛은 원화 그대로다', async () => {
  const { textureTintMix } = await import('../src/engine/fx.js');
  for (const warm of [0xff7228, 0xffd060, 0xff3030, 0xfff0c0, 0xffffff]) expect(textureTintMix(warm)).toBe(0);
  for (const cool of [0xb26bff, 0x4cc3ff, 0x7feac0, 0x72dfff]) expect(textureTintMix(cool)).toBeGreaterThan(.5);
});
