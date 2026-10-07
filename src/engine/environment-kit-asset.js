import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ENVIRONMENT_KIT_ROOT = '/models/environment/studio-kit/';
export const ENVIRONMENT_KIT_ASSETS = Object.freeze([
  'evergreen-tree', 'broadleaf-tree', 'mossy-rock-cluster', 'timber-cottage', 'village-gate', 'lantern',
]);
const templates = new Map(), pending = new Map();
const loader = new GLTFLoader();

/** 장식 자산 하나의 실패가 기존 광장의 이동·출격을 막지 않는다. */
export async function preloadEnvironmentKit({ fetcher = globalThis.fetch } = {}) {
  const results = await Promise.all(ENVIRONMENT_KIT_ASSETS.map(async id => {
    if (!pending.has(id)) pending.set(id, (async () => {
      try {
        const response = await fetcher(`${ENVIRONMENT_KIT_ROOT}${id}.glb`, { signal: AbortSignal.timeout(4500) });
        if (!response.ok) return false;
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 3000000) return false;
        const gltf = await loader.parseAsync(bytes, ENVIRONMENT_KIT_ROOT);
        templates.set(id, gltf.scene); return true;
      } catch { return false; }
    })());
    return { id, loaded: await pending.get(id) };
  }));
  return { loaded: results.filter(result => result.loaded).length, total: results.length, results };
}

/** 불변 원본 버퍼를 공유하고 배치 재질·인스턴스 버퍼만 각 장면이 소유한다. */
export function buildEnvironmentInstances(placements, { assets = templates, name = 'Citadel_StudioKit' } = {}) {
  const root = new THREE.Group(); root.name = name;
  const bins = new Map(), materials = new Set(), matrix = new THREE.Object3D();
  for (const placement of placements) {
    const key = `${placement.asset}:${placement.chunk || 'plaza'}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(placement);
  }
  let instanceCount = 0, batchCount = 0;
  for (const [key, entries] of bins) {
    const source = assets instanceof Map ? assets.get(entries[0].asset) : assets[entries[0].asset];
    const template = source?.scene || source;
    if (!template) continue;
    template.updateMatrixWorld(true);
    template.traverse(node => {
      if (!node.isMesh || node.isSkinnedMesh) return;
      const copy = material => {
        const next = new THREE.MeshLambertMaterial({
          color: material.color, vertexColors: material.vertexColors, side: THREE.FrontSide,
          emissive: material.emissive, emissiveIntensity: Math.min(material.emissiveIntensity || 0, .12),
        });
        next.name = material.name; materials.add(next); return next;
      };
      const material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      const mesh = new THREE.InstancedMesh(node.geometry, material, entries.length);
      entries.forEach((placement, index) => {
        matrix.position.set(placement.x, placement.y || 0, placement.z);
        matrix.rotation.set(0, placement.yaw || 0, 0);
        matrix.scale.setScalar(placement.scale || 1); matrix.updateMatrix();
        mesh.setMatrixAt(index, matrix.matrix.multiply(node.matrixWorld));
      });
      mesh.name = `StudioKit_${key}`; mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); root.add(mesh); batchCount++;
    });
    instanceCount += entries.length;
  }
  let disposed = false;
  root.userData = { version: 'studio-environment-v1', instanceCount, batchCount, dispose() {
    if (disposed) return; disposed = true;
    for (const material of materials) material.dispose();
    root.traverse(node => { if (node.isInstancedMesh) node.dispose(); });
    root.removeFromParent();
  } };
  return root;
}
