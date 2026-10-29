// 필드 장비 드랍 모델: 인벤토리 · 장착 화면 썸네일과 '3D로 보기'가 쓰는 같은 3D 원본을 드랍에도 쓴다(docs/item-presentation.md).
//  - 대장간 장비(일반 무기 · 반지 · 신발 · 테마/원정/소환 장비): item-forge acquireItemGeometry(형태, 장비).
//    무기는 그 전투 영웅이 실제로 드는 형태(resolveItemForm)로 만든다. 쌍수 형태는 같은 형상 두 개를 교차한다.
//  - 방어구: armor-appearance 의 실제 갑옷 파츠. 바인드 포즈 좌표라 손 소켓 탐침처럼 빈 골격에 한 번 입혀 그 형상을 그대로 받는다.
//  - 병기고 24종: /models/armory-v1/<id>.glb 원본. 비동기라 처음 한 번은 기존 슬롯 형상으로 보이고, 읽히면 그 자리에서 바뀐다.
// 형상 · 재질은 장비 id(+형태) · 등급 단위로 캐시해 모든 드랍이 공유한다. 드랍마다 새 GPU 자원을 만들지 않는다.
// 재질에는 등급 윤곽광(프레넬 발광)을 걸고, 캐릭터 블룸 표식으로 몸 반사광은 번지지 않게 해 윤곽만 블룸에 걸린다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ITEM_BY_ID, RARITY_COLOR } from '../data/items.js';
import { acquireItemGeometry, createItemMaterial } from '../engine/item-forge.js';
import { excludeFromBloom } from '../engine/character-bloom.js';
import { applyArmorAppearance } from './armor-appearance.js';
import { itemRenderSource } from '../ui/item-presentation.js';
import { resolveItemForm } from '../ui/item-visual-forms.js';
import { createLootVisual } from './loot-visual.js';

/** 부위별 드랍 대각선 길이(월드 단위). 기존 0.5~2 범위 안에서 멀리서도 실루엣이 읽히게 키운다. */
export const LOOT_MODEL_SIZE = Object.freeze({ weapon: 1.75, armor: 1.3, boots: 1.1, ring: .95 });
/** 등급 윤곽광: [윤곽 세기, 바탕 발광]. N 은 거의 없고 S 부터 단계적으로 강해진다. 블룸이 꺼진 저화질에서도 테두리 색으로 읽힌다. */
export const LOOT_RIM = Object.freeze({ N: [.22, 0], S: [.75, .03], E: [1.15, .06], U: [1.55, .1], L: [2.1, .16] });
const RIM_PULSE = Object.freeze({ N: 0, S: .12, E: .18, U: .24, L: .3 });
// 어두운 던전 조명에서도 장비 고유 색이 읽히게 알베도의 일부를 스스로 밝힌다(픽업 가독성용, 모든 등급 같은 값).
export const LOOT_LIFT = .16;
// 환경맵이 없는 전투 조명에서 금속도 .82 는 거의 검게 보인다. 드랍 재질만 금속도를 이 값으로 낮춘다(인벤 원본 재질은 그대로).
export const LOOT_MAX_METALNESS = .5;
// 등급별 공유 유니폼 묶음: 색과 [윤곽, 바탕] 세기. update() 가 프레임마다 값만 바꾼다(할당 없음).
const rimUniforms = new Map();
function rimFor(rarity) {
  const key = Object.hasOwn(LOOT_RIM, rarity) ? rarity : 'N';
  if (!rimUniforms.has(key)) rimUniforms.set(key, {
    lootRimColor: { value: new THREE.Color(RARITY_COLOR[key] || '#e6e6e6') },
    lootRimGain: { value: new THREE.Vector3(...LOOT_RIM[key], LOOT_LIFT) },
  });
  return rimUniforms.get(key);
}
/** 등급 윤곽광 맥동. 드랍 시스템이 프레임마다 한 번 부른다. */
export function updateLootRim(time) {
  for (const [rarity, u] of rimUniforms) {
    const k = 1 + Math.sin(time * 3.1 + rarity.charCodeAt(0)) * RIM_PULSE[rarity];
    u.lootRimGain.value.set(LOOT_RIM[rarity][0] * k, LOOT_RIM[rarity][1] * k, LOOT_LIFT);
  }
}

