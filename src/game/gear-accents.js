import * as THREE from 'three';
import { RARITY_INFO } from '../data/items.js';

/**
 * 라이브러리 영웅(Tripo 몸체 + Mixamo 골격)의 슬롯별 등급 윤곽광.
 * 갑옷 단계 몸체(1~3)만으로는 반지·신발과 같은 단계 안의 등급 차이가 보이지 않는다.
 * 그래서 몸체 재질에 등급색 가장자리 빛(프레넬)을 넣고, 부위는 스킨 가중치로 나눈다.
 *  · 방어구 → 몸 전체 윤곽
 *  · 신발 → 다리·발 본에 실린 정점
 *  · 반지 → 왼팔뚝·왼손 본에 실린 정점
 * 표면에 덧붙인 조각이 아니라 Tripo 원본 실루엣을 그대로 둔다. 드로우콜·정점이 늘지 않고,
 * 셰이더는 재질마다 한 번 붙인 뒤 장비가 바뀌면 유니폼 값만 바꾼다(재컴파일·프레임 할당 없음).
 */
export const GEAR_RIM_STRENGTH = Object.freeze({ N: 0, S: .3, E: .62, U: .78, L: .95 });
const HOOKED = new WeakSet();
const FEET_BONES = ['LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
const RING_BONES = ['LeftForeArm', 'LeftHand'];

/** 등급·강화 → 윤곽광 색(세기를 곱한 선형 색). 없으면 검정. */
export function gearRimColor(item, enh = 0, target = new THREE.Color()) {
  const strength = item ? GEAR_RIM_STRENGTH[item.rarity] || 0 : 0;
  if (!strength) return target.setRGB(0, 0, 0);
  return target.set(RARITY_INFO[item.rarity]?.color || '#ffffff').multiplyScalar(strength + Math.min(20, enh || 0) * .015);
}

/** 본 이름 끝말로 스켈레톤 인덱스를 찾는다. 빈 칸은 -1(어떤 정점과도 맞지 않음). */
export function gearBoneMask(bones, names) {
  const out = new Float32Array(8).fill(-1);
  let n = 0;
  for (const name of names) {
    const index = bones.findIndex((bone) => bone.name.replace(/[^A-Za-z0-9]/g, '').endsWith(name));
    if (index >= 0 && n < 8) out[n++] = index;
  }
  return out;
}

/** 몸체 재질에 윤곽광 훅을 한 번만 건다. 기존 훅(블룸 제외 등)은 먼저 실행한다. */
function hook(material, state) {
  if (HOOKED.has(material) || !material.isMeshStandardMaterial) return;
  const original = material.onBeforeCompile, prefix = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    original.call(this, shader, renderer);
    if (!shader.vertexShader.includes('#include <skinning_vertex>') || !shader.fragmentShader.includes('#include <emissivemap_fragment>')) return;
    Object.assign(shader.uniforms, { gearRimBody: state.body, gearRimFeet: state.feet, gearRimRing: state.ring, gearFeetBones: state.feetBones, gearRingBones: state.ringBones });
    shader.vertexShader = 'uniform float gearFeetBones[8];\nuniform float gearRingBones[8];\nvarying vec2 vGearZone;\n' + shader.vertexShader.replace('#include <skinning_vertex>', `#include <skinning_vertex>
vGearZone = vec2(0.0);
#ifdef USE_SKINNING
for (int k = 0; k < 8; k++) {
  vGearZone.x += dot(skinWeight, vec4(equal(skinIndex, vec4(gearFeetBones[k]))));
  vGearZone.y += dot(skinWeight, vec4(equal(skinIndex, vec4(gearRingBones[k]))));
}
#endif`);
    shader.fragmentShader = 'uniform vec3 gearRimBody;\nuniform vec3 gearRimFeet;\nuniform vec3 gearRimRing;\nvarying vec2 vGearZone;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float gearFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float gearRim = pow(1.0 - gearFacing, 2.6);
  vec3 gearTint = mix(gearRimBody, gearRimFeet, clamp(vGearZone.x * 1.4, 0.0, 1.0));
  gearTint = mix(gearTint, gearRimRing, clamp(vGearZone.y * 1.4, 0.0, 1.0));
  totalEmissiveRadiance += gearTint * gearRim;
}`);
  };
  material.customProgramCacheKey = () => prefix + '|gear-rim-v1';
  material.needsUpdate = true;
  HOOKED.add(material);
}

export function removeGearAccents(model) {
  const state = model.userData.gearRim;
  if (state) for (const u of [state.body, state.feet, state.ring]) u.value.setRGB(0, 0, 0);
  delete model.userData.gearAppearance;
}

/**
 * @param {THREE.Object3D} model 라이브러리 영웅 root
 * @param {{ armor?: any, ring?: any, boots?: any }} gear 슬롯별 아이템 정의(없으면 null)
 * @param {{ armor?: number, ring?: number, boots?: number }} [enh] 슬롯별 강화 수치
 * @returns {string[]} 윤곽광이 켜진 슬롯
 */
export function applyGearAccents(model, gear = {}, enh = {}) {
  const skins = [];
  model.traverse((o) => { if (o.isSkinnedMesh && o.userData.libraryBody) skins.push(o); });
  if (!skins.length) { removeGearAccents(model); return []; }
  // 영웅 인스턴스마다 유니폼 묶음 하나를 재질들이 공유한다(몸체 교체 뒤 새 재질도 같은 묶음에 건다).
  const state = model.userData.gearRim || (model.userData.gearRim = {
    body: { value: new THREE.Color(0) }, feet: { value: new THREE.Color(0) }, ring: { value: new THREE.Color(0) },
    feetBones: { value: new Float32Array(8).fill(-1) }, ringBones: { value: new Float32Array(8).fill(-1) },
  });
  const bones = skins[0].skeleton.bones;
  state.feetBones.value.set(gearBoneMask(bones, FEET_BONES)); state.ringBones.value.set(gearBoneMask(bones, RING_BONES));
  for (const skin of skins) for (const material of Array.isArray(skin.material) ? skin.material : [skin.material]) hook(material, state);
  gearRimColor(gear.armor, enh.armor, state.body.value);
  // 신발·반지가 없으면 그 부위도 몸 윤곽을 따른다.
  if (gear.boots) gearRimColor(gear.boots, enh.boots, state.feet.value); else state.feet.value.copy(state.body.value);
  if (gear.ring) gearRimColor(gear.ring, enh.ring, state.ring.value); else state.ring.value.copy(state.body.value);
  const slots = ['armor', 'boots', 'ring'].filter((slot) => gear[slot] && GEAR_RIM_STRENGTH[gear[slot].rarity] > 0);
  model.userData.gearAppearance = slots;
  return slots;
}
