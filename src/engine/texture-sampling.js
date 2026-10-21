import * as THREE from 'three';

/** 캐릭터 텍스처 이방성 상한. 실제 값은 기기가 지원하는 최대치와 비교해 더 작은 쪽을 쓴다. */
export const CHARACTER_ANISOTROPY = 8;
// 렌더러가 만들어지면 기기 최대치를 알려 준다. 그 전에 읽힌 모델도 Three 가 업로드할 때 기기 최대치로 다시 잘라 주므로 안전하다.
let deviceMaxAnisotropy = CHARACTER_ANISOTROPY;

/** Renderer 생성 직후 `renderer.capabilities.getMaxAnisotropy()` 를 넘긴다. */
export function setDeviceMaxAnisotropy(max) {
  deviceMaxAnisotropy = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1;
}

/** min(8, 기기 최대 이방성). 순수 함수라 기기 값을 직접 넘겨 시험할 수 있다. */
export function characterAnisotropy(max = deviceMaxAnisotropy) {
  return Math.max(1, Math.min(CHARACTER_ANISOTROPY, Number.isFinite(max) ? Math.floor(max) : 1));
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'specularColorMap', 'specularIntensityMap'];

/**
 * 재질의 모든 텍스처를 밉맵 + 이방성 필터로 맞춘다. 영웅·몬스터가 작게 그려질 때 번쩍이거나 뭉개지지 않고,
 * 비스듬히 보일 때도 무늬가 선명하게 남는다. 텍스처를 줄이거나 다시 그리지 않는다(필터 설정만 바꾼다).
 * @returns {number} 손댄 텍스처 수
 */
export function tuneCharacterTextures(material, anisotropy = characterAnisotropy()) {
  if (!material) return 0;
  let count = 0;
  for (const slot of TEXTURE_SLOTS) {
    const texture = material[slot];
    if (!texture || !texture.isTexture || texture.isRenderTargetTexture) continue;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = anisotropy;
    count++;
  }
  return count;
}