const RIM_STATEMENT = `
{
  float lootFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float lootRim = pow(1.0 - lootFacing, 2.3);
  totalEmissiveRadiance += lootRimColor * (lootRim * lootRimGain.x + lootRimGain.y) + diffuseColor.rgb * lootRimGain.z;
}`;
/** 재질 하나에 등급 윤곽광을 건다. 기존 셰이더 훅(대장간 균열 발광 등)을 먼저 실행한다. */
export function hookLootRim(material, rarity) {
  if (!material?.isMeshStandardMaterial || material.userData.lootRim) return material;
  const original = material.onBeforeCompile, prefix = material.customProgramCacheKey(), uniforms = rimFor(rarity);
  material.onBeforeCompile = function (shader, renderer) {
    original.call(this, shader, renderer);
    if (!shader.fragmentShader.includes('#include <emissivemap_fragment>')) return;
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = 'uniform vec3 lootRimColor;\nuniform vec3 lootRimGain;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + RIM_STATEMENT);
  };
  material.customProgramCacheKey = () => prefix + '|loot-rim-v1';
  material.userData.lootRim = rarity;
  material.needsUpdate = true;
  // 몸의 알베도 반사는 블룸에서 빼고 발광(윤곽 · 균열)만 번지게 한다.
  return excludeFromBloom(material);
}

/** 드랍 형상을 바닥 기준 원점으로 옮기고 정해진 대각선으로 맞추는 변환. */
function fitTransform(box, slot) {
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const scale = (LOOT_MODEL_SIZE[slot] || LOOT_MODEL_SIZE.weapon) / Math.max(1e-4, size.length());
  return { scale, offset: center.multiplyScalar(-scale), halfHeight: size.y * scale / 2 };
}

// 방어구 탐침: 실제 갑옷 함수가 찾는 본(chest · hips · upperarm.l/r)만 있는 빈 골격.
function bakeArmor(item) {
  const probe = new THREE.Group(); probe.userData.tllIdentity = 'casual-v2';
  const bones = ['chest', 'hips', 'upperarm.l', 'upperarm.r'].map((name) => { const bone = new THREE.Bone(); bone.name = name; probe.add(bone); return bone; });
  const skin = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()); skin.name = 'TLL_loot_probe';
  probe.add(skin); probe.updateMatrixWorld(true); skin.bind(new THREE.Skeleton(bones));
  applyArmorAppearance(probe, { id: 'knight' }, item);
  const parts = [];
  for (const mesh of [...probe.children]) {
    if (!mesh.userData.equippedArmor) continue;
    mesh.removeFromParent();
    // 바인드 포즈 = 항등 골격이라 정점 좌표가 곧 갑옷 모양이다. 드랍에는 스킨 속성이 필요 없다.
    mesh.geometry.deleteAttribute('skinIndex'); mesh.geometry.deleteAttribute('skinWeight');
    mesh.geometry.computeBoundingBox();
    parts.push({ geometry: mesh.geometry, material: mesh.material });
  }
  skin.geometry.dispose(); skin.material.dispose(); skin.skeleton.dispose();
  if (!parts.length) throw Error('방어구 드랍 형상 없음: ' + item.id);
  return parts;
}

/** 원본 형상 묶음: { parts: [{ geometry, material, matrix? }], slot, source, fit } */
function boxOf(parts) {
  const box = new THREE.Box3(), part = new THREE.Box3();
  for (const p of parts) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    part.copy(p.geometry.boundingBox); if (p.matrix) part.applyMatrix4(p.matrix);
    box.union(part);
  }
  return box;
}

let gltfLoader = null;
const loader = () => gltfLoader || (gltfLoader = (() => { const created = new GLTFLoader(); created.setMeshoptDecoder(MeshoptDecoder); return created; })());

/**
 * 장비 드랍 모델 라이브러리. 드랍 시스템 하나가 하나를 소유하고 전투가 바뀌어도 유지한다.
 * build() 는 동기다. 병기고 GLB 처럼 아직 없는 원본은 기존 슬롯 형상으로 먼저 보이고 준비되면 onReady 로 교체한다.
 */
