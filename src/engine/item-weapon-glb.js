// 장비 무기 id별 Tripo GLB(검성 sword / greatsword 전용) 선로드와 캐시.
// 매니페스트에 없거나 형태가 다르거나 로딩이 실패하면 항상 null → 호출 쪽이 기존 절차적 무기로 폴백한다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import MANIFEST from '../data/item-weapon-glb.json';

export const ITEM_WEAPON_GLB_FORMS = Object.freeze(['sword', 'greatsword']);
export const ITEM_WEAPON_GLB_BUDGET = Object.freeze({ triangles: 4000, textureMax: 1024 });

const records = new Map();   // id → { form, geometry, material }
const failed = new Set();
const warned = new Set();
let active = MANIFEST;
let pending = null;
let loader = null;
// GLB 하나가 멈춰도 영웅 로딩 전체가 기다리지 않게 항목별 상한. 넘기면 실패로 보고 절차적 무기로 폴백.
const LOAD_TIMEOUT_MS = 8000;

function withTimeout(promise, id) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`시간 초과 ${LOAD_TIMEOUT_MS}ms: ${id}`)), LOAD_TIMEOUT_MS); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function warnOnce(key, message, error) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message, error?.message || error || '');
}

function entryOf(id) { return active.items.find(item => item.id === id) || null; }

/** 매니페스트 항목. 형태가 다르면 null(검성 외 영웅·다른 형태에 검 모델이 붙지 않게). */
export function itemWeaponGlbEntry(id, form) {
  const entry = entryOf(id);
  return entry && entry.form === form ? entry : null;
}

/** 로딩이 끝난 GLB 기록. 없거나 실패했거나 형태가 다르면 null. 프레임 루프에서 불려도 할당이 없다. */
export function itemWeaponGlb(id, form) {
  const record = records.get(id);
  return record && record.form === form ? record : null;
}

function bakeRecord(entry, gltf) {
  let mesh = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    if (mesh) throw Error('무기 GLB 메시가 하나가 아님');
    mesh = o;
  });
  if (!mesh || Array.isArray(mesh.material) || mesh.isSkinnedMesh) throw Error('무기 GLB 단일 메시·단일 재질 계약 실패');
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  // 정점색·보조 속성은 쓰지 않는다. forgeGlow / forgeMetal 이 없는 GLB 라 위치·법선·UV 만 남긴다.
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  // 호출 쪽(look.js·loot-models·item-visual-model)은 재질을 배열로 붙인다. 그룹이 없으면 three 가 아무것도 그리지 않으므로
  // 절차적 무기(item-forge finish)와 같이 전체를 0번 재질 그룹 하나로 둔다.
  geometry.clearGroups();
  geometry.addGroup(0, geometry.index ? geometry.index.count : geometry.attributes.position.count, 0);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!(box.min.y < 0 && box.max.y > 0)) throw Error('무기 GLB 손잡이 원점이 길이축(+Y) 안에 없음');
  geometry.computeBoundingSphere();
  const source = mesh.material;
  const material = new THREE.MeshStandardMaterial({
    map: source.map || null, normalMap: source.normalMap || null,
    roughness: source.roughness ?? .5, metalness: source.metalness ?? .6,
    // 강화 빛(look.js)이 emissive 를 칠한다. 텍스처 발광은 쓰지 않아 칠한 색이 그대로 보인다.
    emissive: new THREE.Color(0), emissiveMap: null, vertexColors: false,
  });
  material.name = `ItemWeaponGlb_${entry.id}`;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  mesh.geometry.dispose(); source.dispose();
  return { form: entry.form, geometry, material };
}

/** 매니페스트의 GLB 를 한 번만 미리 읽는다. 여러 번 불러도 같은 약속을 돌려주고, 실패는 항목별로 null 폴백.
 * @param {{ manifest?: { items: any[] }, load?: (url: string) => Promise<any> }} [options] 시험용 주입
 */
export function preloadItemWeaponGlbs(options = {}) {
  if (options.manifest) { active = options.manifest; pending = null; }
  if (pending) return pending;
  const load = options.load || (url => {
    if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
    return loader.loadAsync(url);
  });
  pending = Promise.all(active.items.map(async entry => {
    if (records.has(entry.id) || failed.has(entry.id)) return;
    if (!ITEM_WEAPON_GLB_FORMS.includes(entry.form)) { failed.add(entry.id); warnOnce(entry.id, `[item-weapon-glb] 지원하지 않는 형태: ${entry.id}:${entry.form}`); return; }
    try { records.set(entry.id, bakeRecord(entry, await withTimeout(load(entry.file), entry.id))); }
    catch (error) { failed.add(entry.id); warnOnce(entry.id, `[item-weapon-glb] 로딩 실패, 절차적 무기로 대체: ${entry.id}`, error); }
  })).then(() => undefined);
  return pending;
}

/** 시험용: 캐시와 상태를 비운다. */
export function resetItemWeaponGlbsForTest() {
  for (const record of records.values()) { record.geometry.dispose(); record.material.dispose(); }
  records.clear(); failed.clear(); warned.clear(); active = MANIFEST; pending = null;
}
