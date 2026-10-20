import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * 유리 정원 소품 키트(Blender 제작, tools/art/build-glass-garden-kit-v1.py).
 * 소품마다 LOD0/LOD1 GLB 한 쌍이며 재질은 gg_matte(정점 색, 조명 받음)와 gg_glow(발광 × 정점 색)뿐이다.
 * 여기서는 원본 지오메트리를 읽어 필요한 속성만 복사한 불변 템플릿으로 보관하고,
 * 방별 병합 장식(glass-garden-decor.js)이 템플릿을 복사해 쓴다.
 */
export const GLASS_GARDEN_KIT_ROOT = '/models/glass-garden-kit-v1/';
export const GLASS_GARDEN_KIT_ASSETS = Object.freeze([
  'crystal-cluster-s', 'crystal-cluster-l', 'trellis-arch', 'planter-crystal', 'moss-edging', 'hanging-lantern',
]);
const MAX_BYTES = 200000;
const templates = new Map(), pending = new Map();
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** 불러온 GLB 장면에서 재질 이름별 지오메트리를 뽑는다. 월드 행렬은 지오메트리에 구워 넣는다.
 * @param {THREE.Object3D} scene @returns {{matte: THREE.BufferGeometry[], glow: THREE.BufferGeometry[]}} */
export function extractKitGeometry(scene) {
  scene.updateMatrixWorld(true);
  /** @type {{matte: THREE.BufferGeometry[], glow: THREE.BufferGeometry[]}} */
  const parts = { matte: [], glow: [] };
  scene.traverse(node => {
    if (!node.isMesh || node.isSkinnedMesh) return;
    const source = node.geometry, position = source.getAttribute('position'), normal = source.getAttribute('normal'), color = source.getAttribute('color');
    if (!position || !color) return;
    const count = position.count, geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(node.matrixWorld), v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).toArray(positions, i * 3);
      if (normal) v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().toArray(normals, i * 3);
      colors[i * 3] = color.getX(i); colors[i * 3 + 1] = color.getY(i); colors[i * 3 + 2] = color.getZ(i);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (source.index) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(source.index.array), 1));
    const names = (Array.isArray(node.material) ? node.material : [node.material]).map(material => material?.name || '');
    parts[names.some(name => name.includes('glow')) ? 'glow' : 'matte'].push(geometry);
  });
  return parts;
}

async function loadKitFile(fetcher, id, lod) {
  const response = await fetcher(`${GLASS_GARDEN_KIT_ROOT}${id}${lod ? '-lod1' : ''}.glb`, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) return false;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return false;
  const gltf = await loader.parseAsync(bytes, GLASS_GARDEN_KIT_ROOT);
  const entry = templates.get(id) || {};
  entry[lod ? 'lod1' : 'lod0'] = extractKitGeometry(gltf.scene);
  templates.set(id, entry);
  return true;
}

/** 키트 하나의 실패가 던전 입장을 막지 않는다. 장식 자산은 선택 사항이다.
 * 진행 중인 요청만 공유하고, 실패(HTTP 오류·크기 초과·예외)는 캐시에 남기지 않아 다음 호출이 다시 시도한다. */
export async function preloadGlassGardenKit({ fetcher = globalThis.fetch } = {}) {
  const jobs = [];
  for (const id of GLASS_GARDEN_KIT_ASSETS) for (const lod of [0, 1]) {
    const key = `${id}:${lod}`;
    if (!pending.has(key)) {
      const task = loadKitFile(fetcher, id, lod).then(
        loaded => { if (!loaded) pending.delete(key); return loaded; },
        () => { pending.delete(key); return false; });
      pending.set(key, task);
    }
    jobs.push(pending.get(key).then(loaded => ({ id, lod, loaded })));
  }
  const results = await Promise.all(jobs);
  return { loaded: results.filter(result => result.loaded).length, total: results.length, results };
}

/** 모든 소품의 두 LOD가 준비됐을 때만 장식을 올린다(일부만 있는 반쪽 장식을 막는다). */
export function glassGardenKitTemplates() {
  for (const id of GLASS_GARDEN_KIT_ASSETS) if (!templates.get(id)?.lod0) return null;
  return templates;
}
/** 템플릿과 요청 캐시를 모두 비운다(시험용). */
export function clearGlassGardenKit() { templates.clear(); pending.clear(); }
export function setGlassGardenKitTemplates(map) {
  templates.clear();
  for (const [id, entry] of map) templates.set(id, entry);
}

/** 발광 재질: 정점 색을 방출색에도 곱한다(블룸이 수정·등불만 잡도록 정점 색으로 세기를 조절). */
export function createGlowMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: .85, side: THREE.DoubleSide });
  material.name = 'gg_glow';
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    prior.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif');
  };
  material.customProgramCacheKey = () => 'glass-garden-glow-v1';
  return material;
}
export function createMatteMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  material.name = 'gg_matte';
  return material;
}
