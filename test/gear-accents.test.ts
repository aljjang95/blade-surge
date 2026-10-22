import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { applyGearAccents, gearBoneMask, gearRimColor, removeGearAccents, GEAR_RIM_STRENGTH } from '../src/game/gear-accents.js';
import { ITEM_BY_ID as ITEMS } from '../src/data/items.js';

const ITEM_BY_ID: Record<string, any> = ITEMS;

function libraryHero() {
  const names = ['mixamorigHips', 'mixamorigSpine', 'mixamorigLeftLeg', 'mixamorigLeftFoot', 'mixamorigLeftForeArm', 'mixamorigLeftHand'];
  const bones = names.map((name) => Object.assign(new THREE.Bone(), { name }));
  for (let i = 1; i < bones.length; i++) bones[0].add(bones[i]);
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(.25), 4));
  const material = new THREE.MeshStandardMaterial();
  const skin = new THREE.SkinnedMesh(geometry, material);
  skin.userData.libraryBody = 1;
  const root = new THREE.Group(); root.add(bones[0], skin);
  skin.bind(new THREE.Skeleton(bones));
  return { root, skin, material };
}

test('등급 윤곽 세기는 N 없음부터 L까지 오르고 강화가 더한다', () => {
  const order = ['N', 'S', 'E', 'U', 'L'].map((r) => GEAR_RIM_STRENGTH[r as keyof typeof GEAR_RIM_STRENGTH]);
  expect(order[0]).toBe(0);
  for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  expect(gearRimColor(ITEM_BY_ID.a_leather).getHex()).toBe(0);
  const plain = gearRimColor(ITEM_BY_ID.a_king), plus = gearRimColor(ITEM_BY_ID.a_king, 15);
  expect(plus.r).toBeGreaterThan(plain.r);
});

test('본 마스크는 Mixamo 이름 끝말로 찾고 빈 칸은 -1', () => {
  const bones = ['mixamorigLeftLeg', 'mixamorigLeftUpLeg', 'mixamorigLeftFoot'].map((name) => Object.assign(new THREE.Bone(), { name }));
  const mask = gearBoneMask(bones, ['LeftLeg', 'LeftFoot', 'RightFoot']);
  expect([...mask.slice(0, 3)]).toEqual([0, 2, -1]);
});

test('장비 표식은 재질 셰이더를 한 번만 고치고 장비가 바뀌면 유니폼만 바꾼다', () => {
  const { root, material } = libraryHero();
  const slots = applyGearAccents(root, { armor: ITEM_BY_ID.a_king, boots: ITEM_BY_ID.b_knight, ring: ITEM_BY_ID.r_copper }, { armor: 0 });
  expect(slots).toEqual(['armor', 'boots']);
  const key = material.customProgramCacheKey();
  expect(key).toContain('gear-rim-v1');
  const shader: any = { uniforms: {}, vertexShader: 'void main(){\n#include <skinning_vertex>\n}', fragmentShader: 'void main(){\n#include <emissivemap_fragment>\n}' };
  material.onBeforeCompile(shader, null as any);
  expect(shader.vertexShader).toContain('vGearZone');
  expect(shader.fragmentShader).toContain('totalEmissiveRadiance += gearTint * gearRim');
  expect(shader.uniforms.gearRimBody.value.getHex()).not.toBe(0);
  // 반지는 N 등급이라 왼손 윤곽은 0, 신발은 에픽 파랑
  expect(shader.uniforms.gearRimRing.value.getHex()).toBe(0);
  expect(shader.uniforms.gearRimFeet.value.b).toBeGreaterThan(shader.uniforms.gearRimFeet.value.r);
  expect([...shader.uniforms.gearFeetBones.value.slice(0, 2)]).toEqual([2, 3]);
  applyGearAccents(root, {});
  expect(material.customProgramCacheKey()).toBe(key);
  expect(shader.uniforms.gearRimBody.value.getHex()).toBe(0);
  applyGearAccents(root, { armor: ITEM_BY_ID.a_knight });
  removeGearAccents(root);
  expect(shader.uniforms.gearRimBody.value.getHex()).toBe(0);
  expect(root.userData.gearAppearance).toBeUndefined();
});

test('라이브러리 몸체가 없는 모델은 건드리지 않는다', () => {
  const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  expect(applyGearAccents(root, { armor: ITEM_BY_ID.a_king })).toEqual([]);
});