export class LootModelLibrary {
  constructor({ load = (url) => loader().loadAsync(url) } = {}) {
    this.sources = new Map();     // `${id}|${form}` → 원본 형상 묶음
    this.materials = new Map();   // `${id}|${rarity}|${n}` → 윤곽광 재질
    this.fallbackMaterials = new Map();
    this.pending = new Map();     // 병기고 id → Promise
    this.leases = [];
    this.owned = new Set();      // 라이브러리가 만든 형상(방어구 굽기 · 병기고 GLB)
    this.load = load;
  }
  /** 전부 반납한다(전투 시스템 수명이 끝날 때 · 테스트 정리). 대장간 공유 버퍼는 임대만 돌려준다. */
  dispose() {
    for (const lease of this.leases.splice(0)) lease.release();
    for (const geometry of this.owned) geometry.dispose();
    for (const material of this.materials.values()) for (const m of [material].flat()) m.dispose();
    for (const pair of this.fallbackMaterials.values()) for (const m of pair) m.dispose();
    for (const source of this.sources.values()) if (source.kind === 'armor-rig') for (const part of source.parts) part.material.dispose();
    this.owned.clear(); this.sources.clear(); this.materials.clear(); this.fallbackMaterials.clear(); this.pending.clear();
  }
  /** 이 장비가 드랍에서 어떤 원본을 쓰는지. 테스트 · QA 가 같은 판정을 읽는다. */
  sourceOf(item, heroId = null) {
    const def = ITEM_BY_ID[item?.id];
    if (!def) return { kind: 'fallback', key: null, form: null, count: 1 };
    const kind = itemRenderSource(def);
    if (kind === 'armory-glb') return { kind, key: def.id + '|armory', form: 'armory', count: 1 };
    if (kind === 'armor-rig') return { kind, key: def.id + '|armor', form: 'armor', count: 1 };
    if (def.slot !== 'weapon') return { kind, key: def.id + '|' + def.slot, form: def.slot, count: 1 };
    // 영웅이 실제로 드는 형태(활 · 지팡이 · 쌍단검 …). 병기고가 아닌 무기만 여기 온다.
    const form = resolveItemForm(def, heroId);
    const shape = form.variant === 'hero-form' ? form.form : 'sword';
    const count = form.variant === 'hero-form' ? Math.max(1, form.count || 1) : 1;
    return { kind, key: def.id + '|' + shape + (count > 1 ? '-pair' : ''), form: shape, count };
  }
  _source(def, info) {
    if (this.sources.has(info.key)) return this.sources.get(info.key);
    let parts;
    if (info.kind === 'armor-rig') { parts = bakeArmor(def); for (const part of parts) this.owned.add(part.geometry); }
    else if (info.kind === 'armory-glb') return null;
    else {
      // 인벤 3D 보기와 같은 공유 버퍼를 영구 임대한다(미리보기가 반환해도 드랍 쪽은 남는다).
      const lease = acquireItemGeometry(info.form, def); this.leases.push(lease);
      parts = [{ geometry: lease.geometry, material: null }];
      if (info.count > 1) {
        const box = lease.geometry.boundingBox || (lease.geometry.computeBoundingBox(), lease.geometry.boundingBox);
        const length = box.max.y - Math.max(0, box.min.y), mid = length / 2;
        // item-visual-model 의 crossPair 와 같은 교차 배치.
        parts.push({ geometry: lease.geometry, material: null, matrix: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(mid, mid, -.06 * Math.max(.5, length)) });
      }
    }
    const source = { parts, slot: def.slot, kind: info.kind, form: info.form, fit: fitTransform(boxOf(parts), def.slot) };
    this.sources.set(info.key, source);
    return source;
  }
  _material(def, rarity, index, base, form = null) {
    const key = `${def.id}|${rarity}|${index}${form ? '|' + form : ''}`;
    if (!this.materials.has(key)) {
      // 대장간 재질은 장비 표면(얼음 등)을 읽어 새로 만들고, 방어구 · 병기고 원본 재질은 복제해 등급 윤곽만 더한다.
      const material = base ? base.clone() : createItemMaterial(def, form)[0];
      if (base?.onBeforeCompile && base.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
        material.onBeforeCompile = base.onBeforeCompile; material.customProgramCacheKey = base.customProgramCacheKey;
      }
      if (material.isMeshStandardMaterial) material.metalness = Math.min(material.metalness, LOOT_MAX_METALNESS);
      this.materials.set(key, hookLootRim(material, rarity));
    }
    return this.materials.get(key);
  }
  _armory(def) {
    if (this.pending.has(def.id)) return this.pending.get(def.id);
    const promise = this.load('/models/armory-v1/' + def.modelNode + '.glb').then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      // 다중 재질 메시도 그대로 쓰도록 메시 단위로 묶는다. 형상은 원본 GLB 것을 공유한다.
      const meshes = [];
      gltf.scene.traverse((node) => { if (node.isMesh) { meshes.push({ geometry: node.geometry, material: node.material, matrix: node.matrixWorld.clone() }); this.owned.add(node.geometry); } });
      if (!meshes.length) throw Error('병기고 드랍 메시 없음: ' + def.id);
      const source = { parts: meshes, slot: def.slot, kind: 'armory-glb', fit: fitTransform(boxOf(meshes), def.slot) };
      this.sources.set(def.id + '|armory', source);
      return source;
    });
    promise.catch(() => this.pending.delete(def.id));
    this.pending.set(def.id, promise);
    return promise;
  }
  _fallback(item) {
    const root = createLootVisual(item, this.fallbackMaterials);
    root.rotation.x = 0;
    for (const child of root.children) { child.castShadow = false; child.receiveShadow = false; }
    return root;
  }
  /** 원본 형상 묶음 → 드랍 껍데기(Group). 메시는 형상 · 재질을 공유하고 자신만의 GPU 자원을 갖지 않는다. */
  _attach(root, def, rarity, source) {
    const pivot = new THREE.Group(); pivot.name = 'loot-pivot';
    pivot.scale.setScalar(source.fit.scale); pivot.position.copy(source.fit.offset);
    source.parts.forEach((part, index) => {
      const material = Array.isArray(part.material) ? part.material.map((m, j) => this._material(def, rarity, `${index}.${j}`, m)) : this._material(def, rarity, index, part.material, source.form);
      const mesh = new THREE.Mesh(part.geometry, material);
      if (part.matrix) part.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = `loot-mesh-${def.id}`;
      pivot.add(mesh);
    });
    root.add(pivot);
    root.userData.lootSource = source.kind;
    root.userData.lootRestY = Math.max(.55, source.fit.halfHeight + .16);
  }
  /**
   * @param {{ id: string, rarity?: string }} item 드랍 장비(인스턴스)
   * @param {{ heroId?: string|null, onReady?: (root: THREE.Group) => void, prepare?: (staged: THREE.Group) => unknown }} [options]
   * @returns {THREE.Group}
   */
  build(item, { heroId = null, onReady, prepare } = {}) {
    const def = ITEM_BY_ID[item?.id], rarity = item?.rarity || def?.rarity || 'N';
    const slot = def?.slot || 'weapon';
    const root = new THREE.Group(); root.name = `loot-${slot}-${item?.id}`;
    root.userData.lootSlot = slot; root.userData.lootRarity = rarity;
    if (def?.summon) root.userData.lootSummon = def.summon.id;
    const info = this.sourceOf(item, heroId);
    let source = null;
    try { source = def && info.kind !== 'fallback' ? this._source(def, info) : null; }
    catch (error) { console.warn('loot model fallback', item?.id, error?.message); source = null; }
    if (source) { this._attach(root, def, rarity, source); return root; }
    const fallback = this._fallback(item);
    for (const child of [...fallback.children]) root.add(child);
    root.userData.lootSource = 'fallback'; root.userData.lootRestY = .72;
    if (def && info.kind === 'armory-glb') {
      root.userData.lootPendingSource = 'armory-glb';
      this._armory(def).then(async (ready) => {
        // 교체 전에 새 재질 셰이더를 비동기로 준비해 바뀌는 순간 끊기지 않게 한다.
        const staged = new THREE.Group(); this._attach(staged, def, rarity, ready);
        try { await prepare?.(staged); } catch { /* 준비 실패는 첫 그리기 컴파일로 넘어간다 */ }
        // 이미 주웠거나 사라진 드랍은 바꾸지 않는다.
        if (root.userData.lootPendingSource !== 'armory-glb') return;
        delete root.userData.lootPendingSource;
        for (const child of [...root.children]) root.remove(child);
        for (const child of [...staged.children]) root.add(child);
        Object.assign(root.userData, { lootSource: staged.userData.lootSource, lootRestY: staged.userData.lootRestY });
        onReady?.(root); root.userData.onLootReady?.(root);
      }).catch((error) => { console.warn('armory loot model fallback', def.id, error?.message); delete root.userData.lootPendingSource; });
    }
    return root;
  }
  /** 첫 드랍 셰이더 컴파일 끊김 방지용 준비 껍데기: 대장간 · 방어구(금속/천) · 폴백 재질 프로그램을 모두 담는다. */
  preparation() {
    return [['w_iron', 'N'], ['a_chain', 'S'], ['a_cloth', 'N'], ['r_ruby', 'E']].map(([id, rarity]) => this.build({ id, rarity }))
      .concat([this._fallback({ id: 'b_cloth', rarity: 'N' })]);
  }
}
