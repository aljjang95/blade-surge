// 장비 무기 id·형태별 Tripo GLB(영웅 무기 8형태 전부; 같은 id가 형태마다 GLB를 가질 수 있음) 선로드와 캐시.
// 매니페스트에 없거나 형태가 다르거나 로딩이 실패하면 항상 null → 호출 쪽이 기존 절차적 무기로 폴백한다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import MANIFEST from '../data/item-weapon-glb.json';
import { isRemoteAsset, readRemoteBuffer, remoteAssets } from '../platform/remote-assets.js';

export const ITEM_WEAPON_GLB_FORMS = Object.freeze(['sword', 'greatsword', 'axe', 'greataxe', 'wand', 'staff', 'dagger', 'bow']);
/** 텍스처가 있는 GLB 무기는 등급·강화 발광을 이 비율로만 칠한다(절차적 무기 대비). */
export const ITEM_WEAPON_GLB_EMISSIVE_SCALE = 0.4;
export const ITEM_WEAPON_GLB_METALNESS_MAX = 0.3;
export const ITEM_WEAPON_GLB_COLOR_LIFT = 1.35;
export const ITEM_WEAPON_GLB_BUDGET = Object.freeze({ triangles: 4000, textureMax: 1024 });

const records = new Map();   // `${id}:${form}` → { form, geometry, material }
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

const keyOf = (id, form) => `${id}:${form}`;
function entryOf(id, form) { return active.items.find(item => item.id === id && item.form === form) || null; }

/** 매니페스트 항목. 형태가 다르면 null(같은 id의 다른 형태 모델이 붙지 않게). */
export function itemWeaponGlbEntry(id, form) {
  return entryOf(id, form);
}

/** 로딩이 끝난 GLB 기록. 없거나 실패했거나 형태가 다르면 null. 프레임 루프에서 불려도 할당이 없다. */
export function itemWeaponGlb(id, form) {
  return records.get(keyOf(id, form)) || null;
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
  // Tripo 재질은 metallicRoughness 텍스처에 기대어 metalness=1·roughness=1 을 둔다. 텍스처를 버리면 전부 금속(환경광 없으면 검정)이 된다.
  const metalnessMap = source.metalnessMap || null, roughnessMap = source.roughnessMap || null;
  const material = new THREE.MeshStandardMaterial({
    map: source.map || null, normalMap: source.normalMap || null, metalnessMap, roughnessMap,
    roughness: roughnessMap ? (source.roughness ?? 1) : (source.roughness ?? .5),
    // Tripo 강철은 중간 회색 albedo(sRGB 약 100)에 금속 맵 약 0.85 라, 이 게임 조명에서는 반사색이 어둡게 가라앉는다.
    // 아이콘의 밝은 손그림 강철에 맞추려고 금속 계수를 낮추고(맵의 부위 차이는 유지) 색을 조금 밝힌다.
    metalness: Math.min(source.metalness ?? .6, ITEM_WEAPON_GLB_METALNESS_MAX),
    color: new THREE.Color(ITEM_WEAPON_GLB_COLOR_LIFT, ITEM_WEAPON_GLB_COLOR_LIFT, ITEM_WEAPON_GLB_COLOR_LIFT),
    // 강화 빛(look.js)이 emissive 를 칠한다. 발광을 색 텍스처로 곱해 무늬가 남게 하고(단색 덩어리 방지),
    // look.js 는 userData.emissiveScale 로 절차적 무기보다 약하게 칠한다.
    emissive: new THREE.Color(0), emissiveMap: source.map || null, vertexColors: false,
    side: source.side ?? THREE.FrontSide,
  });
  material.userData.emissiveScale = ITEM_WEAPON_GLB_EMISSIVE_SCALE;
  material.name = `ItemWeaponGlb_${entry.id}_${entry.form}`;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  mesh.geometry.dispose(); source.dispose();
  return { form: entry.form, geometry, material };
}

/** 매니페스트의 GLB 를 한 번만 미리 읽는다. 여러 번 불러도 같은 약속을 돌려주고, 실패는 항목별로 null 폴백.
 * @param {{ manifest?: { items: any[] }, load?: (url: string) => Promise<any> }} [options] 시험용 주입
 */
