import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';
import { VFX_TEX } from '../src/engine/assets.js';
import { decorativeBurstGain } from '../src/engine/combat-feedback.js';

function withFx(run: (fx: FX) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => context }), getElementById: () => ({ firstChild: null }),
  } });
  const fx = new FX(new THREE.Scene(), new THREE.PerspectiveCamera());
  try { run(fx); } finally {
    fx.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('장식 발광 상한은 작은 접촉을 그대로 두고 넓은 폭발만 읽을 수 있는 밝기로 낮춘다', () => {
  for (const size of [0, 1.45, 2.4, 3, 4, NaN, Infinity]) expect(decorativeBurstGain(size)).toBe(1);
  const gains = [5, 6, 8, 10, 12, 20].map(decorativeBurstGain);
  expect(gains[0]).toBeLessThan(1);
  expect(gains.every((gain, i) => gain >= .2 && (!i || gain <= gains[i - 1]))).toBe(true);
  expect(gains[4]).toBeLessThanOrEqual(.3);
  expect(gains[5]).toBe(gains[4]);
});

test('큰 충격파는 텍스처와 폴백 모두 RGB만 낮추고 지름·알파·수명·난수 진행을 보존한다', () => withFx(fx => {
  const textures = VFX_TEX as Record<string, THREE.Texture>;
  const previous = textures.shockwave, texture = new THREE.Texture(), random = Math.random;
  const position = new THREE.Vector3(2, 0, -3), color = new THREE.Color(0xffd060), originalColor = color.clone();
  function trace(decorative: boolean, radius: number) {
    let state = 20261008;
    const consumed: number[] = [];
    Math.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const value = state / 4294967296; consumed.push(value); return value;
    };
    try {
      if (decorative) fx.shockTex(position, color, { r1: radius, life: .5 });
      else fx.groundTex(position, 'shockwave', color, { r0: .5, r1: radius, life: .5, spin: .4, y: .1, fadeIn: .05 });
      const item = fx.items.at(-1)!, mesh = item.obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const rgb = mesh.material.color.clone(), samples: unknown[] = [];
      for (const dt of [.05, .1, .2]) {
        fx.update(dt);
        samples.push({ position: mesh.position.toArray(), scale: mesh.scale.toArray(), rotation: mesh.rotation.toArray(), opacity: mesh.material.opacity });
      }
      const next = Math.random();
      expect(fx.items).toHaveLength(1); expect(item.life).toBe(.5);
      fx.update(.16); expect(fx.items).toHaveLength(0); expect(mesh.parent).toBeNull();
      return { rgb, samples, consumed, next };
    } finally { Math.random = random; fx.clearAll(); }
  }
  try {
    for (const asset of [texture, null]) {
      if (asset) textures.shockwave = asset; else delete textures.shockwave;
      // 출격 준비와 같은 기존 재질 변형을 먼저 채운다.
      fx.shockTex(position, color, { r1: 14 }); fx.clearAll();
      for (const radius of [3, 14]) {
        const baseline = trace(false, radius), candidate = trace(true, radius);
        expect(candidate.samples).toEqual(baseline.samples);
        expect(candidate.consumed).toEqual(baseline.consumed); expect(candidate.next).toBe(baseline.next);
        const ratio = candidate.rgb.r / baseline.rgb.r;
        if (radius === 3) expect(ratio).toBe(1);
        else { expect(ratio).toBeGreaterThanOrEqual(.2); expect(ratio).toBeLessThanOrEqual(.3); }
        expect(color.equals(originalColor)).toBe(true);
      }
    }
  } finally {
    Math.random = random;
    if (previous) textures.shockwave = previous; else delete textures.shockwave;
    texture.dispose();
  }
}));

test('장식 gain이 주어져도 실제 적 예고와 일반 마법진의 원래 색·밝기는 유지한다', () => withFx(fx => {
  const textures = VFX_TEX as Record<string, THREE.Texture>;
  const previous = textures.shockwave, texture = new THREE.Texture();
  const position = new THREE.Vector3(), color = new THREE.Color(0xff6040);
  try {
    for (const asset of [texture, null]) {
      if (asset) textures.shockwave = asset; else delete textures.shockwave;
      for (const options of [{ r1: 14 }, { r1: 14, telegraph: true, gain: .2 }]) {
        fx.groundTex(position, 'shockwave', color, options);
        const mesh = fx.items.at(-1)!.obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
        expect(mesh.material.color.equals(color)).toBe(true);
        fx.clearAll();
      }
    }
  } finally {
    if (previous) textures.shockwave = previous; else delete textures.shockwave;
    texture.dispose();
  }
}));
