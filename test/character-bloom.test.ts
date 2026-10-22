import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { bindCharacterBloom, characterBloomMask, excludeFromBloom, isBloomExcluded } from '../src/engine/character-bloom.js';

const standardShader = () => ({ uniforms: {} as Record<string, any>, vertexShader: '',
  fragmentShader: THREE.ShaderLib.standard.fragmentShader });

test('캐릭터 재질은 불투명일 때만 발광 비율을 음수 알파 표식으로 쓰고, 원래 훅·캐시 키를 이어간다', () => {
  const material = new THREE.MeshStandardMaterial();
  let calls = 0;
  material.onBeforeCompile = function (shader) { expect(this).toBe(material); calls++; shader.fragmentShader += '\n// prior'; };
  material.customProgramCacheKey = () => 'prior-key';
  const version = material.version;
  expect(excludeFromBloom(material)).toBe(material);
  const hook = material.onBeforeCompile;
  excludeFromBloom(material);
  expect(material.onBeforeCompile).toBe(hook);
  expect(material.version).toBe(version + 1);
  expect(isBloomExcluded(material)).toBe(true);
  expect(material.customProgramCacheKey()).toBe('prior-key|character-bloom-v1');
  const shader = standardShader();
  material.onBeforeCompile(shader as any, {} as THREE.WebGLRenderer);
  expect(calls).toBe(1);
  expect(shader.uniforms.characterBloomMask).toBe(characterBloomMask);
  expect(shader.fragmentShader.startsWith('uniform float characterBloomMask;')).toBe(true);
  // 표식은 OPAQUE 안에서만, 디더링(마지막 출력) 뒤에서 알파만 바꾼다.
  const tail = shader.fragmentShader.slice(shader.fragmentShader.indexOf('#include <dithering_fragment>'));
  expect(tail).toContain('#ifdef OPAQUE');
  expect(tail).toContain('gl_FragColor.a = characterGlow - 1.0;');
  expect(tail).toContain('totalEmissiveRadiance');
  expect(shader.fragmentShader).toContain('// prior');
});

test('표식은 메인 장면 렌더 밖에서는 꺼져 있고, 셰이더가 없는 재질·VFX 재질은 건너뛴다', () => {
  expect(characterBloomMask.value).toBe(0);
  const basic = new THREE.MeshBasicMaterial(), key = basic.customProgramCacheKey();
  excludeFromBloom(basic);
  expect(isBloomExcluded(basic)).toBe(false);
  expect(basic.customProgramCacheKey()).toBe(key);
  expect(excludeFromBloom(null as any)).toBe(null);
  // 클론은 훅이 복사되지 않으므로 표식 대상으로 보지 않는다(초상화 등 다른 소유자).
  const source = excludeFromBloom(new THREE.MeshStandardMaterial());
  expect(isBloomExcluded(source.clone())).toBe(false);
});

test('블룸 고역 통과는 음수 알파(캐릭터)만 발광 비율로 낮추고 월드 알파 0~1 은 그대로 통과한다', () => {
  const bloom = new UnrealBloomPass(new THREE.Vector2(64, 64), .62, .62, .84);
  try {
    const before = bloom.materialHighPassFilter.fragmentShader;
    expect(bindCharacterBloom(bloom)).toBe(bloom);
    const after = bloom.materialHighPassFilter.fragmentShader;
    expect(after).not.toBe(before);
    expect(after).toContain('float characterWeight = texel.a < 0.0 ? clamp( texel.a + 1.0, 0.0, 1.0 ) : 1.0;');
    expect(after).toContain('gl_FragColor = mix( outputColor, texel, alpha * characterWeight );');
    // 두 번 묶으면 r170 원문이 없으므로 조용히 겹치지 않고 실패한다.
    expect(() => bindCharacterBloom(bloom)).toThrow();
    // 셰이더 식과 같은 가중치: 월드(≥0)는 1, 캐릭터는 발광 비율.
    const weight = (a: number) => a < 0 ? Math.min(1, Math.max(0, a + 1)) : 1;
    expect([1, .5, 0, -1, -.25, 1.6].map(weight)).toEqual([1, 1, 1, 0, .75, 1]);
  } finally {
    bloom.dispose();
  }
});
