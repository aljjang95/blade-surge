// 캐릭터(영웅·몬스터·동행)의 조명 받은 몸·장비가 블룸을 만들지 않게 하는 표식.
// 밝은 흰 갑옷·금발·검날이 블룸 문턱(선형 0.84)을 넘어 자기 몸 위에 뿌연 빛을 덮으면서 색이 하얗게 바랬다.
// 장면 렌더 타깃(HalfFloat)의 알파에 음수 표식을 쓴다: 불투명 캐릭터 픽셀은 (발광 비율 - 1) ∈ [-1, 0].
// 블룸 고역 통과는 알파가 음수일 때만 (알파 + 1) = 발광 비율만큼 통과시킨다. 그래서
//  - 몸의 알베도·조명 반사는 블룸이 없고, 피격 번쩍임·무기 등급 발광 같은 발광 성분은 그대로 번진다.
//  - 월드 재질의 알파(0~1)는 건드리지 않으므로 VFX·월드 블룸은 이전과 같다.
//  - 가산 VFX 가 캐릭터 위에 겹치면 알파가 올라가 그만큼 다시 번진다.
// 표식은 메인 렌더러가 장면을 그리는 동안(characterBloomMask=1)만 켠다. 같은 재질을 쓰는 초상화·미리보기의
// 투명 캔버스는 값이 0 이라 알파가 바뀌지 않는다.

export const characterBloomMask = { value: 0 };

const LUMA = 'vec3(.2126, .7152, .0722)';
const STATEMENT = `
#ifdef OPAQUE
if (characterBloomMask > .5) {
  float characterGlow = clamp(dot(totalEmissiveRadiance, ${LUMA}) / max(dot(outgoingLight, ${LUMA}), 1e-4), 0.0, 1.0);
  gl_FragColor.a = characterGlow - 1.0;
}
#endif`;
const ANCHOR = '#include <dithering_fragment>';
const bound = new WeakSet();

/** 캐릭터 몸·장비 재질 하나에 표식을 건다. 같은 재질에 두 번 걸지 않고, 원래 셰이더 훅은 그대로 먼저 실행한다. */
export function excludeFromBloom(material) {
  if (!material || bound.has(material)) return material;
  if (!(material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial || material.isMeshToonMaterial)) return material;
  const original = material.onBeforeCompile, prefix = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    original.call(this, shader, renderer);
    if (!shader.fragmentShader.includes(ANCHOR) || !shader.fragmentShader.includes('totalEmissiveRadiance')) return;
    shader.uniforms.characterBloomMask = characterBloomMask;
    shader.fragmentShader = 'uniform float characterBloomMask;\n' + shader.fragmentShader.replace(ANCHOR, ANCHOR + STATEMENT);
  };
  material.customProgramCacheKey = () => prefix + '|character-bloom-v1';
  material.needsUpdate = true;
  bound.add(material);
  return material;
}

export const isBloomExcluded = (material) => bound.has(material);

/** three r170 UnrealBloomPass 고역 통과에 캐릭터 표식 가중치를 넣는다. */
export function bindCharacterBloom(bloom) {
  const material = bloom?.materialHighPassFilter;
  const output = 'gl_FragColor = mix( outputColor, texel, alpha );';
  if (!material?.isShaderMaterial || !material.fragmentShader.includes(output)) throw new Error('character bloom requires the Three r170 luminosity high pass');
  material.fragmentShader = material.fragmentShader.replace(output,
    'float characterWeight = texel.a < 0.0 ? clamp( texel.a + 1.0, 0.0, 1.0 ) : 1.0;\n\t\t\tgl_FragColor = mix( outputColor, texel, alpha * characterWeight );');
  material.needsUpdate = true;
  return bloom;
}
