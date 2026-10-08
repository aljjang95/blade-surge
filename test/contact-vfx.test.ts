import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';
import { ringTex, sparkTex, VFX_TEX } from '../src/engine/assets.js';

function withFx(run: (fx: FX) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => context }),
    getElementById: () => ({ firstChild: null }),
  } });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(6, 8, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const fx = new FX(new THREE.Scene(), camera);
  try { run(fx); } finally {
    fx.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('실제 접촉 VFX는 종류마다 한 sprite만 만들며 풀의 불꽃·수명·해제를 유지한다', () => withFx(fx => {
  const position = new THREE.Vector3(2, 1.1, -3), direction = new THREE.Vector3(0, 0, 1);
  const initial = position.clone(), source = direction.clone();
  const retained = fx.sparks.pos;
  const slash = fx.contact(position, direction, 0xffd060, { size: 1.45, particles: 7, kind: 'slash', tier: 'finisher' });
  const blunt = fx.contact(position, direction, 0xffd060, { size: 1.45, particles: 7, kind: 'blunt', tier: 'heavy' });
  const magic = fx.contact(position, direction, 0xa0e0ff, { size: 1.45, particles: 7, kind: 'magic', tier: 'heavy' });
  expect(fx.items).toHaveLength(3); expect(fx.items.every(item => item.obj.isSprite)).toBe(true);
  expect(slash.material.map).toBe(sparkTex()); expect(blunt.material.map).toBe(ringTex());
  expect(magic.material.map).toBe(sparkTex()); expect(magic.material.rotation).toBe(Math.PI / 4);
  expect(slash.scale.x / slash.scale.y).toBeCloseTo(4); expect(blunt.scale.x).toBe(blunt.scale.y);
  expect(slash.material.rotation).not.toBe(magic.material.rotation);
  expect(fx.sparks.n).toBe(21); expect(fx.sparks.pos).toBe(retained);
  expect(position.equals(initial)).toBe(true); expect(direction.equals(source)).toBe(true);
  const materials = [slash.material, blunt.material, magic.material];
  let disposed = 0; materials.forEach(material => material.addEventListener('dispose', () => disposed++));
  fx.update(.04); expect(fx.items).toHaveLength(3); expect(slash.material.opacity).toBeLessThan(1);
  fx.update(.2); expect(fx.items).toHaveLength(0); expect(disposed).toBe(3);
  // 불꽃 풀의 기존 수명 변동은 0.18초의 최대 1.4배다.
  fx.update(.04); expect(fx.sparks.n).toBe(0); expect(slash.parent).toBeNull();
  fx.clearAll(); expect(disposed).toBe(3);
}));

test('동작 줄이기는 고정된 작은 접촉 한 개만 남기고 회전·확대·불꽃·조명을 만들지 않는다', () => withFx(fx => {
  const cue = fx.contact(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0xffffff,
    { size: .7, particles: 0, kind: 'blunt', tier: 'finisher', light: true });
  const scale = cue.scale.clone();
  expect(fx.items).toHaveLength(1); expect(cue.material.rotation).toBe(0);
  for (let i = 0; i < 4; i++) { fx.update(.016); expect(cue.scale.equals(scale)).toBe(true); }
  expect(fx.sparks.n).toBe(0); expect(fx.lights.every(slot => slot.light.intensity === 0)).toBe(true);
  fx.update(.02); expect(fx.items).toHaveLength(0);
}));

test('낮음 품질과 잘못된 크기 입력에서도 접촉 면과 불꽃 예산은 유한하다', () => withFx(fx => {
  fx.setQuality('low');
  const cue = fx.contact(new THREE.Vector3(), new THREE.Vector3(), 0xffffff,
    { size: Infinity, particles: 100, kind: 'slash', tier: 'finisher' });
  expect(fx.items).toHaveLength(1); expect(fx.sparks.n).toBe(2);
  expect(cue.scale.toArray().every(Number.isFinite)).toBe(true);
  fx.clearAll(); expect(fx.items).toHaveLength(0); expect(fx.sparks.n).toBe(0);
}));

test('실제 이전 효과 경로와 새 접촉은 같은 시드 난수 순서와 다음 전투 난수를 유지한다', () => withFx(fx => {
  const textures = VFX_TEX as Record<string, THREE.Texture>;
  const previousRandom = Math.random, originalSlash = textures.slash;
  const position = new THREE.Vector3(2, 1, 3), direction = new THREE.Vector3(0, 0, 1);
  // 실제 FX.prepare가 완료한 공유 sprite 셰이더/고리 텍스처 상태에서 비교한다.
  fx.flash(position, 0xffffff, { angle: 0 }); ringTex(); fx.clearAll();
  const cases = [
    { particles: 4, tier: 'light', kind: 'slash' },
    { particles: 7, tier: 'heavy', kind: 'blunt' },
    { particles: 9, tier: 'counter', kind: 'magic' },
    { particles: 7, tier: 'finisher', kind: 'slash' },
    { particles: 0, tier: 'light', kind: 'slash' },
    { particles: 0, tier: 'finisher', kind: 'slash' },
  ];
  function trace(legacy: boolean, options: typeof cases[number]) {
    let state = 20261008;
    const consumed: number[] = [];
    Math.random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; const value = (state >>> 0) / 4294967296; consumed.push(value); return value; };
    const { particles, tier, kind } = options, size = 1.45, color = 0xffd060;
    if (legacy) {
      // 변경 전 FX.contact의 실제 sprite/아틀라스/불꽃 호출 순서다.
      fx.flash(position, color, { size, angle: -.65, contact: true });
      fx.flash(position, 0xffffff, { size: size * .56, angle: -.65, contact: true });
      if ((tier === 'finisher' || particles > 5) && !fx.lite) fx.texFlash(position, 'slash', 0xffffff, { size: size * .9, life: .13, spin: 0, grow: .42, y: 0 });
      if (particles > 0) fx.directional(position, direction, color, { n: fx.lite ? Math.min(3, particles) : particles, speed: particles > 5 ? 11 : 7, size: particles > 5 ? .25 : .18, life: .18, spread: .26 });
    } else fx.contact(position, direction, color, { size, ...options });
    const nextBattleRandom = Math.random();
    Math.random = previousRandom; fx.clearAll();
    return { consumed, nextBattleRandom };
  }
  const authored = new THREE.Texture();
  try {
    for (const texture of [authored, null]) {
      if (texture) textures.slash = texture; else delete textures.slash;
      for (const quality of ['high', 'low']) {
        fx.setQuality(quality);
        for (const options of cases) expect(trace(false, options)).toEqual(trace(true, options));
      }
    }
  } finally {
    Math.random = previousRandom;
    if (originalSlash) textures.slash = originalSlash; else delete textures.slash;
    authored.dispose();
  }
}));