export function preloadItemWeaponGlbs(options = {}) {
  if (options.manifest) { active = options.manifest; pending = null; }
  const load = options.load || defaultLoad;
  // 스토어 네이티브 채널에서 APK 밖(remote)인 GLB 는 이미 기기에 보관된 것만 여기서 읽는다(첫 실행 부팅이 다운로드를 기다리지 않는다).
  // 나머지는 사전 내려받기('weapons' 묶음, 와이파이)나 loadItemWeaponGlbsFor 가 채우고, 그때까지 호출 쪽은 절차적 무기로 폴백한다.
  if (!pending) pending = Promise.all(active.items.map(async entry => {
    const key = keyOf(entry.id, entry.form);
    if (records.has(key) || failed.has(key)) return;
    if (!ITEM_WEAPON_GLB_FORMS.includes(entry.form)) { failed.add(key); warnOnce(key, `[item-weapon-glb] 지원하지 않는 형태: ${key}`); return; }
    if (!options.load && isRemoteAsset(entry.file) && !remoteAssets.isCached(entry.file)) return;
    try { records.set(key, bakeRecord(entry, await withTimeout(load(entry.file), key))); }
    catch (error) { failed.add(key); warnOnce(key, `[item-weapon-glb] 로딩 실패, 절차적 무기로 대체: ${key}`, error); }
  })).then(() => undefined);
  return pending.then(() => sweepStoredRemote(load, options));
}

function defaultLoad(url) {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  if (isRemoteAsset(url)) return readRemoteBuffer(url).then(buffer => loader.parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1)));
  return loader.loadAsync(url);
}

const remoteJobs = new Map();   // key → Promise (같은 GLB 를 동시에 두 번 읽지 않는다)
/** remote GLB 한 개를 읽어 기록한다. 실패해도 failed 에 넣지 않아 다음 호출에서 다시 시도한다. */
function loadRemoteEntry(entry, load) {
  const key = keyOf(entry.id, entry.form);
  if (records.has(key)) return Promise.resolve();
  if (remoteJobs.has(key)) return remoteJobs.get(key);
  const job = (async () => {
    try { records.set(key, bakeRecord(entry, await withTimeout(load(entry.file), key))); }
    catch (error) { warnOnce(key, `[item-weapon-glb] remote 로딩 실패, 절차적 무기로 대체: ${key}`, error); }
  })().finally(() => remoteJobs.delete(key));
  remoteJobs.set(key, job);
  return job;
}

/** 이미 보관된 remote GLB 를 (사전 내려받기가 끝난 뒤) 기록으로 올린다. */
function sweepStoredRemote(load, options) {
  if (options.load) return undefined;
  const todo = active.items.filter(entry => !records.has(keyOf(entry.id, entry.form)) && !failed.has(keyOf(entry.id, entry.form))
    && ITEM_WEAPON_GLB_FORMS.includes(entry.form) && isRemoteAsset(entry.file) && remoteAssets.isCached(entry.file));
  return todo.length ? Promise.all(todo.map(entry => loadRemoteEntry(entry, load))).then(() => undefined) : undefined;
}

/** 아이템 하나가 화면에 나오기 직전: 그 아이템의 remote GLB(형태마다 수백 KB)만 받아 기록한다. 못 받으면 절차적 무기 그대로. */
export function loadItemWeaponGlbsFor(id) {
  return Promise.all(active.items.filter(entry => entry.id === id && ITEM_WEAPON_GLB_FORMS.includes(entry.form) && !records.has(keyOf(entry.id, entry.form))
    && !failed.has(keyOf(entry.id, entry.form)) && isRemoteAsset(entry.file)).map(entry => loadRemoteEntry(entry, defaultLoad))).then(() => undefined);
}

/** 시험용: 캐시와 상태를 비운다. */
export function resetItemWeaponGlbsForTest() {
  for (const record of records.values()) { record.geometry.dispose(); record.material.dispose(); }
  records.clear(); failed.clear(); warned.clear(); remoteJobs.clear(); active = MANIFEST; pending = null;
}
