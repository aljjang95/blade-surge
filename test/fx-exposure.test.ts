import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX, FX_EXPOSURE, TEX_FLASH_MAX_DIAMETER, texFlashFitSize, vividDecalColor } from '../src/engine/fx.js';
import { BLOOM_ADAPT, bloomLoadFor } from '../src/engine/combat-feedback.js';
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
  // 12m 섬광은 최대 지름 상한으로 줄어 한 장의 면적이 작아졌으므로 8장을 겹친다.
  for (let i = 0; i < 8; i++) fx.texFlash(p, 'holy_burst', 0xffffff, { size: 12 });
  const crowded = rgb(fx);
  expect(first).toBe(1);
  expect(crowded).toBeLessThan(.8); expect(crowded).toBeGreaterThanOrEqual(FX_EXPOSURE.floor - 1e-9);
  // 노출 예산은 크기·수명을 바꾸지 않는다(크기는 지름 상한만 따른다).
  expect((fx.items.at(-1)!.obj as THREE.Sprite).scale.x).toBeCloseTo(texFlashFitSize(12, 1.3) * .4); expect(fx.items.at(-1)!.life).toBe(.35);
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

test('카메라를 향한 텍스처 섬광은 최종 지름이 상한을 넘지 않고, 작은 섬광은 그대로다', () => withFx(fx => {
  expect(texFlashFitSize(3, 1.3)).toBe(3);
  expect(texFlashFitSize(12, 1.6) * (0.4 + 1.6)).toBeCloseTo(TEX_FLASH_MAX_DIAMETER);
  expect(texFlashFitSize(NaN, 1)).toBeNaN();
  const p = new THREE.Vector3();
  fx.texFlash(p, 'holy_burst', 0xffffff, { size: 12, grow: 1.6, life: .5 });
  const it = fx.items.at(-1)!; it.update?.(1, .5, 0);
  fx.update(.499);
  expect((it.obj as THREE.Sprite).scale.x).toBeLessThanOrEqual(TEX_FLASH_MAX_DIAMETER + 1e-6);
}));

test('장식 지면층의 파스텔색은 색상을 지킨 진한 색으로 바뀌고, 예고는 원래 색이다', () => withFx(fx => {
  const out = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 }, src = { h: 0, s: 0, l: 0 };
  for (const pastel of [0xfff3b0, 0xc0d8ff, 0x80e0ff, 0xdff8ff]) {
    vividDecalColor(pastel, out).getHSL(hsl, THREE.SRGBColorSpace); new THREE.Color(pastel).getHSL(src, THREE.SRGBColorSpace);
    expect(hsl.l).toBeLessThan(src.l); expect(hsl.s).toBeGreaterThanOrEqual(.8); expect(Math.abs(hsl.h - src.h)).toBeLessThan(.02);
  }
  // 이미 진한 색(일반 마법진·영웅색)은 그대로, 흰색은 회색 상한까지만
  for (const vivid of [0x8a4aff, 0xff6040, 0xffd060, 0xff7a30]) expect(vividDecalColor(vivid, out).getHex()).toBe(vivid);
  expect(vividDecalColor(0xffffff, out).getHSL(hsl, THREE.SRGBColorSpace).l).toBeCloseTo(.72);
  const p = new THREE.Vector3();
  fx.groundTex(p, 'shockwave', 0xfff3b0, { r1: 3 });
  const deco = fx.items.at(-1)!.obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(deco.material.color.equals(new THREE.Color(0xfff3b0))).toBe(false);
  fx.groundTex(p, 'shockwave', 0xfff3b0, { r1: 3, telegraph: true });
  const warn = fx.items.at(-1)!.obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(warn.material.color.equals(new THREE.Color(0xfff3b0))).toBe(true);
}));

test('일반 타격 노출(0~30)은 블룸을 그대로 두고 궁극기 겹침에서만 블룸 부하가 오른다', () => withFx(fx => {
  expect(bloomLoadFor(0)).toBe(0); expect(bloomLoadFor(30)).toBe(0); expect(bloomLoadFor(BLOOM_ADAPT.soft)).toBe(0);
  expect(bloomLoadFor(BLOOM_ADAPT.full)).toBe(1); expect(bloomLoadFor(5000)).toBe(1); expect(bloomLoadFor(NaN)).toBe(0);
  expect(fx.bloomLoad()).toBe(0);
  const p = new THREE.Vector3();
  for (let i = 0; i < 12; i++) fx.texFlash(p, 'holy_burst', 0xffffff, { size: 12 });
  expect(fx.bloomLoad()).toBeGreaterThan(0);
  fx.update(3); expect(fx.bloomLoad()).toBe(0);
}));
