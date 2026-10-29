import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';

// 전투 중 레벨업 연출은 인스턴스 임팩트 층·입자 풀·조명 풀만 쓴다(AGENTS.md 인스턴싱·프레임 할당 규칙).
test('levelUpBurst 는 장면에 메시를 더하지 않고 Math.random 을 쓰지 않으며 임팩트 칸을 프레임 예산 안에서 쓴다', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => context }), getElementById: () => ({ firstChild: null }),
  } });
  const scene = new THREE.Scene(), fx = new FX(scene, new THREE.PerspectiveCamera());
  const nativeRandom = Math.random; let calls = 0;
  try {
    const before = scene.children.length, live = (fx as any).live?.length ?? 0, high = (fx as any).impact.ring.high;
    Math.random = () => { calls++; return nativeRandom(); };
    fx.levelUpBurst(new THREE.Vector3(1, 0, 2), '#7feac0');
    Math.random = nativeRandom;
    expect(scene.children.length).toBe(before);
    expect((fx as any).live?.length ?? 0).toBe(live);
    expect(calls).toBe(0);
    const used = (fx as any).impact.ring.high - high;
    expect(used).toBeGreaterThan(6);
    expect(used).toBeLessThanOrEqual(24);
  } finally {
    Math.random = nativeRandom; fx.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
  }
});
