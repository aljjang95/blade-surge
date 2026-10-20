import * as THREE from 'three';

export const GATE_STONE_SURFACE_PATH = '/img/environment/gate-stone-detail-v1.webp';
/** 한 번만 읽는 무채색 손그림 돌 타일. 로드 전이나 실패 시에는 null 이고 관문은 정점 색만으로 그려진다. */
/** @type {{ texture: THREE.Texture | null }} */
export const GATE_STONE_SURFACE = { texture: null };
// 삼면 투영 한 칸이 덮는 길이(m)의 역수. 0.85 이면 타일 한 장이 약 1.2m 이고 바위 한 덩이가 20~25cm 로 보인다.
const TILE_SCALE = 0.85;
const sharedUniforms = { gateDetailMap: { value: null }, gateDetailScale: { value: TILE_SCALE } };
let pending = null;
const listeners = new Set();

/** 읽은 텍스처를 공유 상태에 넣고 기다리던 관문 재질에 알린다. 불러오기 외에는 테스트가 쓴다. null 은 상태만 되돌린다. */
export function setGateStoneSurface(texture) {
  GATE_STONE_SURFACE.texture = texture;
  sharedUniforms.gateDetailMap.value = texture;
  if (texture) for (const listener of [...listeners]) listener(texture);
}

/** 첫 호출에서만 읽는다. 실패하면 조용히 null 로 끝나 기존 모습을 유지한다. 브라우저가 아니면 읽지 않는다. */
export function preloadGateStoneSurface() {
  if (pending) return pending;
  if (typeof document === 'undefined') return pending = Promise.resolve(null);
  pending = new THREE.TextureLoader().loadAsync(GATE_STONE_SURFACE_PATH).then(texture => {
    texture.name = 'GPT_Gate_Stone_Detail_v1';
    // 색이 아니라 밝기 배율로 쓰는 값이라 변환 없이 읽는다.
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    setGateStoneSurface(texture);
    return texture;
  }).catch(() => null);
  return pending;
}

/** 텍스처가 도착하면 한 번 호출한다. 이미 있으면 바로 호출한다. 돌려주는 함수로 구독을 끊는다. */
export function onGateStoneSurface(listener) {
  if (GATE_STONE_SURFACE.texture) { listener(GATE_STONE_SURFACE.texture); return () => {}; }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 정점 색 × 돌 질감 밝기. 병합 지오메트리의 UV 가 일정하지 않아 오브젝트 좌표 삼면 투영을 쓰고 프래그먼트당 샘플은 3회다.
 * 밝기 배율은 0.6~1.25 로 제한해 루트별 돌 색 구분을 유지한다. 관문 위치마다 패턴이 달라 보이게 모델 이동량을 섞는다.
 */
export function applyGateStoneSurface(material) {
  if (!GATE_STONE_SURFACE.texture || material.userData.gateStoneSurface) return !!material.userData.gateStoneSurface;
  material.userData.gateStoneSurface = 'gpt-gate-stone-detail-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.gateDetailMap = sharedUniforms.gateDetailMap;
    shader.uniforms.gateDetailScale = sharedUniforms.gateDetailScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 gateObjPos;\nvarying vec3 gateObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ngateObjPos = position + modelMatrix[3].xyz * 0.37;\ngateObjNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 gateObjPos;\nvarying vec3 gateObjNormal;\nuniform sampler2D gateDetailMap;\nuniform float gateDetailScale;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 gateW = pow(abs(normalize(gateObjNormal)), vec3(4.0));
          gateW /= gateW.x + gateW.y + gateW.z;
          float gateV = texture2D(gateDetailMap, gateObjPos.zy * gateDetailScale).r * gateW.x
            + texture2D(gateDetailMap, gateObjPos.xz * gateDetailScale).r * gateW.y
            + texture2D(gateDetailMap, gateObjPos.xy * gateDetailScale).r * gateW.z;
          diffuseColor.rgb *= clamp(1.0 + (gateV - 0.49) * 1.7, 0.6, 1.25);
        }`);
  };
  material.customProgramCacheKey = () => 'gate-stone-triplanar-v1';
  material.needsUpdate = true;
  return true;
}
